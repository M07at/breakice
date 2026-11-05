<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'

/** 构建标识：改这里 + 重新构建，控制台就能确认跑的是不是最新包 */
const BUILD_ID = 'v17-1105'

onLaunch(() => {
  // 每次启动都打一条，方便从控制台截图判断版本
  console.log(`[破冰局] build ${BUILD_ID}`)
})
</script>

<style>
page {
  /* 全局背景：图片 + 半透明黑底，所有页面统一 */
  background-color: #0b1020;
  background-image: url('/static/background.jpg');
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  color: #172033;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 28rpx;
}

/* 半透明黑底：叠在背景图上，让内容区是深色玻璃质感，卡片仍然透出白 */
view.page {
  min-height: 100vh;
  background: rgba(8, 12, 24, 0.55) !important;
}

view,
text,
button,
input,
scroll-view {
  box-sizing: border-box;
}

button::after {
  border: 0;
}
</style>
