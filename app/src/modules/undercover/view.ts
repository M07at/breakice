import { currentSpeaker, currentTurnKey, eligibleVoterIds } from './engine'
import { UcError } from './errors'
import type { EndReason, Phase, Role, RoundResult, Side, UcState, Variant, WordPair } from './types'

export interface UcPublicPlayer {
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
}

/** 广播给房间里所有人的内容，不含任何人的词 */
export interface UcPublicView {
  version: number
  variant: Variant
  round: number
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
export interface UcSecretView {
  playerId: string
  word: string | null
  isBlank: boolean
}

export function toPublicView(s: UcState): UcPublicView {
  const ended = s.phase === 'ended'
  const voters = s.phase === 'vote' ? eligibleVoterIds(s) : []
  const roleCounts: Record<Role, number> = { civilian: 0, undercover: 0, blank: 0 }
  for (const p of s.players) roleCounts[p.role]++
  return {
    version: s.version,
    variant: s.config.variant,
    round: s.round,
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
    })),
    lastResult: s.lastResult,
    drawings: s.drawings,
    winner: s.winner,
    endedReason: s.endedReason,
    pair: ended ? s.pair : null,
    aiScores: ended ? s.aiScores : null,
  }
}

export function toSecretView(s: UcState, playerId: string): UcSecretView {
  const p = s.players.find((x) => x.id === playerId)
  if (!p) throw new UcError('UNKNOWN_PLAYER', '这局游戏里没有你')
  return { playerId, word: p.word, isBlank: p.role === 'blank' }
}
