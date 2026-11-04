import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';


export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['packages/server/test/**/*.e2e-spec.ts'],
    env: {
      DISCORD_BOT_TOKEN: '',
    },
  },
});
