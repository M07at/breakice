import { roomApi } from '../platform'
import { SupabaseRoomApi } from '../platform/supabase'
import type { DrawAction, DrawActionKind, DrawRemoteApi } from './drawRemote'
import type { DrawRoomView } from '../modules/draw/room'

/**
 * DrawRemoteApi 的 Supabase 实现，对应 0017 里的 5 个 RPC。
 *
 * 没配后端（本机房间）时直接抛错——你画我猜联机必须先有房间服务。
 */
function api(): SupabaseRoomApi {
  if (roomApi.mode !== 'supabase') {
    throw new Error('你画我猜联机需要 Supabase 后端')
  }
  return roomApi as SupabaseRoomApi
}

interface ReadRow {
  view: DrawRoomView
  version: number | string
  updated_at?: string
}

interface ActionRow {
  id: number | string
  user_id: string
  kind: DrawActionKind
  payload: Record<string, unknown> | null
  created_at: string
}

export function createSupabaseDrawApi(): DrawRemoteApi {
  return {
    async publishView(roomId, view) {
      const version = await api().rpcCall<number | string>('publish_draw_view', {
        p_room_id: roomId,
        p_view: view,
      })
      return Number(version)
    },

    async readView(roomId) {
      const rows = await api().rpcCall<ReadRow[] | ReadRow | null>('read_draw_view', { p_room_id: roomId })
      const row = Array.isArray(rows) ? rows[0] : rows
      if (!row?.view) return null
      return { view: row.view, version: Number(row.version) }
    },

    async postAction(roomId, kind, payload = {}) {
      const id = await api().rpcCall<number | string>('post_draw_action', {
        p_room_id: roomId,
        p_kind: kind,
        p_payload: payload,
      })
      return Number(id)
    },

    async takeActions(roomId, limit = 50) {
      const rows = await api().rpcCall<ActionRow[] | null>('take_draw_actions', {
        p_room_id: roomId,
        p_limit: limit,
      })
      if (!Array.isArray(rows)) return []
      return rows.map<DrawAction>((row) => ({
        id: Number(row.id),
        userId: row.user_id,
        kind: row.kind,
        payload: row.payload ?? {},
        createdAt: row.created_at,
      }))
    },
  }
}

/** 这局结束后清理服务端会话，避免下一局的旧视图被读到 */
export async function clearRemoteDrawRoom(roomId: string): Promise<void> {
  if (roomApi.mode !== 'supabase') return
  try {
    await (roomApi as SupabaseRoomApi).rpcCall<void>('clear_draw_session', { p_room_id: roomId })
  } catch (error) {
    console.warn('清理你画我猜会话失败', error)
  }
}
