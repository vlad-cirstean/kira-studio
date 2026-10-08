import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// The phone app: a second build of this frontend, served by the Go mobileweb server. No `@bindings`
// alias and no Wails runtime, so an accidental import of the desktop `control` bridge fails the
// build instead of shipping a broken bundle.
export default defineConfig({
  root: at('./mobile'),
  base: '/',
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Kira Space Agents',
        short_name: 'Agents',
        description: 'Your Kira Space agents, backlog and plan on your phone.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#181818',
        background_color: '#1f1f1f',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // The shell is cached so the app opens offline; data never is. The setup page runs on the
      // plain-HTTP port, where no service worker can register, so it stays out of the precache.
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,ico,ttf}'],
        globIgnores: ['setup.html', 'assets/setup-*'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }],
      },
    }),
  ],
  server: { host: '127.0.0.1', port: 9247, strictPort: true },
  resolve: {
    alias: {
      '@': at('./src'),
      '@ade': at('./src/ade/v2'),
      '@shared': at('../../../packages/shared'),
      '@theme': at('../../../packages/theme/src'),
      '@workbench': at('../../../packages/workbench/src'),
    },
  },
  define: { __KIRA_DEBUG_HOOKS__: 'false' },
  build: {
    outDir: at('./dist-mobile'),
    emptyOutDir: true,
    rolldownOptions: {
      input: { index: at('./mobile/index.html'), setup: at('./mobile/setup.html') },
    },
  },
});
