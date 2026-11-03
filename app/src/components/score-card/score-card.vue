<template>
  <view class="score-card">
    <view class="head">
      <text class="title">AI 评分</text>
      <text v-if="result && result.provider" class="provider">{{ result.provider }}</text>
    </view>

    <view v-if="loading" class="loading">
      <text class="loading-text">正在给这幅画打分…</text>
    </view>

    <block v-else-if="result">
      <view class="total-row">
        <text class="total">{{ result.score }}</text>
        <text class="total-unit">/ 100</text>
        <view v-if="painterPoints !== null" class="bonus">
          <text class="bonus-label">本轮作画得分</text>
          <text class="bonus-value">+{{ painterPoints }}</text>
        </view>
      </view>

      <view class="dims">
        <view v-for="dim in dimensions" :key="dim.key" class="dim">
          <view class="dim-head">
            <text class="dim-label">{{ dim.label }}</text>
            <text class="dim-value">{{ dim.value }}</text>
          </view>
          <view class="bar">
            <view class="bar-fill" :style="{ width: dim.value + '%', background: dim.color }" />
          </view>
        </view>
      </view>

      <text v-if="result.comment" class="comment">{{ result.comment }}</text>
      <text v-else class="comment muted">这次没有评语</text>

      <view v-if="result.degraded" class="degraded">本轮未含 AI 评分</view>
    </block>

    <text v-else class="empty">交画之后，这里会显示构图、创意、契合度三项分数和一段评语</text>
  </view>
</template>

<script setup lang="ts">
/**
 * AI 评分卡（FR-04 的输出形态）。
 * 只负责展示，不认识 AI 服务：分数由 A 的接口给，B 只做解析和渲染。
 */
import { computed } from 'vue'
import type { AiScoreResult } from '@/modules/draw'

const props = withDefaults(
  defineProps<{
    result?: AiScoreResult | null
    loading?: boolean
    /** 本轮落到作画者头上的分数（含猜中加成），不传就不显示 */
    painterPoints?: number | null
  }>(),
  { result: null, loading: false, painterPoints: null },
)

const dimensions = computed(() => {
  const dims = props.result?.dimensions ?? { composition: 0, creativity: 0, relevance: 0 }
  return [
    { key: 'composition', label: '构图', value: dims.composition, color: '#3a55e6' },
    { key: 'creativity', label: '创意', value: dims.creativity, color: '#7c3aed' },
    { key: 'relevance', label: '契合度', value: dims.relevance, color: '#16a34a' },
  ]
})
</script>

<style scoped>
.score-card {
  padding: 24rpx;
  border-radius: 16rpx;
  background: #fff;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-size: 30rpx;
  font-weight: 600;
}
.provider {
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  background: #eef1ff;
  color: #3a55e6;
  font-size: 22rpx;
}
.loading {
  padding: 32rpx 0;
}
.loading-text {
  display: block;
  color: #1f2330;
  font-size: 28rpx;
}
.loading-hint {
  display: block;
  margin-top: 8rpx;
  color: #8a8f9c;
  font-size: 22rpx;
}
.total-row {
  display: flex;
  align-items: flex-end;
  margin: 16rpx 0 20rpx;
}
.total {
  font-size: 96rpx;
  font-weight: 700;
  line-height: 1;
  color: #1f2330;
}
.total-unit {
  margin-left: 6rpx;
  color: #8a8f9c;
  font-size: 24rpx;
}
.bonus {
  margin-left: auto;
  text-align: right;
}
.bonus-label {
  display: block;
  color: #8a8f9c;
  font-size: 22rpx;
}
.bonus-value {
  color: #16a34a;
  font-size: 40rpx;
  font-weight: 600;
}
.dim {
  margin-bottom: 16rpx;
}
.dim-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6rpx;
}
.dim-label {
  color: #4a4f5c;
  font-size: 26rpx;
}
.dim-value {
  font-size: 26rpx;
  font-weight: 600;
}
.bar {
  height: 14rpx;
  border-radius: 999rpx;
  background: #eef0f5;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 999rpx;
}
.comment {
  display: block;
  margin-top: 16rpx;
  padding: 16rpx;
  border-radius: 12rpx;
  background: #f7f8fc;
  color: #1f2330;
  font-size: 26rpx;
  line-height: 1.5;
}
.comment.muted {
  color: #8a8f9c;
}
.degraded {
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background: #fff7e6;
  color: #8a5a00;
  font-size: 24rpx;
}
.empty {
  display: block;
  padding: 24rpx 0;
  color: #8a8f9c;
  font-size: 24rpx;
}
</style>
