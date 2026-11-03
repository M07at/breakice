/**
 * 统一计分的核心：一个记账本 + 一个排行榜。
 *
 * 纯逻辑，不碰 uni API。所有分数只在这里产生，页面只读结果，
 * 所以「客户端伪造分数」这条路在结构上就走不通（写分数的地方不接收客户端结果）。
 */
import type { AiScoreResult } from '../draw/types'
import { DEFAULT_SCORE_CONFIG, eventKey, resolveScoreConfig, weightOf } from './rules'
import type {
  DrawRoundInput,
  DrawRoundResult,
  LeaderboardRow,
  ScoreConfig,
  ScoreConfigPatch,
  ScoreEvent,
  ScoreRecord,
} from './types'

/** 作画者得分 = round(AI 总分 × aiWeight) + 猜中人数 × perGuesser，封顶 painterCap */
export function settleDrawRound(input: DrawRoundInput, config: ScoreConfig = DEFAULT_SCORE_CONFIG): DrawRoundResult {
  const ai: AiScoreResult | null = input.ai
  const degraded = !ai || ai.degraded === true || !Number.isFinite(ai.score)

  // 同一个人被记两次猜中时，按最快的那个算，不叠加
  const guessMap = new Map<string, number>()
  for (const guess of input.guesses ?? []) {
    const seconds = Number.isFinite(guess.seconds) ? Math.max(0, guess.seconds) : 0
    const previous = guessMap.get(guess.playerId)
    if (previous === undefined || seconds < previous) guessMap.set(guess.playerId, seconds)
  }
  if (input.painterId) guessMap.delete(input.painterId)

  const aiPart = degraded
    ? Math.round((input.manualAvg ?? 0) * config.manualWeight)
    : Math.round((ai as AiScoreResult).score * config.aiWeight)
  const painterPoints = Math.max(0, Math.min(config.painterCap, aiPart + guessMap.size * config.perGuesser))

  const events: ScoreEvent[] = [
    {
      roomId: input.roomId,
      gameId: input.gameId,
      roundKey: input.roundKey,
      playerId: input.painterId,
      reason: 'draw_painter',
      points: painterPoints,
    },
  ]

  const guessers: Array<{ playerId: string; points: number }> = []
  for (const [playerId, seconds] of guessMap) {
    const points = Math.max(0, Math.round(config.guesserBase - seconds * config.guesserPerSecond))
    guessers.push({ playerId, points })
    events.push({
      roomId: input.roomId,
      gameId: input.gameId,
      roundKey: input.roundKey,
      playerId,
      reason: 'draw_guesser',
      points,
    })
  }

  return { events, degraded, painterPoints, guessers }
}

/**
 * ScoreBook 的配置。计分参数直接平铺在顶层，写的时候不用再套一层 `config`：
 * `new ScoreBook({ aiWeight: 0.8, weights: { uc_win_undercover: 1.5 }, names, seats })`
 */
export interface ScoreBookOptions extends ScoreConfigPatch {
  /** 显示名，缺省用 playerId */
  names?: Record<string, string>
  /** 加入顺序，同分时按它排（和 C 的 seat 一致） */
  seats?: Record<string, number>
  now?: () => number
}

export interface ApplyReport {
  applied: ScoreEvent[]
  /** 幂等键已经存在、被挡下来的重复事件 */
  skipped: ScoreEvent[]
}

/**
 * 记账本。一个房间一局一个实例。
 *
 * 幂等：同一 (roundKey, playerId, reason) 只记一次。网络重试、用户连点、
 * 云函数重放都不会重复加分——这是 FR-05 那条「同一轮重复结算返回首次结果」的落点。
 */
export class ScoreBook {
  private readonly config: ScoreConfig
  private readonly names: Record<string, string>
  private readonly seats: Record<string, number>
  private readonly now: () => number

  private records = new Map<string, ScoreRecord>()
  private totals = new Map<string, number>()
  private deltas = new Map<string, number>()
  private degradedRounds = new Map<string, number>()
  private boardVersion = 0

  constructor(options: ScoreBookOptions = {}) {
    // names / seats / now 不是计分参数，别混进 config 里
    const { names, seats, now, ...scoreConfig } = options
    this.config = resolveScoreConfig(scoreConfig)
    this.names = names ?? {}
    this.seats = seats ?? {}
    this.now = now ?? (() => Date.now())
  }

  get version(): number {
    return this.boardVersion
  }

  get scoreConfig(): ScoreConfig {
    return this.config
  }

  /** 收一批计分事件（C 的卧底事件、D 的真心话事件、B 自己的事件都走这里） */
  apply(events: readonly ScoreEvent[]): ApplyReport {
    const applied: ScoreEvent[] = []
    const skipped: ScoreEvent[] = []
    for (const event of events) {
      const key = eventKey(event)
      if (this.records.has(key)) {
        skipped.push(event)
        continue
      }
      const weighted = Math.round(event.points * weightOf(this.config, event.reason))
      const record: ScoreRecord = { ...event, points: weighted, key, at: this.now() }
      this.records.set(key, record)
      this.totals.set(event.playerId, (this.totals.get(event.playerId) ?? 0) + weighted)
      this.deltas.set(event.playerId, (this.deltas.get(event.playerId) ?? 0) + weighted)
      applied.push(event)
    }
    if (applied.length > 0) this.boardVersion += 1
    return { applied, skipped }
  }

  /** 结算一轮你画我猜：算分 → 记账 → 记下是不是降级轮 */
  settleRound(input: DrawRoundInput): { result: DrawRoundResult; report: ApplyReport } {
    const result = settleDrawRound(input, this.config)
    const report = this.apply(result.events)
    if (result.degraded) {
      this.degradedRounds.set(input.painterId, (this.degradedRounds.get(input.painterId) ?? 0) + 1)
    }
    return { result, report }
  }

  totalOf(playerId: string): number {
    return this.totals.get(playerId) ?? 0
  }

  /** 按总分降序；同分按座位先后，再按 id 字典序，保证任何两端排出来一样 */
  rows(): LeaderboardRow[] {
    const ids = new Set<string>([...this.totals.keys()])
    const list = [...ids].map((playerId) => ({
      playerId,
      name: this.names[playerId] ?? playerId,
      total: this.totals.get(playerId) ?? 0,
      delta: this.deltas.get(playerId) ?? 0,
      degradedRounds: this.degradedRounds.get(playerId) ?? 0,
    }))
    list.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      const seatA = this.seats[a.playerId] ?? Number.MAX_SAFE_INTEGER
      const seatB = this.seats[b.playerId] ?? Number.MAX_SAFE_INTEGER
      if (seatA !== seatB) return seatA - seatB
      return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0
    })
    let rank = 0
    let lastTotal = Number.NaN
    return list.map((row, index) => {
      if (row.total !== lastTotal) {
        rank = index + 1
        lastTotal = row.total
      }
      return { ...row, rank }
    })
  }

  topN(n: number): LeaderboardRow[] {
    return this.rows().slice(0, Math.max(0, n))
  }

  /** 排行榜上的 +N 动画播完了调用，把增量清零 */
  clearDeltas(): void {
    this.deltas.clear()
  }

  reset(): void {
    this.records.clear()
    this.totals.clear()
    this.deltas.clear()
    this.degradedRounds.clear()
    this.boardVersion = 0
  }
}

/**
 * 排行榜广播的乱序保护：只有版本号比本地新才采用。
 * 实时推送不保证顺序，晚到的旧榜单不能把新榜单盖回去。
 */
export function shouldAcceptVersion(current: number, incoming: number): boolean {
  return Number.isFinite(incoming) && incoming > current
}
