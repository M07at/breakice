import type { ScoreConfig, ScoreConfigPatch, ScoreReason } from './types'

/** 各理由的中文名，界面直接用 */
export const SCORE_REASON_LABEL: Record<ScoreReason, string> = {
  uc_win_civilian: '平民阵营获胜',
  uc_win_undercover: '卧底阵营获胜',
  uc_survive: '活到最后',
  uc_correct_vote: '投中卧底',
  uc_ai_bonus: '画作 AI 奖励',
  draw_painter: '作画得分',
  draw_guesser: '猜中得分',
}

/** C 在集成指南里给的建议分值，只用来做默认值和对账 */
export const UC_SUGGESTED_POINTS = {
  uc_win_civilian: 2,
  uc_win_undercover: 4,
  uc_survive: 1,
  uc_correct_vote: 1,
  uc_ai_bonus: 2,
} as const

/**
 * 默认计分配置。对应需求文档 FR-05：
 * 作画者 = round(AI 总分 × 0.5) + 被猜中人数 × 10，单轮上限 100
 * 猜中者 = round(max(0, 50 - 用时秒 × 0.5))
 */
export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  aiWeight: 0.5,
  painterCap: 100,
  perGuesser: 10,
  guesserBase: 50,
  guesserPerSecond: 0.5,
  manualWeight: 5,
  weights: {
    uc_win_civilian: 1,
    uc_win_undercover: 1,
    uc_survive: 1,
    uc_correct_vote: 1,
    uc_ai_bonus: 1,
    draw_painter: 1,
    draw_guesser: 1,
  },
}

/** 合并调用方给的局部配置，权重表要单独合，否则漏一项就变成 NaN */
export function resolveScoreConfig(partial: ScoreConfigPatch = {}): ScoreConfig {
  return {
    ...DEFAULT_SCORE_CONFIG,
    ...partial,
    weights: { ...DEFAULT_SCORE_CONFIG.weights, ...(partial.weights ?? {}) },
  }
}

export function weightOf(config: ScoreConfig, reason: ScoreReason): number {
  const weight = config.weights[reason]
  return Number.isFinite(weight) ? weight : 1
}

/** 计分事件的幂等键。同一回合同一玩家同一理由只记一次 */
export function eventKey(event: { gameId: string; roundKey?: string; playerId: string; reason: ScoreReason }): string {
  return `${event.roundKey ?? event.gameId}:${event.playerId}:${event.reason}`
}
