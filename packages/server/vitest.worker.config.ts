import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { ADMIN_PASSWORD: 'test-admin' } },
    }),
  ],
  test: { name: 'server-worker', include: ['test/worker/**/*.test.ts'] },
});
