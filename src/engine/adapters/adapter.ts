import type { Caps } from '../../shared/caps';
import type { ConnectionKind } from '../../shared/domain/connection';
import type { ConsoleRequest } from '../../shared/domain/console';
import type { SourceText } from '../../shared/domain/ddl';
import type { MutationPlan, MutationResult } from '../../shared/domain/mutations';
import type { NodePath, ObjectMeta, TreeNode } from '../../shared/domain/tree';
import type { PageCursor, SortSpec } from '../../shared/protocol/data-ops';
import type { ResolvedConnectionConfig } from '../../shared/protocol/engine-ops';
import type { Page } from '../../shared/protocol/page';

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

export interface ConnectInfo {
  serverVersion: string;
  /** Free-form, engine-specific, shown in the connection tooltip. */
  details?: Record<string, string>;
}

/**
 * Rules that hold for every adapter, present and future:
 *
 * 1. An adapter imports nothing from `electron`. It is a plain Node module — this is what
 *    makes `tests/db/` able to import it directly and what would let a connection move to
 *    its own process later (§4).
 * 2. Every method that talks to the server takes an `OpCtx` and honours `ctx.signal`. A
 *    method that ignores the signal is a bug even if the underlying driver "is fast".
 * 3. `ctx.setCommand()` is called before the statement is issued, not after it returns — an
 *    op that is cancelled mid-flight must still show what it was running.
 * 4. Errors are thrown as `AdapterError` (`./errors.ts`) with a code from a closed set and
 *    the server's own message verbatim in `message`. §8.5 and §8.14 both require unmodified
 *    server errors; wrapping starts there.
 * 5. `children()` returns `[]` for a leaf, never throws. `hasChildren` on the parent is the
 *    adapter's promise; getting it wrong shows a twisty that expands to nothing, which is a
 *    bug to fix in the parent's query, not to paper over.
 * 6. An adapter is single-connection. One instance <-> one `connections` row. The registry
 *    in `src/engine/adapters/live.ts` owns the `Map<connectionId, Adapter>`.
 * 7. `read()` and `count()` obey the same identifier rule as the catalog code, via
 *    `quoteIdent` (D8). Every identifier they emit came out of a catalog query in the same
 *    op. A projected column name that is not in that catalog result is `E_NOT_FOUND`, never
 *    quoted-and-hoped.
 * 8. A page is built with `createTabularPageBuilder` from `shared/protocol/page.ts`. An
 *    adapter that hand-rolls the columnar layout will disagree with the renderer's decoder in
 *    some edge case; there is one codec.
 */
export interface ReadRequest {
  path: NodePath;
  projection: string[] | null;
  filter: string | null;
  sort: SortSpec | null;
  pageSize: number; // already validated <= MAX_PAGE_SIZE at the port boundary
  cursor: PageCursor;
}

export interface CountRequest {
  path: NodePath;
  filter: string | null;
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

  /** The object's definition as executable statements. Gated by caps.ddl; L1-cached by main. */
  ddl(path: NodePath, ctx: OpCtx): Promise<SourceText>;

  /**
   * Forward a cancel for an in-flight op to the server (D5).
   * Returns false when the op was unknown or the server refused; never throws for
   * "already finished". Adapters with caps.cancel === false return false unconditionally.
   */
  cancel(opId: string): Promise<boolean>;

  /** One page of rows. Shape depends on caps.defaultPageKind; both SQL adapters return TabularPage. */
  read(req: ReadRequest, ctx: OpCtx): Promise<Page>;

  /** `exact` is false when the adapter can only estimate (caps.exactCount === false). */
  count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }>;

  /**
   * Exact-command preview (§8.13). Synchronous and never executes — no catalog lookup, no
   * network, trusts `plan`'s column names as given. Gated by `caps.writable`.
   */
  preview(plan: MutationPlan): string[];

  /**
   * Commits a pending-change set: fresh catalog validation in this same op (D7, mirrors
   * `resolveProjection`'s discipline), delete/update/insert in that order (D8), one transaction,
   * one op-log row. Throws `E_UNSUPPORTED` if the connection is read-only. Gated by `caps.writable`.
   */
  mutate(plan: MutationPlan, ctx: OpCtx): Promise<MutationResult>;

  /**
   * §8.14's query console: runs every statement in `req.statements` in order over one
   * connection, one op-log row for the whole batch (`ctx.setCommand()` called once, P5 D9's
   * precedent). All-or-nothing — a mid-batch failure rejects the call with `AdapterError`; there
   * is no partial-results-with-per-statement-error shape. One `Page` per statement, in order.
   * Gated by `caps.sql`.
   */
  execute(req: ConsoleRequest, ctx: OpCtx): Promise<Page[]>;
}

export interface AdapterDeps {
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

export type AdapterFactory = (deps: AdapterDeps) => Adapter;

/**
 * Adapter roadmap (normative, D3). `read`/`count` shipped in P2, `preview`/`mutate` in P5,
 * `execute` in P5.5 — all above, nothing pending. A later phase that widens `Adapter` again does
 * so by amending docs/plans/P1-connections-and-tree.md §4b first, same discipline as this line.
 */
