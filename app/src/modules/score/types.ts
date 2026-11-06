/**
 * 统一计分（B）的共享类型。
 *
 * 为什么要统一：你画我猜的分数由 B 算（含 AI 权重），谁是卧底的分数由 C 的引擎产生，
 * 两边如果各记一套分，排行榜就对不上。所以**只有一个记账本**，谁发生计分事件都往这里送。
 */
import type { AiScoreResult } from '../draw/types'

/** C 的引擎产生的计分事件（见 C-集成指南第 3 节） */
export type UcScoreReason =
  | 'uc_win_civilian'
  | 'uc_win_undercover'
  | 'uc_survive'
  | 'uc_correct_vote'
  | 'uc_ai_bonus'

/** B 的你画我猜产生的事件 */
export type DrawScoreReason = 'draw_painter' | 'draw_guesser'

export type ScoreReason = UcScoreReason | DrawScoreReason

/**
 * 计分事件。`points` 是**建议值**，最终乘 B 的权重表，所以 C 那边只需按自己的规则发。
 * 服务端必须用登录态覆盖 playerId，客户端传来的分数一律不算数（FR-05 异常与边界）。
 */
export interface ScoreEvent {
  roomId: string
  gameId: string
  playerId: string
  reason: ScoreReason
  points: number
  /** 幂等键的一部分：同一回合同一理由只记一次。C 的结算事件建议带轮次号 */
  roundKey?: string
}

/** 已经记账的一行 */
export interface ScoreRecord extends ScoreEvent {
  /** `${roundKey|gameId}:${playerId}:${reason}`，重复的请求会被它挡住 */
  key: string
  at: number
}

export interface ScoreConfig {
  /** AI 总分在作画者得分里的权重，0–1。0.5 = 只认一半，另一半靠别人猜中 */
  aiWeight: number
  /** 单轮作画者得分上限 */
  painterCap: number
  /** 每被一个玩家猜中，作画者加多少分 */
  perGuesser: number
  /** 猜中者的基础分 */
  guesserBase: number
  /** 猜中者每用掉一秒扣多少分 */
  guesserPerSecond: number
  /** 降级兜底：人工评分均值（0–10）乘多少。FR-05 定为 5 */
  manualWeight: number
  /** C 的事件按这里的权重重新算分；缺省 1 就是照 C 的建议值 */
  weights: Record<ScoreReason, number>
}

/**
 * 只改一部分计分参数时的写法。
 * `weights` 可以只给要改的那几项，其余沿用默认值——所以这里是 Partial 的 Partial。
 */
export type ScoreConfigPatch = Omit<Partial<ScoreConfig>, 'weights'> & {
  weights?: Partial<Record<ScoreReason, number>>
}

/** 一次你画我猜回合的结算输入 */
export interface DrawRoundInput {
  roomId: string
  gameId: string
  /** 轮次唯一标识，做幂等键 */
  roundKey: string
  painterId: string
  /** AI 评分；null 表示还没回来或彻底失败 */
  ai: AiScoreResult | null
  /** 本轮猜中的人和他们用掉多少秒 */
  guesses: Array<{ playerId: string; seconds: number }>
  /** AI 降级时才用：其他玩家的人工评分均值（0–10）。界面没做人工评分面板时留空 */
  manualAvg?: number
}

export interface DrawRoundResult {
  events: ScoreEvent[]
  /** true = 本轮没含 AI 评分（AI 失败 / 超时 / 解析不了） */
  degraded: boolean
  /** 作画者这一轮拿了多少，给评分卡显示 */
  painterPoints: number
  /** 分摊给猜中者的情况 */
  guessers: Array<{ playerId: string; points: number }>
}

export interface LeaderboardRow {
  playerId: string
  name: string
  mbti?: string | null
  total: number
  /** 1 开头，同分并列同名次 */
  rank: number
  /** 上一次清零之后涨了多少，用来做 +N 动画 */
  delta: number
  /** 这名玩家有几轮是没含 AI 评分的 */
  degradedRounds: number
}
