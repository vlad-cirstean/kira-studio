import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION } from '@kira/git-ipc';
import {
  buildWebviewDocument,
  collectCss,
  type ViteManifest,
  WEBVIEW_ENTRY,
} from '../../../src/webviewDocument.ts';

/**
 * G19 §4.2: the interaction tier's own static server — the same shape
 * `tests/layout/support/server.ts` already uses (see that file's own doc comment for the fuller
 * rationale), extended with one thing the layout tier never needed: a `target` for the `/review`
 * document's own bootstrap island, so a cold review-view mount can go straight into `setTarget`
 * (D40's cold-bootstrap arm) instead of asking `repo.list` for an active repo first — `fakeReview
 * Host.ts`'s four scripted responses do not include one.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '../../../dist/ui');

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export interface InteractionServer {
  readonly url: string;
  close(): Promise<void>;
}

function nonce(): string {
  return randomBytes(16).toString('hex');
}

export interface StartInteractionServerOptions {
  /** Seeded into the `/review` document's own bootstrap island as `target` — `null` for the
   *  ordinary "no branch yet" cold boot. */
  readonly reviewTarget?: { repoId: string; branch: string } | null;
  /** G-UX (item 13): seeded into both documents' own bootstrap island as `connectionState` —
   *  defaults to `connected` (the ordinary case for every existing spec built on this fixture,
   *  whose fake host answers every request as if connected). A spec exercising the connection
   *  banner's own cold-boot seed passes a different value here. */
  readonly connectionState?: { kind: string; detail?: string };
}

export async function startInteractionServer(
  options: StartInteractionServerOptions = {},
): Promise<InteractionServer> {
  const manifestPath = join(DIST_DIR, '.vite', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ViteManifest;
  const entry = manifest[WEBVIEW_ENTRY];
  if (!entry) {
    throw new Error(
      `tests/interaction/support/server.ts: no "${WEBVIEW_ENTRY}" entry in ${manifestPath}`,
    );
  }
  const scriptUrl = `/${entry.file}`;
  const styleUrls = collectCss(manifest, WEBVIEW_ENTRY, new Set()).map((css) => `/${css}`);
  const reviewTarget = options.reviewTarget ?? null;
  const connectionState = options.connectionState ?? { kind: 'connected' as const };

  let origin = '';
  const server: Server = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      const view = pathname === '/graph' ? 'graph' : pathname === '/review' ? 'review' : null;
      if (view) {
        const bootstrap = {
          host: 'vscode' as const,
          contractVersion: CONTRACT_VERSION,
          repo: null,
          view,
          target: view === 'review' ? reviewTarget : null,
          pendingUiAction: null,
          connectionState,
        };
        const document = buildWebviewDocument({
          scriptUrl,
          styleUrls,
          cspSource: origin,
          view,
          bootstrap,
          nonce: nonce(),
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(document);
        return;
      }

      const rel = pathname.replace(/^\/+/, '');
      const filePath = join(DIST_DIR, rel);
      if (!filePath.startsWith(DIST_DIR)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const body = await readFile(filePath);
        res.writeHead(200, {
          'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
        });
        res.end(body);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`not found: ${pathname}`);
      }
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
