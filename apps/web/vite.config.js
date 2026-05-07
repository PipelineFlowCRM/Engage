var _a, _b, _c;
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
                target: (_a = process.env.VITE_API_URL) !== null && _a !== void 0 ? _a : 'http://localhost:4100',
                changeOrigin: true,
            },
            '/p': {
                target: (_b = process.env.VITE_API_URL) !== null && _b !== void 0 ? _b : 'http://localhost:4100',
                changeOrigin: true,
            },
            '/admin/queues': {
                target: (_c = process.env.VITE_API_URL) !== null && _c !== void 0 ? _c : 'http://localhost:4100',
                changeOrigin: true,
            },
        },
    },
});
