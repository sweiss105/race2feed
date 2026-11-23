import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'server-core', include: ['test/core/**/*.test.ts'], environment: 'node' },
});
