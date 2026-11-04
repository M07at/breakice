<script setup lang="ts">
/**
 * 画布自测页（开发用，不在正常导航里出现）。
 *
 * 目的：不联机、不开局，单独验证 B 的画布在本机能画、能导出 PNG。
 * 打开方式：开发者工具 → 编译模式 → 添加编译模式 → 启动页面填 pages-uc/canvas-test
 */
import { ref } from 'vue'
import DrawCanvas from '@/components/draw-canvas/draw-canvas.vue'
import { DrawEngine } from '@/modules/draw/engine'

interface CanvasApi {
  exportPng(): Promise<string>
  exportBase64(): Promise<string>
  paint(): void
  reset(): void
}

const canvasRef = ref<CanvasApi | null>(null)
const previewPath = ref('')
const info = ref('')
const error = ref('')
const busy = ref(false)

// 用固定 id 建引擎，只在本页画，不连任何同步通道
const engine = new DrawEngine({ by: 'canvas-test' })

async function exportImage() {
  if (busy.value || !canvasRef.value) return
  busy.value = true
  error.value = ''
  info.value = ''
  try {
    const path = await canvasRef.value.exportPng()
    previewPath.value = path
    info.value = `导出成功：${path}`
  } catch (issue) {
    error.value = issue instanceof Error ? issue.message : String(issue)
  } finally {
    busy.value = false
  }
}

async function exportBase64() {
  if (busy.value || !canvasRef.value) return
  busy.value = true
  error.value = ''
  try {
    const base64 = await canvasRef.value.exportBase64()
    info.value = `Base64 长度 ${base64.length}，前 40 字符：${base64.slice(0, 40)}`
  } catch (issue) {
    error.value = issue instanceof Error ? issue.message : String(issue)
  } finally {
    busy.value = false
  }
}

function reset() {
  canvasRef.value?.reset()
  previewPath.value = ''
  info.value = ''
  error.value = ''
}
</script>

<template>
  <view class="page">
    <view class="uc-card">
      <text class="uc-label">画布自测</text>
      <text class="uc-muted">随便画几笔，点「导出 PNG」。能看到下面的预览图，就说明画布和导出都正常。</text>
    </view>

    <DrawCanvas ref="canvasRef" :engine="engine" mode="draw" variant="classic" @error="error = $event" />

    <view class="actions">
      <button class="uc-button" :disabled="busy" @tap="exportImage">{{ busy ? '导出中…' : '导出 PNG' }}</button>
      <button class="uc-button uc-secondary" :disabled="busy" @tap="exportBase64">导出 Base64</button>
      <button class="uc-link" :disabled="busy" @tap="reset">清空</button>
    </view>

    <text v-if="info" class="uc-note">{{ info }}</text>
    <text v-if="error" class="uc-note error">{{ error }}</text>

    <view v-if="previewPath" class="uc-card">
      <text class="uc-label">导出结果预览</text>
      <image class="shot" :src="previewPath" mode="widthFix" />
    </view>
  </view>
</template>

<style scoped>
.page {
  padding: 24rpx;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16rpx;
  margin: 20rpx 0;
}

.shot {
  display: block;
  width: 100%;
  margin-top: 14rpx;
  border-radius: 12rpx;
  background: #fff;
}

.error {
  color: #c2410c;
}
</style>
