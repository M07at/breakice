import { afterEach, expect, it, vi } from 'vitest'
import { createDrawRoomScorer } from '../drawScoring'
import { validDrawingRef } from '../../modules/draw/scoringContract'
import { LocalDrawRoomBackend } from '../../modules/draw/room'
import type { SupabaseRoomApi } from '../../platform/supabase'
import type { AiScoreResult } from '../../modules/draw/types'

afterEach(() => vi.useRealTimers())

function setup(results: unknown[]) {
  const rpcCall = vi.fn(async () => undefined)
  const invokeFunction = vi.fn(async () => {
    const next = results.shift()
    if (next instanceof Error) throw next
    return next
  })
  const api = { rpcCall, invokeFunction } as unknown as Pick<SupabaseRoomApi, 'rpcCall' | 'invokeFunction'>
  return { rpcCall, invokeFunction, scorer: createDrawRoomScorer({ roomId: 'room', api, painterId: () => 'guest' }) }
}
const drawing = { imageRef: 'room/draw/r1/guest-123.png', word: '苹果', roundKey: 'r1' }

it('writes the private word and requests the real scoring endpoint for the actual painter', async () => {
  const { scorer, rpcCall, invokeFunction } = setup([{ status: 'success', score: 92, comment: 'AI 猜：apple', provider: 'drawzy' }])
  expect(await scorer.score(drawing)).toMatchObject({ score: 92, provider: 'drawzy', degraded: false })
  expect(rpcCall).toHaveBeenCalledWith('publish_draw_word', { p_room_id: 'room', p_round_key: 'r1', p_user_id: 'guest', p_word: '苹果' })
  expect(invokeFunction).toHaveBeenCalledWith('/functions/v1/draw-score', { room_id: 'room', round_key: 'r1', image_ref: drawing.imageRef })
})

it.each(['failed', 'timeout', 'unsupported'])('reports %s as unavailable without mock AI points', async status => {
  const { scorer } = setup([{ status }])
  expect(await scorer.score(drawing)).toMatchObject({ score: 0, degraded: true })
})

it('polls an already-running score and uses its final result', async () => {
  vi.useFakeTimers()
  const { scorer, invokeFunction } = setup([{ status: 'pending' }, { status: 'success', total: 84 }])
  const result = scorer.score(drawing)
  await vi.advanceTimersByTimeAsync(1000)
  expect(await result).toMatchObject({ score: 84, degraded: false })
  expect(invokeFunction).toHaveBeenCalledTimes(2)
})

it('rejects references outside the current room, painter and round', () => {
  expect(validDrawingRef('room', 'r1', 'guest', drawing.imageRef)).toBe(true)
  for (const ref of ['other/draw/r1/guest-123.png', 'room/draw/r2/guest-123.png', 'room/draw/r1/host-123.png', 'room/draw/r1/guest-../secret.png', 'room/draw/r1/guest-x.png?x=1']) {
    expect(validDrawingRef('room', 'r1', 'guest', ref)).toBe(false)
  }
})

it('keeps a slow score on its original turn even after the drawing deadline', async () => {
  let now = 100000
  let resolveScore!: (result: AiScoreResult) => void
  const room = new LocalDrawRoomBackend({
    playerCount: 2, variant: 'custom', customText: '苹果', drawSeconds: 30, now: () => now,
    scorer: { score: () => new Promise(resolve => { resolveScore = resolve }) },
  })
  const first = await room.start()
  const submission = room.submitDrawing('room/draw/r1/me-1.png')
  await Promise.resolve()
  now += 100000
  expect(await room.tick()).toMatchObject({ phase: 'drawing', roundIndex: 0, scoring: true })
  const guesser = first.players.find(player => player.id !== first.painterId)!.id
  expect((await room.sendMessage('苹果', guesser)).messages.every(message => message.kind !== 'correct')).toBe(true)
  resolveScore({ score: 83, dimensions: { composition: 83, creativity: 83, relevance: 83 }, comment: '真实模型结果' })
  const revealed = await submission
  expect(revealed).toMatchObject({ phase: 'reveal', roundIndex: 0, scoring: false })
  expect(revealed.panel[0].ai?.score).toBe(83)
  now += 8000
  expect(await room.tick()).toMatchObject({ phase: 'drawing', roundIndex: 1 })
  room.dispose()
})
