/**
 * 你画我猜的 AI 评分：AI 猜的结果 + 用时 → 0–100 分。
 *
 * 口径（产品定的，很直白）：
 * - **猜中**：80 分起步，越快越高，最高 100
 *   `80 + 20 × (1 - 用时/60)`
 * - **没猜中**：80 分往下扣，越慢越低，最低 0
 *   `80 × (1 - 用时/60)`
 *
 * 用时统一夹在 0–60 秒；缺省按 60 秒处理（拿不到时间就别给速度加成）。
 * 纯函数，客户端展示和服务端计分都能用。
 */

export interface GuessOutcome {
  /** AI 是否猜中 */
  correct: boolean
  /** 从开始画到出结果的秒数 */
  seconds?: number
  /** AI 猜到的词（展示用） */
  guess?: string
}

const MAX_SECONDS = 60

function normalizeSeconds(seconds: number | undefined): number {
  if (seconds === undefined || !Number.isFinite(seconds)) return MAX_SECONDS
  return Math.min(MAX_SECONDS, Math.max(0, seconds))
}

export function scoreFromGuess(outcome: GuessOutcome): number {
  const seconds = normalizeSeconds(outcome.seconds)
  const ratio = 1 - seconds / MAX_SECONDS // 0 秒 → 1，60 秒 → 0

  const raw = outcome.correct ? 80 + 20 * ratio : 80 * ratio
  return Math.min(100, Math.max(0, Math.round(raw)))
}

/** 展示用文案：AI 猜了什么、用了多久 */
export function describeGuess(outcome: GuessOutcome): string {
  const parts: string[] = []
  if (outcome.guess) parts.push(`AI 猜：${outcome.guess}`)
  if (outcome.seconds !== undefined && Number.isFinite(outcome.seconds)) {
    parts.push(`用时 ${outcome.seconds.toFixed(1)} 秒`)
  }
  parts.push(outcome.correct ? '猜中了' : '没猜中')
  return parts.join(' · ')
}
