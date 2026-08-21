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
import type { ConnectInfo, ResolvedConnectionConfig } from '../../shared/engine-ops';
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
//   P2   read(req, ctx) -> Page          (Page = TabularPage | DocumentPage | KeyValuePage | StreamPage)
//   P2   count(req, ctx) -> { value, exact }
//   P4   ddl(path, ctx) -> SourceText    (caps.ddl)
//   P5   preview(plan) -> string[]       (caps.writable, synchronous)
//   P5   mutate(plan, ctx) -> MutationResult (caps.writable)
//   P5.5 execute(req, ctx) -> Page[]     (caps.sql)
// Do not add them early.
