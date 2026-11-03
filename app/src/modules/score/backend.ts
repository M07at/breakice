/**
 * 计分入口。
 *
 * 分工边界：
 * - C 的引擎产生计分事件 → 交给 `ScoreSink.submit`
 * - D 的真心话大冒险不计分（FR-08），所以不用送
 * - A 负责把 submit 落到服务端（RPC 或 Edge Function），前端只认这个接口
 *
 * 单机模式下用 `LocalScoreSink`（内存记账，排行榜页面直接读它）；
 * 接入 A 之后换成远程实现，页面和 C 的调用方都不用改。
 */
import { ScoreBook } from './engine'
import type { ApplyReport, ScoreBookOptions } from './engine'
import type { LeaderboardRow, ScoreEvent } from './types'

export interface ScoreSink {
  /** 送一批计分事件，返回最新排行榜。重复事件必须被服务端幂等挡掉 */
  submit(events: readonly ScoreEvent[]): Promise<LeaderboardRow[]>
  /** 读当前排行榜（重连、进页面时用） */
  leaderboard(): Promise<LeaderboardRow[]>
}

export interface LocalScoreSinkOptions extends ScoreBookOptions {
  /** 提交后是否要等一拍，模拟网络往返，让 loading 状态看得见 */
  latencyMs?: number
}

/** 单机：一个房间一局一个 ScoreBook，存在内存里 */
export class LocalScoreSink implements ScoreSink {
  readonly book: ScoreBook
  private readonly latencyMs: number

  constructor(options: LocalScoreSinkOptions = {}) {
    this.book = new ScoreBook(options)
    this.latencyMs = options.latencyMs ?? 0
  }

  async submit(events: readonly ScoreEvent[]): Promise<LeaderboardRow[]> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs))
    this.book.apply(events)
    return this.book.rows()
  }

  async leaderboard(): Promise<LeaderboardRow[]> {
    return this.book.rows()
  }

  /** 给单机页面用的同步入口：不用 await，直接拿报告 */
  applyNow(events: readonly ScoreEvent[]): ApplyReport {
    return this.book.apply(events)
  }
}
