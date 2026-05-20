import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  optimizeDeps: {
    exclude: ['lucide-react'],
  },

  server: {
    watch: {
      usePolling: true,
    },
  },

  build: {
    // PHASE 8 — Code splitting for faster initial load
    // Each route group loads only what it needs
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime — always needed
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],

          // Date handling
          'vendor-date': ['date-fns'],

          // QR code library — only needed on scanner + invitation pages
          'vendor-qr': ['qrcode', 'jsqr'],

          // PDF/Excel export — only needed on admin-heavy pages
          'vendor-export': ['jspdf', 'xlsx'],

          // Charts/canvas — only needed on ticket designer
          'vendor-canvas': ['html2canvas'],

          // Supabase client
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },

    // Generate source maps for production debugging (optional — remove if bundle size matters)
    sourcemap: false,

    // Warn if any chunk exceeds 500kb
    chunkSizeWarningLimit: 500,
  },
});