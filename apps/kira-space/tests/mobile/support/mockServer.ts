import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';

// A stand-in for the Go mobileweb server: the built phone app from frontend/dist-mobile plus a
// scripted /api. Served by one process so the service worker, the SSE stream and the pairing
// long-poll all run for real. State is per worker and reset before each test.

const DIST = resolve(__dirname, '../../../frontend/dist-mobile');
const FIXTURES = resolve(__dirname, '../../fixtures/ade-v2');

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
};

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

export type PairOutcome = 'approve' | 'deny' | 'timeout';

interface State {
  /** `/api/me` and every device route answer 200, 401 unauthorized or 401 revoked. */
  auth: 'ok' | 'unauthorized' | 'revoked';
  requests: { method: string; path: string; body: string }[];
  pairWaiters: ServerResponse[];
  streams: Set<ServerResponse>;
}

export interface MobileServer {
  url: string;
  state: State;
  reset(): void;
  /** Sends one server-sent event to every open stream. */
  emit(channel: string, data: unknown): void;
  /** Answers every parked `POST /api/pair`; approving also marks the device paired. */
  resolvePair(outcome: PairOutcome): void;
  /** Requests that changed state, i.e. anything but GET. */
  nonGet(): { method: string; path: string }[];
  close(): Promise<void>;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
    });
    req.on('end', () => done(data));
  });
}

async function serveFile(res: ServerResponse, pathname: string): Promise<void> {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = join(DIST, rel);
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = readFileSync(file);
    const noCache = rel === 'sw.js' || rel.endsWith('.html');
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=31536000',
    });
    res.end(body);
  } catch {
    // A client-side route: any extensionless navigation gets the app shell.
    if (extname(rel) === '') await serveFile(res, '/');
    else res.writeHead(404).end();
  }
}

export async function startMobileServer(): Promise<MobileServer> {
  const state: State = { auth: 'unauthorized', requests: [], pairWaiters: [], streams: new Set() };
  const repos = (
    fixture('repos') as { repos: { codeRepoId: string; name: string; nickname: string }[] }
  ).repos.map(({ codeRepoId, name, nickname }) => ({ codeRepoId, name, nickname }));
  const reads: Record<string, unknown> = {
    '/api/ade/board': fixture('board'),
    '/api/ade/prs': fixture('prs'),
    '/api/ade/sessions': fixture('sessions'),
    '/api/ade/workflows': fixture('workflows'),
    '/api/ade/backlog': fixture('backlog'),
    '/api/ade/repos': { repos },
    '/api/ade/log': fixture('log-page'),
    '/api/agent/sessions': { sessions: [] },
  };

  const unauthorized = (res: ServerResponse): void => {
    const revoked = state.auth === 'revoked';
    json(res, 401, {
      code: revoked ? 'E_REVOKED' : 'E_UNAUTHORIZED',
      message: revoked ? 'device revoked' : 'not paired',
    });
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    if (!path.startsWith('/api/')) {
      await serveFile(res, path);
      return;
    }
    const body = method === 'GET' ? '' : await readBody(req);
    state.requests.push({ method, path, body });

    if (path === '/api/pair' && method === 'POST') {
      state.pairWaiters.push(res);
      res.on('close', () => {
        state.pairWaiters = state.pairWaiters.filter((r) => r !== res);
      });
      return;
    }
    if (state.auth !== 'ok') {
      unauthorized(res);
      return;
    }
    if (path === '/api/me') {
      json(res, 200, { deviceId: 'dev-1', label: 'Test phone' });
    } else if (path === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(': open\n\n');
      state.streams.add(res);
      res.on('close', () => state.streams.delete(res));
    } else if (path in reads && method === 'GET') {
      json(res, 200, reads[path]);
    } else {
      json(res, 404, { code: 'E_NOT_FOUND', message: 'not found' });
    }
  };

  const server: Server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ok());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const api: MobileServer = {
    url: `http://127.0.0.1:${port}/`,
    state,
    reset() {
      for (const res of [...state.streams, ...state.pairWaiters]) res.destroy();
      state.auth = 'unauthorized';
      state.requests = [];
      state.pairWaiters = [];
      state.streams = new Set();
    },
    emit(channel, data) {
      for (const res of state.streams)
        res.write(`event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    resolvePair(outcome) {
      for (const res of state.pairWaiters) {
        if (outcome === 'approve') {
          state.auth = 'ok';
          json(res, 200, { deviceId: 'dev-1', label: 'Test phone' });
        } else {
          json(res, 403, {
            code: 'E_PAIRING_DENIED',
            message: outcome === 'deny' ? 'access denied' : 'request timed out',
            reason: outcome === 'deny' ? 'denied' : 'timeout',
          });
        }
      }
      state.pairWaiters = [];
    },
    nonGet: () =>
      state.requests
        .filter((r) => r.method !== 'GET')
        .map(({ method, path }) => ({ method, path })),
    close: () =>
      new Promise<void>((ok, fail) => {
        api.reset();
        server.closeAllConnections();
        server.close((err) => (err ? fail(err) : ok()));
      }),
  };
  return api;
}
