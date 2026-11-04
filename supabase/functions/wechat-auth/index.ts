// 破冰局 · A：微信登录 → Supabase 会话
// 流程：wx.login() 拿 code → 本函数调 jscode2session 换 openid → 建/取用户 → 返回会话
// 需要的函数级密钥（不要放进前端）：
//   WECHAT_APPID / WECHAT_APPSECRET / WECHAT_LOGIN_SECRET
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

/** 由服务端密钥与 openid 派生的稳定密码，避免保存明文、也便于重复登录。 */
async function derivePassword(openid: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(openid))
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 40)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405)

  let payload: { code?: string; nickname?: string; avatar_url?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: "BAD_JSON" }, 400)
  }

  const code = payload.code
  if (!code || typeof code !== "string") return json({ error: "CODE_REQUIRED" }, 422)

  const appid = Deno.env.get("WECHAT_APPID")
  // 线上项目里的密钥名是 WECHAT_SECRET，仓库这份最初写的是 WECHAT_APPSECRET；
  // 两个都认，避免重新部署时因为命名不一致直接 WECHAT_NOT_CONFIGURED。
  const appsecret = Deno.env.get("WECHAT_APPSECRET") ?? Deno.env.get("WECHAT_SECRET")
  // 派生密码用的密钥：优先 WECHAT_LOGIN_SECRET，没配就退回 AppSecret 本身。
  // 一旦线上有用户，这个值不能再改，否则老用户会变成新账号。
  const loginSecret = Deno.env.get("WECHAT_LOGIN_SECRET") ?? appsecret
  if (!appid || !appsecret) {
    return json({ error: "WECHAT_NOT_CONFIGURED" }, 500)
  }

  const url = `${SESSION_URL}?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(appsecret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`

  let session: { openid?: string; session_key?: string; errcode?: number; errmsg?: string }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    session = await response.json()
  } catch (error) {
    return json({ error: "WECHAT_UNREACHABLE", detail: String(error) }, 502)
  }

  if (!session.openid) {
    return json({ error: "WECHAT_LOGIN_FAILED", detail: session }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "SUPABASE_NOT_CONFIGURED" }, 500)

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const email = `${session.openid}@wechat.local`
  const password = await derivePassword(session.openid, loginSecret)

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id, nickname, avatar_url")
    .eq("openid", session.openid)
    .maybeSingle()

  let userId = existingProfile?.id as string | undefined

  if (!userId) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        openid: session.openid,
        nickname: payload.nickname ?? "玩家",
        avatar_url: payload.avatar_url ?? null,
      },
    })

    // 并发首次登录可能已被另一请求创建，退回查询
    if (error && !String(error.message).toLowerCase().includes("already")) {
      return json({ error: "USER_CREATE_FAILED", detail: error.message }, 500)
    }

    userId = created?.user?.id
    if (!userId) {
      const { data: retry } = await admin
        .from("profiles")
        .select("id")
        .eq("openid", session.openid)
        .maybeSingle()
      userId = retry?.id as string | undefined
    }

    if (userId) {
      await admin
        .from("profiles")
        .update({
          openid: session.openid,
          nickname: payload.nickname ?? "玩家",
          avatar_url: payload.avatar_url ?? null,
        })
        .eq("id", userId)
    }
  }

  if (!userId) return json({ error: "USER_NOT_READY" }, 500)

  const { data: signIn, error: signInError } = await admin.auth.signInWithPassword({ email, password })
  if (signInError || !signIn.session) {
    return json({ error: "SESSION_FAILED", detail: signInError?.message ?? "no session" }, 500)
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id, nickname, avatar_url, mbti, intro")
    .eq("id", userId)
    .single()

  return json({
    user_id: userId,
    access_token: signIn.session.access_token,
    refresh_token: signIn.session.refresh_token,
    expires_in: signIn.session.expires_in,
    profile,
  })
})
