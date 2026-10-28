import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 43123,
    strictPort: true,
    host: '127.0.0.1',
    allowedHosts: ['.app.github.dev'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:43180',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 43124,
    strictPort: true,
  },
  test: {
    // The existing UI suite exercises prototype flows; local API settings must not redirect it to a live database.
    env: { VITE_USE_API: 'false' },
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
