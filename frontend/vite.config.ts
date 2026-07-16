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
  // Same /api proxy for `vite preview` so session cookies stay same-origin when
  // opening http://localhost:5173 against a build that embeds 127.0.0.1:3333.
  preview: {
    // Bind all interfaces so http://localhost:5173 and http://127.0.0.1:5173
    // both reach the kiosk build (Chromium may resolve localhost via IPv4/IPv6).
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3333',
        changeOrigin: true,
      },
    },
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
