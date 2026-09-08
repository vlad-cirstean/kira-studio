/**
 * G16 D10: the `vscode`-free half of the webview document assembly, split out of `html.ts` so
 * `apps/kira-studio-vscode/tests/layout/webview-layout.spec.ts` can build and serve the *genuine*
 * document — the exact template, CSP assembly and manifest walk `renderHtml` emits — without a
 * `vscode` module stub. G14 shipped a webview panel that instantiated but was visually collapsed
 * to ~75px while its own DOM/accessibility-tree check passed; a geometry guard built against a
 * hand-rolled approximation of this document would be exactly the kind of proxy-for-the-real-
 * thing that let that regression through. `html.ts` keeps `renderHtml`, `resolveUiAssets` and
 * `nonce` — the pieces that genuinely need `vscode.Webview`/`vscode.Uri` — and imports everything
 * here.
 */

/** Vite's own convention: an entry's manifest key is its input path relative to the build
 *  root. `packages/git-ui/vite.config.ts`'s root is the repo root (a build whose source spans
 *  `packages/git-ui` and `apps/kira-studio-vscode` — see that file's own comment), so the key is
 *  this file's repo-root-relative path. */
export const WEBVIEW_ENTRY = 'apps/kira-studio-vscode/src/webview/main.ts';

export interface ViteManifestEntry {
  readonly file: string;
  readonly css?: readonly string[];
  readonly imports?: readonly string[];
}

export type ViteManifest = Readonly<Record<string, ViteManifestEntry>>;

/** The webview and renderer entries share almost all of `packages/ui`'s own code, so Vite
 *  splits it into a common chunk both entries `imports` rather than duplicating it — which
 *  means the CSS that chunk pulls in (`vscode-tokens.css`, `density.css`, `codicon.css`) shows
 *  up in *that chunk's* `css` array, not the entry's own. Vite's documented manifest-consumer
 *  pattern is exactly this: walk `imports` transitively and collect every `css` array found
 *  along the way. `seen` guards the (currently impossible, but not contractually forbidden)
 *  case of a chunk graph that revisits the same chunk from two import paths. */
export function collectCss(manifest: ViteManifest, key: string, seen: Set<string>): string[] {
  if (seen.has(key)) return [];
  seen.add(key);
  const entry = manifest[key];
  if (!entry) return [];
  const fromImports = (entry.imports ?? []).flatMap((imp) => collectCss(manifest, imp, seen));
  return [...fromImports, ...(entry.css ?? [])];
}

export interface WebviewDocumentOptions {
  readonly scriptUrl: string;
  readonly styleUrls: readonly string[];
  readonly cspSource: string;
  readonly view: 'graph' | 'review';
  /** Already assembled by the caller (`renderHtml` builds it from `process.env.KIRA_REPO` and its
   *  own options) — this function only serializes it into the bootstrap island, it does not know
   *  what belongs in it. */
  readonly bootstrap: unknown;
  readonly nonce: string;
}

/** The document template and CSP assembly, byte-identical to what `renderHtml` emitted before
 *  this extraction (G16 §7.1 item 7 checks this). No style rule is added here for `html`, `body`
 *  or `#app` (G16 D3) — that height chain lives in `packages/git-ui/src/theme/app-shell.css`
 *  instead, loaded through the built stylesheet `styleUrls` already lists. */
export function buildWebviewDocument(opts: WebviewDocumentOptions): string {
  const { scriptUrl, styleUrls, cspSource, view, bootstrap, nonce } = opts;

  const styleLinks = styleUrls.map((url) => `<link rel="stylesheet" href="${url}">`).join('\n    ');

  const csp = [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    // P4 W4: the layout module worker (`packages/ui/src/graph/layoutClient.ts`) is constructed
    // via `new Worker(new URL(...), { type: "module" })`; Vite's built module-worker bundling
    // for that form loads through a `blob:` URL in a webview, not the extension's own origin, so
    // both sources are needed. V1 confirms this holds on a real webview. The review document
    // does not need this — it runs no layout worker (§6.8/D41) — but CSP is otherwise identical
    // between the two views and one `renderHtml` covers both rather than forking the document.
    ...(view === 'graph' ? [`worker-src ${cspSource} blob:`] : []),
  ].join('; ');

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
    <script type="module" nonce="${nonce}" src="${scriptUrl}"></script>
  </body>
</html>`;
}
