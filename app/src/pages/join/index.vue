<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useRoomStore } from '../../stores/room'
import AvatarEditor from '../../components/AvatarEditor.vue'
import { getSavedAvatar, saveAvatar } from '../../services/avatarService'
import type { AvatarConfig } from '../../types/room'

const roomStore = useRoomStore()
const roomCode = ref('')
const nickname = ref('')
const avatar = ref<AvatarConfig>(getSavedAvatar())

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
  if (roomCode.value.trim().length < 4 || !nickname.value.trim()) {
    uni.showToast({ title: '请输入房间号和昵称', icon: 'none' })
    return
  }
  await roomStore.join({ code: roomCode.value.trim(), nickname: nickname.value.trim(), avatar: avatar.value })
  saveAvatar(avatar.value)
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
      <view class="section-title"><text>告诉大家你是谁</text><text class="muted">匿名即可</text></view>
      <input v-model="nickname" class="input" maxlength="12" placeholder="输入你的昵称" />
      <view class="avatar-section-title"><text>自定义头像</text><text class="muted">轻量本地保存</text></view>
      <AvatarEditor v-model="avatar" />
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

.section-title .muted {
  font-size: 21rpx;
  font-weight: 400;
}

.avatar-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 24rpx;
  color: var(--ink);
  font-size: 23rpx;
  font-weight: 700;
}

.avatar-section-title .muted {
  font-size: 20rpx;
  font-weight: 400;
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
