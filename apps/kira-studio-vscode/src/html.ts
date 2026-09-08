/**
 * CSP, nonce, asset URIs, initial-state injection (P3 W10) — the document `panelView.ts` hands
 * to the webview. Reads a Vite build manifest to find `webview/main.ts`'s built output rather
 * than hard-coding a hashed filename; `WEBVIEW_ENTRY` below is the manifest key
 * `packages/git-ui/vite.config.ts` actually produces for this to resolve.
 *
 * `dist/ui` sits inside `extensionUri` (this package's own folder), unlike upstream's shared
 * repo-root `dist/`: this repo's `package.json#main` is `./dist/extension.js` (G1 §5.4), and
 * `packages/git-ui/vite.config.ts` writes its own output to this same package's `dist/ui`.
 */
import { readFileSync } from 'node:fs';
import { CONTRACT_VERSION, type UiActionKind } from '@kira/git-ipc';
import * as vscode from 'vscode';
import {
  buildWebviewDocument,
  collectCss,
  type ViteManifest,
  WEBVIEW_ENTRY,
} from './webviewDocument.ts';

interface UiAssets {
  readonly scriptUri: vscode.Uri;
  readonly styleUris: readonly vscode.Uri[];
}

function resolveUiAssets(webview: vscode.Webview, distUi: vscode.Uri): UiAssets {
  const manifestPath = vscode.Uri.joinPath(distUi, '.vite', 'manifest.json').fsPath;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ViteManifest;
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
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** The target the review view should open on a cold resolve — see `reviewView.ts`'s own doc
 *  comment for the three-entry-point flow this is one arm of (§6.8, D40). `null` when the
 *  palette command (or a first-ever resolve with nothing pending) revealed the view: it renders
 *  its own "pick a branch" ask-state rather than being handed one. */
export interface ReviewTarget {
  readonly repoId: string;
  readonly branch: string;
}

export interface RenderHtmlOptions {
  readonly webview: vscode.Webview;
  readonly extensionUri: vscode.Uri;
  readonly view: 'graph' | 'review';
  /** Only meaningful when `view === "review"`; ignored (and should be omitted) for the graph. */
  readonly target?: ReviewTarget | null;
  /** G10 D19: only meaningful when `view === "graph"`; ignored (and should be omitted) for the
   *  review sidebar — see `panelView.ts`'s own `runUiAction` doc comment for the flow this seeds.
   *  G14 D10: grew an optional `target`, mirroring `ui.action`'s own shape. */
  readonly pendingUiAction?: {
    action: UiActionKind;
    target?: { repoId: string; sha: string };
  } | null;
}

export function renderHtml(opts: RenderHtmlOptions): string {
  const { webview, extensionUri, view, target, pendingUiAction } = opts;
  const distUi = vscode.Uri.joinPath(extensionUri, 'dist', 'ui');
  const assets = resolveUiAssets(webview, distUi);
  const csNonce = nonce();
  // `KIRA_REPO`: a dev/e2e-only convenience, since P3 has no repo-picker UI on this host. This
  // host rebuilds its document — and this bootstrap island — on every resolve, so the env var
  // travels through the island rather than a query string.
  const bootstrap = {
    host: 'vscode' as const,
    contractVersion: CONTRACT_VERSION,
    repo: process.env.KIRA_REPO ?? null,
    view,
    target: view === 'review' ? (target ?? null) : null,
    pendingUiAction: view === 'graph' ? (pendingUiAction ?? null) : null,
  };

  return buildWebviewDocument({
    scriptUrl: assets.scriptUri.toString(),
    styleUrls: assets.styleUris.map((uri) => uri.toString()),
    cspSource: webview.cspSource,
    view,
    bootstrap,
    nonce: csNonce,
  });
}
