import { withRsbuildConfig } from '@rstest/adapter-rsbuild';
import { defineConfig } from '@rstest/core';


export default defineConfig({
  extends: withRsbuildConfig({ cwd: import.meta.dirname }),
  name: 'web',
  globals: true,
  include: ['src/**/*.spec.{ts,tsx}'],
  testEnvironment: 'jsdom',
  setupFiles: ['./src/test/setup.ts'],
  coverage: {
    exclude: ['src/components/ui/**', 'src/main.tsx', 'src/test/**', 'src/**/*.spec.{ts,tsx}'],
  },
});
