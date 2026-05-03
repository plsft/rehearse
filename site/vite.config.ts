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
        docs: resolve(__dirname, 'docs.html'),
        about: resolve(__dirname, 'about.html'),
        packages: resolve(__dirname, 'packages.html'),
        pro: resolve(__dirname, 'pro.html'),
        pricing: resolve(__dirname, 'pricing.html'),
        catalog: resolve(__dirname, 'catalog.html'),
        security: resolve(__dirname, 'security.html'),
        checkout: resolve(__dirname, 'checkout.html'),
        checkoutSuccess: resolve(__dirname, 'checkout/success.html'),
        docsPro: resolve(__dirname, 'docs/pro.html'),
      },
    },
  },
  server: { port: 4321 },
});
