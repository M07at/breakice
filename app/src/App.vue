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
@import './styles/background.css';
page {
  /* 全局背景：只用这张图，不叠黑底 */
  background-color: #f6f8fb;
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  color: #172033;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 28rpx;
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
