// 破冰局 · A：AI 画作评分（多模态）
// 契约：
//   请求 POST { "artwork_id": "<uuid>" }，需登录态 Authorization: Bearer <access_token>
//   成功 { status:"success", composition, creativity, relevance, total, comment }
//   失败 { status:"failed"|"timeout", error } —— 客户端据此降级，不影响投票/结算
// 幂等：ai_scores.artwork_id 唯一；同一幅画重复调用只会产生一条记录。
// 函数密钥：AI_BASE_URL / AI_API_KEY / AI_MODEL / AI_TIMEOUT_MS / ARTWORK_BUCKET
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const DEFAULT_BUCKET = "artworks"
const DEFAULT_TIMEOUT_MS = 5000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function clampScore(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}

function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

function promptFor(word: string | null) {
  return [
    "你是线下破冰游戏的画作评审，玩家用一根手指在手机上画图。",
    word ? `本轮题目是「${word}」。` : "本轮题目未知。",
    "请只输出 JSON，不要输出解释：",
    '{"composition": 0-100 的整数, "creativity": 0-100 的整数, "relevance": 0-100 的整数, "comment": "一句中文点评（不超过 40 字）"}',
    "评分标准：构图看布局是否完整平衡；创意看表达是否有想法；契合度看是否画出了题目所示的事物。",
    "空白、乱划、与题目无关的画作三项都应给低分。",
  ].join("\n")
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405)

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return json({ error: "AUTH_REQUIRED" }, 401)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "SUPABASE_NOT_CONFIGURED" }, 500)

  let body: { artwork_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: "BAD_JSON" }, 400)
  }
  const artworkId = body.artwork_id
  if (!artworkId) return json({ error: "ARTWORK_ID_REQUIRED" }, 422)

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json({ error: "AUTH_INVALID" }, 401)
  const userId = authData.user.id

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 画作 + 房间归属
  const { data: artwork, error: artworkError } = await admin
    .from("artworks")
    .select("id, game_id, user_id, storage_path, status, games(room_id)")
    .eq("id", artworkId)
    .maybeSingle()

  if (artworkError || !artwork) return json({ error: "ARTWORK_NOT_FOUND" }, 404)

  const roomId = (artwork.games as { room_id?: string } | null)?.room_id
  if (!roomId) return json({ error: "GAME_NOT_FOUND" }, 404)

  const { data: member } = await admin
    .from("room_members")
    .select("user_id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle()

  if (!member) return json({ error: "NOT_A_MEMBER" }, 403)

  // 幂等：已有成功结果直接返回
  const { data: existing } = await admin
    .from("ai_scores")
    .select("*")
    .eq("artwork_id", artworkId)
    .maybeSingle()

  if (existing?.status === "success") return json(existing)
  if (existing?.status === "pending") {
    const ageMs = Date.now() - new Date(existing.created_at as string).getTime()
    if (ageMs < DEFAULT_TIMEOUT_MS * 2) return json(existing)
  }

  // 占位（唯一约束保证只有一条）
  const { error: claimError } = await admin.from("ai_scores").upsert(
    {
      artwork_id: artworkId,
      status: "pending",
      provider: Deno.env.get("AI_PROVIDER") ?? "multimodal",
      model: Deno.env.get("AI_MODEL") ?? null,
    },
    { onConflict: "artwork_id", ignoreDuplicates: true },
  )
  if (claimError) return json({ error: "SCORE_CLAIM_FAILED", detail: claimError.message }, 500)

  const apiKey = Deno.env.get("AI_API_KEY")
  const baseUrl = (Deno.env.get("AI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "")
  const model = Deno.env.get("AI_MODEL") ?? "gpt-4o-mini"
  const timeoutMs = Number(Deno.env.get("AI_TIMEOUT_MS") ?? DEFAULT_TIMEOUT_MS)
  const bucket = Deno.env.get("ARTWORK_BUCKET") ?? DEFAULT_BUCKET

  const finish = async (patch: Record<string, unknown>, artworkStatus: "scored" | "failed") => {
    await admin.from("ai_scores").update(patch).eq("artwork_id", artworkId)
    await admin.from("artworks").update({ status: artworkStatus }).eq("id", artworkId)
  }

  if (!apiKey) {
    await finish({ status: "failed", error: "AI_NOT_CONFIGURED" }, "failed")
    return json({ status: "failed", error: "AI_NOT_CONFIGURED" })
  }

  // 目标词取自该玩家本局词牌
  const { data: secret } = await admin
    .from("game_secrets")
    .select("word")
    .eq("game_id", artwork.game_id)
    .eq("user_id", artwork.user_id)
    .maybeSingle()

  let dataUrl = ""
  try {
    const { data: signed, error: signedError } = await admin.storage
      .from(bucket)
      .createSignedUrl(artwork.storage_path as string, 60)
    if (signedError || !signed?.signedUrl) throw new Error(signedError?.message ?? "signed url failed")

    const imageResponse = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(timeoutMs) })
    if (!imageResponse.ok) throw new Error(`image fetch ${imageResponse.status}`)
    const bytes = new Uint8Array(await imageResponse.arrayBuffer())
    let binary = ""
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
    dataUrl = `data:image/png;base64,${btoa(binary)}`
  } catch (error) {
    await finish({ status: "failed", error: `IMAGE_UNAVAILABLE: ${String(error)}` }, "failed")
    return json({ status: "failed", error: "IMAGE_UNAVAILABLE" })
  }

  const startedAt = Date.now()
  let content = ""
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: promptFor(secret?.word ?? null) },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) throw new Error(`provider ${response.status}: ${(await response.text()).slice(0, 200)}`)
    const payload = await response.json()
    content = payload?.choices?.[0]?.message?.content ?? ""
  } catch (error) {
    const isTimeout = String(error).toLowerCase().includes("abort")
    await finish(
      { status: isTimeout ? "timeout" : "failed", error: String(error).slice(0, 300), latency_ms: Date.now() - startedAt },
      "failed",
    )
    return json({ status: isTimeout ? "timeout" : "failed", error: String(error).slice(0, 200) })
  }

  const parsed = extractJson(content)
  const composition = clampScore(parsed?.composition)
  const creativity = clampScore(parsed?.creativity)
  const relevance = clampScore(parsed?.relevance)

  if (composition === null || creativity === null || relevance === null) {
    await finish(
      { status: "failed", error: "BAD_PROVIDER_JSON", latency_ms: Date.now() - startedAt },
      "failed",
    )
    return json({ status: "failed", error: "BAD_PROVIDER_JSON" })
  }

  const total = Math.round(composition * 0.4 + creativity * 0.3 + relevance * 0.3)
  const comment = typeof parsed?.comment === "string" ? parsed.comment.slice(0, 120) : ""

  await finish(
    {
      status: "success",
      composition,
      creativity,
      relevance,
      total,
      comment,
      model,
      latency_ms: Date.now() - startedAt,
      completed_at: new Date().toISOString(),
      error: null,
    },
    "scored",
  )

  return json({ status: "success", composition, creativity, relevance, total, comment })
})
