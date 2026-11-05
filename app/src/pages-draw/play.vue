<template>
  <view v-if="room && view" class="page">
    <!-- 题目 + 倒计时 -->
    <view class="topic-card">
      <view class="topic-top">
        <text class="topic-chip">{{ DRAW_VARIANT_LABEL[view.variant] }}</text>
        <text class="topic-timer" :class="{ urgent: remaining <= 10 && view.phase === 'drawing' }">
          {{ view.phase === 'ended' ? '结束' : remaining + 's' }}
        </text>
      </view>
      <text class="topic-word">{{ topicWord }}</text>
      <text class="topic-progress">第 {{ view.roundIndex + 1 }} / {{ view.players.length }} 位</text>
    </view>

    <!--
      提示框：浅黄色、居中、大字。字数和类别是公开信息，猜的人也要看得见。
      注意：这一行**高度必须恒定**——揭晓时只是里面的字没了，占位还在，
      否则画布会被顶得上下跳（之前"轮到玩家2时画布上移"就是这个原因）。
    -->
    <view v-if="view.phase !== 'ended'" class="hint-row">
      <view v-if="hintText" class="hint-box">
        <text class="hint-box-text">{{ hintText }}</text>
      </view>
    </view>

    <!-- 画布：揭晓时换成同样大小的图片（canvas 是小程序原生组件，会盖在弹窗上面） -->
    <draw-canvas
      v-if="view.phase === 'drawing'"
      ref="canvasRef"
      :engine="engine"
      :mode="isMyTurn ? 'draw' : 'watch'"
      :variant="view.variant"
      :palette="view.palette"
      @error="onCanvasError"
    />
    <view v-else-if="view.phase === 'reveal'" class="reveal-board" :class="{ 'with-emoji': view.variant === 'emoji' }">
      <view class="board-freeze">
        <image v-if="revealImage" class="board-freeze-img" :src="revealImage" mode="aspectFit" />
        <text v-else class="empty">这张没交画</text>
      </view>
    </view>

    <!-- 聊天 / 抢答：答对了单独显示成「XXX 回答正确」，答到词的字会被冰块遮住 -->
    <view v-if="view.phase === 'drawing'" class="section chat">
      <view class="section-title">聊天 / 抢答</view>
      <scroll-view scroll-y class="chat-list" :scroll-into-view="lastMessageId">
        <view
          v-for="m in view.messages"
          :id="m.id"
          :key="m.id"
          class="chat-item"
          :class="{ correct: m.kind === 'correct' }"
        >
          <text class="chat-who">{{ m.playerName }}<text class="chat-id">{{ m.shortId }}</text></text>
          <text v-if="m.kind === 'correct'" class="chat-correct">{{ m.text }}</text>
          <text v-else class="chat-text">{{ m.text }}</text>
        </view>
        <text v-if="view.messages.length === 0" class="empty">还没有人说话</text>
      </scroll-view>
      <view class="chat-input-row">
        <input
          v-model="draft"
          class="chat-input"
          placeholder="打字聊天或抢答"
          maxlength="40"
          confirm-type="send"
          @confirm="send"
        />
        <button size="mini" :disabled="sending" @tap="send">发送</button>
      </view>
    </view>

    <!-- 全部结束：汇总画面（每张画 + 答案 + AI 分 + 花/差评） + 排名 -->
    <block v-if="view.phase === 'ended'">
      <view class="section panel">
        <view class="section-title">本局汇总</view>
        <view v-for="entry in view.panel" :key="entry.playerId" class="panel-item">
          <view class="panel-head">
            <text class="panel-name">{{ entry.name }}<text class="panel-id">{{ entry.shortId }}</text></text>
            <text class="panel-ai">{{ entry.ai && !entry.ai.degraded ? entry.ai.score : '—' }}</text>
          </view>
          <view class="panel-answer-row">
            <text class="panel-answer-label">答案</text>
            <text class="panel-answer">{{ entry.answer || '没交画' }}</text>
          </view>
          <image v-if="entry.imageRef" class="panel-img" :src="entry.imageRef" mode="aspectFit" />
          <view class="panel-actions">
            <button size="mini" class="react-btn" @tap="react(entry.playerId, 'flower')">
              🌸 {{ entry.flowers }}
            </button>
            <button size="mini" class="react-btn" @tap="react(entry.playerId, 'dislike')">
              👎 {{ entry.dislikes }}
            </button>
          </view>
        </view>
      </view>

      <leaderboard :rows="view.ranking" :version="view.roundIndex + 1" />

      <view class="actions">
        <button size="mini" @tap="again">再来一局</button>
        <button size="mini" @tap="back">返回设置</button>
      </view>
    </block>

    <!-- 每画完一个人就弹一次：只有这一张，8 秒后自己收起，期间不开始下一位 -->
    <view v-if="view.phase === 'reveal'" class="modal-mask">
      <view class="modal-card">
        <view class="modal-head">
          <text class="modal-title">{{ painterName }} 画完了</text>
          <text class="modal-left">{{ remaining }}s</text>
        </view>
        <scroll-view scroll-y class="modal-body">
          <view v-for="entry in view.panel" :key="entry.playerId" class="panel-item">
            <view class="panel-head">
              <text class="panel-name">{{ entry.name }}<text class="panel-id">{{ entry.shortId }}</text></text>
              <text class="panel-ai">{{ entry.ai && !entry.ai.degraded ? entry.ai.score : '—' }}</text>
            </view>
            <view class="panel-answer-row">
              <text class="panel-answer-label">答案</text>
              <text class="panel-answer">{{ entry.answer || '没交画' }}</text>
            </view>
            <image v-if="entry.imageRef" class="panel-img" :src="entry.imageRef" mode="aspectFit" />
            <text v-else class="empty">这张没交画</text>
            <view class="panel-actions">
              <button size="mini" class="react-btn" @tap="react(entry.playerId, 'flower')">
                🌸 {{ entry.flowers }}
              </button>
              <button size="mini" class="react-btn" @tap="react(entry.playerId, 'dislike')">
                👎 {{ entry.dislikes }}
              </button>
            </view>
          </view>
        </scroll-view>
      </view>
    </view>
  </view>
  <view v-else class="page">
    <view class="empty">没找到对局，回设置页开一局</view>
    <button class="primary" @tap="back">回设置页</button>
  </view>
</template>

<script setup lang="ts">
/**
 * 你画我猜（联机形态）：每个人在自己手机上玩。
 *
 * 这台设备只是「我」一个玩家：
 * - 轮到我画 → 画布可画，有题面和提示；到点/点「都猜到了」自动交画
 * - 不是我的回合 → 只能看别人画（笔画走频道同步，见 `StrokeTransport`）
 * - 全部画完 → 服务端算分，这里显示每个人的 AI 分和排名
 *
 * 房间状态全部来自 `DrawRoomBackend`，页面不认识"谁在手机间传递"这件事。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import DrawCanvas from '@/components/draw-canvas/draw-canvas.vue'
import Leaderboard from '@/components/leaderboard/leaderboard.vue'
import { DrawEngine } from '@/modules/draw/engine'
import { DRAW_VARIANT_LABEL } from '@/modules/draw/words'
import { currentDrawRoom, disposeDrawRoom, startLocalDrawRoom } from '@/modules/draw/room'
import type { DrawReaction, DrawRoomView } from '@/modules/draw/room'

interface CanvasApi {
  paint(): void
  exportPng(): Promise<string>
  exportBase64(): Promise<string>
  reset(): void
}

/** 提示递进的解锁时间：前 30 秒只说几个字，之后再加上类别 */
const HINT_UNLOCK_SECONDS = 30

const room = currentDrawRoom()
const canvasRef = ref<CanvasApi | null>(null)
const view = ref<DrawRoomView | null>(null)

const now = ref(Date.now())
const submitting = ref(false)
const draft = ref('')
const sending = ref(false)

/** 消息列表自动滚到最新一条 */
const lastMessageId = computed(() => {
  const list = view.value?.messages ?? []
  return list.length > 0 ? list[list.length - 1].id : ''
})

let unsubscribe: (() => void) | undefined
let timer: ReturnType<typeof setInterval> | undefined
let cachedImage = ''
let preExporting = false
let ticking = false

const emptyEngine = new DrawEngine({ by: 'empty' })

const isMyTurn = computed(() => !!view.value && view.value.phase === 'drawing' && view.value.painterId === (room?.meId ?? ''))

/**
 * 自己画的时候用本机的 `actor` 引擎；看别人画的时候用 `viewer`（笔画由频道同步过来重放）。
 * 两个引擎分开，换人时不会把上一个人的画留在屏幕上。
 */
const engine = computed<DrawEngine>(() => {
  if (!room) return emptyEngine
  return isMyTurn.value ? room.actor : room.viewer
})

/** 揭晓时用一张静态图顶替画布（canvas 是原生组件，会盖在弹窗上面，答案就被挡住了） */
const revealImage = computed(() => {
  const v = view.value
  if (!v || v.phase !== 'reveal') return ''
  return v.panel[0]?.imageRef ?? ''
})

const painterName = computed(() => {
  const v = view.value
  if (!v) return ''
  return v.players.find((p) => p.id === v.painterId)?.name ?? ''
})

/** 题目卡上的大标题：自己画显示自己的词，别人画显示提示语，揭晓时显示「XX 画完了」 */
const topicWord = computed(() => {
  const v = view.value
  if (!v) return ''
  if (v.phase === 'ended') return '本局结束'
  if (v.phase === 'reveal') return `${painterName.value} 画完了`
  if (isMyTurn.value) return v.word ? v.word.word : ''
  return `轮到「${painterName.value}」画`
})

/**
 * 本机时钟和服务端时钟的偏差。房间状态里带 `serverTime`，每次收到就校正一次。
 * **不能**用「这一轮总时长 − 剩余」算已经过了多久：每次刷新视图都会把总时长重新算成剩余，
 * 计时器于是永远从 0 开始，30 秒的提示永远等不到。
 */
let clockOffset = 0

/** 服务端现在几点（用本地节拍 now 驱动，computed 才会跟着刷新） */
function serverNow(): number {
  return now.value + clockOffset
}

/** 收到新状态：顺便校准时钟 */
function applyView(next: DrawRoomView) {
  now.value = Date.now()
  clockOffset = next.serverTime - now.value
  view.value = next
}

const remaining = computed(() => {
  const v = view.value
  if (!v || v.phase === 'ended') return 0
  return Math.max(0, Math.ceil((v.endsAt - serverNow()) / 1000))
})

/** 这一轮已经过去多少秒（用服务端时钟，刷新视图不会把它归零） */
const elapsed = computed(() => {
  const v = view.value
  if (!v || v.phase === 'ended') return 0
  return Math.max(0, Math.floor((serverNow() - v.startedAt) / 1000))
})

/**
 * 提示只有两层，而且**绝不显示 emoji**：
 * - 0–30 秒：「3 个字」
 * - 30 秒后：「3 个字 · 动物」
 * 字数和类别是公开的（猜的人也需要），题面本身不下发。
 */
const hintText = computed(() => {
  const v = view.value
  if (!v || v.phase !== 'drawing') return ''
  const hint = v.hint
  if (!hint) return ''
  const chars = `${hint.chars} 个字`
  if (elapsed.value < HINT_UNLOCK_SECONDS) return chars
  return hint.category ? `${chars} · ${hint.category}` : chars
})

onLoad(async () => {
  if (!room) {
    uni.redirectTo({ url: '/pages-draw/setup' })
    return
  }
  // 别人画的时候，笔画同步过来要重画画布
  room.onStrokeChange = () => canvasRef.value?.paint()
  room.pump.start()
  unsubscribe = room.subscribe((v) => {
    applyView(v)
  })
  applyView(await room.view())
  timer = setInterval(onTimer, 250)
})

onUnload(() => {
  if (timer) clearInterval(timer)
  unsubscribe?.()
  if (room) disposeDrawRoom(room)
})

watch(remaining, (value) => {
  const v = view.value
  if (!v || v.phase !== 'drawing' || v.submittedByMe) return
  if (isMyTurn.value && value > 0 && value <= 3) void preExport()
})

// 换到下一个画家：画布清空重画（引擎是同一个实例，只是被 reset 了，组件不会自己发现）
watch(
  () => view.value?.roundIndex,
  () => {
    nextTick(() => canvasRef.value?.paint())
  },
)

/**
 * 所有人都猜到了 → 立刻交画，不必等倒计时。
 * 没有"交画"按钮：到点会自动交，猜完也会自动交。
 */
watch(
  () => view.value?.allGuessed,
  (guessed) => {
    if (guessed && isMyTurn.value && !view.value?.submittedByMe) void submit()
  },
)

function nameOf(playerId: string): string {
  return view.value?.players.find((p) => p.id === playerId)?.name ?? playerId
}

function onCanvasError(message: string) {
  uni.showToast({ title: message, icon: 'none' })
}

async function onTimer() {
  now.value = Date.now()
  const v = view.value
  if (!room || !v || v.phase === 'ended') return
  if (now.value < v.endsAt) return

  // 到点了：如果正好是我在画，先把自己的画交上去，再让房间推进
  if (isMyTurn.value && !v.submittedByMe) {
    await submit()
  }
  if (ticking) return
  ticking = true
  try {
    await room.tick()
  } finally {
    ticking = false
  }
}

/** 倒计时结束前先把图导出好，到点直接提交 */
async function preExport() {
  if (preExporting || cachedImage || !canvasRef.value) return
  preExporting = true
  try {
    cachedImage = await canvasRef.value.exportPng()
  } catch {
    // 导出失败就等提交时再试
  } finally {
    preExporting = false
  }
}

async function submit() {  if (!room || !isMyTurn.value || submitting.value) return
  submitting.value = true
  try {
    const imageRef = cachedImage || (await canvasRef.value?.exportPng()) || ''
    if (!imageRef) {
      uni.showToast({ title: '画布还没准备好', icon: 'none' })
      return
    }
    await room.submitDrawing(imageRef)
    cachedImage = ''
  } catch (error) {
    const message = error instanceof Error ? error.message : '交画失败，请再试一次'
    uni.showToast({ title: message, icon: 'none' })
  } finally {
    submitting.value = false
    await nextTick()
    canvasRef.value?.paint()
  }
}

/** 发一条聊天 / 抢答。答案里的字由后台遮成冰块，答对了会返回一条 correct */
async function send() {
  if (!room || sending.value) return
  const text = draft.value.trim()
  if (!text) return
  sending.value = true
  try {
    applyView(await room.sendMessage(text))
    draft.value = ''
  } catch (error) {
    const message = error instanceof Error ? error.message : '发送失败'
    uni.showToast({ title: message, icon: 'none' })
  } finally {
    sending.value = false
  }
}

/** 送花 / 点差评：只累加计数 */
async function react(targetPlayerId: string, kind: DrawReaction) {
  if (!room) return
  try {
    applyView(await room.sendReaction(targetPlayerId, kind))
  } catch {
    // 送不出去就算了，不影响结算
  }
}

async function again() {
  if (!room) return
  const settings = room.settings
  disposeDrawRoom(room)
  try {
    await startLocalDrawRoom(settings)
    uni.redirectTo({ url: '/pages-draw/play' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '开局失败'
    uni.showToast({ title: message, icon: 'none' })
  }
}

function back() {
  uni.redirectTo({ url: '/pages-draw/setup' })
}
</script>

<style>
@import '../styles/c-temp.css';

/* 题目卡：三行高度全部写死。文字在「自己的词 / 轮到别人画 / XX 画完了」之间切换，
   高度必须一致，否则下面的画布会跟着上下跳 */
.topic-card {
  margin-bottom: 14rpx;
  padding: 20rpx 26rpx 24rpx;
  border-radius: 20rpx;
  background: var(--surface, #ffffff);
  box-shadow: 0 6rpx 18rpx rgba(31, 35, 48, 0.06);
  text-align: center;
}
.topic-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56rpx;
}
.topic-chip {
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  background: #eef1ff;
  color: #3a55e6;
  font-size: 22rpx;
}
.topic-timer {
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1;
  color: #1f2330;
}
.topic-timer.urgent {
  color: #d93025;
}
.topic-word {
  display: block;
  height: 76rpx;
  margin-top: 6rpx;
  overflow: hidden;
  font-size: 48rpx;
  font-weight: 700;
  line-height: 76rpx;
  letter-spacing: 2rpx;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: #1f2330;
}
.topic-progress {
  display: block;
  height: 34rpx;
  line-height: 34rpx;
  color: var(--muted, #6c7588);
  font-size: 24rpx;
}

/* 提示框：浅黄底、居中、字号大一点，放在画布正上方。
   高度写死，揭晓时没有文字也照样占位，画布不会被顶动 */
.hint-row {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  margin-bottom: 16rpx;
}
.hint-box {
  padding: 18rpx 44rpx;
  border: 2rpx solid #ffe08a;
  border-radius: 18rpx;
  background: var(--surface, #ffffff)7d6;
  box-shadow: 0 6rpx 16rpx rgba(255, 200, 60, 0.18);
}
.hint-box-text {
  color: #7a4e00;
  font-size: 38rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
}


/* 聊天 / 抢答 */
.chat-list {
  height: 300rpx;
  padding: 8rpx 0;
  border-radius: 12rpx;
  background: #f7f8fc;
}
.chat-item {
  padding: 8rpx 16rpx;
}
.chat-who {
  color: var(--muted, #6c7588);
  font-size: 22rpx;
}
.chat-id {
  margin-left: 6rpx;
  color: #b3b8c4;
  font-size: 20rpx;
}
.chat-text {
  display: block;
  margin-top: 2rpx;
  color: #1f2330;
  font-size: 28rpx;
  word-break: break-all;
}
/* 答对了：一条醒目的方框 */
.chat-item.correct {
  margin: 8rpx 8rpx;
  border: 2rpx solid #86d6a8;
  border-radius: 12rpx;
  background: #eefaf2;
}
.chat-correct {
  display: block;
  margin-top: 4rpx;
  color: #1e8e4a;
  font-size: 30rpx;
  font-weight: 700;
}
.chat-input-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 12rpx;
}
.chat-input {
  flex: 1;
  height: 72rpx;
  padding: 0 20rpx;
  border: 1rpx solid #dfe2ea;
  border-radius: 12rpx;
  background: #fafbfd;
  font-size: 28rpx;
}
.chat-input-row button {
  margin: 0;
}

.result-card {
  margin-top: 16rpx;
}

/* 揭晓时顶替画布的静态图：尺寸和画布一致，页面不会跳 */
.reveal-board {
  width: 100%;
}
/* Emoji 版上面还有一条贴纸条（76rpx + 16rpx 间距），这里补上同样的空白 */
.reveal-board.with-emoji {
  padding-top: 92rpx;
}
.board-freeze {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 75vw;
  border-radius: 16rpx;
  background: var(--surface, #ffffff);
  box-shadow: 0 6rpx 18rpx rgba(31, 35, 48, 0.06);
}
.board-freeze-img {
  width: 100%;
  height: 100%;
  border-radius: 16rpx;
}

/* 公开答案弹窗 */
.modal-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 99;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40rpx;
  background: rgba(15, 18, 26, 0.55);
  box-sizing: border-box;
}
.modal-card {
  width: 100%;
  max-height: 82vh;
  padding: 24rpx;
  border-radius: 20rpx;
  background: var(--surface, #ffffff);
  box-sizing: border-box;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}
.modal-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #1f2330;
}
.modal-left {
  color: var(--muted, #6c7588);
  font-size: 24rpx;
}
.modal-body {
  max-height: 60vh;
}
.modal-foot {
  margin-top: 16rpx;
  text-align: center;
}
/* 公开答案面板 */
.panel-item {
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f0f1f5;
}
.panel-item:last-child {
  border-bottom: none;
}
.panel-head {
  display: flex;
  align-items: center;
}
.panel-name {
  flex: 1;
  font-size: 28rpx;
  font-weight: 600;
}
.panel-id {
  margin-left: 6rpx;
  color: #b3b8c4;
  font-size: 20rpx;
  font-weight: 400;
}
.panel-answer-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 8rpx;
}
.panel-answer-label {
  padding: 2rpx 14rpx;
  border-radius: 999rpx;
  background: #eef1ff;
  color: #3a55e6;
  font-size: 22rpx;
}
.panel-answer {
  color: #1f2330;
  font-size: 34rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
}
.panel-ai {
  width: 110rpx;
  color: #3a55e6;
  font-size: 32rpx;
  font-weight: 700;
  text-align: right;
}
.panel-img {
  width: 100%;
  height: 320rpx;
  margin-top: 10rpx;
  border-radius: 12rpx;
  background: #f7f8fc;
}
.panel-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 10rpx;
}
.panel-actions button {
  margin: 0;
  border: 1rpx solid #e6e8f0;
  border-radius: 999rpx;
  background: #fafbfd;
  font-size: 26rpx;
}
</style>
