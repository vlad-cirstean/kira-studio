# Architecture reference

This file is **authoritative for the app as it stands today**: facts about the app itself —
driver/dependency choices, protocol-level constraints, capability quirks and the structural reasons
behind them — organized by subsystem/engine so a future session can look something up without
reconstructing it from phase-history prose. Environment-specific operational notes (how to run
Docker in Claude Code's own sandbox, how to work around a proxy block, which env var a headless
Linux box needs) belong in `AGENTS.md`, not here.

The tree itself outranks this file — if they disagree, the tree is right and this file needs
fixing, not the other way around. Where this file and `docs/v1/SPEC.md` disagree, this file is
authoritative for behavior: SPEC.md is the record of what v1 was *specified* to be, phase by phase
(§10), kept as originally written rather than corrected to match later reality — see
`docs/v1/README.md` for what that folder is and isn't.

**Related documents:** [`docs/PERF.md`](PERF.md) (performance budgets and measured results),
[`docs/PACKAGING.md`](PACKAGING.md) (macOS build and packaging verification),
[`docs/design/kira-design-system/`](design/kira-design-system/) (the workbench visual reference),
[`AGENTS.md`](../AGENTS.md) (the working agreement for changes to this repo).

## Stack

| Concern | Choice | Note |
|---|---|---|
| Shell | **Wails v3** (`v3.0.0-beta.16`), Go | a custom, hidden-inset title bar (`Mac.TitleBar: application.MacTitleBarHiddenInset`, P1) drawn by `workbench/TitleBar.vue` over a full-size-content window — not the OS-drawn bar; macOS 14+, `arm64` only |
| Language | TypeScript 6 (`tsc`/`vue-tsc`) for `.ts` and `.vue`; **Go** for the shell | pinned below TypeScript 7 on purpose — TS7 ships no stable programmatic compiler API until 7.1, and `vue-tsc` (which `bun run typecheck:web` runs) consumes that API in-process; `@typescript/native-preview`'s `tsgo` binary (`typecheck:tests`/`typecheck:unit`) is a separate, already-latest-upstream tool in the meantime. Converge on one toolchain once TS 7.1 ships and `vue-tsc` adopts it (P19 F2/F4) |
| Package manager / scripts / test runner | Bun | tooling only — every adapter is native Go, so nothing at runtime depends on it |
| Renderer build | Vite (`vite build`, `apps/kira-studio/frontend/vite.config.ts`) | builds `apps/kira-studio/frontend/src` straight into `apps/kira-studio/frontend/dist`, which `apps/kira-studio/main.go` embeds via `//go:embed all:frontend/dist` and serves through Wails' `AssetOptions.Handler`. Two dynamically-imported chunks as of P15, still split under Vite 8/Rolldown (P19 C6): the query console's SQL Format button reaches `sql-formatter` only through `views/console/sqlFormatterEntry.ts`'s `await import()` (~37 KB gzip), and the data grid's Generate data… dialog reaches `@faker-js/faker` only through `views/grid/fakeData/fakerEntry.ts`'s `await import()` (~155 KB gzip) — both fetched on first use, neither costing a launch |
| UI | Vue 3 (`<script setup>`, Composition API) | VDOM mode — Vapor mode evaluated and declined in P6 (`docs/v1.1/plans/P6-vue-vapor-mode.md`) |
| Styling | Tailwind (v4, CSS-first config) | tokens mirror VS Code Dark Modern |
| Text editing / viewing | CodeMirror 6 | definition tab's Source pane, cell editor, document view, command preview |
| Icons | `@vscode/codicons` | UI chrome |
| Validation | Zod (TypeScript side) / hand-written model decoders (Go side) | Zod's remaining TypeScript-side job is connection-dialog input — the engine wire protocol it used to guard (`src/engine/{control,rpc,data,stdio-main}.ts`) went with `src/engine/`'s deletion (P58f). Rows read back out of SQLite are validated in Go (`apps/kira-studio/internal/storage/model/`) |
| Lint + format | Biome, default rules | single tool, no ESLint/Prettier |
| Storage | SQLite at `~/.kira-studio/kira.sqlite`, accessed **from Go** | `database/sql` + `modernc.org/sqlite` (pure-Go, no cgo — the same driver the sqlite adapter package already used for browsing external files, now also backing the app's own database); `SetMaxOpenConns(1)`. No ORM — the Drizzle dependency and every consumer of it are gone |
| Packaging | `wails3 task darwin:package:dmg` + `scripts/sign-bundle.sh` | ad-hoc signed (identity `-`), both the `.app` and the `.dmg` around it; ships as a styled disk image with an `/Applications` shortcut (P10), no auto-update, no notarization; no `runtime/` tree to vendor or sign any more (P58f) |
| DB tests | Testcontainers, driven from Bun | `packages/db-fixtures/` no longer holds per-engine specs (P58f D1) — it survives as the shared fixture corpus (`fixtures/*.sql`, `support/*.ts`) that Go's `testsupport` package and `apps/kira-studio/tests/e2e-real/` both seed from; real containers, real data; Colima |
| UI tests | Playwright against the built bundle, real WebKit | every change validated |
| Logging | Go `log/slog` | a daily-rolling file under `~/.kira-studio/logs/`, mirroring the configuration `electron-log` used to hold — single log file, single source of truth |
| Data/console grid rendering (P22 Pass B cutover; P30 §3 extended it) | `slickgrid@5.20.0`'s core engine (MIT, `6pac/SlickGrid`), core `SlickGrid` class only — no `SlickDataView`, no plugin, no `slickgrid-vue` | **the only grid engine** — `views/grid/DataGrid.vue`, `GridRow.vue` and `__kiraGridEngine` are gone (P22 Pass B). `views/grid/SlickGridHost.vue` hosts a data tab (full parity: sort, editor, selection ranges, FK/PK nav, clipboard); `views/console/ConsoleSlickGrid.vue` hosts the query console's tabular results (P30 §3) over the same reusable layer, ~300 lines instead of a second 2000+-line host: `views/shared/slick/kiraSlickGrid.ts` (the tuned scroll/runway/chase mechanism, inherited unmodified), `views/shared/slick/dataSource.ts` (the `CustomDataView` bridge; its data-tab-specific half, `createDisplayValueExtractor`/`pendingRowClasses`, stays in `views/grid/slick/dataSource.ts`, which re-exports the rest), `views/shared/slick/slickTheme.css`, `views/shared/page/columns.ts` and `theme/cellClass.ts`. The console host has no selection-range model, sort, editor, context menu, clipboard, FK nav or persisted column widths — a console result has none of what those exist to serve. `@tanstack/vue-virtual` is no longer a dependency (P30 §3.6 C7) |
| Outbound HTTP client (P2, body modes P3) | plain `net/http` (`apps/kira-studio/internal/httpclient/`), **no client/retry/URL-parsing/multipart-builder dependency at all** | the same "no driver dependency" shape the ClickHouse adapter already established (below): one package-level `*http.Client`, a 30s timeout applied via `context.WithTimeout` rather than `Client.Timeout` (so the Stop button and a timeout abort an in-flight body read the same way), redirects followed and every hop recorded up to 10, TLS verification always on, `http.ProxyFromEnvironment`. Reachable only from Go — the webview's own `fetch` is never used (`docs/ARCHITECTURE.md`'s own "Go owns the network" invariant, below). P3 adds every body mode this app's request builder supports — none/raw/code/urlencoded/formdata/file (`internal/httpclient/body.go`) — over the same one dependency-free package: a two-pass `mime/multipart` writer computes an *exact* `Content-Length` from a fixed boundary's deterministic framing before streaming a single byte, so a form-data or binary send is never chunked and never guesses |

Driver libraries — the best-maintained option per engine, **Go-native for all ten kinds as of P58e
M9.3** (checkpoint C2): `jackc/pgx/v5` (postgres), `go-sql-driver/mysql` (mariadb/mysql, via a shared
`mysqlfamily` core), `modernc.org/sqlite` (sqlite — pure Go, no cgo), a hand-rolled `net/http` client
(clickhouse, no driver dependency at all), `go.mongodb.org/mongo-driver/v2` (mongodb),
`redis/go-redis/v9` (redis), `aws-sdk-go-v2/service/{sqs,s3}` (sqs/s3, sharing a small `awscfg`
config-and-error-mapping package), `github.com/twmb/franz-go` + `franz-go/pkg/kadm` (kafka). **The
whole product binary is cgo-free for its own code** — only Wails' own macOS bindings still need
`CGO_ENABLED=1` — a materially better outcome than the parent plan's own D8 predicted, and one
nothing had claimed until now. **The Node engine child is gone as of P58f M10**: checkpoint C2
(P58e M9.3) had already brought it to answering no connection traffic for any kind; P58f deleted the
process itself, its build/vendoring machinery, and everything that supervised it.

App identity: organisation **kirathecat**, app name **Kira Studio**, bundle ID
`com.kirathecat.kira-studio` (the `-shell` suffix carried during the P52–P56 coexistence window is
gone). The bundle's executable is literally `Contents/MacOS/Kira Studio`, space included. No
auto-update.

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
- **Bulk data is produced and encoded exactly once, in the process that owns the window (P58 D3).**
  A result page is built in Go by the adapter that read it, held in the Go-side L2 cache as native
  structures, and serialized a single time when a renderer asks for it (see Process model, below).
  There is no second process, no intermediate encoding, and no re-decode — Go now parses every
  data-plane request envelope too, since it is the thing answering them. This replaces both the
  original Electron-era rule ("bulk data skips the main process", describing `MessagePort`) and the
  P58a–P58e interim ("the Go process forwards without looking"), which held only while a
  Node-served kind could still exist beside a Go-native one — P58f M10 deleted that seam along with
  the Node engine child.
- The renderer loads no remote content, opens no window, and navigates nowhere but its own base
  URL. Under Electron this was enforced by the shell as well as true of the code; under Wails only
  the second half still holds — the renderer contains no such call, but there is no navigation
  policy left to stop one (see Renderer security surface, below). The *shell* can open a second
  window — *Window → New Window*, ⇧⌘N (P8) — but only from a Go-side menu command, never from a
  renderer-initiated call: `JavaScriptCanOpenWindowsAutomatically: Disabled` (Renderer security
  surface, below) is unchanged, and the renderer never calls `window.open` or its own equivalent.

## Adapter contract

Every engine is one package under `apps/kira-studio/internal/adapters/` (`postgres/`, `mysqlfamily/` shared by
mariadb/mysql, `sqlite/`, `clickhouse/`, `mongo/`, `redis/`, `sqs/`, `s3/`, `kafka/`), implementing
the `Adapter` interface (`apps/kira-studio/internal/adapters/adapter.go`). A `Caps` struct
(`apps/kira-studio/internal/adapters/caps.go`, field order kept identical to the TypeScript `Caps` type still
declared in `packages/shared/caps.ts` for the renderer, so the two diff against each other) declares what
that engine can do — `DefaultPageKind`, `Pagination` strategy, `CanInsert`/`CanUpdate`/`CanDelete`,
`Cancel`, `SQL`, `Definition`, `Describe`, `FileTransfer`, `KeyBrowser` (P41 — true only for
redis/s3: the top-level container's own key/object space is unbounded and arbitrarily nested, so
the project tree treats that container as a leaf and the UI reaches it through a dedicated Browse
tab instead, SPEC.md §8.18) — and the UI reads *only* `Caps`, never a `connection.kind` check, to
decide what to show. `registry.go`'s `loaders` map is `registry.ts`'s successor: a plain constructor
table, each adapter package registering its own constructor from its own `init()`, not a
lazy-`import()` map — Go links every adapter into the binary regardless of whether a connection kind
is ever used, so there is no per-engine baseline-memory story left to preserve (P58a OQ-6).

### Per-database mapping

| DB | Tree levels | Default view | Pagination | Exact count | EXPLAIN form (P18) | Cancel mechanism |
|---|---|---|---|---|---|---|
| PostgreSQL | database → schema → tables (ungrouped), views/matviews/functions/sequences grouped into per-kind folders | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `EXPLAIN (FORMAT JSON, COSTS TRUE, VERBOSE FALSE, SETTINGS FALSE, BUFFERS FALSE) <sql>` — nested `Plans[]` tree | `pg_cancel_backend(pid)` on a side connection |
| MariaDB | database → tables (ungrouped), views/routines grouped into per-kind folders (routines labelled "Routines") | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `EXPLAIN FORMAT=JSON <sql>` — `nested_loop[]`/`read_sorted_file`/`filesort` wrappers, scalar `cost` (**a different JSON schema than MySQL's own**, despite the identical statement — F13) | `KILL QUERY <threadId>` on a side connection |
| MySQL | database → tables (ungrouped), views/routines grouped into per-kind folders (routines labelled "Routines"); no sequences (MySQL has no SEQUENCE engine) | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `EXPLAIN FORMAT=JSON <sql>` — `query_block.table`/`nested_loop`, `cost_info.query_cost` | `KILL QUERY <threadId>` on a side connection |
| SQLite | one `database` node per `PRAGMA database_list` entry (in practice always exactly `main`) → tables (ungrouped), views grouped into a folder; no sequences or routines (SQLite has neither) | tabular | keyset on PK, else a unique index, else the table's own implicit `rowid` (never mutation identity); `LIMIT/OFFSET` only for a view or a text-sorted request | yes (`count(*)` measured at ~9 ms/1M rows) | `EXPLAIN QUERY PLAN <sql>` — N rows × `(id, parent, notused, detail)`, **no cost and no row estimate at all** | `modernc.org/sqlite`'s real `sqlite3_interrupt`, reached by cancelling an adapter-owned per-op `context.Context` on that op's own dedicated `*sql.Conn` (Go-native as of P58b M6.3 — the Node adapter had no such mechanism at all) |
| ClickHouse | one node per `system.databases` row → tables (ungrouped), views/materialized views grouped into per-kind folders; no sequences or routines (ClickHouse has neither); `system` is kept, not hidden | tabular | `LIMIT/OFFSET` only — a MergeTree `PRIMARY KEY` is a sparse index, with no unique row key to build a keyset cursor on | yes (`count()` reads part metadata) | **two statements, one call:** `EXPLAIN PLAN json = 1, indexes = 1, description = 1 <sql>` (index selectivity, no cost) then `EXPLAIN ESTIMATE <sql>` (the only row-count figure) | `KILL QUERY WHERE query_id = '<id>' SYNC` on a second HTTP request (the client's own connection pool already has one free) |
| MongoDB | database → collections (ungrouped, indexes shown in the definition view) | documents | `_id` keyset, `skip/limit` fallback | `countDocuments` (slow) / `estimatedDocumentCount` | — (P18's SPEC row is the five SQL dialects only) | `$currentOp` + `killOp` on the *same* client the adapter already holds (never a side connection) |
| Redis | db index (a leaf — its key namespace is unbounded, browsed in a Browse tab) | key/value | `SCAN` cursor (never `KEYS`) | `DBSIZE` only (approx per-prefix) | — | a permanent, honest `false` — go-redis's blocking commands override the caller's context for the wait itself, so `CheckCancelled` between bounded `SCAN`-family rounds is the entire cancellation surface (`caps.cancel` stays `true`, since that surface is genuinely effective) |
| Kafka | cluster → topics (ungrouped), consumer groups (folder) | stream | offset window per partition | end-offset − begin-offset | — | none server-side — Kafka's protocol has no cancel operation at all, so the op's own `context.Context`, passed directly to every `kadm`/`kgo` call, is the entire mechanism; `caps.cancel` stays `true` since that surface is genuinely effective |
| SQS | region → queues | stream | receive batches | `ApproximateNumberOfMessages` | — | none server-side — the op's own `context.Context`, passed directly to every AWS SDK call (never a detached context), is the entire mechanism; `caps.cancel` stays `true` since that is genuinely effective |
| S3 | account → buckets (a leaf — a bucket's prefix/object space is unbounded, browsed in a Browse tab) | key/value (object browser) | `ListObjectsV2` continuation token | **per-object** exact field-row count via `HeadObject` (not a bucket-wide key count — S3 has no cheap exact answer to "how many keys total") | — | none server-side — same as SQS, the op's own `context.Context` on every SDK call; also load-bearing for `DownloadObject`'s temp-file cleanup ordering |

**SQS read policy.** Reads are **never automatic**. The stream view has an explicit
**Poll** button with a visible warning: `ReceiveMessage` makes messages invisible to real
consumers for the visibility timeout. Nothing is fetched on tab open, on refresh, or on a timer.
SQS's authentication is by **named AWS profile** (static keys accepted only in URI mode).

Cancellation is never "stop showing the result" — it is always forwarded to the server. If a driver
cannot cancel, the capability is absent and the stop button says so rather than lying.

Every adapter maps its own driver's returned errors to the closed `ErrorCode` set via
`apps/kira-studio/internal/adapters/errors.go`'s `New`/`CodeOf`, the driver's message preserved verbatim
(Adapter rule 4, carried over unchanged from the TypeScript design this replaced). `errors.go` also
holds the shared guard functions every adapter package calls rather than re-implementing: `Unsupported`/
`NoQueryConsole` (the two sentence shapes behind every `E_UNSUPPORTED` capability stub),
`AssertWritable` (the read-only refusal every write-capable adapter's `Mutate` opens with),
`CheckNotStarted`/`CheckCancelled` (pre-flight and mid-flight cancellation checks against the op's
own `context.Context`), and `RequireConnected[T]` (the generic "did `Connect` ever run" guard every
adapter's handle accessor opens with). `sqltext.go` holds the shared, driver-agnostic SQL text/
planning glue the SQL adapters' `read.go` modules call — projection resolution, the keyset-
eligibility rule and its per-dialect tiebreaker, page-token encode/decode, `WhereClause`/
`ParseCountValue`, and the full keyset-position pipeline (`AssertKeysetSupported` →
`ResolveFetchColumns` → `BuildScanOrderBy` → `BuildKeysetPosition`) that postgres/mysqlfamily/sqlite
each call with only their own tiebreaker and cell reader. `sqlmutate.go` holds the shared mutation
guards (`OrderedOps`, `AssertColumnsKnown`, `AssertAffectedExactlyOne`, `AssertKeyIsPrimaryKey`) and
a generic row-op-to-SQL-text renderer (`ValueRenderer`, `LiteralRenderer`/`NewParamRenderer`,
`RenderRowOp`) that postgres/mysqlfamily/sqlite share apart from each dialect's own parameter
placeholder and qualified-name format. `abort.go`'s `RunWithAbortRace[T]` is the one abort/settle
race every adapter with a callback-style or detached-context driver needs (postgres, mysqlfamily —
see their own sections below for which side of the race each takes and why).

## Per-engine adapter facts

### PostgreSQL / MariaDB / MySQL

Full read/write SQL adapters — keyset pagination on the primary key (falling back to
`LIMIT/OFFSET`), `pg_cancel_backend`/`KILL QUERY` cancellation on a side connection.

**PostgreSQL is Go-native as of P58a M5** (`apps/kira-studio/internal/adapters/postgres/`, `pgx/v5`) —
`nativeKinds["postgres"]` is `true`, so a Postgres connection is served in-process by
`adapterhost.Router`, never by the Node engine child. The Go port keeps the design facts
above (keyset-on-PK pagination, `pg_cancel_backend` on a side connection using the tracked backend
pid) exactly; what changed is only which process runs the adapter and how its query context is
handled — a caller-side op cancellation must never be the same `context.Context` passed to `pgx`'s
own `Query`/`Exec`, since pgx (unlike Node's `pg`) honours context cancellation by racing its own
cancel request against the adapter's explicit `pg_cancel_backend` call
(`internal/adapters/postgres/query.go`'s `runWithAbortRace`).

**MariaDB and MySQL are Go-native as of P58b M6.2**
(`apps/kira-studio/internal/adapters/mysqlfamily/`, `github.com/go-sql-driver/mysql`) —
`nativeKinds["mariadb"]` and `nativeKinds["mysql"]` are both `true`. The shared-core/thin-profile
split carries over unchanged from the Node design: `mysqlfamily/` holds one `Adapter`
implementation, and `mariadb/`/`mysql/` each hold only their own `Profile` (server label,
`ApplyEngineOptions`). Same abort pattern as Postgres but for the opposite reason: where pgx
honours ctx cancellation and the adapter has to race it against an explicit
`pg_cancel_backend`, go-sql-driver's `database/sql` path does the opposite — cancelling the
`context.Context` passed to `QueryContext`/`ExecContext` closes the underlying connection outright
(`driver: bad connection` on the next statement), so `mysqlfamily` never passes the op's own
context to the driver at all, using `adapters.RunWithAbortRace` with a background context and an
explicit `KILL QUERY <threadId>` on a side connection instead
(`internal/adapters/mysqlfamily/query.go`). Two capability losses versus the Node adapter, both
inherent to `go-sql-driver/mysql` rather than fixable in the port: the query console's "N row(s)
affected" status text is gone (no `RowsAffected()` on the `QueryContext` path the console's
multi-statement runner needs; a generic "OK" is shown instead), and `allowPublicKeyRetrieval` has
no equivalent — the driver requests the server's RSA public key unconditionally over plaintext
when `caching_sha2_password` needs one and TLS is off, with no option to refuse that request.

### SQLite (P35; Go-native as of P58b M6.3)

**SQLite is Go-native as of P58b M6.3** (`apps/kira-studio/internal/adapters/sqlite/`, `modernc.org/sqlite`,
pure Go and cgo-free — the same driver that also backs the app's own storage, see Storage below) —
`nativeKinds["sqlite"]` is `true`. `caps.cancel` flips from the Node adapter's honest `false` to
an equally honest `true`: `node:sqlite` (a Node builtin, no native module, no build step, requiring
Bun 1.4+/Node 22.5+) had no `sqlite3_interrupt` and its whole API was synchronous, so a running
statement blocked the event loop and an abort could never be delivered while one ran; the Go port's
`modernc.org/sqlite` has a real `sqlite3_interrupt`, reached by cancelling an adapter-owned per-op
`context.Context` on that op's own dedicated `*sql.Conn` (one connection per op, not a pinned
shared one — unlike Postgres/MariaDB/MySQL, whose cancellation goes through a side connection
instead). Keyset pagination falls back through primary key → unique index → the table's own
implicit `rowid` (never surfaced as mutation identity) before degrading to `LIMIT/OFFSET`, unchanged
from the Node design.

**A real, previously-undocumented `modernc.org/sqlite` driver quirk**: unlike `node:sqlite`, this
driver's own `rows.Next()` unconditionally re-parses a `TEXT` value into a Go `time.Time` whenever
the column's declared type is `DATE`/`DATETIME`/`TIMESTAMP` and the stored text happens to parse as
a recognised time layout — with no DSN option to disable it. The adapter's own `readPage` (the data
grid path) routes around this by wrapping every selected column in
`CASE WHEN typeof(col) = 'text' THEN col || '' ELSE col END`, which defeats the coercion's own
trigger condition (SQLite reports no declared type for a `CASE` expression) while leaving every
other storage class (`NULL`/`INTEGER`/`REAL`/`BLOB`) untouched. The query console cannot apply the
same rewrite (it runs a user's own raw SQL text), so a console `SELECT` of such a column still hits
the coercion; that one path reformats the value to SQLite's own canonical
`strftime('%Y-%m-%d %H:%M:%f')` text rather than passing the original bytes through unmodified — a
narrow, documented capability trade, not a silent gap.

### ClickHouse (P36; Go-native as of P58b M6.4)

**ClickHouse is Go-native as of P58b M6.4** (`apps/kira-studio/internal/adapters/clickhouse/`, plain
`net/http`) — `nativeKinds["clickhouse"]` is `true`, the last of the five SQL-family kinds P58b set
out to migrate. Unlike every other adapter in this phase, the Go port carries **no driver
dependency at all**: no `@clickhouse/client` equivalent, no vendored client library — a hand-rolled
HTTP client that POSTs the statement text and reads ClickHouse's own
`JSONCompactStringsEachRowWithNamesAndTypes` wire format line by line (names row, types row, then
one JSON array of strings — or the `ᴺᵁᴸᴸ` sentinel — per data row). This works because ClickHouse's
own text-rendering already covers every exotic type (`Decimal128`, `UUID`, `Array`/`Tuple`/`Map`,
`Enum8`, big `UInt64`/`Int64` values) exactly the way the cell editor needs it, so there is nothing
a Go-side type system would add. The one cost of skipping a client library: its hidden defaults
have to be re-discovered and re-set explicitly. `output_format_json_quote_64bit_integers=1` is one
such setting — `@clickhouse/client`'s own `.json()` method sets it invisibly on every request;
without it, a plain `FORMAT JSON` catalog query (`total_rows`, `count()`, `system.columns.position`)
renders a UInt64/Int64 column as a bare JSON number rather than a quoted string, which is both a
precision loss past 2^53 and a decode failure for a Go struct field typed `string`. Every such
setting travels as a URL query parameter on every request (there is no persistent client-level
session over stateless HTTP), including `database=<db>` (no per-request database override exists
in ClickHouse's HTTP interface either way, so every statement is fully qualified with
`` `db`.`table` `` regardless of driver).

`canUpdate`/`canDelete` are permanently `false` (`caps.go`) — a MergeTree `PRIMARY KEY` is a sparse
index over parts, not a unique row key, so there is no addressable row to target for `UPDATE`/
`DELETE`. This is a structural fact about the engine, not "not yet implemented." The grid's `− row`
button and inline cell editing are both disabled for this connection kind for the same reason, with
a tooltip naming it. Cancellation goes through `KILL QUERY WHERE query_id = '<id>' SYNC` on a
second HTTP request (`net/http`'s own connection pool, sized to always have one free), since the
server keeps executing a query after the original socket closes.

### Kafka (Go-native as of P58e M9.3)

**Go-native as of P58e M9.3** (`apps/kira-studio/internal/adapters/kafka/`, `github.com/twmb/franz-go` +
`franz-go/pkg/kadm`) — `nativeKinds["kafka"]` is `true`, the **tenth and last** of ten kinds, and the
flip that records checkpoint C2 (the parent P58 plan's zero-traffic proof: a full manual pass across
all ten kinds, plus cancel/settings-save/cache-clear, left `adapterhost.Router.ChildRoutes()` at
zero — the Node engine child is spawned, idle, and answers no connection traffic at all). franz-go
replaces the old TypeScript driver's ABI-specific compiled binding (built against V8's C++ API — the
one engine Bun could never load at any ABI) with a pure-Go client: no compiled binding, no ABI, no
rebuild step, and no packaged-bundle native-module gap (`docs/PACKAGING.md` §6).

The adapter never joins a consumer group for a read-only browse — `kgo.ConsumePartitions` assigns
partitions directly at explicit start offsets (a construction-time option, so the browse client is
fresh and ephemeral per read, never the adapter's long-lived admin-and-produce client), never
`subscribe()`/`kgo.ConsumerGroup`. This is now **structural**, not merely configured: there is no
group-join call in the browse path at all, where the old driver's `group.id` was a
required-but-never-joined constant. End-of-log detection is a per-fetch `HighWatermark` comparison
(captured from the fetch that actually delivered the last record, never a follow-up peek poll) rather
than a `partition.eof` event, with a fixed-count empty-poll counter kept as a second, independent
terminator — the same clamp the old driver needed after a real regression (P43 iter2 F19/D26), now
without the native event that made it possible before.

Two capabilities the old driver's binding never exposed come back: a topic's Configuration section
now has real rows (`kadm.DescribeTopicConfigs`) instead of "not available: no `DescribeConfigs`
call", and `ConnectInfo.details.cluster` reports a real cluster id (`kadm.Metadata`). One row is
lost: the group definition's CLASSIC-vs-KIP-848 `type` row has no `kadm` source and is dropped;
`partitionAssignor` merges into a `protocol` row that already carries the same value. Idempotent
producing is franz-go's default and is explicitly disabled (`kgo.DisableIdempotentWrite()`) to match
the old driver's own default and avoid an `InitProducerId` hang on a single-broker cluster whose
transaction-log replication factor is Kafka's default of 3. The produce command-preview text was
re-rendered in P58f M10 (D6): it used to show the old `node-rdkafka` binding's
`producer.produce('<topic>', null, Buffer.from(...), '<key>')` call signature, which after M10 would
have been the last reference in the repo to an API that no longer exists in a user-visible string;
it now reads `ProduceSync <topic> key=<key>` (`key=<none>` when the key is null), matching the real
`kgo.ProduceSync` call the adapter makes (`produce.go`'s `previewProduce`).

Cancellation has no server-side kill at all — Kafka's protocol has none, the same shape as SQS and
S3 — so the op's own `context.Context` on every `kadm`/`kgo` call is the entire mechanism, with one
detail neither SQL adapter's port prepares a reader for: `kgo.Client.PollRecords` returns a
`Fetches`, not an error, and a cancelled context surfaces as an injected fake fetch carrying
`ctx.Err()` (`Fetches.Err()`), so the browse loop checks that explicitly rather than relying on a
returned error. `canDelete` is permanently `false` — a topic's log is immutable, so there is no
per-message delete or update at the protocol level, only retention/compaction.

### SQS (Go-native as of P58d M8.2)

**Go-native as of P58d M8.2** (`apps/kira-studio/internal/adapters/sqs/`, `aws-sdk-go-v2/service/sqs`) —
`nativeKinds["sqs"]` is `true`, the eighth of ten kinds P58 migrates. `caps.pagination = 'batch'` —
every poll is an independent, non-resumable `ReceiveMessage` call with no addressable position;
the stream view never auto-loads, only an explicit Poll button. `canDelete` is a real per-item
removal via the message's receipt handle (kept adapter-local, in-memory, never round-tripped over
the wire — a receipt handle is only valid for the message it names, on the session that received
it, and the Go port needs an explicit mutex plus a FIFO eviction queue where the JavaScript
original relied on single-threadedness and `Map` insertion order, neither of which survives
translation). No `canUpdate`: a delivered message can't be edited in place, only replaced by
delete + resend.

**Unlike every native adapter built before this sub-phase, neither SQS nor S3 has a server-side
kill mechanism at all.** Both adapters pass the op's own `context.Context` directly to every AWS
SDK call rather than through `adapters.RunWithAbortRace` (every other native adapter's shared
detached-context helper) — a cancelled context aborts an in-flight request through the SDK's own
plumbing, confirmed against a real LocalStack container (P58d M8.0's AWS-1(e)/AWS-3(e) probes).
Using the shared helper here would have let a cancelled operation keep running server-side after
the caller unblocked: a cancelled `ReceiveMessage` would still complete and hide messages via
`VisibilityTimeout`, and a cancelled `DownloadObject` would still be writing its temp file while
the caller's cleanup already ran.

The SQS `headers` cell is built by a hand-written encoder over `MessageAttributeValue`, never a
plain `json.Marshal` of the SDK struct — the latter emits every field (`BinaryValue`,
`StringListValues`, …) with an explicit `null` even when absent, which the JavaScript original's
`JSON.stringify(message.MessageAttributes ?? {})` never produced. The profile-resolution error also
changed observably: a nonexistent named AWS profile now fails **at connect time**
(`config.LoadDefaultConfig` returns `config.SharedConfigProfileNotExistError` directly) rather than
at first use, which is a gain the Test button reports sooner.

### S3 (Go-native as of P58d M8.3)

**Go-native as of P58d M8.3** (`apps/kira-studio/internal/adapters/s3/`, `aws-sdk-go-v2/service/s3`) —
`nativeKinds["s3"]` is `true`, reaching **nine of ten** native kinds — Kafka went native next, in
P58e, reaching ten of ten (see the Kafka section above).
The only engine with `caps.fileTransfer` — items are whole files, streamed to/from a local path via
a native OS dialog (`downloadObject`), not a value the mutation-preview model can show inline.
`fileTransfer` is orthogonal to the three write flags: Download reads regardless of a connection's
read-only flag; Upload is gated on `fileTransfer && canInsert` together.

`caps.keyBrowser = true` (P41): a bucket's prefix/object space has no fixed size and can nest
arbitrarily deep, so `s3/catalog.go`'s `bucket` node is `hasChildren: false` — the tree stops at the
bucket, and `/`-delimited prefix/object navigation happens in a Browse tab instead
(SPEC.md §8.18). Object node paths still carry the *full* bucket-relative key on their own
`object` segment, nested under every ancestor `prefix` segment (`catalog.go`'s `listPrefixChildren`
— `bucket:b/prefix:reports/object:reports%2Fnote.txt`, not a bare local filename), the same
convention the tree used before this phase and unrelated to it.

`DownloadObject` is the phase's first and only real file transfer: it writes to a sibling
`.kira-partial-<uuid>` temp file and renames on success, unlinking on any failure or cancellation.
This is only safe because the copy runs on the caller's own goroutine — the op's own context goes
directly into `io.Copy` via the SDK call (the same no-detached-context rule SQS follows), so a
cancelled download's cleanup never races a writer that `RunWithAbortRace` would have left running
in the background. `PutObject`'s insert path matches a collision check structurally on
`*types.NotFound` rather than on a mapped error code — a narrowing from the original TypeScript,
which treated any query-level error as "probably not found, proceed." S3 object metadata keys come
back **lowercased** from `HeadObject`/`GetObject` regardless of the case they were sent in (a real
S3/LocalStack behavior for `x-amz-meta-*` headers, confirmed against a live container) — not a
casing bug in the adapter.

**RabbitMQ was dropped from v1's scope** (P58 findings) before it was ever ported to Go — it was
Node-served-only via an HTTP-management-API adapter with no AMQP client, and rather than carry it
through the native-adapter migration it was cut. `connectionKindSchema`/`nodeKindSchema` no longer
carry `rabbitmq`/`exchange`; there is no successor section here.

### MongoDB / Redis (P9/P41; Go-native as of P58c M7.3/M7.4)

**Both are Go-native as of P58c** (`apps/kira-studio/internal/adapters/mongo/` and `.../redis/`) —
`nativeKinds["mongodb"]` and `nativeKinds["redis"]` are both `true`, the sixth and seventh of ten
kinds P58 migrates. MongoDB: document-shaped, `_id` keyset pagination falling back to
`skip`/`limit`, cancellation via `$currentOp` + `killOp` on the *same* client the adapter already
holds (never a side connection — `$currentOp`'s default `allUsers: false` only matches the polling
connection's own authenticated user). Redis: key/value-shaped, `SCAN`-cursor pagination (never
`KEYS`), exact per-key counts via O(1) type-length commands, and — unlike every other adapter —
`Cancel` is a permanent, honest `false`: go-redis's blocking commands override the caller's context
for the wait itself, so `CheckCancelled` between bounded `SCAN`-family rounds is the entire
cancellation surface (`caps.cancel` stays `true` regardless, since that surface is genuinely
effective).

`mongo/literal.go` — the JSON5-lite tokenizer/BSON-constructor parser every Mongo filter/document/
console surface runs through — was written and unit-tested alone first (P58 D11), with no driver
and no container, before the rest of the package. One structural requirement threads through the
whole package: `IDText` (a document's `_id`, rendered as canonical extended JSON text for a page's
`ids` column, *Copy `_id`*, and a page token) and `literal.go`'s own parser must form a closed loop
— whatever `IDText` emits, the parser must accept back, through two different real paths
(`mutate.go`'s `parseIdKey`, which treats it as a bare value, and a filter box, which wraps it as
`{_id: ...}`). `bson.MarshalExtJSON`/`UnmarshalExtJSON` share a real gotcha this closure exposed
twice: neither can encode or decode a bare scalar at the top level, only a document — both
directions need a value wrapped in a one-field document first.

Redis is the other `caps.keyBrowser = true` engine (P41, alongside S3): a db index's own key
namespace is unbounded, so `redis/catalog.go`'s `database` node is `hasChildren: false` and the
`:`-split namespace/key navigation that used to expand inline in the tree happens in a Browse tab
instead (SPEC.md §8.18) — `SCAN`'s own cursor/count-budget discipline is unchanged, only where the
result is shown moved. Redis's `DbConnectionSet` is a `mysql-family`-style LRU (an 8-entry cap,
keyed by db index rather than by database name), with go-redis's `Protocol: 2` pinned explicitly —
its RESP3 default changes reply shapes for `HGETALL`/`CONFIG GET` and the console's own generic
dispatch, from a flat array to a map.

## Storage

`~/.kira-studio/` (dir `0700`), containing `kira.sqlite` (`0600`) and `logs/`.

Credentials in the `connections` table's `password` column are **encrypted at rest** (P25), now from
Go rather than through Electron's `safeStorage`. The design `safeStorage` used is kept deliberately,
because it is the right one: one **single symmetric key** lives in the OS keychain and every value
is encrypted with it, with the ciphertext in the app's own database — one keychain item means one
authorization decision rather than a prompt per connection, item-count and item-size limits become
irrelevant, and `SecretStore.copy()` stays a raw column copy that never needs the OS key at all.

The key is 32 random bytes held as one generic-password item via `github.com/keybase/go-keychain`
(service `Kira Studio Secrets`, account `Kira Studio`), and values are sealed with
**AES-256-GCM** under a `kira:v2:<base64>` envelope. Two item attributes are load-bearing:
`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, so the key is never restorable from a backup onto
another machine, and non-synchronizable, so it never reaches iCloud Keychain. `secrets/keyring_darwin.go`
is the only file in the repo that touches the keychain library; `secrets/cipher.go` is the only
file that encrypts or decrypts, so a future re-key or a real cross-platform secret store stays a
contained change. The service name was `Kira Studio Safe Storage` through P52-P57 (P57 D12 kept it
stable across the Electron-to-Wails rename specifically so existing users' stored keys weren't
orphaned) but is now `Kira Studio Secrets`: "Safe Storage" is Chromium/Electron's own naming
convention for this kind of item, and this app has had no Electron/Chromium in it since P57 — so the
name was actively misleading about what created it. The app has not shipped, so there is no
installed base to orphan; the OS looks the item up by service name, not by bundle identifier, so
**this is the last time the name can change for free** — once real users exist, a rename needs a
migration (read the old service name once, re-write under the new one, then stop looking).

Two things changed with the cipher, and both are deliberate. The envelope bumped **`kira:v1:` →
`kira:v2:`** because the cipher genuinely changed (AES-256-GCM under our own key, against Chromium's
AES-128-CBC under `safeStorage`'s) — reusing the v1 prefix would hand a v1 value to a v2 decrypt and
fail confusingly. And the **pre-P25 plaintext passthrough is dropped**: `Decrypt` of a non-enveloped
value now returns an `E_SECRET_STORE` error naming the problem instead of returning it verbatim.
`upgradeLegacySecrets` was deleted rather than ported for the same reason — it only ever upgraded
rows written before P25. AES-GCM's authentication tag is a real gain over the old design: a tampered
or truncated ciphertext fails to authenticate rather than decrypting to garbage, and the existing
user-facing decrypt-failure message ("may have been written on a different machine or after a
keychain reset — re-enter it to fix this connection") is already correct for that case and is kept
verbatim.

The connection dialog's credential note reflects the platform's actual backend rather than a fixed
warning; the probed `{available, backend, insecureFallback, reason}` status is resolved once at
startup and never changes for the life of the process. Linux — development/CI only, v1 targets macOS
only — has no real keychain support: behind an explicit `KIRA_INSECURE_SECRETS=1` env var it falls
back to obfuscation under a hardcoded compile-time key (the same threat model and the same honesty
as Chromium's `basic_text`, whose backend name is kept); without it, secret storage is unavailable
and a write carrying a password is refused rather than silently stored in the clear.

Decrypting a stored credential for **display** — the connection edit dialog's password field —
is gated separately from every other use of it (P14): pressing *Show password* is what triggers
the reveal, not opening the dialog, and the backend (`internal/localauth`) confirms the device
owner before it will decrypt, via macOS's own `LAContext.evaluatePolicy(.deviceOwnerAuthentication)`
(Touch ID with the account password as its own fallback). A successful confirmation grants a
5-minute, process-wide, non-persisted grace window, so re-opening the same or a different
connection's edit dialog shortly after doesn't re-prompt — but each window still requires its own
explicit *Show password* press (§ below). Where OS authentication genuinely isn't available (Linux,
a Mac with neither biometry nor a login password), the app falls back to its existing in-app
`confirmDialog()` instead, which grants that one reveal without recording a grace. `Connect`,
`Test`, and `Duplicate` all continue to use the stored secret unprompted, exactly as before — this
gate is about turning a secret into visible text, not about using it.

```
schema_version(version)
settings(key, value)                                   -- fonts, sizes, budgets, toggles
connections(id, name, kind, color, mode, read_only, host, port, database, username, password,
            uri, options_json, preconnect, preconnect_sidecar, auto_explain, throttle_per_sec,
            created_at, updated_at, sort_order)
connection_filters(id, connection_id, node_kind, pattern, is_regex, action)  -- hide/show rules
connection_ddl(connection_id, ddl, updated_at)          -- pasted DDL for the SQL language service
saved_queries(id, connection_id, path, name, kind, body, pinned, created_at, used_at)
                                                       -- saved filters/queries per table + console
filter_history(id, connection_id, path, where_text, order_by_json, used_at)
                                                       -- history list of past filters/sorts
metadata_cache(connection_id, path, kind, payload_json, fetched_at, etag)
op_log(id, connection_id, tab_id, started_at, duration_ms, kind, status, rows,
       command, error)                                  -- rotated, capped
ui_layout(key, value)                                   -- panel sizes, visibility (app-wide)
windows(key, order, bounds_json)                        -- one row per workbench (P8)
tabs(id, connection_id, path, kind, state_json, order, active, window_key)  -- session restore,
                                                       -- window_key ON DELETE CASCADE into windows
http_collections(id, name, sort_order, origin_json, created_at, updated_at)  -- P4
http_items(id, collection_id, parent_id, kind, name, sort_order, method, url,
           request_json, origin_json, created_at, updated_at)
                                                       -- the folder/request tree; parent_id and
                                                       -- collection_id both ON DELETE CASCADE
```

Migrations are forward-only numbered SQL files (`apps/kira-studio/internal/storage/migrations/`) applied on
startup. Table access is hand-written `database/sql` in `apps/kira-studio/internal/storage/repos/` — there is
no ORM; the Drizzle dependency went out with the Electron shell. Every row read back out of
`settings`, `ui_layout` and `connections` is decoded through the model types in
`apps/kira-studio/internal/storage/model/` before use, so a hand-edited or stale-shape row fails loudly
instead of propagating zero values into the UI.

**Collections are stored, not filed (P4).** A Postman collection lives in `kira.sqlite` as a
normalized `http_collections`/`http_items` tree, not as a `.json` file on disk that the app edits
in place. `item` is an *ordered array* in the format, so `sort_order` is data rather than
presentation, and it is rewritten dense within a parent on any insert or delete — the same
discipline `TabsRepo.Save` applies to `tabs."order"`. `http_items.parent_id` is a self-reference
with `ON DELETE CASCADE`, which is genuinely enforced because `db.go`'s DSN sets `_foreign_keys=1`
on every connection the pool opens: deleting a folder deletes its subtree at any depth in one
statement, with no recursive delete in Go.

**`origin_json` is what makes Postman fidelity real.** Each row also stores **the original Postman
object verbatim**, minus only its recursive `item` array. This exists because fidelity here is a
*retention* problem, not a parsing one: `encoding/json` drops every member a struct does not
declare, so no typed model — library or hand-written — can round-trip the members this app does not
model, and those members are most of a real collection once you get past the requests themselves
(`auth` at three levels, `event[]` scripts, `variable[]` at four, saved `response[]` examples,
`protocolProfileBehavior`, `request.proxy`/`certificate`, and the per-row `description` on headers,
query params, urlencoded fields and form-data fields). Export therefore starts from `origin_json`
and rewrites exactly three members — `url`, `header`, `body` — and only when re-running the
importer over the origin's own member no longer yields what is stored; `method` is always written
from `request_json`, and every other member is re-emitted byte-identically. `CollectionsRepo.SaveRequest`
performs the same comparison and *sheds* each rewritten member from `origin_json`, so an edited
request stops carrying a stale duplicate of its own body. The one thing not preserved is member
order within a JSON object, since `map[string]json.RawMessage` re-marshals sorted — not semantic in
JSON, and not something Postman's own exporter guarantees either. Scripts, auth and variables are
preserved **inert**: never executed, never applied, never resolved. The honest consequence, which
the import report states out loud, is that a request relying on collection-level Bearer auth will
401 when sent from this app until the phase that builds an auth surface lands.

**A known, deliberate orphan.** `settings` stores leaves by key, and an existing installation may
carry an `advanced.engineMemoryCapMb` row from before P58f M10 removed the setting end to end
(D18, with it the `--max-old-space-size` flag it fed) — there is no migration to delete it, since a
schema-version bump for one inert leaf row was judged not worth the migration-ordering risk. Nothing
reads that key any more; the row is harmless and is recorded here so nobody rediscovers it later
wondering what still consumes it. The same judgement applies to `ui_layout`'s own `window.bounds`
leaf: P8's `0002_p8_windows.sql` seeds the first `windows` row from it and then leaves the
now-inert leaf row in place rather than deleting it.

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

**A fourth, renderer-side tier, deliberately unbudgeted (P5).** The three tiers above are all
Go-side and byte-budgeted (L2's own `> budget/2` refusal rule). The renderer keeps its own copy —
five page stores (`views/shared/page/store.ts`, one per page kind, §"UI architecture" below) each
holding one loaded page per open tab, plus `views/shared/document/rows.ts`'s parsed-tree cache for
document bodies — released on tab close, and now (P5 C3) pruned to the rendered window as a tab
scrolls, in all five stores rather than the two (grid, console) that had it before. It has **no
byte budget of any kind**, which is a deliberate consequence of an earlier decision (`docs/PERF.md`
§2.2's lever L-B: evicting a cold tab's page was declined twice, on the stated trade of RAM for the
≤ 50 ms cached-tab-switch interaction budget) — not an oversight P5 left unfixed. Ten tabs of large
pages is real, uncapped renderer memory; `docs/v1.1/plans/P5-ram-usage.md` §8 OQ-2 hands the actual
follow-up (surfacing this figure next to the status bar's own cache size, not eviction) to P7.

## UI architecture

Distilled facts about how the workbench is put together — not a restatement of `docs/v1/SPEC.md`
§8's per-dialog field lists or its mockup-vs-shipped narrative, which stay where they are as the
phase-by-phase record. This is the structural rules a future session needs to not reinvent.

**A view is chosen by page kind, never by database type.** `Page` is a discriminated union
(`TabularPage`, `DocumentPage`, `KeyValuePage`, `StreamPage`); the UI reads the page's own `kind`
to decide grid vs. document view vs. key/value view vs. stream view. This is why a Postgres
`jsonb` column can open in the document view and a Mongo `$group` result can open in the grid —
the mapping is page-shape → view, not engine → view.

**Tab identity is the tab's `id`, never its `path`.** A tab is `{ id, connectionId, path, kind,
state }`; the same table/collection/key can be open in any number of tabs at once, each with fully
independent paging, projection, sort, filter and scroll state. Every tab kind — `data`,
`definition`, `document`, `keyvalue`, `stream`, `console`, `browse` — follows this rule, including
Browse (below), where `state.levelPath` is the one piece of Browse-specific state layered on top
of the same identity.

**A tab's mode is a function of its kind; switching modes writes nothing.** P1 introduced a
second top-level mode alongside Studio (**Http**, still empty as of P1 — no request builder, no
collections, nothing protocol-specific has landed yet), and the seam is deliberately the smallest
thing that works: `TAB_KIND_MODE` (`packages/shared/domain/tabs.ts`) is a total, hand-maintained
map from `TabKind` to `AppMode`, so there is no `mode` column, no migration and no Go change — a
tab's mode is derived, never stored, the same shape the "page kind, never database type" rule
above already uses. `state/mode.ts`'s `modeState` is a plain selection (`setMode`); `tabsState`
(`state/tabs.ts`) keeps one active tab **per mode** (`activeIdByMode: Record<AppMode, string |
null>`, not a single app-wide id), and `activateTab`/`closeTab`/`closeOthers`/`closeToTheRight`/
`closeAll`/`stepTab` are all scoped to the current mode's own slice of the one shared `tabs` array.
Switching mode touches no `TabRecord`, schedules no save and issues no IPC — the two modes cannot
drift, cannot double-persist into each other, and (per-window `tabs.window_key` scoping,
unaffected) cannot leak tabs across a window.

**The left panel is a shell with pluggable content; the tree host is a separate, mode-agnostic
primitive.** `workbench/panels/LeftPanel.vue` owns the header geometry, the search reveal/toggle
and the VS-Code-style type-ahead redirect — the same panel shell both `ProjectPanel.vue` (Studio)
and `http/CollectionsPanel.vue` (Http) mount into via its `#title`/`#actions`/`#body`/`#empty`
slots, so a second left panel was never added (there are still exactly three layout panels).
Separately, `theme/primitives/TreeHost.vue` is the virtualized-tree mechanics factored out of
`ProjectTree.vue` — `VirtualList` wiring, the pinned-ancestor sticky band
(`theme/primitives/stickyBand.ts`), reveal-scroll with band inset — generic over any row shape
with `depth`/`hasChildren`/`expanded`/`key`. `ProjectTree.vue` still owns every Studio-specific
behaviour (the connection-driven row model, the five openable-kind dispatch, context menus,
keyboard shortcuts) unchanged. **P4's `http/CollectionsTree.vue` is that primitive's second
consumer**, and it landed with no change to `TreeHost.vue`, `VirtualList.vue` or `stickyBand.ts` at
all — the props, the `#row` slot, `revealKey` and the background-contextmenu emit were exactly what
a second tree needed, which is the check the factoring was meant to pass. It mounts `TreeHost` over
its **own** row model, not a shared one: `CollectionRowVm` is four structural members plus seven of
its own against `TreeRowVm`'s fourteen, because `connectionId`, `color`, `status`, `statusDetail`,
`groupKind`, `badges`, `loading` and `error` mean nothing here. `http/CollectionRow.vue` is
likewise its own row rather than a widened `project/TreeRow.vue` — partly because `http/**` may not
import `project/**` at all, and partly because the differences are the point (no connection rail,
no status dot, no `EngineIcon`; a leading method chip; an inline rename input). The two modes'
tree *rows* have nothing in common, only how rows are virtualized and pinned.

The stores differ for a reason worth stating: Studio's tree is lazy because its data is remote —
expanding a node connects a connection and issues an IPC call, which is what its children cache,
loading set, search debounce and "searching cached nodes only" caveat all exist for. A collections
tree has none of that, because the whole tree is rows in a local SQLite table listable in one call,
so its `visibleRows` is a pure `computed` over one array with no cache, no loading set and nothing
to be incomplete about. While a search is active every ancestor of a match renders expanded
**without mutating the expansion set**, so clearing the search restores exactly the shape the user
had.

**The tab strip and content area are registry-driven, not a per-kind dispatch chain.**
`state/tabKinds.ts`'s `TAB_KINDS` (component-free) supplies each `TabKind`'s title/icon/rail
colour/default-and-duplicate state/page-store cleanup/context-menu extras;
`workbench/tabViews.ts`'s `TAB_VIEWS` (statically imported, so the bundle's two dynamic chunks
above are unaffected) supplies the view component. `MainView.vue` is one
`<component :is="TAB_VIEWS[activeTab.kind]">` plus a mode-registry (`workbench/modes.ts`) fallback
when the mode has no active tab, replacing what used to be a nine-branch `v-if`/`v-else-if` chain;
`TabStrip.vue` reads the same `TAB_KINDS` registry for its icon/title/rail/context-menu instead of
branching on `tab.kind` itself, and no longer imports `project/state/tree` at all. Adding a tab
kind means one registry entry each in `state/tabKinds.ts` and `workbench/tabViews.ts`, not editing
a dispatch chain in three files — `'http-request'` (P2) is the first kind to actually exercise
that promise, and the first Http-mode kind at all: `TAB_KIND_MODE['http-request']` is `'http'`,
every other entry is `'studio'`. It costs a fourth vocabulary Go's `model.RenderableTabKinds` has
to carry too (no compiler catches a miss there — `tests/unit/go-ts-vocabulary-parity.spec.ts`
does). Every Studio kind's `path` addresses a real target the tab is a *view* onto; an HTTP
request has none — its state **is** the request — so its `path` is the literal constant
`'request'`: non-empty (`model.TabRecord.Validate` requires one), carrying no false uniqueness,
and never reused for identity (a tab's identity is always its `id`, never its `path`, restated
above). Duplicating an HTTP request tab therefore copies the source's own request state rather
than starting fresh, the one kind where "same target, fresh default state" does not apply.

**A saved collection request opens that same `'http-request'` kind — P4 added no tab kind (and no
op kind).** Its state is sourced from an `http_items` row instead of `defaultHttpRequestTabState()`,
and the binding lives in the state as `itemId`, *not* in `path`, which stays the literal constant
above. That placement is forced rather than aesthetic: `duplicateTab` copies `path` verbatim while
`duplicateState` clears `itemId`, so a `collection:<id>/request:<id>` path would leave a duplicated
tab carrying the saved request's *path identity* alongside a state saying it is unsaved — and
`openTab`'s reuse lookup, keyed on kind + connectionId + path, would then activate the **duplicate**
when the user opened the original from the tree. Keeping identity in exactly one place and doing
the reuse lookup explicitly (`openCollectionRequestTab`) is four lines with no such failure mode.
A second state field, `name`, keeps `httpRequestTitle` pure: without it a request saved as
"Create order" would render as `/v2/orders` in both the strip and the header. Deleting a row does
**not** close tabs bound to it — a tab is an editing surface with its own persisted state, and
closing one because a tree row went away would lose work; the tab simply reads as unsaved, and
Save falls back to Save as…

**A restored tab's state is normalized through its own kind's schema — merge-only, every kind,
since P3.** `TabKindDef` (`state/tabKinds.ts`) carries a ninth member, `parseState(raw)`, a
one-liner per kind (`safeParse` against that kind's own Zod schema, `null` on failure); `hydrateTabs`
(`state/tabs.ts`) maps every record `tabsList()` returns through its own kind's `parseState` and
keeps the parsed result **only on success**, the stored record unchanged otherwise. This is what
makes every `*TabStateSchema`'s own `.default()` comment actually true: before P3, nothing in the
restore path ever called `.parse`/`.safeParse` at all (`repos/tabs.go`'s Go side validates only the
envelope — ID/path/kind/object-ness — deliberately leaving per-kind shape "renderer-side"), so a
tab saved with a field missing restored with that property `undefined` rather than defaulted, and a
stale enum value restored as-is. Merge-only is the load-bearing property: a successful parse can
only *add* a missing field's default, never drop or reset one, so this is safe to have landed
underneath a state-widening phase (P3's own body-mode schema, six new fields) rather than needing
its own migration story. `tabsSave` still writes `tabsState.tabs` straight back, so a parse also
drops any key no schema recognizes — deliberate, not lossy in a way that matters, since a garbage
key had no reader to begin with.

**An HTTP request body is one of five modes; there is no GraphQL mode.** `packages/shared/domain/
http.ts`'s `httpBodyModeSchema` — `'none' | 'raw' | 'code' | 'urlencoded' | 'formdata' | 'file'` —
started life (P3) as Postman's own Collection v2.1 `body.mode` enum verbatim (six modes, `raw`
carrying a `rawLanguage` sub-selector across Text/JavaScript/JSON/HTML/XML), on the theory that a
later Postman import/export phase would need to round-trip that exact vocabulary. A later product
decision dropped GraphQL entirely (not deprecated — deleted: no query/variables state, no GraphQL
`StreamLanguage`, no server-side envelope builder) and split `raw`'s sub-selector in two: `raw` is
now plain text only, and JavaScript/JSON/HTML/XML became their own top-level `code` mode with its
own `codeLanguage` field. **This means the mode vocabulary no longer maps 1:1 onto Postman's own
`body.mode`** — Postman still has one `raw` mode with a `language` sub-field covering all five,
this app now has two separate modes and no `graphql` mode at all. **P4 built that translation**, in
`apps/kira-studio/internal/postman/body.go`, and it resolves as follows. On import: a Postman `raw`
body whose `options.raw.language` is absent or `"text"` becomes `raw`; one of the four known
languages becomes `code` with that `codeLanguage`; an *unrecognised* language degrades to plain
`raw` rather than failing, since `options` is untyped in the published schema and the original
language survives in `origin_json` for an unedited export to restore. On export the reverse, with
`language: "text"` written explicitly for `raw` rather than omitted, so a Postman import shows the
Text sub-selector instead of relying on a default this app does not control.

**A Postman `graphql` body imports as `code`·`json`, carrying the GraphQL-over-HTTP envelope**
(`{"query": …, "variables": …, "operationName": …}`) — byte-for-byte what this app's own serializer
built before GraphQL was removed. Refusing the file, skipping the item and importing as `none` were
all considered and declined: the point of importing a request is that it stays runnable, and the
other three produce a request that silently does nothing. While the body is untouched the round
trip is lossless (the export re-emits `mode: "graphql"` verbatim), and **the moment the user edits
it, it stops being a GraphQL body** and exports as `raw` + `language: "json"` — an app with no
GraphQL mode cannot honestly claim to have edited a GraphQL body. The import report says so.

**Two lossiness boundaries, stated rather than hidden.** A collection this app created, and a
collection imported from real Postman and re-exported *untouched*, both round-trip losslessly
(modulo object member order). A collection imported from real Postman, **edited**, and re-exported
does not, and cannot: the edited member is rebuilt in this app's canonical form, which drops what
this app does not model *about that member* — a query param's `description` and its `disabled` flag
when the URL changed, a header's `description` when the header list changed, a form-data row's
`description` when the body changed, and a `graphql` body's identity as above. A Go/TS parity test
(`tests/unit/go-ts-vocabulary-parity.spec.ts`, reading `internal/httpclient/body.go`'s
`validBodyModes` as plain text) guards the two languages' mode and Content-Type vocabularies from
drifting apart, and a third pair added by P4 does the same for `internal/postman/body.go`'s
`postmanCodeLanguages` against `CODE_LANGUAGES` — without it, a fifth language added on the
TypeScript side would make the importer silently treat that language's bodies as plain `raw` and
the exporter silently stop emitting it, with nothing failing anywhere. The builder's own labels: `formdata` reads **form-data**, `urlencoded` reads
**x-www-form-urlencoded**, `file` — "one local file, sent as the request's entire body" — reads
**binary**, and `code` reads **Code**. `Content-Type` is a **default Go applies only when the
request carries none of its own** (`text/plain` for raw, the `code` language's Content-Type,
`application/x-www-form-urlencoded`, a generated `multipart/form-data; boundary=…`, and explicitly
*no* header at all for a binary body, matching Postman's own documented behaviour for that one) —
a hand-set `Content-Type` header always wins, including the one edge case that needs an assist: a
user-typed bare `multipart/form-data` with no boundary gets Go's generated boundary appended,
since the boundary is unknowable to the user and the header and the body must agree.

**P2's legacy `bodyMode: 'json'` alias still restores correctly** — `httpRequestTabStateSchema`
preprocesses that one legacy shape into `bodyMode: 'code'`, `codeLanguage: 'json'`, moving the
saved text from the old `body` field into `code`'s own buffer rather than merely renaming the mode
value, since `raw` and `code` are now separate buffers and a value-only rename would strand the
legacy text where the (now plain-text) `raw` mode would never render it.

**A file's bytes reach Go by path, never through the renderer or the control plane (P3).** The
native file dialog (`FilesService.ChooseOpen`, shared with S3's own upload dialog) returns
`{path, name, size}`; only `path` — a short string — rides the send args for a form-data file row
or a binary body, and Go re-`os.Stat`s and streams it directly from disk. See the Process model
section below for the control-plane arithmetic this is built against.

**Response headers are shown alphabetised, not in received order — a known property of
`net/http`, not a bug.** Go's `http.Response.Header` is a `map[string][]string` with
`textproto.CanonicalMIMEHeaderKey` already applied by the transport; there is no stdlib access to
the bytes as actually received, so `internal/httpclient` cannot recover either the original casing
or the original order even if it wanted to. `Response.Headers` is instead a deterministic
substitute — `[]Header{Name, Value}` sorted by name, one entry per value so a duplicate header
(e.g. multiple `Set-Cookie`s) still survives — documented on the struct itself. A byte-level raw
inspector, the phase that could recover the wire bytes directly (P7), is the one that can lift this
if it ever matters.

**Session restore never auto-reconnects.** On relaunch, previous tabs reopen but their connections
are not. A restored tab renders a centred **Reconnect & load** button (`ReconnectGate`) and
nothing else until it is pressed — the same gate every view kind uses for this state, including
Browse tabs.

**The write model is staged for SQL tables, immediate everywhere else.** PostgreSQL/MariaDB/
MySQL/SQLite table writes (add row, delete row, cell edit) accumulate in a per-tab pending-change
set — nothing reaches the database until *Commit*, and *Preview command* renders the exact
statements first. ClickHouse tables get add-row only, staged the same way (no addressable row to
update/delete — a MergeTree `PRIMARY KEY` is a sparse index). MongoDB/Redis/Kafka/SQS/S3 write
**immediately**, gated per adapter's `canInsert`/`canUpdate`/`canDelete` capability, with no
staging or preview — there is no pending-change set to opt into for these engines at all.
**The fake-data generator (P15) is a third, staging-free caller of that same `data.mutate` op** —
its own per-column recipe plans build `MutationRowOp[]` batches directly, the way
`views/shared/immediateMutation.ts` already does, rather than going through the pending-change set:
that store renders one un-virtualized DOM row per staged insert, which is fine for a hand-clicked
row and wrong for a generator that can be asked for thousands.

**The cell editor is a panel mounted by whichever view owns the tab**, not a global singleton —
grid, documents, key/value, stream and console each mount their own instance, appearing only while
their tab has a selected cell and disappearing the instant it doesn't (including across a tab
switch). A view kind that never shows one (a definition tab) simply never mounts it — there is no
central registry or visibility flag to keep in sync.

**Browse panel: one level per screen, never a recursive tree.** Redis (a db index's key
namespace) and S3 (a bucket's prefix/object space) are unbounded and arbitrarily nested, so their
project-tree node is a leaf and a dedicated `browse` tab is the only place either is actually
navigated, one lazy level at a time over the same `SCAN`/`ListObjectsV2` calls the tree would
otherwise have made inline. The toolbar's **Up** button and a breadcrumb are the only ways to move
between levels; there is no expand/collapse and no level is ever rendered nested under another.

**Find/search and chunked scanning are shared machinery, not four reimplementations.** The grid,
document, key/value and console-result views all call the same `createPageSearch` factory and the
same `runChunkedScan` scanner (`views/shared/page/`) rather than each view owning its own find
logic — one animation-frame-driven scan loop, one match-list/highlight model, one filter-toggle
behavior, reused across all four call sites. A scan can carry an optional priority window (the
rows currently on screen, reported by each view's own virtualization bounds) scanned first, so a
find on a large loaded dataset highlights what's visible before continuing the ascending pass over
the rest in the background.

**Every `ViewChrome` consumer looks the same because it mounts the same primitives, not because
each view re-derives the look.** P48 closed the SQL grid's own last holdout — `DataView.vue` now
mounts `<ViewChrome>` exactly like documents/keyvalue/stream/console/definition, its badges and PK
chip in `#badges`/`#head-trailing`, `DataToolbar`/`FilterToolbar` in `#toolbar`/`#toolbar-2` — so
every data-view kind now shares one toolbar-mounting shape, not six independently-styled ones. The
per-tab runtime store (`createRuntimeStore`) owns `setActionError`/`toggleSearchOpen`/
`setSearchOpen` rather than each view re-implementing them; `views/shared/viewOp.ts`'s `beginOp`/
`applyLoadFailure` are the one load-op preamble and load-failure tail behind every view's own
`load()` except Browse (which supersedes by `loadSeq`, not `opId`, and has no `E_CANCELLED`
branch — a genuinely different shape, not a missed adoption); `views/shared/page/store.ts` is the
one two-level page-cache implementation behind all five page modules (grid, documents, keyvalue,
stream, console), and (P5 C3) its visible-window pruning is now wired into the view side of all
five, not just grid's and console's — documents also prunes `views/shared/document/rows.ts`'s own
parsed-tree cache to the same window; `views/shared/immediateMutation.ts` is the one write body behind documents/
keyvalue/stream's ten immediate-mutation functions; `views/shared/page/Pager.vue` is the one pager
behind both the SQL grid and the document list (previously two independently-maintained
prev/next/count implementations); `views/shared/document/DocumentRow.vue` is the one Mongo
document-row component behind both the document view's editable row and the console's read-only
copy of it; and `views/shared/page/columns.ts`'s `columnHeaderTooltip`/`GUTTER_WIDTH`/
`DEFAULT_COLUMN_WIDTH` are the one column-header tooltip and the one pair of layout constants
behind the grid and the console's own tabular result, ending three different spellings of the same
two numbers the two had drifted into.

**The SQL console's language service is DDL-driven, never introspective.** P18 (v1.1)'s
completion/diagnostics/hover providers (`views/console/sqlLanguageService.ts`,
`sqlDiagnostics.ts`, `sqlHover.ts`) read only a per-connection `DdlSchema` parsed from a user-pasted
DDL document (`connection_ddl`, below) via `@codemirror/lang-sql`'s own per-dialect Lezer parser —
no schema introspection over a live connection, ever, even though the renderer already has live
column metadata in reach (`runtime[tabId].meta`, the WHERE/ORDER BY boxes' own completion source).
With no DDL document, a SQL console is byte-for-byte what it was before this phase.

**EXPLAIN crosses the wire as an ordinary result page, never a new op.** P18 (v1.1)'s Explain
button and auto-explain toggle (`connections.auto_explain`, below) both compose a dialect's own
EXPLAIN statement text in the renderer (`views/console/explain.ts`) and issue it through the
console's existing `data:execute` op — the same call *Run statement* makes. Every dialect's
structured EXPLAIN already comes back as an ordinary `TabularPage` (Postgres/MySQL/MariaDB one row
of JSON text, SQLite N rows of `(id, parent, notused, detail)`, ClickHouse a JSON-plan page plus a
second `EXPLAIN ESTIMATE` page in the same call), so this needed no new `Adapter` method, no `Caps`
field, and no `wire.fbs` change. `views/console/planParsers/*.ts` normalizes each dialect's own
shape into one `QueryPlan` tree (`planModel.ts`); the "expensive query" threshold
(`advanced.expensiveQueryRows`) is an **estimated-rows-read** number, never a cost unit — two of
the five dialects report no cost at all, and the two that share the field name `cost` (MySQL,
MariaDB) disagree by three orders of magnitude for a comparable scan. `EXPLAIN ANALYZE` (or any
dialect's equivalent) is never issued anywhere in this phase: it executes the statement, which is
exactly the cost auto-explain must not pay — plain `EXPLAIN` is roughly three orders of magnitude
cheaper, measured against a real Postgres server.

**Settings are staged in a per-dialog draft, committed as one patch on Save.** P18's predecessor
model had every control in the Settings dialog call `patchSettings()` from its own `@change`
handler, writing to the app-wide store, the SQLite `settings` table and an app-wide `Emit`
broadcast in one go per keystroke; P17 replaced that with a local draft edited freely and applied
only on Save. `SettingsDialog.vue` is still the only caller of `patchSettings` in the tree. The
app-wide side of the line is unchanged: settings remain **app-wide** in the per-window/app-wide
split above, so a Save still broadcasts to every window.

**Reverting a setting is per-leaf, not all-or-nothing.** P28 replaced the dialog's single
*Revert to Defaults* footer button (which staged every section back to
`model.DefaultSettings()` at once, discarding every other customization along with the one the
user actually wanted to undo) with a small `IconButton icon="discard"` beside each of the nine
editable leaves, disabled once the draft already equals that leaf's own default. Two generic
`isAtDefault`/`resetLeaf` helpers drive all nine — the same discipline `diffSection` already
applies to the Save-time patch — so a future leaf needs no dedicated handler. A reset still only
stages the default into the draft; Save is what commits it, unchanged from P17.

**The op log records one connectionless op kind: `'http'` (P2).** `Host.RunOp`'s `OpSpec.ConnectionID`
was always `*string`, but P2 is the first phase to give it a real, every-day connectionless caller
— `bridge/http.go`'s `HttpService.Send` calls `Host.RunOp(ctx, OpSpec{ConnectionID: nil, Kind:
"http", OpID: args.OpID, TabID: &args.TabID}, fn)`. Nothing in `RunOp`/`CancelOp` needed to
change: both connection-dependent branches already guarded on `ConnectionID != nil` (the throttle
gate below, and `CancelOp`'s live-adapter kill), so an HTTP op mints an id, registers a cancellable
context, emits `op:start`/`op:end` and hits the panic boundary exactly like a database op. The
reason it joins the *existing* log rather than getting a second one of its own: the toolbar's
progress ring and elapsed-time readout (`useRunState(tabId)`) and the Operations panel's own
per-row Cancel button both read *only* this op log — a second one would mean either a dead ring on
every HTTP tab or a second `useRunState`/ops store to keep in sync with the first, the exact
"two implementations, two places for the same bug" this app's own registries elsewhere exist to
avoid. A non-2xx HTTP response is still logged `status: 'ok'` — the op is the exchange, and testing
a 404 endpoint is the point of an HTTP client; only a transport failure, a timeout or a cancel is
`'error'`/`'cancelled'`. The outcome rides in `op.SetCommand`: the method and URL before the send,
overwritten with `→ <status> <statusText>` once the response is known.

**A per-connection command throttle paces the adapter dispatch funnel, not any one adapter.** P28
added `connections.throttle_per_sec` (0 = unlimited, the default) alongside `auto_explain` as a
first-class column, not an `options_json` key — the same reasoning applies with more force here,
since a rate limit is a *safety* setting an `options_json` value could be silently removed by
pasting a connection URI. `internal/adapterhost/throttle.go`'s `throttleRegistry` wraps one
`golang.org/x/time/rate.Limiter` per throttled connection (its own mutex, never `Host.mu`, so a
config write never contends with the hot `running` map), with burst
`max(1, min(10, round(perSec)))` — small enough to still pace sustained traffic, large enough that
a correctly-configured limit doesn't stall the first click after an idle period. `Host.RunOp`
(above) is the one gate: every real op kind (`read`/`count`/`mutate`/`execute`/`transfer`/
`children`/`describe`/`definition`) waits for a token after the op is registered (so it stays
cancellable) but before `op:start` is emitted (so `DurationMs` never counts queue time);
`connect`/`disconnect`/`test` are never gated, so a misconfigured throttle can never lock a user
out of fixing it, and a cache hit (returning before `RunOp` is ever reached) is never throttled
either. A wait bounded at 30s expires into `E_TIMEOUT`; cancelling a queued op yields
`E_CANCELLED` — no new `adapters.ErrorCode`, and neither op:start nor op:end is ever emitted for a
queued-then-cancelled-or-timed-out op, since it never touched the database. The limiter's lifetime
matches the live adapter's: installed just before `Connect`, replaced live on an `Update` to a
currently-connected connection (so tuning a limit while hitting it applies immediately, no
reconnect needed), and cleared in `Disconnect`.

**Row coloring is a per-column text colour, not a row background.** P9's `appearance.rowColoring`
setting (default on) does not paint a background, a stripe, a parity rule or a hash — it derives a
text colour from each column's own `typeClass`, decided by exactly one function
(`DataGrid.vue`'s `colorForColumn`). Turning the setting off removes colour wholesale; with it on,
string-typed cells get no distinct colour of their own, unlike every other type class.

**The renderer runs Vue in VDOM mode, deliberately, not by default.** Vapor mode (Vue's
compiled, no-virtual-DOM rendering) was evaluated against this tree in P6
(`docs/v1.1/plans/P6-vue-vapor-mode.md`) and declined — not because it is new, but because this
app's hot paths already sit outside the VDOM's per-binding diffing model via the
no-reactivity-on-row-data invariant above (`:66-67`), so there is no rendering cost left for Vapor
to remove; partial adoption would also ship both runtimes for one component, and the one global
`v-tooltip` directive is an `ObjectDirective`, an interface Vapor's custom directives don't accept.
A future Vue 3.6 upgrade keeps VDOM mode — see the plan's §6 for the conditions under which this
should be re-evaluated.

## Process model

Two processes: the **webview** running the Vue renderer, and the **Go shell** that owns the window,
all app state, and now every database driver too.

```
┌──────────────────────┐
│  webview             │
│  (Vue renderer)      │
└──────────┬───────────┘
           │
           │  control: generated Wails bindings
           │           (HTTP to /wails/runtime)
           │  data:    one "engine" stream — a held poll/send pair on
           │           desktop, a real WebSocket only in a -tags server build
           │
┌──────────┴───────────┐
│  Go shell (Wails v3) │  window, menus, SQLite, settings, op log, keychain,
│  apps/kira-studio/main.go       │  pre-connect, every adapter, cache, metrics
└──────────────────────┘
```

**Why there used to be a separate engine process, and what P58f gave up to remove it.** Driver work
(socket reads, protocol parsing, row decoding) is CPU-bursty; a Node child process kept it off the
shell's window/menu handling and off the webview's frame budget, at the cost of the JSON-inflation
hop below and the packaging/vendoring machinery P58f deleted. P58 (`docs/v1/plans/P58-go-native-adapters.md`
D16) traded that process isolation for one fewer process, in-process encoding (below), and no
native-module packaging story — the real loss, not papered over: **an adapter panic used to kill
only the engine child** (`E_ENGINE_DOWN`, every connection errors, the window/tabs/settings/op log
all survive); now every adapter call runs behind a `recover()` at the op boundary
(`adapterhost.Host.safeRun`), which converts a panic into a failed op (`E_INTERNAL`) for that one
call instead of taking the whole app down — but a panic *outside* that boundary (a goroutine an
adapter spawns and never joins, for instance) still can. This does not restore the old isolation;
it converts "the app disappears" into "one operation failed" for the panics it actually catches.

**One process for all connections**, same as before: there was never one V8 isolate per connection,
and there is no per-connection Go process either — the adapter host multiplexes every open
connection through its own registry and cache regardless of how many are open at once.

**The renderer talks to Go over two planes.** The **control plane** is the Wails-generated
TypeScript bindings under `apps/kira-studio/frontend/bindings/…/internal/bridge/` (git-ignored, regenerated by
`wails3 task common:generate:bindings`, which `scripts/setup.sh` calls), which `apps/kira-studio/frontend/src/bridge/control.ts` calls as plain
typed async functions — `AppService.Info()`, `ConnectionsService.List()` — resolving under the hood
to HTTP calls against the local `/wails/runtime` endpoint driven by `/wails/runtime.js`
(`@wailsio/runtime`). That specifier is a literal URL the app itself answers — Wails serves its own
runtime bundle there — not a package the build resolves, so `vite.config.ts` marks `/wails/*`
external. Vite's dev server still has to resolve it at transform time, which is what
`apps/kira-studio/frontend/wails/runtime.js` is for: a file at exactly that path under the Vite root, so the
rewritten import URL stays `/wails/runtime.js` and `wails3 dev`'s asset server (which answers
`/wails/*` itself and proxies only the rest to Vite) keeps serving the real bundle. Every call is
wrapped in one `unwrap()` that normalizes a Go-side error into
the `{message, code}` shape the renderer already branched on.

**The control plane has its own undocumented size behaviour, measured once (P3) rather than
inherited by accident.** A bound call's serialized argument body over 512 KiB
(`@wailsio/runtime`'s `CHUNK_THRESHOLD`) is sliced into 512 KiB pieces and `await`ed **serially**,
one `fetch` per chunk — and the Go side (`pkg/application/transport_http.go`) refuses an assembled
body over **64 MiB** outright (`"assembled body too large"`), after holding it simultaneously as a
JS string, a `Uint8Array` and a Go `[]byte` before `encoding/json` ever parses it. So a 20 MiB
file base64-encoded (~26.7 MiB) would cross as 54 sequential round trips before a byte reaches Go,
and a 50 MiB file could not cross the control plane at all — a hard ceiling with no `E_TOO_LARGE`
of its own to explain it. This is exactly why the HTTP request body's file modes (P3: form-data
file fields, the binary body) and the pre-existing S3 object upload both cross the wire as a short
local **path** instead of the file's own bytes: Go opens and streams the file itself
(`internal/httpclient/body.go`'s `buildFormData`/`buildFile`, mirroring `internal/adapters/s3/
transfer.go`'s `openUploadBody`), so an upload's size is bounded by the filesystem, not by this
512 KiB/64 MiB arithmetic, and a multi-GB file is one ~200-byte control call rather than hundreds.

The **data plane** is a single named
stream, `"engine"`, opened once per page load by `apps/kira-studio/frontend/src/bridge/port.ts` via
`Stream('engine')`, carrying binary FlatBuffers frames for bulk payloads (grid pages, tree
results) — requests are still plain JSON text (P11 D3); only responses and events are binary.

**The data plane is not a WebSocket, on the build that ships (P4 F2, F3).** `Stream`
wraps Wails' own transport, and which transport that is depends on the build tag. A desktop build
(what this app ships) has no local listener at all: the frontend holds open `GET
/wails/stream/poll` (up to 20 s) until the Go side has a frame to deliver, and posts outbound
frames to `POST /wails/stream/send` — both over the asset server's custom URI scheme, deliberately,
so that no local TCP port is open for another process on the machine to reach. `WailsSocket` wraps
that poll/send pair in the same `readyState`/`onmessage`/`send()` shape a `WebSocket` has, which is
why the frontend code reads as if it were talking to one — but a real, on-the-wire `WebSocket` only
exists in a `-tags server` build (`apps/kira-studio/tests/e2e-real/` builds with that tag; the
packaged app does not), where the identical application code runs unchanged over a real
`net.Listener` instead.

**The data plane is a server, not a byte forwarder (P58 D3).** Bulk data is produced and encoded
exactly once, in the process that owns the window — the old Electron-era invariant ("Go never reads
a data-plane frame") could not survive Go adapters existing at all. `apps/kira-studio/internal/adapterhost/dataframe.go`'s
`HandleDataFrame` parses just enough of each inbound frame — its `op`, and for a connection-scoped
op, that connection's `connectionId` — to route it, then answers every op in-process by
`adapterhost.Dispatcher`, its response encoded as one FlatBuffers `Frame` — a `"KIF1"`
file-identified buffer whose `offsets`/`truncated` vectors are `[uint]` so
`packages/shared/protocol/frame.ts`'s `decodeFrame` reads every chunk's four buffers as zero-copy
typed-array views over the received bytes, not a base64 decode-and-copy (P11 D4, D5). There is no
other wire shape any more for a response or event; requests (renderer → Go) still travel as plain
JSON text (P11 D3). `ping` is answered locally too — the engine *is* this process now (P58f D11),
so the status pill's pid is this process's own `os.Getpid()`, not a child's; `cache:stats`/`cache:clear`
are answered locally as before, merging both caches' counters while reporting the configured budget
once, not doubled (A16).

**One writer, one producer.** `adapterhost.Session` owns a single bounded queue (64 frames / 32 MiB)
and the one goroutine draining it into the renderer's `Send`, so exactly one goroutine ever calls
the renderer connection's blocking `Send`. There is only one producer now — the router's own
locally-produced responses — where P58a–P58e had two (the deleted Node engine's own data frames were
the other, fanned together by the now-deleted `internal/enginebackend`, P58f D9). A full queue never
drops a response frame — `enqueueResponse` blocks for room instead (P2 R1 task #51, P2 R2 task #97),
since a dropped response could never settle its pending request, which has no client-side timeout of
its own. Only `enqueueLocal`'s unsolicited events (`cache:stats`) drop on a full queue, because the
next one supersedes it. There is no OS pipe left to push back through, so the old retry-with-backoff
that paused the engine's stdout read loop has no successor and needs none.

**Backpressure is app-level and transport-level, stacked, and which one actually binds differs by
case (P4 F5).** For a single oversized response, the app-level check fires first: `dataframe.go`'s
`respond` refuses a payload over `maxDataFrameBytes - 4096` with a visible error before the frame is
even built, strictly inside Wails' own matching hard cap (`streamMaxFrameBytes`, 64 MiB, which would
otherwise reject it outright at the transport). For sustained throughput, it runs the other way:
`adapterhost.Session`'s 32 MiB/64-frame queue sits **in front of** Wails' smaller 8 MiB/256-frame
per-connection window, so it is the *transport-level* bound that actually saturates first when the
frontend isn't draining fast enough — the drain goroutine's `Send` call blocks against Wails' window,
which stalls the queue's own draining and only then, as the queue backs up toward its own 32 MiB/64
frames, does the app-level bound engage and block the producer (`enqueueResponse`). The app's larger
queue is the shock absorber in front of the smaller transport window, not a tighter gate ahead of
it. Inbound (renderer → Go) has no app-level queue at all: Wails' own limit (256 frames / 8 MiB)
answers **429** rather than blocking, deliberately, because the held poll request is this
transport's scarce resource, not a buffer to grow.

**The FE↔BE protocol decision (P4, superseded on the data plane by P11).** With efficiency and a
possible future network split both in scope, P4 audited the two planes above and weighed them
against gRPC, protobuf/FlatBuffers/Cap'n Proto, Arrow IPC and msgpack — and, at the time, kept JSON
on both planes. P11 revisited the data plane alone once the P4 §5 binary envelope's own numbers
made a real candidate worth re-weighing, and adopted FlatBuffers:

- **Format: the control plane stays JSON; the data plane's responses and events are FlatBuffers.**
  Requests (renderer → Go) are still plain JSON text — only the bulk-payload direction changed.
  gRPC still cannot run over the custom-URI-scheme transport this app ships on (the socket it would
  need is the exact thing that transport exists to avoid). Arrow IPC was the closest structural fit
  — `page.Chunk` is already Arrow's `Utf8` layout — but it is self-describing and pays a 400+ byte
  schema tax on *every independent frame* (this app's traffic has no stream to amortize that against,
  one page per scroll/tab-switch), needs four hand-built accommodations (inverted null polarity,
  `uint32` vs `int32` offsets, no `truncated` slot, three of four page kinds not being tabular at
  all), and its JS package is 51.4 KB gzip in the webview bundle. FlatBuffers transmits no schema at
  all — both ends already agree on layout via code generated from one `.fbs` — costs +0.01–1.7% over
  raw buffer bytes at real page sizes (against Arrow's +6.6% at the default page size, worse at small
  ones), and its JS runtime is 2.7 KB gzip, smaller than a single icon set. Cap'n Proto has comparable
  wire overhead but no public untyped builder in its JS tooling and a thinner ecosystem. Full
  measurements: `docs/v1.1/plans/P11-flatbuffers-data-plane.md` §2/§3.
- **The measured cost was in the Go encoder, not the wire, and that part was fixed.** `internal/page`
  called a custom `MarshalJSON` per page and per offset array, then had `encoding/json` re-scan
  (`compact`) the bytes each one returned into the outer buffer — a cost paid on every page *view*,
  including cache hits. Removing both `Marshaler` boundaries (plain struct tags, `[]byte` fields
  marshaled natively) is byte-for-byte identical on the wire and 6–15x faster to encode, with
  allocation dropping from 2.3–3.8x the frame size to 1.00x (`docs/PERF.md` §2.6).
- **The network-split answer is a build tag, not a wire-format change.** `-tags server` (already
  exercised by `tests/e2e-real/`) turns the same `StreamSession`-shaped application code onto a real
  `net.Listener`, with `Stream` becoming an actual on-the-wire WebSocket with no
  application change at all — the two-method `Send([]byte)`/`Receive() ([]byte, error)` seam already
  hides the transport from everything above it. What that build tag does *not* provide is
  authentication of any kind, and three flows still assume the Go side and the user are the same
  machine (`FilesService.ChooseSave`'s native dialog, the OS keychain in `internal/secrets`,
  `internal/preconnect`'s locally-supervised processes) — none of which a protocol choice fixes, and
  none of which gRPC would fix either.
- **P4's own §5 binary envelope proposal is superseded, not deferred.** That plan specified a
  hand-built frame layout (byte-offset/length pairs into a raw payload section) for whenever base64's
  ~25-33% wire cost and 0.2–38 ms of JavaScriptCore-proxied frontend decode per page view cleared a
  stated bar, and declined to build it immediately. P11 built the zero-copy decode win that envelope
  was for, using FlatBuffers instead of that hand-built layout — a generator-enforced alignment rule
  beats a comment enforcing one, per the row-5-vs-row-3 comparison in P11's own §3 table — so there is
  no remaining hand-built envelope left to build later. Full findings, the weighed alternatives, and
  the measurements are `docs/v1.1/plans/P4-fe-be-data-transfer-protocol.md` (historical) and
  `docs/v1.1/plans/P11-flatbuffers-data-plane.md` (current).

**The Go side is `apps/kira-studio/`.** `apps/kira-studio/main.go` builds the `application.New` options and registers
fifteen bound services under `apps/kira-studio/internal/bridge/` — `AppService`, `SettingsService`,
`LayoutService`, `TabsService`, `WindowsService` (P8: a page's own boot-time window registration,
see Process model's multi-window subsection below), `ConnectionsService`, `TreeService`,
`EngineService`, `OpsService`, `FiltersService`, `FilesService`, `QueriesService`, `SchemaService`
(P18: per-connection DDL document store, backing `connection_ddl` and the DDL-driven SQL language
service described below), `HttpService` (P2: `Send`, the outbound HTTP path — see the op-log
paragraph below and Stack, above), `LifecycleService`. `EngineService.Status()` has
zero renderer callers (the status pill reads the data-plane `ping` above, not this) but stays bound
rather than deleted, since removing it would mean regenerating bindings and editing `control.ts` for
no user-visible gain; it now reports unconditionally, since the engine is this process. Behind the
services: `internal/storage/` (repos plus forward-only SQL migrations), `internal/tree/service.go`
(the children/describe/definition cache-aside), `internal/preconnect/` (the pre-connect script
supervisor, a real process-supervisor state machine), `internal/secrets/` (the keychain, see
Storage), `internal/adapterhost/` (the router, session and data-plane server described above),
`internal/adapters/` (every engine's own package, see Adapter contract), `internal/oplog/` (the
op-log event type and its two topics, relocated here from the deleted `internal/enginehost` — P58f
D9), and `internal/metrics/`.

**Multi-window: per window, or app-wide (P8).** The app has always had exactly one window in
practice — there was no code path to a second one in either the Electron or the Wails shell — but
Wails' own window manager (`internal/shell`) supports any number, and P8 is the phase that made a
second window both reachable (*Window → New Window*, ⇧⌘N) and correct. The line, and why it sits
where it does:

- **Per window:** the tab set and active tab (`tabs.window_key`), and the window's own rectangle
  (`windows.bounds_json`) — both properties of *this workbench*, meaningless shared. Proved
  full-stack by `apps/kira-studio/tests/e2e-real/multiwindow-real.spec.ts`: two windows against one
  backend, each keeping only its own tabs.
- **App-wide:** connections and their live state, settings, the op log, all three cache tiers, the
  metrics readout, the keychain, pre-connect supervision, and panel layout — each a property of the
  one process and the one database (this section's own "One process for all connections"), so a
  per-window copy would be invented divergence, not a fix. The local-authentication grace grant
  (P14) sits on this side of the line too — it authenticates the machine's owner, not a workbench —
  but the *action* it gates stays per-window: each window's edit dialog still requires its own
  explicit *Show password* press, which just succeeds without a prompt while a grant is live.

**The window key travels as `?window=<key>` on the frontend URL**, not through an async runtime
call: the shell mints a UUID per window (`internal/storage/model.WindowRecord`) and builds
`WebviewWindowOptions{URL: "/?window=" + key, Name: key}`, so `frontend/src/state/window.ts` can
read it **synchronously**, at module load, with `new URLSearchParams(location.search).get('window')`
— before `hydrateTabs()` (or anything else window-scoped) ever runs. Absent or unrecognised falls
back to the key `"main"`, which is what `tests/ui`'s static file server and `tests/e2e-real`'s plain
Chromium tab both see with no `?window=` of their own, and what a `-tags server` build's own lack of
a native shell means every window key needs a registration path for anyway
(`bridge.WindowsService.Ensure`, called once at renderer boot — always a no-op on the native shell,
since `main.go`'s own window-creation paths already create a window's `windows` row before that
window's URL ever loads).

**A window's `windows` row survives its own closing, unless another window is still open.** Closing
one of several open windows deletes that row (cascading its tabs via
`tabs.window_key ... ON DELETE CASCADE`) — the user closed that workbench, its tabs should not
reappear. Closing the *last* window leaves the row in place: `ApplicationShouldTerminateAfterLastWindowClosed:
false` (P56) keeps the app running, and the next Dock click or relaunch reopens the same workbench,
tabs included, exactly as a single-window session always has.

**Menu commands go to the focused window; state changes still broadcast to every window.** Wails'
own event transport fans every `app.Event.Emit` out to all windows — correct for a connection-state
change or a settings update, wrong for a menu command, which Electron always sent to
`BrowserWindow.getFocusedWindow()` only. `appcore.Emitter` has three delivery shapes over the same
`DispatchWailsEvent` primitive: `Emit` (broadcast — the six state-change channels, and the quit
handshake's own flush-before-close signal, which every window must answer), `EmitTo(windowKey, …)`
(exactly one window by key — the per-window close-flush handshake), and `EmitFocused` (exactly the
key/focused window — the menu's twelve signal channels, `bridge.Events.Signal`'s successor to
`sendToFocusedWindow`). Getting this split wrong the other way (broadcasting a menu command) was a
real regression the Wails port introduced and P8 fixed: Cmd+W used to close a tab in every open
window at once, and a menu-driven Run could execute a console statement in a window the user wasn't
looking at.

**App-wide CPU/footprint metrics** (`internal/metrics/`, the Go analogue of Electron's
`app.getAppMetrics()`) find this app's process set by **executable-path substring match, not a
pid-tree walk** — a native webview's helpers (WKWebView's `com.apple.WebKit.*`, WebKitGTK's
WebProcess/NetworkProcess) are not children of the shell in the ppid sense, so a tree walk would
silently under-count. `AnchorNeedles` is `["Kira Studio"]` (P58f: no vendored Node child needle any
more), `HelperNeedles` is `["com.apple.WebKit", "webkitgtk", "bwrap"]`, matched in one full
process-table scan per 60 s (`CachedPIDs`, revalidated cheaply on every 5 s tick in between — not a
full scan per tick). On darwin the memory figure is `ri_phys_footprint`, read via one
`proc_pid_rusage(pid, RUSAGE_INFO_V2, …)` syscall per pid per tick — the same field, from the same
API, Activity Monitor's own "Memory" column reads, not `pti_resident_size` ("Real Memory"/RSS, what
this figure was before P7): each of this app's own processes maps the dyld shared cache and (for
the WebKit helpers) the WebKit framework text, so summing RSS across the process set counts those
shared pages once per process, while footprint is a per-task ledger that doesn't. Every other
platform sums RSS, unchanged.

**Two different, both-correct CPU conventions, and this app picks the normalized one.** Activity
Monitor itself shows both: its per-process **"% CPU" column is an unnormalized per-core sum**
(0…100×N, so a process pinning two cores of an 8-core Mac reads 200%), while its **CPU-load pane
graphs the normalized figure** (0…100, a share of the machine's whole capacity). The status bar
follows the second convention — matching the CPU-load pane, not the per-process column — because a
one-number readout in a 4-character slot answers "how much of this Mac is the app using", and its
tooltip states this explicitly (`StatusBar.vue`) since a user comparing against the per-process
column will otherwise see a figure up to `logicalCPUs` times smaller and reasonably conclude the
status bar is wrong.

**Neither convention accounts for core frequency or Apple silicon's P/E asymmetry.** A normalized
percentage is a share of total core-*seconds*, not a share of compute capability: four E cores at
1 GHz and four P cores at 4.5 GHz can both read "400%" for very different amounts of actual work.
Activity Monitor has the same limitation, so matching its own accounting is still the right call —
this is a property of the underlying `% CPU`/`ri_user_time` accounting itself, not a bug this app's
readout could fix by reading something else.

**The JSON-inflation regression named in earlier phases was fixed and measured in its time, not
merely claimed — and has since been superseded, not merely improved on.** The old Node-engine-over-
stdio hop `JSON.stringify`d every frame, control and data alike — a `TypedArray` has no native JSON
form, so it serialized as an object keyed `"0","1",…`, which is why a `reviveChunks` decode step
existed at all, back when it did. That correctness fix was never the problem; the wire and heap
cost of getting there was. P58a M2 measured both paths on the same fixture
(`docs/PERF.md` §2.5): the Node engine's index-keyed JSON inflated a chunk **10.872x** on the wire
and **40.9x** in transient heap; Go's own base64 encoding (P58 D5) inflated it **1.334x** and
**6.86x** respectively — a real cost (base64 is never free) but an order of magnitude smaller. Base64
is not what any kind uses today: P11 replaced it with a FlatBuffers frame decoded as zero-copy typed-
array views, landing at +0.01–1.7% over raw buffer bytes with no transient heap copy on decode at all
(`docs/PERF.md` §2.7).

## Renderer security surface

**This section is much shorter than it was, and that is the finding, not an omission.** Most of what
P46 hardened were default-on Electron/Chromium capabilities. Under Wails the webview is a native
WKWebView, not a bundled Chromium, so the majority of those switches have **no subject at all** —
there is nothing to turn off, because the thing was never on. A smaller number have **no analogue**:
Wails exposes no equivalent, and the guarantee is genuinely weaker than it was. Those are listed as
losses below rather than papered over.

`apps/kira-studio/internal/shell/security.go` is the one module that owns what remains. `Harden()` returns the
posture, and `window.go`'s `Options` is its single caller. It does four things: deny every
permission except clipboard reads, set `JavaScriptCanOpenWindowsAutomatically` false, leave
`EnableFileDrop` false, and leave `OpenInspectorOnStartup` false.

| P46 control | Status under Wails |
|---|---|
| `contextIsolation` / `sandbox` / `nodeIntegration: false` | **No subject, strictly better.** There is no Node in the webview to isolate it from, and no `contextBridge`/`window.kira` surface at all — the renderer reaches Go only through generated bindings and the `engine` stream. |
| DevTools in a packaged build | **Ports, by a different mechanism.** It is a Go build tag rather than a runtime option: `-tags production`, already set by `apps/kira-studio/build/darwin/Taskfile.yml`. |
| Every Chromium permission except the clipboard | **Set, but inert on macOS.** `WebviewWindowOptions.Permissions` exists and is populated (microphone/camera/geolocation/notifications denied, `PermissionClipboardRead` allowed), but Wails v3.0.0-beta.16 implements `resolvePermission` only for Linux and Windows — there are zero darwin references. The option is kept because it is genuinely correct on Linux, where `wails3 task dev` runs; on macOS the real clipboard answer is WebKit's own user-gesture heuristics. |
| `window.open` deny | **Partial.** `MacWebviewPreferences.JavaScriptCanOpenWindowsAutomatically` is false, which denies JS-initiated windows; there is no per-request handler (no `WKUIDelegate createWebViewWithConfiguration:`). Still zero `window.open`, zero `target="_blank"` and zero `<a href>` in `apps/kira-studio/frontend/src`/`packages/shared`, and file pickers remain native dialogs via `FilesService`, not popups. |
| Navigation lock to the base URL | **No analogue — a real loss, already known.** There is no navigation-policy delegate on darwin at all (`webview_window_darwin.m` has no `decidePolicy`). This is weaker than the Electron `will-frame-navigate` guard plus fuses it replaces, and is recorded as a loss rather than mitigated. |
| `webviewTag: false` | **No subject.** |
| The spellchecker | **No analogue in the shell** — Wails exposes no spellcheck control. The mitigation moved into the renderer instead: `spellcheck="false"` on the field itself. The reason is unchanged: the connection dialog's password field becomes plain `type="text"` once the eye toggle reveals it. |
| WebGL off | **No subject.** |
| The seven `disable-*` Chromium switches | **No subject.** |
| `grantFileProtocolExtraPrivileges` | **No subject, and the whole class with it.** Assets are no longer served over `file://` — `apps/kira-studio/main.go` embeds `frontend/dist` and serves it through a plain Go `http.Handler` (`AssetOptions.Handler`), so the `file://`-module-CORS trap that made this fuse mandatory does not exist. |
| The three Electron fuses (`runAsNode` and friends) | **No subject.** There is no Electron binary to re-run as Node. |

**Whether the `WKWebView` itself is configurable beyond this table — checked, and closed, at P22
(D5).** `MacWebviewPreferences` (`webview_window_options.go:762-786`) is Wails v3.0.0-beta.16's
entire macOS webview surface — ten fields, byte-identical to beta.15 — and none is a compositing or
tiling knob; the `WKWebViewConfiguration` is built and `autorelease`d inside one cgo block
(`webview_window_darwin.go:138-195`) with no hook of any kind between "config allocated" and
"webview created" (the whole options file has exactly one func-typed field, `KeyBindings`).
`WindowsOptions` carries `EnabledFeatures`/`DisabledFeatures`/`AdditionalBrowserArgs` for WebView2;
`MacOptions` has only `ActivationPolicy` and terminate-on-last-window-closed — macOS is the one
platform with no engine-flags escape hatch. `NativeWindow()` reaches Wails' private ObjC
`WebviewWindow` subclass, whose `webView` ivar is castable, but there is nothing to set once you
have it: the coverage-rect/tile-pooling behaviour `docs/WEBVIEW-SCROLL-MEMORY.md` §7 describes lives
in WebCore, below anything `WKWebView`/`WKWebViewConfiguration`/`WKPreferences` expose publicly.
Full citations: `docs/v1.1/plans/P22-webview-scroll-performance.md` §3 F8–F11. **A bounded SPI-header
grep on a real Mac (that plan's §6.2 C6) is still pending** — no macOS SDK is reachable from this
sandbox — and its result, whichever way it goes, does not change this disposition (F8–F10 close the
Wails half on their own). Re-check after any Wails version bump; P19's posture means this repo keeps
moving through betas.

**Autofill** is unchanged and still a renderer-side control: `autocomplete="off"` on every
`TextField.vue`-backed input, because zero `<form>` elements means the engine has no form owner to
attach autofill heuristics to and the attribute is the actual per-input opt-out.

**The clipboard allowlist is an allowlist, not a deny-all, because a deny-all breaks the app.**
Denying clipboard reads throws at `clipboard.ts`'s `copyText` (38 call sites) and the grid's own
paste path. This reasoning still governs the `Permissions` map even though that map is inert on
macOS — it is the correct value, and it is the value that actually applies on Linux.

**Deliberately left alone, each a decision rather than an oversight:**
- **Hardware acceleration** stays on. The grid's scroll budget (see Invariants, above, and
  `docs/PERF.md` §1) depends on GPU compositing.
- **`window.confirm()`** still gates six destructive actions (deleting a key, an S3 object, a
  message, a document, a connection). Replacing them with the app's own confirmation UI is a UI
  change for a future phase.

**What actually holds this**, so a revert is never silent: `apps/kira-studio/internal/shell/security_test.go`
and `menutemplate_test.go` (the posture value and the packaged-vs-dev menu template — the successors
to the deleted `tests/unit/security.spec.ts`/`menu.spec.ts`, whose subjects moved to Go). There is
no Wails analogue of the old `tests/e2e/hardening.spec.ts`, and none was written: with the table
above reduced to "no subject" for most rows, there is nothing left for such a spec to assert that
the Go test does not already cover. The macOS-only behaviours — WebKit's clipboard gesture
heuristics, and the absent navigation delegate — have no automated coverage on any platform this
repo's CI runs.

## Testing

Four suites, under `apps/kira-studio/tests/`: `unit/`, `ipc/`, `ui/`, `e2e-real/`, plus the Go suite
in `apps/kira-studio/` (`bun run test:go`). `packages/db-fixtures/` is a shared fixture corpus, not
a suite of its own (see below). `ipc/` is the odd one out among the four — it is two suites in one directory, a Go backend
half and a Playwright frontend half per adapter, sharing one fixture module by design (P50, below).

**Isolation from the dev server.** The container-backed and UI suites run against their own
`KIRA_HOME` and their own Testcontainers-provisioned databases, never the developer's real
`~/.kira-studio` or a database a running `bun run dev` session is connected to. Running the tests
must not disconnect, lock out, or otherwise disturb a `bun run dev` instance already running on the
same machine. One exception is deliberate (P25 F10): on a real macOS dev machine the app's Keychain
item is shared with the developer's own login keychain, so a test that saves a connection password
touches the same OS-level encryption key a `bun run dev` session would. This is safe — each test's
*secrets* stay isolated in its own temp `KIRA_HOME`'s `kira.sqlite`, only the underlying key is
shared, and no test ever rotates or clears that key.

**`tests/unit/` needs nothing external and finishes in about a second** (`bun test tests/unit`) —
plain TypeScript modules exercised with fakes rather than a real container or a real app process. It
was pruned hard during the migration to a much stricter bar: a unit test now exists only for
genuinely complex or deeply-nested logic — parsers, cursor/pagination boundary arithmetic, cache
eviction, crypto, concurrency state machines. Most CRUD-, wrapper- and constructor-shaped tests were
deleted as low-value rather than ported. The **Go suite was pruned against the same bar** in the
same pass. Two specs were deleted because their subject moved rather than disappeared:
`security.spec.ts` and `menu.spec.ts` are now `apps/kira-studio/internal/shell/security_test.go` and
`menutemplate_test.go`. A shared runtime stub (`tests/unit/support/wailsRuntime.ts`) registers a fake
`/wails/runtime.js` and is imported for its side effect by every spec that needs one, rather than
each spec declaring its own — Bun's module registry is shared across every spec file in one test
run, so whichever spec's stub loads first wins for the whole run.

**`packages/db-fixtures/` is a shared fixture corpus now, not a spec suite (P58f D1).** Every
per-engine `packages/db-fixtures/*.spec.ts` is gone — the last four (clickhouse, mariadb, mysql, sqlite) retired
in P58f M10 alongside `src/engine/`, the same day the argument for keeping them (*"a still-passing
TypeScript spec is a live oracle to diff a Go port against"*) expired, since that oracle read
`src/engine/adapters/` directly. What survives, because Go and `apps/kira-studio/tests/e2e-real/`
both still read it: `fixtures/*.{sql,ts}` (read by
`apps/kira-studio/internal/adapters/testsupport/{postgres,mariadb,mysql,sqlite,clickhouse}.go`
by absolute path) and six `support/*.ts` modules (`connectionConfig`, `docker`, `postgres`,
`mariadb`, `sqlite`, `kafka`) that `apps/kira-studio/tests/e2e-real/support/*.ts` re-exports for
container seeding.
`packages/db-fixtures/kafka.spec.ts`, the one file in this directory that could never run under Bun at all (the
old TypeScript driver's compiled binding loaded under no Bun ABI), had already moved to
`apps/kira-studio/internal/adapters/kafka/kafka_test.go` in P58e M9, ahead of the rest.

The fixture data itself is unchanged from what it always seeded: wide tables, `NULL`s, unicode,
large text/blob, nested JSON, composite PKs, self-referencing and multi-hop FKs, ≥ 1 M rows in one
table to exercise paging and counts. Per-engine scenario coverage — connect/disconnect, tree
enumeration, describe, definition, first page, deep page, count, projection, sort, filter,
cancel-mid-query (asserted **server-side**), cache hit/miss behaviour, add/delete row, command
preview correctness — now lives in `apps/kira-studio/internal/adapters/*/*_test.go`, one Go test
file per engine, run by `bun run test:go`. **No CI wiring in v1** — but that same coverage also runs
on demand against each kind's version extremes: `scripts/db-compat.sh` (`bun run test:compat`, P16)
runs the identical conformance packages against every supported kind's oldest and newest server
image, sixteen (kind, min|max) pairs, via `testsupport.ImageFor`'s env-var override, running every
pair even after an earlier one fails. Its `workflow_dispatch` CI workflow is written and staged, not
live (`AGENTS.md`'s Known open items). The version floor/ceiling this proves is also surfaced to the
user: `packages/shared/domain/connection.ts`'s `MIN_SERVER_VERSION` map, rendered per kind by
`apps/kira-studio/frontend/src/project/ConnectionDialog.vue`.

**Each adapter's real-container coverage is two suites, by design (P25, populated P26).** A
*general* suite (the `*_test.go` file named above) runs unconditionally under `bun run test:go` —
connect/disconnect, tree, describe, read/filter/projection/count, mutate, DDL round trips where the
engine has a DDL surface at all, and read-only refusal: the load-bearing per-capability behaviours,
one assertion per capability a `caps.go` declares. A *complete* suite (each adapter's own
`authmatrix_test.go`), gated behind `KIRA_TEST_MATRIX=1` and run by `scripts/test-matrix.sh`
(`bun run test:matrix`), is the full auth/config permutation matrix per adapter — root vs.
least-privilege principal, with/without password, with/without the database-equivalent field — with
every connecting case's own functional consequences (a real read, a real write, a real permission
refusal) attached via `testsupport.Scenario`/`RunMatrix`'s `Then`. `testsupport.RunScenarios` is the
same `Scenario` body run outside a matrix table, which is what lets one scenario back both tiers
instead of being written twice. A permission *refusal* getting the wrong `ErrorCode` — an
authorization failure read as a wrong password (`E_AUTH`) rather than a query/permission failure — is
the specific risk the complete suite is built to catch, and four adapters (clickhouse, mongo, redis,
kafka) are known, pinned instances of exactly that conflation, each with a comment at the assertion
naming it.

**`tests/ipc/`** (P50) splits each adapter's former all-in-one UI spec at the app's real wire
boundary — the control plane and the bulk-data plane (see Process model, above) — and **its backend
half moved to Go in P58f M10 (D13)**, since the wire boundary it exercises is now Go-to-Go, not
Go-to-Node. Per adapter, `apps/kira-studio/tests/ipc/<adapter>/` holds two files now:
`<adapter>.frontend.spec.ts` drives the real Vue UI with both planes mocked, via `bun run
test:ipc:fe`, which needs no Docker, no container and no native driver; and `<adapter>.fixture.ts`
is the file it imports, generated — **never hand-written** — by
`apps/kira-studio/internal/ipcfixture`'s per-adapter Go test (`clickhouse_test.go`, `kafka_test.go`,
`mariadb_test.go`, `mysql_test.go`, `redis_test.go`, `sqs_test.go`; postgres and sqlite are covered
elsewhere and generate no fixture of their own).
`KIRA_IPC_FIXTURES=write go test ./apps/kira-studio/internal/ipcfixture/...` drives the real `adapterhost`/`adapters`
stack against a real container, captures its real responses, and writes the `.ts` module
(`write.go`'s `mustMarshalNoEscape` — Go's `encoding/json` escapes HTML and sorts map keys by
default, so the generator uses `SetEscapeHTML(false)` and typed structs, never maps); every
subsequent plain `go test` run of the same package asserts its own real responses against that
committed file. This is the tier's anti-drift guarantee, kept **word for word** across the port
because it is easy to state wrong: **a frontend spec cannot mock a shape the backend has stopped
producing without that same fixture module's own backend assertion failing first.** The guarantee
holds only while *something* regenerates: `kafka.frontend.spec.ts`'s Configuration-section assertion
went stale for three weeks after the Kafka adapter went native (P58e M9.3) and kept asserting an
empty section against a fixture nobody had re-captured, until this port's own regeneration surfaced
and fixed it. Wall-clock and other non-reproducible fields (timestamps, ephemeral ports, randomly generated
ids, approximate row-count estimates) are frozen to fixed placeholders (`frozen.go`) after being
validated structurally against the real value, never invented. `tests/ipc/support/types.ts` is the
one TypeScript file the tier keeps outright — the frontend specs' own shared types, with real
consumers on that side and no Go equivalent needed.

**`tests/e2e/` is gone** — the whole `_electron.launch()` tier, 23 spec files, was retired with the
Electron shell rather than ported wholesale. Every pure-UI spec has a verified `tests/ui/` port;
every full-stack-only spec has a named disposition, recorded here because two of them are losses:
`sqlite.spec.ts`'s and the postgres wiring value was recovered by the new
`apps/kira-studio/tests/e2e-real/` tier; `s3.spec.ts`'s file-write contract (the engine writes the
file itself, bytes never transit the shell or the renderer) was recovered by a `packages/db-fixtures/`
case; **`mongo.spec.ts`'s full-stack anchor value was
not recovered**, and that is an accepted, documented loss. `hardening.spec.ts` and `startup.spec.ts`
were deleted outright with no analogue: there is no `webPreferences`, fuse or Chromium-permission
concept left to assert, and no `process.uptime()` equivalent — cold start is now a manual procedure
(`docs/PERF.md` §3).

**`tests/ui/`** (`bun run test:ui`) is its replacement for everything that ported: 72 tests across 25
spec files driving the **real built `apps/kira-studio/frontend/dist` bundle** — real Vue, real
`bridge/{control,port}.ts` — over a static HTTP file server, in **real WebKit**, which is what a
packaged build actually embeds (WKWebView on macOS, WebKitGTK on Linux). There is no native app
process and no container: **both wire planes are mocked**, the control plane by
`page.route('**/wails/runtime')` answering from fixtures keyed by a hand-maintained `CHANNEL_TO_FQN`
table, the data plane by a fake `window._wails.streamFactory` socket. It covers what the old tier
covered minus the full-stack anchors: panel toggles, settings persistence, connection CRUD, tree
expansion and caching, opening the same table twice with independent state, pagination, projection,
search toolbar modes, stop button, cell editor, document expand/collapse, PK/FK navigation, context
menus, copy/paste, the sticky ancestor band's geometry, the checkbox tree filter, plus the
budgets/perf/leaks specs — and, from v1.1, the console Format button (`console-format.spec.ts`,
P13), Explain/auto-explain and the DDL-driven SQL language service (`console-explain.spec.ts`,
`sql-schema.spec.ts`, `autocomplete.spec.ts`, P18), the fake-data generator
(`fake-data.spec.ts`, P15), credential reveal (`credential-reveal.spec.ts`, P14), row coloring
(`row-coloring.spec.ts`, P9), and settings apply-on-save (`settings-apply-on-save.spec.ts`, P17).

**`tests/e2e-real/`** is the full-stack *wiring* tier, and it is deliberately small — four specs
(sqlite, postgres, mariadb, multiwindow), six tests. `multiwindow-real.spec.ts` is the only
full-stack proof of P8's `tabs.window_key` isolation ("two windows, one backend: each keeps only
its own tabs"), referenced by name in the multi-window subsection below. It builds the Go shell
with `-tags server` (Wails v3's
server build mode), which serves both planes over plain HTTP and WebSocket to a plain Chromium tab
with **no native window at all**: a real Go backend, a real adapter, a real container — there is no
embedded engine child to speak of any more (P58f M10). That recovers the wiring confidence
`tests/e2e/` used to provide for these engines at a small fraction of the cost. It is not a
UI-fidelity tier — that is `tests/ui/`'s job, which is why this one uses Chromium rather than
WebKit. Server mode has no file dialogs (`FilesService.ChooseSave`/`ChooseOpen` answer a real HTTP
422), so a spec needing one stubs exactly that method through a passthrough route that reuses
`CHANNEL_TO_FQN` rather than re-deriving it. `mariadb-real.spec.ts`'s second test is the coexistence
proof that used to kill the Node engine child mid-session and assert every connection survived
(`C2`, retired with the child it needed) — rewritten in P58f M10 to prove **two native kinds in one
session** instead: a MariaDB and a Kafka connection are both opened, the page is reloaded, and both
serve a real read afterward, since there is no child left to kill and the property worth proving now
is that native adapters coexist cleanly within one process across a reload.

**Parallelism.** `playwright.config.ts` runs three projects, all `fullyParallel`. `ui` being fully
parallel is a real change from the old `e2e` project's `workers: 1`, and it is earned rather than
inherited: that serialisation existed because concurrent Electron apps contend over wall-clock/RSS
budgets and Docker containers, and this tier has neither — the same reasoning that already made
`ipc-frontend` fully parallel. `e2e-real` runs `workers: 2`, safe because a per-test `KIRA_HOME` plus
`WAILS_SERVER_PORT` gives each instance its own SQLite app storage and its own secrets.
