import { describe, expect, it, vi } from 'vitest'
import { createRng } from '../../shared/random'
import { applyAction, createGame, isUcError, LocalUcBackend, toPublicView } from '..'
import type { UcBackend, UcClientAction, UcConfig, UcEvent, UcPublicView } from '..'

const players = Array.from({ length: 6 }, (_, i) => `p${i + 1}`)
const pair = { civilian: '苹果', undercover: '梨' }

async function fixture(config: Partial<UcConfig> = {}) {
  const clock = { now: 0 }
  const scores: UcEvent[] = []
  const local = new LocalUcBackend({ playerIds: players, hostId: 'p1', pickPair: () => pair, rng: createRng(3), now: () => clock.now, onScore: e => scores.push(e) })
  const backend: UcBackend = local
  const options = { roomId: 'room-1', variant: 'classic' as const, config: { swapWords: false, ...config }, requestId: 'start-1' }
  const started = await backend.start(options)
  return { local, backend, clock, scores, options, gameId: started.gameId, view: started.view }
}
async function acknowledgeAll(h: Awaited<ReturnType<typeof fixture>>) {
  const words: Record<string, string | null> = {}
  for (const id of players) {
    h.local.me = id
    words[id] = (await h.backend.getMyWord(h.gameId)).word
    h.view = await h.backend.act(h.gameId, { type: 'acknowledgeWord' }, { requestId: `word-${id}`, expectedVersion: h.view.version })
  }
  return words
}
async function describeAll(h: Awaited<ReturnType<typeof fixture>>) {
  while (h.view.phase === 'describe') {
    h.local.me = h.view.currentSpeakerId!
    h.view = await h.backend.act(h.gameId, { type: 'turnDone' }, { requestId: `turn-${h.view.version}`, expectedVersion: h.view.version })
  }
}

describe('C1 后端接口合同：本机参考实现', () => {
  it('同一开始请求只创建一局；设置改变必须换请求ID', async () => {
    const h = await fixture()
    expect((await h.backend.start(h.options)).gameId).toBe(h.gameId)
    await expect(h.backend.start({ ...h.options, variant: 'draw' })).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' })
    await expect(h.backend.start({ ...h.options, requestId: 'start-2' })).rejects.toMatchObject({ code: 'GAME_ACTIVE' })
    await h.backend.act(h.gameId, { type: 'endGame' })
    expect((await h.backend.start(h.options)).view.phase).toBe('ended')
    expect((await h.backend.start({ ...h.options, requestId: 'start-2' })).gameId).not.toBe(h.gameId)
  })

  it('重复发言完成不会跳过下一位；同ID不同操作明确拒绝', async () => {
    const h = await fixture()
    await acknowledgeAll(h)
    h.local.me = h.view.currentSpeakerId!
    const meta = { requestId: 'finish-turn', expectedVersion: h.view.version }
    const first = await h.backend.act(h.gameId, { type: 'turnDone' }, meta)
    expect(await h.backend.act(h.gameId, { type: 'turnDone' }, meta)).toEqual(first)
    await expect(h.backend.act(h.gameId, { type: 'endGame' }, meta)).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' })
  })

  it('旧版本新操作失败且不修改当前局面', async () => {
    const h = await fixture()
    await acknowledgeAll(h)
    h.local.me = h.view.currentSpeakerId!
    const first = await h.backend.act(h.gameId, { type: 'turnDone' })
    await expect(h.backend.act(h.gameId, { type: 'turnDone' }, { requestId: 'stale', expectedVersion: h.view.version })).rejects.toMatchObject({ code: 'STALE_STATE' })
    expect(await h.backend.getView(h.gameId)).toEqual(first)
  })

  it('最后一票重试不重复结算和发分；结束重试不覆盖胜利', async () => {
    const h = await fixture()
    const words = await acknowledgeAll(h)
    const undercover = players.find(id => words[id] === '梨')!
    await describeAll(h)
    let lastAction: { type: 'vote'; targetId: string } | undefined
    let lastMeta: { requestId: string; expectedVersion: number } | undefined
    for (const id of players) {
      h.local.me = id
      lastAction = { type: 'vote', targetId: id === undercover ? players.find(p => p !== id)! : undercover }
      lastMeta = { requestId: `vote-${id}`, expectedVersion: h.view.version }
      h.view = await h.backend.act(h.gameId, lastAction, lastMeta)
    }
    expect(h.view.winner).toBe('civilian')
    const scoreCount = h.scores.length
    expect(await h.backend.act(h.gameId, lastAction!, lastMeta!)).toEqual(h.view)
    expect(h.scores).toHaveLength(scoreCount)
    expect(await h.backend.tick(h.gameId)).toEqual(h.view)
    h.local.me = 'p1'
    await expect(h.backend.act(h.gameId, { type: 'endGame' })).rejects.toMatchObject({ code: 'WRONG_PHASE' })
  })

  it('提前结束同请求重试只成功一次', async () => {
    const h = await fixture()
    const meta = { requestId: 'end', expectedVersion: h.view.version }
    const ended = await h.backend.act(h.gameId, { type: 'endGame' }, meta)
    expect(await h.backend.act(h.gameId, { type: 'endGame' }, meta)).toEqual(ended)
    expect(h.scores).toEqual([])
  })

  it('截止时先推进局面，再拒绝过期投票，不给下一阶段错误投票', async () => {
    const h = await fixture()
    await acknowledgeAll(h)
    await describeAll(h)
    h.clock.now = h.view.phaseDeadline
    h.local.me = 'p1'
    await expect(h.backend.act(h.gameId, { type: 'vote', targetId: 'p2' }, { requestId: 'late', expectedVersion: h.view.version })).rejects.toMatchObject({ code: 'STALE_STATE' })
    const latest = await h.backend.getView(h.gameId)
    expect(latest.phase).toBe('reveal')
    expect(latest.lastResult?.ballots.every(b => b.targetId === null)).toBe(true)
  })

  it('后台很久后按真实截止时间追赶，不给每位重新计时', async () => {
    const h = await fixture()
    await acknowledgeAll(h)
    h.clock.now = 278_000 // 六次40秒发言 + 30秒投票 + 8秒揭晓
    const current = await h.backend.getView(h.gameId)
    expect(current.phase).toBe('describe')
    expect(current.round).toBe(2)
    expect(current.phaseDeadline).toBe(318_000)
    expect(await h.backend.tick(h.gameId)).toEqual(current)
  })

  it('后台恢复跨越终局也只计分一次', async () => {
    const h = await fixture({ maxRounds: 1 })
    await acknowledgeAll(h)
    h.clock.now = 1_000_000
    const current = await h.backend.tick(h.gameId)
    expect(current.endedReason).toBe('max_rounds')
    const count = h.scores.length
    expect(count).toBeGreaterThan(0)
    expect(await h.backend.tick(h.gameId)).toEqual(current)
    expect(h.scores).toHaveLength(count)
  })

  it('重复退出不增加版本，也不再次淘汰', async () => {
    const h = await fixture()
    const first = h.local.playerLeft(h.gameId, 'p2')
    expect(h.local.playerLeft(h.gameId, 'p2')).toEqual(first)
  })

  it('非成员不能读写或订阅；非主持人不能开始', async () => {
    const h = await fixture()
    h.local.me = 'p2'
    await expect(h.backend.start({ ...h.options, roomId: 'room-2' })).rejects.toMatchObject({ code: 'HOST_ONLY' })
    h.local.me = 'outsider'
    await expect(h.backend.getView(h.gameId)).rejects.toMatchObject({ code: 'UNKNOWN_PLAYER' })
    await expect(h.backend.getMyWord(h.gameId)).rejects.toMatchObject({ code: 'UNKNOWN_PLAYER' })
    await expect(h.backend.act(h.gameId, { type: 'acknowledgeWord' })).rejects.toMatchObject({ code: 'UNKNOWN_PLAYER' })
    expect(() => h.backend.subscribe(h.gameId, () => {})).toThrow('当前玩家不属于本局')
    h.local.me = 'p1'
    await expect(h.backend.getView('missing-game')).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' })
  })

  it('无效命令元数据有明确错误', async () => {
    const h = await fixture()
    await expect(h.backend.act(h.gameId, { type: 'acknowledgeWord' }, { requestId: '', expectedVersion: 1 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(h.backend.act(h.gameId, { type: 'acknowledgeWord' }, { requestId: 'x', expectedVersion: NaN })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('拒绝伪造操作者和系统内部操作', async () => {
    const h = await fixture()
    const forged = { type: 'acknowledgeWord', by: 'p2' } as unknown as UcClientAction
    const internal = { type: 'playerLeft', playerId: 'p2' } as unknown as UcClientAction
    await expect(h.backend.act(h.gameId, forged)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(h.backend.act(h.gameId, internal)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect((await h.backend.getView(h.gameId)).players.every(p => p.alive && !p.wordConfirmed)).toBe(true)
  })

  it('网络错误不当作已确认的业务拒绝', () => {
    expect(isUcError({ code: 'STALE_STATE', message: '局面已更新' })).toBe(true)
    expect(isUcError(Object.assign(new Error('connection lost'), { code: 'ECONNRESET' }))).toBe(false)
    expect(isUcError(new Error('unknown result'))).toBe(false)
  })

  it('公开快照和不同监听器彼此隔离；退订后不再收到通知', async () => {
    const h = await fixture()
    h.view.players[0].alive = false
    h.view.speakOrder.push('outsider')
    expect((await h.backend.getView(h.gameId)).players[0].alive).toBe(true)
    const seen: UcPublicView[] = []
    h.backend.subscribe(h.gameId, v => { v.players[0].alive = false; v.speakOrder.push('outsider') })
    const stop = h.backend.subscribe(h.gameId, v => seen.push(v))
    await h.backend.act(h.gameId, { type: 'acknowledgeWord' })
    expect(seen[0].players[0].alive).toBe(true)
    expect(seen[0].speakOrder).not.toContain('outsider')
    stop()
    h.local.me = 'p2'
    await h.backend.act(h.gameId, { type: 'acknowledgeWord' })
    expect(seen).toHaveLength(1)
  })

  it('监听器异常不破坏成功命令或其他订阅', async () => {
    const h = await fixture()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const seen: number[] = []
      h.backend.subscribe(h.gameId, () => { throw new Error('listener failure') })
      h.backend.subscribe(h.gameId, v => seen.push(v.version))
      const result = await h.backend.act(h.gameId, { type: 'acknowledgeWord' }, { requestId: 'ack', expectedVersion: 1 })
      expect(result.players[0].wordConfirmed).toBe(true)
      expect(seen).toEqual([2])
      await h.backend.act(h.gameId, { type: 'acknowledgeWord' }, { requestId: 'ack', expectedVersion: 1 })
      expect(seen).toEqual([2])
    } finally { warning.mockRestore() }
  })
})

describe('C1 引擎边界', () => {
  it.each([
    { describeSeconds: 0 }, { voteSeconds: NaN }, { revealSeconds: -1 },
    { drawSeconds: Infinity }, { maxRounds: 1.5 }, { undercoverCount: 1.5 },
    { maxRounds: 101 }, { describeSeconds: 3601 },
  ])('拒绝无效配置 %j', config => {
    expect(() => createGame({ playerIds: players, pair, now: 0, rng: createRng(1), config })).toThrowError(expect.objectContaining({ code: 'BAD_CONFIG' }))
  })

  it('未确认词语的最后一位退出后，其余玩家正常开始', () => {
    let state = createGame({ playerIds: [...players, 'p7'], pair, now: 0, rng: createRng(1) }).state
    const leaving = state.players.find(p => p.role === 'civilian')!.id
    for (const player of state.players) if (player.id !== leaving) state = applyAction(state, { type: 'acknowledgeWord', by: player.id }, { now: 0 }).state
    expect(state.phase).toBe('word')
    state = applyAction(state, { type: 'playerLeft', playerId: leaving }, { now: 0 }).state
    expect(state.phase).toBe('describe')
    expect(state.speakOrder).not.toContain(leaving)
  })

  it('原始引擎也拒绝到点发言操作且不改变输入', () => {
    let state = createGame({ playerIds: players, pair, now: 0, rng: createRng(1) }).state
    for (const id of players) state = applyAction(state, { type: 'acknowledgeWord', by: id }, { now: 0 }).state
    const before = JSON.stringify(state)
    expect(() => applyAction(state, { type: 'turnDone', by: state.speakOrder[0] }, { now: state.phaseDeadline })).toThrowError(expect.objectContaining({ code: 'DEADLINE_PASSED' }))
    expect(JSON.stringify(state)).toBe(before)
    const publicView = toPublicView(state)
    publicView.speakOrder.splice(0)
    expect(state.speakOrder).toHaveLength(6)
  })
})
