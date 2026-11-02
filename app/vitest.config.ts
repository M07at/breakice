import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 单测只跑纯逻辑，不加载 uni 插件
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
