<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import AvatarBuilder from '../../components/AvatarBuilder.vue'
import { MBTI_TYPES } from '../../modules/shared/mbti'
import {
  NICKNAME_MAX,
  clearLegacyAvatar,
  getSavedProfile,
  normalizeNickname,
  saveProfile,
} from '../../services/avatarService'
import type { UserProfile } from '../../services/avatarService'

/** 首页是自定义导航，标题栏区域要自己让出来 */
function statusBarHeight(): number {
  try {
    const uniApi = uni as unknown as { getWindowInfo?: () => { statusBarHeight?: number } }
    const info = uniApi.getWindowInfo?.() ?? uni.getSystemInfoSync()
    return Number(info.statusBarHeight) || 20
  } catch {
    return 20
  }
}

clearLegacyAvatar()
const topInset = ref(statusBarHeight())
const profile = ref<UserProfile>(getSavedProfile())
const mbtiOptions = ['暂不填写', ...MBTI_TYPES]
const mbtiIndex = () => profile.value.mbti ? MBTI_TYPES.indexOf(profile.value.mbti) + 1 : 0
function onMbtiChange(event: { detail: { value: string | number } }) {
  profile.value.mbti = MBTI_TYPES[Number(event.detail.value) - 1] ?? null
  flushSave()
}

/** 没有保存按钮：形象和昵称一改就自动落盘，写入做了合并防抖 */
let saveTimer: ReturnType<typeof setTimeout> | undefined

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }
  saveProfile(profile.value)
}

watch(
  profile,
  () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flushSave, 250)
  },
  { deep: true },
)

function onNicknameBlur() {
  profile.value.nickname = normalizeNickname(profile.value.nickname)
  flushSave()
}

function openHelp() {
  uni.navigateTo({ url: '/pages/help/index' })
}

function goCreate() {
  flushSave()
  uni.navigateTo({ url: '/pages/create/index' })
}

function goJoin() {
  flushSave()
  uni.navigateTo({ url: '/pages/join/index' })
}

onUnmounted(flushSave)
</script>

<template>
  <view class="home-page" :style="{ paddingTop: topInset + 'px' }">
    <view class="help-btn" :style="{ top: topInset + 'px' }" @tap="openHelp">
      <text class="help-mark">?</text>
    </view>
    <view class="avatar-area">
      <AvatarBuilder v-model="profile.avatar" />
      <view class="nickname-row">
        <text class="profile-label">请你填你的游戏名字</text>
        <input
          v-model="profile.nickname"
          class="nickname-input"
          type="text"
          :maxlength="NICKNAME_MAX"
          placeholder="请输入游戏名字"
          placeholder-class="nickname-placeholder"
          @blur="onNicknameBlur"
          @confirm="onNicknameBlur"
        />
        <text class="profile-label mbti-label">你的 MBTI（选填）</text>
        <picker :range="mbtiOptions" :value="mbtiIndex()" @change="onMbtiChange">
          <view class="mbti-selector">{{ profile.mbti || '暂不填写' }} <text>⌄</text></view>
        </picker>
      </view>
    </view>

    <view class="actions">
      <image class="action-button" src="/static/start/create-room.png" mode="aspectFit" @tap="goCreate" />
      <image class="action-button" src="/static/start/join-room.png" mode="aspectFit" @tap="goJoin" />
    </view>
  </view>
</template>

<style scoped>
.help-btn {
  position: absolute;
  top: 0;
  right: 28rpx;
  z-index: 10;
  width: 56rpx;
  height: 56rpx;
  margin-top: 6rpx;
  border-radius: 50%;
  background: #fff;
  border: 1rpx solid var(--line, #e7eaf0);
  box-shadow: 0 6rpx 16rpx rgba(30, 41, 59, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
}

.help-mark {
  color: var(--brand, #4f8ef7);
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1;
}

.home-page {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-height: 100vh;
  padding-bottom: 48rpx;
  padding-bottom: calc(48rpx + env(safe-area-inset-bottom));
  background: #f7f8fb;
}

.avatar-area {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12rpx 0 0;
}

.nickname-row {
  display: flex;
  justify-content: center;
  flex-direction: column;
  width: 440rpx;
  max-width: 85%;
  margin-top: 6rpx;
}

.nickname-input {
  box-sizing: border-box;
  width: 100%;
  height: 78rpx;
  padding: 0 28rpx;
  border: 1rpx solid #e3e7f0;
  border-radius: 999rpx;
  color: #172033;
  background: #fff;
  font-size: 30rpx;
  font-weight: 700;
  text-align: center;
}

.profile-label { margin-bottom: 10rpx; color: #303c50; font-size: 24rpx; font-weight: 700; }
.mbti-label { margin-top: 20rpx; }
.mbti-selector { display: flex; align-items: center; justify-content: space-between; height: 72rpx; padding: 0 26rpx; border: 1rpx solid #e3e7f0; border-radius: 18rpx; background: #fff; color: #303c50; font-size: 26rpx; }

.nickname-placeholder {
  color: #b4bac8;
  font-weight: 500;
}

.actions {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  padding-top: 20rpx;
}

.action-button {
  width: 620rpx;
  height: 265rpx;
}

.action-button + .action-button {
  margin-top: 22rpx;
}

.action-button:active {
  opacity: 0.86;
}
</style>
