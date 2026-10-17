// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// The API runs separately (FastAPI in ../server). In dev, Vite proxies /api and
// /ws to it so the browser only ever talks to one origin — the same shape as
// production, where FastAPI serves this build behind the Cloudflare tunnel.
const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:8000';

export default defineConfig({
  site: 'https://cysense.elio.ltd',
  output: 'static',
  integrations: [react()],
  build: { format: 'directory' },
  vite: {
    plugins: [tailwindcss()],
    server: {
      // Lets a phone on a quick tunnel (cloudflared tunnel --url) reach the dev server.
      allowedHosts: true,
      proxy: {
        '/api': { target: API_TARGET, changeOrigin: true },
        '/ws': { target: API_TARGET.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
      },
    },
  },
});
