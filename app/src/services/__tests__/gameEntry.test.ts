import { describe, expect, it } from 'vitest'
import { bankUrl, PLAYER_ROUTE, toSeatNames, undercoverSetupUrl } from '../gameEntry'
import { getPromptPoolSize, pickPrompt } from '../truthOrDareService'
import type { Player } from '../../types/room'

function player(nickname: string, id = nickname): Player {
  return {
    id,
    nickname,
    avatar: { skin: 'light', eyes: 'round', nose: 'dot', mouth: 'smile', hair: 'short', accessory: 'none' },
    isHost: false,
    isReady: false,
    online: true,
  }
}

describe('D → C 游戏入口适配', () => {
  it('房间名单按座位顺序转成昵称，空昵称被忽略', () => {
    expect(toSeatNames([player('小雨'), player('阿哲'), player('  '), player('阿毛')])).toEqual(['小雨', '阿哲', '阿毛'])
    expect(toSeatNames([])).toEqual([])
    expect(toSeatNames(null)).toEqual([])
    expect(toSeatNames(undefined)).toEqual([])
  })

  it('开设页地址带上座位昵称，且每个昵称单独编码后可原样还原', () => {
    const names = ['小雨', 'A,B', '空格 名字']
    const url = undercoverSetupUrl('classic', names.map((name) => player(name)))
    expect(url.startsWith('/pages-uc/setup?names=')).toBe(true)
    const encoded = url.split('names=')[1]
    expect(encoded.split(',').map(decodeURIComponent)).toEqual(names)
  })

  it('没有玩家时不追加查询参数，两条开设路由与玩家路由固定', () => {
    expect(undercoverSetupUrl('classic', [])).toBe('/pages-uc/setup')
    expect(undercoverSetupUrl('draw', null)).toBe('/pages-uc/hybrid')
    expect(PLAYER_ROUTE.classic).toBe('/pages-uc/player')
    expect(PLAYER_ROUTE.draw).toBe('/pages-uc/hybrid-player')
    expect(bankUrl()).toBe('/pages-bank/index')
  })
})

describe('真心话大冒险使用 C 模块题库', () => {
  it('系统题库的真心话与大冒险都超过内置兜底条数', () => {
    expect(getPromptPoolSize('truth')).toBeGreaterThanOrEqual(69)
    expect(getPromptPoolSize('dare')).toBeGreaterThanOrEqual(52)
  })

  it('抽到的题目类型正确、文本非空且带难度', () => {
    for (const type of ['truth', 'dare'] as const) {
      for (let i = 0; i < 20; i++) {
        const prompt = pickPrompt(type)
        expect(prompt.type).toBe(type)
        expect(prompt.text.trim().length).toBeGreaterThan(0)
        expect(['轻松', '进阶']).toContain(prompt.difficulty)
      }
    }
  })
})
