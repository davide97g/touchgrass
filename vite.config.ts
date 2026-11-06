import { defineConfig } from 'vite';

// Relative base so the static build works on any host or sub-path (GitHub Pages, Netlify, Vercel).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
