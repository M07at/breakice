/**
 * 画布引擎：纯逻辑，不碰 uni API，所以能在 Node 里单测。
 *
 * 状态 = 一条操作流（DrawOp[]）。画面永远是「把操作流重放一遍」的结果，
 * 这样撤销、清空、Emoji 拖动、远端同步、断线重连全都走同一条路径，没有第二套真相。
 */
import { DrawError } from './errors'
import { CANVAS, DEFAULT_DRAW_CONFIG } from './types'
import type {
  DrawChunk,
  DrawConfig,
  DrawOp,
  EmojiOp,
  EmojiUpdateOp,
  Point,
  RenderItem,
  StrokeOp,
  StrokeStyle,
} from './types'

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return value < min ? min : value > max ? max : value
}

/**
 * 触摸点 （屏幕像素）→ 归一化坐标（0–1000 整数）。
 * displayW / displayH 是 canvas 元素在屏幕上的实际宽高，不是物理像素。
 */
export function toNormalizedPoint(x: number, y: number, displayW: number, displayH: number): Point {
  if (!(displayW > 0) || !(displayH > 0)) throw new DrawError('NO_POINT', '画布尺寸还没拿到')
  return {
    x: Math.round(clamp((x / displayW) * CANVAS.unit, 0, CANVAS.unit)),
    y: Math.round(clamp((y / displayH) * CANVAS.unit, 0, CANVAS.unit)),
  }
}

/** 归一化坐标 → 逻辑画布像素（800×600）。绘制时用 */
export function toCanvasPoint(point: Point, width: number = CANVAS.width, height: number = CANVAS.height): Point {
  return {
    x: (clamp(point.x, 0, CANVAS.unit) / CANVAS.unit) * width,
    y: (clamp(point.y, 0, CANVAS.unit) / CANVAS.unit) * height,
  }
}

/** 一个操作流里一共有多少个笔画点，用来判断分片是不是太大了 */
export function countPoints(ops: readonly DrawOp[]): number {
  let n = 0
  for (const op of ops) if (op.kind === 'stroke') n += op.points.length
  return n
}

/**
 * 重放出可渲染列表。规则：
 * - stroke / emoji 直接进列表
 * - emoji-update 改列表里那个 emoji 的属性（找不到就忽略，说明它的源操作已丢失）
 * - undo 把目标那条从列表里删掉
 * - clear 清空列表
 */
export function replay(ops: readonly DrawOp[]): RenderItem[] {
  const visible: RenderItem[] = []
  for (const op of ops) {
    switch (op.kind) {
      case 'stroke':
        visible.push({ kind: 'stroke', seq: op.seq, color: op.color, width: op.width, points: op.points })
        break
      case 'emoji':
        visible.push({
          kind: 'emoji',
          seq: op.seq,
          emoji: op.emoji,
          x: op.x,
          y: op.y,
          size: op.size,
          rotate: op.rotate,
        })
        break
      case 'emoji-update': {
        const index = visible.findIndex((item) => item.kind === 'emoji' && item.seq === op.target)
        if (index < 0) break
        const current = visible[index] as Extract<RenderItem, { kind: 'emoji' }>
        visible[index] = {
          kind: 'emoji',
          seq: current.seq,
          emoji: current.emoji,
          x: op.x ?? current.x,
          y: op.y ?? current.y,
          size: op.size ?? current.size,
          rotate: op.rotate ?? current.rotate,
        }
        break
      }
      case 'undo': {
        const index = visible.findIndex((item) => item.seq === op.target)
        if (index >= 0) visible.splice(index, 1)
        break
      }
      case 'clear':
        visible.length = 0
        break
    }
  }
  return visible
}

export interface DrawEngineOptions {
  /** 这条操作流属于谁。服务端收到分片时要用登录态覆盖它，不能信客户端 */
  by: string
  config?: Partial<DrawConfig>
  /** 注入时钟，测试里可以快进 */
  now?: () => number
  /** 注入分片 id 生成器，测试里要确定性 */
  newChunkId?: () => string
}

export interface DrawStats {
  /** 操作流总条数（含 undo / clear） */
  ops: number
  /** 画面上的笔画点数 */
  points: number
  /** 画面上的 emoji 个数 */
  emoji: number
  /** 已生成但还没发出去的操作条数 */
  pending: number
  /** 当前最大 seq */
  seq: number
}

/**
 * 一个回合一个实例。**一个回合只有一个人在画**，所以 seq 在回合内唯一；
 * 换人作画时新建实例（或 reset + 新回合），不要两个引擎的操作流混在一起。
 */
export class DrawEngine {
  readonly by: string
  private readonly config: DrawConfig
  private readonly now: () => number
  private readonly newChunkId: () => string

  private ops: DrawOp[] = []
  private pending: DrawOp[] = []
  private redoStack: DrawOp[] = []
  private draft: StrokeOp | null = null
  private seq = 0
  /** 已收下的最大 seq，用来丢弃迟到的旧分片和重复操作 */
  private maxSeq = 0
  private pendingPoints = 0
  private lastFlushAt: number
  /** 已经处理过的分片 id，防止同一条推送来两次 */
  private seenChunks = new Set<string>()
  private chunkCounter = 0

  constructor(options: DrawEngineOptions) {
    this.by = options.by
    this.config = { ...DEFAULT_DRAW_CONFIG, ...options.config }
    this.now = options.now ?? (() => Date.now())
    this.newChunkId = options.newChunkId ?? (() => `${options.by}-${this.chunkCounter++}-${Math.random().toString(36).slice(2, 8)}`)
    this.lastFlushAt = this.now()
  }

  get drawConfig(): DrawConfig {
    return this.config
  }

  /** 当前是不是画到一半（手指还没抬起来） */
  get drawing(): boolean {
    return this.draft !== null
  }

  get canUndo(): boolean {
    return replay(this.ops).length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get hasPending(): boolean {
    return this.pending.length > 0
  }

  stats(): DrawStats {
    const visible = replay(this.ops)
    return {
      ops: this.ops.length,
      points: visible.reduce((n, item) => n + (item.kind === 'stroke' ? item.points.length : 0), 0),
      emoji: visible.filter((item) => item.kind === 'emoji').length,
      pending: this.pending.length,
      seq: this.seq,
    }
  }

  /** 落笔 */
  beginStroke(point: Point, style: StrokeStyle): StrokeOp {
    this.endStroke()
    // 新的动作发生，说明用户放弃了原来的重做链
    this.redoStack = []
    const op: StrokeOp = {
      kind: 'stroke',
      seq: this.nextSeq(),
      color: style.color,
      width: clamp(style.width, 1, 40),
      points: [this.normalize(point)],
    }
    this.draft = op
    return op
  }

  /**
   * 手移动。返回 true 表示这个点被收下了（重复点会被丢掉，省流量）。
   * 单条笔画超过上限后忽略后续点，避免极端情况下把分片撑爆。
   */
  extendStroke(point: Point): boolean {
    // 多指触摸或抬手事件晚到时，touchmove 可能晚于 touchend 到达，这里不抛错，直接忽略
    if (!this.draft) return false
    if (this.draft.points.length >= this.config.maxPointsPerStroke) return false
    const next = this.normalize(point)
    const last = this.draft.points[this.draft.points.length - 1]
    if (last && last.x === next.x && last.y === next.y) return false
    this.draft.points.push(next)
    return true
  }

  /** 抬手：把这一笔提交进操作流，等分片带走 */
  endStroke(): StrokeOp | null {
    const draft = this.draft
    if (!draft) return null
    this.draft = null
    this.push(draft)
    return draft
  }

  /** 贴一个 emoji（Emoji 版） */
  placeEmoji(emoji: string, point: Point, options: { size?: number; rotate?: number } = {}): number {
    const count = replay(this.ops).filter((item) => item.kind === 'emoji').length
    if (count >= this.config.maxEmoji) throw new DrawError('EMOJI_LIMIT', '贴纸太多了，先撤销几个')
    this.redoStack = []
    const at = this.normalize(point)
    const op: EmojiOp = {
      kind: 'emoji',
      seq: this.nextSeq(),
      emoji,
      x: at.x,
      y: at.y,
      size: options.size ?? this.config.emojiSize,
      rotate: options.rotate ?? 0,
    }
    this.push(op)
    return op.seq
  }

  /** 拖动 / 缩放 / 旋转已贴上的 emoji。只在手指抬起时调用一次 */
  updateEmoji(target: number, patch: { x?: number; y?: number; size?: number; rotate?: number }): number {
    const exists = replay(this.ops).some((item) => item.kind === 'emoji' && item.seq === target)
    if (!exists) throw new DrawError('NO_POINT', '这个贴纸已经不在了')
    this.redoStack = []
    const op: EmojiUpdateOp = { kind: 'emoji-update', seq: this.nextSeq(), target }
    if (patch.x !== undefined || patch.y !== undefined) {
      const point = this.normalize({ x: patch.x ?? 0, y: patch.y ?? 0 })
      if (patch.x !== undefined) op.x = point.x
      if (patch.y !== undefined) op.y = point.y
    }
    if (patch.size !== undefined) op.size = clamp(patch.size, 24, 400)
    if (patch.rotate !== undefined) op.rotate = ((patch.rotate % 360) + 360) % 360
    this.push(op)
    return op.seq
  }

  /** 撤销最上面那一笔 / 那个贴纸。返回被撤销的 seq，没东西可撤返回 null */
  undo(): number | null {
    this.endStroke()
    const visible = replay(this.ops)
    if (visible.length === 0) return null
    const target = visible[visible.length - 1].seq
    const source = this.ops.find((op) => op.seq === target)
    if (source) this.redoStack.push(source)
    this.push({ kind: 'undo', seq: this.nextSeq(), target })
    return target
  }

  /** 重做：把撤销掉的那条换个新 seq 再发一次（远端不用懂 redo） */
  redo(): number | null {
    const source = this.redoStack.pop()
    if (!source) return null
    const again = this.reissue(source)
    if (!again) return null
    this.push(again)
    return again.seq
  }

  /** 清空画布。清空本身也是一条操作，所以要发出去 */
  clear(): number {
    this.endStroke()
    this.redoStack = []
    const seq = this.nextSeq()
    this.push({ kind: 'clear', seq })
    return seq
  }

  /** 画面上的东西（渲染层照着画） */
  visible(): RenderItem[] {
    return replay(this.ops)
  }

  /** 算一下现在该不该发分片了 */
  shouldFlush(now: number = this.now()): boolean {
    if (this.pending.length === 0) return false
    if (this.pending.length >= this.config.maxOpsPerChunk) return true
    if (this.pendingPoints >= this.config.maxPointsPerChunk) return true
    return now - this.lastFlushAt >= this.config.chunkMs
  }

  /**
   * 取一个分片。返回 null 表示还没到点。
   * 注意：**画到一半的笔画不进分片**，等抬手后进下一个分片，
   * 否则远端会收到半条线，看起来像断掉的。
   */
  takeChunk(now: number = this.now(), force = false): DrawChunk | null {
    if (this.pending.length === 0) return null
    if (!force && !this.shouldFlush(now)) return null
    const ops = this.pending
    this.pending = []
    this.pendingPoints = 0
    this.lastFlushAt = now
    return {
      chunkId: this.newChunkId(),
      by: this.by,
      ops,
      seqTo: ops[ops.length - 1].seq,
      at: now,
    }
  }

  /**
   * 收下别人发来的分片。返回实际应用了几条操作（0 表示重复或太旧）。
   * 频道可能把同一条推送两次，也可能晚到一条旧的分片，这里都按下不表。
   */
  applyChunk(chunk: DrawChunk): number {
    if (this.seenChunks.has(chunk.chunkId)) return 0
    this.remember(chunk.chunkId)
    // 自己发出去的分片被频道回显时不用再画一遍
    if (chunk.by === this.by) return 0
    let applied = 0
    for (const op of chunk.ops) {
      if (op.seq <= this.maxSeq) continue
      this.ops.push(op)
      this.maxSeq = op.seq
      applied++
    }
    return applied
  }

  /** 断线重连时用：拿当前完整的操作流 */
  snapshot(): DrawOp[] {
    return this.ops.slice()
  }

  /** 断线重连时用：**整体替换**，不做增量合并，避免脏数据残留 */
  loadSnapshot(ops: readonly DrawOp[]): void {
    this.ops = ops.slice()
    this.pending = []
    this.pendingPoints = 0
    this.draft = null
    this.redoStack = []
    this.maxSeq = this.ops.reduce((max, op) => (op.seq > max ? op.seq : max), 0)
    if (this.maxSeq > this.seq) this.seq = this.maxSeq
    this.lastFlushAt = this.now()
  }

  /**
   * 换回合作画时调用：清画面但**不重置 seq**。
   * 如果重置了，观看端的 maxSeq 会拒绝所有新操作，画面就永远空着。
   */
  reset(): void {
    this.ops = []
    this.pending = []
    this.pendingPoints = 0
    this.draft = null
    this.redoStack = []
    this.seenChunks.clear()
    this.lastFlushAt = this.now()
  }

  // ---------------------------------------------------------------- 内部

  private nextSeq(): number {
    this.seq += 1
    return this.seq
  }

  private push(op: DrawOp): void {
    this.ops.push(op)
    this.pending.push(op)
    // push 只会收到已经定稿的操作，所以这里数点数不会把半条笔画算进去
    if (op.kind === 'stroke') this.pendingPoints += op.points.length
    if (op.seq > this.maxSeq) this.maxSeq = op.seq
  }

  /** 重新发一次同内容、新 seq 的操作；undo / clear 不能重做 */
  private reissue(op: DrawOp): DrawOp | null {
    const seq = this.nextSeq()
    switch (op.kind) {
      case 'stroke':
        return { ...op, seq }
      case 'emoji':
        return { ...op, seq }
      case 'emoji-update':
        return { ...op, seq }
      default:
        return null
    }
  }

  private normalize(point: Point): Point {
    return {
      x: Math.round(clamp(point.x, 0, CANVAS.unit)),
      y: Math.round(clamp(point.y, 0, CANVAS.unit)),
    }
  }

  /** 分片 id 只留最近 1000 个，长局也不会一路吃内存 */
  private remember(chunkId: string): void {
    this.seenChunks.add(chunkId)
    if (this.seenChunks.size <= 1000) return
    const oldest = this.seenChunks.values().next()
    if (!oldest.done) this.seenChunks.delete(oldest.value)
  }
}
