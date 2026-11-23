import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        projector: resolve(__dirname, 'projector/index.html'),
        ref: resolve(__dirname, 'ref/index.html'),
        control: resolve(__dirname, 'control/index.html'),
        notFound: resolve(__dirname, '404.html'),
      },
    },
  },
});
