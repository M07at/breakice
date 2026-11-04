import { roomApi } from '../platform'
import { PlatformError } from '../platform/types'
import { SupabaseRoomApi } from '../platform/supabase'
import { installPlayerPort } from '../modules/undercover/player'
import type { UcPlayerPort, UcPlayerSnapshot } from '../modules/undercover/player'
import type { Variant } from '../modules/undercover'

/**
 * 谁是卧底 / 你画我猜谁是卧底的**房间联机**接入。
 *
 * 服务端是 supabase/functions/uc-command：C 的引擎跑在 Edge Function 里，
 * 客户端只拿公开快照和自己的词，不再本地算局面。
 * 没配 Supabase 时（本机房间）没有服务端引擎，这里会直接报错，由页面提示。
 */

export const PLAYER_PAGE: Record<Variant, string> = {
  classic: '/pages-uc/player',
  draw: '/pages-uc/hybrid-player',
}

let activeRoomId = ''
let activeGameId = ''

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  if (roomApi.mode !== 'supabase') {
    throw new PlatformError('NOT_CONFIGURED', '联机谁是卧底需要 Supabase 后端，请先在 .env.local 里配置')
  }
  return (roomApi as SupabaseRoomApi).invokeFunction<T>('/functions/v1/uc-command', body)
}

function createPort(gameId: string, variant: Variant): UcPlayerPort {
  return {
    label: '房间联机',
    resumeUrl: PLAYER_PAGE[variant],
    load: () => invoke<UcPlayerSnapshot>({ op: 'tick', game_id: gameId }),
    getMyWord: (id) => invoke({ op: 'word', game_id: id }),
    act: (id, action, meta) => invoke<UcPlayerSnapshot>({ op: 'act', game_id: id, action, meta }),
    submitDrawing: (id, drawing, meta) =>
      invoke<UcPlayerSnapshot>({
        op: 'act',
        game_id: id,
        action: { type: 'drawingSubmitted', turnKey: meta.expectedTurnKey, drawingRef: drawing.preview },
        meta,
      }),
    replay: (requestId) => {
      if (!activeRoomId) throw new PlatformError('UNKNOWN', '请回到房间重新开始')
      return invoke<UcPlayerSnapshot>({
        op: 'start',
        room_id: activeRoomId,
        variant,
        request_id: requestId,
      })
    },
  }
}

function install(snapshot: UcPlayerSnapshot, variant: Variant) {
  installPlayerPort(createPort(snapshot.gameId, variant), variant)
}

/** 主持人开局：服务端建局、发牌，然后把端口装好，页面直接进玩家端 */
export async function startUndercoverRound(roomId: string, variant: Variant): Promise<UcPlayerSnapshot> {
  activeRoomId = roomId
  const snapshot = await invoke<UcPlayerSnapshot>({
    op: 'start',
    room_id: roomId,
    variant,
    request_id: `start-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  })
  install(snapshot, variant)
  activeGameId = snapshot.gameId
  return snapshot
}

/** 其他人：房间进入 playing 后，找到本房进行中的一局并接管 */
export async function adoptUndercoverRound(roomId: string, variant: Variant): Promise<UcPlayerSnapshot | null> {
  activeRoomId = roomId
  const result = await invoke<{ snapshot: UcPlayerSnapshot | null }>({ op: 'current', room_id: roomId })
  if (!result?.snapshot) return null
  install(result.snapshot, variant)
  activeGameId = result.snapshot.gameId
  return result.snapshot
}

/** 主持人提前结束本局：让服务端把 games.status 收尾，否则下一局会被 GAME_ACTIVE 挡住 */
export async function endUndercoverRound(): Promise<void> {
  if (!activeGameId) return
  await invoke({
    op: 'act',
    game_id: activeGameId,
    action: { type: 'endGame' },
    meta: { requestId: `end-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  activeGameId = ''
}
