/**
 * The shape every module's contract satisfies — the type algebra `rpc.ts`/`transport.ts` are
 * written directly against, generic over `C` rather than over one module's `Contract`. A module's
 * own contract (e.g. `@kira/git-ipc`'s `Contract`) needs no edit to satisfy this: it already is a
 * map of `{params, result}` requests, event payloads, and `{params, chunk}` streams.
 */
export interface ContractShape {
  readonly requests: Record<string, { readonly params: unknown; readonly result: unknown }>;
  readonly events: Record<string, unknown>;
  readonly streams: Record<string, { readonly params: unknown; readonly chunk: unknown }>;
}

export type RequestKey<C extends ContractShape> = keyof C['requests'] & string;
export type EventKey<C extends ContractShape> = keyof C['events'] & string;
export type StreamKey<C extends ContractShape> = keyof C['streams'] & string;
export type ParamsOf<C extends ContractShape, K extends RequestKey<C>> = C['requests'][K]['params'];
export type ResultOf<C extends ContractShape, K extends RequestKey<C>> = C['requests'][K]['result'];
export type EventPayload<C extends ContractShape, K extends EventKey<C>> = C['events'][K];
export type StreamParamsOf<
  C extends ContractShape,
  K extends StreamKey<C>,
> = C['streams'][K]['params'];
export type StreamChunkOf<
  C extends ContractShape,
  K extends StreamKey<C>,
> = C['streams'][K]['chunk'];
