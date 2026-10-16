# P1 — Connections & tree

> Plan for SPEC.md §10 phase **P1**. Authored by Opus, executed by Sonnet.
> Deliverable: *Connection CRUD (fields + URI), colors, adapter interface, **PostgreSQL adapter**, connect/disconnect, lazy cached tree, green dot, tree context menus, filters + panel search, operations panel, L1 metadata cache. Testcontainers harness for Postgres.*
>
> This is the first end-to-end vertical slice. Its job is to prove the adapter shape before five more adapters are written against it. Everything else in the phase exists to exercise that shape.

## 0. Ground rules for this phase

- Build **only** what P1 lists. Read §11 (Out of scope) before starting and again whenever you feel like "just adding" a grid, a tab, or a second adapter.
- Run `bun run lint`, `bun run typecheck` and `bun run test:ui` at the end of each numbered step. From Step 11 on, also `bun run test:db`. A step is done when its acceptance check passes.
- **Never interpolate a database identifier into SQL.** Every catalog query in this phase looks objects up *by name as a bind parameter* against `pg_namespace` / `pg_class`. There is no `quote_ident` string-building anywhere in P1. This is a standing rule for the codebase.

### P0 realities you must work with (verified against the tree, not the P0 plan)

These differ from, or are not stated in, the P0 plan. Do not rediscover them the hard way.

1. **`Db.transaction` is not re-entrant.** `src/main/storage/db.ts` issues raw `BEGIN`/`COMMIT`/`ROLLBACK`. Calling a storage function that opens a transaction from inside another transaction throws `cannot start a transaction within a transaction`. Structure the new storage modules so public functions either open a transaction or are called inside one — never both. Where both are needed, split into `fooTx()` (assumes a transaction) and `foo()` (wraps `fooTx`).
2. **`SqlParam` is `string | number | bigint | null | Uint8Array`** — **no boolean**. Every boolean column (`read_only`, `is_regex`) must be written as `1`/`0` and read back through Zod's `z.coerce`/transform. Passing a JS boolean to `db.run` is a runtime `TypeError` from `node:sqlite`, not a type error in some cases — be explicit.
3. **Renderer panels live in `src/renderer/workbench/panels/`**, not directly under `workbench/` as the P0 plan's target tree drew them. There is also an `EmptyState.vue` there (props: `icon`, `label`, `compact`). Reuse it; do not write new empty states by hand.
4. **There is no `SettingsDialog/sections/` directory** — the dialog is one file with inline `<template v-if>` blocks per section. Follow that pattern if you touch it (you should not need to in P1).
5. **`metadata_cache` already has `UNIQUE (connection_id, path)`** and `ON DELETE CASCADE` from `connections`. So deleting a connection already drops its L1 cache, its filters and its saved queries. No new migration is needed for P1 — the P0 schema is complete for this phase. **Do not add a `0002_*.sql`.** If you think you need one, you are building something out of scope.
6. **`tabs."order"` is quoted everywhere** — irrelevant to P1 (no tabs), listed so you do not touch that table.
7. **IPC channel names live in one `IPC` const object** in `src/shared/protocol/ipc.ts`, keyed camelCase. Extend it; do not scatter string literals.
8. **The Playwright fixture is `kira` / `relaunch` / `consoleErrors`** in `tests/ui/fixtures.ts`, with `KIRA_HOME` isolated under `tmpdir()` and an assertion enforcing that. `consoleErrors` must stay empty in every spec — a Vue warning fails the suite.
9. **`externalizeDepsPlugin()` externalises `dependencies`, bundles `devDependencies`.** `pg` is loaded by the engine at runtime from `node_modules`, so it goes in **`dependencies`**, not `devDependencies`. `zod` is already there and is correct.
10. **Renderer state modules are plain `reactive()`** (D4 of P0, no Pinia). As of this phase they follow SPEC §11's three-way split: state more than one area needs (the active-connection map, the operations ring) lives in the new top-level `src/renderer/state/`; state used by exactly one area stays local to it (`src/renderer/project/state/tree.ts` for the tree's node cache; `src/renderer/workbench/state/{layout,settings,engine,contextMenu}.ts`, unchanged from P0/Step 9). See note 11 below for what this phase does and does not restructure.
11. **This phase begins applying SPEC §11's nested repository layout**, proposed after P0 landed with a flatter one (see SPEC §11's own note there). Per that section's rule — a file migrates only in the phase that actually touches it — P1 restructures exactly what it substantially rewrites (`src/shared/*`, `src/main/ipc.ts`, the storage accessors P1 adds or modifies, `src/engine/ops.ts`, the two new cross-view renderer state modules) and leaves everything else exactly where P0 put it: `src/main/window.ts`, `src/main/menu.ts`, `src/main/log.ts`, `src/main/engine-host.ts`'s location (only its contents change, per D2), `src/renderer/workbench/panels/`, and `src/renderer/workbench/state/{layout,settings,engine}.ts`. Do not "clean up" any of those in passing — that is scope this plan does not budget for, and a later phase that actually touches them is what relocates them.

### Prerequisites to verify before Step 1

```
colima status            # must report a running VM; if not: colima start --cpu 4 --memory 6 --disk 40
docker context ls        # 'colima' must exist
docker info              # must succeed
docker pull postgres:17-alpine
```

**Colima, not Docker Desktop.** The dev machine's Docker-compatible daemon is Colima (`/opt/homebrew/bin/colima`). Every setup and troubleshooting instruction in this plan assumes it. See Step 11a for the Testcontainers environment variables Colima needs — they are not optional and they are the single most likely cause of a "works on the docs, not on the machine" failure in this phase.

---

## 1. Decisions made in this plan

The spec leaves these open. They are decided here — implement as written, do not re-litigate.

| # | Decision | Rationale |
|---|---|---|
| **D1** | **All P1 database traffic is control-plane: renderer → main (`ipcRenderer.invoke`) → engine (`parentPort`) → adapter.** The renderer↔engine MessagePort keeps carrying only `ping` in P1. | Two reasons. (a) **Secrets**: if the renderer initiated `connect`, it would have to hold and send the credentials. Routing connect through main means the renderer never sees a password it did not explicitly ask to reveal. (b) **L1 cache**: the cache is SQLite, which only main can touch, so a tree read is `renderer → main → (cache hit) → return` with zero engine involvement — the fastest possible path and exactly what §7 promises ("instant on launch"). P2 adds port ops for result pages, which are bulk and genuinely need the direct channel; tree nodes and metadata are neither. |
| **D2** | **Main↔engine gets a real request/response channel.** `engine-host.ts` grows `call(op, payload): Promise<T>` over `child.postMessage` with an incrementing id, plus an event stream engine→main for `op:start` / `op:end` / `connection:state`. | The P0 channel is fire-and-forget (`attach-port` only). D1 makes it the primary control path, so it needs correlation ids, timeouts and error propagation. ~80 lines. |
| **D3** | **`Adapter` ships with only the methods P1 implements** (`connect`, `disconnect`, `children`, `describe`, `cancel`) plus `kind` and `caps`. Future methods are *specified* in the normative roadmap table in §4 of this plan, not stubbed in code. | P0's discipline: no scaffolding forward. Declaring `read()` with a placeholder `Page` type in P1 guarantees P2 redesigns it, and an interface with five `throw new Error('not implemented')` bodies is a lie the type system endorses. The roadmap table is binding: P2–P5 add exactly those signatures, so nothing is re-litigated. |
| **D4** | **`Caps`, by contrast, ships complete** — every flag any v1 adapter will need, decided now, including three additions to §5's list (`cancel`, `defaultPageKind`, `pagination`) and one replacement (`pagination` replaces `keysetPagination`). | Caps is a *data* type the UI branches on. Getting it wrong later means touching every adapter and every view. §5.1's mapping table already implies fields §5's `Caps` lacks: S3 has no cancel-free story, Kafka paginates by offset window, Mongo's default view is documents. See §4 for the full type and a per-database fill-in of the whole §5.1 table. |
| **D5** | **`cancel(opId)` is a core `Adapter` method**, not a P2 addition, and `caps.cancel` reports whether it works. | §5.1's closing paragraph: "Cancellation is never 'stop showing the result' — it is always forwarded to the server. If a driver cannot cancel, the capability is absent and the stop button says so rather than lying." That is a P1 contract; the stop button that consumes it is P2's. A tree expansion against a 40k-table catalog is exactly the op you need to be able to kill. |
| **D6** | **Node paths are encoded strings, `kind:name` segments joined by `/`, with `name` percent-encoded.** `NodePath` is `{ connectionId, segments }` in memory; `encodePath` / `decodePath` in `src/shared/domain/tree.ts` are the only conversions. The encoded form excludes the connection id, because `metadata_cache`'s key is already `(connection_id, path)`. | §6's `metadata_cache.path`, `saved_queries.path` and `tabs.path` are all `TEXT`. A canonical, human-diffable, stable string is required. `kind:` prefixes make an encoded path self-describing, so a stale cache row is legible in `sqlite3` and a decode can validate without a schema lookup. |
| **D7** | **In URI mode, the password is extracted out of the URI at save time.** `connections.uri` stores the URI with the userinfo password removed; `connections.password` stores the extracted password. On connect, main re-injects it. | Makes `ConnectionSummary.uri` safe to hand to the renderer verbatim (the *Copy URI* menu item, the dialog, the tree tooltip) with no redaction pass that can be forgotten. Gives exactly one secret channel for the `SecretStore` to own regardless of mode. Re-injection is a mechanical userinfo edit and round-trips. |
| **D8** | **`SecretStore` is an async, connection-id-keyed interface in `src/main/storage/repos/secrets.ts`.** P1's implementation is `PlaintextColumnSecretStore`, backed by `connections.password` per §6. Nothing outside that file reads or writes the column. It lives under `repos/`, not loose in `storage/`, because it is the one file besides `repos/connections.ts` that touches the `connections` table directly — SPEC §11's rule that `repos/` holds "the only files that import the Drizzle instance" applies to it too. | §6 mandates the indirection. Async now so the eventual Keychain implementation (Electron's `safeStorage.encryptString`, which is Keychain-derived and dependency-free — the named future swap) is a one-file change and not an API break. §1 defers credential encryption; do **not** implement it here. |
| **D9** | **The renderer receives `ConnectionSummary`, which has no `password` field at all.** Reading a secret requires an explicit `kira:connections:reveal(id)` call, which main logs. | The connection dialog genuinely must show the password when editing (§8.12 stores plain text and says so). Making that a separate, logged, single-purpose call means every other renderer surface — list, tree, tooltips, op log, copy-URI — is structurally incapable of leaking it. |
| **D10** | **L1 metadata cache lives in main, cache-aside, in the existing `metadata_cache` table.** `kira:tree:children` checks SQLite first and only calls the engine on a miss or an explicit refresh. | Follows from D1. Also means the tree renders from cache while *disconnected*, which is what makes the panel useful on launch (§7, §8.3). |
| **D11** | **On a successful connect, main deletes every `metadata_cache` row for that connection and pushes `kira:connection:metadataInvalidated`; the renderer re-fetches only the paths it currently has expanded.** | §7: "the whole connection's metadata is refreshed on **every reconnect**". A blunt delete alone would blank the tree; re-fetching the expanded set (which the renderer already knows) refreshes without a flash and without walking a catalog the user never opened. |
| **D12** | **Context menus are renderer-drawn** (a `ContextMenu.vue` + a `state/contextMenu.ts` service), not Electron's native `Menu.popup`. | §8.10 needs a checkbox item (Read-only), a submenu of 12 color swatches, and per-item icons — all awkward-to-impossible natively on macOS. Decisively: a native menu is invisible to Playwright, and §9.2 requires asserting "every context menu opening with the right items". One service, per §8.10's "so none is forgotten". |
| **D13** | **Filters are applied in the renderer, at render time, over cached nodes.** They never change what is fetched or cached. | §8.3 draws the line: "filters persist and hide, search is transient". Both are presentation. Applying them server-side would make the L1 cache contents depend on filter state, which is a cache-key bug waiting to happen. |
| **D14** | **`pg` is used with one `Client` per (connection, database)** — not a `Pool` — held in a `Map` on the adapter instance, all closed on `disconnect()`. A separate short-lived `Client` is opened per cancel. | `pg_cancel_backend(pid)` needs a known backend pid; with a Pool you do not reliably know which backend ran your query. One client per database also makes the multi-database tree (§5.1: `database → schema → …`) work at all, since a Postgres connection is bound to one database. P2 revisits this if concurrency demands it. |
| **D15** | **Postgres tree: system schemas are hidden**, and a schema's children are the objects themselves — **no `Tables` / `Views` folder nodes**. | §5.1's level list is flat: `database → schema → tables/views/matviews/functions/sequences`. Folders are a P6 presentation polish; `NodeKind` has no `folder` member in P1. |
| **D16** | **A table node expands to its columns**, sourced from the same `describe()` result that feeds L1. | Cheapest possible end-to-end proof that `describe` and the metadata cache work, it is what §8.10's "Column (tree)" row implies exists, and P2/P7 need column metadata cached anyway. |
| **D17** | **`ObjectMeta` carries `referencedBy` (inbound FKs) as well as `foreignKeys`.** | One flipped `WHERE` clause in the same `pg_constraint` query. P7's FK navigation needs the reverse edge and would otherwise force a metadata cache format change and a full re-fetch across every connection. Cost now: zero. |
| **D18** | **Connection color is stored as a palette *name*** (`'red' … 'grey'`), never a hex string, and resolved to `var(--kira-conn-<name>)` in CSS. | The twelve tokens already exist in `tokens.css` from P0. Storing names means a future palette re-tune restyles existing connections instead of stranding them on dead hexes. |
| **D19** | **`op_log` is written by main**, from `op:start` / `op:end` events the engine emits. The renderer keeps a capped in-memory ring (500 entries) hydrated from `op_log` at startup. Retention pruning (30 days, hard cap 20 000 rows) runs once at startup. Split across two files per SPEC §11: `src/main/storage/repos/ops.ts` is the plain CRUD (`appendOp`/`finishOp`/`recentOps`/`pruneOps`) and the only file that touches the `op_log` table; `src/main/oplog.ts` is the orchestration — subscribes to the engine's events, calls the repo, forwards `kira:op:update`, calls `pruneOps` once at startup — matching §11's explicit top-level `main/oplog.ts` listing. | Main owns SQLite (P0 D2) and is already "the single source of truth for state and logging" (§4). §8.11 requires the panel be "capped in memory, persisted to `op_log` with retention". |
| **D20** | **`OpCtx` gains `setCommand(text)`.** The adapter reports the exact statement it is about to run; that string is what lands in `op_log.command` and in the operations panel. | §8.11's `command` column must show the real statement, and §9.1 requires "command preview correctness". Deriving it anywhere but inside the adapter would mean guessing. |
| **D21** | **DB integration tests run under `bun test` via a new `test:db` script**, in `tests/db/`, separate from the Playwright `tests/ui/` suite. | §3 names Bun as the test runner; §9's "two suites only" maps cleanly onto two scripts. Adapters import nothing from `electron`, so they are directly importable by a plain Bun process. See the risk register for the fallback if `dockerode` misbehaves under Bun. |
| **D22** | **UI specs that need a live database start their own Testcontainers Postgres** (reusing `tests/db/support/postgres.ts`) and **skip with a Colima-naming reason** if the Docker daemon is unreachable. Connection-CRUD specs that need no database never skip. | §9.2 wants the real UI against real containers, but a developer with a stopped Colima VM should get a legible skip on the DB-backed specs, not a wall of red on all of them. |

---

## 2. Target tree at the end of P1

New and modified files only; everything else from P0 is untouched.

Paths below follow SPEC §11's nested layout (see ground-rule note 11): P1 is the first phase to
substantially touch `shared/`, `main/ipc.ts`, the storage accessors, and `engine/ops.ts`, so it is the
one that moves them into the proposed shape. Everything P1 does not touch stays exactly where P0 left
it — `main/window.ts`, `main/menu.ts`, `main/log.ts`, `main/engine-host.ts`'s location,
`renderer/workbench/panels/`, `renderer/workbench/state/{layout,settings,engine}.ts`.

```
package.json                                    + pg, testcontainers, @types/pg; + test:db script
src/
  shared/
    caps.ts                          NEW  Caps, PageKind, PaginationStrategy, per-kind cap tables
    domain/                          NEW  (SPEC §11's shared/domain/ — "what the concepts mean")
      connection.ts                       Zod: kind, color, mode, ConnectionRecord/Input/Summary, state
      tree.ts                             NodeKind, NodePath, encode/decodePath, TreeNode, ObjectMeta (+Zod)
      ops.ts                               OpRecord (op_log row) + Zod, OpKind, OpStatus
      uri.ts                               parse/format/redact/inject for connection URIs (+Zod)
    protocol/                        NEW  (SPEC §11's shared/protocol/ — "bytes on the wire")
      ipc.ts                              MOD, moved from the flat src/shared/ipc.ts P0 left; new
                                           channel names + KiraApi methods
      port.ts                             — NOT moved: P1 does not touch it, stays at src/shared/port.ts
                                           (note 11 — only a phase that touches a file relocates it)
      engine-ops.ts                       NEW  main<->engine op names + payload types/schemas
  main/
    ipc/                              NEW  (SPEC §11's main/ipc/ — one file per domain + registry.ts,
                                           replacing the single growing src/main/ipc.ts)
      registry.ts                         NEW  wires every domain's handlers into ipcMain
      app.ts                              MOD  moved from ipc.ts: kira:app:info
      settings.ts                         MOD  moved from ipc.ts: kira:settings:*
      layout.ts                           MOD  moved from ipc.ts: kira:layout:*
      engine.ts                           MOD  moved from ipc.ts: kira:engine:status
      connections.ts                      NEW  the P1 connections channels
      tree.ts                             NEW  the P1 tree channels
      filters.ts                          NEW  the P1 filters channels
      ops.ts                               NEW  the P1 ops channels
    engine-host.ts                   MOD  request/response `call()`, event stream, D2 — stays top-level,
                                           only its contents change
    connections.ts                   NEW  CRUD orchestration: storage + secrets + engine + state
    tree-service.ts                  NEW  L1 cache-aside for children/describe (D10)
    oplog.ts                         NEW  subscribes engine op:start/op:end, forwards kira:op:update,
                                           calls pruneOps at startup (D19) — SPEC §11's top-level
                                           main/oplog.ts, distinct from the repo below
    storage/
      repos/                          NEW  (SPEC §11's storage/repos/ — "the only files that import
                                           the Drizzle instance"; one file per table)
        settings.ts                       MOD  moved from storage/settings.ts (P0)
        layout.ts                         MOD  moved from storage/layout.ts (P0)
        connections.ts                     NEW  connections table accessors (Zod-validated)
        secrets.ts                         NEW  SecretStore interface + PlaintextColumnSecretStore (D8)
        filters.ts                         NEW  connection_filters accessors
        metadata-cache.ts                  NEW  metadata_cache accessors
        ops.ts                              NEW  op_log append/query/prune (D19) — the repo half; the
                                           orchestration half is main/oplog.ts above
  engine/
    index.ts                         MOD  route control frames to control.ts
    control.ts                       NEW  main<->engine dispatch, connection registry — stays top-level,
                                           sibling to main/connections.ts's orchestration role
    scheduler/                       NEW  (SPEC §11's engine/scheduler/ — "op lifecycle, cancellation,
                                           progress — driver-agnostic")
      ops.ts                              NEW  runOp(): opId, AbortController, op:start/op:end, cancel
                                           registry
    adapters/
      adapter.ts                     NEW  Adapter, OpCtx, AdapterFactory, ConnectInfo (D3)
      registry.ts                    NEW  kind -> factory
      errors.ts                      NEW  AdapterError + codes
      postgres/
        index.ts                     NEW  the adapter: connect/disconnect/children/describe/cancel
        client.ts                    NEW  per-database pg.Client map, config building (D14)
        query.ts                     NEW  cancellable query helper (exported for tests)
        catalog.ts                   NEW  the catalog SQL, one function per level
        caps.ts                      NEW  the Postgres Caps literal
  renderer/
    env.d.ts                         MOD  (nothing — KiraApi is imported from @shared/protocol/ipc)
    bridge/control.ts                MOD  wrappers for the new channels
    state/                           NEW  (SPEC §11's renderer/state/ — cross-view app state; its own
                                           examples are "active connection" and "op log ring")
      connections.ts                      records, states, dialog open/edit target
      ops.ts                               operations ring buffer + filters
    project/                         NEW  (SPEC §11's renderer/project/)
      ProjectTree.vue                     virtualized tree body
      TreeRow.vue                         one row: twisty, icon, color rail, dot, label, detail
      SearchBox.vue                       §8.3 search over cached nodes
      ConnectionDialog.vue                §8.12 fields/URI dialog
      ColorPicker.vue                     12 swatches
      FiltersDialog.vue                   §8.3 hide/show rules
      icons.ts                            NodeKind + column type -> codicon name
      filter.ts                           glob/regex matching + rule evaluation (D13)
      state/
        tree.ts                           node cache, expansion set, loading/error per path, search —
                                           stays local to project/: nothing outside the tree reads it
    workbench/
      ContextMenu.vue                NEW  renderer-drawn menu + submenu (D12) — stays in workbench/,
                                           SPEC §11 names "context-menu service" as one of its jobs
      VirtualList.vue                NEW  fixed-row-height windowing, used by tree and op panel
      StatusBar.vue                  MOD  "● N connected" indicator (§8.1)
      state/
        contextMenu.ts               NEW  the single ContextMenu service (§8.10)
      panels/
        ProjectPanel.vue             MOD  header + search + tree, replacing the empty state
        OperationsPanel.vue          MOD  real table, replacing the empty state
tests/
  db/                                NEW
    support/
      docker.ts                           Colima socket resolution + daemon availability probe
      postgres.ts                         container start/stop + seeded config
    fixtures/
      0001_seed.sql                       the §9.1 dataset
    postgres.spec.ts                      P1 scenarios (§9.1 subset)
  ui/
    support/pg.ts                    NEW  shares tests/db/support/postgres.ts with Playwright
    connections.spec.ts              NEW  CRUD, colors, URI round-trip, persistence — no container
    tree.spec.ts                     NEW  connect, expand, cache, context menus — container-backed
docs/plans/P1-connections-and-tree.md     (this file)
```

---

## 3. Shared contracts (Step 1 writes these; the rest of the plan refers back)

### 3a. `src/shared/domain/tree.ts`

```ts
export const nodeKindSchema = z.enum([
  'connection', 'database', 'schema',
  'table', 'view', 'matview', 'function', 'sequence',
  'column',
]);
export type NodeKind = z.infer<typeof nodeKindSchema>;

export interface PathSegment { kind: NodeKind; name: string }
export interface NodePath { connectionId: string; segments: PathSegment[] }

// 'schema:public/table:order%2Fitems' — the connection id is not part of the string (D6).
export function encodePath(segments: PathSegment[]): string
export function decodePath(connectionId: string, encoded: string): NodePath
export function pathParent(encoded: string): string | null
export function pathTail(encoded: string): PathSegment | null
```

`encodePath([])` is `''` — the connection root. `decodePath` throws on an unknown `kind` or a malformed segment; callers treat that as a corrupt cache row and drop it.

```ts
export const treeNodeSchema = z.object({
  kind: nodeKindSchema,
  name: z.string(),                    // the raw identifier, used to build SQL and to copy
  path: z.string(),                    // encoded, relative to the connection
  hasChildren: z.boolean(),
  detail: z.string().optional(),       // muted right-aligned text: type, row estimate, signature
  badges: z.array(z.string()).optional(), // e.g. ['PK'], ['UNIQUE']
});
export type TreeNode = z.infer<typeof treeNodeSchema>;

export const columnMetaSchema = z.object({
  name: z.string(), position: z.number(), dataType: z.string(),
  nullable: z.boolean(), defaultExpr: z.string().nullable(),
  isPrimaryKey: z.boolean(), comment: z.string().nullable(),
});
export const indexMetaSchema = z.object({
  name: z.string(), columns: z.array(z.string()),
  unique: z.boolean(), primary: z.boolean(), method: z.string().nullable(),
});
export const foreignKeyMetaSchema = z.object({
  name: z.string(), columns: z.array(z.string()),
  referencedPath: z.string(),          // encoded path of the referenced table (P7)
  referencedColumns: z.array(z.string()),
  onDelete: z.string().nullable(), onUpdate: z.string().nullable(),
});
export const objectMetaSchema = z.object({
  path: z.string(), kind: nodeKindSchema, name: z.string(), qualifiedName: z.string(),
  columns: z.array(columnMetaSchema),
  primaryKey: z.array(z.string()).nullable(),
  foreignKeys: z.array(foreignKeyMetaSchema),
  referencedBy: z.array(foreignKeyMetaSchema),   // D17
  indexes: z.array(indexMetaSchema),
  rowEstimate: z.number().nullable(),
  comment: z.string().nullable(),
});
export type ObjectMeta = z.infer<typeof objectMetaSchema>;
```

Both schemas are used to parse `metadata_cache.payload_json` on read-back (§6's rule). A row that fails to parse is **deleted and treated as a miss** — never surfaced as an error.

### 3b. `src/shared/domain/connection.ts`

```ts
export const connectionKindSchema = z.enum([
  'postgres', 'mariadb', 'mongodb', 'redis', 'kafka', 'sqs', 's3',
]);                                   // all v1 kinds; only 'postgres' has an adapter in P1
export const connectionColorSchema = z.enum([
  'red','orange','amber','olive','green','teal','cyan','blue',
  'indigo','violet','magenta','grey',
]);                                   // D18; matches --kira-conn-* in tokens.css
export const connectionModeSchema = z.enum(['fields', 'uri']);

export const connectionInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: connectionKindSchema,
  color: connectionColorSchema,
  mode: connectionModeSchema,
  readOnly: z.boolean(),
  host: z.string().trim().nullable(),
  port: z.number().int().min(1).max(65535).nullable(),
  database: z.string().nullable(),
  username: z.string().nullable(),
  password: z.string().nullable(),    // present on the way IN only; never on the way OUT (D9)
  uri: z.string().nullable(),
  options: z.record(z.string(), z.unknown()),
}).superRefine(/* mode==='fields' requires host+port; mode==='uri' requires a parseable uri */);

export type ConnectionInput = z.infer<typeof connectionInputSchema>;

// What the renderer gets. Note the absence of `password` — this is D9 enforced by the type.
export const connectionSummarySchema = connectionInputSchema
  .omit({ password: true })
  .extend({ id: z.string(), sortOrder: z.number(), createdAt: z.string(), updatedAt: z.string() });
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

export const connectionStateSchema = z.object({
  connectionId: z.string(),
  status: z.enum(['disconnected', 'connecting', 'connected', 'error']),
  serverVersion: z.string().nullable(),
  error: z.string().nullable(),
  since: z.number(),                  // epoch ms
});
export type ConnectionState = z.infer<typeof connectionStateSchema>;
```

`ResolvedConnectionConfig` (main → engine only, never renderer-visible) is `ConnectionSummary` plus `password: string | null` plus `uri` with the password re-injected (D7). Declare it in `src/shared/protocol/engine-ops.ts`, not `connection.ts`, so it is obvious that only the engine channel carries it.

### 3c. `src/shared/domain/uri.ts`

```ts
export interface ParsedUri {
  scheme: string; host: string | null; port: number | null;
  database: string | null; username: string | null; password: string | null;
  params: Record<string, string>;
}
export function parseConnectionUri(uri: string): ParsedUri | null    // null = unparseable
export function formatConnectionUri(input: Omit<ConnectionInput,'uri'|'mode'>): string
export function stripUriPassword(uri: string): { uri: string; password: string | null }  // D7
export function injectUriPassword(uri: string, password: string | null): string          // D7
export function canRoundTripToFields(parsed: ParsedUri, kind: ConnectionKind): boolean
```

Implementation notes:
- Use WHATWG `new URL()`. It populates `username`/`password`/`hostname`/`port`/`pathname` for non-special schemes such as `postgres:` and `postgresql:`. Wrap in try/catch and return `null` on throw.
- `canRoundTripToFields` is **false** when: the scheme is not `postgres`/`postgresql`, the host section contains a comma (multi-host), the host is empty or begins with `/` (unix socket path), or the userinfo contains characters that do not survive `encodeURIComponent` round-tripping. When false, §8.12's rule applies: the dialog **stays in URI mode**.
- `params` come from `searchParams`; they are stored into `connections.options_json`, so a `?sslmode=require` survives a fields↔URI flip.

### 3d. `src/shared/domain/ops.ts`

```ts
export const opKindSchema  = z.enum(['connect','disconnect','children','describe','test']);
export const opStatusSchema = z.enum(['running','ok','error','cancelled']);
export const opRecordSchema = z.object({
  id: z.string(), connectionId: z.string().nullable(), tabId: z.string().nullable(),
  startedAt: z.string(), durationMs: z.number().nullable(),
  kind: opKindSchema, status: opStatusSchema,
  rows: z.number().nullable(), command: z.string().nullable(), error: z.string().nullable(),
});
export type OpRecord = z.infer<typeof opRecordSchema>;
```

`opKind` grows in P2 (`read`, `count`) and P5 (`mutate`) — do not add those members now.

---

## 4. The adapter model (the consequential part)

Everything below lands in Step 4. Read this section before writing any of it.

### 4a. `Caps` (D4) — `src/shared/caps.ts`

```ts
export type PageKind = 'tabular' | 'document' | 'keyvalue' | 'stream';

export type PaginationStrategy =
  | 'keyset'        // ordered by a unique key; LIMIT/OFFSET fallback when there is no key
  | 'offset'        // LIMIT/OFFSET only
  | 'cursor'        // driver-side cursor (Redis SCAN, Mongo cursor)
  | 'token'         // opaque continuation token (S3)
  | 'offsetWindow'  // explicit begin/end offsets per partition (Kafka)
  | 'batch';        // receive-a-batch, no addressable position (SQS)

export interface Caps {
  // ---- shape: what view the UI reaches for, and what a page looks like
  tabular: boolean;
  documents: boolean;
  keyValue: boolean;
  stream: boolean;
  defaultPageKind: PageKind;      // §5.1 "Default view" column — ADDED to §5's list (D4)

  // ---- language surfaces
  sql: boolean;                   // gates §8.14's query console menu item
  ddl: boolean;                   // gates §8.10's "Open DDL"

  // ---- read pushdown
  projection: boolean;            // can fetch a column subset server-side
  serverFilter: boolean;          // can push a predicate server-side
  exactCount: boolean;            // can produce a true count, not an estimate
  pagination: PaginationStrategy; // REPLACES §5's `keysetPagination: boolean` (D4)

  // ---- graph + writes
  foreignKeys: boolean;
  writable: boolean;
  transactions: boolean;

  // ---- lifecycle
  cancel: boolean;                // can forward a cancel to the server — ADDED (D4, D5)
}
```

Three deviations from §5, all recorded in D4:
- **`keysetPagination: boolean` → `pagination: PaginationStrategy`.** A boolean cannot express S3's continuation token, Kafka's offset window or SQS's non-addressable batches; §5.1's Pagination column already has five distinct answers. Keeping both a boolean and a strategy would be redundant state that can disagree.
- **`+ defaultPageKind`.** §5 correctly says the UI picks a view from the *page kind*, not the database type — but the tree needs to know what "Open data" will produce *before* it issues the read, to pick an icon and a tab kind. This is that, and only that.
- **`+ cancel`.** Required by §5.1's closing paragraph. Without it the stop button either lies or has to sniff for a method.

The whole of §5.1, filled in, as a comment block in `caps.ts` — this is the map every later adapter is written against, so write it down once:

| kind | tree levels | defaultPageKind | pagination | exactCount | cancel mechanism | sql | ddl | foreignKeys |
|---|---|---|---|---|---|---|---|---|
| postgres | database → schema → table/view/matview/function/sequence → column | tabular | keyset | yes | `pg_cancel_backend(pid)`, side connection | yes | yes | yes |
| mariadb | database → table/view/routine → column | tabular | keyset | yes | `KILL QUERY <threadId>`, side connection | yes | yes | yes |
| mongodb | database → collection (+ indexes) | document | cursor | estimate only | cursor `AbortSignal`, `killOp` fallback | yes (shell-style) | no | **no** (§8.5) |
| redis | db index → key namespace (split on `:`) | keyvalue | cursor (`SCAN`) | no (`DBSIZE` approx) | abort the SCAN loop; `CLIENT KILL` | yes (commands) | no | no |
| kafka | cluster → topics, consumer groups | stream | offsetWindow | yes (end − begin) | stop consumer + `AbortSignal` | no | no | no |
| sqs | region → queues | stream | batch | no (`ApproximateNumberOfMessages`) | SDK `AbortSignal` | no | no | no |
| s3 | account → bucket → prefix/object (lazy, `/`-delimited) | keyvalue | token | no | SDK `AbortController` | no | no | no |

**Only the postgres row is implemented in P1.** The table is documentation, not code — do not create the other adapters' cap literals.

### 4b. `Adapter` — `src/engine/adapters/adapter.ts`

```ts
export interface Progress { message?: string; done?: number; total?: number }

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

export interface Adapter {
  readonly kind: ConnectionKind;
  readonly caps: Caps;

  connect(cfg: ResolvedConnectionConfig, ctx: OpCtx): Promise<ConnectInfo>;
  disconnect(): Promise<void>;

  /** One lazy tree level. `path.segments` is empty for the connection root. Widened in P43
   *  iteration 2 (D21 of that phase's plan) — see the roadmap table below. */
  children(path: NodePath, ctx: OpCtx): Promise<TreeChildren>;

  /** Columns, PK, FK, inbound FK, indexes for one object. Feeds the L1 cache. */
  describe(path: NodePath, ctx: OpCtx): Promise<ObjectMeta>;

  /**
   * Forward a cancel for an in-flight op to the server (D5).
   * Returns false when the op was unknown or the server refused; never throws for
   * "already finished". Adapters with caps.cancel === false return false unconditionally.
   */
  cancel(opId: string): Promise<boolean>;
}

export type AdapterFactory = (deps: AdapterDeps) => Adapter;
export interface AdapterDeps {
  log(level: 'info' | 'warn' | 'error', message: string): void;
}
```

**Adapter roadmap (normative, D3).** Each later phase adds exactly these members. Do not add them early; do not change the signatures without amending this table.

| Phase | Added to `Adapter` | Gated by |
|---|---|---|
| P2 | `read(req: ReadRequest, ctx: OpCtx): Promise<Page>` where `Page` is the discriminated union `TabularPage \| DocumentPage \| KeyValuePage \| StreamPage` keyed on `kind: PageKind` | always present |
| P2 | `count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }>` | `caps.exactCount` decides `exact`; the method is always present |
| P4 | `ddl(path: NodePath, ctx: OpCtx): Promise<SourceText>` | `caps.ddl` |
| P5 | `preview(plan: MutationPlan): string[]` — **synchronous, never executes** | `caps.writable` |
| P5 | `mutate(plan: MutationPlan, ctx: OpCtx): Promise<MutationResult>` | `caps.writable` |
| P5.5 | `execute(req: ConsoleRequest, ctx: OpCtx): Promise<Page[]>` | `caps.sql` |
| P33 | `downloadObject(req: ObjectDownloadRequest, ctx: OpCtx): Promise<ObjectTransferResult>` — streams one object's bytes to a local path; a **read**, never blocked by the connection's read-only flag | `caps.fileTransfer` |
| P43 iter2 | `children()`'s return type widens from `TreeNode[]` to `TreeChildren = { nodes: TreeNode[]; truncated?: boolean }` — `truncated` is set only by `redis`/`s3` (the two adapters whose catalog listing has its own round budget, `MAX_SCAN_ROUNDS`/`MAX_LIST_ROUNDS`) when that budget cut the level short; the other eight adapters return `{ nodes }` unchanged. `main/tree-service.ts` never persists a truncated level to `metadata_cache` (P43 iter2 D22), so a `source: 'cache'` `TreeChildrenResult` is always complete. This is the first amendment to this table since P33 — see `docs/v1/plans/P43-functionality-review-iter2.md` D21/D22/D23 for the full finding and rationale. | always present (the field itself); `truncated` only ever appears for `redis`/`s3` |

Rules that hold for every adapter, present and future — put them as a doc comment at the top of `adapter.ts`:

1. **An adapter imports nothing from `electron`.** It is a plain Node module. This is what makes `tests/db/` able to import it directly (D21) and what would let a connection move to its own process later (§4).
2. **Every method that talks to the server takes an `OpCtx` and honours `ctx.signal`.** A method that ignores the signal is a bug even if the underlying driver "is fast".
3. **`ctx.setCommand()` is called before the statement is issued**, not after it returns — an op that is cancelled mid-flight must still show what it was running.
4. **Errors are thrown as `AdapterError`** (`src/engine/adapters/errors.ts`) with a `code` from a closed set (`E_CONNECT`, `E_AUTH`, `E_CANCELLED`, `E_TIMEOUT`, `E_NOT_FOUND`, `E_QUERY`, `E_UNSUPPORTED`) and the server's own message **verbatim** in `message`. §8.5 and §8.14 both require unmodified server errors; wrapping starts here.
5. **`children()` returns `{ nodes: [] }` for a leaf, never throws** (P43 iter2: `{ nodes: [] }`, not the bare `[]` this rule originally said — the roadmap table's own widening). `hasChildren` on the parent is the adapter's promise; getting it wrong shows a twisty that expands to nothing, which is a bug to fix in the parent's query, not to paper over.
6. **An adapter is single-connection.** One instance ↔ one `connections` row. The registry in `src/engine/control.ts` owns the `Map<connectionId, Adapter>`.

### 4c. `src/engine/scheduler/ops.ts`

```ts
export async function runOp<T>(
  spec: { connectionId: string | null; kind: OpKind },
  fn: (ctx: OpCtx) => Promise<T>,
): Promise<{ opId: string; value: T }>
```

- Generates `opId` (`crypto.randomUUID()`), creates an `AbortController`, registers it in a module-level `Map<string, { controller, connectionId }>`.
- Emits `op:start` to main immediately: `{ opId, connectionId, kind, startedAt }`.
- On settle, emits `op:end`: `{ opId, status, durationMs, rows, command, error }`. `rows` is `null` unless the caller sets it via a returned setter — for P1, `children` sets it to the node count and `describe` to the column count, so the operations panel has something meaningful in the column.
- Deregisters the controller in a `finally`.
- `cancelOp(opId)`: aborts the controller **and** calls `adapter.cancel(opId)` for the owning connection. Both, in that order — the abort unblocks the local await, the adapter call kills the server-side work (§5.1: cancellation is always forwarded).

---

## Step 1 — Shared contracts and Zod schemas

**Files:** `src/shared/caps.ts`, `src/shared/domain/{connection,tree,uri,ops}.ts`, `src/shared/protocol/engine-ops.ts` (new), `src/shared/protocol/ipc.ts` (moved from `src/shared/ipc.ts`, mod)

Write §3 and §4a of this plan verbatim as code. No behaviour, no imports from `main`/`engine`/`renderer`.

`src/shared/protocol/engine-ops.ts` declares the main↔engine wire (D2):

```ts
export const ENGINE_OP = {
  connect: 'adapter:connect',
  disconnect: 'adapter:disconnect',
  children: 'adapter:children',
  describe: 'adapter:describe',
  test: 'adapter:test',
  cancel: 'adapter:cancel',
} as const;

export const ENGINE_EVENT = {
  opStart: 'op:start',
  opEnd: 'op:end',
  connectionState: 'connection:state',
} as const;

export interface ResolvedConnectionConfig { /* ConnectionSummary + password + uri-with-password */ }

// One Zod schema per request and per event payload. The engine parses every inbound frame;
// main parses every inbound event. Both are trust boundaries (§3).
```

`src/shared/protocol/ipc.ts` (relocated from the flat `src/shared/ipc.ts` P0 left, per note 11) gains the P1 channels and the matching `KiraApi` methods:

```
kira:connections:list        () -> ConnectionSummary[]
kira:connections:create      (ConnectionInput) -> ConnectionSummary
kira:connections:update      ({ id, input: ConnectionInput }) -> ConnectionSummary
kira:connections:duplicate   ({ id }) -> ConnectionSummary
kira:connections:delete      ({ id }) -> void
kira:connections:reorder     ({ ids: string[] }) -> ConnectionSummary[]
kira:connections:reveal      ({ id }) -> { password: string | null }        // D9, logged
kira:connections:test        ({ input: ConnectionInput }) -> { ok: boolean; serverVersion?: string; error?: string }
kira:connections:connect     ({ id }) -> ConnectionState
kira:connections:disconnect  ({ id }) -> ConnectionState
kira:connections:states      () -> ConnectionState[]
kira:tree:children           ({ connectionId, path, refresh?: boolean })
                             -> { nodes: TreeNode[]; source: 'cache' | 'server' }
kira:tree:describe           ({ connectionId, path, refresh?: boolean })
                             -> { meta: ObjectMeta; source: 'cache' | 'server' }
kira:tree:invalidate         ({ connectionId, path?: string }) -> void
kira:filters:list            ({ connectionId }) -> ConnectionFilter[]
kira:filters:replace         ({ connectionId, filters: ConnectionFilterInput[] }) -> ConnectionFilter[]
kira:ops:recent              ({ limit }) -> OpRecord[]
kira:ops:cancel              ({ opId }) -> void
```
Main → renderer pushes: `kira:connection:state`, `kira:connection:metadataInvalidated`, `kira:op:update`.

**Acceptance:** `bun run typecheck` passes with the new files imported by nothing. Add a throwaway assertion in a scratch spec (delete it before committing) that `encodePath(decodePath('c', 'schema:pub%2Flic/table:t').segments) === 'schema:pub%2Flic/table:t'`.

---

## Step 2 — Storage: connections, secrets, filters, metadata cache, op log

**Files:** `src/main/storage/repos/{connections,secrets,filters,metadata-cache,ops}.ts`

**No migration.** The P0 schema already has every table and index P1 needs (see §0 note 5).

### 2a. `repos/secrets.ts` (D8)

```ts
export interface SecretStore {
  get(connectionId: string): Promise<string | null>;
  set(connectionId: string, secret: string | null): Promise<void>;
  delete(connectionId: string): Promise<void>;
}
export function createSecretStore(db: Db): SecretStore   // returns PlaintextColumnSecretStore
```

The implementation reads and writes `connections.password` and **nothing else in the codebase may reference that column** — enforce it by never selecting `password` in `storage/repos/connections.ts`'s queries. Add the one-line comment naming `safeStorage.encryptString` as the intended replacement and §1's deferral as the reason it is not used yet.

### 2b. `connections.ts`

- Row schema: a Zod schema that parses the SQLite row shape (snake_case, integers for booleans) and transforms it into `ConnectionSummary` (camelCase, real booleans, `options_json` parsed). A row that fails to parse is **logged and skipped**, not thrown — one hand-mangled row must not make the app unlaunchable. (This is a deliberate divergence from `settings.ts`/`layout.ts`, which throw: there, a bad row means the whole app has no settings; here it means one connection is broken.)
- `listConnections(db): ConnectionSummary[]` — ordered by `sort_order, name`.
- `getConnection(db, id): ConnectionSummary | null`
- `insertConnection`, `updateConnection`, `deleteConnection`, `reorderConnections(ids)`.
- `sort_order` on insert = `max(sort_order) + 1`.
- Booleans → `1`/`0` (§0 note 2). `options` → `JSON.stringify`.
- These functions **do not** touch `password`; the caller pairs them with the `SecretStore` (see Step 6a).

### 2c. `filters.ts`

`connection_filters(id, connection_id, node_kind, pattern, is_regex, action)`.

```ts
export interface ConnectionFilter {
  id: string; connectionId: string;
  nodeKind: 'database' | 'schema' | 'table';   // §8.3: databases/schemas/tables
  pattern: string; isRegex: boolean; action: 'hide' | 'show';
}
listFilters(db, connectionId): ConnectionFilter[]
replaceFilters(db, connectionId, inputs): ConnectionFilter[]   // delete-all + insert, one transaction
```
Replace-whole-set rather than per-row CRUD: the dialog edits a list and saves it, and the set is tiny.

### 2d. `metadata-cache.ts` (D10)

```ts
export type MetaKind = 'children' | 'describe';
getCached(db, connectionId, path, kind): unknown | null        // JSON.parse'd, NOT validated here
putCached(db, connectionId, path, kind, payload): void
dropCached(db, connectionId, path?): void                      // path omitted = whole connection
countCached(db, connectionId): number
```

- The unique index is `(connection_id, path)` — `kind` is **not** part of the key. So a `children` payload and a `describe` payload for the same path would collide. **Resolution: store both under one row**, as `{ children?: TreeNode[]; describe?: ObjectMeta }` in `payload_json`, with `kind` set to whichever was written last (it becomes informational). `putCached` therefore reads-modify-writes the existing row inside one transaction. This avoids a migration and keeps one row per node, which is also what makes `dropCached` cheap.
- `fetched_at` is an ISO string; `etag` stays `NULL` in P1 (no adapter produces one).
- **Size guard:** a payload whose JSON exceeds **4 MB** is not cached — return without writing and log at `warn`. A schema with 200 000 relations should degrade to "slow expand" rather than to a bloated SQLite file. This is L1's only size story; see §7 discussion in Step 6c.
- **No TTL, no LRU, no eviction timer.** §7 is explicit: entries die when the connection is deleted (already handled by `ON DELETE CASCADE`), when the connection reconnects (D11), or on a manual *Refresh*.

### 2e. `repos/ops.ts` (D19)

```ts
appendOp(db, record: OpRecord): void          // INSERT with status 'running'
finishOp(db, id, patch): void                 // UPDATE status/duration/rows/error
recentOps(db, limit): OpRecord[]              // ORDER BY started_at DESC LIMIT ?
pruneOps(db): void                            // older than 30 days, then hard cap 20 000 rows
```
Pure CRUD — the only file that touches `op_log` through Drizzle. The orchestration that decides *when*
to call these (subscribing to engine events, calling `pruneOps` once at startup) is `src/main/oplog.ts`,
covered in Step 6d. Rows are parsed back through `opRecordSchema` on read; unparseable rows are skipped.

**Acceptance:** a scratch script (or a temporary Playwright `app.evaluate`) inserts, lists, updates and deletes a connection and a filter set; `sqlite3` shows the expected rows; deleting the connection cascades its filters and cache rows away. `bun run lint && bun run typecheck` green.

---

## Step 3 — Main↔engine request/response channel (D2)

**Files:** `src/main/engine-host.ts` (mod), `src/engine/index.ts` (mod), `src/engine/control.ts` (new)

### 3a. `engine-host.ts`

Extend the returned `EngineHost`:

```ts
export interface EngineHost {
  status(): { alive: boolean; pid: number | null };
  attachRendererPort(port: MessagePortMain, generation: number): void;
  call<T>(op: string, payload: unknown, timeoutMs?: number): Promise<T>;
  on(event: string, handler: (payload: unknown) => void): () => void;
  stop(): void;
}
```

- `call` posts `{ kind: 'req', id, op, payload }` and resolves from `child.on('message')` on `{ kind: 'res', id, ok, ... }`. Default timeout **30 s**; `connect` and `test` pass **20 s** explicitly (a hung TCP connect must not sit for 30).
- `on` subscribes to `{ kind: 'evt', topic, payload }` frames. Reuse the envelope shapes already in `src/shared/port.ts` — they are generic and the second envelope §4 warned against inventing is exactly what we are avoiding.
- **On engine exit**: reject every pending `call` with `E_ENGINE_DOWN`, and emit a synthetic `connection:state` `{status:'error', error:'engine process exited'}` for every connection main believes is connected. Without this the tree hangs forever on a crashed engine. Still **no auto-respawn** (P0 deferred it and P1 has connections to restore, which is a policy question — record it in the risk register, do not build it).

### 3b. `engine/index.ts` + `engine/control.ts`

`index.ts` keeps the port handling exactly as it is and forwards every non-`attach-port` frame to `control.handleFrame`. `control.ts`:

- Owns `const adapters = new Map<string, Adapter>()` and `const states = new Map<string, ConnectionState>()`.
- Dispatch table over `ENGINE_OP`, each handler parsing its payload with the Zod schema from `shared/protocol/engine-ops.ts` **before** use.
- `emit(topic, payload)` → `process.parentPort.postMessage({ kind: 'evt', topic, payload })`.
- Every handler that touches the server wraps its body in `runOp` (Step 4c / `engine/scheduler/ops.ts`).
- `adapter:connect`: if a live adapter exists for that id, disconnect it first (a reconnect is a disconnect + connect, never two clients). Build the adapter from the registry by `cfg.kind`; a kind with no registered factory throws `E_UNSUPPORTED` with the message `"<kind> connections are not supported yet"` — which is exactly what the UI should show for a MariaDB row in P1.

**Acceptance:** a temporary `adapter:test` handler that returns `{ ok: true }` for a hardcoded config is callable from an `ipcMain.handle` and returns to the renderer; killing the engine (`kill <pid>`) makes an in-flight call reject within 100 ms rather than hanging.

---

## Step 4 — Adapter interface, registry, ops

**Files:** `src/engine/adapters/{adapter,registry,errors}.ts`, `src/engine/scheduler/ops.ts`

Write §4b and §4c of this plan verbatim. `registry.ts` is:

```ts
const factories: Partial<Record<ConnectionKind, AdapterFactory>> = {
  postgres: createPostgresAdapter,   // Step 5
};
export function createAdapter(kind: ConnectionKind, deps: AdapterDeps): Adapter
```
Explicit object literal, not dynamic import — a v1 with seven adapters is not big enough to justify lazy loading, and `externalizeDepsPlugin` handles keeping the drivers out of the bundle.

`errors.ts`:
```ts
export type AdapterErrorCode =
  | 'E_CONNECT' | 'E_AUTH' | 'E_CANCELLED' | 'E_TIMEOUT'
  | 'E_NOT_FOUND' | 'E_QUERY' | 'E_UNSUPPORTED' | 'E_ENGINE_DOWN';
export class AdapterError extends Error {
  constructor(readonly code: AdapterErrorCode, message: string, readonly cause?: unknown)
}
export function toWireError(err: unknown): { message: string; code?: string }
```
`toWireError` preserves the server's message verbatim (rule 4 in §4b).

**Acceptance:** `bun run typecheck`; `createAdapter('mariadb', deps)` throws `E_UNSUPPORTED` with a legible message.

---

## Step 5 — PostgreSQL adapter

**Files:** `src/engine/adapters/postgres/{index,client,query,catalog,caps}.ts`
**Deps:** `bun add pg` (→ `dependencies`, §0 note 9), `bun add -d @types/pg`

### 5a. `caps.ts`

```ts
export const postgresCaps: Caps = {
  tabular: true, documents: false, keyValue: false, stream: false,
  defaultPageKind: 'tabular',
  sql: true, ddl: true,
  projection: true, serverFilter: true, exactCount: true, pagination: 'keyset',
  foreignKeys: true, writable: true, transactions: true,
  cancel: true,
};
```

### 5b. `client.ts` (D14)

- `buildClientConfig(cfg: ResolvedConnectionConfig): ClientConfig` —
  - `mode === 'uri'` → `{ connectionString: cfg.uri }` (password already re-injected by main).
  - `mode === 'fields'` → `{ host, port, database, user, password, ...knownOptions }`.
  - Always: `application_name: 'kira-studio'`, `connectionTimeoutMillis: 10_000`, `statement_timeout: 0` (the app cancels explicitly; a silent server-side timeout would make the stop button's contract a lie).
  - `options.sslmode` maps to `pg`'s `ssl` (`require`/`prefer` → `{ rejectUnauthorized: false }`, `verify-full` → `true`). Anything else is passed through untouched; unknown options are ignored with a `warn` log, never silently dropped.
- `class ClientPool` — misleading name, avoid it; call it `ClientSet`:
  - `get(database: string | null): Promise<Client>` — `null` means the connection's default database. Creates and connects on first use, caches in a `Map`, records `client.processID`.
  - `primary(): Client` — the client for the configured database; created at `connect()`.
  - `closeAll(): Promise<void>` — `end()` every client, clear the map, swallow errors.
  - **Bound the map at 8 databases.** Beyond that, evict the least-recently-used non-primary client. A user expanding twenty databases should not open twenty backends.

### 5c. `query.ts` — the cancellable query helper

```ts
export interface RunningQuery { backendPid: number }

export async function runQuery<R extends QueryResultRow>(
  client: Client, sql: string, params: SqlParam[], ctx: OpCtx,
  track: (q: RunningQuery) => void,
): Promise<R[]>
```

- Calls `ctx.setCommand(sql)` **first** (D20 / rule 3).
- Registers `{ backendPid: client.processID }` via `track` so `cancel()` can find it.
- Rejects immediately with `E_CANCELLED` if `ctx.signal.aborted`; otherwise attaches an `abort` listener that resolves the local await early. Note that `pg` has no per-query abort — the local abort stops *us* waiting; the server-side kill is `adapter.cancel()`'s job, and both run (see `cancelOp` in §4c). Say this in a comment; it is the single most misunderstood part of this design.
- Translates `pg` errors into `AdapterError`: `28P01`/`28000` → `E_AUTH`, `57014` (query_canceled) → `E_CANCELLED`, `ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT` → `E_CONNECT`, everything else → `E_QUERY` with `err.message` verbatim.
- **Exported from this module so `tests/db/postgres.spec.ts` can drive a `SELECT pg_sleep(30)` directly** — this is how the server-side cancellation assertion in §9.1 is tested without inventing a fake tree level.

### 5d. `catalog.ts` — the SQL, one function per level

Every query binds identifiers as **parameters** and resolves them through the catalog (§0 ground rule).

**Databases** (connection root):
```sql
SELECT datname AS name,
       pg_catalog.shobj_description(oid, 'pg_database') AS comment
FROM pg_database
WHERE NOT datistemplate AND datallowconn
ORDER BY datname
```
→ `kind: 'database'`, `hasChildren: true`. `detail` = the connected database gets `'connected'`, others get nothing.

**Schemas** (inside a database, D15 hides system schemas):
```sql
SELECT nspname AS name
FROM pg_namespace
WHERE nspname NOT IN ('pg_catalog', 'information_schema')
  AND nspname NOT LIKE 'pg\_toast%' AND nspname NOT LIKE 'pg\_temp%'
ORDER BY nspname
```

**Relations in a schema:**
```sql
SELECT c.relname AS name, c.relkind,
       c.reltuples::bigint AS row_estimate,
       obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relkind = ANY('{r,p,v,m,S}')
ORDER BY CASE c.relkind WHEN 'r' THEN 0 WHEN 'p' THEN 0 WHEN 'v' THEN 1
                        WHEN 'm' THEN 2 WHEN 'S' THEN 3 END, c.relname
```
`relkind` → `NodeKind`: `r`/`p` → `table`, `v` → `view`, `m` → `matview`, `S` → `sequence`.
`detail` for tables/matviews = `~N rows` from `reltuples` when `>= 0` (Postgres uses `-1` for "never analysed" — render nothing in that case, do **not** render `-1`). `hasChildren` is true for `table`/`view`/`matview`, false for `sequence`.

**Functions in a schema** (same level, appended after relations):
```sql
SELECT p.proname AS name,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')
ORDER BY p.proname
```
→ `kind: 'function'`, `detail: '(' + args + ')'`, `hasChildren: false`.

**Columns** (children of a table/view/matview, and the `columns` of `describe`):
```sql
SELECT a.attname AS name, a.attnum AS position,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable,
       pg_get_expr(d.adbin, d.adrelid) AS default_expr,
       col_description(a.attrelid, a.attnum) AS comment
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = (
        SELECT c.oid FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2)
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum
```
Tree `detail` for a column = `data_type` + `' NOT NULL'` when not nullable. `badges` = `['PK']` when the column is in the primary key.

**Indexes** and **primary key**:
```sql
SELECT i.relname AS name, ix.indisunique AS unique, ix.indisprimary AS primary,
       am.amname AS method,
       ARRAY(SELECT pg_get_indexdef(ix.indexrelid, k.i, true)
             FROM generate_subscripts(ix.indkey, 1) AS k(i) ORDER BY k.i) AS columns
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_am am ON am.oid = i.relam
WHERE ix.indrelid = $1::oid
```
The primary key is the `columns` of the row with `primary = true`, or `null`.

**Foreign keys** (outbound) and **`referencedBy`** (inbound, D17) — the same query with `con.conrelid = $1` and `con.confrelid = $1` respectively:
```sql
SELECT con.conname AS name,
       con.confdeltype AS on_delete, con.confupdtype AS on_update,
       (SELECT array_agg(att.attname ORDER BY u.ord)
          FROM unnest(con.conkey) WITH ORDINALITY u(attnum, ord)
          JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum) AS columns,
       fn.nspname AS ref_schema, fc.relname AS ref_table,
       (SELECT array_agg(att.attname ORDER BY u.ord)
          FROM unnest(con.confkey) WITH ORDINALITY u(attnum, ord)
          JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = u.attnum) AS ref_columns,
       sn.nspname AS src_schema, sc.relname AS src_table
FROM pg_constraint con
JOIN pg_class fc ON fc.oid = con.confrelid JOIN pg_namespace fn ON fn.oid = fc.relnamespace
JOIN pg_class sc ON sc.oid = con.conrelid  JOIN pg_namespace sn ON sn.oid = sc.relnamespace
WHERE con.contype = 'f' AND con.conrelid = $1::oid
```
`confdeltype`/`confupdtype` are single chars — map `a`→`NO ACTION`, `r`→`RESTRICT`, `c`→`CASCADE`, `n`→`SET NULL`, `d`→`SET DEFAULT`. `referencedPath` is `encodePath([{kind:'database',name:db},{kind:'schema',name:ref_schema},{kind:'table',name:ref_table}])`.

### 5e. `index.ts` — the adapter

- `connect(cfg, ctx)`: build the config, open the primary client, `SELECT version(), current_database(), current_schema()`; return `{ serverVersion, details: { database, encoding } }`. Map connect failures to `E_CONNECT`/`E_AUTH`.
- `disconnect()`: `clientSet.closeAll()`, clear the running-query map. Idempotent.
- `children(path, ctx)`: switch on `path.segments.length` / last segment kind → databases | schemas | relations+functions | columns. An unknown shape throws `E_NOT_FOUND` naming the path.
- `describe(path, ctx)`: resolve the relation oid once, then columns + indexes + FKs + inbound FKs in **one `Promise.all`** on the same client (`pg` serialises them on the single connection, which is fine and keeps one backend pid for cancellation).
- `cancel(opId)`: look up the tracked `backendPid`; open a fresh `Client` with the same config; `SELECT pg_cancel_backend($1)`; `end()`; return the boolean result. Unknown `opId` → `false`, no throw.
- **Read-only guard:** `cfg.readOnly` is recorded on the adapter instance and, in P1, is asserted only in the sense that no P1 code path issues a write. §8.12's engine-side enforcement lands with P5's `mutate`. Add the field now and a one-line comment saying where the guard goes; do not build a guard around methods that cannot write.

**Acceptance:** deferred to Step 11 (this is the step the Testcontainers harness exists to validate). Until then, `bun run typecheck` and a manual `bun run dev` against a locally running Postgres.

---

## Step 6 — Main-side services: connections, tree/L1, op log

**Files:** `src/main/{connections,tree-service,oplog}.ts`, `src/main/ipc/{registry,app,settings,layout,engine,connections,tree,filters,ops}.ts` (registry + app/settings/layout/engine moved out of the old `src/main/ipc.ts`, which this step retires; connections/tree/filters/ops new), `src/main/index.ts` (mod)

### 6a. `connections.ts`

Orchestration only — storage does SQL, the engine does the network, this file joins them.

- `create(input)`: validate with `connectionInputSchema`; if `mode === 'uri'`, run `stripUriPassword` (D7) so the stored `uri` is passwordless and the extracted password goes to the `SecretStore`; insert the row; `secrets.set(id, password)`; return the summary.
- `update(id, input)`: same, plus — if `input.password === null` **and** the record already had one, keep the existing secret (the dialog sends `null` for "unchanged"); an empty string clears it. Document this three-state convention in the schema's doc comment, it is the kind of thing that silently wipes a password otherwise.
- `duplicate(id)`: copy the row with a new id, `name + ' copy'`, and **copy the secret too** (§8.10 lists Duplicate under Connection; a duplicate that cannot connect is useless).
- `remove(id)`: disconnect first if live, then delete the row (cascade clears filters/cache/saved queries), then `secrets.delete(id)`.
- `resolve(id): ResolvedConnectionConfig` — summary + `secrets.get(id)` + `injectUriPassword`. **Private to this module.** Never returned over IPC.
- `connect(id)`: set state `connecting`, push it, `engineHost.call(ENGINE_OP.connect, resolve(id))`, on success set `connected` with `serverVersion`, **drop the whole metadata cache for that connection and push `metadataInvalidated`** (D11); on failure set `error` with the verbatim message.
- `disconnect(id)`: engine call, then state `disconnected`. Cached metadata **stays** (§2.2: "metadata stays, it is on disk").
- `test(input)`: resolve *from the input, not from storage* (the dialog tests unsaved edits), call `ENGINE_OP.test`, return `{ ok, serverVersion }` or `{ ok:false, error }`. The engine connects and disconnects a throwaway adapter.
- `states()`: main holds the authoritative `Map<string, ConnectionState>` — it is what the green dot reads and what survives a renderer reload.
- `reveal(id)`: `secrets.get(id)`, and `log('info', 'connections', 'secret revealed for <id>')` (D9).

### 6b. `tree-service.ts` (D10)

```ts
async function children(connectionId, path, refresh): Promise<{ nodes, source }>
```
1. If `!refresh`: `getCached(...)`; if present, parse `z.array(treeNodeSchema)`. On success return `{ nodes, source: 'cache' }`. On parse failure, `dropCached` and fall through.
2. Require the connection to be `connected`; if not, throw `E_DISCONNECTED` with the message `"<name> is not connected"` — the renderer turns that into an inline "Connect" affordance on the node, not an error dialog.
3. `engineHost.call(ENGINE_OP.children, { connectionId, path })`.
4. `putCached(...)`, return `{ nodes, source: 'server' }`.

`describe` is the same shape. `invalidate(connectionId, path?)` is `dropCached` plus a `metadataInvalidated` push.

### 6c. L1 scope, stated precisely (§7)

**What L1 caches:** exactly two payload types per node path — the `children` array and the `describe` object. Nothing else. Not connection state, not row counts (that is L3, P2), not DDL text (P4 will add a third payload key to the same row).

**Key:** `(connection_id, encoded_path)`. **Persisted:** yes, `metadata_cache`, survives restart. **TTL:** none.

**Eviction, in full:**
| Trigger | Effect |
|---|---|
| connection deleted | all rows (SQL `ON DELETE CASCADE`, already in the schema) |
| connection reconnects | all rows for that connection (D11), expanded paths re-fetched |
| *Refresh* on a node | that node's row |
| *Refresh* on a connection / *Refresh all* | all rows for that/every connection |
| payload > 4 MB | not written in the first place (Step 2d) |
| anything else | **nothing** — no timer, no LRU, no byte budget |

That is the entire L1 story and it is deliberately smaller than L2's. §2.2's byte-budgeted LRU applies to result pages (P2), which are orders of magnitude larger and in memory; metadata is small, on disk, and the whole point is that it never expires.

### 6d. Op log wiring (D19) — `src/main/oplog.ts`

Exports `wireOplog(engineHost, db, broadcast)`, called from `main/index.ts` after `registerIpc`:
subscribes to the engine's `op:start` / `op:end` events, calls `repos/ops.ts`'s `appendOp` / `finishOp`,
and forwards each as a `kira:op:update` push to every window. Also calls `repos/ops.ts`'s `pruneOps(db)`
once at startup. This file is pure orchestration — it never touches Drizzle directly (rule from
`repos/`'s doc comment); every actual query goes through `repos/ops.ts`.

### 6e. `main/ipc/` — registry and the per-domain handler files

SPEC §11's `main/ipc/` split lands here: the single `src/main/ipc.ts` P0 built (four handlers:
`app:info`, `settings:*`, `layout:*`, `engine:status`) is retired in favor of one file per domain plus
a `registry.ts` that wires all of them into `ipcMain`. Moving the P0 handlers is mechanical — same
bodies, new files — and is done in this step because splitting `ipc.ts` at all means touching every
handler already in it.

- `ipc/app.ts`, `ipc/settings.ts`, `ipc/layout.ts`, `ipc/engine.ts` — the four P0 handlers, relocated
  verbatim (bodies unchanged; only the file and its `registerXHandlers(...)`-style export are new).
- `ipc/connections.ts`, `ipc/tree.ts`, `ipc/filters.ts`, `ipc/ops.ts` — the new P1 handlers, one file
  per domain from Step 1's channel list.
- `ipc/registry.ts` — a single `registerIpc(deps)` that calls each domain module's registration
  function. `main/index.ts` calls only `registerIpc`, never a domain file directly — the same shape
  P0's `registerIpc` had, just backed by eight files instead of one.

Each handler, regardless of which domain file it lives in:
1. parses its payload with the channel's Zod schema (this is a trust boundary — §3),
2. delegates to `connections.ts` / `tree-service.ts` / a storage module,
3. converts thrown `AdapterError`s into a rejected invoke whose message is the server's verbatim text with the code prefixed as `[E_QUERY] …` so the renderer can branch on the code without a separate error envelope.

**Acceptance:** from the renderer devtools console, `await window.kira.connectionsCreate({...})` then `connectionsConnect` then `treeChildren` returns databases; a second `treeChildren` for the same path returns `source: 'cache'` and produces **no** new `op_log` row. `sqlite3` shows one `metadata_cache` row and two `op_log` rows.

---

## Step 7 — Renderer: connection state, dialog, CRUD, colors

**Files:** `src/renderer/project/{ConnectionDialog,ColorPicker}.vue`, `src/renderer/state/connections.ts`, `src/renderer/bridge/control.ts` (mod)

### 7a. `src/renderer/state/connections.ts`

Lives in the new top-level `renderer/state/`, not `project/state/` — SPEC §11 names the active-connection
map as its example of cross-view state, and P2's grid/tabs will need to read connection state too, not
just the tree.

```ts
export const connectionsState = reactive({
  records: [] as ConnectionSummary[],
  states: {} as Record<string, ConnectionState>,
  dialog: { open: false, mode: 'create' as 'create' | 'edit', draft: null as ConnectionDraft | null },
});
export async function hydrateConnections(): Promise<void>   // list + states, awaited in main.ts
```
Subscribe to `kira:connection:state` on mount and write into `states`. Hydrate in `main.ts` alongside layout/settings so the tree renders on first paint with no flash.

### 7b. `ConnectionDialog.vue` (§8.12)

Same visual language as `SettingsDialog.vue` — scrim, `Escape` closes, focus trap, footer buttons. Reuse the `.field` / `.segmented` / `.dialog` CSS patterns from that file (copy them; do not extract a shared stylesheet in this phase).

Layout, top to bottom:
1. **Name** (text) · **Color** (`ColorPicker`, inline row of 12 swatches) — one row.
2. **Kind** (select). Only `PostgreSQL` is selectable; the other six v1 kinds are rendered `disabled` with the suffix *"— not yet supported"*. Rendering them disabled rather than omitting them is the same reasoning as P0's settings sections: it shows the shape of the product.
3. **Mode** — segmented `Fields` / `URI`.
4. **Fields mode:** Host, Port (number, default 5432 for postgres), Database, User, Password (`type="password"` with a reveal eye toggle).
   **URI mode:** a single-line `<input>` (not a textarea) plus a monospace muted line below it showing the parsed interpretation or *"Cannot be parsed into fields — will be used as-is."*
5. **Read-only** checkbox with the helper text *"Blocks every mutation path for this connection."*
6. The **plain-text credential warning**, always visible, `--kira-warn` colored, exactly: *"Credentials are stored unencrypted in ~/.kira-studio/kira.sqlite."*
7. Footer: **Test connection** (left, with an inline result chip), **Cancel**, **Save**.

**Mode sync (§8.12):**
- `fields → URI`: regenerate on every keystroke via `formatConnectionUri`, so flipping to URI mode always shows a current string.
- `URI → fields`: on flip (and on blur in URI mode), `parseConnectionUri` + `canRoundTripToFields`. If it round-trips, populate the fields and allow the flip. If it does not, **stay in URI mode** and show the reason inline. Never silently drop information.
- The dialog's `mode` is what gets saved; it decides which columns the adapter uses.

**Editing:** opening the dialog for an existing connection calls `kira:connections:reveal` once and puts the secret in the password field, masked (D9). If the user does not touch the field, the draft sends `null` (= unchanged, per Step 6a's three-state rule).

**Validation:** the draft is parsed through `connectionInputSchema` on Save; Zod issues render inline under the offending field. Save is disabled while the draft is invalid.

### 7c. `ColorPicker.vue`

Twelve 14 px round swatches in one row, `background: var(--kira-conn-<name>)`, selected one ringed with `--kira-focus`. `aria-label` = the color name, and `data-testid="color-<name>"` (Playwright picks colors by name).

### 7d. Colors on chrome

§8.12: the color appears on the tree rail, the tab, and the data-view toolbar. P1 has no tabs and no data-view toolbar, so **P1 applies the color to the tree rail only** — and to the connection chip in the operations panel (Step 10), which §8.11 explicitly asks for. Note this in the code so P2 knows where to reach.

**Acceptance:** create, edit, duplicate, reorder (drag is P6 — P1 exposes reorder only via the `kira:connections:reorder` channel used by nothing; skip the UI) and delete a connection; all survive a relaunch; the password never appears in a `kira:connections:list` response (assert this in the spec, not just by eye).

---

## Step 8 — Renderer: the project tree

**Files:** `src/renderer/project/{ProjectTree,TreeRow,SearchBox,FiltersDialog}.vue`, `src/renderer/project/{icons,filter}.ts`, `src/renderer/project/state/tree.ts`, `src/renderer/workbench/VirtualList.vue`, `src/renderer/workbench/panels/ProjectPanel.vue` (mod)

### 8a. `VirtualList.vue`

A fixed-row-height windowing list — the smallest thing that satisfies §2.1's "long lists are virtualized too". Props: `items: readonly T[]`, `rowHeight: number`, `overscan = 8`. Slot per visible item with `{ item, index }`. Spacer divs above and below; `scrollTop` from a passive scroll listener; no `IntersectionObserver`, no library. Used by the tree *and* by the operations panel (Step 10). Target ≤ 90 lines.

`rowHeight` comes from `--kira-row-height` (22 px compact / 28 px comfortable) — read it once on mount and on settings change so density applies to the tree.

### 8b. `state/tree.ts`

```ts
export const treeState = reactive({
  children: {} as Record<string, TreeNode[]>,        // key: `${connectionId}|${encodedPath}`
  expanded: new Set<string>(),                        // same key
  loading: new Set<string>(),
  errors: {} as Record<string, string>,
  search: '',
});
export async function expand(connectionId, path): Promise<void>
export async function collapse(connectionId, path): Promise<void>
export async function refresh(connectionId, path): Promise<void>   // refresh: true
export async function refreshExpanded(connectionId): Promise<void> // D11 handler
export const visibleRows = computed<TreeRowVm[]>(() => /* flatten + filter + search */)
```

- `expand` sets `loading`, calls `kira:tree:children`, writes `children`, adds to `expanded`, clears `loading`. An error goes into `errors[key]` and the row renders it inline (muted, `--kira-error`) with a retry affordance — never a modal.
- The expansion set is **session-only** in P1 (§8.4's session restore is P2's `tabs` work; expansion state is not in the schema and must not be added).
- `refreshExpanded` is subscribed to `kira:connection:metadataInvalidated`: it re-fetches every currently-expanded path for that connection, breadth-first, sequentially (do not fan out N parallel engine calls on one client).

### 8c. `visibleRows` — flatten, filter, search

One `computed` producing a flat array (the virtual list needs indices, not a nested render):

1. Start from `connectionsState.records` in `sortOrder` order → depth-0 rows.
2. For each expanded node, splice its `children` in at depth+1, recursively.
3. **Filters (D13):** drop any node whose `kind` has rules and that the rules reject. `filter.ts`:
   ```ts
   evaluate(node, rules): boolean
   // 1. rules for this node kind only
   // 2. if any 'show' rule exists for the kind, the node must match at least one, else drop
   // 3. then, if the node matches any 'hide' rule, drop
   ```
   Glob is the default: translate `*`/`?` to a `RegExp`, escaping everything else. `isRegex` uses the pattern as-is, compiled once per rule and **cached** — an invalid regex is caught, the rule is skipped, and the filters dialog shows the error next to that row.
4. **Search (§8.3):** when `search` is non-empty, keep a row if its `name` contains the query case-insensitively, **or** if any kept descendant does (so ancestors of matches stay visible). Matching rows get their matched substring wrapped for highlight. Matching ancestors are force-expanded for the duration of the search and restored when it clears.
5. If `search` is non-empty **and** any connection has unexpanded nodes, render a persistent footer line in the panel: *"Searching cached nodes only — expand more of the tree to include it."* §8.3 requires the panel say so rather than under-report silently.

### 8d. `TreeRow.vue`

One row, `height: var(--kira-row-height)`, `padding-left: 8 + depth * 14 px`:

- **Twisty**: `codicon-chevron-right` / `chevron-down`, invisible (not absent — alignment) when `!hasChildren`. Spinner (`codicon-loading` + `animate-spin`) while loading.
- **Color rail**: on depth-0 connection rows only, a 3 px full-height bar at the far left, `background: var(--kira-conn-<color>)`.
- **Status dot** (§8.3, §8.1): on connection rows, a 8 px dot right after the icon — `--kira-ok` when `connected`, `--kira-warn` pulsing when `connecting`, `--kira-error` when `error`, `--kira-fg-disabled` when `disconnected`. `title` shows the server version or the error.
- **Icon**: from `icons.ts`.
- **Label**: `name`, ellipsised, with the search highlight span.
- **Detail**: right-aligned, `--kira-fg-muted`, `font-size: 11px` — the node's `detail`.
- **Badges**: small `--kira-badge` pills.
- `data-testid="tree-row"`, `data-path`, `data-kind`, `data-status` — Playwright selects on these.
- Single click selects; double click expands/collapses; right click opens the context menu (Step 9); the twisty toggles.

### 8e. `icons.ts`

```
connection → 'plug'          database → 'database'      schema  → 'symbol-namespace'
table      → 'table'         view     → 'eye'           matview → 'symbol-structure'
sequence   → 'list-ordered'  function → 'symbol-method'
column     → by data type: int/numeric/float → 'symbol-numeric';
             bool → 'symbol-boolean'; date/time/timestamp → 'calendar';
             json/jsonb → 'symbol-object'; array types → 'symbol-array';
             uuid → 'symbol-key'; everything else → 'symbol-string'
```
Every icon goes through P0's `Codicon.vue` — no raw `codicon-*` classes (P0 Step 5c's standing rule).

### 8f. `ProjectPanel.vue` (rewrite)

Header row (keeping the existing border and padding): `Project` · spacer · `+` button, now **enabled**, opening the connection dialog. Below it, `SearchBox.vue` (a `codicon-search`-prefixed input with a clear `×`, `data-testid="tree-search"`). Below that, the `ProjectTree` filling the remaining height. When `connectionsState.records` is empty, keep the existing `EmptyState` — but with the label *"No connections"* and a clickable *"New connection"* link beneath it.

### 8g. `FiltersDialog.vue` (§8.3)

Small modal, opened from a connection's context menu. A list of rules, each row: node-kind select (`Database`/`Schema`/`Table`), action select (`Hide`/`Show`), pattern input, `Regex` checkbox, delete button. `+ Add rule` at the bottom. Save calls `kira:filters:replace`. A live preview count — *"hides 12 of 84 cached nodes"* — computed from the same `filter.ts` used at render, so the dialog cannot disagree with the tree.

**Acceptance:** with a live Postgres connection, expanding connection → database → schema → table → columns works; collapsing and re-expanding issues **no** new op (assert via the operations panel); *Refresh* on a schema does issue one; search finds a cached table and shows the cached-only notice; a `hide` filter on `pg_*` removes matching schemas immediately with no refetch.

---

## Step 9 — Context menu service and the P1 menu subset

**Files:** `src/renderer/workbench/ContextMenu.vue`, `src/renderer/workbench/state/contextMenu.ts`

### 9a. The service (D12)

```ts
export type MenuItem =
  | { type: 'item'; id: string; label: string; icon?: string; danger?: boolean;
      disabled?: boolean; checked?: boolean; run(): void | Promise<void> }
  | { type: 'submenu'; id: string; label: string; icon?: string; items: MenuItem[] }
  | { type: 'separator' };

export const contextMenuState = reactive({ open: false, x: 0, y: 0, items: [] as MenuItem[] });
export function openContextMenu(ev: MouseEvent, items: MenuItem[]): void
export function closeContextMenu(): void
```

`ContextMenu.vue` is teleported to `body`, positioned at the click and **flipped** when it would overflow the window, closes on `Escape` / outside click / scroll / window blur, supports one level of submenu opening on hover with a small delay, and renders checkmarks for `checked`. `data-testid="context-menu"`, each item `data-testid="menu-item-<id>"`. Keyboard navigation is §8.15/P6 — not now.

**One service, per §8.10** — every future menu (grid cell, tab, document, op row) calls `openContextMenu`. Do not let a second menu implementation appear.

### 9b. The P1 subset (scoped down — the full matrix is P6)

Items marked *(P#)* below are in §8.10 but are **omitted entirely** in P1 — not rendered disabled — because the feature they open does not exist yet and a greyed row that never enables is worse than an absent one. §11 lists them again as out of scope.

| Target | P1 items | Omitted until |
|---|---|---|
| **Connection** | Connect · Disconnect · Refresh · Edit… · Duplicate · Copy name · Copy URI · Filters… · Color ▸ (12 swatches, checked) · Read-only ✓ (toggles + persists) · — · Delete | Open query console (P5.5) |
| **Database / schema** | Refresh · Copy name · Filters… | Open query console (P5.5); Set as default (P2 — nothing consumes a default yet) |
| **Table / view / matview** | Refresh · Copy name · Copy qualified name | Open data, Open data in new tab (P2); Open DDL (P4); Open query console (P5.5); Count rows (P2, needs L3); Saved filters (P2) |
| **Sequence / function** | Copy name · Copy qualified name | everything else |
| **Column** | Copy name | Add to projection, Sort by (P2) |
| **Empty tree background** | New connection · Refresh all · Collapse all | — |
| **Operations log row** | Copy command · Copy error · Cancel (only while `running`) | Re-run (P5.5); Reveal originating tab (P2 — there are no tabs) |

- *Connect* / *Disconnect* are mutually exclusive: render only the applicable one.
- *Read-only ✓* writes through `kira:connections:update` and, if the connection is live, **forces a reconnect** so the engine picks up the new flag — with a confirm prompt if it is connected. (In P1 nothing writes, so the flag is inert; the reconnect keeps the invariant "the engine's view of a connection always matches the stored row" true from day one.)
- *Delete* asks for confirmation naming the connection.
- *Copy qualified name* is `schema.table` for Postgres, produced by the renderer from the path — do not round-trip to the engine for a string join.

**Acceptance:** right-clicking each node kind opens a menu with exactly the items above (a Playwright spec asserts the item id list per kind, per §9.2); *Copy URI* puts the passwordless URI on the clipboard; *Color ▸* re-tints the rail immediately and after a relaunch.

---

## Step 10 — Operations panel (§8.11)

**Files:** `src/renderer/state/ops.ts`, `src/renderer/workbench/panels/OperationsPanel.vue` (rewrite)

### 10a. `src/renderer/state/ops.ts`

Lives in the new top-level `renderer/state/`, not `workbench/state/` — SPEC §11 names "op log ring" as
its other example of cross-view state, alongside connections (Step 7a). The panel that renders it stays
in `workbench/panels/` (that part of the split is presentation, not state).

```ts
export const opsState = reactive({
  records: [] as OpRecord[],       // newest first, hard-capped at 500 (D19)
  filterText: '',
  statusFilter: 'all' as 'all' | 'running' | 'error',
});
export async function hydrateOps(): Promise<void>          // kira:ops:recent(200)
export const visibleOps = computed<OpRecord[]>(() => /* text + status filter */)
```
Subscribe to `kira:op:update`; upsert by `id` (a `running` row is later replaced by its finished self); trim past 500 from the tail.

### 10b. The panel

Replace the empty state with a header + a `VirtualList` body.

**Header:** a filter input (`codicon-filter`, `data-testid="ops-filter"`), a status segmented control (`All` / `Running` / `Errors`), a running count, and a `Clear` button (clears the in-memory ring only — `op_log` retention is automatic; say so in the button's `title`).

**Columns**, in §8.11's order, fixed widths except `command`:
`time (HH:MM:SS.mmm)` · `connection` (a color chip: 8 px square in `var(--kira-conn-<color>)` + name) · `tab` (empty in P1 — the column exists, `—`) · `kind` · `status` · `duration` (`—` while running) · `rows` · `command` (truncated, monospace).

- Running rows show a small spinner in the status cell and a `codicon-debug-stop` cancel button that calls `kira:ops:cancel`.
- Error rows are `--kira-error`; the error text replaces the command cell with a `title` carrying the full text.
- Clicking a row expands it inline to a two-line detail (full command, full error). **Not CodeMirror** — §8.11 says "expandable in CodeMirror", but CodeMirror is not a dependency until P3, and adding it for a log detail is exactly the kind of forward-scaffolding P0 banned. Record this deviation in a comment; P3 upgrades it when CodeMirror lands.
- Clicking a row also "reveals the tab that issued it" (§8.11) — no tabs in P1, so this is inert; do not stub a tab service.
- Keep the empty state for zero records, with the label *"No operations yet"*.

**Acceptance:** connecting and expanding the tree produces one row per server round-trip and **zero** rows for a cache hit; the status filter and text filter work; cancelling a long op flips the row to `cancelled`; the panel survives a relaunch showing the persisted history.

---

## Step 11 — Testcontainers harness for Postgres (§9.1)

**Files:** `tests/db/support/{docker,postgres}.ts`, `tests/db/fixtures/0001_seed.sql`, `tests/db/postgres.spec.ts`, `package.json` (script)
**Deps:** `bun add -d testcontainers`

### 11a. Colima setup (put this verbatim in a comment at the top of `support/docker.ts`)

The dev machine's Docker daemon is **Colima**, not Docker Desktop. Testcontainers needs three things:

```sh
colima start --cpu 4 --memory 6 --disk 40      # once; `colima status` to check
docker context use colima
# Testcontainers reads DOCKER_HOST; Colima's socket is not the default path:
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
# Ryuk (the reaper container) bind-mounts the socket at its *in-container* path,
# which must be the conventional one even though the host path differs:
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
```

`support/docker.ts` does this automatically so a developer with a clean shell is not stuck:
- `resolveDockerHost()`: if `DOCKER_HOST` is unset, shell out to `docker context inspect --format '{{.Endpoints.docker.Host}}'` and set `process.env.DOCKER_HOST` from it; also default `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE` to `/var/run/docker.sock` when the resolved host points into `~/.colima`.
- `isDockerAvailable(): Promise<boolean>` — a `docker info` probe with a 5 s timeout. Used by D22's skip logic. Its failure message must name **Colima** and the `colima start` command, not Docker Desktop.

### 11b. `support/postgres.ts`

```ts
export interface PgFixture {
  container: StartedTestContainer;
  config: ResolvedConnectionConfig;   // ready to hand to the adapter
  uri: string;
  stop(): Promise<void>;
}
export async function startPostgres(opts?: { seedBigTable?: boolean }): Promise<PgFixture>
```
- Image **`postgres:17-alpine`**, `POSTGRES_PASSWORD=kira`, `POSTGRES_DB=kira_test`, waiting on the log strategy `database system is ready to accept connections` seen **twice** (the image emits it once during its init phase and once for real — waiting on the first start gives you a connection refused a moment later; this is the classic Postgres/Testcontainers flake).
- After start, execute `fixtures/0001_seed.sql` through a plain `pg.Client`.
- `startupTimeout` 120 s (a cold `docker pull` under Colima is slow).
- Module-level **memoisation**: one container per test process, started lazily, stopped in a global teardown. Starting a fresh container per test would make the suite unusable.

### 11c. `fixtures/0001_seed.sql` — the §9.1 dataset

One `app` schema plus a second `analytics` schema (so the tree has more than one schema to list), containing:

- `wide_table` — 60 columns spanning `int`, `bigint`, `numeric(20,6)`, `text`, `varchar(50)`, `bool`, `date`, `timestamptz`, `uuid`, `jsonb`, `bytea`, `int[]`, `inet`, `interval`. Some columns nullable, some `NOT NULL`, several with defaults and column comments.
- `nulls_and_unicode` — rows with `NULL`s in every nullable column, empty strings (distinct from `NULL` — §8.5 requires they render differently), emoji, CJK, RTL, combining characters, a 1 MB `text` value and a 256 KB `bytea`.
- `nested_json` — a `jsonb` column with 5-level nesting and a 200-element array.
- `composite_pk(tenant_id, entity_id, …)` — a two-column primary key.
- `employees(id, manager_id → employees.id)` — self-referencing FK.
- `orders → customers → regions` and `order_items → orders` + `order_items → products` — a multi-hop FK graph, so `foreignKeys` *and* `referencedBy` (D17) both have something to assert.
- `big_rows` — **1 000 000 rows** via `INSERT INTO big_rows SELECT i, md5(i::text) FROM generate_series(1, 1000000) i`, plus `ANALYZE` so `reltuples` is populated (the tree's `~N rows` detail reads it). Gated behind `seedBigTable` (default **true**) — P1 only needs it to prove the harness can build it; P2's paging is what really consumes it. If it costs more than ~10 s, keep it anyway and note the time in the spec output.
- One view, one materialized view, one sequence, one function and one procedure, so every `NodeKind` the adapter emits appears in the tree.
- A table named `weird"name` and one named `Order Items` — identifier quoting is where catalog code breaks, and the ground rule about parameter binding needs a test that would catch a regression.

### 11d. `tests/db/postgres.spec.ts`

Run with `bun test`; add `"test:db": "bun test tests/db"` to `package.json`. Scenarios — the §9.1 list, restricted to what P1 implements:

1. **connect / disconnect** — `connect` returns a `serverVersion` matching `/^PostgreSQL 17/`; `disconnect` closes every backend (assert `SELECT count(*) FROM pg_stat_activity WHERE application_name = 'kira-studio'` is 0 from a side client).
2. **auth failure** — a wrong password yields `AdapterError` with code `E_AUTH` and the server's message verbatim.
3. **tree enumeration** — root lists `kira_test` (and `postgres`); the database lists `app` and `analytics` and **not** `pg_catalog`/`information_schema` (D15); `app` lists the tables, the view, the matview, the sequence, the function and the procedure with the right `kind`s; `wide_table` lists 60 columns in `attnum` order.
4. **quoting** — `weird"name` and `Order Items` appear with their exact names and their columns are listable.
5. **describe** — `order_items` has the right `columns` (types, nullability, defaults, comments), `primaryKey`, one index per created index with `unique`/`primary` correct, two `foreignKeys` with resolved `referencedPath`/`referencedColumns`, and `employees` has a `referencedBy` entry pointing at itself (D17).
6. **row estimate** — `big_rows`'s tree node `detail` reports ~1 000 000 after `ANALYZE`; a never-analysed table reports no estimate rather than `-1`.
7. **cancel, asserted server-side (§9.1's hard requirement)** — start `runQuery(client, 'SELECT pg_sleep(30)', …, ctx)` under a `runOp`; wait until a side client sees the query in `pg_stat_activity`; call `cancelOp(opId)`; assert (a) the promise rejects with `E_CANCELLED`, and (b) within 2 s `pg_stat_activity` no longer has a row whose `query` contains `pg_sleep`. **The query must actually be gone from the server** — asserting only on the local rejection is the failure mode this test exists to prevent.
8. **cap honesty** — `postgresCaps.cancel === true` and scenario 7 passes; a future adapter that fails 7 must set the cap false.
9. **children of a leaf** — a sequence returns `[]` and does not throw (rule 5 in §4b).
10. **unsupported kind** — `createAdapter('mongodb', …)` throws `E_UNSUPPORTED`.

Cache hit/miss behaviour (§9.1's cache scenario) is asserted in the **UI** suite instead, since the cache lives in main and the op log is how a user observes it — see Step 12.

**Acceptance:** `bun run test:db` is green with Colima running, and prints a legible "start Colima" error (not a stack trace) when it is not.

---

## Step 12 — Playwright specs

**Files:** `tests/ui/support/pg.ts`, `tests/ui/connections.spec.ts`, `tests/ui/tree.spec.ts`

### 12a. `support/pg.ts` (D22)

Re-exports `startPostgres` / `isDockerAvailable` from `tests/db/support/`. Each container-backed spec file begins with:
```ts
test.beforeAll(async () => {
  if (!(await isDockerAvailable())) test.skip(true, 'Docker daemon unreachable — run `colima start`');
});
```
Playwright runs under Node, so `testcontainers` works there unchanged.

### 12b. `connections.spec.ts` — no container needed, never skips

- Create a connection through the dialog (fields mode); assert it appears in the tree with the right color rail and a grey (disconnected) dot; relaunch; assert it is still there.
- Assert `await window.evaluate(() => window.kira.connectionsList())` contains **no** `password` key on any record (D9, asserted not eyeballed).
- Switch the dialog to URI mode; assert the generated URI matches the fields; type an exotic URI (`postgres://u:p@a.example,b.example/db`); assert the dialog **stays** in URI mode and shows the reason.
- Save a URI-mode connection with a password in the string; assert `kira:connections:list` returns the URI **without** the password (D7) and that `reveal` returns it.
- Edit → change color via the dialog and via the context menu; both re-tint; both persist.
- Duplicate, then delete, with the confirm; assert the count.
- Screenshot `test-results/screenshots/connection-dialog.png`.

### 12c. `tree.spec.ts` — container-backed

- Start Postgres, create a connection pointed at it via `window.kira.connectionsCreate` (faster and less brittle than driving the dialog for setup — the dialog is already covered by 12b).
- Connect; assert the dot turns green within 10 s; assert one `connect` row in the operations panel.
- Expand connection → database → `app` → `wide_table` → columns; assert node counts and a few names.
- **Cache assertion (§7, §9.2's "assert query counts via the op log")**: note the operations-panel row count, collapse the whole connection, re-expand the same path, assert the row count is **unchanged** — the second expansion came from L1.
- *Refresh* on the schema from the context menu; assert exactly one new `children` row appears.
- Disconnect, then expand a **cached** node: it still renders (L1 survives disconnect). Expand an **uncached** node: it renders the inline "not connected" affordance, not an error dialog.
- Reconnect; assert the cache was invalidated and the expanded paths re-fetched (D11 — new `children` rows appear for exactly the expanded paths).
- Search: type `order`, assert the matching tables show and their ancestors stay; assert the cached-only notice is present; clear, assert restoration.
- Filters: add a `hide` glob `pg_*` on schemas; assert affected nodes vanish with **no** new op-log rows (D13); relaunch; assert the rule persisted.
- Context menus: right-click each of connection / database / schema / table / column / empty background and assert the exact item id list from Step 9b.
- Screenshots: `project-tree.png`, `operations-panel.png`, `context-menu-connection.png`.
- `consoleErrors` empty throughout.

**Acceptance:** `bun run test:ui` green with Colima up; the connection specs still green with Colima down (the tree spec skips with the Colima message).

---

## Step 13 — Drizzle for the internal SQLite layer (appended at request)

**Files:** `package.json` (mod), `src/main/storage/schema/{settings,layout,connections,connection-filters,metadata-cache,ops}.ts` (new — SPEC §11's `storage/schema/`, one file per table this phase actually uses), `src/main/storage/db.ts` (mod), `src/main/storage/repos/{settings,layout,connections,secrets,filters,metadata-cache,ops}.ts` (mod), `src/main/{connections,tree-service,index}.ts` (mod, signature-only)
**Deps:** `bun add drizzle-orm`

Migrate the internal SQLite access layer from hand-written SQL over the `Db` interface to Drizzle's
schema + typed query builder. This is a **pure refactor**: the on-disk schema, the IPC surface, the
renderer, and every acceptance criterion of Steps 1–12 are unchanged.

### 13a. Driver (D13a)

Use **`drizzle-orm/sqlite-proxy` over the existing `node:sqlite` `DatabaseSync`**. There is no
first-party Drizzle driver for `node:sqlite` (verified against drizzle-orm 0.45.2's export map), and
P0 deliberately chose the built-in `node:sqlite` to keep the project free of native rebuilds —
switching to `better-sqlite3` would reintroduce the `@electron/rebuild` story P0 walked away from.
The proxy is a thin async callback bridge:

```ts
drizzle(async (sql, params, method) => {
  // method: 'run' | 'all' | 'get' | 'values'
  // node:sqlite returns objects built in column order, so Object.values(row) preserves the
  // positional order the proxy's row arrays expect.
});
```

Settle during implementation against drizzle's `.d.ts` (do not guess): the exact
`SqliteProxyCallback` return shape per `method`, and how `changes` / `lastInsertRowid` surface for
`run`. Use drizzle's `.returning()` (needs SQLite ≥ 3.35, satisfied by node:sqlite) for inserts that
need the new row back.

### 13b. Schema (`storage/schema/`)

One file per table, each exporting one `sqliteTable(...)`, matching `migrations/0001_init.sql`
exactly: `settings.ts`, `layout.ts`, `connections.ts`, `connection-filters.ts`, `metadata-cache.ts`,
`ops.ts` (the `op_log` table) — the six tables P1 actually has a `repos/` module for. SPEC §11 says
`storage/schema/` "mirrors `migrations/` 1:1", but P0's no-scaffolding-forward rule wins where they'd
conflict: `tabs` and `saved_queries` already exist as columns in `0001_init.sql`, yet nothing in P1
reads or writes them, so **do not add `tabs.ts` or `saved-queries.ts` here** — P2 and P5.5 add their
own schema file in the same step that adds their `repos/` module, which is what "1:1 with what's
actually used" means in practice until the whole schema has a consumer. Booleans use
`integer(..., { mode: 'boolean' })` so the 0/1 ↔ boolean transform (P0 note 2) is handled by Drizzle
and the `? 1 : 0` sprinkling disappears from the storage modules. `payload_json` / JSON columns stay
`text` and keep the existing `JSON.parse` at the storage boundary.

### 13c. `db.ts` + migrations

`db.ts` opens `node:sqlite` as now, wraps it in the proxy bridge, and exports the Drizzle instance
plus a raw `exec()` for `migrate()` (multi-statement `0001_init.sql` has no Drizzle equivalent) and
for the startup PRAGMAs. **No drizzle-kit**: the schema is small and hand-maintained in sync with
`0001_init.sql`; a generated-migration workflow is not worth a new dev dependency here. `migrate()`
and the PRAGMA setup are otherwise unchanged.

### 13d. Storage module rewrites

Rewrite each `storage/repos/` module's queries in the builder, keeping public signatures (callers only
thread `db` through, so their code — including `main/oplog.ts`, which calls `repos/ops.ts` but never
Drizzle directly — is unchanged):

- `repos/settings.ts` / `repos/layout.ts` — `db.select()` + `db.update()`; read-back validation stays.
- `repos/connections.ts` — `select/insert/update/delete` + `sql\`COALESCE(MAX(sort_order), -1)\``; the
  "skip unparseable row" read-back discipline is unchanged.
- `repos/secrets.ts` — `db.select({ password })` / `db.update`.
- `repos/filters.ts` — `replaceFilters` becomes `db.transaction(async (tx) => …)`; delete-all + insert.
- `repos/metadata-cache.ts` — `putCached`'s read-modify-write becomes `db.transaction(async (tx) => …)`;
  the `fooTx()`/`foo()` split from P0 note 1 still applies (never nest transactions).
- `repos/ops.ts` — `appendOp`/`finishOp`/`recentOps`/`pruneOps` in the builder.

### 13e. Acceptance

1. `bun run lint && bun run typecheck && bun run build` green.
2. `bun run test:ui` green (the storage layer is exercised end-to-end by the existing specs).
3. `bun run test:db` green (postgres.spec.ts is unaffected but must still pass).
4. Scratch check: create → list → update → delete a connection and a filter set through the Drizzle
   layer, confirming `sqlite3` shows identical rows and cascade delete still fires.
5. `grep -rn "db\.\(all\|get\|run\|exec\)" src/main` returns nothing outside `db.ts`/`migrate.ts`
   (no raw SQL strings left in the storage modules).

---

## 11. Explicitly out of scope for P1

Do not build, stub, or "prepare" any of these. If a P1 file seems to need one, the design is wrong — say so rather than scaffolding forward.

- **No second adapter.** No MariaDB, MongoDB, Redis, Kafka, SQS or S3 adapter, and no directories for them under `src/engine/adapters/`. Their rows in the §4a capability table are documentation. Their entries in `connectionKindSchema` exist only so the dialog can render them disabled.
- **No data grid, no tabular view, no tabs.** `MainView.vue`, `TabStrip.vue`, `Toolbar.vue` and `CellEditorPanel.vue` keep their P0 empty states, untouched. The `tabs` table stays empty. §8.5 is P2.
- **No `read` / `count` / `Page` types.** The adapter has no read path in P1 (D3). No pagination, no projection, no server filter, no count-all, no stop button in a toolbar.
- **No L2 or L3 cache.** No in-memory page LRU, no byte budgets, no prefetch, no count cache, no cache-size readout in the status bar, no *Clear caches* action. The settings dialog's Cache section stays disabled exactly as P0 left it. §7's L1 is the whole cache story for this phase, bounded as in Step 6c.
- **No cell editor content.** No CodeMirror dependency at all — including in the operations panel's expanded row (Step 10b records the deviation). P3 brings it.
- **No DDL.** `caps.ddl` is `true` for Postgres because Postgres *can*; the `ddl()` method is P4's.
- **No mutations.** No add/delete row, no cell editing, no pending-change set, no command preview, no commit/rollback. The read-only flag is stored and passed to the engine; the guard it gates is P5's.
- **No query console.** No `console` tab kind, no `saved_queries` writes, and **no "Open query console" item in any context menu** — it appears in §8.10 for Connection, Database/schema and Table, and is omitted from all three (Step 9b). P5.5.
- **No full right-click matrix.** Only the subset in Step 9b. Nothing for grid cells, grid rows, grid headers, tabs or documents — those targets do not exist yet. §8.10's remaining rows are P6.
- **No FK navigation.** `ObjectMeta.foreignKeys` / `referencedBy` are collected and cached (D17) and nothing consumes them. No cell buttons, no filtered tabs, no FK graph. P7.
- **No keyboard shortcuts** beyond P0's three menu accelerators. No command palette, no keybinding table. §8.15 is P6.
- **No session restore** of tabs or of tree expansion state. Expansion is session-only (Step 8b).
- **No schema migration.** The P0 `0001_init.sql` is sufficient (§0 note 5).
- **No engine auto-respawn**, no per-connection engine processes, no connection pooling beyond D14's one-client-per-database.
- **No packaging, no signing, no auto-update, no CI wiring** for the container suite (§9.1: "local-only for now").
- **No pre-connect scripts.** §1 defers them to P11 explicitly — no field in the dialog, no column use, no shell execution anywhere.
- **No unit tests.** Two suites only: `tests/db` and `tests/ui`.

---

## 12. Risk register

| Risk | Signal | Response |
|---|---|---|
| **`testcontainers`/`dockerode` misbehaves under `bun test`** (stream handling on container logs is the usual sore spot) | `bun run test:db` hangs on container start, or the log wait strategy never fires | Fall back to running the DB suite under Playwright's runner as a second project (`{ name: 'db', testDir: './tests/db' }` in `playwright.config.ts`, `test:db` → `playwright test --project=db`). `@playwright/test` is already installed and runs under Node, so this is a config change plus swapping the `bun:test` imports for `@playwright/test`. **Write the specs with a thin import shim (`tests/db/support/harness.ts` re-exporting `test`/`expect`) so this swap is one file.** |
| **Colima socket not where Testcontainers looks** | `Could not find a working container runtime strategy` | `support/docker.ts`'s `resolveDockerHost()` (Step 11a) plus the `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` export. If Ryuk still fails, `TESTCONTAINERS_RYUK_DISABLED=true` and stop containers explicitly in teardown — acceptable locally, and P1 has no CI. |
| **Postgres container accepts connections, then restarts during init** | Intermittent `ECONNREFUSED` right after `startPostgres()` resolves | Wait on the readiness log line seen **twice** (Step 11b). Do not "fix" it with a sleep. |
| **1M-row seed dominates suite runtime** | `bun run test:db` takes minutes | Container is memoised per process (Step 11b); the seed runs once. If it still hurts, `COPY … FROM PROGRAM` beats `INSERT … SELECT`, or gate `seedBigTable` off for P1 and turn it on in P2 where paging needs it. |
| **`node:sqlite` rejects a boolean parameter** | `TypeError` from `db.run` on the first connection insert | §0 note 2 — write `1`/`0`. Grep the new storage modules for `? 1 : 0` before running. |
| **Nested `db.transaction`** | `cannot start a transaction within a transaction` | §0 note 1 — the `fooTx()` / `foo()` split. This bites in `connections.remove()` (delete + secret) and in `metadata-cache.putCached()` (read-modify-write). |
| **Password leaks to the renderer** | A `password` field visible in a devtools network/IPC payload | D9's type-level omission plus the explicit spec assertion in 12b. If a new channel needs to return a record, return `ConnectionSummary` — never the row. |
| **Engine crash leaves the UI hung** | Tree spinner forever after killing the engine pid | Step 3a's "reject all pending calls + synthesise error states on exit". Verify by `kill`ing the engine during an expand. |
| **`pg_cancel_backend` returns true but the query survives** | Test 7's `pg_stat_activity` assertion fails while the local promise rejects | This is precisely the lie §5.1 forbids. Do not weaken the test — investigate (usually the cancel targeted the wrong backend because a Pool was introduced; see D14). |
| **Catalog queries slow on a large database** | Expanding a schema with 40k relations takes seconds | Acceptable in P1 *provided* it is cancellable (D5) and shows a spinner. Do not add pagination to the tree — that is a real design question and belongs to P12's hardening pass with measurements behind it. |
| **`metadata_cache`'s `(connection_id, path)` unique index forces the merged payload shape** | A `describe` write clobbers a `children` write | Step 2d's single-row read-modify-write. Do not add a migration to widen the key (§0 note 5). |
| **Adapter accidentally imports `electron`** | `tests/db` fails to import the adapter | Rule 1 in §4b. Add it to the review checklist; a `grep -r "from 'electron'" src/engine/adapters/` returning anything is a bug. |

---

## 13. Open questions for the human — resolve before Step 2

Two of these have defaults I have chosen and implemented in the plan; they are called out because they are the kind of thing a user may want to overrule *before* code exists, not after.

1. **Plain-text credentials.** §1 and §6 defer credential encryption, so D8 ships `PlaintextColumnSecretStore` and the dialog carries the warning banner. Electron's `safeStorage` would give Keychain-backed encryption for **zero new dependencies and roughly 30 lines** entirely inside `secrets.ts` — the indirection is designed for exactly this. Default taken: **follow the spec, plain text**. Say so if you would rather have `safeStorage` now; it is genuinely cheap here and expensive to retrofit once there are stored connections to migrate.
2. **Engine auto-respawn.** P0 deferred the policy to P1 on the grounds that P1 has connections to restore. P1's plan **does not build it** — on engine exit, main fails every pending call and marks connections errored, and the user reconnects manually. Building silent auto-reconnect means deciding whether a read-only flag, an open transaction (P5) or a half-listed tree can be resumed safely, and I would rather that decision come after P5 exists. Default taken: **no respawn, loud failure**. Flagging it because "the engine died and the app said so" is a visible product behaviour, not just an internal choice.

---

## 14. Definition of done for P1

1. `bun install && bun run lint && bun run typecheck && bun run build && bun run test:ui && bun run test:db` is green from a clean clone with Colima running.
2. A PostgreSQL connection can be created in fields mode **and** in URI mode, tested, saved, edited, duplicated, colored, marked read-only and deleted — all surviving a relaunch.
3. `kira:connections:list` provably never returns a password; `connections.password` is touched only by `src/main/storage/repos/secrets.ts`.
4. Connecting turns the dot green and shows the server version on hover; disconnecting turns it grey; a failed connect shows the server's verbatim message.
5. The tree lazily expands connection → database → schema → table/view/matview/sequence/function → column, virtualized, at the configured row density.
6. A second expansion of the same node issues **no** database round-trip (visible as zero new operations-panel rows); *Refresh* issues exactly one; reconnecting invalidates and re-fetches exactly the expanded paths.
7. Panel search filters cached nodes only and says so; persistent filters hide nodes without refetching and survive a relaunch.
8. Right-clicking every P1 node kind opens a menu with exactly the Step 9b item set, asserted by a spec.
9. The operations panel shows every round-trip with its real command, duration and row count; running ops can be cancelled and the cancel reaches the server.
10. `tests/db/postgres.spec.ts` passes all ten scenarios, including the server-side cancellation assertion against `pg_stat_activity`.
11. `test-results/screenshots/` contains `project-tree.png`, `connection-dialog.png`, `operations-panel.png` and `context-menu-connection.png`, and they look like §8.1's chrome.
12. Nothing from §11 exists in the tree — in particular no second adapter, no `Page`/`read`, no CodeMirror, no L2/L3.
