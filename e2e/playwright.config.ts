import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: '../test-results/e2e',
  use: { baseURL: 'http://localhost:8787', trace: 'off', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'rm -rf .wrangler/e2e && npm run build && npx wrangler dev -c packages/server/wrangler.jsonc --port 8787 --ip 127.0.0.1 --local-upstream localhost:8787 --persist-to .wrangler/e2e --var DEV_CONSOLE_USER:e2e@example.com --show-interactive-dev-session=false',
    cwd: '..',
    url: 'http://localhost:8787/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
