import type { ColumnDescriptor, PagePosition } from '@shared/protocol/page';

/**
 * One control-channel snapshot: the args that produce it, and the response, verbatim (P50 §2.2).
 * `response` is both the backend half's assertion target and the frontend half's canned answer —
 * that is the vital rule, and it is enforced by both halves importing the same fixture module.
 */
export interface ControlSnapshot<T = unknown> {
  /** A value from tests/ui/support/ipcChannels.ts's IPC map (P2 R1: relocated there from
   *  shared/protocol/ipc.ts, which nothing under apps/kira-studio/frontend/src had imported since the P57/P58
   *  Electron/Node-engine cutover — this tier's own fixture-key namespace, not a live app protocol). */
  channel: string;
  /** Exactly what the renderer sends — used by the frontend half to match a request to a
   *  snapshot when a channel has more than one (e.g. treeChildren for different paths); a
   *  channel with exactly one snapshot answers regardless of its args (connectionsList,
   *  opsCancel). Optional because JSON.stringify drops an `undefined`-valued key entirely, so a
   *  channel captured with no args at all has no `args` key in the committed fixture. */
  args?: unknown;
  /** Optional for the same reason `args` is — a channel that resolves `void` (e.g. `opsCancel`)
   *  captures `response: undefined`, which JSON.stringify drops from the committed fixture. */
  response?: T;
  /** tests/ui/-only (P57): when set, `mockRuntime.ts` answers this snapshot as a failed bound
   *  call instead of a 200 — `control.ts`'s `unwrap` reads `.cause.code`/`.cause.message` off the
   *  thrown error, so this is the shape a real business-rule rejection (not a schema-validation
   *  one, which never reaches the wire) takes. Mutually exclusive with `response` — a snapshot
   *  answers as one or the other, never both. No `tests/ipc/**` fixture sets this; the backend
   *  capture/replay half has no concept of it. `details` is P10 D15's own addition — ipcerr.Error's
   *  optional `json.RawMessage` field, so far only ever set by HttpService.Send's own failed-send
   *  timeline; every other seeded error leaves it unset. */
  error?: { code: string; message: string; details?: unknown };
}

/** One bulk-data snapshot. `payload` matches a PortRequest's own payload; `response` is logical,
 *  never the encoded typed-array page — see LogicalPage below (P50 D6). */
export interface PortSnapshot {
  /** A value from shared/protocol/data-ops.ts's DATA_OP map. */
  op: string;
  payload: unknown;
  response?: LogicalPortResponse;
  /** tests/ui/-only (P57), mirrors ControlSnapshot.error above: a failed bulk-data op (e.g. a
   *  mutate that violates a constraint) — port.ts's handleMessage rejects with `.message`/`.code`
   *  read straight off this. Mutually exclusive with `response`. No `tests/ipc/**` fixture sets
   *  this. */
  error?: { code: string; message: string };
  /** Frontend-only: delays the mocked reply, so a spec can observe a request as still in flight
   *  (e.g. the stop button's enabled state, P50 §4.2 scenario 7) without a real slow query. Never
   *  read by the backend half. */
  delayMs?: number;
}

export type LogicalPortResponse =
  | { kind: 'read'; page: LogicalPage; source: 'cache' | 'server' }
  | {
      kind: 'count';
      value: number;
      exact: boolean;
      stale: boolean;
      source: 'cache' | 'server';
    }
  | { kind: 'mutate'; affectedRows: number }
  | { kind: 'preview'; statements: string[] }
  | { kind: 'execute'; pages: LogicalPage[] }
  | { kind: 'invalidate' };

interface LogicalPageBase {
  position: PagePosition;
}

export interface LogicalTabularPage extends LogicalPageBase {
  kind: 'tabular';
  columns: ColumnDescriptor[];
  rows: (string | null)[][];
  truncatedCells: number;
  /** tests/ui/-only (P57): per-column row indices whose value came back truncated — the logical
   *  counterpart of page.ts's `TextColumnChunk.truncated` bitset (read via `isTruncated`), which
   *  `decodePage()` does not surface (nothing needed it before cell-editor.spec.ts's port).
   *  Optional and index-aligned with `columns`; absent (every page literal that predates this
   *  field) means "nothing in this page is truncated," so an old fixture still decodes the same
   *  as before. */
  truncatedRows?: number[][];
}

export interface LogicalDocumentPage extends LogicalPageBase {
  kind: 'document';
  ids: (string | null)[];
  bodies: (string | null)[];
}

export interface LogicalKeyValuePage extends LogicalPageBase {
  kind: 'keyvalue';
  redisType: 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'object';
  ttlMs: number | null;
  memoryBytes: number | null;
  fields: (string | null)[];
  values: (string | null)[];
}

export interface LogicalStreamPage extends LogicalPageBase {
  kind: 'stream';
  keys: (string | null)[];
  headers: (string | null)[];
  attrs: (string | null)[];
  timestamps: (string | null)[];
  bodies: (string | null)[];
  visibilityTimeoutSeconds: number | null;
}

export type LogicalPage =
  | LogicalTabularPage
  | LogicalDocumentPage
  | LogicalKeyValuePage
  | LogicalStreamPage;
