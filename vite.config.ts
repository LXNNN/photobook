import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 默认按 GitHub Pages 的子路径部署；根路径部署（如 Cloudflare Pages）用 npm run build:cf
// （等价于 vite build --base=/）。也可用环境变量 VITE_BASE 覆盖，但 Windows Git Bash
// 会把裸 "/" 当成路径转换，建议优先用 build:cf。
const base = process.env.VITE_BASE || '/photobook/'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
})
