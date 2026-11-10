import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev proxy (docs/01): same-origin API calls, no CORS code anywhere.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
