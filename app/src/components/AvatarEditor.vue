<script setup lang="ts">
import { computed } from 'vue'
import Avatar from './Avatar.vue'
import type { AvatarConfig, AvatarOption } from '../types/room'

const props = defineProps<{ modelValue: AvatarConfig }>()
const emit = defineEmits<{ 'update:modelValue': [value: AvatarConfig] }>()

const categories = [
  { key: 'skin', label: '肤色', options: ['light', 'warm', 'tan', 'deep'], labels: ['奶油', '暖棕', '小麦', '深棕'] },
  { key: 'eyes', label: '眼睛', options: ['round', 'happy', 'wink'], labels: ['圆眼', '笑眼', '眨眼'] },
  { key: 'nose', label: '鼻子', options: ['dot', 'small', 'triangle'], labels: ['圆鼻', '小鼻', '尖鼻'] },
  { key: 'mouth', label: '嘴巴', options: ['smile', 'open', 'line'], labels: ['微笑', '张嘴', '平嘴'] },
  { key: 'hair', label: '发型', options: ['short', 'bob', 'curly', 'cap'], labels: ['短发', '波波', '卷发', '帽子'] },
  { key: 'accessory', label: '配饰', options: ['none', 'glasses', 'star', 'headphones'], labels: ['无', '眼镜', '星星', '耳机'] },
] as const

const preview = computed(() => props.modelValue)

function pick(key: keyof AvatarConfig, value: string) {
  emit('update:modelValue', { ...props.modelValue, [key]: value as AvatarOption })
}
</script>

<template>
  <view class="avatar-editor">
    <view class="avatar-preview-wrap">
      <Avatar :avatar="preview" size="large" />
      <text class="avatar-preview-label">这是你的头像</text>
    </view>
    <view v-for="category in categories" :key="category.key" class="avatar-option-group">
      <text class="avatar-option-label">{{ category.label }}</text>
      <scroll-view scroll-x class="avatar-options" :show-scrollbar="false">
        <view
          v-for="(option, index) in category.options"
          :key="option"
          :class="['avatar-option', { selected: modelValue[category.key] === option }]"
          @click="pick(category.key, option)"
        >
          <Avatar :avatar="{ ...modelValue, [category.key]: option } as AvatarConfig" size="small" />
          <text>{{ category.labels[index] }}</text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<style scoped>
.avatar-editor { padding-top: 4rpx; }
.avatar-preview-wrap { display: flex; flex-direction: column; align-items: center; padding: 8rpx 0 24rpx; }
.avatar-preview-label { margin-top: 10rpx; color: var(--muted); font-size: 21rpx; }
.avatar-option-group + .avatar-option-group { margin-top: 18rpx; }
.avatar-option-label { display: block; margin-bottom: 10rpx; color: var(--ink); font-size: 23rpx; font-weight: 700; }
.avatar-options { white-space: nowrap; width: 100%; }
.avatar-option { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; width: 112rpx; min-height: 98rpx; margin-right: 12rpx; border: 2rpx solid var(--line); border-radius: 14rpx; color: var(--muted); background: #fbfcfe; font-size: 18rpx; }
.avatar-option.selected { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-soft); }
.avatar-option text { margin-top: 6rpx; }
</style>
