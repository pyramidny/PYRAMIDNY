import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VitePWA removed — service worker was causing SSL cert errors on /auth/callback
// which blocked supabase.auth.exchangeCodeForSession from executing.
// This is an internal staff portal; PWA/offline support is not required.

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})
