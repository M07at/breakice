import type { Rng } from '../shared/random'
import { applyAction, createGame, currentTurnKey, tick } from './engine'
import { UcError } from './errors'
import type { Phase, UcAction, UcConfig, UcEvent, UcState, Variant, WordPair } from './types'
import { toPublicView, toSecretView } from './view'
import type { UcPublicView, UcSecretView } from './view'

/** 客户端能发的动作。by 由服务端按登录态填，客户端不能冒充别人 */
export type UcClientAction =
  | { type: 'acknowledgeWord' }
  | { type: 'turnDone' }
  | { type: 'drawingSubmitted'; turnKey: string; drawingRef: string }
  | { type: 'vote'; targetId: string | null }
  | { type: 'skipTurn' }
  | { type: 'next' }
  | { type: 'endGame' }

export interface UcStartOptions {
  roomId: string
  variant: Variant
  /** 不填用系统题库 */
  bankIds?: string[]
  config?: Partial<UcConfig>
  /** 同一次开始操作重试必须使用同一个ID；再来一局使用新ID */
  requestId?: string
}

export interface UcCommandMeta {
  requestId: string
  expectedVersion: number
  /** 固定玩家并发领词/投票：版本可因别人提交增长，但不能跨阶段/轮次重放。 */
  expectedPhase?: Phase
  expectedRound?: number
  expectedTurnKey?: string
}

/**
 * C 的页面只依赖这个接口。
 * 现在用 LocalUcBackend（单机内存）开发；接入 A 的平台后换成远程实现，页面不用改。
 */
export interface UcBackend {
  start(options: UcStartOptions): Promise<{ gameId: string; view: UcPublicView }>
  act(gameId: string, action: UcClientAction, meta?: UcCommandMeta): Promise<UcPublicView>
  /** 倒计时归零时调用，重复调用安全 */
  tick(gameId: string): Promise<UcPublicView>
  getView(gameId: string): Promise<UcPublicView>
  getMyWord(gameId: string): Promise<UcSecretView>
  subscribe(gameId: string, onView: (view: UcPublicView) => void): () => void
}

export interface LocalBackendOptions {
  /** 模拟房间成员，按座位顺序 */
  playerIds: string[]
  hostId: string
  pickPair: (variant: Variant) => WordPair
  rng: Rng
  now?: () => number
  /** 代替 B 的统一计分 */
  onScore?: (event: Extract<UcEvent, { type: 'score' }>) => void
}

/** 单机版：一部手机轮流扮演每个玩家（me 可切换），用来开发页面和离线演示 */
export class LocalUcBackend implements UcBackend {
  me: string
  private games = new Map<string, UcState>()
  private listeners = new Map<string, Set<(view: UcPublicView) => void>>()
  private nextId = 1
  private roomGames = new Map<string, string>()
  private starts = new Map<string, { fingerprint: string; gameId: string }>()
  private receipts = new Map<string, Map<string, string>>()

  constructor(private readonly opts: LocalBackendOptions) {
    this.me = opts.hostId
  }

  async start(options: UcStartOptions) {
    this.requireMember()
    if (this.me !== this.opts.hostId) throw new UcError('HOST_ONLY', '只有主持人可以开始游戏')
    if (typeof options.roomId !== 'string' || !options.roomId.trim()) throw new UcError('BAD_REQUEST', '缺少房间标识')
    if (options.requestId !== undefined) validateRequestId(options.requestId)
    const key = options.requestId ? `${this.me}:${options.requestId}` : undefined
    const fingerprint = canonical(options)
    const previous = key ? this.starts.get(key) : undefined
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new UcError('REQUEST_CONFLICT', '同一个请求编号不能用于不同的开始设置')
      return { gameId: previous.gameId, view: toPublicView(this.settleDeadline(previous.gameId)) }
    }
    const activeId = this.roomGames.get(options.roomId)
    if (activeId && this.settleDeadline(activeId).phase !== 'ended') {
      throw new UcError('GAME_ACTIVE', '本房间已有进行中的游戏，请先完成或结束')
    }
    const { state, events } = createGame({
      playerIds: this.opts.playerIds,
      pair: this.opts.pickPair(options.variant),
      config: { ...options.config, variant: options.variant },
      now: this.now(),
      rng: this.opts.rng,
    })
    const gameId = `local_${this.nextId++}`
    this.roomGames.set(options.roomId, gameId)
    if (key) this.starts.set(key, { fingerprint, gameId })
    this.commit(gameId, state, events)
    return { gameId, view: toPublicView(state) }
  }

  async act(gameId: string, action: UcClientAction, meta?: UcCommandMeta) {
    this.requireMember()
    validateClientAction(action)
    if (meta) {
      validateRequestId(meta.requestId)
      if (!Number.isInteger(meta.expectedVersion) || meta.expectedVersion < 1) throw new UcError('BAD_REQUEST', '局面版本无效')
      if (meta.expectedPhase !== undefined || meta.expectedRound !== undefined || meta.expectedTurnKey !== undefined) {
        if (!['word', 'describe', 'vote', 'review', 'reveal', 'ended'].includes(meta.expectedPhase ?? '') || !Number.isInteger(meta.expectedRound) || (meta.expectedRound ?? 0) < 1 || typeof meta.expectedTurnKey !== 'string' || !meta.expectedTurnKey) throw new UcError('BAD_REQUEST', '阶段上下文无效')
      }
    }
    const stateBeforeDeadline = this.get(gameId)
    const state = this.settleDeadline(gameId)
    const key = meta ? `${this.me}:${meta.requestId}` : undefined
    const fingerprint = canonical(action)
    const receipts = this.receipts.get(gameId) ?? new Map<string, string>()
    if (key && receipts.has(key)) {
      if (receipts.get(key) !== fingerprint) throw new UcError('REQUEST_CONFLICT', '同一个请求编号不能用于不同的操作')
      return toPublicView(state)
    }
    const sameStage = meta?.expectedPhase === state.phase && meta.expectedRound === state.round && meta.expectedTurnKey === currentTurnKey(state)
    if (meta?.expectedPhase !== undefined && !sameStage) throw new UcError('STALE_STATE', '阶段已变化，请刷新后继续')
    const independentAction = (action.type === 'acknowledgeWord' && state.phase === 'word') || (action.type === 'vote' && state.phase === 'vote')
    const concurrent = meta && sameStage && independentAction && meta.expectedVersion <= state.version
    if (meta && meta.expectedVersion !== state.version && !concurrent) throw new UcError('STALE_STATE', '局面已更新，请刷新后重新选择')
    if (state !== stateBeforeDeadline && ['vote', 'turnDone', 'skipTurn', 'next'].includes(action.type)) {
      throw new UcError('DEADLINE_PASSED', '本阶段已到时，已更新到当前进度')
    }
    const full: UcAction =
      action.type === 'acknowledgeWord' || action.type === 'turnDone' || action.type === 'vote' || action.type === 'drawingSubmitted'
        ? { ...action, by: this.me }
        : action
    const result = applyAction(state, full, {
      now: this.now(),
      isHost: this.me === this.opts.hostId,
    })
    if (key) { receipts.set(key, fingerprint); this.receipts.set(gameId, receipts) }
    this.commit(gameId, result.state, result.events)
    return toPublicView(result.state)
  }

  async tick(gameId: string) {
    this.requireMember()
    return toPublicView(this.settleDeadline(gameId))
  }

  async getView(gameId: string) {
    this.requireMember()
    return toPublicView(this.settleDeadline(gameId))
  }

  async getMyWord(gameId: string) {
    this.requireMember()
    return toSecretView(this.get(gameId), this.me)
  }

  subscribe(gameId: string, onView: (view: UcPublicView) => void) {
    this.requireMember()
    this.get(gameId)
    let set = this.listeners.get(gameId)
    if (!set) {
      set = new Set()
      this.listeners.set(gameId, set)
    }
    set.add(onView)
    return () => {
      set?.delete(onView)
    }
  }

  /** 模拟有人退出房间（真实环境由 A 的房间服务触发） */
  playerLeft(gameId: string, playerId: string) {
    const { state, events } = applyAction(this.settleDeadline(gameId), { type: 'playerLeft', playerId }, { now: this.now() })
    this.commit(gameId, state, events)
    return toPublicView(state)
  }

  /** 开发评分适配器的内部入口，不属于客户端命令。 */
  recordPreviewScore(gameId: string, playerId: string, turnKey: string, score: number) {
    const result = applyAction(this.get(gameId), { type: 'aiScored', playerId, turnKey, score }, { now: this.now() })
    this.commit(gameId, result.state, result.events)
  }

  private get(gameId: string): UcState {
    const s = this.games.get(gameId)
    if (!s) throw new UcError('GAME_NOT_FOUND', '找不到本局游戏，请返回设置')
    return s
  }

  private commit(gameId: string, state: UcState, events: UcEvent[]) {
    if (this.games.get(gameId) === state && events.length === 0) return
    this.games.set(gameId, state)
    for (const e of events) {
      if (e.type === 'score') {
        try { this.opts.onScore?.(e) } catch (error) { console.warn('本机计分回调失败', error) }
      }
    }
    this.listeners.get(gameId)?.forEach((fn) => {
      try { fn(toPublicView(state)) } catch (error) { console.warn('本机局面监听回调失败', error) }
    })
  }

  private requireMember() {
    if (!this.opts.playerIds.includes(this.me)) throw new UcError('UNKNOWN_PLAYER', '当前玩家不属于本局')
  }

  private settleDeadline(gameId: string): UcState {
    let state = this.get(gameId)
    const events: UcEvent[] = []
    const now = this.now()
    while (state.phase !== 'word' && state.phase !== 'ended' && now >= state.phaseDeadline) {
      const next = tick(state, now)
      if (next.state === state) break
      state = next.state
      events.push(...next.events)
    }
    this.commit(gameId, state, events)
    return state
  }

  private now() {
    return this.opts.now ? this.opts.now() : Date.now()
  }
}

function validateRequestId(id: string) {
  if (typeof id !== 'string' || !id.trim() || id.length > 100) throw new UcError('BAD_REQUEST', '请求编号必须为1–100个字符')
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function validateClientAction(action: UcClientAction) {
  const fields: Record<string, string[]> = {
    acknowledgeWord: [], turnDone: [], drawingSubmitted: ['turnKey', 'drawingRef'],
    vote: ['targetId'], skipTurn: [], next: [], endGame: [],
  }
  if (!action || typeof action !== 'object' || !Object.prototype.hasOwnProperty.call(fields, action.type)) throw new UcError('BAD_REQUEST', '未知的游戏操作')
  const expected = ['type', ...fields[action.type]]
  if (Object.keys(action).length !== expected.length || Object.keys(action).some(key => !expected.includes(key))) throw new UcError('BAD_REQUEST', '游戏操作字段无效')
  if (action.type === 'vote' && action.targetId !== null && (typeof action.targetId !== 'string' || !action.targetId.trim())) throw new UcError('BAD_REQUEST', '投票目标无效')
  if (action.type === 'drawingSubmitted' && [action.turnKey, action.drawingRef].some(value => typeof value !== 'string' || !value.trim())) throw new UcError('BAD_REQUEST', '画作信息无效')
}
