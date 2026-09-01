import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Builds the real src/renderer to apps/kira-studio/frontend/dist, which main.go embeds via
// `//go:embed all:frontend/dist`. src/renderer/bridge/{control,port}.ts now talk to the generated
// Wails bindings and the `engine` Stream directly (P57) — no injected shim, and no build-time HTML
// transform, stand between them and the real webview.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      // Generated bindings (P57 D8) — kept short because the real path is repeated once per
      // service import in control.ts and would otherwise break if either tree moves. @bindings
      // is the bridge services themselves; @bindings-internal is one level up, for the sibling
      // packages (connections/, tree/, storage/model/) whose model types those services return.
      '@bindings': resolve(
        __dirname,
        'apps/kira-studio/frontend/bindings/github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge',
      ),
      '@bindings-internal': resolve(
        __dirname,
        'apps/kira-studio/frontend/bindings/github.com/kirathecat/kira-studio/apps/kira-studio/internal',
      ),
    },
  },
  build: {
    outDir: resolve(__dirname, 'apps/kira-studio/frontend/dist'),
    emptyOutDir: true,
    rollupOptions: {
      // Generated bindings (`wails3 generate bindings -b`) import "/wails/runtime.js" — a path
      // Wails' own asset server resolves inside a real webview, not an npm package. Marking it
      // external keeps that import literal in the built output instead of failing to resolve it.
      external: [/^\/wails\//],
    },
  },
});
