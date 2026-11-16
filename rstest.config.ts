import { defineConfig } from '@rstest/core';


export default defineConfig({
  projects: ['packages/*'],
  pool: { maxWorkers: '50%' },
  coverage: {
    provider: 'v8',
  },
});
