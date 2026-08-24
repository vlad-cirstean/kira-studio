# Kira Studio — Specification (draft v0.1)

A visual database client (DataGrip/DBeaver class) for macOS. Electron + TypeScript + Vue 3.

> Status: **P0–P19 implemented** on the v1 feature branch — see §10's phasing table for the record.
> Where this spec and the tree disagree, the tree is authoritative; `README.md` describes what
> shipped.

> **Start here:** read `AGENTS.md` first — the working agreement — before this spec. Per-phase
> implementation plans live in `docs/plans/`.

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
in use, the connection is marked disconnected. See phase **P11** in §10.

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
| Text editing / viewing | CodeMirror 6 | definition tab's Source pane, cell editor, document view, command preview |
| Icons | `@vscode/codicons` | UI chrome |
| Validation | Zod | runtime validation at every trust boundary: IPC control-channel payloads, stored settings/layout/connection rows read back from SQLite, connection-dialog input |
| Lint + format | Biome, default rules | single tool, no ESLint/Prettier |
| Storage | SQLite at `~/.kira-studio/kira.sqlite`, accessed through **Drizzle ORM** | `drizzle-orm/sqlite-proxy` over `node:sqlite` (`better-sqlite3` as the driver fallback) — implementation detail behind the storage module |
| Packaging | electron-builder | unsigned local builds; signing/notarization after v1 |
| DB tests | Testcontainers (Node) | real containers, real data; Colima |
| UI tests | Playwright `_electron.launch` | every change validated |
| Logging | `electron-log` | main process only (`electron-log/main`), scoped loggers (`log.scope(name)`); the engine `utilityProcess` keeps writing to stdout/stderr, which main pipes into the same sink — single log file, single source of truth |

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
  definition: boolean       // gates "Open definition" — a structured + raw-text object view
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
  definition(path: NodePath, ctx: OpCtx): Promise<ObjectDefinition>
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
| PostgreSQL | database → schema → tables (ungrouped), views/matviews/functions/sequences grouped into per-kind folders | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `pg_cancel_backend(pid)` on a side connection |
| MariaDB | database → tables (ungrouped), views/routines grouped into per-kind folders (routines labelled "Routines") | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `KILL QUERY <threadId>` on a side connection |
| MongoDB | database → collections (ungrouped, indexes shown in the definition view) | documents | `_id` keyset, `skip/limit` fallback | `countDocuments` (slow) / `estimatedDocumentCount` | `AbortSignal` on the cursor, `killOp` fallback |
| Redis | db index → key namespaces (split on `:`) | key/value | `SCAN` cursor (never `KEYS`) | `DBSIZE` only (approx per-prefix) | abort the SCAN loop; `CLIENT KILL` for blocking cmds |
| Kafka | cluster → topics (folder), consumer groups (folder) | stream | offset window per partition | end-offset − begin-offset | stop consumer, `AbortSignal` |
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

Migrations are forward-only numbered SQL files applied on startup. Table access goes through
**Drizzle ORM** schema definitions that mirror the migration files. Every row read back out of
`settings`, `ui_layout` and `connections` is parsed through a **Zod** schema before use, so a
hand-edited or stale-shape row fails loudly instead of propagating `undefined`s into the UI.

S3 connections reuse the existing `connections` columns, mirroring SQS's own fields-mode
repurposing exactly (D8/D9): `host`/`port` are unused, `database` holds the **AWS region**, the
AWS **named profile** goes in `username`, and static keys (accepted only in URI mode, per the SQS
policy in §5.1) go in `uri`. `options_json` holds two independent overrides: `endpoint` (a
non-AWS S3-compatible target — LocalStack, MinIO) and `bucket` (scopes the whole tree to one
bucket via `HeadBucketCommand` instead of `ListBucketsCommand`, for IAM credentials that can only
ever see that one bucket and commonly deny `s3:ListAllMyBuckets` outright).

---

## 7. Caching

Three tiers, each with an explicit invalidation story.

**L1 — metadata** (databases, schemas, tables, columns, PK/FK, indexes, object definitions).
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

**No speculative fetching.** A page is loaded only in direct response to a user action — Next/
Previous, a filter/sort/projection change, Refresh, or the Count button. There is no background
prefetch of the next page and no automatic count-on-open; both existed at one point and were
removed by user request as unwanted background work rather than kept as an opt-out setting.

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
│              │  main view (grid / documents / definition / …) │
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

A visual mockup of this chrome (rounded-pill tabs, floating sidebar/editor/panel surfaces, the
4/6/8px corner-radius system) lives in `docs/design/vscode-modern-ui/`, grounded in VS Code's actual
`workbench.experimental.modernUI` CSS rather than approximated from memory.

### 8.2 Settings dialog

Modal, sectioned. v1 sections:
- **Appearance** — one font family + size for the whole app (UI, grid and editors alike), row
  density.
- **Data** — default page size. (Prefetch and count-on-open toggles existed at one point; both
  were removed as functionality per user request, not merely hidden here — see §7.)
- **Cache** — L2 byte budget, hit-rate readout, clear caches.
- **Advanced** — engine memory cap, op-log retention.

### 8.3 Project panel

Tree of connections. Each connection shows its **color** as a left rail/dot and a **green status dot**
when connected. Levels are lazy and cached (§7 L1).

**Grouping (P19, extended by P23).** For SQL/Mongo connections, tables (and Mongo collections) show
first, ungrouped, in the tree's own order; every other listed object kind — views, materialized
views, sequences, functions (MariaDB's routines) — collapses into a per-kind folder below them. For
Kafka, the whole root is foldered instead: **Topics** and **Consumer groups**, each collapsed by
default — a lone Consumer groups folder trailing several hundred topic rows would not be findable,
so unlike the SQL kinds there is no "primary kind first, ungrouped" tier here. A kind with no
members renders no folder, in either scheme. Folders are a renderer-only grouping of an
already-fetched child list: expanding one issues no IPC call and creates no op-log row.
Tables/views/matviews/collections and Kafka topics no longer expand in the tree — their
columns/indexes/constraints, or a topic's partitions and configuration, moved into the definition
view (§8.10-adjacent, below); a topic's partition list is still fetched fresh through the same
adapter call whenever the stream view's own partition filter is opened (§8.9), since that is a
second, live consumer of it unrelated to the tree.

- **Search box** — filters the tree over **cached nodes only**. Never issues a query. Nodes that have
  never been expanded are simply not searchable, and the panel says so rather than silently
  under-reporting.
- **Filters** — persistent hide/show rules per connection (`connection_filters`), edited in a small
  dialog: glob by default, regex opt-in, applies to databases/schemas/tables. Distinct from search:
  filters persist and hide, search is transient.

### 8.4 Tabs

A tab is `{ id, connectionId, path, kind, state }`. **Identity is `id`, not `path`** — the same table
opens any number of times, each with independent paging, projection, sort, filter and scroll state.
Tabs are tinted with the connection color. Kinds: `data`, `definition`, `document`, `keyvalue`,
`stream`, `console`.

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
- **UUID format** gets a generate button (a fresh `crypto.randomUUID()`, overwriting the buffer).
- **Timestamp formats** (epoch seconds/millis, ISO-8601) get a `datetime-local` picker alongside
  the local/UTC reading — picking a moment re-encodes it into whichever of the three shapes the
  cell already uses.
- **Hex and base64** get a second, editable "decoded text" pane below the raw value — the same
  bytes as plaintext, kept in sync in both directions (typing plaintext re-encodes the raw value;
  editing the raw value re-decodes the plaintext). Bytes that aren't valid UTF-8 show a note
  instead of a second editor rather than rendering garbled text.
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

Each item that has a keyboard shortcut prints it alongside its label, muted and right-aligned
(P21). Keys are written Windows/Linux-first below; macOS renders the ⌘/⇧/⌥/⌫ glyph form, and where
the two diverge the mac key follows a slash. See §8.16 for the binding table itself.

| Target | Items |
|---|---|
| Connection | Connect, Disconnect, **Open query console**, Refresh, Edit `F2`, Duplicate `Ctrl/Cmd+D`, Copy name `Ctrl/Cmd+C`, Copy URI `Shift+Alt+C`/`⌥⌘C`, Filters…, Color ▸, Read-only ✓, Delete `Delete`/`⌘⌫` |
| Database / schema | **Open query console**, Refresh, Copy name `Ctrl/Cmd+C`, Filters…, (Postgres) Set as default |
| Table / view / collection | Open data `Enter`, Open data in new tab, **Open query console**, Open definition, Refresh, Copy name `Ctrl/Cmd+C`, Copy qualified name, Count rows, Saved filters ▸ |
| Object-kind folder (P19, and P23's Kafka Topics/Consumer groups) | Refresh, Collapse all |
| Topic / queue (P23) | Open `Enter`, Open in new tab, Open definition, Copy name `Ctrl/Cmd+C` |
| Consumer group (P23) | Open definition, Copy name `Ctrl/Cmd+C`, Copy qualified name |
| Column (definition view) | Copy name, Add to projection, Sort by |
| Tab | Close `Ctrl/Cmd+W`, Close others, Close to the right, Close all, Duplicate tab, Copy name, Reveal in project panel |
| Grid cell | Copy `Ctrl/Cmd+C`, Copy with header, Copy as JSON, Paste `Ctrl/Cmd+V`, Edit `Enter`, Set NULL, Filter by this value, Go to referenced row |
| Grid row | Copy row(s) ▸ (TSV `Ctrl/Cmd+C`/CSV/JSON/INSERT), Duplicate row `Ctrl/Cmd+D`, Delete row `Delete`/`⌘⌫` |
| Grid header | Sort asc/desc, Clear sort, Hide column, Show all columns, Copy column name, Copy column values `Ctrl/Cmd+C` |
| Document | Expand all, Collapse all, Copy document, Copy `_id`, Edit, Delete |
| Operations log row | Copy command, Copy error, Re-run, Reveal originating tab, Cancel (if running) |
| Empty tree background | New connection `Ctrl/Cmd+N`, Refresh all, Collapse all |

A key is printed only where it genuinely runs that item. The tree's per-row **Refresh** shows
nothing on purpose: `F5` is the *active tab's* refresh, a different command on a different object.

### 8.11 Definition view

One tab, two panes via a **Structure / Source** toggle (Structure is the default). Both panes are
read-only. **Structure** shows Columns (type icon, PK/FK badge, type, nullable, default, comment;
right-click gives the "Column (definition view)" row above), Indexes, and — for a SQL table/view —
Constraints, each with a count badge; a Mongo collection replaces Constraints with **Validation**:
its `$jsonSchema` fields as a table (name, bsonType, required, description) with
`validationLevel`/`validationAction` chips, or the validator rendered as raw JSON when it isn't a
`$jsonSchema`, or an honest "no validator set" line when the collection has none. **Source** shows
the object's underlying text highlighted in CodeMirror — SQL DDL composed from the catalog (or
passed through verbatim on engines that support `SHOW CREATE`) for Postgres/MariaDB, and a Mongo
collection's creation-options document (EJSON) for MongoDB — with the same notes strip and Copy
behaviour as before. Available wherever `caps.definition` is true: Postgres/MariaDB tables, views
and materialized views, Mongo collections, and — as of P23 — Kafka topics/consumer groups and SQS
queues; never for sequences, functions, indexes, or any Redis/S3 node.

**Properties sections (P23).** Kafka and SQS have no `describe()`, so their Structure body is a
`sections` list of generic name/value/muted-detail tables (`PropertiesSection.vue`) instead of
Columns/Indexes/Constraints — the view no longer hard-requires `describe()` to render Structure at
all, which also means a *SQL* table whose `describe()` fails now still shows whatever Source has
rather than blanking the whole tab. A Kafka **topic** shows **Partitions** (id, leader,
replicas/ISR) and **Configuration** (its non-default `describeConfigs` entries, sensitive values
masked, degrading to a note rather than failing the tab if `DESCRIBE_CONFIGS` is denied); a
**consumer group** shows **Group** (state/protocol/member count), **Members** and **Committed
offsets**. An SQS **queue** shows a single **Attributes** section — its full `GetQueueAttributes`
set, `RedrivePolicy`/`Policy` pretty-printed as JSON — from one call that never receives or hides a
message (SPEC §5.1's automatic-read rule is about `ReceiveMessage` specifically). **Open in
console** is gated on the connection's `caps.sql` rather than shown unconditionally, since Kafka and
SQS have none.

### 8.12 Operations panel

Every DB operation, live. Columns: time, connection (color chip), tab, kind, status, duration, rows,
command (truncated, expandable in CodeMirror). Running ops show a spinner and a cancel button.
Filter box + level filter. Virtualized, capped in memory, persisted to `op_log` with retention.
Clicking a row reveals the tab that issued it.

### 8.13 Connections

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

### 8.14 Pending changes

Cell edits, added rows and deleted rows accumulate in a per-tab **pending-change set** — nothing
reaches the database until *Commit*. Changed cells are tinted, added rows marked in the gutter,
deleted rows struck through. *Preview command* renders the exact statements the set will execute;
*Rollback* discards it. A tab with pending changes warns before closing. Rows are addressed by
primary key; a table with no PK is editable only if the adapter can identify a row unambiguously
(e.g. `ctid`), otherwise editing is disabled with the reason shown.

### 8.15 Query console

A `console` tab bound to a connection (and optionally a default database/schema). CodeMirror with
per-engine highlighting, full undo/redo, run-statement / run-all, result grids reusing §8.5, and
errors surfaced verbatim. For non-SQL engines the console takes that engine's native command form
(Mongo shell-style commands, Redis commands); where an adapter has no console, `caps.sql` is false
and the menu item is absent. Every console kind completes as you type — SQL keywords (uppercase)
for Postgres/MariaDB, collection names and supported shell methods for Mongo, command names for
Redis — and shows inline syntax diagnostics for the statement under the cursor. Console contents
are saved to `saved_queries`.

### 8.16 Keyboard shortcuts

A **minimal, VS Code-flavoured** set only — command palette, tab switching/closing, panel toggles,
new connection, find, refresh, run, plus a handful of focus-scoped actions in the project tree and
the SQL grid. **Not remappable in v1**; the binding table is a single data file
(`src/shared/shortcuts.ts`, P21) so remapping is a later feature, not a rewrite.

Every binding is one entry in that table, and three consumers derive from it: the native menu bar's
Electron `accelerator` strings, the key printed next to a context-menu item (§8.10), and the local
keydown handlers. A printed key and the key that runs therefore cannot drift apart.

Entries are either **global** — emitted as an Electron accelerator, so they fire regardless of what
has DOM focus (`Cmd/Ctrl+,` settings, `Cmd/Ctrl+N` new connection, `Cmd/Ctrl+B`/`Cmd/Ctrl+J` panel
toggles, `Cmd/Ctrl+Shift+P` palette, `Cmd/Ctrl+F` find, `F5` refresh, `Cmd/Ctrl+Return` run,
`Cmd/Ctrl+Shift+Return` run all, `Control+Tab`/`Control+Shift+Tab` tab nav, `Cmd/Ctrl+W` close tab,
`Cmd/Ctrl+Shift+W` close window) — or **local**, owned by a DOM-focus-scoped keydown handler and
deliberately never an accelerator, so the same key can mean the right thing in two surfaces. The
local set is the grid's `Cmd/Ctrl+C`/`Cmd/Ctrl+V`/`Enter`/`Ctrl/Cmd+D`/`Delete` and the project
tree's `Enter`/`Ctrl/Cmd+C`/`Shift+Alt+C`/`F2`/`Ctrl/Cmd+D`/`Delete`. This split is what
`user-select: none` on `body` makes safe: outside a text field the native `role: 'copy'` accelerator
has nothing to act on, so the keydown reaches the page.

Keyboard scopes exist only where a focusable container and a selection already do — the project
tree and the SQL grid. The document, key/value, stream and operations views are mouse-and-menu only.

### 8.17 Tooltips

Every hover hint is app chrome, not the OS's: a `v-tooltip` directive (`workbench/state/tooltip.ts`)
replaces the native `title` attribute everywhere in `src/renderer`, rendered by one singleton,
`AppTooltip.vue`, mounted beside `ContextMenu.vue` and sharing the same `Teleport`/`fixed`/`.p-float`
chrome every other floating surface already uses. It opens after **400 ms** — the app's one hover-pause
constant, shared with the query console's lint-diagnostic delay (§8.15) — and re-arms instantly (no
pause) when the pointer moves from one hinted control straight to another, so scanning a toolbar reads
as one gesture. It hides on pointer-leave, click, any keypress, scroll, or window blur, and is
`pointer-events: none` so it can never intercept the press it describes.

The hovered control is resolved through one document-level, animation-frame-coalesced `pointermove`
listener plus `elementFromPoint`, deliberately not a `mouseenter`/`pointerover` handler on each control:
Blink dispatches no pointer events on a `disabled` form control, and a number of this app's hints exist
only to explain why a control is disabled (e.g. every write action on a read-only connection). Hit
testing sees a disabled control the same way it always did, so those hints still show.

Accessibility is two mechanical rules applied by the directive itself, not authored per call site: a
control with no accessible name of its own (no text content, no `aria-label`, no `aria-labelledby`)
gets the tooltip text mirrored into `aria-label`; while the tooltip is open, the control carries
`aria-describedby` pointing at it, and `focusin`/`focusout` open and close it for keyboard users the
same way pointer hover does.

---

## 9. Testing

**No unit tests.** Two suites only.

**Isolation from the dev server.** Both suites run against their own `KIRA_HOME` (§10, P0 D10) and
their own Testcontainers-provisioned databases, never the developer's real `~/.kira-studio` or a
database a running `bun run dev` session is connected to. Running the tests must not disconnect,
lock out, or otherwise disturb a `bun run dev` instance already running on the same machine.

### 9.1 Integration (Testcontainers, real data)

One container per engine, one fixture module per engine that seeds a realistic dataset: wide tables,
`NULL`s, unicode, large text/blob, nested JSON, composite PKs, self-referencing and multi-hop FKs,
≥ 1 M rows in one table to exercise paging and counts.

Scenarios per engine: connect/disconnect, tree enumeration, describe, definition, first page, deep page,
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
| **P11 Pre-connect scripts** | Per-connection optional shell command (e.g. port-forward) run before connect; connection marked disconnected if the process exits while in use; config UI in the connection dialog | Cuts across every adapter, so it lands once the adapter surface is complete, ahead of the final hardening pass |
| **P12 Hardening** | Memory/perf pass against §2 budgets, cache tuning, cold-start time, unsigned packaging | Measure once the surface is complete — nothing should still be changing under it |
| **P13 Nonfunctional checks** | Sweep for memory leaks, storage leaks, inefficient/redundant DB interaction, and insufficient caching across the whole codebase; fix everything found | P12 measured against budgets and only pulled the levers its numbers justified — several items were deliberately left open for a dedicated sweep (`docs/PERF.md` §4); this phase closes them before the surface is described in docs |
| **P14 Docs** | Descriptions in every expected in-repo location plus the main repository README — full functionality, install and dev-setup instructions | Written once the app's behavior and nonfunctional characteristics are final, so nothing documented here needs revisiting |
| **P15 GH tooling** | Pre-commit hook; GitHub Actions CI (macOS-only); tag-triggered unsigned macOS binary build; auto-update configuration verified | Last, since CI and release tooling should target a finished, documented build rather than a moving one |
| **P16 Misc fixes** | Explicit per-connection preconnect-mode checkbox (overrides P11's settle-window auto-detection); connection-kind icon picker; click-to-open connection-error popover; `scripts/demo-dbs/` full six-engine coverage; two font-family bugs; testcontainers preset packages for Postgres/MariaDB/Redis | Not a planned deliverable — a batch of user-directed fixes surfaced after P15 shipped, grouped into one phase rather than reopening P1/P9/P10/P11/P14 |
| **P17 S3** | Adapter + object browser view (bucket → prefix/object, `/`-delimited, per §4/§9 above) | Implemented: the tree mirrors redis's own namespace-tree shape exactly ('/' delimiter instead of ':', `bucket`/`prefix`/`object` node kinds instead of `database`/`namespace`/`key'), and an object reuses the `keyvalue` page kind — its metadata (ContentType/Size/LastModified/ETag/StorageClass/user Metadata) plus a `Body` field/value row is exactly the flat listing a redis hash key already renders, so `KeyValueView.vue` needed no new view. Read-only browsing only in this phase (no insert/update/delete of buckets or objects); `tests/db/s3.spec.ts` against a LocalStack container, mirroring `sqs.spec.ts`'s own structure |
| **P18 Autocomplete** | Field/identifier autocomplete in each connection kind's filter surface (the WHERE-clause-style input, and whatever the equivalent filter/query input is per engine), plus the same in the query console, plus basic SQL syntax (keyword) completion there | Implemented, scoped exactly to the four surfaces with a real free-text identifier grammar (SQL's WHERE/ORDER BY, Mongo's filter/SORT) plus the query console — Redis/Kafka/SQS/S3 have no such surface (local-page search, a structured multiselect, or nothing) and get nothing, per docs/plans/P18-autocomplete.md's D1. A new `AutocompleteField.vue` primitive owns its own `<input>` rather than wrapping `TextField.vue` (verified, not assumed, that a wrapper can't safely intercept Enter across two components — see the plan's §1); SQL columns are inserted dialect-quoted only when needed, Mongo fields as `field: ` with `_id` included and a curated `$`-operator vocabulary. The query console is covered by the plan's §9 addendum, implemented: undo/redo restored in the shared CodeMirror host (`history()`/`historyKeymap`, folded into the existing read-only compartment); the completion popup's 100 ms typing debounce removed (`activateOnTypingDelay`/`interactionDelay: 0`) and Tab (not Enter) accepts, keeping Enter a newline in the multi-line console; keywords, types and builtins complete uppercase (`sql()`'s `upperCaseKeywords`); completion extended to the Mongo (collection names after `db.`, the ten supported shell methods after `db.<collection>.`, `$`-operators) and Redis (command names on the first token only) consoles, each with its own `StreamLanguage` highlighting mode instead of SQL's; and inline lexical/shape-level diagnostics per engine via a new `lintSource` prop/compartment (`@codemirror/lint`, no gutter or panel — an underline plus a themed hover tooltip only), reusing each adapter's own error wording so a diagnostic can never contradict what running the statement would do |
| **P19 Tree reorganization + generic object-definition view** | Tree shows tables first, ungrouped; every other object kind (functions, sequences, etc.) grouped into per-kind folders by default. Tables no longer expand to show columns in the tree — that moves into the definition view. The definition view (today's DDL tab) defaults to a nicely parsed structured display (columns/indexes/constraints) with a toggle to see the raw SQL text as it works today; gains a MongoDB implementation (indexes, and the collection's JSON Schema validator if set); renamed to a more generic term than "DDL" to fit non-SQL connections | Implemented, per `docs/plans/P19-tree-reorg-definition-view.md`: a renderer-only `GROUPED_KINDS` table (view/matview/sequence/function, MariaDB's function folder labelled "Routines") splits an already-fetched child list into ungrouped tables/collections plus collapsed per-kind folders — expanding one issues no IPC call and no op-log row. Tables/views/matviews/collections became tree leaves; both SQL adapters' `children()` return `[]` at that depth and the DB specs' column assertions moved to `describe()`. The DDL feature was renamed end to end (`Caps.ddl`→`Caps.definition`, the adapter method, IPC channel, tab kind, L1 cache key, `views/ddl/`→`views/definition/`), with a legacy `'ddl'`-row coercion on read so upgrading doesn't drop open tabs or blank the Operations panel. `ObjectDefinition` gained `language`/`constraints`/`documentSchema`: Postgres fills `constraints` from the `pg_constraint` query it already runs for its DDL text (zero extra round trips), MariaDB from one added `information_schema.TABLE_CONSTRAINTS` query on the definition path only. The definition tab is one view with a Structure/Source `<Segmented>` toggle (not the mockup's four-way split) — Structure stacks Columns/Indexes/Constraints (SQL) or Indexes/Validation (Mongo) sections with count badges, fed by a second, independently-cached `describe()` load; the tree's former column-row context menu (Copy name/Add to projection/Sort by) relocated into the Columns section. Mongo's `definition()` sources Source from the collection's creation-options document (EJSON-relaxed) and Validation from its `$jsonSchema` validator, rendered as a field table when it is one, else raw JSON, with an honest empty state when there's none |
| **P20 Electrobun migration spike** | On a branch cut from this point, migrate the app off Electron onto Electrobun; then run the full automated perf suite (`tests/ui/budgets.spec.ts`, `perf.spec.ts`, `memory.spec.ts`, `startup.spec.ts` — see `docs/PERF.md`) on both branches and record the results side by side. Run each branch's suite multiple times, not once — these tests have real run-to-run variability (see `docs/PERF.md` §2.1's methodology note), so a single sample per branch isn't sufficient to call a difference real | **Blocked at Stage 0 — see `docs/plans/P20-electrobun-spike.md`.** The Electrobun runtime/SDK (as opposed to its npm CLI bootstrapper) is served only from `hutch.blackboard.sh`/`electrobun-artifacts.blackboard.sh`, both unreachable from this environment (403), and the existing perf suite is Electron-`_electron.launch`-bound so it cannot run against a non-Electron build regardless. The plan's own §0.4 verdict: the literal deliverable is not producible here on any hardware this project has had access to; a scoped down spike (throwaway shell, OS-level neutral harness) is possible in principle but needs a macOS 14+ arm64 machine with unrestricted egress, which has not been available (`docs/PERF.md` §3). Implementation is intentionally not started — the plan's own ground rules hold it pending answers to its §8 open questions |
| **P21 Menu shortcut hints** | Every context-menu item that has a keyboard shortcut prints it alongside its label, VS Code style — muted and right-aligned. A single shared binding table (`src/shared/shortcuts.ts`) becomes the one source of truth §8.16 already promised, feeding the native menu bar's accelerators, the context menus' displayed keys, and the local DOM-scoped keydown handlers alike, so a printed key and the key that runs can no longer drift. Audits all 104 context-menu rows across 21 builders, surfaces 5 bindings that already worked but were never shown (the grid's `Cmd/Ctrl+C` over cell/row/column selections, its `Enter`-to-edit, and the tab strip's `Cmd/Ctrl+W`), and adds 9 new ones following VS Code's own conventions — `F2` rename, `Delete`/`⌘⌫` delete, `Ctrl/Cmd+C` copy, `Ctrl/Cmd+N` new, `Enter` open, `Shift+Alt+C` copy path, plus duplicate on `Ctrl/Cmd+D` — scoped to the two surfaces that already have focus and a selection, the project tree and the SQL grid. See `docs/plans/P21-menu-shortcut-hints.md` | The right-click matrix (P6) and every view that feeds it are complete, so the audit can be exhaustive rather than provisional; and the binding table has to exist before shortcuts can be shown, let alone remapped |
| **P22 App-owned tooltips** | Every hover hint in the app is drawn by the app instead of by the OS. The native `title` attribute is removed from `src/renderer` entirely — all 123 of them, in 34 files — and replaced by a `v-tooltip` directive plus one `AppTooltip.vue` singleton mounted beside `ContextMenu.vue`, sharing the same `Teleport`/`fixed`/`.p-float` chrome every other floating surface already uses. Opens after 400 ms (the app's existing hover constant, `CodeMirrorHost.vue`'s lint delay), re-arms without the pause when moving between adjacent controls, hides on leave/click/key/scroll/blur, and is `pointer-events: none` so it can never intercept the press it describes. Resolves the hovered control through one document-level rAF-coalesced `pointermove` + `elementFromPoint`, deliberately *not* per-element `mouseenter`, because Blink dispatches no pointer events on a disabled control and a dozen of these hints exist only to explain a disabled state. Accessibility is two mechanical rules inside the directive: mirror the hint into `aria-label` where the control has no accessible name (only 18 `aria-label`s exist against 123 `title`s today), and wire `aria-describedby` while shown, with `focusin` opening it for keyboard users. See `docs/plans/P22-app-owned-tooltips.md`, §8.17 | Implemented exactly per the plan: all 123 real `title`/`:title` sites across 34 files converted (the 6 remaining `title=` in the tree are unrelated component props — `DialogFrame`'s and `SavedListMenu`'s own `title` prop, never a directive target), `main.ts` registers `v-tooltip` globally, `App.vue` installs and tears down the one document-level listener set. Seven existing UI-test assertions that read `title` as a data channel were retargeted to `data-kira-tip`, and `tests/ui/tooltips.spec.ts` covers the open-delay timing, a disabled control's hint (the case a naive `mouseenter` implementation would miss), a hint on a control inside an already-open popover, and both the `pointer-events: none` and `aria-describedby`/auto-`aria-label` guarantees |
| **P23 Kafka tree reshape + stream-engine definitions** | A Kafka topic stops expanding into partition rows — it becomes a leaf, the way P19 made SQL tables leaves — and the cluster's root list is organised into **Topics** and **Consumer groups** folders by extending P19's renderer-only `GROUPED_KINDS` table by two rows (no adapter change, no new `NodeKind`, no path segment, no IPC on expand). The partition data is relocated, not deleted: `caps.definition` flips to `true` for Kafka and SQS, and `ObjectDefinition` gains a generic `sections` list (name/value/detail rows) rendered by a new `PropertiesSection.vue` inside P19's existing definition view — a topic shows its partitions (id, leader, replicas, ISR, from metadata the tree already fetched and discarded) plus its `describeConfigs` topic configuration with sensitive values masked; a consumer group, which had no view at all, shows its state, members and committed offsets; an SQS queue shows its full `GetQueueAttributes` set. The definition view stops hard-requiring `describe()` (`Promise.allSettled`, `meta` may stay null) and gates its Open-in-console button on `caps.sql`. `children()` on a topic path is deliberately left intact — the stream view's partition multiselect is a live second consumer of it. Redis stays `definition: false` permanently (its key type/TTL/memory are already on every key/value page); S3 stays `false` as a named follow-up (a bucket's properties are five SDK calls a single-bucket IAM policy routinely denies). See `docs/plans/P23-kafka-tree-and-stream-definitions.md`, §5.1, §8.3, §8.10, §8.11 | Implemented exactly per the plan, including both of its own open questions resolved to their stated default: the whole Kafka root is foldered (D2, not just "other kinds"), and SQS is in scope (D9). `kafka/definition.ts` and `sqs/definition.ts` degrade to a `notes` line rather than failing the tab when `describeConfigs` (Kafka) is denied — verified against `tests/db/kafka.spec.ts`/`sqs.spec.ts` scenario 6 and `tests/ui/kafka.spec.ts`/`sqs.spec.ts`'s new definition-tab coverage, plus `tests/ui/definition.spec.ts` passing unchanged as D8's regression guard that Postgres/MariaDB/Mongo definition tabs moved by nothing |

---

## 11. Repository layout

**This is the tree as built**, with one exception: `main/window/` stayed a single `main/window.ts`
alongside sibling modules (`menu.ts`, `log.ts`, `oplog.ts`, `connections.ts`, `engine-host.ts`,
`engine-config.ts`, `preconnect.ts`, `tree-service.ts`) rather than its own directory. The goal was
to make two things cheap: **adding an adapter** and **adding an IPC-exposed domain**, without
growing any single file into a junk drawer as v1 filled in.

```
src/
  main/
    window/        BrowserWindow creation, native menu, app lifecycle
    storage/
      db.ts         node:sqlite open + pragmas — the only file that imports node:sqlite (D2)
      migrate.ts     forward-only migration runner
      migrations/    numbered .sql files
      schema/        one Drizzle sqliteTable() file per table, mirrors migrations/ 1:1
      repos/         one file per table: connections.ts, settings.ts, layout.ts, ops.ts, ...
                      — the only files that import the Drizzle instance
    ipc/
      connections.ts, tree.ts, settings.ts, ops.ts, ...   -- one file per IPC domain
      registry.ts    wires every domain's handlers into ipcMain, single place that must not miss one
    oplog.ts        op-log persistence, retention pruning
  engine/           utilityProcess host
    scheduler/      op lifecycle, cancellation, progress — driver-agnostic
    cache/          L1/L2/L3 tiers, byte-budgeted LRU (split from scheduler: caching and
                    cancellation are independent concerns that today live in one file)
    adapters/
      registry.ts   capability-keyed adapter lookup
      postgres/     index.ts (Adapter impl), client.ts, query.ts, definition.ts, read.ts
      mariadb/      same shape as postgres/
      mongo/ redis/ kafka/ sqs/ s3/   -- same shape once each ships; a new engine is
                    "add one folder matching this shape", never a change to scheduler/ or cache/
  renderer/         Vue app
    workbench/      shell, panels, status bar, settings dialog, context-menu service,
                    the app-owned tooltip (state/tooltip.ts, AppTooltip.vue — §8.17)
    project/        tree, connection dialog, filters, search
    views/
      grid/ documents/ keyvalue/ stream/ definition/ celleditor/ console/
                    -- each owns its own state module; a new page kind is one new folder here
                       plus one Page variant in shared/protocol, not a change to existing views
    state/          cross-view app state (tabs, active connection, op log ring) — promoted out of
                    workbench/ so views/ doesn't have to reach into workbench/ to read it
    bridge/         control.ts, port.ts — the only files that touch ipcRenderer/MessagePort
    theme/          tokens, codicons
  shared/
    protocol/       ipc.ts, port.ts, engine-ops.ts — wire message shapes, one file per channel group
    domain/         connection.ts, tree.ts, ops.ts, uri.ts — types + Zod schemas for domain
                    concepts, independent of any one transport
    caps.ts         the Caps/Adapter contract (§5)
tests/
  db/               testcontainers fixtures + per-engine scenarios, mirrors engine/adapters/
  ui/               playwright specs
docs/
```

**Why this split pays for itself:**
- **`storage/schema/` vs `storage/repos/`** separates "what the tables look like" (generated-adjacent,
  changes only with a migration) from "how the app queries them" (changes with every feature) — today
  both live inside single per-table files, so a schema tweak and a query tweak are an undiffable mix.
- **`main/ipc/` one file per domain plus a `registry.ts`** replaces a single growing `ipc.ts`. Adding
  `kira:tabs:*` for session restore, or `kira:s3:*` later, is a new file and one registry line, never
  an edit to unrelated handlers.
- **`engine/scheduler/` vs `engine/cache/`** are pulled apart because they are genuinely different
  lifecycles (an op's cancellation vs a page's eviction) that P1/P2 currently co-locate; keeping them
  separate now avoids a forced split later when Kafka/SQS streaming ops need scheduler changes that
  have nothing to do with caching.
- **Adapters keep one fixed internal shape** (`index.ts`/`client.ts`/`query.ts`/`definition.ts`/`read.ts`)
  so `tests/db/` can mirror `engine/adapters/` 1:1 and a reviewer already knows where MongoDB's
  `read.ts` will be before it exists.
- **`renderer/state/`** exists so `views/*` are siblings that depend downward on shared state, never
  sideways on each other or upward into `workbench/` — the dependency graph stays a tree as more
  view kinds (P8 documents, P9 key/value, P10 stream) are added.
- **`shared/protocol/` vs `shared/domain/`** separates "bytes on the wire" from "what the concepts
  mean," so a new transport (e.g. moving an op onto the MessagePort) never touches the Zod schemas
  that define what a connection or a tree node *is*.

---

## 12. Working agreement

- **One feature branch for all of v1.** No per-phase PRs — there is nothing to review against.
  `feature/kickoff` is that branch: everything specified in this document is v1, and agents
  working from this spec build directly on top of `feature/kickoff` rather than branching off
  `main`.
- **A phase's last step is to land its commits on `feature/kickoff`.** A phase is developed on
  its own branch (started as an exact copy of `feature/kickoff`'s tip), so once the phase's
  final step (its lint/typecheck/definition-of-done pass) is green, replay/push that branch's
  commits onto `feature/kickoff` — a fast-forward, since the phase branch never diverges from
  it. The next phase then starts its own branch from the new `feature/kickoff` tip.
- Biome default rules, no exceptions files without a reason recorded.