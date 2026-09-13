import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, resolve } from 'node:path';

// Built by `bun run build` (vite.config.ts → apps/kira-studio/frontend/dist), the exact bytes the
// real Wails bundle embeds (P52 main.go's `//go:embed all:frontend/dist`) — this tier serves the
// same static output a packaged app does, just over plain HTTP instead of Wails' own AssetServer.
const DIST_DIR = resolve(__dirname, '../../../frontend/dist');

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
};

export interface UiServer {
  url: string;
  close(): Promise<void>;
}

/**
 * A static HTTP server over `apps/kira-studio/frontend/dist`, one per worker (P57 §4.10) — the tests/ui/
 * counterpart to `_electron.launch()`. It serves `index.html` for `/` and every built asset, and
 * deliberately serves nothing under `/wails/`: those requests are either intercepted by
 * `mockRuntime.ts` (the runtime's own `*.js` files, and the one RPC endpoint bound calls POST to)
 * or never issued at all (the bulk-data stream, replaced outright by `mockStream.ts`'s
 * `window._wails.streamFactory`, D14). A `/wails/*` request that reaches this server anyway is a
 * real bug — a call `mockRuntime.ts`'s route did not intercept — so it answers 501 naming the
 * path, loudly, rather than 404, which would look like nothing more than a missing asset.
 */
export async function startServer(): Promise<UiServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname.startsWith('/wails/')) {
        res.writeHead(501, { 'Content-Type': 'text/plain' });
        res.end(
          `tests/ui/support/server.ts does not serve /wails/* — unmocked request: ${pathname}`,
        );
        return;
      }
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
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

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((err) => (err ? reject(err) : resolvePromise()));
      }),
  };
}
