/**
 * The generic RPC client (`docs/plans/P3.md`, W2): request correlation, event dispatch, stream
 * credits and cancellation over a `MessageChannelLike`. The Go server on the other end of the
 * channel owns the server half of the protocol.
 */
import { decodeStreamPayload } from './codec.ts';
import type {
  EventKey,
  EventPayload,
  ParamsOf,
  RequestKey,
  ResultOf,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
} from './contract.ts';
import { type Transport, TransportError } from './transport.ts';
import {
  assertContractShape,
  unwrapVersioned,
  type VersionedEnvelope,
  wrapVersioned,
} from './validate.ts';

/** What a transport implements: post a message and be told about incoming ones. Correlation,
 *  credits and cancellation are `rpc.ts`'s job, not the channel's. */
export interface MessageChannelLike {
  post(message: unknown): void;
  onMessage(handler: (message: unknown) => void): () => void;
  close(): void;
}

/** An error that crossed the wire as data (§3.5): `code` and `message`. `code` is a
 *  `WireErrorCode` (contract.ts) from Go. A git failure's kind is folded into the code
 *  (`E_GIT_<KIND>`) by Go's `mapGitError`. Raw stderr never crosses. */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export class RpcError extends Error {
  readonly code: string;

  constructor(wire: WireError) {
    super(wire.message);
    this.name = 'RpcError';
    this.code = wire.code;
  }
}

// ---------------------------------------------------------------------------------------
// The frame union. Every member crosses the wire wrapped by `wrapVersioned`.
// ---------------------------------------------------------------------------------------

type Frame =
  | {
      readonly t: 'req';
      readonly id: number;
      readonly method: RequestKey;
      readonly params: unknown;
    }
  | { readonly t: 'res'; readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly t: 'res'; readonly id: number; readonly ok: false; readonly error: WireError }
  | { readonly t: 'evt'; readonly method: EventKey; readonly payload: unknown }
  | {
      readonly t: 'open';
      readonly id: number;
      readonly method: StreamKey;
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

function post(channel: MessageChannelLike, frame: Frame): void {
  channel.post(wrapVersioned(frame));
}

function receive(channel: MessageChannelLike, handleFrame: (frame: Frame) => void): () => void {
  return channel.onMessage((raw) => {
    handleFrame(unwrapVersioned(raw as VersionedEnvelope<Frame>));
  });
}

// ---------------------------------------------------------------------------------------
// createRpcClient — the UI side of the endpoint. Implements P0's `Transport`.
// ---------------------------------------------------------------------------------------

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: unknown) => void;
}

interface PendingStream {
  readonly method: StreamKey;
  readonly onChunk: (chunk: unknown) => void | Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  /** Chains chunk processing so out-of-order concurrent deliveries of `onMessage` (the
   *  transport may invoke it again before an `await onChunk(...)` above resolves) cannot call
   *  `onChunk` for two chunks concurrently — ordering is a contract callers rely on (W9). */
  queue: Promise<void>;
  done: boolean;
}

export interface RpcClientOptions {
  /** G32 round-3 performance review, finding #5: a client that only relays chunks onward (the
   *  extension host's `graph.stream` proxy, which never reads a field of the chunk) has no use
   *  for `decodeStreamPayload`'s FlatBuffer materialization — it immediately re-encodes the same
   *  bytes for its own downstream client. When true, `onChunk` receives the still-wire-shaped
   *  `frame.chunk` verbatim; the caller is responsible for treating it as opaque. Defaults to
   *  false so every other client (the webview) is unaffected. */
  readonly rawStreamChunks?: boolean;
}

export function createRpcClient(
  channel: MessageChannelLike,
  options?: RpcClientOptions,
): Transport {
  let nextId = 1;
  const pendingRequests = new Map<number, PendingRequest>();
  const pendingStreams = new Map<number, PendingStream>();
  const eventHandlers = new Map<EventKey, Set<(payload: unknown) => void>>();

  function finishStream(id: number): void {
    const entry = pendingStreams.get(id);
    if (!entry) return;
    entry.done = true;
    pendingStreams.delete(id);
  }

  function handleFrame(frame: Frame): void {
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
        assertContractShape('event', frame.method, frame.payload);
        for (const handler of eventHandlers.get(frame.method) ?? []) handler(frame.payload);
        return;
      }
      case 'chunk': {
        const entry = pendingStreams.get(frame.id);
        if (!entry || entry.done) return;
        // F2: this queued callback must never itself reject — a throwing `onChunk` or a bad
        // `decodeStreamPayload` would otherwise turn `entry.queue` into a rejected promise, and
        // every later `.then` chained onto it (including `end`'s own finish/resolve/reject) would
        // then be skipped per standard promise semantics, wedging the stream forever. Catch here,
        // settle the stream one way or the other, and tell the server to stop sending.
        entry.queue = entry.queue.then(async () => {
          if (entry.done) return;
          try {
            const payload = options?.rawStreamChunks
              ? frame.chunk
              : decodeStreamPayload(entry.method, frame.chunk);
            await entry.onChunk(payload);
            if (entry.done) return;
            post(channel, { t: 'credit', id: frame.id, n: 1 });
          } catch (error) {
            if (entry.done) return;
            finishStream(frame.id);
            post(channel, { t: 'cancel', id: frame.id });
            entry.reject(error);
          }
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

  const unsubscribe = receive(channel, handleFrame);

  return {
    request<K extends RequestKey>(
      method: K,
      params: ParamsOf<K>,
      signal?: AbortSignal,
    ): Promise<ResultOf<K>> {
      if (signal?.aborted) {
        return Promise.reject(
          new TransportError('cancelled', `request '${method}' was already cancelled`),
        );
      }
      const id = nextId++;
      return new Promise<ResultOf<K>>((resolve, reject) => {
        pendingRequests.set(id, { resolve: resolve as (result: unknown) => void, reject });
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              if (!pendingRequests.has(id)) return;
              pendingRequests.delete(id);
              post(channel, { t: 'cancel', id });
              reject(new TransportError('cancelled', `request '${method}' was cancelled`));
            },
            { once: true },
          );
        }
        post(channel, { t: 'req', id, method, params });
      });
    },

    on<K extends EventKey>(method: K, handler: (payload: EventPayload<K>) => void): () => void {
      let set = eventHandlers.get(method);
      if (!set) {
        set = new Set();
        eventHandlers.set(method, set);
      }
      const wrapped = handler as (payload: unknown) => void;
      set.add(wrapped);
      return () => set.delete(wrapped);
    },

    stream<K extends StreamKey>(
      method: K,
      params: StreamParamsOf<K>,
      onChunk: (chunk: StreamChunkOf<K>) => void,
      signal?: AbortSignal,
    ): Promise<void> {
      // Concurrent streams of one method are independent; supersession belongs to the caller
      // (its own AbortSignal), never to the transport shared by unrelated views.
      if (signal?.aborted) {
        return Promise.reject(
          new TransportError('cancelled', `stream '${method}' was already cancelled`),
        );
      }

      const id = nextId++;
      return new Promise<void>((resolve, reject) => {
        const entry: PendingStream = {
          method,
          onChunk: onChunk as (chunk: unknown) => void | Promise<void>,
          resolve,
          reject,
          queue: Promise.resolve(),
          done: false,
        };
        pendingStreams.set(id, entry);

        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              if (entry.done) return;
              finishStream(id);
              post(channel, { t: 'cancel', id });
              resolve();
            },
            { once: true },
          );
        }

        post(channel, { t: 'open', id, method, params });
        post(channel, { t: 'credit', id, n: INITIAL_STREAM_CREDIT });
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
      eventHandlers.clear();
      channel.close();
    },
  };
}
