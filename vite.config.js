import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    minify: 'esbuild',
    cssMinify: true,
    reportCompressedSize: false,
    target: 'es2020',
    rollupOptions: {
      treeshake: true,
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor'
          }

          if (id.includes('node_modules/leaflet')) {
            return 'leaflet'
          }

          if (id.includes('node_modules/firebase/app-check') || id.includes('node_modules/firebase/auth')) {
            return 'firebase-auth'
          }

          if (id.includes('node_modules/firebase/firestore') || id.includes('node_modules/firebase/database')) {
            return 'firebase-data'
          }

          if (id.includes('node_modules/firebase/analytics')) {
            return 'firebase-analytics'
          }

          if (id.includes('node_modules/firebase')) {
            return 'firebase-core'
          }
        }
      }
    }
  }
})