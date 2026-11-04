import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import uniModule from '@dcloudio/vite-plugin-uni'
import { c1PreviewPlugin } from './dev/c1-preview-plugin'

// vite-plugin-uni 在部分安装形态下是 CJS 默认导出，这里兼容两种形态。
const uni = (uniModule as typeof uniModule & { default?: typeof uniModule }).default ?? uniModule

// 只有 H5 需要把 vue 指向 uni-app 的 H5 运行时；小程序端由 uni 插件自行解析。
const isH5 = process.env.UNI_PLATFORM === 'h5'


export default defineConfig({

  plugins: [uni(), c1PreviewPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      ...(isH5
        ? {
            vue: '@dcloudio/uni-h5-vue',
            'vue/package.json': '@dcloudio/uni-h5-vue/package.json',
          }
        : {}),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      // 编辑器/工具原子写入时会在源码目录里建临时目录，Vite 监听它会抛 EBUSY 把 dev server 打挂
      ignored: ['**/*.tmpdir/**', '**/.*.tmpdir/**'],
    },
  },
})

