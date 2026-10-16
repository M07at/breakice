import { createRng, randomInt, shuffle } from '../shared/random'
import type { Rng } from '../shared/random'
import { UcError } from './errors'
import {
  DEFAULT_CONFIG,
  DEFAULT_POINTS,
  PHASE_LABEL,
  PLAYER_LIMITS,
  VARIANT_LABEL,
  aiBonusMultiplier,
  checkWinner,
  roleCounts,
  sideOf,
  tallyVotes,
} from './rules'
import type {
  EndReason,
  Phase,
  Role,
  ScoreReason,
  Side,
  Transition,
  UcAction,
  UcConfig,
  UcContext,
  UcEvent,
  UcPlayer,
  UcState,
  WordPair,
} from './types'

export interface CreateGameInput {
  /** 按座位顺序（加入房间的顺序） */
  playerIds: string[]
  pair: WordPair
  config?: Partial<UcConfig>
  now: number
  rng: Rng
}

export function createGame(input: CreateGameInput): Transition {
  const config: UcConfig = { ...DEFAULT_CONFIG, ...input.config }
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
    phase: 'describe',
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
  startDescribe(state, events, input.now)
  return { state, events }
}

/** 所有玩家和主持人的操作都走这里；不合法直接抛 UcError，原局面不变 */
export function applyAction(prev: UcState, action: UcAction, ctx: UcContext): Transition {
  const s = clone(prev)
  const events: UcEvent[] = []
  switch (action.type) {
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
export function tick(prev: UcState, now: number): Transition {
  if (prev.phase === 'ended' || now < prev.phaseDeadline) return { state: prev, events: [] }
  const s = clone(prev)
  const events: UcEvent[] = []
  if (s.phase === 'describe') finishTurn(s, events, now)
  else if (s.phase === 'vote') closeVote(s, events, now)
  else afterReveal(s, events, now)
  s.version = prev.version + 1
  return { state: s, events }
}

export function currentSpeaker(s: UcState): string | null {
  return s.phase === 'describe' ? s.speakOrder[s.speakerIndex] ?? null : null
}

/** 融合玩法里画作按 turnKey 分组：普通轮 "2"，加赛 "2-pk" */
export function currentTurnKey(s: UcState): string {
  return s.pkCandidates ? `${s.round}-pk` : String(s.round)
}

export function eligibleVoterIds(s: UcState): string[] {
  return s.players
    .filter((p) => p.alive && !(s.pkCandidates && s.pkCandidates.includes(p.id)))
    .map((p) => p.id)
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
    startVote(s, events, now)
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
