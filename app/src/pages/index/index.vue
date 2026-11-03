<template>
  <view class="content">
    <image class="logo" src="/static/logo.png" />
    <text class="title">破冰局</text>
    <!-- 开发入口：D 的大厅做好后删掉，改由大厅进入各个游戏 -->
    <view class="dev">
      <text class="dev-title">开发测试入口</text>
      <button class="dev-btn" @tap="go('/pages-uc/setup')">谁是卧底</button>
      <button class="dev-btn" @tap="go('/pages-uc/hybrid')">你画我猜谁是卧底</button>
      <button class="dev-btn" @tap="go('/pages-draw/setup')">你画我猜</button>
      <button class="dev-btn" @tap="go('/pages-bank/index')">题库管理</button>
    </view>
  </view>
</template>

<script setup lang="ts">
function go(url: string) {
  uni.navigateTo({ url })
}
</script>

<style>
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.logo {
  height: 200rpx;
  width: 200rpx;
  margin-top: 200rpx;
  margin-left: auto;
  margin-right: auto;
  margin-bottom: 50rpx;
}

.title {
  font-size: 36rpx;
  color: #8f8f94;
}

.dev {
  width: 80%;
  margin-top: 80rpx;
}

.dev-title {
  display: block;
  margin-bottom: 16rpx;
  color: #8f8f94;
  font-size: 24rpx;
  text-align: center;
}

.dev-btn {
  margin-bottom: 20rpx;
}
</style>
