# P5 — Mutations

> Plan for SPEC.md §10 phase **P5**. Deliverable: *Add/delete row, cell editing, pending-change
> set, exact-command preview, commit/rollback, read-only guard, cache invalidation — needs grid +
> cell editor + preview + op log.*
>
> This is the phase the `Adapter` roadmap comment has been pointing at since P1: `preview()` and
> `mutate()`. It is also the first phase whose renderer half outweighs its engine half — the SQL
> generation is a few hundred lines behind a well-worn `read.ts` pattern; staging edits in a live,
> virtualized, non-reactive-by-design grid is the real work.

## 0. Ground rules for this phase

- Build only what P5 lists. A pending change is renderer state, in memory, per tab — never
  persisted (not `tabs.state_json`, not a new SQLite table, not `localStorage`). Closing a tab or
  quitting the app silently discards uncommitted edits, exactly like closing a spreadsheet you
  never saved. No migration in this phase.
- Every value that crosses from the grid into a `MutationPlan` is a string or `null` — never a
  typed JS number/boolean/Date. The server casts on assignment (`UPDATE t SET n = $1` binds a
  string to a numeric column exactly the way `filter`'s free-text WHERE fragment already does);
  Kira does not parse or validate a cell's textual value against its column type before sending it.
  A cast failure is the server's own error, shown verbatim (Adapter rule 4), not something Kira
  pre-empts.
- `preview()` stays **exactly** as synchronous as the roadmap says: `(plan: MutationPlan) =>
  string[]`. It cannot touch the catalog, the network, or `ctx` — it does not receive one. It
  trusts the plan's column names as given. `mutate()` is where the same D10-style discipline as
  `resolveProjection()` (P2) lives: a fresh `getReadTarget()` call inside the same op, and any
  column in the plan that isn't in that fresh result is `E_NOT_FOUND`, not quoted-and-hoped.
- The read-only guard is enforced **in the adapter**, inside `mutate()`, before any statement is
  built — not only a greyed-out toolbar button. This is the same standard §8.12 already holds
  connections to.
- No new `AdapterErrorCode`. A read-only connection's `mutate()` throws the existing
  `E_UNSUPPORTED` (a capability the connection genuinely does not have); a stale/conflicting row
  (a WHERE-by-primary-key that no longer matches exactly one row) throws the existing `E_QUERY`.
  `errors.ts`'s closed set does not grow in this phase.
- `preview`/`mutate` are **data-channel** ops (`DATA_OP`, MessagePort), not control-channel
  (`ENGINE_OP`, through main) — `shared/protocol/data-ops.ts`'s `DATA_OP.invalidate` has carried
  the comment *"P5's mutation hook"* since P2. Cache invalidation after a successful mutation is a
  same-process `cache.dropTarget()` call in `engine/data.ts`, exactly like the existing
  `DATA_OP.invalidate` handler — never a round trip back through main.
- No new dependency. `renderer/editor/`'s `CodeMirrorHost` already renders read-only SQL text with
  the right dialect; the *Preview command* panel and the operations-log command/error detail rows
  (P3's D19, still a plain-text stopgap) both reuse it as-is.
- Run `bun run lint`, `bun run typecheck` and `bun run build` throughout; `bun run test:db` from
  the adapter step on, `xvfb-run -a bun run test:ui` from the renderer step on.

### P0–P4 realities you must work with (verified against the tree)

1. **The `Adapter` roadmap (`src/engine/adapters/adapter.ts:105-115`) is normative and unchanged
   by this plan**: `preview(plan: MutationPlan): string[]` and
   `mutate(plan: MutationPlan, ctx: OpCtx): Promise<MutationResult>`, both gated by
   `caps.writable` (true for both existing adapters — `src/shared/caps.ts`'s table). `opKindSchema`
   (`shared/domain/ops.ts`) already carries the comment *"P5 adds 'mutate'"* — it is the only
   member this phase adds; `preview` never reaches the op log (see D9).
2. **Both adapters already carry a `private readOnly = false` field**, set from `cfg.readOnly` on
   `connect()`, with the comment *"P5's `mutate()` is where this flag turns into an actual
   enforcement check"* (`postgres/index.ts:38`, `mariadb/index.ts:42`). The flag already exists;
   P5 is only the `if (this.readOnly) throw …` line.
3. **`ReadTarget`** (`postgres/catalog.ts`, `mariadb/catalog.ts`) already carries everything a
   mutation needs: `qualifiedName`, `columns` (with `isPrimaryKey`), `primaryKey: string[] | null`.
   `getReadTarget()` is the exact fresh-per-op catalog call `mutate()` reuses.
4. **MariaDB's driver constraint from P2 carries over verbatim**: every mutation statement goes
   through `conn.query()` (text protocol, client-side `?`-escaping), never `conn.execute()` — the
   read path's own comment documents binary-protocol corruption with bound params.
5. **`runQuery` (both `query.ts` files) only returns `.rows`**, discarding `rowCount`/
   `affectedRows` — fine for `SELECT`, useless for `UPDATE`/`DELETE`/`INSERT`. This phase adds a
   sibling `runCommand()` in each `query.ts` that returns the affected-row count instead, sharing
   the same cancellation/error-mapping logic.
6. **`ctx.setCommand()` (Adapter rule 3) is called once and its last call wins** — `runOp`'s
   closure just overwrites a `command` variable. A mutation is a *batch* of statements under one
   op-log row, so `mutate()` calls `ctx.setCommand()` itself, once, with the full joined statement
   text, before issuing anything, and the per-statement `runCommand()` calls inside the
   transaction pass `suppressCommand: true` so they don't clobber it.
7. **`ObjectMeta.primaryKey` and `ColumnDescriptor.isPrimaryKey` already exist** and already reach
   the renderer (`tree.describe()`'s L1-cached result, and every `TabularPage`'s per-column
   descriptor respectively) — row identity for staging an edit is "every column in the page with
   `isPrimaryKey === true`", no new wire field.
8. **`views/celleditor/` may not import from `views/grid/`** (`state/cellSelection.ts`'s own
   comment: *"the seam that keeps it that way"*). Whether a row can be edited depends on whether
   its page has a primary key at all — grid-only knowledge — so `SelectedCell` (in
   `state/cellSelection.ts`, neutral ground) grows one field, `hasPrimaryKey: boolean`, computed
   once by `DataGrid.vue`'s existing publish watch.
9. **`DataToolbar.vue` already has three disabled stub buttons** — `toolbar-add-row`,
   `toolbar-delete-row`, `toolbar-preview-command` — each `title="Available in a later version"`.
   This phase is what enables them; their `data-testid`s do not change.
10. **`OperationsPanel.vue`'s expanded command/error rows are plain text on purpose**, with an
    explicit comment naming P5 as the owner of upgrading them to the same widget the *Preview
    command* panel uses (D19 of P3's plan). Small, and in scope here.
11. **`DataTabState` does not grow a field.** Pending changes are not part of tab state — they are
    a separate reactive map keyed by tab id, cleared on `closeTab`/`reload`/`load`, never written
    to `tabs.state_json`.
12. **`data-ops.ts`'s wire convention is "path as an encoded string, decoded engine-side"** — every
    existing `*RequestWire` (`ReadRequestWire`, `CountRequestWire`, `InvalidateRequestWire`) shapes
    its `path` this way. `MutateRequestWire`/`PreviewRequestWire` follow the same convention rather
    than sending a structured `NodePath` over the wire.

## 1. `MutationPlan` shape (D1)

A plan always targets **one table** — exactly what one grid tab ever produces. Multi-table
batching is not a P5 requirement (the grid edits one object at a time) and is not built.

```ts
// src/shared/domain/mutations.ts
export type MutationRowOp =
  | { kind: 'update'; key: Record<string, string | null>; changes: Record<string, string | null> }
  | { kind: 'insert'; values: Record<string, string | null> }
  | { kind: 'delete'; key: Record<string, string | null> };

export interface MutationPlan {
  path: NodePath; // the target table — same shape read()/describe() already take
  ops: MutationRowOp[];
}

export interface MutationResult {
  affectedRows: number;
}
```

`key` always carries **every** primary-key column (mutate() rejects a partial key as `E_QUERY` —
a partial key is not a safe row identifier). `changes`/`values` map column name to its new textual
value; `null` means SQL `NULL`, never the string `"null"`.

## 2. Decisions made in this plan

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | `MutationPlan` is single-table (`path` hoisted out of each op); ops are `update`/`insert`/`delete` keyed by primary-key value(s), never a rowid/ctid fallback. | Matches the one thing the UI ever produces (one tab, one target); ctid is not stable across a VACUUM FULL and adding it back later is strictly additive. |
| D2 | A row with no primary key (`ObjectMeta.primaryKey === null`) cannot be edited or deleted in P5. New `ReadOnlyReason` member `'no-primary-key'`. | There is no safe, generic way to re-identify a specific row for `UPDATE`/`DELETE` without one; a composite unique index is a P6+ candidate, not this phase's. |
| D3 | Pending changes live in a new renderer module, `views/grid/pendingChanges.ts`: a `reactive` `Record<tabId, TabPending>`, never persisted. | Mirrors `views/grid/state.ts`'s own `runtime` map exactly (D15 of P4's plan already established this pattern for DDL); §11's cross-view state rule places it in `renderer/state/`-adjacent territory, but it is grid-specific (keyed by page row index, page-column-aware) so it stays beside `state.ts`, not in `renderer/state/`. |
| D4 | Editing happens **in the grid**: double-click (or Enter on a selected cell) opens an inline `<input>` over the cell; Enter/blur stages the change, Escape cancels. The cell-editor panel (`views/celleditor/`) stays read-only/view-only in P5. | The panel already exists to *view* one cell's full (possibly multi-KB, possibly JSON/XML-formatted) value — turning it into the *editing* surface too would mean two write paths for one cell. In-grid inline edit is the direct, spreadsheet-conventional path and is what §8.13 stages; a panel-based edit affordance is not ruled out later but is not built now. |
| D5 | Row identity for staging: every column in the current page with `isPrimaryKey === true`, read via the same `cell()` accessor the grid already uses. | No new wire field — P2's `ColumnDescriptor.isPrimaryKey` already reaches every page. |
| D6 | `preview()` takes no `ctx`, does no catalog lookup, and renders literal (properly-escaped) SQL text for display only — it is **never** executed. `mutate()` builds the same statement shape with real parameter placeholders, executed via `runCommand()`. | The roadmap fixes `preview()`'s signature as synchronous; a synchronous method cannot hit the network. Sharing one `renderRowOp()` builder (parameterized by how a value is rendered — inline literal vs. bound placeholder) keeps the two textually identical in shape without duplicating WHERE/column-list construction. |
| D7 | `mutate()` re-resolves `getReadTarget()` fresh in the same op and validates every column name in every op's `key`/`changes`/`values` against it, `E_NOT_FOUND` on drift — mirrors `resolveProjection()` (P2 D10). | Same standing rule: a renderer-supplied identifier is never trusted across a catalog boundary without a same-op re-check. |
| D8 | Execution order inside one `mutate()` call is always **delete, then update, then insert**, regardless of the plan's own `ops` array order. | Deterministic and avoids a delete-then-recreate-at-the-same-key row from racing its own insert; matches common DB-GUI convention. |
| D9 | The whole batch is one op-log row, `kind: 'mutate'`. `ctx.setCommand()` is called once, before anything executes, with every statement's preview-style text joined by `;\n`. `preview()` itself never runs inside `runOp` and never reaches the op log — same precedent as `configureCache`. | `runOp`'s `command` is last-write-wins (P0/P1 reality #6 above); one call with the full text is the only way a cancelled-mid-batch mutation still shows what it was running (Adapter rule 3). |
| D10 | Every `UPDATE`/`DELETE` statement is wrapped, together with the surrounding `BEGIN`/`COMMIT`, in one transaction on the plan's single client/connection; after each statement, the driver-reported affected-row count must be exactly 1 or the whole transaction rolls back with `E_QUERY`. | `caps.transactions` is `true` for both adapters. A `WHERE`-by-primary-key that matches zero rows (already deleted by another session) or more than one (a corrupted/duplicate key) is a conflict, not a silent partial success. |
| D11 | The read-only guard (`this.readOnly`) is checked once at the top of `mutate()`, before `getReadTarget()` even runs. Not checked in `preview()` — an operator previewing a read-only connection's hypothetical edit is harmless; only *executing* one is guarded. | §8.12's "enforced in the engine" standard; `preview()` never touches the server at all, so there is nothing to guard. |
| D12 | New `DATA_OP` members `preview: 'data:preview'` and `mutate: 'data:mutate'`, dispatched in `engine/rpc.ts`/`engine/data.ts` beside `read`/`count`/`invalidate`. `handlePreview` calls `adapter.preview()` directly (no `runOp`, mirroring `configureCache`); `handleMutate` wraps `adapter.mutate()` in `runOp` and then calls `cache.dropTarget(connectionId, path)` on success. | The pre-existing "P5's mutation hook" comment on `DATA_OP.invalidate` already named this channel; `preview` is a pure computation with no server round trip, same class as `configureCache`. |
| D13 | `MutateRequestWire`/`PreviewRequestWire` carry `path` as an encoded string (decoded engine-side via `decodePath`), matching `ReadRequestWire`/`CountRequestWire`/`InvalidateRequestWire`'s existing convention. | Consistency with every other `data-ops.ts` wire type; no reason to special-case mutations. |
| D14 | `SelectedCell` (`state/cellSelection.ts`) grows one field: `hasPrimaryKey: boolean`, set by `DataGrid.vue`'s existing publish watch from `page.columns.some(c => c.isPrimaryKey)`. `readOnlyReasonFor()` gains the `'no-primary-key'` branch ahead of the pre-existing `'value-truncated'`/`'not-editable-yet'` ones, and now returns `ReadOnlyReason | null` (`null` = genuinely editable). | Keeps `views/celleditor/` importing nothing from `views/grid/` (P0 reality #8) while still letting it render the right lock reason; the truncated-cell reason was already reserved in P3's plan comment. |
| D15 | Pending state renders as: an edited cell gets a tinted background showing the *staged* value (not the original); a pending-delete row is struck through and non-interactive until un-marked; a pending-insert row is appended below the page's own rows, permanently in edit mode (every cell an `<input>`), and is never sent to the server until commit. | Directly visible, reversible staging is what §8.13 calls a "pending-change set" for — the grid must show what will happen, not just record it invisibly. |
| D16 | `toolbar-add-row` appends one pending-insert row (all columns `null` until edited); `toolbar-delete-row` marks the selected row(s) pending-delete (or, for an already-pending-insert row, simply discards it); `toolbar-preview-command` opens a new `PreviewCommandPanel.vue` overlay showing `adapter.preview()`'s exact text; two new buttons, `toolbar-commit-changes`/`toolbar-discard-changes`, appear only while a tab has pending changes. All five are gated on `caps.writable && !connection.readOnly`. | These are exactly the three stubs P3 left behind, plus the commit/rollback affordance §8.13 requires; gating mirrors the existing read-only chip's condition. |
| D17 | On a successful commit, the tab calls `data.invalidate()` (already wired to `cache.dropTarget()`) is unnecessary to call from the renderer — `handleMutate` already drops the target cache-side — so the renderer only needs to `reload()` the tab's current page after a successful `mutate()`, exactly like the existing ↻ button. | Avoids a redundant second invalidate call; `reload()` already does invalidate-then-load in one function (`views/grid/state.ts`). |
| D18 | `OperationsPanel.vue`'s expanded `detail-command`/`detail-error` rows switch from plain text to a fixed-height `CodeMirrorHost` (`language: 'sql'` for the command row, `'text'` for the error row, both `read-only: true`), reusing `PreviewCommandPanel.vue`'s same host instance pattern. | P3's own plan named this P5's to do; small and already unblocked by D19's read-only rendering surface existing. |
| D19 | DB-spec scenarios for mutations start at **21** in `tests/db/postgres.spec.ts` (currently ends at 20, "ddl") and **20** in `tests/db/mariadb.spec.ts` (currently ends at 19, "ddl"). | Continues each file's existing numbered-scenario convention without renumbering anything already there. |

## 3. Target tree at the end of P5

```
src/shared/domain/mutations.ts                    NEW  MutationRowOp/MutationPlan/MutationResult + zod
src/shared/domain/ops.ts                           MOD  opKindSchema += 'mutate'
src/shared/domain/tabs.ts                          --   unchanged (D11)
src/shared/protocol/data-ops.ts                    MOD  DATA_OP.preview/mutate + wire schemas
src/engine/adapters/adapter.ts                     MOD  Adapter.preview()/mutate()
src/engine/adapters/postgres/mutate.ts             NEW  renderRowOp/buildStatements, preview(), mutate()
src/engine/adapters/postgres/query.ts              MOD  + runCommand()
src/engine/adapters/postgres/index.ts              MOD  wire preview()/mutate(), readOnly guard
src/engine/adapters/mariadb/mutate.ts              NEW  mirrors postgres/mutate.ts
src/engine/adapters/mariadb/query.ts               MOD  + runCommand()
src/engine/adapters/mariadb/index.ts               MOD  wire preview()/mutate(), readOnly guard
src/engine/data.ts                                 MOD  handlePreview/handleMutate + cache.dropTarget
src/engine/rpc.ts                                  MOD  dispatch DATA_OP.preview/mutate
src/renderer/bridge/data.ts                        MOD  data.preview()/data.mutate()
src/renderer/state/cellSelection.ts                MOD  SelectedCell.hasPrimaryKey
src/renderer/views/celleditor/state.ts             MOD  'no-primary-key' reason, ReadOnlyReason | null
src/renderer/views/celleditor/CellEditorView.vue   MOD  chip text for the new/changed reasons only
src/renderer/views/grid/pendingChanges.ts          NEW  per-tab staging state + buildPlan()/commit()/discard()
src/renderer/views/grid/DataGrid.vue               MOD  inline cell edit, pending row/cell rendering, hasPrimaryKey publish
src/renderer/views/grid/DataToolbar.vue            MOD  wire the 3 stub buttons + commit/discard
src/renderer/views/grid/PreviewCommandPanel.vue    NEW  reads adapter.preview() via data.preview()
src/renderer/workbench/panels/OperationsPanel.vue  MOD  CodeMirrorHost for command/error detail rows
tests/db/postgres.spec.ts                          MOD  scenarios 21+
tests/db/mariadb.spec.ts                           MOD  scenarios 20+
tests/ui/mutations.spec.ts                         NEW  edit/add/delete/preview/commit/discard, read-only guard
```
