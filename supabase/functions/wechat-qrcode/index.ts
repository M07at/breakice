// 破冰局 · 微信小程序码
//
// 客户端普通二维码只能扫出文本；要"扫一下直接拉起小程序"必须用官方小程序码，
// 而生成小程序码要用 access_token，只能放在服务端。
//
// 请求：POST { room_code: "ABC123", env?: "release" | "trial" | "develop" }
// 响应：{ image: "data:image/png;base64,...", env } 或 { error, detail }
//
// 需要的函数级密钥：WECHAT_APPID / WECHAT_SECRET（或 WECHAT_APPSECRET）
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token"
const CODE_URL = "https://api.weixin.qq.com/wxa/getwxacodeunlimit"
/** 扫码后落在加入房间页；页面里会解析 scene 里的房间号 */
const CODE_PAGE = "pages/join/index"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

type Admin = ReturnType<typeof createClient>

async function loadAccessToken(admin: Admin, appid: string, secret: string, force = false): Promise<string> {
  if (!force) {
    const { data } = await admin
      .from("wechat_tokens")
      .select("value, expires_at")
      .eq("kind", "access_token")
      .maybeSingle()
    const expiresAt = data?.expires_at ? new Date(data.expires_at).getTime() : 0
    if (data?.value && expiresAt - Date.now() > 60_000) return data.value
  }

  const url = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
  const payload = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }
  if (!payload.access_token) {
    throw new Error(`换取 access_token 失败：${payload.errcode ?? "?"} ${payload.errmsg ?? ""}`)
  }

  await admin.from("wechat_tokens").upsert({
    kind: "access_token",
    value: payload.access_token,
    expires_at: new Date(Date.now() + Math.max(60, (payload.expires_in ?? 7200) - 200) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  })

  return payload.access_token
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const appid = Deno.env.get("WECHAT_APPID")
  const secret = Deno.env.get("WECHAT_SECRET") ?? Deno.env.get("WECHAT_APPSECRET")
  if (!supabaseUrl || !serviceKey) return json({ error: "SUPABASE_NOT_CONFIGURED" }, 500)
  if (!appid || !secret) return json({ error: "WECHAT_NOT_CONFIGURED", detail: "缺少 WECHAT_APPID / WECHAT_SECRET" }, 500)

  try {
    const body = (await req.json().catch(() => ({}))) as { room_code?: string; env?: string }
    const roomCode = String(body.room_code ?? "").trim().toUpperCase()
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) return json({ error: "BAD_ROOM_CODE" }, 422)

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData?.user) return json({ error: "AUTH_REQUIRED" }, 401)
    const uid = userData.user.id

    // 只给本房间成员生成，避免有人拿房间号批量刷小程序码
    const { data: room } = await admin.from("rooms").select("id").eq("code", roomCode).maybeSingle()
    if (!room) return json({ error: "ROOM_NOT_FOUND" }, 404)
    const { data: member } = await admin
      .from("room_members")
      .select("user_id")
      .eq("room_id", room.id)
      .eq("user_id", uid)
      .is("left_at", null)
      .maybeSingle()
    if (!member) return json({ error: "NOT_A_MEMBER" }, 403)

    const env = body.env === "trial" || body.env === "develop" ? body.env : "release"

    let accessToken = await loadAccessToken(admin, appid, secret)
    let image = await requestCode(accessToken, roomCode, env)
    if (!image.ok) {
      // token 失效（40001/42001）时强制刷新一次
      accessToken = await loadAccessToken(admin, appid, secret, true)
      image = await requestCode(accessToken, roomCode, env)
    }
    if (!image.ok) return json({ error: "WXACODE_FAILED", detail: image.detail }, 502)

    return json({ image: `data:image/png;base64,${image.base64}`, env, room_code: roomCode })
  } catch (error) {
    console.error("[wechat-qrcode]", error)
    return json({ error: "UNEXPECTED", detail: String(error) }, 500)
  }
})

type CodeResult = { ok: true; base64: string } | { ok: false; detail: string }

async function requestCode(accessToken: string, scene: string, env: string): Promise<CodeResult> {
  const res = await fetch(`${CODE_URL}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scene,
      page: CODE_PAGE,
      // 开发版/体验版里页面路径可能还没发布，关掉校验
      check_path: false,
      env_version: env,
      width: 430,
      auto_color: false,
      line_color: { r: 79, g: 70, b: 229 },
    }),
  })

  const contentType = res.headers.get("content-type") ?? ""
  // 成功时是图片二进制，失败时是 JSON
  if (contentType.includes("application/json") || contentType.includes("text/plain")) {
    const text = await res.text()
    return { ok: false, detail: text.slice(0, 300) }
  }

  const buffer = new Uint8Array(await res.arrayBuffer())
  if (buffer.byteLength < 200) {
    return { ok: false, detail: `图片异常（${buffer.byteLength} 字节）` }
  }

  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < buffer.length; i += chunk) {
    binary += String.fromCharCode(...buffer.subarray(i, i + chunk))
  }
  return { ok: true, base64: btoa(binary) }
}
