import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4520',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
