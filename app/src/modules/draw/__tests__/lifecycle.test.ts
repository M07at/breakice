import { expect, it } from 'vitest'
import { LocalDrawRoomBackend } from '../room'
import type { AiScoreResult } from '../types'
const result = { score: 42, dimensions: { composition: 42, creativity: 42, relevance: 42 }, comment: '' }

it('runs a real one-person roster through draw, reveal and complete exactly once', async () => {
  let now = 100000
  const room = new LocalDrawRoomBackend({ variant: 'custom', customText: '苹果', playerCount: 1, players: [{ id: 'solo', name: '测试' }], meId: 'solo', scorer: { score: async () => result }, now: () => now })
  const started = await room.start()
  expect(started.players).toHaveLength(1)
  expect(started.painterId).toBe('solo')
  const revealed = await room.submitDrawing('solo.png')
  expect(revealed.phase).toBe('reveal')
  now += 8000
  const ended = await room.tick()
  expect(ended.phase).toBe('ended')
  expect(ended.panel).toHaveLength(1)
  now += 999999
  expect((await room.tick()).phase).toBe('ended')
  room.dispose()
})

it('does not reopen or award a late score after the host finishes the game', async () => {
  let resolve!: (score: AiScoreResult) => void
  const room = new LocalDrawRoomBackend({ variant: 'custom', customText: '苹果', playerCount: 1, scorer: { score: () => new Promise(done => { resolve = done }) } })
  await room.start()
  const submission = room.submitDrawing('pending.png')
  await Promise.resolve()
  await room.end()
  resolve(result)
  expect((await submission).phase).toBe('ended')
  expect((await room.view()).panel.every(entry => entry.ai === null)).toBe(true)
  room.dispose()
})
