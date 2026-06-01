import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, '..', '')
  const apiPort = rootEnv.PORT || '3000'
  const devPort = Number(rootEnv.FRONTEND_DEV_PORT || '3001')
  const apiTarget = rootEnv.VITE_API_PROXY_TARGET || `http://127.0.0.1:${apiPort}`

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: devPort,
      strictPort: false,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/webhooks': { target: apiTarget, changeOrigin: true },
      },
    },
  }
})
