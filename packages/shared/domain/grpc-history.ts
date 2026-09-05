// P11 D11: the TypeScript mirrors of Go's model.GrpcCallHistoryEntry/GrpcCallSnapshot — following
// response-history.ts's own precedent exactly (P2 D5's rule: types, not guards; control.ts
// `trust<T>()`s them like every other bound result). Nothing here becomes tab state (a call's
// result is runtime-only), so neither earns a Zod-parse boundary.
import type { GrpcMessageWire, GrpcMetaPairWire } from './grpc';

// P18 D4: mirrors repos/grpc_history.go's own grpcHistoryPerScopeCap, pinned equal by
// tests/unit/go-ts-vocabulary-parity.spec.ts.
export const GRPC_HISTORY_PER_SCOPE_LIMIT = 30;

// The list row — no message content, ever (D11's List projection never selects snapshot_json).
export interface GrpcCallHistoryEntry {
  id: string;
  itemId: string | null;
  tabId: string;
  calledAt: string;
  target: string;
  method: string;
  streaming: 'unary' | 'server';
  environment: string;
  code: number;
  codeName: string;
  statusMessage: string;
  elapsedMs: number;
  messageCount: number;
  messageBytes: number;
  storedBytes: number;
}

/** One stored message — D11's own per-message truncation flag. */
export interface GrpcCallHistoryMessage extends GrpcMessageWire {
  truncated: boolean;
}

// One entry's full snapshot (D11).
export interface GrpcCallSnapshot {
  entry: GrpcCallHistoryEntry;
  // Stage 1: {{name}} substituted for a non-secret only, a secret still spelled {{name}} — never
  // the resolved (secret-bearing) call.
  target: string;
  method: string;
  streaming: 'unary' | 'server';
  message: string;
  // P18 D7: the request message was stored truncated at the 256 KiB per-entry cap — mirrors
  // ResponseHistorySnapshot's own requestBodyStorageTruncated.
  requestMessageTruncated: boolean;
  metadata: GrpcMetaPairWire[];
  messages: GrpcCallHistoryMessage[];
  // D11's own "showing the first 100 of N" flag — the true count is entry.messageCount.
  messagesElided: boolean;
  header: GrpcMetaPairWire[];
  trailer: GrpcMetaPairWire[];
}
