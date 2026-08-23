/**
 * The UI bundle (P3 W13, §3.1's own tree entry for this file) — one Vite build producing both
 * the VS Code webview entry (`host-vscode/src/webview/main.ts`) and the Electron renderer's
 * HTML entry (`host-electron/src/renderer/index.html`), so the same `packages/ui` component
 * tree, theme CSS, and codicon font asset ship to both hosts unchanged (§8.4).
 *
 * `root` is `packages/` — the closest common ancestor of both entries. It has to be a real
 * ancestor of both: Vite refuses to emit an HTML entry whose computed output path would fall
 * outside `root` (there is no way to place `packages/host-electron/...` under a `root` of
 * `packages/host-vscode`), so `root: packages/host-vscode` (which would have made the webview's
 * manifest key the shorter `src/webview/main.ts`) is not an option once the renderer's HTML
 * entry is in the same build. `html.ts`'s `WEBVIEW_ENTRY` and `main/index.ts`'s
 * `RENDERER_HTML_PATH` are written to match exactly what this root produces — both entries'
 * manifest keys / output paths are their `packages/`-relative path (e.g.
 * `host-vscode/src/webview/main.ts`, `dist/ui/host-electron/src/renderer/index.html`) — so
 * changing `root` here means updating those two coordination points too.
 *
 * `base: "./"` (§ W13's table) makes every emitted `<script>`/`<link>` URL relative to the
 * HTML file's own location rather than absolute from a web root — required for
 * `BrowserWindow.loadFile()`'s `file://` loading (an absolute `/assets/...` URL would resolve
 * to the OS filesystem root, not `dist/ui/assets/`); `html.ts` doesn't use the built HTML at
 * all (VS Code needs a fresh nonce/CSP per load, so it renders its own document and only reads
 * the manifest for hashed filenames), so `base` only matters for the Electron entry, but it is
 * harmless for the webview one either way.
 */
import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "..");

export default defineConfig({
  root,
  base: "./",
  plugins: [vue()],
  build: {
    outDir: resolve(root, "..", "dist", "ui"),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        webview: resolve(root, "host-vscode", "src", "webview", "main.ts"),
        renderer: resolve(root, "host-electron", "src", "renderer", "index.html"),
      },
    },
  },
});
