import { describe, expect, it } from 'vitest'
import { ScoreBook, settleDrawRound, shouldAcceptVersion } from '../engine'
import { LocalScoreSink } from '../backend'
import { DEFAULT_SCORE_CONFIG, eventKey, resolveScoreConfig, weightOf } from '../rules'
import type { AiScoreResult } from '../../draw/types'
import type { ScoreEvent } from '../types'

const ai = (score: number, degraded = false): AiScoreResult => ({
  score,
  dimensions: { composition: score, creativity: score, relevance: score },
  comment: '',
  degraded,
})

function ev(patch: Partial<ScoreEvent> & Pick<ScoreEvent, 'playerId' | 'reason' | 'points'>): ScoreEvent {
  return { roomId: 'room', gameId: 'g1', ...patch }
}

describe('单轮你画我猜结算（FR-05 公式）', () => {
  it('作画者 = round(AI × 0.5) + 猜中人数 × 10', () => {
    const r = settleDrawRound({
      roomId: 'room',
      gameId: 'g1',
      roundKey: 'r1',
      painterId: 'alice',
      ai: ai(80),
      guesses: [
        { playerId: 'bob', seconds: 10 },
        { playerId: 'carol', seconds: 20 },
      ],
    })
    expect(r.degraded).toBe(false)
    expect(r.painterPoints).toBe(60)
    expect(r.guessers).toEqual([
      { playerId: 'bob', points: 45 },
      { playerId: 'carol', points: 40 },
    ])
  })

  it('猜中者 = round(max(0, 50 - 用时秒 × 0.5))，拖太久也不倒扣', () => {
    const r = settleDrawRound({
      roomId: 'room',
      gameId: 'g1',
      roundKey: 'r1',
      painterId: 'alice',
      ai: ai(50),
      guesses: [{ playerId: 'bob', seconds: 200 }],
    })
    expect(r.guessers[0].points).toBe(0)
  })

  it('单轮作画者得分封顶，不会因为一堆人猜中就爆分', () => {
    const guesses = Array.from({ length: 10 }, (_, i) => ({ playerId: `p${i}`, seconds: 1 }))
    const r = settleDrawRound({
      roomId: 'room',
      gameId: 'g1',
      roundKey: 'r1',
      painterId: 'alice',
      ai: ai(100),
      guesses,
    })
    expect(r.painterPoints).toBe(100)
  })

  it('AI 降级时走人工评分兜底，并明确标记本轮没含 AI', () => {
    const r = settleDrawRound({
      roomId: 'room',
      gameId: 'g1',
      roundKey: 'r1',
      painterId: 'alice',
      ai: null,
      manualAvg: 6,
      guesses: [{ playerId: 'bob', seconds: 10 }],
    })
    expect(r.degraded).toBe(true)
    expect(r.painterPoints).toBe(40) // 6 × 5 + 10
  })

  it('服务端自己标记降级时同样按降级算', () => {
    const r = settleDrawRound({
      roomId: 'room',
      gameId: 'g1',
      roundKey: 'r1',
      painterId: 'alice',
      ai: ai(90, true),
      guesses: [],
    })
    expect(r.degraded).toBe(true)
    expect(r.painterPoints).toBe(0)
  })

  it('同一个人被记两次猜中只算一次，按最快的算', () => {
    const r = settleDrawRound({
      roomId: 'room',
      gameId: 'g1',
      roundKey: 'r1',
      painterId: 'alice',
      ai: ai(80),
      guesses: [
        { playerId: 'bob', seconds: 30 },
        { playerId: 'bob', seconds: 10 },
      ],
    })
    expect(r.guessers).toEqual([{ playerId: 'bob', points: 45 }])
    expect(r.painterPoints).toBe(50)
  })

  it('作画者不会同时拿猜中分', () => {
    const r = settleDrawRound({
      roomId: 'room',
      gameId: 'g1',
      roundKey: 'r1',
      painterId: 'alice',
      ai: ai(80),
      guesses: [{ playerId: 'alice', seconds: 5 }],
    })
    expect(r.guessers).toEqual([])
    expect(r.painterPoints).toBe(40)
  })

  it('权重可调：aiWeight 拉到 1 就是完全认 AI 的分', () => {
    const config = resolveScoreConfig({ aiWeight: 1, perGuesser: 0 })
    const r = settleDrawRound(
      { roomId: 'room', gameId: 'g1', roundKey: 'r1', painterId: 'alice', ai: ai(80), guesses: [] },
      config,
    )
    expect(r.painterPoints).toBe(80)
  })
})

describe('计分配置', () => {
  it('局部配置只覆盖给到的字段，权重表逐项合并', () => {
    const config = resolveScoreConfig({ aiWeight: 0.8, weights: { uc_win_undercover: 1.5 } })
    expect(config.aiWeight).toBe(0.8)
    expect(config.painterCap).toBe(DEFAULT_SCORE_CONFIG.painterCap)
    expect(weightOf(config, 'uc_win_undercover')).toBe(1.5)
    expect(weightOf(config, 'uc_survive')).toBe(1)
  })

  it('幂等键把轮次算进去，不同轮同理由不会互相顶掉', () => {
    const a = eventKey({ gameId: 'g1', roundKey: 'r1', playerId: 'alice', reason: 'draw_painter' })
    const b = eventKey({ gameId: 'g1', roundKey: 'r2', playerId: 'alice', reason: 'draw_painter' })
    expect(a).not.toBe(b)
  })
})

describe('记账本', () => {
  it('照 C 的建议分值记账', () => {
    const book = new ScoreBook({ names: { alice: 'A' } })
    const report = book.apply([
      ev({ playerId: 'alice', reason: 'uc_win_civilian', points: 2, roundKey: 'r1' }),
      ev({ playerId: 'alice', reason: 'uc_survive', points: 1, roundKey: 'r1' }),
    ])
    expect(report.applied).toHaveLength(2)
    expect(book.totalOf('alice')).toBe(3)
  })

  it('B 可以按权重重新算 C 的分', () => {
    const book = new ScoreBook({ weights: { uc_win_undercover: 1.5 } })
    book.apply([ev({ playerId: 'bob', reason: 'uc_win_undercover', points: 4, roundKey: 'r1' })])
    expect(book.totalOf('bob')).toBe(6)
  })

  it('重复的结算请求被幂等挡掉，不重复加分', () => {
    const book = new ScoreBook()
    const event = ev({ playerId: 'alice', reason: 'draw_painter', points: 60, roundKey: 'r1' })
    expect(book.apply([event]).applied).toHaveLength(1)
    const second = book.apply([event])
    expect(second.applied).toHaveLength(0)
    expect(second.skipped).toHaveLength(1)
    expect(book.totalOf('alice')).toBe(60)
  })

  it('版本号只在真的记了新账时往前走', () => {
    const book = new ScoreBook()
    expect(book.version).toBe(0)
    book.apply([ev({ playerId: 'alice', reason: 'uc_survive', points: 1, roundKey: 'r1' })])
    expect(book.version).toBe(1)
    book.apply([ev({ playerId: 'alice', reason: 'uc_survive', points: 1, roundKey: 'r1' })])
    expect(book.version).toBe(1)
  })

  it('结算一轮：算分、记账、标记降级轮次', () => {
    const book = new ScoreBook({ names: { alice: 'A', bob: 'B' }, seats: { alice: 0, bob: 1 } })
    const { result } = book.settleRound({
      roomId: 'room',
      gameId: 'g1',
      roundKey: 'r1',
      painterId: 'alice',
      ai: null,
      guesses: [{ playerId: 'bob', seconds: 10 }],
    })
    expect(result.degraded).toBe(true)
    expect(book.totalOf('alice')).toBe(10)
    expect(book.totalOf('bob')).toBe(45)
    const painterRow = book.rows().find((row) => row.playerId === 'bob')
    expect(painterRow?.total).toBe(45)
    expect(book.rows().find((row) => row.playerId === 'alice')?.degradedRounds).toBe(1)
  })
})

describe('排行榜', () => {
  function board() {
    const book = new ScoreBook({
      names: { alice: 'A', bob: 'B', carol: 'C' },
      seats: { alice: 0, bob: 1, carol: 2 },
    })
    book.apply([
      ev({ playerId: 'alice', reason: 'uc_win_civilian', points: 2, roundKey: 'r1' }),
      ev({ playerId: 'alice', reason: 'uc_correct_vote', points: 2, roundKey: 'r1' }),
      ev({ playerId: 'bob', reason: 'uc_win_undercover', points: 2, roundKey: 'r2' }),
      ev({ playerId: 'bob', reason: 'uc_correct_vote', points: 2, roundKey: 'r2' }),
      ev({ playerId: 'carol', reason: 'uc_survive', points: 2, roundKey: 'r3' }),
    ])
    return book
  }

  it('按总分降序，同分并列同名次，下一名跳号', () => {
    const rows = board().rows()
    expect(rows.map((row) => [row.name, row.total, row.rank])).toEqual([
      ['A', 4, 1],
      ['B', 4, 1],
      ['C', 2, 3],
    ])
  })

  it('同分时按座位先后排，两端的榜单顺序一致', () => {
    const rows = board().rows()
    expect(rows.map((row) => row.playerId)).toEqual(['alice', 'bob', 'carol'])
  })

  it('+N 增量可以清零，用于播完动画', () => {
    const book = board()
    expect(book.rows()[0].delta).toBe(4)
    book.clearDeltas()
    expect(book.rows()[0].delta).toBe(0)
  })

  it('topN 只取前几名，给大屏用', () => {
    expect(board().topN(2).map((row) => row.playerId)).toEqual(['alice', 'bob'])
    expect(board().topN(0)).toEqual([])
  })

  it('晚到的旧版本榜单被拒绝，不会把新榜单盖回去', () => {
    expect(shouldAcceptVersion(3, 4)).toBe(true)
    expect(shouldAcceptVersion(3, 3)).toBe(false)
    expect(shouldAcceptVersion(3, 2)).toBe(false)
  })
})

describe('单机计分入口', () => {
  it('submit 之后 leaderboard 能读到同一份账', async () => {
    const sink = new LocalScoreSink({ names: { alice: 'A' } })
    const rows = await sink.submit([ev({ playerId: 'alice', reason: 'uc_win_civilian', points: 2, roundKey: 'r1' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'A', total: 2, rank: 1 })
    expect(await sink.leaderboard()).toEqual(rows)
  })
})
