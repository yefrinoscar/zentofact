import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Build web del renderer (independiente de Electron), para servir estático.
export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: '/',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src/renderer/src') } },
  build: { outDir: path.resolve(__dirname, 'web-dist'), emptyOutDir: true },
});
