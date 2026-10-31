import { UcError } from './errors'
import type { Ballot, EndReason, Phase, Role, ScoreReason, Side, UcConfig, UcPlayer, Variant } from './types'

export const PHASE_LABEL: Record<Phase, string> = {
  word: '私密领词',
  describe: '描述',
  vote: '投票',
  review: '作品回顾',
  reveal: '揭晓',
  ended: '已结束',
}

export const ROLE_LABEL: Record<Role, string> = {
  civilian: '平民',
  undercover: '卧底',
  blank: '白板',
}

export const ENDING_LABEL: Record<EndReason, string> = {
  win: '',
  max_rounds: '打满轮数，卧底存活',
  host_ended: '主持人提前结束了游戏',
}

export const SIDE_LABEL: Record<Side, string> = {
  civilian: '平民胜利',
  undercover: '卧底胜利',
}

export const DEFAULT_CONFIG: UcConfig = {
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
export const PLAYER_LIMITS: Record<Variant, { min: number; max: number }> = {
  classic: { min: 4, max: 20 },
  draw: { min: 4, max: 12 },
}

export const VARIANT_LABEL: Record<Variant, string> = {
  classic: '谁是卧底',
  draw: '你画我猜谁是卧底',
}

export const BLANK_MIN_PLAYERS = 7

/** 建议分值；最终分值由 B 的统一计分配置决定 */
export const DEFAULT_POINTS: Record<ScoreReason, number> = {
  uc_win_civilian: 2,
  uc_win_undercover: 4,
  uc_survive: 1,
  uc_correct_vote: 1,
  uc_ai_bonus: 1,
}

export function defaultUndercoverCount(playerCount: number): number {
  if (playerCount <= 6) return 1
  if (playerCount <= 12) return 2
  return 3
}

export function roleCounts(playerCount: number, config: UcConfig) {
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

export function sideOf(role: Role): Side {
  return role === 'civilian' ? 'civilian' : 'undercover'
}

/**
 * 卧底和白板全部出局 → 平民胜；
 * 卧底人数 ≥ 平民人数，或只剩 3 人且卧底阵营还在 → 卧底胜。
 * 人数比较不算白板，否则 7 人局开白板（2 卧底 + 1 白板 + 4 平民）投错一次就直接结束。
 */
export function checkWinner(players: readonly UcPlayer[]): Side | null {
  const alive = players.filter((p) => p.alive)
  const undercover = alive.filter((p) => p.role === 'undercover').length
  const blank = alive.filter((p) => p.role === 'blank').length
  const civilian = alive.length - undercover - blank
  if (undercover + blank === 0) return 'civilian'
  if (undercover >= civilian || alive.length <= 3) return 'undercover'
  return null
}

export function tallyVotes(ballots: readonly Ballot[]): { tally: Record<string, number>; top: string[] } {
  const tally: Record<string, number> = {}
  for (const b of ballots) {
    if (b.targetId) tally[b.targetId] = (tally[b.targetId] ?? 0) + 1
  }
  const max = Math.max(0, ...Object.values(tally))
  const top = max === 0 ? [] : Object.keys(tally).filter((id) => tally[id] === max)
  return { tally, top }
}

/** AI 契合度 0–100 换算成奖励分倍数：80 分以上 2 倍，60 分以上 1 倍 */
export function aiBonusMultiplier(score: number): number {
  if (score >= 80) return 2
  if (score >= 60) return 1
  return 0
}
