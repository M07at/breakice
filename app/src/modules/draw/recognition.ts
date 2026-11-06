import { DRAWZY_CLASSES, expectedClassFor } from './classMap'

/** 以目标类别的模型概率计分；下载耗时和无关的前五候选不再带来保底高分。 */
export function evaluateRecognition(word: string, raw: unknown): Record<string, unknown> {
  const expected = expectedClassFor(word) ?? DRAWZY_CLASSES.find(value => value === word.trim().toLowerCase())
  if (!expected) return { status: 'unsupported', error: 'UNSUPPORTED_WORD', comment: '本题超出 AI 识别范围，本轮不计 AI 分。' }
  const data = (raw as { data?: { sketch_class_name?: string; class_probabilities?: Record<string, number>; top_five_sketch_classes?: string[]; preprocessing_version?: string } })?.data
  if (data?.preprocessing_version !== 'canvas-ink-v3') return { status: 'failed', error: 'OUTDATED_PROVIDER_RESULT' }
  const confidence = data?.class_probabilities?.[expected]
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !data?.sketch_class_name) {
    return { status: 'failed', error: 'BAD_PROVIDER_RESULT' }
  }
  const score = Math.round(confidence * 100)
  return { status: 'success', score, total: score, confidence, guess: data.sketch_class_name,
    candidates: data.top_five_sketch_classes ?? [], provider: 'drawzy', scoringVersion: 'confidence-v3', preprocessingVersion: data.preprocessing_version,
    comment: `AI 识别：${data.sketch_class_name} · 题目匹配度 ${score}%` }
}
