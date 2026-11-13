import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // The deployed commit, so the bug button can tell when a newer version has fixes.
    'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VITE_BUILD_COMMIT ?? ''),
  },
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        ws: true,
      },
      '/api/turn': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/multiplayer': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  test: {
    // iCloud leaves copies named "file 2.ts" beside the real files.
    exclude: ['**/node_modules/**', '**/dist/**', '**/* 2.*'],
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/stats/dashboard.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
      },
    },
  },
});
