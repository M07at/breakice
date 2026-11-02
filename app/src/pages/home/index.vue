<script setup lang="ts">
function go(path: string) {
  uni.navigateTo({ url: path })
}

function showHelp() {
  uni.showToast({ title: '选择一个入口开始吧', icon: 'none' })
}
</script>

<template>
  <view class="home-page">
    <view class="home-topbar">
      <view class="brand-lockup">
        <view class="brand-mark">✦</view>
        <view>
          <text class="brand-name">破冰局</text>
          <text class="brand-caption">让陌生人快速熟起来</text>
        </view>
      </view>
      <view class="help-button" @click="showHelp">?</view>
    </view>

    <view class="hero-copy">
      <text class="eyebrow">BREAK THE ICE</text>
      <text class="hero-title">今天，和大家玩点不一样的。</text>
      <text class="hero-subtitle">扫码即玩 · 轻松破冰 · 记住彼此</text>
    </view>

    <view class="action-panel">
      <button class="main-action" @click="go('/pages/create/index')">
        <text class="action-icon">＋</text>
        <view class="action-copy">
          <text class="action-title">创建一个房间</text>
          <text class="action-desc">你来主持，大家一起玩</text>
        </view>
        <text class="action-arrow">›</text>
      </button>
      <button class="join-action" @click="go('/pages/join/index')">
        <text class="action-icon">↗</text>
        <view class="action-copy">
          <text class="action-title">加入朋友的房间</text>
          <text class="action-desc">输入房间号或扫码加入</text>
        </view>
        <text class="action-arrow">›</text>
      </button>
    </view>

    <view class="games-section">
      <view class="section-heading">
        <text>今晚玩什么</text>
        <text class="section-note">更多玩法陆续上线</text>
      </view>
      <view class="game-preview-row">
        <view class="game-preview truth">
          <text class="game-emoji">🎡</text>
          <text class="game-name">真心话大冒险</text>
          <text class="game-status">房间内开启</text>
        </view>
        <view class="game-preview drawing">
          <text class="game-emoji">✏️</text>
          <text class="game-name">你画我猜</text>
          <text class="game-status">即将上线</text>
        </view>
        <view class="game-preview undercover">
          <text class="game-emoji">🕵️</text>
          <text class="game-name">谁是卧底</text>
          <text class="game-status">房间内开启</text>
        </view>
      </view>
      <view class="bank-link" @click="go('/pages-bank/index')">
        <text class="bank-link-title">题库管理</text>
        <text class="bank-link-desc">谁是卧底与融合玩法共用 488 条题库</text>
        <text class="bank-link-arrow">›</text>
      </view>
    </view>

    <view class="trust-row">
      <text>● 适合 4-20 人</text>
      <text>● 手机就能玩</text>
      <text>● 无需注册</text>
    </view>
  </view>
</template>

<style scoped>
.home-page {
  min-height: 100vh;
  padding: 48rpx 32rpx 56rpx;
  background: var(--canvas);
}

.home-topbar,
.brand-lockup,
.section-heading,
.trust-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand-lockup {
  justify-content: flex-start;
  gap: 14rpx;
}

.brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  border-radius: 20rpx;
  color: #fff;
  background: var(--brand);
  font-size: 36rpx;
  font-weight: 800;
}

.brand-name,
.brand-caption {
  display: block;
}

.brand-name {
  color: var(--ink);
  font-size: 30rpx;
  font-weight: 800;
}

.brand-caption {
  margin-top: 3rpx;
  color: var(--muted);
  font-size: 20rpx;
}

.help-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx;
  height: 52rpx;
  border: 1rpx solid var(--line);
  border-radius: 50%;
  color: var(--muted);
  background: #fff;
  font-size: 28rpx;
  font-weight: 700;
}

.hero-copy {
  padding: 92rpx 10rpx 46rpx;
}

.eyebrow {
  display: block;
  color: var(--brand);
  font-size: 21rpx;
  font-weight: 800;
  letter-spacing: 5rpx;
}

.hero-title {
  display: block;
  margin-top: 18rpx;
  color: var(--ink);
  font-size: 54rpx;
  font-weight: 800;
  line-height: 1.25;
}

.hero-subtitle {
  display: block;
  margin-top: 18rpx;
  color: var(--muted);
  font-size: 26rpx;
}

.action-panel {
  display: grid;
  gap: 18rpx;
}

.main-action,
.join-action {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 142rpx;
  padding: 26rpx 24rpx;
  border-radius: 24rpx;
  text-align: left;
}

.main-action {
  color: #fff;
  background: var(--brand);
  box-shadow: 0 16rpx 30rpx rgba(79, 70, 229, 0.2);
}

.join-action {
  border: 1rpx solid var(--line);
  color: var(--ink);
  background: #fff;
}

.action-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 68rpx;
  height: 68rpx;
  border-radius: 18rpx;
  color: var(--brand);
  background: #fff;
  font-size: 38rpx;
  font-weight: 300;
}

.join-action .action-icon {
  color: var(--mint);
  background: var(--mint-soft);
}

.action-copy {
  flex: 1;
  margin-left: 18rpx;
}

.action-title,
.action-desc {
  display: block;
}

.action-title {
  font-size: 30rpx;
  font-weight: 800;
}

.action-desc {
  margin-top: 8rpx;
  opacity: 0.72;
  font-size: 22rpx;
}

.action-arrow {
  margin-left: 14rpx;
  opacity: 0.75;
  font-size: 46rpx;
  font-weight: 300;
}

.games-section {
  margin-top: 58rpx;
}

.section-heading {
  margin-bottom: 20rpx;
  color: var(--ink);
  font-size: 29rpx;
  font-weight: 800;
}

.section-note {
  color: var(--muted);
  font-size: 20rpx;
  font-weight: 400;
}

.game-preview-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14rpx;
}

.game-preview {
  min-height: 174rpx;
  padding: 20rpx 16rpx;
  border-radius: 18rpx;
}

.game-preview.truth {
  color: #5a45b7;
  background: #eeeafe;
}

.game-preview.drawing {
  color: #17826c;
  background: #e7f7f3;
}

.game-preview.undercover {
  color: #9f6414;
  background: #fff3dc;
}

.game-emoji,
.game-name,
.game-status {
  display: block;
}

.game-emoji {
  font-size: 36rpx;
}

.game-name {
  margin-top: 14rpx;
  font-size: 23rpx;
  font-weight: 800;
  line-height: 1.35;
}

.game-status {
  margin-top: 8rpx;
  opacity: 0.7;
  font-size: 18rpx;
}

.bank-link {
  display: flex;
  align-items: center;
  margin-top: 16rpx;
  padding: 22rpx 20rpx;
  border: 1rpx dashed var(--line);
  border-radius: 18rpx;
  background: #fff;
}

.bank-link-title {
  color: var(--ink);
  font-size: 25rpx;
  font-weight: 800;
}

.bank-link-desc {
  flex: 1;
  margin-left: 14rpx;
  color: var(--muted);
  font-size: 20rpx;
}

.bank-link-arrow {
  color: var(--brand);
  font-size: 38rpx;
}

.trust-row {
  justify-content: space-around;
  margin-top: 48rpx;
  color: var(--muted);
  font-size: 20rpx;
}
</style>
