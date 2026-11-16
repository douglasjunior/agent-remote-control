import { defineConfig } from '@rstest/core';


export default defineConfig({
  name: 'server',
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
