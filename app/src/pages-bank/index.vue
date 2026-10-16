<template>
  <view class="page">
    <scroll-view scroll-x class="chips tabs">
      <view v-for="t in GAME_TYPES" :key="t" class="chip" :class="{ active: t === type }" @tap="setType(t)">
        {{ GAME_TYPE_LABEL[t] }}
      </view>
    </scroll-view>

    <view v-if="rows.length === 0" class="empty">还没有{{ GAME_TYPE_LABEL[type] }}题库</view>
    <view v-for="r in rows" :key="r.bank.id" class="card" @tap="open(r.bank.id)">
      <view class="card-head">
        <text class="card-title">{{ r.bank.name }}</text>
        <text class="badge" :class="r.bank.visibility">{{ r.bank.visibility === 'system' ? '系统' : '我的' }}</text>
      </view>
      <text class="hint">{{ r.count }} 条{{ r.bank.description ? ` · ${r.bank.description}` : '' }}</text>
    </view>

    <button class="primary" @tap="create">新建{{ GAME_TYPE_LABEL[type] }}题库</button>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { GAME_TYPES, GAME_TYPE_LABEL } from '@/modules/bank'
import type { Bank, GameType } from '@/modules/bank'
import { LOCAL_USER_ID, bankRepo } from '@/modules/local/session'

const type = ref<GameType>('undercover')
const rows = ref<{ bank: Bank; count: number }[]>([])

onShow(load)

async function load() {
  const repo = bankRepo()
  const banks = await repo.listBanks(LOCAL_USER_ID, type.value)
  rows.value = await Promise.all(banks.map(async (bank) => ({ bank, count: (await repo.listItems(bank.id)).length })))
}

function setType(t: GameType) {
  type.value = t
  load()
}

function open(id: string) {
  uni.navigateTo({ url: `/pages-bank/detail?id=${id}` })
}

function create() {
  uni.showModal({
    title: `新建${GAME_TYPE_LABEL[type.value]}题库`,
    editable: true,
    placeholderText: '题库名称，最多 20 个字',
    success: async (r) => {
      if (!r.confirm) return
      try {
        const bank = await bankRepo().createBank(
          { name: r.content ?? '', gameType: type.value, description: '' },
          LOCAL_USER_ID,
        )
        open(bank.id)
      } catch (e) {
        uni.showToast({ title: (e as Error).message, icon: 'none' })
      }
    },
  })
}
</script>

<style>
@import '../styles/c-temp.css';

.tabs {
  margin-bottom: 24rpx;
}
</style>
