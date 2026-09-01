import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Root is this file's own directory (the Wails `frontend/` slot), so `dist` lands where
// apps/kira-studio/main.go's `//go:embed all:frontend/dist` can reach it — Go's embed cannot
// escape its own package directory.
export default defineConfig({
  base: './',
  plugins: [vue(), tailwindcss()],
  // `wails3 dev` exports WAILS_VITE_PORT and then proxies the app's asset server at
  // FRONTEND_DEVSERVER_URL to it; the Taskfile passes the same port on the CLI. Both are set so
  // neither path silently picks a different one.
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../../../src/shared', import.meta.url)),
      '@bindings': fileURLToPath(
        new URL(
          './bindings/github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge',
          import.meta.url,
        ),
      ),
      '@bindings-internal': fileURLToPath(
        new URL(
          './bindings/github.com/kirathecat/kira-studio/apps/kira-studio/internal',
          import.meta.url,
        ),
      ),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Generated with `-b`, the bindings import "/wails/runtime.js" — a path Wails' own asset
      // server resolves inside the webview, not an npm package. Keep it literal.
      external: [/^\/wails\//],
    },
  },
});
