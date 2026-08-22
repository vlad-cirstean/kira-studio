// The driver adapter contract. Rules that hold for every adapter, present and future:
//
// 1. An adapter imports nothing from `electron` — it is a plain Node module. This is what makes
//    tests/db able to import it directly and what would let a connection move to its own process.
// 2. Every method that talks to the server takes an OpCtx and honours ctx.signal. Ignoring the
//    signal is a bug even if the driver "is fast".
// 3. ctx.setCommand() is called before the statement is issued, not after it returns — an op
//    cancelled mid-flight must still show what it was running.
// 4. Errors are thrown as AdapterError with a closed-set code and the server's own message
//    verbatim (see errors.ts).
// 5. children() returns [] for a leaf, never throws. hasChildren on the parent is the adapter's
//    promise; a wrong value shows a twisty that expands to nothing.
// 6. An adapter is single-connection: one instance ↔ one connections row. The registry in
//    engine/control.ts owns the Map<connectionId, Adapter>.

import type { Caps } from '../../shared/caps';
import type { ConnectionKind } from '../../shared/connection';
import type { CountRequest, ReadRequest } from '../../shared/data';
import type { ConnectInfo, ResolvedConnectionConfig } from '../../shared/engine-ops';
import type { Page } from '../../shared/page';
import type { SourceText } from '../../shared/ddl';
import type { NodePath, ObjectMeta, TreeNode } from '../../shared/tree';

export interface Progress {
  message?: string;
  done?: number;
  total?: number;
}

export interface OpCtx {
  readonly opId: string;
  readonly signal: AbortSignal;
  /** The exact statement about to run. Lands in op_log.command and §8.11's command column (D20). */
  setCommand(text: string): void;
  onProgress?(p: Progress): void;
}

export interface Adapter {
  readonly kind: ConnectionKind;
  readonly caps: Caps;

  connect(cfg: ResolvedConnectionConfig, ctx: OpCtx): Promise<ConnectInfo>;
  disconnect(): Promise<void>;

  /** One lazy tree level. `path.segments` is empty for the connection root. */
  children(path: NodePath, ctx: OpCtx): Promise<TreeNode[]>;

  /** Columns, PK, FK, inbound FK, indexes for one object. Feeds the L1 cache. */
  describe(path: NodePath, ctx: OpCtx): Promise<ObjectMeta>;

  /** DDL for one object. Reconstructed (pg tables) or exact (views/functions, MariaDB) per D5. */
  ddl(path: NodePath, ctx: OpCtx): Promise<SourceText>;

  /** One page of table/view data (P2 D6). The cursor is dual: keyset on PK, else offset. */
  read(req: ReadRequest, ctx: OpCtx): Promise<Page>;

  /** Exact or estimated row count (P2 D8). Estimate is only offered with no filter. */
  count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }>;

  /**
   * Quote one identifier for this dialect (D12). The ONLY valid source of the argument is cached
   * catalog metadata (a decoded NodePath segment or a describe() column name) — never user
   * free-text. Postgres doubles `"`, MariaDB doubles `` ` ``; both reject `\0`.
   */
  quoteIdent(name: string): string;

  /**
   * Forward a cancel for an in-flight op to the server (D5). Returns false when the op was unknown
   * or the server refused; never throws for "already finished". Adapters with caps.cancel === false
   * return false unconditionally.
   */
  cancel(opId: string): Promise<boolean>;
}

export type AdapterFactory = (deps: AdapterDeps) => Adapter;

export interface AdapterDeps {
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

// Adapter roadmap (normative, D3). Each later phase adds exactly these members:
//   P4   ddl(path, ctx) -> SourceText    (caps.ddl) — implemented
//   P5   preview(plan) -> string[]       (caps.writable, synchronous)
//   P5   mutate(plan, ctx) -> MutationResult (caps.writable)
//   P5.5 execute(req, ctx) -> Page[]     (caps.sql)
// read/count/quoteIdent landed in P2 — do not change them now.
