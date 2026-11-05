<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useRoomStore } from '../../stores/room'
import Avatar from '../../components/Avatar.vue'
import PlayerIdentity from '../../components/PlayerIdentity.vue'
import { getSavedProfile } from '../../services/avatarService'
import { toErrorMessage } from '../../platform/types'
import { parseRoomCode } from '../../services/roomCode'

const roomStore = useRoomStore()
const roomCode = ref('')

/** 形象和昵称统一在首页设置，这里只读取，不再重复编辑 */
const profile = getSavedProfile()

function applyRoomCode(value: string) {
  const parsed = parseRoomCode(value)
  if (!parsed) return false
  roomCode.value = parsed
  return true
}

function scanCode() {
  // #ifdef MP-WEIXIN
  uni.scanCode({
    onlyFromCamera: false,
    scanType: ['qrCode'],
    success: (result) => {
      if (!applyRoomCode(result.result) && !applyRoomCode(result.path ?? '')) {
        uni.showToast({ title: '没有识别到有效房间码', icon: 'none' })
      }
    },
    fail: (issue) => {
      if (!/cancel/i.test(issue.errMsg)) uni.showToast({ title: '未识别成功，请重新扫码或选择图片', icon: 'none' })
    },
  })
  // #endif
  // #ifndef MP-WEIXIN
  uni.showToast({ title: '小程序端可直接扫码加入', icon: 'none' })
  // #endif
}

onLoad((options) => {
  // 微信小程序码带的是 scene=房间号；普通二维码/分享链接带的是 code
  const raw = options?.scene ? String(options.scene) : options?.code ? String(options.code) : ''
  if (raw) applyRoomCode(raw)
})

async function submit() {
  const code = parseRoomCode(roomCode.value)
  if (!code) {
    uni.showToast({ title: '请输入 6 位房间号', icon: 'none' })
    return
  }
  // 用全局 loading 而不是按钮的 :loading：后者会在跳转同帧 patch Button 的插槽，
  // uni-app H5 运行时会抛 "Cannot assign to read only property '_'"，页面就卡住不跳。
  uni.showLoading({ title: '加入中…', mask: true })
  try {
    await roomStore.join({ code })
    uni.hideLoading()
    // 用 reLaunch 直接落到房间页：清掉加入页，避免从房间返回时又回到表单
    uni.reLaunch({ url: '/pages/room/index' })
  } catch (issue) {
    uni.hideLoading()
    uni.showToast({ title: roomStore.error || toErrorMessage(issue), icon: 'none' })
  }
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
      <view class="code-label-row">
        <text class="input-label">房间号</text>
        <button class="scan-btn" aria-label="扫描二维码或从相册识别" @tap="scanCode">▣ 扫码 / 相册</button>
      </view>
      <input v-model="roomCode" class="room-code-input" maxlength="6" type="text" placeholder="例如 5A7K2M" />
      <text class="scan-hint">点击图标扫码，也可在扫码界面选择相册中的二维码。</text>
    </view>

    <view class="surface identity-card">
      <view class="identity-row">
        <Avatar :avatar="profile.avatar" size="medium" />
        <view class="identity-copy">
          <text class="identity-name"><PlayerIdentity :name="profile.nickname" :mbti="profile.mbti" /></text>
          <text class="identity-hint">形象和昵称在首页设置</text>
        </view>
      </view>
    </view>

    <button class="btn btn-primary submit-btn" @click="submit">加入房间</button>
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
  height: 60rpx;
  margin: 0;
  padding: 0 16rpx;
  border: 1rpx solid var(--line);
  border-radius: 16rpx;
  color: var(--brand);
  background: #fff;
  font-size: 22rpx;
  line-height: 60rpx;
}

.code-label-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14rpx; }
.code-label-row .input-label { margin-bottom: 0; }
.scan-hint { display: block; margin-top: 14rpx; color: var(--muted); font-size: 21rpx; line-height: 1.6; }

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
