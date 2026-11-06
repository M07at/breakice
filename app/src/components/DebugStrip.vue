<script setup lang="ts">
/**
 * 临时诊断条：真机上看联机状态用，正式发布前把 services/debug.ts 的
 * DEBUG_STRIP 改成 false 就会全部隐藏。
 */
import { DEBUG_STRIP } from '@/services/debug'

const props = defineProps<{ text: string }>()
</script>

<template>
  <view v-if="DEBUG_STRIP" class="debug-strip">
    <text class="debug-text">{{ props.text }}</text>
  </view>
</template>

<style scoped>
.debug-strip {
  margin: 12rpx 0 16rpx;
  padding: 14rpx 18rpx;
  border-radius: var(--radius-md);
  background: #e8effc;
  border: 1rpx solid #c9dcff;
}

.debug-text {
  color: #1e3a8a;
  font-size: 20rpx;
  line-height: 1.5;
  word-break: break-all;
}
</style>
