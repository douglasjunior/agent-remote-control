import { defineConfig } from '@rstest/core';


export default defineConfig({
  name: 'server',
  globals: true,
  include: ['src/**/*.spec.ts'],
  testEnvironment: 'node',
  // `@peculiar/x509` (through tsyringe) needs the Reflect polyfill as soon as it is imported, which can precede Nest's.
  setupFiles: ['reflect-metadata'],
  resolve: {
    conditionNames: ['source', '...'],
  },
  source: {
    decorators: { version: 'legacy' },
  },
});
