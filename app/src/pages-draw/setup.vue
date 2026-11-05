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
      <view v-if="locked" class="row">
        <text class="count">{{ count }} 人</text>
      </view>
      <view v-else class="row">
        <button size="mini" :disabled="count <= 2" @tap="count--">−</button>
        <text class="count">{{ count }} 人</text>
        <button size="mini" :disabled="count >= 12" @tap="count++">+</button>
      </view>
      <text v-if="locked" class="hint">本局人数由房间决定，房间里的人都会参加</text>
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
/** 从房间进来时锁定人数：这一局就是房间里这些人 */
const locked = ref(false)
/** 从房间进来时带上房间 id；联机版要靠它发布/订阅对局 */
const roomId = ref('')

// 从房间进入时用房间人数预填，房间是这一局的单位
onMounted(() => {
  const pages = getCurrentPages()
  const current = pages[pages.length - 1] as unknown as { options?: Record<string, string> } | undefined
  const raw = Number(current?.options?.count)
  if (Number.isFinite(raw)) count.value = Math.min(12, Math.max(2, Math.round(raw)))
  locked.value = current?.options?.lock === '1'
  // 从房间进来时会带 room=<id>，联机版靠它发布/订阅对局
  roomId.value = String(current?.options?.room ?? '')
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
    uni.navigateTo({ url: roomId.value ? '/pages-draw/play?room=' + encodeURIComponent(roomId.value) : '/pages-draw/play' })
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
  color: var(--muted, #6c7588);
  font-size: 22rpx;
}
.count {
  flex: 1;
  text-align: center;
  font-size: 30rpx;
}
</style>

