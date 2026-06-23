import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: './',   // top-level: makes built asset paths relative (./assets/…) so file:// works
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: '0.0.0.0',
    port: 5175,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3333',
        changeOrigin: true,
      },
    },
    // /api/vision/* is a subset of /api — already proxied above
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-slot'],
          'settings': [
            './src/pages/SettingsPage.tsx',
            './src/components/settings/sections/GeneralSettingsSection.tsx',
            './src/components/settings/sections/UserManagementSection.tsx',
            './src/components/settings/sections/SystemResetSection.tsx',
          ],
        },
      },
    },
  },
})
