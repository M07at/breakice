<script setup lang="ts">
import type { Player } from '../types/room'
import Avatar from './Avatar.vue'
import PlayerIdentity from './PlayerIdentity.vue'

defineProps<{
  players: Player[]
  maxPlayers: number
  showHostBadge?: boolean
}>()
</script>

<template>
  <view class="player-list">
    <view v-for="player in players" :key="player.id" class="player-item">
      <view class="avatar-wrap">
        <Avatar :avatar="player.avatar" size="small" />
        <view :class="['online-dot', { offline: !player.online }]" />
      </view>
      <view class="player-copy">
        <view class="player-name-row">
          <text class="player-name"><PlayerIdentity :name="player.nickname" :mbti="player.mbti" /></text>
          <text v-if="showHostBadge && player.isHost" class="host-badge">房主</text>
        </view>
        <text class="player-state">{{ player.isReady ? '已准备' : '等待准备' }}</text>
      </view>
      <text :class="['ready-state', { ready: player.isReady }]">{{ player.isReady ? '✓' : '·' }}</text>
    </view>
    <view v-for="slot in Math.max(0, Math.min(4, maxPlayers - players.length))" :key="`empty-${slot}`" class="player-item empty">
      <view class="empty-avatar">+</view>
      <text class="player-state">等待加入</text>
    </view>
  </view>
</template>

<style scoped>
.player-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18rpx;
}

.player-item {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 20rpx 16rpx;
  border: 1rpx solid var(--line);
  border-radius: 18rpx;
  background: #fbfcff;
}

.player-item.empty {
  border-style: dashed;
}

.avatar-wrap {
  position: relative;
  flex: 0 0 auto;
}

.empty-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  border-radius: 18rpx;
  background: var(--brand-soft);
}

.empty-avatar {
  color: var(--brand);
  font-size: 36rpx;
}

.online-dot {
  position: absolute;
  right: -2rpx;
  bottom: -2rpx;
  width: 14rpx;
  height: 14rpx;
  border: 3rpx solid #fbfcff;
  border-radius: 50%;
  background: #16b890;
}

.online-dot.offline {
  background: #b9bfca;
}

.player-copy {
  min-width: 0;
  flex: 1;
  margin-left: 14rpx;
}

.player-name-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.player-name {
  overflow: hidden;
  color: var(--ink);
  font-size: 25rpx;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-badge {
  flex: 0 0 auto;
  padding: 3rpx 8rpx;
  border-radius: 8rpx;
  color: var(--brand);
  background: var(--brand-soft);
  font-size: 18rpx;
}

.player-state {
  display: block;
  margin-top: 5rpx;
  color: var(--muted);
  font-size: 21rpx;
}

.ready-state {
  color: #c3c8d2;
  font-size: 38rpx;
  font-weight: 700;
}

.ready-state.ready {
  color: var(--mint);
}
</style>
