import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const apiTarget = process.env.VITE_API_TARGET || process.env.VITE_API_URL || 'http://localhost:3010';
const apiPrefixes = [
  '/api',
  '/health',
  '/me',
  '/dashboard',
  '/orders-inbox',
  '/order-management',
  '/products',
  '/product-listings',
  '/inventory',
  '/catalog',
  '/users',
  '/insumos',
  '/companies',
  '/branches',
  '/boletas',
  '/facturas',
  '/documentos',
  '/credit-notes',
  '/falabella',
  '/ripley',
  '/workflow',
  '/auto-emit',
  '/webhooks',
];
const apiProxy = Object.fromEntries(
  apiPrefixes.map((prefix) => [
    prefix,
    {
      target: apiTarget,
      changeOrigin: true,
    },
  ]),
);

// Frontend web independiente. El proxy mantiene la API desacoplada en dev.
export default defineConfig({
  root: __dirname,
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 3011,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    allowedHosts: true,
    proxy: apiProxy,
  },
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true },
});
