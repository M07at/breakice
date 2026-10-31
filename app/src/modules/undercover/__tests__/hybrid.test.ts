import { describe, expect, it } from 'vitest'
import { C1PreviewStore } from '../../../../dev/c1-preview-store'
import type { UcPlayerSnapshot } from '../player'

async function fixture() {
  const clock = { now: 0 }; const store = new C1PreviewStore(() => clock.now)
  const credentials = await store.create(['甲', '乙', '丙', '丁'], false, 'draw')
  const users = store.invites(credentials.sessionId, credentials.ticket)
  const load = (i = 0) => store.snapshot(credentials.sessionId, users[i].ticket)
  let sequence = 0
  const meta = (s: UcPlayerSnapshot, id = `hy-${++sequence}`) => ({ requestId: id, expectedVersion: s.view.version, expectedPhase: s.view.phase, expectedRound: s.view.round, expectedTurnKey: s.view.turnKey })
  for (let i = 0; i < 4; i++) { const s = await load(i); await store.act(s.sessionId, users[i].ticket, s.gameId, { type: 'acknowledgeWord' }, meta(s)) }
  return { clock, store, users, load, meta }
}
describe('C2同步融合玩法', () => {
  it('画手权限、重复提交去重和内容冲突', async () => {
    const h = await fixture(); const s = await h.load(); const i = s.players.findIndex(p => p.id === s.view.currentSpeakerId)
    const drawing = { preview: '◯', scoreMode: 'success' as const }; const m = h.meta(s, 'same-drawing')
    await expect(h.store.submitDrawing(s.sessionId, h.users[(i+1)%4].ticket, s.gameId, drawing, m)).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' })
    await Promise.all([h.store.submitDrawing(s.sessionId,h.users[i].ticket,s.gameId,drawing,m),h.store.submitDrawing(s.sessionId,h.users[i].ticket,s.gameId,drawing,m)])
    expect((await h.load()).artworks).toHaveLength(1)
    expect((await h.load()).view.currentSpeakerId).not.toBe(s.playerId === s.view.currentSpeakerId ? s.playerId : s.view.currentSpeakerId)
    await expect(h.store.submitDrawing(s.sessionId,h.users[i].ticket,s.gameId,{...drawing,preview:'△'},m)).rejects.toMatchObject({code:'REQUEST_CONFLICT'})
  })
  it('成功、失败、超时均走到回顾、投票和一致终局，重开不带旧作品', async () => {
    const h=await fixture(); const initial=await h.load(); const words=await Promise.all(h.users.map(u=>h.store.word(initial.sessionId,u.ticket,initial.gameId)))
    for(let n=0;n<4;n++) { const s=await h.load(); const i=s.players.findIndex(p=>p.id===s.view.currentSpeakerId); await h.store.submitDrawing(s.sessionId,h.users[i].ticket,s.gameId,{preview:'☆',scoreMode:n===1?'failed':n===2?'timeout':'success'},h.meta(s)) }
    h.clock.now+=6000; let s=await h.load()
    expect(s.view.phase).toBe('review'); expect(s.artworks?.map(a=>a.status)).toEqual(['success','failed','timeout','success']); expect(s.artworks?.every(a=>a.score===undefined)).toBe(true)
    h.clock.now=10000; s=await h.load(); expect(s.view.phase).toBe('vote')
    const undercover=words.find(w=>words.filter(x=>x.word===w.word).length===1)!.playerId
    for(let i=0;i<4;i++) { s=await h.load(i); await h.store.act(s.sessionId,h.users[i].ticket,s.gameId,{type:'vote',targetId:s.playerId===undercover?s.players.find(p=>p.id!==undercover)!.id:undercover},h.meta(s)) }
    s=await h.load(); expect(s.view.winner).toBe('civilian'); expect(s.artworks?.filter(a=>a.score===78)).toHaveLength(2)
    const next=await h.store.replay(s.sessionId,h.users[0].ticket,'again');expect(next.view.phase).toBe('word');expect(next.artworks).toEqual([]);expect(next.view.variant).toBe('draw')
  })
  it('无人交画也能超时进入投票，不依赖评分返回',async()=>{const h=await fixture();h.clock.now=110000;const s=await h.load();expect(s.view.phase).toBe('vote');expect(s.artworks).toEqual([])})
})
