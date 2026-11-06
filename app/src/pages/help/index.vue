<script setup lang="ts">
const topInset = (() => {
  try {
    const info = uni.getWindowInfo?.() ?? uni.getSystemInfoSync()
    return Number(info.statusBarHeight) || 20
  } catch {
    return 20
  }
})()

function back() {
  uni.navigateBack({ delta: 1, fail: () => uni.reLaunch({ url: '/pages/home/index' }) })
}

const steps = [
  '先给自己捏个雪人、起个游戏名字（MBTI 选填），进去后大家就靠它认人。',
  '点「创建房间」，把房间号或二维码发到群里；朋友点「加入房间」输房间号或扫码。',
  '人到齐后各自点「我准备好了」，由房主选一个玩法开始。一局结束后回到大厅，重新准备就能再来一局。',
]

const games = [
  {
    name: '谁是卧底',
    need: '至少 4 人',
    lines: [
      '每人拿到一个词，大多数人一样（平民），少数人拿到相近但不同的词（卧底）。',
      '按顺序轮流用一句话描述自己的词，不能直接说出词语本身。',
      '所有人发言完投票，票数最多的人出局；平票则平票者加赛。',
      '卧底全部出局平民赢；平民全部出局、或只剩一平民一卧底，则卧底赢。',
    ],
  },
  {
    name: '你画我猜',
    need: '至少 2 人',
    lines: [
      '轮到谁画，谁拿到一个词，用画笔把它画出来，其他人盯着看。',
      '其他人随时可以输入答案，猜中有提示；答对越快得分越高。',
      '画的人每有一人猜对也会加分，倒计时结束自动交画。',
      '一局结束后按积分排名，前三名上台领奖。',
    ],
  },
  {
    name: '你画我猜谁是卧底',
    need: '至少 4 人',
    lines: [
      '结合了前两个玩法：既可以画，也可以靠描述和投票找卧底。',
      '每轮共用一块画板，按发言顺序接力作画，后一个人接着前一个人的画继续。',
      '轮末所有人依次展示自己那一版画面，再进入投票。',
      '找出卧底的方式与「谁是卧底」一致。',
    ],
  },
  {
    name: '真心话大冒险',
    need: '2 人以上',
    lines: [
      '房主抽取题目，选择真心话或大冒险，所有人在自己手机上看到同一道题。',
      '被抽到的人完成题目，完成后点「完成这一轮并进入下一轮」。',
      '题目仅供破冰参考，任何人有权利跳过让自己不适的问题。',
    ],
  },
]
</script>

<template>
  <view class="help-page" :style="{ paddingTop: topInset + 'px' }">
    <view class="head">
      <text class="eyebrow">HOW TO PLAY</text>
      <text class="title">使用说明</text>
    </view>

    <scroll-view scroll-y class="scroll">
      <view class="card">
        <text class="card-title">三步开始</text>
        <view v-for="(step, index) in steps" :key="index" class="step">
          <text class="step-no">{{ index + 1 }}</text>
          <text class="step-text">{{ step }}</text>
        </view>
      </view>

      <view v-for="game in games" :key="game.name" class="card">
        <view class="card-head">
          <text class="card-title">{{ game.name }}</text>
          <text class="need">{{ game.need }}</text>
        </view>
        <text v-for="(line, index) in game.lines" :key="index" class="rule">· {{ line }}</text>
      </view>

      <view class="card tip">
        <text class="card-title">小提示</text>
        <text class="rule">· 房主退出会关闭房间，其他人会回到主界面。</text>
        <text class="rule">· 结束后结算会一直保留，看够了再退出，也可以在房间里点「回到游戏」回来看。</text>
        <text class="rule">· 人不够时房主可以补充人机，人机只做最少的事，不会替你投票。</text>
      </view>
    </scroll-view>

    <view class="foot">
      <button class="back-btn" @tap="back">返回</button>
    </view>
  </view>
</template>

<style scoped>
.help-page {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  height: 100vh;
  background: #f7f8fb;
}

.head {
  position: relative;
  padding: 24rpx 32rpx 12rpx;
}

.eyebrow {
  display: block;
  color: var(--brand, #4f8ef7);
  font-size: 20rpx;
  letter-spacing: 2rpx;
}

.title {
  display: block;
  margin-top: 6rpx;
  color: var(--ink, #172033);
  font-size: 48rpx;
  font-weight: 800;
}

.foot {
  flex-shrink: 0;
  padding: 16rpx 32rpx 28rpx;
  padding-bottom: calc(28rpx + env(safe-area-inset-bottom));
}

.back-btn {
  width: 100%;
  height: 88rpx;
  border-radius: var(--radius-md, 20rpx);
  background: var(--brand, #4f8ef7);
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 88rpx;
}

.back-btn::after {
  border: none;
}

.scroll {
  flex: 1;
  min-height: 0;
  padding: 8rpx 32rpx 40rpx;
  box-sizing: border-box;
}

.card {
  margin-bottom: 22rpx;
  padding: 26rpx;
  border-radius: var(--radius-lg, 28rpx);
  background: #fff;
  box-shadow: 0 10rpx 26rpx rgba(30, 41, 59, 0.06);
}

.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

.card-title {
  display: block;
  color: var(--ink, #172033);
  font-size: 30rpx;
  font-weight: 700;
  margin-bottom: 12rpx;
}

.need {
  margin-bottom: 12rpx;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  background: var(--brand-soft, #e9f1ff);
  color: var(--brand-deep, #2f6bd6);
  font-size: 20rpx;
}

.step {
  display: flex;
  align-items: flex-start;
  margin-top: 14rpx;
}

.step-no {
  flex-shrink: 0;
  width: 36rpx;
  height: 36rpx;
  margin-right: 14rpx;
  border-radius: 50%;
  background: var(--brand, #4f8ef7);
  color: #fff;
  font-size: 20rpx;
  line-height: 36rpx;
  text-align: center;
}

.step-text {
  flex: 1;
  color: var(--muted, #6c7588);
  font-size: 24rpx;
  line-height: 1.6;
}

.rule {
  display: block;
  margin-top: 10rpx;
  color: var(--muted, #6c7588);
  font-size: 24rpx;
  line-height: 1.65;
}

.tip {
  background: var(--brand-soft, #e9f1ff);
}

.tip .rule {
  color: var(--brand-deep, #2f6bd6);
}
</style>
