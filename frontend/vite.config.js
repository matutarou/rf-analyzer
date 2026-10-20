import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function resolvePort(envName, defaultPort) {
  const value = process.env[envName]
  if (value === undefined) return defaultPort
  const port = Number(value)
  if (!/^[+-]?\d+$/.test(value.trim()) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${envName} は1〜65535の整数で指定してください: ${JSON.stringify(value)}`)
  }
  return port
}

const backendPort = resolvePort('RF_BACKEND_PORT', 8780)
const frontendPort = resolvePort('RF_FRONTEND_PORT', 5280)

export default defineConfig({
  plugins: [react()],
  server: {
    port: frontendPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
})
