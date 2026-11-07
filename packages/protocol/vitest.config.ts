import { defineConfig } from 'vitest/config';


export default defineConfig({
  test: {
    name: 'protocol',
    globals: true,
    include: ['src/**/*.spec.ts'],
  },
});
