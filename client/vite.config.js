import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Vite config for the PocketPy client.
//
// Two things worth understanding here:
//  1. Dev proxy — in development the React app runs on Vite's dev server (5173)
//     while the API runs on the Node backend (3000). The proxy forwards /api and
//     /healthz to the backend so the browser sees a single origin (and cookies
//     just work). In production there is only one origin: the Node server serves
//     the built files AND the API.
//  2. PWA — we precache the app shell but deliberately DO NOT precache the big
//     Pyodide files; those are runtime-cached (CacheFirst) so the ~10 MB WASM is
//     fetched once and then served from cache offline.

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The Pyodide runtime lives in public/pyodide and is large + versioned; keep
      // it out of the precache manifest and let runtimeCaching handle it.
      workbox: {
        globIgnores: ['**/pyodide/**'],
        // App-shell files are small; allow up to 3 MB just in case a chunk grows.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/healthz/],
        runtimeCaching: [
          {
            // Self-hosted Pyodide runtime: fetch once, then serve from cache.
            urlPattern: ({ url }) => url.pathname.startsWith('/pyodide/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pyodide-runtime',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'PocketPy — Python practice',
        short_name: 'PocketPy',
        description: 'Mobile-first Python practice with auto-graded challenges.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        // A single SVG scales to any size. It's authored with a safe centre zone so
        // it doubles as the maskable icon. Swap in real PNGs later if you want.
        icons: [
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
  },
  build: {
    // Emit into client/dist, which the Node server serves in production.
    outDir: 'dist',
    // Pyodide's asm.wasm is large; don't warn about it.
    chunkSizeWarningLimit: 2000,
  },
});
