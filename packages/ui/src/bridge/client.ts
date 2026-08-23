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
} from "@kira-version/ipc";
import { shallowRef } from "vue";

export type ConnectionState = "connecting" | "connected" | "error";

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
  readonly connectionState = shallowRef<ConnectionState>("connecting");

  readonly #transport: Transport;
  #initPromise: Promise<ResultOf<"app.init">> | undefined;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /** Performs the `app.init` handshake exactly once, however many callers ask for it — every
   *  `state/` module that needs the initial snapshot awaits the same promise. */
  init(): Promise<ResultOf<"app.init">> {
    if (!this.#initPromise) {
      this.#initPromise = this.#transport.request("app.init", {}).then(
        (result) => {
          this.connectionState.value = "connected";
          return result;
        },
        (error: unknown) => {
          this.connectionState.value = "error";
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
    this.connectionState.value = "connecting";
    this.#transport.dispose();
  }
}
