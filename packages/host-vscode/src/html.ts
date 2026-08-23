/**
 * CSP, nonce, asset URIs, initial-state injection (P3 W10) — the document `panelView.ts` hands
 * to the webview. Reads a Vite build manifest to find `src/webview/main.ts`'s built output
 * rather than hard-coding a hashed filename; `WEBVIEW_ENTRY` below is the manifest key W13's
 * `scripts/build.ts` must produce for this to resolve.
 */
import { readFileSync } from "node:fs";
import { CONTRACT_VERSION } from "@kira-version/ipc";
import * as vscode from "vscode";

/** Vite's own convention: an entry's manifest key is its input path relative to the build
 *  root — coordinated with W13 rather than guessed at from a built artifact. */
const WEBVIEW_ENTRY = "src/webview/main.ts";

interface ViteManifestEntry {
  readonly file: string;
  readonly css?: readonly string[];
}

type ViteManifest = Readonly<Record<string, ViteManifestEntry>>;

interface UiAssets {
  readonly scriptUri: vscode.Uri;
  readonly styleUris: readonly vscode.Uri[];
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
    styleUris: (entry.css ?? []).map((css) =>
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
  const distUi = vscode.Uri.joinPath(extensionUri, "dist", "ui");
  const assets = resolveUiAssets(webview, distUi);
  const csNonce = nonce();
  const bootstrap = { host: "vscode" as const, contractVersion: CONTRACT_VERSION };

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
