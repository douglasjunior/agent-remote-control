import { defineConfig } from '@rstest/core';

import unitConfig from './rstest.config.js';


export default defineConfig({
  ...unitConfig,
  name: 'server-e2e',
  pool: { maxWorkers: '50%' },
  include: ['test/**/*.e2e-spec.ts'],
  env: {
    DISCORD_BOT_TOKEN: '',
    REMOTE_ENABLED: 'false',
  },
});
