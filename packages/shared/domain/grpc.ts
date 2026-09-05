import { z } from 'zod';

// P11 D5: the wire shapes live in Go (internal/grpcclient) and are mirrored, not re-validated,
// here — control.ts's grpcDescribe/grpcCall trust<T>() the bound call's result exactly as every
// other bound call does (P2 D5's rule, applied a fourth time). These types exist so the renderer
// has something to type against, not to guard input Go already produced.

/** internal/grpcclient.MetaPair — one gRPC metadata name/value pair. F6: keys are lowercased by
 *  the time this reaches the renderer. */
export interface GrpcMetaPairWire {
  name: string;
  value: string;
}

/** internal/grpcclient.Method — one method the schema browser lists. */
export interface GrpcMethodWire {
  name: string;
  fullName: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  inputType: string;
  outputType: string;
  /** The empty-instance JSON of the input message (EmitUnpopulated + Multiline) — the "fill this
   *  in" template the message editor seeds with (D4). */
  requestTemplate: string;
}

/** internal/grpcclient.Service — one service the schema browser lists. */
export interface GrpcServiceWire {
  name: string;
  methods: GrpcMethodWire[];
}

/** internal/grpcclient.Schema — GrpcService.Describe's whole answer (D4). */
export interface GrpcSchemaWire {
  services: GrpcServiceWire[];
  mode: string;
  warnings: string[];
}

/** internal/grpcclient.Message — one message of a call, arrival offset and wire size included
 *  (F5, F7). */
export interface GrpcMessageWire {
  seq: number;
  json: string;
  wireBytes: number;
  offsetMs: number;
}

/** internal/grpcclient.CallResult — D16: a non-OK gRPC status lives here, not in a thrown error.
 *  `messages` carries every message a call produced: exactly one for a unary call, N for a
 *  streaming one (which also pushes each one over ChannelGrpcCall as it arrives, D8). */
export interface GrpcCallResultWire {
  code: number;
  codeName: string;
  statusMessage: string;
  elapsedMs: number;
  header: GrpcMetaPairWire[];
  trailer: GrpcMetaPairWire[];
  messageCount: number;
  messageBytes: number;
  messages?: GrpcMessageWire[];
}

/** D8: one batch of a server-streaming call's messages, pushed over ChannelGrpcCall. `seq` is the
 *  index of the first message in the batch, so the renderer appends by index and a future
 *  reviewer can detect a gap. `done`/`status` are set only on the terminal event. */
export interface GrpcCallEvent {
  callId: string;
  seq: number;
  messages: GrpcMessageWire[];
  done: boolean;
  status?: GrpcCallResultWire;
  /** Set only on a terminal event that ended in something other than a clean stream end — e.g.
   *  Stop (F8) — so the renderer can render D17's own sentence without re-deriving it. */
  error?: { code: string; message: string };
}

// codes.Code.String() (grpc-go), verbatim — GRPC_CODE_NAMES is the renderer's own copy so a
// status chip never has to wait on a round trip to learn a code's name (Go already sends
// CallResult.codeName, but the History pane and a partial/failure path both want a name from a
// bare integer code too).
export const GRPC_CODE_NAMES: Readonly<Record<number, string>> = {
  0: 'OK',
  1: 'Canceled',
  2: 'Unknown',
  3: 'InvalidArgument',
  4: 'DeadlineExceeded',
  5: 'NotFound',
  6: 'AlreadyExists',
  7: 'PermissionDenied',
  8: 'ResourceExhausted',
  9: 'FailedPrecondition',
  10: 'Aborted',
  11: 'OutOfRange',
  12: 'Unimplemented',
  13: 'Internal',
  14: 'Unavailable',
  15: 'DataLoss',
  16: 'Unauthenticated',
};

/** D14: the status chip's colour — OK is 'ok', a handful of "try again"-shaped codes are 'warn',
 *  everything else (including Canceled, which the app itself only ever produces via Stop) is
 *  'err'. Mirrors statusClass's own four-value vocabulary (domain/http.ts) over .p-chip's existing
 *  ok/warn/err/info variants (P2 F17) — no new colour token (F23). */
export function grpcCodeClass(code: number): 'info' | 'ok' | 'warn' | 'err' {
  if (code === 0) return 'ok';
  if (code === 4 || code === 8 || code === 14) return 'warn'; // DeadlineExceeded/ResourceExhausted/Unavailable
  return 'err';
}

/** P4 D16's exact reason, applied to gRPC (D12): the collections tree's own row needs a class for
 *  its leading chip and http/** may not import views/** (biome.json), so this lives here rather
 *  than in views/grpcrequest/. The tree's own denormalised columns (method/url, reused verbatim
 *  for a gRPC row's "pkg.Service/Method" and target) carry no streaming flag — that lives in the
 *  method's own descriptor, which a collections row cannot resolve without a live call — so every
 *  gRPC row gets the one neutral class from the status family (P17 D19 retired `httpMethodClass`
 *  in favour of `httpMethodToken`'s own seven-plus-'other' vocabulary for HTTP methods
 *  specifically; a gRPC call has no per-verb distinction to colour-code at all, so this stays on
 *  the plain status palette rather than adopting that new one). */
export function grpcMethodClass(_method: string): 'info' | 'ok' | 'warn' | 'err' {
  return 'info';
}

/** D5: {name, value, enabled} — deliberately the same three fields as httpHeaderSchema
 *  (domain/http.ts) with the same "enabled is builder-state-only" rule (P2 D6), because it is the
 *  same idea and a person moving between the two tabs should not have to learn a second one. Not
 *  the same *type*: gRPC lowercases keys (F6) and has its own validity rule (call.go's own
 *  metadataKeyPattern), and sharing the Zod object across two protocols to save four lines is the
 *  coupling P12 would then have to unpick. */
export const grpcMetadataSchema = /*#__PURE__*/ z.object({
  name: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true),
});
export type GrpcMetadataState = z.infer<typeof grpcMetadataSchema>;

export const grpcTlsModeSchema = /*#__PURE__*/ z.enum(['plaintext', 'tls']);
export type GrpcTlsMode = z.infer<typeof grpcTlsModeSchema>;

export const grpcDescriptorModeSchema = /*#__PURE__*/ z.enum(['reflection', 'proto']);
export type GrpcDescriptorMode = z.infer<typeof grpcDescriptorModeSchema>;

export const grpcRequestPaneSchema = /*#__PURE__*/ z.enum(['message', 'metadata', 'schema']);
export type GrpcRequestPane = z.infer<typeof grpcRequestPaneSchema>;

export const grpcResponsePaneSchema = /*#__PURE__*/ z.enum(['messages', 'metadata', 'history']);
export type GrpcResponsePane = z.infer<typeof grpcResponsePaneSchema>;

// D5: every field .default()ed, flat rather than nested, so a tab saved by an earlier build
// restores through TabKindDef.parseState's merge-only normalisation (following
// httpRequestTabStateSchema's own discipline exactly).
export const grpcRequestTabStateSchema = /*#__PURE__*/ z.object({
  target: z.string().default(''),
  tlsMode: grpcTlsModeSchema.default('tls'),
  caFile: z.string().default(''), // a path, never bytes
  serverName: z.string().default(''), // TLS SNI / authority override
  descriptorMode: grpcDescriptorModeSchema.default('reflection'),
  protoPath: z.string().default(''),
  importPaths: /*#__PURE__*/ z.array(z.string()).default([]),
  service: z.string().default(''), // fully-qualified
  method: z.string().default(''), // method name within the service
  message: z.string().default(''), // the request JSON the user authored
  metadata: /*#__PURE__*/ z.array(grpcMetadataSchema).default([]),
  itemId: z.string().nullable().default(null),
  name: z.string().default(''),
  requestPane: grpcRequestPaneSchema.default('message'),
  responsePane: grpcResponsePaneSchema.default('messages'),
  requestPaneHeight: z.number().int().min(0).default(0),
});
export type GrpcRequestTabState = z.infer<typeof grpcRequestTabStateSchema>;

export function defaultGrpcRequestTabState(): GrpcRequestTabState {
  return grpcRequestTabStateSchema.parse({});
}

/** D2: the saved name, else Service/Method, else the target, else 'New gRPC request' — mirrors
 *  httpRequestTitle's own precedence (views/httprequest/url.ts). */
export function grpcRequestTitle(state: {
  name: string;
  service: string;
  method: string;
  target: string;
}): string {
  if (state.name) return state.name;
  if (state.service && state.method) return `${state.service}/${state.method}`;
  if (state.target) return state.target;
  return 'New gRPC request';
}

/** D12: the streaming-kind chip's own two values, mirrored from grpc_call_history.streaming
 *  (Go: model.GrpcStreamingUnary/GrpcStreamingServer). */
export const GRPC_STREAMING_KINDS = ['unary', 'server'] as const;
export type GrpcStreamingKind = (typeof GRPC_STREAMING_KINDS)[number];

export function grpcStreamingLabel(kind: GrpcStreamingKind): string {
  return kind === 'server' ? 'STREAM' : 'UNARY';
}
