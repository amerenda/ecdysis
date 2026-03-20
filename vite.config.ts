import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8082',
      '/control': 'http://localhost:8082',
      '/health': 'http://localhost:8082',
    },
  },
})
