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

function requireApi(): SupabaseRoomApi {
  if (roomApi.mode !== 'supabase') {
    throw new PlatformError('NOT_CONFIGURED', '画作上传需要 Supabase 后端')
  }
  return roomApi as SupabaseRoomApi
}

/**
 * 画作上传 + 建档：返回 Storage 路径（写进引擎的 drawingRef）和 artworks.id（用来要 AI 评分）。
 * 路径必须是 {room_id}/{game_id}/{turn_key}/{user_id}.png —— 0005 的桶策略拿第一段当房间号校验，
 * 第一段写成 game_id 会被 RLS 直接拒绝。
 */
export async function prepareHybridArtwork(
  gameId: string,
  turnKey: string,
  filePath: string,
): Promise<{ storagePath: string; artworkId?: string }> {
  // 本机调试（没配 Supabase）：不上传，直接用本地临时文件当预览，方便验画布
  if (roomApi.mode !== 'supabase') return { storagePath: filePath }
  const api = requireApi()
  if (!activeRoomId) throw new PlatformError('UNKNOWN', '缺少房间信息，无法上传画作')
  const userId = await api.currentUserId()
  const storagePath = `${activeRoomId}/${gameId}/${turnKey}/${userId}.png`
  await api.uploadArtwork(storagePath, filePath)
  const artworkId = await api.rpcCall<string>('submit_artwork', {
    p_game_id: gameId,
    p_turn_key: turnKey,
    p_storage_path: storagePath,
  })
  return { storagePath, artworkId }
}

/** 把 artworks 里的路径换成临时可访问地址（私有桶，默认 1 小时） */
export async function resolveArtworkUrls(
  items: { id: string; preview: string }[],
): Promise<Record<string, string>> {
  if (roomApi.mode !== 'supabase' || items.length === 0) return {}
  const api = roomApi as SupabaseRoomApi
  const pairs = await Promise.all(
    items.map(async (item) => {
      // 只有真实画作是路径；模拟适配器放的是图形符号，跳过
      if (!item.preview || !item.preview.includes('/')) return [item.id, ''] as const
      try {
        return [item.id, await api.signedArtworkUrl(item.preview)] as const
      } catch {
        return [item.id, ''] as const
      }
    }),
  )
  return Object.fromEntries(pairs.filter(([, url]) => url))
}

function createPort(gameId: string, variant: Variant): UcPlayerPort {
  return {
    label: '房间联机',
    resumeUrl: PLAYER_PAGE[variant],
    load: () => invoke<UcPlayerSnapshot>({ op: 'tick', game_id: gameId }),
    getMyWord: (id) => invoke({ op: 'word', game_id: id }),
    act: (id, action, meta) => invoke<UcPlayerSnapshot>({ op: 'act', game_id: id, action, meta }),
    submitDrawing: async (id, drawing, meta) => {
      const submitted = await invoke<UcPlayerSnapshot>({
        op: 'act',
        game_id: id,
        action: { type: 'drawingSubmitted', turnKey: meta.expectedTurnKey, drawingRef: drawing.preview },
        meta,
      })
      // 画作已入库，再要一次 AI 评分；评分失败/超时不影响回合推进
      if (!drawing.artworkId) return submitted
      try {
        const ai = await requireApi().scoreArtwork(drawing.artworkId)
        if (ai?.status === 'success' && typeof ai.total === 'number') {
          const view = submitted.view
          return await invoke<UcPlayerSnapshot>({
            op: 'act',
            game_id: id,
            action: {
              type: 'aiScored',
              playerId: submitted.playerId,
              turnKey: meta.expectedTurnKey,
              score: ai.total,
            },
            meta: {
              requestId: `${meta.requestId ?? 'draw'}-ai`,
              expectedVersion: view.version,
              expectedPhase: view.phase,
              expectedRound: view.round,
              expectedTurnKey: view.turnKey,
            },
          })
        }
        console.warn('[uc] AI 评分未成功', ai?.status)
      } catch (error) {
        console.warn('[uc] AI 评分异常', error)
      }
      return submitted
    },
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
  // 服务端可能返回 { snapshot } 也可能直接返回快照（旧部署），两种都认
  const result = await invoke<{ snapshot?: UcPlayerSnapshot | null } & Partial<UcPlayerSnapshot>>({
    op: 'current',
    room_id: roomId,
  })
  const snapshot = result?.snapshot ?? (result?.gameId ? (result as UcPlayerSnapshot) : null)
  if (!snapshot?.gameId) return null
  install(snapshot, variant)
  activeGameId = snapshot.gameId
  return snapshot
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


