import { defineConfig } from 'vitest/config';


export default defineConfig({
  resolve: {
    conditions: ['source'],
  },
  ssr: {
    resolve: {
      conditions: ['source'],
    },
  },
  test: {
    name: 'p2p-server',
    globals: true,
    include: ['src/**/*.spec.ts'],
  },
});
