<script setup lang="ts">
/**
 * 房间二维码（独立页）。
 *
 * 页面里有两种码：
 *   1. 微信小程序码 —— 扫一下直接拉起小程序并进到加入页（需要 Edge Function 生成）
 *   2. 普通二维码 —— 兜底，好友在小程序内「加入房间 → 扫描二维码」也能进
 *
 * 独立成页的原因：canvas 是原生组件，会浮在页面上层并吃掉点击，
 * 放在大厅里会挡住主持人控制台的卡片。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import QrCode from '../../components/QrCode.vue'
import { roomApi } from '../../platform'
import { SupabaseRoomApi } from '../../platform/supabase'

/**
 * 生成码指向的小程序版本：release 正式版 / trial 体验版 / develop 开发版。
 * 还没发布正式版时要改成 trial 或 develop，否则微信会返回错误。
 */
const WX_ENV: 'release' | 'trial' | 'develop' = 'trial'

const code = ref('')
const qrText = ref('')
const wxImage = ref('')
const wxError = ref('')
const wxLoading = ref(false)

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

async function generateWxCode() {
  if (wxLoading.value || !code.value) return
  if (roomApi.mode !== 'supabase') {
    wxError.value = '本机房间模式没有后端，生成不了小程序码'
    return
  }
  wxLoading.value = true
  wxError.value = ''
  try {
    const result = await (roomApi as SupabaseRoomApi).invokeFunction<{ image?: string; detail?: string }>(
      '/functions/v1/wechat-qrcode',
      { room_code: code.value, env: WX_ENV },
    )
    if (result?.image) {
      wxImage.value = result.image
    } else {
      wxError.value = result?.detail ?? '生成失败，可能是小程序还没发布对应版本'
    }
  } catch (error) {
    wxError.value = error instanceof Error ? error.message : String(error)
  } finally {
    wxLoading.value = false
  }
}
</script>

<template>
  <view class="page">
    <view class="card">
      <text class="label">房间号</text>
      <text class="code">{{ code }}</text>

      <view v-if="wxImage" class="qr-holder">
        <image class="wx-code" :src="wxImage" mode="widthFix" />
        <text class="hint">微信扫一扫直接进入加入页</text>
      </view>

      <template v-else>
        <view class="qr-holder">
          <QrCode :text="qrText" :size="220" canvas-id="room-code-qr" />
        </view>
        <text class="hint">在小程序里点「加入房间 → 扫描二维码」可识别</text>
        <text class="warn">微信「扫一扫」扫这张只会显示一串文本，打不开小程序——那是正常的，微信不认识自定义链接。想让微信直接打开，必须点下面的按钮生成「微信小程序码」。</text>
      </template>

      <button class="btn" :disabled="wxLoading" @click="generateWxCode">
        {{ wxLoading ? '正在生成…' : wxImage ? '重新生成小程序码' : '生成微信小程序码' }}
      </button>
      <text v-if="wxError" class="error">{{ wxError }}</text>
      <button class="btn ghost" @click="copyCode">复制房间号</button>
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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx;
  border: 2rpx solid #eef0f6;
  border-radius: 16rpx;
}

.wx-code {
  width: 380rpx;
  border-radius: 12rpx;
}

.hint {
  margin: 20rpx 0 8rpx;
  color: #8a8f9c;
  font-size: 22rpx;
  text-align: center;
}

.btn {
  width: 100%;
  margin-top: 16rpx;
  border-radius: 16rpx;
  color: #fff;
  background: #4f46e5;
  font-size: 28rpx;
}

.btn.ghost {
  color: #4f46e5;
  background: #eef0ff;
}

.error {
  margin-top: 12rpx;
  color: #c2410c;
  font-size: 22rpx;
  text-align: center;
  word-break: break-all;
}
.warn { margin-top: 8rpx; padding: 12rpx 16rpx; border-radius: 10rpx; color: #7c2d12; background: #fef3c7; font-size: 20rpx; line-height: 1.5; }
</style>

