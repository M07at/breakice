import type { Player } from '../types/room'

/**
 * D 模块（大厅 / 房间）到其它模块的入口适配层。
 *
 * 边界说明：
 * - C 的游戏引擎只使用「座位昵称」，玩家身份由各自的 UcPlayerPort 绑定；
 *   这里只负责把大厅的房间名单传过去，不创建游戏状态、不切换操作者。
 * - B 的你画我猜目前是本机房间（LocalDrawRoomBackend），开设页自己管版本和人数，
 *   这里只提供路由，不接管它的房间状态。
 * - 头像仍然由 D 的形象系统渲染在房间等待区；C、B 的页面目前只展示昵称。
 * - 真正的实时同步（多设备）需要 A 模块接入，本文件不提供假实现。
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

/** B：你画我猜（常规 / Emoji / 自定义）；人数由房间决定，开设页只选版本 */
export function drawSetupUrl(memberCount?: number, roomId?: string): string {
  const count = Math.round(Number(memberCount) || 0)
  // lock=1：进入游戏后不允许再改人数；room 让联机版能发布/订阅对局
  const room = roomId ? `&room=${encodeURIComponent(roomId)}` : ''
  return count >= 2 && count <= 12 ? `/pages-draw/setup?count=${count}&lock=1${room}` : `/pages-draw/setup?room=${encodeURIComponent(roomId ?? '')}`
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

