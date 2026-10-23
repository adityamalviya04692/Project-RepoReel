/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 3000 },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
