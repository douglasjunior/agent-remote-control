import { defineConfig } from '@rstest/core';


export default defineConfig({
  name: 'protocol',
  globals: true,
  include: ['src/**/*.spec.ts'],
  testEnvironment: 'node',
});
