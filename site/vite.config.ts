import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        pricing: resolve(__dirname, 'pricing.html'),
        docs: resolve(__dirname, 'docs.html'),
        cloud: resolve(__dirname, 'cloud.html'),
      },
    },
  },
  server: { port: 4321 },
});
