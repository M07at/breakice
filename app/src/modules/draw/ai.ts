/**
 * AI 评分的**前端一侧**适配器。
 *
 * 分工：A 在服务端调多模态模型（`scoreDrawing`，见 A6），B 只负责
 * 1) 把画作交出去，2) 把返回的东西解析成确定的形状，3) 渲染评分卡、算权重分。
 *
 * 这里对返回格式做**容错**：A 的服务端无论字段叫 score 还是 total、dimensions 还是 dims，
 * 都能解析出来。但解析不了就明确失败，绝不把原始文本直接塞进界面（需求 FR-04 异常与边界）。
 */
import { DrawError } from './errors'
import type { AiScoreDimensions, AiScoreResult } from './types'

export interface AiScoreRequest {
  /** 云存储里的图片引用（fileID / URL），不是手机本地临时路径 */
  imageRef: string
  /** 本轮题面，评分要判断「契合度」 */
  word: string
  /** 同一个回合同一个玩家，服务端用它做幂等，避免重复计费 */
  roundKey?: string
}

/** A 的服务端实现这个接口，B 的页面只依赖它 */
export interface AiScorer {
  score(request: AiScoreRequest): Promise<AiScoreResult>
}

const DIMENSION_KEYS = ['composition', 'creativity', 'relevance'] as const
/** 允许服务端用中文键名，省得为了字段名来回改 */
const DIMENSION_ALIASES: Record<keyof AiScoreDimensions, string[]> = {
  composition: ['composition', 'compositionScore', '构图'],
  creativity: ['creativity', 'creativityScore', '创意'],
  relevance: ['relevance', 'relevanceScore', 'match', '契合度'],
}

function readNumber(source: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function clampScore(value: number): number {
  const n = Math.round(value)
  return n < 0 ? 0 : n > 100 ? 100 : n
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * 把服务端返回的东西变成 AiScoreResult。
 * 三个维度缺任何一个都会从综合分补，保证界面永远有分项可显示。
 */
export function normalizeAiScore(raw: unknown): AiScoreResult {
  const root = asRecord(raw)
  if (!root) throw new DrawError('BAD_SCORE', 'AI 评分返回的不是对象，本轮按降级处理')

  // 有的封装会把结果包在 data / result 里
  const payload = asRecord(root.data) ?? asRecord(root.result) ?? root
  const dimsSource = asRecord(payload.dimensions) ?? asRecord(payload.dims) ?? asRecord(payload.scores) ?? payload

  const dimensions = {} as AiScoreDimensions
  for (const key of DIMENSION_KEYS) {
    const value = readNumber(dimsSource, DIMENSION_ALIASES[key])
    dimensions[key] = value === null ? Number.NaN : clampScore(value)
  }

  const total = readNumber(payload, ['score', 'total', 'totalScore', 'overall'])
  const validDims = DIMENSION_KEYS.map((key) => dimensions[key]).filter((n) => Number.isFinite(n))
  const fallbackTotal = validDims.length > 0 ? validDims.reduce((a, b) => a + b, 0) / validDims.length : Number.NaN
  const score = total === null ? fallbackTotal : clampScore(total)
  if (!Number.isFinite(score)) throw new DrawError('BAD_SCORE', 'AI 评分里没有可用的分数，本轮按降级处理')

  // 综合分有了，分项还缺的就用综合分补，界面不留空
  for (const key of DIMENSION_KEYS) {
    if (!Number.isFinite(dimensions[key])) dimensions[key] = Math.round(score)
  }

  const commentSource = payload.comment ?? payload.review ?? payload.summary ?? payload.评语
  const comment = typeof commentSource === 'string' ? commentSource.trim() : ''
  const providerSource = payload.provider ?? payload.model
  const latencySource = readNumber(payload, ['latencyMs', 'latency', 'elapsedMs'])

  return {
    score: Math.round(score),
    dimensions,
    comment,
    degraded: payload.degraded === true || payload.ok === false,
    ...(typeof providerSource === 'string' ? { provider: providerSource } : {}),
    ...(latencySource !== null ? { latencyMs: Math.round(latencySource) } : {}),
  }
}

/** 明确的降级结果：AI 不可用时用它，排行榜会标「本轮未含 AI 评分」 */
export function degradedScore(reason = ''): AiScoreResult {
  return {
    score: 0,
    dimensions: { composition: 0, creativity: 0, relevance: 0 },
    comment: reason,
    degraded: true,
  }
}

/**
 * 本地假评分器：**只在没接 A 的服务端时用**，用来把前端链路跑通。
 * 形状和真接口完全一致，接真接口时只要把 AI 评分器换掉，页面一行都不用改。
 */
export class MockAiScorer implements AiScorer {
  private readonly delayMs: number
  private readonly failRate: number

  constructor(options: { delayMs?: number; failRate?: number } = {}) {
    this.delayMs = options.delayMs ?? 900
    this.failRate = options.failRate ?? 0
  }

  async score(request: AiScoreRequest): Promise<AiScoreResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    if (this.failRate > 0 && Math.random() < this.failRate) {
      throw new DrawError('BAD_SCORE', '（演示）AI 服务超时')
    }
    // 用题面和图片引用算一个稳定的假分，避免每次刷新分数乱跳
    const seed = hash(`${request.word}:${request.imageRef}`)
    const composition = 55 + (seed % 40)
    const creativity = 50 + ((seed >> 3) % 45)
    const relevance = 45 + ((seed >> 6) % 50)
    const score = Math.round((composition + creativity + relevance) / 3)
    return {
      score,
      dimensions: { composition, creativity, relevance },
      comment: mockComment(score, request.word),
      provider: 'mock',
      latencyMs: this.delayMs,
    }
  }
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mockComment(score: number, word: string): string {
  if (score >= 85) return `这张「${word}」很到位：构图清楚，一眼就能认出来，还有点小心思。`
  if (score >= 70) return `画的「${word}」基本认得出来，细节再补两笔会更像。`
  if (score >= 55) return `「${word}」的主要特征抓住了，但构图有点散，猜的人要想一会儿。`
  return `这个「${word}」…很有想象力，就是和题目不太熟。`
}

// ---------------------------------------------------------------- 真接口

/**
 * 发一次请求的最小抽象。抽出来是为了两件事：
 * 1. 单测里塞个假 transport，不需要真网络，也不需要 uni 环境；
 * 2. 以后 A 想换成走 RPC、走云开发、或者加签名，只换 transport，不动评分逻辑。
 */
export interface AiScoreTransport {
  post(url: string, body: Record<string, unknown>, timeoutMs: number): Promise<unknown>
}

export interface HttpAiScorerOptions {
  /** A 提供的评分接口地址（Edge Function URL / RPC 网关） */
  endpoint: string
  /** 默认按 8 秒总预算算，和需求 FR-04 的 ⑤ 一致 */
  timeoutMs?: number
  /** 不传就用 uni.request；单测里传假的 */
  transport?: AiScoreTransport
}

/**
 * 调 A 的 `scoreDrawing`。
 *
 * 请求体只有这三个字段——这是我们之间的契约，也是唯一需要 A 对齐的地方：
 * `{ imageRef, word, roundKey? }`
 *
 * 返回的东西交给 `normalizeAiScore` 做容错解析：解析不了就抛 `BAD_SCORE`，
 * 由调用方降级，绝不把服务端原文塞进界面。
 */
export class HttpAiScorer implements AiScorer {
  private readonly endpoint: string
  private readonly timeoutMs: number
  private readonly transport: AiScoreTransport

  constructor(options: HttpAiScorerOptions) {
    this.endpoint = options.endpoint
    this.timeoutMs = options.timeoutMs ?? 8000
    this.transport = options.transport ?? createUniAiTransport()
  }

  async score(request: AiScoreRequest): Promise<AiScoreResult> {
    const body: Record<string, unknown> = { imageRef: request.imageRef, word: request.word }
    // 有 roundKey 才带，避免服务端把 undefined 当成一个真实值
    if (request.roundKey) body.roundKey = request.roundKey
    const raw = await this.transport.post(this.endpoint, body, this.timeoutMs)
    return normalizeAiScore(raw)
  }
}

interface UniRequestResult {
  statusCode?: number
  data?: unknown
}

interface UniRequestFail {
  errMsg?: string
}

/** 走 uni.request 的默认实现。注意：小程序正式版要求这个域名已完成 ICP 备案 */
export function createUniAiTransport(headers: Record<string, string> = {}): AiScoreTransport {
  return {
    post(url: string, body: Record<string, unknown>, timeoutMs: number) {
      return new Promise<unknown>((resolve, reject) => {
        uni.request({
          url,
          method: 'POST',
          data: body as never,
          timeout: timeoutMs,
          header: { 'content-type': 'application/json', ...headers },
          success: (res: UniRequestResult) => {
            const status = res.statusCode ?? 0
            if (status < 200 || status >= 300) {
              // 5xx / 4xx 都按「评分失败」处理，让调用方走降级
              reject(new DrawError('BAD_SCORE', `评分服务返回 ${status}`))
              return
            }
            resolve(res.data)
          },
          fail: (err: UniRequestFail) => {
            reject(new DrawError('BAD_SCORE', err?.errMsg || 'AI 评分请求失败'))
          },
        })
      })
    },
  }
}

