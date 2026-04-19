import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// VITE_API_TARGET: dev-only Worker URL for the /api proxy (default matches wrangler dev).
// In production, set VITE_API_BASE to the deployed Worker origin and the proxy is unused.
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8787'

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
