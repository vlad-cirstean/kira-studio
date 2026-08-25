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

## Adapter contract

Every engine is one directory under `src/engine/adapters/`, implementing the `Adapter` interface
(`src/engine/adapters/adapter.ts`). A `Caps` object (`src/shared/caps.ts`) declares what that
engine can do — `defaultPageKind`, `pagination` strategy, `canInsert`/`canUpdate`/`canDelete`,
`cancel`, `sql`, `definition`, `describe`, `fileTransfer` — and the UI reads *only* `Caps`, never a
`connection.kind` check, to decide what to show. `registry.ts` lazily `import()`s each adapter
directory so an unused engine's driver is never loaded into the engine process's baseline memory.

Full per-database mapping table (tree shape, pagination, exact count, cancel mechanism): SPEC.md
§5.1.

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

## Storage

`~/.kira-studio/kira.sqlite` (`0600`), via Drizzle. Credentials are encrypted at rest through
Electron's `safeStorage` (Keychain-backed on macOS); see SPEC.md §6 for the storage schema and the
secret-cipher design.

## Process model

Three processes: the Vue 3 renderer, an Electron main process (windowing, storage, IPC), and every
database driver isolated in its own `utilityProcess` ("engine"), reached over a `MessagePort`. See
SPEC.md §4 for the full diagram and rationale.
