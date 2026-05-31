import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    fs: {
      // Allow importing shared brand SVGs from the repo root
      // (../assets/*) so the logo files have a single source of
      // truth at /assets/. Scoped to ../assets specifically (not
      // the whole parent) so the dev server can't serve anything
      // else from outside web/ if it's bound beyond localhost.
      allow: ['.', '../assets'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
