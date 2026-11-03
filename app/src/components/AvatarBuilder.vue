<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue'
import type { AvatarConfig, AvatarLayerKey } from '../types/room'
import { AVATAR_MAIN, avatarLayers, cycleValue, getAvatarLayer, layerImage, normalizeAvatar } from '../services/avatarService'

const props = defineProps<{ modelValue: AvatarConfig }>()
const emit = defineEmits<{ 'update:modelValue': [value: AvatarConfig] }>()

const avatar = computed(() => normalizeAvatar(props.modelValue))

/** 每一层当前的滑入方向，动画播完就清掉，保证下次点击能重放 */
const slides = ref<Partial<Record<AvatarLayerKey, '' | 'slide-next' | 'slide-prev'>>>({})
const hint = ref('')
const hintVisible = ref(false)

const slideTimers = new Map<AvatarLayerKey, ReturnType<typeof setTimeout>>()
let hintTimer: ReturnType<typeof setTimeout> | undefined

/** 叠加顺序：color → main → body → mouth → eyes → hat */
const stackedLayers = computed(() => [
  { key: 'color' as const, src: layerImage('color', avatar.value.color) },
  { key: 'main' as const, src: AVATAR_MAIN },
  { key: 'body' as const, src: layerImage('body', avatar.value.body) },
  { key: 'mouth' as const, src: layerImage('mouth', avatar.value.mouth) },
  { key: 'eyes' as const, src: layerImage('eyes', avatar.value.eyes) },
  { key: 'hat' as const, src: layerImage('hat', avatar.value.hat) },
])

function step(key: AvatarLayerKey, direction: 1 | -1) {
  const layer = getAvatarLayer(key)
  const next = cycleValue(avatar.value[key], layer.count, direction)

  // 先撤掉动画类，下一帧再和新的图片一起加回来，否则连续点击不会重播
  slides.value = { ...slides.value, [key]: '' }
  nextTick(() => {
    emit('update:modelValue', { ...avatar.value, [key]: next })
    slides.value = { ...slides.value, [key]: direction === 1 ? 'slide-next' : 'slide-prev' }
    const existing = slideTimers.get(key)
    if (existing) clearTimeout(existing)
    slideTimers.set(
      key,
      setTimeout(() => {
        slides.value = { ...slides.value, [key]: '' }
      }, 240),
    )
  })

  hint.value = `${layer.label} ${next}/${layer.count}`
  hintVisible.value = true
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => {
    hintVisible.value = false
  }, 900)
}

onUnmounted(() => {
  slideTimers.forEach((timer) => clearTimeout(timer))
  if (hintTimer) clearTimeout(hintTimer)
})
</script>

<template>
  <view class="builder">
    <view class="stage">
      <view class="side">
        <view v-for="layer in avatarLayers" :key="`prev-${layer.key}`" class="arrow-slot">
          <image class="arrow" src="/static/start/arrow-left.png" mode="aspectFit" @tap="step(layer.key, -1)" />
        </view>
      </view>

      <view class="preview">
        <image
          v-for="item in stackedLayers"
          :key="item.key"
          :class="['preview-layer', item.key === 'main' ? '' : slides[item.key]]"
          :src="item.src"
          mode="aspectFit"
        />
        <view v-if="hintVisible" class="preview-hint">{{ hint }}</view>
      </view>

      <view class="side">
        <view v-for="layer in avatarLayers" :key="`next-${layer.key}`" class="arrow-slot">
          <image class="arrow" src="/static/start/arrow-right.png" mode="aspectFit" @tap="step(layer.key, 1)" />
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.builder {
  width: 100%;
  display: flex;
  justify-content: center;
}

.stage {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.side {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex: 0 0 auto;
  width: 88rpx;
  height: 470rpx;
}

.arrow-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 72rpx;
}

.arrow {
  width: 72rpx;
  height: 72rpx;
  opacity: 0.92;
}

.arrow:active {
  opacity: 0.6;
}

.preview {
  position: relative;
  flex: 0 0 auto;
  width: 470rpx;
  height: 470rpx;
  margin: 0 6rpx;
}

.preview-layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}

.preview-layer.slide-next {
  animation: slide-in-next 220ms ease-out;
}

.preview-layer.slide-prev {
  animation: slide-in-prev 220ms ease-out;
}

@keyframes slide-in-next {
  from {
    transform: translateX(14%);
    opacity: 0.3;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes slide-in-prev {
  from {
    transform: translateX(-14%);
    opacity: 0.3;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.preview-hint {
  position: absolute;
  left: 50%;
  bottom: 4rpx;
  transform: translateX(-50%);
  padding: 6rpx 20rpx;
  border-radius: 999rpx;
  color: #fff;
  background: rgba(23, 32, 51, 0.55);
  font-size: 20rpx;
  white-space: nowrap;
}
</style>
