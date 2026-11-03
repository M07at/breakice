import { describe, expect, it } from 'vitest'
import { DrawEngine, countPoints, replay, toCanvasPoint, toNormalizedPoint } from '../engine'
import { DrawError } from '../errors'
import { HttpAiScorer, normalizeAiScore } from '../ai'
import { EMOJI_POOL, pickEmojiPalette } from '../words'
import { createRng } from '../../shared/random'
import type { DrawChunk, Point } from '../types'

/** 固定时钟，测试里手动推进 */
function fakeClock(start = 1_000_000) {
  let now = start
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

let idCounter = 0
function engine(by = 'p1', config: Record<string, number> = {}) {
  const clock = fakeClock()
  const e = new DrawEngine({
    by,
    config,
    now: clock.now,
    newChunkId: () => `chunk-${++idCounter}`,
  })
  return { e, clock }
}

const p = (x: number, y: number): Point => ({ x, y })

describe('坐标归一化', () => {
  it('按显示尺寸换算成 0–1000 的整数', () => {
    expect(toNormalizedPoint(0, 0, 400, 300)).toEqual({ x: 0, y: 0 })
    expect(toNormalizedPoint(200, 150, 400, 300)).toEqual({ x: 500, y: 500 })
    expect(toNormalizedPoint(400, 300, 400, 300)).toEqual({ x: 1000, y: 1000 })
  })

  it('超出手指范围的坐标被 clamp，不会画出画布', () => {
    expect(toNormalizedPoint(-50, 999, 400, 300)).toEqual({ x: 0, y: 1000 })
  })

  it('换回逻辑画布像素时按 800×600 还原', () => {
    expect(toCanvasPoint({ x: 500, y: 500 })).toEqual({ x: 400, y: 300 })
    expect(toCanvasPoint({ x: 1000, y: 1000 })).toEqual({ x: 800, y: 600 })
  })

  it('画布尺寸还没拿到时明确报错', () => {
    expect(() => toNormalizedPoint(1, 1, 0, 0)).toThrow(DrawError)
  })
})

describe('画一笔', () => {
  it('落笔、移动、抬手之后操作流里只有一条笔画', () => {
    const { e } = engine()
    e.beginStroke(p(100, 100), { color: '#000', width: 4 })
    e.extendStroke(p(120, 120))
    e.extendStroke(p(140, 160))
    const stroke = e.endStroke()

    expect(stroke?.points).toHaveLength(3)
    expect(e.snapshot()).toHaveLength(1)
    expect(e.drawing).toBe(false)
  })

  it('原地重复的点被丢掉，省流量', () => {
    const { e } = engine()
    e.beginStroke(p(100, 100), { color: '#000', width: 4 })
    expect(e.extendStroke(p(120, 120))).toBe(true)
    expect(e.extendStroke(p(120, 120))).toBe(false)
    e.endStroke()
    expect(e.visible()[0]).toMatchObject({ kind: 'stroke' })
    expect(countPoints(e.snapshot())).toBe(2)
  })

  it('抬手事件晚到、没有落笔时，extendStroke 不抛错', () => {
    const { e } = engine()
    expect(e.extendStroke(p(10, 10))).toBe(false)
  })

  it('落笔前先结束上一笔，不会把两条线焊在一起', () => {
    const { e } = engine()
    e.beginStroke(p(10, 10), { color: '#000', width: 4 })
    e.extendStroke(p(20, 20))
    e.beginStroke(p(300, 300), { color: '#f00', width: 8 })
    e.endStroke()
    expect(e.snapshot()).toHaveLength(2)
  })

  it('单条笔画超过上限后不再收点', () => {
    const { e } = engine('p1', { maxPointsPerStroke: 3 })
    e.beginStroke(p(0, 0), { color: '#000', width: 4 })
    e.extendStroke(p(1, 1))
    e.extendStroke(p(2, 2))
    expect(e.extendStroke(p(3, 3))).toBe(false)
    e.endStroke()
    expect(countPoints(e.snapshot())).toBe(3)
  })
})

describe('撤销 / 重做 / 清空', () => {
  function twoStrokes() {
    const { e, clock } = engine()
    e.beginStroke(p(10, 10), { color: '#000', width: 4 })
    e.extendStroke(p(20, 20))
    e.endStroke()
    e.beginStroke(p(100, 100), { color: '#f00', width: 4 })
    e.extendStroke(p(120, 120))
    e.endStroke()
    return { e, clock }
  }

  it('撤销删掉最上面那一笔，重做把它加回来（换新 seq）', () => {
    const { e } = twoStrokes()
    expect(e.visible()).toHaveLength(2)
    const target = e.undo()
    expect(e.visible()).toHaveLength(1)
    expect(e.canRedo).toBe(true)

    const again = e.redo()
    expect(again).not.toBe(target)
    expect(e.visible()).toHaveLength(2)
  })

  it('没东西可撤时返回 null，不会破坏状态', () => {
    const { e } = engine()
    expect(e.undo()).toBeNull()
    expect(e.canUndo).toBe(false)
    expect(e.canRedo).toBe(false)
  })

  it('撤销之后重新画，重做栈作废', () => {
    const { e } = twoStrokes()
    e.undo()
    e.beginStroke(p(50, 50), { color: '#0a0', width: 4 })
    e.endStroke()
    expect(e.canRedo).toBe(false)
  })

  it('清空之后画面为空，但清空本身也进了操作流（要发出去）', () => {
    const { e } = twoStrokes()
    e.clear()
    expect(e.visible()).toHaveLength(0)
    expect(e.snapshot().at(-1)?.kind).toBe('clear')
  })
})

describe('Emoji 版', () => {
  it('贴上去的 emoji 出现在画面上', () => {
    const { e } = engine()
    const seq = e.placeEmoji('🐱', p(500, 500))
    const item = e.visible()[0]
    expect(item).toMatchObject({ kind: 'emoji', emoji: '🐱', seq })
  })

  it('拖动 / 缩放只在抬手时发一条更新，不是一路跟着发', () => {
    const { e } = engine()
    const seq = e.placeEmoji('🐱', p(500, 500))
    const before = e.snapshot().length
    e.updateEmoji(seq, { x: 700, y: 300, size: 160, rotate: -90 })
    e.updateEmoji(seq, { rotate: 30 })
    expect(e.snapshot().length).toBe(before + 2)
    expect(e.visible()[0]).toMatchObject({ x: 700, y: 300, size: 160, rotate: 30 })
  })

  it('旋转角度会归一化到 0–360', () => {
    const { e } = engine()
    const seq = e.placeEmoji('🐱', p(1, 1))
    e.updateEmoji(seq, { rotate: -90 })
    expect((e.visible()[0] as { rotate: number }).rotate).toBe(270)
  })

  it('贴纸超过上限时报 EMOJI_LIMIT', () => {
    const { e } = engine('p1', { maxEmoji: 2 })
    e.placeEmoji('🐱', p(1, 1))
    e.placeEmoji('🐶', p(2, 2))
    expect(() => e.placeEmoji('🐰', p(3, 3))).toThrow(DrawError)
  })
})

describe('分片聚合（约束 C-06 的对策）', () => {
  it('没到 5 秒不出片', () => {
    const { e, clock } = engine()
    e.beginStroke(p(10, 10), { color: '#000', width: 4 })
    e.endStroke()
    clock.advance(1_000)
    expect(e.takeChunk()).toBeNull()
    expect(e.hasPending).toBe(true)
  })

  it('到 5 秒出一个分片，出完就空了', () => {
    const { e, clock } = engine()
    e.beginStroke(p(10, 10), { color: '#000', width: 4 })
    e.extendStroke(p(20, 20))
    e.endStroke()
    clock.advance(5_000)
    const chunk = e.takeChunk()
    expect(chunk?.ops).toHaveLength(1)
    expect(chunk?.by).toBe('p1')
    expect(chunk?.seqTo).toBe(1)
    expect(e.takeChunk()).toBeNull()
  })

  it('操作条数够了立刻出片，不用等满 5 秒', () => {
    const { e, clock } = engine('p1', { maxOpsPerChunk: 2 })
    for (let i = 0; i < 2; i++) {
      e.beginStroke(p(i * 10, 10), { color: '#000', width: 4 })
      e.endStroke()
    }
    clock.advance(100)
    expect(e.takeChunk()).not.toBeNull()
  })

  it('画到一半的笔画不进分片，抬手后才进下一片', () => {
    const { e, clock } = engine()
    e.beginStroke(p(10, 10), { color: '#000', width: 4 })
    e.extendStroke(p(20, 20))
    clock.advance(5_000)
    expect(e.takeChunk()).toBeNull()
    e.endStroke()
    expect(e.takeChunk(clock.now(), true)).not.toBeNull()
  })

  it('提交时强制出片把所有待发的都发完', () => {
    const { e } = engine()
    for (let i = 0; i < 3; i++) {
      e.beginStroke(p(i, i), { color: '#000', width: 4 })
      e.endStroke()
    }
    expect(e.takeChunk(0, true)?.ops).toHaveLength(3)
    expect(e.takeChunk(0, true)).toBeNull()
  })
})

describe('接收远端分片', () => {
  function chunkOf(ops: DrawChunk['ops'], by = 'p1', chunkId = 'c1'): DrawChunk {
    return { chunkId, by, ops, seqTo: ops[ops.length - 1]?.seq ?? 0, at: 0 }
  }

  it('别人画的分片能重放出同样的画面', () => {
    const { e: painter } = engine('p1')
    painter.beginStroke(p(100, 100), { color: '#000', width: 4 })
    painter.extendStroke(p(200, 200))
    painter.endStroke()
    const chunk = painter.takeChunk(0, true) as DrawChunk

    const { e: viewer } = engine('viewer')
    expect(viewer.applyChunk(chunk)).toBe(1)
    expect(viewer.visible()).toHaveLength(1)
  })

  it('同一条分片推来两次只应用一次', () => {
    const { e: painter } = engine('p1')
    painter.beginStroke(p(1, 1), { color: '#000', width: 4 })
    painter.endStroke()
    const chunk = painter.takeChunk(0, true) as DrawChunk

    const { e: viewer } = engine('viewer')
    viewer.applyChunk(chunk)
    expect(viewer.applyChunk(chunk)).toBe(0)
  })

  it('迟到的旧分片被丢掉，画面不会回退', () => {
    const { e: painter } = engine('p1')
    painter.beginStroke(p(1, 1), { color: '#000', width: 4 })
    painter.endStroke()
    const first = painter.takeChunk(0, true) as DrawChunk
    painter.beginStroke(p(2, 2), { color: '#000', width: 4 })
    painter.endStroke()
    const second = painter.takeChunk(0, true) as DrawChunk

    const { e: viewer } = engine('viewer')
    viewer.applyChunk(second)
    expect(viewer.applyChunk(first)).toBe(0)
    expect(viewer.visible()).toHaveLength(1)
  })

  it('自己发出去的分片被频道回显时不再画一遍', () => {
    const { e } = engine('p1')
    e.beginStroke(p(1, 1), { color: '#000', width: 4 })
    e.endStroke()
    const chunk = e.takeChunk(0, true) as DrawChunk
    expect(e.applyChunk(chunk)).toBe(0)
    expect(e.visible()).toHaveLength(1)
  })

  it('多片分片按顺序拼成完整画面（含撤销）', () => {
    const { e: painter } = engine('p1')
    painter.beginStroke(p(10, 10), { color: '#000', width: 4 })
    painter.endStroke()
    const c1 = painter.takeChunk(0, true) as DrawChunk
    painter.undo()
    const c2 = painter.takeChunk(0, true) as DrawChunk

    const { e: viewer } = engine('viewer')
    viewer.applyChunk(c1)
    viewer.applyChunk(c2)
    expect(viewer.visible()).toHaveLength(0)
  })

  it('换回合 reset 之后 seq 继续递增，观看端不会把新操作全丢掉', () => {
    const { e: painter } = engine('p1')
    painter.beginStroke(p(1, 1), { color: '#000', width: 4 })
    painter.endStroke()
    const first = painter.takeChunk(0, true) as DrawChunk

    const { e: viewer } = engine('viewer')
    viewer.applyChunk(first)

    painter.reset()
    painter.beginStroke(p(2, 2), { color: '#000', width: 4 })
    painter.endStroke()
    const second = painter.takeChunk(0, true) as DrawChunk

    expect(second.seqTo).toBeGreaterThan(first.seqTo)
    expect(viewer.applyChunk(second)).toBe(1)
  })
})

describe('断线重连', () => {
  it('快照整体替换本地画面，不做增量合并', () => {
    const { e } = engine('viewer')
    e.loadSnapshot([
      { kind: 'stroke', seq: 5, color: '#000', width: 4, points: [p(1, 1), p(2, 2)] },
    ])
    expect(e.visible()).toHaveLength(1)
    // seq 跟着快照走，之后的远端分片才不会被误判成旧的
    e.loadSnapshot([])
    expect(e.stats().seq).toBe(5)
  })

  it('快照能完整往返（画 → 存 → 恢复 → 一样）', () => {
    const { e: painter } = engine('p1')
    painter.beginStroke(p(10, 10), { color: '#000', width: 4 })
    painter.extendStroke(p(30, 40))
    painter.endStroke()
    painter.placeEmoji('🐱', p(500, 500))
    const snapshot = painter.snapshot()

    const { e: restored } = engine('viewer')
    restored.loadSnapshot(snapshot)
    expect(restored.visible()).toEqual(painter.visible())
  })
})

describe('replay 纯函数', () => {
  it('emoji-update 找不到目标时忽略，不抛错', () => {
    const items = replay([{ kind: 'emoji-update', seq: 2, target: 99, x: 1 }])
    expect(items).toHaveLength(0)
  })

  it('clear 之后画面上什么都没有', () => {
    const items = replay([
      { kind: 'stroke', seq: 1, color: '#000', width: 4, points: [p(1, 1), p(2, 2)] },
      { kind: 'clear', seq: 2 },
    ])
    expect(items).toHaveLength(0)
  })
})

describe('AI 评分解析（A 的服务端返回什么都得能吃下）', () => {
  it('标准形状直接通过', () => {
    const r = normalizeAiScore({
      score: 82,
      dimensions: { composition: 80, creativity: 90, relevance: 76 },
      comment: '画得不错',
    })
    expect(r).toMatchObject({ score: 82, comment: '画得不错', degraded: false })
    expect(r.dimensions).toEqual({ composition: 80, creativity: 90, relevance: 76 })
  })

  it('字段换了名字也能解析（total / dims / review）', () => {
    const r = normalizeAiScore({ total: '78', dims: { 构图: 70, 创意: 80, 契合度: 84 }, review: '还行' })
    expect(r.score).toBe(78)
    expect(r.dimensions).toEqual({ composition: 70, creativity: 80, relevance: 84 })
    expect(r.comment).toBe('还行')
  })

  it('包了一层 data 也能解析', () => {
    const r = normalizeAiScore({ data: { score: 66, dimensions: { composition: 60, creativity: 70, relevance: 68 } } })
    expect(r.score).toBe(66)
  })

  it('只有分项没给总分时，用分项平均补', () => {
    const r = normalizeAiScore({ dimensions: { composition: 60, creativity: 70, relevance: 80 } })
    expect(r.score).toBe(70)
  })

  it('超范围的分被压到 0–100', () => {
    const r = normalizeAiScore({ score: 130, dimensions: { composition: -5, creativity: 200, relevance: 50 } })
    expect(r.score).toBe(100)
    expect(r.dimensions).toEqual({ composition: 0, creativity: 100, relevance: 50 })
  })

  it('解析不了就明确失败，不把原始文本塞进界面', () => {
    expect(() => normalizeAiScore('AI 说：画得挺好')).toThrow(DrawError)
    expect(() => normalizeAiScore({ comment: '没有分' })).toThrow(DrawError)
  })

  it('服务端标记降级时如实反映', () => {
    expect(normalizeAiScore({ ok: false, score: 0 }).degraded).toBe(true)
  })
})

describe('真评分器（调 A 的接口）', () => {
  it('把契约里那三个字段发给服务端，返回解析好的结果', async () => {
    let seenUrl = ''
    let seenBody: Record<string, unknown> | null = null
    const scorer = new HttpAiScorer({
      endpoint: 'https://example.supabase.co/functions/v1/ai-score',
      transport: {
        post: async (url, body) => {
          seenUrl = url
          seenBody = body
          return { score: 77, dimensions: { composition: 70, creativity: 80, relevance: 82 }, comment: '不错' }
        },
      },
    })

    const result = await scorer.score({ imageRef: 'room/1/r1.png', word: '猫', roundKey: 'r1' })

    expect(seenUrl).toContain('ai-score')
    expect(seenBody).toEqual({ imageRef: 'room/1/r1.png', word: '猫', roundKey: 'r1' })
    expect(result).toMatchObject({ score: 77, comment: '不错', degraded: false })
    expect(result.dimensions).toEqual({ composition: 70, creativity: 80, relevance: 82 })
  })

  it('没有 roundKey 时不往请求体里塞空字段', async () => {
    let seenBody: Record<string, unknown> = {}
    const scorer = new HttpAiScorer({
      endpoint: 'x',
      transport: {
        post: async (_url, body) => {
          seenBody = body
          return { score: 50, dimensions: { composition: 50, creativity: 50, relevance: 50 } }
        },
      },
    })
    await scorer.score({ imageRef: 'a.png', word: '狗' })
    expect('roundKey' in seenBody).toBe(false)
  })

  it('服务端返回垃圾就抛 BAD_SCORE，交给调用方降级', async () => {
    const scorer = new HttpAiScorer({
      endpoint: 'x',
      transport: { post: async () => 'AI 说：画得挺好' },
    })
    await expect(scorer.score({ imageRef: 'a.png', word: '狗' })).rejects.toThrow(DrawError)
  })

  it('transport 抛错时原样抛出去，不会被吞掉', async () => {
    const scorer = new HttpAiScorer({
      endpoint: 'x',
      transport: {
        post: async () => {
          throw new Error('网络超时')
        },
      },
    })
    await expect(scorer.score({ imageRef: 'a.png', word: '狗' })).rejects.toThrow('网络超时')
  })
})

describe('Emoji 版贴纸面板', () => {
  it('每回合随机给 10–20 个，且一份面板里不重复', () => {
    const rng = createRng(20260101)
    for (let i = 0; i < 60; i++) {
      const palette = pickEmojiPalette(rng)
      expect(palette.length).toBeGreaterThanOrEqual(10)
      expect(palette.length).toBeLessThanOrEqual(20)
      expect(new Set(palette).size).toBe(palette.length)
    }
  })

  it('两次抽的面板不该一模一样', () => {
    const rng = createRng(7)
    const first = pickEmojiPalette(rng)
    const second = pickEmojiPalette(rng)
    expect(first.join('')).not.toBe(second.join(''))
  })

  it('不同种子（也就是换一局）抽出来的面板不同', () => {
    const palettes = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      palettes.add(pickEmojiPalette(createRng(seed)).join(''))
    }
    // 20 个种子至少给出 18 种不同面板，说明换局基本不会重样
    expect(palettes.size).toBeGreaterThanOrEqual(18)
  })

  it('能把这道题自己的 emoji 剔掉，否则贴一下就猜中了', () => {
    const rng = createRng(99)
    for (let i = 0; i < 30; i++) {
      const palette = pickEmojiPalette(rng, { exclude: ['🦒', '🍎'] })
      expect(palette).not.toContain('🦒')
      expect(palette).not.toContain('🍎')
    }
  })

  it('指定数量时按数量给，要得比池子多就全给', () => {
    const rng = createRng(3)
    expect(pickEmojiPalette(rng, { count: 5 })).toHaveLength(5)
    expect(pickEmojiPalette(rng, { count: 9999 })).toHaveLength(EMOJI_POOL.length)
  })

  it('池子本身没有重复（去重过），而且够大', () => {
    expect(new Set(EMOJI_POOL).size).toBe(EMOJI_POOL.length)
    expect(EMOJI_POOL.length).toBeGreaterThan(200)
  })
})
