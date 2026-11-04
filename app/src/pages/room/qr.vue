<script setup lang="ts">
/**
 * 房间二维码（独立页）。
 *
 * 独立成页的原因：旧版 canvas 是原生组件，会浮在页面上层并吃掉点击。
 * 放在房间页里会挡住主持人控制台的卡片，所以把它挪出主界面。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import QrCode from '../../components/QrCode.vue'

const code = ref('')
const qrText = ref('')

onLoad((options) => {
  code.value = String(options?.code ?? '')
  qrText.value = `break-ice-hall://join?code=${code.value}`
})

function copyCode() {
  uni.setClipboardData({
    data: code.value,
    success: () => uni.showToast({ title: '房间号已复制', icon: 'none' }),
  })
}
</script>

<template>
  <view class="page">
    <view class="card">
      <text class="label">房间号</text>
      <text class="code">{{ code }}</text>
      <view class="qr-holder">
        <QrCode :text="qrText" :size="220" canvas-id="room-code-qr" />
      </view>
      <text class="hint">朋友在小程序里点「加入房间 → 扫描二维码」即可加入</text>
      <button class="btn" @click="copyCode">复制房间号</button>
    </view>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  justify-content: center;
  padding: 40rpx 24rpx;
}

.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 620rpx;
  padding: 36rpx 28rpx;
  border-radius: 24rpx;
  background: #fff;
  box-shadow: 0 12rpx 30rpx rgba(23, 32, 51, 0.08);
}

.label {
  color: #8a8f9c;
  font-size: 24rpx;
}

.code {
  margin: 8rpx 0 24rpx;
  letter-spacing: 10rpx;
  color: #172033;
  font-size: 56rpx;
  font-weight: 800;
}

.qr-holder {
  padding: 16rpx;
  border: 2rpx solid #eef0f6;
  border-radius: 16rpx;
}

.hint {
  margin: 24rpx 0;
  color: #8a8f9c;
  font-size: 22rpx;
  text-align: center;
}

.btn {
  width: 100%;
  border-radius: 16rpx;
  color: #fff;
  background: #4f46e5;
  font-size: 28rpx;
}
</style>
