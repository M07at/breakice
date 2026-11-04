import { roomApi } from '../platform'
import { SupabaseRoomApi } from '../platform/supabase'
import type { LeaderboardRow } from '../modules/score'

/**
 * 房间积分榜。
 *
 * 分数由 uc-command 在结算时写进 public.scores（引擎给的建议分值），
 * 这里通过 0010 的 room_leaderboard RPC 按房间聚合，再转成 B 的排行榜组件要的行结构。
 */

interface RawRow {
  user_id: string
  nickname: string | null
  points: number | string | null
  games: number | string | null
}

export async function fetchRoomLeaderboard(roomId: string): Promise<LeaderboardRow[]> {
  if (!roomId || roomApi.mode !== 'supabase') return []
  const rows = await (roomApi as SupabaseRoomApi).rpcCall<RawRow[]>('room_leaderboard', { p_room_id: roomId })
  if (!Array.isArray(rows)) return []

  const sorted = rows
    .map((row) => ({
      playerId: row.user_id,
      name: row.nickname || '玩家',
      total: Number(row.points) || 0,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'zh-Hans-CN'))

  // 同分并列同名次
  let rank = 0
  let lastTotal: number | null = null
  return sorted.map((row, index) => {
    if (lastTotal === null || row.total !== lastTotal) {
      rank = index + 1
      lastTotal = row.total
    }
    return { ...row, rank, delta: 0, degradedRounds: 0 }
  })
}
