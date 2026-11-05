import { describe, expect, it } from 'vitest'
import { canScoreWithAi, DRAWZY_CLASSES, DRAW_WORD_POOL, expectedClassFor, filterScorable } from '../classMap'

describe('中文词→英文类别映射', () => {
  it('includes the original model first class so prediction indices do not shift', () => {
    expect(DRAWZY_CLASSES).toHaveLength(46)
    expect(DRAWZY_CLASSES[0]).toBe('aircraft carrier')
    expect(DRAWZY_CLASSES[8]).toBe('apple')
    expect(DRAWZY_CLASSES[13]).toBe('banana')
    expect(DRAWZY_CLASSES[45]).toBe('bucket')
    expect(expectedClassFor('航母')).toBe('aircraft carrier')
  })
  it('常见单字/物体能映射', () => {
    expect(expectedClassFor('苹果')).toBe('apple')
    expect(expectedClassFor('自行车')).toBe('bicycle')
    expect(expectedClassFor('面包')).toBe('bread')
  })

  it('成语取主要可画物体', () => {
    expect(expectedClassFor('生日蛋糕')).toBe('birthday cake')
    expect(expectedClassFor('回旋镖')).toBe('boomerang')
  })

  it('子串也能命中，且优先更长的键', () => {
    expect(expectedClassFor('一个大苹果')).toBe('apple')
    expect(expectedClassFor('小篮球')).toBe('basketball')
  })

  it('词池里的词全部可评分', () => {
    expect(DRAW_WORD_POOL.length).toBeGreaterThan(25)
    expect(filterScorable(DRAW_WORD_POOL)).toHaveLength(DRAW_WORD_POOL.length)
  })

  it('映射不到的词返回 null，不参与 AI 评分', () => {
    expect(expectedClassFor('量子力学')).toBeNull()
    expect(canScoreWithAi('量子力学')).toBe(false)
    expect(canScoreWithAi('苹果')).toBe(true)
  })

  it('映射值非空，且常见物体都在 drawzy 类别表里', () => {
    const known = new Set(DRAWZY_CLASSES as readonly string[])
    // 成语类映射（cow/rabbit 等）需要真实调用后跟 drawzy 的标签对齐，这里只校验常用物体
    for (const word of ['苹果', '面包', '西兰花', '生日蛋糕', '回旋镖']) {
      const cls = expectedClassFor(word)
      expect(cls).not.toBeNull()
      expect(known.has(cls as string)).toBe(true)
    }
  })
})
