import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION } from '@kira/git-ipc';
import { serveStatic } from '../../../../packages/workbench/src/testing/ui/server.ts';
import {
  buildWebviewDocument,
  collectCss,
  type ViteManifest,
  WEBVIEW_ENTRY,
} from '../../src/webviewDocument.ts';

/**
 * The shared `/graph` and `/review` static+bootstrap server behind both
 * `tests/interaction/support/server.ts` and `tests/layout/support/server.ts` (P107 I2-27) — each
 * of those files now only supplies its own `bootstrap` callback, the one thing that genuinely
 * differed between them. `apps/kira-space-vscode/package.json` declares `"type": "module"`, so
 * this file runs as real ESM — no `__dirname` global, hence the `import.meta.url` detour.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '../../dist/ui');

export interface WebviewServer {
  readonly url: string;
  close(): Promise<void>;
}

function nonce(): string {
  return randomBytes(16).toString('hex');
}

type WebviewKind = 'graph' | 'review';

export interface StartWebviewServerOptions {
  /** Builds the bootstrap island payload for a `/graph` or `/review` request, given the server's
   *  own origin (needed for `cspSource`-derived fields some callers seed, e.g. connectionState). */
  readonly bootstrap: (view: WebviewKind, origin: string) => unknown;
}

export async function startWebviewServer(
  options: StartWebviewServerOptions,
): Promise<WebviewServer> {
  const { bootstrap } = options;
  const manifestPath = join(DIST_DIR, '.vite', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ViteManifest;
  const entry = manifest[WEBVIEW_ENTRY];
  if (!entry) {
    throw new Error(`webviewServer.ts: no "${WEBVIEW_ENTRY}" entry in ${manifestPath}`);
  }
  const scriptUrl = `/${entry.file}`;
  const styleUrls = collectCss(manifest, WEBVIEW_ENTRY, new Set()).map((css) => `/${css}`);

  let origin = '';
  const server: Server = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      // Chromium auto-probes this on every top-level navigation regardless of the document — real
      // VS Code webviews never see it (there is no favicon concept there), and a 404 for it is not
      // a regression either tier's own specs exist to catch, so it is answered quietly rather than
      // left to pollute "zero console errors".
      if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      const view: WebviewKind | null =
        pathname === '/graph' ? 'graph' : pathname === '/review' ? 'review' : null;
      if (view) {
        const document = buildWebviewDocument({
          scriptUrl,
          styleUrls,
          cspSource: origin,
          view,
          bootstrap: bootstrap(view, origin),
          nonce: nonce(),
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(document);
        return;
      }
      await serveStatic(DIST_DIR, pathname, res);
    })();
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  origin = `http://127.0.0.1:${port}`;

  return {
    url: origin,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((err) => (err ? reject(err) : resolvePromise()));
      }),
  };
}

/** `CONTRACT_VERSION` re-exported so callers building a `bootstrap` payload don't need their own
 *  `@kira/git-ipc` import just for this one constant. */
export { CONTRACT_VERSION };
