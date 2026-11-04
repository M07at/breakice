import type { AvatarConfig, GameType, Room } from '../types/room'

/** 后端形态：配置了 Supabase 就用 Supabase，否则用本机房间 */
export type PlatformMode = 'supabase' | 'local'

/** 当前设备上的「我」 */
export interface Identity {
  id: string
  nickname: string
  avatar: AvatarConfig
}

export interface CreateRoomInput {
  title: string
  maxPlayers: number
}

export type Unsubscribe = () => void

/**
 * 房间后端接口。D 的大厅/房间只依赖这个接口，
 * 换成 Supabase（A 的 RPC）或本机实现时页面不用改。
 *
 * 约定：
 * - 所有方法里的身份都来自登录态/本机身份，不接受「我是谁」参数；
 * - `watch` 在房间数据变化时回调完整快照；
 * - 游戏开始 = 房间从 lobby 进入 playing，`gameType` 决定进哪个游戏。
 */
export interface RoomApi {
  readonly mode: PlatformMode
  /** 展示用，例如「本机房间」/「Supabase 房间」 */
  readonly label: string
  identity(): Identity
  setIdentity(patch: Partial<Pick<Identity, 'nickname' | 'avatar'>>): Promise<Identity>
  createRoom(input: CreateRoomInput): Promise<Room>
  joinRoom(code: string): Promise<Room>
  leaveRoom(roomId: string): Promise<void>
  setReady(roomId: string, ready: boolean): Promise<void>
  /** 主持人开局：写 gameType 并把房间切到 playing */
  startGame(roomId: string, gameType: GameType): Promise<void>
  /** 主持人结束本局，房间回到大厅 */
  endGame(roomId: string): Promise<void>
  /** 主持人关闭房间 */
  closeRoom(roomId: string): Promise<void>
  getRoom(roomId: string): Promise<Room>
  watch(roomId: string, onChange: (room: Room) => void): Unsubscribe
}

export type PlatformErrorCode =
  | 'AUTH_REQUIRED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_NOT_JOINABLE'
  | 'ROOM_FULL'
  | 'NOT_A_MEMBER'
  | 'HOST_ONLY'
  | 'NOT_ALL_READY'
  | 'NETWORK'
  | 'NOT_CONFIGURED'
  | 'UNKNOWN'

export class PlatformError extends Error {
  readonly code: PlatformErrorCode

  constructor(code: PlatformErrorCode, message: string) {
    super(message)
    this.name = 'PlatformError'
    this.code = code
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof PlatformError) return error.message
  if (error instanceof Error) return error.message
  return '操作失败，请重试'
}
