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
| Shell | **Wails v3** (`v3.0.0-beta.15`), Go | native title bar, macOS 13+, `arm64` only |
| Language | TypeScript 7 (native compiler) for `.ts`; **Go** for the shell | `.vue` typechecks with whatever the Vue tooling supports (TS 5.x if needed); converge on one toolchain once `vue-tsc` runs on TS7 |
| Package manager / scripts / test runner | Bun | tooling only — every adapter is native Go, so nothing at runtime depends on it |
| Renderer build | Vite (`vite build`, `apps/kira-studio/frontend/vite.config.ts`) | builds `apps/kira-studio/frontend/src` straight into `apps/kira-studio/frontend/dist`, which `apps/kira-studio/main.go` embeds via `//go:embed all:frontend/dist` and serves through Wails' `AssetOptions.Handler` |
| UI | Vue 3 (`<script setup>`, Composition API) | VDOM mode — Vapor mode evaluated and declined in P6 (`docs/v1.1/plans/P6-vue-vapor-mode.md`) |
| Styling | Tailwind (v4, CSS-first config) | tokens mirror VS Code Dark Modern |
| Text editing / viewing | CodeMirror 6 | definition tab's Source pane, cell editor, document view, command preview |
| Icons | `@vscode/codicons` | UI chrome |
| Validation | Zod (TypeScript side) / hand-written model decoders (Go side) | Zod's remaining TypeScript-side job is connection-dialog input — the engine wire protocol it used to guard (`src/engine/{control,rpc,data,stdio-main}.ts`) went with `src/engine/`'s deletion (P58f). Rows read back out of SQLite are validated in Go (`apps/kira-studio/internal/storage/model/`) |
| Lint + format | Biome, default rules | single tool, no ESLint/Prettier |
| Storage | SQLite at `~/.kira-studio/kira.sqlite`, accessed **from Go** | `database/sql` + `modernc.org/sqlite` (pure-Go, no cgo — the same driver the sqlite adapter package already used for browsing external files, now also backing the app's own database); `SetMaxOpenConns(1)`. No ORM — the Drizzle dependency and every consumer of it are gone |
| Packaging | `wails3 task darwin:package` + `scripts/sign-bundle.sh` | ad-hoc signed (identity `-`); ships as a zipped `.app`, no DMG, no auto-update, no notarization; no `runtime/` tree to vendor or sign any more (P58f) |
| DB tests | Testcontainers, driven from Bun | `packages/db-fixtures/` no longer holds per-engine specs (P58f D1) — it survives as the shared fixture corpus (`fixtures/*.sql`, `support/*.ts`) that Go's `testsupport` package and `apps/kira-studio/tests/e2e-real/` both seed from; real containers, real data; Colima |
| UI tests | Playwright against the built bundle, real WebKit | every change validated |
| Logging | Go `log/slog` | a daily-rolling file under `~/.kira-studio/logs/`, mirroring the configuration `electron-log` used to hold — single log file, single source of truth |

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
  policy left to stop one (see Renderer security surface, below).

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

| DB | Tree levels | Default view | Pagination | Exact count | Cancel mechanism |
|---|---|---|---|---|---|
| PostgreSQL | database → schema → tables (ungrouped), views/matviews/functions/sequences grouped into per-kind folders | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `pg_cancel_backend(pid)` on a side connection |
| MariaDB | database → tables (ungrouped), views/routines grouped into per-kind folders (routines labelled "Routines") | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `KILL QUERY <threadId>` on a side connection |
| MySQL | database → tables (ungrouped), views/routines grouped into per-kind folders (routines labelled "Routines"); no sequences (MySQL has no SEQUENCE engine) | tabular | keyset on PK, else `LIMIT/OFFSET` | yes | `KILL QUERY <threadId>` on a side connection |
| SQLite | one `database` node per `PRAGMA database_list` entry (in practice always exactly `main`) → tables (ungrouped), views grouped into a folder; no sequences or routines (SQLite has neither) | tabular | keyset on PK, else a unique index, else the table's own implicit `rowid` (never mutation identity); `LIMIT/OFFSET` only for a view or a text-sorted request | yes (`count(*)` measured at ~9 ms/1M rows) | `modernc.org/sqlite`'s real `sqlite3_interrupt`, reached by cancelling an adapter-owned per-op `context.Context` on that op's own dedicated `*sql.Conn` (Go-native as of P58b M6.3 — the Node adapter had no such mechanism at all) |
| ClickHouse | one node per `system.databases` row → tables (ungrouped), views/materialized views grouped into per-kind folders; no sequences or routines (ClickHouse has neither); `system` is kept, not hidden | tabular | `LIMIT/OFFSET` only — a MergeTree `PRIMARY KEY` is a sparse index, with no unique row key to build a keyset cursor on | yes (`count()` reads part metadata) | `KILL QUERY WHERE query_id = '<id>' SYNC` on a second HTTP request (the client's own connection pool already has one free) |
| MongoDB | database → collections (ungrouped, indexes shown in the definition view) | documents | `_id` keyset, `skip/limit` fallback | `countDocuments` (slow) / `estimatedDocumentCount` | `$currentOp` + `killOp` on the *same* client the adapter already holds (never a side connection) |
| Redis | db index (a leaf — its key namespace is unbounded, browsed in a Browse tab) | key/value | `SCAN` cursor (never `KEYS`) | `DBSIZE` only (approx per-prefix) | a permanent, honest `false` — go-redis's blocking commands override the caller's context for the wait itself, so `CheckCancelled` between bounded `SCAN`-family rounds is the entire cancellation surface (`caps.cancel` stays `true`, since that surface is genuinely effective) |
| Kafka | cluster → topics (ungrouped), consumer groups (folder) | stream | offset window per partition | end-offset − begin-offset | none server-side — Kafka's protocol has no cancel operation at all, so the op's own `context.Context`, passed directly to every `kadm`/`kgo` call, is the entire mechanism; `caps.cancel` stays `true` since that surface is genuinely effective |
| SQS | region → queues | stream | receive batches | `ApproximateNumberOfMessages` | none server-side — the op's own `context.Context`, passed directly to every AWS SDK call (never a detached context), is the entire mechanism; `caps.cancel` stays `true` since that is genuinely effective |
| S3 | account → buckets (a leaf — a bucket's prefix/object space is unbounded, browsed in a Browse tab) | key/value (object browser) | `ListObjectsV2` continuation token | **per-object** exact field-row count via `HeadObject` (not a bucket-wide key count — S3 has no cheap exact answer to "how many keys total") | none server-side — same as SQS, the op's own `context.Context` on every SDK call; also load-bearing for `DownloadObject`'s temp-file cleanup ordering |

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
`LIMIT/OFFSET`), `pg_cancel_backend`/`KILL QUERY` cancellation on a side connection. MariaDB and
MySQL share one driver (`mariadb`, a genuine dual client) and one core (`engine/adapters/
mysql-family/`) — `mariadb/` and `mysql/` each hold only their own profile (server label,
`applyEngineOptions`) and re-export everything else.

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

Migrations are forward-only numbered SQL files (`apps/kira-studio/internal/storage/migrations/`) applied on
startup. Table access is hand-written `database/sql` in `apps/kira-studio/internal/storage/repos/` — there is
no ORM; the Drizzle dependency went out with the Electron shell. Every row read back out of
`settings`, `ui_layout` and `connections` is decoded through the model types in
`apps/kira-studio/internal/storage/model/` before use, so a hand-edited or stale-shape row fails loudly
instead of propagating zero values into the UI.

**A known, deliberate orphan.** `settings` stores leaves by key, and an existing installation may
carry an `advanced.engineMemoryCapMb` row from before P58f M10 removed the setting end to end
(D18, with it the `--max-old-space-size` flag it fed) — there is no migration to delete it, since a
schema-version bump for one inert leaf row was judged not worth the migration-ordering risk. Nothing
reads that key any more; the row is harmless and is recorded here so nobody rediscovers it later
wondering what still consumes it.

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
`wails3 generate bindings -b -i -ts -names`), which `apps/kira-studio/frontend/src/bridge/control.ts` calls as plain
typed async functions — `AppService.Info()`, `ConnectionsService.List()` — resolving under the hood
to HTTP calls against the local `/wails/runtime` endpoint driven by `/wails/runtime.js`
(`@wailsio/runtime`). Every call is wrapped in one `unwrap()` that normalizes a Go-side error into
the `{message, code}` shape the renderer already branched on. The **data plane** is a single named
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
twelve bound services under `apps/kira-studio/internal/bridge/` — `AppService`, `SettingsService`,
`LayoutService`, `TabsService`, `ConnectionsService`, `TreeService`, `EngineService`, `OpsService`,
`FiltersService`, `FilesService`, `QueriesService`, `LifecycleService`. `EngineService.Status()` has
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

**App-wide CPU/RSS metrics** (`internal/metrics/`, the Go analogue of Electron's
`app.getAppMetrics()`) find this app's process set by **executable-path substring match, not a
pid-tree walk** — a native webview's helpers (WKWebView's `com.apple.WebKit.*`, WebKitGTK's
WebProcess/NetworkProcess) are not children of the shell in the ppid sense, so a tree walk would
silently under-count. `AnchorNeedles` is `["Kira Studio"]` (P58f: no vendored Node child needle any
more), `HelperNeedles` is `["com.apple.WebKit", "webkitgtk", "bwrap"]`, matched in one system-wide
scan per 5 s tick.

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
| Every Chromium permission except the clipboard | **Set, but inert on macOS.** `WebviewWindowOptions.Permissions` exists and is populated (microphone/camera/geolocation/notifications denied, `PermissionClipboardRead` allowed), but Wails v3.0.0-beta.15 implements `resolvePermission` only for Linux and Windows — there are zero darwin references. The option is kept because it is genuinely correct on Linux, where `wails3 task dev` runs; on macOS the real clipboard answer is WebKit's own user-gesture heuristics. |
| `window.open` deny | **Partial.** `MacWebviewPreferences.JavaScriptCanOpenWindowsAutomatically` is false, which denies JS-initiated windows; there is no per-request handler (no `WKUIDelegate createWebViewWithConfiguration:`). Still zero `window.open`, zero `target="_blank"` and zero `<a href>` in `apps/kira-studio/frontend/src`/`packages/shared`, and file pickers remain native dialogs via `FilesService`, not popups. |
| Navigation lock to the base URL | **No analogue — a real loss, already known.** There is no navigation-policy delegate on darwin at all (`webview_window_darwin.m` has no `decidePolicy`). This is weaker than the Electron `will-frame-navigate` guard plus fuses it replaces, and is recorded as a loss rather than mitigated. |
| `webviewTag: false` | **No subject.** |
| The spellchecker | **No analogue in the shell** — Wails exposes no spellcheck control. The mitigation moved into the renderer instead: `spellcheck="false"` on the field itself. The reason is unchanged: the connection dialog's password field becomes plain `type="text"` once the eye toggle reveals it. |
| WebGL off | **No subject.** |
| The seven `disable-*` Chromium switches | **No subject.** |
| `grantFileProtocolExtraPrivileges` | **No subject, and the whole class with it.** Assets are no longer served over `file://` — `apps/kira-studio/main.go` embeds `frontend/dist` and serves it through a plain Go `http.Handler` (`AssetOptions.Handler`), so the `file://`-module-CORS trap that made this fuse mandatory does not exist. |
| The three Electron fuses (`runAsNode` and friends) | **No subject.** There is no Electron binary to re-run as Node. |

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
both still read it: `fixtures/*.sql` (read by
`apps/kira-studio/internal/adapters/testsupport/{postgres,mariadb,mysql,sqlite,clickhouse}.go`
by absolute path) and five `support/*.ts` modules (`docker`, `postgres`, `mariadb`, `sqlite`,
`kafka`) that `apps/kira-studio/tests/e2e-real/support/*.ts` re-exports for container seeding.
`packages/db-fixtures/kafka.spec.ts`, the one file in this directory that could never run under Bun at all (the
old TypeScript driver's compiled binding loaded under no Bun ABI), had already moved to
`apps/kira-studio/internal/adapters/kafka/kafka_test.go` in P58e M9, ahead of the rest.

The fixture data itself is unchanged from what it always seeded: wide tables, `NULL`s, unicode,
large text/blob, nested JSON, composite PKs, self-referencing and multi-hop FKs, ≥ 1 M rows in one
table to exercise paging and counts. Per-engine scenario coverage — connect/disconnect, tree
enumeration, describe, definition, first page, deep page, count, projection, sort, filter,
cancel-mid-query (asserted **server-side**), cache hit/miss behaviour, add/delete row, command
preview correctness — now lives in `apps/kira-studio/internal/adapters/*/*_test.go`, one Go test
file per engine, run by `bun run test:go`. Local-only for now — no CI wiring in v1.

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

**`tests/ui/`** (`bun run test:ui`) is its replacement for everything that ported: 36 tests across 18
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
budgets/perf/leaks specs.

**`tests/e2e-real/`** is the full-stack *wiring* tier, and it is deliberately small — three specs
(sqlite, postgres, mariadb), five tests. It builds the Go shell with `-tags server` (Wails v3's
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
