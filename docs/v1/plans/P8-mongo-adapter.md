# P8 — MongoDB adapter + document view

> Plan for SPEC.md §10 phase **P8**. Deliverable: *Adapter + document view (expand/collapse, edit,
> delete).* "First non-tabular shape; validates the page-kind union" — every phase through P7 has
> been SQL/tabular; this phase is the first consumer of the `Page` union's second arm and the first
> non-relational adapter.

## 0. Ground rules for this phase

- Build exactly what §5.1's mongodb row + §8.7 "Document view" + §8.10's Mongo context-menu rows +
  §8.14's shell-style console describe. No aggregation pipeline builder UI, no schema inference,
  no index-creation UI — those are not named anywhere in scope for v1.
- §8.5 says outright: **"Mongo has no FK navigation in v1"** — P7's cell-nav button/menu items stay
  gated on `meta !== null`, and `ObjectMeta`/`describe()` is never populated for a Mongo tab, so
  no extra gate is needed there.
- Document edit/delete execute **immediately** (delete behind a confirm dialog; edit commits on
  save), bypassing the grid's pending-change/preview/commit staging machinery entirely. §8.7's
  spec paragraph never mentions staging or preview for documents, unlike §8.5's grid section which
  explicitly does — this is read as a deliberate scope narrowing, not an oversight.
- The shared, relational-shaped `MutationRowOp`/`MutationPlan` schema (`{key, changes}` keyed by
  column name) is **not widened**. A whole-document replace is expressed as an `update` op whose
  `changes` has exactly one key, the reserved sentinel `'$document'`, holding the EJSON text of the
  full new document. `$` cannot start a normal MongoDB field name, so no real top-level field can
  ever collide with the sentinel.
- One adapter = one connection (existing rule #6 in `adapter.ts`) still holds: one `MongoClient`
  per `AdapterInstance`, not a client-side pool-of-pools. The driver's own internal pool handles
  concurrency under that one client.
- Pagination is keyset-on-`_id` with `skip`/`limit` fallback when a query's sort isn't `_id`-driven
  (§5.1's literal wording); count is `estimatedDocumentCount()` by default, exact
  `countDocuments()` only on explicit request (§5.1: "estimatedDocumentCount for count" — read as
  the default path, matching Caps' `count: 'estimate-only'`).
- Cancellation: pass `ctx.signal` as the driver's native `AbortSignal` option on every cursor op
  (driver v6 supports this directly); as a best-effort second layer, tag every op with
  `comment: opId` and have `cancel(opId)` run `db.admin().command({currentOp: 1, 'command.comment':
  opId})` then `killOp` any match — mirrors §5.1's "AbortSignal on cursor + killOp fallback for
  cancel" exactly.
- No unit tests beyond the two existing suites. `tests/db/mongo.spec.ts` is a new numbered-scenario
  file (mirrors `mariadb.spec.ts`'s structure) using Testcontainers' Mongo image; `tests/ui/mongo.spec.ts`
  is a new minimal-but-real UI spec (mirrors `mariadb.spec.ts`'s UI counterpart). Run `bun run lint`,
  `bun run typecheck` (all three project splits), `bunx electron-vite build`, `bun run test:db`, and
  `xvfb-run -a bun run test:ui` before committing.

### Realities this phase works with (verified against the tree)

1. **`Page` is already a single-member union with a doc comment reserving this exact widening** —
   `src/shared/protocol/page.ts`: `type Page = TabularPage; // P8 widens this to TabularPage |
   DocumentPage`. `assertPageStructure(page: TabularPage)` is the only structural-validation call
   site (`renderer/bridge/data.ts`) and must become kind-dispatching.
2. **`TextColumnChunk`'s packed-UTF8 + offsets + null-bitset + truncated-indices codec is generic**
   — it's used today for `TabularPage`'s per-column cell text, but nothing about it is
   column-specific. `DocumentPage` reuses it verbatim for two fixed columns (`ids`, `bodies`)
   instead of the tabular caller's `columns[]`.
3. **`Caps`/`PageKind` already have the target shape reserved** — `PageKind` already includes
   `'document'`; `caps.ts`'s bottom doc-comment table already specifies every field of the target
   `mongoCaps` object; only the postgres row exists as real code today (`postgres/caps.ts`).
4. **`nodeKindSchema` needs exactly two new literals** — `'collection'` (mongo's table-equivalent,
   opened as a document tab) and `'index'` (a leaf under a collection, per §5.1's "database →
   collections (+ indexes)" tree and §8.10's index row). `encodePath`/`decodePath` are kind-agnostic
   and need no change.
5. **`tabKindSchema` already includes `'document'`**; `RENDERABLE_TAB_KINDS` and
   `tabRecordSchema`'s discriminated union do not yet have the matching member — this phase adds
   `documentTabStateSchema`/`defaultDocumentTabState()`/`asDocumentTab()` following the exact
   `dataTabStateSchema` pattern (§1 below).
6. **`connectionKindSchema` already includes `'mongodb'`**; only `DEFAULT_PORT.mongodb` (27017) is
   missing from `connection.ts`. The connection dialog's fields-mode (host/port/user/password/
   database) already works generically for any kind — `ConnectionDialog.vue`'s `SUPPORTED_KINDS`
   just needs `'mongodb'` added to the set that's offered.
7. **`registry.ts` is a flat object literal** (`factories: Partial<Record<ConnectionKind,
   AdapterFactory>>`) — adding Mongo is one import + one entry, no other wiring.
8. **`engine/data.ts` and `engine/cache/{index,pages}.ts` reference `TabularPage` only as pure type
   annotations** (`page.rowCount`/`page.byteSize`, both present on any `Page` member) — widening to
   `Page` there is a mechanical, behavior-free change.
9. **`Toolbar.vue`'s `v-if` already excludes `'console'`**, because `ConsoleView.vue` renders its
   own toolbar internally — the same self-contained-toolbar precedent applies to `DocumentView.vue`;
   `Toolbar.vue` itself needs no change, just one more excluded kind.
10. **`ProjectTree.vue`'s `OPENABLE_KINDS` set unconditionally calls `openDataTab`** for every
    member — opening a `'collection'` node needs a kind-aware branch (`openDocumentTab` instead),
    not just a set addition. Likewise `menus.ts`'s `menuForRow()` switch needs a `'collection'` case
    (near-copy of `relationMenu`, opening via `openDocumentTab`) and a minimal `'index'` case
    (copy-name only, per §8.10's table having no dedicated index-menu row beyond what a column-like
    leaf would offer).
11. **`state/tabs.ts`'s `duplicateTab()` is a non-exhaustive 3-way ternary** that silently treats
    any unhandled kind as console-shaped — adding the `document` branch turns this into a real
    4-way dispatch (still not compiler-exhaustive without a `never` check, but this phase adds the
    explicit branch rather than relying on the silent fallthrough).
12. **The MariaDB adapter is the closest structural template** for `catalog.ts`/`index.ts`'s shape
    (its tree is `database → table → column`, one level shallower than Postgres, matching Mongo's
    `database → collection` shape), but its `ConnectionSet` (per-database LRU `Connection`,
    needed for `KILL QUERY`) does not apply — Mongo's `client.ts` is a single pooled `MongoClient`
    with a cheap synchronous `client.db(name)` handle-get, no eviction needed.
13. **`sql-text.ts`'s `encodePageToken`/`decodePageToken`/`requestFingerprint` are dialect-agnostic**
    (base64url JSON `{v:1,k:string[],f:fingerprint}`) and reused as-is for `_id`-keyset tokens;
    `buildOrderBy`/`buildKeysetPredicate` are SQL-text-specific and are not reused. The driver's own
    `EJSON.stringify`/`EJSON.parse` round-trips `_id`/document values (`ObjectId`, `Date`, etc.)
    inside tokens and page bodies.
14. **`mongodb` is not yet a dependency** — `package.json` has `pg`, `mariadb`, `drizzle-orm`,
    `electron-log`, `zod`, but no Mongo driver. This phase adds it.

## 1. Shapes introduced in this plan

```ts
// src/shared/protocol/page.ts

// Mirrors TabularPage's TextColumnChunk codec exactly, with two fixed semantic columns instead of
// a generic columns[] — a document page's shape never varies per-request the way a projection does.
export interface DocumentPage {
  kind: 'document';
  position: PagePosition;
  ids: TextColumnChunk; // EJSON text of each document's _id
  bodies: TextColumnChunk; // EJSON text of each full document
  rowCount: number;
  byteSize: number;
}

export type Page = TabularPage | DocumentPage;

// Builder mirroring createTabularPageBuilder — same private ColumnScratch reuse, fixed two-column
// output instead of caller-supplied columns. truncation budget: DOCUMENT_TRUNCATE_BYTES (64 KiB,
// matching MAX_CELL_BYTES) per body normally; when the caller passes singleRow: true (the "show
// all" re-fetch path, always exactly one _id-filtered document) the per-body cap is instead
// MAX_CELL_BYTES * 64 (4 MiB) — large enough that truncation of a single explicitly-requested
// document should not practically happen, without formally removing the cap.
export function createDocumentPageBuilder(opts?: { singleRow?: boolean }): {
  push(id: unknown, bodyEjson: string): void;
  build(position: PagePosition): DocumentPage;
};

// assertPageStructure becomes kind-dispatching; each arm re-validates that arm's chunk invariants
// (offsets monotonic, byteSize matches, etc.) — the tabular arm's logic is unchanged, just moved
// under `if (page.kind === 'tabular')`.
export function assertPageStructure(page: Page): void;
```

```ts
// src/engine/adapters/mongo/caps.ts
export const mongoCaps: Caps = {
  tree: { levels: ['database', 'collection'], leafHasChildren: true }, // + indexes, per §5.1
  defaultView: 'document',
  pagination: 'cursor',
  count: 'estimate-only',
  cancel: 'cursor-signal-with-killop-fallback',
  sql: true, // shell-style console, per §8.14
  ddl: false,
  foreignKeys: false,
};
```

```ts
// src/engine/adapters/mongo/client.ts
export interface MongoClientHandle {
  client: MongoClient;
  db(name: string): Db; // client.db(name) is a cheap synchronous handle — no cache needed
}
export function connectMongo(input: ConnectionInput): Promise<MongoClientHandle>;
```

```ts
// src/engine/adapters/mongo/catalog.ts
export function listDatabases(client: MongoClient): Promise<string[]>;
export function listCollections(db: Db): Promise<TreeNode[]>; // + one 'indexes' container child
export function listIndexes(db: Db, collection: string): Promise<TreeNode[]>;
```

```ts
// src/engine/adapters/mongo/read.ts
export function readPage(
  db: Db,
  collection: string,
  request: ReadPageRequest,
  ctx: OpCtx,
): Promise<DocumentPage>; // _id-keyset when unsorted/sorted-by-_id, skip/limit fallback otherwise
export function countRows(
  db: Db,
  collection: string,
  request: CountRequest,
  ctx: OpCtx,
): Promise<CountResult>; // estimatedDocumentCount() unless request.exact
```

```ts
// src/engine/adapters/mongo/mutate.ts
// Recognizes the '$document' sentinel key (ground rules) for whole-document replace; a delete op
// is {kind:'delete', key:{_id: <ejson>}} mapped straight to deleteOne({_id}).
export function mutate(db: Db, collection: string, plan: MutationPlan, ctx: OpCtx): Promise<MutationResult>;
export function preview(db: Db, collection: string, plan: MutationPlan): Promise<string>; // shell-command text
```

```ts
// src/engine/adapters/mongo/console.ts
// Safe (no eval/Function) tolerant parser for `db.<collection>.<method>(<json5-ish args>)` shell
// syntax — unquoted keys, single-quoted strings, no functions/expressions accepted as arg values.
// Supported methods: find, findOne, insertOne, insertMany, updateOne, updateMany, deleteOne,
// deleteMany, countDocuments, aggregate. Each statement's result becomes one DocumentPage (or, for
// count/insert/update/delete's ack, a single-row status DocumentPage mirroring console.ts's
// singleStatusPage pattern in the MariaDB adapter).
export function execute(db: Db, statementText: string, ctx: OpCtx): Promise<Page>;
```

```ts
// src/engine/adapters/mongo/index.ts
export function createMongoAdapter(): Adapter; // implements the Adapter interface end-to-end
```

```ts
// src/shared/domain/tabs.ts
export interface DocumentTabState {
  status: 'idle' | 'loading' | 'error';
  error: string | null;
  expanded: Record<string, boolean>; // per-_id expand/collapse memory (§8.7)
  search: string;
}
export function defaultDocumentTabState(): DocumentTabState;
// tabRecordSchema gains a `document` discriminated-union member with `state: documentTabStateSchema`.
export function asDocumentTab(tab: TabRecord): DocumentTabRecord | null;
```

```ts
// src/renderer/state/tabs.ts
export function openDocumentTab(connectionId: string, path: string, opts?: { newTab?: boolean }): string;
export function patchDocumentTabState(tabId: string, patch: Partial<DocumentTabState>): void;
export function findDocumentTab(connectionId: string, path: string): TabRecord | undefined;
```

```ts
// src/renderer/views/documents/state.ts — mirrors views/grid/state.ts's DataViewRuntime shape
// (status/rows/tokens/pager), but rows are { id: string; bodyEjson: string }[] instead of columnar.
export function load(tabId: string, opts?: { refresh?: boolean }): Promise<void>;
export function goNext(tabId: string): Promise<void>;
export function goPrev(tabId: string): Promise<void>;
export function setSearch(tabId: string, text: string): void;
```

```ts
// src/renderer/views/documents/documentMutations.ts
// Immediate-execute (ground rules) — no staging. deleteDocument shows a confirm dialog first.
export function saveDocumentEdit(tabId: string, id: string, newBodyJson: string): Promise<void>;
export function deleteDocument(tabId: string, id: string): Promise<void>;
```

## 2. Decisions made in this plan

| # | Decision | Rationale |
|---|---|---|
| D1 | `DocumentPage` is a fixed two-column (`ids`, `bodies`) reuse of `TextColumnChunk`, not a generic `columns[]` like `TabularPage`. | A document page's shape is invariant — there is never a "which columns" question the way a tabular projection has one; reusing the exact codec (realities #2) means zero new wire-format code, only a narrower builder API. |
| D2 | `assertPageStructure` dispatches on `page.kind` with one arm per member, rather than becoming a generic "validate any chunk-shaped field" walker. | Matches the file's own existing doc-comment instruction ("Switch on `page.kind` everywhere, even though there is one arm today") — an abstracted walker would be premature generalization for a two-member union. |
| D3 | Document mutation reuses the existing relational `MutationPlan`/`MutationRowOp` schema unchanged, via the `'$document'` sentinel key for whole-document replace and the natural `{key:{_id}}` shape for delete — no new shared mutation schema. | Keeps exactly one mutation wire shape in the whole app; `$`-prefixed keys are already illegal as real top-level Mongo field names, so the sentinel can never collide with genuine data. Introducing a parallel document-mutation schema would fork the preview/mutate IPC surface for no behavioral gain. |
| D4 | Document edit and delete execute immediately — delete behind a confirm dialog, edit committed straight from the editor's save action — bypassing `views/grid/pendingChanges.ts` entirely; no new pending-state module for documents. | §8.7 never mentions staging/preview for documents, unlike §8.5's grid section which explicitly does; `pendingChanges.ts` is confirmed tightly coupled to the grid's columnar `page.ts`/`cell()` model and not reusable as-is. Building a parallel staging system for one entity type with no spec mandate would be scope creep. |
| D5 | Count defaults to `estimatedDocumentCount()`; `countDocuments()` (exact) is only issued when the UI explicitly asks for an exact count (a toolbar action, not the default pager behavior). | §5.1 lists both and marks `countDocuments` "(slow)" — `Caps.count: 'estimate-only'` (realities #3) already signals the UI to treat the pager's count as approximate by default, matching Mongo's own documented performance guidance. |
| D6 | Pagination keys off `_id` via the existing generic `encodePageToken`/`decodePageToken` (realities #13), using the driver's `EJSON` for `_id` serialization inside the token; a request whose `sort` isn't `_id`-compatible falls back to `skip`/`limit`. | Reuses proven, already-tested token plumbing instead of inventing a second pagination-token format; matches §5.1's literal wording exactly ("`_id` keyset + `skip/limit` fallback"). |
| D7 | Cancellation is two-layered: `ctx.signal` passed directly as the driver's native cursor `AbortSignal` option (primary), plus every op tagged with `comment: opId` and a `cancel(opId)` that runs `currentOp` + `killOp` as a best-effort fallback for ops the native abort doesn't reach in time. | Matches §5.1's literal wording ("AbortSignal on cursor + killOp fallback for cancel"); the native abort covers the common case cheaply, `killOp` covers the gap where a long-running server-side op has already started before the abort is observed. |
| D8 | `client.ts` holds one pooled `MongoClient` per adapter instance with a synchronous `client.db(name)` handle-get; no `ConnectionSet`/LRU analog to MariaDB's. | Mongo's driver is inherently a connection pool per `MongoClient`; `client.db()` doesn't open a new connection, it returns a lightweight handle. MariaDB's per-database `Connection` + LRU exists specifically to support `KILL QUERY <threadId>` against a single active connection, which Mongo's `killOp`-by-`comment` (D7) doesn't need. |
| D9 | The console's shell-command parser is a small hand-written JSON5-lite tokenizer/parser (unquoted keys, single-quoted strings, numbers/booleans/null/arrays/objects only) — no `eval`, no `Function`, no third-party expression evaluator. | User-supplied console text must never reach a JS evaluator (security); a full JS-expression Mongo shell is explicitly out of scope (§8.14 only asks for "that engine's native command form," not a JS runtime) — supporting the common literal-argument shape covers realistic query/insert/update text without the attack surface of `eval`. |
| D10 | `nodeKindSchema` gains `'collection'` and `'index'`; a collection's children include one synthetic `'index'`-kind container-adjacent listing (mirrors §5.1's "collections (+ indexes)" and §8.10's dedicated index row) rather than folding indexes into the collection node itself. | Keeps the tree's existing one-node-per-schema-object convention intact; an index is its own addressable path segment (needed for the "Copy name" menu item in realities #10) rather than a property bag on the collection node. |
| D11 | `ProjectTree.vue`'s open-dispatch becomes kind-aware (`'collection'` → `openDocumentTab`, existing members → `openDataTab`) instead of adding `'collection'` to the existing single-target `OPENABLE_KINDS` set. | The set's current shape assumes every openable kind opens the same way; Mongo is the first kind that doesn't, so the dispatch must branch on kind rather than staying a flat set membership check. |
| D12 | `state/tabs.ts`'s `duplicateTab()` gets an explicit `document` branch (4-way dispatch) rather than leaving `document` to fall through the existing "else treat as console" default. | The existing ternary's silent fallthrough was tolerable with 3 known kinds; leaving a 4th kind to silently inherit console's duplicate shape would duplicate a tab incorrectly (wrong state shape) rather than failing loudly — an explicit branch is one line and removes the ambiguity. |
| D13 | `mongodb` (official Node driver, v6.x line) is added as a direct dependency; no ODM (Mongoose etc.) is introduced. | The adapter operates on raw documents/EJSON by design (no schema), matching every other adapter's dependency shape (`pg`, `mariadb` are also raw drivers, not ORMs) and `drizzle-orm`'s existing use elsewhere is unrelated to this adapter. |
| D14 | Index nodes' context menu (`menus.ts`'s `'index'` case) offers only "Copy name" / "Copy qualified name," reusing `columnMenu`'s minimal shape rather than a bespoke index menu. | §8.10's context-menu table has no dedicated "Index" row beyond what's implied by the tree existing at all — a minimal copy-name affordance is the smallest thing consistent with the index being an addressable, named tree leaf. |
| D15 | `DocumentView.vue` renders its own toolbar internally (search box + refresh + pager + exact-count trigger), matching `ConsoleView.vue`'s self-contained-toolbar precedent; `Toolbar.vue` is not modified beyond adding `'document'` to its excluded-kinds check. | Realities #9 — the precedent already exists and works for a fundamentally different-shaped view; document search/pagination controls don't map onto the grid toolbar's column/filter-bar affordances anyway. |

## 3. Target tree at the end of P8

```
src/shared/
  protocol/page.ts        MOD — DocumentPage, createDocumentPageBuilder, Page union widened,
                                 assertPageStructure kind-dispatch, DOCUMENT_TRUNCATE_BYTES.
  domain/tree.ts           MOD — nodeKindSchema gains 'collection', 'index'.
  domain/tabs.ts           MOD — documentTabStateSchema, defaultDocumentTabState, asDocumentTab,
                                  tabRecordSchema document member, RENDERABLE_TAB_KINDS.
  domain/connection.ts     MOD — DEFAULT_PORT.mongodb = 27017.
src/engine/adapters/
  registry.ts               MOD — mongodb: createMongoAdapter entry.
  mongo/                    NEW
    caps.ts                 NEW — mongoCaps.
    client.ts                NEW — connectMongo, MongoClientHandle.
    errors.ts                NEW — mapMongoError → AdapterError.
    catalog.ts                NEW — listDatabases/listCollections/listIndexes.
    read.ts                   NEW — readPage, countRows.
    mutate.ts                  NEW — mutate, preview ('$document' sentinel handling).
    console.ts                  NEW — JSON5-lite parser + execute (shell-style statements).
    index.ts                    NEW — createMongoAdapter (Adapter implementation).
src/engine/
  data.ts                  MOD — TabularPage → Page in handleRead/handlePrefetch/handlePreview types.
  cache/pages.ts           MOD — TabularPage → Page.
  cache/index.ts           MOD — TabularPage → Page.
src/renderer/
  bridge/data.ts           MOD — assertPageStructure call site unchanged in shape, now kind-generic.
  state/tabs.ts             MOD — openDocumentTab, patchDocumentTabState, findDocumentTab,
                                   duplicateTab's document branch.
  project/ConnectionDialog.vue MOD — SUPPORTED_KINDS gains 'mongodb'.
  project/ProjectTree.vue   MOD — kind-aware open dispatch for 'collection'.
  project/menus.ts          MOD — 'collection' case (near-copy of relationMenu, opens document tab),
                                   'index' case (copy-name only), QUALIFIED_KINDS gains 'collection'.
  workbench/panels/MainView.vue  MOD — v-else-if branch for 'document' → DocumentView.
  workbench/panels/Toolbar.vue   MOD — excluded-kinds check gains 'document'.
  workbench/panels/TabStrip.vue  MOD — iconFor 'document' case.
  views/documents/           NEW
    DocumentView.vue          NEW — self-contained toolbar + virtualized expand/collapse list.
    state.ts                   NEW — DataViewRuntime analog for documents.
    documentMutations.ts        NEW — saveDocumentEdit, deleteDocument (immediate-execute).
    documentMenu.ts              NEW — per-document context menu (Expand/Collapse all, Copy
                                        document, Copy _id, Edit, Delete — §8.10).
package.json               MOD — mongodb driver dependency.
tests/db/
  support/mongo.ts          NEW — Testcontainers startMongo(), mirrors postgres.ts.
  fixtures/mongo-seed.ts     NEW — seed documents (JS-based, not .sql).
  mongo.spec.ts               NEW — numbered scenario suite (catalog, read/paginate, count,
                                     mutate, console, cancel).
  postgres.spec.ts          MOD — "unsupported kind" test target switched from 'mongodb' to
                                    another still-unsupported kind (e.g. 'redis').
tests/ui/
  mongo.spec.ts              NEW — connect, tree walk, open document tab, expand/collapse, edit,
                                    delete, console, cancel, consoleErrors check.
docs/plans/
  P8-mongo-adapter.md       NEW — this document.
```
