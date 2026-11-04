<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { onLoad, onShareAppMessage, onShow } from '@dcloudio/uni-app'
import { useRoomStore } from '../../stores/room'
import PlayerList from '../../components/PlayerList.vue'
import RoomCodeCard from '../../components/RoomCodeCard.vue'
import Leaderboard from '../../components/leaderboard/leaderboard.vue'
import { bankUrl, drawSetupUrl } from '../../services/gameEntry'
import { adoptUndercoverRound, endUndercoverRound, PLAYER_PAGE, startUndercoverRound } from '../../services/ucGame'
import { fetchRoomLeaderboard } from '../../services/scoreBoard'
import { toErrorMessage } from '../../platform/types'
import type { LeaderboardRow } from '../../modules/score'
import type { GameType } from '../../types/room'

const roomStore = useRoomStore()
const room = computed(() => roomStore.room)
const notice = ref('')
/** 临时诊断：点开局后这一行会显示走到哪一步，方便定位"点了没反应" */
const debugLine = ref('')
/** 本房累计积分（由 uc-command 结算时写入 scores，0010 聚合） */
const leaderboard = ref<LeaderboardRow[]>([])
const leaderboardVersion = ref(0)

async function loadLeaderboard() {
  const roomId = room.value?.id
  if (!roomId) return
  try {
    const rows = await fetchRoomLeaderboard(roomId)
    leaderboard.value = rows
    if (rows.length) leaderboardVersion.value += 1
  } catch (error) {
    console.warn('读取积分榜失败', error)
  }
}

onLoad(async () => {
  if (!roomStore.room) await roomStore.restore()
  await loadLeaderboard()
})

onShow(() => {
  if (roomStore.room) void roomStore.restore()
  void loadLeaderboard()
})

const GAME_LABEL: Record<GameType, string> = {
  'truth-or-dare': '真心话大冒险',
  drawing: '你画我猜',
  undercover: '谁是卧底',
  hybrid: '你画我猜谁是卧底',
}

const missingReady = computed(() => Math.max(0, roomStore.memberCount - roomStore.readyCount))

/** 每个玩法的最低人数：点之前先拦一道，别让用户白等一次服务端往返 */
const MIN_PLAYERS: Record<GameType, number> = {
  'truth-or-dare': 2,
  undercover: 4,
  hybrid: 4,
  drawing: 2,
}

function openPage(url: string) {
  uni.navigateTo({
    url,
    fail: (error) => {
      console.warn('打开页面失败', url, error)
      uni.showToast({ title: `打不开 ${url}`, icon: 'none' })
    },
  })
}

/** 真心话大冒险 / 你画我猜：页面自己开局，路由带上房间人数 */
function gameUrl(gameType: GameType): string {
  if (gameType === 'drawing') return drawSetupUrl(roomStore.memberCount)
  return '/pages/game/index'
}

const isUndercover = (gameType: GameType | null) => gameType === 'undercover' || gameType === 'hybrid'
const variantOf = (gameType: GameType): 'classic' | 'draw' => (gameType === 'hybrid' ? 'draw' : 'classic')

/**
 * 你画我猜目前只有单机版：B 的房间后端跑在客户端，多台设备各自开一局、互相看不到。
 * 在它接入服务端之前，这里明确告诉主持人是单机，避免误以为是联机。
 */
function confirmLocalDraw() {
  uni.showModal({
    title: '你画我猜（单机演示）',
    content: '联机版还没接入服务端：接下来只有你这台设备进入游戏，其他玩家的手机不会同步，他们也可以各自点开单机玩。',
    confirmText: '单机试玩',
    cancelText: '再等等',
    success: (result) => {
      if (result.confirm) void startLocalDraw()
    },
  })
}

async function startLocalDraw() {
  try {
    await roomStore.begin('drawing')
    await nextTick()
    openPage(drawSetupUrl(roomStore.memberCount))
  } catch (issue) {
    uni.showToast({ title: toErrorMessage(issue), icon: 'none' })
  }
}

async function hostStart(gameType: GameType) {
  const minPlayers = MIN_PLAYERS[gameType]
  console.log('[房间] 点击开局', gameType, {
    members: roomStore.memberCount,
    allReady: roomStore.allReady,
    isHost: roomStore.isHost,
    roomId: room.value?.id ?? '(空)',
  })
  notice.value = ''
  // 临时诊断：页面上能看到点击走到哪一步
  debugLine.value = `点击 ${gameType}｜人数=${roomStore.memberCount}｜已准备=${String(roomStore.allReady)}｜房间=${room.value?.id ? '有' : '无'}`

  // 谁是卧底 / 融合玩法可以用机器人补位，人数不够也能开局
  if (roomStore.memberCount < minPlayers && !isUndercover(gameType)) {
    uni.showToast({ title: `${GAME_LABEL[gameType]}至少要 ${minPlayers} 人`, icon: 'none' })
    debugLine.value += '｜拦截:人数不足'
    return
  }
  if (!roomStore.allReady) {
    uni.showToast({ title: `还有 ${missingReady.value} 人没准备`, icon: 'none' })
    notice.value = `开局前需要所有人在「准备状态」里点「我准备好了」`
    debugLine.value += '｜拦截:有人没准备'
    return
  }
  if (gameType === 'drawing') {
    confirmLocalDraw()
    return
  }

  if (isUndercover(gameType)) {
    if (!room.value) {
      uni.showToast({ title: '房间信息还没加载好，请稍后重试', icon: 'none' })
      debugLine.value += '｜拦截:房间为空'
      return
    }
    const variant = variantOf(gameType)
    const shortfall = Math.max(0, Math.min(3, 4 - roomStore.memberCount))
    try {
      // 人数不足直接补机器人，不再弹窗确认：少一个可能失败的环节
      if (shortfall > 0) {
        uni.showToast({ title: `人数不足，已补 ${shortfall} 个机器人`, icon: 'none' })
      }
      debugLine.value += `｜补位=${shortfall}｜请求中`
      uni.showLoading({ title: '正在开局…', mask: true })
      try {
        await startUndercoverRound(room.value.id, variant, shortfall)
      } finally {
        uni.hideLoading()
      }
      debugLine.value += '｜开局成功，正在进入游戏'
      roomStore.markPlaying(gameType)
      await nextTick()
      openPage(PLAYER_PAGE[variant])
    } catch (issue) {
      uni.hideLoading()
      const message = toErrorMessage(issue)
      console.error('[房间] 开局失败', issue)
      uni.showToast({ title: message, icon: 'none' })
      notice.value = `开局失败：${message}`
      debugLine.value += `｜失败:${message}`
    }
    return
  }

  try {
    await roomStore.begin(gameType)
    await nextTick()
    openPage(gameUrl(gameType))
  } catch (issue) {
    const message = toErrorMessage(issue)
    console.error('[房间] 开局失败', issue)
    uni.showToast({ title: message, icon: 'none' })
    notice.value = `开局失败：${message}`
  }
}

/** 回到正在进行的一局；谁是卧底要先把房间里的那局接管过来 */
async function enterCurrentGame() {
  const gameType = room.value?.gameType
  if (!gameType) return
  if (isUndercover(gameType) && room.value) {
    const variant = variantOf(gameType)
    try {
      const snapshot = await adoptUndercoverRound(room.value.id, variant)
      if (!snapshot) {
        uni.showToast({ title: '还没找到进行中的一局，稍后再试', icon: 'none' })
        return
      }
      openPage(PLAYER_PAGE[variant])
    } catch (issue) {
      uni.showToast({ title: toErrorMessage(issue), icon: 'none' })
    }
    return
  }
  if (gameType === 'drawing' && !roomStore.isHost) {
    // 单机版没有服务端房间，其他人跟进去只会各开一局，不如说清楚
    uni.showToast({ title: '你画我猜是单机演示，本局只在主持人设备上进行', icon: 'none' })
    return
  }
  openPage(gameUrl(gameType))
}

/** 别人按了开始：本端跟着进游戏（只在「大厅 → 进行中」这次跳转时触发） */
watch(
  () => room.value?.phase,
  (phase, previous) => {
    if (phase === 'playing' && previous === 'lobby' && !roomStore.isHost) void enterCurrentGame()
  },
)

async function finishRound() {
  // 谁是卧底的局在 games 表里，得先让服务端把它收尾，否则下一局会被 GAME_ACTIVE 挡住
  if (isUndercover(room.value?.gameType ?? null)) {
    try {
      await endUndercoverRound()
    } catch (issue) {
      console.warn('结束服务端局次失败', issue)
    }
  }
  await roomStore.finishGame()
  await loadLeaderboard()
  notice.value = '本局已结束，房间回到大厅'
}

function openBank() {
  openPage(bankUrl())
}

async function leaveRoom() {
  await roomStore.leave()
  uni.reLaunch({ url: '/pages/home/index' })
}

function goHome() {
  uni.reLaunch({ url: '/pages/home/index' })
}

onShareAppMessage(() => ({
  title: `${room.value?.name ?? '破冰局'}，等你来玩！`,
  path: `/pages/join/index?code=${room.value?.code ?? ''}`,
}))
</script>

<template>
  <view v-if="room" class="page room-page">
    <view class="room-heading row-between">
      <view>
        <text class="eyebrow">ROOM LOBBY</text>
        <text class="room-title">{{ room.name }}</text>
        <text class="room-platform">{{ roomStore.platformLabel }} · {{ roomStore.memberCount }}/{{ room.maxPlayers }} 人</text>
      </view>
      <button class="leave-btn" @click="leaveRoom">退出</button>
    </view>

    <view v-if="roomStore.error || notice" class="room-alert">{{ roomStore.error || notice }}</view>

    <RoomCodeCard :code="room.code" :room-name="room.name" />

    <view class="surface players-surface">
      <view class="section-title">
        <text>房间成员 <text class="count">{{ roomStore.memberCount }}/{{ room.maxPlayers }}</text></text>
        <text class="live-label">● 实时同步</text>
      </view>
      <PlayerList :players="room.players" :max-players="room.maxPlayers" show-host-badge />
    </view>

    <view v-if="leaderboard.length" class="surface leaderboard-surface">
      <Leaderboard :rows="leaderboard" :version="leaderboardVersion" :me="roomStore.currentPlayerId" :limit="5" />
    </view>

    <view v-if="!roomStore.playing" class="surface ready-surface">
      <view class="section-title">
        <text>准备状态</text>
        <text class="muted">{{ roomStore.readyCount }}/{{ roomStore.memberCount }} 已准备</text>
      </view>
      <button
        :class="['ready-btn', { active: roomStore.currentPlayer?.isReady }]"
        :loading="roomStore.busy"
        @click="roomStore.toggleReady"
      >
        {{ roomStore.currentPlayer?.isReady ? '已准备，取消准备' : '我准备好了' }}
      </button>
      <text v-if="roomStore.allReady" class="ready-hint ok">全员已准备，主持人可以开局</text>
      <text v-else class="ready-hint">还差 {{ missingReady }} 人准备</text>
    </view>

    <view v-if="roomStore.playing" class="surface playing-surface">
      <view class="section-title"><text>本局进行中</text><text class="live-label">{{ GAME_LABEL[room.gameType ?? 'truth-or-dare'] }}</text></view>
      <text class="muted">这一局以房间为单位进行，结束后回到大厅再开下一局。</text>
      <button class="btn btn-primary play-btn" @click="enterCurrentGame">回到游戏</button>
      <button v-if="roomStore.isHost" class="btn btn-ghost finish-btn" :loading="roomStore.busy" @click="finishRound">结束本局</button>
    </view>

    <view v-else-if="roomStore.isHost" class="surface host-surface">
      <text v-if="debugLine" class="debug-line">{{ debugLine }}</text>
      <view class="section-title">
        <text>主持人控制台</text>
        <text class="muted">{{ roomStore.allReady ? '可以开局' : `还差 ${missingReady} 人` }}</text>
      </view>
      <view :class="['game-choice', 'available', { dimmed: !roomStore.allReady }]" @click="hostStart('truth-or-dare')">
        <text class="choice-icon">🎡</text>
        <view class="choice-copy"><text class="choice-title">真心话大冒险</text><text class="choice-desc">转盘选人，随机抽题，轻松破冰</text></view>
        <text class="choice-arrow">›</text>
      </view>
      <view :class="['game-choice', 'available', { dimmed: !roomStore.allReady }]" @click="hostStart('undercover')">
        <text class="choice-icon">🕵️</text>
        <view class="choice-copy"><text class="choice-title">谁是卧底</text><text class="choice-desc">每人看自己的词，轮流描述后投票</text></view>
        <text class="choice-arrow">›</text>
      </view>
      <view :class="['game-choice', 'available', { dimmed: !roomStore.allReady }]" @click="hostStart('hybrid')">
        <text class="choice-icon">✏️</text>
        <view class="choice-copy"><text class="choice-title">你画我猜谁是卧底</text><text class="choice-desc">画作代替描述，再看谁画得不一样</text></view>
        <text class="choice-arrow">›</text>
      </view>
      <view :class="['game-choice', 'available', { dimmed: !roomStore.allReady }]" @click="hostStart('drawing')">
        <text class="choice-icon">🎨</text>
        <view class="choice-copy"><text class="choice-title">你画我猜</text><text class="choice-desc">轮流作画，聊天抢答，AI 评分与排行榜（单机演示）</text></view>
        <text class="choice-arrow">›</text>
      </view>
      <view class="tool-row" @click="openBank">
        <text class="tool-title">题库管理</text>
        <text class="tool-desc">谁是卧底与融合玩法共用同一套题库</text>
        <text class="choice-arrow">›</text>
      </view>
      <text class="integration-note">谁是卧底系列按「每人一台手机」设计，实时服务取决于后端；你画我猜目前是本机房间，同一台设备上只有「我」实际作画。</text>
    </view>

    <view v-else class="surface waiting-surface">
      <text class="ready-title">等主持人选玩法</text>
      <text class="ready-desc">房主开始游戏后，你的手机会自动进入对应的游戏页面。</text>
    </view>

    <text class="realtime-note">房间状态会自动同步，短暂断线后可恢复</text>
  </view>
  <view v-else class="page empty-page">
    <text class="title">{{ roomStore.connecting ? '正在找回房间…' : '房间不存在' }}</text>
    <button class="btn btn-primary" @click="goHome">返回首页</button>
  </view>
</template>

<style scoped>
.room-page {
  padding-top: 26rpx;
}

.room-heading {
  margin-bottom: 24rpx;
}

.room-title {
  display: block;
  margin-top: 8rpx;
  color: var(--ink);
  font-size: 38rpx;
  font-weight: 800;
}

.room-platform {
  display: block;
  margin-top: 6rpx;
  color: var(--muted);
  font-size: 21rpx;
}

.leave-btn {
  height: 58rpx;
  padding: 0 22rpx;
  border: 1rpx solid var(--line);
  border-radius: 14rpx;
  color: var(--muted);
  background: #fff;
  font-size: 22rpx;
  line-height: 58rpx;
}

.room-alert {
  margin-bottom: 18rpx;
  padding: 16rpx 20rpx;
  border-radius: 14rpx;
  color: #973c27;
  background: #fff0e8;
  font-size: 22rpx;
}

.players-surface,
.ready-surface,
.host-surface,
.playing-surface,
.waiting-surface,
.leaderboard-surface {
  margin-top: 24rpx;
}

.count {
  color: var(--brand);
}

.live-label {
  color: var(--mint);
  font-size: 21rpx;
  font-weight: 500;
}

.ready-btn {
  height: 84rpx;
  border-radius: 18rpx;
  color: #fff;
  background: var(--brand);
  font-size: 28rpx;
  font-weight: 700;
  line-height: 84rpx;
}

.ready-btn.active {
  color: var(--brand-deep);
  background: var(--brand-soft);
}

.ready-hint {
  display: block;
  margin-top: 14rpx;
  color: var(--muted);
  font-size: 21rpx;
  text-align: center;
}

.ready-hint.ok {
  color: #087d6a;
}

.game-choice {
  display: flex;
  align-items: center;
  min-height: 104rpx;
  padding: 16rpx;
  border: 1rpx solid var(--line);
  border-radius: 16rpx;
  background: #fff;
}

.game-choice + .game-choice {
  margin-top: 14rpx;
}

.game-choice.dimmed {
  opacity: 0.5;
}

.choice-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 62rpx;
  height: 62rpx;
  border-radius: 15rpx;
  background: #f2f4f8;
  font-size: 32rpx;
}

.choice-copy {
  flex: 1;
  margin-left: 16rpx;
}

.choice-title,
.choice-desc {
  display: block;
}

.choice-title {
  color: var(--ink);
  font-size: 26rpx;
  font-weight: 800;
}

.choice-desc {
  margin-top: 5rpx;
  color: var(--muted);
  font-size: 20rpx;
}

.choice-arrow {
  color: var(--brand);
  font-size: 42rpx;
}

.tool-row {
  display: flex;
  align-items: center;
  margin-top: 18rpx;
  padding: 20rpx 16rpx;
  border: 1rpx dashed var(--line);
  border-radius: 16rpx;
}

.tool-title {
  color: var(--ink);
  font-size: 25rpx;
  font-weight: 800;
}

.tool-desc {
  flex: 1;
  margin-left: 14rpx;
  color: var(--muted);
  font-size: 20rpx;
}

.integration-note {
  display: block;
  margin-top: 18rpx;
  color: var(--muted);
  font-size: 19rpx;
  line-height: 1.6;
}

.play-btn {
  margin-top: 20rpx;
}

.finish-btn {
  margin-top: 14rpx;
}

.ready-title,
.ready-desc {
  display: block;
}

.ready-title {
  color: var(--ink);
  font-size: 26rpx;
  font-weight: 800;
}

.ready-desc {
  margin-top: 8rpx;
  color: var(--muted);
  font-size: 22rpx;
  line-height: 1.6;
}

.realtime-note {
  display: block;
  margin-top: 28rpx;
  color: var(--muted);
  font-size: 20rpx;
  text-align: center;
}

.empty-page .btn {
  margin-top: 30rpx;
}
.debug-line { display: block; margin: 6rpx 0 14rpx; padding: 8rpx 12rpx; border-radius: 8rpx; color: #7c2d12; background: #fef3c7; font-size: 20rpx; word-break: break-all; }
</style>




