import * as net from 'node:net';
import { join } from 'node:path';
import { expect, test } from './fixtures';

// G1 §8.1(c): the full stack, including a real Approve click. F14/the plan's own reasoning — the
// e2e-real fixture already gives a socket test everything it needs: a real -tags server binary,
// a per-test KIRA_HOME (so the socket lives at a private, disposable path), and a real Playwright
// page. This spec dials that socket directly from the test process while clicking Approve in the
// same test's browser page, proving pairing, token reuse, and revocation end to end.

const MAX_FRAME_BYTES = 8 * 1024 * 1024; // D1 — must match internal/gitsock's own cap exactly.

// A tiny, standalone length-prefixed JSON framer/parser — deliberately not importing
// @kira/git-ipc's own createSocketChannel: this spec's job is proving the real Go server against
// an independent client implementation, the same way internal/gitsock/integration_test.go's own
// testClient is independent of gitsock's internals rather than reaching into them.
class FrameClient {
  #socket: net.Socket;
  #buffer: Buffer = Buffer.alloc(0);
  #queue: unknown[] = [];
  #waiters: Array<(v: unknown) => void> = [];
  #closed: Promise<void>;

  constructor(socket: net.Socket) {
    this.#socket = socket;
    socket.on('data', (chunk: Buffer) => {
      this.#buffer = this.#buffer.byteLength === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
      for (;;) {
        if (this.#buffer.byteLength < 4) return;
        const len = this.#buffer.readUInt32BE(0);
        if (len > MAX_FRAME_BYTES || this.#buffer.byteLength < 4 + len) return;
        const body = this.#buffer.subarray(4, 4 + len);
        this.#buffer = this.#buffer.subarray(4 + len);
        const msg = JSON.parse(body.toString('utf8'));
        const waiter = this.#waiters.shift();
        if (waiter) waiter(msg);
        else this.#queue.push(msg);
      }
    });
    this.#closed = new Promise((resolve) => {
      socket.once('close', () => resolve());
      socket.once('error', () => resolve());
    });
  }

  static async connect(path: string): Promise<FrameClient> {
    const socket = net.connect(path);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    });
    return new FrameClient(socket);
  }

  send(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const frame = Buffer.allocUnsafe(4 + body.byteLength);
    frame.writeUInt32BE(body.byteLength, 0);
    body.copy(frame, 4);
    this.#socket.write(frame);
  }

  async receive(timeoutMs = 10_000): Promise<unknown> {
    const queued = this.#queue.shift();
    if (queued !== undefined) return queued;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('FrameClient.receive timed out')), timeoutMs);
      this.#waiters.push((v) => {
        clearTimeout(timer);
        resolve(v);
      });
    });
  }

  waitClosed(): Promise<void> {
    return this.#closed;
  }

  destroy(): void {
    this.#socket.destroy();
  }
}

interface HandshakeFrame {
  readonly kind: string;
  readonly requestId?: string;
  readonly token?: string;
  readonly reason?: string;
  readonly [key: string]: unknown;
}

const PROTOCOL = 1;
const CONTRACT_VERSION = 18; // Mirrors gitrpc.ContractVersion / @kira/git-ipc's CONTRACT_VERSION.

test('pairing, token reuse and revocation over the real socket', async ({ kira, kiraHome }) => {
  const { window: page } = kira;
  const sockPath = join(kiraHome, 'git.sock');

  // --- 1. Dial with no token; the extension's identity for this test.
  const client = await FrameClient.connect(sockPath);
  client.send({
    kind: 'hello',
    protocol: PROTOCOL,
    contractVersion: CONTRACT_VERSION,
    client: {
      id: 'e2e-real-client',
      label: 'Playwright e2e-real',
      pid: process.pid,
      appVersion: 'test',
    },
    token: null,
  });

  // --- 2. Wait for the pairing dialog in the real browser page and click Approve.
  const pairingRequired = (await client.receive()) as HandshakeFrame;
  expect(pairingRequired.kind).toBe('pairingRequired');

  const dialog = page.locator('[data-testid="git-pairing-dialog"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.click('[data-testid="git-pairing-approve"]');

  // --- 3. The socket receives "paired" then "ready".
  const paired = (await client.receive()) as HandshakeFrame;
  expect(paired.kind).toBe('paired');
  expect(typeof paired.token).toBe('string');
  const token = paired.token as string;
  expect(token.length).toBeGreaterThan(0);

  const ready = (await client.receive()) as HandshakeFrame;
  expect(ready.kind).toBe('ready');

  // --- 4. app.init / repo.open round-trip for real, over rpcstream's own envelope. This
  // container has no git discovery on Linux (F13) — {kind:"notFound"} is the platform's true
  // answer, not a degraded mode, and both round trips completing is what this tier proves; the
  // "ok" branch is internal/gitsock/integration_test.go's job.
  let nextId = 1;
  const request = async (
    method: string,
    params: unknown,
  ): Promise<{ ok: boolean; result?: unknown }> => {
    const id = nextId++;
    client.send({ version: CONTRACT_VERSION, body: { t: 'req', id, method, params } });
    const resp = (await client.receive()) as {
      body: { id: number; ok: boolean; result?: unknown };
    };
    expect(resp.body.id).toBe(id);
    return resp.body;
  };

  const initRes = await request('app.init', {});
  expect(initRes.ok).toBe(true);
  const initResult = initRes.result as { git: { kind: string; probed?: string[] } };
  expect(initResult.git.kind).toBe('notFound');
  expect(initResult.git.probed?.some((line) => line.includes('linux'))).toBe(true);

  const openRes = await request('repo.open', { path: '/tmp/does-not-matter' });
  expect(openRes.ok).toBe(true);
  expect((openRes.result as { kind: string }).kind).toBe('gitUnavailable');

  // --- 5. Settings -> Connected editors: the row is listed, Revoke closes the live connection.
  await page.click('[data-testid="open-settings"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();
  await page.click('[data-testid="settings-section-Connected editors"]');
  await expect(page.locator('[data-testid="git-client-row-e2e-real-client"]')).toBeVisible();

  await page.click('[data-testid="git-client-revoke-e2e-real-client"]');
  await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible();
  await page.click('[data-testid="confirm-dialog-confirm"]');

  await client.waitClosed();

  // --- 6. Re-dial with the stored token: tokenRejected (D18's revocation loop).
  const reconnect = await FrameClient.connect(sockPath);
  reconnect.send({
    kind: 'hello',
    protocol: PROTOCOL,
    contractVersion: CONTRACT_VERSION,
    client: {
      id: 'e2e-real-client',
      label: 'Playwright e2e-real',
      pid: process.pid,
      appVersion: 'test',
    },
    token,
  });
  const rejected = (await reconnect.receive()) as HandshakeFrame;
  expect(rejected.kind).toBe('tokenRejected');
  reconnect.destroy();
});
