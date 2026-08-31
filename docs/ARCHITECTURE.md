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
| Package manager / scripts / test runner | Bun | the engine runs on a vendored real Node, not on Bun — Bun is tooling only |
| Renderer build | Vite (`vite build`, `vite.config.ts` at the repo root) | builds `src/renderer` straight into `shell/frontend/dist`, which `shell/main.go` embeds via `//go:embed all:frontend/dist` and serves through Wails' `AssetOptions.Handler` |
| Engine build | esbuild (`bun run build:engine`) | bundles `src/engine/stdio-main.ts` into `shell/runtime/engine/engine.cjs` |
| Engine runtime | a **vendored Node** at `shell/runtime/node/` | fetched from nodejs.org by `scripts/vendor-node.sh`, git-ignored; deliberately not the system Node and not an embedded-in-the-shell runtime |
| UI | Vue 3 (`<script setup>`, Composition API) | |
| Styling | Tailwind (v4, CSS-first config) | tokens mirror VS Code Dark Modern |
| Text editing / viewing | CodeMirror 6 | definition tab's Source pane, cell editor, document view, command preview |
| Icons | `@vscode/codicons` | UI chrome |
| Validation | Zod (TypeScript side) / hand-written model decoders (Go side) | Zod still guards every trust boundary that is still TypeScript: the engine wire protocol's control and data payloads (`src/engine/{control,rpc,data,stdio-main}.ts`) and connection-dialog input. Rows read back out of SQLite are now validated in Go instead (`shell/internal/storage/model/`) |
| Lint + format | Biome, default rules | single tool, no ESLint/Prettier |
| Storage | SQLite at `~/.kira-studio/kira.sqlite`, accessed **from Go** | `database/sql` + `mattn/go-sqlite3` (the same unmodified upstream SQLite amalgamation `node:sqlite` embeds, so the migrations and queries behave identically); `SetMaxOpenConns(1)`. No ORM — the Drizzle dependency and every consumer of it are gone |
| Packaging | `wails3 task darwin:package` + `scripts/sign-bundle.sh` | ad-hoc signed (identity `-`); ships as a zipped `.app`, no DMG, no auto-update, no notarization |
| DB tests | Testcontainers (Node) | real containers, real data; Colima |
| UI tests | Playwright against the built bundle, real WebKit | every change validated |
| Logging | Go `log/slog` | a daily-rolling file under `~/.kira-studio/logs/`, mirroring the configuration `electron-log` used to hold; the engine child keeps writing to stdout/stderr, which the shell pipes into the same sink — single log file, single source of truth |

Driver libraries — the best-maintained option per engine, Go-native for nine of ten kinds as of
P58d (`b40a09e`..): `jackc/pgx/v5` (postgres), `go-sql-driver/mysql` (mariadb/mysql, via a shared
`mysqlfamily` core), `mattn/go-sqlite3` (sqlite), a hand-rolled `net/http` client (clickhouse, no
driver dependency at all), `go.mongodb.org/mongo-driver/v2` (mongodb), `redis/go-redis/v9` (redis),
`aws-sdk-go-v2/service/{sqs,s3}` (sqs/s3, sharing a small `awscfg` config-and-error-mapping
package). Kafka is the only kind still Node-served, on `@confluentinc/kafka-javascript` (native,
heavier, but actively maintained where `kafkajs` has stalled) — its own Go port is P58e's.

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
- **Bulk data passes through the Go process without being parsed, copied or re-encoded.** Result
  pages travel renderer↔engine over one named stream that the Go shell forwards verbatim in both
  directions (see Process model, below). Go never unmarshals a data-plane frame. This replaces the
  older "bulk data skips the main process" rule, which described Electron's `MessagePort`
  arrangement: under Wails the bytes genuinely do traverse the shell process, and what is
  guaranteed is that it does not look at them.
- The renderer loads no remote content, opens no window, and navigates nowhere but its own base
  URL. Under Electron this was enforced by the shell as well as true of the code; under Wails only
  the second half still holds — the renderer contains no such call, but there is no navigation
  policy left to stop one (see Renderer security surface, below).

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
| SQLite | one `database` node per `PRAGMA database_list` entry (in practice always exactly `main`) → tables (ungrouped), views grouped into a folder; no sequences or routines (SQLite has neither) | tabular | keyset on PK, else a unique index, else the table's own implicit `rowid` (never mutation identity); `LIMIT/OFFSET` only for a view or a text-sorted request | yes (`count(*)` measured at ~9 ms/1M rows) | `modernc.org/sqlite`'s real `sqlite3_interrupt`, reached by cancelling an adapter-owned per-op `context.Context` on that op's own dedicated `*sql.Conn` (Go-native as of P58b M6.3 — the Node adapter had no such mechanism at all) |
| ClickHouse | one node per `system.databases` row → tables (ungrouped), views/materialized views grouped into per-kind folders; no sequences or routines (ClickHouse has neither); `system` is kept, not hidden | tabular | `LIMIT/OFFSET` only — a MergeTree `PRIMARY KEY` is a sparse index, with no unique row key to build a keyset cursor on | yes (`count()` reads part metadata) | `KILL QUERY WHERE query_id = '<id>' SYNC` on a second HTTP request (the client's own connection pool already has one free) |
| MongoDB | database → collections (ungrouped, indexes shown in the definition view) | documents | `_id` keyset, `skip/limit` fallback | `countDocuments` (slow) / `estimatedDocumentCount` | `$currentOp` + `killOp` on the *same* client the adapter already holds (never a side connection) |
| Redis | db index (a leaf — its key namespace is unbounded, browsed in a Browse tab) | key/value | `SCAN` cursor (never `KEYS`) | `DBSIZE` only (approx per-prefix) | a permanent, honest `false` — go-redis's blocking commands override the caller's context for the wait itself, so `CheckCancelled` between bounded `SCAN`-family rounds is the entire cancellation surface (`caps.cancel` stays `true`, since that surface is genuinely effective) |
| Kafka | cluster → topics (ungrouped), consumer groups (folder) | stream | offset window per partition | end-offset − begin-offset | close the assigned consumer, `AbortSignal` |
| SQS | region → queues | stream | receive batches | `ApproximateNumberOfMessages` | none server-side — the op's own `context.Context`, passed directly to every AWS SDK call (never a detached context), is the entire mechanism; `caps.cancel` stays `true` since that is genuinely effective |
| S3 | account → buckets (a leaf — a bucket's prefix/object space is unbounded, browsed in a Browse tab) | key/value (object browser) | `ListObjectsV2` continuation token | **per-object** exact field-row count via `HeadObject` (not a bucket-wide key count — S3 has no cheap exact answer to "how many keys total") | none server-side — same as SQS, the op's own `context.Context` on every SDK call; also load-bearing for `DownloadObject`'s temp-file cleanup ordering |

**SQS read policy.** Reads are **never automatic**. The stream view has an explicit
**Poll** button with a visible warning: `ReceiveMessage` makes messages invisible to real
consumers for the visibility timeout. Nothing is fetched on tab open, on refresh, or on a timer.
SQS's authentication is by **named AWS profile** (static keys accepted only in URI mode).

Cancellation is never "stop showing the result" — it is always forwarded to the server. If a driver
cannot cancel, the capability is absent and the stop button says so rather than lying.

Every adapter maps its own driver's thrown errors from its own `errors.ts`, exported as one
`mapError(err): AdapterError` (P39) — the closed `AdapterErrorCode` set, with the driver's message
preserved verbatim (Adapter rule 4). `src/engine/adapters/errors.ts` (the shared root, not any one engine's own)
also holds `unsupported(kind, what)` and `noQueryConsole(kind)` — the two sentence shapes behind
every `E_UNSUPPORTED` capability stub (describe/definition/file-transfer read `"<what> is not
supported for <kind>"`; a missing query console reads `"<kind> has no query console"`). It also
holds `assertWritable(readOnly)` (P39 iter2) — the `"connection is read-only"` refusal every
write-capable adapter's `mutate()` opens with (`mutate()`'s own documented contract in
`adapter.ts`: enforced on the engine side, not only greyed out in the UI). It also holds
`assertNotCancelled(ctx)` (P39 iter3) — Adapter rule 2's pre-flight cancellation check (`throw`s
`E_CANCELLED` if `ctx.signal` is already aborted), replacing nine copies of the same guard across
postgres/mysql-family/clickhouse/sqlite. It also holds (P48) `throwIfCancelled(ctx)` —
`assertNotCancelled`'s mid-flight sibling, the check an adapter re-runs after an `await` rather than
before a call starts, with a message that says so ("operation was cancelled", no "before it
started") — replacing twenty-six identical copies across eight adapters, and `requireConnected(handle)`,
replacing ten identical "did `connect()` ever run" guards each adapter's private handle accessors
opened with. `postgres/query.ts` and `mysql-family/query.ts`'s own callback-style abort/settle race
(cancel arriving after the driver's callback already resolved, or vice versa) is unified behind a
new `engine/adapters/abort.ts`'s `withAbortRace(ctx, run, opts)`, replacing six near-identical copies
across their `query.ts`/`console.ts` modules.

`src/engine/adapters/sql-text.ts` holds the genuinely shared, driver-agnostic SQL text/planning
glue the SQL adapters' `read.ts` modules call — `resolveProjection`/`safeInt` (P39),
`stripOneTrailingSemicolon`/`singleStatusPage` (P39 iter2), and `computeEffectiveOrder` (P39 iter3)
— the keyset-eligibility rule (which sort terms admit a keyset predicate, and the tiebreaker that
makes one) that postgres/mysql-family/sqlite's `read.ts` each wrote out identically; each call site
still passes its own tiebreaker expression (sqlite's keeps its rowid fallback, since only sqlite's
`ReadTarget` has a `rowidColumn` field to fall back to). P48 added the rest of the SQL read path's
keyset planning here too: `assertKeysetSupported`/`resolveFetchColumns`/`buildScanOrderBy`, then
`buildKeysetPosition` — collapsing three 28-line `strategy`/`hasMore`/`nextToken`/`prevToken`/
`position` blocks (postgres, mysql-family, sqlite) and their three `keysetValuesOf` closures into
one, each caller passing only its own `cellAt` reader — plus `whereClause`/`parseCountValue` (the
filter clause and numeric count-result parse `read.ts`'s `readPage`/`countRows` share across all
four SQL adapters including ClickHouse) and `primaryKeyFromIndexes`/`resolveKeyShape`, moved out of
postgres's and mysql-family's own `catalog.ts` where each had its own copy.

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

**PostgreSQL is Go-native as of P58a M5** (`shell/internal/adapters/postgres/`, `pgx/v5`) —
`nativeKinds["postgres"]` is `true`, so a Postgres connection is served in-process by
`adapterhost.Router`, never by the Node engine child. The Go port keeps the design facts
above (keyset-on-PK pagination, `pg_cancel_backend` on a side connection using the tracked backend
pid) exactly; what changed is only which process runs the adapter and how its query context is
handled — a caller-side op cancellation must never be the same `context.Context` passed to `pgx`'s
own `Query`/`Exec`, since pgx (unlike Node's `pg`) honours context cancellation by racing its own
cancel request against the adapter's explicit `pg_cancel_backend` call
(`internal/adapters/postgres/query.go`'s `runWithAbortRace`).

**MariaDB and MySQL are Go-native as of P58b M6.2**
(`shell/internal/adapters/mysqlfamily/`, `github.com/go-sql-driver/mysql`) —
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

**SQLite is Go-native as of P58b M6.3** (`shell/internal/adapters/sqlite/`, `modernc.org/sqlite`)
— `nativeKinds["sqlite"]` is `true`. `caps.cancel` flips from the Node adapter's honest `false` to
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

**ClickHouse is Go-native as of P58b M6.4** (`shell/internal/adapters/clickhouse/`, plain
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

### Kafka (`@confluentinc/kafka-javascript`, P32)

The Kafka adapter's driver wraps a native NAN addon (built against V8's C++ API, not N-API) — it is
**ABI-specific per JS runtime**, not portable the way a pure-JS dependency is. Under the Electron
shell that meant an ABI rebuild step before every run and before packaging; against the vendored
Node runtime there is **no rebuild step at all** — the addon loads under a stock Node exactly as it
landed on disk from `bun install`. **Bun still cannot load this addon at any ABI** — confirmed
empirically, not just from the docs (a matching-ABI build still crashes with `undefined symbol:
v8::FunctionTemplate::SetClassName` when required from Bun) — which is why `tests/db/kafka.spec.ts`
runs esbuild-bundled under the vendored Node (`node:test`, via `scripts/run-db-tests.sh`'s
`--path-ignore-patterns`) while every other engine's spec in that directory runs under Bun.

The adapter never joins a consumer group for a read-only browse — it assigns partitions directly
(`assign()`, explicit start offsets, a bounded poll loop) rather than `subscribe()`, so `group.id`
is a required-but-never-joined constant and browsing never pays a group-join round trip. `canDelete`
is permanently `false` — a topic's log is immutable, so there is no per-message delete or update at
the protocol level, only retention/compaction.

### SQS (Go-native as of P58d M8.2)

**Go-native as of P58d M8.2** (`shell/internal/adapters/sqs/`, `aws-sdk-go-v2/service/sqs`) —
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

**Go-native as of P58d M8.3** (`shell/internal/adapters/s3/`, `aws-sdk-go-v2/service/s3`) —
`nativeKinds["s3"]` is `true`, reaching **nine of ten** native kinds; only Kafka is left for P58e.
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

**Both are Go-native as of P58c** (`shell/internal/adapters/mongo/` and `.../redis/`) —
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

Migrations are forward-only numbered SQL files (`shell/internal/storage/migrations/`) applied on
startup. Table access is hand-written `database/sql` in `shell/internal/storage/repos/` — there is
no ORM; the Drizzle dependency went out with the Electron shell. Every row read back out of
`settings`, `ui_layout` and `connections` is decoded through the model types in
`shell/internal/storage/model/` before use, so a hand-edited or stale-shape row fails loudly
instead of propagating zero values into the UI.

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
stream, console); `views/shared/immediateMutation.ts` is the one write body behind documents/
keyvalue/stream's ten immediate-mutation functions; `views/shared/page/Pager.vue` is the one pager
behind both the SQL grid and the document list (previously two independently-maintained
prev/next/count implementations); `views/shared/document/DocumentRow.vue` is the one Mongo
document-row component behind both the document view's editable row and the console's read-only
copy of it; and `views/shared/page/columns.ts`'s `columnHeaderTooltip`/`GUTTER_WIDTH`/
`DEFAULT_COLUMN_WIDTH` are the one column-header tooltip and the one pair of layout constants
behind the grid and the console's own tabular result, ending three different spellings of the same
two numbers the two had drifted into.

## Process model

Three processes: the **webview** running the Vue renderer, the **Go shell** that owns the window
and all app state, and the **engine**, a Node child process holding every database driver.

```
┌──────────────────────┐                          ┌────────────────────────┐
│  webview             │                          │  engine (drivers)      │
│  (Vue renderer)      │                          │  vendored Node child   │
└──────────┬───────────┘                          └───────────┬────────────┘
           │                                                  │
           │  control: generated Wails bindings               │  stdio, JSON-line
           │           (HTTP to /wails/runtime)               │  wire protocol
           │  data:    one "engine" WebSocket stream          │  (control + data)
           │                                                  │
           └─────────────────────┬────────────────────────────┘
                      ┌──────────┴───────────┐
                      │  Go shell (Wails v3) │  window, menus, SQLite, settings, op log,
                      │  shell/main.go       │  keychain, pre-connect, engine supervision
                      └──────────────────────┘
```

**Why a separate engine process.** Driver work (socket reads, protocol parsing, row decoding) is
CPU-bursty. In the shell process it would stall window/menu handling; in the webview it would drop
frames. In its own process it is fully parallel and its memory is separately capped and reclaimable
(`--max-old-space-size`, from the `advanced.engineMemoryCapMb` setting).

**One engine for all connections**, not one per connection: a V8 isolate costs ~35 MB, so
per-connection processes would blow the RAM budget at 5 connections. The adapter host is written so
a connection *can* be moved to its own process later (config flag) if a driver proves unstable.

**The renderer talks to Go over two planes.** The **control plane** is the Wails-generated
TypeScript bindings under `shell/frontend/bindings/…/internal/bridge/` (git-ignored, regenerated by
`wails3 generate bindings -b -i -ts -names`), which `src/renderer/bridge/control.ts` calls as plain
typed async functions — `AppService.Info()`, `ConnectionsService.List()` — resolving under the hood
to HTTP calls against the local `/wails/runtime` endpoint driven by `/wails/runtime.js`
(`@wailsio/runtime`). Every call is wrapped in one `unwrap()` that normalizes a Go-side error into
the `{message, code}` shape the renderer already branched on. The **data plane** is a single named
stream, `"engine"`, opened once per page load by `src/renderer/bridge/port.ts` via
`JSONStream('engine')`, carrying JSON frames for bulk payloads (grid pages, tree results).

**The data plane is a server now, not a byte forwarder (P58 D3, since P58a M4).** Bulk data is
produced and encoded exactly once, in the process that owns the window — the old invariant ("Go
never reads a data-plane frame") could not survive Go adapters existing at all, since the router
has to decide, per connection, which process answers. `shell/internal/adapterhost/dataframe.go`'s
`HandleDataFrame` parses just enough of each inbound frame — its `op`, and for a connection-scoped
op, that connection's `connectionId` — to route it: a **Go-native** connection (`nativeKinds`, A12;
`{"postgres": true}` as of P58a M5, every other kind still Node-served) is answered in-process by
`adapterhost.Dispatcher`, its response `json.Marshal`ed directly (base64 chunk encoding, P58 D5)
with no engine involved at all; a **Node-served** connection's frame is forwarded to the engine's
stdin unread, exactly as before. `src/renderer/bridge/port.ts`'s `reviveChunks`/`toTypedArray`
decode either wire shape transparently: a base64 string (a Go-native chunk) or `JSON.stringify`'s
index-keyed object (a Node-served one, P57's own finding) — `isChunkLike`'s own check only looks at
the outer object's four key names, not which shape each one carries.
`ping` always reaches the Node engine regardless (A17 — the status pill still reports its pid while
it does most of the work); `cache:stats`/`cache:clear` are answered locally, merging both caches'
counters while reporting the configured budget once, not doubled (A16).

**One writer, both producers (A18).** `adapterhost.Session` owns a single bounded queue (64 frames
/ 32 MiB, matching the engine host's own bounds) and the one goroutine draining it into the
renderer's `Send` — both the Node engine's own data frames (`Session` satisfies `enginehost.Sink`)
and the router's own locally-produced responses enqueue into it, so exactly one goroutine ever
calls the renderer connection's blocking `Send`. Backpressure toward the Node engine is unchanged:
a full queue reports `enginehost.ErrStreamFull`, which the engine host's own retry-with-backoff
already handles by pausing its stdout read loop, which is what pushes back on the OS pipe. A
locally-produced response has no pipe to push back through, so a full queue just drops it — the
renderer's own pending request then times out exactly as if the process had died. Wails' own
`application.StreamConn` bounds sit underneath all of this: `Send` blocks and `TrySend` is the
non-blocking `ErrStreamFull`-returning variant, per-connection limits are 8 MiB **and** 256 frames,
and any single frame over 64 MiB (`streamMaxFrameBytes`) is rejected outright — a real ceiling this
transport introduces that Electron's structured clone never had, enforced Go-side too by
`internal/enginehost/stream.go`'s `maxDataFrameBytes`, which drops an oversized frame with a named
log line rather than corrupting the stream.

**The Go side is `shell/`.** `shell/main.go` builds the `application.New` options and registers
twelve bound services under `shell/internal/bridge/` — `AppService`, `SettingsService`,
`LayoutService`, `TabsService`, `ConnectionsService`, `TreeService`, `EngineService`, `OpsService`,
`FiltersService`, `FilesService`, `QueriesService`, `LifecycleService`. Behind them:
`internal/storage/` (repos plus forward-only SQL migrations), `internal/tree/service.go` (the
children/describe/definition cache-aside), `internal/preconnect/` (the pre-connect script
supervisor, a real process-supervisor state machine), `internal/secrets/` (the keychain, see
Storage), `internal/enginehost/` (the engine child's supervisor and protocol speaker), and
`internal/metrics/`.

**App-wide CPU/RSS metrics** (`internal/metrics/`, the Go analogue of Electron's
`app.getAppMetrics()`) find this app's process set by **executable-path substring match, not a
pid-tree walk** — a native webview's helpers (WKWebView's `com.apple.WebKit.*`, WebKitGTK's
WebProcess/NetworkProcess) are not children of the shell in the ppid sense, so a tree walk would
silently under-count. `AnchorNeedles` is `["Kira Studio", "runtime/node/bin/node"]`,
`HelperNeedles` is `["com.apple.WebKit", "webkitgtk", "bwrap"]`, matched in one system-wide scan per
5 s tick.

**Under the stdio transport, stdout is the frame channel, not a log sink.** `src/engine`'s own
modules call `console.log`/`warn`/`error` directly (`control.ts`'s `AdapterDeps.log`, `cache/lru.ts`'s
refusal warning); harmless under Electron's `parentPort`, but a stray write here lands raw text in
the exact byte stream `internal/enginehost`'s length-prefixed reader is parsing. `stdio-main.ts`
repoints it — `globalThis.console = new Console({stdout: process.stderr, stderr: process.stderr})` —
before reading a single byte of stdin, and any new engine-side logging must stay on that path.

**Known regression: the engine stdio hop JSON-encodes bulk data.** `stdio-main.ts`'s `writeFrame`
does `JSON.stringify` on every frame, control and data alike. Electron's `MessagePortMain` carried
`TextColumnChunk`'s four exactly-sized typed arrays across by real structured clone; JSON does not
— a `TypedArray` serializes as an object keyed `"0","1",…`, which is why `bridge/port.ts` has to
carry `reviveChunks` to rebuild real `Uint8Array`/`Uint32Array` instances on the renderer side. The
correctness hole is closed, but the cost is not: a binary blob inflates to roughly 5–6 bytes per
original byte on the wire before `reviveChunks` even runs, plus the transient heap both the
`stringify` and the `parse` need. This is a genuine memory and CPU regression against the Electron
architecture and it is **not fixed** — the named direction is a future phase (P58) migrating the
adapters to native Go, which removes the Node sidecar and this hop with it.

## Renderer security surface

**This section is much shorter than it was, and that is the finding, not an omission.** Most of what
P46 hardened were default-on Electron/Chromium capabilities. Under Wails the webview is a native
WKWebView, not a bundled Chromium, so the majority of those switches have **no subject at all** —
there is nothing to turn off, because the thing was never on. A smaller number have **no analogue**:
Wails exposes no equivalent, and the guarantee is genuinely weaker than it was. Those are listed as
losses below rather than papered over.

`shell/internal/shell/security.go` is the one module that owns what remains. `Harden()` returns the
posture, and `window.go`'s `Options` is its single caller. It does four things: deny every
permission except clipboard reads, set `JavaScriptCanOpenWindowsAutomatically` false, leave
`EnableFileDrop` false, and leave `OpenInspectorOnStartup` false.

| P46 control | Status under Wails |
|---|---|
| `contextIsolation` / `sandbox` / `nodeIntegration: false` | **No subject, strictly better.** There is no Node in the webview to isolate it from, and no `contextBridge`/`window.kira` surface at all — the renderer reaches Go only through generated bindings and the `engine` stream. |
| DevTools in a packaged build | **Ports, by a different mechanism.** It is a Go build tag rather than a runtime option: `-tags production`, already set by `shell/build/darwin/Taskfile.yml`. |
| Every Chromium permission except the clipboard | **Set, but inert on macOS.** `WebviewWindowOptions.Permissions` exists and is populated (microphone/camera/geolocation/notifications denied, `PermissionClipboardRead` allowed), but Wails v3.0.0-beta.15 implements `resolvePermission` only for Linux and Windows — there are zero darwin references. The option is kept because it is genuinely correct on Linux, where `wails3 task dev` runs; on macOS the real clipboard answer is WebKit's own user-gesture heuristics. |
| `window.open` deny | **Partial.** `MacWebviewPreferences.JavaScriptCanOpenWindowsAutomatically` is false, which denies JS-initiated windows; there is no per-request handler (no `WKUIDelegate createWebViewWithConfiguration:`). Still zero `window.open`, zero `target="_blank"` and zero `<a href>` in `src/renderer`/`src/shared`, and file pickers remain native dialogs via `FilesService`, not popups. |
| Navigation lock to the base URL | **No analogue — a real loss, already known.** There is no navigation-policy delegate on darwin at all (`webview_window_darwin.m` has no `decidePolicy`). This is weaker than the Electron `will-frame-navigate` guard plus fuses it replaces, and is recorded as a loss rather than mitigated. |
| `webviewTag: false` | **No subject.** |
| The spellchecker | **No analogue in the shell** — Wails exposes no spellcheck control. The mitigation moved into the renderer instead: `spellcheck="false"` on the field itself. The reason is unchanged: the connection dialog's password field becomes plain `type="text"` once the eye toggle reveals it. |
| WebGL off | **No subject.** |
| The seven `disable-*` Chromium switches | **No subject.** |
| `grantFileProtocolExtraPrivileges` | **No subject, and the whole class with it.** Assets are no longer served over `file://` — `shell/main.go` embeds `frontend/dist` and serves it through a plain Go `http.Handler` (`AssetOptions.Handler`), so the `file://`-module-CORS trap that made this fuse mandatory does not exist. |
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

**What actually holds this**, so a revert is never silent: `shell/internal/shell/security_test.go`
and `menutemplate_test.go` (the posture value and the packaged-vs-dev menu template — the successors
to the deleted `tests/unit/security.spec.ts`/`menu.spec.ts`, whose subjects moved to Go). There is
no Wails analogue of the old `tests/e2e/hardening.spec.ts`, and none was written: with the table
above reduced to "no subject" for most rows, there is nothing left for such a spec to assert that
the Go test does not already cover. The macOS-only behaviours — WebKit's clipboard gesture
heuristics, and the absent navigation delegate — have no automated coverage on any platform this
repo's CI runs.

## Testing

Five suites, under `tests/`: `unit/`, `db/`, `ipc/`, `ui/`, `e2e-real/`, plus the Go suite in
`shell/` (`bun run test:go`). `ipc/` is the odd one out — it is two suites in one directory, a
`node:test` backend half and a Playwright frontend half per adapter, sharing one fixture module by
design (P50, below).

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
`security.spec.ts` and `menu.spec.ts` are now `shell/internal/shell/security_test.go` and
`menutemplate_test.go`. A shared runtime stub (`tests/unit/support/wailsRuntime.ts`) registers a fake
`/wails/runtime.js` and is imported for its side effect by every spec that needs one, rather than
each spec declaring its own — Bun's module registry is shared across every spec file in one test
run, so whichever spec's stub loads first wins for the whole run.

**`tests/db/` needs a real external resource** — a Testcontainers-managed Docker container per
engine (`bun run test:db`, requires Colima on macOS or a Docker daemon on Linux). It is **entirely
untouched by the shell migration**: the adapters did not move, and Bun + Testcontainers is
unaffected by what the shell is written in. It also absorbed the former `tests/electron-db/`: the
Kafka spec now lives beside every other engine's as `tests/db/kafka.spec.ts`, and
`scripts/run-db-tests.sh` runs it esbuild-bundled under the vendored Node while the rest of the
directory runs under Bun. Bun still cannot load the Kafka driver's native addon at any ABI, but a
stock Node loads it with no ABI dance at all — the Electron-ABI rebuild step is gone.

One container per engine, one fixture module per engine that seeds a realistic dataset: wide tables,
`NULL`s, unicode, large text/blob, nested JSON, composite PKs, self-referencing and multi-hop FKs,
≥ 1 M rows in one table to exercise paging and counts. Scenarios per engine: connect/disconnect,
tree enumeration, describe, definition, first page, deep page, count, projection, sort, filter,
cancel-mid-query (asserted **server-side** — the query must actually be gone from `pg_stat_activity`
/ `SHOW PROCESSLIST` / `currentOp`), cache hit/miss behaviour, add/delete row, command preview
correctness. Local-only for now — no CI wiring in v1.

**`tests/ipc/`** (P50) splits each adapter's former all-in-one UI spec at the app's real wire
boundary — the control plane and the bulk-data plane (see Process model, above). Per adapter, one
folder holds three files: `<adapter>.backend.spec.ts` drives the real `handleFrame`/`dispatch` stack
against a real container with no renderer at all (`bun run test:ipc:be`, one vendored-Node process
per spec file — no Electron is involved any more, since the harness's own `src/main` imports are
gone and neither `engine/{control,rpc}.ts` nor any adapter ever imported `electron`; the separate
process per file is still needed because some adapters, sqlite and kafka, cannot load under Bun at
any ABI). The one thing that harness lost with `src/main` is the real tree cache-aside, which used
to come from `src/main/tree-service.ts`; it is now a Map-backed stand-in for
`shell/internal/tree.Service`'s cache-aside, since the real one is Go and this tier is TypeScript.
`<adapter>.frontend.spec.ts` drives the real Vue UI with both planes mocked, via `bun run
test:ipc:fe`, which needs no Docker, no container and no native driver; and `<adapter>.fixture.ts`
is the one file both halves import. That
fixture is **generated, never hand-written**: `KIRA_IPC_FIXTURES=write bun run test:ipc:be` captures
real responses from a real container and writes the module, and every subsequent run of the backend
spec asserts its own real responses against that same committed file. This is the tier's anti-drift
guarantee, stated once because it is easy to state wrong: **a frontend spec cannot mock a shape the
backend has stopped producing without that same fixture module's own backend assertion failing
first.** Wall-clock and other non-reproducible fields (timestamps, ephemeral ports, randomly
generated ids, approximate row-count estimates) are frozen to fixed placeholders in the fixture
after being validated structurally against the real value, never invented.

**`tests/e2e/` is gone** — the whole `_electron.launch()` tier, 23 spec files, was retired with the
Electron shell rather than ported wholesale. Every pure-UI spec has a verified `tests/ui/` port;
every full-stack-only spec has a named disposition, recorded here because two of them are losses:
`sqlite.spec.ts`'s and the postgres wiring value was recovered by the new `tests/e2e-real/` tier;
`s3.spec.ts`'s file-write contract (the engine writes the file itself, bytes never transit the shell
or the renderer) was recovered by a `tests/db/` case; **`mongo.spec.ts`'s full-stack anchor value was
not recovered**, and that is an accepted, documented loss. `hardening.spec.ts` and `startup.spec.ts`
were deleted outright with no analogue: there is no `webPreferences`, fuse or Chromium-permission
concept left to assert, and no `process.uptime()` equivalent — cold start is now a manual procedure
(`docs/PERF.md` §3).

**`tests/ui/`** (`bun run test:ui`) is its replacement for everything that ported: 36 tests across 18
spec files driving the **real built `shell/frontend/dist` bundle** — real Vue, real
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

**`tests/e2e-real/`** is the new full-stack *wiring* tier, and it is deliberately small — two specs
(sqlite, postgres). It builds the Go shell with `-tags server` (Wails v3's server build mode), which
serves both planes over plain HTTP and WebSocket to a plain Chromium tab with **no native window at
all**: a real Go backend, a real embedded engine child, a real adapter, a real container. That
recovers the wiring confidence `tests/e2e/` used to provide for these two engines at a small
fraction of the cost. It is not a UI-fidelity tier — that is `tests/ui/`'s job, which is why this one
uses Chromium rather than WebKit. Server mode has no file dialogs (`FilesService.ChooseSave`/
`ChooseOpen` answer a real HTTP 422), so a spec needing one stubs exactly that method through a
passthrough route that reuses `CHANNEL_TO_FQN` rather than re-deriving it.

**Parallelism.** `playwright.config.ts` runs three projects, all `fullyParallel`. `ui` being fully
parallel is a real change from the old `e2e` project's `workers: 1`, and it is earned rather than
inherited: that serialisation existed because concurrent Electron apps contend over wall-clock/RSS
budgets and Docker containers, and this tier has neither — the same reasoning that already made
`ipc-frontend` fully parallel. `e2e-real` runs `workers: 2`, safe because a per-test `KIRA_HOME` plus
`WAILS_SERVER_PORT` gives each instance its own SQLite app storage, its own secrets and its own
engine child.
