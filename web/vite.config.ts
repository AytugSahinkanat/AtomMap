import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    // Repo root (parent of web/), so fixtures/ can be imported with ?url.
    fs: { allow: ['..'] },
  },
});
