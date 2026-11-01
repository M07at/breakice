import { defineConfig } from 'vite'
import uniModule from '@dcloudio/vite-plugin-uni'

const uni = (uniModule as typeof uniModule & { default?: typeof uniModule }).default ?? uniModule

export default defineConfig({
  plugins: uni(),
  resolve: {
    alias: {
      vue: '@dcloudio/uni-h5-vue',
      'vue/package.json': '@dcloudio/uni-h5-vue/package.json',
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
