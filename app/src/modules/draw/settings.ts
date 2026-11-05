export const DEFAULT_DRAW_SECONDS = 90
export const DRAW_DURATION_OPTIONS = [30, 60, 90, 120, 180] as const

/** 固定选项也用于校验入口参数，避免无效时间产生无限/负数倒计时。 */
export function normalizeDrawSeconds(raw: unknown): number {
  const seconds = Number(raw)
  return DRAW_DURATION_OPTIONS.some(value => value === seconds) ? seconds : DEFAULT_DRAW_SECONDS
}
