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


// ---------------------------------------------------------------------------
// 中文词 → drawzy 的英文类别（与 app/src/modules/draw/classMap.ts 保持一致）
// 这里是服务端的精简副本：Edge Function 不能 import 前端模块。
// ---------------------------------------------------------------------------
const WORD_TO_CLASS: Record<string, string> = {
  苹果: "apple", 香蕉: "banana", 面包: "bread", 西兰花: "broccoli", 芦笋: "asparagus",
  蓝莓: "blueberry", 黑莓: "blackberry", 生日蛋糕: "birthday cake", 蛋糕: "birthday cake",
  蚂蚁: "ant", 蜜蜂: "bee", 熊: "bear", 鸟: "bird", 蝙蝠: "bat",
  飞机: "airplane", 救护车: "ambulance", 自行车: "bicycle", 单车: "bicycle",
  背包: "backpack", 望远镜: "binoculars",
  闹钟: "alarm clock", 斧头: "axe", 斧子: "axe", 绷带: "bandage", 棒球: "baseball",
  棒球棒: "baseball bat", 篮球: "basketball", 篮子: "basket", 浴缸: "bathtub",
  床: "bed", 皮带: "belt", 长椅: "bench", 书: "book", 书本: "book",
  回旋镖: "boomerang", 瓶盖: "bottlecap", 领结: "bowtie", 手链: "bracelet",
  大脑: "brain", 桥: "bridge", 扫帚: "broom", 水桶: "bucket", 桶: "bucket",
  手臂: "arm", 天使: "angel", 胡子: "beard",
  海滩: "beach", 谷仓: "barn", 动物迁徙: "animal migration", 铁砧: "anvil",
}

function expectedClassFor(word: string): string {
  const text = word.trim()
  if (!text) return ""
  if (WORD_TO_CLASS[text]) return WORD_TO_CLASS[text]
  const keys = Object.keys(WORD_TO_CLASS).filter((key) => text.includes(key) || key.includes(text))
  keys.sort((a, b) => b.length - a.length)
  return keys.length > 0 ? WORD_TO_CLASS[keys[0]] : ""
}

/** 猜中 80+（越快越高），没猜中 80-（越慢越低），与 app 侧的 aiScore.ts 同口径 */
function scoreFromGuess(input: { correct: boolean; seconds: number }): number {
  const seconds = Math.min(60, Math.max(0, Number.isFinite(input.seconds) ? input.seconds : 60))
  const ratio = 1 - seconds / 60
  const raw = input.correct ? 80 + 20 * ratio : 80 * ratio
  return Math.min(100, Math.max(0, Math.round(raw)))
}

function describeGuess(input: { correct: boolean; guess: string; seconds: number }): string {
  const parts: string[] = []
  if (input.guess) parts.push(`AI 猜：${input.guess}`)
  parts.push(`用时 ${input.seconds.toFixed(1)} 秒`)
  parts.push(input.correct ? "猜中了" : "没猜中")
  return parts.join(" · ")
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

  const mode = Deno.env.get("AI_MODE") ?? "chat"
  if (mode !== "guess" && !apiKey) {
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

  const startedGuessAt = Date.now()
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

  // ---- guess 模式：调 drawzy 的 /predict/sketch，用「猜中与否 + 用时」算分 ----
  if (mode === "guess") {
    const expected = expectedClassFor((secret?.word as string | undefined) ?? "")
    const base64 = dataUrl.split(",")[1] ?? ""
    const guessStarted = Date.now()
    try {
      const response = await fetch(`${baseUrl}/predict/sketch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sketch_data: base64 }),
        // drawzy 首次调用要加载模型，固定给足 45 秒，不依赖 Secret
        signal: AbortSignal.timeout(Math.max(timeoutMs, 45000)),
      })
      if (!response.ok) throw new Error(`drawzy ${response.status} ${await response.text().catch(() => '')}`.slice(0, 200))
      const payload = await response.json() as {
        data?: { sketch_class_name?: string; top_five_sketch_classes?: string[] }
      }
      const predicted = String(payload.data?.sketch_class_name ?? "")
      const top5 = (payload.data?.top_five_sketch_classes ?? []).map((item) => String(item).toLowerCase())
      const seconds = Math.round((guessStarted - startedGuessAt) / 100) / 10
      const correct = Boolean(expected) && top5.includes(expected.toLowerCase())
      const score = scoreFromGuess({ correct, seconds })
      const comment = describeGuess({ correct, guess: predicted, seconds })
      await finish(
        { status: "success", total: score, comment, provider: "drawzy", model: "quickdraw-cnn", ai_guess: predicted, ai_seconds: seconds },
        "scored",
      )
      return json({ status: "success", score, comment, guess: predicted, seconds })
    } catch (error) {
      await finish({ status: "failed", error: `DRAWZY_FAILED: ${String(error)}` }, "failed")
      return json({ status: "failed", error: "DRAWZY_FAILED" })
    }
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
