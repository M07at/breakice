// 破冰局 · A：微信登录 → Supabase 会话
// 流程：wx.login() 拿 code → 本函数调 jscode2session 换 openid → 建/取用户 → 返回会话
// 需要的函数级密钥（不要放进前端）：
//   WECHAT_APPID / WECHAT_SECRET（或 WECHAT_APPSECRET）/ WECHAT_LOGIN_SECRET
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session"
const DEFAULT_NICKNAME = "玩家"

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

type Admin = ReturnType<typeof createClient>

/**
 * 按邮箱在 auth.users 里找人。
 * profiles.openid 可能因为历史迁移缺失，这里兜底，避免"用户已存在但找不到 id"。
 */
async function findUserIdByEmail(admin: Admin, email: string): Promise<string | undefined> {
  const target = email.toLowerCase()
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) return undefined
    const hit = (data.users as { id: string; email?: string }[]).find((user) => user.email?.toLowerCase() === target)
    if (hit) return hit.id
    if (data.users.length < 200) return undefined
  }
  return undefined
}

Deno.serve({ port: Number(Deno.env.get("PORT") ?? "8000") }, async (req) => {
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
  if (!appid || !appsecret) {
    return json({ error: "WECHAT_NOT_CONFIGURED", detail: "缺少 WECHAT_APPID / WECHAT_SECRET" }, 500)
  }
  // 派生密码用的密钥：优先 WECHAT_LOGIN_SECRET，没配就退回 AppSecret 本身。
  // 一旦线上有用户，这个值不能再改，否则老用户密码对不上（下面会自动重设，但仍建议固定）。
  const loginSecret = Deno.env.get("WECHAT_LOGIN_SECRET") ?? appsecret

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
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "SUPABASE_NOT_CONFIGURED", detail: "缺少 SUPABASE_URL / SERVICE_ROLE_KEY" }, 500)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const openid = String(session.openid)
  const email = `${openid}@wechat.local`
  const password = await derivePassword(openid, loginSecret)
  const nickname = payload.nickname?.trim() || DEFAULT_NICKNAME

  // ---- 1) 找到这个微信对应的账号：openid → 邮箱 → 新建 ----
  let userId: string | undefined
  let currentNickname: string | undefined

  const { data: byOpenid } = await admin
    .from("profiles")
    .select("id, nickname")
    .eq("openid", openid)
    .maybeSingle()
  if (byOpenid?.id) {
    userId = byOpenid.id as string
    currentNickname = (byOpenid.nickname as string | null) ?? undefined
  }

  if (!userId) {
    // profiles 里的 openid 可能是历史遗留的空值，按邮箱兜底
    userId = await findUserIdByEmail(admin, email)
  }

  if (!userId) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { openid, nickname, avatar_url: payload.avatar_url ?? null },
    })
    if (error && !String(error.message).toLowerCase().includes("already")) {
      return json({ error: "USER_CREATE_FAILED", detail: error.message }, 500)
    }
    userId = created?.user?.id ?? (await findUserIdByEmail(admin, email))
  }

  if (!userId) {
    return json({ error: "USER_NOT_READY", detail: "既没有现成账号，也没能新建" }, 500)
  }

  // ---- 2) 保证 profiles 行存在且 openid 正确（历史数据可能缺这两样） ----
  const { data: profileRow } = await admin
    .from("profiles")
    .select("id, nickname, avatar_url")
    .eq("id", userId)
    .maybeSingle()

  const keepNickname = profileRow?.nickname && profileRow.nickname !== DEFAULT_NICKNAME
  if (!profileRow) {
    await admin.from("profiles").insert({
      id: userId,
      openid,
      nickname,
      avatar_url: payload.avatar_url ?? null,
    })
  } else {
    await admin
      .from("profiles")
      .update({
        openid,
        // 只补默认昵称，不覆盖用户自己设置过的名字
        nickname: keepNickname ? profileRow.nickname : (currentNickname ?? nickname),
        avatar_url: profileRow.avatar_url ?? payload.avatar_url ?? null,
      })
      .eq("id", userId)
  }

  // ---- 3) 登录；历史账号的密码可能来自旧密钥，对不上就重设再试 ----
  let signIn = await admin.auth.signInWithPassword({ email, password })
  let resetPassword = false

  if (!signIn.data?.session) {
    resetPassword = true
    const { error: resetError } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    })
    if (resetError) {
      return json(
        { error: "PASSWORD_RESET_FAILED", detail: resetError.message, signIn: signIn.error?.message },
        500,
      )
    }
    signIn = await admin.auth.signInWithPassword({ email, password })
  }

  if (signIn.error || !signIn.data?.session) {
    return json({ error: "SESSION_FAILED", detail: signIn.error?.message ?? "no session" }, 500)
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id, nickname, avatar_url, mbti, intro")
    .eq("id", userId)
    .single()

  return json({
    user_id: userId,
    access_token: signIn.data.session.access_token,
    refresh_token: signIn.data.session.refresh_token,
    expires_in: signIn.data.session.expires_in,
    profile,
    // 便于排查：这次是不是靠兜底/重设密码才登进来的
    recovered: resetPassword || !byOpenid?.id,
  })
})

