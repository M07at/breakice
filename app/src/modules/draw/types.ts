/**
 * 你画我猜（B）的共享类型。
 *
 * 两条硬约定，改之前先看 ADR：
 * 1. 坐标一律是 **0–1000 的归一化整数**，不存手机物理像素。逻辑画布固定 800×600，
 *    渲染时再按比例换算，这样谁在什么机型上画，别人看到的都是同一幅画。
 * 2. 画面由**操作流（DrawOp）**重放出来，而不是存一张位图。撤销、清空、Emoji 拖动
 *    都是操作流里的一条记录，所以远端只要收到同一个流就能重放出同一幅画。
 */

/** draw = 我能画；watch = 我只看别人画（同步进来）；readonly = 复盘/画廊，连按钮都不给 */
export type DrawMode = 'draw' | 'watch' | 'readonly'

/** classic = 常规自由画；emoji = 只能贴 emoji；custom = 题面是房主给的文字或图片 */
export type DrawVariant = 'classic' | 'emoji' | 'custom'

/** 归一化坐标，范围 0–1000，超出会被 clamp */
export interface Point {
  x: number
  y: number
}

export const CANVAS = {
  /** 逻辑画布宽（px），只影响绘制，不影响传输 */
  width: 800,
  /** 逻辑画布高（px） */
  height: 600,
  /** 归一化基准：坐标取值范围 0..unit */
  unit: 1000,
} as const

export interface StrokeStyle {
  color: string
  width: number
}

/** 一条笔画。points 少于 2 个时按「点」渲染成一个圆点 */
export interface StrokeOp {
  kind: 'stroke'
  seq: number
  color: string
  width: number
  points: Point[]
}

/** 贴上去的一个 emoji。size 是逻辑画布里的字号（px），rotate 是角度 */
export interface EmojiOp {
  kind: 'emoji'
  seq: number
  emoji: string
  x: number
  y: number
  size: number
  rotate: number
}

/**
 * 改一个已经贴上去的 emoji（拖动 / 缩放 / 旋转都发这一条）。
 * 只在手指抬起时发一次，拖动过程中不发，避免一拖几十条请求。
 */
export interface EmojiUpdateOp {
  kind: 'emoji-update'
  seq: number
  /** 被修改的那个 emoji 的 seq */
  target: number
  x?: number
  y?: number
  size?: number
  rotate?: number
}

/** 撤销：让 seq 等于 target 的那条操作不再显示 */
export interface UndoOp {
  kind: 'undo'
  seq: number
  target: number
}

/** 清空：丢掉所有比它早的操作 */
export interface ClearOp {
  kind: 'clear'
  seq: number
}

export type DrawOp = StrokeOp | EmojiOp | EmojiUpdateOp | UndoOp | ClearOp

/**
 * 笔画分片：一局里每人每 5 秒合并成 1 个分片再发。
 * 不是「画一笔发一次」—— 云开发的实时监听有单次记录数上限，一笔一条会瞬间打爆。
 */
export interface DrawChunk {
  chunkId: string
  /** 发分片的人。服务端必须用登录态覆盖它，不能信客户端 */
  by: string
  ops: DrawOp[]
  /** 分片里最大的 seq，接收方用它丢弃迟到的旧分片 */
  seqTo: number
  at: number
}

/** 重放结果：渲染层只需要照着这个数组画，不需要懂操作流 */
export type RenderItem =
  | { kind: 'stroke'; seq: number; color: string; width: number; points: Point[] }
  | { kind: 'emoji'; seq: number; emoji: string; x: number; y: number; size: number; rotate: number }

export interface DrawConfig {
  /** 多少个 emoji 版贴纸同时存在时给个上限，防止有人刷满屏 */
  maxEmoji: number
  /** emoji 默认字号（逻辑画布 px） */
  emojiSize: number
  /** 单条笔画最多存多少个点，超出就忽略后续点（防止极端长笔画把分片撑爆） */
  maxPointsPerStroke: number
  /** 一个分片最多几条操作，够了立刻发，不等 5 秒 */
  maxOpsPerChunk: number
  /** 一个分片最多几个笔画点，够了立刻发 */
  maxPointsPerChunk: number
  /** 5 秒一个分片 */
  chunkMs: number
  /** 画作导出后的大小上限（字节）。超过就缩小重导，给 AI 评分用 */
  maxImageBytes: number
}

export const DEFAULT_DRAW_CONFIG: DrawConfig = {
  maxEmoji: 40,
  emojiSize: 96,
  maxPointsPerStroke: 600,
  maxOpsPerChunk: 60,
  maxPointsPerChunk: 1200,
  chunkMs: 5000,
  maxImageBytes: 100 * 1024,
}

/** 三个维度，和需求文档 FR-04 一致 */
export interface AiScoreDimensions {
  /** 构图 */
  composition: number
  /** 创意 */
  creativity: number
  /** 契合度：和题目有多像 */
  relevance: number
}

/**
 * A 的 AI 评分结果（`scoreDrawing` 的返回）。
 * 这是我们之间的契约，A 的服务端只要按这个形状返回，前端一行都不用改。
 */
export interface AiScoreResult {
  /** 综合分 0–100 */
  score: number
  dimensions: AiScoreDimensions
  /** 一段评语；降级时可能是空字符串 */
  comment: string
  /** true = 这轮 AI 不可用，分数来自兜底，排行榜上要标「本轮未含 AI 评分」 */
  degraded?: boolean
  /** 模型名，只用来在评分卡上做小字标注，不参与逻辑 */
  provider?: string
  /** 服务端耗时，用于 NFR-02 的观察 */
  latencyMs?: number
}

/** 一道题面。B 只需要这三种来源，题库细节归 C 的 bank 模块 */
export interface DrawWord {
  word: string
  /** 分类提示，例如「动物」。作画页可以显示，避免有人不知道画什么 */
  hint?: string
  /** Emoji 版用：这道题推荐用哪个 emoji 开头 */
  emoji?: string
  /** 自定义版用：房主给的一段文字或一张参考图 */
  custom?: { type: 'text' | 'image'; text?: string; imageRef?: string }
}
