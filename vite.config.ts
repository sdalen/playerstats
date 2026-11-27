import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type ProxyOptions } from 'vite'

// API-et tillater kun CORS fra https://live.hockey.no, så nettleseren kaller /api
// og Vite videresender forespørselen server-side.
const apiProxy: Record<string, ProxyOptions> = {
  '/api': {
    target: 'https://sf34-terminlister-prod-app.azurewebsites.net',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
})
