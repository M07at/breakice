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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import DrawCanvas from '@/components/draw-canvas/draw-canvas.vue'
import Avatar from '@/components/Avatar.vue'
import PlayerIdentity from '@/components/PlayerIdentity.vue'
import { DrawEngine } from '@/modules/draw/engine'
import { ChunkPump } from '@/modules/draw/sync'
import type { DrawChunk } from '@/modules/draw/types'
import { disposeDrawRoom, startLocalDrawRoom } from '@/modules/draw/room'
import { DEFAULT_DRAW_SECONDS, normalizeDrawSeconds, readDrawPrompt } from '@/modules/draw/settings'
import { createDrawRoomScorer } from '@/services/drawScoring'
import type { DrawRoomView } from '@/modules/draw/room'
import type { LocalDrawRoomBackend } from '@/modules/draw/room'
import { roomApi } from '@/platform'
import { SupabaseRoomApi } from '@/platform/supabase'
import { fetchRoom } from '@/services/roomService'
import { useRoomStore } from '@/stores/room'
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

/**
 * 你画我猜的计分规则（产品口径）：
 * - 答对一题 +200（不按速度衰减）
 * - 作画者：每有一人猜对 +100
 * - AI 评分（100 分制）直接加在作画者身上，上限放宽到 2000
 */
const DRAW_SCORE = { aiWeight: 1, painterCap: 2000, perGuesser: 100, guesserBase: 200, guesserPerSecond: 0 }

const roomId = ref('')
const roomStore = useRoomStore()
let finishing = false
let finishRequested = false
let returning = false
let returnTimer: ReturnType<typeof setTimeout> | null = null
/** 玩法：普通 / Emoji / 自定义，由主持人在房间页选择 */
const drawVariant = ref<'classic' | 'emoji' | 'custom'>('classic')
const customText = ref('')
const drawSeconds = ref(DEFAULT_DRAW_SECONDS)
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

/** 座位号：同名玩家靠它区分（B 的视图里 players 顺序就是座位顺序） */
function mbtiOf(id: string | null | undefined) { return view.value?.players.find(p => p.id === id)?.mbti }
function seatOf(id: string): number {
  const index = view.value?.players.findIndex((player) => player.id === id) ?? -1
  return index >= 0 ? index + 1 : 0
}

/** 「名字 #座位」——同名时也能一眼分清，颜色也按座位走 */
function labelOf(id: string, fallback = ''): string {
  const player = view.value?.players.find((item) => item.id === id)
  const name = player?.name ?? fallback
  const seat = seatOf(id)
  return seat > 0 ? `${name} #${seat}` : name
}

function toneOf(id: string): string {
  const seat = seatOf(id)
  return seat > 0 ? `tone-${seat % 6}` : ''
}

/** 房间成员的形象（颁奖台用），从房间接口取 */
const avatarById = ref<Record<string, import('@/types/room').AvatarConfig>>({})
const ranking = computed(() => view.value?.ranking ?? [])
const podium = computed(() => ranking.value.slice(0, 3))
const restRows = computed(() => ranking.value.slice(3))
const ended = computed(() => view.value?.phase === 'ended')
function avatarOf(id: string) {
  return avatarById.value[id] ?? { color: 1, body: 1, mouth: 1, eyes: 1, hat: 1 }
}

const painterName = computed(() => {
  const painterId = view.value?.painterId
  if (!painterId) return '有人'
  return labelOf(painterId).split(' #')[0] || '有人'
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
/** 倒计时结束自动交画：画完不用手动点，和产品规则一致 */
let autoSubmitArmed = true
const autoSubmit = () => {
  const snapshot = view.value
  if (!snapshot || snapshot.phase !== 'drawing') return
  if (!myTurn.value || busy.value || !autoSubmitArmed) return
  autoSubmitArmed = false
  void submitDrawing()
}

const remain = computed(() => {
  const snapshot = view.value
  if (!snapshot || snapshot.phase === 'ended') return 0
  // endsAt 是服务端时间：先用偏差换成本机时间，再减，倒计时才会真的走
  return Math.max(0, Math.ceil((snapshot.endsAt - (clockTick.value + serverOffset.value)) / 1000))
})

/** 联机用的单人画布引擎：只画自己的这一张 */
watch(remain, (value) => {
  if (value <= 0) autoSubmit()
})

const painterEngine = new DrawEngine({ by: 'live-painter' })
/** 观战画布：把作画者广播来的分片重放出来 */
const viewerEngine = new DrawEngine({ by: 'live-viewer' })
const viewCanvasRef = ref<{ paint(): void } | null>(null)
let painterPump: ChunkPump | null = null
let offStroke: (() => void) | null = null
let endedTimer: ReturnType<typeof setTimeout> | null = null

onLoad((options) => {
  roomId.value = String(options?.room ?? '')
  const variant = String(options?.variant ?? '')
  if (variant === 'emoji' || variant === 'custom' || variant === 'classic') drawVariant.value = variant
  customText.value = readDrawPrompt(options?.customText)
  drawSeconds.value = normalizeDrawSeconds(options?.drawSeconds)
})

/** 收到新视图时统一处理：校正时钟、刷新画廊图片、同步私有题面 */
function adoptView(next: DrawRoomView) {
  const previous = view.value
  serverOffset.value = next.serverTime - Date.now()
  clockTick.value = Date.now()
  

  // 换了一轮就清掉上一轮读到的题面
  if (lastRoundKey !== next.roundKey) {
    lastRoundKey = next.roundKey
    remoteWord.value = ''
    autoSubmitArmed = true
    viewerEngine.reset()
  }
  view.value = next
  if (!previous || previous.phase !== next.phase || previous.roundKey !== next.roundKey) {
    void nextTick(() => uni.pageScrollTo({ scrollTop: 0, duration: 0 }))
  }
  error.value = ''
  if (next.phase === 'ended') {
    // 结算页常驻：不自动收尾、不自动返回，等玩家点「退出，回到大厅」，
    // 房主结束本局由大厅的「结束本局」触发。
    if (publisher) publisher.stop()
  }
  // 玩法以主持人发布出来的视图为准：其他人是自动进房的，URL 里没有 variant
  const published = (next as { variant?: string }).variant
  if (published === 'emoji' || published === 'custom' || published === 'classic') {
    drawVariant.value = published
  }
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
    avatarById.value = Object.fromEntries(room.players.map((player) => [player.id, player.avatar]))
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
        variant: drawVariant.value,
        customText: customText.value,
        drawSeconds: drawSeconds.value,
        players: room.players.map((player) => ({ id: player.id, name: player.nickname, mbti: player.mbti })),
        meId: meId.value,
        scoreConfig: DRAW_SCORE,
        scorer: createDrawRoomScorer({
          roomId: roomId.value,
          api: roomApi as SupabaseRoomApi,
          painterId: () => localBackend?.currentPainterId() ?? meId.value,
        }),
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
  if (returnTimer) clearTimeout(returnTimer)
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

function backToLobby() {
  if (returning) return
  returning = true
  uni.navigateBack({ delta: 1, fail: () => uni.reLaunch({ url: '/pages/room/index' }) })
}
function scheduleReturn() {
  // 结算页常驻：只停掉后台任务，不做任何跳转
  publisher?.stop()
  remoteDispose?.()
  if (tickTimer) clearInterval(tickTimer)
  // 结算页常驻，由玩家自己退出
}
async function finishDrawingSession(early = false) {
  if (finishing || !view.value || !isHost.value) return
  finishing = true
  finishRequested = true
  try {
    if (early && localBackend) view.value = await localBackend.end()
    await publisher?.flush()
    await (roomApi as SupabaseRoomApi).rpcCall('finish_draw_session', { p_room_id: roomId.value, p_game_key: view.value.gameId })
    scheduleReturn()
    await roomStore.refreshNow()
  } catch (issue) {
    error.value = issue instanceof Error ? issue.message : String(issue)
  } finally { finishing = false }
}
watch(() => roomStore.room?.phase, (phase, previous) => {
  // 房主在大厅结束本局 → 房间回 lobby，所有人退回大厅（结算页本身不自动跳）
  if (phase === 'lobby' && previous === 'playing') {
    uni.navigateBack({ delta: 1, fail: () => uni.reLaunch({ url: '/pages/room/index' }) })
  }
})

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
    // 画的人不能猜自己的题：B 的引擎本来就这么判，本地提示也要跟上
    const hit = !myTurn.value && Boolean(mine) && text.toLowerCase() === mine.toLowerCase()

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

/** 退出回大厅：房间仍是 playing，随时可以点「回到游戏」继续 */
function exitToLobby() {
  uni.navigateBack({ delta: 1, fail: () => uni.reLaunch({ url: '/pages/room/index' }) })
}

async function endSession() {
  finishRequested = false
  await finishDrawingSession(true)
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


    <view v-if="wordError" class="alert">{{ wordError }}</view>
    <view v-if="error" class="alert">{{ error }}</view>

    <view v-if="!view" class="surface empty">等待主持人开局…</view>

    <template v-else>
      <view v-if="!ended" class="drawing-countdown" :class="{ urgent: remain <= 5 }" role="timer">
        <text>{{ view.scoring ? 'AI 正在评分' : view.phase === 'reveal' ? '查看结果，随后换人' : '作画剩余' }}</text>
        <text v-if="!view.scoring" class="countdown-number">{{ remain }}<text class="countdown-unit"> 秒</text></text>
      </view>
      <view class="surface turn">
        <text class="label">{{ myTurn ? '轮到你画' : '正在作画' }} · <PlayerIdentity :name="painterName" :mbti="mbtiOf(view?.painterId)" /></text>
        <text class="muted">{{ view.scoring ? 'AI 正在识别画作，请稍候…' : `${hintText} · 剩余 ${remain} 秒` }}</text>
        <text v-if="myTurn && myWord" class="word">你的题：{{ myWord.word }}</text>
      </view>

      <view v-if="myTurn && view.phase === 'drawing'" class="surface">
        <DrawCanvas ref="canvasRef" :engine="painterEngine" :mode="view.scoring ? 'watch' : 'draw'" :variant="drawVariant" @error="error = $event" />
        <button class="primary" :disabled="busy || view.scoring" @click="submitDrawing">{{ view.scoring ? 'AI 评分中…' : busy ? '上传中…' : '交画' }}</button>
      </view>

      <view v-else-if="view.phase === 'drawing'" class="surface">
        <text class="label"><PlayerIdentity :name="painterName" :mbti="mbtiOf(view?.painterId)" /> 正在画</text>
        <DrawCanvas ref="viewCanvasRef" :engine="viewerEngine" mode="watch" :variant="drawVariant" :palette="view ? view.palette : undefined" @error="error = $event" />
      </view>

            <view v-if="ended" class="surface">
        <text class="label">最终排名</text>
        <text class="muted">本局已结束，5 秒后回到房间；下一局需要重新准备。</text>
        <button v-if="isHost" class="primary" @click="backToLobby">回到大厅 →</button>
        <view class="podium">
          <view v-for="(row, index) in podium" :key="row.playerId" class="podium-item" :class="'place-' + (index + 1)">
            <text class="medal">{{ index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉' }}</text>
            <Avatar :avatar="avatarOf(row.playerId)" size="large" />
            <text class="pname" :class="toneOf(row.playerId)"><PlayerIdentity :name="row.name" :mbti="mbtiOf(row.playerId)" /> #{{ seatOf(row.playerId) }}</text>
            <text class="pscore">{{ row.total }}</text>
          </view>
        </view>
        <view v-if="restRows.length" class="rank-table">
          <view class="tr th"><text>排名</text><text>昵称</text><text>得分</text></view>
          <view v-for="row in restRows" :key="row.playerId" class="tr">
            <text>{{ row.rank }}</text>
            <text :class="toneOf(row.playerId)"><PlayerIdentity :name="row.name" :mbti="mbtiOf(row.playerId)" /> #{{ seatOf(row.playerId) }}</text>
            <text>{{ row.total }}</text>
          </view>
        </view>
      </view>

      <view v-if="view.panel.length" class="surface">
        <text class="label">本轮作品</text>
        <view v-for="entry in view.panel" :key="entry.playerId" class="panel-row">
          <text class="name"><PlayerIdentity :name="entry.name" :mbti="mbtiOf(entry.playerId)" /> {{ entry.shortId }}</text>
          <image v-if="panelUrls[entry.imageRef]" class="shot" :src="panelUrls[entry.imageRef]" mode="widthFix" />
          <text class="muted">答案：{{ entry.answer }}<template v-if="entry.ai"> · {{ entry.ai.degraded ? '本轮未计 AI 分' : `AI ${entry.ai.score} 分` }}</template></text>
          <text v-if="entry.ai?.comment" class="muted">{{ entry.ai.comment }}</text>
          <view class="reactions">
            <button class="tiny" @click="react(entry.playerId, 'flower')">送花 {{ entry.flowers }}</button>
            <button class="tiny" @click="react(entry.playerId, 'dislike')">差评 {{ entry.dislikes }}</button>
          </view>
        </view>
      </view>

      <view class="surface">
        <text class="label">猜一猜</text>
        <view v-for="message in view.messages.slice(-8)" :key="message.id" class="message" :class="{ correct: message.kind === 'correct' }">
          <text class="who" :class="toneOf(message.playerId)"><PlayerIdentity :name="labelOf(message.playerId, message.playerName)" :mbti="mbtiOf(message.playerId)" /></text>
          <text class="text">{{ message.text }}</text>
        </view>
        <view v-if="!myTurn" class="input-row">
          <input v-model="guess" class="input" :disabled="view.scoring" placeholder="输入你的答案" confirm-type="send" @confirm="sendGuess" />
          <button class="primary small" :disabled="view.scoring" @click="sendGuess">发送</button>
        </view>
        <text v-else class="muted">这一轮你在画，不能猜自己的题</text>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page {
  padding: 24rpx;
}
.drawing-countdown { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; padding: 22rpx 28rpx; margin-bottom: 20rpx; border: 3rpx solid #4f8ef7; border-radius: 20rpx; background: #edf4ff; color: #2455a5; font-size: 28rpx; font-weight: 700; }
.countdown-number { font-size: 76rpx; line-height: 1; font-weight: 900; font-variant-numeric: tabular-nums; }
.countdown-unit { font-size: 28rpx; }
.drawing-countdown.urgent { background: #fff0ec; border-color: #d75535; color: #b53d24; }
.head {
  margin-bottom: 20rpx;
}
.eyebrow {
  display: block;
  color: var(--muted);
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
  color: var(--muted);
  font-size: 22rpx;
}
.surface {
  margin-bottom: 20rpx;
  padding: 24rpx;
  border-radius: var(--radius-md);
  background: var(--surface, #ffffff);
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
  color: var(--brand);
  font-size: 30rpx;
  font-weight: 800;
}
.primary {
  margin-top: 16rpx;
  border-radius: var(--radius-md, 20rpx);
  color: var(--surface, #ffffff);
  background: var(--brand);
  font-size: 28rpx;
}
.primary.small {
  margin-top: 0;
  padding: 0 24rpx;
  font-size: 24rpx;
}
.ghost {
  border-radius: var(--radius-md);
  color: var(--brand);
  background: var(--brand-soft);
  font-size: 24rpx;
}
.alert {
  margin-bottom: 16rpx;
  padding: 16rpx;
  border-radius: var(--radius-md);
  color: var(--danger);
  background: var(--brand-soft);
  font-size: 22rpx;
  word-break: break-all;
}
.empty {
  color: var(--muted);
  text-align: center;
}
.panel-row {
  margin-bottom: 16rpx;
}
.shot {
  display: block;
  width: 100%;
  margin: 8rpx 0;
  border-radius: var(--radius-md);
  background: var(--canvas);
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
  border-radius: var(--radius-md, 20rpx);
  color: var(--brand);
  background: var(--brand-soft);
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
  color: var(--muted);
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
  border-radius: var(--radius-md);
  background: var(--canvas);
  font-size: 26rpx;
}
.alert.debug { color: #1e3a8a; background: #e8effc; font-size: 20rpx; }
.tone-0 { color: var(--brand); }
.tone-1 { color: #0891b2; }
.tone-2 { color: var(--danger); }
.tone-3 { color: #15803d; }
.tone-4 { color: #7c3aed; }
.tone-5 { color: #b45309; }/* 颁奖台：1/2/3 名高度递减，图片用 Avatar 组件 */
.podium {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 16rpx;
  margin: 16rpx 0 24rpx;
}
.podium-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  padding: 16rpx 8rpx;
  border-radius: var(--radius-md, 20rpx);
  background: linear-gradient(180deg, #f5f7ff, #eef1fb);
}
.podium-item.place-1 {
  order: 2;
  padding-top: 24rpx;
  background: linear-gradient(180deg, var(--surface, #ffffff)7e0, #ffe9b8);
}
.podium-item.place-2 {
  order: 1;
  background: linear-gradient(180deg, #f3f5fa, #e3e7f0);
}
.podium-item.place-3 {
  order: 3;
  background: linear-gradient(180deg, #fdf1e7, #f6ddc8);
}
.medal {
  font-size: 40rpx;
}
.pname {
  margin-top: 6rpx;
  font-size: 22rpx;
  text-align: center;
}
.pscore {
  margin-top: 4rpx;
  color: var(--ink);
  font-size: 32rpx;
  font-weight: 800;
}
.rank-table {
  margin-top: 8rpx;
}
.tr {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 12rpx 8rpx;
  border-bottom: 1rpx solid var(--line);
  font-size: 24rpx;
}
.tr text:first-child {
  width: 60rpx;
  color: var(--muted);
}
.tr text:nth-child(2) {
  flex: 1;
}
.tr text:last-child {
  width: 100rpx;
  text-align: right;
  font-weight: 700;
}
.tr.th {
  color: var(--muted);
  font-size: 22rpx;
}</style>




























