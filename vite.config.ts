import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    // Desktop app ships as one local bundle (xterm + React); splitting is not useful here.
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
    },
  },
})
