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

interface QrMatrix {
  count: number
  isDark(row: number, col: number): boolean
}

function buildMatrix(): QrMatrix | null {
  if (!props.text) return null
  const qr = qrcode(0, 'M')
  qr.addData(props.text)
  qr.make()
  return { count: qr.getModuleCount(), isDark: (row, col) => qr.isDark(row, col) }
}

/** 按矩阵逐格填色 */
function paint(ctx: CanvasRenderingContext2D | UniApp.CanvasContext, matrix: QrMatrix) {
  const cell = props.size / matrix.count
  ctx.fillStyle = props.light
  ctx.fillRect(0, 0, props.size, props.size)
  ctx.fillStyle = props.dark
  for (let row = 0; row < matrix.count; row++) {
    for (let col = 0; col < matrix.count; col++) {
      if (!matrix.isDark(row, col)) continue
      // 多画 0.4px 消除模块之间的缝隙
      ctx.fillRect(col * cell, row * cell, cell + 0.4, cell + 0.4)
    }
  }
}

/**
 * 小程序：用 <canvas type="2d"> 同层渲染。
 * 旧版 canvas-id 是原生组件，会浮在页面上层并把点击吃掉，必须避开。
 */
function drawSameLayer() {
  const matrix = buildMatrix()
  if (!matrix) return
  // uni 的类型定义里 NodeField 是给小程序用的，H5 没有，这里按运行时能力取
  const query = uni.createSelectorQuery().in(instance as never) as unknown as {
    select(selector: string): {
      fields(fields: Record<string, boolean>): {
        exec(callback: (result: { node?: unknown }[]) => void): void
      }
    }
  }
  query
    .select(`#${props.canvasId}`)
    .fields({ node: true, size: true })
    .exec((result) => {
      const node = result?.[0]?.node as
        | { width: number; height: number; getContext(type: '2d'): CanvasRenderingContext2D }
        | undefined
      if (!node) {
        drawLegacy()
        return
      }
      const dpr = uni.getSystemInfoSync().pixelRatio || 2
      node.width = props.size * dpr
      node.height = props.size * dpr
      const ctx = node.getContext('2d')
      ctx.scale(dpr, dpr)
      paint(ctx, matrix)
    })
}

/** H5 兜底：没有 node 节点时走旧的 CanvasContext */
function drawLegacy() {
  const matrix = buildMatrix()
  if (!matrix) return
  const ctx = uni.createCanvasContext(props.canvasId, instance as never)
  ctx.setFillStyle(props.light)
  ctx.fillRect(0, 0, props.size, props.size)
  ctx.setFillStyle(props.dark)
  const cell = props.size / matrix.count
  for (let row = 0; row < matrix.count; row++) {
    for (let col = 0; col < matrix.count; col++) {
      if (!matrix.isDark(row, col)) continue
      ctx.fillRect(col * cell, row * cell, cell + 0.4, cell + 0.4)
    }
  }
  ctx.draw()
}

function draw() {
  // #ifdef H5
  drawLegacy()
  // #endif
  // #ifndef H5
  drawSameLayer()
  // #endif
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
    <canvas
      type="2d"
      :id="canvasId"
      :canvas-id="canvasId"
      class="qr-canvas"
      :style="{ width: styleSize, height: styleSize }"
    />
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
  width: 100%;
  height: 100%;
}
</style>
