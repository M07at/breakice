/**
 * Supabase Realtime 的最小客户端（只用到 broadcast）。
 *
 * 为什么手写：小程序没有原生 WebSocket 全局对象，@supabase/supabase-js 的 realtime 依赖
 * 浏览器的 WebSocket；uni.connectSocket 提供的是任务对象，接口不一样。
 * 协议本身很简单：Phoenix 通道 + 每 25 秒心跳，这里实现够用的一部分。
 *
 * 用途：房间内任何人做了动作就广播一条 poke，其他人立刻重新拉取，
 * 不必等 2 秒轮询。轮询仍然保留作为兜底——WS 断线时功能不受影响。
 */

const WS_PATH = '/realtime/v1/websocket'
const HEARTBEAT_MS = 25_000

export interface LiveChannel {
  /** 广播一条事件给同房间的其他人 */
  poke(event?: string, payload?: Record<string, unknown>): void
  close(): void
  readonly connected: boolean
}

interface ChannelOptions {
  roomId: string
  onPoke: (event: string, payload: Record<string, unknown>) => void
  onStatus?: (connected: boolean) => void
}

function baseUrl(): string {
  return String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
}

function anonKey(): string {
  return String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '')
}

/** 没配置后端时返回 null，调用方直接跳过（本机房间不需要） */
export function openLiveChannel(options: ChannelOptions): LiveChannel | null {
  const base = baseUrl()
  const key = anonKey()
  if (!base || !key) return null

  const topic = `realtime:room-${options.roomId}`
  const url = `${base.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')}${WS_PATH}?apikey=${encodeURIComponent(key)}&vsn=1.0.0`

  let socket: UniApp.SocketTask | null = null
  let closed = false
  let connected = false
  let ref = 0
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryDelay = 2000

  function nextRef(): string {
    ref += 1
    return String(ref)
  }

  function sendRaw(message: Record<string, unknown>) {
    if (!socket || !connected) return
    try {
      socket.send({ data: JSON.stringify(message) })
    } catch (error) {
      console.warn('[realtime] 发送失败', error)
    }
  }

  function stopHeartbeat() {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
  }

  function scheduleReconnect() {
    if (closed) return
    stopHeartbeat()
    if (retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      retryDelay = Math.min(retryDelay * 2, 30_000)
      connect()
    }, retryDelay)
  }

  function connect() {
    if (closed) return
    const task = uni.connectSocket({ url, complete: () => undefined })
    socket = task ?? null
    if (!task) {
      scheduleReconnect()
      return
    }

    task.onOpen(() => {
      connected = true
      retryDelay = 2000
      options.onStatus?.(true)
      task.send({
        data: JSON.stringify({
          topic,
          event: 'phx_join',
          payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' } } },
          ref: nextRef(),
          join_ref: '1',
        }),
      })
      stopHeartbeat()
      heartbeat = setInterval(() => {
        sendRaw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() })
      }, HEARTBEAT_MS)
    })

    task.onMessage((message) => {
      let parsed: { event?: string; payload?: Record<string, unknown> } | null = null
      try {
        parsed = JSON.parse(String(message.data))
      } catch {
        return
      }
      if (!parsed?.event) return
      if (parsed.event === 'broadcast') {
        const body = parsed.payload ?? {}
        const event = String(body.event ?? 'poke')
        const payload = (body.payload ?? {}) as Record<string, unknown>
        options.onPoke(event, payload)
      }
    })

    const onDown = () => {
      if (!connected) return
      connected = false
      options.onStatus?.(false)
      scheduleReconnect()
    }
    task.onClose(onDown)
    task.onError(onDown)
  }

  connect()

  return {
    get connected() {
      return connected
    },
    poke(event = 'poke', payload = {}) {
      sendRaw({
        topic,
        event: 'broadcast',
        payload: { type: 'broadcast', event, payload },
        ref: nextRef(),
      })
    },
    close() {
      closed = true
      stopHeartbeat()
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      try {
        socket?.close({})
      } catch {
        // 已经断了就不用管
      }
      socket = null
    },
  }
}
