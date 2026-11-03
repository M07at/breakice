import { defaultAvatar } from './avatarService'
import type { AvatarConfig, GameType, Player, Room } from '../types/room'

export interface CreateRoomInput {
  name: string
  maxPlayers: number
  nickname: string
  avatar: AvatarConfig
}

export interface JoinRoomInput {
  code: string
  nickname: string
  avatar: AvatarConfig
}

const seedPlayers: Player[] = [
  { id: 'player-2', nickname: '小雨', avatar: { color: 9, body: 7, mouth: 12, eyes: 5, hat: 9 }, isHost: false, isReady: true, online: true },
  { id: 'player-3', nickname: '阿哲', avatar: { color: 4, body: 3, mouth: 2, eyes: 10, hat: 14 }, isHost: false, isReady: false, online: true },
]

function createRoomSeed(input: CreateRoomInput): Room {
  const hostId = 'player-host'
  return {
    id: 'mock-room-001',
    code: '5A7K2M',
    name: input.name,
    hostId,
    maxPlayers: input.maxPlayers,
    phase: 'lobby',
    gameType: null,
    players: [
      {
        id: hostId,
        nickname: input.nickname,
        avatar: input.avatar,
        isHost: true,
        isReady: true,
        online: true,
      },
      ...seedPlayers,
    ],
  }
}

export async function createRoom(input: CreateRoomInput): Promise<Room> {
  await new Promise((resolve) => setTimeout(resolve, 220))
  return createRoomSeed(input)
}

export async function joinRoom(input: JoinRoomInput): Promise<Room> {
  await new Promise((resolve) => setTimeout(resolve, 220))
  const room = createRoomSeed({ name: '周五破冰局', maxPlayers: 20, nickname: '主持人', avatar: { ...defaultAvatar } })
  room.players.push({
    id: 'current-player',
    nickname: input.nickname,
    avatar: input.avatar,
    isHost: false,
    isReady: false,
    online: true,
  })
  room.code = input.code.toUpperCase()
  return room
}

export async function startGame(room: Room, gameType: GameType): Promise<Room> {
  await new Promise((resolve) => setTimeout(resolve, 160))
  return { ...room, gameType, phase: 'playing' }
}

export async function getRoomState(code: string): Promise<Room | null> {
  await new Promise((resolve) => setTimeout(resolve, 120))
  return code ? createRoomSeed({ name: '周五破冰局', maxPlayers: 20, nickname: '主持人', avatar: { ...defaultAvatar } }) : null
}
