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
        security: resolve(__dirname, 'security.html'),
        vs: resolve(__dirname, 'vs.html'),
        bench: resolve(__dirname, 'bench.html'),
        customers: resolve(__dirname, 'customers.html'),
        changelog: resolve(__dirname, 'changelog.html'),
        localGithubActions: resolve(__dirname, 'local-github-actions.html'),
        typescriptGithubActions: resolve(__dirname, 'typescript-github-actions.html'),
        checkout: resolve(__dirname, 'checkout.html'),
        checkoutSuccess: resolve(__dirname, 'checkout/success.html'),
        docsPro: resolve(__dirname, 'docs/pro.html'),
        blog: resolve(__dirname, 'blog/index.html'),
        blogActAlternative: resolve(__dirname, 'blog/act-alternative.html'),
        blogPrePush: resolve(__dirname, 'blog/github-actions-before-push.html'),
        blogTsYaml: resolve(__dirname, 'blog/typescript-github-actions-yaml.html'),
      },
    },
  },
  server: { port: 4321 },
});
