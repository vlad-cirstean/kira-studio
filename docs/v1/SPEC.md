# Kira Studio — Specification (draft v0.1)

A visual database client (DataGrip/DBeaver class) for macOS. Electron + TypeScript + Vue 3.

> **This is the v1 record, not a living spec.** It documents what v1 was specified to be, phase by
> phase (§10), kept as originally written rather than edited to track later changes. For the app
> **as it stands today**, read [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) instead — where the two
> disagree, the tree is authoritative over both, and ARCHITECTURE.md is authoritative for behavior.
> See [`docs/v1/README.md`](README.md) for what this folder is.

> Status: **P0–P37 implemented** (P38 skipped by user direction); P39 onward are user-directed
> post-v1 phases — see §10's phasing table for the full record. Per-phase implementation plans live
> in `docs/v1/plans/`.

---

## 1. Scope

**In scope (v1):** MariaDB, MySQL, PostgreSQL, SQLite, ClickHouse, MongoDB, Redis, Kafka, SQS, S3,
RabbitMQ. macOS only. Dark mode only. Read paths complete. Write paths: PostgreSQL/MariaDB/MySQL/
SQLite tables get **add row, delete row, and cell editing**, staged as pending changes with an
exact-command preview (§8.14). **ClickHouse tables get add row only** — a MergeTree `PRIMARY KEY`
is a sparse index, not a unique key, so there is no addressable row to update or delete (§5, §5.1).
MongoDB, Redis, Kafka, SQS and S3 also write — insert/update/delete gated per adapter's
`canInsert`/`canUpdate`/`canDelete` capability (§5, §8.7–§8.9) — but apply **immediately**, with no
staging or preview. **RabbitMQ queues get add row (publish) only** — a message has no
broker-assigned identity, so there is no per-message update or delete in the protocol at any
version, not merely one this app hasn't implemented (§5, §5.1). S3 additionally gets **download and
upload** (`caps.fileTransfer`, §5, §8.8) — streaming a whole object to/from a local file, since an
object's bytes are never a value the mutation-preview model can show inline. **DDL is read-only**
but modelled for editing.

Also in v1: a **SQL/query console** (opened from the right-click menu of a connection, database or
table), **saved filters and queries per table**, and a per-connection **read-only guard** that blocks
every mutation path.

**Explicitly deferred:** light mode, Windows/Linux, DDL editing, unit tests, code
signing/notarization, auto-update. Deferred to v2: **SSH tunnel**.
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
  describe: boolean         // the adapter implements describe() — false for kafka/sqs/redis/s3 (P31)
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

Beyond the illustrative fields above, the real `Caps` also carries `canInsert`/`canUpdate`/
`canDelete` (per-action write gating, §1) and `fileTransfer` — true only for S3: this engine's
items are whole files, streamed to and from a local path via a native OS dialog (`Adapter`'s
`downloadObject`, §8.8), rather than a value a mutation preview can show inline. `fileTransfer` is
orthogonal to the three write flags: Download reads regardless of a connection's read-only flag,
while Upload is gated on `fileTransfer && canInsert` together.

ClickHouse is the app's first **tabular SQL** adapter with `canUpdate`/`canDelete` both permanently
false alongside `canInsert: true` — a MergeTree `PRIMARY KEY` is a sparse index, not a unique key
(a table can hold multiple rows with an identical one), so a row cannot be addressed unambiguously
for an `UPDATE`/`DELETE` the way every other SQL engine in this app assumes. The same structural
reason Kafka's own two write flags stay false: not "not yet implemented," an honest, permanent
absence.

RabbitMQ is the third engine with `canUpdate`/`canDelete` permanently false, for a third distinct
structural reason: a message carries no broker-assigned identity at all (`message_id` is an
optional, publisher-set AMQP property, never one the broker itself assigns), and AMQP has no
per-message update or delete at any protocol version — only consuming a message (which this
adapter's own read path deliberately never does destructively, §5.1) or purging a whole queue
(out of scope). `canInsert: true` publishes through an exchange, the only mutation the protocol
offers.

### 5.1 Per-database mapping

| DB | Tree levels | Default view | Pagination | Exact count | Cancel mechanism |
|---|---|---|---|---|---|
| PostgreSQL | database → schema → tables (ungrouped), views/matviews/functions/sequences grouped into per-kind folders | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `pg_cancel_backend(pid)` on a side connection |
| MariaDB | database → tables (ungrouped), views/routines grouped into per-kind folders (routines labelled "Routines") | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `KILL QUERY <threadId>` on a side connection |
| MySQL | database → tables (ungrouped), views/routines grouped into per-kind folders (routines labelled "Routines"); no sequences (MySQL has no SEQUENCE engine) | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `KILL QUERY <threadId>` on a side connection |
| SQLite | one `database` node per `PRAGMA database_list` entry (in practice always exactly `main`) → tables (ungrouped), views grouped into a folder; no sequences or routines (SQLite has neither) | tabular | keyset on PK, else a unique index, else the table's own implicit `rowid` (never mutation identity); `LIMIT/OFFSET` only for a view or a text-sorted request | yes (`count(*)` measured at ~9 ms/1M rows) | none — SQLite has no interruptible statement (`sqlite3_interrupt` doesn't exist in `node:sqlite`, and the whole API is synchronous) |
| ClickHouse | one node per `system.databases` row → tables (ungrouped), views/materialized views grouped into per-kind folders; no sequences or routines (ClickHouse has neither); `system` is kept, not hidden | tabular | `LIMIT/OFFSET` only — a MergeTree `PRIMARY KEY` is a sparse index, with no unique row key to build a keyset cursor on | yes (`count()` reads part metadata) | `KILL QUERY WHERE query_id = '<id>' SYNC` on a second HTTP request (the client's own connection pool already has one free) |
| MongoDB | database → collections (ungrouped, indexes shown in the definition view) | documents | `_id` keyset, `skip/limit` fallback | `countDocuments` (slow) / `estimatedDocumentCount` | `AbortSignal` on the cursor, `killOp` fallback |
| Redis | db index (a leaf — its key namespace is unbounded, browsed in a Browse tab, §8.18) | key/value | `SCAN` cursor (never `KEYS`) | `DBSIZE` only (approx per-prefix) | abort the SCAN loop; `CLIENT KILL` for blocking cmds |
| Kafka | cluster → topics (ungrouped), consumer groups (folder) | stream | offset window per partition | end-offset − begin-offset | close the assigned consumer, `AbortSignal` |
| SQS | region → queues | stream | receive batches | `ApproximateNumberOfMessages` | `AbortSignal` on the SDK call |
| S3 | account → buckets (a leaf — a bucket's prefix/object space is unbounded, browsed in a Browse tab, §8.18) | key/value (object browser) | `ListObjectsV2` continuation token | `KeyCount` per listed page only (no cheap exact bucket count) | `AbortController` on the SDK call |
| RabbitMQ | one `database` node per virtual host (reuses the `database` kind, labelled "Virtual host") → queues (ungrouped), exchanges (grouped into an "Exchanges" folder); bindings live in the definition view, never the tree, since a binding has no name or ID of its own | stream | `basic.get` batches of up to 500 messages through the management HTTP API, no addressable position | no — `messages` is a live snapshot of a moving queue, never a transactional count | `AbortSignal` on the HTTP request (no server-side kill — there is no long-running query left executing after the socket closes) |

**SQS/RabbitMQ read policy.** Reads are **never automatic**. The stream view has an explicit
**Poll** button with a visible warning. For SQS, `ReceiveMessage` makes messages invisible to real
consumers for the visibility timeout; for RabbitMQ, `basic.get` (via the management API) requeues
every message it returns rather than removing it — nothing is lost, but each poll can reorder a
queue's messages and marks them redelivered on the next poll. Nothing is fetched on tab open, on
refresh, or on a timer for either engine. SQS's authentication is by **named AWS profile** (static
keys accepted only in URI mode); RabbitMQ's is HTTP basic auth against the management API, on port
**15672**, not AMQP's own 5672 — the adapter has no AMQP client at all, so an `amqp://` URI is
refused at connect rather than silently tried.

Cancellation is never "stop showing the result" — it is always forwarded to the server. If a driver
cannot cancel, the capability is absent and the stop button says so rather than lying.

---

## 6. Storage

`~/.kira-studio/` (dir `0700`), containing `kira.sqlite` (`0600`) and `logs/`.

Credentials in the `connections` table's `password` column are **encrypted at rest** (P25) via
Electron's `safeStorage` (Keychain-derived on macOS) as a `kira:v1:<base64>` envelope — plaintext
never touches disk for a connection created or edited since, and a row left plaintext by an older
build is upgraded in place on the next launch. The connection dialog's credential note reflects
the platform's actual backend rather than a fixed warning. Linux — development/CI only, v1 targets
macOS only (§1) — has no real keychain support: behind an explicit `KIRA_INSECURE_SECRETS=1` env
var it falls back to Chromium's `basic_text` obfuscation (a hardcoded key, not a real keychain);
without it, secret storage is unavailable and a write carrying a password is refused rather than
silently stored in the clear. The column is still accessed only through a `SecretStore`
indirection (now paired with a `SecretCipher`, `main/secret-cipher.ts` — the only file that
imports `safeStorage`), so a future re-key or a real cross-platform secret store stays a contained
change.

```
schema_version(version)
settings(key, value)                                   -- fonts, sizes, budgets, toggles
connections(id, name, kind, color, mode, read_only, host, port, database, username, password,
            uri, options_json, preconnect, preconnect_sidecar, created_at, updated_at, sort_order)
connection_filters(id, connection_id, node_kind, pattern, is_regex, action)  -- hide/show rules
saved_queries(id, connection_id, path, name, kind, body, pinned, created_at, used_at)
                                                       -- saved filters/queries per table + console
filter_history(id, connection_id, path, where_text, order_by_json, used_at)
                                                       -- §8.5's History list of past filters/sorts
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

SQLite connections reuse the same columns again, the same way (P35 D10): `database` holds the
**absolute file path** on disk, and `host`/`port`/`username`/`password` are all unused — there is
no server and no credential, only a file Kira opens.

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
4/6/8px corner-radius system) lives in `docs/design/kira-design-system/`, grounded in VS Code's
actual `workbench.experimental.modernUI` CSS rather than approximated from memory.

The whole workbench is inset from the window's own edge on three sides — 6px (`--kira-window-inset`)
top/right/left, 2px (`--kira-gap`, unchanged) on the bottom so the status bar still reads as seated
on the window edge — rather than flush against it (P31 D8). The tab strip scrolls horizontally once
its tabs overflow the available width (mouse wheel included), rather than clipping the overflow with
no way to reach it (P31 D6/D7).

### 8.2 Settings dialog

Modal, sectioned. v1 sections:
- **Appearance** — one font family + size for the whole app (UI, grid and editors alike), row
  density, and a **word wrap** toggle (P42), defaulting on, driven into every CodeMirror instance
  (query console, Mongo console, cell editor, translate panes) through a live-reconfigurable
  `Compartment` rather than a per-surface setting. Typing a font family that doesn't resolve to a
  real face marks the field invalid, names the browser fallback it lands on, and still saves it
  (settings apply immediately, not just valid ones) — a canvas-measurement check against a
  guaranteed-bogus probe name, since `document.fonts.check()` returns `true` even for a nonexistent
  family (P31 D9/D10). A font change re-measures every grid's column widths rather than reusing
  widths sized for whatever font was active when the app first measured (P31 D11).
- **Data** — default page size. (Prefetch and count-on-open toggles existed at one point; both
  were removed as functionality per user request, not merely hidden here — see §7.)
- **Cache** — L2 byte budget, hit-rate readout, clear caches.
- **Advanced** — engine memory cap, op-log retention.

### 8.3 Project panel

Tree of connections. Each connection shows its **color** as a left rail/dot and a **green status dot**
when connected. Levels are lazy and cached (§7 L1).

**Grouping (P19, extended by P23).** The primary kind shows first, ungrouped, in the tree's own
order; every other listed object kind collapses into a per-kind folder below it, collapsed by
default. For SQL/Mongo connections that's tables (and Mongo collections) ungrouped, with views,
materialized views, sequences, functions (MariaDB's routines) foldered. For Kafka it's topics
ungrouped, with only **Consumer groups** foldered — the same rule, not a special case. A kind with
no members renders no folder. Folders are a renderer-only grouping of an already-fetched child
list: expanding one issues no IPC call and creates no op-log row. Tables/views/matviews/collections
and Kafka topics no longer expand in the tree — their columns/indexes/constraints, or a topic's
partitions and configuration, moved into the definition view (§8.10-adjacent, below); a topic's
partition list is still fetched fresh through the same adapter call whenever the stream view's own
partition filter is opened (§8.9), since that is a
second, live consumer of it unrelated to the tree.

**Unbounded key/object spaces (P41).** A Redis `database` node and an S3 `bucket` node are leaves
in this tree (no twisty, `hasChildren: false`) for the same structural reason a table's columns
moved out: unlike a schema's table list, a db index's keyspace or a bucket's prefix/object space
has no fixed size and can nest arbitrarily deep, so caching it inline would mean caching an
unbounded tree. Double-clicking either row, or its context menu's **Browse objects/keys** item,
opens a dedicated Browse tab (§8.18) instead — the tree itself never renders a `namespace`,
`prefix` or `key`/`object` row.

- **Sticky ancestor headers (P28).** Scrolling the panel pins the currently-open connection,
  database and schema rows (up to three, outermost first) at the top of the list until the scroll
  passes into the next section, at which point the header stack slides out and the next
  connection's/database's/schema's own header takes its slot — no flicker, no gap. A pinned row is
  a real row: clickable, twisty-toggleable, right-clickable, and carries the connection's colour
  rail. Pure renderer geometry over the already-virtualized row list (`project/stickyBand.ts`) —
  no fetch, no new IPC call.
- **Search box** — filters the tree over **cached nodes only**. Never issues a query. Nodes that have
  never been expanded are simply not searchable, and the panel says so rather than silently
  under-reporting.
- **Filters (P28)** — a persisted set of *exclusions* per connection (`connection_tree_filters`),
  edited in a checkbox dialog reached from a row's context menu, opened focused on the row it was
  invoked from. Two sections: **Object types** (every node kind present under the connection, with
  a cached count — unticking one hides every node of that kind, and its P19 folder with it) and
  **Objects** (an expandable, flat-plus-depth tree over the same cached nodes, tri-state per
  container, with its own name-substring filter). Nothing you have not unticked is ever hidden,
  including an object fetched for the first time after the filter was saved — there is no pattern
  language, no glob, no regex, and no evaluation order to hold in your head. Distinct from search:
  filters persist and hide, search is transient.

### 8.4 Tabs

A tab is `{ id, connectionId, path, kind, state }`. **Identity is `id`, not `path`** — the same table
opens any number of times, each with independent paging, projection, sort, filter and scroll state.
Tabs are tinted with the connection color. Kinds: `data`, `definition`, `document`, `keyvalue`,
`stream`, `console`, `browse` (§8.18).

**Session restore.** On relaunch the previous tabs are reopened but their connections are **not**
opened automatically. A restored tab renders a centred **Reconnect & load** button and nothing else
until it is pressed.

### 8.5 Data view (tabular)

Toolbar, left to right:

`↻ refresh` · `⏮ ◀ page N of M ▶ ⏭` · `rows [10|100|1k|10k]` · `Σ count all` · `columns ▾ (projection)`
· `+ row` · `− row` · `⌘ preview command` · `🔍 search` · `⏹ stop`

`columns`'s corner mark is a plain accent dot, not a count, shown only when the tab's column set
deviates from default (some hidden, or reordered) — the exact numbers are in the tooltip instead
(P31 D38). **Preview command** separates staged statements with a blank line, not just the join's
own `;` (P31 D40).

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
  filter toolbar's `WHERE`, and the two are deliberately not mixed. A **filter toggle** narrows the
  grid to only the rows the search matched, without re-querying or losing scroll/selection state
  (rows are re-indexed by display position, the underlying page is untouched); a scan with zero
  matches while the toggle is on shows a dedicated "no matching rows" empty state with a one-click
  way back to every row, distinct from the table's own "no rows" state. The same filter toggle and
  match highlighting exist in every other in-page find widget the app has — document, key/value and
  stream (§8.7/§8.9) — sharing one state module (P31 D16-D21). Paging, Fetch more, a page-size
  change, Refresh or a `WHERE` re-run all restart the scan against the new page rather than leave a
  stale match list pointing at rows that no longer hold what matched (P31 D22-D24). **Viewport-first
  scanning (P42):** the rows currently on screen are scanned first, in their own frame, and
  highlighted immediately; the ordinary ascending pass then runs in chunked animation frames behind
  it, publishing a growing (`pending`) match list as it goes rather than nothing until the whole
  page has been walked. The filter toggle waits for a *completed* scan before it hides anything — a
  partial answer highlights, but never filters, so rows can't vanish and reappear as the scan
  catches up. The completed match list, and prev/next's own cycling, are always strictly ascending
  regardless of where the priority window sat.
- **Stop** — aborts the in-flight op and forwards the cancel to the server (§5.1). Enabled only while
  an op is running.

Grid: virtualized rows and columns, sticky header, row-number gutter, resizable/reorderable columns,
sort by clicking a header (direction shown as a 13px codicon pinned to the header cell's own right
edge, not a text glyph in the font-affected label flow — P31 D34), multi-cell/row/column selection —
including **click-and-drag** across cells (P42), extending a range selection the same way shift-click
already does, with the selection auto-scrolling the grid when the drag reaches an edge — and the
gutter/header's top-left corner cell **selecting every cell in the grid** on click. Two adjacent
selected cells share one border at their common edge rather than each drawing its own (a doubled
line where they meet, P42). `NULL` rendered distinctly from empty string, type-aware
right-alignment for numerics. Both axes render a 560px overscan buffer beyond the viewport (P29) —
a fast fling in either direction outruns the main thread's own re-render before it can show a blank
gap, not just vertically. A column header's hover tooltip (P42) separates the column name, its data
type and its glossary description into distinct visual rows rather than one run-on line — the same
structured tooltip shape §8.17 describes. Where two scrollbars meet (the grid's own bottom-right
corner, and any other scroll container) the corner square is transparent, not Chromium's opaque
white default (P42).

The gutter's staged-change rail is a 2px bar: warn/yellow for a pending edit, ok/green for a pending
insert, error/red for a pending delete (mutually exclusive — a row headed for deletion never also
reads as edited, P31 D31). `Delete`/`⌘⌫` fires from a cell or range selection too, not only a row
selection (P31 D32); the cell context menu's own **Delete row** does the same (P31 D33).

**Copy/paste.** Copy row(s) as TSV (default), CSV, JSON, or `INSERT` statements. Paste of TSV/CSV
into the grid stages new/edited rows as pending changes.

**PK/FK navigation.** A cell in a primary-key column shows a small button on hover/selection; pressing
it lists every column known to reference it (from cached FK metadata) and opening one spawns a **new
tab** pre-filtered to that value. A foreign-key cell does the mirror: jump to the referenced row.
Discovery is metadata-driven for Postgres/MariaDB. **Mongo has no FK navigation** in v1 — no
convention inference, no manual mapping.

### 8.6 Cell editor (mounted by the view that owns the tab)

Clicking a cell renders its value here in CodeMirror. The panel is owned and mounted by whichever
data-shaped view has the tab open — grid, documents, key/value, stream, console — appearing while
that tab has a selected cell and disappearing the instant it doesn't, including on a tab switch to
a tab with no cell selected or to a view kind that never mounts one (a definition tab, for
instance). A view kind opts out simply by not mounting it (P26).
- **Format autodetect** even for free text: JSON, XML/HTML, SQL, base64, hex, epoch seconds/millis,
  ISO-8601 (labelled "Time (ISO…)"), CSV, plain text. Detection is a scored guess, always
  overridable. **UUID and URL are not formats** (P42) — neither did anything useful when picked
  (no beautify, no validation), so a UUID/URL-shaped value now simply detects as plain text; a
  UUID-shaped value is still guarded against colliding with base64's own overlapping shape.
- **Manual type override** — an app-drawn picker (not a native `<select>`, P42, so each row can
  carry its own hover explanation matching the column header's — §8.17), common formats first,
  binary encodings last; the choice sticks per column for the session.
- **Validation (P42)** — every format checks the buffer for real against the *effective* (auto or
  overridden) format: JSON/XML for balance, CSV for a consistent column count, SQL for a lint
  error, a timestamp format for a parseable moment, base64/hex for a decodable shape. A failure
  shows a named "invalid" chip beside the format picker — broken JSON says where, a bad timestamp
  says so — rather than silently accepting it.
- **Beautify** — two modes: *indented* and *compact* (single-line, no indentation).
- **Generators (P42)** — a small panel of values a developer routinely needs to type by hand: a
  UUID (v4), a ULID, a random hex token, and "Now" (spelled for the effective format — an ISO
  timestamp, or an epoch count when the format is one of those). Never gated by the cell's own
  format — a generator writes text into the buffer regardless of what format that text is read as.
- **Timestamp formats** (epoch seconds/millis, ISO-8601) get a **translate pane** below the raw
  value, on the same footing as the hex/base64 decoded-text pane: an editable field plus a
  local/UTC toggle and an expressive calendar picker (month grid, time-of-day controls, a "now"
  shortcut), kept in sync with the raw value in both directions in real time — typing in the
  translate pane or picking a moment re-encodes the raw value, and editing the raw value re-parses
  into the pane. Re-encoding preserves the value's original shape byte-for-byte (separator, UTC
  offset style, fractional-second digits) apart from the digits that actually changed. The
  calendar's own month/year label (P42) is itself a control, cycling **days → months → years** so a
  date far away is a handful of clicks instead of dozens of single-month page turns; picking a month
  or a year moves only the calendar's view, never the selected value.
- **Hex and base64** get a second, editable "decoded text" pane below the raw value — the same
  bytes as plaintext, kept in sync in both directions (typing plaintext re-encodes the raw value;
  editing the raw value re-decodes the plaintext). Bytes that aren't valid UTF-8 show a note
  instead of a second editor rather than rendering garbled text.
- **Editable.** Committing a change stages a pending cell edit (§8.14) rather than writing
  immediately. The panel is forced read-only when the connection is marked read-only, and likewise
  when the cell's value was truncated on load — a partial value can be read and copied, but never
  staged as a write over the full one. Its own byte figure is shown once, in the status badge
  alongside the decoded reading/truncation/beautify-failure notes it already carries (P42) — not a
  second time in a duplicate byte badge, which this panel no longer has at all.
- **Viewer mode** (P40): the query console's dock passes `readOnly` — a distinct, stronger flag
  than the two above. Those explain a *refusal* (a real write exists but is blocked), and keep
  their reason chip and full staging UI to say so; viewer mode means there was never a write on
  offer at all (a console result has no addressable row to write back to), so it shows no reason
  chip and hides every affordance that exists only to serve staging one — the generators panel, the
  `modified` chip, Beautify, Revert. Facts about the value (type, NULL/empty/truncated badges, the
  format select and its validation, both translate panes) still show; only ways to *write* it are
  hidden.

### 8.7 Document view (Mongo, and any document-shaped page)

Virtualized list of documents (P27). Toolbar: page-size control, a sort field, a **fields**
(projection) picker — pushed server-side via Mongo's `find()` projection — exact count, and an
**Add document** action.

A collapsed row shows only its `_id` — in Mongo shell form, `ObjectId("…")`/`ISODate("…")`/etc. —
plus a field-count badge and a byte-size badge, never any part of the body. Every document is
**expanded by default**, to its first layer of keys only: a nested object or array renders as a
one-line `{…} N fields` / `[…] N items` summary with its own twisty, expanded independently and
never persisted (only the top-level expand/collapse state survives per `_id`, remembered the same
way it always has). *Expand all* / *Collapse all* act on that same first layer, never the nested
paths. A body past 64 KB falls back to its raw text rather than a tree, with a **truncated** badge.

Each row carries three actions in this order: expand/collapse (leading, the disclosure twisty),
**Edit** and **Delete** (trailing, both disabled with an explaining tooltip on a read-only
connection). Editing shows the document's shell-literal spelling — the same constructors the tree
renders, not the raw wire JSON — in the row's own edit area, alongside the shared buffer controls
(the `modified` chip, a live byte count, Beautify/Minify, Revert — the identical component the
cell editor's own header renders) and Save/Cancel. Insert/edit/delete execute **immediately**
against the server — no pending-change staging or preview (§8.14's staged model is the SQL grid's
own). The cell editor panel (§8.6) is never shown for a document tab: a document's own row is
already the read/write surface, and the panel has no primary key of its own to publish a cell for.
Same search toolbar as the grid (client-side only), scrolling a match into view even when it
starts outside the rendered window, with the same filter toggle and — new in P31 (D20) — real
match highlighting: the matched document's row itself, and, while collapsed, a preview line
showing the matched substring wrapped in `<mark>` (the row otherwise shows only `_id`, per D1
above). An expanded document's own body is not highlighted.

BSON values — `ObjectId`, dates, `Int32`/`Int64`/`Decimal128`, binary, and the rest of extended
JSON — are recognised by shape (no driver import in the renderer) and rendered in shell form
throughout: the `_id` line, the tree, the edit buffer and the clipboard all agree. The filter bar
and the Mongo console both accept a shell constructor call (`ObjectId('…')`) and a canonical
extended-JSON wrapper (`{"$oid": "…"}`) for the same value in the same document, and both offer
the six constructors as completions.

### 8.8 Key/value view (Redis, and S3 objects)

Opens one key's value (reached by descending a Browse tab to it, §8.18 — the namespace/`:`-split
navigation itself lives there, not here). Per-type value renderers (string, hash, list, set, zset,
stream) with TTL and memory usage shown. Never `KEYS`, never `SCAN` without a count budget.
Toolbar adds a page-size control and in-page search, with the same filter toggle and cell-level
highlighting as the grid (P31 D17). **Edit** and **Add key** are scoped to string-typed values
only (a hash/list/set/zset/stream element needs its own per-type semantics, out of scope for this
version); **Delete** works on any type. All three execute **immediately** — no pending-change
staging or preview.

**S3 objects (P33)** reuse this same view — a single object opens as a `KeyValuePage` whose rows are
its metadata (`ContentType`, `ContentLength`, `LastModified`, `ETag`, `StorageClass`, user
`Metadata.*`) plus, when the object is small enough, a synthetic `Body` row; `memoryBytes` carries
the object's real size (no longer always `null` for S3). Four actions, gated on `caps.fileTransfer`/
`canInsert`/`canUpdate`/`canDelete` and the connection's read-only flag exactly like Redis's own
gate:

- **Download** streams the object to a local path chosen via a native save dialog, never blocked by
  read-only (a read). The bytes go straight from the adapter to a temp file in the destination's own
  directory, renamed into place on success and unlinked on any failure or cancellation — never a
  partial file left at the real destination.
- **Upload** (the object tab's Add button, a bucket row's own tree menu, or a Browse tab's toolbar/
  container-row menu, §8.18) opens a file-choose dialog, then a small form (key, content type, both
  prefilled from the chosen file's name and the Browse panel's own current level) before a single
  `PutObject`; refused if the key already exists (S3 has no conditional-create, so this is a
  `HeadObject` probe first) or if a >5 GiB source is chosen.
- **Edit** replaces the body with a new `PutObject` that carries forward every other attribute
  `HeadObject` returned (`ContentType`, `Metadata`, `CacheControl`, etc. — a `PutObject` replaces the
  object wholesale, so anything not resent is gone). It is enabled only when the object is at or
  under 1 MB, not truncated, and decodes as valid UTF-8 — otherwise the Edit button stays visible but
  disabled, with a tooltip naming the actual reason (the real byte count, "truncated", or "not valid
  UTF-8") rather than just disappearing.
- **Delete** is `DeleteObject`, behind the same `window.confirm` precedent as a Redis key.

An object over 4 MB (`OBJECT_BODY_PREVIEW_BYTES`) shows no `Body` row at all — its metadata and size
badge still render, plus an explicit "too large to preview, download it" strip — rather than
transferring and truncating megabytes of a value nothing downstream can fully show anyway.

### 8.9 Stream view (Kafka, SQS, RabbitMQ)

Message list with key, headers, partition/offset (Kafka), message/receipt attributes (SQS), or
routing key/delivery attributes (RabbitMQ — `exchange`/`redelivered`/`payload_bytes`/
`payload_encoding`/`message_count` plus every non-headers AMQP property, under the broker's own
field spellings), body in the document/cell viewer. SQS and RabbitMQ are both poll-on-demand only
(§5.1), with their own warning-strip wording each — SQS's messages are consumed, RabbitMQ's are
requeued, and reusing one engine's sentence for the other would be a false statement about it. An
**Add message** action produces (Kafka), sends (SQS), or publishes (RabbitMQ) a new message with
key/body/headers — RabbitMQ additionally offers a routing key (prefilled with the queue's own
name), an exchange (prefilled to the default), and a **Persistent** checkbox
(`delivery_mode: 2`) — executed **immediately** with no staging or preview. Kafka is insert-only —
a topic's log is immutable, so there is no per-message update or delete; SQS also supports
**Delete** (a real per-item removal via the message's receipt handle) but no update; RabbitMQ is
insert-only too, for a different reason than Kafka's — a message has no broker-assigned identity to
address, not an immutable log. Kafka additionally offers offset/partition/timestamp filters with
session-only (non-persisted) history — the timestamp field has a calendar `IconButton` +
`DateTimePicker` trigger identical to the cell editor's own timestamp translate pane (§8.6), and an
unparseable value is reported inline (`.is-invalid` + a message) rather than silently discarded
(P31 D12-D14). In-page search shares the same filter toggle as the other three views, with the
app's own `color-mix` match tint (P31 D17/D21) — row-level, since a stream match has no single
column to point at.

### 8.10 Right-click coverage

Every one of these has a menu; the app has a single `ContextMenu` service so none is forgotten.

Each item that has a keyboard shortcut prints it alongside its label, muted and right-aligned
(P21). Keys are written Windows/Linux-first below; macOS renders the ⌘/⇧/⌥/⌫ glyph form, and where
the two diverge the mac key follows a slash. See §8.16 for the binding table itself.

| Target | Items |
|---|---|
| Connection | Connect, Disconnect, **Open query console**, Refresh, Edit `F2`, Duplicate `Ctrl/Cmd+D`, Copy name `Ctrl/Cmd+C`, Copy URI `Shift+Alt+C`/`⌥⌘C`, Filters…, Color ▸, Read-only ✓, Delete `Delete`/`⌘⌫` |
| Database / schema / (Redis) Database / (S3) Bucket | (Redis/S3 only, `caps.keyBrowser`) **Browse objects/keys** `Enter`, **Open query console**, Refresh, Copy name `Ctrl/Cmd+C`, Filters…, (Postgres) Set as default, (S3) Upload file… |
| Table / view / collection | Open data `Enter`, Open data in new tab, **Open query console**, Open definition, Refresh, Copy name `Ctrl/Cmd+C`, Copy qualified name, Count rows, Saved filters ▸ |
| Browse panel row (§8.18): Redis namespace / S3 prefix | Refresh, Copy name `Ctrl/Cmd+C`, (S3) Upload file… |
| Browse panel row (§8.18): Redis key | Open `Enter`, Open in new tab, Copy name `Ctrl/Cmd+C` |
| Browse panel row (§8.18): S3 object | Open `Enter`, Open in new tab, Copy name `Ctrl/Cmd+C`, Download…, Delete `Delete`/`⌘⌫` |
| Object-kind folder (P19, P23's Kafka Consumer groups, P37's RabbitMQ Exchanges) | Refresh, Collapse all |
| Topic / queue (P23) | Open `Enter`, Open in new tab, Open definition, Copy name `Ctrl/Cmd+C` |
| Consumer group (P23) / Exchange (P37) | Open definition, Copy name `Ctrl/Cmd+C`, Copy qualified name |
| Column (definition view) | Copy name, Add to projection, Sort by |
| Tab | Close `Ctrl/Cmd+W`, Close others, Close to the right, Close all, Duplicate tab, Copy name, Reveal in project panel |
| Console result tab (P42) | Close, Close others, Close to the right |
| Grid cell | Copy `Ctrl/Cmd+C`, Copy with header, Copy as JSON, Paste `Ctrl/Cmd+V`, Edit `Enter`, Set NULL, Delete row `Delete`/`⌘⌫`, Filter by this value, Go to referenced row |
| Grid row | Copy row(s) ▸ (TSV `Ctrl/Cmd+C`/CSV/JSON/INSERT), Duplicate row `Ctrl/Cmd+D`, Revert row(s) (un-stages a pending edit/delete on the row, disabled when there's nothing to revert), Delete row `Delete`/`⌘⌫` |
| Grid header | Sort asc/desc, Clear sort, Hide column, Show all columns, Copy column name, Copy column values `Ctrl/Cmd+C` |
| Document | Expand all, Collapse all, Copy document, Copy `_id`, Edit, Delete (P27: both copy items now copy the Mongo shell form — `ObjectId("…")`, not the raw wire JSON — so pasting *Copy `_id`* into the filter bar as `{ _id: … }` works) |
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
queues, and — as of P37 — RabbitMQ queues and exchanges; never for sequences, functions, indexes,
or any Redis/S3 node.

**Properties sections (P23).** Kafka and SQS have no `describe()`, so their Structure body is a
`sections` list of generic name/value/muted-detail tables (`PropertiesSection.vue`) instead of
Columns/Indexes/Constraints — the view no longer hard-requires `describe()` to render Structure at
all, which also means a *SQL* table whose `describe()` fails now still shows whatever Source has
rather than blanking the whole tab. A Kafka **topic** shows **Partitions** (id, leader,
replicas/ISR) and **Configuration** — empty, with a note explaining why: `@confluentinc/kafka-
javascript` (P32) has no `describeConfigs` call on either its compat or native surface, so this is
a permanent gap in the driver rather than an ACL-dependent one; a **consumer group** shows
**Group** (a named state and type — resolved from the driver's numeric enums, never the bare
digit — protocol, partition assignor, coordinator, member count), **Members** and **Committed
offsets**. An SQS **queue** shows a single **Attributes** section — its full `GetQueueAttributes`
set, `RedrivePolicy`/`Policy` pretty-printed as JSON — from one call that never receives or hides a
message (SPEC §5.1's automatic-read rule is about `ReceiveMessage` specifically). **Open in
console** is gated on the connection's `caps.sql` rather than shown unconditionally, since Kafka and
SQS have none.

**RabbitMQ (P37).** A **queue** shows **Queue** (type, durable, auto-delete, exclusive, state,
node, leader, consumer count, messages ready/unacknowledged/total, message bytes, policy, effective
policy definition), **Arguments** (every `x-*` argument, or an explicit "none set" row),
**Bindings** (the exchange, routing key and arguments of every binding into this queue), and
**Consumers** (tag, channel, ack mode, prefetch) — the queue's own `consumer_details` and
`effective_policy_definition` arrive on the same request that fetches everything else, so Bindings
is the only second call. An **exchange** shows **Exchange** (type, durable, auto-delete, internal,
policy), **Arguments**, **Bindings from this exchange**, and **Bindings to this exchange** — both
directions, since a binding has no name of its own (the management API synthesises one from the
binding's own properties) and an exchange-to-exchange binding is otherwise invisible from one side.
Three `notes` sentences state what the view would otherwise imply wrongly: message counts are a
live snapshot, not a transactional count; reading messages through the management API requeues
them; a binding's own "name" is a synthesised key, not something anyone assigned. **Open in
console** never appears — RabbitMQ has no `caps.sql`, the same reason Kafka and SQS lack it.

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
button, and a credential-storage note reflecting the platform's actual backend — Keychain-encrypted,
a Linux-only development fallback, or unavailable (§6). A read-only connection disables `+ row`, `− row`, cell
editing, document edit/delete and console execution of anything but a read — the guard is enforced in
the **engine**, not just greyed out in the UI. The two modes are kept in sync where unambiguous (fields → URI is generated;
URI → fields is parsed best-effort and the dialog stays in URI mode if it cannot round-trip).

**Color palette** — twelve swatches approximating DataGrip's, tuned for a dark UI, all twelve still a
valid, storable, renderable colour for a connection (`none` plus eleven hues):

`Red #C75450` · `Orange #CC7832` · `Amber #BFA23A` · `Olive #91A93E` · `Green #499C54` ·
`Teal #2AA198` · `Cyan #3592C4` · `Blue #4B7BEC` · `Indigo #6C71C4` · `Violet #9876AA` ·
`Magenta #C066B0` · `Grey #6E7681`

**Offered vs. storable (P42).** The picker (here, and the tree row's Color submenu, §8.10) offers a
**trimmed eight** — `none, red, amber, green, cyan, blue, magenta, grey` — dropping `orange, olive,
teal, indigo, violet`. The full twelve-entry enum above is never narrowed: the palette was built as
one lightness/chroma at eleven evenly-spaced hues, which put its two closest neighbours (blue and
indigo) under 26° apart — visible side by side as swatches, invisible in the 2px tab rail or 5px
status dot the colour is actually shown in. Trimming to the six hues with the widest minimum gap
(over 42°) fixes that; narrowing the *stored* enum instead would silently drop any connection
already saved with a retired colour on next launch (its row fails to parse), so a connection with
one keeps parsing, listing and painting its own rail exactly as before — it's just not offered to a
new one.

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
Redis — and shows inline syntax diagnostics for the statement under the cursor; a Mongo statement's
own diagnostics now (P42) include each top-level argument's shell-literal validity, not just
balanced brackets. Console contents are saved to `saved_queries`.

**One result set is shown at a time, chosen by a strip of chips** above it (P40) — a "Run all"
producing several result sets no longer stacks a fixed-height panel per statement; each chip reads
"Result N" (its position, which renumbers as siblings close), shows a leading icon for that result's
own kind (tabular/document/key-value), and closes with its own ×, dropping that result's cached
page; right-clicking a chip offers Close/Close others/Close to the right (§8.10). The chip strip is
styled closer to — while staying visually smaller and secondary to — the main tab strip (P42),
scrolling horizontally (wheel included) once it overflows. A toolbar toggle decides whether the next
run **appends** a new result set alongside the current ones (the default, P42) or **replaces** them
— a per-tab preference, so *not* accumulating results across runs is now the opt-in. The active
result's grid always fills the panel down to its own bottom edge (no fixed-height band left empty
below a short result). The same shared find toolbar the grid/document/key-value views use (§8.5)
docks above the active result, scoped to the console tab and resolving to whichever result is
currently active — switching the active result re-scans the toolbar's own query against it rather
than leaving a stale match list pointing at rows no longer on screen. The result grid's header shows
a column's type in its hover tooltip (name, type, glossary description), matching the main data
grid, rather than a badge in the header row.

**A Mongo statement's result** (P42) renders as the same read-only document view §8.7 describes —
DocumentTree.vue, moved to `views/shared/document/` so both places can mount it (§11) — rather than
the tabular grid every other engine's result reuses; each document starts **collapsed**, unlike the
Mongo data tab's own expanded-by-default (a console run is usually a shape-skimming glance at many
documents, not a read of one). No edit/delete affordance and no JSON validation chip beyond the
console's own diagnostics above — the result is read-only, the same as every other console result.

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
has nothing to act on, so the keydown reaches the page. The grid's own `Delete`/`⌘⌫` fires from a
cell or range selection too, not only a row selection (P31 D32) — `Ctrl/Cmd+D` (Duplicate row)
stays row-selection-only.

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

The directive's value can be a plain string, or (P42) a **structured** `{ title, meta?, body? }` —
rendered as a title line, a muted meta badge on that same line, and a body line below, rather than
one run-on sentence; the grid/console-result header (§8.5) and the cell editor's format picker
(§8.6) are its first two callers. The plain-text mirror (`data-kira-tip`, the newline-joined title +
meta + body) is unchanged either way — it's what accessibility and every existing assertion still
read — so a structured tooltip is a strictly additive widening of the one directive, never a second
mechanism.

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

### 8.18 Browse panel (P41)

The one place a Redis db index's keyspace or an S3 bucket's prefix/object space is actually
navigated — reached by double-clicking (or `Enter`-ing) a `database`/`bucket` row in the project
tree, or its context menu's **Browse objects/keys** item (§8.10). A `browse` tab, one lazy level at
a time, over the same `SCAN`/`ListObjectsV2` calls the tree used to make inline.

**One level per screen, never a recursive tree.** The panel shows exactly the children of its
*current level* — a namespace/prefix's own container children, or a top-level db index/bucket's
own. Double-clicking a container row descends into it; double-clicking a key/object row opens it
in a key/value tab (§8.8), reusing the same tab identity rules as everywhere else. The toolbar's
**Up** button (disabled at the tab's own top level) and a breadcrumb (one crumb per path segment,
each a jump target) are the only ways to move between levels — there is no expand/collapse, and no
level is ever rendered nested under another.

**Tab identity persists the level, not just the container.** Reactivating an already-open Browse
tab (double-clicking its tree row again) resumes exactly where it was left — still three levels
deep, if that's where it was — the same `{ id, connectionId, path, kind, state }` identity every
other tab kind uses (§8.4), with `state.levelPath` as the one piece of Browse-specific state.

**Filter** is a plain client-side substring match over the level already loaded — never a second
`SCAN`/`ListObjectsV2` call, and the count strip reads `N of M` while a filter is active. **Upload**
(toolbar button, or a container row's own menu) opens the same dialog as the tree's bucket-row
Upload, prefilled with the current level's own prefix ahead of the chosen file's name. Row actions
are addressed by node kind, not the whole tab (§8.10's last three rows): a container row gets
Refresh/Copy name/Upload; a Redis key gets Open/Open in new tab/Copy name only (no download/delete
from this row, unlike an S3 object, which additionally gets Download…/Delete gated on caps and
read-only exactly like the key/value view's own toolbar buttons, §8.8).

Loading, empty, and error states follow the same `ReconnectGate`/`MessageStrip` chrome as every
other view — a restored tab shows **Reconnect & load** until pressed (§8.4), and a level with zero
children shows "No items" rather than an empty list indistinguishable from a still-loading one.

---

## 9. Testing

**No unit tests.** Two suites only.

**Isolation from the dev server.** Both suites run against their own `KIRA_HOME` (§10, P0 D10) and
their own Testcontainers-provisioned databases, never the developer's real `~/.kira-studio` or a
database a running `bun run dev` session is connected to. Running the tests must not disconnect,
lock out, or otherwise disturb a `bun run dev` instance already running on the same machine. One
exception is deliberate (P25 F10): on a real macOS dev machine, the Keychain item `safeStorage`
uses is named after the app and shared with the developer's own login keychain, so a UI test that
saves a connection password touches the same OS-level encryption key a `bun run dev` session
would. This is safe — each test's *secrets* stay isolated in its own temp `KIRA_HOME`'s
`kira.sqlite`, only the underlying key is shared, the same as any two processes signed as this app
would share it, and no test ever rotates or clears that key.

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
menu opening with the right items, copy/paste, the sticky ancestor band's exact geometry and handoff
across a scroll (P28), and the checkbox tree filter's kind/tri-state/name-filter/persistence behavior
(P28). Plus a memory/perf smoke test asserting the RSS budget and no dropped frames while scrolling
10k rows.

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
| **P20 Electrobun migration spike** | On a branch cut from this point, migrate the app off Electron onto Electrobun; then run the full automated perf suite (`tests/ui/budgets.spec.ts`, `perf.spec.ts`, `memory.spec.ts`, `startup.spec.ts` — see `docs/PERF.md`) on both branches and record the results side by side. Run each branch's suite multiple times, not once — these tests have real run-to-run variability (see `docs/PERF.md` §2.1's methodology note), so a single sample per branch isn't sufficient to call a difference real | **Out of scope — will not be done.** A later attempt got past the original Stage 0 network block (a machine with open egress to `hutch.blackboard.sh` reached and ran a real Electrobun build), so the migration was investigated properly rather than staying blocked on access. It surfaced two dealbreakers, not implementation friction: (1) **no E2E testing path exists.** Electrobun's webview is WKWebView, which Apple exposes no WebDriver/CDP endpoint for; `tests/ui/*.spec.ts`'s `_electron.launch()` has no equivalent to call, Cypress has the same wall (and worse tooling around it), and the one working alternative — Appium's `mac2-driver`/XCUITest — drives the OS accessibility tree, not the DOM, which for this app's grid-heavy, cell-level UI means rewriting the entire suite's interaction model from scratch with no CSS-selector equivalent, not porting it. (2) **the bulk-data architecture would regress.** SPEC §4's `MessageChannelMain` design hands the engine subprocess a port straight into the renderer so bulk query results never transit or block the main process; Electrobun's RPC bridge (confirmed by reading its `bridge-payload-ownership.test.ts` and finding no `Transferable`/`ArrayBuffer`/`structuredClone` anywhere in `rpc.ts`) only copies payloads, with no port-transfer primitive — every bulk page would move onto the same event loop as the native menu and window chrome, undermining the interaction budgets in `docs/PERF.md` §2.1 rather than just needing them re-measured. Electrobun is also pre-1.0 (Cottontail, its default JSC-based main-process runtime, is v0.5.0), so the API-compatibility surface under either `mainProcess` option is unverified beyond docs. Given both, the benefit (lower baseline memory/idle footprint) doesn't clear the cost. Superseded by a direct Electron memory-footprint pass instead (see `docs/PERF.md`) |
| **P21 Menu shortcut hints** | Every context-menu item that has a keyboard shortcut prints it alongside its label, VS Code style — muted and right-aligned. A single shared binding table (`src/shared/shortcuts.ts`) becomes the one source of truth §8.16 already promised, feeding the native menu bar's accelerators, the context menus' displayed keys, and the local DOM-scoped keydown handlers alike, so a printed key and the key that runs can no longer drift. Audits all 104 context-menu rows across 21 builders, surfaces 5 bindings that already worked but were never shown (the grid's `Cmd/Ctrl+C` over cell/row/column selections, its `Enter`-to-edit, and the tab strip's `Cmd/Ctrl+W`), and adds 9 new ones following VS Code's own conventions — `F2` rename, `Delete`/`⌘⌫` delete, `Ctrl/Cmd+C` copy, `Ctrl/Cmd+N` new, `Enter` open, `Shift+Alt+C` copy path, plus duplicate on `Ctrl/Cmd+D` — scoped to the two surfaces that already have focus and a selection, the project tree and the SQL grid. See `docs/plans/P21-menu-shortcut-hints.md` | The right-click matrix (P6) and every view that feeds it are complete, so the audit can be exhaustive rather than provisional; and the binding table has to exist before shortcuts can be shown, let alone remapped |
| **P22 App-owned tooltips** | Every hover hint in the app is drawn by the app instead of by the OS. The native `title` attribute is removed from `src/renderer` entirely — all 123 of them, in 34 files — and replaced by a `v-tooltip` directive plus one `AppTooltip.vue` singleton mounted beside `ContextMenu.vue`, sharing the same `Teleport`/`fixed`/`.p-float` chrome every other floating surface already uses. Opens after 400 ms (the app's existing hover constant, `CodeMirrorHost.vue`'s lint delay), re-arms without the pause when moving between adjacent controls, hides on leave/click/key/scroll/blur, and is `pointer-events: none` so it can never intercept the press it describes. Resolves the hovered control through one document-level rAF-coalesced `pointermove` + `elementFromPoint`, deliberately *not* per-element `mouseenter`, because Blink dispatches no pointer events on a disabled control and a dozen of these hints exist only to explain a disabled state. Accessibility is two mechanical rules inside the directive: mirror the hint into `aria-label` where the control has no accessible name (only 18 `aria-label`s exist against 123 `title`s today), and wire `aria-describedby` while shown, with `focusin` opening it for keyboard users. See `docs/plans/P22-app-owned-tooltips.md`, §8.17 | Implemented exactly per the plan: all 123 real `title`/`:title` sites across 34 files converted (the 6 remaining `title=` in the tree are unrelated component props — `DialogFrame`'s and `SavedListMenu`'s own `title` prop, never a directive target), `main.ts` registers `v-tooltip` globally, `App.vue` installs and tears down the one document-level listener set. Seven existing UI-test assertions that read `title` as a data channel were retargeted to `data-kira-tip`, and `tests/ui/tooltips.spec.ts` covers the open-delay timing, a disabled control's hint (the case a naive `mouseenter` implementation would miss), a hint on a control inside an already-open popover, and both the `pointer-events: none` and `aria-describedby`/auto-`aria-label` guarantees |
| **P23 Kafka tree reshape + stream-engine definitions** | A Kafka topic stops expanding into partition rows — it becomes a leaf, the way P19 made SQL tables leaves — and the cluster's root list follows the same rule P19 set for SQL: topics show first, ungrouped, and only the auxiliary **Consumer groups** kind folders, by extending P19's renderer-only `GROUPED_KINDS` table by one row (no adapter change, no new `NodeKind`, no path segment, no IPC on expand). The partition data is relocated, not deleted: `caps.definition` flips to `true` for Kafka and SQS, and `ObjectDefinition` gains a generic `sections` list (name/value/detail rows) rendered by a new `PropertiesSection.vue` inside P19's existing definition view — a topic shows its partitions (id, leader, replicas, ISR, from metadata the tree already fetched and discarded) plus its `describeConfigs` topic configuration with sensitive values masked; a consumer group, which had no view at all, shows its state, members and committed offsets; an SQS queue shows its full `GetQueueAttributes` set. The definition view stops hard-requiring `describe()` (`Promise.allSettled`, `meta` may stay null) and gates its Open-in-console button on `caps.sql`. `children()` on a topic path is deliberately left intact — the stream view's partition multiselect is a live second consumer of it. Redis stays `definition: false` permanently (its key type/TTL/memory are already on every key/value page); S3 stays `false` as a named follow-up (a bucket's properties are five SDK calls a single-bucket IAM policy routinely denies). See `docs/plans/P23-kafka-tree-and-stream-definitions.md`, §5.1, §8.3, §8.10, §8.11 | Implemented per the plan, with its D2 open question resolved the other way after user feedback: topics stay ungrouped at the root (the literal reading of "a folder for other elements", matching P19's SQL rule exactly) rather than the plan's own initial default of foldering the whole root; SQS is in scope (D9, as the plan defaulted). `kafka/definition.ts` and `sqs/definition.ts` degrade to a `notes` line rather than failing the tab when `describeConfigs` (Kafka) is denied — verified against `tests/db/kafka.spec.ts`/`sqs.spec.ts` scenario 6 and `tests/ui/kafka.spec.ts`/`sqs.spec.ts`'s new definition-tab coverage, plus `tests/ui/definition.spec.ts` passing unchanged as D8's regression guard that Postgres/MariaDB/Mongo definition tabs moved by nothing |
| **P24 Search filter, cell editor fixes, expressive date picker, design cohesion** | Three user-directed topics from one sweep, per `docs/plans/P24-search-filter-celleditor-dates-design.md`: (1) the grid's search toolbar gains a filter toggle that narrows the grid to only the matched rows, client-side and reversible, with its own "no matching rows" empty state; (2) a set of cell-editor bugs (a stale disabled-reset tooltip, no keyboard way to abandon an edit, a truncated value silently stageable as a full-value write, `statusLine` disagreeing with the buffer while typing) plus moving timestamp formats out of the native `datetime-local` picker into a **translate pane** on the same footing as the hex/base64 decoded-text pane — an editable field and an app-owned calendar picker (local/UTC toggle, month grid, time controls, a "now" shortcut), synced with the raw value in both directions in real time and re-encoding into the value's exact original shape; (3) a design-cohesion sweep fixing sixteen findings (F1–F16) — one icon size, one type scale, `SegmentedControl`/definition-section primitives replacing five sets of hand-rolled duplicates, `.is-invalid` states that were dead CSS, a `formatBytes` used from four different places instead of three divergent ones, and the grid's view header finally carrying the same kind/count/read-write/PK facts every sibling view already shows | Implemented per the plan, all twelve steps, each left `bun run lint`/`typecheck`/`build` green. `tests/ui/data-view.spec.ts` and `cell-editor.spec.ts` gained the new scenarios the plan's §5 names, but — like every other testcontainers-backed spec — could not be executed in the sandbox this phase was implemented in (Docker image pulls blocked by that environment's network policy, see `AGENTS.md`); they need a real run in CI or the macOS/Colima environment before this phase's `tests/db/`-adjacent coverage is considered verified. The four non-container specs (`smoke`, `startup`, `workbench`, `connections`) were run and pass |
| **P25 Credential encryption at rest (Keychain)** | Connection secrets (passwords, tokens, URIs with embedded credentials) move from plaintext in the SQLite `connections` table to OS Keychain-backed encryption — macOS Keychain via `safeStorage`/`keytar`-equivalent for now, with the storage layer shaped so a Linux/Windows credential-store backend is a later adapter, not a rewrite. Must account for the Playwright harness, which drives a real (if headless) Electron process and therefore a real, ask-free Keychain path in CI. See `docs/plans/P25-credential-keychain-encryption.md` | Security hardening, independent of every other v1 feature; deferred past the functional phases so it lands against a settled connection-record shape rather than one still moving under P17–P24. Implemented per the plan, application-code steps 1–6 and the docs step 8: `secret-cipher.ts` is the only file importing `safeStorage`, probed once after `app.whenReady()`; stored passwords are a `kira:v1:<base64>` envelope; a pre-P25 plaintext row is upgraded on next launch; `duplicate()` copies the ciphertext raw rather than decrypting; a decrypt/encrypt failure surfaces as a real message (`reveal()`'s `{password, error}`, the dialog's inline save error) instead of an unhandled rejection; the connection dialog's credential note reflects the platform's actual backend. `tests/ui/secrets.spec.ts`'s five scenarios pass locally (14 passed, 31 Docker-gated specs skipped, 0 failed on the full suite, zero edits to any existing spec per F12), including the Linux development-fallback path (`KIRA_INSECURE_SECRETS=1`) this sandbox actually runs under. **Not yet applied to this branch: step 7's CI change** (D15's keychain-prep step in `.github/workflows/ci.yml`'s `ui-smoke` job) — the session that implemented this phase had a GitHub token without the `workflow` OAuth scope needed to push a workflow-file change, so that one step's diff was handed to the repo owner to apply by hand instead of being committed. **Until it lands, `ui-smoke` on macOS CI may fail**: `secrets.spec.ts` scenario 1 deliberately asserts `available === true`/`backend === 'keychain'` rather than skipping (the whole point of D15's "fail loudly, not silently" CI guard), so a runner whose default keychain is locked or absent — exactly the case the missing step exists to fix — will now show up as a real red build instead of the wrong-but-quiet default. **Also not yet verified**: the macOS-only paths in general (a real Keychain, scenario 1's `darwin` branch) need a real run on macOS — this sandbox is Linux-only. |
| **P26 Cell editor moves inside the data view** | The cell editor panel is a workbench-global singleton today, mounted once outside any per-tab component tree; it is not scoped to the view showing it, so switching tabs can leave it rendering the previous tab's cell until a new cell is clicked in the new tab. It becomes owned by each data-shaped view instead — mounted and torn down with the view, like every other per-tab piece of state — so a tab switch cannot leave it stale, and a view kind can opt out of it entirely (Mongo's document view has no real use for it in its current form, see P27) | A latent cross-tab staleness bug, found through real use rather than a planned deliverable; fixing the panel's ownership before P27 reshapes the Mongo document view means that phase isn't also working around the same architectural issue. Implemented per `docs/v1/plans/P26-cell-editor-in-data-view.md`, all five commits: `state/cellSelection.ts` moved from one global slot to a per-tab-id record; a new `CellEditorDock.vue` is the only mount point, added to every data-shaped view (grid, documents, key/value, stream, console) and deleted from the shell along with the now-obsolete `CellEditorPanel.vue`; the two views' unmount-time clears that existed only to guard the old shared slot are gone, so a backgrounded tab now keeps its selection instead of losing it on switch-back; a dirty buffer now stages on unmount (not just on blur) so a keyboard-driven tab switch can no longer silently drop an in-flight edit. Mongo's `DocumentView.vue` mounts the dock unchanged, exactly as P26's own boundary with P27 specifies. `lint`/`typecheck`/`build` clean and the four non-Docker Playwright specs pass throughout; the new cross-tab-isolation scenario in `cell-editor.spec.ts` is Postgres-container-backed and could not be run in this sandbox (no Docker) — it needs a real run in CI or the macOS/Colima environment, the same caveat P24 recorded for itself. |
| **P27 Mongo document view redesign + ObjectId support + render perf** | Three related Mongo-specific fixes. (1) A document's collapsed preview shows only its primary key by default, all documents expanded to just their first layer of keys with correct spacing, and each document row gets three actions — edit, expand/collapse, delete — rather than expand/collapse being the only affordance; the cell editor panel (P26) is hidden by default for Mongo, its useful pieces (JSON beautify, byte count, revert) relocated into the expanded document's own edit area instead of a separate panel below. (2) `ObjectId` becomes usable in the filter bar (not just a raw 24-hex-char string match) and is parsed/rendered distinctly inside a document body — survey how other Mongo GUI clients (Compass, Studio 3T) represent it before choosing a shape, since a bare string and a tagged `{"$oid": "..."}` read very differently. (3) Mongo document rendering is currently slow enough to notice; profile and fix it | User-reported UX and performance issues in the one non-tabular view that ships today (P8); grouped into one phase because the preview reshape and the ObjectId work touch the same document-rendering code path, and the perf fix needs to be verified against whatever that reshape lands as, not the code it replaces. Implemented per `docs/v1/plans/P27-mongo-document-redesign.md`, all eleven commits: `beautify.ts` hoisted to the renderer root and `views/shared/useEditBuffer.ts`/`EditBufferActions.vue` extracted so the cell editor and the document row's own edit area share one dirty/beautify/bytes/revert implementation; `views/documents/ejson.ts` recognises the closed EJSON v2 wrapper set by shape (no `bson` import) and renders BSON in Mongo shell form; `engine/adapters/mongo/literal.ts` gained `resolveEjsonWrappers`/`parseDocumentLiteral` so the filter box, `mutate.ts` and the document editor all accept shell constructors *and* extended JSON in the same document; `VirtualList.vue` gained an additive `rowHeights` prop (prefix-sum offsets, binary search) backing `documentRows.ts`'s exact per-row height model and `DocumentTree.vue`'s flattened, CodeMirror-free read path; `DocumentView.vue`'s list moved onto that virtualizer with the new id-only/badge head, expanded-by-default first layer, and Edit/Delete row actions; the document view no longer publishes to the cell editor panel at all; the filter bar and Mongo console both offer the six BSON constructors as completions, and *Copy `_id`*/*Copy document* switched to the shell form. `bun run lint`/`typecheck`/`build` clean throughout and the four non-Docker Playwright specs pass; every Docker-gated spec this phase touches (`tests/db/mongo.spec.ts`'s new scenarios 23-24, `tests/ui/mongo.spec.ts`'s rewritten and new scenarios, `cell-editor.spec.ts` as the shared-buffer-extraction regression guard) self-skips cleanly in this sandbox (no Docker daemon) rather than erroring, and still needs a real run in CI or the macOS/Colima environment before this phase's document-tab rendering behavior is considered verified — the same standing caveat every Docker-gated phase in this branch has recorded for itself. |
| **P28 Connections panel: sticky group headers + checkbox filter** | Two independent connections-panel fixes. (1) Scrolling the panel keeps the currently-open connection's group header stuck at the top, like a sticky section header, until scroll passes into the next connection's group. (2) The panel's filter changes from a regex/text match over the flat list to an expandable checkbox tree — filtering by kind/tag/whatever the tree's own grouping already exposes, checked rather than typed | Two isolated, independently-scoped UI fixes to the one panel that hasn't had a dedicated pass since P1 introduced it. Implemented per `docs/v1/plans/P28-connections-panel-sticky-checkbox.md`, all nine steps: `tests/ui/support/tree.ts` unified twenty files' worth of duplicated/flaky Playwright helpers into one band-aware copy; `VirtualList.vue` gained an additive `scrollstate` emit and a zero-height `#sticky` overlay slot; `project/stickyBand.ts` computes the pinned connection/database/schema band (capped at three rows, clamped to the viewport) purely from the flat row array and scroll offset, rendered by `ProjectTree.vue` as real `TreeRow`s (`sticky` prop, distinct testid, `tabindex="-1"`) so a pinned row is fully interactive; `grouping.ts` gained `labelForKind()` as the one source of every node kind's display label, per connection kind. The filter half replaced the glob/regex rule list (`connection_filters`, `shared/domain/connection-filter.ts`) with a set of exclusions (`shared/domain/tree-filter.ts`'s `TreeVisibility`, `connection_tree_filters` in migration 0005) — nothing ticked off is ever hidden, including an object fetched for the first time after the filter was saved; `project/filterTree.ts` derives the checkbox dialog's kind rows, tri-state object rows and live consequence count from the same cached nodes the tree itself renders from, no new IPC call; `FiltersDialog.vue` was rewritten as the two-section checkbox UI and now opens focused on the row it was invoked from, ancestors pre-expanded. `bun run lint`/`typecheck`/`build` clean throughout and the four non-Docker Playwright specs pass; `tests/ui/tree.spec.ts`'s sticky-header and checkbox-filter scenarios are Postgres-container-gated and self-skip cleanly in this sandbox (no Docker daemon) — they still need a real run in CI or the macOS/Colima environment, the same standing caveat every Docker-gated phase on this branch has recorded for itself. |
| **P29 Grid/cell-view scroll rendering gap** | Scrolling either the data grid or the cell editor's own content quickly leaves a visible blank gap before the newly-scrolled-to content renders — worse horizontally than vertically. Root-cause the virtualization/paint timing (prefetch window, row-height math, horizontal column virtualization if any) and close the gap rather than papering over it with a spinner | A perceptible responsiveness regression in the app's two highest-traffic surfaces; standalone from every other phase in this batch. Implemented per `docs/v1/plans/P29-scroll-render-gap.md`, all eight steps: the report traced to `DataGrid.vue` (the only two-axis-virtualized surface — every CodeMirror host runs `EditorView.lineWrapping`, so the cell editor has no horizontal scroll to be "worse" at) and to five stacked causes — `rowRange`/`colRange` invalidating on every scroll pixel (fixed by deriving four primitive computeds so a sub-boundary scroll invalidates nothing downstream), zero column-axis overscan against the row axis's existing 560px (`columns.ts`'s `visibleColumnRange` gained symmetric pixel overscan, capped per side), ~126 `displayCell`/`cellNavEntry` calls per rendered cell from the template re-evaluating them on every render (collapsed into `renderRows`'s `RowVM`/`CellVM`, built once per render, template now reads fields only), `cellNavEntry` building a whole-row snapshot before knowing whether a column even had a nav affordance (gated on a `navColumns` precheck plus a narrow per-row value map), and `page.ts`'s decode cache clearing entirely on every row boundary crossed during a fling (now prunes only the rows that left the window). `.grid-row { contain: layout }` was added as a low-risk, low-cost addition; its own measured effect could not be isolated in this sandbox (see below). `bun run lint`/`typecheck`/`build` clean throughout and the four non-Docker Playwright specs pass; `budgets.spec.ts`'s new horizontal/wide-table scroll measurements and overscan-coverage invariants (`tests/ui/support/pg.ts`'s new `app.scroll_grid` fixture, 60 columns x 5000 rows) self-skip cleanly in this sandbox (no Docker daemon) and, along with the rest of the Docker-gated suite this phase's refactor is regression-guarded by (`data-view`/`mutations`/`interaction`/`tabs`/`leaks`/`cell-editor`/`perf.spec.ts`), still need a real run on the macOS/Colima box or CI — before/after PERF.md numbers are recorded as outstanding there, not fabricated. |
| **P31 Cross-cutting polish and bug-fix batch** | A grouped batch of unrelated small fixes surfaced by use, in the tradition of P16: (1) verify the `describe is not supported for kafka`/`for sqs` log lines are a stale/incorrect warning rather than a sign the data shown is mocked, and fix or remove the log; (2) the tab strip can't be scrolled when tabs overflow — it should; (3) changing the font in Settings has no effect — fix; (4) add a small margin between the app's panels and the window's left/right/top edges; (5) give the Kafka view's ISO-timestamp fields the same date-picker affordance the grid's cell editor has (P24); (6) bring search-match highlighting and the "show only filtered rows" toggle (P24) to the Kafka, SQS, and Mongo views, which don't have it; (7) the search toolbar's match state doesn't update when the underlying page changes (a new page, fetch-more, or fetch-less changing which rows exist) — fix so match indices/highlights never point at stale rows; (8) drop the tooltip on the connections panel's expand/collapse control (it adds noise, not information); (9) the "no color" option in the new-connection color picker currently reads as a dark swatch — make it unambiguously read as transparent/none; (10) add descriptive tooltips for every column data type shown in the grid/definition view; (11) the saved/recent filters menu's hover tooltip truncates content that needs to be readable in full — widen or reflow it; (12) deleted (pending-delete) rows get a red left-edge marker, matching the existing yellow-for-modified/green-for-new convention, and Delete becomes a working keyboard shortcut and a right-click menu item, not mouse/toolbar-only; (13) drop the redundant sort-direction text from a sorted column's header label now that the click-to-sort chevron already shows it; (14) the query console's autocomplete popup doesn't respond to Arrow Up/Down — fix keyboard navigation; (15) the columns-projection toolbar button's "activated" label text overlaps its icon — remove the label and replace it with a small indicator dot/mark on the icon itself; (16) the SQL preview panel should insert a blank line between each generated statement for readability | Batched the same way P16 batched its own post-P15 fixes — none of these sixteen items is large enough to be its own phase, several touch the same surfaces (Kafka/SQS/Mongo search parity, P24's search infrastructure), and batching means one round of `test:ui` regression coverage instead of sixteen. Implemented per `docs/v1/plans/P31-polish-bugfix-batch.md`, all eleven commits: `caps.describe` (false for kafka/sqs/redis/s3) stops the definition view's second load from ever firing for an adapter that can't serve it; `CodeMirrorHost.vue`'s completion keymap wrapped in `Prec.highest` so Arrow Up/Down reach the popup instead of `defaultKeymap`'s cursor-move winning by array order; the workbench gained a 6px three-side window inset and the tab strip scrolls (wheel included) once its tabs overflow; `renderer/fonts.ts`'s canvas-measurement check (a candidate family vs. a guaranteed-bogus probe, since `document.fonts.check()` returns true for anything) reports an unavailable font honestly and re-measures every grid's column widths on a font change; all four in-page search toolbars (grid/documents/keyvalue/stream) now share `views/shared/searchFilter.ts`'s filter-toggle state, restart their scan when the underlying page is replaced (`pageVersion.n`), and Mongo/stream gained real match highlighting and empty states to match the grid/key-value pair that already had them; `DateTimePicker.vue` moved to `views/shared/` for the stream view's since-timestamp field, which now validates on apply instead of silently discarding an unparseable value; the grid's gutter gained its own red pending-delete rail (mutually exclusive with the yellow edit rail), `Delete`/`⌘⌫` and the cell context menu's own **Delete row** both work from a cell/range selection now, not only a row selection; the header's sort chevron became a 13px codicon pinned to the cell's own right edge, the Columns/Fields buttons swapped their "N / M" text badge for a plain indicator dot (the counts stayed in the tooltip), and the preview command panel puts a blank line between staged statements; `typeGlossary.ts` widened from "just the exotica" to every SQL type family plus Mongo's BSON `bsonType` spellings, the grid header tooltip gained the description, the project tree's twisty dropped its redundant tooltip (kept `aria-label`), the "no colour" swatch became a diagonal-slash mark instead of a hollow ring that read as a 13th hue, and the three saved/recent filter menus gained full-text tooltips on every entry. `bun run lint`/`typecheck`/`build` clean throughout every commit and the four non-Docker Playwright specs (`smoke`/`startup`/`workbench`/`connections`) pass — `workbench.spec.ts`'s own font-availability scenario is a real, executable regression guard in this sandbox (not Docker-gated), and caught two genuine bugs in `fonts.ts` and a pre-existing `TextField`/`:invalid`-prop snap-back bug in `SettingsDialog.vue` along the way, both fixed. Every other item this batch touches is Docker-gated (`tests/db/`, `tests/ui/kafka.spec.ts`/`sqs.spec.ts`/`mongo.spec.ts`/`redis.spec.ts`/`data-view.spec.ts`/`tabs.spec.ts`/`tooltips.spec.ts`) and self-skips cleanly in this sandbox (no Docker daemon) rather than erroring; it still needs a real run in CI or the macOS/Colima environment, including `tooltips.spec.ts`'s own new D25/D27 assertions, which were not added blind against an environment this sandbox cannot exercise. |
| **P32 Kafka client migration + skip unnecessary group-join** | Migrate the Kafka adapter off its current client library onto `@confluentinc/kafka-javascript` (Kafka 4-compatible), and stop joining a consumer group for operations that don't need one — browsing/read-only paths currently pay a group-join round trip they have no use for | Kafka-adapter-internal; the client swap is lower-risk once P27's non-tabular-view lessons and P31's Kafka fixes are already landed, so it isn't chasing two moving targets in the same adapter at once | Implemented per `docs/v1/plans/P32-kafka-client-migration.md`, application-code steps 2–11 (step 1's macOS/Colima native-build proof could not run here — see below). `kafkajs` is gone from `package.json`/`src/`/`tests/` entirely (confirmed by grep); `@confluentinc/kafka-javascript@1.10.0` is a pinned production dependency, native and Electron-ABI-specific, built by the new `scripts/native-electron-build.sh` (marker + cache + `electron-rebuild`, wired as `predev`/`pretest:ui`/`pretest:db:kafka`/`prepackage:mac`) rather than electron-builder's own rebuild step. `client.ts`/`index.ts`/`produce.ts` moved onto the compat `KafkaJS` API behind one shared `RdConfig`; `errors.ts` classifies by librdkafka's numeric codes instead of kafkajs's error names; `catalog.ts`/`definition.ts` adapted to the new array-shaped `fetchTopicMetadata` and numeric group-state/type enums (resolved to names, never the bare digit); a topic's Configuration section is now permanently empty with a note, since this client has no `describeConfigs` call at all. The core commit (`read.ts`) rewrites the browse consumer onto `assign()` with explicit start offsets and a bounded poll loop — it never calls `subscribe()`, so it never joins a consumer group; `group.id` stays a required-but-never-joined constant instead of a per-browse UUID. The Kafka adapter suite left Bun for `ELECTRON_RUN_AS_NODE=1 electron` (`test:db:kafka`, `tests/electron-db/kafka.spec.ts` on `node:test`/`node:assert/strict`) since Bun cannot load this driver at any ABI; the seed fixture (`tests/db/fixtures/0005_kafka_seed.ts`) now runs the broker's own CLI inside the test container instead of a JS client, and the test broker moved from `cp-kafka:7.6.1` to `8.0.7` (Apache Kafka 4.0) — the compatibility target this phase exists for. Four new scenarios (17–20) prove the group-less browse structurally: no `kira-studio-browse` group ever appears in `listGroups()`, it carries no committed offsets, a timestamp filter still seeks via `fetchTopicOffsetsByTimestamp`, and an oversized start offset is refused rather than silently truncated. `bun run lint`/`typecheck` (all three projects, `tests/db`+`tests/electron-db`)/`build` are green throughout and the four non-Docker Playwright specs pass. **Not verified in this sandbox** (no Docker daemon, and Electron's headers host is proxy-blocked here): step 1's macOS-only native-build proof (a real `electron-rebuild` run, the `librdkafka`/feature-list probe, packaging's `asarUnpack`), the 20 `tests/electron-db/kafka.spec.ts` scenarios' actual assertions against a live broker, and `tests/ui/kafka.spec.ts` end to end — confirmed only as far as this container allows: the suite bundles with esbuild and loads correctly under `ELECTRON_RUN_AS_NODE=1 electron` (resolving every import including the adapter's constructor parameter properties and this repo's extensionless relative imports, and reaching `node:test`'s runner — answering D28's open question), then fails cleanly at the same "Docker daemon unreachable" point `tests/db`'s own Docker-gated specs already show in this sandbox. All of this needs a real run on the macOS/Colima box before the phase is considered fully verified. |
| **P33 S3: upload, download, delete, bounded edit** | S3 objects gain download and upload actions, and the demo-seed script gains more/larger sample content to exercise them against. Also add delete, and edit where the object is small enough to reasonably render/parse — above a size threshold, an object is neither parsed nor rendered, matching the grid's own large-value-truncation precedent (§8.6) rather than risking a stalled frame or a runaway parse | S3 shipped read-only browsing only in P17 S3, with mutation explicitly deferred; this is that deferred work, picked up once the rest of the mutation-and-editing patterns (grid pending-changes, Mongo insert/edit/delete, cell editor size limits) are established elsewhere in the app to reuse rather than reinvent | Implemented per `docs/v1/plans/P33-s3-mutations.md`. `caps.fileTransfer` is a new flag (true only for S3); `canInsert`/`canUpdate`/`canDelete`/`writable` all flip to `true` for S3 too. `s3/mutate.ts` rides the same sentinel-through-`MutationRowOp` technique `redis/mutate.ts` established (`_key`, plus `$file`/`$contentType` for an upload) — update/delete/insert, insert refusing an existing key via a `HeadObject` probe (S3 has no conditional-create) and preserving every other `HeadObject` attribute across an edit's `PutObject` (D11). `s3/transfer.ts` is the one file in the adapter that imports `node:fs`: `downloadObject` streams to a `.kira-partial-*` temp file in the destination's own directory, renamed into place on success and unlinked on any failure or cancellation. The preview ceiling drops from the old 32 MB truncate-and-show to 4 MB (`OBJECT_BODY_PREVIEW_BYTES`) with no `Body` row at all above it — a deliberate reversal (OQ1 in the plan), now that Download exists as the actual answer for a large object; a separate, lower 1 MB `OBJECT_BODY_EDIT_BYTES` gates Edit, which also refuses a truncated or non-UTF-8 body, each with a tooltip naming the real reason. `main/ipc/files.ts` adds one engine-neutral `kira:files:chooseSave`/`chooseOpen` IPC domain (native dialogs, `basename()`'d since an S3 key routinely contains `/`) rather than an S3-specific one. `KeyValueView.vue` gained a Download button (never blocked by read-only, D18) and reuses its existing `editOpen` ref to swap in the new `ObjectBodyEditor.vue` inline band for an S3 object instead of a second popover model; `state/objectStore.ts` (in `renderer/state/`, not `views/keyvalue/`, so `project/menus.ts` can reach it) holds the upload-dialog state and the download/upload/delete flows, driving the new `UploadObjectDialog.vue`. `scripts/demo-dbs/s3/seed.sh` grew from 3 objects in 2 buckets to a full size/type ladder (empty/small/medium/over-edit-limit/over-preview-limit/binary) plus a >1000-object `bulk/` prefix exercising `ListObjectsV2`'s continuation loop, and a third `kira-uploads-bucket` for the empty-bucket-upload case. `bun run lint`/`typecheck` (all three splits)/`build` are clean and the four non-Docker Playwright specs pass. **Not verified in this sandbox** (no Docker daemon, and LocalStack's image pull is blocked by network policy): `tests/db/s3.spec.ts`'s 27 scenarios and `tests/ui/s3.spec.ts`'s 7 scenarios were written and pass `playwright test --list`/typecheck/lint, but neither suite's assertions were ever executed against a live LocalStack container here — that run, and the demo seed's own `docker compose up` + `seed.sh` pass, both still need to happen in CI or on the macOS/Colima box before this phase is fully verified. |
| **P34 MySQL adapter** | A sixth SQL-family adapter, `engine/adapters/mysql/`, matching the fixed internal shape (`index.ts`/`client.ts`/`query.ts`/`definition.ts`/`read.ts`) `postgres/` and `mariadb/` already establish, with its own `tests/db/mysql.spec.ts` against a MySQL testcontainer | New-engine work is cheapest once every adapter-shape decision (definition view, pending-change staging, projection/caps negotiation) has already been exercised twice; MySQL is closer to MariaDB's dialect than any other engine in the app, so it's the lowest-risk new SQL adapter to add last | Implemented per `docs/v1/plans/P34-mysql-adapter.md`, all ten commits. The MariaDB adapter's driver, `mariadb` (npm), is a genuine dual MariaDB/MySQL client — P34 adds **no new dependency**. `engine/adapters/mysql-family/` is a new shared core (profile.ts's 3-field `MysqlFamilyProfile` — kind/serverLabel/applyEngineOptions — plus a separately-passed per-engine `caps` literal) extracted byte-for-byte from `mariadb/`; `mariadb/` keeps `index.ts`/`caps.ts`/`client.ts` with the real MariaDB profile and reduces `query.ts`/`read.ts`/`definition.ts` to re-exports, and `mysql/` mirrors that shape with the MySQL profile. `mysql-family/query.ts`'s `mapError` (renamed from `mapMariaError`) gained two new branches: MySQL 8's `caching_sha2_password` handshake failing over a plaintext connection (errno 45044) or against a self-signed cert under `sslmode=verify-full` (errno 45063) both map to `E_AUTH` naming both remedies (`sslmode=require` or `allowPublicKeyRetrieval=true`). `shared/domain/connection.ts` gained the `'mysql'` kind and its `DEFAULT_PORT` (3306); `views/shared/sqlIdent.ts` gained a `SqlDialect = 'postgres' \| 'mysql'` **family** type (mariadb and mysql share one dialect) and `sqlDialectFor()`, replacing twelve renderer call sites' hand-rolled kind checks whose silent `undefined` fallback for an unhandled kind would have emitted invalid double-quoted identifiers for MySQL — the failure this phase's own UI spec exists to catch. `EngineIcon.vue` and `_icons.html` gained a real (non-empty) MySQL mark; `ConnectionDialog.vue`/`grouping.ts` gained the MySQL tile, accent colour and "Routines" folder label (shared with MariaDB). `tests/db/mysql.spec.ts` ports `mariadb.spec.ts`'s 33 scenarios 1:1 with four engine-difference adjustments (server version, no sequence kind, a wider composite_pk row-estimate band for MySQL's statistics cache, view-not-sequence children) plus five MySQL-specific additions (two auth scenarios against never-authenticated `kira_nocache`/`kira_pubkey` users, native-JSON classification, absent integer display widths, and the big nested_json array surviving its `WITH RECURSIVE` seed port) — the fixture (`0008_mysql_seed.sql`) and its Testcontainers harness (`support/mysql.ts`) are the same byte-for-byte-port discipline, substituting `CHAR(36)` for MariaDB's UUID type and a digits-cross-join numbers table for its SEQUENCE-based `big_rows` insert (MySQL has neither). `tests/ui/mysql.spec.ts` is a small, deliberate subset of `tests/ui/mariadb.spec.ts` whose load-bearing assertion is the dialect seam above: a grid row's *Filter by this value* comes back **backtick**-quoted and narrows the grid for real. `scripts/demo-dbs/` gained an eighth service (`mysql:8.4` on host port 3307 — 3306 is already MariaDB's) with its own byte-parallel `init.sql`/`seed.sql`. `bun run lint`/`typecheck` (all three splits)/`build` are clean throughout every commit, and the four non-Docker Playwright specs (`smoke`/`startup`/`workbench`/`connections`) pass. **Not verified in this sandbox** (no Docker daemon, and `docker pull mysql:8.4` cannot fetch layers through the outbound policy here): `tests/db/mysql.spec.ts`'s 38 scenarios and `tests/ui/mysql.spec.ts` were written and pass `typecheck`/`lint`/`playwright test --list`, and the UI spec was confirmed to skip cleanly rather than error without Docker, but neither suite's assertions were ever executed against a live MySQL container here — several of the MySQL-specific findings this plan reasons from driver/server source (the TLS path, the statistics-cache band, the JSON decode) are explicitly flagged in the plan as verify-on-container. That run, and the demo stack's own `docker compose up` + `seed.sh` pass, still need to happen on the macOS/Colima box or in CI before this phase is fully verified. |
| **P35 SQLite adapter** | A seventh SQL-family adapter, `engine/adapters/sqlite/`, for local/embedded `.sqlite`/`.db` files rather than a network connection — matching the fixed internal shape the other SQL adapters establish where SQLite's file-based, serverless model actually fits it, with its own `tests/db/sqlite.spec.ts` | New-engine work is cheapest once every adapter-shape decision has already been exercised six times; SQLite is the one engine in the app with no server, no auth and no network at all, so its own connection shape (a file path) and cancellation story (none) are worth landing once every other SQL adapter's own conventions are settled to compare against | Implemented per `docs/v1/plans/P35-sqlite-adapter.md`, all nine commits. **`node:sqlite`, no new dependency**: the app already stakes its own storage on it (`main/storage/db.ts`), and it ships in the exact runtime the engine process is (Electron/Node 22.5+, or Bun 1.4+) over SQLite 3.53+. `engine/adapters/sqlite/` stands alone — no "family" pattern (P34's shared-driver reason doesn't apply; SQLite shares neither wire protocol nor driver with anything). `shared/domain/connection.ts` gained the `'sqlite'` kind and a new `FILE_KINDS` set (mirroring `AWS_STYLE_KINDS`): fields mode repurposes `database` for the absolute file path, `host`/`port` stay unused, and no `DEFAULT_PORT` entry exists on purpose. Every prepared statement that touches real user data (never a catalog/pragma query) opts into `setReadBigInts(true)` — an integer outside `Number.MAX_SAFE_INTEGER` would otherwise crash the whole page (`ERR_OUT_OF_RANGE`) rather than just losing precision; the value-to-text codec (`toCellText`) switches on the *value's* own JS type, not the column's declared type, since SQLite is dynamically typed. Keyset paging's fallback chain goes one step further than any other SQL adapter: primary key, else a unique index, else the table's own implicit `rowid` (never surfaced as a page column, never mutation identity) — the one place this phase is genuinely better than merely different, since every rowid table gets a free stable tiebreaker where MariaDB/MySQL/Postgres would degrade to offset paging. `caps.cancel = false` is the app's first honest `false`: there is no `sqlite3_interrupt` in `node:sqlite` and its entire API is synchronous, so a running statement blocks the event loop and an `AbortSignal` cannot even arrive while one runs. `mutate()` wraps a batch in `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` (not a deferred `BEGIN`) so a contended file fails before a single row changes, and `definition()` returns `sqlite_master.sql` verbatim (SQLite's own `CREATE` text, no `SHOW CREATE TABLE`-equivalent round trip needed) with constraints composed from pragmas — CHECK constraints have no catalog at all, so they're named as absent with a note pointing at the Source text instead of a silently empty section. `ConnectionDialog.vue` gained an `isFileStyle`-gated **Database file** field with a **Browse…** button (`kira:files:chooseOpen` grew an optional filters payload for this) instead of host/port/credentials; `SqlDialect` gained `'sqlite'` as a genuine third member (not an alias of `'postgres'`), wired through `languages.ts`'s CodeMirror dialect and `quoteIdent`'s existing double-quote default. `tests/db/sqlite.spec.ts` ports `mysql.spec.ts`'s 33 scenarios with adjustments for real engine differences (no auth — three connect-failure scenarios instead; the cancel contract rewritten around `caps.cancel === false`; no running-query map, so the P13 leak-guard tripwires rewritten around a failed connect leaving nothing open) plus seven SQLite-specific additions (int64/BigInt fidelity, the dynamic-typing value-vs-declared-type codec, the file-is-not-modified guard — the phase's central promise — rowid keyset paging, generated columns, a locked database surfacing `E_TIMEOUT`, and multi-statement input refused rather than truncated); `tests/db/support/sqlite.ts` is a **temp-file fixture, not a container** (`mkdtemp` → seed via `node:sqlite` → one plain `WITH RECURSIVE` CTE for the 1M-row `big_rows` table, no chunking needed unlike MariaDB's/MySQL's own workarounds), gated by `sqliteAvailable()`/`SQLITE_UNAVAILABLE_MESSAGE` rather than Docker. `tests/ui/sqlite.spec.ts` is the **first DB-backed UI spec that runs unconditionally** (D35) — no Docker gate, no container — so it is also the first to actually execute in Claude Code's own Linux web container, where every other engine's UI spec self-skips; its load-bearing assertion mirrors the MySQL spec's own backtick one, but double-quoted. `scripts/demo-dbs/sqlite/seed.ts` builds a demo database directly with `node:sqlite` (no compose service — there is nothing to containerize), the same e-commerce model as the other relational engines. `bun run lint`/`typecheck` (all three splits)/`build` are clean throughout every commit. **Verified further than P34 could be**: this sandbox's system Node (22.22.2) has `node:sqlite`, so — unlike every other engine's DB/UI suite here — `tests/ui/sqlite.spec.ts` was run for real (`xvfb-run -a bunx playwright test`, passes) and every `tests/db/sqlite.spec.ts` scenario was independently verified against the real adapter and a real temp-file database via an esbuild-bundled harness run under Electron's own Node (this sandbox's Bun 1.3 itself lacks `node:sqlite`, so `bun test tests/db/sqlite.spec.ts` here reports the legible `SQLITE_UNAVAILABLE_MESSAGE` failure rather than actually running). That verification pass caught and fixed a real bug: `catalog.ts`'s `getReadTarget()` treated a *view* as a rowid table (`PRAGMA table_list` reports `wr: 0` for a view too, meaninglessly), crashing any keyset-fallback read against one with "no such column: rowid" before the fix. |
| **P36 ClickHouse adapter** | An eighth SQL-family adapter, `engine/adapters/clickhouse/`, for ClickHouse's columnar/OLAP dialect, matching the fixed adapter shape with its own `tests/db/clickhouse.spec.ts` against a ClickHouse testcontainer | The open question was whether OLAP's own conventions (a MergeTree `PRIMARY KEY` as a sparse index, not a unique key; no per-request database override in the HTTP client) fit the fixed SQL-adapter shape at all, or needed a divergent one; they turned out to fit cleanly once row identity is treated honestly | Implemented per `docs/v1/plans/P36-clickhouse-adapter.md`, all eleven commits. `@clickhouse/client@1` (npm) is the app's first added dependency since P32, and needs no native build — a plain JS HTTP client. `engine/adapters/clickhouse/` stands alone, ten files (`index.ts`/`client.ts`/`query.ts`/`catalog.ts`/`read.ts`/`mutate.ts`/`console.ts`/`definition.ts`/`caps.ts`/`errors.ts`), no shared "family" (P34's reason doesn't apply — ClickHouse shares neither wire protocol nor driver with anything). The client's HTTP interface has **no per-request `database` override** (confirmed from `node_modules` source: `database` is sourced only from client-construction config and embedded in every request's URL query string) — the originally-planned `RunOptions.database` field was removed once `typecheck` caught it referencing a property that doesn't exist on the client's own types; every statement instead relies on the connection's one construction-time default database plus fully-qualified `` `db`.`table` `` identifiers (D19). `caps.ts` sets `canUpdate`/`canDelete` permanently `false` alongside `canInsert: true` — ClickHouse's own first non-Kafka case of a permanently-false write flag, since a MergeTree `PRIMARY KEY` is a sparse index over parts, not a unique row key, so there is no addressable row to target for update/delete; `catalog.ts`'s `toColumnMeta()` hardcodes `isPrimaryKey: false` for the same reason (a caught bug: an early draft surfaced `system.columns.is_in_primary_key` as the PK badge, which would have claimed uniqueness the engine doesn't have — fixed in a standalone commit, with the already-pushed DB-spec assertion corrected alongside it). `mutate.ts`'s insert-only `assertColumnsKnown` deliberately does **not** pre-block a MATERIALIZED/ALIAS generated column (D28) — that belongs to the renderer's own insert paths (a new `ColumnDescriptor.generated` flag, threaded through every adapter's `read.ts`/`console.ts` and the grid's add-row/paste/duplicate-as-insert paths, gated in this same phase); an explicit `mutate()` call against one is left for ClickHouse's own native rejection to surface verbatim (Adapter rule 4), not a second app-invented message ahead of it — a design correction made after the first draft added its own guard, caught while writing DB-spec scenario 39. `definition.ts` composes Engine/Sorting key/Primary key/Partition key/Total rows/Comment from `system.tables`, `create_table_query` verbatim minus its trailing `;`, and two fixed notes on the sparse-index/no-FK facts. `views/shared/sqlIdent.ts`/`editor/languages.ts` gained ClickHouse as a genuine fourth `SqlDialect` (backtick-quoted, `backslashEscapes: true`, its own keyword/type lists); `DataGrid.vue`/`DataToolbar.vue`/`gridMenu.ts` gained a `canDeleteRows` computed and caps-gated `−row`/delete-menu disabling (previously conflated with the edit-permission check) with a tooltip naming the real reason; `typeGlossary.ts` gained `CLICKHOUSE_DESCRIPTIONS` (case-sensitive PascalCase match against the un-lowercased type text, since `Int8` and Postgres/MySQL's lowercase `int8` share six characters for unrelated meanings) and `unwrapClickHouseWrappers()` (recursive `Nullable(...)`/`LowCardinality(...)` stripping before the generic single-level paren regex, which otherwise mangled `Nullable(LowCardinality(String))`). `tests/db/clickhouse.spec.ts` (45 scenarios) and its fixture/harness (`0010_clickhouse_seed.sql`, `support/clickhouse.ts` on `@testcontainers/clickhouse@12.1.0`) follow the same shape as every prior adapter's DB spec, with ClickHouse-specific additions: `ReplacingMergeTree` duplicate-key rows proving F16 directly (two separate inserts with an identical `ORDER BY` value both stay visible with no background merge run), cancel via `KILL QUERY WHERE query_id = ... SYNC` issued as a second HTTP request against a self-chosen `query_id`, and a scratch-database round trip for `definition()`. `tests/ui/clickhouse.spec.ts` covers the tile/connect/tree(Views+Materialized views folders)/backtick-filter/row-gating-and-no-inline-edit/definition-no-PK-badge/console surface. `scripts/demo-dbs/` gained a tenth service (`clickhouse/clickhouse-server:26.3`, host port 8124) with its own `init.sql`/`seed.sql` re-expressing the shared e-commerce model in MergeTree terms via `numbers()` (no chunking, no `WITH RECURSIVE` depth limit — P34's own workaround doesn't apply) plus a `data_types_demo` row showing ClickHouse's own type family (Array/Tuple/Map/Enum8/UUID/IPv4/IPv6/Decimal/DateTime64/FixedString/LowCardinality/geo) rather than a literal port. `bun run format`/`lint`/`typecheck`/`build` are clean throughout every commit. **Not verified in this sandbox** (Docker's daemon is reachable here, unlike prior phases, but pulling `testcontainers/ryuk`/`clickhouse/clickhouse-server` images fails with `403` at the outbound proxy's Docker Hub relay): `tests/db/clickhouse.spec.ts`'s 45 scenarios and `tests/ui/clickhouse.spec.ts` were written and pass `typecheck`/`lint`/`playwright test --list`, and `xvfb-run -a bunx playwright test tests/ui/clickhouse.spec.ts` was run for real, failing only at the same image-pull step — confirming the spec file itself is defect-free up to that point. Verification was substituted where possible with real, targeted checks against actual dependencies: `node:sqlite` for the cross-adapter `generated` column fix, `splitSqlStatements` for both new SQL fixture/seed files (run standalone via esbuild-bundled scripts), and `@clickhouse/client`'s own module resolution. `docker compose config` validated the demo stack's new service block and `bash -n` validated `seed.sh`'s new stanza, but neither the DB suite, the UI spec's live assertions, nor the demo seed's actual `docker compose up` + `seed.sh` run against a live ClickHouse container here — that run still needs to happen on the macOS/Colima box or in CI before this phase is fully verified. |
| **P37 RabbitMQ adapter** | A new adapter and view for RabbitMQ (exchanges, queues, bindings), alongside the existing Kafka/SQS stream adapters, with its own `tests/db/rabbitmq.spec.ts` against a RabbitMQ testcontainer | The open question was whether RabbitMQ's model fits the existing `stream` view (P10) or needs its own page kind; it fits cleanly on SQS's own half of that view (no addressable position, `'batch'` pagination) once message data and topology data are kept apart — a message's routing key/headers/body map onto the five fixed stream columns, while exchanges/bindings/policies (not message data at all) move into the definition view, exactly where P23 already put a Kafka topic's partitions. Implemented per `docs/v1/plans/P37-rabbitmq-adapter.md`, all ten commits. **No new dependency** — AMQP 0-9-1 itself cannot enumerate anything (no list-queues/list-exchanges/list-bindings in the protocol), so the only viable enumeration surface is the `rabbitmq_management` plugin's HTTP API, and the platform's own `fetch` (already global in both this app's runtimes) is enough to speak it; adding an AMQP client on top for publish/destructive-consume was considered and rejected as a second protocol for zero enumeration benefit. `engine/adapters/rabbitmq/` stands alone (nine files: index.ts/caps.ts/client.ts/query.ts/catalog.ts/read.ts/mutate.ts/definition.ts/errors.ts, no console.ts — `caps.sql` is false), with every HTTP call routed through `query.ts`'s one `request()`/`requestAll()` pair so the default-vhost `%2F` encoding rule, the per-request `AbortSignal`, the Authorization header and the op-log command text are each written exactly once. `canUpdate`/`canDelete` stay permanently false — a RabbitMQ message has no broker-assigned identity at all and AMQP has no per-message update or delete at any version, a third distinct structural reason after ClickHouse's sparse-index one and Kafka's immutable-log one; `mutate()` accepts only `insert` (a publish through an exchange, defaulting to the default exchange with the queue's own name as routing key), and a publish the broker accepts but routes nowhere (`{"routed":false}`) is reported as an error rather than a silent success. Reads are poll-on-demand (`ackmode: reject_requeue_true` — nothing is ever removed, messages come back marked redelivered) with a 500-message clamp (the management API's own page-size ceiling) and a one-byte-over-budget truncate request so an oversized payload the broker doesn't fully truncate still gets marked truncated by the page builder's own logic, no new mechanism needed. `connect()` issues exactly one request (`GET /api/overview`) and turns each of its distinguishable failures into its own message — wrong credential, no management plugin at this address, and the single most common mistake (pointing the adapter at AMQP's own port 5672 instead of the management API's 15672) named explicitly; an `amqp://` URI is refused the same way rather than silently tried. The tree reuses the existing `database` kind for a RabbitMQ virtual host (a per-connection-kind label override renders it "Virtual host") rather than adding a new one, and `exchange` is the one genuinely new `NodeKind` this phase adds — a definition-only leaf, foldered under an "Exchanges" heading exactly the way P23 foldered Kafka's consumer groups, with the nameless default exchange filtered out of every listing since its blank name cannot survive this app's own path/tab-title plumbing honestly. `tests/db/rabbitmq.spec.ts` (27 scenarios) and its fixture/harness (`0011_rabbitmq_seed.ts`, `support/rabbitmq.ts` on `@testcontainers/rabbitmq@12.1.0`, whose own wait strategy is overridden from the AMQP-era "Server startup complete" log line to an HTTP probe of the management port) cover connect-failure classification, vhost scoping and the `%2F` round trip, a percent-encoded queue name end to end, both binding directions on an exchange's definition, the exact stream-column mapping, read non-destructiveness across two consecutive polls, the 500-message clamp, a stream-type queue's `basic.get` refusal reclassified from a generic query error to `E_UNSUPPORTED`, binary/oversize payload truncation, every mutation refusal (read-only sending zero requests), the credential never reaching `op_log.command` text, and the P13 tripwire (exactly two GETs per vhost expansion regardless of object count). `tests/ui/rabbitmq.spec.ts` is a small, Docker-gated subset (not unconditional like SQLite's own spec — there is no local-file equivalent for a message broker) whose load-bearing assertions are the seams where a missing branch fails silently: the queue tab never auto-loading with a requeue-worded warning strip (not SQS's "consumes" wording), Poll rendering the routing key in the key column, and the Delete-message button's absence. `scripts/demo-dbs/` gained an eleventh service (`rabbitmq:4.3.5-management-alpine`, host port 15672 unchanged since nothing else collides, the AMQP port deliberately not published) with a host-side `seed.sh` — the management-alpine image ships no bulk-publish CLI worth `docker exec`-ing into, so it talks straight to `localhost:15672` with `curl`, the same HTTP surface the adapter itself reads. `bun run format`/`lint`/`typecheck`/`build` are clean throughout every commit, and the four non-Docker Playwright specs plus the unconditional `sqlite.spec.ts` all still pass, confirming the SQS/Kafka stream-view branches moved by nothing. **Not verified in this sandbox** (Docker's daemon is reachable here, but pulling `testcontainers/ryuk`/`rabbitmq:4.3.5-management-alpine` images fails with `403` at the outbound proxy's Docker Hub relay, confirmed directly via `docker pull`): `tests/db/rabbitmq.spec.ts`'s 27 scenarios and `tests/ui/rabbitmq.spec.ts` were written and pass `typecheck`/`lint`/`playwright test --list`, and both were run for real up to the same image-pull step, confirming the spec files themselves are defect-free that far. Verification was substituted where possible with real, targeted checks against actual dependencies: a standalone esbuild bundle of the adapter exercised against a mocked `fetch` (connect/probe classification for 401/404/timeout/ECONNREFUSED, the default-vhost `%2F` decode and its own `//`-shaped round trip through `formatConnectionUri`, the default-exchange filter, the exact stream-column mapping, a full publish→preview→mutate round trip with byte-identical text, every mutation refusal, the `amqp://` scheme rejection, and the stream-queue `E_UNSUPPORTED` reclassification), plus a second bundle dry-running the seed fixture's ~2,031 requests to confirm its own encoding and topology. That live-container run, and the demo stack's own `docker compose up` + `seed.sh` pass, still need to happen on the macOS/Colima box or in CI before this phase is fully verified. |
| **P38 Catppuccin themes** | Add the [Catppuccin](https://github.com/catppuccin/vscode) theme family (Latte/Frappé/Macchiato/Mocha) as selectable app themes, alongside the app's current single fixed dark theme, with a picker in the settings dialog | Not yet planned — queued. The `theme/tokens.css` variable set was designed around one dark palette; how much of it maps cleanly onto four new palettes (including a light one, Latte) is an open question for that plan |
| **P39 Modularity and cleanliness** | Not a SPEC §10 deliverable — a user-directed, post-v1 phase (P38 skipped by user direction; nothing here touches themes) reorganizing structure with zero behavior change, run as **three iterations** (AGENTS.md's multi-pass convention): each iteration is its own Opus-plan/Sonnet-implement cycle against the tree the previous iteration left, looking for what the last round missed or newly created, with its own plan file (`P39-modularity-and-cleanliness.md`, `-iter2.md`, `-iter3.md`) | After 38 phases, structure debt accumulated faster than any single pass could safely find and fix at once — the reasoning for splitting this into rounds rather than one larger plan is the same one that keeps every phase's own implementation order to small, independently-reviewable commits, applied one level up | **Iteration 1**: implemented per the plan, all eighteen steps — §11's layering (`views/*` no longer imports `workbench/*` or a sibling `views/*`), five near-duplicate data-view modules (page store, chunked scanner, find-widget toolbar, page-size table, load-error classifier) collapsed behind shared `views/shared/` implementations, every adapter but RabbitMQ on one `errors.ts`/`mapError`, `resolveProjection`/`safeInt` hoisted into `sql-text.ts`, one `unsupported()`/`noQueryConsole()` pair for twenty capability-stub throws, one naming scheme across the four data-view folders (`page.ts`/`search.ts`/`menu.ts`/`mutations.ts`), `shared/port.ts`/`layout.ts`/`settings.ts`/`shortcuts.ts` moved to match §11's own tree. `lint`/`typecheck` (all four projects)/`build` green after every commit; every `data-testid` unchanged. The one finding where a naive merge would have changed behavior — `state/tabs.ts`'s six patchers, three of which skip a no-op patch's save and three of which didn't — is preserved as an explicit `skipUnchanged` flag per caller rather than silently unified either way, with the question of which is the bug left to the functionality-review phase (P43, renumbered from P40 when P40/P41 were inserted for console UX and Redis/S3 tree navigation, then renumbered again from P42 to P43 when a console/grid/cell-editor polish batch was inserted ahead of it). **Iteration 2**: implemented per its own plan
(`P39-modularity-and-cleanliness-iter2.md`), all seventeen steps — the residue iteration 1's own
merges left behind (five `dropForTab` aliases down to one real body, one `createPageSearch`
factory and one `eachMatch` loop behind the three search modules, three renamed stragglers),
`views/shared/useConnectionGate.ts` replacing six copies of §8.4's reconnect gate, one
`connectionRecord()` accessor replacing twenty-six `.records.find()` call sites, one
`patchConnectionFields()` behind the two connection field setters, the sort-document parser moved
out of `DocumentView.vue` to match `DataGrid.vue`'s own precedent, `stripOneTrailingSemicolon`/
`singleStatusPage` hoisted into `sql-text.ts` and `orderedOps`/`assertColumnsKnown`/
`assertAffectedExactlyOne`/`assertKeyIsPrimaryKey` into a new `sql-mutate.ts`, `assertWritable()`
replacing ten copies of the read-only refusal, twelve module-private exports losing their `export`,
and — investigated for real rather than deferred a second time — `@shared/*` made resolvable from
`engine/`/`main/`/`preload/` and adopted everywhere, plus a `biome.json` `noRestrictedImports`
override that now enforces §11's layering rule at lint time instead of by review alone. `lint`/
`typecheck` (all four projects)/`build` green after every commit; `bun test tests/db` reproduces
the pre-existing 12 pass/10 fail baseline with zero resolution errors; every `data-testid`
unchanged. The largest unfixed finding — `project/`↔`views/` depending on each other in both
directions, which undermines iteration 1's own rationale for where `columnsSectionMenu` lives — is
recorded, not fixed, and handed to iteration 3 with a concrete proposal (a small command registry
in `renderer/state/`). **Iteration 3**: implemented per its own plan
(`P39-modularity-and-cleanliness-iter3.md`), all fifteen steps — completing the three-iteration
convention. `state/viewCommands.ts` (new): the leaf-registry inversion `state/tabRuntime.ts` already
uses, applied to the six `project/ → views/` import edges iteration 2 recorded and deferred; each
view's `state.ts` registers its own `reload`/count/query commands at module scope, `ProjectTree.vue`
and `menus.ts` dispatch through the registry, and `grep -rn "views/" src/renderer/project` now
returns only comment text. `columnsSectionMenu` moved from `project/menus.ts` into a new
`views/definition/columnsMenu.ts` — iteration 1's own D23 finally answered rather than deferred, now
that the registry means the move creates no `views/definition → views/grid` edge. Seven near-
duplicate `views/shared/` modules (page store, chunked scanner, find-widget state, the "hide
non-matching rows" toggle, page-size table, column-measuring helpers, find-widget toolbar) moved
into a new `views/shared/page/` folder and dropped their `page` prefix, the same un-prefixing
iteration 1's own D24 did inside each view folder. `createSearchState` moved out of the chunked
scanner into the module that actually owns per-tab search state; `computeEffectiveOrder` (the
keyset-eligibility rule three `read.ts` modules each wrote out) and a generic row-op renderer
(`ValueRenderer<P>`/`renderRowOp`/`resolveDatabaseTablePath`, the SQL adapters' mutate-statement
text) hoisted into `sql-text.ts`/`sql-mutate.ts`; `assertNotCancelled` replaced nine copies of the
pre-flight cancellation check; two module-private helpers in `preload/index.ts` replaced nineteen
copies of one four-line listener pattern. Eighteen source comments across nine files that still
named five paths earlier iterations had already moved or deleted were corrected. `biome.json`'s
`noRestrictedImports` layering rule — iteration 2 enforced it for `views/*` only — extended to
`main/` (Drizzle and `node:sqlite` scoped away from anything but `storage/`), `engine/adapters/**`
(no adapter imports `electron`, the rule that lets `tests/db/` import adapters directly), and
`project/**` (no more `views/*` imports, closing the loop the new registry opened); every override
proven with a throwaway violation before removal, and each `includes` kept disjoint from every
other's — Biome's `noRestrictedImports` options do not merge across overlapping overrides, so a
careless broad override placed after a narrow one can silently delete the narrow one's rules while
`lint` stays green. `lint`/`typecheck` (all four projects)/`build` green after every commit; `bun
test tests/db` reproduces the pre-existing 12 pass/10 fail baseline; every `data-testid` unchanged |
| **P40 Query console UX and cell-editor read-only mode** | Not a SPEC §10 deliverable — a user-directed, post-v1 phase: a toolbar toggle for opening a run's result in a new result tab vs. reusing the current one; the shared find/search toolbar (already in grid/documents/keyvalue) added to console results; a result-set strip ("N result sets", each closable with an ×) for console's multi-statement runs; the empty gap between the last row and the panel's bottom edge when the cell editor is closed; a real read-only mode for the cell editor — hiding Format/Beautify and other edit-only affordances and the primary-key label when nothing on screen is editable, which the query console's own cell editor (always read-only, §8.14) currently doesn't do; the console's SQL cell view brought visually in line with the main grid's cell view, dropping the data-type badge from its header | The user's own framing: a set of console-specific UX gaps found by using the feature, queued ahead of the broader functionality review | Implemented per `docs/v1/plans/P40-query-console-ux-and-readonly-cell-editor.md`, eight commits. A result set gets a stable key (`views/console/state.ts`'s `resultPageKey(tabId, seq)`, the tab's own monotonic `nextSeq`, never an array index) so closing one never re-keys its siblings. One result set is shown at a time behind a `.p-tab`-chip strip (`console-result-strip`/`console-result-tab`/`console-result-close`), replacing the old stacked-panel-per-statement layout the view's own comment had recorded as a deviation from the design system since P5.5 — this also fixed the empty band below the last row when the cell editor is closed (the fixed `height: 260px` `.result-panel` is gone; the active grid is `flex: 1`, same as the data grid's own `.grid-area`). A toolbar toggle (`console-new-result-toggle`) decides append-vs-replace, persisted per tab as `consoleTabStateSchema.newResultSet` (`.default(false)`, so an already-saved tab restores unchanged). `views/console/search.ts` is the fourth `createPageSearch` call site (after grid/documents/keyvalue) — its `activePage(tabId)` in `state.ts` is the one place "which of this tab's N result sets" is resolved, so `views/shared/page/`'s two shared cleanup handlers never had to learn a per-result-set key scheme; `setActiveResult` bumps `resultPages.ts`'s `pageVersion` so an open find re-scans the newly active result. `CellEditorDock`/`CellEditorView` gained an optional `readOnly` prop (defaulting to `false`, so the other four mounts are unchanged) — true "viewer mode": no reason chip (`data-read-only="true"`, no `data-read-only-reason`, since there was never a write on offer to refuse) and none of UUID-generate/`modified`/byte-badge/Beautify/Revert, which either did nothing meaningful on a console cell or lied about why. `ConsoleResultGrid.vue`'s header dropped its `p-badge` data-type badge for the same hover tooltip (name/type/glossary description) `DataGrid.vue`'s own header cell has carried since P31, plus row-hover and `tabular-nums` parity. Two real defects found on the way were written up and deliberately left untouched at the time, handed to P43 — both since fixed, in P43 iteration 1: `stream`/`documents` mount the cell editor with the same no-write-path gap the console had (F14); `resultPages.ts`'s `setVisibleWindow` has no caller anywhere (F22), so the console's decode cache is never pruned the way the grid's is. `bun run lint`/`typecheck` (all four projects)/`build` clean after every commit; `tests/ui/sqlite.spec.ts` (the one console-touching spec that runs without Docker in this sandbox) exercises the toggle/strip/×/find toolbar for real and passes; `console.spec.ts`/`interaction.spec.ts`'s two stacked-grid-count assertions were updated to the new chip model in the same commits that changed the behavior, and `console.spec.ts` gained its own dedicated result-set/find-toolbar test plus a viewer-mode block in `cell-editor.spec.ts`'s existing console step — all Postgres-backed and **not run in this sandbox** (Docker image pulls are blocked here); they typecheck/lint clean and need a real run in CI or on the macOS/Colima box before this phase is fully verified. |
| **P41 Redis/S3 tree navigation and the sticky header fix** | Not a SPEC §10 deliverable — a user-directed, post-v1 phase: Redis and S3 connections currently expand their full key/object tree inline in the project panel; this phase keeps only the top-level containers (buckets for S3, databases for Redis) in the connection tree and adds a dedicated panel for the actual — potentially infinitely nested — key/object navigation. Also fixes the sticky ancestor-band header (P28's `stickyBand.ts`): the top band does not stick on scroll while a bottom one incorrectly does and duplicates rows | The user's own framing: the sticky header is a real, currently-broken bug, and unbounded Redis/S3 nesting in the connection tree is a scalability problem worth fixing before the broader functionality review | Implemented per `docs/v1/plans/P41-redis-s3-tree-navigation-and-sticky-header-fix.md`, seven commits. The sticky bug's real cause was never `stickyBand.ts`'s geometry (correct all along) but DOM order in `theme/primitives/VirtualList.vue`: a `position: sticky; top: 0` box only ever engages from flow position 0, and the sticky slot was rendered *after* the header/top-spacer, never at position 0 — moved to the first child, two-line fix. A new `caps.keyBrowser` boolean (true only for redis/s3) marks an engine whose top-level container hides an unbounded, arbitrarily-nested key/object space; `redis/catalog.ts`'s `database` node and `s3/catalog.ts`'s `bucket` node flip to `hasChildren: false`, and `project/grouping.ts`'s `isLeafKind`/`project/state/tree.ts`'s `revealPath`/`project/filterTree.ts` all thread the flag through so a keyBrowser container is treated as a leaf everywhere the tree already treats a table/topic as one. A new `browse` tab kind (`shared/domain/tabs.ts`, `views/browse/{state,BrowseView.vue,menu.ts}`) shows exactly one level at a time — `state.levelPath` persists which level a reactivated tab resumes at (§8.4's identity rule, unchanged) — with Up/breadcrumb navigation, a client-side substring filter, and container/key/object row menus moved verbatim from the tree's now-deleted `namespaceMenu`/`prefixMenu`/`keyMenu`/`objectMenu`; `state/objectStore.ts` gained the moved, re-signatured `uploadMenuItem` so both the tree's bucket row and the Browse panel's own container rows share one upload entry point without crossing the `project/ → views/` layering rule (`state/viewCommands.ts`'s existing leaf-registry pattern extended with `registerBrowseInvalidate`/`browseInvalidate`). `ProjectTree.vue`'s `onOpen` and `project/menus.ts`'s new `browseMenuItem` (first position, ahead of Refresh) are the two entry points into a Browse tab. `lint`/`typecheck` (all four projects)/`build` green after every commit; `tests/ui/sqlite.spec.ts`'s new inline-height sticky-band assertions and the full Docker-free spec subset (`startup`/`smoke`/`connections`/`sqlite`) pass for real in this sandbox after every commit. `redis.spec.ts`/`s3.spec.ts`/`memory.spec.ts` were rewritten wherever they drove tree-based namespace/prefix/key/object navigation to instead open a Browse tab and drive it, plus new dedicated Browse-panel scenarios (filter, Up, a prefix-level upload, and the tree-wide absence of any `prefix` row) — all Postgres/Redis/S3-backed and **not run in this sandbox** (Docker image pulls are blocked here); they typecheck/lint clean and need a real run in CI or on the macOS/Colima box before this phase is fully verified. One pre-existing bug was found and deliberately left untouched at the time, out of this phase's scope: `UploadObjectDialog.vue`'s `containerPrefix` computed only captures a container path's own immediate local segment name (`pathTail`), not the full ancestor-joined relative prefix, so uploading through a *2-or-more-level-nested* S3 prefix's own Upload entry point silently dropped every ancestor segment above the immediate parent from the prefilled key — handed to P43, and fixed there in iteration 1. |
| **P42 Console, grid and cell-editor polish batch** | Not a SPEC §10 deliverable — a user-directed, post-v1 phase, a grab-bag of concrete UX gaps and visual bugs found by using the app, in the same spirit as P31's own "polish/bugfix batch": **Query console** — the new-result-vs-reuse toggle (P40) defaults flipped so a run opens a **new** result tab by default (reuse becomes the opt-in); the result-tab strip (`console-result-strip`) restyled closer to the main `TabStrip.vue` look while staying visually smaller/secondary; the result tabs gain a right-click menu (Close, Close others, Close to the right — the same three §8.10 already gives the main tab strip). **Mongo console** — a Mongo statement's result switches from the tabular grid to the same document view (§8.7/DocumentTree.vue) the Mongo data tab already uses, read-only; the console's own editor gains JSON validation feedback (currently only the cell editor has it). **Code editors** — a word-wrap toggle/default added everywhere a CodeMirror instance is editable (query console, Mongo console, the cell editor), not just the ones that already wrap. **Grid selection** — click-and-drag over multiple cells doesn't extend the selection today (only click + shift-click do); the corner cell (row-number/column-header intersection) doesn't select-all the way a spreadsheet's does; two adjacent selected cells render a visibly doubled border where their edges meet. **Grid chrome** — the column header's hover tooltip needs real visual hierarchy between the column name, its data format and its description (currently reads as one run-on); the grid's own bottom-right corner cell renders white regardless of theme. **Cell editor's format picker** — UUID and URL are listed as detected "formats" but do nothing useful when picked (no beautify, no validation) and should be dropped; the existing ISO-timestamp format's label becomes "Time (ISO…)"; every remaining format gains real validation (a broken-JSON or invalid-timestamp value should say so, not silently accept it); the list reorders common-first; hovering a format in this picker should show the same explanation text the column-header tooltip now shows for it; the "Generate UUID" single-purpose button becomes a small panel/menu of generators (UUID plus whatever else this list decides developers commonly reach for on the fly); the byte-size figure is shown twice in the cell editor's own chrome and should show once. **Date/time picker** — month/year navigation needs an easier jump than only prev/next arrows; a numeric stepper's increase/decrease controls render visibly outside their own button box, a CSS layout bug. **Connection colors** — the palette's colors sit too close to each other perceptually; trim it to keep only entries distinct enough from the rest. **Find/search performance** — on a large loaded dataset, the in-page find highlight is slow because it scans and highlights the whole dataset before showing anything; it should highlight what's already in the viewport first, then continue scanning/highlighting the rest in the background | The user's own framing: a list of concrete UX gaps and visual bugs found by using the app, given ahead of the broader functionality-review phase the same way P40's own console gaps were | Implemented per `docs/v1/plans/P42-console-grid-celleditor-polish-batch.md`, all 17 commits. Two CSS regressions fixed first: the numeric stepper's chevrons now fit inside their own 10px button (the icon prop, not a losing CSS override, since `CodiconIcon`'s inline `font-size` style beats an external rule) and every scroll container's corner square is transparent, not Chromium's opaque white default. The query console: `newResultSet` defaults to `true` (an explicit "off" saved before this phase still restores off — an explicit preference outranks a changed default); the result-chip strip drops to `--kira-h-sm`, gains a leading kind icon, hover/close-on-hover chrome and wheel-to-horizontal scrolling (hoisted into `renderer/wheelScroll.ts`, shared with the main tab strip), and a right-click gives Close/Close others/Close to the right. `views/documents/{ejson.ts,documentRows.ts,DocumentTree.vue}` moved verbatim to `views/shared/document/` (a zero-behavior-change commit, `rows.ts`'s one hard dependency on `documents/page.ts` inverted into a registered row source) so the console's own Mongo result could rebuild on it: collapsed-by-default (unlike the data tab's expanded default — a console run is usually a shape-skimming glance at many documents), no edit/delete affordance, and `lintMongoConsole` gained an argument check via the existing shell-literal parser (`tryParseShellText`, exported from `ejson.ts`), not `JSON.parse` — a Mongo statement's own grammar allows `ObjectId(…)`/`ISODate(…)` constructors a plain JSON parser would reject. Word wrap became one `appearanceSettingsSchema.wordWrap` setting (`.default(true)`, matching today's hard-coded behavior) driven into `CodeMirrorHost.vue` through a fifth `Compartment`, replacing the per-component hard-code the report was actually describing. The grid gained real drag-to-select (`mousedown` → `mouseenter` while held → `mouseup`, auto-scrolling at the viewport edge) and a corner cell that selects everything as one `range` (never a `row` selection, which would be an O(rows) `Array.includes` inside the render loop); two adjacent selected cells now share one border at their common edge via four independent `box-shadow` custom properties rather than each drawing a full outline. `workbench/state/tooltip.ts` widened to accept a structured `{ title, meta?, body? }` alongside a plain string — the grid/console-result header's own tooltip is its first caller, rendering the column name, type and description as separate lines instead of one run-on sentence; the plain-text `data-kira-tip` mirror is unchanged either way. The cell editor's format picker: `uuid`/`url` dropped entirely (both were inert on selection — `detectUuid`'s regex survives as a one-line guard inside `detectBase64`, so a real UUID doesn't start mis-detecting as base64), `iso8601`'s label became "Time (ISO…)", the list reordered common-first into three groups: a new `validate.ts` checks the buffer for real against the effective format (JSON/XML balance, CSV column-count consistency, a SQL lint error, a parseable timestamp, a decodable base64/hex shape) and surfaces a named "invalid" chip; the native `<select>` became an app-drawn `ContextMenu` picker (the only way a per-row hover explanation — `FORMAT_HELP`, read by both the picker and the trigger's own tooltip — could exist at all, since a native `<option>` sits outside `elementFromPoint`'s reach), at the cost of losing arrow-key navigation the native control had; the old UUID-only generate button became a four-entry generators panel (UUID v4, ULID, a random hex token, "Now") that is never format-gated, and `EditBufferActions` gained a `showBytes` prop (default true, the cell editor passes false) so its own byte badge stopped duplicating the status badge's byte figure. `DateTimePicker.vue`'s month/year label became a button cycling three views — days, a 3×4 month grid, a 4×4 16-year block — with the prev/next arrows paging whichever is active; picking a month or year moves only the calendar's own view, never the selected value. `CONNECTION_COLOR_CHOICES` trims the picker to eight offered swatches (`none, red, amber, green, cyan, blue, magenta, grey`) at a 42° minimum OKLCH hue gap, roughly double the full palette's worst gap (25.6°, blue↔indigo); `connectionColorSchema` itself stays whole, since narrowing it would make a connection saved with a retired colour silently vanish on next launch rather than merely stop being offered. `runChunkedScan` gained an optional priority window, scanned in its own animation frame before the ordinary ascending pass starts from row 0 and rebuilds the match list from scratch (so the published order stays strictly ascending regardless of where the window sat); every scan tick now publishes into `searchState` marked `pending`, so the filter toggle (`matchedRows()`) waits for a *completed* scan before hiding anything instead of hiding-then-un-hiding rows as a partial answer arrives. A new `views/shared/page/visibleRows.ts` carries each tab's on-screen row window from renderer to scanner, reported by `DataGrid.vue`'s existing bounds watch and a new `VirtualList.vue` `visible-range` emit forwarded by `DocumentView.vue` and `ConsoleResultGrid.vue`; `KeyValueView.vue` renders every loaded row directly (no virtualization to report a window from) and so keeps ascending-only priority while still gaining the progressive-publication fix. `bun run format`/`lint`/`typecheck`/`build` clean after every commit, and the five non-Docker Playwright specs (`sqlite`/`startup`/`smoke`/`connections`/`workbench`) — extended with real regression coverage for the stepper fix, the scrollbar corner, the console tab default, the drag-select/corner-select/shared-border trio, the structured header tooltip, word wrap, and the trimmed color palette (including a connection created with a retired color, proving it still lists and paints) — pass for real in this sandbox throughout. Every other spec this batch touches (`cell-editor.spec.ts`'s format-picker/validation/generators/date-picker scenarios, `data-view.spec.ts`'s viewport-first search assertions, `budgets.spec.ts`'s re-run, `mongo.spec.ts`'s document-result rewrite, `autocomplete.spec.ts`'s Mongo argument-lint additions, and the single retired-swatch line each in `clickhouse.spec.ts`/`rabbitmq.spec.ts`/`mysql.spec.ts`) is Docker-gated and self-skips cleanly in this sandbox; each was written, passes `typecheck`/`lint`/`playwright test --list`, and — where reasoned about by construction rather than observed live (the viewport-first scan's own frame-boundary ordering, in particular) — the reasoning is recorded in the spec's own comments, but none of it has been executed against a live container here. That run still needs to happen in CI or the macOS/Colima environment before this phase is fully verified. |
| **P43 Functionality review** | Not a SPEC §10 deliverable — a user-directed, post-v1 phase, run as **three iterations** like P39: an in-depth review of the app's actual behavior (data handling, panel-to-panel communication, whether a state change is reflected everywhere it should be, error handling and how errors reach the user), frontend or engine/main, followed by real fixes — unlike P39, this phase is explicitly allowed to change behavior | The user's own framing: "practically anything that could be a bug should be found and fixed no matter if it be FE or in between" | Implemented as three iterations (AGENTS.md's multi-pass convention), each round's plan written against the tree the previous round actually left, not against its own prose. **Iteration 1** (`docs/v1/plans/P43-functionality-review.md`, `d78429a`…`ad3377c`, eleven commits): an S3 upload through a nested prefix keeps every ancestor segment now, not just the immediate parent (`UploadObjectDialog.vue`'s `containerPrefix`, the bug P41's own row above handed forward); `ConsoleResultGrid.vue`'s decoded-cell cache prunes as it scrolls (`resultPages.ts`'s `setVisibleWindow` wired to a caller for the first time — P40's own row above handed this forward as F22); the stream and document cell-editor docks stopped offering a write path that silently did nothing (F14, the same P40 row); a NUL byte in a ClickHouse identifier is rejected instead of reaching the query; a failed commit's server error reaches the grid instead of vanishing, and every immediate mutation (not just a commit) now surfaces its own failure the same way; a filter change invalidates the tab's stale row count; a disconnect returns every open tab to Reconnect & load, not just the one that noticed; a committed mutation reloads every other tab open on the same target; a key/object mutation refreshes an open Browse tab; and a failed mutation still invalidates the target's cached pages. **Iteration 2** (`docs/v1/plans/P43-functionality-review-iter2.md`, `2881f95`…`78fc6d5`, twelve commits): Mongo's offset-cursor skip guard now fires only on a genuine page jump (`offset > 0`), not on page one's own `{ offset: 0 }`; Redis list pagination dropped its 500-row `LIST_WINDOW` clamp so a requested page size is actually honoured; Kafka's `readTopic` clamps a window whose high watermark falls inside an uncommitted transaction gap; `state/runState.ts`'s `useRunState` prefers a still-running op over a newer finished one, so the toolbar ring no longer goes dark mid-query; `metadata-cache.ts` gained a per-connection `MAX_ROWS_PER_CONNECTION` eviction pass; `TreeChildren`'s wire shape widened to `{ nodes, truncated? }` across every adapter, `engine/control.ts`, both protocol layers and the renderer's Browse view, so a round-capped listing says so instead of quietly looking complete; the cell editor's selection now clears on every page change across console/keyvalue/stream, not just the grid; a truncated cell value never reports as broken JSON; a generated ULID's timestamp half decodes to the real date instead of 167 years in the future (`toCrockford`'s trailing-pad encoder was never correct for a 50-bit left-padded field); a closed console result set releases its parsed documents and expansion state instead of leaking them for the life of the process; a superseded search scan never republishes stale matches and an in-flight Enter keeps its place across a tick; and an open inline grid editor no longer doubles as a drag-select handle. **Iteration 3** (`docs/v1/plans/P43-functionality-review-iter3.md`, `1a815e5`…`1345e68`, ten commits): closed the verification debt the first two iterations left open, by writing Docker-free `bun:test` specs over a `bun:sqlite` + `drizzle-orm/sqlite-proxy` harness (`tests/db/metadata-cache.spec.ts`, `tests/db/run-state.spec.ts`) that run for real in this sandbox and confirm iteration 2's D19/D20 do what their comments claim; a truncated `children` refresh now drops the stale complete-looking cache row it couldn't replace, instead of serving it back with no truncation strip; `views/browse/state.ts` gained the per-tab supersession guard every other view's `load()` already had (a slow Redis/S3 level's listing could otherwise land after the user had already navigated elsewhere); a Refresh on a cursor-paged Redis key (hash/set/zset/stream) now returns the pager to page one instead of drifting it silently forward; the find toolbar keeps the match a user navigated to mid-scan once the scan finishes, instead of snapping back to the first hit and re-scrolling the viewport; a long value inside an expanded document is reachable by scrolling `DocumentTree.vue` sideways (the same chrome-less idiom `TabStrip.vue`/`ConsoleView.vue` already use), closing P42's own §8 item 1 after three rounds of being handed forward; every `ContextMenu.vue` menu in the app — including the cell editor's format picker, a capability P42 D27's native-`<select>`-to-context-menu swap had quietly dropped — gained roving keyboard navigation, closing P42's own §8 item 3 the same way; a whole-row or whole-column grid selection now draws its own end caps instead of leaving its outline open at both ends; and `Caps` gained an optional `maxPageSize` so the stream page-size picker stops offering RabbitMQ sizes a `basic.get` poll can never serve. Across all three iterations: `bun run lint`/`typecheck` (all four projects)/`bunx electron-vite build` stayed clean after every commit, and the Docker-free Playwright subset (`sqlite`/`startup`/`smoke`/`connections`/`workbench`) passed for real in this sandbox after every commit throughout. The verification honesty each iteration's own plan insisted on: a majority of the findings across all three rounds are Docker-gated (Postgres/MySQL/MongoDB/Redis/S3/SQS/RabbitMQ/ClickHouse via Testcontainers, or `tests/electron-db/kafka.spec.ts`'s native-ABI requirement) and were written, typecheck, and `playwright test --list` clean here, but were never executed against a live container in this sandbox — iteration 3 measurably improved that ratio (five of its ten commits run for real here, the highest of the three rounds) but did not eliminate it. One specific item never got real coverage anywhere across all three rounds: iteration 2's own commit 3, the Kafka partition-EOF/high-watermark clamp — re-read adversarially in iteration 3 and found correct, but still owed a real run on a box with Docker and a matching-ABI native Electron rebuild before this phase can be called fully verified. |
| **P44 Unit tests** | Not a SPEC §10 deliverable — a user-directed, post-v1 phase: add unit tests, but sparingly — only where there is enough logic to justify one, and only where a unit test is the better fit than the existing UI (Playwright) coverage when both could apply. `tests/db/` is explicitly out of scope | The user's own framing: be scarce with new tests, prioritize unit over UI when both would work, never touch the DB suites | Implemented per `docs/v1/plans/P44-sparse-unit-tests.md`, five commits (`e52a1a4`…`5f3bfcd`). Sixteen candidates were read; five were accepted and eleven rejected, each written up in the plan's own §6 at the same length as the accepted ones. A new `tests/unit/` directory holds all five, wired exactly the way `tests/db/` already is — its own `tsconfig.json`, a `typecheck:unit` script folded into `bun run typecheck`, and a `test:unit` script — because P43 iteration 3 had put two Docker-free unit specs (`metadata-cache.spec.ts`, `run-state.spec.ts`) *inside* `tests/db/` and then recommended the same route to this phase by name, directly contradicting the "explicitly out of scope" instruction if followed literally. The resolution, now a standing repository convention rather than a one-phase judgment call: `tests/db/` is out of scope in the whole-directory sense — this phase added no file to it, moved no file out of it, and edited no file in it, including the two iteration-3 specs, which stay exactly where they are — and every *new* unit spec goes to `tests/unit/` instead. The two directories now split three Docker-free specs from five; reconciling that split (a `git mv` plus two prose citations) is handed to P45, whose own remit already includes the repo's folder structure and which is not under this phase's prohibition. `shared/domain/sql-split.ts`'s six lexical regimes (commit 1) and `engine/adapters/sql-text.ts`'s keyset-eligibility/page-token logic (commit 2) were both reached by real adapters and console code with no test anywhere in the repo, their only existing coverage being Testcontainers-backed suites that have never run in this sandbox and only ever walk the eligible-and-correct path. `views/shared/page/scan.ts`'s frame-driven scheduler (commit 3) — the subject of three separate P43 findings — is pinned through a queue-based fake `requestAnimationFrame` that hands frames out one at a time, the only way to stand between two frames and assert what a settled-end-state Playwright test cannot see. `redis/catalog.ts`/`s3/catalog.ts`'s `truncated` flag (commit 4) is driven through hand-written fake clients across all 200/20 round-cap rounds in under a millisecond, without seeding the hundreds of thousands of keys a live assertion would need. `views/browse/state.ts`'s load supersession guard and `views/keyvalue/state.ts`'s cursor-strategy reload (commit 5, both from P43 iteration 3) are driven by manually resolved promises that force the exact older-lands-after-newer interleaving no Playwright test can force on demand. This phase changed no production code — a defect surfaced while writing a spec would have been written up and handed to §8, not fixed under a `test:` commit, and none was found. All five commits run and pass for real in this sandbox (`bun run test:unit`), the first phase in this sequence with no verification debt of its own, and `bun run lint`/`typecheck` (five projects after commit 1)/`bunx electron-vite build` stayed clean throughout; the Docker-free Playwright subset and the three untouched `tests/db/` Docker-free specs were re-run after every commit as the standing guard that nothing else was disturbed. |
| **P45 Docs cleanup** | Not a SPEC §10 deliverable — a user-directed, post-v1 phase: SPEC.md and its `plans/` are retired as v1 history rather than a living spec; whatever in them is still true and durable moves into `ARCHITECTURE.md`, which `AGENTS.md` points to and which itself points out to the general docs (`PACKAGING.md`, `PERF.md`); the `docs/` folder structure is reconsidered to match | The user's own framing: spec and its plans are now "an element of the past of v1" | Implemented per `docs/v1/plans/P45-docs-cleanup.md`, twelve commits (`395423e`…`59e1a77`) plus this row. The mandate's premise was half-true: ARCHITECTURE.md/PACKAGING.md/PERF.md already existed (under `docs/v1/`), and AGENTS.md already pointed at ARCHITECTURE.md six times; what was actually still true was that ARCHITECTURE.md deferred to SPEC.md for four live facts and named it authoritative in its own second paragraph (D62/D60). `docs/v1/` disposition (D57/D58): SPEC.md and `plans/` do **not** move — 56 in-repo citations name `docs/v1/plans/` by path, six of them live `src/`/`tests/` comments, and moving them would dangle every one and force retro-editing frozen history. The restructure goes the other way: `ARCHITECTURE.md`/`PACKAGING.md`/`PERF.md` move up to `docs/`, `design/` to `docs/design/`, so `docs/*.md` is living and `docs/v1/` (now holding exactly `SPEC.md`, `plans/` and a new archive-banner `README.md`) is the v1 record — repairing four references left dangling by an earlier `f660ffd` move along the way (commit 1). ARCHITECTURE.md absorbed (D62) the process model, storage, caching, the §5.1 per-engine mapping table, the stack, §2's invariants (with a pointer to `docs/PERF.md` §1 for the budget numbers rather than a duplicate table) and a testing strategy corrected to name all four `tests/` directories and D66's rule (`tests/unit/` needs nothing and finishes in about a second, `tests/db/`/`tests/electron-db/` need a real external resource) — each replacing a stub or filling a gap that had never existed. It deliberately did not absorb §8's 604 UI lines verbatim (D63): a new ~55-line UI architecture section distills view-kind-by-page-kind selection, the tab-identity rule, the session-restore reconnect gate, the staged-vs-immediate write model, the cell editor as a per-view mounted panel, the Browse panel's one-level model, and the shared find/chunked-scan machinery instead, each re-verified against the current tree rather than copied from SPEC's prose. SPEC.md's own front matter (lines 1-12, a reader's-guide header, not a record) was rewritten to fix a stale "P0–P31 implemented" status (the real figure is P0–P37; P38 was skipped by user direction) and its `docs/plans/` pointer, and to invert authority to ARCHITECTURE.md per D60/D61; no other line of SPEC.md's body, and no file under `docs/v1/plans/`, was touched. `tests/db/` → `tests/unit/` reconciliation (D66, P44 §8's own handoff item): metadata-cache.spec.ts and run-state.spec.ts move, not three files — preconnect.spec.ts measured at 23.0s of a 24.1s total and spawns real OS processes, so it stays; a collision found while planning this (Bun's shared module registry means two specs' inline `window` stubs race for which one "wins" for the whole test run) was fixed with one shared `tests/unit/support/window.ts` (commit 11) before the move (commit 12), proven both before and after: 52→63 pass, 0 fail. `bun run format`/`lint`/`typecheck` (five projects)/`bunx electron-vite build` stayed clean after every commit, and the Docker-free Playwright subset (`sqlite`/`startup`/`smoke`/`connections`/`workbench`) passed for real in this sandbox after every commit throughout. One deviation from the plan, forced rather than chosen: commit 2's four-line diff to `.github/workflows/{ci,release}.yml` (updating the same `docs/v1/PACKAGING.md` → `docs/PACKAGING.md` reference already fixed everywhere else) could not be pushed — this session's GitHub token lacks the `workflow` OAuth scope, the same limitation recorded against P25's CI step — so those two files were reverted out of that commit and the diff handed to the repo owner to apply by hand; every other file in that commit landed normally. |
| **P46 Disable unnecessary Chromium/Electron features** | Not a SPEC §10 deliverable — a user-directed, post-v1 phase: audit the app's Electron/Chromium surface and disable whatever this app doesn't use — renderer capabilities the app never needs, DevTools reachability outside development, spellcheck/autofill/form-data features, unused Chromium command-line switches, background-throttling and GPU features the app doesn't rely on, and any other default-on Electron/Chromium capability with no purpose here | The user's own framing: disable unnecessary Chromium and Electron features | Implemented per `docs/v1/plans/P46-disable-unnecessary-chromium-electron-features.md`, nine commits (`b6eac8d`…`7e55f8e`). Every disable is backed by a reproduction against the shipped renderer, not an inference from Electron's own hardening checklist: `window.open('https://example.com/')` returned a live handle with the window count going 1→2; `location.href` to a remote origin moved the real app off its own page and destroyed the workbench, with the `<meta>` CSP having no say over top-level navigation; every Chromium permission (notifications, geolocation, media, device APIs) was granted by default because no handler existed; `devTools: true` in a packaged build left `openDevTools()` reachable even though the keyboard shortcut path was already closed by `menu.ts`'s dev gating; and `session.defaultSession.isSpellCheckerEnabled()` was `true` on a stock window, spellchecking the connection dialog's password field the instant the eye toggle reveals it. All five now close, via one new `src/main/security.ts` (`rendererWebPreferences`/`hardenSession`/`hardenWindow`, its only `electron` import `import type` so it unit-tests with no mocking at all) plus `autocomplete="off"` on the one shared `TextField.vue` sixty call sites share, plus three Electron fuses in `electron-builder.yml` (`runAsNode`/`enableNodeOptionsEnvironmentVariable`/`enableNodeCliInspectArguments`, all `false`) closing the one remaining "debuggable outside development" path a Node inspector on main would otherwise leave open. Two findings kept this from being a blanket pass, both proven by running them: a deny-all permission handler broke `navigator.clipboard` — the grid's paste and `clipboard.ts`'s 38 `copyText` call sites — with no failure visible in this sandbox's Docker-free subset, so the fix is a two-entry allowlist (`clipboard-read`/`clipboard-sanitized-write`) shared by both the request and check handlers rather than a deny-all; and flipping `grantFileProtocolExtraPrivileges` off on a copied Electron binary bricked the app outright (the renderer's own `<script type="module" crossorigin>`, loaded over `file://`, is CORS-refused without it) — left on, with `scripts/verify-packaging.sh`'s new S6/S7 static checks (confirmed to actually fire, by breaking and reverting each) guarding both the three safe fuses and this one staying untouched. Three items were decided rather than disabled, each recorded as its own decision: background throttling stays on (nothing on the quit-flush or run-state-ticker paths depends on a hidden window's timers running unthrottled); hardware acceleration stays on (the grid's scroll budget depends on GPU compositing); `disableDialogs`/`safeDialogs` stay off the table (`window.confirm()` gates six destructive actions, and replacing them is a UI change for a future phase). No unused command-line switch existed to remove, and none was added — a `--disable-features` list is fail-open and untestable, and every capability it would target here either doesn't exist in this app or has a first-class, assertable Electron API instead. New `tests/ui/hardening.spec.ts` (Docker-free, ten scenarios) plus `tests/unit/security.spec.ts`/`menu.spec.ts` hold every claim for real in this sandbox except two, both honestly recorded rather than assumed passing: the three Electron fuses were only measured against a copied binary running the real `out/main/index.js`, not a packaged `.app`, and the WebGL scenario passes vacuously here because xvfb blocklists WebGL before the option is ever consulted — both need a `package:mac` run on a macOS box, which this sandbox cannot produce (no macOS, and the native Kafka rebuild `prepackage:mac` needs is blocked here regardless, per AGENTS.md). `bun run format`/`lint`/`typecheck` (five projects)/`bunx electron-vite build` stayed clean after every commit, and the Docker-free Playwright subset plus `hardening.spec.ts` passed for real in this sandbox after every commit throughout. |

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
      db.ts         node:sqlite open + pragmas — the only file in main/ that imports node:sqlite
                    (D2; `engine/adapters/sqlite/` also does, correctly — a different driver, P35)
      migrate.ts     forward-only migration runner
      migrations/    numbered .sql files
      schema/        one Drizzle sqliteTable() file per table, mirrors migrations/ 1:1
      repos/         one file per table: connections.ts, settings.ts, layout.ts, ops.ts, ...
                      — the only files that import the Drizzle instance
    ipc/
      connections.ts, tree.ts, settings.ts, ops.ts, ...   -- one file per IPC domain
      files.ts       (P33) kira:files:chooseSave/chooseOpen — engine-neutral native save/open
                      dialogs (any future export-to-disk feature reuses this, not just S3)
      registry.ts    wires every domain's handlers into ipcMain, single place that must not miss one
    oplog.ts        op-log persistence, retention pruning
  engine/           utilityProcess host
    scheduler/      op lifecycle, cancellation, progress — driver-agnostic
    cache/          L1/L2/L3 tiers, byte-budgeted LRU (split from scheduler: caching and
                    cancellation are independent concerns that today live in one file)
    adapters/
      registry.ts   capability-keyed adapter lookup
      postgres/     index.ts (Adapter impl), client.ts, query.ts, definition.ts, read.ts
      mariadb/      same shape as postgres/, but index.ts/client.ts/caps.ts hold the real MariaDB
                    profile and query.ts/read.ts/definition.ts are pure re-exports of mysql-family/'s
                    (P34 D7-D10)
      mysql-family/ the shared MySQL-connector core mariadb/ and mysql/ both sit on top of (profile.ts,
                    index.ts, client.ts, query.ts, catalog.ts, read.ts, mutate.ts, console.ts,
                    definition.ts) — parameterized by a 3-field MysqlFamilyProfile (kind,
                    serverLabel, applyEngineOptions) plus a separately-passed per-engine caps
                    literal; mariadb and mysql are one dialect **family**, not two adapters (P34)
      mysql/        same re-export shape as mariadb/ — index.ts (the MySQL profile + caching_sha2_
                    password/RSA-key E_AUTH mapping), caps.ts, client.ts (applyEngineOptions'
                    allowPublicKeyRetrieval passthrough), plus query.ts/read.ts/definition.ts
                    re-exports (P34)
      sqlite/       stands alone, not a re-export of mysql-family/ — a different driver
                    (node:sqlite), different catalog (pragmas, not information_schema), different
                    type system (dynamic, F21) and no server to share a wire protocol with. Full
                    fixed shape: index.ts, caps.ts, client.ts, query.ts, catalog.ts, read.ts,
                    mutate.ts, console.ts, definition.ts, errors.ts (P35)
      clickhouse/   stands alone too — a different driver (@clickhouse/client, HTTP-only), different
                    catalog (system.* tables, not information_schema or pragmas), different type
                    grammar (Nullable(T)/LowCardinality(T) wrapping), and no unique row key
                    (a MergeTree PRIMARY KEY is a sparse index, F16) — so canUpdate/canDelete stay
                    permanently false and mutate.ts accepts only insert ops. Full fixed shape:
                    index.ts, caps.ts, client.ts, query.ts, catalog.ts, read.ts, mutate.ts,
                    console.ts, definition.ts, errors.ts (P36)
      rabbitmq/     stands alone too, and adds no dependency at all — the platform's own fetch
                    against the rabbitmq_management HTTP API, since AMQP 0-9-1 itself cannot
                    enumerate anything (no list-queues/list-exchanges/list-bindings in the
                    protocol). No console.ts (caps.sql is false — there is no ad-hoc command
                    language worth one). canUpdate/canDelete stay permanently false: a message has
                    no broker-assigned identity, so mutate.ts accepts only insert (a publish).
                    Nine files: index.ts, caps.ts, client.ts, query.ts, catalog.ts, read.ts,
                    mutate.ts, definition.ts, errors.ts. A rabbitmq virtual host reuses the
                    existing `database` NodeKind rather than becoming a new one; `exchange` is the
                    one addition to shared/domain/tree.ts's NodeKind union this phase makes (P37)
      mongo/ redis/ kafka/ sqs/ s3/   -- same shape once each ships; a new engine is
                    "add one folder matching this shape", never a change to scheduler/ or cache/
                    s3/ also has mutate.ts (update/insert/delete + preview(), the sentinel-through-
                    MutationRowOp technique redis/mutate.ts established) and transfer.ts (P33: the
                    only file in the adapter that imports node:fs — downloadObject's temp-file-
                    then-rename streaming, and openUploadBody for insert)
  renderer/         Vue app
    workbench/      shell, panels, status bar, settings dialog,
                    the app-owned tooltip (state/tooltip.ts, AppTooltip.vue — §8.17)
                    (P39) the context-menu service and panel layout state moved to
                    renderer/state/ — most of their importers were already outside workbench/;
                    ViewChrome.vue/VirtualList.vue/PanelSplitter.vue moved to theme/primitives/
                    — none had a workbench/ dependency and each has callers beyond it
                    UploadObjectDialog.vue (P33): choose file → key → content type → upload, one
                    dialog reachable from a bucket's own tree row, an open object's own toolbar, and
                    (P41) the Browse panel's toolbar/container-row menu
    project/        tree, connection dialog, filters, search
                    stickyBand.ts (P28): pure geometry for the pinned ancestor band — which rows
                    are stuck and where each one sits, DOM/Vue-free
                    filterTree.ts (P28): the checkbox filter dialog's model over the tree's own
                    cached nodes — kind rows, tri-state object rows, toggles, no IPC of its own
    views/
      grid/ documents/ keyvalue/ stream/ definition/ console/ browse/
                    -- each owns its own state module; a new page kind is one new folder here
                       plus one Page variant in shared/protocol, not a change to existing views
                    (P39) grid/documents/keyvalue/stream share one module-naming scheme —
                    page.ts (the page store), search.ts (the chunked scanner), menu.ts (context
                    menus) and, on the three that stage no pending-change set, mutations.ts (the
                    mutate-immediately writers) — so a reviewer already knows where a sibling
                    view's equivalent file lives. grid/pendingChanges.ts keeps its own name: it's
                    the staged-change model (§8.14), not a mutation executor
      browse/       (P41) §8.18's one-level-at-a-time redis/s3 key-object navigation — state.ts
                    (currentLevel/load/descend/ascend/goToLevel/setFilter, registers 'browse' with
                    both state/tabRuntime.ts's reload hook and state/viewCommands.ts's own
                    registerBrowseInvalidate), BrowseView.vue (toolbar Up/breadcrumb/filter/count,
                    a VirtualList body), menu.ts (containerRowMenu/keyRowMenu/objectRowMenu, moved
                    verbatim from project/menus.ts's deleted namespaceMenu/prefixMenu/keyMenu/
                    objectMenu once the tree stopped rendering any of those rows, D5)
      documents/    page.ts, menu.ts, mutations.ts, search.ts, state.ts, DocumentView.vue — the
                    Mongo data tab's own view/state; (P42) ejson.ts/documentRows.ts/DocumentTree.vue
                    moved out to shared/document/ below once the console needed the same document
                    tree for its own Mongo results (§8.15)
      shared/document/  (P42) ejson.ts (BSON shape recognition, shell-form render, no `bson`
                    import — P27 D13; also exports tryParseShellText, the same shell-literal
                    grammar the Mongo console's own lint now validates arguments against — §8.15),
                    rows.ts (documents/'s former documentRows.ts — memoized per-row parse, per-path
                    nested expansion, the exact row-height model — P27 D18/D20/D21; its own hard
                    dependency on documents/page.ts inverted into a registered row source rather
                    than an import, so console/ can supply its own), DocumentTree.vue (one expanded
                    document's flattened line list, no per-node component recursion — P27 D19).
                    Moved out of documents/ (byte-for-byte, its own commit) once console/ needed
                    the same tree for a Mongo statement's own result
      keyvalue/     an S3 object's body is edited through the same docked cell editor every grid
                    cell uses (CellEditorDock, format detection included) — its onEdit stages the
                    draft into a local ref rather than writing to S3 on blur, and a Save strip in
                    KeyValueView.vue's own #strips slot is what actually calls saveValueEdit; the
                    same `_key`/`$value` sentinel pair mutations.ts already used for Redis covers
                    S3 too, unmodified
      definition/   columnsMenu.ts (P39 iter3): columnsSectionMenu (the tree's former column-row
                    context menu, P19 D9) moved here from project/menus.ts — it has belonged to the
                    Columns section since P19 moved columns there, and only the import direction
                    (state/viewCommands.ts now closes it) kept it in project/ until this iteration
      console/      (P40) a result set is addressed by a stable key (state.ts's resultPageKey,
                    keyed by the tab's own monotonic nextSeq, not an array index) rather than
                    position, so the result-set strip's × can close one without re-keying its
                    siblings; setActiveResult/closeResult/activePage are the console's own
                    "which of this tab's N result sets" resolution. search.ts is the fourth
                    createPageSearch call site (after grid/documents/keyvalue, shared/page/
                    below) — it alone resolves that same "which result" question for the find
                    toolbar via activePage(tabId), so views/shared/page/'s two cleanup handlers
                    never needed a per-result-set key scheme. resultPages.ts gained
                    bumpPageVersion(), called by setActiveResult so an open find re-scans the
                    newly active result the same way a replaced page already triggers a re-scan.
      shared/       cross-view Vue helpers with a second consumer (never view-specific):
                    FilterHistoryMenu.vue, mongoVocabulary.ts, sqlIdent.ts, and (P27)
                    useEditBuffer.ts (the dirty/beautify/bytes/revert state machine) plus
                    EditBufferActions.vue (the chip/byte-badge/Beautify/Minify/Revert row, its
                    byte badge now optional — a `showBytes` prop, P42 — since the cell editor's own
                    mount hides it in favor of the one figure its status badge already carries) —
                    mounted by both the cell editor and the document row's own edit area, one
                    implementation instead of two. (P31) DateTimePicker.vue — (P42) its month/year
                    label cycles a days/months/years view for a faster jump than prev/next alone.
                    (P39) celleditor/ moved here whole (it was never a tab kind — the cell editor is
                    a panel five of the six view kinds mount, P26 — and every one of its own imports
                    already went to state/theme/editor/views/shared/, never sideways to another
                    view); typeGlossary.ts joined it for the same reason; viewOp.ts
                    (classifyLoadError()/stopOp(), the load-error classification and stop-button
                    body all six view state modules share) is new here too. (P42) celleditor/ gained
                    validate.ts (per-format buffer validation, read by the format picker's own
                    invalid chip) and generate.ts (the four pure generator functions — UUID/ULID/
                    token/Now — the generators panel calls, no Vue import so P44's sparse-unit-test
                    phase can pin them cheaply). (P39 iter2) useConnectionGate.ts — a composable,
                    the same shape useEditBuffer.ts already is — holding §8.4's reconnect gate the
                    six view components each wrote out; `onLoad` is the one thing that varies per
                    view (stream skips a batch tab, console passes none). (P39 iter3)
                    viewOp.ts gained createRuntimeStore() — the `reactive({})` + re-read-after-
                    assign pattern behind each view's per-tab runtime record, replacing six
                    hand-written copies.
      shared/page/  (P39 iter3) the seven paged-data-view modules — a closed unit with one client
                    set and internal cross-imports — moved out of shared/ and dropped their `page`
                    prefix, the same un-prefixing iteration 1's own D24 did inside each view folder:
                    store.ts (the page store three of the four data views share verbatim), scan.ts
                    (the chunked scanner — P42: an optional priority row-window scanned first, in
                    its own frame, before the ordinary ascending pass) + search.ts (per-tab search
                    state + the generic find-widget API factory — P42: a `pending` flag on each
                    partial publication) + SearchToolbar.vue (the find widget grid/documents/
                    keyvalue share, joined by console (P40), which supplies its own runSearch/
                    pageVersion/loadedRowCount from views/console/search.ts without this folder
                    changing at all — stream's own scanner and toolbar are deliberately simpler and
                    stay in stream/), searchFilter.ts (the "hide non-matching rows" toggle +
                    matched-row derivation every in-page find widget shares), sizes.ts (one
                    page-size table, four testid prefixes), columns.ts (the grid's
                    column-width/measuring helpers, also used by the console's result grid) and
                    (P42) visibleRows.ts — a tab's on-screen row window, reported by whichever view
                    renders it and read by that tab's own runSearch as scan.ts's priority window;
                    deliberately not views/{grid,console}/page.ts's own setVisibleWindow, which
                    prunes a decode cache keyed by *page*, not search priority keyed by *tab*
    state/          cross-view app state (tabs, active connection, op log ring) — promoted out of
                    workbench/ so views/ doesn't have to reach into workbench/ to read it
                    objectStore.ts (P33): S3 upload-dialog state + download/upload/delete flows —
                    lives here rather than views/keyvalue/ so project/menus.ts's bucket row and
                    (P41) views/browse/menu.ts's own container-row menu can both open the upload
                    dialog through one shared uploadMenuItem() without a sideways views/ → views/
                    import
                    (P39) contextMenu.ts and layout.ts joined this folder from workbench/state/ —
                    most of their importers were already outside workbench/ (§11's own rationale)
                    viewCommands.ts (P39 iter3): the leaf-registry inversion tabRuntime.ts already
                    used for per-tab cleanup, applied to project/'s six former `views/*` imports
                    (reload/count/setFilter/setSort/setProjection) — each view's own state.ts
                    registers its handler at module scope, project/ dispatches by tab kind, and the
                    `views/* → project/ → state/` graph iteration 2 recorded as two-directional is
                    one-directional again. (P41) registerBrowseInvalidate/browseInvalidate: the same
                    pattern for one more edge — UploadObjectDialog.vue invalidating the Browse
                    panel's currently loaded level after a successful upload without importing
                    views/browse/ directly
    bridge/         control.ts, port.ts — the only files that touch ipcRenderer/MessagePort
    theme/          tokens, codicons
                    primitives/ (P39): also holds ViewChrome.vue/VirtualList.vue/PanelSplitter.vue
                    (view-agnostic chrome and generic list/splitter primitives, moved from
                    workbench/) and icons.ts (the node-kind/column-type icon vocabulary, moved
                    from project/ once views/definition/ became a second consumer)
    format.ts       shared number/byte formatting (formatBytes), used by the status bar,
                    settings dialog and cell editor alike (P24)
    beautify.ts     lossless JSON/XML scanner + indented/compact renderer (P24), moved to the
                    renderer root in P27 so views/documents/ can use it without a sideways import
                    into views/celleditor/ (P39: views/shared/celleditor/) — the CellFormat-aware
                    dispatch stayed behind as celleditor/formats.ts's beautifyFor()
    fonts.ts        (P31) canvas-measurement font-availability check — document.fonts.check()
                    returns true even for a nonexistent family, so this compares a candidate
                    family's measured width against a guaranteed-bogus probe name instead
    wheelScroll.ts  (P42) translates a vertical wheel gesture into horizontal scroll on an
                    overflowing strip (a plain mouse produces no deltaX) — a renderer-root utility
                    since both workbench/'s tab strip and views/console/'s result-chip strip need
                    it and neither may import the other's own file sideways
  shared/
    protocol/       ipc.ts, port.ts, engine-ops.ts, data-ops.ts, page.ts — wire message shapes, one
                    file per channel group (`page.ts` is the largest module in shared/ — the
                    TabularPage/DocumentPage/KeyValuePage/StreamPage union and its byte-packed
                    chunk format)
    domain/         connection.ts, tree.ts, ops.ts, uri.ts — types + Zod schemas for domain
                    concepts, independent of any one transport
                    object-store.ts (P33): the S3 transfer/upload wire types, the `_key`/`$file`/
                    `$contentType` mutation sentinels, and contentTypeForFilename()
                    (P39) layout.ts, settings.ts and shortcuts.ts joined this folder from the
                    shared/ root — Zod-schema domain vocabularies whose transports differ (layout/
                    settings ride IPC, shortcuts rides nothing), which is exactly why this split
                    separates "what the concepts mean" from "bytes on the wire"
    caps.ts         the Caps/Adapter contract (§5) — the one documented root member; every other
                    shared/ file lives under protocol/ or domain/ (P39)
tests/
  db/               testcontainers fixtures + per-engine scenarios, mirrors engine/adapters/
  electron-db/      P32: the Kafka adapter suite, run under `ELECTRON_RUN_AS_NODE=1 electron` on
                    `node:test` — Bun cannot load @confluentinc/kafka-javascript's native addon at
                    any ABI, so this one engine's scenarios can't live under tests/db/ like the rest
  ui/               playwright specs
docs/
```

**Why this split pays for itself:**
- **`storage/schema/` vs `storage/repos/`** separates "what the tables look like" (generated-adjacent,
  changes only with a migration) from "how the app queries them" (changes with every feature) — today
  both live inside single per-table files, so a schema tweak and a query tweak are an undiffable mix.
- **`main/ipc/` one file per domain plus a `registry.ts`** replaces a single growing `ipc.ts`. Adding
  `kira:tabs:*` for session restore, or `kira:files:*` for P33's save/open dialogs, is a new file and
  one registry line, never an edit to unrelated handlers.
- **`engine/scheduler/` vs `engine/cache/`** are pulled apart because they are genuinely different
  lifecycles (an op's cancellation vs a page's eviction) that P1/P2 currently co-locate; keeping them
  separate now avoids a forced split later when Kafka/SQS streaming ops need scheduler changes that
  have nothing to do with caching.
- **Adapters share the same core files, not one fixed five-file shape.** Every adapter has
  `index.ts`/`client.ts`/`query.ts`/`definition.ts`/`read.ts`/`caps.ts` (P36's ClickHouse was the
  eleventh and last to add `caps.ts`), and most also have `catalog.ts` (9), `mutate.ts` (9) and
  `console.ts` (6) — `postgres/` alone holds ten files. `errors.ts` is not "every adapter but
  RabbitMQ": **RabbitMQ has it** (exporting two mappers, not one), and **`mariadb/`/`mysql/` have
  none** — they are re-export profiles over `mysql-family/` (P34 D7-D10), which owns the mapper.
  `tests/db/` mirrors `engine/adapters/` 1:1 regardless, and a reviewer already knows where a new
  adapter's `read.ts`, or its error mapper, will be before either exists. Four modules sit directly
  under `engine/adapters/`, outside any one adapter's own folder, for the genuinely driver-agnostic
  glue that duplicating would only let drift: `sql-text.ts` (P39: `resolveProjection`/`safeInt`;
  P39 iter2: `stripOneTrailingSemicolon`/`singleStatusPage`; P39 iter3: `computeEffectiveOrder`, the
  keyset-eligibility rule postgres/mysql-family/sqlite's `read.ts` each wrote out), `sql-mutate.ts`
  (P39 iter2: `orderedOps`/`assertColumnsKnown`/`assertAffectedExactlyOne`/`assertKeyIsPrimaryKey`
  — the SQL adapters' mutation guards; P39 iter3: a generic `ValueRenderer<P>`/`renderRowOp`/
  `resolveDatabaseTablePath`, the row-op-to-SQL-text renderer four adapters' `mutate.ts` each wrote
  out, parameterized over the dialect's own placeholder and params-element type) and `errors.ts`
  (P39: `unsupported()`/`noQueryConsole()`; P39 iter2: `assertWritable()`, the read-only refusal
  every write-capable adapter opened with; P39 iter3: `assertNotCancelled()`, Adapter rule 2's
  pre-flight cancellation check, replacing nine copies).
- **`renderer/state/`** exists so `views/*` are siblings that depend downward on shared state, never
  sideways on each other, upward into `workbench/`, or (P39 iter3) into `project/` — the dependency
  graph stays a tree as more view kinds (P8 documents, P9 key/value, P10 stream) are added. P39 made
  this a fact rather than an intention: eighteen `views/* → workbench/*` imports and six sideways
  `views/* → views/*` imports had accumulated by P38; both counts are zero now. P39 iteration 2 made
  it a *held* fact rather than a measured one: `biome.json`'s `noRestrictedImports` override on
  `src/renderer/views/**` fails the build on either kind of edge, so the count staying zero no
  longer depends on review alone. Iteration 2 also found, but left unfixed, `project/`↔`views/`
  depending on each other in both directions; iteration 3 closed it with `state/viewCommands.ts`'s
  registry (above) and added a matching `src/renderer/project/**` override forbidding `**/views/**`.
  The same pass extended the enforced layering past `views/*` for the first time: `main/**` (minus
  `storage/`) may not import `drizzle-orm`/`node:sqlite`, `main/storage/**` (minus `db.ts`) may not
  import `node:sqlite`, and `engine/adapters/**` may not import `electron` — Adapter rule 1, the
  property that lets `tests/db/` import an adapter directly, checked by a lint rule for the first
  time. Biome's `noRestrictedImports` `overrides` do not merge across overlapping blocks — the last
  matching override replaces the whole rule rather than adding to it — so a broadly-scoped override
  placed after a narrowly-scoped one can silently delete the narrow one's patterns while `lint`
  stays green; every override added here keeps its `includes` disjoint from every other's, except
  the deliberate `engine/adapters/s3/**` nesting inside `engine/adapters/**`, which repeats the
  `electron` pattern it would otherwise mask.
- **`@shared/*` is the one import spelling, everywhere.** P39 iteration 2 made the alias resolvable
  from `engine/`/`main/`/`preload/` too (a root `tsconfig.json` `paths` map plus
  `electron.vite.config.ts`'s `main`/`preload` blocks) and migrated every relative
  `../shared/...`/`../../src/shared/...` import (renderer, engine, main, preload, `tests/db/`) to
  it. `@renderer/*` — declared in three places, used in zero — no longer exists.
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