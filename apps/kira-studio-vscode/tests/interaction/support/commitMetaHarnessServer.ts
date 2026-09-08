import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { build as viteBuild } from 'vite';

/**
 * G19 §4.2/D4: builds `commitMetaHarness.entry.ts` with its own small, one-off Vite step (never
 * the shared `packages/git-ui/vite.config.ts` build every other tier reuses — this harness has no
 * business perturbing that config for one component's own geometry check) and serves the result
 * over plain HTTP, the same shape `tests/layout/support/server.ts`/`tests/interaction/support/
 * server.ts` already use for the real webview document.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
// "dist" (not a made-up name) so the root .gitignore's existing bare `dist` rule already covers
// it — no new ignore entry needed.
const OUT_DIR = resolve(__dirname, 'dist');

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export interface HarnessServer {
  readonly url: string;
  close(): Promise<void>;
}

export async function startCommitMetaHarnessServer(): Promise<HarnessServer> {
  await viteBuild({
    configFile: false,
    root: __dirname,
    plugins: [vue()],
    logLevel: 'warn',
    build: {
      outDir: OUT_DIR,
      emptyOutDir: true,
      rollupOptions: {
        input: { harness: resolve(__dirname, 'commitMetaHarness.entry.ts') },
        output: {
          entryFileNames: 'harness.js',
          chunkFileNames: 'harness-chunk.js',
          assetFileNames: 'harness.[ext]',
        },
      },
    },
  });

  let server: Server;
  await new Promise<void>((resolvePromise, reject) => {
    server = createServer((req, res) => {
      void (async () => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname === '/' || pathname === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            `<!doctype html><html><head><meta charset="utf-8">` +
              `<style>body{margin:0;font:14px -apple-system,sans-serif;background:#1e1e1e;color:#ccc;} #app{width:420px;padding:16px;}</style>` +
              `<link rel="stylesheet" href="/harness.css">` +
              `</head><body><div id="app"></div>` +
              `<script type="module" src="/harness.js"></script></body></html>`,
          );
          return;
        }
        const rel = pathname.replace(/^\/+/, '');
        const filePath = join(OUT_DIR, rel);
        if (!filePath.startsWith(OUT_DIR)) {
          res.writeHead(403);
          res.end();
          return;
        }
        try {
          const body = await readFile(filePath);
          res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'text/plain' });
          res.end(body);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end(`not found: ${pathname}`);
        }
      })();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  // biome-ignore lint/style/noNonNullAssertion: assigned synchronously inside the Promise executor above.
  const s = server!;
  const address = s.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        s.close((err) => (err ? reject(err) : resolvePromise()));
      }),
  };
}
