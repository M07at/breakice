<script setup lang="ts">
/**
 * 融合玩法里的「作画回合」：用 B 的真实画布替换 C 的模拟图形。
 *
 * 流程：画 → 导出 PNG → 上传 artworks 私有桶 → submit_artwork 建档
 *       → 交给端口提交 drawingSubmitted（并把 artworkId 带出去触发 AI 评分）。
 * 上传或建档失败时降级为「未交画」，不阻塞回合推进。
 */
import { computed, onUnmounted, ref } from 'vue'
import DrawCanvas from '@/components/draw-canvas/draw-canvas.vue'
import { DrawEngine } from '@/modules/draw/engine'
import type { HybridArtwork } from '@/modules/undercover/player'
import type { DrawingSubmission } from '@/modules/undercover/player'
import { prepareHybridArtwork } from '@/services/ucGame'
import { ChunkPump } from '@/modules/draw/sync'
import { onLivePoke, pokeRoom } from '@/services/liveRoom'
import type { DrawChunk } from '@/modules/draw/types'

const props = defineProps<{
  gameId: string
  turnKey: string
  /** 本轮已经画好的笔画（接力起点） */
  seedOps?: import('@/modules/draw/types').DrawOp[]
  /** 作画者 id：artworks 的唯一键是 (game_id, turn_key)，同一轮多人作画必须区分 */
  playerId: string
  editable: boolean
}>()

const emit = defineEmits<{ submit: [drawing: DrawingSubmission] }>()

interface CanvasApi {
  exportPng(): Promise<string>
  exportBase64(): Promise<string>
  paint(): void
  reset(): void
}

const canvasRef = ref<CanvasApi | null>(null)
let painterPump: ChunkPump | null = null
let offSync: (() => void) | null = null
const submitting = ref(false)
const errorText = ref('')
const scoreMode = ref<HybridArtwork['status']>('success')

const engine = new DrawEngine({ by: `hybrid-${props.gameId}-${props.turnKey}` })
// 接力画：把本轮上一位玩家的笔迹作为起点，自己接着画
if (props.seedOps && props.seedOps.length > 0) engine.loadSnapshot(props.seedOps)
/** 同一轮里每位玩家各有一幅，用 轮次#玩家 作为作品键 */
const artworkKey = `${props.turnKey}#${props.playerId}`
// 笔画实时广播：同房其他人用观战画布重放，别等到交画才看到
painterPump = new ChunkPump(
  engine,
  {
    send: (chunk: DrawChunk) => pokeRoom('hybrid-stroke', { chunk }),
    subscribe: () => () => undefined,
  },
  { intervalMs: 600 },
)
painterPump.start()

// 观战端重置画布后会请求一次全量笔画，这里把当前画布整份回过去
offSync = onLivePoke((event) => {
  if (event !== 'hybrid-sync') return
  pokeRoom('hybrid-snapshot', { ops: engine.snapshot() })
})

onUnmounted(() => {
  offSync?.()
  painterPump?.stop()
  painterPump = null
})
const canSubmit = computed(() => props.editable && !submitting.value)

// 交给父组件在倒计时结束时调用：画完不再手动点
defineExpose({ submitNow: () => submit() })

async function submit() {
  if (!canSubmit.value || !canvasRef.value) return
  submitting.value = true
  errorText.value = ''
  try {
    const filePath = await canvasRef.value.exportPng()
    if (!filePath) throw new Error('画布还没画东西')

    const { storagePath, artworkId } = await prepareHybridArtwork(props.gameId, artworkKey, filePath)
    emit('submit', { preview: storagePath, scoreMode: scoreMode.value === 'pending' ? 'success' : scoreMode.value, artworkId })
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '提交失败，请重试'
  } finally {
    submitting.value = false
  }
}

function clearCanvas() {
  if (!canvasRef.value) return
  canvasRef.value?.reset()
  // 通知观战端一起清空：增量分片里没有「清除」这种操作
  pokeRoom('hybrid-clear')
}
</script>

<template>
  <view class="uc-card">
    <view class="draw-head">
      <text class="uc-label">你的作画回合</text>
      <text class="uc-muted">{{ turnKey }} 号作品 · 倒计时结束自动提交</text>
    </view>

    <DrawCanvas ref="canvasRef" :engine="engine" mode="draw" variant="classic" @error="errorText = $event" />

    <text v-if="errorText" class="uc-note">{{ errorText }}</text>
  </view>
</template>

<style scoped>
.draw-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

.draw-actions {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 16rpx;
}

.draw-actions .uc-button {
  flex: 1;
}
</style>




