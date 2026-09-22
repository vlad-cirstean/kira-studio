import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Root is this file's own directory (the Wails `frontend/` slot), so `dist` lands where
// apps/kira-studio/main.go's `//go:embed all:frontend/dist` can reach it — Go's embed cannot
// escape its own package directory.
export default defineConfig(({ command }) => {
  // `serve` is `wails3 dev`'s Vite dev server, whose DevTools console is the only place
  // docs/PERF.md's real-hardware scroll protocol can run. KIRA_DEBUG_HOOKS covers the two *built*
  // bundles that also need the window.__kira* hooks: build:dev (a DEV=true native build) and
  // build:test (what tests/ui and tests/ipc:fe build against) — everything else, including the
  // packaged production build, gets the hooks compiled out (P29 F1).
  const debugHooks = command === 'serve' || process.env.KIRA_DEBUG_HOOKS === '1';
  return {
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
        // shadcn-vue's own generated-component alias (P98) — existing source keeps relative
        // imports, this is for what `bunx shadcn-vue add` writes.
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('../../../packages/shared', import.meta.url)),
        // P103 (byte-identical tier, folded into this pass): see apps/kira-space/frontend/
        // vite.config.ts's own note — the same shared theme/shadcn-vue/primitive source, this app
        // importing rather than owning its own copy.
        '@theme': fileURLToPath(new URL('../../../packages/theme/src', import.meta.url)),
        // P103 Part 1: the byte-identical/code-identical workbench tier hoisted out of both apps'
        // own src/ into one real location — this app importing, not owning, its own copy. Follows
        // @theme's own alias shape exactly (not packages/git-ui's exports-map precedent), since
        // these files import @theme/*/@shared/* themselves, which only resolve through this app's
        // own alias table.
        '@workbench': fileURLToPath(new URL('../../../packages/workbench/src', import.meta.url)),
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
    define: {
      __KIRA_DEBUG_HOOKS__: JSON.stringify(debugHooks),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rolldownOptions: {
        // Generated with `-b`, the bindings import "/wails/runtime.js" — a path Wails' own asset
        // server resolves inside the webview, not an npm package. Keep it literal.
        external: [/^\/wails\//],
      },
    },
  };
});
