import type { Player } from '../types/room'

/**
 * D 模块（大厅 / 房间）到 C 模块（谁是卧底 / 题库）的入口适配层。
 *
 * 边界说明：
 * - C 的游戏引擎只使用「座位昵称」，玩家身份由各自的 UcPlayerPort 绑定；
 *   这里只负责把大厅的房间名单传过去，不创建游戏状态、不切换操作者。
 * - 头像仍然由 D 的头像系统渲染在房间等待区；C 的页面目前只展示昵称。
 * - 真正的实时同步（多设备）需要 A 模块接入 UcPlayerPort，本文件不提供假实现。
 */

export type UndercoverVariant = 'classic' | 'draw'

const ROUTE: Record<UndercoverVariant, string> = {
  classic: '/pages-uc/setup',
  draw: '/pages-uc/hybrid',
}

export const PLAYER_ROUTE: Record<UndercoverVariant, string> = {
  classic: '/pages-uc/player',
  draw: '/pages-uc/hybrid-player',
}

/** 房间里的玩家顺序即座位顺序：1 号位是主持人，与 C 的规则一致。 */
export function toSeatNames(players: Player[] | undefined | null): string[] {
  if (!players?.length) return []
  return players.map((player) => (player.nickname || '').trim()).filter(Boolean)
}

export function undercoverSetupUrl(variant: UndercoverVariant, players?: Player[] | null): string {
  const names = toSeatNames(players)
  const base = ROUTE[variant]
  // 逐个编码再用逗号拼接，避免逗号本身被编码后无法拆分。
  return names.length ? `${base}?names=${names.map((name) => encodeURIComponent(name)).join(',')}` : base
}

export function bankUrl(): string {
  return '/pages-bank/index'
}
