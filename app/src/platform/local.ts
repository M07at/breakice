import { getSavedProfile, normalizeAvatar, normalizeNickname, saveProfile } from '../services/avatarService'
import type { AvatarConfig, GameType, Player, Room, TruthTurn } from '../types/room'
import { PlatformError } from './types'
import type { CreateRoomInput, Identity, RoomApi, Unsubscribe } from './types'
import { normalizeMbti } from '../modules/shared/mbti'

/**
 * 本机房间：没有配置 Supabase 时的实现。
 *
 * 房间状态只存在于当前设备内存里，所以它只能验证「创建房间 → 准备 → 主持人开局」
 * 这一条流程，不能让第二台设备加入。要真正多人联机必须配 Supabase（A 的后端）。
 * 这里不做假的「其他玩家」，保证界面看到的就是真实存在的成员。
 */

const DEVICE_KEY = 'break-ice-device-id-v1'
const ROOMS_KEY = 'break-ice-local-rooms-v1'

interface LocalRoomRecord {
  id: string
  code: string
  title: string
  hostId: string
  maxPlayers: number
  phase: Room['phase']
  gameType: GameType | null
  truth?: TruthTurn | null
  members: { id: string; nickname: string; avatar: AvatarConfig; mbti?: Identity['mbti']; ready: boolean; online: boolean; seat: number }[]
}

const listeners = new Map<string, Set<(room: Room) => void>>()

function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
  return code
}

function deviceId(): string {
  try {
    const saved = uni.getStorageSync(DEVICE_KEY)
    if (typeof saved === 'string' && saved) return saved
    const next = randomId('device')
    uni.setStorageSync(DEVICE_KEY, next)
    return next
  } catch {
    return 'device-local'
  }
}

function readRooms(): Record<string, LocalRoomRecord> {
  try {
    const raw = uni.getStorageSync(ROOMS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(String(raw)) as Record<string, LocalRoomRecord>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeRooms(rooms: Record<string, LocalRoomRecord>): void {
  try {
    uni.setStorageSync(ROOMS_KEY, JSON.stringify(rooms))
  } catch (error) {
    console.warn('保存本机房间失败', error)
  }
}

function toRoom(record: LocalRoomRecord): Room {
  const players: Player[] = record.members
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((member) => ({
      id: member.id,
      nickname: member.nickname,
      mbti: normalizeMbti(member.mbti),
      avatar: member.avatar,
      isHost: member.id === record.hostId,
      isReady: member.ready,
      online: member.online,
    }))
  return {
    id: record.id,
    code: record.code,
    name: record.title,
    hostId: record.hostId,
    maxPlayers: record.maxPlayers,
    phase: record.phase,
    gameType: record.gameType,
    truth: record.truth ?? null,
    players,
  }
}

function emit(record: LocalRoomRecord): void {
  const room = toRoom(record)
  listeners.get(record.id)?.forEach((listener) => listener(room))
}

function save(record: LocalRoomRecord): Room {
  const rooms = readRooms()
  rooms[record.id] = record
  writeRooms(rooms)
  emit(record)
  return toRoom(record)
}

function load(roomId: string): LocalRoomRecord {
  const record = readRooms()[roomId]
  if (!record) throw new PlatformError('ROOM_NOT_FOUND', '房间不存在或已关闭')
  return record
}

export class LocalRoomApi implements RoomApi {
  readonly mode = 'local' as const
  readonly label = '本机房间'

  identity(): Identity {
    const profile = getSavedProfile()
    return { id: deviceId(), nickname: profile.nickname, avatar: profile.avatar, mbti: normalizeMbti(profile.mbti) }
  }

  async setIdentity(patch: Partial<Pick<Identity, 'nickname' | 'avatar' | 'mbti'>>): Promise<Identity> {
    const current = getSavedProfile()
    const next = {
      nickname: patch.nickname !== undefined ? normalizeNickname(patch.nickname) : current.nickname,
      avatar: patch.avatar !== undefined ? normalizeAvatar(patch.avatar) : current.avatar,
      mbti: normalizeMbti(patch.mbti !== undefined ? patch.mbti : current.mbti),
    }
    saveProfile(next)
    return { id: deviceId(), ...next }
  }

  async createRoom(input: CreateRoomInput): Promise<Room> {
    const me = this.identity()
    const record: LocalRoomRecord = {
      id: randomId('room'),
      code: roomCode(),
      title: input.title,
      hostId: me.id,
      maxPlayers: input.maxPlayers,
      phase: 'lobby',
      gameType: null,
      members: [{ id: me.id, nickname: me.nickname, avatar: me.avatar, mbti: me.mbti, ready: true, online: true, seat: 1 }],
    }
    return save(record)
  }

  async joinRoom(code: string): Promise<Room> {
    const me = this.identity()
    const rooms = readRooms()
    const record = Object.values(rooms).find((room) => room.code === code.trim().toUpperCase())
    if (!record) throw new PlatformError('ROOM_NOT_FOUND', '没有找到这个房间号')
    if (record.phase !== 'lobby') throw new PlatformError('ROOM_NOT_JOINABLE', '这个房间已经开始了')

    const existing = record.members.find((member) => member.id === me.id)
    if (existing) {
      existing.online = true
      existing.nickname = me.nickname
      existing.avatar = me.avatar
      existing.mbti = me.mbti
      return save(record)
    }
    if (record.members.length >= record.maxPlayers) throw new PlatformError('ROOM_FULL', '房间人数已满')

    record.members.push({
      id: me.id,
      nickname: me.nickname,
      mbti: me.mbti,
      avatar: me.avatar,
      ready: false,
      online: true,
      seat: record.members.length + 1,
    })
    return save(record)
  }

  async leaveRoom(roomId: string): Promise<void> {
    const me = this.identity()
    const rooms = readRooms()
    const record = rooms[roomId]
    if (!record) return
    record.members = record.members.filter((member) => member.id !== me.id)
    if (record.members.length === 0) {
      delete rooms[roomId]
      writeRooms(rooms)
      emit(record)
      return
    }
    if (record.hostId === me.id) {
      const next = record.members.slice().sort((a, b) => a.seat - b.seat)[0]
      record.hostId = next.id
    }
    save(record)
  }

  async setReady(roomId: string, ready: boolean): Promise<void> {
    const me = this.identity()
    const record = load(roomId)
    const member = record.members.find((item) => item.id === me.id)
    if (!member) throw new PlatformError('NOT_A_MEMBER', '你不在这个房间里')
    member.ready = ready
    save(record)
  }

  async startGame(roomId: string, gameType: GameType): Promise<void> {
    const me = this.identity()
    const record = load(roomId)
    if (record.hostId !== me.id) throw new PlatformError('HOST_ONLY', '只有主持人可以开始游戏')
    if (record.phase !== 'lobby') throw new PlatformError('ROOM_NOT_JOINABLE', '这一局已经开始了')
    if (record.members.some((member) => !member.ready)) {
      throw new PlatformError('NOT_ALL_READY', '还有玩家没有准备')
    }
    record.gameType = gameType
    record.phase = 'playing'
    save(record)
  }

  async endGame(roomId: string): Promise<void> {
    const me = this.identity()
    const record = load(roomId)
    if (record.hostId !== me.id) throw new PlatformError('HOST_ONLY', '只有主持人可以结束游戏')
    record.phase = 'lobby'
    record.gameType = null
    record.members.forEach((member) => {
      member.ready = member.id === record.hostId
    })
    save(record)
  }

  async closeRoom(roomId: string): Promise<void> {
    const me = this.identity()
    const record = load(roomId)
    if (record.hostId !== me.id) throw new PlatformError('HOST_ONLY', '只有主持人可以关闭房间')
    const rooms = readRooms()
    delete rooms[roomId]
    writeRooms(rooms)
    record.phase = 'ended'
    emit(record)
  }

  async setTruth(roomId: string, turn: TruthTurn | null): Promise<void> {
    const record = load(roomId)
    record.truth = turn
    save(record)
  }

  async getRoom(roomId: string): Promise<Room> {
    return toRoom(load(roomId))
  }

  watch(roomId: string, onChange: (room: Room | null) => void): Unsubscribe {
    const set = listeners.get(roomId) ?? new Set()
    set.add(onChange)
    listeners.set(roomId, set)
    // 立即推一次，避免调用方要自己再拉一遍
    try {
      onChange(toRoom(load(roomId)))
    } catch {
      // 房间还不存在时忽略
    }
    return () => {
      set.delete(onChange)
      if (set.size === 0) listeners.delete(roomId)
    }
  }
}




