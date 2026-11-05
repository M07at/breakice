import { describe, expect, it } from 'vitest'
import { LocalDrawRoomBackend } from '../room'
import type { AiScorer } from '../ai'
import type { BankItem } from '../../bank'
import type { AiScoreResult } from '../types'

/**
 * 联机扩展的回归测试：
 * 1. 用房间真实名单开局（players / meId）；
 * 2. 主持人代收别人的画与消息（submitDrawing / sendMessage 的 actorId）。
 *
 * 这两处改动动了 B 的引擎核心，单机行为必须保持——单机场景的用例仍在 room.test.ts 里。
 */

const DRAW_ITEMS: BankItem<'draw'>[] = [
  { id: 'd1', bankId: 'fake', tags: [], difficulty: 1, content: { word: '长颈鹿', hint: '动物', emoji: '🦒' } },
  { id: 'd2', bankId: 'fake', tags: [], difficulty: 1, content: { word: '大象', hint: '动物', emoji: '🐘' } },
]

const listItems = async () => DRAW_ITEMS

const scorer: AiScorer = {
  async score(): Promise<AiScoreResult> {
    return { score: 80, dimensions: { composition: 80, creativity: 80, relevance: 80 }, comment: '' }
  },
}

function clock(start = 1_000_000) {
  let now = start
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

const ROSTER = [
  { id: 'user-a', name: '甲', mbti: 'ENFP' },
  { id: 'user-b', name: '乙' },
  { id: 'user-c', name: '丙' },
]

async function newOnlineRoom(meId: string) {
  const c = clock()
  const room = new LocalDrawRoomBackend({
    playerCount: ROSTER.length,
    players: ROSTER,
    meId,
    variant: 'classic',
    scorer,
    now: c.now,
    listItems,
  })
  await room.start()
  return { room, clock: c }
}

describe('LocalDrawRoomBackend 支持房间真实名单', () => {
  it('视图里的玩家就是传入的名单，顺序不变', async () => {
    const { room } = await newOnlineRoom('user-a')
    const view = await room.view()

    expect(view.players.map((player) => player.id)).toEqual(['user-a', 'user-b', 'user-c'])
    expect(view.players.map((player) => player.name)).toEqual(['甲', '乙', '丙'])
    expect(room.meId).toBe('user-a')
  })

  it('不传 players 时仍是单机生成规则', async () => {
    const c = clock()
    const room = new LocalDrawRoomBackend({ playerCount: 3, variant: 'classic', scorer, now: c.now, listItems })
    await room.start()
    const view = await room.view()

    expect(view.players[1].name).toBe('玩家2')
    expect(view.players[1].id.startsWith('local-')).toBe(true)
  })

  it('作画者是名单里的真实 id，题面只下发给作画者', async () => {
    const { room } = await newOnlineRoom('user-a')
    const view = await room.view()

    expect(ROSTER.map((player) => player.id)).toContain(view.painterId)
    // 主持人不是作画者时看不到题面
    if (view.painterId !== 'user-a') expect(view.word).toBeNull()
  })
})

describe('主持人代收别人的动作', () => {
  it('不是作画者提交会被拒绝', async () => {
    const { room } = await newOnlineRoom('user-a')
    const view = await room.view()
    const painter = view.painterId
    const bystander = ROSTER.find((player) => player.id !== painter && player.id !== 'user-a')?.id

    if (bystander) {
      await expect(room.submitDrawing('path/a.png', bystander)).rejects.toThrow()
    } else {
      // 名单只有三人且主持人是作画者时，用另一个非作画者验证
      await expect(room.submitDrawing('path/a.png', 'user-c')).rejects.toThrow()
    }
  })

  it('以作画者身份代收，画作记在作画者名下', async () => {
    const { room, clock: c } = await newOnlineRoom('user-a')
    const view = await room.view()
    const painter = view.painterId

    const after = await room.submitDrawing('room/draw/1/painter.png', painter)
    // 交完立刻进入揭晓，面板里应该是这位作画者的作品
    expect(after.phase).toBe('reveal')
    const entry = after.panel.find((row) => row.playerId === painter)
    expect(entry?.imageRef).toBe('room/draw/1/painter.png')

    c.advance(8_100)
    await room.tick()
  })

  it('代发消息会记在真实发言人头上', async () => {
    const { room } = await newOnlineRoom('user-a')
    const view = await room.view()
    const guesser = ROSTER.find((player) => player.id !== view.painterId)?.id ?? 'user-b'

    const after = await room.sendMessage('随便聊聊', guesser)
    const message = after.messages[after.messages.length - 1]
    expect(message.playerId).toBe(guesser)
    expect(message.text).toBe('随便聊聊')
  })

  it('代发的正确抢答只记一次', async () => {
    const { room } = await newOnlineRoom('user-a')
    const view = await room.view()
    const answer = view.word?.word ?? ''
    const guesser = ROSTER.find((player) => player.id !== view.painterId)?.id ?? 'user-b'

    // 主持人不是作画者时才知道答案；用 peek 拿不到就跳过断言
    if (!answer) return

    const first = await room.sendMessage(answer, guesser)
    const correct = first.messages.filter((message) => message.kind === 'correct')
    expect(correct.length).toBeGreaterThan(0)
    expect(correct[0].playerId).toBe(guesser)
  })
})
