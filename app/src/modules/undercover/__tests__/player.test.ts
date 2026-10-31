import { describe, expect, it } from 'vitest'
import { C1PreviewStore } from '../../../../dev/c1-preview-store'
import { playerPermissions, shouldAcceptPlayerSnapshot } from '../player'
import type { UcPlayerPort, UcPlayerSnapshot } from '../player'
import type { UcClientAction } from '../backend'

async function fixture() {
  const store = new C1PreviewStore(() => 1000)
  const credentials = await store.create(['小林', '小王', '小李', '小张', '小陈', '小周'])
  const invites = store.invites(credentials.sessionId, credentials.ticket)
  const ports: UcPlayerPort[] = invites.map(({ ticket }) => ({
    label: 'test fixed player',
    load: () => store.snapshot(credentials.sessionId, ticket),
    getMyWord: gameId => store.word(credentials.sessionId, ticket, gameId),
    act: (gameId, action, meta) => store.act(credentials.sessionId, ticket, gameId, action, meta),
    replay: requestId => store.replay(credentials.sessionId, ticket, requestId),
  }))
  let seq = 0
  async function act(index: number, action: UcClientAction) {
    const current = await ports[index].load()
    return ports[index].act(current.gameId, action, { requestId: `cmd-${++seq}`, expectedVersion: current.view.version })
  }
  async function acknowledge() { for (let i = 0; i < 6; i++) await act(i, { type: 'acknowledgeWord' }) }
  async function describeAll() {
    let current = await ports[0].load()
    while (current.view.phase === 'describe') {
      current = await act(current.players.findIndex(p => p.id === current.view.currentSpeakerId), { type: 'turnDone' })
    }
  }
  return { store, credentials, invites, ports, act, acknowledge, describeAll }
}

describe('每台设备一个固定玩家', () => {
  it('六个客户端始终绑定自己，词卡响应不含其他人的秘密', async () => {
    const h = await fixture()
    for (let i = 0; i < 6; i++) {
      const initial = await h.ports[i].load()
      const word = await h.ports[i].getMyWord(initial.gameId)
      expect(initial.playerId).toBe(`p${i + 1}`)
      expect(word.playerId).toBe(initial.playerId)
      expect(Object.keys(word).sort()).toEqual(['isBlank', 'playerId', 'word'])
      expect(initial.view.players.every(p => p.role === null && p.word === undefined)).toBe(true)
      expect(JSON.stringify(initial)).not.toContain('ticket')
      await h.act(i, { type: 'acknowledgeWord' })
      expect((await h.ports[i].load()).playerId).toBe(initial.playerId)
    }
    expect(playerPermissions(await h.ports[0].load()).canAcknowledge).toBe(false)
  })

  it('自己确认后等待别人，只有当前发言者有结束发言权限', async () => {
    const h = await fixture()
    await h.act(0, { type: 'acknowledgeWord' })
    expect(playerPermissions(await h.ports[0].load()).canAcknowledge).toBe(false)
    expect(playerPermissions(await h.ports[1].load()).canAcknowledge).toBe(true)
    for (let i = 1; i < 6; i++) await h.act(i, { type: 'acknowledgeWord' })
    const snapshots = await Promise.all(h.ports.map(p => p.load()))
    expect(snapshots.filter(s => playerPermissions(s).canFinish)).toHaveLength(1)
    const waitingIndex = snapshots.findIndex(s => !playerPermissions(s).canFinish)
    await expect(h.act(waitingIndex, { type: 'turnDone' })).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' })
  })

  it('投票阶段每个人同时看到自己的资格，提交后只等待不切换成别人', async () => {
    const h = await fixture()
    await h.acknowledge(); await h.describeAll()
    const current = await Promise.all(h.ports.map(p => p.load()))
    expect(current.every(s => playerPermissions(s).canVote)).toBe(true)
    await h.act(0, { type: 'vote', targetId: 'p2' })
    const own = await h.ports[0].load()
    expect(own.playerId).toBe('p1')
    expect(playerPermissions(own).canVote).toBe(false)
    expect(playerPermissions(await h.ports[1].load()).canVote).toBe(true)
    expect(own.view.lastResult).toBeNull()
    await expect(h.act(0, { type: 'vote', targetId: 'p3' })).rejects.toMatchObject({ code: 'ALREADY_VOTED' })
  })

  it('六个设备从同一版本同时领词和投票，不互相阻塞；旧轮次上下文拒绝', async () => {
    const h = await fixture()
    const before = await h.ports[0].load()
    const context = (s: UcPlayerSnapshot, requestId: string) => ({ requestId, expectedVersion: s.view.version, expectedPhase: s.view.phase, expectedRound: s.view.round, expectedTurnKey: s.view.turnKey })
    await Promise.all(h.ports.map((p, i) => p.act(before.gameId, { type: 'acknowledgeWord' }, context(before, `concurrent-word-${i}`))))
    await h.describeAll()
    const vote = await h.ports[0].load()
    await Promise.all(h.ports.map((p, i) => p.act(vote.gameId, { type: 'vote', targetId: null }, context(vote, `concurrent-vote-${i}`))))
    expect((await h.ports[0].load()).view.phase).toBe('reveal')
    await expect(h.ports[0].act(vote.gameId, { type: 'vote', targetId: 'p2' }, context(vote, 'expired-stage'))).rejects.toMatchObject({ code: 'STALE_STATE' })
  })

  it('不能伪造另一位操作者；普通玩家不能结束或分发邀请', async () => {
    const h = await fixture()
    await expect(h.act(1, { type: 'acknowledgeWord', by: 'p1' } as unknown as UcClientAction)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(h.act(1, { type: 'endGame' })).rejects.toMatchObject({ code: 'HOST_ONLY' })
    expect(() => h.store.invites(h.credentials.sessionId, h.invites[1].ticket)).toThrow('只有主持人可分发联调链接')
    await expect(h.store.snapshot(h.credentials.sessionId, 'wrong-ticket')).rejects.toMatchObject({ code: 'UNKNOWN_PLAYER' })
    const other = await h.store.create(['a', 'b', 'c', 'd'])
    await expect(h.store.snapshot(other.sessionId, h.invites[1].ticket)).rejects.toMatchObject({ code: 'UNKNOWN_PLAYER' })
  })

  it('六个独立客户端完成同一局并收到一致终局', async () => {
    const h = await fixture()
    const start = await h.ports[0].load()
    const words = await Promise.all(h.ports.map(p => p.getMyWord(start.gameId)))
    const undercover = words.find(w => words.filter(other => other.word === w.word).length === 1)!.playerId
    await h.acknowledge(); await h.describeAll()
    for (let i = 0; i < 6; i++) await h.act(i, { type: 'vote', targetId: `p${i + 1}` === undercover ? (undercover === 'p1' ? 'p2' : 'p1') : undercover })
    const results = await Promise.all(h.ports.map(p => p.load()))
    expect(results.every(s => s.view.phase === 'ended' && s.view.winner === 'civilian')).toBe(true)
    expect(new Set(results.map(s => JSON.stringify(s.view))).size).toBe(1)
    expect(results.map(s => s.playerId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])
  })

  it('主持人重开后所有客户端自动读取新局；旧请求不使局次倒退', async () => {
    const h = await fixture()
    const old = await h.ports[1].load()
    await expect(h.ports[1].replay('replay-1')).rejects.toMatchObject({ code: 'HOST_ONLY' })
    await h.act(0, { type: 'endGame' })
    const next = await h.ports[0].replay('replay-1')
    expect(next.gameNumber).toBe(2)
    expect((await h.ports[1].load()).gameId).toBe(next.gameId)
    expect(shouldAcceptPlayerSnapshot(old, await h.ports[1].load())).toBe(false)
    expect((await h.ports[0].replay('replay-1')).gameNumber).toBe(2)
    expect((await h.ports[0].replay('initial-start')).gameNumber).toBe(2)
    await expect(h.ports[1].getMyWord(old.gameId)).rejects.toMatchObject({ code: 'STALE_STATE' })
  })

  it('拒绝同一页面悄悄切换玩家，忽略旧版本快照', async () => {
    const h = await fixture()
    const p1 = await h.ports[0].load()
    const p2 = await h.ports[1].load()
    expect(() => shouldAcceptPlayerSnapshot(p2, p1)).toThrow('玩家身份发生变化')
    await h.act(0, { type: 'acknowledgeWord' })
    expect(shouldAcceptPlayerSnapshot(p1, await h.ports[0].load())).toBe(false)
    const inconsistent = { ...p1, playerId: 'outsider' } as UcPlayerSnapshot
    expect(() => shouldAcceptPlayerSnapshot(inconsistent)).toThrow('当前身份不属于这场游戏')
  })
})
