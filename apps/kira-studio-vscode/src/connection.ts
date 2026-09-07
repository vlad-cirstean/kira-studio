/**
 * The socket connection manager (SPEC §5 item 1, G1 §5.4) — dial `${KIRA_HOME}/git.sock`, run the
 * handshake (SPEC §3.3/G1 plan §3.1.1), store the token in `context.secrets`, reconnect with
 * backoff on drop. This is the one genuinely new piece of wiring the migration adds; everything
 * downstream of `ready` (the RPC surface itself) is `@kira/git-ipc`'s `createRpcClient`, unchanged.
 *
 * The handshake speaks the same raw, length-prefixed JSON frames `createSocketChannel` already
 * frames/parses — `onMessage` is a single-subscriber seam by design (that file's own doc comment),
 * so this class can read the handshake's own frames directly and then hand the very same channel
 * to `createRpcClient` once `ready` arrives, exactly the handoff `gitsock`'s Go side makes from its
 * own `runHandshake` into `rpcstream.Serve`.
 */
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@kira/git-core';
import type {
  EventKey,
  EventPayload,
  ParamsOf,
  RequestKey,
  ResultOf,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
  Transport,
} from '@kira/git-ipc';
import { CONTRACT_VERSION, createRpcClient } from '@kira/git-ipc';
import type { SocketChannel } from '@kira/git-ipc/socketChannel';
import { createSocketChannel } from '@kira/git-ipc/socketChannel';
import * as vscode from 'vscode';

// SPEC §3.3's own protocol version — the handshake envelope's version, distinct from
// CONTRACT_VERSION and never expected to change unless hello/ready itself is redesigned. Mirrors
// gitrpc.Protocol on the Go side.
const PROTOCOL = 1;

const TOKEN_SECRET_KEY = 'kira.git.token';
const CLIENT_ID_KEY = 'kira.git.clientId';

// D22: 500ms -> 8s, x2, +-20% jitter, reset to 500ms on a successful "ready".
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

export type ConnectionState =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'pairing' }
  | { readonly kind: 'connected' }
  | { readonly kind: 'denied'; readonly reason: 'denied' | 'timeout' }
  | {
      readonly kind: 'versionMismatch';
      readonly expected: number;
      readonly received: number;
      readonly serverVersion: string;
    };

interface HandshakeResponse {
  readonly kind: string;
  readonly expected?: number;
  readonly received?: number;
  readonly serverVersion?: string;
  readonly contractVersion?: number;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly expiresInMs?: number;
  readonly token?: string;
  readonly reason?: string;
}

function socketPath(): string {
  const home = process.env.KIRA_HOME ?? path.join(os.homedir(), '.kira-studio');
  return path.join(home, 'git.sock');
}

async function getOrCreateClientId(context: vscode.ExtensionContext): Promise<string> {
  const existing = context.globalState.get<string>(CLIENT_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await context.globalState.update(CLIENT_ID_KEY, id);
  return id;
}

function clientLabel(): string {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.name;
  return workspace ? `${os.hostname()} — ${workspace}` : os.hostname();
}

export class ConnectionManager implements vscode.Disposable {
  readonly #context: vscode.ExtensionContext;
  readonly #logger: Logger;
  readonly #clientId: Promise<string>;
  readonly #appVersion: string;
  readonly #stateEmitter = new vscode.EventEmitter<ConnectionState>();
  readonly onStateChange = this.#stateEmitter.event;

  #state: ConnectionState = { kind: 'connecting' };
  #socket: net.Socket | undefined;
  #transport: Transport | undefined;
  // on()'s subscriptions must survive a reconnect (D19) -- the transport is rebuilt on every
  // successful handshake (#handleHandshakeFrame's 'ready' case), so this class keeps its own
  // handler set and re-subscribes each new transport (#attachEventHandlers), rather than letting
  // a subscription silently go quiet across a drop.
  #eventHandlers = new Map<EventKey, Set<(payload: unknown) => void>>();
  #transportEventUnsubs = new Map<(payload: unknown) => void, () => void>();
  #backoffMs = INITIAL_BACKOFF_MS;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  // Every dial gets a fresh token; a callback checks it against the current one before acting,
  // so a superseded (disposed, or replaced by a fresh retry) dial's late socket events are inert.
  #dialToken = 0;

  constructor(context: vscode.ExtensionContext, logger: Logger, appVersion: string) {
    this.#context = context;
    this.#logger = logger;
    this.#appVersion = appVersion;
    this.#clientId = getOrCreateClientId(context);
    void this.#dial();
  }

  get state(): ConnectionState {
    return this.#state;
  }

  request<K extends RequestKey>(
    method: K,
    params: ParamsOf<K>,
    signal?: AbortSignal,
  ): Promise<ResultOf<K>> {
    if (!this.#transport) {
      return Promise.reject(new Error('connection: not connected to Kira Studio'));
    }
    return this.#transport.request(method, params, signal);
  }

  /** Mirrors Transport.stream exactly (D19) — rejects the same way request() does when not
   *  currently connected. */
  stream<K extends StreamKey>(
    method: K,
    params: StreamParamsOf<K>,
    onChunk: (chunk: StreamChunkOf<K>) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.#transport) {
      return Promise.reject(new Error('connection: not connected to Kira Studio'));
    }
    return this.#transport.stream(method, params, onChunk, signal);
  }

  /** Subscribes handler to method's events for the life of this ConnectionManager, across
   *  however many reconnects happen in between (D19) — the one piece of real logic here that
   *  request() does not need. */
  on<K extends EventKey>(method: K, handler: (payload: EventPayload<K>) => void): () => void {
    const wrapped = handler as (payload: unknown) => void;
    let set = this.#eventHandlers.get(method);
    if (!set) {
      set = new Set();
      this.#eventHandlers.set(method, set);
    }
    set.add(wrapped);
    if (this.#transport) {
      this.#transportEventUnsubs.set(wrapped, this.#transport.on(method, wrapped));
    }
    return () => {
      set?.delete(wrapped);
      this.#transportEventUnsubs.get(wrapped)?.();
      this.#transportEventUnsubs.delete(wrapped);
    };
  }

  /** Re-attaches every still-registered on() handler to the newly connected transport — called
   *  once per successful handshake, right after #transport is assigned. */
  #attachEventHandlers(): void {
    if (!this.#transport) return;
    for (const [method, set] of this.#eventHandlers) {
      for (const handler of set) {
        this.#transportEventUnsubs.set(handler, this.#transport.on(method, handler));
      }
    }
  }

  /** Re-arms the loop after a deliberate stop (`denied`/`versionMismatch`, D22) — the only way
   *  either state ever leaves itself, since disconnection alone does not retry them. */
  retry(): void {
    if (this.#state.kind !== 'denied' && this.#state.kind !== 'versionMismatch') return;
    this.#backoffMs = INITIAL_BACKOFF_MS;
    this.#setState({ kind: 'connecting' });
    void this.#dial();
  }

  dispose(): void {
    this.#stopped = true;
    this.#dialToken++;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#socket?.destroy();
    this.#stateEmitter.dispose();
  }

  #setState(state: ConnectionState): void {
    this.#state = state;
    this.#stateEmitter.fire(state);
  }

  async #dial(): Promise<void> {
    if (this.#stopped) return;
    const dialToken = ++this.#dialToken;
    const clientId = await this.#clientId;
    const storedToken = await this.#context.secrets.get(TOKEN_SECRET_KEY);
    if (dialToken !== this.#dialToken) return;

    const socket = net.connect(socketPath());
    this.#socket = socket;

    socket.once('error', (err) => {
      if (dialToken !== this.#dialToken) return;
      this.#logger.log('debug', 'dial failed', { err: String(err) });
      this.#onDisconnected(dialToken);
    });

    socket.once('connect', () => {
      if (dialToken !== this.#dialToken) return;
      const channel = createSocketChannel(socket);
      channel.onClose(() => this.#onDisconnected(dialToken));
      this.#awaitOneFrame(dialToken, channel, socket);
      channel.post({
        kind: 'hello',
        protocol: PROTOCOL,
        contractVersion: CONTRACT_VERSION,
        client: {
          id: clientId,
          label: clientLabel(),
          pid: process.pid,
          appVersion: this.#appVersion,
        },
        token: storedToken ?? null,
      });
    });
  }

  /** Reads exactly one handshake frame — §3.1.1's rows 4-7 each answer with either a terminal
   *  frame or one more frame to wait for ("paired" precedes "ready"; "pairingRequired" precedes
   *  the broker's own eventual answer), so the handshake proceeds frame by frame rather than as
   *  one blocking read. */
  #awaitOneFrame(dialToken: number, channel: SocketChannel, socket: net.Socket): void {
    const unsubscribe = channel.onMessage((raw) => {
      unsubscribe();
      void this.#handleHandshakeFrame(dialToken, channel, socket, raw as HandshakeResponse);
    });
  }

  async #handleHandshakeFrame(
    dialToken: number,
    channel: SocketChannel,
    socket: net.Socket,
    resp: HandshakeResponse,
  ): Promise<void> {
    if (dialToken !== this.#dialToken) return;
    switch (resp.kind) {
      case 'ready': {
        this.#backoffMs = INITIAL_BACKOFF_MS;
        this.#transport = createRpcClient(channel);
        this.#attachEventHandlers();
        this.#setState({ kind: 'connected' });
        this.#logger.log('info', 'connected', { sessionId: resp.sessionId });
        return;
      }
      case 'paired': {
        if (resp.token) await this.#context.secrets.store(TOKEN_SECRET_KEY, resp.token);
        this.#awaitOneFrame(dialToken, channel, socket);
        return;
      }
      case 'pairingRequired': {
        this.#setState({ kind: 'pairing' });
        this.#awaitOneFrame(dialToken, channel, socket);
        return;
      }
      case 'tokenRejected': {
        // D18's loop: a revoked token is cleared and re-dialed immediately, no backoff — this is
        // what turns a revocation into a fresh pairing prompt within about one round trip.
        await this.#context.secrets.delete(TOKEN_SECRET_KEY);
        socket.destroy();
        if (dialToken === this.#dialToken) void this.#dial();
        return;
      }
      case 'pairingDenied': {
        this.#setState({
          kind: 'denied',
          reason: resp.reason === 'timeout' ? 'timeout' : 'denied',
        });
        socket.destroy();
        return;
      }
      case 'versionMismatch': {
        this.#setState({
          kind: 'versionMismatch',
          expected: resp.expected ?? 0,
          received: resp.received ?? 0,
          serverVersion: resp.serverVersion ?? '',
        });
        socket.destroy();
        return;
      }
      default: {
        this.#logger.log('warn', 'unexpected handshake frame', { kind: resp.kind });
        socket.destroy();
      }
    }
  }

  #onDisconnected(dialToken: number): void {
    if (dialToken !== this.#dialToken) return;
    this.#transport = undefined;
    this.#transportEventUnsubs.clear(); // the dead transport's own unsubscribes are moot.
    this.#socket = undefined;
    if (this.#stopped) return;
    // `denied`/`versionMismatch` are deliberate stops (D22) — only a `retry()` call issues a
    // fresh dialToken past this check; every other state means the drop was unplanned.
    if (this.#state.kind === 'denied' || this.#state.kind === 'versionMismatch') return;
    this.#setState({ kind: 'connecting' });
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    const jitter = 1 + (Math.random() * 0.4 - 0.2); // +-20%
    const delay = Math.round(this.#backoffMs * jitter);
    this.#backoffMs = Math.min(this.#backoffMs * 2, MAX_BACKOFF_MS);
    this.#reconnectTimer = setTimeout(() => void this.#dial(), delay);
  }
}
