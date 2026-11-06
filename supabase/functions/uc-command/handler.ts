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

/** 部署后可以用 { op: 'version' } 确认线上跑的是哪一版 */
const HANDLER_VERSION = 'uc-2026-11-06-drawing-lifecycle'

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
    .select('user_id, seat, ready, profiles(nickname,mbti)')
    .eq('room_id', roomId)
    .is('left_at', null)
    .order('seat')
  if (error) throw new UcError('BAD_REQUEST', `读取房间成员失败：${error.message}`)
  return (data ?? []) as { user_id: string; seat: number; ready: boolean; profiles?: { nickname?: string; mbti?: string | null } }[]
}

const ARTWORK_STATUS: Record<string, 'pending' | 'success' | 'failed' | 'timeout'> = {
  pending: 'pending',
  scored: 'success',
  success: 'success',
  failed: 'failed',
  timeout: 'timeout',
}

/** 本轮/本局的画作 + AI 分数，客户端据此渲染画廊（真实图片走 Storage 签名地址） */
async function loadArtworks(admin: Admin, gameId: string) {
  const { data: arts, error } = await admin
    .from('artworks')
    .select('id, turn_key, user_id, storage_path, status')
    .eq('game_id', gameId)
    .order('created_at', { ascending: true })
  if (error) {
    console.warn('[uc-command] 读取画作失败', error.message)
    return []
  }
  if (!arts?.length) return []

  const rows = arts as { id: string; turn_key: string; user_id: string; storage_path: string; status: string }[]
  const { data: scores } = await admin
    .from('ai_scores')
    .select('artwork_id, total, status, comment')
    .in('artwork_id', rows.map((a) => a.id))
  const scoreRows = (scores ?? []) as { artwork_id: string; total: number | null; status: string; comment: string | null }[]
  const byArtwork = new Map(scoreRows.map((s) => [s.artwork_id, s]))

  return rows.map((art) => {
    const ai = byArtwork.get(art.id)
    const status = ARTWORK_STATUS[String(ai?.status ?? art.status)] ?? 'pending'
    return {
      id: art.id,
      playerId: art.user_id,
      turnKey: art.turn_key,
      preview: art.storage_path,
      status,
      score: ai?.status === 'success' && typeof ai.total === 'number' ? ai.total : undefined,
      comment: typeof ai?.comment === 'string' ? ai.comment : undefined,
    }
  })
}

async function snapshotOf(input: {
  admin: Admin
  gameId: string
  gameNumber: number
  state: UcState
  viewerId: string
  hostId: string
  members: { user_id: string; profiles?: { nickname?: string; mbti?: string | null } }[]
}) {
  const artworks = input.state.config.variant === 'draw' ? await loadArtworks(input.admin, input.gameId) : []
  // 名单以引擎里的座位顺序为准，机器人没有 room_members 记录，名字从 bots 表补
  const names = new Map<string, string>()
  for (const m of input.members) names.set(m.user_id, m.profiles?.nickname ?? '玩家')
  for (const bot of await loadBots(input.admin)) {
    if (!names.has(bot.user_id)) names.set(bot.user_id, BOT_NAME(bot.slot))
  }
  return {
    sessionId: input.gameId,
    gameId: input.gameId,
    gameNumber: input.gameNumber,
    playerId: input.viewerId,
    hostId: input.hostId,
    players: input.state.players.map((p) => ({ id: p.id, name: names.get(p.id) ?? '玩家', mbti: input.members.find(m => m.user_id === p.id)?.profiles?.mbti ?? null })),
    view: toPublicView(input.state),
    artworks,
    serverNow: Date.now(),
  }
}

type ScoreRow = { game_id: string; user_id: string; points: number; reason: string; ref: string }

/** 机器人下一步该做什么；没有就让位给真人 */
function nextBotAction(state: UcState, botIds: Set<string>): { actor: string; action: UcAction } | null {
  if (state.phase === 'word') {
    const bot = state.players.find((p) => botIds.has(p.id) && !state.wordConfirmedIds.includes(p.id))
    return bot ? { actor: bot.id, action: { type: 'acknowledgeWord', by: bot.id } as UcAction } : null
  }
  if (state.phase === 'describe') {
    const speaker = currentSpeaker(state)
    return speaker && botIds.has(speaker)
      ? { actor: speaker, action: { type: 'turnDone', by: speaker } as UcAction }
      : null
  }
  if (state.phase === 'vote') {
    const bot = state.players.find(
      (p) => p.alive && botIds.has(p.id) && !(p.id in state.votes) && eligibleVoterIds(state).includes(p.id),
    )
    if (!bot) return null
    // 加时赛只能投给加赛候选人，投别人会被引擎判 INVALID_TARGET
    const pool = state.pkCandidates && state.pkCandidates.length > 0 ? state.pkCandidates : eligibleVoterIds(state)
    const targets = pool.filter((id) => id !== bot.id)
    // 普通轮没人可投就弃权；加时赛必须投给自己以外的候选人，没有就退而投候选人之一
    const target = targets.length > 0 ? targets[Math.floor(Math.random() * targets.length)] : (pool.length > 0 ? pool[0] : null)
    return { actor: bot.id, action: { type: 'vote', by: bot.id, targetId: target } as UcAction }
  }
  return null
}

/**
 * 把机器人的回合自动走完：领词 → 发言结束 → 投票。
 * 只在轮到机器人时推进，撞到真人就停，所以不会替真人做决定。
 */
async function driveBots(admin: Admin, gameId: string, maxSteps = 24): Promise<void> {
  const bots = await loadBots(admin)
  if (bots.length === 0) return
  const botIds = new Set(bots.map((bot) => bot.user_id))

  for (let step = 0; step < maxSteps; step++) {
    const game = await loadGame(admin, gameId)
    if (game.status !== 'active') return
    const pick = nextBotAction(game.state, botIds)
    if (!pick) return

    // 只执行机器人自己的动作，不推进时间：
    // 阶段该不该结束交给引擎（全员行动完）和客户端的 tick 决定，
    // 否则机器人会在同一次请求里把整局一路推到结算。
    const now = Date.now()
    // 机器人动作失败只跳过它自己，绝不能让整个 tick 请求 400
    let applied
    try {
      applied = applyAction(game.state, pick.action, { now, isHost: false })
    } catch (botError) {
      console.warn('[uc-command] 机器人动作被拒，已跳过', pick.action.type, String(botError))
      return
    }
    const next = applied.state
    const ended = next.phase === 'ended'
    const { error } = await admin.rpc('uc_commit_action', {
      p_game_id: gameId,
      p_actor: pick.actor,
      p_request_id: `bot-${gameId}-${next.version}-${pick.action.type}`,
      p_fingerprint: await digest({ bot: pick.actor, version: game.state.version, type: pick.action.type }),
      p_state: next,
      p_view: toPublicView(next),
      p_version: next.version,
      p_status: ended ? 'ended' : 'active',
      p_ended_reason: ended ? next.endedReason : null,
    })
    if (error) {
      console.warn('[uc-command] 机器人提交失败', error.message)
      return
    }
    await writeScores(admin, gameId, applied.events, `bot-${next.version}`)
    if (ended) return
  }
}

/**
 * 把引擎事件里的计分落库。
 * ref 用「本次提交的请求号 + 事件序号」，配合 unique(game_id,user_id,reason,ref) 保证重放不会重复加分。
 */
async function writeScores(admin: Admin, gameId: string, events: UcEvent[], refBase: string): Promise<void> {
  const rows: ScoreRow[] = []
  events.forEach((event, index) => {
    if (event.type !== 'score') return
    rows.push({
      game_id: gameId,
      user_id: event.playerId,
      points: Math.round(event.points),
      reason: event.reason,
      ref: `${refBase}:${index}`,
    })
  })
  if (rows.length === 0) return
  const { error } = await admin
    .from('scores')
    .upsert(rows, { onConflict: 'game_id,user_id,reason,ref', ignoreDuplicates: true })
  if (error) console.warn('[uc-command] 写积分失败', error.message)
}

type BotRow = { slot: number; user_id: string }

const BOT_NAME = (slot: number) => `机器人${slot}`

/** 读取已创建的机器人账号（按 slot 排序） */
async function loadBots(admin: Admin): Promise<BotRow[]> {
  const { data, error } = await admin.from('bots').select('slot, user_id').order('slot')
  if (error) {
    console.warn('[uc-command] 读取机器人失败', error.message)
    return []
  }
  return (data ?? []) as BotRow[]
}

/** 确保有 count 个机器人账号；没有就现建（auth 用户 + profiles，昵称由触发器写入） */
async function ensureBots(admin: Admin, count: number): Promise<BotRow[]> {
  if (count <= 0) return []
  const existing = await loadBots(admin)
  const bySlot = new Map(existing.map((bot) => [bot.slot, bot.user_id]))
  const out: BotRow[] = []
  for (let slot = 1; slot <= count; slot++) {
    let userId = bySlot.get(slot)
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `bot${slot}@bots.breakice.local`,
        password: `bot-${slot}-${crypto.randomUUID()}`,
        email_confirm: true,
        user_metadata: { nickname: BOT_NAME(slot) },
      })
      if (error || !data?.user) throw new UcError('BAD_REQUEST', `创建机器人失败：${error?.message ?? '未知错误'}`)
      userId = data.user.id
      const { error: insertError } = await admin.from('bots').insert({ slot, user_id: userId })
      if (insertError) console.warn('[uc-command] 记录机器人失败', insertError.message)
    }
    out.push({ slot, user_id: String(userId) })
  }
  return out
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

/**
 * 把「已经离开房间」的玩家从局内摘掉。
 *
 * 退出房间走的是 leave_room，games.state 不会自动更新；这里按房间成员表对账，
 * 否则轮到他发言/投票时整局要卡到倒计时结束。客户端不需要配合上报。
 */
async function settleDeparted(
  admin: Admin,
  roomId: string,
  state: UcState,
  now: number,
): Promise<{ state: UcState; events: UcEvent[] }> {
  const members = await roomMembers(admin, roomId)
  const present = new Set(members.map((m) => m.user_id))
  // 机器人只出现在对局名单里、不是房间成员，不能当成"已离开"摘掉，
  // 否则机器人一被摘光，胜负条件立刻成立，整局会瞬间结算。
  const bots = new Set((await loadBots(admin)).map((bot) => bot.user_id))
  const gone = state.players.filter((p) => p.alive && !present.has(p.id) && !bots.has(p.id))
  if (gone.length === 0) return { state, events: [] }

  let next = state
  const events: UcEvent[] = []
  for (const player of gone) {
    try {
      const applied = applyAction(next, { type: 'playerLeft', playerId: player.id } as UcAction, {
        now,
        isHost: false,
      })
      next = applied.state
      events.push(...applied.events)
    } catch (error) {
      console.warn('[uc-command] 移除离场玩家失败', player.id, String(error))
    }
  }
  return { state: next, events }
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
  if (members.some((m) => !m.ready)) throw new UcError('BAD_CONFIG', '还有玩家没有准备')

  // 人不够时用机器人补位（测试用）：
  //   客户端显式给 bots 就按它补；没给就算 4 人还差几个（最多 5 个）。
  // 机器人是真实的 auth 账号，引擎不需要任何改动。
  const rosterIds = members.map((m) => m.user_id)
  const botCount = testBotCount(rosterIds.length, body.bots)
  if (botCount > 0) {
    const bots = await ensureBots(admin, botCount)
    rosterIds.push(...bots.map((bot) => bot.user_id))
  }
  if (rosterIds.length < 4) {
    throw new UcError('PLAYER_COUNT', `还差 ${4 - rosterIds.length} 人才能开局，谁是卧底至少要 4 人`)
  }

  const { data: active } = await admin
    .from('games')
    .select('id')
    .eq('room_id', roomId)
    .eq('status', 'active')
    .maybeSingle()
  if (active) throw new UcError('GAME_ACTIVE', '房间里已经有一局了')

  const config = { ...DEFAULT_CONFIG, variant, ...(body.config ?? {}) }
  const startedAt = Date.now()
  // 主持人在题库页选过自定义词对就用它，否则回退系统题库
  const customPairs = Array.isArray(body.pairs)
    ? (body.pairs as { civilian?: string; undercover?: string }[])
        .filter((pair) => pair && pair.civilian && pair.undercover)
        .map((pair) => ({ civilian: String(pair.civilian), undercover: String(pair.undercover) }))
    : []
  const pair = customPairs.length > 0
    ? customPairs[Math.floor(Math.random() * customPairs.length)]
    : pickPair(variant)

  const transition = createGame({
    playerIds: rosterIds,
    pair,
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

  // 开局后机器人会把"领词"这类动作立刻走完，所以快照要用刷新后的状态
  await driveBots(admin, String(gameId))
  const fresh = await loadGame(admin, String(gameId))
  return json(
    await snapshotOf({
      admin,
      gameId: fresh.id,
      gameNumber: created?.game_number ?? 1,
      state: fresh.state,
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
    // 自己退出随时可以；请别人出局只有主持人能做
    const who = String((action as { playerId?: string }).playerId ?? uid)
    if (who !== uid) {
      const { data: hostRow } = await admin.from('rooms').select('host_id').eq('id', game.room_id).maybeSingle()
      if (hostRow?.host_id !== uid) throw new ApiError(403, 'HOST_ONLY', '只有主持人可以请出玩家')
    }
  }

  if (action.type !== 'aiScored' && meta.expectedVersion !== undefined && Number(meta.expectedVersion) !== state.version) {
    const independent = action.type === 'acknowledgeWord' || action.type === 'vote' || action.type === 'drawingSubmitted'
    // 交画只要求还在作画阶段：轮次/发言者的时间戳很容易在提交瞬间变化，
    // 用 turnKey 严格比对会把正常的提交判成过期（人机回合切换快时尤其明显）。
    const sameStage =
      action.type === 'drawingSubmitted'
        ? meta.expectedPhase === state.phase && state.phase === 'describe'
        : meta.expectedPhase === state.phase &&
          Number(meta.expectedRound) === state.round &&
          meta.expectedTurnKey === currentTurnKey(state)
    if (!(independent && sameStage && Number(meta.expectedVersion) <= state.version)) {
      throw new UcError('STALE_STATE', '局面已经更新，请刷新后再操作')
    }
  }

  const { data: room } = await admin.from('rooms').select('host_id').eq('id', game.room_id).maybeSingle()
  const hostId = room?.host_id ?? ''
  const now = Date.now()

  // 先把"已经离开房间"的人从局内摘掉，否则他那一轮会一直卡到倒计时结束
  const departed = await settleDeparted(admin, game.room_id, state, now)
  const baseState = departed.state

  const full = { ...(action as object), by: uid } as UcAction
  // AI 评分只能代表自己交的那幅画，不让客户端给别人加分
  if (full.type === 'aiScored') {
    full.playerId = uid
    const { data: artwork } = await admin.from('artworks').select('id').eq('game_id', game.id).eq('user_id', uid).eq('turn_key', `${full.turnKey}#${uid}`).maybeSingle()
    const { data: verified } = artwork ? await admin.from('ai_scores').select('total,status').eq('artwork_id', artwork.id).maybeSingle() : { data: null }
    if (verified?.status !== 'success' || typeof verified.total !== 'number') throw new UcError('BAD_REQUEST', '没有已验证的 AI 分数')
    full.score = verified.total
  }
  const applied = applyAction(baseState, full, { now, isHost: hostId === uid })
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

  // 引擎在事件里给出了建议分值，这里落库；唯一约束 (game_id,user_id,reason,ref) 负责去重
  await writeScores(admin, game.id, [...departed.events, ...applied.events, ...settled.events], requestId)

  console.log('[uc-command] act', { game: game.id, action: full.type, version: resultVersion })
  // 轮到机器人就立刻替它走完，回到真人回合再返回
  await driveBots(admin, game.id)
  const fresh = await loadGame(admin, game.id)
  const members = await roomMembers(admin, game.room_id)
  return json(
    await snapshotOf({
      admin,
      gameId: fresh.id,
      gameNumber: fresh.game_number,
      state: fresh.state,
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
      await snapshotOf({
        admin,
        gameId: game.id,
        gameNumber: game.game_number,
        state: game.state,
        viewerId: uid,
        hostId: room?.host_id ?? '',
        members,
      }),
    )
  }

  const tickNow = Date.now()
  // 每 2 秒一次的轮询顺便对账：有人退出房间就把他从局内摘掉
  const departed = await settleDeparted(admin, game.room_id, game.state, tickNow)
  const settled = tick(departed.state, tickNow)
  if (settled.state.version !== game.state.version) {
    const view = toPublicView(settled.state)
    const ended = settled.state.phase === 'ended'
    await admin.rpc('uc_tick', {
      p_game_id: game.id,
      p_state: settled.state,
      p_view: view,
      p_version: settled.state.version,
    })
    await writeScores(admin, game.id, [...departed.events, ...settled.events], `${game.id}:v${settled.state.version}`)
  }

  await driveBots(admin, game.id)
  const fresh = await loadGame(admin, game.id)
  const members = await roomMembers(admin, game.room_id)
  const { data: room } = await admin.from('rooms').select('host_id').eq('id', game.room_id).maybeSingle()
  return json(
    await snapshotOf({
      admin,
      gameId: fresh.id,
      gameNumber: fresh.game_number,
      state: fresh.state,
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

  // 先找进行中的，没有再退回「最近一局」——这样已结束的局也能被接管，
  // 玩家从大厅点「回到游戏」能看到结算页（只读），而不是被拒绝。
  const { data: active } = await admin
    .from('games')
    .select('id')
    .eq('room_id', roomId)
    .eq('status', 'active')
    .maybeSingle()

  let game = active
  if (!game) {
    const { data: latest } = await admin
      .from('games')
      .select('id')
      .eq('room_id', roomId)
      .order('game_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    game = latest
  }
  if (!game) return json({ snapshot: null })

  const loaded = await loadGame(admin, game.id)
  const members = await roomMembers(admin, roomId)
  const { data: room } = await admin.from('rooms').select('host_id').eq('id', roomId).maybeSingle()
  return json({
    snapshot: await snapshotOf({
      admin,
      gameId: loaded.id,
      gameNumber: loaded.game_number,
      state: loaded.state,
      viewerId: uid,
      hostId: room?.host_id ?? '',
      members,
    }),
  })
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
      case 'version':
        return json({ version: HANDLER_VERSION })
      default:
        throw new UcError('BAD_REQUEST', `未知操作：${String(body.op)}`)
    }
  } catch (error) {
    return fail(error)
  }
})















