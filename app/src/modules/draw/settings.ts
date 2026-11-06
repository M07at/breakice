export const DEFAULT_DRAW_SECONDS = 90
export const DRAW_DURATION_OPTIONS = [30, 60, 90, 120, 180] as const

/** 固定选项也用于校验入口参数，避免无效时间产生无限/负数倒计时。 */
export function normalizeDrawSeconds(raw: unknown): number {
  const seconds = Number(raw)
  return DRAW_DURATION_OPTIONS.some(value => value === seconds) ? seconds : DEFAULT_DRAW_SECONDS
}

/** navigateTo 的自定义题面可能仍带 URL 编码；同时接受已解码的中文。 */
export function readDrawPrompt(raw: unknown): string {
  let value = String(raw ?? '')
  try { value = decodeURIComponent(value) } catch { /* 保留合法的百分号文字。 */ }
  return value.trim().slice(0, 20)
}
