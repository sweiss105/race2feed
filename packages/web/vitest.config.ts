import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: { name: 'web', include: ['test/**/*.test.{ts,tsx}'], environment: 'happy-dom' },
});
