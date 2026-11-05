<script setup lang="ts">
import { ref } from 'vue'
import { useRoomStore } from '../../stores/room'
import Avatar from '../../components/Avatar.vue'
import PlayerIdentity from '../../components/PlayerIdentity.vue'
import { getSavedProfile } from '../../services/avatarService'
import { toErrorMessage } from '../../platform/types'

const roomStore = useRoomStore()
const roomName = ref('周五破冰局')
const maxPlayers = ref('20')

/** 形象和昵称统一在首页设置，这里只读取，不再重复编辑 */
const profile = getSavedProfile()

async function submit() {
  if (!roomName.value.trim()) {
    uni.showToast({ title: '请填写房间名', icon: 'none' })
    return
  }
  // 用全局 loading 而不是按钮的 :loading：后者会在跳转同帧 patch Button 的插槽，
  // uni-app H5 运行时会抛 "Cannot assign to read only property '_'"，页面就卡住不跳。
  uni.showLoading({ title: '创建中…', mask: true })
  try {
    await roomStore.create({
      name: roomName.value.trim(),
      maxPlayers: Number(maxPlayers.value) || 20,
    })
    uni.hideLoading()
    // 用 reLaunch 直接落到房间页：清掉创建页，避免从房间返回时又回到表单
    uni.reLaunch({ url: '/pages/room/index' })
  } catch (issue) {
    uni.hideLoading()
    uni.showModal({
      title: '创建房间失败',
      content: roomStore.error || toErrorMessage(issue),
      showCancel: false,
      confirmText: '知道了',
    })
  }
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
      <view class="identity-row">
        <Avatar :avatar="profile.avatar" size="medium" />
        <view class="identity-copy">
          <text class="identity-name"><PlayerIdentity :name="profile.nickname" :mbti="profile.mbti" /></text>
          <text class="identity-hint">形象和昵称在首页设置</text>
        </view>
      </view>

      <view class="form-field">
        <text class="input-label">房间名称</text>
        <input v-model="roomName" class="input" maxlength="20" placeholder="例如：周五破冰局" />
      </view>
      <view class="form-field">
        <text class="input-label">人数上限</text>
        <input v-model="maxPlayers" class="input" type="number" maxlength="2" placeholder="4 - 20 人" />
        <text class="field-hint">建议 4-20 人，人数太多时可以分组玩。</text>
      </view>
    </view>

    <view class="tips surface">
      <text class="tips-title">创建后你可以</text>
      <text class="tip">• 分享房间号或二维码邀请朋友</text>
      <text class="tip">• 查看所有玩家的加入和准备状态</text>
      <text class="tip">• 选择玩法并控制游戏开始</text>
    </view>

    <button class="btn btn-primary submit-btn" @click="submit">创建并进入房间</button>
  </view>
</template>

<style scoped>
.identity-row {
  display: flex;
  align-items: center;
  padding-bottom: 24rpx;
  border-bottom: 1rpx solid var(--line);
}

.identity-copy {
  margin-left: 18rpx;
}

.identity-name {
  display: block;
  color: var(--ink);
  font-size: 30rpx;
  font-weight: 800;
}

.identity-hint {
  display: block;
  margin-top: 6rpx;
  color: var(--muted);
  font-size: 21rpx;
}

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
