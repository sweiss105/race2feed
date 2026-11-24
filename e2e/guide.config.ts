import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshots for the staff user guide (`npm run guide:shots`).
 * Kept apart from the e2e suite: its own port, its own throwaway store, and it writes into docs/guide/images.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'guide.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: '../test-results/guide',
  use: {
    baseURL: 'http://localhost:8788',
    trace: 'off',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'rm -rf .wrangler/guide && npm run build && npx wrangler dev -c packages/server/wrangler.jsonc --port 8788 --ip 127.0.0.1 --persist-to .wrangler/guide --var ADMIN_PASSWORD:e2e-admin --show-interactive-dev-session=false',
    cwd: '..',
    url: 'http://localhost:8788/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
