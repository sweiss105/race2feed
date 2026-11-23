import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/engine', 'packages/server/vitest.core.config.ts', 'packages/server/vitest.worker.config.ts', 'packages/web/vitest.config.ts'],
  },
});
