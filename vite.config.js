import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Development only: forward the Snappy chat API like scripts/serve-lan.mjs does.
  server: {
    proxy: {
      '/api/agent': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
        // changeOrigin rewrites Host, so a same-origin browser Origin would no longer match it
        // at the Snappy server. Drop the Origin only when it is the dev server's own; a foreign
        // Origin is left in place and refused by Snappy, as by serve-lan.mjs.
        configure: proxy => proxy.on('proxyReq', (proxyReq, req) => {
          const origin = req.headers.origin;
          try { if (origin && new URL(origin).host === req.headers.host) proxyReq.removeHeader('origin'); } catch { /* keep it */ }
        }),
      },
    },
  },
})
