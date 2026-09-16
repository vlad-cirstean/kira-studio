import { createServer, type Server } from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { type Rolldown, build as viteBuild } from 'vite';

/**
 * G19 §4.2/D4: builds `commitMetaHarness.entry.ts` with its own small, one-off Vite step (never
 * the shared `packages/git-ui/vite.config.ts` build every other tier reuses — this harness has no
 * business perturbing that config for one component's own geometry check) and serves the result
 * over plain HTTP, the same shape `tests/layout/support/server.ts`/`tests/interaction/support/
 * server.ts` already use for the real webview document.
 *
 * P81 §5: built with `write: false` and served from memory, never from disk. This project's
 * `webview-interaction` config sets `fullyParallel: true`, and `test.beforeAll` runs once per
 * worker — N workers used to mean N concurrent Vite builds into one shared `dist/`, each emptying
 * it first, so a worker mid-fetch of `/harness.js` while a sibling's build was mid-wipe got a 404
 * and the page never mounted (measured: 56/270 requests 404ing under two concurrent builds; see
 * `docs/v1.8/plans/P81-fix-flaky-ui-tests.md` §5.2/§5.4). Serving from memory removes the shared
 * resource instead of partitioning it — no directory for a sibling worker to race.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

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
  const result = await viteBuild({
    configFile: false,
    root: __dirname,
    plugins: [vue()],
    logLevel: 'warn',
    build: {
      write: false,
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
  // Narrow the union `viteBuild` returns for a single, non-watch build (this app pins vite's
  // rolldown-based bundler — `build.rolldownOptions` elsewhere in this repo — so the real return
  // type is `RolldownOutput`, not classic Rollup's; `RolldownWatcher` is watch-mode-only, which
  // this call never triggers — no `watch` option is passed above).
  const outputs = (Array.isArray(result) ? result[0] : result) as Rolldown.RolldownOutput;
  const files = new Map<string, string | Uint8Array>();
  for (const o of outputs.output) {
    files.set(`/${o.fileName}`, o.type === 'chunk' ? o.code : o.source);
  }
  // A silent rename in the config above must not degrade into a 404 at request time.
  for (const required of ['/harness.js', '/harness.css']) {
    if (!files.has(required)) {
      throw new Error(`commit-meta harness build produced no ${required}`);
    }
  }

  let server: Server;
  await new Promise<void>((resolvePromise, reject) => {
    server = createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><html><head><meta charset="utf-8">` +
            // G-UX D7 (item 7): `#app` carries a real, fixed 480px height (this plan's own §2 D7
            // 7c worked example) so `DetailPane.vue`'s `.kv-detail-pane { height: 100% }` — and
            // every percentage `max-height` hung off it — resolves against a concrete number,
            // not an unconstrained one that would collapse to 0.
            `<style>body{margin:0;font:14px -apple-system,sans-serif;background:#1e1e1e;color:#ccc;} #app{width:420px;height:480px;}</style>` +
            `<link rel="stylesheet" href="/harness.css">` +
            `</head><body><div id="app"></div>` +
            `<script type="module" src="/harness.js"></script></body></html>`,
        );
        return;
      }
      const body = files.get(pathname);
      if (body === undefined) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`not found: ${pathname}`);
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(pathname)] ?? 'text/plain' });
      res.end(body);
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
