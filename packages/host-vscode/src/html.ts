/**
 * CSP, nonce, asset URIs, initial-state injection (P3 W10) — the document `panelView.ts` hands
 * to the webview. Reads a Vite build manifest to find `webview/main.ts`'s built output rather
 * than hard-coding a hashed filename; `WEBVIEW_ENTRY` below is the manifest key W13's
 * `packages/ui/vite.config.ts` actually produces for this to resolve.
 *
 * `dist/ui` sits two levels up from `extensionUri` (this package's own folder), not inside it:
 * `package.json`'s `main: "../../dist/vscode/extension.js"` already commits this package to a
 * shared, repo-root `dist/` (W13's one build output for all three targets), and `dist/ui` is
 * one of that same root's siblings — `packages/host-electron/src/main/index.ts`'s
 * `RENDERER_HTML_PATH` reaches the same directory the same way, up from `dist/electron/`.
 */
import { readFileSync } from "node:fs";
import { CONTRACT_VERSION } from "@kira-version/ipc";
import * as vscode from "vscode";

/** Vite's own convention: an entry's manifest key is its input path relative to the build
 *  root. W13's `packages/ui/vite.config.ts` root is `packages/` — the closest common ancestor
 *  of this entry and `host-electron/src/renderer/index.html`, the other file that same Vite
 *  build produces (a single Vite invocation cannot emit an HTML entry that lives outside its
 *  configured root) — so the key is this file's `packages/`-relative path, not the shorter
 *  `src/webview/main.ts` a `host-vscode`-rooted build would have produced. */
const WEBVIEW_ENTRY = "host-vscode/src/webview/main.ts";

interface ViteManifestEntry {
  readonly file: string;
  readonly css?: readonly string[];
  readonly imports?: readonly string[];
}

type ViteManifest = Readonly<Record<string, ViteManifestEntry>>;

interface UiAssets {
  readonly scriptUri: vscode.Uri;
  readonly styleUris: readonly vscode.Uri[];
}

/** The webview and renderer entries share almost all of `packages/ui`'s own code, so Vite
 *  splits it into a common chunk both entries `imports` rather than duplicating it — which
 *  means the CSS that chunk pulls in (`vscode-tokens.css`, `density.css`, `codicon.css`) shows
 *  up in *that chunk's* `css` array, not the entry's own. Vite's documented manifest-consumer
 *  pattern is exactly this: walk `imports` transitively and collect every `css` array found
 *  along the way. `seen` guards the (currently impossible, but not contractually forbidden)
 *  case of a chunk graph that revisits the same chunk from two import paths. */
function collectCss(manifest: ViteManifest, key: string, seen: Set<string>): string[] {
  if (seen.has(key)) return [];
  seen.add(key);
  const entry = manifest[key];
  if (!entry) return [];
  const fromImports = (entry.imports ?? []).flatMap((imp) => collectCss(manifest, imp, seen));
  return [...fromImports, ...(entry.css ?? [])];
}

function resolveUiAssets(webview: vscode.Webview, distUi: vscode.Uri): UiAssets {
  const manifestPath = vscode.Uri.joinPath(distUi, ".vite", "manifest.json").fsPath;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ViteManifest;
  const entry = manifest[WEBVIEW_ENTRY];
  if (!entry) {
    throw new Error(`html.ts: no "${WEBVIEW_ENTRY}" entry in ${manifestPath}`);
  }
  return {
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(distUi, entry.file)),
    styleUris: collectCss(manifest, WEBVIEW_ENTRY, new Set()).map((css) =>
      webview.asWebviewUri(vscode.Uri.joinPath(distUi, css)),
    ),
  };
}

function nonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export interface RenderHtmlOptions {
  readonly webview: vscode.Webview;
  readonly extensionUri: vscode.Uri;
}

export function renderHtml(opts: RenderHtmlOptions): string {
  const { webview, extensionUri } = opts;
  const distUi = vscode.Uri.joinPath(extensionUri, "..", "..", "dist", "ui");
  const assets = resolveUiAssets(webview, distUi);
  const csNonce = nonce();
  // `KIRA_REPO` (`packages/host-electron/src/main/index.ts`'s own doc comment): the same
  // dev/e2e-only convenience, extended here since P3 has no repo-picker UI on this host either.
  // Electron carries it through `loadFile`'s `query` option because its HTML is a static file
  // (W13); this host already rebuilds its document — and this bootstrap island — on every
  // resolve, so the env var travels through the island instead.
  const bootstrap = {
    host: "vscode" as const,
    contractVersion: CONTRACT_VERSION,
    repo: process.env["KIRA_REPO"] ?? null,
  };

  const styleLinks = assets.styleUris
    .map((uri) => `<link rel="stylesheet" href="${uri.toString()}">`)
    .join("\n    ");

  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${csNonce}'`,
  ].join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kira Version</title>
    ${styleLinks}
  </head>
  <body>
    <div id="app"></div>
    <script type="application/json" id="kira-bootstrap">${JSON.stringify(bootstrap)}</script>
    <script type="module" nonce="${csNonce}" src="${assets.scriptUri.toString()}"></script>
  </body>
</html>`;
}
