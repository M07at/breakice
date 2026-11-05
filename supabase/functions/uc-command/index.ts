/**
 * ⚠️ 自动生成，不要直接改这个文件。
 *
 * 来源：
 *   app/src/modules/undercover/{types,errors,rules,engine,view}.ts
 *   app/src/modules/shared/random.ts
 *   app/src/modules/bank/seed/{undercover-pairs,english-pairs}.json
 *   supabase/functions/uc-command/handler.ts
 * 重新生成： node scripts/build-uc-command.mjs
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ===== 引擎（C 的模块，原样内联）=====
type Rng = () => number

/** 可复现的伪随机数（mulberry32），测试和服务端重放用同一个种子能得到同一局 */
function createRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive)
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1)
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

/** classic = 口头描述；draw = 你画我猜谁是卧底（轮流画） */
type Variant = 'classic' | 'draw'
type Role = 'civilian' | 'undercover' | 'blank'
/** 白板算卧底阵营 */
type Side = 'civilian' | 'undercover'
type Phase = 'word' | 'describe' | 'vote' | 'review' | 'reveal' | 'ended'

interface WordPair {
  civilian: string
  undercover: string
}

interface UcConfig {
  variant: Variant
  /** 不填按人数自动：4–6 人 1 个，7–12 人 2 个，13–20 人 3 个 */
  undercoverCount?: number
  /** 只在 7 人及以上生效 */
  blankEnabled: boolean
  /** 随机交换平民词和卧底词，同一词对能玩出两种局 */
  swapWords: boolean
  describeSeconds: number
  drawSeconds: number
  voteSeconds: number
  revealSeconds: number
  /** 超过轮数卧底仍存活则卧底胜 */
  maxRounds: number
}

interface UcPlayer {
  id: string
  seat: number
  role: Role
  /** 白板为 null */
  word: string | null
  alive: boolean
  out?: { round: number; reason: 'voted' | 'left' }
}

interface Ballot {
  voterId: string
  /** null = 弃权 */
  targetId: string | null
}

interface RoundResult {
  round: number
  pk: boolean
  ballots: Ballot[]
  tally: Record<string, number>
  /** 并列最高票的玩家；没有并列为 null */
  tied: string[] | null
  eliminatedId: string | null
}

type EndReason = 'win' | 'max_rounds' | 'host_ended'

/** 完整局面，含所有人的词，只能存在服务端（或本地模式内存里） */
interface UcState {
  version: number
  seed: number
  config: UcConfig
  pair: WordPair
  players: UcPlayer[]
  round: number
  phase: Phase
  /** 已私密查看并确认词语的玩家；经典模式全部确认后才开始发言 */
  wordConfirmedIds: string[]
  /** 平票加赛的候选人；不在加赛中为 null */
  pkCandidates: string[] | null
  /** 揭晓后要进入的加赛候选人 */
  pendingPk: string[] | null
  speakOrder: string[]
  speakerIndex: number
  votes: Record<string, string | null>
  /** 毫秒时间戳，以服务端时钟为准；ended 时为 0 */
  phaseDeadline: number
  lastResult: RoundResult | null
  history: RoundResult[]
  /** 融合玩法：turnKey -> playerId -> 画作引用（B 导出的图片 ID），超时没交为 null */
  drawings: Record<string, Record<string, string | null>>
  /** 融合玩法：`${turnKey}:${playerId}` -> AI 契合度 0–100，结束前不公开 */
  aiScores: Record<string, number>
  winner: Side | null
  endedReason: EndReason | null
}

type UcAction =
  | { type: 'acknowledgeWord'; by: string }
  | { type: 'turnDone'; by: string }
  /** 画作导出上传比结束回合慢，所以单独提交，回合结束后也能补交 */
  | { type: 'drawingSubmitted'; by: string; turnKey: string; drawingRef: string }
  | { type: 'vote'; by: string; targetId: string | null }
  | { type: 'skipTurn' }
  | { type: 'next' }
  | { type: 'endGame' }
  | { type: 'playerLeft'; playerId: string }
  | { type: 'aiScored'; playerId: string; turnKey: string; score: number }

interface UcContext {
  now: number
  /** 由调用方（服务端）根据房间信息判断，引擎不关心谁是房主 */
  isHost?: boolean
}

type ScoreReason =
  | 'uc_win_civilian'
  | 'uc_win_undercover'
  | 'uc_survive'
  | 'uc_correct_vote'
  | 'uc_ai_bonus'

type UcEvent =
  | { type: 'phase'; phase: Phase; round: number; deadline: number }
  | { type: 'speaker'; playerId: string; deadline: number }
  | { type: 'eliminated'; playerId: string; role: Role; reason: 'voted' | 'left' }
  | { type: 'ended'; winner: Side | null; reason: EndReason }
  | { type: 'score'; playerId: string; reason: ScoreReason; points: number }

interface Transition {
  state: UcState
  events: UcEvent[]
}

type UcErrorCode =
  | 'PLAYER_COUNT'
  | 'DUPLICATE_PLAYER'
  | 'BAD_CONFIG'
  | 'BAD_PAIR'
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'NOT_ELIGIBLE'
  | 'ALREADY_VOTED'
  | 'INVALID_TARGET'
  | 'HOST_ONLY'
  | 'UNKNOWN_PLAYER'
  | 'DEADLINE_PASSED'
  | 'STALE_STATE'
  | 'BAD_REQUEST'
  | 'REQUEST_CONFLICT'
  | 'GAME_ACTIVE'
  | 'GAME_NOT_FOUND'

/** message 直接给玩家看，所以写成中文提示 */
class UcError extends Error {
  readonly code: UcErrorCode

  constructor(code: UcErrorCode, message: string) {
    super(message)
    this.name = 'UcError'
    this.code = code
  }
}

/** 远程适配器可以返回同结构错误；网络错误不能冒充已确认失败的业务错误。 */
function isUcError(error: unknown): error is UcError {
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error) || typeof error.message !== 'string') return false
  return [
    'PLAYER_COUNT', 'DUPLICATE_PLAYER', 'BAD_CONFIG', 'BAD_PAIR', 'WRONG_PHASE',
    'NOT_YOUR_TURN', 'NOT_ELIGIBLE', 'ALREADY_VOTED', 'INVALID_TARGET', 'HOST_ONLY',
    'UNKNOWN_PLAYER', 'DEADLINE_PASSED', 'STALE_STATE', 'BAD_REQUEST', 'REQUEST_CONFLICT',
    'GAME_ACTIVE', 'GAME_NOT_FOUND',
  ].includes(String(error.code))
}

const PHASE_LABEL: Record<Phase, string> = {
  word: '私密领词',
  describe: '描述',
  vote: '投票',
  review: '作品回顾',
  reveal: '揭晓',
  ended: '已结束',
}

const ROLE_LABEL: Record<Role, string> = {
  civilian: '平民',
  undercover: '卧底',
  blank: '白板',
}

const ENDING_LABEL: Record<EndReason, string> = {
  win: '',
  max_rounds: '打满轮数，卧底存活',
  host_ended: '主持人提前结束了游戏',
}

const SIDE_LABEL: Record<Side, string> = {
  civilian: '平民胜利',
  undercover: '卧底胜利',
}

const DEFAULT_CONFIG: UcConfig = {
  variant: 'classic',
  blankEnabled: false,
  swapWords: true,
  describeSeconds: 40,
  drawSeconds: 25,
  voteSeconds: 30,
  revealSeconds: 8,
  maxRounds: 10,
}

/** 融合玩法每人都要画一遍，人多了一轮太长，所以上限 12 */
const PLAYER_LIMITS: Record<Variant, { min: number; max: number }> = {
  classic: { min: 4, max: 20 },
  draw: { min: 4, max: 12 },
}

const VARIANT_LABEL: Record<Variant, string> = {
  classic: '谁是卧底',
  draw: '你画我猜谁是卧底',
}

const BLANK_MIN_PLAYERS = 7

/** 建议分值；最终分值由 B 的统一计分配置决定 */
const DEFAULT_POINTS: Record<ScoreReason, number> = {
  uc_win_civilian: 2,
  uc_win_undercover: 4,
  uc_survive: 1,
  uc_correct_vote: 1,
  uc_ai_bonus: 1,
}

function defaultUndercoverCount(playerCount: number): number {
  if (playerCount <= 6) return 1
  if (playerCount <= 12) return 2
  return 3
}

function roleCounts(playerCount: number, config: UcConfig) {
  const undercover = config.undercoverCount ?? defaultUndercoverCount(playerCount)
  const blank = config.blankEnabled && playerCount >= BLANK_MIN_PLAYERS ? 1 : 0
  const civilian = playerCount - undercover - blank
  if (undercover < 1) {
    throw new UcError('BAD_CONFIG', '至少要有 1 个卧底')
  }
  if (civilian <= undercover + blank) {
    throw new UcError('BAD_CONFIG', `${playerCount} 人局卧底太多：平民人数必须多于卧底和白板`)
  }
  return { undercover, blank, civilian }
}

function sideOf(role: Role): Side {
  return role === 'civilian' ? 'civilian' : 'undercover'
}

/**
 * 卧底和白板全部出局 → 平民胜；
 * 卧底人数 ≥ 平民人数，或只剩 3 人且卧底阵营还在 → 卧底胜。
 * 人数比较不算白板，否则 7 人局开白板（2 卧底 + 1 白板 + 4 平民）投错一次就直接结束。
 */
function checkWinner(players: readonly UcPlayer[]): Side | null {
  const alive = players.filter((p) => p.alive)
  const undercover = alive.filter((p) => p.role === 'undercover').length
  const blank = alive.filter((p) => p.role === 'blank').length
  const civilian = alive.length - undercover - blank

  // 卧底阵营全出局 → 平民胜
  if (undercover + blank === 0) return 'civilian'
  // 平民全出局 → 卧底胜
  if (civilian === 0) return 'undercover'
  // 只剩两人（一平民 + 一卧底）→ 卧底胜
  if (alive.length <= 2) return 'undercover'
  return null
}

function tallyVotes(ballots: readonly Ballot[]): { tally: Record<string, number>; top: string[] } {
  const tally: Record<string, number> = {}
  for (const b of ballots) {
    if (b.targetId) tally[b.targetId] = (tally[b.targetId] ?? 0) + 1
  }
  const max = Math.max(0, ...Object.values(tally))
  const top = max === 0 ? [] : Object.keys(tally).filter((id) => tally[id] === max)
  return { tally, top }
}

/** AI 契合度 0–100 换算成奖励分倍数：80 分以上 2 倍，60 分以上 1 倍 */
function aiBonusMultiplier(score: number): number {
  if (score >= 80) return 2
  if (score >= 60) return 1
  return 0
}

interface CreateGameInput {
  /** 按座位顺序（加入房间的顺序） */
  playerIds: string[]
  pair: WordPair
  config?: Partial<UcConfig>
  now: number
  rng: Rng
}

function createGame(input: CreateGameInput): Transition {
  const config: UcConfig = { ...DEFAULT_CONFIG, ...input.config }
  validateConfig(config)
  const ids = input.playerIds
  const limits = PLAYER_LIMITS[config.variant]
  if (ids.length < limits.min || ids.length > limits.max) {
    throw new UcError(
      'PLAYER_COUNT',
      `${VARIANT_LABEL[config.variant]}需要 ${limits.min}–${limits.max} 人，现在是 ${ids.length} 人`,
    )
  }
  if (new Set(ids).size !== ids.length) {
    throw new UcError('DUPLICATE_PLAYER', '玩家列表里有重复的人')
  }
  if (ids.some((id) => typeof id !== 'string' || !id.trim() || ['__proto__', 'constructor', 'prototype'].includes(id))) {
    throw new UcError('BAD_CONFIG', '玩家标识不能为空或使用保留名称')
  }
  const civilianWord = input.pair.civilian.trim()
  const undercoverWord = input.pair.undercover.trim()
  if (!civilianWord || !undercoverWord || civilianWord === undercoverWord) {
    throw new UcError('BAD_PAIR', '词对需要两个不同的词')
  }

  const counts = roleCounts(ids.length, config)
  const pair: WordPair =
    config.swapWords && input.rng() < 0.5
      ? { civilian: undercoverWord, undercover: civilianWord }
      : { civilian: civilianWord, undercover: undercoverWord }
  const roles = shuffle<Role>(
    [
      ...repeat<Role>('undercover', counts.undercover),
      ...repeat<Role>('blank', counts.blank),
      ...repeat<Role>('civilian', counts.civilian),
    ],
    input.rng,
  )
  const players: UcPlayer[] = ids.map((id, seat) => ({
    id,
    seat,
    role: roles[seat],
    word: roles[seat] === 'blank' ? null : roles[seat] === 'undercover' ? pair.undercover : pair.civilian,
    alive: true,
  }))

  const state: UcState = {
    version: 1,
    seed: Math.floor(input.rng() * 0x100000000),
    config,
    pair,
    players,
    round: 1,
    phase: 'word',
    wordConfirmedIds: [],
    pkCandidates: null,
    pendingPk: null,
    speakOrder: [],
    speakerIndex: 0,
    votes: {},
    phaseDeadline: 0,
    lastResult: null,
    history: [],
    drawings: {},
    aiScores: {},
    winner: null,
    endedReason: null,
  }
  const events: UcEvent[] = []
  if (state.phase === 'word') {
    events.push({ type: 'phase', phase: 'word', round: 1, deadline: 0 })
  } else {
    startDescribe(state, events, input.now)
  }
  return { state, events }
}

/** 所有玩家和主持人的操作都走这里；不合法直接抛 UcError，原局面不变 */
function applyAction(prev: UcState, action: UcAction, ctx: UcContext): Transition {
  // 网络重试或双击确认不会重启发言计时，也不会再次分配词语。
  if (action.type === 'acknowledgeWord' && prev.wordConfirmedIds.includes(action.by)) {
    return { state: prev, events: [] }
  }
  if (['turnDone', 'skipTurn', 'vote', 'next'].includes(action.type) && prev.phaseDeadline > 0 && ctx.now >= prev.phaseDeadline) {
    throw new UcError('DEADLINE_PASSED', '本阶段已到时，请刷新后继续')
  }
  if (action.type === 'playerLeft') {
    const player = findPlayer(prev, action.playerId)
    if (prev.phase === 'ended' || !player.alive) return { state: prev, events: [] }
  }
  const s = clone(prev)
  const events: UcEvent[] = []
  switch (action.type) {
    case 'acknowledgeWord': {
      requirePhase(s, 'word')
      const player = findPlayer(s, action.by)
      if (!player.alive) throw new UcError('NOT_ELIGIBLE', '已离开的玩家不能确认词语')
      s.wordConfirmedIds.push(action.by)
      if (s.players.filter((p) => p.alive).every((p) => s.wordConfirmedIds.includes(p.id))) {
        startDescribe(s, events, ctx.now)
      }
      break
    }
    case 'turnDone':
      requirePhase(s, 'describe')
      if (action.by !== currentSpeaker(s)) throw new UcError('NOT_YOUR_TURN', '还没轮到你')
      finishTurn(s, events, ctx.now)
      break
    case 'skipTurn':
      requireHost(ctx)
      requirePhase(s, 'describe')
      finishTurn(s, events, ctx.now)
      break
    case 'vote':
      castVote(s, events, ctx.now, action.by, action.targetId)
      break
    case 'next':
      requireHost(ctx)
      requirePhase(s, 'reveal')
      afterReveal(s, events, ctx.now)
      break
    case 'endGame':
      requireHost(ctx)
      if (s.phase === 'ended') throw new UcError('WRONG_PHASE', '游戏已经结束了')
      endGame(s, events, null, 'host_ended')
      break
    case 'playerLeft':
      playerLeft(s, events, ctx.now, action.playerId)
      break
    case 'drawingSubmitted': {
      const slot = s.drawings[action.turnKey]
      if (!slot || !has(slot, action.by)) throw new UcError('NOT_YOUR_TURN', '这一轮没有轮到你画')
      if (slot[action.by] === null) slot[action.by] = action.drawingRef
      break
    }
    case 'aiScored':
      recordAiScore(s, events, action.playerId, action.turnKey, action.score)
      break
  }
  s.version = prev.version + 1
  return { state: s, events }
}

/** 到点推进：客户端倒计时归零时调用。没到点或已结束时原样返回，重复调用安全 */
function tick(prev: UcState, now: number): Transition {
  if (prev.phase === 'word' || prev.phase === 'ended' || now < prev.phaseDeadline) return { state: prev, events: [] }
  const s = clone(prev)
  const events: UcEvent[] = []
  // 用计划截止时间推进；后台恢复时重复 tick 可追上已过去的所有阶段。
  const deadline = prev.phaseDeadline
  if (s.phase === 'describe') finishTurn(s, events, deadline)
  else if (s.phase === 'review') startVote(s, events, deadline)
  else if (s.phase === 'vote') closeVote(s, events, deadline)
  else afterReveal(s, events, deadline)
  s.version = prev.version + 1
  return { state: s, events }
}

function currentSpeaker(s: UcState): string | null {
  return s.phase === 'describe' ? s.speakOrder[s.speakerIndex] ?? null : null
}

/** 融合玩法里画作按 turnKey 分组：普通轮 "2"，加赛 "2-pk" */
function currentTurnKey(s: UcState): string {
  return s.pkCandidates ? `${s.round}-pk` : String(s.round)
}

function eligibleVoterIds(s: UcState): string[] {
  // 加时赛的候选人同样有投票权：否则四人全平票时没人能投，
  // 只会出现「全员弃权」，加时赛就失去意义。
  // （可选目标仍然限定在 pkCandidates 内，由投票校验把关。）
  return s.players.filter((p) => p.alive).map((p) => p.id)
}

function startDescribe(s: UcState, events: UcEvent[], now: number): void {
  const aliveIds = s.players.filter((p) => p.alive).map((p) => p.id)
  let order: string[]
  if (s.pkCandidates) {
    const candidates = s.pkCandidates
    order = aliveIds.filter((id) => candidates.includes(id))
  } else {
    // 每轮从随机的人开始，按座位顺序轮下去
    const start = randomInt(createRng(s.seed + s.round * 7919), aliveIds.length)
    order = [...aliveIds.slice(start), ...aliveIds.slice(0, start)]
  }
  s.phase = 'describe'
  s.speakOrder = order
  s.speakerIndex = 0
  s.votes = {}
  events.push({ type: 'phase', phase: 'describe', round: s.round, deadline: now + turnMs(s) })
  beginTurn(s, events, now)
}

function beginTurn(s: UcState, events: UcEvent[], now: number): void {
  while (s.speakerIndex < s.speakOrder.length && !isAlive(s, s.speakOrder[s.speakerIndex])) {
    s.speakerIndex++
  }
  if (s.speakerIndex >= s.speakOrder.length) {
    if (s.config.variant === 'draw') {
      s.phase = 'review'; s.phaseDeadline = now + 10_000
      events.push({ type: 'phase', phase: 'review', round: s.round, deadline: s.phaseDeadline })
    } else startVote(s, events, now)
    return
  }
  const id = s.speakOrder[s.speakerIndex]
  s.phaseDeadline = now + turnMs(s)
  if (s.config.variant === 'draw') {
    const key = currentTurnKey(s)
    if (!s.drawings[key]) s.drawings[key] = {}
    s.drawings[key][id] = null
  }
  events.push({ type: 'speaker', playerId: id, deadline: s.phaseDeadline })
}

function finishTurn(s: UcState, events: UcEvent[], now: number): void {
  s.speakerIndex++
  beginTurn(s, events, now)
}

function startVote(s: UcState, events: UcEvent[], now: number): void {
  s.phase = 'vote'
  s.votes = {}
  s.phaseDeadline = now + s.config.voteSeconds * 1000
  events.push({ type: 'phase', phase: 'vote', round: s.round, deadline: s.phaseDeadline })
  if (eligibleVoterIds(s).length === 0) closeVote(s, events, now)
}

function castVote(s: UcState, events: UcEvent[], now: number, by: string, targetId: string | null): void {
  requirePhase(s, 'vote')
  const voter = findPlayer(s, by)
  if (!eligibleVoterIds(s).includes(by)) {
    throw new UcError('NOT_ELIGIBLE', voter.alive ? '加赛中的玩家这一轮不投票' : '出局的玩家不能投票')
  }
  if (has(s.votes, by)) throw new UcError('ALREADY_VOTED', '你已经投过票了')
  if (targetId !== null) {
    if (targetId === by) throw new UcError('INVALID_TARGET', '不能投给自己')
    const target = findPlayer(s, targetId)
    const inPk = !s.pkCandidates || s.pkCandidates.includes(targetId)
    if (!target.alive || !inPk) {
      throw new UcError('INVALID_TARGET', s.pkCandidates ? '只能投给加赛中的玩家' : '只能投给还在场上的玩家')
    }
  }
  s.votes[by] = targetId
  if (eligibleVoterIds(s).every((id) => has(s.votes, id))) closeVote(s, events, now)
}

function closeVote(s: UcState, events: UcEvent[], now: number): void {
  const pk = s.pkCandidates !== null
  const ballots = eligibleVoterIds(s).map((voterId) => {
    const target = has(s.votes, voterId) ? s.votes[voterId] : null
    return { voterId, targetId: target && isAlive(s, target) ? target : null }
  })
  const { tally, top } = tallyVotes(ballots)
  const eliminatedId = top.length === 1 ? top[0] : null
  const tied = top.length > 1 ? top : null
  s.lastResult = { round: s.round, pk, ballots, tally, tied, eliminatedId }
  s.history.push(s.lastResult)
  s.votes = {}

  if (eliminatedId) {
    const out = eliminate(s, events, eliminatedId, 'voted')
    if (sideOf(out.role) === 'undercover') {
      for (const b of ballots) if (b.targetId === eliminatedId) addScore(events, b.voterId, 'uc_correct_vote')
    }
  }
  // 普通轮平票进加赛；加赛再平票就没人出局
  s.pendingPk = tied && !pk ? tied : null

  const winner = checkWinner(s.players)
  if (winner) {
    endGame(s, events, winner, 'win')
    return
  }
  s.phase = 'reveal'
  s.phaseDeadline = now + s.config.revealSeconds * 1000
  events.push({ type: 'phase', phase: 'reveal', round: s.round, deadline: s.phaseDeadline })
}

function afterReveal(s: UcState, events: UcEvent[], now: number): void {
  const pk = s.pendingPk ? s.pendingPk.filter((id) => isAlive(s, id)) : null
  s.pendingPk = null
  if (pk && pk.length >= 2) {
    s.pkCandidates = pk
    startDescribe(s, events, now)
    return
  }
  s.pkCandidates = null
  if (s.round >= s.config.maxRounds) {
    endGame(s, events, 'undercover', 'max_rounds')
    return
  }
  s.round++
  startDescribe(s, events, now)
}

function playerLeft(s: UcState, events: UcEvent[], now: number, id: string): void {
  const p = findPlayer(s, id)
  if (s.phase === 'ended' || !p.alive) return
  const wasSpeaker = currentSpeaker(s) === id
  eliminate(s, events, id, 'left')
  delete s.votes[id]
  // 投给他的人可以重投
  for (const voter of Object.keys(s.votes)) if (s.votes[voter] === id) delete s.votes[voter]
  if (s.pkCandidates) s.pkCandidates = s.pkCandidates.filter((c) => c !== id)
  if (s.pendingPk) s.pendingPk = s.pendingPk.filter((c) => c !== id)

  const winner = checkWinner(s.players)
  if (winner) {
    endGame(s, events, winner, 'win')
    return
  }
  if (s.phase === 'word') {
    if (s.players.filter((p) => p.alive).every((p) => s.wordConfirmedIds.includes(p.id))) {
      startDescribe(s, events, now)
    }
    return
  }
  if (s.pkCandidates && s.pkCandidates.length < 2 && s.phase !== 'reveal') {
    // 加赛只剩一个人，取消加赛直接进下一轮
    afterReveal(s, events, now)
    return
  }
  if (wasSpeaker) {
    finishTurn(s, events, now)
    return
  }
  if (s.phase === 'vote' && eligibleVoterIds(s).every((v) => has(s.votes, v))) closeVote(s, events, now)
}

function recordAiScore(s: UcState, events: UcEvent[], playerId: string, turnKey: string, score: number): void {
  const slot = s.drawings[turnKey]
  if (!slot || !has(slot, playerId)) throw new UcError('UNKNOWN_PLAYER', '这一轮没有这位玩家的画')
  const key = `${turnKey}:${playerId}`
  if (has(s.aiScores, key)) return // 同一张画只记一次
  const value = Math.min(100, Math.max(0, Math.round(score)))
  s.aiScores[key] = value
  // 结束后才到的评分立刻发奖励；结束前的在 endGame 统一发
  if (s.phase === 'ended' && s.endedReason !== 'host_ended') addAiBonus(events, playerId, value)
}

function endGame(s: UcState, events: UcEvent[], winner: Side | null, reason: EndReason): void {
  s.phase = 'ended'
  s.winner = winner
  s.endedReason = reason
  s.phaseDeadline = 0
  s.pkCandidates = null
  s.pendingPk = null
  events.push({ type: 'ended', winner, reason })
  if (!winner) return
  for (const p of s.players) {
    if (sideOf(p.role) !== winner) continue
    addScore(events, p.id, winner === 'civilian' ? 'uc_win_civilian' : 'uc_win_undercover')
    if (p.alive) addScore(events, p.id, 'uc_survive')
  }
  for (const key of Object.keys(s.aiScores)) {
    addAiBonus(events, key.slice(key.indexOf(':') + 1), s.aiScores[key])
  }
}

function eliminate(s: UcState, events: UcEvent[], id: string, reason: 'voted' | 'left'): UcPlayer {
  const p = findPlayer(s, id)
  p.alive = false
  p.out = { round: s.round, reason }
  events.push({ type: 'eliminated', playerId: id, role: p.role, reason })
  return p
}

function addScore(events: UcEvent[], playerId: string, reason: ScoreReason, multiplier = 1): void {
  events.push({ type: 'score', playerId, reason, points: DEFAULT_POINTS[reason] * multiplier })
}

function addAiBonus(events: UcEvent[], playerId: string, score: number): void {
  const m = aiBonusMultiplier(score)
  if (m > 0) addScore(events, playerId, 'uc_ai_bonus', m)
}

function turnMs(s: UcState): number {
  return (s.config.variant === 'draw' ? s.config.drawSeconds : s.config.describeSeconds) * 1000
}

function findPlayer(s: UcState, id: string): UcPlayer {
  const p = s.players.find((x) => x.id === id)
  if (!p) throw new UcError('UNKNOWN_PLAYER', '这局游戏里没有这位玩家')
  return p
}

function isAlive(s: UcState, id: string): boolean {
  return s.players.some((p) => p.id === id && p.alive)
}

function requirePhase(s: UcState, phase: Phase): void {
  if (s.phase !== phase) throw new UcError('WRONG_PHASE', `现在是${PHASE_LABEL[s.phase]}环节`)
}

function requireHost(ctx: UcContext): void {
  if (!ctx.isHost) throw new UcError('HOST_ONLY', '只有主持人可以这样做')
}

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function repeat<T>(value: T, n: number): T[] {
  return Array.from({ length: n }, () => value)
}

/** 局面必须能存成 JSON（jsonb），所以用 JSON 深拷贝，顺便保证没混进不能序列化的东西 */
function clone(s: UcState): UcState {
  return JSON.parse(JSON.stringify(s)) as UcState
}

function validateConfig(config: UcConfig): void {
  if (!['classic', 'draw'].includes(config.variant) || typeof config.blankEnabled !== 'boolean' || typeof config.swapWords !== 'boolean') {
    throw new UcError('BAD_CONFIG', '玩法或开关配置无效')
  }
  for (const key of ['describeSeconds', 'drawSeconds', 'voteSeconds', 'revealSeconds'] as const) {
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > 3600) {
      throw new UcError('BAD_CONFIG', '阶段时长必须为1–3600秒的整数')
    }
  }
  if (!Number.isInteger(config.maxRounds) || config.maxRounds < 1 || config.maxRounds > 100) {
    throw new UcError('BAD_CONFIG', '最大轮数必须为1–100的整数')
  }
  if (config.undercoverCount !== undefined && (!Number.isInteger(config.undercoverCount) || config.undercoverCount < 1)) {
    throw new UcError('BAD_CONFIG', '卧底人数必须为正整数')
  }
}

interface UcPublicPlayer {
  id: string
  seat: number
  alive: boolean
  /** 出局后或游戏结束后才公开 */
  role: Role | null
  /** 游戏结束后才公开 */
  word?: string | null
  out?: { round: number; reason: 'voted' | 'left' }
  canVote: boolean
  hasVoted: boolean
  wordConfirmed: boolean
}

/** 广播给房间里所有人的内容，不含任何人的词 */
interface UcPublicView {
  version: number
  variant: Variant
  round: number
  maxRounds: number
  phase: Phase
  pkCandidates: string[] | null
  speakOrder: string[]
  currentSpeakerId: string | null
  turnKey: string
  phaseDeadline: number
  roleCounts: Record<Role, number>
  players: UcPublicPlayer[]
  /** 上一次投票的结果，含谁投了谁 */
  lastResult: RoundResult | null
  /** 画作大家都看过，可以公开 */
  drawings: Record<string, Record<string, string | null>>
  winner: Side | null
  endedReason: EndReason | null
  /** 以下只在结束后有值 */
  pair: WordPair | null
  aiScores: Record<string, number> | null
}

/** 只发给本人 */
interface UcSecretView {
  playerId: string
  word: string | null
  isBlank: boolean
}

function toPublicView(s: UcState): UcPublicView {
  const ended = s.phase === 'ended'
  const voters = s.phase === 'vote' ? eligibleVoterIds(s) : []
  const roleCounts: Record<Role, number> = { civilian: 0, undercover: 0, blank: 0 }
  for (const p of s.players) roleCounts[p.role]++
  // 返回的公开快照不能与权威状态共享数组/对象，避免调用者或监听器修改局面。
  return JSON.parse(JSON.stringify({
    version: s.version,
    variant: s.config.variant,
    round: s.round,
    maxRounds: s.config.maxRounds,
    phase: s.phase,
    pkCandidates: s.pkCandidates,
    speakOrder: s.speakOrder,
    currentSpeakerId: currentSpeaker(s),
    turnKey: currentTurnKey(s),
    phaseDeadline: s.phaseDeadline,
    roleCounts,
    players: s.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      alive: p.alive,
      role: ended || !p.alive ? p.role : null,
      ...(ended ? { word: p.word } : {}),
      ...(p.out ? { out: p.out } : {}),
      canVote: voters.includes(p.id),
      hasVoted: Object.prototype.hasOwnProperty.call(s.votes, p.id),
      wordConfirmed: s.wordConfirmedIds.includes(p.id),
    })),
    lastResult: s.lastResult,
    drawings: s.drawings,
    winner: s.winner,
    endedReason: s.endedReason,
    pair: ended ? s.pair : null,
    aiScores: ended ? s.aiScores : null,
  })) as UcPublicView
}

function toSecretView(s: UcState, playerId: string): UcSecretView {
  const p = s.players.find((x) => x.id === playerId)
  if (!p) throw new UcError('UNKNOWN_PLAYER', '这局游戏里没有你')
  return { playerId, word: p.word, isBlank: p.role === 'blank' }
}

// ===== 系统词库（来自 C 的 seed JSON）=====
const SEED_PAIRS: { civilian: string; undercover: string; drawable: boolean }[] = [{"civilian":"苹果","undercover":"梨","drawable":true},{"civilian":"饺子","undercover":"包子","drawable":true},{"civilian":"牛奶","undercover":"豆浆","drawable":true},{"civilian":"西瓜","undercover":"哈密瓜","drawable":true},{"civilian":"橘子","undercover":"橙子","drawable":true},{"civilian":"草莓","undercover":"樱桃","drawable":true},{"civilian":"葡萄","undercover":"蓝莓","drawable":true},{"civilian":"榴莲","undercover":"菠萝","drawable":true},{"civilian":"面包","undercover":"蛋糕","drawable":true},{"civilian":"汉堡","undercover":"三明治","drawable":true},{"civilian":"冰淇淋","undercover":"雪糕","drawable":true},{"civilian":"火锅","undercover":"麻辣烫","drawable":true},{"civilian":"奶茶","undercover":"咖啡","drawable":true},{"civilian":"可乐","undercover":"雪碧","drawable":true},{"civilian":"粽子","undercover":"汤圆","drawable":true},{"civilian":"鸡蛋","undercover":"鸭蛋","drawable":true},{"civilian":"胡萝卜","undercover":"白萝卜","drawable":true},{"civilian":"薯片","undercover":"虾条","drawable":true},{"civilian":"方便面","undercover":"螺蛳粉","drawable":true},{"civilian":"月饼","undercover":"饼干","drawable":true},{"civilian":"老虎","undercover":"狮子","drawable":true},{"civilian":"狗","undercover":"狼","drawable":true},{"civilian":"熊猫","undercover":"考拉","drawable":true},{"civilian":"企鹅","undercover":"鸭子","drawable":true},{"civilian":"蝴蝶","undercover":"蜻蜓","drawable":true},{"civilian":"蜜蜂","undercover":"苍蝇","drawable":true},{"civilian":"猫","undercover":"狐狸","drawable":true},{"civilian":"兔子","undercover":"松鼠","drawable":true},{"civilian":"鲨鱼","undercover":"海豚","drawable":true},{"civilian":"长颈鹿","undercover":"骆驼","drawable":true},{"civilian":"眼镜","undercover":"墨镜","drawable":true},{"civilian":"雨伞","undercover":"雨衣","drawable":true},{"civilian":"口红","undercover":"唇膏","drawable":true},{"civilian":"枕头","undercover":"抱枕","drawable":true},{"civilian":"牙刷","undercover":"梳子","drawable":true},{"civilian":"钟表","undercover":"手表","drawable":true},{"civilian":"围巾","undercover":"领带","drawable":true},{"civilian":"拖鞋","undercover":"凉鞋","drawable":true},{"civilian":"蜡烛","undercover":"灯泡","drawable":true},{"civilian":"风筝","undercover":"气球","drawable":true},{"civilian":"镜子","undercover":"窗户","drawable":true},{"civilian":"毛笔","undercover":"钢笔","drawable":true},{"civilian":"黑板","undercover":"白板","drawable":true},{"civilian":"手机","undercover":"平板","drawable":true},{"civilian":"吉他","undercover":"尤克里里","drawable":true},{"civilian":"钢琴","undercover":"电子琴","drawable":true},{"civilian":"自行车","undercover":"电动车","drawable":true},{"civilian":"飞机","undercover":"直升机","drawable":true},{"civilian":"火车","undercover":"地铁","drawable":true},{"civilian":"帆船","undercover":"轮船","drawable":true},{"civilian":"篮球","undercover":"足球","drawable":true},{"civilian":"羽毛球","undercover":"网球","drawable":true},{"civilian":"游泳","undercover":"潜水","drawable":true},{"civilian":"跑步","undercover":"散步","drawable":false},{"civilian":"医生","undercover":"护士","drawable":true},{"civilian":"警察","undercover":"保安","drawable":true},{"civilian":"厨师","undercover":"服务员","drawable":true},{"civilian":"魔术师","undercover":"小丑","drawable":true},{"civilian":"图书馆","undercover":"自习室","drawable":false},{"civilian":"食堂","undercover":"外卖","drawable":false},{"civilian":"班长","undercover":"团支书","drawable":false},{"civilian":"军训","undercover":"体育课","drawable":false},{"civilian":"社团","undercover":"学生会","drawable":false},{"civilian":"期末考试","undercover":"四六级","drawable":false},{"civilian":"早八","undercover":"晚自习","drawable":false},{"civilian":"宿舍","undercover":"酒店","drawable":false},{"civilian":"操场","undercover":"体育馆","drawable":true},{"civilian":"圣诞老人","undercover":"雪人","drawable":true},{"civilian":"春节","undercover":"中秋节","drawable":false},{"civilian":"烟花","undercover":"鞭炮","drawable":true},{"civilian":"豆腐","undercover":"豆花","drawable":true},{"civilian":"包子","undercover":"馒头","drawable":true},{"civilian":"面条","undercover":"米线","drawable":true},{"civilian":"烤鸭","undercover":"烧鸡","drawable":true},{"civilian":"寿司","undercover":"饭团","drawable":true},{"civilian":"披萨","undercover":"煎饼","drawable":true},{"civilian":"酸奶","undercover":"奶酪","drawable":true},{"civilian":"绿茶","undercover":"红茶","drawable":false},{"civilian":"果汁","undercover":"汽水","drawable":true},{"civilian":"巧克力","undercover":"糖果","drawable":true},{"civilian":"爆米花","undercover":"棉花糖","drawable":true},{"civilian":"煎饼果子","undercover":"手抓饼","drawable":false},{"civilian":"烧烤","undercover":"铁板烧","drawable":true},{"civilian":"柠檬","undercover":"青柠","drawable":true},{"civilian":"桃子","undercover":"李子","drawable":true},{"civilian":"玉米","undercover":"红薯","drawable":true},{"civilian":"金鱼","undercover":"锦鲤","drawable":true},{"civilian":"乌龟","undercover":"蜗牛","drawable":true},{"civilian":"大象","undercover":"河马","drawable":true},{"civilian":"鸽子","undercover":"麻雀","drawable":true},{"civilian":"猴子","undercover":"猩猩","drawable":true},{"civilian":"蛇","undercover":"蚯蚓","drawable":true},{"civilian":"斑马","undercover":"马","drawable":true},{"civilian":"青蛙","undercover":"蟾蜍","drawable":true},{"civilian":"恐龙","undercover":"鳄鱼","drawable":true},{"civilian":"螃蟹","undercover":"龙虾","drawable":true},{"civilian":"耳机","undercover":"音箱","drawable":true},{"civilian":"充电宝","undercover":"充电器","drawable":true},{"civilian":"书包","undercover":"行李箱","drawable":true},{"civilian":"台灯","undercover":"手电筒","drawable":true},{"civilian":"牙膏","undercover":"洗面奶","drawable":true},{"civilian":"帽子","undercover":"头盔","drawable":true},{"civilian":"戒指","undercover":"手链","drawable":true},{"civilian":"口罩","undercover":"眼罩","drawable":true},{"civilian":"保温杯","undercover":"马克杯","drawable":true},{"civilian":"剪刀","undercover":"菜刀","drawable":true},{"civilian":"闹钟","undercover":"沙漏","drawable":true},{"civilian":"冰箱","undercover":"空调","drawable":true},{"civilian":"电脑","undercover":"电视","drawable":true},{"civilian":"相机","undercover":"望远镜","drawable":true},{"civilian":"地图","undercover":"指南针","drawable":true},{"civilian":"辅导员","undercover":"班主任","drawable":false},{"civilian":"学霸","undercover":"学神","drawable":false},{"civilian":"选修课","undercover":"必修课","drawable":false},{"civilian":"论文","undercover":"作业","drawable":false},{"civilian":"实验室","undercover":"教室","drawable":true},{"civilian":"毕业照","undercover":"证件照","drawable":true},{"civilian":"新生","undercover":"学长","drawable":false},{"civilian":"社团招新","undercover":"迎新晚会","drawable":false},{"civilian":"校园卡","undercover":"身份证","drawable":true},{"civilian":"宿管阿姨","undercover":"保安大叔","drawable":false},{"civilian":"运动会","undercover":"篮球赛","drawable":true},{"civilian":"网课","undercover":"直播","drawable":false},{"civilian":"自拍","undercover":"合照","drawable":true},{"civilian":"朋友圈","undercover":"群聊","drawable":false},{"civilian":"熬夜","undercover":"通宵","drawable":false},{"civilian":"早餐","undercover":"夜宵","drawable":true},{"civilian":"奶茶店","undercover":"咖啡馆","drawable":true},{"civilian":"外卖小哥","undercover":"快递员","drawable":true},{"civilian":"程序员","undercover":"设计师","drawable":false},{"civilian":"歌手","undercover":"演员","drawable":false},{"civilian":"宇航员","undercover":"飞行员","drawable":true},{"civilian":"消防员","undercover":"救生员","drawable":true},{"civilian":"海边","undercover":"沙漠","drawable":true},{"civilian":"公园","undercover":"游乐园","drawable":true},{"civilian":"电影院","undercover":"KTV","drawable":false},{"civilian":"医院","undercover":"药店","drawable":true},{"civilian":"超市","undercover":"便利店","drawable":true},{"civilian":"机场","undercover":"火车站","drawable":true},{"civilian":"彩虹","undercover":"极光","drawable":true},{"civilian":"雪花","undercover":"雨滴","drawable":true},{"civilian":"火山","undercover":"冰山","drawable":true},{"civilian":"月亮","undercover":"星星","drawable":true},{"civilian":"闪电","undercover":"龙卷风","drawable":true},{"civilian":"乒乓球","undercover":"台球","drawable":true},{"civilian":"滑板","undercover":"轮滑","drawable":true},{"civilian":"瑜伽","undercover":"普拉提","drawable":false},{"civilian":"拳击","undercover":"摔跤","drawable":true},{"civilian":"跳绳","undercover":"踢毽子","drawable":true},{"civilian":"魔方","undercover":"拼图","drawable":true},{"civilian":"剧本杀","undercover":"狼人杀","drawable":false},{"civilian":"动漫","undercover":"漫画","drawable":false},{"civilian":"演唱会","undercover":"音乐节","drawable":false},{"civilian":"过山车","undercover":"摩天轮","drawable":true},{"civilian":"红包","undercover":"压岁钱","drawable":true},{"civilian":"灯笼","undercover":"孔明灯","drawable":true},{"civilian":"生日","undercover":"纪念日","drawable":false},{"civilian":"apple","undercover":"pear","drawable":true},{"civilian":"cat","undercover":"dog","drawable":true},{"civilian":"tiger","undercover":"lion","drawable":true},{"civilian":"bus","undercover":"train","drawable":true},{"civilian":"cup","undercover":"bowl","drawable":true},{"civilian":"spoon","undercover":"fork","drawable":true},{"civilian":"cake","undercover":"bread","drawable":true},{"civilian":"milk","undercover":"juice","drawable":true},{"civilian":"coffee","undercover":"tea","drawable":true},{"civilian":"rain","undercover":"snow","drawable":true},{"civilian":"sun","undercover":"moon","drawable":true},{"civilian":"river","undercover":"lake","drawable":true},{"civilian":"beach","undercover":"desert","drawable":true},{"civilian":"mountain","undercover":"hill","drawable":true},{"civilian":"shirt","undercover":"coat","drawable":true},{"civilian":"hat","undercover":"cap","drawable":true},{"civilian":"shoe","undercover":"boot","drawable":true},{"civilian":"chair","undercover":"sofa","drawable":true},{"civilian":"bed","undercover":"tent","drawable":true},{"civilian":"door","undercover":"window","drawable":true},{"civilian":"pen","undercover":"pencil","drawable":true},{"civilian":"book","undercover":"magazine","drawable":true},{"civilian":"phone","undercover":"camera","drawable":true},{"civilian":"guitar","undercover":"violin","drawable":true},{"civilian":"drum","undercover":"piano","drawable":true},{"civilian":"duck","undercover":"goose","drawable":true},{"civilian":"horse","undercover":"zebra","drawable":true},{"civilian":"sheep","undercover":"goat","drawable":true},{"civilian":"bee","undercover":"butterfly","drawable":true},{"civilian":"ant","undercover":"spider","drawable":true},{"civilian":"fish","undercover":"shark","drawable":true},{"civilian":"whale","undercover":"dolphin","drawable":true},{"civilian":"carrot","undercover":"potato","drawable":true},{"civilian":"onion","undercover":"garlic","drawable":true},{"civilian":"lemon","undercover":"orange","drawable":true},{"civilian":"peach","undercover":"plum","drawable":true},{"civilian":"grape","undercover":"cherry","drawable":true},{"civilian":"cookie","undercover":"cracker","drawable":true},{"civilian":"pizza","undercover":"burger","drawable":true},{"civilian":"rice","undercover":"noodle","drawable":true},{"civilian":"boat","undercover":"ship","drawable":true},{"civilian":"bike","undercover":"scooter","drawable":true},{"civilian":"truck","undercover":"van","drawable":true},{"civilian":"bridge","undercover":"tunnel","drawable":true},{"civilian":"castle","undercover":"palace","drawable":true},{"civilian":"school","undercover":"library","drawable":true},{"civilian":"park","undercover":"garden","drawable":true},{"civilian":"pool","undercover":"pond","drawable":true},{"civilian":"clock","undercover":"watch","drawable":true},{"civilian":"ring","undercover":"bracelet","drawable":true},{"civilian":"rope","undercover":"chain","drawable":true},{"civilian":"box","undercover":"basket","drawable":true},{"civilian":"ball","undercover":"balloon","drawable":true},{"civilian":"flag","undercover":"kite","drawable":true},{"civilian":"star","undercover":"heart","drawable":true},{"civilian":"candle","undercover":"lamp","drawable":true},{"civilian":"key","undercover":"lock","drawable":true},{"civilian":"mirror","undercover":"picture","drawable":true},{"civilian":"comb","undercover":"brush","drawable":true},{"civilian":"wallet","undercover":"purse","drawable":true}]

// ===== 指令处理 =====
﻿// 破冰局 · uc-command：服务端谁是卧底引擎
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
const HANDLER_VERSION = 'uc-2026-11-05-rules2'

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
      score: typeof ai?.total === 'number' ? ai.total : undefined,
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
  members: { user_id: string; profiles?: { nickname?: string } }[]
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
    players: input.state.players.map((p) => ({ id: p.id, name: names.get(p.id) ?? '玩家' })),
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
  //   客户端显式给 bots 就按它补；没给就算 4 人还差几个（最多 2 个）。
  // 机器人是真实的 auth 账号，引擎不需要任何改动。
  const rosterIds = members.map((m) => m.user_id)
  const requested = Math.round(Number(body.bots ?? 0))
  const shortfall = Math.max(0, Math.min(2, 4 - rosterIds.length))
  const botCount = Math.max(0, Math.min(2, Number.isFinite(requested) && requested > 0 ? requested : shortfall))
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
  const transition = createGame({
    playerIds: rosterIds,
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

  if (meta.expectedVersion !== undefined && Number(meta.expectedVersion) !== state.version) {
    const independent = action.type === 'acknowledgeWord' || action.type === 'vote' || action.type === 'drawingSubmitted'
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

  // 先把"已经离开房间"的人从局内摘掉，否则他那一轮会一直卡到倒计时结束
  const departed = await settleDeparted(admin, game.room_id, state, now)
  const baseState = departed.state

  const full = { ...(action as object), by: uid } as UcAction
  // AI 评分只能代表自己交的那幅画，不让客户端给别人加分
  if (full.type === 'aiScored') (full as { playerId: string }).playerId = uid
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
    if (ended) {
      await admin.from('games').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', game.id)
      await admin.from('rooms').update({ status: 'lobby' }).eq('id', game.room_id)
    }
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














