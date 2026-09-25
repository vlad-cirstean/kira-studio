import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type UserConfigExport } from 'vite';

interface DefineAppViteConfigOptions {
  /** This app's own directory name under `apps/` — also the segment wails3's `-b` bindings
   *  generator writes the Go module's `internal/` tree under (`@bindings`/`@bindings-internal`
   *  below). The module path itself stays "kira-studio" regardless (that's the Go module name,
   *  go.mod, not the app name) — only this segment varies per app. */
  app: string;
  /** Falls back to this when `WAILS_VITE_PORT` isn't set (`wails3 dev` exports it; the Taskfile
   *  also passes it on the CLI) — each app's own default, so both dev servers can run side by
   *  side. */
  port: number;
  /** The calling `vite.config.ts`'s own `import.meta.url` — every alias below resolves relative
   *  to it, exactly as the two apps' own inlined configs did before this factory existed. */
  configUrl: string;
}

// P113 F6: kira-studio's and kira-space's own vite.config.ts were byte-identical apart from the
// dev-server port and the bindings path's own app segment (plus comments) — this factory is that
// shared shape, called from each app's own (now few-line) vite.config.ts.
export function defineAppViteConfig({
  app,
  port,
  configUrl,
}: DefineAppViteConfigOptions): UserConfigExport {
  return defineConfig(({ command }) => {
    // `serve` is `wails3 dev`'s Vite dev server, whose DevTools console is the only place
    // docs/PERF.md's real-hardware scroll protocol can run. KIRA_DEBUG_HOOKS covers the two
    // *built* bundles that also need the window.__kira* hooks: build:dev (a DEV=true native
    // build) and build:test (what tests/ui and tests/ipc:fe build against) — everything else,
    // including the packaged production build, gets the hooks compiled out (P29 F1).
    const debugHooks = command === 'serve' || process.env.KIRA_DEBUG_HOOKS === '1';
    return {
      base: './',
      plugins: [vue(), tailwindcss()],
      // `wails3 dev` exports WAILS_VITE_PORT and then proxies the app's asset server at
      // FRONTEND_DEVSERVER_URL to it; the Taskfile passes the same port on the CLI. Both are set
      // so neither path silently picks a different one.
      server: {
        host: '127.0.0.1',
        port: Number(process.env.WAILS_VITE_PORT) || port,
        strictPort: true,
      },
      resolve: {
        alias: {
          // shadcn-vue's own generated-component alias (P98) — existing source keeps relative
          // imports, this is for what `bunx shadcn-vue add` writes.
          '@': fileURLToPath(new URL('./src', configUrl)),
          '@shared': fileURLToPath(new URL('../../../packages/shared', configUrl)),
          // P103 (byte-identical tier): the shared theme/shadcn-vue/primitive source, this app
          // importing rather than owning its own copy.
          '@theme': fileURLToPath(new URL('../../../packages/theme/src', configUrl)),
          // P103 Part 1: the byte-identical/code-identical workbench tier hoisted out of both
          // apps' own src/ into one real location — this app importing, not owning, its own
          // copy. Follows @theme's own alias shape exactly (not packages/git-ui's exports-map
          // precedent), since these files import @theme/*/@shared/* themselves, which only
          // resolve through this app's own alias table.
          '@workbench': fileURLToPath(new URL('../../../packages/workbench/src', configUrl)),
          '@bindings': fileURLToPath(
            new URL(
              `./bindings/github.com/kirathecat/kira-studio/apps/${app}/internal/bridge`,
              configUrl,
            ),
          ),
          '@bindings-internal': fileURLToPath(
            new URL(`./bindings/github.com/kirathecat/kira-studio/apps/${app}/internal`, configUrl),
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
          // Generated with `-b`, the bindings import "/wails/runtime.js" — a path Wails' own
          // asset server resolves inside the webview, not an npm package. Keep it literal.
          external: [/^\/wails\//],
        },
      },
    };
  });
}
