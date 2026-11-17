import { defineConfig } from '@rstest/core';


export default defineConfig({
  name: 'p2p-server',
  globals: true,
  include: ['src/**/*.spec.ts'],
  testEnvironment: 'node',
  setupFiles: ['./test/setup.ts'],
  resolve: {
    conditionNames: ['source', '...'],
  },
  source: {
    decorators: { version: 'legacy' },
  },
});
