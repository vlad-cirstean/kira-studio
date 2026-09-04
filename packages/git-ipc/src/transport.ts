import type {
  EventKey,
  EventPayload,
  ParamsOf,
  RequestKey,
  ResultOf,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
} from './contract';

export type TransportErrorCode =
  | 'cancelled'
  | 'contract-mismatch'
  | 'transport-closed'
  | 'handler-error';

export class TransportError extends Error {
  readonly code: TransportErrorCode;

  constructor(code: TransportErrorCode, message: string) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
  }
}

/**
 * The one interface a host implements. Kira Studio's host (a `Transport` over the bound
 * `bridge.GitService` and its Wails stream) and the harness's mock bridge both satisfy it, as the
 * source project's VS Code `postMessage` host did. `git-ui`'s bridge client depends only on this
 * interface, never on a concrete transport — which is what lets the UI bundle mount with no host
 * present at all.
 */
export interface Transport {
  request<K extends RequestKey>(
    method: K,
    params: ParamsOf<K>,
    signal?: AbortSignal,
  ): Promise<ResultOf<K>>;

  on<K extends EventKey>(method: K, handler: (payload: EventPayload<K>) => void): () => void;

  stream<K extends StreamKey>(
    method: K,
    params: StreamParamsOf<K>,
    onChunk: (chunk: StreamChunkOf<K>) => void,
    signal?: AbortSignal,
  ): Promise<void>;

  dispose(): void;
}
