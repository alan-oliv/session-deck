import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const stripTests = { 'import.meta.vitest': 'undefined' }

export default defineConfig({
  main: { define: stripTests },
  preload: { define: stripTests },
  renderer: {
    define: stripTests,
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
  },
})
