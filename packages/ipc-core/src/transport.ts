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
 * The one interface a host implements, generic over the contract it is host to. A module's own
 * host (a `Transport` over its bound service and its own stream) and a harness's mock bridge both
 * satisfy it — mirrored on the Go side by `rpcstream`'s `Conn`/`Handlers` split. A UI's bridge
 * client depends only on this interface, never on a concrete transport — which is what lets the
 * UI bundle mount with no host present at all.
 */
export interface Transport<C extends ContractShape> {
  request<K extends RequestKey<C>>(
    method: K,
    params: ParamsOf<C, K>,
    signal?: AbortSignal,
  ): Promise<ResultOf<C, K>>;

  on<K extends EventKey<C>>(method: K, handler: (payload: EventPayload<C, K>) => void): () => void;

  stream<K extends StreamKey<C>>(
    method: K,
    params: StreamParamsOf<C, K>,
    onChunk: (chunk: StreamChunkOf<C, K>) => void,
    signal?: AbortSignal,
  ): Promise<void>;

  dispose(): void;
}
