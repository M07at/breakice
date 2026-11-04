<script setup lang="ts">
/**
 * 你画我猜 · 房间联机页。
 *
 * 主持人权威：主持人这台设备跑 B 的本机后端，并把视图发布到 0017 的 draw_sessions；
 * 其他人读视图、把自己的操作投进 draw_inbox。
 * 谁轮到作画，就在自己这台设备上画完、导出、上传，再以图片形式交上去。
 *
 * 只有本页用于房间模式；B 原来的 setup/play 单机流程不受影响。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import DrawCanvas from '@/components/draw-canvas/draw-canvas.vue'
import { DrawEngine } from '@/modules/draw/engine'
import { disposeDrawRoom, startLocalDrawRoom } from '@/modules/draw/room'
import type { DrawRoomView } from '@/modules/draw/room'
import type { LocalDrawRoomBackend } from '@/modules/draw/room'
import { roomApi } from '@/platform'
import { SupabaseRoomApi } from '@/platform/supabase'
import { fetchRoom } from '@/services/roomService'
import { createDrawPublisher } from '@/services/drawRemote'
import type { DrawRemoteApi, Publisher } from '@/services/drawRemote'
import { createRemoteDrawRoom, } from '@/services/drawRemote'
import { createSupabaseDrawApi, clearRemoteDrawRoom } from '@/services/drawRemoteApi'

interface CanvasApi {
  exportPng(): Promise<string>
  paint(): void
  reset(): void
}

const roomId = ref('')
const meId = ref('')
const isHost = ref(false)
const roomName = ref('')
const view = ref<DrawRoomView | null>(null)
const error = ref('')
const busy = ref(false)
const guess = ref('')
const panelUrls = ref<Record<string, string>>({})
const canvasRef = ref<CanvasApi | null>(null)

let api: DrawRemoteApi | null = null
let publisher: Publisher | null = null
let localBackend: LocalDrawRoomBackend | null = null
let offView: (() => void) | null = null
let remoteDispose: (() => void) | null = null

const myTurn = computed(() => Boolean(view.value && view.value.painterId === meId.value && view.value.phase === 'drawing'))
const painterName = computed(() => {
  const painter = view.value?.players.find((player) => player.id === view.value?.painterId)
  return painter?.name ?? '有人'
})
const myWord = computed(() => view.value?.word ?? null)
const hintText = computed(() => {
  const hint = view.value?.hint
  if (!hint) return ''
  return `${hint.chars} 个字${hint.category ? ` · ${hint.category}` : ''}`
})
const remain = computed(() => {
  const snapshot = view.value
  if (!snapshot || snapshot.phase !== 'drawing') return 0
  return Math.max(0, Math.round((snapshot.endsAt - snapshot.serverTime) / 1000))
})

/** 联机用的单人画布引擎：只画自己的这一张 */
const painterEngine = new DrawEngine({ by: 'live-painter' })

onLoad((options) => {
  roomId.value = String(options?.room ?? '')
})

onMounted(async () => {
  if (!roomId.value) {
    error.value = '缺少房间信息，请从房间大厅进入'
    return
  }
  try {
    const room = await fetchRoom(roomId.value)
    roomName.value = room.name
    meId.value = roomApi.identity().id
    isHost.value = room.hostId === meId.value
    api = createSupabaseDrawApi()

    if (isHost.value) {
      // 主持人：用房间真实名单开局，再把视图发布出去
      localBackend = await startLocalDrawRoom({
        playerCount: room.players.length,
        variant: 'classic',
        players: room.players.map((player) => ({ id: player.id, name: player.nickname })),
        meId: meId.value,
      })
      publisher = createDrawPublisher({
        roomId: roomId.value,
        api,
        backend: localBackend,
        onError: (issue) => console.warn('[live] 发布/消费失败', issue),
      })
      publisher.start()
      offView = localBackend.subscribe(() => {
        void localBackend?.view().then((next) => (view.value = next))
      })
      view.value = await localBackend.view()
    } else {
      const remote = createRemoteDrawRoom({
        roomId: roomId.value,
        api,
        meId: meId.value,
        onError: (issue) => console.warn('[live] 读取失败', issue),
      })
      remoteDispose = () => remote.dispose()
      offView = remote.subscribe((next) => {
        view.value = next
      })
      view.value = await remote.view()
    }
  } catch (issue) {
    error.value = issue instanceof Error ? issue.message : String(issue)
  }
})

onUnmounted(() => {
  offView?.()
  remoteDispose?.()
  publisher?.stop()
  disposeDrawRoom(localBackend)
})

/** 把 panel 里的 imageRef 换成可访问地址（私有桶签名链接） */
async function syncPanelUrls() {
  const entries = view.value?.panel ?? []
  if (roomApi.mode !== 'supabase') return
  const supabase = roomApi as SupabaseRoomApi
  const next = { ...panelUrls.value }
  for (const entry of entries) {
    if (!entry.imageRef || next[entry.imageRef]) continue
    try {
      next[entry.imageRef] = await supabase.signedArtworkUrl(entry.imageRef)
    } catch (issue) {
      console.warn('[live] 取画作地址失败', issue)
    }
  }
  panelUrls.value = next
}

async function submitDrawing() {
  if (busy.value || !canvasRef.value || !view.value) return
  busy.value = true
  error.value = ''
  try {
    const filePath = await canvasRef.value.exportPng()
    if (!filePath) throw new Error('还没画东西')
    const supabase = roomApi as SupabaseRoomApi
    const storagePath = `${roomId.value}/draw/${view.value.roundKey}/${meId.value}.png`
    await supabase.uploadArtwork(storagePath, filePath)
    // 主持人直接喂本机后端；其他人走指令队列
    if (localBackend) await localBackend.submitDrawing(storagePath)
    else await api?.postAction(roomId.value, 'submitDrawing', { imageRef: storagePath })
    view.value = await (localBackend ? localBackend.view() : api!.readView(roomId.value).then((r) => r?.view ?? view.value!))
    void syncPanelUrls()
  } catch (issue) {
    error.value = issue instanceof Error ? issue.message : String(issue)
  } finally {
    busy.value = false
  }
}

async function sendGuess() {
  const text = guess.value.trim()
  if (!text || !view.value) return
  guess.value = ''
  try {
    if (localBackend) await localBackend.sendMessage(text)
    else await api?.postAction(roomId.value, 'message', { text })
    if (localBackend) view.value = await localBackend.view()
  } catch (issue) {
    error.value = issue instanceof Error ? issue.message : String(issue)
  }
}

async function react(targetPlayerId: string, kind: 'flower' | 'dislike') {
  try {
    if (localBackend) await localBackend.sendReaction(targetPlayerId, kind)
    else await api?.postAction(roomId.value, 'reaction', { targetPlayerId, kind })
    if (localBackend) view.value = await localBackend.view()
  } catch (issue) {
    error.value = issue instanceof Error ? issue.message : String(issue)
  }
}

async function endSession() {
  publisher?.stop()
  await clearRemoteDrawRoom(roomId.value)
  uni.navigateBack({ delta: 1 })
}
</script>

<template>
  <view class="page">
    <view class="head row-between">
      <view>
        <text class="eyebrow">ROUND {{ (view?.roundIndex ?? 0) + 1 }}</text>
        <text class="title">你画我猜 · {{ roomName }}</text>
        <text class="muted">{{ isHost ? '主持人（本机权威）' : '联机观战' }} · {{ view?.players.length ?? 0 }} 人</text>
      </view>
      <button v-if="isHost" class="ghost" @click="endSession">结束</button>
    </view>

    <view v-if="error" class="alert">{{ error }}</view>

    <view v-if="!view" class="surface empty">等待主持人开局…</view>

    <template v-else>
      <view class="surface turn">
        <text class="label">{{ myTurn ? '轮到你画' : `${painterName} 正在画` }}</text>
        <text class="muted">{{ hintText }} · 剩余 {{ remain }} 秒</text>
        <text v-if="myTurn && myWord" class="word">你的题：{{ myWord.word }}</text>
      </view>

      <view v-if="myTurn && view.phase === 'drawing'" class="surface">
        <DrawCanvas ref="canvasRef" :engine="painterEngine" mode="draw" variant="classic" @error="error = $event" />
        <button class="primary" :disabled="busy" @click="submitDrawing">{{ busy ? '上传中…' : '交画' }}</button>
      </view>

      <view v-if="view.panel.length" class="surface">
        <text class="label">本轮作品</text>
        <view v-for="entry in view.panel" :key="entry.playerId" class="panel-row">
          <text class="name">{{ entry.name }}</text>
          <image v-if="panelUrls[entry.imageRef]" class="shot" :src="panelUrls[entry.imageRef]" mode="widthFix" />
          <text class="muted">答案：{{ entry.answer }}<template v-if="entry.ai"> · AI {{ entry.ai.score }} 分</template></text>
          <view class="reactions">
            <button class="tiny" @click="react(entry.playerId, 'flower')">送花 {{ entry.flowers }}</button>
            <button class="tiny" @click="react(entry.playerId, 'dislike')">差评 {{ entry.dislikes }}</button>
          </view>
        </view>
      </view>

      <view class="surface">
        <text class="label">猜一猜</text>
        <view v-for="message in view.messages.slice(-8)" :key="message.id" class="message" :class="{ correct: message.kind === 'correct' }">
          <text class="who">{{ message.playerName }}</text>
          <text class="text">{{ message.text }}</text>
        </view>
        <view class="input-row">
          <input v-model="guess" class="input" placeholder="输入你的答案" confirm-type="send" @confirm="sendGuess" />
          <button class="primary small" @click="sendGuess">发送</button>
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page {
  padding: 24rpx;
}
.head {
  margin-bottom: 20rpx;
}
.eyebrow {
  display: block;
  color: #8a8f9c;
  font-size: 20rpx;
  letter-spacing: 2rpx;
}
.title {
  display: block;
  margin-top: 6rpx;
  font-size: 34rpx;
  font-weight: 800;
}
.muted {
  display: block;
  margin-top: 6rpx;
  color: #8a8f9c;
  font-size: 22rpx;
}
.surface {
  margin-bottom: 20rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background: #fff;
}
.label {
  display: block;
  margin-bottom: 8rpx;
  font-size: 28rpx;
  font-weight: 700;
}
.word {
  display: block;
  margin-top: 12rpx;
  color: #4f46e5;
  font-size: 30rpx;
  font-weight: 800;
}
.primary {
  margin-top: 16rpx;
  border-radius: 14rpx;
  color: #fff;
  background: #4f46e5;
  font-size: 28rpx;
}
.primary.small {
  margin-top: 0;
  padding: 0 24rpx;
  font-size: 24rpx;
}
.ghost {
  border-radius: 12rpx;
  color: #4f46e5;
  background: #eef0ff;
  font-size: 24rpx;
}
.alert {
  margin-bottom: 16rpx;
  padding: 16rpx;
  border-radius: 12rpx;
  color: #c2410c;
  background: #fff1e6;
  font-size: 22rpx;
  word-break: break-all;
}
.empty {
  color: #8a8f9c;
  text-align: center;
}
.panel-row {
  margin-bottom: 16rpx;
}
.shot {
  display: block;
  width: 100%;
  margin: 8rpx 0;
  border-radius: 12rpx;
  background: #f6f8fb;
}
.name {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
}
.reactions {
  display: flex;
  gap: 12rpx;
  margin-top: 8rpx;
}
.tiny {
  padding: 0 16rpx;
  border-radius: 10rpx;
  color: #4f46e5;
  background: #eef0ff;
  font-size: 22rpx;
}
.message {
  display: flex;
  gap: 12rpx;
  padding: 8rpx 0;
  font-size: 24rpx;
}
.message.correct .text {
  color: #16a34a;
  font-weight: 700;
}
.who {
  color: #8a8f9c;
}
.input-row {
  display: flex;
  gap: 12rpx;
  margin-top: 12rpx;
}
.input {
  flex: 1;
  height: 72rpx;
  padding: 0 20rpx;
  border-radius: 12rpx;
  background: #f6f8fb;
  font-size: 26rpx;
}
</style>

