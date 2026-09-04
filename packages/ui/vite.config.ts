/**
 * The UI bundle (P3 W13, §3.1's own tree entry for this file) — one Vite build producing the
 * VS Code webview entry (`host-vscode/src/webview/main.ts`), so the same `packages/ui`
 * component tree, theme CSS, and codicon font asset ship to the host unchanged (§8.4). P4b
 * removed the Electron renderer entry that used to share this build — see
 * `docs/plans/P4b-remove-electron.md`.
 *
 * `root` stays `packages/` rather than moving down to `packages/host-vscode` (which would
 * shorten the webview's manifest key to `src/webview/main.ts`): it is a correct root for a
 * build whose source spans `packages/ui` and `packages/host-vscode`, and moving it would change
 * every manifest key and force a matching edit in `html.ts`'s `WEBVIEW_ENTRY` and in the visual
 * baselines' asset paths — churn bought for nothing now that there is only one entry.
 *
 * `base: "./"` is inert for the webview path — `html.ts` doesn't use the built HTML at all (VS
 * Code needs a fresh nonce/CSP per load, so it renders its own document and only reads the
 * manifest for hashed filenames) — and harmless, so it is left as-is rather than removed for no
 * behavioural gain.
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
      },
    },
  },
});
