import react from '@vitejs/plugin-react';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';


export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['source', ...defaultClientConditions],
  },
  test: {
    name: 'web',
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      exclude: ['src/components/ui/**', 'src/main.tsx', 'src/test/**', 'src/**/*.spec.{ts,tsx}'],
    },
  },
});
