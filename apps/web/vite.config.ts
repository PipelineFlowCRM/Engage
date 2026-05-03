import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:4100',
        changeOrigin: true,
      },
      '/p': {
        target: process.env.VITE_API_URL ?? 'http://localhost:4100',
        changeOrigin: true,
      },
      '/admin/queues': {
        target: process.env.VITE_API_URL ?? 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
});
