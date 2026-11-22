/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

/** Short commit id + build date, shown in Settings so you can tell which version is running. */
function buildLabel(): string {
  let sha = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = 'dev';
    }
  }
  return `${sha.slice(0, 7)} · ${new Date().toISOString().slice(0, 10)}`;
}

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(buildLabel()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in src/lib/pwa.ts
      // Only the built app shell is cached. API traffic (Supabase) is never
      // cached by the service worker: personal data lives in IndexedDB only.
      workbox: {
        // App files (JS/CSS/fonts/icons) are precached for offline use. The page
        // itself is NOT served cache-first: when online, every launch loads the
        // latest index.html from the network (so a bad cached copy can't get the
        // installed app stuck); the cached copy is only used offline or if the
        // network takes more than 4 s.
        globPatterns: ['**/*.{js,css,svg,png,webmanifest,woff2}'],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'pilot-pages', networkTimeoutSeconds: 4, expiration: { maxEntries: 5 } },
          },
        ],
      },
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        name: 'Pilot',
        short_name: 'Pilot',
        description: 'A private instrument for noticing your own patterns.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fbf3e8',
        theme_color: '#fbf3e8',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
  },
});
