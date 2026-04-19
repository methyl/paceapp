import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// VITE_API_TARGET: dev-only URL for the /api proxy (default matches `wrangler pages dev`).
// Prefer `bun run dev:pages` which starts both and routes /api internally.
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8788'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
})
