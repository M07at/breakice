// 破冰局 · uc-command：服务端谁是卧底引擎
//
// 这个文件会被 scripts/build-uc-command.mjs 拼在上面的引擎代码之后，
// 所以这里**不要写 import**，直接用内联进来的 createGame / applyAction / tick / toPublicView / UcError。
//
// 请求（Authorization: Bearer <用户 access_token>）：
//   { op: 'start',  room_id, variant: 'classic'|'draw', request_id, config? }
//   { op: 'act',    game_id, action, meta: { requestId, expectedVersion, expectedPhase, expectedRound, expectedTurnKey } }
//   { op: 'tick',   game_id }        倒计时推进 + 返回快照（客户端轮询用）
//   { op: 'current', room_id }       房间当前进行中的一局（没有则返回 null）
//   { op: 'word',   game_id }        自己的词
// 响应：要么是 C 的 UcPlayerSnapshot，要么 { error: { code, message } }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorStatus(code: string): number {
  switch (code) {
    case 'AUTH_REQUIRED':
      return 401
    case 'HOST_ONLY':
    case 'NOT_A_MEMBER':
    case 'UNKNOWN_PLAYER':
      return 403
    case 'GAME_NOT_FOUND':
      return 404
    case 'STALE_STATE':
    case 'REQUEST_CONFLICT':
    case 'GAME_ACTIVE':
      return 409
    default:
      return 400
  }
}

/** 非引擎类错误（鉴权、成员身份），需要显式指定 HTTP 状态 */
class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function fail(error: unknown): Response {
  if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status)
  if (isUcError(error)) return json({ error: { code: error.code, message: error.message } }, errorStatus(error.code))
  const message = error instanceof Error ? error.message : String(error)
  console.error('[uc-command]', error)
  return json({ error: { code: 'BAD_REQUEST', message: `服务端异常：${message}` } }, 500)
}

async function digest(parts: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function pickPair(variant: Variant): WordPair {
  const pool = variant === 'draw' ? SEED_PAIRS.filter((p) => p.drawable) : SEED_PAIRS
  const list = pool.length > 0 ? pool : SEED_PAIRS
  const item = list[Math.floor(Math.random() * list.length)]
  if (!item) throw new UcError('BAD_PAIR', '词库里没有可用的词对')
  return { civilian: item.civilian, undercover: item.undercover }
}

type Admin = ReturnType<typeof createClient>

async function roomMembers(admin: Admin, roomId: string) {
  const { data, error } = await admin
    .from('room_members')
    .select('user_id, seat, ready, profiles(nickname)')
    .eq('room_id', roomId)
    .is('left_at', null)
    .order('seat')
  if (error) throw new UcError('BAD_REQUEST', `读取房间成员失败：${error.message}`)
  return (data ?? []) as { user_id: string; seat: number; ready: boolean; profiles?: { nickname?: string } }[]
}

function snapshotOf(input: {
  gameId: string
  gameNumber: number
  state: UcState
  viewerId: string
  hostId: string
  members: { user_id: string; profiles?: { nickname?: string } }[]
}) {
  return {
    sessionId: input.gameId,
    gameId: input.gameId,
    gameNumber: input.gameNumber,
    playerId: input.viewerId,
    hostId: input.hostId,
    players: input.members.map((m) => ({ id: m.user_id, name: m.profiles?.nickname ?? '玩家' })),
    view: toPublicView(input.state),
    serverNow: Date.now(),
  }
}

async function loadGame(admin: Admin, gameId: string) {
  const { data, error } = await admin
    .from('games')
    .select('id, room_id, game_number, variant, status, version, state, view')
    .eq('id', gameId)
    .maybeSingle()
  if (error) throw new UcError('BAD_REQUEST', `读取局次失败：${error.message}`)
  if (!data) throw new UcError('GAME_NOT_FOUND', '这局游戏不存在')
  return data as {
    id: string
    room_id: string
    game_number: number
    variant: Variant
    status: 'active' | 'ended'
    version: number
    state: UcState
    view: unknown
  }
}

async function handleStart(admin: Admin, uid: string, body: Record<string, any>): Promise<Response> {
  const roomId = String(body.room_id ?? '')
  const variant: Variant = body.variant === 'draw' ? 'draw' : 'classic'
  const requestId = String(body.request_id ?? crypto.randomUUID())

  const { data: room, error } = await admin
    .from('rooms')
    .select('id, host_id, status, max_players')
    .eq('id', roomId)
    .maybeSingle()
  if (error) throw new UcError('BAD_REQUEST', `读取房间失败：${error.message}`)
  if (!room) throw new UcError('GAME_NOT_FOUND', '房间不存在或已关闭')
  if (room.host_id !== uid) throw new UcError('HOST_ONLY', '只有主持人可以开始游戏')
  if (room.status !== 'lobby') throw new UcError('GAME_ACTIVE', '房间里已经有一局了')

  const members = await roomMembers(admin, roomId)
  if (members.length < 4) throw new UcError('PLAYER_COUNT', '至少需要 4 名玩家')
  if (members.some((m) => !m.ready)) throw new UcError('BAD_CONFIG', '还有玩家没有准备')

  const { data: active } = await admin
    .from('games')
    .select('id')
    .eq('room_id', roomId)
    .eq('status', 'active')
    .maybeSingle()
  if (active) throw new UcError('GAME_ACTIVE', '房间里已经有一局了')

  const config = { ...DEFAULT_CONFIG, variant, ...(body.config ?? {}) }
  const startedAt = Date.now()
  const transition = createGame({
    playerIds: members.map((m) => m.user_id),
    pair: pickPair(variant),
    config,
    now: startedAt,
    rng: createRng(Math.floor(Math.random() * 0x7fffffff)),
  })
  const state = transition.state
  const view = toPublicView(state)
  const secrets = state.players.map((p) => ({
    user_id: p.id,
    // game_secrets.word 是 not null，白板用空串占位；客户端按 isBlank 判断
    word: p.word ?? '',
    camp: p.role === 'undercover' ? 'undercover' : 'civilian',
  }))

  const { data: gameId, error: startError } = await admin.rpc('uc_start_game', {
    p_actor: uid,
    p_room_id: roomId,
    p_variant: variant,
    p_state: state,
    p_view: view,
    p_secrets: secrets,
    p_request_id: requestId,
  })
  if (startError) {
    if (/GAME_ACTIVE/.test(startError.message)) throw new UcError('GAME_ACTIVE', '房间里已经有一局了')
    if (/HOST_ONLY/.test(startError.message)) throw new UcError('HOST_ONLY', '只有主持人可以开始游戏')
    throw new UcError('BAD_REQUEST', `开局失败：${startError.message}`)
  }

  const { data: created } = await admin.from('games').select('game_number').eq('id', String(gameId)).maybeSingle()
  return json(
    snapshotOf({
      gameId: String(gameId),
      gameNumber: created?.game_number ?? 1,
      state,
      viewerId: uid,
      hostId: room.host_id,
      members,
    }),
  )
}

async function handleAct(admin: Admin, uid: string, body: Record<string, any>): Promise<Response> {
  const game = await loadGame(admin, String(body.game_id ?? ''))
  if (game.status !== 'active') throw new UcError('GAME_NOT_FOUND', '这一局已经结束了')
  const state = game.state
  if (!state.players.some((p) => p.id === uid)) throw new UcError('UNKNOWN_PLAYER', '你不在这局游戏里')

  const meta = (body.meta ?? {}) as Record<string, any>
  const action = body.action as UcAction
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    throw new UcError('BAD_REQUEST', '缺少动作')
  }
  // 身份只认 token：无论客户端传什么 by，都用当前登录用户覆盖
  if (action.type === 'playerLeft') {
    const { data: hostRow } = await admin.from('rooms').select('host_id').eq('id', game.room_id).maybeSingle()
    if (hostRow?.host_id !== uid) throw new ApiError(403, 'HOST_ONLY', '只有主持人可以请出玩家')
  }

  if (meta.expectedVersion !== undefined && Number(meta.expectedVersion) !== state.version) {
    const independent = action.type === 'acknowledgeWord' || action.type === 'vote'
    const sameStage =
      meta.expectedPhase === state.phase &&
      Number(meta.expectedRound) === state.round &&
      meta.expectedTurnKey === currentTurnKey(state)
    if (!(independent && sameStage && Number(meta.expectedVersion) <= state.version)) {
      throw new UcError('STALE_STATE', '局面已经更新，请刷新后再操作')
    }
  }

  const { data: room } = await admin.from('rooms').select('host_id').eq('id', game.room_id).maybeSingle()
  const hostId = room?.host_id ?? ''
  const now = Date.now()

  const full = { ...(action as object), by: uid } as UcAction
  const applied = applyAction(state, full, { now, isHost: hostId === uid })
  const settled = tick(applied.state, now)
  const next = settled.state
  const view = toPublicView(next)

  const requestId = String(meta.requestId ?? body.request_id ?? crypto.randomUUID())
  const fingerprint = await digest({ action: full, version: state.version })
  const ended = next.phase === 'ended'

  const { data: resultVersion, error } = await admin.rpc('uc_commit_action', {
    p_game_id: game.id,
    p_actor: uid,
    p_request_id: requestId,
    p_fingerprint: fingerprint,
    p_state: next,
    p_view: view,
    p_version: next.version,
    p_status: ended ? 'ended' : 'active',
    p_ended_reason: ended ? next.endedReason : null,
  })
  if (error) {
    if (/REQUEST_CONFLICT/.test(error.message)) throw new UcError('REQUEST_CONFLICT', '同一请求的两次内容不一致')
    if (/STALE_STATE/.test(error.message)) throw new UcError('STALE_STATE', '局面已经更新，请刷新')
    throw new UcError('BAD_REQUEST', `提交失败：${error.message}`)
  }

  if (full.type === 'acknowledgeWord') {
    await admin
      .from('game_secrets')
      .update({ acknowledged_at: new Date(now).toISOString() })
      .eq('game_id', game.id)
      .eq('user_id', uid)
      .is('acknowledged_at', null)
  }

  console.log('[uc-command] act', { game: game.id, action: full.type, version: resultVersion })
  const members = await roomMembers(admin, game.room_id)
  return json(
    snapshotOf({
      gameId: game.id,
      gameNumber: game.game_number,
      state: next,
      viewerId: uid,
      hostId,
      members,
    }),
  )
}

async function handleTick(admin: Admin, uid: string, body: Record<string, any>): Promise<Response> {
  const game = await loadGame(admin, String(body.game_id ?? ''))
  if (game.status === 'ended') {
    const members = await roomMembers(admin, game.room_id)
    const { data: room } = await admin.from('rooms').select('host_id').eq('id', game.room_id).maybeSingle()
    return json(
      snapshotOf({
        gameId: game.id,
        gameNumber: game.game_number,
        state: game.state,
        viewerId: uid,
        hostId: room?.host_id ?? '',
        members,
      }),
    )
  }

  const settled = tick(game.state, Date.now())
  if (settled.state.version !== game.state.version) {
    const view = toPublicView(settled.state)
    const ended = settled.state.phase === 'ended'
    await admin.rpc('uc_tick', {
      p_game_id: game.id,
      p_state: settled.state,
      p_view: view,
      p_version: settled.state.version,
    })
    if (ended) {
      await admin.from('games').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', game.id)
      await admin.from('rooms').update({ status: 'lobby' }).eq('id', game.room_id)
    }
  }

  const members = await roomMembers(admin, game.room_id)
  const { data: room } = await admin.from('rooms').select('host_id').eq('id', game.room_id).maybeSingle()
  return json(
    snapshotOf({
      gameId: game.id,
      gameNumber: game.game_number,
      state: settled.state,
      viewerId: uid,
      hostId: room?.host_id ?? '',
      members,
    }),
  )
}

async function handleCurrent(admin: Admin, uid: string, body: Record<string, any>): Promise<Response> {
  const roomId = String(body.room_id ?? '')
  const { data: member } = await admin
    .from('room_members')
    .select('user_id')
    .eq('room_id', roomId)
    .eq('user_id', uid)
    .is('left_at', null)
    .maybeSingle()
  if (!member) throw new ApiError(403, 'NOT_A_MEMBER', '你不在这个房间里')

  const { data: game } = await admin
    .from('games')
    .select('id')
    .eq('room_id', roomId)
    .eq('status', 'active')
    .maybeSingle()
  if (!game) return json({ snapshot: null })

  const loaded = await loadGame(admin, game.id)
  const members = await roomMembers(admin, roomId)
  const { data: room } = await admin.from('rooms').select('host_id').eq('id', roomId).maybeSingle()
  return json(
    snapshotOf({
      gameId: loaded.id,
      gameNumber: loaded.game_number,
      state: loaded.state,
      viewerId: uid,
      hostId: room?.host_id ?? '',
      members,
    }),
  )
}

async function handleWord(admin: Admin, uid: string, body: Record<string, any>): Promise<Response> {
  const gameId = String(body.game_id ?? '')
  const game = await loadGame(admin, gameId)
  if (game.status === 'ended') throw new UcError('GAME_NOT_FOUND', '这一局已经结束了')
  const player = game.state.players.find((p) => p.id === uid)
  if (!player) throw new UcError('UNKNOWN_PLAYER', '你不在这局游戏里')
  const secret = toSecretView(game.state, uid)
  return json({ ...secret, acknowledged: game.state.wordConfirmedIds.includes(uid) })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: { code: 'BAD_REQUEST', message: '只支持 POST' } }, 405)

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json({ error: { code: 'BAD_REQUEST', message: '函数缺少 SUPABASE_URL / SERVICE_ROLE_KEY' } }, 500)
    }
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData?.user) throw new ApiError(401, 'AUTH_REQUIRED', '登录已失效，请重新进入')
    const uid = userData.user.id

    let body: Record<string, any>
    try {
      body = (await req.json()) as Record<string, any>
    } catch {
      throw new UcError('BAD_REQUEST', '请求体不是合法 JSON')
    }

    switch (body.op) {
      case 'start':
        return await handleStart(admin, uid, body)
      case 'act':
        return await handleAct(admin, uid, body)
      case 'tick':
        return await handleTick(admin, uid, body)
      case 'current':
        return await handleCurrent(admin, uid, body)
      case 'word':
        return await handleWord(admin, uid, body)
      default:
        throw new UcError('BAD_REQUEST', `未知操作：${String(body.op)}`)
    }
  } catch (error) {
    return fail(error)
  }
})


