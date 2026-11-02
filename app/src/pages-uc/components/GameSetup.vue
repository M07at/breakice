<template>
  <view class="uc-page">
    <view class="uc-header">
      <text class="uc-eyebrow">破冰局 / 一起认识一下</text>
      <text class="uc-title">{{ VARIANT_LABEL[variant] }}</text>
      <text class="uc-subtitle">{{ variant === 'classic' ? '同一组人，不同的秘密词。听一听，谁的描述有点不一样？' : '用画作表达秘密词。看一看，谁画得有点不一样？' }}</text>
    </view>
    <view class="uc-note">每位玩家使用自己的手机，在自己的界面领词、作画和投票。</view>
    <!-- #ifndef H5 -->
    <view class="uc-note integration">当前是小程序端：多设备实时服务尚未接入（由 A 模块负责）。完整联调请在电脑上运行 npm run dev:players，用 H5 预览打开并分发邀请链接。</view>
    <!-- #endif -->
    <view v-if="error" class="uc-error" role="alert">{{ error }}</view>
    <view v-if="fixedResume" class="uc-card"><text class="uc-label">返回我的游戏</text><text class="uc-muted">继续使用你之前绑定的玩家身份。</text><button class="uc-button uc-secondary" :disabled="starting" @tap="resumeFixed">打开我的游戏 →</button></view>
    <view class="uc-card">
      <view class="uc-row"><text class="uc-label">02 / 谁来参加</text><text class="uc-badge">{{ limits.min }}–{{ limits.max }} 人</text></view>
      <view class="uc-row counter">
        <button class="uc-small" :disabled="count <= limits.min" aria-label="减少人数" @tap="count--">−</button>
        <text class="count">{{ count }} <text class="uc-muted inline">人</text></text>
        <button class="uc-small" :disabled="count >= limits.max" aria-label="增加人数" @tap="count++">＋</button>
      </view>
      <text class="uc-muted">填昵称，发言时更容易记住彼此。1 号位负责开始和结束。</text>
      <view class="names">
        <view v-for="(_, i) in count" :key="i" class="name-row">
          <text class="seat">{{ String(i + 1).padStart(2, '0') }}</text>
          <input v-model="names[i]" class="name-input" :maxlength="12" :placeholder="`玩家${i + 1}${i === 0 ? '（主持人）' : ''}`" :aria-label="`${i + 1}号玩家昵称`" />
        </view>
      </view>
      <view class="uc-row option-row">
        <view><text>加入白板</text><text class="uc-muted">{{ BLANK_MIN_PLAYERS }} 人起可选；没有词，和卧底同阵营</text></view>
        <switch :checked="blank && count >= BLANK_MIN_PLAYERS" :disabled="count < BLANK_MIN_PLAYERS" color="#1f4e43" @change="onBlankChange" />
      </view>
      <text class="uc-muted">{{ countsText }}</text>
    </view>
    <view class="uc-card"><text class="uc-label">词语语言</text><view class="uc-grid"><button class="uc-choice" :class="{active:language==='zh'}" @tap="setLanguage('zh')">中文</button><button class="uc-choice" :class="{active:language==='en'}" @tap="setLanguage('en')">English</button></view><text class="uc-muted">只改变词语语言。两个游戏共用同一题库，融合玩法只抽可画词对。</text><button v-for="bank in banks" :key="bank.id" class="uc-button uc-secondary" @tap="toggleBank(bank.id)">{{ selectedBanks.includes(bank.id) ? '✓ ' : '' }}{{ bank.name }}</button><button class="uc-link" @tap="manage">管理共享题库</button></view>
    <view class="uc-card"><text class="uc-label">规则</text><text class="uc-muted">默认内置中英文词对。创建后由主持人分发不同座位的联调链接。</text><text class="uc-muted">{{ rulesText }}</text></view>
    <button class="uc-button" :disabled="starting" @tap="start">{{ starting ? '正在准备…' : '创建多设备联调游戏 →' }}</button>
    <text class="uc-muted footer-note">主持人也是一名玩家；每人只使用自己的加入链接。</text>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { bankRepo, LOCAL_USER_ID } from '@/modules/local/session'
import type { Bank } from '@/modules/bank'
import { switchValue } from '@/modules/local/events'
import { BLANK_MIN_PLAYERS, DEFAULT_CONFIG, PLAYER_LIMITS, VARIANT_LABEL, roleCounts } from '@/modules/undercover'
import type { Variant } from '@/modules/undercover'
import { getPlayerPort, installPlayerPort } from '@/modules/undercover/player'
import { createPlayerPreview } from '@/modules/local/player-preview'

const fixedResume = ref(false)
const props = defineProps<{ variant: Variant }>()
const variant = computed(() => props.variant)
const language = ref<'zh' | 'en'>((uni.getStorageSync('word-language') || 'zh') as 'zh' | 'en')
const banks = ref<Bank[]>([])
const selectedBanks = ref<string[]>(['sys_undercover'])
const count = ref(6)
const names = ref<string[]>(Array(20).fill(''))
const blank = ref(false)
const starting = ref(false)
const error = ref('')
const limits = computed(() => PLAYER_LIMITS[variant.value])
const rulesText = computed(() => `领词全部确认后开始${variant.value === 'draw' ? '；作品回顾10秒后投票' : ''}；每人${variant.value === 'classic' ? DEFAULT_CONFIG.describeSeconds : DEFAULT_CONFIG.drawSeconds}秒，投票${DEFAULT_CONFIG.voteSeconds}秒。不能自投，可弃权；平票加赛一次，再平票无人出局。平民找出全部卧底和白板获胜；卧底人数不少于平民，或剩余不超过3人且卧底阵营仍在则卧底获胜。最多${DEFAULT_CONFIG.maxRounds}轮。`)
const countsText = computed(() => {
  try {
    const c = roleCounts(count.value, { ...DEFAULT_CONFIG, blankEnabled: blank.value })
    return `${c.civilian} 平民 · ${c.undercover} 卧底${c.blank ? ` · ${c.blank} 白板` : ''}`
  } catch (e) { return (e as Error).message }
})
async function loadBanks() { fixedResume.value = !!getPlayerPort(variant.value); try { banks.value = await bankRepo().listBanks(LOCAL_USER_ID, 'undercover'); selectedBanks.value = selectedBanks.value.filter(id => banks.value.some(b=>b.id===id)); if (!selectedBanks.value.length) selectedBanks.value = ['sys_undercover'] } catch(e) { error.value = (e as Error).message } }
onShow(loadBanks)
onMounted(() => {
  applyRoster()
  loadBanks()
})

/**
 * 从 D 模块的房间等待区进入时，用房间名单预填座位，玩家不必再手输昵称。
 * 这里是组件内部，直接读当前页面栈的参数，避免依赖页面级 onLoad 生命周期。
 */
function applyRoster() {
  const pages = getCurrentPages()
  const current = pages[pages.length - 1] as unknown as { options?: Record<string, string> } | undefined
  const raw = current?.options?.names
  if (!raw) return
  const roster = raw
    .split(',')
    .map((name) => safeDecode(name.trim()))
    .filter(Boolean)
    .slice(0, limits.value.max)
  if (roster.length < limits.value.min) return
  count.value = roster.length
  names.value = [...roster, ...Array(Math.max(0, 20 - roster.length)).fill('')]
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function resumeFixed() { uni.navigateTo({ url: getPlayerPort(variant.value)?.resumeUrl ?? (variant.value === 'draw' ? '/pages-uc/hybrid-player' : '/pages-uc/player') }) }
function onBlankChange(e: Event) { blank.value = switchValue(e) }
function setLanguage(value: 'zh' | 'en') { language.value = value; uni.setStorageSync('word-language', value) }
function toggleBank(id: string) { selectedBanks.value = selectedBanks.value.includes(id) ? selectedBanks.value.filter(x=>x!==id) : [...selectedBanks.value,id] }
function manage() { uni.navigateTo({url:'/pages-bank/index'}) }
async function start() {
  if (starting.value) return
  starting.value = true
  error.value = ''
  try {
    const playerPort = await createPlayerPreview(names.value.slice(0, count.value), blank.value && count.value >= BLANK_MIN_PLAYERS, variant.value, language.value, selectedBanks.value)
    installPlayerPort(playerPort, variant.value)
    uni.navigateTo({ url: playerPort.resumeUrl ?? '/pages-uc/player' })
  } catch (e) { error.value = (e as Error).message }
  finally { starting.value = false }
}
</script>

<style>
@import '../classic.css';
.mode-name { display: block; font-size: 28rpx; font-weight: 700; margin-bottom: 8rpx; }
.counter { padding: 12rpx 0 28rpx; }
.count { font-size: 58rpx; font-weight: 800; }
.inline { display: inline; }
.names { margin: 24rpx 0; }
.name-row { display: flex; gap: 20rpx; align-items: center; min-height: 86rpx; border-bottom: 2rpx solid #edf0e7; }
.seat { font-size: 24rpx; color: #718577; font-weight: 700; }
.name-input { flex: 1; font-size: 28rpx; height: 76rpx; }
.option-row { margin: 28rpx 0 16rpx; }
.bank { width: 100%; margin-top: 12rpx; font-size: 26rpx; }
.footer-note { text-align: center; margin-top: 24rpx; }
.integration { background: #fff4dc; color: #8a5a17; }
</style>
