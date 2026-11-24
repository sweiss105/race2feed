import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

const here = import.meta.dirname;

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
        projector: resolve(here, 'projector/index.html'),
        ref: resolve(here, 'ref/index.html'),
        control: resolve(here, 'control/index.html'),
        emergency: resolve(here, 'emergency/index.html'),
        notFound: resolve(here, '404.html'),
      },
    },
  },
});
