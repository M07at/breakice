<script setup lang="ts">
const props = defineProps<{ code: string; roomName: string }>()

function copyCode() {
  uni.setClipboardData({
    data: props.code,
    success: () => uni.showToast({ title: '房间号已复制', icon: 'none' }),
  })
}

function shareRoom() {
  uni.showToast({ title: '请使用右上角分享给朋友', icon: 'none' })
}

/**
 * 二维码放到独立页面：旧版 canvas 是原生组件，会浮在页面上层并吃掉点击，
 * 放在大厅里会挡住主持人控制台的卡片。
 */
function openQr() {
  uni.navigateTo({
    url: `/pages/room/qr?code=${encodeURIComponent(props.code)}`,
    fail: (error) => {
      console.warn('打开二维码页失败', error)
      uni.showToast({ title: '打不开二维码页', icon: 'none' })
    },
  })
}
</script>

<template>
  <view class="code-card">
    <view class="code-copy">
      <text class="code-label">房间号</text>
      <text class="code">{{ code }}</text>
      <text class="code-hint">分享房间号或二维码，邀请朋友加入</text>
      <view class="code-actions">
        <button class="mini-btn" @click="copyCode">复制房间号</button>
        <button class="mini-btn secondary" @click="shareRoom">分享房间</button>
        <button class="mini-btn" @click="openQr">二维码</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.code-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx;
  border-radius: var(--radius-lg);
  color: #fff;
  background: linear-gradient(135deg, #4f46e5, #6259e9);
  box-shadow: 0 16rpx 30rpx rgba(79, 70, 229, 0.22);
}

.code-copy {
  min-width: 0;
}

.code-label {
  display: block;
  opacity: 0.8;
  font-size: 23rpx;
}

.code {
  display: block;
  margin-top: 6rpx;
  letter-spacing: 8rpx;
  font-size: 50rpx;
  font-weight: 800;
}

.code-hint {
  display: block;
  margin-top: 5rpx;
  opacity: 0.8;
  font-size: 21rpx;
}

.code-actions {
  display: flex;
  gap: 12rpx;
  margin-top: 18rpx;
}

.mini-btn {
  height: 54rpx;
  padding: 0 16rpx;
  border-radius: 12rpx;
  color: #fff;
  background: rgba(255, 255, 255, 0.18);
  font-size: 21rpx;
  line-height: 54rpx;
}

.mini-btn.secondary {
  color: var(--brand-deep);
  background: #fff;
}

.qr-wrap {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  margin-left: 18rpx;
  padding: 10rpx;
  border-radius: 14rpx;
  background: #fff;
}

.qr-tip {
  color: var(--muted);
  font-size: 19rpx;
}
</style>
