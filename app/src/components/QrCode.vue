<script setup lang="ts">
import { computed, getCurrentInstance, onMounted, watch } from 'vue'
// 纯 JS 的二维码编码器，无原生依赖，小程序和 H5 都能跑
import qrcode from 'qrcode-generator'

const props = withDefaults(
  defineProps<{
    text: string
    /** 画布边长（px，canvas 里不能用 rpx） */
    size?: number
    canvasId?: string
    dark?: string
    light?: string
  }>(),
  { size: 120, canvasId: 'room-qr', dark: '#172033', light: '#ffffff' },
)

const instance = getCurrentInstance()?.proxy
const styleSize = computed(() => `${props.size}px`)

function draw() {
  if (!props.text) return
  const qr = qrcode(0, 'M')
  qr.addData(props.text)
  qr.make()

  const count = qr.getModuleCount()
  const cell = props.size / count
  const ctx = uni.createCanvasContext(props.canvasId, instance as never)

  ctx.setFillStyle(props.light)
  ctx.fillRect(0, 0, props.size, props.size)
  ctx.setFillStyle(props.dark)
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue
      // 多画 0.3px 消除模块之间的缝隙
      ctx.fillRect(col * cell, row * cell, cell + 0.3, cell + 0.3)
    }
  }
  ctx.draw()
}

onMounted(() => {
  // 等一帧，保证 canvas 节点已经挂上
  setTimeout(draw, 50)
})

watch(
  () => props.text,
  () => draw(),
)
</script>

<template>
  <view class="qr" :style="{ width: styleSize, height: styleSize }">
    <canvas :canvas-id="canvasId" :id="canvasId" class="qr-canvas" :style="{ width: styleSize, height: styleSize }" />
  </view>
</template>

<style scoped>
.qr {
  overflow: hidden;
  border-radius: 10rpx;
  background: #fff;
}

.qr-canvas {
  display: block;
}
</style>
