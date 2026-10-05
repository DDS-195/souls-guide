import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    // TinyMCE 是仅桌面写作页按需加载的独立异步包（gzip 约 430 KiB）；
    // 初始包不受影响，超过当前编辑器体量的异常增长仍会触发告警。
    chunkSizeWarningLimit: 1300,
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
})
