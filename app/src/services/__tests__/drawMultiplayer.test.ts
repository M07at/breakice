import { describe, expect, it } from 'vitest'
import { LocalDrawRoomBackend } from '../../modules/draw/room'
import { createDrawPublisher, createRemoteDrawRoom } from '../drawRemote'
import type { DrawAction, DrawActionKind, DrawRemoteApi } from '../drawRemote'
import type { AiScorer } from '../../modules/draw/ai'
import type { BankItem } from '../../modules/bank'
import type { AiScoreResult } from '../../modules/draw/types'

/**
 * 双端联调：主持人（本机权威后端 + 发布器）↔ 观战端（远程 backend），
 * 中间用内存版 DrawRemoteApi 模拟 0017 的会话与指令队列。
 *
 * 这样能在没有两台设备的情况下验证整条联机链路：
 * 视图发布、名单映射、代收交画、代发消息与归因。
 */

const DRAW_ITEMS: BankItem<'draw'>[] = [
  { id: 'd1', bankId: 'fake', tags: [], difficulty: 1, content: { word: '长颈鹿', hint: '动物', emoji: '🦒' } },
  { id: 'd2', bankId: 'fake', tags: [], difficulty: 1, content: { word: '大象', hint: '动物', emoji: '🐘' } },
]

const scorer: AiScorer = {
  async score(): Promise<AiScoreResult> {
    return { score: 80, dimensions: { composition: 80, creativity: 80, relevance: 80 }, comment: '' }
  },
}

const ROSTER = [
  { id: 'user-a', name: '甲' },
  { id: 'user-b', name: '乙' },
]

/** 一个共享的"服务端"：会话视图 + 指令队列，按用户身份造出各自的 API */
function hub() {
  let stored: { view: unknown; version: number } | null = null
  let queue: DrawAction[] = []
  let seq = 0

  function apiFor(userId: string): DrawRemoteApi {
    return {
      async publishView(_roomId, view) {
        stored = { view, version: (stored?.version ?? 0) + 1 }
        return stored.version
      },
      async readView() {
        if (!stored) return null
        return { view: stored.view as never, version: stored.version }
      },
      async postAction(_roomId, kind: DrawActionKind, payload = {}) {
        seq += 1
        queue.push({ id: seq, userId, kind, payload, createdAt: new Date().toISOString() })
        return seq
      },
      async takeActions() {
        const taken = queue
        queue = []
        return taken
      },
    }
  }

  return { apiFor }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('你画我猜双端联调', () => {
  it('主持人发布视图，观战端读到同一份名单', async () => {
    const { apiFor } = hub()
    const local = new LocalDrawRoomBackend({
      playerCount: ROSTER.length,
      players: ROSTER,
      meId: 'user-a',
      variant: 'classic',
      scorer,
      listItems: async () => DRAW_ITEMS,
    })
    await local.start()

    const publisher = createDrawPublisher({ roomId: 'r1', api: apiFor('user-a'), backend: local, publishMs: 10, pollMs: 10 })
    publisher.start()
    await wait(30)

    const follower = createRemoteDrawRoom({ roomId: 'r1', api: apiFor('user-b'), meId: 'user-b', pollMs: 20 })
    const view = await follower.view()

    expect(view.players.map((player) => player.id)).toEqual(['user-a', 'user-b'])
    expect(view.players.map((player) => player.name)).toEqual(['甲', '乙'])

    publisher.stop()
    follower.dispose()
    local.dispose()
  })

  it('观战端交画，主持人代收后画廊里出现这张画', async () => {
    const { apiFor } = hub()
    // 作画顺序是 players[0] 起：把观战端排在第一位，让它先画
    const painterFirst = [
      { id: 'user-b', name: '乙' },
      { id: 'user-a', name: '甲' },
    ]
    const local = new LocalDrawRoomBackend({
      playerCount: painterFirst.length,
      players: painterFirst,
      meId: 'user-a',
      variant: 'classic',
      scorer,
      listItems: async () => DRAW_ITEMS,
    })
    await local.start()

    const publisher = createDrawPublisher({ roomId: 'r1', api: apiFor('user-a'), backend: local, publishMs: 10, pollMs: 10 })
    publisher.start()
    await wait(30)

    const follower = createRemoteDrawRoom({ roomId: 'r1', api: apiFor('user-b'), meId: 'user-b', pollMs: 20 })
    const initial = await follower.view()
    expect(initial.painterId).toBe('user-b')

    // 轮到自己时交画，主持人应当代收
    await follower.submitDrawing('room/draw/1/painter.png')
    await wait(60)

    const after = await follower.view()
    const entry = after.panel.find((row) => row.playerId === 'user-b')
    expect(entry?.imageRef).toBe('room/draw/1/painter.png')
    expect(after.phase).toBe('reveal')

    publisher.stop()
    follower.dispose()
    local.dispose()
  })

  it('观战端发言会被记在它自己名下，不是主持人', async () => {
    const { apiFor } = hub()
    const local = new LocalDrawRoomBackend({
      playerCount: ROSTER.length,
      players: ROSTER,
      meId: 'user-a',
      variant: 'classic',
      scorer,
      listItems: async () => DRAW_ITEMS,
    })
    await local.start()

    const publisher = createDrawPublisher({ roomId: 'r1', api: apiFor('user-a'), backend: local, publishMs: 10, pollMs: 10 })
    publisher.start()
    await wait(30)

    const follower = createRemoteDrawRoom({ roomId: 'r1', api: apiFor('user-b'), meId: 'user-b', pollMs: 20 })
    await follower.view()
    await follower.sendMessage('是长颈鹿吧')
    // 只看主持人的权威视图，避免受发布/轮询时序影响
    await wait(60)
    const host = await local.view()
    const mine = host.messages.filter((message) => message.playerId === 'user-b')
    expect(mine.length).toBeGreaterThan(0)
    expect(mine[0].playerName).toBe('乙')

    publisher.stop()
    follower.dispose()
    local.dispose()
  })
})


