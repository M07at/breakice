<script setup lang="ts">
import { ref } from 'vue'
import { useRoomStore } from '../../stores/room'
import AvatarEditor from '../../components/AvatarEditor.vue'
import { getSavedAvatar, saveAvatar } from '../../services/avatarService'
import type { AvatarConfig } from '../../types/room'

const roomStore = useRoomStore()
const roomName = ref('周五破冰局')
const nickname = ref('主持人')
const maxPlayers = ref('20')
const avatar = ref<AvatarConfig>(getSavedAvatar())

async function submit() {
  if (!roomName.value.trim() || !nickname.value.trim()) {
    uni.showToast({ title: '请填写房间名和昵称', icon: 'none' })
    return
  }
  await roomStore.create({
    name: roomName.value.trim(),
    nickname: nickname.value.trim(),
    maxPlayers: Number(maxPlayers.value) || 20,
    avatar: avatar.value,
  })
  saveAvatar(avatar.value)
  uni.redirectTo({ url: '/pages/room/index' })
}
</script>

<template>
  <view class="page">
    <view class="page-header">
      <text class="eyebrow">HOST MODE</text>
      <text class="title">创建房间</text>
      <text class="subtitle">先把房间准备好，朋友们马上就能加入。</text>
    </view>

    <view class="surface stack-24">
      <view class="form-field">
        <text class="input-label">房间名称</text>
        <input v-model="roomName" class="input" maxlength="20" placeholder="例如：周五破冰局" />
      </view>
      <view class="form-field">
        <text class="input-label">你的昵称</text>
        <input v-model="nickname" class="input" maxlength="12" placeholder="大家怎么称呼你" />
      </view>
      <view class="form-field">
        <text class="input-label">人数上限</text>
        <input v-model="maxPlayers" class="input" type="number" maxlength="2" placeholder="4 - 20 人" />
        <text class="field-hint">建议 4-20 人，人数太多时可以分组玩。</text>
      </view>
      <view class="form-field avatar-field">
        <view class="section-title"><text>你的头像</text><text class="muted">可随时更换</text></view>
        <AvatarEditor v-model="avatar" />
      </view>
    </view>

    <view class="tips surface">
      <text class="tips-title">创建后你可以</text>
      <text class="tip">• 分享房间号或二维码邀请朋友</text>
      <text class="tip">• 查看所有玩家的加入和准备状态</text>
      <text class="tip">• 选择玩法并控制游戏开始</text>
    </view>

    <button class="btn btn-primary submit-btn" :loading="roomStore.busy" @click="submit">创建并进入房间</button>
  </view>
</template>

<style scoped>
.field-hint {
  display: block;
  margin-top: 10rpx;
  color: var(--muted);
  font-size: 21rpx;
}

.form-field + .form-field {
  margin-top: 24rpx;
}

.tips {
  margin-top: 24rpx;
}

.tips-title,
.tip {
  display: block;
}

.tips-title {
  margin-bottom: 16rpx;
  color: var(--ink);
  font-size: 26rpx;
  font-weight: 800;
}

.tip {
  margin-top: 10rpx;
  color: var(--muted);
  font-size: 23rpx;
  line-height: 1.45;
}

.submit-btn {
  margin-top: 30rpx;
}
</style>
