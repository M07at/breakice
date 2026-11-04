import { roomApi } from '../platform'
import type { Unsubscribe } from '../platform/types'
import type { GameType, Room, TruthTurn } from '../types/room'

/**
 * 房间服务的统一出口。页面和 store 只跟这里打交道，
 * 底下是本机房间还是 Supabase 由平台层决定（见 app/src/platform）。
 */

export { PlatformError, toErrorMessage } from '../platform/types'

export interface CreateRoomInput {
  name: string
  maxPlayers: number
}

export interface JoinRoomInput {
  code: string
}

export function platformLabel(): string {
  return roomApi.label
}

export function currentIdentity() {
  return roomApi.identity()
}

/** 把首页设置的昵称/形象同步到后端（Supabase 会写 profiles，本机模式只落本地） */
export function syncIdentity(nickname: string, avatar: ReturnType<typeof currentIdentity>['avatar']) {
  return roomApi.setIdentity({ nickname, avatar })
}

export function createRoom(input: CreateRoomInput): Promise<Room> {
  return roomApi.createRoom({ title: input.name.trim() || '破冰局', maxPlayers: input.maxPlayers })
}

export function joinRoom(input: JoinRoomInput): Promise<Room> {
  return roomApi.joinRoom(input.code)
}

export function leaveRoom(roomId: string): Promise<void> {
  return roomApi.leaveRoom(roomId)
}

export function setReady(roomId: string, ready: boolean): Promise<void> {
  return roomApi.setReady(roomId, ready)
}

export function startGame(roomId: string, gameType: GameType): Promise<void> {
  return roomApi.startGame(roomId, gameType)
}

export function endGame(roomId: string): Promise<void> {
  return roomApi.endGame(roomId)
}

/** 真心话大冒险：把这一轮的「轮到谁 + 什么题」写到房间共享状态 */
export function setTruth(roomId: string, turn: TruthTurn | null): Promise<void> {
  return roomApi.setTruth(roomId, turn)
}

export function closeRoom(roomId: string): Promise<void> {
  return roomApi.closeRoom(roomId)
}

export function fetchRoom(roomId: string): Promise<Room> {
  return roomApi.getRoom(roomId)
}

export function watchRoom(roomId: string, onChange: (room: Room | null) => void): Unsubscribe {
  return roomApi.watch(roomId, onChange)
}


