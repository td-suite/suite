import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import moduleCss from './vite.plugin.modcss.js';
export default defineConfig({
  plugins: [moduleCss(), react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
});
