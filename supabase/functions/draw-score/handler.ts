// 普通你画我猜：主持人触发，题面取私有通道，图像从私有 Storage 读取。
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' }
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return reply({})
  if (req.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: auth, error: authError } = await admin.auth.getUser(token)
    if (authError || !auth.user) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const body = await req.json()
    const roomId = String(body.room_id ?? '')
    const roundKey = String(body.round_key ?? '')
    const imageRef = String(body.image_ref ?? '')
    if (!/^[\da-f-]{36}$/i.test(roomId) || imageRef.length > 512) return reply({ error: 'BAD_REQUEST' }, 400)
    const { data: room } = await admin.from('rooms').select('host_id,closed_at').eq('id', roomId).maybeSingle()
    if (!room || room.closed_at) return reply({ error: 'ROOM_NOT_FOUND' }, 404)
    if (room.host_id !== auth.user.id) return reply({ error: 'HOST_ONLY' }, 403)
    const { data: member } = await admin.from('room_members').select('user_id').eq('room_id', roomId).eq('user_id', auth.user.id).is('left_at', null).maybeSingle()
    if (!member) return reply({ error: 'NOT_A_MEMBER' }, 403)
    const { data: session } = await admin.from('draw_sessions').select('view').eq('room_id', roomId).maybeSingle()
    const view = session?.view
    if (!view || view.roundKey !== roundKey || !['drawing', 'reveal'].includes(view.phase)) return reply({ error: 'STALE_ROUND' }, 409)
    if (!validDrawingRef(roomId, roundKey, view.painterId, imageRef)) return reply({ error: 'INVALID_DRAWING_REF' }, 400)
    const gameKey = String(view.gameId ?? '')
    if (!gameKey || gameKey.length > 128) return reply({ error: 'BAD_GAME_KEY' }, 400)
    const key = { room_id: roomId, game_key: gameKey, round_key: roundKey }
    const { data: cached, error: cacheError } = await admin.from('draw_ai_scores').select('*').match(key).maybeSingle()
    if (cacheError) return reply({ error: 'SCORING_STORAGE_UNAVAILABLE' }, 503)
    if (cached && cached.image_ref !== imageRef) return reply({ error: 'DRAWING_ALREADY_SUBMITTED' }, 409)
    if (cached?.result && ['success', 'unsupported'].includes(cached.status) && (cached.result.scoringVersion === 'confidence-v2' || cached.status === 'unsupported')) return reply(cached.result)
    if (cached?.status === 'pending' && Date.now() - Date.parse(cached.updated_at) < 65000) return reply({ status: 'pending' })

    const claim = { ...key, image_ref: imageRef, status: 'pending', result: null, updated_at: new Date().toISOString() }
    const claimed = cached
      ? await admin.from('draw_ai_scores').update(claim).match(key).eq('updated_at', cached.updated_at).select('room_id')
      : await admin.from('draw_ai_scores').insert(claim).select('room_id')
    if (claimed.error?.code === '23505' || (!claimed.error && !claimed.data?.length)) return reply({ status: 'pending' })
    if (claimed.error) return reply({ error: 'SCORE_CLAIM_FAILED' }, 500)
    async function finish(result: Record<string, unknown>) {
      const { error } = await admin.from('draw_ai_scores').update({ status: result.status, result, updated_at: new Date().toISOString() }).match(key)
      if (error) throw new Error('SCORE_SAVE_FAILED')
      return reply(result)
    }

    try {
      const { data: privateWord } = await admin.from('draw_words').select('word').eq('room_id', roomId).eq('round_key', roundKey).eq('user_id', view.painterId).maybeSingle()
      if (!privateWord?.word) return await finish({ status: 'failed', error: 'WORD_NOT_READY' })
      const word = String(privateWord.word)
      const expected = expectedClassFor(word) ?? DRAWZY_CLASSES.find(value => value === word.trim().toLowerCase())
      if (!expected) return await finish({ status: 'unsupported', error: 'UNSUPPORTED_WORD', comment: '此题不在 AI 识别词库中，本轮不计 AI 分，猜题分正常计算。' })
      const base = (Deno.env.get('AI_BASE_URL') ?? '').replace(/\/$/, '')
      if (!base.startsWith('https://')) return await finish({ status: 'failed', error: 'AI_NOT_CONFIGURED' })
      const started = Date.now()
      const { data: image, error: imageError } = await admin.storage.from('artworks').download(imageRef)
      if (imageError || !image) return await finish({ status: 'failed', error: 'IMAGE_UNAVAILABLE' })
      if (image.size > 1024 * 1024) return await finish({ status: 'failed', error: 'IMAGE_TOO_LARGE' })
      const bytes = new Uint8Array(await image.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const serviceToken = Deno.env.get('DRAWZY_TOKEN')
      if (serviceToken) headers.Authorization = `Bearer ${serviceToken}`
      const response = await fetch(`${base}/predict/sketch`, { method: 'POST', headers, body: JSON.stringify({ sketch_data: btoa(binary) }), signal: AbortSignal.timeout(45000) })
      if (!response.ok) throw new Error(`DRAWZY_HTTP_${response.status}`)
      const raw = await response.json()
      return await finish({ ...evaluateRecognition(word, raw), latencyMs: Date.now() - started })
    } catch (error) {
      const timeout = /timeout|abort/i.test(String(error))
      console.error('[draw-score] provider failed', String(error))
      return await finish({ status: timeout ? 'timeout' : 'failed', error: timeout ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE' })
    }
  } catch (error) {
    console.error('[draw-score]', String(error))
    return reply({ error: 'SCORING_FAILED' }, 500)
  }
})
