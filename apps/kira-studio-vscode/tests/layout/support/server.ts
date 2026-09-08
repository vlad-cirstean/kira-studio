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

// The exact bytes `bun run build:vscode` produces (`apps/kira-studio-vscode/dist/ui`) — the same
// output `renderHtml`'s own `resolveUiAssets` reads in the real extension host, served over plain
// HTTP instead of through `webview.asWebviewUri`. Reimplemented here rather than imported from
// `apps/kira-studio/tests/ui/support/server.ts`: SPEC's own module-boundary rule for this chapter
// says git-specific frontend code lives under its own directories, and this config already exists
// as a second `playwright.config.ts` for exactly that reason (see it for the fuller rationale).
// `apps/kira-studio-vscode/package.json` declares `"type": "module"`, so this file runs as real
// ESM — no `__dirname` global, hence the `import.meta.url` detour.
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

export interface LayoutServer {
  readonly url: string;
  close(): Promise<void>;
}

function nonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * A per-worker static server over `dist/ui`, serving both the built assets and the document
 * `buildWebviewDocument` produces at `/graph` and `/review` — the same document `renderHtml`
 * emits for a real webview, minus the `vscode.Webview`/`vscode.Uri` plumbing this test has no
 * host for. `cspSource` is set to the server's own origin (F9: measured to survive a real CSP
 * carrying `default-src 'none'`), so the emitted `<meta http-equiv="Content-Security-Policy">`
 * matches where the assets it references actually are. No transport, no backend, no repo: the
 * app boots into its pre-connect state, which is all G16's geometry assertions need.
 */
export async function startLayoutServer(): Promise<LayoutServer> {
  const manifestPath = join(DIST_DIR, '.vite', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ViteManifest;
  const entry = manifest[WEBVIEW_ENTRY];
  if (!entry) {
    throw new Error(
      `tests/layout/support/server.ts: no "${WEBVIEW_ENTRY}" entry in ${manifestPath}`,
    );
  }
  const scriptUrl = `/${entry.file}`;
  const styleUrls = collectCss(manifest, WEBVIEW_ENTRY, new Set()).map((css) => `/${css}`);

  let origin = '';
  const server: Server = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      // Chromium auto-probes this on every top-level navigation regardless of the document —
      // real VS Code webviews never see it (there is no favicon concept there), and a 404 for it
      // is not the CSP/asset regression assertion 6 in the spec file exists to catch, so it is
      // answered quietly rather than left to pollute "zero console errors".
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
          target: null,
          pendingUiAction: null,
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
