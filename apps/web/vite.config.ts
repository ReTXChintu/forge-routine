import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // The repo keeps one .env at the root; Vite would otherwise look only here.
  const env = loadEnv(mode, resolve(__dirname, '../..'), 'VITE_');

  return {
    plugins: [react()],
    resolve: {
      alias: { '~': resolve(__dirname, 'src') },
    },
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(
        env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1',
      ),
      'import.meta.env.VITE_APP_NAME': JSON.stringify(env.VITE_APP_NAME ?? 'ForgeRoutine'),
    },
    server: { port: 5173, strictPort: true },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          // Monaco is large and changes rarely; a separate chunk keeps it cached
          // across deploys instead of being re-downloaded with every app change.
          manualChunks: {
            monaco: ['@monaco-editor/react'],
            vendor: ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
    },
  };
});
