<template>
  <view class="uc-card">
    <text class="uc-label">你的作画回合</text>
    <text class="uc-muted">模拟画布：选择一个图形作为测试画作。真实画布由B的组件替换。</text>
    <text class="mock-picture">{{ preview || '选择图形开始' }}</text>
    <view class="uc-grid"><button v-for="shape in shapes" :key="shape" class="uc-choice" :class="{ active: preview === shape }" :disabled="!editable" @tap="preview = shape">{{ shape }}</button></view>
    <button class="uc-link" :disabled="!editable" @tap="preview = ''">清空</button>
    <text class="uc-muted">模拟评分结果（仅联调用）</text>
    <view class="uc-grid"><button v-for="mode in modes" :key="mode.value" class="uc-choice" :class="{ active: scoreMode === mode.value }" :disabled="!editable" @tap="scoreMode = mode.value">{{ mode.label }}</button></view>
    <button class="uc-button" :disabled="!editable || !preview" @tap="submit">提交模拟画作 →</button>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import type { DrawingSubmission, MockScoreMode } from '@/modules/undercover/player'
const props = defineProps<{ editable: boolean }>()
const emit = defineEmits<{ submit: [drawing: DrawingSubmission] }>()
const preview = ref('')
const scoreMode = ref<MockScoreMode>('success')
const shapes = ['◯', '△', '∿', '☆']
const modes: { value: MockScoreMode; label: string }[] = [{ value: 'success', label: '成功' }, { value: 'failed', label: '失败降级' }, { value: 'timeout', label: '超时降级' }]
function submit() { if (props.editable && preview.value) emit('submit', { preview: preview.value, scoreMode: scoreMode.value }) }
</script>
<style>.mock-picture { display:block; text-align:center; padding:48rpx 0; font-size:64rpx; color:#1f4e43; }</style>
