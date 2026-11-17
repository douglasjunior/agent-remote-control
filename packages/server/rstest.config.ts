import { defineConfig } from '@rstest/core';


export default defineConfig({
  name: 'server',
  pool: { maxWorkers: process.env.CI === 'true' ? '100%' : '50%' },
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
