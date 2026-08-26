# Architecture reference

This is the **current-state** companion to `docs/v1/SPEC.md`. SPEC's §10 phasing table is a
decision *history* — what was built, in what order, and why, phase by phase, kept exactly as
implemented. This file is the opposite cut: facts about the app **as it stands today**, organized
by subsystem/engine so a future session can look something up without reconstructing it from
phase-history prose. When the two ever appear to disagree, SPEC.md is authoritative for behavior
and this file should be corrected to match.

This file is for facts about the app itself — driver/dependency choices, protocol-level
constraints, capability quirks and the structural reasons behind them. Environment-specific
operational notes (how to run Docker in Claude Code's own sandbox, how to work around a proxy
block, which env var a headless Linux box needs) belong in `AGENTS.md`, not here.

## Stack

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

## Invariants

Rules that follow from the app's two hard non-functional requirements — silky UI and a small RAM
footprint. The budget numbers themselves (and what's actually measured) live in
[`docs/PERF.md`](PERF.md) §1, not here — this section is the *rules*, not the numbers.

- The renderer never imports a database driver and never parses a wire protocol.
- No DOM node per cell for off-screen rows — the grid is virtualized in both axes.
- No Vue reactivity on row data. Rows live in plain frozen typed structures; the grid reads them
  imperatively and re-renders on an explicit version counter.
- Long lists (tree, log panel, document view) are virtualized too.
- Every operation that can exceed ~150 ms shows progress and a working stop button.
- Every DB read goes through the cache layer (see Caching, below) — a cache miss is the only thing
  that produces a query.

## Adapter contract

Every engine is one directory under `src/engine/adapters/`, implementing the `Adapter` interface
(`src/engine/adapters/adapter.ts`). A `Caps` object (`src/shared/caps.ts`) declares what that
engine can do — `defaultPageKind`, `pagination` strategy, `canInsert`/`canUpdate`/`canDelete`,
`cancel`, `sql`, `definition`, `describe`, `fileTransfer`, `keyBrowser` (P41 — true only for
redis/s3: the top-level container's own key/object space is unbounded and arbitrarily nested, so
the project tree treats that container as a leaf and the UI reaches it through a dedicated Browse
tab instead, SPEC.md §8.18) — and the UI reads *only* `Caps`, never a `connection.kind` check, to
decide what to show. `registry.ts` lazily `import()`s each adapter directory so an unused engine's
driver is never loaded into the engine process's baseline memory.

### Per-database mapping

| DB | Tree levels | Default view | Pagination | Exact count | Cancel mechanism |
|---|---|---|---|---|---|
| PostgreSQL | database → schema → tables (ungrouped), views/matviews/functions/sequences grouped into per-kind folders | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `pg_cancel_backend(pid)` on a side connection |
| MariaDB | database → tables (ungrouped), views/routines grouped into per-kind folders (routines labelled "Routines") | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `KILL QUERY <threadId>` on a side connection |
| MySQL | database → tables (ungrouped), views/routines grouped into per-kind folders (routines labelled "Routines"); no sequences (MySQL has no SEQUENCE engine) | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `KILL QUERY <threadId>` on a side connection |
| SQLite | one `database` node per `PRAGMA database_list` entry (in practice always exactly `main`) → tables (ungrouped), views grouped into a folder; no sequences or routines (SQLite has neither) | tabular | keyset on PK, else a unique index, else the table's own implicit `rowid` (never mutation identity); `LIMIT/OFFSET` only for a view or a text-sorted request | yes (`count(*)` measured at ~9 ms/1M rows) | none — SQLite has no interruptible statement (`sqlite3_interrupt` doesn't exist in `node:sqlite`, and the whole API is synchronous) |
| ClickHouse | one node per `system.databases` row → tables (ungrouped), views/materialized views grouped into per-kind folders; no sequences or routines (ClickHouse has neither); `system` is kept, not hidden | tabular | `LIMIT/OFFSET` only — a MergeTree `PRIMARY KEY` is a sparse index, with no unique row key to build a keyset cursor on | yes (`count()` reads part metadata) | `KILL QUERY WHERE query_id = '<id>' SYNC` on a second HTTP request (the client's own connection pool already has one free) |
| MongoDB | database → collections (ungrouped, indexes shown in the definition view) | documents | `_id` keyset, `skip/limit` fallback | `countDocuments` (slow) / `estimatedDocumentCount` | `AbortSignal` on the cursor, `killOp` fallback |
| Redis | db index (a leaf — its key namespace is unbounded, browsed in a Browse tab) | key/value | `SCAN` cursor (never `KEYS`) | `DBSIZE` only (approx per-prefix) | abort the SCAN loop; `CLIENT KILL` for blocking cmds |
| Kafka | cluster → topics (ungrouped), consumer groups (folder) | stream | offset window per partition | end-offset − begin-offset | close the assigned consumer, `AbortSignal` |
| SQS | region → queues | stream | receive batches | `ApproximateNumberOfMessages` | `AbortSignal` on the SDK call |
| S3 | account → buckets (a leaf — a bucket's prefix/object space is unbounded, browsed in a Browse tab) | key/value (object browser) | `ListObjectsV2` continuation token | `KeyCount` per listed page only (no cheap exact bucket count) | `AbortController` on the SDK call |
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

Every adapter maps its own driver's thrown errors from its own `errors.ts`, exported as one
`mapError(err): AdapterError` (P39) — the closed `AdapterErrorCode` set, with the driver's message
preserved verbatim (Adapter rule 4). RabbitMQ is the one exception: it exports `mapHttpError` and
`mapNetworkError` instead, since it maps two genuinely different inputs (an HTTP status plus a
management-API body, and a `fetch` rejection) and collapsing them would lose the `notFoundHint`
distinction P37 built. `src/engine/adapters/errors.ts` (the shared root, not any one engine's own)
also holds `unsupported(kind, what)` and `noQueryConsole(kind)` — the two sentence shapes behind
every `E_UNSUPPORTED` capability stub (describe/definition/file-transfer read `"<what> is not
supported for <kind>"`; a missing query console reads `"<kind> has no query console"`). It also
holds `assertWritable(readOnly)` (P39 iter2) — the `"connection is read-only"` refusal every
write-capable adapter's `mutate()` opens with (`mutate()`'s own documented contract in
`adapter.ts`: enforced on the engine side, not only greyed out in the UI). It also holds
`assertNotCancelled(ctx)` (P39 iter3) — Adapter rule 2's pre-flight cancellation check (`throw`s
`E_CANCELLED` if `ctx.signal` is already aborted), replacing nine copies of the same guard across
postgres/mysql-family/rabbitmq/clickhouse/sqlite.

`src/engine/adapters/sql-text.ts` holds the genuinely shared, driver-agnostic SQL text/planning
glue the SQL adapters' `read.ts` modules call — `resolveProjection`/`safeInt` (P39),
`stripOneTrailingSemicolon`/`singleStatusPage` (P39 iter2), and `computeEffectiveOrder` (P39 iter3)
— the keyset-eligibility rule (which sort terms admit a keyset predicate, and the tiebreaker that
makes one) that postgres/mysql-family/sqlite's `read.ts` each wrote out identically; each call site
still passes its own tiebreaker expression (sqlite's keeps its rowid fallback, since only sqlite's
`ReadTarget` has a `rowidColumn` field to fall back to).

`src/engine/adapters/sql-mutate.ts` (P39 iter2) holds the SQL adapters' shared mutation guards —
`orderedOps` (delete, then update, then insert, regardless of the plan's own array order),
`assertColumnsKnown`, `assertAffectedExactlyOne` and `assertKeyIsPrimaryKey` — called by postgres/
mysql-family/sqlite (and clickhouse for `assertColumnsKnown` alone, since it has no addressable row
to update or delete). `assertKeyIsPrimaryKey` takes the caller's own already-built qualified-name
string rather than a shared format, since the three dialects spell it three different ways
(`schema.relation` / `database.table` / `schema.table`). It also holds (P39 iter3) a generic
row-op-to-SQL-text renderer — `ValueRenderer<P>`, `literalRenderer`/`createParamRenderer` and
`renderRowOp` — that postgres/mysql-family/sqlite's `mutate.ts` each wrote out character-for-
character identically apart from the dialect's own parameter placeholder (`$n` vs `?`) and params
element type (`unknown[]` vs sqlite's `SqliteParam[]`), plus `resolveDatabaseTablePath` for the
two-segment database/table path check clickhouse/mysql-family/sqlite's `mutate.ts` shared (postgres
keeps its own three-segment `resolveTablePath`, a genuinely different path shape with its own
message).

## Per-engine adapter facts

### PostgreSQL / MariaDB / MySQL

Full read/write SQL adapters — keyset pagination on the primary key (falling back to
`LIMIT/OFFSET`), `pg_cancel_backend`/`KILL QUERY` cancellation on a side connection. MariaDB and
MySQL share one driver (`mariadb`, a genuine dual client) and one core (`engine/adapters/
mysql-family/`) — `mariadb/` and `mysql/` each hold only their own profile (server label,
`applyEngineOptions`) and re-export everything else.

### SQLite (`node:sqlite`, P35)

Uses `node:sqlite`, a Node builtin — no new dependency, no native module, no build step. Requires
Bun 1.4+ or Electron/Node 22.5+ (not present in Bun 1.3). `caps.cancel` is permanently `false`:
`node:sqlite` has no `sqlite3_interrupt` and the whole API is synchronous, so a running statement
blocks the event loop and an abort can never be delivered while one runs — this is a fact about the
driver, not a gap. Keyset pagination falls back through primary key → unique index → the table's
own implicit `rowid` (never surfaced as mutation identity) before degrading to `LIMIT/OFFSET`.

### ClickHouse (`@clickhouse/client`, P36)

`@clickhouse/client` (npm) — the app's first added dependency since the Kafka client migration
(P32), and unlike that one it needs no native build step at all (a plain JS HTTP client). The
client's HTTP interface has **no per-request `database` override**: `database` is set once at
client construction and embedded in every request's URL query string automatically. Every
statement the adapter issues relies on that one construction-time default plus fully-qualified
`` `db`.`table` `` identifiers — there is no per-call `database` option to reach for; the client's
own types don't have one.

`canUpdate`/`canDelete` are permanently `false` (`caps.ts`) — a MergeTree `PRIMARY KEY` is a sparse
index over parts, not a unique row key, so there is no addressable row to target for `UPDATE`/
`DELETE`. This is a structural fact about the engine, not "not yet implemented." The grid's `− row`
button and inline cell editing are both disabled for this connection kind for the same reason, with
a tooltip naming it. Cancellation goes through `KILL QUERY WHERE query_id = '<id>' SYNC` on a
second HTTP request (the client's own connection pool already has a free one), since the server
keeps executing a query after the original socket closes.

### Kafka (`@confluentinc/kafka-javascript`, P32)

The Kafka adapter's driver wraps a native NAN addon (built against V8's C++ API, not N-API) — it is
**ABI-specific per JS runtime**, not portable the way a pure-JS dependency is, and it must be
rebuilt for Electron's own ABI before use (`scripts/native-electron-build.sh`, wired as `predev`/
`pretest:ui`/`pretest:db:kafka`/`prepackage:mac`). **Bun cannot load this addon at any ABI** —
confirmed empirically, not just from the docs (a matching-ABI build still crashes with `undefined
symbol: v8::FunctionTemplate::SetClassName` when required from Bun) — which is why the Kafka
adapter suite runs under `ELECTRON_RUN_AS_NODE=1 electron` (`tests/electron-db/kafka.spec.ts`, on
`node:test`) instead of `bun test tests/db` like every other engine.

The adapter never joins a consumer group for a read-only browse — it assigns partitions directly
(`assign()`, explicit start offsets, a bounded poll loop) rather than `subscribe()`, so `group.id`
is a required-but-never-joined constant and browsing never pays a group-join round trip. `canDelete`
is permanently `false` — a topic's log is immutable, so there is no per-message delete or update at
the protocol level, only retention/compaction.

### SQS

Adapter over `@aws-sdk/client-sqs`. `caps.pagination = 'batch'` — every poll is an independent,
non-resumable `ReceiveMessage` call with no addressable position; the stream view never
auto-loads, only an explicit Poll button. `canDelete` is a real per-item removal via the message's
receipt handle (kept adapter-local, in-memory, never round-tripped over the wire — a receipt handle
is only valid for the message it names, on the session that received it). No `canUpdate`: a
delivered message can't be edited in place, only replaced by delete + resend.

### S3

The only engine with `caps.fileTransfer` — items are whole files, streamed to/from a local path via
a native OS dialog (`downloadObject`), not a value the mutation-preview model can show inline.
`fileTransfer` is orthogonal to the three write flags: Download reads regardless of a connection's
read-only flag; Upload is gated on `fileTransfer && canInsert` together.

`caps.keyBrowser = true` (P41): a bucket's prefix/object space has no fixed size and can nest
arbitrarily deep, so `s3/catalog.ts`'s `bucket` node is `hasChildren: false` — the tree stops at the
bucket, and `/`-delimited prefix/object navigation happens in a Browse tab instead
(SPEC.md §8.18). Object node paths still carry the *full* bucket-relative key on their own
`object` segment, nested under every ancestor `prefix` segment (`catalog.ts`'s `listPrefixChildren`
— `bucket:b/prefix:reports/object:reports%2Fnote.txt`, not a bare local filename), the same
convention the tree used before this phase and unrelated to it.

### RabbitMQ (HTTP management API, P37)

**No dependency at all** — the adapter speaks only the `rabbitmq_management` plugin's HTTP API over
the platform's own `fetch`. AMQP 0-9-1 itself has no way to enumerate anything (no list-queues, no
list-exchanges, no list-bindings in the protocol at all), so the wire protocol was never a
candidate for the adapter's read path; adding an AMQP client on top of the HTTP one would be a
second protocol for zero enumeration benefit, not a shortcut. `engine/adapters/rabbitmq/` has no
`console.ts` — `caps.sql` is `false`, since the management API has no ad-hoc command language worth
a console.

The default vhost is literally **named `/`**, and must reach the wire as `%2F` (the management
API's own path convention, e.g. `GET /api/queues/%2F/<name>`) — every path segment the adapter
builds goes through one `encodeSegment()` function in `query.ts` so this can't be forgotten at a
second call site. The image must carry `-management` in its tag: the plain `rabbitmq:4` image has
no management plugin at all, so the adapter cannot reach a broker started from it.

`canUpdate`/`canDelete` are permanently `false` — a RabbitMQ message has no broker-assigned
identity at all (`message_id` is an optional, publisher-set AMQP property, never one the broker
itself assigns), and AMQP has no per-message update or delete at any protocol version. This is a
third distinct structural reason for the same pair of flags, after ClickHouse's sparse-index one
and Kafka's immutable-log one. `mutate()` accepts only `insert` (a publish through an exchange,
defaulting to the default exchange with the queue's own name as routing key); a publish the broker
accepts but routes nowhere (`{"routed":false}`) is reported as an error, not a silent success.

A poll **requeues, it does not consume** — `read()` always uses `ackmode: reject_requeue_true`, so
nothing this adapter does removes a message from a queue; messages come back marked `redelivered`
on the next poll. This is the same "poll-on-demand, never automatic" policy SQS uses, with its own
warning-strip wording (SQS's messages are consumed; RabbitMQ's are requeued — reusing one engine's
sentence for the other would be a false statement about it). The tree reuses the existing
`database` NodeKind for a RabbitMQ virtual host (labelled "Virtual host" via a per-connection-kind
override) rather than adding a new one; `exchange` is the one new `NodeKind` this phase added — a
definition-only leaf, foldered under "Exchanges," with the nameless default exchange filtered out
of every listing (its blank name cannot survive the app's own path/tab-title plumbing honestly).

### MongoDB / Redis

MongoDB: document-shaped, `_id` keyset pagination falling back to `skip/limit`, `AbortSignal` +
`killOp` cancellation. Redis: key/value-shaped, `SCAN`-cursor pagination (never `KEYS`), `DBSIZE`
for an approximate count only.

Redis is the other `caps.keyBrowser = true` engine (P41, alongside S3): a db index's own key
namespace is unbounded, so `redis/catalog.ts`'s `database` node is `hasChildren: false` and the
`:`-split namespace/key navigation that used to expand inline in the tree happens in a Browse tab
instead (SPEC.md §8.18) — `SCAN`'s own cursor/count-budget discipline is unchanged, only where the
result is shown moved.

## Storage

`~/.kira-studio/` (dir `0700`), containing `kira.sqlite` (`0600`) and `logs/`.

Credentials in the `connections` table's `password` column are **encrypted at rest** (P25) via
Electron's `safeStorage` (Keychain-derived on macOS) as a `kira:v1:<base64>` envelope — plaintext
never touches disk for a connection created or edited since, and a row left plaintext by an older
build is upgraded in place on the next launch. The connection dialog's credential note reflects
the platform's actual backend rather than a fixed warning. Linux — development/CI only, v1 targets
macOS only — has no real keychain support: behind an explicit `KIRA_INSECURE_SECRETS=1` env var it
falls back to Chromium's `basic_text` obfuscation (a hardcoded key, not a real keychain); without
it, secret storage is unavailable and a write carrying a password is refused rather than silently
stored in the clear. The column is still accessed only through a `SecretStore` indirection (now
paired with a `SecretCipher`, `main/secret-cipher.ts` — the only file that imports `safeStorage`),
so a future re-key or a real cross-platform secret store stays a contained change.

```
schema_version(version)
settings(key, value)                                   -- fonts, sizes, budgets, toggles
connections(id, name, kind, color, mode, read_only, host, port, database, username, password,
            uri, options_json, preconnect, preconnect_sidecar, created_at, updated_at, sort_order)
connection_filters(id, connection_id, node_kind, pattern, is_regex, action)  -- hide/show rules
saved_queries(id, connection_id, path, name, kind, body, pinned, created_at, used_at)
                                                       -- saved filters/queries per table + console
filter_history(id, connection_id, path, where_text, order_by_json, used_at)
                                                       -- history list of past filters/sorts
metadata_cache(connection_id, path, kind, payload_json, fetched_at, etag)
op_log(id, connection_id, tab_id, started_at, duration_ms, kind, status, rows,
       command, error)                                  -- rotated, capped
ui_layout(key, value)                                   -- panel sizes, visibility
tabs(id, connection_id, path, kind, state_json, order, active)  -- session restore
```

Migrations are forward-only numbered SQL files applied on startup. Table access goes through
**Drizzle ORM** schema definitions that mirror the migration files. Every row read back out of
`settings`, `ui_layout` and `connections` is parsed through a **Zod** schema before use, so a
hand-edited or stale-shape row fails loudly instead of propagating `undefined`s into the UI.

S3 connections reuse the existing `connections` columns, mirroring SQS's own fields-mode
repurposing exactly: `host`/`port` are unused, `database` holds the **AWS region**, the AWS
**named profile** goes in `username`, and static keys (accepted only in URI mode, per the SQS
read policy in the per-engine mapping table above) go in `uri`. `options_json` holds two
independent overrides: `endpoint` (a non-AWS S3-compatible target — LocalStack, MinIO) and
`bucket` (scopes the whole tree to one bucket via `HeadBucketCommand` instead of
`ListBucketsCommand`, for IAM credentials that can only ever see that one bucket and commonly
deny `s3:ListAllMyBuckets` outright).

SQLite connections reuse the same columns again, the same way: `database` holds the **absolute
file path** on disk, and `host`/`port`/`username`/`password` are all unused — there is no server
and no credential, only a file Kira opens.

## Caching

Three tiers, each with an explicit invalidation story.

**L1 — metadata** (databases, schemas, tables, columns, PK/FK, indexes, object definitions).
Persisted in `metadata_cache`. Survives restart. **No TTL** — an entry is dropped only when its
connection is deleted, and the whole connection's metadata is refreshed on **every reconnect**.
Plus manual *Refresh* from the tree context menu. This is what makes the project panel instant on
launch and what lets panel search work without touching the database.

**L2 — result pages.** In-memory LRU in the engine, byte-budgeted (default 64 MB, configurable).
Key = hash of `{connectionId, path, filter, projection, sort, pageSize, pageToken}`. Never
persisted. Invalidated by: manual refresh, any local mutation on the same target, disconnect.

**L3 — counts.** `{connectionId, path, filter} → {count, at}`. TTL 5 min, and immediately marked
*stale* (shown greyed with a refresh affordance) after any local mutation. Counts are only
computed on explicit user request — never automatically, because they are the most expensive read
in the app.

**No speculative fetching.** A page is loaded only in direct response to a user action — Next/
Previous, a filter/sort/projection change, Refresh, or the Count button. There is no background
prefetch of the next page and no automatic count-on-open; both existed at one point and were
removed by user request as unwanted background work rather than kept as an opt-out setting.

**Observability.** The status bar shows cache size; the settings dialog shows hit rate and a
*Clear caches* action.

## Process model

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

## Testing

Four suites, under `tests/`: `unit/`, `db/`, `electron-db/`, `ui/`.

**Isolation from the dev server.** The container-backed and UI suites run against their own
`KIRA_HOME` and their own Testcontainers-provisioned databases, never the developer's real
`~/.kira-studio` or a database a running `bun run dev` session is connected to. Running the tests
must not disconnect, lock out, or otherwise disturb a `bun run dev` instance already running on the
same machine. One exception is deliberate (P25 F10): on a real macOS dev machine, the Keychain item
`safeStorage` uses is named after the app and shared with the developer's own login keychain, so a
UI test that saves a connection password touches the same OS-level encryption key a `bun run dev`
session would. This is safe — each test's *secrets* stay isolated in its own temp `KIRA_HOME`'s
`kira.sqlite`, only the underlying key is shared, the same as any two processes signed as this app
would share it, and no test ever rotates or clears that key.

**`tests/unit/` needs nothing external and finishes in about a second** (`bun test tests/unit`) —
plain TypeScript modules exercised with fakes (a `bun:sqlite`-backed Drizzle instance restating a
table's DDL by hand, a fake `requestAnimationFrame` queue, a hand-written fake client implementing
one method) rather than a real container or a real Electron process. A shared `window` stub
(`tests/unit/support/window.ts`) is imported by every spec that needs one, rather than each spec
declaring its own — Bun's module registry is shared across every spec file in one test run, so
whichever spec's stub loads first wins for the whole run.

**`tests/db/` and `tests/electron-db/` need a real external resource** — a Testcontainers-managed
Docker container per engine (`bun test tests/db`, requires Colima on macOS or a Docker daemon on
Linux) — and one file in `electron-db/` needs a real Electron process on top of that, because the
native Kafka driver is built against Electron's own Node ABI and cannot load under Bun at all (see
the Kafka section above). One container per engine, one fixture module per engine that seeds a
realistic dataset: wide tables, `NULL`s, unicode, large text/blob, nested JSON, composite PKs,
self-referencing and multi-hop FKs, ≥ 1 M rows in one table to exercise paging and counts.
Scenarios per engine: connect/disconnect, tree enumeration, describe, definition, first page, deep
page, count, projection, sort, filter, cancel-mid-query (asserted **server-side** — the query must
actually be gone from `pg_stat_activity` / `SHOW PROCESSLIST` / `currentOp`), cache hit/miss
behaviour, add/delete row, command preview correctness. Local-only for now — no CI wiring in v1.

**`tests/ui/`** (`bun run test:ui`) runs Playwright's `_electron.launch()` against the built app,
driving the real UI against the real containers. Every change is validated with it before it is
called done. Coverage: panel toggles, settings persistence, connection CRUD, tree expansion and
caching (assert query counts via the op log), opening the same table twice with independent state,
all pagination controls, projection, search toolbar modes, stop button, cell editor autodetect +
beautify, document expand/collapse, PK/FK navigation, every context menu opening with the right
items, copy/paste, the sticky ancestor band's exact geometry and handoff across a scroll, and the
checkbox tree filter's kind/tri-state/name-filter/persistence behavior. Plus a memory/perf smoke
test asserting the RSS budget and no dropped frames while scrolling 10k rows.
