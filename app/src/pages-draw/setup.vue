<template>
  <view class="page">
    <view class="section">
      <view class="section-title">版本</view>
      <view class="choices">
        <view
          v-for="v in variants"
          :key="v"
          class="choice"
          :class="{ active: variant === v }"
          @tap="variant = v"
        >
          <text class="choice-name">{{ DRAW_VARIANT_LABEL[v] }}</text>
          <text class="choice-desc">{{ DRAW_VARIANT_HINT[v] }}</text>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-title">人数</view>
      <view class="row">
        <button size="mini" :disabled="count <= 2" @tap="count--">−</button>
        <text class="count">{{ count }} 人</text>
        <button size="mini" :disabled="count >= 12" @tap="count++">+</button>
      </view>
    </view>

    <view v-if="variant === 'custom'" class="section">
      <view class="section-title">自定义题面</view>
      <input v-model="customText" class="input" placeholder="例如：我们宿舍楼下那棵树" maxlength="20" />
      <text class="hint">房主自己出的题</text>
    </view>

    <button class="primary" :disabled="starting" @tap="start">{{ starting ? '正在开局…' : '开始作画' }}</button>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
// 按具体文件引，不走 modules/draw 的统一出口：出口会把房间/题库一起带进主包
import { DRAW_VARIANT_HINT, DRAW_VARIANT_LABEL } from '@/modules/draw/words'
import { startLocalDrawRoom } from '@/modules/draw/room'
import type { DrawVariant } from '@/modules/draw/types'

const variants: DrawVariant[] = ['classic', 'emoji', 'custom']
const variant = ref<DrawVariant>('classic')
const count = ref(4)
const customText = ref('')
const starting = ref(false)

// 从房间进入时用房间人数预填，房间是这一局的单位
onMounted(() => {
  const pages = getCurrentPages()
  const current = pages[pages.length - 1] as unknown as { options?: Record<string, string> } | undefined
  const raw = Number(current?.options?.count)
  if (Number.isFinite(raw)) count.value = Math.min(12, Math.max(2, Math.round(raw)))
})

async function start() {
  if (starting.value) return
  starting.value = true
  try {
    await startLocalDrawRoom({
      variant: variant.value,
      playerCount: count.value,
      customText: customText.value,
    })
    uni.navigateTo({ url: '/pages-draw/play' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '开局失败'
    uni.showToast({ title: message, icon: 'none' })
  } finally {
    starting.value = false
  }
}
</script>

<style>
@import '../styles/c-temp.css';

.choices {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}
.choice {
  padding: 20rpx;
  border: 2rpx solid #e6e8f0;
  border-radius: 14rpx;
}
.choice.active {
  border-color: #3a55e6;
  background: #f4f6ff;
}
.choice-name {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
}
.choice-desc {
  display: block;
  margin-top: 6rpx;
  color: #8a8f9c;
  font-size: 22rpx;
}
.count {
  flex: 1;
  text-align: center;
  font-size: 30rpx;
}
</style>
