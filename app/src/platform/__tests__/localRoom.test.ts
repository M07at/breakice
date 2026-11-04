import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LocalRoomApi } from '../local'

/**
 * 本机房间的规则验证：房间是游戏单位，必须所有人都准备好主持人才开得了局。
 * 这里用一个内存版 uni 存储模拟「换一台设备」，验证加入 / 准备 / 开局 / 移交。
 */

const storage = new Map<string, unknown>()

beforeAll(() => {
  ;(globalThis as unknown as { uni: unknown }).uni = {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => void storage.set(key, value),
    removeStorageSync: (key: string) => void storage.delete(key),
  }
})

function useDevice(id: string, nickname: string) {
  storage.set('break-ice-device-id-v1', id)
  // uni.getStorageSync 会把对象原样返回，这里也存对象
  storage.set('break-ice-profile-v2', { nickname, avatar: { color: 1, body: 1, mouth: 1, eyes: 1, hat: 1 } })
}

const api = new LocalRoomApi()

beforeEach(() => {
  storage.clear()
})

describe('本机房间', () => {
  it('创建房间：房主坐 1 号位并且默认已准备', async () => {
    useDevice('dev-host', '主持人')
    const room = await api.createRoom({ title: '测试房', maxPlayers: 8 })
    expect(room.players).toHaveLength(1)
    expect(room.hostId).toBe('dev-host')
    expect(room.players[0].isHost).toBe(true)
    expect(room.players[0].isReady).toBe(true)
    expect(room.code).toMatch(/^[A-Z0-9]{6}$/)
    expect(room.phase).toBe('lobby')
  })

  it('第二台设备可以用房间号加入，座位按顺序排', async () => {
    useDevice('dev-host', '主持人')
    const created = await api.createRoom({ title: '测试房', maxPlayers: 8 })

    useDevice('dev-guest', '小明')
    const joined = await api.joinRoom(created.code)
    expect(joined.players.map((player) => player.nickname)).toEqual(['主持人', '小明'])
    expect(joined.players[1].isHost).toBe(false)
    expect(joined.players[1].isReady).toBe(false)
  })

  it('有人没准备时主持人不可以开局，准备后可以', async () => {
    useDevice('dev-host', '主持人')
    const created = await api.createRoom({ title: '测试房', maxPlayers: 8 })
    useDevice('dev-guest', '小明')
    await api.joinRoom(created.code)

    useDevice('dev-host', '主持人')
    await expect(api.startGame(created.id, 'undercover')).rejects.toMatchObject({ code: 'NOT_ALL_READY' })

    useDevice('dev-guest', '小明')
    await api.setReady(created.id, true)

    useDevice('dev-host', '主持人')
    await api.startGame(created.id, 'undercover')
    const after = await api.getRoom(created.id)
    expect(after.phase).toBe('playing')
    expect(after.gameType).toBe('undercover')
  })

  it('非主持人不能开局，也不能结束本局', async () => {
    useDevice('dev-host', '主持人')
    const created = await api.createRoom({ title: '测试房', maxPlayers: 8 })
    useDevice('dev-guest', '小明')
    await api.joinRoom(created.code)
    await api.setReady(created.id, true)

    await expect(api.startGame(created.id, 'drawing')).rejects.toMatchObject({ code: 'HOST_ONLY' })
    await expect(api.endGame(created.id)).rejects.toMatchObject({ code: 'HOST_ONLY' })
  })

  it('结束本局后房间回到大厅，准备状态重置（房主保持已准备）', async () => {
    useDevice('dev-host', '主持人')
    const created = await api.createRoom({ title: '测试房', maxPlayers: 8 })
    useDevice('dev-guest', '小明')
    await api.joinRoom(created.code)
    await api.setReady(created.id, true)

    useDevice('dev-host', '主持人')
    await api.startGame(created.id, 'hybrid')
    await api.endGame(created.id)

    const room = await api.getRoom(created.id)
    expect(room.phase).toBe('lobby')
    expect(room.gameType).toBeNull()
    expect(room.players.map((player) => [player.nickname, player.isReady])).toEqual([
      ['主持人', true],
      ['小明', false],
    ])
  })

  it('房主离开后房主身份移交给下一位', async () => {
    useDevice('dev-host', '主持人')
    const created = await api.createRoom({ title: '测试房', maxPlayers: 8 })
    useDevice('dev-guest', '小明')
    await api.joinRoom(created.code)

    useDevice('dev-host', '主持人')
    await api.leaveRoom(created.id)

    const room = await api.getRoom(created.id)
    expect(room.players).toHaveLength(1)
    expect(room.hostId).toBe('dev-guest')
    expect(room.players[0].isHost).toBe(true)
  })

  it('房间号不存在时给出可读错误', async () => {
    useDevice('dev-guest', '小明')
    await expect(api.joinRoom('ZZZZZZ')).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' })
  })

  it('房间变化会推送给订阅者', async () => {
    useDevice('dev-host', '主持人')
    const created = await api.createRoom({ title: '测试房', maxPlayers: 8 })
    const seen: string[] = []
    const stop = api.watch(created.id, (room) => seen.push(`${room.phase}:${room.players.length}`))
    expect(seen.at(-1)).toBe('lobby:1')

    useDevice('dev-guest', '小明')
    await api.joinRoom(created.code)
    expect(seen.at(-1)).toBe('lobby:2')
    stop()
  })
})
