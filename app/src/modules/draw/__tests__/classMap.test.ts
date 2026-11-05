import { describe, expect, it } from 'vitest'
import { canScoreWithAi, DRAWZY_CLASSES, expectedClassFor } from '../classMap'

describe('中文词→英文类别映射', () => {
  it('常见单字/物体能映射', () => {
    expect(expectedClassFor('苹果')).toBe('apple')
    expect(expectedClassFor('自行车')).toBe('bicycle')
    expect(expectedClassFor('吉他')).toBe('guitar')
  })

  it('成语取主要可画物体', () => {
    expect(expectedClassFor('对牛弹琴')).toBe('cow')
    expect(expectedClassFor('守株待兔')).toBe('rabbit')
  })

  it('子串也能命中，且优先更长的键', () => {
    expect(expectedClassFor('一个大苹果')).toBe('apple')
    expect(expectedClassFor('小汽车')).toBe('car')
  })

  it('映射不到的词返回 null，不参与 AI 评分', () => {
    expect(expectedClassFor('量子力学')).toBeNull()
    expect(canScoreWithAi('量子力学')).toBe(false)
    expect(canScoreWithAi('苹果')).toBe(true)
  })

  it('映射值非空，且常见物体都在 drawzy 类别表里', () => {
    const known = new Set(DRAWZY_CLASSES as readonly string[])
    // 成语类映射（cow/rabbit 等）需要真实调用后跟 drawzy 的标签对齐，这里只校验常用物体
    for (const word of ['苹果', '披萨', '雨伞', '太阳', '吉他']) {
      const cls = expectedClassFor(word)
      expect(cls).not.toBeNull()
      expect(known.has(cls as string)).toBe(true)
    }
  })
})
