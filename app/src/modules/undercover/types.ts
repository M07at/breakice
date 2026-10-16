/** classic = 口头描述；draw = 你画我猜谁是卧底（轮流画） */
export type Variant = 'classic' | 'draw'
export type Role = 'civilian' | 'undercover' | 'blank'
/** 白板算卧底阵营 */
export type Side = 'civilian' | 'undercover'
export type Phase = 'describe' | 'vote' | 'reveal' | 'ended'

export interface WordPair {
  civilian: string
  undercover: string
}

export interface UcConfig {
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

export interface UcPlayer {
  id: string
  seat: number
  role: Role
  /** 白板为 null */
  word: string | null
  alive: boolean
  out?: { round: number; reason: 'voted' | 'left' }
}

export interface Ballot {
  voterId: string
  /** null = 弃权 */
  targetId: string | null
}

export interface RoundResult {
  round: number
  pk: boolean
  ballots: Ballot[]
  tally: Record<string, number>
  /** 并列最高票的玩家；没有并列为 null */
  tied: string[] | null
  eliminatedId: string | null
}

export type EndReason = 'win' | 'max_rounds' | 'host_ended'

/** 完整局面，含所有人的词，只能存在服务端（或本地模式内存里） */
export interface UcState {
  version: number
  seed: number
  config: UcConfig
  pair: WordPair
  players: UcPlayer[]
  round: number
  phase: Phase
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

export type UcAction =
  | { type: 'turnDone'; by: string }
  /** 画作导出上传比结束回合慢，所以单独提交，回合结束后也能补交 */
  | { type: 'drawingSubmitted'; by: string; turnKey: string; drawingRef: string }
  | { type: 'vote'; by: string; targetId: string | null }
  | { type: 'skipTurn' }
  | { type: 'next' }
  | { type: 'endGame' }
  | { type: 'playerLeft'; playerId: string }
  | { type: 'aiScored'; playerId: string; turnKey: string; score: number }

export interface UcContext {
  now: number
  /** 由调用方（服务端）根据房间信息判断，引擎不关心谁是房主 */
  isHost?: boolean
}

export type ScoreReason =
  | 'uc_win_civilian'
  | 'uc_win_undercover'
  | 'uc_survive'
  | 'uc_correct_vote'
  | 'uc_ai_bonus'

export type UcEvent =
  | { type: 'phase'; phase: Phase; round: number; deadline: number }
  | { type: 'speaker'; playerId: string; deadline: number }
  | { type: 'eliminated'; playerId: string; role: Role; reason: 'voted' | 'left' }
  | { type: 'ended'; winner: Side | null; reason: EndReason }
  | { type: 'score'; playerId: string; reason: ScoreReason; points: number }

export interface Transition {
  state: UcState
  events: UcEvent[]
}
