<template>
  <view class="page">
    <view class="notice">单机模式：一部手机轮流扮演所有人，用来开发和演示。接入房间后改由大厅开始游戏。</view>

    <view class="section">
      <view class="section-title">玩法</view>
      <view class="choices">
        <view
          v-for="v in variants"
          :key="v"
          class="choice"
          :class="{ active: variant === v }"
          @tap="setVariant(v)"
        >
          <text class="choice-name">{{ VARIANT_LABEL[v] }}</text>
          <text class="hint">{{ PLAYER_LIMITS[v].min }}–{{ PLAYER_LIMITS[v].max }} 人</text>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-title">人数</view>
      <view class="row">
        <button size="mini" :disabled="count <= limits.min" @tap="count--">−</button>
        <text class="count">{{ count }} 人</text>
        <button size="mini" :disabled="count >= limits.max" @tap="count++">+</button>
      </view>
      <view class="row">
        <text>加入白板（{{ BLANK_MIN_PLAYERS }} 人以上）</text>
        <switch :checked="blank" :disabled="count < BLANK_MIN_PLAYERS" @change="onBlankChange" />
      </view>
      <text class="hint">{{ countsText }}</text>
    </view>

    <view class="section">
      <view class="section-title">词库</view>
      <view v-for="b in banks" :key="b.id" class="row" @tap="toggleBank(b.id)">
        <text>{{ b.name }}</text>
        <text class="check">{{ selected.includes(b.id) ? '✓' : '' }}</text>
      </view>
      <text v-if="variant === 'draw'" class="hint">融合玩法只会抽标了「可画」的词对</text>
      <view class="link" @tap="goBank">管理题库 ›</view>
    </view>

    <button class="primary" :disabled="starting || selected.length === 0" @tap="start">开始游戏</button>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { Bank } from '@/modules/bank'
import { switchValue } from '@/modules/local/events'
import { LOCAL_USER_ID, bankRepo, startLocalGame } from '@/modules/local/session'
import { BLANK_MIN_PLAYERS, DEFAULT_CONFIG, PLAYER_LIMITS, VARIANT_LABEL, roleCounts } from '@/modules/undercover'
import type { Variant } from '@/modules/undercover'

const variants: Variant[] = ['classic', 'draw']
const variant = ref<Variant>('classic')
const count = ref(6)
const blank = ref(false)
const banks = ref<Bank[]>([])
const selected = ref<string[]>([])
const starting = ref(false)

const limits = computed(() => PLAYER_LIMITS[variant.value])

const countsText = computed(() => {
  try {
    const c = roleCounts(count.value, { ...DEFAULT_CONFIG, blankEnabled: blank.value })
    return `卧底 ${c.undercover} 个 · ${c.blank ? `白板 ${c.blank} 个 · ` : ''}平民 ${c.civilian} 个`
  } catch (e) {
    return (e as Error).message
  }
})

onShow(async () => {
  banks.value = await bankRepo().listBanks(LOCAL_USER_ID, 'undercover')
  const ids = banks.value.map((b) => b.id)
  selected.value = selected.value.filter((id) => ids.includes(id))
  if (selected.value.length === 0) {
    selected.value = banks.value.filter((b) => b.visibility === 'system').map((b) => b.id)
  }
})

function setVariant(v: Variant) {
  variant.value = v
  const { min, max } = PLAYER_LIMITS[v]
  count.value = Math.min(Math.max(count.value, min), max)
}

function onBlankChange(e: Event) {
  blank.value = switchValue(e)
}

function toggleBank(id: string) {
  selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id]
}

function goBank() {
  uni.navigateTo({ url: '/pages-bank/index' })
}

async function start() {
  starting.value = true
  try {
    await startLocalGame({
      playerCount: count.value,
      variant: variant.value,
      blankEnabled: blank.value && count.value >= BLANK_MIN_PLAYERS,
      bankIds: selected.value,
    })
    uni.navigateTo({ url: '/pages-uc/play' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    starting.value = false
  }
}
</script>

<style>
@import '../styles/c-temp.css';

.choices {
  display: flex;
  gap: 16rpx;
}
.choice {
  flex: 1;
  padding: 20rpx;
  border: 2rpx solid #dfe2ea;
  border-radius: 12rpx;
}
.choice.active {
  border-color: #3a55e6;
  background: #eef1ff;
}
.choice-name {
  font-weight: 600;
}
.count {
  font-size: 36rpx;
  font-weight: 600;
}
.check {
  color: #3a55e6;
  font-weight: 600;
}
.link {
  margin-top: 16rpx;
  color: #3a55e6;
}
</style>
