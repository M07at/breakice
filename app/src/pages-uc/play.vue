<template>
  <view v-if="game && view" class="page">
    <view class="header">
      <view>
        <text class="card-title">{{ VARIANT_LABEL[view.variant] }}</text>
        <text class="hint">第 {{ view.round }} 轮 · {{ view.pkCandidates ? '加赛' : '' }}{{ PHASE_LABEL[view.phase] }}</text>
      </view>
      <text v-if="view.phase !== 'ended'" class="countdown" :class="{ urgent: remaining <= 5 }">{{ remaining }}s</text>
    </view>
    <text class="hint counts">{{ countsText }}</text>

    <view class="section">
      <view class="section-title">现在由谁操作（单机模式）</view>
      <scroll-view scroll-x class="chips">
        <view
          v-for="p in view.players"
          :key="p.id"
          class="chip"
          :class="{ active: p.id === me, out: !p.alive }"
          @tap="switchTo(p.id)"
        >
          {{ nameOf(p.id) }}
        </view>
      </scroll-view>
    </view>

    <view v-if="view.phase !== 'ended'" class="word-card" @tap="showWord = !showWord">
      <block v-if="showWord && secret">
        <text class="word">{{ secret.isBlank ? '你是白板' : secret.word }}</text>
        <text class="hint">{{ secret.isBlank ? '你没有词，听别人怎么说，别暴露自己' : '描述它，但别直接说出这个词' }}</text>
      </block>
      <text v-else class="hint">点一下查看「{{ nameOf(me) }}」的词，别让别人看到</text>
    </view>
    <view v-if="mePlayer && !mePlayer.alive && view.phase !== 'ended'" class="notice">
      {{ nameOf(me) }}已出局，可以继续旁观
    </view>

    <view v-if="view.phase === 'describe'" class="section">
      <view class="section-title">
        {{ view.pkCandidates ? '平票加赛：' : '' }}{{ view.variant === 'draw' ? '轮流作画' : '轮流描述' }}
      </view>
      <view class="speaker">
        <text class="speaker-name">{{ nameOf(view.currentSpeakerId) }}</text>
        <text class="hint">{{ view.variant === 'draw' ? '正在画' : '正在发言' }} · {{ seatOf(view.currentSpeakerId) }} 号位</text>
        <text class="hint">自我介绍卡：接入 D 的组件后显示头像、MBTI 和一句话介绍</text>
      </view>
      <view v-if="view.variant === 'draw'" class="canvas-placeholder">画布位置：接入 B 的画布组件后在这里作画 / 观看</view>
      <view class="order">
        <text
          v-for="(id, i) in view.speakOrder"
          :key="id"
          class="order-item"
          :class="{ done: i < speakerIndex, now: id === view.currentSpeakerId }"
        >
          {{ nameOf(id) }}
        </text>
      </view>
      <button v-if="isMyTurn" class="primary" @tap="finishTurn">{{ view.variant === 'draw' ? '画完了' : '说完了' }}</button>
      <view v-else class="hint">轮到「{{ nameOf(view.currentSpeakerId) }}」时切换到他来操作</view>
      <button v-if="isHost && !isMyTurn" size="mini" class="skip" @tap="act({ type: 'skipTurn' })">跳过当前玩家</button>
    </view>

    <view v-if="view.phase === 'vote'" class="section">
      <view class="section-title">{{ view.pkCandidates ? '加赛投票：只能投加赛的人' : '投出你认为的卧底' }}</view>
      <view v-if="view.variant === 'draw'" class="gallery">
        <view v-for="d in drawings" :key="d.id" class="gallery-item">
          <text>{{ nameOf(d.id) }}</text>
          <text class="hint">{{ d.ref ? '画作' : '没交画' }}</text>
        </view>
      </view>
      <view v-if="canVote" class="vote-grid">
        <view v-for="p in voteTargets" :key="p.id" class="vote-item" @tap="vote(p.id)">{{ nameOf(p.id) }}</view>
        <view class="vote-item abstain" @tap="vote(null)">弃权</view>
      </view>
      <view v-else class="notice">{{ voteBlockReason }}</view>
      <text class="hint">已投票 {{ votedCount }} / {{ voterCount }}</text>
    </view>

    <view v-if="view.phase === 'reveal' && view.lastResult" class="section">
      <view class="result">{{ resultText }}</view>
      <view class="ballots">
        <text v-for="b in view.lastResult.ballots" :key="b.voterId" class="ballot">
          {{ nameOf(b.voterId) }} → {{ b.targetId ? nameOf(b.targetId) : '弃权' }}
        </text>
      </view>
      <button v-if="isHost" class="primary" @tap="act({ type: 'next' })">{{ nextLabel }}</button>
      <text v-else class="hint">倒计时结束自动继续，主持人可以提前开始</text>
    </view>

    <view v-if="view.phase === 'ended'" class="section">
      <view class="result big">{{ endText }}</view>
      <text v-if="view.pair" class="hint">平民词「{{ view.pair.civilian }}」 · 卧底词「{{ view.pair.undercover }}」</text>
      <block v-if="finalVote">
        <text class="hint">最后一票：{{ resultText }}</text>
        <view class="ballots final">
          <text v-for="b in finalVote.ballots" :key="b.voterId" class="ballot">
            {{ nameOf(b.voterId) }} → {{ b.targetId ? nameOf(b.targetId) : '弃权' }}
          </text>
        </view>
      </block>
      <view class="table">
        <view v-for="p in view.players" :key="p.id" class="table-row">
          <text class="cell name">{{ nameOf(p.id) }}</text>
          <text class="cell">{{ p.role ? ROLE_LABEL[p.role] : '' }}</text>
          <text class="cell">{{ wordText(p) }}</text>
          <text class="cell">{{ fateText(p) }}</text>
          <text class="cell score">+{{ game.scores[p.id] || 0 }}</text>
        </view>
      </view>
      <view class="actions">
        <button class="primary" size="mini" @tap="again">再来一局</button>
        <button size="mini" @tap="back">返回</button>
      </view>
    </view>

    <button v-if="isHost && view.phase !== 'ended'" size="mini" class="danger end" @tap="confirmEnd">结束游戏</button>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { LOCAL_USER_ID, currentGame, startLocalGame } from '@/modules/local/session'
import { ENDING_LABEL, PHASE_LABEL, ROLE_LABEL, SIDE_LABEL, VARIANT_LABEL } from '@/modules/undercover'
import type { UcClientAction, UcPublicPlayer, UcPublicView, UcSecretView } from '@/modules/undercover'

const game = currentGame()
const view = ref<UcPublicView | null>(null)
const secret = ref<UcSecretView | null>(null)
const me = ref(LOCAL_USER_ID)
const showWord = ref(false)
const now = ref(Date.now())

let timer: ReturnType<typeof setInterval> | undefined
let unsubscribe: (() => void) | undefined
let tickedVersion = -1

onLoad(async () => {
  if (!game) {
    uni.redirectTo({ url: '/pages-uc/setup' })
    return
  }
  game.backend.me = me.value
  unsubscribe = game.backend.subscribe(game.gameId, (v) => {
    view.value = v
  })
  view.value = await game.backend.getView(game.gameId)
  await refreshSecret()
  timer = setInterval(onTimer, 250)
})

onUnload(() => {
  if (timer) clearInterval(timer)
  unsubscribe?.()
})

const nameOf = (id: string | null) => game?.players.find((p) => p.id === id)?.name ?? ''
const seatOf = (id: string | null) => (view.value?.players.find((p) => p.id === id)?.seat ?? 0) + 1

const remaining = computed(() => {
  const v = view.value
  if (!v || !v.phaseDeadline) return 0
  return Math.max(0, Math.ceil((v.phaseDeadline - now.value) / 1000))
})

const countsText = computed(() => {
  const c = view.value?.roleCounts
  if (!c) return ''
  return `卧底 ${c.undercover} 个 · ${c.blank ? `白板 ${c.blank} 个 · ` : ''}平民 ${c.civilian} 个`
})

const mePlayer = computed(() => view.value?.players.find((p) => p.id === me.value) ?? null)
const isHost = computed(() => me.value === LOCAL_USER_ID)
const isMyTurn = computed(() => view.value?.phase === 'describe' && view.value.currentSpeakerId === me.value)
const speakerIndex = computed(() => (view.value ? view.value.speakOrder.indexOf(view.value.currentSpeakerId ?? '') : -1))

const drawings = computed(() => {
  const v = view.value
  if (!v) return []
  return Object.entries(v.drawings[v.turnKey] ?? {}).map(([id, ref]) => ({ id, ref }))
})

const canVote = computed(() => !!mePlayer.value && mePlayer.value.canVote && !mePlayer.value.hasVoted)
const voteTargets = computed(() => {
  const v = view.value
  if (!v) return []
  return v.players.filter(
    (p) => p.alive && p.id !== me.value && (!v.pkCandidates || v.pkCandidates.includes(p.id)),
  )
})
const voterCount = computed(() => view.value?.players.filter((p) => p.canVote).length ?? 0)
const votedCount = computed(() => view.value?.players.filter((p) => p.canVote && p.hasVoted).length ?? 0)
const voteBlockReason = computed(() => {
  const p = mePlayer.value
  if (!p) return ''
  if (p.hasVoted) return '已投票，等其他人投完'
  if (!p.alive) return '出局的玩家不能投票'
  return '加赛中的玩家这一轮不投票'
})

const resultText = computed(() => {
  const r = view.value?.lastResult
  if (!r) return ''
  if (r.eliminatedId) {
    const role = view.value?.players.find((p) => p.id === r.eliminatedId)?.role
    return `「${nameOf(r.eliminatedId)}」出局，身份是${role ? ROLE_LABEL[role] : ''}`
  }
  if (r.tied && !r.pk) return `${r.tied.map((id) => `「${nameOf(id)}」`).join('')}平票，进入加赛`
  if (r.tied) return '加赛又平票，本轮没人出局'
  return '没人投票，本轮没人出局'
})
const nextLabel = computed(() => {
  const r = view.value?.lastResult
  return r && r.tied && !r.pk ? '开始加赛' : '下一轮'
})

/** 因为投票分出胜负时，结算页也展示这一票 */
const finalVote = computed(() => {
  const v = view.value
  const r = v?.lastResult
  return v && r && v.endedReason === 'win' && r.round === v.round && r.eliminatedId ? r : null
})

const endText = computed(() => {
  const v = view.value
  if (!v) return ''
  if (!v.winner) return ENDING_LABEL.host_ended
  return v.endedReason === 'max_rounds' ? `${SIDE_LABEL[v.winner]}（${ENDING_LABEL.max_rounds}）` : SIDE_LABEL[v.winner]
})

function wordText(p: UcPublicPlayer) {
  return p.word === null ? '（白板）' : p.word ?? ''
}

function fateText(p: UcPublicPlayer) {
  if (p.alive) return '存活'
  return p.out?.reason === 'left' ? `第 ${p.out.round} 轮退出` : `第 ${p.out?.round ?? 0} 轮出局`
}

async function refreshSecret() {
  if (!game) return
  secret.value = await game.backend.getMyWord(game.gameId)
}

function switchTo(id: string) {
  if (!game) return
  game.backend.me = id
  me.value = id
  showWord.value = false
  refreshSecret()
}

async function run(fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '操作失败', icon: 'none' })
  }
}

function act(action: UcClientAction) {
  if (!game) return Promise.resolve()
  return run(() => game.backend.act(game.gameId, action))
}

function vote(targetId: string | null) {
  return act({ type: 'vote', targetId })
}

async function finishTurn() {
  const v = view.value
  if (!game || !v) return
  if (v.variant === 'draw') {
    // B 的画布接入前先交一个占位画作
    await act({ type: 'drawingSubmitted', turnKey: v.turnKey, drawingRef: `placeholder:${v.turnKey}:${me.value}` })
  }
  await act({ type: 'turnDone' })
}

async function onTimer() {
  now.value = Date.now()
  const v = view.value
  if (!game || !v || v.phase === 'ended' || !v.phaseDeadline) return
  if (now.value >= v.phaseDeadline && tickedVersion !== v.version) {
    tickedVersion = v.version
    await run(() => game.backend.tick(game.gameId))
  }
}

function confirmEnd() {
  uni.showModal({
    title: '结束游戏',
    content: '提前结束不计分，确定吗？',
    success: (r) => {
      if (r.confirm) act({ type: 'endGame' })
    },
  })
}

async function again() {
  if (!game) return
  await run(async () => {
    await startLocalGame(game.options)
    uni.redirectTo({ url: '/pages-uc/play' })
  })
}

function back() {
  uni.navigateBack()
}
</script>

<style>
@import '../styles/c-temp.css';

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.counts {
  margin-bottom: 24rpx;
}
.countdown {
  font-size: 48rpx;
  font-weight: 700;
  color: #3a55e6;
}
.countdown.urgent {
  color: #d93025;
}
.word-card {
  margin-bottom: 24rpx;
  padding: 40rpx 24rpx;
  border-radius: 16rpx;
  background: #1f2330;
  color: #fff;
  text-align: center;
}
.word {
  display: block;
  font-size: 56rpx;
  font-weight: 700;
}
.speaker {
  padding: 24rpx;
  border-radius: 12rpx;
  background: #eef1ff;
}
.speaker-name {
  font-size: 36rpx;
  font-weight: 700;
}
.canvas-placeholder {
  margin-top: 16rpx;
  padding: 80rpx 24rpx;
  border: 2rpx dashed #c5cad6;
  border-radius: 12rpx;
  color: #8a8f9c;
  text-align: center;
}
.order {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin: 20rpx 0;
}
.order-item {
  padding: 6rpx 16rpx;
  border-radius: 8rpx;
  background: #eef0f5;
  font-size: 24rpx;
}
.order-item.done {
  opacity: 0.45;
}
.order-item.now {
  background: #3a55e6;
  color: #fff;
}
.skip {
  margin-top: 16rpx;
}
.gallery,
.vote-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-bottom: 16rpx;
}
.gallery-item {
  width: 200rpx;
  padding: 20rpx;
  border: 2rpx dashed #c5cad6;
  border-radius: 12rpx;
  text-align: center;
}
.vote-item {
  min-width: 180rpx;
  padding: 24rpx 16rpx;
  border-radius: 12rpx;
  background: #eef1ff;
  color: #3a55e6;
  font-weight: 600;
  text-align: center;
}
.vote-item.abstain {
  background: #eef0f5;
  color: #5c6170;
}
.result {
  margin-bottom: 16rpx;
  font-size: 32rpx;
  font-weight: 600;
}
.result.big {
  font-size: 40rpx;
  color: #3a55e6;
}
.ballots {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-bottom: 16rpx;
}
.ballots.final {
  margin-top: 12rpx;
}
.ballot {
  padding: 6rpx 14rpx;
  border-radius: 8rpx;
  background: #f5f6fa;
  font-size: 24rpx;
}
.table {
  margin-top: 16rpx;
}
.table-row {
  display: flex;
  padding: 12rpx 0;
  border-bottom: 1rpx solid #eef0f5;
  font-size: 24rpx;
}
.cell {
  flex: 1;
}
.cell.name {
  flex: 1.6;
}
.cell.score {
  flex: 0.6;
  color: #1e8e4a;
  text-align: right;
}
.end {
  display: block;
  margin-top: 16rpx;
}
</style>
