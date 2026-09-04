/**
 * The one generic RPC endpoint. Everything above the literal message-posting call lives here —
 * request correlation, event dispatch, stream credits and cancellation — so a host and the
 * harness's mock cannot diverge on semantics; each contributes only a ~ten-line
 * `MessageChannelLike` adapter over whatever it actually has (a Wails stream here, a webview's
 * `postMessage` in the source project, a plain in-process queue in the harness). It never learns
 * what a method means: the contract is a type parameter, and the version plus method vocabulary
 * are an injected `EndpointConfig` — a module instantiates both once (see `@kira/git-ipc`'s
 * `endpoint.ts`) and every consumer of that module's IPC surface is none the wiser.
 */
import { dedupeTransferList, encode } from './codec';
import type {
  ContractShape,
  EventKey,
  EventPayload,
  ParamsOf,
  RequestKey,
  ResultOf,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
} from './contractShape';
import { unwrapVersioned, type VersionedEnvelope, wrapVersioned } from './envelope';
import type { ContractChannel } from './shape';
import { type Transport, TransportError } from './transport';

/** The one thing every transport (real or mock) implements: post a message, optionally with a
 *  transfer list, and be told about incoming ones. Everything above this — correlation,
 *  credits, cancellation — is `rpc.ts`'s job, not the channel's. */
export interface MessageChannelLike {
  post(message: unknown, transfer?: readonly ArrayBuffer[]): void;
  onMessage(handler: (message: unknown) => void): () => void;
  close(): void;
}

/** An error that crossed the wire as data: `code` and `message` always; `kind` is a classified
 *  error's own kind when the failure carries one, carried structurally since this package
 *  depends on nothing. Raw stderr never crosses — see `toWireError` below. */
export interface WireError {
  readonly code: string;
  readonly message: string;
  readonly kind?: string;
}

export class RpcError extends Error {
  readonly code: string;
  readonly kind: string | undefined;

  constructor(wire: WireError) {
    super(wire.message);
    this.name = 'RpcError';
    this.code = wire.code;
    this.kind = wire.kind;
  }
}

/** The version and method-shape vocabulary one module's contract binds these functions to —
 *  everything the generic endpoint needs to know about a contract that a `ContractShape` type
 *  parameter alone cannot carry into a runtime check. */
export interface EndpointConfig {
  readonly contractVersion: number;
  readonly assertShape: (channel: ContractChannel, method: string, payload: unknown) => void;
}

// ---------------------------------------------------------------------------------------
// The frame union. Every member crosses the wire wrapped by `wrapVersioned`.
// ---------------------------------------------------------------------------------------

type Frame<C extends ContractShape> =
  | {
      readonly t: 'req';
      readonly id: number;
      readonly method: RequestKey<C>;
      readonly params: unknown;
    }
  | { readonly t: 'res'; readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly t: 'res'; readonly id: number; readonly ok: false; readonly error: WireError }
  | { readonly t: 'evt'; readonly method: EventKey<C>; readonly payload: unknown }
  | {
      readonly t: 'open';
      readonly id: number;
      readonly method: StreamKey<C>;
      readonly params: unknown;
    }
  | { readonly t: 'chunk'; readonly id: number; readonly seq: number; readonly chunk: unknown }
  | { readonly t: 'end'; readonly id: number; readonly error?: WireError }
  | { readonly t: 'credit'; readonly id: number; readonly n: number }
  | { readonly t: 'cancel'; readonly id: number };

/** Streams open with this much credit already granted — enough that the server can keep one
 *  chunk moving while the previous one is still being processed, never so much that a slow
 *  consumer lets a 100k walk queue unbounded buffers into it (W2). */
const INITIAL_STREAM_CREDIT = 2;

function toWireError(error: unknown): WireError {
  if (error instanceof Error) {
    const kind = (error as { readonly kind?: unknown }).kind;
    return typeof kind === 'string'
      ? { code: error.name, message: error.message, kind }
      : { code: error.name, message: error.message };
  }
  return { code: 'Unknown', message: String(error) };
}

function post<C extends ContractShape>(
  channel: MessageChannelLike,
  config: EndpointConfig,
  frame: Frame<C>,
): void {
  const envelope = wrapVersioned(config.contractVersion, frame);
  const { payload, transfer } = encode(envelope);
  channel.post(payload, dedupeTransferList(transfer));
}

function receive<C extends ContractShape>(
  channel: MessageChannelLike,
  config: EndpointConfig,
  handleFrame: (frame: Frame<C>) => void,
): () => void {
  return channel.onMessage((raw) => {
    const envelope = raw as VersionedEnvelope<Frame<C>>;
    handleFrame(unwrapVersioned(config.contractVersion, envelope));
  });
}

// ---------------------------------------------------------------------------------------
// A small counting semaphore — the credit gate a stream's `emit` waits on.
// ---------------------------------------------------------------------------------------

class CreditGate {
  #available = 0;
  #waiters: Array<() => void> = [];

  grant(n: number): void {
    this.#available += n;
    while (this.#available > 0 && this.#waiters.length > 0) {
      this.#available--;
      this.#waiters.shift()?.();
    }
  }

  acquire(): Promise<void> {
    if (this.#available > 0) {
      this.#available--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.#waiters.push(resolve));
  }
}

// ---------------------------------------------------------------------------------------
// createRpcClient — the UI side of the endpoint. Implements P0's `Transport`.
// ---------------------------------------------------------------------------------------

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: unknown) => void;
}

interface PendingStream<C extends ContractShape> {
  readonly method: StreamKey<C>;
  readonly onChunk: (chunk: unknown) => void | Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  /** Chains chunk processing so out-of-order concurrent deliveries of `onMessage` (the
   *  transport may invoke it again before an `await onChunk(...)` above resolves) cannot call
   *  `onChunk` for two chunks concurrently — ordering is a contract callers rely on (W9). */
  queue: Promise<void>;
  done: boolean;
}

export function createRpcClient<C extends ContractShape>(
  channel: MessageChannelLike,
  config: EndpointConfig,
): Transport<C> {
  let nextId = 1;
  const pendingRequests = new Map<number, PendingRequest>();
  const pendingStreams = new Map<number, PendingStream<C>>();
  const openStreamIdByMethod = new Map<StreamKey<C>, number>();
  const eventHandlers = new Map<EventKey<C>, Set<(payload: unknown) => void>>();

  function finishStream(id: number): void {
    const entry = pendingStreams.get(id);
    if (!entry) return;
    entry.done = true;
    pendingStreams.delete(id);
    if (openStreamIdByMethod.get(entry.method) === id) openStreamIdByMethod.delete(entry.method);
  }

  function handleFrame(frame: Frame<C>): void {
    switch (frame.t) {
      case 'res': {
        const pending = pendingRequests.get(frame.id);
        if (!pending) return;
        pendingRequests.delete(frame.id);
        if (frame.ok) pending.resolve(frame.result);
        else pending.reject(new RpcError(frame.error));
        return;
      }
      case 'evt': {
        config.assertShape('event', frame.method, frame.payload);
        for (const handler of eventHandlers.get(frame.method) ?? []) handler(frame.payload);
        return;
      }
      case 'chunk': {
        const entry = pendingStreams.get(frame.id);
        if (!entry || entry.done) return;
        entry.queue = entry.queue.then(async () => {
          if (entry.done) return;
          await entry.onChunk(frame.chunk);
          if (entry.done) return;
          channel.post(
            wrapVersioned<Frame<C>>(config.contractVersion, { t: 'credit', id: frame.id, n: 1 }),
          );
        });
        return;
      }
      case 'end': {
        const entry = pendingStreams.get(frame.id);
        if (!entry || entry.done) return;
        entry.queue = entry.queue.then(() => {
          if (entry.done) return;
          finishStream(frame.id);
          if (frame.error) entry.reject(new RpcError(frame.error));
          else entry.resolve();
        });
        return;
      }
      // "req", "open", "credit" and "cancel" are client -> server only; a client never
      // receives them, and a stray one is a protocol bug worth failing loudly on.
      default:
        throw new TransportError(
          'contract-mismatch',
          `client received an unexpected frame '${frame.t}'`,
        );
    }
  }

  const unsubscribe = receive<C>(channel, config, handleFrame);

  return {
    request<K extends RequestKey<C>>(
      method: K,
      params: ParamsOf<C, K>,
      signal?: AbortSignal,
    ): Promise<ResultOf<C, K>> {
      if (signal?.aborted) {
        return Promise.reject(
          new TransportError('cancelled', `request '${method}' was already cancelled`),
        );
      }
      const id = nextId++;
      return new Promise<ResultOf<C, K>>((resolve, reject) => {
        pendingRequests.set(id, { resolve: resolve as (result: unknown) => void, reject });
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              if (!pendingRequests.has(id)) return;
              pendingRequests.delete(id);
              post<C>(channel, config, { t: 'cancel', id });
              reject(new TransportError('cancelled', `request '${method}' was cancelled`));
            },
            { once: true },
          );
        }
        post<C>(channel, config, { t: 'req', id, method, params });
      });
    },

    on<K extends EventKey<C>>(
      method: K,
      handler: (payload: EventPayload<C, K>) => void,
    ): () => void {
      let set = eventHandlers.get(method);
      if (!set) {
        set = new Set();
        eventHandlers.set(method, set);
      }
      const wrapped = handler as (payload: unknown) => void;
      set.add(wrapped);
      return () => set.delete(wrapped);
    },

    stream<K extends StreamKey<C>>(
      method: K,
      params: StreamParamsOf<C, K>,
      onChunk: (chunk: StreamChunkOf<C, K>) => void,
      signal?: AbortSignal,
    ): Promise<void> {
      // Opening a second stream for the same method supersedes the first (W2) — the same
      // "superseded query is killed" rule §4.3 states for reads.
      const priorId = openStreamIdByMethod.get(method);
      if (priorId !== undefined) {
        const prior = pendingStreams.get(priorId);
        if (prior && !prior.done) {
          finishStream(priorId);
          post<C>(channel, config, { t: 'cancel', id: priorId });
          prior.resolve();
        }
      }

      if (signal?.aborted) {
        return Promise.reject(
          new TransportError('cancelled', `stream '${method}' was already cancelled`),
        );
      }

      const id = nextId++;
      return new Promise<void>((resolve, reject) => {
        const entry: PendingStream<C> = {
          method,
          onChunk: onChunk as (chunk: unknown) => void | Promise<void>,
          resolve,
          reject,
          queue: Promise.resolve(),
          done: false,
        };
        pendingStreams.set(id, entry);
        openStreamIdByMethod.set(method, id);

        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              if (entry.done) return;
              finishStream(id);
              post<C>(channel, config, { t: 'cancel', id });
              resolve();
            },
            { once: true },
          );
        }

        post<C>(channel, config, { t: 'open', id, method, params });
        post<C>(channel, config, { t: 'credit', id, n: INITIAL_STREAM_CREDIT });
      });
    },

    dispose(): void {
      unsubscribe();
      for (const pending of pendingRequests.values()) {
        pending.reject(new TransportError('transport-closed', 'the transport was disposed'));
      }
      pendingRequests.clear();
      for (const [id, entry] of pendingStreams) {
        if (!entry.done) {
          entry.done = true;
          entry.resolve();
        }
        pendingStreams.delete(id);
      }
      openStreamIdByMethod.clear();
      eventHandlers.clear();
      channel.close();
    },
  };
}

// ---------------------------------------------------------------------------------------
// createRpcServer — the host side of the endpoint.
// ---------------------------------------------------------------------------------------

export type RequestHandler<C extends ContractShape, K extends RequestKey<C>> = (
  params: ParamsOf<C, K>,
  ctx: { readonly signal: AbortSignal },
) => Promise<ResultOf<C, K>>;

export type StreamHandler<C extends ContractShape, K extends StreamKey<C>> = (
  params: StreamParamsOf<C, K>,
  ctx: {
    readonly signal: AbortSignal;
    /** Awaited by the handler: this is where the credit-based backpressure reaches back into
     *  whatever is producing chunks (W7 — P2's paused `git log`). */
    readonly emit: (chunk: StreamChunkOf<C, K>) => Promise<void>;
  },
) => Promise<void>;

export type ServerHandlers<C extends ContractShape> = {
  readonly requests: { readonly [K in RequestKey<C>]: RequestHandler<C, K> };
  readonly streams: { readonly [K in StreamKey<C>]: StreamHandler<C, K> };
};

export interface RpcServer<C extends ContractShape> {
  emit<K extends EventKey<C>>(method: K, payload: EventPayload<C, K>): void;
  dispose(): void;
}

export function createRpcServer<C extends ContractShape>(
  channel: MessageChannelLike,
  handlers: ServerHandlers<C>,
  config: EndpointConfig,
): RpcServer<C> {
  const activeWork = new Map<number, AbortController>();
  const creditGates = new Map<number, CreditGate>();

  async function handleRequest(id: number, method: RequestKey<C>, params: unknown): Promise<void> {
    const controller = new AbortController();
    activeWork.set(id, controller);
    try {
      config.assertShape('request', method, params);
      const handler = handlers.requests[method];
      const result = await handler(params as never, { signal: controller.signal });
      if (activeWork.delete(id)) post<C>(channel, config, { t: 'res', id, ok: true, result });
    } catch (error) {
      if (activeWork.delete(id))
        post<C>(channel, config, { t: 'res', id, ok: false, error: toWireError(error) });
    }
  }

  async function handleOpen(id: number, method: StreamKey<C>, params: unknown): Promise<void> {
    const controller = new AbortController();
    activeWork.set(id, controller);
    const gate = new CreditGate();
    creditGates.set(id, gate);
    let seq = 0;

    async function emit(chunk: unknown): Promise<void> {
      if (controller.signal.aborted) return;
      await Promise.race([
        gate.acquire(),
        new Promise<void>((resolve) =>
          controller.signal.addEventListener('abort', () => resolve(), { once: true }),
        ),
      ]);
      if (controller.signal.aborted) return;
      post<C>(channel, config, { t: 'chunk', id, seq, chunk });
      seq++;
    }

    try {
      config.assertShape('stream', method, params);
      const handler = handlers.streams[method];
      await handler(params as never, { signal: controller.signal, emit: emit as never });
      if (activeWork.delete(id)) {
        creditGates.delete(id);
        post<C>(channel, config, { t: 'end', id });
      }
    } catch (error) {
      if (activeWork.delete(id)) {
        creditGates.delete(id);
        if (controller.signal.aborted) post<C>(channel, config, { t: 'end', id });
        else post<C>(channel, config, { t: 'end', id, error: toWireError(error) });
      }
    }
  }

  function handleFrame(frame: Frame<C>): void {
    switch (frame.t) {
      case 'req':
        void handleRequest(frame.id, frame.method, frame.params);
        return;
      case 'open':
        void handleOpen(frame.id, frame.method, frame.params);
        return;
      case 'credit':
        creditGates.get(frame.id)?.grant(frame.n);
        return;
      case 'cancel': {
        const controller = activeWork.get(frame.id);
        if (controller) {
          controller.abort();
          activeWork.delete(frame.id);
          creditGates.delete(frame.id);
        }
        return;
      }
      // "res", "evt", "chunk" and "end" are server -> client only.
      default:
        throw new TransportError(
          'contract-mismatch',
          `server received an unexpected frame '${frame.t}'`,
        );
    }
  }

  const unsubscribe = receive<C>(channel, config, handleFrame);

  return {
    emit<K extends EventKey<C>>(method: K, payload: EventPayload<C, K>): void {
      post<C>(channel, config, { t: 'evt', method, payload });
    },
    dispose(): void {
      unsubscribe();
      // Not by a timeout: a client that disappears without cancelling (a disposed webview)
      // is handled by aborting every controller this channel is still holding.
      for (const controller of activeWork.values()) controller.abort();
      activeWork.clear();
      creditGates.clear();
      channel.close();
    },
  };
}
