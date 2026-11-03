<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useRoomStore } from '../../stores/room'
import Avatar from '../../components/Avatar.vue'
import { getSavedProfile } from '../../services/avatarService'

const roomStore = useRoomStore()
const roomCode = ref('')

/** 形象和昵称统一在首页设置，这里只读取，不再重复编辑 */
const profile = getSavedProfile()

function applyRoomCode(value: string) {
  const queryCode = value.match(/[?&]code=([^&#]+)/)?.[1]
  roomCode.value = decodeURIComponent(queryCode ?? value).slice(0, 6).toUpperCase()
}

function scanCode() {
  // #ifdef MP-WEIXIN
  uni.scanCode({
    onlyFromCamera: true,
    scanType: ['qrCode'],
    success: (result) => applyRoomCode(result.result),
    fail: () => uni.showToast({ title: '没有识别到有效房间码', icon: 'none' }),
  })
  // #endif
  // #ifndef MP-WEIXIN
  uni.showToast({ title: '小程序端可直接扫码加入', icon: 'none' })
  // #endif
}

onLoad((options) => {
  if (options?.code) applyRoomCode(String(options.code))
})

async function submit() {
  if (roomCode.value.trim().length < 4) {
    uni.showToast({ title: '请输入房间号', icon: 'none' })
    return
  }
  await roomStore.join({ code: roomCode.value.trim(), nickname: profile.nickname, avatar: profile.avatar })
  uni.redirectTo({ url: '/pages/room/index' })
}
</script>

<template>
  <view class="page join-page">
    <view class="page-header">
      <text class="eyebrow">JOIN A ROOM</text>
      <text class="title">加入房间</text>
      <text class="subtitle">输入朋友分享的房间号，马上入场。</text>
    </view>

    <view class="surface code-input-card">
      <text class="input-label">房间号</text>
      <input v-model="roomCode" class="room-code-input" maxlength="6" type="text" placeholder="例如 5A7K2M" />
      <button class="scan-btn" @click="scanCode">▣ 扫描二维码</button>
    </view>

    <view class="surface identity-card">
      <view class="identity-row">
        <Avatar :avatar="profile.avatar" size="medium" />
        <view class="identity-copy">
          <text class="identity-name">{{ profile.nickname }}</text>
          <text class="identity-hint">形象和昵称在首页设置</text>
        </view>
      </view>
    </view>

    <button class="btn btn-primary submit-btn" :loading="roomStore.busy" @click="submit">加入房间</button>
    <text class="safe-note">加入即表示你同意在本次活动中使用这个昵称</text>
  </view>
</template>

<style scoped>
.code-input-card,
.identity-card {
  margin-bottom: 24rpx;
}

.room-code-input {
  width: 100%;
  height: 110rpx;
  padding: 0 24rpx;
  border: 2rpx solid var(--brand);
  border-radius: 18rpx;
  color: var(--ink);
  background: var(--brand-soft);
  font-size: 42rpx;
  font-weight: 800;
  letter-spacing: 8rpx;
  text-align: center;
}

.scan-btn {
  width: 100%;
  height: 78rpx;
  margin-top: 18rpx;
  border: 1rpx solid var(--line);
  border-radius: 16rpx;
  color: var(--brand);
  background: #fff;
  font-size: 25rpx;
  line-height: 78rpx;
}

.identity-row {
  display: flex;
  align-items: center;
}

.identity-copy {
  margin-left: 18rpx;
}

.identity-name {
  display: block;
  color: var(--ink);
  font-size: 30rpx;
  font-weight: 800;
}

.identity-hint {
  display: block;
  margin-top: 6rpx;
  color: var(--muted);
  font-size: 21rpx;
}

.submit-btn {
  margin-top: 30rpx;
}

.safe-note {
  display: block;
  margin-top: 18rpx;
  color: var(--muted);
  font-size: 20rpx;
  text-align: center;
}
</style>
