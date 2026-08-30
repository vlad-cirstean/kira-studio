import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';

const SHIM_PATH = resolve(__dirname, 'shell/frontend/shim/kira-bridge.ts');

// Builds the real src/renderer (untouched — P52 touches no src/ file) to shell/frontend/dist,
// which shell/main.go embeds via `//go:embed all:frontend/dist`. Same root, base, plugins and
// @shared alias as electron.vite.config.ts's own `renderer` block, so the two builds stay
// provably the same app (P52 §2.3).
//
// injectKiraShim is the one addition this config makes that electron.vite.config.ts does not: it
// prepends a <script type="module"> tag loading shell/frontend/shim/kira-bridge.ts — a
// hand-written window.kira implementation backed by the real generated Wails bindings (P52 M1).
// This is a build-time transform only — src/renderer/index.html itself is never modified — so the
// Electron build is completely unaffected. It plays the same role `src/preload`'s contextBridge
// exposure plays for the Electron build, just wired at the frontend-bundling layer instead of
// Electron's own preload mechanism, since Wails has no preload-script concept. Module scripts
// execute in document order, so this runs — and finishes assigning window.kira — before
// src/renderer/main.ts's own module graph evaluates.
//
// The shim is registered as its own rollupOptions.input entry (below) rather than referenced by a
// bare specifier, because Vite/Rollup only resolves and hashes files that are real build inputs;
// this hook then points the injected <script src> at that entry's actual emitted chunk name.
function injectKiraShim(): Plugin {
  return {
    name: 'kira-inject-shim',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        let src: string;
        if (bundle) {
          const shimChunk = Object.values(bundle).find(
            (c) => c.type === 'chunk' && c.facadeModuleId === SHIM_PATH,
          );
          if (!shimChunk) {
            throw new Error('kira-inject-shim: shim chunk not found in the production bundle');
          }
          src = `./${shimChunk.fileName}`;
        } else {
          // Dev server (`wails3 task dev` / `vite`): serve the source file directly via Vite's
          // filesystem-escape-hatch path, since it lives outside this config's `root`.
          src = `/@fs${SHIM_PATH}`;
        }
        return {
          html,
          tags: [{ tag: 'script', attrs: { type: 'module', src }, injectTo: 'head-prepend' }],
        };
      },
    },
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [vue(), tailwindcss(), injectKiraShim()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      // Generated bindings (P57 D8) — kept short because the real path is repeated once per
      // service import in control.ts and would otherwise break if either tree moves. @bindings
      // is the bridge services themselves; @bindings-internal is one level up, for the sibling
      // packages (connections/, tree/, storage/model/) whose model types those services return.
      '@bindings': resolve(
        __dirname,
        'shell/frontend/bindings/github.com/kirathecat/kira-studio/shell/internal/bridge',
      ),
      '@bindings-internal': resolve(
        __dirname,
        'shell/frontend/bindings/github.com/kirathecat/kira-studio/shell/internal',
      ),
    },
  },
  build: {
    outDir: resolve(__dirname, 'shell/frontend/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        shim: SHIM_PATH,
      },
      // Generated bindings (`wails3 generate bindings -b`) import "/wails/runtime.js" — a path
      // Wails' own asset server resolves inside a real webview, not an npm package. Marking it
      // external keeps that import literal in the built output instead of failing to resolve it.
      external: [/^\/wails\//],
    },
  },
});
