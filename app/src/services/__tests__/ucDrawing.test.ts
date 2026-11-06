import { afterEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ mode: 'supabase', invokeFunction: vi.fn(), scoreArtwork: vi.fn() }))
vi.mock('../../platform', () => ({ roomApi: api }))
vi.mock('../liveRoom', () => ({ pokeRoom: vi.fn() }))
import { startUndercoverRound } from '../ucGame'
import { getPlayerPort } from '../../modules/undercover/player'

afterEach(() => vi.resetAllMocks())
it('finishes the drawing turn immediately and skips AI scoring for the hybrid variant', async () => {
  const snapshot = { gameId: 'game', playerId: 'host', hostId: 'host', view: { variant: 'draw', phase: 'describe', round: 1, turnKey: '1', version: 2, currentSpeakerId: 'host' } }
  api.invokeFunction.mockImplementation(async (_path, body) => body.action?.type === 'turnDone'
    ? { ...snapshot, view: { ...snapshot.view, phase: 'review', version: 3, currentSpeakerId: null } } : snapshot)
  let resolveScore!: (value: unknown) => void
  api.scoreArtwork.mockImplementation(() => new Promise(resolve => { resolveScore = resolve }))
  await startUndercoverRound('room', 'draw')
  const port = getPlayerPort('draw')!
  const result = await port.submitDrawing!('game', { preview: 'image.png', artworkId: 'artwork', scoreMode: 'success' }, { requestId: 'submit', expectedVersion: 2, expectedPhase: 'describe', expectedRound: 1, expectedTurnKey: '1' })
  expect(result.view.phase).toBe('review')
  // 产品决定：融合玩法（variant=draw）不再请求 AI 评分，避免识别结果泄露词
  expect(api.scoreArtwork).not.toHaveBeenCalled()
  expect(api.invokeFunction.mock.calls.some(([, body]) => body.action?.type === 'aiScored')).toBe(false)
})
