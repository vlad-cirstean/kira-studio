# Kira Studio — Specification (draft v0.1)

A visual database client (DataGrip/DBeaver class) for macOS. Electron + TypeScript + Vue 3.

> Status: **agreed.** Nothing is implemented. All open decisions have been answered and folded in.

---

## 1. Scope

**In scope (v1):** MariaDB, PostgreSQL, MongoDB, Redis, Kafka, SQS, S3. macOS only. Dark mode only.
Read paths complete. Write paths: **add row, delete row, and cell editing** — all staged as pending
changes with an exact-command preview. **DDL is read-only** but modelled for editing.

Also in v1: a **SQL/query console** (opened from the right-click menu of a connection, database or
table), **saved filters and queries per table**, and a per-connection **read-only guard** that blocks
every mutation path.

**Explicitly deferred:** credential encryption, MySQL, SQLite-as-target, light mode, Windows/Linux,
DDL editing, unit tests, code signing/notarization, auto-update. Deferred to v2: **SSH tunnel**.
Out for v1: export to CSV/JSON, connection folders/groups, split editor groups, multiple windows.

**Deferred to the end of the v1 plan:** **pre-connect scripts** — an optional per-connection shell
command (e.g. a port-forward) run before connecting; if the process exits while the connection is
in use, the connection is marked disconnected. See phase **P12** in §10.

---

## 2. Non-functional requirements

These are the two hard requirements; every design choice below is justified against them.

### 2.1 Silky UI

| Interaction | Budget |
|---|---|
| Grid scroll frame | ≤ 8 ms (120 Hz displays) |
| Cell selection → editor panel populated | ≤ 50 ms |
| Tab switch (cached) | ≤ 50 ms |
| Tree node expand (cached) | ≤ 50 ms |
| Any DB round-trip | async, non-blocking, always cancellable |

Rules that follow:
- The renderer never imports a database driver and never parses a wire protocol.
- No DOM node per cell for off-screen rows — the grid is virtualized in both axes.
- No Vue reactivity on row data. Rows live in plain frozen typed structures; the grid reads them
  imperatively and re-renders on an explicit version counter.
- Long lists (tree, log panel, document view) are virtualized too.
- Every operation that can exceed ~150 ms shows progress and a working stop button.

### 2.2 Small RAM footprint

Target: **< 350 MB total RSS** across all processes with 5 live connections and 10 open tabs.

- Result sets are stored **columnar**: one array per column plus a shared row count, instead of one
  JS object per row. Cuts per-row overhead by ~4–6× on wide tables.
- Every cache has a **byte budget**, not an entry count. Eviction is LRU on measured size.
- Result pages are held only for tabs that are open; closing a tab frees its pages immediately.
- The engine process runs with a bounded old-space so runaway result sets fail loudly instead of
  swapping the machine.
- Disconnecting a connection releases its driver state and all its cached pages (metadata stays,
  it is on disk).

### 2.3 Caching

Every DB read goes through the cache layer. A cache miss is the only thing that produces a query.
See §7.

---

## 3. Stack

| Concern | Choice | Note |
|---|---|---|
| Shell | Electron (latest stable) | native title bar, macOS 13+, `arm64` only |
| Language | TypeScript 7 (native compiler) for `.ts` | `.vue` typechecks with whatever the Vue tooling supports (TS 5.x if needed); converge on one toolchain once `vue-tsc` runs on TS7 |
| Package manager / scripts / test runner | Bun | Electron runs on its embedded Node — Bun is tooling only |
| Build | electron-vite | Vite HMR for renderer, esbuild for main/engine |
| UI | Vue 3 (`<script setup>`, Composition API) | |
| Styling | Tailwind (v4, CSS-first config) | tokens mirror VS Code Dark Modern |
| Text editing / viewing | CodeMirror 6 | DDL tab, cell editor, document view, command preview |
| Icons | `@vscode/codicons` | UI chrome |
| Validation | Zod | runtime validation at every trust boundary: IPC control-channel payloads, stored settings/layout/connection rows read back from SQLite, connection-dialog input |
| Lint + format | Biome, default rules | single tool, no ESLint/Prettier |
| Storage | SQLite at `~/.kira-studio/kira.sqlite` | `node:sqlite` if it holds up, else `better-sqlite3` — implementation detail behind the storage module |
| Packaging | electron-builder | unsigned local builds; signing/notarization after v1 |
| DB tests | Testcontainers (Node) | real containers, real data; Colima |
| UI tests | Playwright `_electron.launch` | every change validated |

Driver libraries — the best-maintained option per engine: `pg`, `mariadb`, `mongodb`, `ioredis`,
`@confluentinc/kafka-javascript` (native, heavier, but actively maintained where `kafkajs` has
stalled), `@aws-sdk/client-sqs`, `@aws-sdk/client-s3`.

App identity: organisation **kirathecat**, bundle ID `com.kirathecat.kira-studio`. No auto-update.

---

## 4. Process architecture

```
┌─────────────┐   MessagePort (bulk data)   ┌──────────────┐
│  renderer   │◄───────────────────────────►│    engine    │  utilityProcess
│  (Vue, UI)  │                             │  (drivers)   │
└──────┬──────┘                             └──────┬───────┘
       │ ipcRenderer (control, storage, dialogs)   │ lifecycle, config
       └────────────────────┬──────────────────────┘
                     ┌──────┴──────┐
                     │    main     │  windows, menus, SQLite, settings, op log
                     └─────────────┘
```

**Why a separate engine process.** Driver work (socket reads, protocol parsing, row decoding) is
CPU-bursty. In the main process it would stall window/menu handling; in the renderer it would drop
frames. In its own process it is fully parallel and its memory is separately capped and reclaimable.

**One engine for all connections**, not one per connection: a V8 isolate costs ~35 MB, so
per-connection processes would blow the RAM budget at 5 connections. The adapter host is written so
a connection *can* be moved to its own process later (config flag) if a driver proves unstable.

**Bulk data skips the main process.** At window creation, main creates a `MessageChannel` and hands
one port to the renderer and one to the engine. Result pages travel renderer↔engine directly, as
transferable `ArrayBuffer`s where the column type allows. Control messages (connect, cancel,
settings) go through main so it stays the single source of truth for state and logging.

---

## 5. Driver adapter model

One capability-driven interface. Adding MySQL or SQLite later means adding one file, not touching
the UI.

```ts
type Caps = {
  tabular: boolean          // renders in the grid
  documents: boolean        // renders in the document view
  keyValue: boolean         // renders in the key browser
  stream: boolean           // renders in the stream view
  sql: boolean
  ddl: boolean
  projection: boolean       // can fetch a column subset server-side
  serverFilter: boolean
  exactCount: boolean
  keysetPagination: boolean
  foreignKeys: boolean
  writable: boolean
  transactions: boolean
}

interface Adapter {
  readonly caps: Caps
  connect(cfg: ConnectionConfig, ctx: OpCtx): Promise<void>
  disconnect(): Promise<void>
  children(path: NodePath, ctx: OpCtx): Promise<TreeNode[]>      // lazy tree level
  describe(path: NodePath, ctx: OpCtx): Promise<ObjectMeta>      // columns, PK, FK, indexes
  ddl(path: NodePath, ctx: OpCtx): Promise<SourceText>
  read(req: ReadRequest, ctx: OpCtx): Promise<Page>              // shape depends on caps
  count(req: CountRequest, ctx: OpCtx): Promise<number>
  preview(plan: MutationPlan): string[]                          // exact commands, no execution
  mutate(plan: MutationPlan, ctx: OpCtx): Promise<MutationResult>
}

type OpCtx = { opId: string; signal: AbortSignal; onProgress?: (p: Progress) => void }
```

`Page` is a discriminated union: `TabularPage` (columnar), `DocumentPage`, `KeyValuePage`,
`StreamPage`. The UI picks a view from the page kind, never from the database type — so a Postgres
`jsonb` column can open in the document view and a Mongo `$group` result can open in the grid.

### 5.1 Per-database mapping

| DB | Tree levels | Default view | Pagination | Exact count | Cancel mechanism |
|---|---|---|---|---|---|
| PostgreSQL | database → schema → tables/views/matviews/functions/sequences | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `pg_cancel_backend(pid)` on a side connection |
| MariaDB | database → tables/views/routines | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `KILL QUERY <threadId>` on a side connection |
| MongoDB | database → collections (+ indexes) | documents | `_id` keyset, `skip/limit` fallback | `countDocuments` (slow) / `estimatedDocumentCount` | `AbortSignal` on the cursor, `killOp` fallback |
| Redis | db index → key namespaces (split on `:`) | key/value | `SCAN` cursor (never `KEYS`) | `DBSIZE` only (approx per-prefix) | abort the SCAN loop; `CLIENT KILL` for blocking cmds |
| Kafka | cluster → topics, consumer groups | stream | offset window per partition | end-offset − begin-offset | stop consumer, `AbortSignal` |
| SQS | region → queues | stream | receive batches | `ApproximateNumberOfMessages` | `AbortSignal` on the SDK call |
| S3 | account → buckets → prefixes/objects (lazy, `/`-delimited) | key/value (object browser) | `ListObjectsV2` continuation token | `KeyCount` per listed page only (no cheap exact bucket count) | `AbortController` on the SDK call |

**SQS read policy.** Reads are **never automatic**. The stream view has an explicit **Poll** button
with a visible warning that `ReceiveMessage` makes messages invisible to real consumers for the
visibility timeout. Nothing is fetched on tab open, on refresh, or on a timer. Authentication is by
**named AWS profile**; static keys are accepted only in URI mode.

Cancellation is never "stop showing the result" — it is always forwarded to the server. If a driver
cannot cancel, the capability is absent and the stop button says so rather than lying.

---

## 6. Storage

`~/.kira-studio/` (dir `0700`), containing `kira.sqlite` (`0600`) and `logs/`.

Credentials are stored in **plain text** for now, in the `connections` table. The connection dialog
carries a visible notice to that effect. The column is named and accessed through a
`SecretStore` indirection so swapping in Keychain/encryption later is a one-file change.

```
schema_version(version)
settings(key, value)                                   -- fonts, sizes, budgets, toggles
connections(id, name, kind, color, mode, read_only, host, port, database, username, password,
            uri, options_json, created_at, updated_at, sort_order)
connection_filters(id, connection_id, node_kind, pattern, is_regex, action)  -- hide/show rules
saved_queries(id, connection_id, path, name, kind, body, created_at, used_at)
                                                       -- saved filters/queries per table + console
metadata_cache(connection_id, path, kind, payload_json, fetched_at, etag)
op_log(id, connection_id, tab_id, started_at, duration_ms, kind, status, rows,
       command, error)                                  -- rotated, capped
ui_layout(key, value)                                   -- panel sizes, visibility
tabs(id, connection_id, path, kind, state_json, order, active)  -- session restore, §8.4
```

Migrations are forward-only numbered SQL files applied on startup. Every row read back out of
`settings`, `ui_layout` and `connections` is parsed through a Zod schema before use, so a hand-edited
or stale-shape row fails loudly instead of propagating `undefined`s into the UI.

S3 connections reuse the existing `connections` columns: `host`/`port`/`database` are unused, the AWS
**named profile** goes in `username`, bucket/region/prefix defaults live in `options_json`, and static
keys (accepted only in URI mode, per the SQS policy in §5.1) go in `uri`.

---

## 7. Caching

Three tiers, each with an explicit invalidation story.

**L1 — metadata** (databases, schemas, tables, columns, PK/FK, indexes, DDL).
Persisted in `metadata_cache`. Survives restart. **No TTL** — an entry is dropped only when its
connection is deleted, and the whole connection's metadata is refreshed on **every reconnect**. Plus
manual *Refresh* from the tree context menu. This is what makes the project panel instant on launch and what lets panel search
work without touching the database.

**L2 — result pages.** In-memory LRU in the engine, byte-budgeted (default 64 MB, configurable).
Key = hash of `{connectionId, path, filter, projection, sort, pageSize, pageToken}`. Never persisted.
Invalidated by: manual refresh, any local mutation on the same target, disconnect.

**L3 — counts.** `{connectionId, path, filter} → {count, at}`. TTL 5 min, and immediately marked
*stale* (shown greyed with a refresh affordance) after any local mutation. Counts are only computed
on explicit user request — never automatically, because they are the most expensive read in the app.

**Prefetch.** After a page renders and the app is idle, the next page is fetched into L2 speculatively
(cancellable, dropped if the user navigates away). This is what makes paging feel instant.

**Observability.** The status bar shows cache size; the settings dialog shows hit rate and a
*Clear caches* action.

---

## 8. UI

### 8.1 Chrome

Native macOS title bar. Below it, the workbench:

```
┌───────────────────────────────────────────────────────────┐
│ ░ native title bar ░                                      │
├──────────────┬────────────────────────────────────────────┤
│              │  tab strip (colored per connection)        │
│   Project    ├────────────────────────────────────────────┤
│    panel     │  toolbar (colored per connection)          │
│              ├────────────────────────────────────────────┤
│              │  main view (grid / documents / DDL / …)    │
│              ├────────────────────────────────────────────┤
│              │  cell editor panel                         │
├──────────────┴────────────────────────────────────────────┤
│  operations panel                                         │
├───────────────────────────────────────────────────────────┤
│ ⬓ Project   ⬓ Operations                          ⚙ ●conn │  status bar
└───────────────────────────────────────────────────────────┘
```

Both side and bottom panels toggle from **status-bar buttons** (VS Code behaviour, VS Code icons,
but placed in the status bar as specified). The **settings** button also lives in the status bar.
Panel sizes and visibility persist. Theme is a single dark token set derived from VS Code **Dark
Modern** — both its colors *and* the recently reworked chrome layout: rounded/floating panels, thin
borders, the detached look rather than the older flat-edge one.

### 8.2 Settings dialog

Modal, sectioned. v1 sections:
- **Appearance** — one font family + size for the whole app (UI, grid and editors alike), row
  density.
- **Data** — default page size, prefetch on/off, count-on-open (default off).
- **Cache** — L2 byte budget, hit-rate readout, clear caches.
- **Advanced** — engine memory cap, op-log retention.

### 8.3 Project panel

Tree of connections. Each connection shows its **color** as a left rail/dot and a **green status dot**
when connected. Levels are lazy and cached (§7 L1).

- **Search box** — filters the tree over **cached nodes only**. Never issues a query. Nodes that have
  never been expanded are simply not searchable, and the panel says so rather than silently
  under-reporting.
- **Filters** — persistent hide/show rules per connection (`connection_filters`), edited in a small
  dialog: glob by default, regex opt-in, applies to databases/schemas/tables. Distinct from search:
  filters persist and hide, search is transient.

### 8.4 Tabs

A tab is `{ id, connectionId, path, kind, state }`. **Identity is `id`, not `path`** — the same table
opens any number of times, each with independent paging, projection, sort, filter and scroll state.
Tabs are tinted with the connection color. Kinds: `data`, `ddl`, `document`, `keyvalue`, `stream`,
`console`.

**Session restore.** On relaunch the previous tabs are reopened but their connections are **not**
opened automatically. A restored tab renders a centred **Reconnect & load** button and nothing else
until it is pressed.

### 8.5 Data view (tabular)

Toolbar, left to right:

`↻ refresh` · `⏮ ◀ page N of M ▶ ⏭` · `rows [10|100|1k|10k]` · `Σ count all` · `columns ▾ (projection)`
· `+ row` · `− row` · `⌘ preview command` · `🔍 search` · `⏹ stop`

Below it, a second **filter toolbar**, left to right:

`🕘 history` · `WHERE …` (free-text predicate, e.g. `field1 = 'a' and field2 is null`) ·
———— · right-aligned `ORDER BY …` (e.g. `field1 ASC, field2 DESC`)

- **History** opens the previously used filters and sorts for this table, plus anything **saved**
  (`saved_queries`); an entry can be named and pinned.
- The predicate and the sort are pushed **server-side** and reset paging. Invalid input is reported
  inline by the server's own error, unmodified.

- **Count all** computes the exact row count and thereby the page count; until then the pager shows
  `page N` with no total. On by request only.
- **Projection** — column multi-select; pushed server-side when `caps.projection`, else applied after
  fetch (and the toolbar says which).
- **Preview command** — opens a read-only CodeMirror panel with the exact statements the pending
  changes will execute. No execution from that panel.
- **Search toolbar** — toggled, VS Code-styled: query, match case, whole word, regex, match count,
  prev/next. Searches the **loaded page only** — never the server. Server-side narrowing is the
  filter toolbar's `WHERE`, and the two are deliberately not mixed.
- **Stop** — aborts the in-flight op and forwards the cancel to the server (§5.1). Enabled only while
  an op is running.

Grid: virtualized rows and columns, sticky header, row-number gutter, resizable/reorderable columns,
sort by clicking a header, multi-cell/row/column selection, `NULL` rendered distinctly from empty
string, type-aware right-alignment for numerics.

**Copy/paste.** Copy row(s) as TSV (default), CSV, JSON, or `INSERT` statements. Paste of TSV/CSV
into the grid stages new/edited rows as pending changes.

**PK/FK navigation.** A cell in a primary-key column shows a small button on hover/selection; pressing
it lists every column known to reference it (from cached FK metadata) and opening one spawns a **new
tab** pre-filtered to that value. A foreign-key cell does the mirror: jump to the referenced row.
Discovery is metadata-driven for Postgres/MariaDB. **Mongo has no FK navigation** in v1 — no
convention inference, no manual mapping.

### 8.6 Cell editor panel (bottom of the main area)

Clicking a cell renders its value here in CodeMirror.
- **Format autodetect** even for free text: JSON, XML/HTML, SQL, base64, hex, epoch seconds/millis,
  ISO-8601, UUID, URL, CSV, plain text. Detection is a scored guess, always overridable.
- **Manual type override** — dropdown; the choice sticks per column for the session.
- **Beautify** — two modes: *indented* and *compact* (single-line, no indentation).
- **Editable.** Committing a change stages a pending cell edit (§8.13) rather than writing
  immediately. The panel is forced read-only when the connection is marked read-only.

### 8.7 Document view (Mongo, and any document-shaped page)

Virtualized list of documents. Each document has expand/collapse (recursive, remembers state per
`_id`), an **edit** button and a **delete** button. Large values are truncated with a
"show all" affordance so a 2 MB document cannot stall a frame. Same search toolbar as the grid.

### 8.8 Key/value view (Redis)

Namespace tree from `SCAN` with `:` splitting; per-type value renderers (string, hash, list, set,
zset, stream) with TTL and memory usage shown. Never `KEYS`, never `SCAN` without a count budget.

### 8.9 Stream view (Kafka, SQS)

Message list with key, headers, partition/offset (Kafka) or message/receipt attributes (SQS), body in
the document/cell viewer. SQS is poll-on-demand only (§5.1).

### 8.10 Right-click coverage

Every one of these has a menu; the app has a single `ContextMenu` service so none is forgotten.

| Target | Items |
|---|---|
| Connection | Connect, Disconnect, **Open query console**, Refresh, Edit, Duplicate, Copy name, Copy URI, Filters…, Color ▸, Read-only ✓, Delete |
| Database / schema | **Open query console**, Refresh, Copy name, Filters…, (Postgres) Set as default |
| Table / view / collection | Open data, Open data in new tab, **Open query console**, Open DDL, Refresh, Copy name, Copy qualified name, Count rows, Saved filters ▸ |
| Column (tree) | Copy name, Add to projection, Sort by |
| Tab | Close, Close others, Close to the right, Close all, Duplicate tab, Copy name, Reveal in project panel |
| Grid cell | Copy, Copy with header, Copy as JSON, Edit, Set NULL, Filter by this value, Go to referenced row |
| Grid row | Copy row(s) ▸ (TSV/CSV/JSON/INSERT), Duplicate row, Delete row |
| Grid header | Sort asc/desc, Clear sort, Hide column, Show all columns, Copy column name, Copy column values |
| Document | Expand all, Collapse all, Copy document, Copy `_id`, Edit, Delete |
| Operations log row | Copy command, Copy error, Re-run, Reveal originating tab, Cancel (if running) |
| Empty tree background | New connection, Refresh all, Collapse all |

### 8.11 Operations panel

Every DB operation, live. Columns: time, connection (color chip), tab, kind, status, duration, rows,
command (truncated, expandable in CodeMirror). Running ops show a spinner and a cancel button.
Filter box + level filter. Virtualized, capped in memory, persisted to `op_log` with retention.
Clicking a row reveals the tab that issued it.

### 8.12 Connections

Two modes in one dialog:
- **Fields** — host, port, database, user, password.
- **URI** — a single connection string; anything exotic (TLS, replica sets, SASL, AWS static keys)
  lives here.

Plus: name, **color** (DataGrip-style palette, see below), a **Read-only** toggle, a test-connection
button, and a plain-text credential warning. A read-only connection disables `+ row`, `− row`, cell
editing, document edit/delete and console execution of anything but a read — the guard is enforced in
the **engine**, not just greyed out in the UI. The two modes are kept in sync where unambiguous (fields → URI is generated;
URI → fields is parsed best-effort and the dialog stays in URI mode if it cannot round-trip).

**Color palette** — twelve swatches approximating DataGrip's, tuned for a dark UI:

`Red #C75450` · `Orange #CC7832` · `Amber #BFA23A` · `Olive #91A93E` · `Green #499C54` ·
`Teal #2AA198` · `Cyan #3592C4` · `Blue #4B7BEC` · `Indigo #6C71C4` · `Violet #9876AA` ·
`Magenta #C066B0` · `Grey #6E7681`

The color appears on: the tree rail, the tab, and the data-view toolbar.

### 8.13 Pending changes

Cell edits, added rows and deleted rows accumulate in a per-tab **pending-change set** — nothing
reaches the database until *Commit*. Changed cells are tinted, added rows marked in the gutter,
deleted rows struck through. *Preview command* renders the exact statements the set will execute;
*Rollback* discards it. A tab with pending changes warns before closing. Rows are addressed by
primary key; a table with no PK is editable only if the adapter can identify a row unambiguously
(e.g. `ctid`), otherwise editing is disabled with the reason shown.

### 8.14 Query console

A `console` tab bound to a connection (and optionally a default database/schema). CodeMirror with
SQL highlighting, run-statement / run-all, result grids reusing §8.5, and errors surfaced verbatim.
For non-SQL engines the console takes that engine's native command form (Mongo shell-style commands,
Redis commands); where an adapter has no console, `caps.sql` is false and the menu item is absent.
Console contents are saved to `saved_queries`.

### 8.15 Keyboard shortcuts

A **minimal, VS Code-flavoured** set only — command palette, tab switching/closing, panel toggles,
find, refresh, run. **Not remappable in v1**; the binding table is a single data file so remapping
is a later feature, not a rewrite.

---

## 9. Testing

**No unit tests.** Two suites only.

### 9.1 Integration (Testcontainers, real data)

One container per engine, one fixture module per engine that seeds a realistic dataset: wide tables,
`NULL`s, unicode, large text/blob, nested JSON, composite PKs, self-referencing and multi-hop FKs,
≥ 1 M rows in one table to exercise paging and counts.

Scenarios per engine: connect/disconnect, tree enumeration, describe, DDL, first page, deep page,
count, projection, sort, filter, cancel-mid-query (asserted **server-side** — the query must actually
be gone from `pg_stat_activity` / `SHOW PROCESSLIST` / `currentOp`), cache hit/miss behaviour,
add/delete row, command preview correctness.

Requires **Colima** (with a running Docker-compatible daemon) on the dev machine. Local-only for
now — no CI wiring in v1.

### 9.2 UI (Playwright)

`_electron.launch()` against the built app, driving the real UI against the real containers. Every
change is validated with it before it is called done. Coverage: panel toggles, settings persistence,
connection CRUD, tree expansion and caching (assert query counts via the op log), opening the same
table twice with independent state, all pagination controls, projection, search toolbar modes, stop
button, cell editor autodetect + beautify, document expand/collapse, PK/FK navigation, every context
menu opening with the right items, copy/paste. Plus a memory/perf smoke test asserting the RSS budget
and no dropped frames while scrolling 10k rows.

---

## 10. Phasing

Ordered so each phase is independently demonstrable and nothing is built twice.

| Phase | Deliverable | Why here |
|---|---|---|
| **P0 Foundations** | Bun + Biome + TS7 + electron-vite; three-process skeleton with MessagePort; SQLite storage + migrations; dark theme tokens + codicons; workbench shell (panels, status bar toggles, settings dialog with fonts); Playwright harness that launches and screenshots the app | Everything else sits on this |
| **P1 Connections & tree** | Connection CRUD (fields + URI), colors, adapter interface, **PostgreSQL adapter**, connect/disconnect, lazy cached tree, green dot, tree context menus, filters + panel search, operations panel, L1 metadata cache. Testcontainers harness for Postgres | First end-to-end vertical slice; proves the adapter shape before writing five more |
| **P2 Tabular data view** | Virtualized grid, tabs (same table N times), pagination + page sizes, count-all, projection, sort, stop button, search toolbar, filter toolbar (`WHERE` + `ORDER BY` + history/saved), L2/L3 caches, prefetch. **MariaDB adapter** | Second SQL engine validates the abstraction cheaply |
| **P3 Cell editor** | CodeMirror panel, format autodetect, manual override, beautify (indented/compact) | Depends on grid selection |
| **P4 DDL tabs** | Read-only DDL view, editable-ready model | Small, independent |
| **P5 Mutations** | Add/delete row, **cell editing**, pending-change set, exact-command preview, commit/rollback, read-only guard, cache invalidation | Needs grid + cell editor + preview + op log |
| **P5.5 Query console** | `console` tab, run statement/all, results into the grid, saved queries | Needs the grid and the op log; independent of the remaining adapters |
| **P6 Interaction completeness** | Full right-click matrix, copy/paste rows, keyboard shortcuts | Needs all views to exist |
| **P7 PK/FK navigation** | FK metadata graph, cell buttons, filtered tabs | Needs mutations-era metadata and tabs |
| **P8 MongoDB** | Adapter + document view (expand/collapse, edit, delete) | First non-tabular shape; validates the page-kind union |
| **P9 Redis** | Adapter + key/value view | Second non-tabular shape |
| **P10 Kafka + SQS** | Adapters + stream view | Most divergent semantics; benefits from everything above |
| **P11 Hardening** | Memory/perf pass against §2 budgets, cache tuning, cold-start time, unsigned packaging | Measure once the surface is complete |
| **P12 Pre-connect scripts** | Per-connection optional shell command (e.g. port-forward) run before connect; connection marked disconnected if the process exits while in use; config UI in the connection dialog | Cuts across every adapter, so it comes last — nothing else depends on it |

---

## 11. Repository layout

```
src/
  main/          window, menus, storage (SQLite), settings, op-log persistence, IPC
  engine/        utilityProcess host: adapter registry, cache tiers, op scheduler, cancellation
    adapters/    postgres/ mariadb/ mongo/ redis/ kafka/ sqs/ s3/   (one dir each)
  renderer/      Vue app
    workbench/   shell, panels, status bar, settings dialog, context-menu service
    project/     tree, connection dialog, filters, search
    views/       grid/ documents/ keyvalue/ stream/ ddl/ celleditor/ console/
    theme/       tokens, codicons
  shared/        protocol types, page/adapter contracts, capability flags
tests/
  db/            testcontainers fixtures + per-engine scenarios
  ui/            playwright specs
docs/
```

---

## 12. Working agreement

- **Opus plans, Sonnet implements.** Each phase gets an Opus-authored plan committed under
  `docs/plans/`, then Sonnet executes it.
- Docs and comments: minimal and explanatory — say what is happening and why, never restate the code.
- **One feature branch for all of v1.** No per-phase PRs — there is nothing to review against.
- Autocompact is configured, so context management is handled automatically — do not stop
  implementation to manually `/compact` between steps.
- Biome default rules, no exceptions files without a reason recorded.