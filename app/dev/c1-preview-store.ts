/** 仅供Vite开发预览和测试。不会进入小程序或H5生产包。 */
import { LocalUcBackend } from '../src/modules/undercover/backend'
import type { UcClientAction, UcCommandMeta } from '../src/modules/undercover/backend'
import { UcError } from '../src/modules/undercover/errors'
import { createRng } from '../src/modules/shared/random'
import type { DrawingSubmission, HybridArtwork, UcPlayerSnapshot } from '../src/modules/undercover/player'
import { C3BankStore } from './c3-bank-store'

interface PreviewSession {
  id: string
  gameId: string
  gameNumber: number
  seenGames: Set<string>
  hostId: string
  players: { id: string; name: string; ticket: string }[]
  backend: LocalUcBackend
  refreshPool: () => Promise<void>
  bankNotice: () => string
  variant: 'classic' | 'draw'
  artworks: Map<string, HybridArtwork & { due: number; mode: DrawingSubmission['scoreMode']; gameId: string }>
  submissions: Map<string, { payload: string; result: Promise<unknown> }>
  blankEnabled: boolean
}

export class C1PreviewStore {
  private sessions = new Map<string, PreviewSession>()
  constructor(private now = () => Date.now(), readonly banks = new C3BankStore()) {}

  async create(names: string[], blankEnabled = false, variant: 'classic' | 'draw' = 'classic', language: 'zh' | 'en' = 'zh', bankIds: string[] = ['sys_undercover']) {
    if (!['classic', 'draw'].includes(variant) || (variant === 'draw' && names?.length > 12)) throw new UcError('BAD_REQUEST', '融合玩法需要4–12人')
    if (!Array.isArray(names) || names.length < 4 || names.length > 20 || names.some(n => typeof n !== 'string' || n.length > 12) || typeof blankEnabled !== 'boolean') throw new UcError('BAD_REQUEST', '需要4–20位玩家，每个昵称最多12字')
    const id = randomHex(12)
    const players = names.map((name, index) => ({ id: `p${index + 1}`, name: name.trim() || `玩家${index + 1}`, ticket: randomHex(24) }))
    const rng = createRng(crypto.getRandomValues(new Uint32Array(1))[0])
    let pool = await this.banks.pool(language, variant, bankIds); let bankNotice = ''
    const refreshPool = async () => { pool = await this.banks.pool(language, variant, bankIds) }
    const backend = new LocalUcBackend({ playerIds: players.map(p => p.id), hostId: players[0].id, rng, now: this.now, pickPair: () => {
      const chosen = this.banks.pick(pool, rng); bankNotice = chosen.notice; return chosen.pair
    } })
    const started = await backend.start({ roomId: id, variant, config: { blankEnabled }, requestId: 'initial-start' })
    this.sessions.set(id, { id, gameId: started.gameId, gameNumber: 1, seenGames: new Set([started.gameId]), hostId: players[0].id, players, backend, blankEnabled, variant, refreshPool, bankNotice: () => bankNotice, artworks: new Map(), submissions: new Map() })
    return { sessionId: id, ticket: players[0].ticket }
  }

  private authenticate(id: string, ticket: string) {
    const session = this.sessions.get(id)
    if (!session) throw new UcError('GAME_NOT_FOUND', '找不到这场联调游戏，请重新开始')
    const player = session.players.find(p => p.ticket === ticket)
    if (!player) throw new UcError('UNKNOWN_PLAYER', '加入链接无效，请打开分配给自己的链接')
    // 此切换只在开发服务内部。请求不能提交操作者ID或读取别人的词。
    session.backend.me = player.id
    return { session, player }
  }

  async snapshot(id: string, ticket: string): Promise<UcPlayerSnapshot> {
    const { session, player } = this.authenticate(id, ticket)
    const gameId = session.gameId
    const gameNumber = session.gameNumber
    for (const art of session.artworks.values()) {
      if (art.gameId === gameId && art.status === 'pending' && this.now() >= art.due) {
        art.status = art.mode
        if (art.mode === 'success') { art.score = 78; session.backend.recordPreviewScore(gameId, art.playerId, art.turnKey, 78) }
      }
    }
    const view = await session.backend.getView(gameId)
    return { sessionId: id, gameId, gameNumber, playerId: player.id, hostId: session.hostId, players: session.players.map(({ id, name }) => ({ id, name })), view, bankNotice: session.bankNotice(), artworks: [...session.artworks.values()].filter(a => a.gameId === gameId).map(a => ({ id: a.id, playerId: a.playerId, turnKey: a.turnKey, preview: a.preview, status: a.status, ...(view.phase === 'ended' && a.score !== undefined ? { score: a.score } : {}) })), serverNow: this.now() }
  }

  async word(id: string, ticket: string, gameId: string) {
    const { session } = this.authenticate(id, ticket)
    if (gameId !== session.gameId) throw new UcError('STALE_STATE', '已经开始新局，请刷新')
    return session.backend.getMyWord(gameId)
  }

  async act(id: string, ticket: string, gameId: string, action: UcClientAction, meta: UcCommandMeta) {
    const { session } = this.authenticate(id, ticket)
    if (gameId !== session.gameId) throw new UcError('STALE_STATE', '已经开始新局，请刷新')
    if (!meta) throw new UcError('BAD_REQUEST', '缺少请求编号和版本')
    if (!['acknowledgeWord', 'turnDone', 'vote', 'endGame'].includes(action?.type)) throw new UcError('BAD_REQUEST', '此操作不属于个人游戏界面')
    await session.backend.act(gameId, action, meta)
    return this.snapshot(id, ticket)
  }

  async submitDrawing(id: string, ticket: string, gameId: string, drawing: DrawingSubmission, meta: UcCommandMeta) {
    const { session, player } = this.authenticate(id, ticket)
    if (gameId !== session.gameId) throw new UcError('STALE_STATE', '已进入新局')
    if (!meta?.requestId || !drawing || !['◯', '△', '∿', '☆'].includes(drawing.preview) || !['success', 'failed', 'timeout'].includes(drawing.scoreMode)) throw new UcError('BAD_REQUEST', '模拟画作格式无效')
    const key = gameId + ':' + player.id + ':' + meta.requestId
    const payload = JSON.stringify(drawing)
    const previous = session.submissions.get(key)
    if (previous) {
      if (previous.payload !== payload) throw new UcError('REQUEST_CONFLICT', '重试不能改变画作')
      await previous.result
      return this.snapshot(id, ticket)
    }
    const result = (async () => {
      const current = await session.backend.getView(gameId)
      if (current.variant !== 'draw' || current.phase !== 'describe' || current.currentSpeakerId !== player.id) throw new UcError('NOT_YOUR_TURN', '只有当前画手可以提交')
      if (current.drawings[current.turnKey]?.[player.id]) throw new UcError('BAD_REQUEST', '本回合已提交画作')
      session.backend.me = player.id
      const artId = randomHex(12)
      const accepted = await session.backend.act(gameId, { type: 'drawingSubmitted', turnKey: current.turnKey, drawingRef: artId }, meta)
      session.artworks.set(artId, { id: artId, playerId: player.id, turnKey: current.turnKey, preview: drawing.preview, status: 'pending', mode: drawing.scoreMode, due: this.now() + (drawing.scoreMode === 'timeout' ? 5000 : 1200), gameId })
      session.backend.me = player.id
      try { await session.backend.act(gameId, { type: 'turnDone' }, { ...meta, requestId: meta.requestId + '-done', expectedVersion: accepted.version }) }
      catch (e) { if (!(e instanceof UcError) || !['STALE_STATE', 'DEADLINE_PASSED', 'WRONG_PHASE', 'NOT_YOUR_TURN'].includes(e.code)) throw e }
    })()
    session.submissions.set(key, { payload, result })
    try { await result } catch (e) { session.submissions.delete(key); throw e }
    return this.snapshot(id, ticket)
  }

  invites(id: string, ticket: string) {
    const { session, player } = this.authenticate(id, ticket)
    if (player.id !== session.hostId) throw new UcError('HOST_ONLY', '只有主持人可分发联调链接')
    return session.players.map(p => ({ name: p.name, ticket: p.ticket }))
  }

  async replay(id: string, ticket: string, requestId: string) {
    const { session, player } = this.authenticate(id, ticket)
    if (player.id !== session.hostId) throw new UcError('HOST_ONLY', '等待主持人开始新局')
    if (typeof requestId !== 'string' || !requestId.trim()) throw new UcError('BAD_REQUEST', '缺少新局请求编号')
    // 同ID重试由底层start收据返回原局；新ID在尚未结束时返回GAME_ACTIVE。
    await session.refreshPool()
    const result = await session.backend.start({ roomId: session.id, variant: session.variant, config: { blankEnabled: session.blankEnabled }, requestId })
    if (!session.seenGames.has(result.gameId)) {
      session.gameId = result.gameId
      session.gameNumber++
      session.seenGames.add(result.gameId)
    }
    return this.snapshot(id, ticket)
  }
}

function randomHex(length: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), byte => byte.toString(16).padStart(2, '0')).join('')
}
