<template>
  <view class="leaderboard">
    <view class="head">
      <text class="title">排行榜</text>
      <text class="head-hint">{{ headHint }}</text>
    </view>

    <view
      v-for="row in shown"
      :key="row.playerId"
      class="row"
      :class="{ me: row.playerId === me }"
    >
      <text class="rank" :class="rankClass(row.rank)">{{ rankLabel(row.rank) }}</text>
      <view class="who">
        <text class="name"><PlayerIdentity :name="row.name" :mbti="row.mbti ?? roomStore.members.find(p => p.id === row.playerId)?.mbti" /></text>
        <text v-if="row.degradedRounds > 0" class="tag">含 {{ row.degradedRounds }} 轮无 AI 评分</text>
      </view>
      <text v-if="row.delta" class="delta">+{{ row.delta }}</text>
      <text class="total">{{ row.total }}</text>
    </view>

    <text v-if="shown.length === 0" class="empty">还没有人得分</text>
  </view>
</template>

<script setup lang="ts">
/**
 * 排行榜（FR-05 的输出形态）。
 *
 * 带版本号保护：实时推送不保证顺序，晚到的旧榜单不能把新榜单盖回去。
 * 显示用的行来自 props，但只有版本号不比本地旧时才采用。
 */
import { computed, ref, watch } from 'vue'
import PlayerIdentity from '../PlayerIdentity.vue'
import { useRoomStore } from '../../stores/room'
import type { LeaderboardRow } from '@/modules/score'

const props = withDefaults(
  defineProps<{
    rows: LeaderboardRow[]
    /** ScoreBook.version，或者服务端广播里的榜单版本 */
    version?: number
    /** 本机玩家，高亮用 */
    me?: string
    /** 大屏模式只显示前几名 */
    limit?: number
  }>(),
  { version: 0, me: '', limit: 0 },
)

const roomStore = useRoomStore()
const shown = ref<LeaderboardRow[]>(props.rows)
const shownVersion = ref(props.version)

watch(
  () => [props.rows, props.version] as const,
  ([rows, version]) => {
    if (version < shownVersion.value) return
    shownVersion.value = version
    shown.value = props.limit > 0 ? rows.slice(0, props.limit) : rows
  },
  { immediate: true, deep: false },
)

const headHint = computed(() => {
  if (props.limit > 0) return `前 ${props.limit} 名`
  return `${shown.value.length} 人`
})

function rankLabel(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return String(rank)
}

function rankClass(rank: number): string {
  return rank <= 3 ? `top top-${rank}` : 'normal'
}
</script>

<style scoped>
.leaderboard {
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background: #fff;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8rpx;
}
.title {
  font-size: 30rpx;
  font-weight: 600;
}
.head-hint {
  color: #8a8f9c;
  font-size: 22rpx;
}
.row {
  display: flex;
  align-items: center;
  min-height: 76rpx;
  border-bottom: 1rpx solid #f0f1f5;
}
.row:last-child {
  border-bottom: none;
}
.row.me {
  background: #f7f8fc;
}
.rank {
  width: 56rpx;
  color: #8a8f9c;
  font-size: 26rpx;
  text-align: center;
}
.rank.top {
  font-size: 32rpx;
}
.who {
  flex: 1;
  min-width: 0;
}
.name {
  display: block;
  overflow: hidden;
  font-size: 28rpx;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tag {
  display: block;
  color: #8a5a00;
  font-size: 20rpx;
}
.delta {
  margin-right: 16rpx;
  color: #16a34a;
  font-size: 26rpx;
  font-weight: 600;
  animation: pop 900ms ease-out;
}
.total {
  min-width: 80rpx;
  font-size: 32rpx;
  font-weight: 600;
  text-align: right;
}
.empty {
  display: block;
  padding: 24rpx 0;
  color: #8a8f9c;
  font-size: 24rpx;
  text-align: center;
}
@keyframes pop {
  0% {
    opacity: 0;
    transform: translateY(8rpx) scale(0.9);
  }
  30% {
    opacity: 1;
    transform: translateY(0) scale(1.1);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
