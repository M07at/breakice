<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'

onLaunch(() => {
  // Supabase 登录和重连恢复由后端适配层接入后启用。
})
</script>

<style>
page {
  background: #f6f8fb;
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
