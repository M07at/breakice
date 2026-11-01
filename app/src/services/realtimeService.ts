import type { Room } from '../types/room'

export type RoomEvent = 'player_joined' | 'player_ready' | 'game_start' | 'state_sync'

export function subscribeToRoom(_roomId: string, _onState: (room: Room) => void) {
  // TODO: 由 A 模块接入 Supabase 私有频道和 Presence。
  return () => undefined
}

export function requestRoomState(_roomCode: string) {
  // TODO: 断线重连后调用 get_room_state RPC。
}
