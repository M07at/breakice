// Hybrid: private image and assigned private word -> DeepSeek semantic similarity.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { scoreDrawingSimilarity, DEEPSEEK_SCORE_VERSION, DEEPSEEK_MODEL } from '../_shared/deepseek.ts'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return json({ error: 'SUPABASE_NOT_CONFIGURED' }, 500)
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: auth, error: authError } = await admin.auth.getUser(token)
    if (authError || !auth.user) return json({ error: 'AUTH_INVALID' }, 401)
    let body: { artwork_id?: string }
    try { body = await req.json() } catch { return json({ error: 'BAD_JSON' }, 400) }
    if (!body.artwork_id) return json({ error: 'ARTWORK_ID_REQUIRED' }, 422)
    const artworkId = body.artwork_id
    const { data: art } = await admin.from('artworks').select('id,game_id,user_id,storage_path,games(room_id)').eq('id', artworkId).maybeSingle()
    if (!art) return json({ error: 'ARTWORK_NOT_FOUND' }, 404)
    const roomId = (art.games as { room_id?: string } | null)?.room_id
    if (!roomId) return json({ error: 'GAME_NOT_FOUND' }, 404)
    const { data: member } = await admin.from('room_members').select('user_id').eq('room_id', roomId).eq('user_id', auth.user.id).is('left_at', null).maybeSingle()
    if (!member) return json({ error: 'NOT_A_MEMBER' }, 403)
    const { data: existing, error: readError } = await admin.from('ai_scores').select('*').eq('artwork_id', artworkId).maybeSingle()
    if (readError) return json({ error: 'SCORING_STORAGE_UNAVAILABLE' }, 503)
    const version = `${DEEPSEEK_MODEL}:${DEEPSEEK_SCORE_VERSION}`
    if (existing?.status === 'success' && existing.model === version) return json(existing)
    if (existing?.status === 'pending' && Date.now() - Date.parse(existing.created_at) < 45000) return json({ status: 'pending' })
    const claim = { artwork_id: artworkId, status: 'pending', provider: 'deepseek', model: version, created_at: new Date().toISOString(), total: null, error: null }
    const claimed = existing
      ? await admin.from('ai_scores').update(claim).eq('artwork_id', artworkId).eq('created_at', existing.created_at).select('artwork_id')
      : await admin.from('ai_scores').insert(claim).select('artwork_id')
    if (claimed.error?.code === '23505' || (!claimed.error && !claimed.data?.length)) return json({ status: 'pending' })
    if (claimed.error) return json({ error: 'SCORE_CLAIM_FAILED' }, 500)
    const finish = async (patch: Record<string, unknown>, status: string) => {
      const { error } = await admin.from('ai_scores').update(patch).eq('artwork_id', artworkId)
      if (error) throw new Error('SCORE_SAVE_FAILED')
      await admin.from('artworks').update({ status }).eq('id', artworkId)
    }
    try {
      const { data: secret } = await admin.from('game_secrets').select('word').eq('game_id', art.game_id).eq('user_id', art.user_id).maybeSingle()
      if (!secret?.word) throw new Error('WORD_NOT_READY')
      const { data: image, error: imageError } = await admin.storage.from(Deno.env.get('ARTWORK_BUCKET') ?? 'artworks').download(art.storage_path)
      if (imageError || !image) throw new Error('IMAGE_UNAVAILABLE')
      if (image.size > 1024 * 1024) throw new Error('IMAGE_TOO_LARGE')
      const result = await scoreDrawingSimilarity(secret.word, new Uint8Array(await image.arrayBuffer()))
      await finish({ status: 'success', total: result.total, relevance: result.total, composition: null, creativity: null,
        comment: result.comment, ai_guess: result.guess, ai_seconds: null, provider: 'deepseek', model: version,
        latency_ms: result.latencyMs, completed_at: new Date().toISOString(), error: null }, 'scored')
      return json(result)
    } catch (error) {
      const timeout = /timeout|abort/i.test(String(error))
      await finish({ status: timeout ? 'timeout' : 'failed', total: null, relevance: null, composition: null, creativity: null, ai_guess: null, ai_seconds: null,
        comment: 'AI 相似度评分暂不可用，本轮未计 AI 分。', error: error instanceof Error ? error.message.slice(0, 100) : 'AI_UNAVAILABLE' }, 'failed')
      return json({ status: timeout ? 'timeout' : 'failed', error: 'AI_UNAVAILABLE' })
    }
  } catch { return json({ error: 'SCORING_FAILED' }, 500) }
})
