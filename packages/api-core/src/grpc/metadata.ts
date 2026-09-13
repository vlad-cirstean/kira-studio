// P18 D12 (P15b #7's gRPC sibling): a metadata-name vocabulary for GrpcRequestView's Metadata
// table, in WELL_KNOWN_REQUEST_HEADERS' own shape (http/headers.ts) — a structural
// HeaderCompletion, no app import, so it slots into MetadataTable.vue's AutocompleteField exactly
// like the HTTP header list does.

import type { HeaderCompletion } from '../http/headers';

function metadataKey(label: string, detail: string): HeaderCompletion {
  // icon: 'symbol-field' matches WELL_KNOWN_REQUEST_HEADERS' own choice — a metadata key is the
  // same "field" shape a column-name completion already draws this icon for.
  return { label, detail, icon: 'symbol-field' };
}

/** gRPC request metadata keys a person actually types — genuinely different from
 *  WELL_KNOWN_REQUEST_HEADERS, not a re-export of it: gRPC metadata keys are lowercase by wire
 *  rule (MetadataTable.vue's own placeholder already says so), and the two vocabularies barely
 *  overlap. Deliberately excludes the HTTP/2 pseudo-headers (`:authority`, `:path`, `:method`,
 *  `:scheme`) and `te`/`content-type`, which the client sets itself and a user must not type, and
 *  `grpc-status`/`grpc-message`, which are trailer-only — the same "this feeds the *request*
 *  table, never a response viewer" rule WELL_KNOWN_REQUEST_HEADERS states for `Set-Cookie` and
 *  friends. */
export const WELL_KNOWN_REQUEST_METADATA: readonly HeaderCompletion[] = [
  // auth
  metadataKey('authorization', 'auth'),
  metadataKey('x-api-key', 'auth'),
  metadataKey('cookie', 'auth'),

  // call
  metadataKey('grpc-timeout', 'call'),
  metadataKey('grpc-encoding', 'call'),
  metadataKey('grpc-accept-encoding', 'call'),
  metadataKey('grpc-message-type', 'call'),

  // tracing
  metadataKey('x-request-id', 'tracing'),
  metadataKey('traceparent', 'tracing'),
  metadataKey('tracestate', 'tracing'),
  metadataKey('user-agent', 'tracing'),
] as const;
