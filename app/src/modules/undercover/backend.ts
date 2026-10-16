import type { Rng } from '../shared/random'
import { applyAction, createGame, tick } from './engine'
import { UcError } from './errors'
import type { UcAction, UcConfig, UcEvent, UcState, Variant, WordPair } from './types'
import { toPublicView, toSecretView } from './view'
import type { UcPublicView, UcSecretView } from './view'

/** 客户端能发的动作。by 由服务端按登录态填，客户端不能冒充别人 */
export type UcClientAction =
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
}

/**
 * C 的页面只依赖这个接口。
 * 现在用 LocalUcBackend（单机内存）开发；接入 A 的平台后换成远程实现，页面不用改。
 */
export interface UcBackend {
  start(options: UcStartOptions): Promise<{ gameId: string; view: UcPublicView }>
  act(gameId: string, action: UcClientAction): Promise<UcPublicView>
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

  constructor(private readonly opts: LocalBackendOptions) {
    this.me = opts.hostId
  }

  async start(options: UcStartOptions) {
    const { state, events } = createGame({
      playerIds: this.opts.playerIds,
      pair: this.opts.pickPair(options.variant),
      config: { ...options.config, variant: options.variant },
      now: this.now(),
      rng: this.opts.rng,
    })
    const gameId = `local_${this.nextId++}`
    this.commit(gameId, state, events)
    return { gameId, view: toPublicView(state) }
  }

  async act(gameId: string, action: UcClientAction) {
    const full: UcAction =
      action.type === 'turnDone' || action.type === 'vote' || action.type === 'drawingSubmitted'
        ? { ...action, by: this.me }
        : action
    const { state, events } = applyAction(this.get(gameId), full, {
      now: this.now(),
      isHost: this.me === this.opts.hostId,
    })
    this.commit(gameId, state, events)
    return toPublicView(state)
  }

  async tick(gameId: string) {
    const { state, events } = tick(this.get(gameId), this.now())
    if (events.length > 0) this.commit(gameId, state, events)
    return toPublicView(state)
  }

  async getView(gameId: string) {
    return toPublicView(this.get(gameId))
  }

  async getMyWord(gameId: string) {
    return toSecretView(this.get(gameId), this.me)
  }

  subscribe(gameId: string, onView: (view: UcPublicView) => void) {
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
    const { state, events } = applyAction(this.get(gameId), { type: 'playerLeft', playerId }, { now: this.now() })
    this.commit(gameId, state, events)
  }

  private get(gameId: string): UcState {
    const s = this.games.get(gameId)
    if (!s) throw new UcError('WRONG_PHASE', '游戏不存在或已结束')
    return s
  }

  private commit(gameId: string, state: UcState, events: UcEvent[]) {
    this.games.set(gameId, state)
    for (const e of events) if (e.type === 'score') this.opts.onScore?.(e)
    const view = toPublicView(state)
    this.listeners.get(gameId)?.forEach((fn) => fn(view))
  }

  private now() {
    return this.opts.now ? this.opts.now() : Date.now()
  }
}
