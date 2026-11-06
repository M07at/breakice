/**
 * 「主动退出后不要自动拉回游戏」的开关。
 *
 * 场景：谁是卧底一局结束后房间仍是 playing（0026），玩家点「退出，回到大厅」后，
 * 房间页看到 phase=playing 又自动把他送回结算页——这不符合「退出就该留在大厅」。
 *
 * 规则：
 * - 玩家主动退出游戏 → 置为抑制状态，回到大厅时不再自动进游戏；
 * - 玩家点「回到游戏」→ 解除抑制。
 */
let suppressed = false

export function suppressAutoEnter(): void {
  suppressed = true
}

export function allowAutoEnter(): void {
  suppressed = false
}

export function autoEnterAllowed(): boolean {
  return !suppressed
}
