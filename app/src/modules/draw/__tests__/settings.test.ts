import { expect, it } from 'vitest'
import { LocalDrawRoomBackend } from '../room'
import { normalizeDrawSeconds } from '../settings'
import type { AiScorer } from '../ai'

it.each([undefined, null, 0, -30, 45, Infinity, 'invalid'])(
  'uses the ninety-second default for invalid duration %s', value => {
    expect(normalizeDrawSeconds(value)).toBe(90)
  },
)

it('keeps the selected custom duration, prompt and deadline across turns and replay settings', async () => {
  let now = 100000
  const scorer: AiScorer = { score: async () => ({ score: 80, dimensions: { composition: 80, creativity: 80, relevance: 80 }, comment: '' }) }
  const room = new LocalDrawRoomBackend({
    playerCount: 2, variant: 'custom', customText: '苹果', drawSeconds: 30, now: () => now, scorer,
  })
  const first = await room.start()
  expect(first.endsAt - first.startedAt).toBe(30000)
  expect(first.word?.word).toBe('苹果')
  expect(first.drawSeconds).toBe(30)
  expect(room.settings).toMatchObject({ customText: '苹果', drawSeconds: 30 })
  now += 29999
  expect((await room.tick()).phase).toBe('drawing')
  now += 1
  expect((await room.tick()).phase).toBe('reveal')
  now += 8000
  const next = await room.tick()
  expect(next.roundIndex).toBe(1)
  expect(next.endsAt - next.startedAt).toBe(30000)
  room.dispose()
})
