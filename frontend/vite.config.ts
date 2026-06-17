import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080', // 使用 127.0.0.1 避免 Node.js 17+ 默认解析 localhost 为 IPv6 (::1) 导致连接拒绝
        changeOrigin: true,
        ws: true,
      }
    }
  }
})
