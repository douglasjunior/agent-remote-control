import { defineConfig } from '@rstest/core';


export default defineConfig({
  projects: ['packages/*'],
  coverage: {
    provider: 'v8',
  },
});
