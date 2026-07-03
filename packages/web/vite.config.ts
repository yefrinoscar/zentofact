import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3010';
const apiPrefixes = [
  '/api',
  '/health',
  '/companies',
  '/branches',
  '/boletas',
  '/facturas',
  '/credit-notes',
  '/daily-summaries',
  '/falabella',
  '/workflow',
  '/auto-emit',
  '/webhooks',
];

// Frontend web independiente. El proxy mantiene la API desacoplada en dev.
export default defineConfig({
  root: __dirname,
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 3011,
    proxy: Object.fromEntries(
      apiPrefixes.map((prefix) => [
        prefix,
        {
          target: apiTarget,
          changeOrigin: true,
        },
      ]),
    ),
  },
  preview: {
    allowedHosts: true,
  },
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true },
});
