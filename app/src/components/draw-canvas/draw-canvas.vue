<template>
  <view class="draw-canvas">
    <!-- Emoji 版：先选贴纸，再点画布放下 -->
    <view v-if="showEmojiBar" class="emoji-bar">
      <scroll-view scroll-x class="emoji-scroll">
        <view
          v-for="e in palette"
          :key="e"
          class="emoji-cell"
          :class="{ active: picked === e }"
          @tap="picked = e"
        >
          <text class="emoji-char">{{ e }}</text>
        </view>
      </scroll-view>
    </view>

    <view class="board-wrap">
      <!-- .stop 会编译成 catchtouchmove：画布上的触摸不再冒泡到页面，页面就不会跟着滚 -->
      <canvas
        id="drawCanvas"
        type="2d"
        class="board"
        :class="{ passive: mode !== 'draw' }"
        @touchstart.stop="onTouchStart"
        @touchmove.stop="onTouchMove"
        @touchend.stop="onTouchEnd"
        @touchcancel.stop="onTouchEnd"
      />
      <view v-if="!ready" class="board-mask">
        <text class="board-mask-text">正在准备画布…</text>
      </view>
      <view v-if="mode === 'watch'" class="board-badge">观看中（别人在画）</view>
      <view v-if="mode === 'readonly'" class="board-badge">只读</view>
    </view>

    <view v-if="mode === 'draw'" class="tools">
      <block v-if="variant !== 'emoji'">
        <view class="colors">
          <view
            v-for="c in BRUSH_COLORS"
            :key="c"
            class="color-dot"
            :class="{ active: color === c, light: c === '#ffffff' }"
            :style="{ background: c }"
            @tap="color = c"
          />
        </view>
        <view class="width-row">
          <text class="width-label">粗细</text>
          <slider
            class="slider"
            :value="width"
            :min="1"
            :max="40"
            :step="1"
            show-value
            activeColor="#3a55e6"
            @changing="onWidthChange"
            @change="onWidthChange"
          />
          <view class="width-preview">
            <view class="width-dot" :style="{ width: width * 2 + 'rpx', height: width * 2 + 'rpx', background: color }" />
          </view>
        </view>
      </block>
      <block v-else>
        <view v-if="selected !== null" class="emoji-edit">
          <text class="emoji-edit-label">大小</text>
          <slider
            class="slider"
            :value="selectedSize"
            :min="24"
            :max="260"
            :step="4"
            show-value
            activeColor="#3a55e6"
            @change="onSizeChange"
          />
          <text class="emoji-edit-label">旋转</text>
          <slider
            class="slider"
            :value="selectedRotate"
            :min="0"
            :max="359"
            :step="1"
            show-value
            activeColor="#3a55e6"
            @change="onRotateChange"
          />
          <view class="rotate-actions">
            <button size="mini" @tap="nudgeRotate(-15)">↺ 15°</button>
            <button size="mini" @tap="nudgeRotate(15)">15° ↻</button>
          </view>
        </view>
        <text v-else class="hint">点一下贴纸选中，再双指旋转缩放</text>
      </block>

      <view class="actions">
        <button class="tool-btn" size="mini" :disabled="!undoable" @tap="undo">撤销</button>
        <button class="tool-btn" size="mini" :disabled="!redoable" @tap="redo">恢复</button>
        <button class="tool-btn" size="mini" @tap="clear">清空</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * 画布组件（B1）。一个组件搞定「作画 / 观看 / 只读」三种模式：
 * - 画面永远由 `engine` 的操作流重放出来，所以作画端和观看端画的是同一套东西
 * - 触摸坐标先归一化成 0–1000 再进引擎，换机型不会变形
 * - 导出走 `exportPng()` / `exportBase64()`，给 AI 评分用
 */
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
// 这里刻意**不走 `@/modules/draw` 这个出口**：那个出口会把 session（以及它拖进来的
// 题库、计分、回环通道）一起带进主包。组件在主包，只要它引到 session，
// 小程序的「分包优化」就没法把 session 挪进 pages-draw，代码质量检查会报主包有未使用的文件。
import { toCanvasPoint, toNormalizedPoint } from '@/modules/draw/engine'
import { DrawError } from '@/modules/draw/errors'
import { BRUSH_COLORS, EMOJI_POOL } from '@/modules/draw/words'
import { CANVAS } from '@/modules/draw/types'
import type { DrawEngine } from '@/modules/draw/engine'
import type { DrawMode, DrawVariant, Point } from '@/modules/draw/types'

const props = withDefaults(
  defineProps<{
    engine: DrawEngine
    /** draw = 我能画；watch = 我只看；readonly = 只读复盘 */
    mode?: DrawMode
    /** classic 用画笔，emoji 只能贴贴纸 */
    variant?: DrawVariant
    /** Emoji 版这一回合的贴纸面板，由上层每回合随机抽一份传进来 */
    palette?: readonly string[]
  }>(),
  {
    mode: 'draw',
    variant: 'classic',
    // 兜底：随机 12 个，避免永远显示同一批（正常情况应由 view.palette 传入）
  palette: () => [...EMOJI_POOL].sort(() => Math.random() - 0.5).slice(0, 12),
  },
)

const emit = defineEmits<{ (e: 'change'): void; (e: 'error', message: string): void }>()

/** 只声明用得到的 Canvas 2D 成员，不把整块 DOM 类型拖进来 */
interface Ctx2D {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  fill(): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  save(): void
  restore(): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  fillText(text: string, x: number, y: number): void
  strokeRect(x: number, y: number, w: number, h: number): void
  setLineDash(segments: number[]): void
  lineCap: string
  lineJoin: string
  lineWidth: number
  strokeStyle: string
  fillStyle: string
  font: string
  textAlign: string
  textBaseline: string
}

interface CanvasNode {
  width: number
  height: number
  getContext(type: '2d'): Ctx2D
}

const instance = getCurrentInstance()
const ready = ref(false)
// 引擎不是响应式对象，撤销/重做的可用状态要自己同步到 ref 上，按钮才会变灰/变亮
const undoable = ref(false)
const redoable = ref(false)
const color = ref<string>(BRUSH_COLORS[0])
const width = ref(4)
const picked = ref<string>(props.palette[0] ?? '😀')
const selected = ref<number | null>(null)
const selectedSize = ref(96)
const selectedRotate = ref(0)

let canvasNode: CanvasNode | null = null
let ctx: Ctx2D | null = null
let dpr = 1
let displayWidth = 0
let displayHeight = 0
/** 画布左上角在**视口**里的坐标（配合 clientX/clientY 用，和滚动无关） */
let boardViewLeft = 0
let boardViewTop = 0
/** 画布左上角在**文档**里的坐标（配合 pageX/pageY 用，要加上滚动量） */
let boardLeft = 0
let boardTop = 0
/** 位置量成功过没有。没量到就不敢用 pageX/pageY 换算，否则会整片画歪 */
let boardMeasured = false
let lastCanvasPoint: Point | null = null

/**
 * 手势。两种：
 * - `move`：一根手指拖动贴纸，抬手才发一条更新
 * - `pinch`：两根手指旋转 + 缩放贴纸（先点一下选中，再双指捏）
 * 两种都只改本地预览，抬手时合成一条 `emoji-update` 操作。
 */
type Gesture =
  | { kind: 'move'; seq: number; origin: Point; from: Point; moved: boolean }
  | {
      kind: 'pinch'
      seq: number
      base: { x: number; y: number; size: number; rotate: number }
      startDist: number
      startAngle: number
    }

let gesture: Gesture | null = null
/** 预览值：位置、大小、角度都可能被手势改，抬手才提交 */
let preview: { seq: number; x: number; y: number; size?: number; rotate?: number } | null = null

/**
 * Emoji 版的贴纸条。**始终占位**（哪怕不在自己回合），否则它一出现/消失
 * 就会把下面的画布顶上顶下。
 */
const showEmojiBar = computed(() => props.variant === 'emoji')

function toast(message: string) {
  emit('error', message)
}

onMounted(() => {
  // 小程序里 canvas 节点要等一帧才能查到，这里给一拍的余量
  setTimeout(() => {
    nextTick(initCanvas)
  }, 30)
  // 刚跳转过来的页面，布局要过一会儿才定稿（图片、字号、内容都会撑开）。
  // 30ms 那次量到的位置可能是中间态，所以再补几次，确保基准和最终布局一致。
  ;[150, 400, 900, 1600].forEach((delay) => {
    setTimeout(measureBoard, delay)
  })
})

onBeforeUnmount(() => {
  canvasNode = null
  ctx = null
})

watch(
  () => props.mode,
  () => paint(),
)

// 换了引擎（比如换人作画）必须整块重画，否则画布上还留着上一个人的画
watch(
  () => props.engine,
  () => paint(),
)

function initCanvas() {
  const query = uni.createSelectorQuery().in(instance?.proxy as never)
  query
    .select('#drawCanvas')
    // uni 的类型里 fields 的回调是必填的；结果统一从 exec 里取，这里给个空函数占位
    .fields({ node: true, size: true }, () => {})
    .exec((res: unknown) => {
      const list = res as Array<{ node?: CanvasNode; width?: number; height?: number } | null>
      const first = list?.[0]
      if (!first?.node) {
        toast('画布没能准备好，退出重进再试一次')
        return
      }
      canvasNode = first.node
      displayWidth = first.width ?? 0
      displayHeight = first.height ?? 0
      dpr = uni.getSystemInfoSync().pixelRatio || 1
      canvasNode.width = CANVAS.width * dpr
      canvasNode.height = CANVAS.height * dpr
      ctx = canvasNode.getContext('2d')
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ready.value = true
      // 画布在页面里的位置也记一份，触摸时用它把「页面坐标」换算成「画布坐标」
      measureBoard()
      paint()
    })
}

/**
 * 重新量一次画布：尺寸 + 它在页面/文档里的位置。
 *
 * 为什么不能只在初始化时量一次：页面内容会变（提示词从「3 个字」变成「3 个字 · 动物」、
 * 词卡展开、评分卡出现），画布会被上下的内容顶得上下移动。位置一变，
 * 手指的页码坐标和画布坐标就对不上，笔画整体偏移。
 */
function measureBoard() {
  const query = uni.createSelectorQuery().in(instance?.proxy as never)
  // uni 的类型里这两个方法都要回调，实际结果统一从 exec 里取，这里给空函数占位
  query.select('#drawCanvas').boundingClientRect(() => {})
  query.selectViewport().scrollOffset(() => {})
  query.exec((res: unknown) => {
    const list = res as Array<Record<string, number> | null>
    const rect = list?.[0]
    const scroll = list?.[1]
    if (!rect || !rect.width || !rect.height) return
    displayWidth = rect.width
    displayHeight = rect.height
    boardViewLeft = rect.left ?? 0
    boardViewTop = rect.top ?? 0
    // 画布左上角在「文档」里的坐标 = 视口坐标 + 页面滚动量
    boardLeft = boardViewLeft + (scroll?.scrollLeft ?? 0)
    boardTop = boardViewTop + (scroll?.scrollTop ?? 0)
    boardMeasured = true
  })
}

/** 把整条操作流重放一遍。开销不大：一局几十上百条，手机上也够快 */
function paint() {
  if (!ctx) return
  const c = ctx
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.clearRect(0, 0, CANVAS.width, CANVAS.height)
  // 白底：导出给 AI 评分时不会是透明背景，白色画笔也顺便当了橡皮
  c.fillStyle = '#ffffff'
  c.fillRect(0, 0, CANVAS.width, CANVAS.height)

  const items = props.engine.visible()
  for (const item of items) {
    if (item.kind === 'stroke') {
      const points = item.points.map((point) => toCanvasPoint(point))
      c.strokeStyle = item.color
      c.fillStyle = item.color
      c.lineWidth = item.width
      if (points.length < 2) {
        c.beginPath()
        c.arc(points[0].x, points[0].y, Math.max(1, item.width / 2), 0, Math.PI * 2)
        c.fill()
        continue
      }
      c.beginPath()
      c.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) c.lineTo(points[i].x, points[i].y)
      c.stroke()
      continue
    }
    // 手势预览优先：拖动中跟手，缩放旋转中实时变化
    const p = preview && preview.seq === item.seq ? preview : null
    const at = toCanvasPoint({ x: p ? p.x : item.x, y: p ? p.y : item.y })
    const size = p && p.size !== undefined ? p.size : item.size
    const rotate = p && p.rotate !== undefined ? p.rotate : item.rotate
    c.save()
    c.translate(at.x, at.y)
    c.rotate((rotate * Math.PI) / 180)
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.font = `${size}px sans-serif`
    c.fillStyle = '#000000'
    c.fillText(item.emoji, 0, 0)
    c.restore()
  }

  // 选中的贴纸画一个虚线外框 + 四角手柄，告诉玩家「现在可以双指转它」
  if (selected.value !== null) {
    const item = findEmoji(selected.value)
    if (item) {
      const p = preview && preview.seq === item.seq ? preview : null
      const at = toCanvasPoint({ x: p ? p.x : item.x, y: p ? p.y : item.y })
      const size = (p && p.size !== undefined ? p.size : item.size)
      const rotate = p && p.rotate !== undefined ? p.rotate : item.rotate
      const half = size / 2
      c.save()
      c.translate(at.x, at.y)
      c.rotate((rotate * Math.PI) / 180)
      c.setLineDash([10, 8])
      c.lineWidth = 2
      c.strokeStyle = '#3a55e6'
      c.strokeRect(-half, -half, size, size)
      c.setLineDash([])
      c.fillStyle = '#3a55e6'
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        c.beginPath()
        c.arc(dx * half, dy * half, 7, 0, Math.PI * 2)
        c.fill()
      }
      c.restore()
    }
  }
  syncButtons()
}

/** 把引擎里的「能不能撤销/重做」搬到 ref 上，供按钮的 disabled 用 */
function syncButtons() {
  undoable.value = props.engine.canUndo
  redoable.value = props.engine.canRedo
}

// ---------------------------------------------------------------- 触摸

interface TouchLike {
  x?: number
  y?: number
  /** 文档坐标（页面滚动不影响它） */
  pageX?: number
  pageY?: number
  clientX?: number
  clientY?: number
}

interface TouchEventLike {
  touches?: TouchLike[]
  changedTouches?: TouchLike[]
}

/**
 * 手指位置 → 归一化坐标。
 *
 * 换算顺序（按可靠性）：
 * 1. `clientX/clientY` − 画布在**视口**里的位置：两边都是视口坐标，和滚动无关，最稳；
 * 2. `pageX/pageY` − 画布在**文档**里的位置（含滚动量）：拿不到 client 坐标时用；
 * 3. 组件自带的 `x/y`（相对画布）：都没有时兜底。
 *
 * 之前只用 pageY + 滚动量，而某些机型上 pageY 本身就是视口坐标，
 * 于是页面一滚动就多减了一个滚动距离——表现为"笔画比手指高一点"。
 */
function pointOf(e: unknown): Point | null {
  const event = e as TouchEventLike
  const touch = event.touches?.[0] ?? event.changedTouches?.[0]
  if (!touch) return null
  if (!displayWidth || !displayHeight) return null

  const inside = (lz: number, ly: number) =>
    lz >= -8 && ly >= -8 && lz <= displayWidth + 8 && ly <= displayHeight + 8

  if (boardMeasured && typeof touch.clientX === 'number' && typeof touch.clientY === 'number') {
    const localX = touch.clientX - boardViewLeft
    const localY = touch.clientY - boardViewTop
    if (inside(localX, localY)) return toNormalizedPoint(localX, localY, displayWidth, displayHeight)
  }

  if (boardMeasured && typeof touch.pageX === 'number' && typeof touch.pageY === 'number') {
    const localX = touch.pageX - boardLeft
    const localY = touch.pageY - boardTop
    if (inside(localX, localY)) return toNormalizedPoint(localX, localY, displayWidth, displayHeight)
  }

  if (typeof touch.x !== 'number' || typeof touch.y !== 'number') return null
  return toNormalizedPoint(touch.x, touch.y, displayWidth, displayHeight)
}

/** 在归一化坐标里找手指落点命中哪个贴纸，后放的在上面，所以倒着找 */
function hitEmoji(point: Point): { seq: number; x: number; y: number; size: number; rotate: number } | null {
  const items = props.engine.visible()
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind !== 'emoji') continue
    const halfX = ((item.size / 2) / CANVAS.width) * CANVAS.unit
    const halfY = ((item.size / 2) / CANVAS.height) * CANVAS.unit
    if (Math.abs(point.x - item.x) <= halfX && Math.abs(point.y - item.y) <= halfY) {
      return { seq: item.seq, x: item.x, y: item.y, size: item.size, rotate: item.rotate }
    }
  }
  return null
}

/** 按 seq 找当前画面上的那个贴纸 */
function findEmoji(seq: number): { seq: number; x: number; y: number; size: number; rotate: number } | null {
  for (const item of props.engine.visible()) {
    if (item.kind === 'emoji' && item.seq === seq) {
      return { seq: item.seq, x: item.x, y: item.y, size: item.size, rotate: item.rotate }
    }
  }
  return null
}

/** 当前所有手指（双指手势要拿两个） */
function touchesOf(e: unknown): Array<{ x: number; y: number }> {
  const event = e as TouchEventLike
  const list = event.touches && event.touches.length > 0 ? event.touches : event.changedTouches ?? []
  return list.filter((t): t is { x: number; y: number } => typeof t.x === 'number' && typeof t.y === 'number')
}

function distanceOf(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** 两根手指的连线角度，单位度 */
function angleOf(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

function normalizeAngle(deg: number): number {
  const value = deg % 360
  return value < 0 ? value + 360 : value
}

function clampSize(size: number): number {
  return Math.min(400, Math.max(24, Math.round(size)))
}

function onTouchStart(e: TouchEvent) {
  if (props.mode !== 'draw') return
  // 每一笔开始前都重新量一次画布的位置和尺寸：页面滚过、内容变过之后，
  // 上一笔留下的基准就可能过期，这是笔画和手指对不上的根因。
  measureBoard()
  const touches = touchesOf(e)

  // 双指：只有 Emoji 版、且已经选中一个贴纸时才当成缩放 / 旋转手势
  if (props.variant === 'emoji' && touches.length >= 2) {
    const item = selected.value === null ? null : findEmoji(selected.value)
    if (item) {
      gesture = {
        kind: 'pinch',
        seq: item.seq,
        base: { x: item.x, y: item.y, size: item.size, rotate: item.rotate },
        startDist: Math.max(1, distanceOf(touches[0], touches[1])),
        startAngle: angleOf(touches[0], touches[1]),
      }
      preview = null
    }
    // 双指但没选中任何贴纸：什么都不做，免得误放一个贴纸上去
    return
  }

  const point = pointOf(e)
  if (!point) return
  selected.value = null

  if (props.variant === 'emoji') {
    const hit = hitEmoji(point)
    if (hit) {
      selected.value = hit.seq
      selectedSize.value = Math.round(hit.size)
      selectedRotate.value = Math.round(hit.rotate)
      gesture = { kind: 'move', seq: hit.seq, origin: { x: hit.x, y: hit.y }, from: point, moved: false }
      paint()
      return
    }
    try {
      const seq = props.engine.placeEmoji(picked.value, point)
      selected.value = seq
      const placed = findEmoji(seq)
      if (placed) {
        selectedSize.value = Math.round(placed.size)
        selectedRotate.value = Math.round(placed.rotate)
      }
      paint()
      emit('change')
    } catch (error) {
      toast(error instanceof DrawError ? error.message : '贴纸放不下了')
    }
    return
  }

  props.engine.beginStroke(point, { color: color.value, width: width.value })
  lastCanvasPoint = toCanvasPoint(point)
  emit('change')
}

function onTouchMove(e: TouchEvent) {
  if (props.mode !== 'draw') return
  const touches = touchesOf(e)

  // 双指缩放 + 旋转：以两指连线的长度和角度为准
  if (gesture?.kind === 'pinch') {
    if (touches.length < 2) return
    const [a, b] = touches
    const scale = distanceOf(a, b) / gesture.startDist
    preview = {
      seq: gesture.seq,
      x: gesture.base.x,
      y: gesture.base.y,
      size: clampSize(gesture.base.size * scale),
      rotate: normalizeAngle(gesture.base.rotate + (angleOf(a, b) - gesture.startAngle)),
    }
    paint()
    return
  }

  const point = pointOf(e)
  if (!point) return

  if (props.variant === 'emoji') {
    if (gesture?.kind !== 'move') return
    const x = Math.min(CANVAS.unit, Math.max(0, gesture.origin.x + (point.x - gesture.from.x)))
    const y = Math.min(CANVAS.unit, Math.max(0, gesture.origin.y + (point.y - gesture.from.y)))
    gesture.moved = true
    preview = { seq: gesture.seq, x, y }
    paint()
    return
  }

  if (!props.engine.drawing) return
  const accepted = props.engine.extendStroke(point)
  if (!accepted || !ctx || !lastCanvasPoint) return
  const next = toCanvasPoint(point)
  const c = ctx
  c.strokeStyle = color.value
  c.lineWidth = width.value
  c.beginPath()
  c.moveTo(lastCanvasPoint.x, lastCanvasPoint.y)
  c.lineTo(next.x, next.y)
  c.stroke()
  lastCanvasPoint = next
}

function onTouchEnd() {
  if (props.mode !== 'draw') return

  if (props.variant === 'emoji') {
    const current = gesture
    const latest = preview
    gesture = null
    preview = null

    if (current?.kind === 'pinch') {
      if (latest && (latest.size !== undefined || latest.rotate !== undefined)) {
        try {
          props.engine.updateEmoji(current.seq, {
            ...(latest.size !== undefined ? { size: latest.size } : {}),
            ...(latest.rotate !== undefined ? { rotate: latest.rotate } : {}),
          })
        } catch (error) {
          toast(error instanceof DrawError ? error.message : '贴纸调整失败')
        }
      }
      syncSelectedSliders()
      paint()
      emit('change')
      return
    }

    if (current?.kind === 'move' && current.moved && latest) {
      try {
        props.engine.updateEmoji(current.seq, { x: latest.x, y: latest.y })
      } catch (error) {
        toast(error instanceof DrawError ? error.message : '贴纸移动失败')
      }
      syncSelectedSliders()
      paint()
      emit('change')
    }
    return
  }

  props.engine.endStroke()
  lastCanvasPoint = null
  // 点一下画出来的圆点也要立刻能看到
  paint()
  emit('change')
}

/** 手势/滑块改完之后，把选中贴纸的实际大小和角度同步回两个滑块 */
function syncSelectedSliders() {
  if (selected.value === null) return
  const item = findEmoji(selected.value)
  if (!item) return
  selectedSize.value = Math.round(item.size)
  selectedRotate.value = Math.round(item.rotate)
}

// ---------------------------------------------------------------- 工具

function undo() {
  if (props.engine.undo() === null) return
  selected.value = null
  paint()
  emit('change')
}

function redo() {
  if (props.engine.redo() === null) return
  paint()
  emit('change')
}

function clear() {
  props.engine.clear()
  selected.value = null
  paint()
  emit('change')
}

function onSizeChange(e: { detail: { value: number } }) {
  if (selected.value === null) return
  selectedSize.value = e.detail.value
  props.engine.updateEmoji(selected.value, { size: e.detail.value })
  paint()
  emit('change')
}

function onRotateChange(e: { detail: { value: number } }) {
  if (selected.value === null) return
  selectedRotate.value = e.detail.value
  props.engine.updateEmoji(selected.value, { rotate: e.detail.value })
  paint()
  emit('change')
}

/** 不能双指精确控制时，用这两个按钮一次转 15° */
function nudgeRotate(delta: number) {
  if (selected.value === null) return
  const item = findEmoji(selected.value)
  if (!item) return
  const next = Math.round(normalizeAngle(item.rotate + delta))
  selectedRotate.value = next
  props.engine.updateEmoji(selected.value, { rotate: next })
  paint()
  emit('change')
}

function onWidthChange(e: { detail: { value: number } }) {
  width.value = e.detail.value
}

/** 换回合：清空画面（引擎的 seq 继续递增，观看端不会把新操作当旧的丢掉） */
function reset() {
  props.engine.reset()
  selected.value = null
  gesture = null
  preview = null
  paint()
  emit('change')
}

// ---------------------------------------------------------------- 导出

type CanvasToTemp = (options: Record<string, unknown>, component?: unknown) => void
const canvasToTempFilePath = uni.canvasToTempFilePath as unknown as CanvasToTemp

function toTempFile(width_: number, height_: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!canvasNode) {
      reject(new DrawError('CANVAS_NOT_READY', '画布还没准备好'))
      return
    }
    canvasToTempFilePath(
      {
        canvas: canvasNode,
        x: 0,
        y: 0,
        width: CANVAS.width,
        height: CANVAS.height,
        destWidth: width_,
        destHeight: height_,
        fileType: 'png',
        success: (res: { tempFilePath: string }) => resolve(res.tempFilePath),
        fail: (err: { errMsg?: string }) => reject(new DrawError('EXPORT_FAILED', `导出图片失败：${err?.errMsg ?? ''}`)),
      },
      instance?.proxy,
    )
  })
}

interface FileInfoApi {
  getFileInfo?: (options: { filePath: string; success: (res: { size: number }) => void; fail: () => void }) => void
}

function fileSize(path: string): Promise<number | null> {
  const api = (uni as unknown as FileInfoApi).getFileInfo
  if (typeof api !== 'function') return Promise.resolve(null)
  return new Promise((resolve) => {
    api.call(uni, {
      filePath: path,
      success: (res) => resolve(res.size),
      fail: () => resolve(null),
    })
  })
}

/**
 * 导出 PNG。超过大小上限（默认 100KB，给 AI 评分用）就降一档分辨率重导。
 * 返回的是本地临时路径，上传到云存储后才应交给 A 的评分接口。
 */
async function exportPng(): Promise<string> {
  if (!ready.value) throw new DrawError('CANVAS_NOT_READY', '画布还没准备好，等一下再交')
  paint()
  const steps: Array<[number, number]> = [
    [CANVAS.width, CANVAS.height],
    [600, 450],
    [400, 300],
  ]
  let last = ''
  for (const [w, h] of steps) {
    const path = await toTempFile(w, h)
    last = path
    const size = await fileSize(path)
    if (size === null || size <= props.engine.drawConfig.maxImageBytes) return path
  }
  return last
}

interface FileSystemApi {
  getFileSystemManager?: () => {
    readFile: (options: { filePath: string; encoding: string; success: (res: { data: string }) => void; fail: () => void }) => void
  }
}

/** 导出 Base64。H5 走 toDataURL，小程序走文件系统读 base64 */
async function exportBase64(): Promise<string> {
  const path = await exportPng()
  const fsApi = (uni as unknown as FileSystemApi).getFileSystemManager
  if (typeof fsApi === 'function') {
    const fs = fsApi.call(uni)
    return new Promise((resolve, reject) => {
      fs.readFile({
        filePath: path,
        encoding: 'base64',
        success: (res) => resolve(`data:image/png;base64,${res.data}`),
        fail: () => reject(new DrawError('EXPORT_FAILED', '读取图片失败')),
      })
    })
  }
  const withDataUrl = canvasNode as unknown as { toDataURL?: (type: string) => string } | null
  if (withDataUrl?.toDataURL) return withDataUrl.toDataURL('image/png')
  throw new DrawError('EXPORT_FAILED', '这个端不支持导出 Base64')
}

defineExpose({ paint, exportPng, exportBase64, reset })
</script>

<style scoped>
.draw-canvas {
  display: flex;
  flex-direction: column;
}
.board-wrap {
  position: relative;
}
.board {
  width: 100%;
  /* 4:3，和 800×600 的逻辑画布一致；改成别的比例画面会被拉伸 */
  height: 75vw;
  border-radius: 16rpx;
  background: #fff;
}
.board.passive {
  opacity: 0.98;
}
.board-mask {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.86);
}
.board-mask-text {
  color: #8a8f9c;
  font-size: 24rpx;
}
.board-badge {
  position: absolute;
  right: 16rpx;
  top: 16rpx;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background: rgba(31, 35, 48, 0.72);
  color: #fff;
  font-size: 22rpx;
}
.emoji-bar {
  height: 76rpx;
  margin-bottom: 16rpx;
}
.emoji-scroll {
  white-space: nowrap;
}
.emoji-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 76rpx;
  height: 76rpx;
  margin-right: 10rpx;
  border-radius: 14rpx;
  background: #eef0f5;
}
.emoji-cell.active {
  background: #3a55e6;
}
.emoji-char {
  font-size: 40rpx;
}
.tools {
  margin-top: 16rpx;
}
.colors {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-bottom: 14rpx;
}
.color-dot {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 3rpx solid transparent;
  box-sizing: border-box;
}
.color-dot.light {
  border-color: #ccc;
}
.color-dot.active {
  border-color: #1f2330;
  transform: scale(1.12);
}
/* 粗细：连续可调 + 一个实时预览点 */
.width-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 10rpx;
}
.width-label {
  flex: none;
  color: #8a8f9c;
  font-size: 22rpx;
}
.width-row .slider {
  flex: 1;
  margin: 0;
}
.width-preview {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 88rpx;
  height: 56rpx;
}
.width-dot {
  min-width: 2rpx;
  min-height: 2rpx;
  border-radius: 50%;
  background: #1f2330;
}
.rotate-actions {
  display: flex;
  gap: 12rpx;
  margin-bottom: 8rpx;
}
.rotate-actions button {
  margin: 0;
}
.emoji-edit {
  margin-bottom: 12rpx;
}
.emoji-edit-label {
  display: block;
  color: #8a8f9c;
  font-size: 22rpx;
}
.slider {
  margin: 0 0 8rpx;
}
.actions {
  display: flex;
  gap: 12rpx;
}
.actions button {
  margin: 0;
}
.hint {
  display: block;
  margin: 8rpx 0 12rpx;
  color: #8a8f9c;
  font-size: 24rpx;
}
.tool-btn {
  margin: 0 8rpx;
  padding: 0 22rpx;
  height: 60rpx;
  line-height: 58rpx;
  border: 1rpx solid var(--line, #e7eaf0);
  border-radius: var(--radius-md, 20rpx);
  background: var(--surface, #ffffff);
  color: var(--ink, #172033);
  font-size: 24rpx;
}

.tool-btn[disabled] {
  color: var(--muted, #6c7588);
  background: var(--canvas, #f6f8fb);
}
</style>
