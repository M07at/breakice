<script setup lang="ts">
import { computed } from 'vue'
import { mbtiGroup, normalizeMbti } from '../modules/shared/mbti'

const props = defineProps<{ name: string; mbti?: string | null }>()
defineOptions({ options: { virtualHost: true } })
const type = computed(() => normalizeMbti(props.mbti))
const group = computed(() => mbtiGroup(type.value))
</script>

<template>
  <text class="player-identity"><text>{{ name }}</text><text v-if="type" :class="['mbti-badge', group]">{{ type }}</text></text>
</template>

<style scoped>
.player-identity { display: inline; }
.mbti-badge { display: inline-block; margin-left: 8rpx; padding: 3rpx 10rpx; border-radius: 8rpx; font-size: 20rpx; font-weight: 700; line-height: 1.5; vertical-align: middle; white-space: nowrap; }
.analyst { color: #663d82; background: #f0e6f7; }
.diplomat { color: #236647; background: #e2f2e9; }
.sentinel { color: #225e78; background: #e1f0f6; }
.explorer { color: #76590e; background: #fff2c9; }
</style>
