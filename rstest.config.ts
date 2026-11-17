import { defineConfig } from '@rstest/core';


export default defineConfig({
  projects: ['packages/*'],
  pool: { maxWorkers: process.env.CI === 'true' ? '100%' : '50%' },
  coverage: {
    provider: 'v8',
  },
});
