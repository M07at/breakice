import { degradedScore, normalizeAiScore } from '../modules/draw/ai'
import type { AiScorer } from '../modules/draw/ai'
import type { SupabaseRoomApi } from '../platform/supabase'

interface Options {
  roomId: string
  api: Pick<SupabaseRoomApi, 'rpcCall' | 'invokeFunction'>
  painterId(): string
}

/** 主持人替当前作画者触发真实评分；题面只写私有通道，不进公开快照。 */
export function createDrawRoomScorer(options: Options): AiScorer {
  return {
    async score(request) {
      try {
        await options.api.rpcCall('publish_draw_word', {
          p_room_id: options.roomId, p_round_key: request.roundKey,
          p_user_id: options.painterId(), p_word: request.word,
        })
        const deadline = Date.now() + 60000
        do {
          const result = await options.api.invokeFunction<Record<string, unknown>>('/functions/v1/draw-score', {
            room_id: options.roomId, round_key: request.roundKey, image_ref: request.imageRef,
          })
          if (result.status === 'success') return normalizeAiScore(result)
          if (result.status !== 'pending') {
            return degradedScore(result.status === 'unsupported'
              ? '此题不在 AI 识别词库中，本轮不计 AI 分，猜题分正常计算。'
              : 'AI 评分暂不可用，本轮不计 AI 分，猜题分正常计算。')
          }
          if (Date.now() >= deadline) break
          await new Promise(resolve => setTimeout(resolve, 1000))
        } while (Date.now() < deadline)
        return degradedScore('AI 评分超时，本轮不计 AI 分，猜题分正常计算。')
      } catch (error) {
        console.warn('[draw-score] 评分失败', error instanceof Error ? error.message : '服务不可用')
        return degradedScore('AI 评分暂不可用，本轮不计 AI 分，猜题分正常计算。')
      }
    },
  }
}
