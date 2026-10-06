/**
 * The UI bundle (G1 §5.2, ported from upstream's `packages/ui/vite.config.ts`) — one Vite build
 * producing the VS Code webview entry (`apps/kira-space-vscode/src/webview/main.ts`), so the
 * same `packages/git-ui` component tree, theme CSS, and codicon font asset ship to the extension
 * unchanged.
 *
 * `root` is the repo root, not `packages/git-ui` itself: this build's source spans
 * `packages/git-ui` and `apps/kira-space-vscode` — two different top-level directories in this
 * repo's own `apps/`/`packages/` split (unlike upstream, where both lived under one shared
 * `packages/`) — and a root that can see both is what lets `rollupOptions.input` reach across.
 *
 * `base: "./"` is inert for the webview path — `html.ts` doesn't use the built HTML at all (VS
 * Code needs a fresh nonce/CSP per load, so it renders its own document and only reads the
 * manifest for hashed filenames) — and harmless, so it is left as-is rather than removed for no
 * behavioural gain.
 */
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const vscodeApp = resolve(repoRoot, 'apps', 'kira-space-vscode');

export default defineConfig({
  root: repoRoot,
  base: './',
  // P110 A1: compiles GU/theme/tailwind.css's `kv:`-prefixed root, scanning packages/git-ui only
  // (that file's own @source line).
  // P131 Part 1 §3.3: also compiles the webview's own second, unprefixed root
  // (apps/kira-space-vscode/src/webview/tailwind.css), which imports packages/theme/src/
  // tailwind-core.css and packages/theme/src/components/** by their `@theme/*` alias -- resolved
  // here the same way both apps' own vite.config.ts factory (packages/workbench/src/
  // viteAppConfig.ts) already resolves it for every other Tailwind root in this repo.
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@theme': resolve(repoRoot, 'packages', 'theme', 'src'),
    },
  },
  build: {
    outDir: resolve(vscodeApp, 'dist', 'ui'),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        webview: resolve(vscodeApp, 'src', 'webview', 'main.ts'),
      },
    },
  },
});
