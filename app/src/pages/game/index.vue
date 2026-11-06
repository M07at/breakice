<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onShareAppMessage } from '@dcloudio/uni-app'
import { useRoomStore } from '../../stores/room'
import { getPromptPoolSize, pickPrompt, pickRandomPlayer, refreshPromptPools } from '../../services/truthOrDareService'
import { setTruth } from '../../services/roomService'
import type { Player, TruthOrDarePrompt, TruthTurn } from '../../types/room'
import Avatar from '../../components/Avatar.vue'
import PlayerIdentity from '../../components/PlayerIdentity.vue'

const roomStore = useRoomStore()
const room = computed(() => roomStore.room)
const targetPlayer = ref<Player | null>(null)
const prompt = ref<TruthOrDarePrompt | null>(null)
const completedIds = ref<string[]>([])
const round = ref(1)
const spinning = ref(false)
const showCustomPrompt = ref(false)
const customPrompt = ref('')
const activeTab = ref<'truth' | 'dare'>('truth')

/** 把这一轮写进房间共享状态：所有设备看到同一个人、同一道题 */
async function publish(turn: Partial<TruthTurn>): Promise<void> {
  const current = room.value
  if (!current) return
  const payload: TruthTurn = {
    round: turn.round ?? round.value,
    targetId: turn.targetId !== undefined ? turn.targetId : (targetPlayer.value?.id ?? null),
    promptId: turn.promptId !== undefined ? turn.promptId : (prompt.value?.id ?? null),
    type: turn.type ?? prompt.value?.type ?? activeTab.value,
    text: turn.text !== undefined ? turn.text : (prompt.value?.text ?? ''),
    at: Date.now(),
    by: roomStore.currentPlayerId ?? '',
  }
  try {
    await setTruth(current.id, payload)
  } catch (error) {
    console.warn('同步真心话状态失败', error)
  }
}

/** 别人转了盘/换了题：跟着更新，避免各看各的 */
watch(
  () => room.value?.truth ?? null,
  (shared) => {
    if (!shared) return
    if (shared.round !== round.value) round.value = shared.round
    targetPlayer.value = shared.targetId
      ? (room.value?.players.find((player) => player.id === shared.targetId) ?? null)
      : null
    prompt.value =
      shared.promptId && shared.text
        ? { id: shared.promptId, type: shared.type, text: shared.text, difficulty: '轻松' }
        : null
  },
  { immediate: true },
)

const remainingText = computed(() => `${completedIds.value.length} 轮已完成`)
const poolVersion = ref(0)
const poolText = computed(() => {
  poolVersion.value
  return `${getPromptPoolSize('truth')} 条真心话 · ${getPromptPoolSize('dare')} 条大冒险`
})

// 题库来自 C 模块的共享题库：先渲染系统题库，再把自建题库并进来。
onMounted(async () => {
  await refreshPromptPools()
  poolVersion.value += 1
})

function spin() {
  if (spinning.value || !room.value?.players.length) return
  spinning.value = true
  prompt.value = null
  setTimeout(() => {
    targetPlayer.value = pickRandomPlayer(room.value?.players ?? [])
    prompt.value = pickPrompt(activeTab.value)
    spinning.value = false
    void publish({
      targetId: targetPlayer.value?.id ?? null,
      promptId: prompt.value?.id ?? null,
      type: prompt.value?.type ?? activeTab.value,
      text: prompt.value?.text ?? '',
    })
  }, 760)
}

function drawPrompt(type: 'truth' | 'dare') {
  activeTab.value = type
  prompt.value = pickPrompt(type)
  void publish({ promptId: prompt.value?.id ?? null, type, text: prompt.value?.text ?? '' })
}

function completeRound() {
  if (!prompt.value || !targetPlayer.value) return
  completedIds.value.push(prompt.value.id)
  uni.showToast({ title: '这一轮完成啦', icon: 'none' })
}

function nextRound() {
  round.value += 1
  targetPlayer.value = null
  prompt.value = null
  void publish({ round: round.value, targetId: null, promptId: null, text: '' })
}

function addCustomPrompt() {
  if (!customPrompt.value.trim()) {
    uni.showToast({ title: '先写下你的题目', icon: 'none' })
    return
  }
  prompt.value = {
    id: `custom-${Date.now()}`,
    type: activeTab.value,
    text: customPrompt.value.trim(),
    difficulty: '进阶',
  }
  customPrompt.value = ''
  showCustomPrompt.value = false
  void publish({ promptId: prompt.value.id, type: prompt.value.type, text: prompt.value.text })
}

function leaveGame() {
  uni.navigateBack({ delta: 1 })
}

function goHome() {
  uni.reLaunch({ url: '/pages/home/index' })
}

onShareAppMessage(() => ({
  title: `${room.value?.name ?? '破冰局'}正在玩真心话大冒险`,
  path: `/pages/join/index?code=${room.value?.code ?? ''}`,
}))
</script>

<template>
  <view v-if="room" class="page game-page">
    <view class="game-topbar row-between">
      <view>
        <text class="eyebrow">ROUND {{ String(round).padStart(2, '0') }}</text>
        <text class="title">真心话大冒险</text>
      </view>
      <button class="leave-btn" @click="leaveGame">退出</button>
    </view>

    <view class="round-meta row-between">
      <text class="muted">{{ room.name }} · {{ room.players.length }} 位玩家</text>
      <text class="progress">{{ remainingText }}</text>
    </view>

    <view class="turn-card surface">
      <view class="turn-label"><text>本轮由谁来挑战</text><text class="turn-status">{{ spinning ? '转盘中...' : '点击开始' }}</text></view>
      <view :class="['wheel', { spinning }]">
        <view class="wheel-ring"><Avatar v-if="targetPlayer" :avatar="targetPlayer.avatar" size="large" /><text v-else class="wheel-emoji">✦</text></view>
        <text class="wheel-name"><PlayerIdentity :name="targetPlayer?.nickname ?? '等待抽取'" :mbti="targetPlayer?.mbti" /></text>
      </view>
      <button class="spin-button" :disabled="spinning" @click="spin">{{ spinning ? '正在抽取' : targetPlayer ? '再转一次' : '开始转盘' }}</button>
    </view>

    <view v-if="targetPlayer" class="prompt-section">
      <view class="prompt-tabs">
        <button :class="['prompt-tab', { active: activeTab === 'truth' }]" @click="drawPrompt('truth')">真心话</button>
        <button :class="['prompt-tab', { active: activeTab === 'dare' }]" @click="drawPrompt('dare')">大冒险</button>
      </view>

      <view class="prompt-card">
        <view class="prompt-card-top"><text class="prompt-badge">{{ prompt ? (prompt.type === 'truth' ? 'TRUTH' : 'DARE') : 'READY' }}</text><text class="difficulty">{{ prompt?.difficulty ?? '选择一种玩法' }}</text></view>
        <text class="prompt-target"><PlayerIdentity :name="targetPlayer.nickname" :mbti="targetPlayer.mbti" /> 的题目</text>
        <text class="prompt-text">{{ prompt?.text ?? '抽取一张题目卡，开始这一轮破冰。' }}</text>
        <view class="prompt-actions">
          <button class="draw-btn" @click="drawPrompt(activeTab)">{{ prompt ? '换一题' : '抽取题目' }}</button>
          <button class="custom-btn" @click="showCustomPrompt = true">自定义题目</button>
        </view>
      </view>

      <button v-if="prompt" class="complete-btn" @click="completeRound">完成这一轮</button>
      <button class="next-btn" @click="nextRound">下一轮 ›</button>
    </view>

    <view class="game-note">题库：{{ poolText }}。题目仅供破冰参考，任何人都可以选择跳过不适合自己的问题。</view>

    <view v-if="showCustomPrompt" class="modal-mask" @click.self="showCustomPrompt = false">
      <view class="modal-sheet">
        <view class="section-title"><text>添加自定义题目</text><text class="close" @click="showCustomPrompt = false">×</text></view>
        <textarea v-model="customPrompt" class="custom-input" maxlength="80" placeholder="写下一个适合现场氛围的问题或挑战" />
        <button class="btn btn-primary" @click="addCustomPrompt">加入本轮题库</button>
      </view>
    </view>
  </view>
  <view v-else class="page empty-page"><text class="title">还没有加入房间</text><button class="btn btn-primary" @click="goHome">返回首页</button></view>
</template>

<style scoped>
.game-page {
  padding-top: 26rpx;
}

.game-topbar {
  margin-bottom: 18rpx;
}

.game-topbar .title {
  display: block;
  margin-top: 7rpx;
  font-size: 38rpx;
}

.leave-btn {
  height: 58rpx;
  padding: 0 22rpx;
  border: 1rpx solid var(--line);
  border-radius: 14rpx;
  color: var(--muted);
  background: #fff;
  font-size: 22rpx;
  line-height: 58rpx;
}

.round-meta {
  margin-bottom: 22rpx;
  font-size: 21rpx;
}

.progress {
  color: var(--brand);
  font-size: 21rpx;
  font-weight: 700;
}

.turn-card {
  padding: 30rpx 24rpx 26rpx;
  text-align: center;
}

.turn-label {
  display: flex;
  justify-content: space-between;
  color: var(--ink);
  font-size: 24rpx;
  font-weight: 800;
}

.turn-status {
  color: var(--brand);
  font-size: 21rpx;
  font-weight: 500;
}

.wheel {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 30rpx 0 26rpx;
}

.wheel.spinning .wheel-ring {
  animation: pulse 0.45s ease-in-out infinite alternate;
}

.wheel-ring {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 176rpx;
  height: 176rpx;
  border: 12rpx solid #dcd9ff;
  border-radius: 50%;
  background: var(--brand-soft);
  box-shadow: 0 0 0 12rpx #f5f4ff;
}

.wheel-emoji {
  font-size: 74rpx;
}

.wheel-name {
  margin-top: 18rpx;
  color: var(--ink);
  font-size: 30rpx;
  font-weight: 800;
}

.spin-button {
  width: 84%;
  height: 80rpx;
  border-radius: 17rpx;
  color: #fff;
  background: var(--brand);
  font-size: 27rpx;
  font-weight: 800;
  line-height: 80rpx;
}

.spin-button[disabled] {
  opacity: 0.65;
}

.prompt-section {
  margin-top: 24rpx;
}

.prompt-tabs {
  display: flex;
  gap: 12rpx;
  margin-bottom: 14rpx;
}

.prompt-tab {
  flex: 1;
  height: 70rpx;
  border-radius: 15rpx;
  color: var(--muted);
  background: #eaedf2;
  font-size: 25rpx;
  line-height: 70rpx;
}

.prompt-tab.active {
  color: var(--brand-deep);
  background: var(--brand-soft);
  font-weight: 800;
}

.prompt-card {
  min-height: 270rpx;
  padding: 28rpx;
  border-radius: var(--radius-lg);
  background: #172033;
  box-shadow: 0 18rpx 36rpx rgba(23, 32, 51, 0.18);
}

.prompt-card-top,
.prompt-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.prompt-badge {
  padding: 7rpx 12rpx;
  border-radius: 8rpx;
  color: #b9b5ff;
  background: rgba(238, 240, 255, 0.13);
  font-size: 18rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
}

.difficulty {
  color: #aeb5c6;
  font-size: 20rpx;
}

.prompt-target {
  display: block;
  margin-top: 24rpx;
  color: #fff;
  font-size: 23rpx;
  font-weight: 700;
}

.prompt-text {
  display: block;
  min-height: 76rpx;
  margin-top: 13rpx;
  color: #fff;
  font-size: 30rpx;
  font-weight: 800;
  line-height: 1.5;
}

.prompt-actions {
  justify-content: flex-start;
  gap: 18rpx;
  margin-top: 20rpx;
}

.draw-btn,
.custom-btn {
  height: 62rpx;
  padding: 0 22rpx;
  border-radius: 13rpx;
  font-size: 22rpx;
  line-height: 62rpx;
}

.draw-btn {
  color: var(--brand-deep);
  background: #fff;
}

.custom-btn {
  color: #e2e5ee;
  background: rgba(255, 255, 255, 0.1);
}

.complete-btn,
.next-btn {
  width: 100%;
  height: 78rpx;
  margin-top: 18rpx;
  border-radius: 16rpx;
  font-size: 26rpx;
  line-height: 78rpx;
}

.complete-btn {
  color: #fff;
  background: var(--mint);
}

.next-btn {
  color: var(--brand);
  background: var(--brand-soft);
}

.game-note {
  margin-top: 22rpx;
  color: var(--muted);
  font-size: 20rpx;
  line-height: 1.5;
  text-align: center;
}

.modal-mask {
  position: fixed;
  z-index: 10;
  inset: 0;
  display: flex;
  align-items: flex-end;
  background: rgba(23, 32, 51, 0.38);
}

.modal-sheet {
  width: 100%;
  padding: 30rpx 32rpx 54rpx;
  border-radius: 28rpx 28rpx 0 0;
  background: #fff;
}

.close {
  color: var(--muted);
  font-size: 44rpx;
  font-weight: 300;
}

.custom-input {
  width: 100%;
  min-height: 180rpx;
  padding: 20rpx;
  border: 1rpx solid var(--line);
  border-radius: 16rpx;
  color: var(--ink);
  background: #fbfcfe;
  font-size: 25rpx;
  line-height: 1.5;
}

.modal-sheet .btn {
  margin-top: 20rpx;
}

@keyframes pulse {
  from { transform: scale(0.95) rotate(-8deg); }
  to { transform: scale(1.05) rotate(8deg); }
}
</style>



