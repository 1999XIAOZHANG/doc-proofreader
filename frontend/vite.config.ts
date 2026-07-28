import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: false,  // 端口冲突自动找下一个
    proxy: {
      '/api': {
        target: 'http://localhost:6545',
        changeOrigin: true
      }
    }
  }
})
