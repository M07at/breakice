import { describe, expect, it } from 'vitest'
import { describeGuess, scoreFromGuess } from '../aiScore'

describe('AI 评分映射（猜中 80+ / 没猜中 80-）', () => {
  it('猜中：80 起步，越快越高，上限 100', () => {
    expect(scoreFromGuess({ correct: true, seconds: 60 })).toBe(80)
    expect(scoreFromGuess({ correct: true, seconds: 0 })).toBe(100)
    expect(scoreFromGuess({ correct: true, seconds: 30 })).toBe(90)
  })

  it('没猜中：80 往下，越慢越低，下限 0', () => {
    expect(scoreFromGuess({ correct: false, seconds: 0 })).toBe(80)
    expect(scoreFromGuess({ correct: false, seconds: 30 })).toBe(40)
    expect(scoreFromGuess({ correct: false, seconds: 60 })).toBe(0)
  })

  it('用时超出范围会被夹住', () => {
    expect(scoreFromGuess({ correct: true, seconds: 999 })).toBe(80)
    expect(scoreFromGuess({ correct: false, seconds: 999 })).toBe(0)
    expect(scoreFromGuess({ correct: true, seconds: -10 })).toBe(100)
  })

  it('拿不到时间按 60 秒处理', () => {
    expect(scoreFromGuess({ correct: true })).toBe(80)
    expect(scoreFromGuess({ correct: false })).toBe(0)
  })

  it('猜中永远不低于没猜中（同一用时）', () => {
    for (const seconds of [0, 10, 25, 40, 60]) {
      const hit = scoreFromGuess({ correct: true, seconds })
      const miss = scoreFromGuess({ correct: false, seconds })
      expect(hit).toBeGreaterThanOrEqual(80)
      expect(miss).toBeLessThanOrEqual(80)
      expect(hit).toBeGreaterThan(miss)
    }
  })

  it('分数永远在 0–100 之间', () => {
    for (const outcome of [
      { correct: true, seconds: -99 },
      { correct: true, seconds: 9999 },
      { correct: false, seconds: -99 },
      { correct: false, seconds: 9999 },
    ]) {
      const score = scoreFromGuess(outcome)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })

  it('展示文案带上猜测、用时和是否猜中', () => {
    expect(describeGuess({ correct: true, guess: '苹果', seconds: 3.24 })).toBe('AI 猜：苹果 · 用时 3.2 秒 · 猜中了')
    expect(describeGuess({ correct: false, guess: '树', seconds: 12 })).toBe('AI 猜：树 · 用时 12.0 秒 · 没猜中')
  })
})
