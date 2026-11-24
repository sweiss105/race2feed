import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { DEV_CONSOLE_USER: 'tester@example.com', EMERGENCY_PASSWORD: 'test-emergency' } },
    }),
  ],
  test: { name: 'server-worker', include: ['test/worker/**/*.test.ts'] },
});
