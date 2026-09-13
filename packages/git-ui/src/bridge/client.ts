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
import { type ShallowRef, shallowRef } from 'vue';

export type ConnectionState = 'connecting' | 'connected' | 'error';

/** G-UX (item 13): the wire's own narrowed shape (`@kira/git-ipc`'s `connection.changed` event) —
 *  distinct from `ConnectionState` above, which is this class's own cold-boot `app.init`
 *  success/failure signal, not the host's live socket state. */
export type HostConnectionState = EventPayload<'connection.changed'>['state'];

/**
 * The real typed client (P3 W9) over the `Transport` W2 provides: `request`/`on`/`stream`
 * forward directly (both already fully typed by the contract), plus the one thing every host
 * needs and no host should reimplement — the `app.init` handshake that turns "a channel
 * exists" into "connectionState is actually connected", carrying the settings/git snapshot
 * every other `state/` module bootstraps from.
 *
 * Keeps the reactive surface small on purpose (§5.3): only `connectionState` is a Vue ref.
 * Commit data never becomes reactive here or anywhere downstream of it.
 */
export class BridgeClient {
  readonly connectionState = shallowRef<ConnectionState>('connecting');
  /** G-UX (item 13): the live "is the host's own socket to Kira Studio up" signal — kept
   *  separately from `connectionState` above rather than folded into it, since that field already
   *  has its own well-established, narrower meaning three other things key off (`app.init` cold-
   *  boot success/failure) and this needs a fourth state (`pairing`) that concept never had.
   *  `undefined` means "never told" — no bootstrap seed (a fresh, e2e-style mount with no host
   *  behind it at all) and no `connection.changed` event has arrived yet — and a banner reading
   *  this should render nothing for that value, the same "no data yet, not an error" convention
   *  `detail.value === undefined` already uses elsewhere in this codebase. Seeded once, at
   *  construction, from the host's own cold-boot bootstrap island (`main.ts`'s own
   *  `MountOptions.connectionState`) — a panel opened while already disconnected must show the
   *  banner immediately, not only on the next live push — then kept current by the event below for
   *  the rest of this webview's life. */
  readonly hostConnection: ShallowRef<HostConnectionState | undefined>;

  readonly #transport: Transport;
  #initPromise: Promise<ResultOf<'app.init'>> | undefined;

  constructor(transport: Transport, initialHostConnection?: HostConnectionState) {
    this.#transport = transport;
    this.hostConnection = shallowRef(initialHostConnection);
    this.#transport.on('connection.changed', (payload) => {
      this.hostConnection.value = payload.state;
    });
  }

  /** Performs the `app.init` handshake exactly once *per success*, however many callers ask for
   *  it — every `state/` module that needs the initial snapshot awaits the same promise. A
   *  rejection clears the memo before rethrowing (G12 D6) so a later call genuinely retries
   *  rather than replaying the same failure forever — the property a webview opened before Kira
   *  Studio's socket is up depends on (F7). */
  init(): Promise<ResultOf<'app.init'>> {
    if (!this.#initPromise) {
      this.#initPromise = this.#transport.request('app.init', {}).then(
        (result) => {
          this.connectionState.value = 'connected';
          return result;
        },
        (error: unknown) => {
          this.connectionState.value = 'error';
          this.#initPromise = undefined;
          throw error;
        },
      );
    }
    return this.#initPromise;
  }

  request<K extends RequestKey>(
    method: K,
    params: ParamsOf<K>,
    signal?: AbortSignal,
  ): Promise<ResultOf<K>> {
    return this.#transport.request(method, params, signal);
  }

  on<K extends EventKey>(method: K, handler: (payload: EventPayload<K>) => void): () => void {
    return this.#transport.on(method, handler);
  }

  stream<K extends StreamKey>(
    method: K,
    params: StreamParamsOf<K>,
    onChunk: (chunk: StreamChunkOf<K>) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.#transport.stream(method, params, onChunk, signal);
  }

  dispose(): void {
    this.connectionState.value = 'connecting';
    this.#transport.dispose();
  }
}
