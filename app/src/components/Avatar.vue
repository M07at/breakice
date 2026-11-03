<script setup lang="ts">
import { computed } from 'vue'
import type { AvatarConfig } from '../types/room'
import { avatarImages } from '../services/avatarService'

const props = withDefaults(defineProps<{ avatar: AvatarConfig; size?: 'small' | 'medium' | 'large' }>(), {
  size: 'medium',
})

/** 六张图按从底到顶的顺序叠出来，main 是永远显示的框架 */
const layers = computed(() => avatarImages(props.avatar))
</script>

<template>
  <view :class="['avatar', `avatar-${size}`]">
    <image v-for="(src, index) in layers" :key="index" class="avatar-layer" :src="src" mode="aspectFit" />
  </view>
</template>

<style scoped>
.avatar {
  position: relative;
  flex: 0 0 auto;
  overflow: hidden;
}

.avatar-small { width: 64rpx; height: 64rpx; }
.avatar-medium { width: 84rpx; height: 84rpx; }
.avatar-large { width: 180rpx; height: 180rpx; }

.avatar-layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
</style>
