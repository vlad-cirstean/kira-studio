// P8 D9: the TypeScript mirrors of Go's model.ResponseHistoryEntry/ResponseHistorySnapshot.
// Following P2 D5's rule — "the wire shapes live in Go and are mirrored, not re-validated" — these
// are types, not guards; control.ts `trust<T>()`s them like every other bound result. Nothing here
// becomes tab state (the response is runtime-only, P2 D6), so neither earns a Zod-parse boundary.
import type { HttpBodyWire, HttpHeaderWire, HttpResponseWire } from './http';

// P18 D4: mirrors repos/response_history.go's own historyPerScopeLimit, pinned equal by
// tests/unit/go-ts-vocabulary-parity.spec.ts. The one place a renderer needs the cap's value —
// "the list is full" is `entries.length >= HISTORY_PER_SCOPE_LIMIT`, not a second hand-written 30.
export const HISTORY_PER_SCOPE_LIMIT = 30;

// The list row — no body, ever (D4's List projection never selects snapshot_json).
export interface ResponseHistoryEntry {
  id: string;
  itemId: string | null;
  tabId: string;
  sentAt: string;
  method: string;
  url: string;
  environment: string;
  status: number;
  statusText: string;
  elapsedMs: number;
  bodyBytes: number;
  storedBytes: number;
}

// One entry's full snapshot (D9). `response` is the unmodified P2 HttpResponseWire shape — that
// identity is what makes ResponsePane.vue's source swap (D10) a one-line change: the three storage
// flags sit beside it in the envelope, never inside it.
export interface ResponseHistorySnapshot {
  entry: ResponseHistoryEntry;
  // Stage 1 (D2/F3): {{$dynamic}} and non-secret {{name}} substituted, a secret still spelled
  // {{name}} — never the resolved (secret-bearing) request.
  request: {
    method: string;
    url: string;
    headers: HttpHeaderWire[];
    body: HttpBodyWire;
  };
  response: HttpResponseWire;
  // D5 rule 2: false for a binary response body — the metadata is kept, the bytes are not.
  bodyStored: boolean;
  // D5 rule 1: the response body was stored truncated at the per-entry cap. NOT the same boolean
  // as response.bodyTruncated (F9) — that one is about the transfer, this one is about storage.
  bodyStorageTruncated: boolean;
  requestBodyStorageTruncated: boolean;
}
