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
import { ChunkPump } from '@/modules/draw/sync'
import type { DrawChunk } from '@/modules/draw/types'
import { disposeDrawRoom, startLocalDrawRoom } from '@/modules/draw/room'
import type { DrawRoomView } from '@/modules/draw/room'
import type { LocalDrawRoomBackend } from '@/modules/draw/room'
import { roomApi } from '@/platform'
import { SupabaseRoomApi } from '@/platform/supabase'
import { fetchRoom } from '@/services/roomService'
import { createDrawPublisher } from '@/services/drawRemote'
import type { DrawRemoteApi, Publisher } from '@/services/drawRemote'
import { createRemoteDrawRoom, } from '@/services/drawRemote'
import { createSupabaseDrawApi, clearRemoteDrawRoom, publishDrawWord, readMyDrawWord } from '@/services/drawRemoteApi'
import { liveConnected, onLivePoke, pokeRoom } from '@/services/liveRoom'

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
/** 服务端时钟与本机时钟的偏差：倒计时按服务端时间算 */
const serverOffset = ref(0)
/** 每秒跳一次，用来驱动倒计时显示 */
const clockTick = ref(Date.now())

let api: DrawRemoteApi | null = null
let publisher: Publisher | null = null
let localBackend: LocalDrawRoomBackend | null = null
let offView: (() => void) | null = null
let remoteDispose: (() => void) | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null
let ticking = false

const myTurn = computed(() => Boolean(view.value && view.value.painterId === meId.value && view.value.phase === 'drawing'))
const painterName = computed(() => {
  const painter = view.value?.players.find((player) => player.id === view.value?.painterId)
  return painter?.name ?? '有人'
})
const remoteWord = ref('')
/** 题面通道出错时的提示（例如 0018 没跑） */
const wordError = ref('')
let lastRoundKey = ''
const myWord = computed(() => view.value?.word ?? (remoteWord.value ? { word: remoteWord.value } : null))
const hintText = computed(() => {
  const hint = view.value?.hint
  if (!hint) return ''
  return `${hint.chars} 个字${hint.category ? ` · ${hint.category}` : ''}`
})
const remain = computed(() => {
  const snapshot = view.value
  if (!snapshot || snapshot.phase !== 'drawing') return 0
  // endsAt 是服务端时间：先用偏差换成本机时间，再减，倒计时才会真的走
  return Math.max(0, Math.round((snapshot.endsAt - (clockTick.value + serverOffset.value)) / 1000))
})

/** 联机用的单人画布引擎：只画自己的这一张 */
const painterEngine = new DrawEngine({ by: 'live-painter' })
/** 观战画布：把作画者广播来的分片重放出来 */
const viewerEngine = new DrawEngine({ by: 'live-viewer' })
const viewCanvasRef = ref<{ paint(): void } | null>(null)
let painterPump: ChunkPump | null = null
let offStroke: (() => void) | null = null

onLoad((options) => {
  roomId.value = String(options?.room ?? '')
})

/** 收到新视图时统一处理：校正时钟、刷新画廊图片、同步私有题面 */
function adoptView(next: DrawRoomView) {
  serverOffset.value = next.serverTime - Date.now()
  clockTick.value = Date.now()
  // 换了一轮就清掉上一轮读到的题面
  if (lastRoundKey !== next.roundKey) {
    lastRoundKey = next.roundKey
    remoteWord.value = ''
  }
  view.value = next
  void syncPanelUrls()

  // 主持人：远程玩家作画时，把他的题面发到私有通道（视图里对别人不可见）
  if (isHost.value && localBackend && next.painterId !== meId.value) {
    const word = localBackend.currentWord()
    if (word) void publishDrawWord(roomId.value, next.roundKey, next.painterId, word)
  }

  // 作画者本人：从私有通道取自己的题
  if (!isHost.value && next.painterId === meId.value && !next.word && !remoteWord.value) {
    void readMyDrawWord(roomId.value, next.roundKey)
      .then((word) => {
        if (word) remoteWord.value = word
      })
      .catch((issue) => {
        wordError.value = issue instanceof Error ? issue.message : String(issue)
      })
  }

  // 作画者的笔画实时广播给其他人：轮到我就开泵，轮不到就停
  const drawing = next.phase === 'drawing'
  if (drawing && next.painterId === meId.value) {
    if (!painterPump) {
      painterPump = new ChunkPump(
        painterEngine,
        {
          send: (chunk: DrawChunk) => pokeRoom('stroke', { chunk }),
          subscribe: () => () => undefined,
        },
        { intervalMs: 600 },
      )
      painterPump.start()
    }
  } else if (painterPump) {
    painterPump.stop()
    painterPump = null
  }
}

onMounted(async () => {
  if (!roomId.value) {
    error.value = '缺少房间信息，请从房间大厅进入'
    return
  }
  try {
    const room = await fetchRoom(roomId.value)
    roomName.value = room.name
    // 用 currentUserId 而不是 identity()：后者在会话尚未建立时会返回 unauthenticated
    meId.value =
      roomApi.mode === 'supabase'
        ? await (roomApi as SupabaseRoomApi).currentUserId()
        : roomApi.identity().id
    isHost.value = room.hostId === meId.value
    api = createSupabaseDrawApi()

    // 倒计时每秒走一次
    clockTimer = setInterval(() => {
      clockTick.value = Date.now()
    }, 1000)

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
        void localBackend?.view().then((next) => adoptView(next))
      })
      // 权威时钟跑在主持人设备上：不 tick 的话倒计时归零也不会推进阶段
      tickTimer = setInterval(() => {
        if (ticking || !localBackend) return
        ticking = true
        localBackend
          .tick()
          .then((next) => adoptView(next))
          .catch((issue) => console.warn('[live] tick 失败', issue))
          .finally(() => {
            ticking = false
          })
      }, 250)
      adoptView(await localBackend.view())
    } else {
      const remote = createRemoteDrawRoom({
        roomId: roomId.value,
        api,
        meId: meId.value,
        onError: (issue) => console.warn('[live] 读取失败', issue),
      })
      remoteDispose = () => remote.dispose()
      offView = remote.subscribe((next) => adoptView(next))
      adoptView(await remote.view())
    }

    // 所有人都监听笔画广播（作画者自己收到自己的会 applyChunk 返回 0，不影响）
    offStroke = onLivePoke((event, payload) => {
      if (event !== 'stroke') return
      const chunk = (payload as { chunk?: DrawChunk }).chunk
      if (!chunk) return
      if (viewerEngine.applyChunk(chunk) > 0) viewCanvasRef.value?.paint()
    })
  } catch (issue) {
    error.value = issue instanceof Error ? issue.message : String(issue)
  }
})

onUnmounted(() => {
  offView?.()
  remoteDispose?.()
  publisher?.stop()
  if (tickTimer) clearInterval(tickTimer)
  if (clockTimer) clearInterval(clockTimer)
  tickTimer = null
  clockTimer = null
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
    const basePath = `${roomId.value}/draw/${view.value.roundKey}/${meId.value}`
    // 每轮一张，带上时间戳避免同名对象覆盖导致上传被判冲突
    const storagePath = `${basePath}-${Date.now()}.png`
    await supabase.uploadArtwork(storagePath, filePath)
    // 主持人直接喂本机后端；其他人走指令队列
    if (localBackend) {
      adoptView(await localBackend.submitDrawing(storagePath))
    } else {
      await api?.postAction(roomId.value, 'submitDrawing', { imageRef: storagePath })
      const snapshot = await api?.readView(roomId.value)
      if (snapshot) adoptView(snapshot.view)
    }
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
    // 本地先判断一次：服务端要等主持人处理队列再回传，自己先给个即时反馈
    const mine = myWord.value?.word ?? ''
    const hit = Boolean(mine) && text.toLowerCase() === mine.toLowerCase()

    if (localBackend) await localBackend.sendMessage(text)
    else await api?.postAction(roomId.value, 'message', { text })
    if (localBackend) adoptView(await localBackend.view())

    if (hit) uni.showToast({ title: '答对了！', icon: 'success' })
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

    <view class="alert debug">
      角色={{ isHost ? '主持人' : '观战' }}｜我={{ meId.slice(0, 6) }}｜阶段={{ view ? view.phase : '无视图' }}｜画者={{
        view ? view.painterId.slice(0, 6) : '-'
      }}｜轮次={{ view ? view.roundKey : '-' }}｜题面={{ myWord ? myWord.word : '空' }}｜通道={{
        liveConnected() ? '连' : '断'
      }}
    </view>

    <view v-if="wordError" class="alert">{{ wordError }}</view>
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

      <view v-else-if="view.phase === 'drawing'" class="surface">
        <text class="label">{{ painterName }} 正在画</text>
        <DrawCanvas ref="viewCanvasRef" :engine="viewerEngine" mode="watch" variant="classic" @error="error = $event" />
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
.alert.debug { color: #1e3a8a; background: #e8effc; font-size: 20rpx; }
</style>















