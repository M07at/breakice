/**
 * 笔画同步通道。
 *
 * B 只定义接口，不写死传输方式：
 * - 单机演示用 `LoopbackTransport`（本机延迟回环，能看到「别人屏幕上的样子」）
 * - 接入平台后由 A 的私有频道 `room:{room_id}` 实现同一个接口，页面和引擎都不用改
 */
import type { DrawChunk } from './types'
import type { DrawEngine } from './engine'

export interface StrokeTransport {
  /** 发一个分片。失败要重试当前分片，不能丢已经画的内容 */
  send(chunk: DrawChunk): void | Promise<void>
  /** 订阅同房间内别人的分片。返回取消订阅的函数 */
  subscribe(onChunk: (chunk: DrawChunk) => void): () => void
}

export interface LoopbackOptions {
  /** 模拟网络延迟，默认 300ms。设 0 就是「同屏立刻看到」 */
  delayMs?: number
}

/**
 * 本机回环通道：把分片延迟一会儿再投回给订阅者。
 * 用途只有一个——在一部手机上演示「作画端 → 观看端」这条链路，
 * 证明分片格式、序号、重放都对，而不需要真的联网。
 */
export class LoopbackTransport implements StrokeTransport {
  private listeners = new Set<(chunk: DrawChunk) => void>()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly delayMs: number

  constructor(options: LoopbackOptions = {}) {
    this.delayMs = options.delayMs ?? 300
  }

  send(chunk: DrawChunk): void {
    if (this.delayMs <= 0) {
      this.deliver(chunk)
      return
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      this.deliver(chunk)
    }, this.delayMs)
    this.timers.add(timer)
  }

  subscribe(onChunk: (chunk: DrawChunk) => void): () => void {
    this.listeners.add(onChunk)
    return () => {
      this.listeners.delete(onChunk)
    }
  }

  /** 页面卸载时调用，把没投递的定时器清掉 */
  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.listeners.clear()
  }

  private deliver(chunk: DrawChunk): void {
    for (const fn of this.listeners) {
      try {
        fn(chunk)
      } catch {
        // 一个监听者出错不能影响其它人，这里直接吞掉
      }
    }
  }
}

export interface ChunkPumpOptions {
  /** 多久检查一次该不该出片，默认 1000ms */
  intervalMs?: number
  now?: () => number
  /** 出了片子以后回调，用来在页面上显示「已同步 N 条」 */
  onFlushed?: (chunk: DrawChunk) => void
}

/**
 * 出片泵：定时问引擎「该发了吗」，该发就交给通道。
 *
 * 为什么不在 touchmove 里直接发？因为实时监听有单次记录数上限（约束 C-06），
 * 一笔一条会瞬间打爆。这里统一按「每人每 5 秒 1 个分片」聚合。
 */
export class ChunkPump {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly intervalMs: number
  private readonly now: () => number
  /** 一共发出去过多少个分片，页面显示「已同步 N 片」用 */
  flushedCount = 0

  constructor(
    private readonly engine: DrawEngine,
    private readonly transport: StrokeTransport,
    private readonly options: ChunkPumpOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 1000
    this.now = options.now ?? (() => Date.now())
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      this.tick()
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }

  /** 检查一次。返回这次发出去的分片，没有就是 null */
  tick(): DrawChunk | null {
    const chunk = this.engine.takeChunk(this.now())
    if (!chunk) return null
    this.transport.send(chunk)
    this.flushedCount += 1
    this.options.onFlushed?.(chunk)
    return chunk
  }

  /**
   * 提交画作 / 回合结束时调用：把还没发的一次性发完。
   * 返回发出去的分片数量。
   */
  flushAll(): number {
    let count = 0
    for (;;) {
      const chunk = this.engine.takeChunk(this.now(), true)
      if (!chunk) break
      this.transport.send(chunk)
      this.flushedCount += 1
      this.options.onFlushed?.(chunk)
      count++
    }
    return count
  }
}
