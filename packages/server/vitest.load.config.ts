import { defineConfig } from 'vitest/config';

/** The hub load profile (`npm run measure:hub`). Kept out of `npm test`: it measures, it doesn't assert. */
export default defineConfig({
  root: import.meta.dirname,
  test: { name: 'hub-load', include: ['test/load/**/*.measure.ts'], environment: 'node' },
});
