import type { DrawReaction, DrawRoomBackend, DrawRoomView } from '../modules/draw/room'

/**
 * 你画我猜联机的客户端远程层。
 *
 * 模型是「主持人权威 + 指令队列」（服务端见 0017）：
 *   - 主持人跑本机 LocalDrawRoomBackend，把视图节流发布出去，并持续消费别人的操作；
 *   - 其他人用 remoteRoom 读视图、把自己的操作投进队列。
 *
 * 这里不直接依赖 Supabase，全部通过注入的 DrawRemoteApi，
 * 这样逻辑可以单测，也不会把平台细节漏进游戏模块。
 */

export type DrawActionKind = 'submitDrawing' | 'message' | 'reaction' | 'tick'

export interface DrawAction {
  id: number
  userId: string
  kind: DrawActionKind
  payload: Record<string, unknown>
  createdAt: string
}

export interface DrawRemoteApi {
  publishView(roomId: string, view: DrawRoomView): Promise<number>
  readView(roomId: string): Promise<{ view: DrawRoomView; version: number } | null>
  postAction(roomId: string, kind: DrawActionKind, payload?: Record<string, unknown>): Promise<number>
  takeActions(roomId: string, limit?: number): Promise<DrawAction[]>
}

export interface PublisherOptions {
  roomId: string
  api: DrawRemoteApi
  /** 本机权威后端（主持人那台设备） */
  backend: DrawRoomBackend
  /** 视图发布节流，默认 500ms */
  publishMs?: number
  /** 消费队列的间隔，默认 800ms */
  pollMs?: number
  onError?: (error: unknown) => void
}

export interface Publisher {
  start(): void
  stop(): void
  /** 立刻发布一次并处理一轮队列（页面切走前调用） */
  flush(): Promise<void>
}

/**
 * 主持人端：把本机视图发布出去，同时把别人投来的操作喂回本机后端。
 * 节流策略是「尾沿」：变化期间只记脏，到点再发一次，避免每帧都打网络。
 */
export function createDrawPublisher(options: PublisherOptions): Publisher {
  const publishMs = options.publishMs ?? 500
  const pollMs = options.pollMs ?? 800
  const report = (error: unknown) => options.onError?.(error)

  let dirty = false
  let publishing = false
  let stopped = true
  let publishTimer: ReturnType<typeof setInterval> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let offView: (() => void) | null = null

  async function publishOnce(): Promise<void> {
    if (!dirty || publishing) return
    publishing = true
    dirty = false
    try {
      const view = await options.backend.view()
      await options.api.publishView(options.roomId, view)
    } catch (error) {
      // 发布失败就标脏，等下一拍重试，别丢状态
      dirty = true
      report(error)
    } finally {
      publishing = false
    }
  }

  async function drainQueue(): Promise<void> {
    try {
      const actions = await options.api.takeActions(options.roomId)
      for (const action of actions) {
        try {
          await applyAction(action)
        } catch (error) {
          report(error)
        }
      }
      // 处理完立即发布一次，让发起方马上看到结果
      if (actions.length > 0) dirty = true
    } catch (error) {
      report(error)
    }
  }

  async function applyAction(action: DrawAction): Promise<void> {
    const payload = action.payload ?? {}
    switch (action.kind) {
      case 'submitDrawing':
        await options.backend.submitDrawing(String(payload.imageRef ?? ''))
        break
      case 'message':
        await options.backend.sendMessage(String(payload.text ?? ''))
        break
      case 'reaction':
        await options.backend.sendReaction(String(payload.targetPlayerId ?? ''), payload.kind as DrawReaction)
        break
      case 'tick':
        await options.backend.tick()
        break
      default:
        break
    }
  }

  function markDirty() {
    dirty = true
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      offView = options.backend.subscribe(() => markDirty())
      publishTimer = setInterval(() => {
        void publishOnce()
      }, publishMs)
      pollTimer = setInterval(() => {
        void drainQueue()
      }, pollMs)
      dirty = true
    },
    stop() {
      stopped = true
      offView?.()
      offView = null
      if (publishTimer) clearInterval(publishTimer)
      if (pollTimer) clearInterval(pollTimer)
      publishTimer = null
      pollTimer = null
    },
    async flush() {
      await publishOnce()
      await drainQueue()
      await publishOnce()
    },
  }
}

export interface RemoteRoomOptions {
  roomId: string
  api: DrawRemoteApi
  meId: string
  /** 视图轮询间隔，默认 800ms */
  pollMs?: number
  onError?: (error: unknown) => void
}

/**
 * 非权威端：读主持人的视图，把自己的操作投进队列。
 * 动作调用后会拉一次最新视图，保证返回值不会比本地还旧。
 */
export function createRemoteDrawRoom(options: RemoteRoomOptions): DrawRoomBackend {
  const pollMs = options.pollMs ?? 800
  const listeners = new Set<(view: DrawRoomView) => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  let lastVersion = -1
  let latest: DrawRoomView | null = null

  async function readOnce(): Promise<DrawRoomView> {
    const snapshot = await options.api.readView(options.roomId)
    if (!snapshot) throw new Error('这一局还没开始，等主持人开局')
    if (snapshot.version !== lastVersion) {
      lastVersion = snapshot.version
      latest = snapshot.view
      for (const listener of listeners) {
        try {
          listener(snapshot.view)
        } catch (error) {
          options.onError?.(error)
        }
      }
    }
    return latest ?? snapshot.view
  }

  async function act(kind: DrawActionKind, payload?: Record<string, unknown>): Promise<DrawRoomView> {
    try {
      await options.api.postAction(options.roomId, kind, payload)
    } catch (error) {
      options.onError?.(error)
      throw error
    }
    return readOnce()
  }

  return {
    meId: options.meId,
    view: () => readOnce(),
    subscribe(onView) {
      listeners.add(onView)
      if (!timer) {
        timer = setInterval(() => {
          void readOnce().catch((error) => options.onError?.(error))
        }, pollMs)
      }
      return () => {
        listeners.delete(onView)
        if (listeners.size === 0 && timer) {
          clearInterval(timer)
          timer = null
        }
      }
    },
    submitDrawing: (imageRef) => act('submitDrawing', { imageRef }),
    tick: () => act('tick'),
    sendMessage: (text) => act('message', { text }),
    sendReaction: (targetPlayerId, kind) => act('reaction', { targetPlayerId, kind }),
    dispose() {
      listeners.clear()
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
