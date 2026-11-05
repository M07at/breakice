import { describe, expect, it } from 'vitest'
import { applyAction, createGame, currentSpeaker, tick } from '../engine'
import { DEFAULT_CONFIG, testBotCount } from '../rules'
import { createRng } from '../../shared/random'
import type { UcAction } from '../types'

describe('测试机器人数量', () => {
  it.each([
    [1, undefined, 3],
    [2, undefined, 2],
    [4, undefined, 0],
    [1, 5, 5],
    [1, 6, 5],
    [1, NaN, 3],
  ])('%s 位真人，申请 %s 时补 %s 个机器人', (humans, requested, expected) => {
    expect(testBotCount(humans as number, requested)).toBe(expected)
  })

  it.each([3, 5])('一位真人和 %s 个机器人仍等待真人确认词语', (count) => {
    const now = 1000
    const botIds = Array.from({ length: count }, (_, i) => `bot-${i + 1}`)
    let state = createGame({
      playerIds: ['human', ...botIds],
      pair: { civilian: '苹果', undercover: '梨' },
      config: { ...DEFAULT_CONFIG, variant: 'classic' },
      now,
      rng: createRng(42),
    }).state
    for (const id of botIds) {
      state = applyAction(state, { type: 'acknowledgeWord', by: id }, { now, isHost: false }).state
    }
    expect(state.phase).toBe('word')
    state = applyAction(state, { type: 'acknowledgeWord', by: 'human' }, { now, isHost: true }).state
    expect(state.phase).toBe('describe')
  })
})

/**
 * 复现「机器人补位后一开局就结算」：
 * 2 个真人 + 2 个机器人，机器人只替自己做最小动作（确认词 / 结束回合 / 弃权投票），
 * 真人的回合必须原样保留，绝不能直接跳到 ended。
 */
describe('机器人补位的阶段推进', () => {
  const players = ['human-a', 'human-b', 'bot-1', 'bot-2']
  const bots = ['bot-1', 'bot-2']

  function start() {
    const now = Date.now()
    const transition = createGame({
      playerIds: players,
      pair: { civilian: '苹果', undercover: '梨' },
      config: { ...DEFAULT_CONFIG, variant: 'classic' },
      now,
      rng: createRng(42),
    })
    return { state: transition.state, now }
  }

  it('机器人替自己行动后，真人没行动就不会结束', () => {
    const { state, now } = start()
    expect(state.phase).toBe('word')

    let current = state
    for (const id of bots) {
      current = applyAction(current, { type: 'acknowledgeWord', by: id } as UcAction, { now, isHost: false }).state
    }
    expect(current.phase).toBe('word')

    current = applyAction(current, { type: 'acknowledgeWord', by: 'human-a' } as UcAction, { now, isHost: false }).state
    expect(current.phase).toBe('word')
    current = applyAction(current, { type: 'acknowledgeWord', by: 'human-b' } as UcAction, { now, isHost: false }).state
    expect(current.phase).toBe('describe')
  })

  it('真人确认词之后 tick 不会把整局推到结算', () => {
    const { state, now } = start()
    let current = state
    for (const id of players) {
      current = applyAction(current, { type: 'acknowledgeWord', by: id } as UcAction, { now, isHost: false }).state
    }
    const settled = tick(current, now)
    expect(settled.state.phase).not.toBe('ended')
  })

  it('机器人只在自己回合结束时推进', () => {
    const { state, now } = start()
    let current = state
    for (const id of players) {
      current = applyAction(current, { type: 'acknowledgeWord', by: id } as UcAction, { now, isHost: false }).state
    }
    expect(current.phase).toBe('describe')

    // 走到机器人发言时，结束回合应当成功
    let guard = 0
    while (current.phase === 'describe' && guard < 8) {
      guard += 1
      const speaker = currentSpeaker(current)
      expect(speaker).toBeTruthy()
      current = applyAction(current, { type: 'turnDone', by: speaker } as UcAction, { now, isHost: false }).state
    }
    expect(['vote', 'ended']).toContain(current.phase)
  })
})

