import { openLiveChannel } from '../platform/realtime'
import type { LiveChannel } from '../platform/realtime'

/**
 * 房间实时通道：房间内任何人做了动作就 poke 一下，其他人立刻刷新。
 *
 * 轮询仍然保留（2 秒）作为兜底，所以通道断了只是慢一点，不会丢功能。
 */
type Listener = (event: string, payload: Record<string, unknown>) => void

let channel: LiveChannel | null = null
let currentRoomId = ''
const listeners = new Set<Listener>()

function ensureChannel(roomId: string) {
  if (!roomId) return
  if (channel && currentRoomId === roomId) return
  channel?.close()
  currentRoomId = roomId
  channel = openLiveChannel({
    roomId,
    onPoke: (event, payload) => {
      for (const listener of listeners) {
        try {
          listener(event, payload)
        } catch (error) {
          console.warn('[live] 监听器出错', error)
        }
      }
    },
  })
}

/** 进入房间时调用；重复调用同一个房间不会重连 */
export function startLive(roomId: string) {
  ensureChannel(roomId)
}

export function stopLive() {
  channel?.close()
  channel = null
  currentRoomId = ''
}

/** 订阅别人的动作；返回取消订阅 */
export function onLivePoke(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 告诉同房间的其他人「有变化」，让他们立刻刷新 */
export function pokeRoom(event = 'poke', payload: Record<string, unknown> = {}) {
  channel?.poke(event, payload)
}

export function liveConnected(): boolean {
  return Boolean(channel?.connected)
}
