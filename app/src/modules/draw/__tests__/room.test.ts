import { describe, expect, it } from 'vitest'
import { DRAW_SECONDS, LocalDrawRoomBackend, maskAnswer } from '../room'
import type { AiScorer } from '../ai'
import type { BankItem } from '../../bank'
import type { AiScoreResult } from '../types'

/** 假题库：房间不再依赖真实的系统题库，单测也就不会去碰本地存储/共享题库 */
const DRAW_ITEMS: BankItem<'draw'>[] = [
  { id: 'd1', bankId: 'fake', tags: [], difficulty: 1, content: { word: '长颈鹿', hint: '动物', emoji: '🦒' } },
  { id: 'd2', bankId: 'fake', tags: [], difficulty: 1, content: { word: '大象', hint: '动物', emoji: '🐘' } },
  { id: 'd3', bankId: 'fake', tags: [], difficulty: 2, content: { word: '红绿灯', hint: '物品' } },
]

const listItems = async () => DRAW_ITEMS

/** 假评分器：固定给 80 分，不联网 */
const scorer: AiScorer = {
  async score(): Promise<AiScoreResult> {
    return {
      score: 80,
      dimensions: { composition: 80, creativity: 80, relevance: 80 },
      comment: '',
    }
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

async function newRoom(playerCount: number) {
  const c = clock()
  const room = new LocalDrawRoomBackend({
    playerCount,
    variant: 'classic',
    scorer,
    now: c.now,
    listItems,
  })
  await room.start()
  return { room, clock: c }
}

/** 揭晓 8 秒走完，换下一位 */
async function skipReveal(room: LocalDrawRoomBackend, c: ReturnType<typeof clock>) {
  c.advance(8_100)
  return room.tick()
}

describe('你画我猜的房间', () => {
  it('题面只发给当前作画者，别人拿不到', async () => {
    const { room, clock: c } = await newRoom(3)
    const first = await room.view()
    // 第一位就是「我」，所以能拿到词
    expect(first.painterId).toBe(room.meId)
    expect(first.word).not.toBeNull()
    // 提示是公开的：字数和类别人人可见
    expect(first.hint?.chars).toBeGreaterThan(0)

    await room.submitDrawing('mine.png')
    await skipReveal(room, c)

    const second = await room.view()
    // 轮到下一位，这台设备不是作画者，词必须为 null
    expect(second.painterId).not.toBe(room.meId)
    expect(second.word).toBeNull()
    expect(second.palette).toEqual([])
    // 但提示还在，不然猜的人没得看
    expect(second.hint?.chars).toBeGreaterThan(0)
  })

  it('画完先进揭晓，这段时间不换人；揭晓结束才轮到下一位', async () => {
    const { room } = await newRoom(2)
    await room.submitDrawing('mine.png')

    const reveal = await room.view()
    expect(reveal.phase).toBe('reveal')
    // 揭晓时还是刚才那位，没换人
    expect(reveal.painterId).toBe(room.meId)
    // 面板只有这一张
    expect(reveal.panel).toHaveLength(1)
    expect(reveal.panel[0].playerId).toBe(room.meId)
  })

  it('别人那一轮到点自动过，最后所有画完就结算出排名', async () => {
    const { room, clock: c } = await newRoom(2)
    await room.submitDrawing('mine.png')
    await skipReveal(room, c)

    const second = await room.view()
    expect(second.phase).toBe('drawing')
    expect(second.painterId).not.toBe(room.meId)

    // 第二位（别人）不在这台手机上，到点进入揭晓（没交画也揭晓）
    c.advance(91_000)
    const reveal2 = await room.tick()
    expect(reveal2.phase).toBe('reveal')

    // 揭晓结束 → 全部画完
    c.advance(8_100)
    const ended = await room.tick()
    expect(ended.phase).toBe('ended')
    expect(ended.ranking.length).toBeGreaterThan(0)
    expect(ended.ranking[0].playerId).toBe(room.meId)
    expect(ended.ranking[0].total).toBeGreaterThan(0)
  })

  it('每轮都有自己的开始时间，换人后重新计时（提示按它算 30 秒）', async () => {
    const { room, clock: c } = await newRoom(2)
    const first = await room.view()
    expect(first.startedAt).toBeGreaterThan(0)
    expect(first.endsAt - first.startedAt).toBe(DRAW_SECONDS * 1000)

    c.advance(30_000)
    await room.submitDrawing('mine.png')
    await skipReveal(room, c)

    const second = await room.view()
    // 第二轮的起点必须比第一轮晚，而且是重新算的整整一轮
    expect(second.startedAt).toBeGreaterThan(first.startedAt)
    expect(second.endsAt - second.startedAt).toBe(DRAW_SECONDS * 1000)
  })

  it('不是自己的回合交画会被拒绝', async () => {
    const { room, clock: c } = await newRoom(2)
    await room.submitDrawing('mine.png')
    await skipReveal(room, c)
    await expect(room.submitDrawing('again.png')).rejects.toThrow('现在不是你画')
  })
})

describe('公开答案面板', () => {
  it('到点一张也没交，揭晓时也照样给出答案', async () => {
    const { room, clock: c } = await newRoom(2)
    const word = (await room.view()).word?.word ?? ''
    expect(word).not.toBe('')

    // 完全不动，直接到点
    c.advance(91_000)
    const reveal = await room.tick()

    expect(reveal.phase).toBe('reveal')
    expect(reveal.panel).toHaveLength(1)
    // 没交画：没有图，但答案必须给出来
    expect(reveal.panel[0].imageRef).toBe('')
    expect(reveal.panel[0].answer).toBe(word)
  })

  it('还没人猜对时 allGuessed 是 false', async () => {
    const { room } = await newRoom(2)
    expect((await room.view()).allGuessed).toBe(false)
  })

  it('进行中不外泄；每画完一张弹一次（只有这一张）；结算后汇总所有人', async () => {
    const { room, clock: c } = await newRoom(2)
    const word = (await room.view()).word?.word ?? ''

    // 还在画：面板空，答案不外泄
    expect((await room.view()).panel).toEqual([])

    await room.submitDrawing('mine.png')
    // 揭晓：只有我这一张
    const reveal = await room.view()
    expect(reveal.panel).toHaveLength(1)
    expect(reveal.panel[0].answer).toBe(word)
    expect(reveal.panel[0].imageRef).toBe('mine.png')

    // 弹窗里可以送花 / 点差评
    const flowered = await room.sendReaction(room.meId, 'flower')
    expect(flowered.panel[0].flowers).toBe(1)
    const snowed = await room.sendReaction(room.meId, 'dislike')
    expect(snowed.panel[0].dislikes).toBe(1)

    // 揭晓 → 下一位到点 → 揭晓 → 结束
    await skipReveal(room, c)
    c.advance(91_000)
    await room.tick()
    c.advance(8_100)
    const ended = await room.tick()

    expect(ended.phase).toBe('ended')
    // 汇总：两人各一行（没交画的那行是空的）
    expect(ended.panel).toHaveLength(2)
    expect(ended.panel.find((e) => e.playerId === room.meId)?.answer).toBe(word)
  })
})

describe('聊天 / 抢答', () => {
  it('答案里的字会被冰块替换', () => {
    expect(maskAnswer('是长颈鹿吧', '长颈鹿')).toBe('是🧊🧊🧊吧')
    expect(maskAnswer('不知道', '长颈鹿')).toBe('不知道')
    expect(maskAnswer('随便说说', '')).toBe('随便说说')
  })

  it('自己画的时候把答案打在聊天里，只会被遮住、不算抢答', async () => {
    const { room } = await newRoom(2)
    const word = (await room.view()).word?.word ?? ''
    expect(word).not.toBe('')

    const next = await room.sendMessage(`答案是${word}`)
    const last = next.messages[next.messages.length - 1]
    expect(last.kind).toBe('chat')
    expect(last.text).not.toContain(word)
    expect(last.text).toContain('🧊')
  })
})
