<script setup lang="ts">
import { computed } from 'vue'
import { onShareAppMessage } from '@dcloudio/uni-app'
import { useRoomStore } from '../../stores/room'
import PlayerList from '../../components/PlayerList.vue'
import RoomCodeCard from '../../components/RoomCodeCard.vue'
import { bankUrl, drawSetupUrl, undercoverSetupUrl } from '../../services/gameEntry'

const roomStore = useRoomStore()
const room = computed(() => roomStore.room)

/**
 * 统一的打开方式：跳转失败时给出可见提示。
 * 小程序里 navigateTo 失败（页面没打进分包、缓存里的旧产物等）默认是静默的，
 * 之前「点你画我猜没反应」就是这么被掩盖掉的。
 */
function openPage(url: string) {
  uni.navigateTo({
    url,
    fail: (error) => {
      console.warn('打开页面失败', url, error)
      uni.showToast({ title: `打不开 ${url}`, icon: 'none' })
    },
  })
}

function startTruthOrDare() {
  roomStore
    .begin('truth-or-dare')
    .then(() => uni.redirectTo({ url: '/pages/game/index' }))
    .catch((error: unknown) => uni.showToast({ title: `打不开真心话大冒险：${String(error)}`, icon: 'none' }))
}

/** 进入 C 模块的开设页；房间名单会作为座位昵称预填。 */
function startUndercover() {
  openPage(undercoverSetupUrl('classic', room.value?.players))
}

function startHybrid() {
  openPage(undercoverSetupUrl('draw', room.value?.players))
}

function openBank() {
  openPage(bankUrl())
}

/** 进入 B 的你画我猜开设页 */
function startDraw() {
  openPage(drawSetupUrl())
}

function leaveRoom() {
  roomStore.clear()
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
      </view>
      <button class="leave-btn" @click="leaveRoom">退出</button>
    </view>

    <RoomCodeCard :code="room.code" :room-name="room.name" />

    <view class="surface players-surface">
      <view class="section-title">
        <text>房间成员 <text class="count">{{ room.players.length }}/{{ room.maxPlayers }}</text></text>
        <text class="live-label">● 实时同步</text>
      </view>
      <PlayerList :players="room.players" :max-players="room.maxPlayers" show-host-badge />
    </view>

    <view v-if="roomStore.isHost" class="surface host-surface">
      <view class="section-title"><text>主持人控制台</text><text class="muted">{{ roomStore.readyCount }} 人已准备</text></view>
      <view class="game-choice selected" @click="startTruthOrDare">
        <text class="choice-icon">🎡</text>
        <view class="choice-copy"><text class="choice-title">真心话大冒险</text><text class="choice-desc">转盘选人，随机抽题，轻松破冰</text></view>
        <text class="choice-arrow">›</text>
      </view>
      <view class="game-choice available" @click="startUndercover">
        <text class="choice-icon">🕵️</text>
        <view class="choice-copy"><text class="choice-title">谁是卧底</text><text class="choice-desc">每人看自己的词，轮流描述后投票</text></view>
        <text class="choice-arrow">›</text>
      </view>
      <view class="game-choice available" @click="startHybrid">
        <text class="choice-icon">✏️</text>
        <view class="choice-copy"><text class="choice-title">你画我猜谁是卧底</text><text class="choice-desc">画作代替描述，再看谁画得不一样</text></view>
        <text class="choice-arrow">›</text>
      </view>
      <view class="game-choice available" @click="startDraw">
        <text class="choice-icon">🎨</text>
        <view class="choice-copy"><text class="choice-title">你画我猜</text><text class="choice-desc">轮流作画，聊天抢答，AI 评分与排行榜</text></view>
        <text class="choice-arrow">›</text>
      </view>
      <view class="tool-row" @click="openBank">
        <text class="tool-title">题库管理</text>
        <text class="tool-desc">谁是卧底与融合玩法共用同一套题库</text>
        <text class="choice-arrow">›</text>
      </view>
      <text class="integration-note">谁是卧底系列按「每人一台手机」设计，小程序端实时服务由 A 模块接入，H5 预览可用本地联调服务；你画我猜目前是本机房间，同一台设备上只有「我」实际作画，其余座位到点自动轮过。</text>
    </view>

    <view v-else class="ready-panel">
      <view><text class="ready-title">准备好了就告诉主持人</text><text class="ready-desc">房主开始游戏后会自动进入</text></view>
      <button :class="['ready-btn', { active: roomStore.currentPlayer?.isReady }]" @click="roomStore.toggleReady">{{ roomStore.currentPlayer?.isReady ? '已准备' : '准备' }}</button>
    </view>

    <text class="realtime-note">房间状态会自动同步，短暂断线后可恢复</text>
  </view>
  <view v-else class="page empty-page"><text class="title">房间不存在</text><button class="btn btn-primary" @click="goHome">返回首页</button></view>
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

.players-surface,
.host-surface {
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

.game-choice {
  display: flex;
  align-items: center;
  min-height: 104rpx;
  padding: 16rpx;
  border: 1rpx solid var(--line);
  border-radius: 16rpx;
}

.game-choice + .game-choice {
  margin-top: 14rpx;
}

.game-choice.selected {
  border-color: #c9c5ff;
  background: var(--brand-soft);
}

.game-choice.available {
  background: #fff;
}

.game-choice.disabled {
  opacity: 0.55;
}

.choice-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 62rpx;
  height: 62rpx;
  border-radius: 15rpx;
  background: #fff;
  font-size: 32rpx;
}

.game-choice.disabled .choice-icon {
  background: #f2f4f8;
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

.coming {
  color: var(--muted);
  font-size: 19rpx;
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

.ready-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: var(--radius-lg);
  background: var(--mint-soft);
}

.ready-title,
.ready-desc {
  display: block;
}

.ready-title {
  color: #087d6a;
  font-size: 25rpx;
  font-weight: 800;
}

.ready-desc {
  margin-top: 7rpx;
  color: #439b8b;
  font-size: 21rpx;
}

.ready-btn {
  min-width: 124rpx;
  height: 70rpx;
  border-radius: 16rpx;
  color: #fff;
  background: var(--mint);
  font-size: 25rpx;
  line-height: 70rpx;
}

.ready-btn.active {
  color: #087d6a;
  background: #fff;
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
</style>
