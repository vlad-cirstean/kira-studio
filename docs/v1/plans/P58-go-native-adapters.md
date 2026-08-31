# P58 — DB adapters in Go, the Node engine sidecar removed

> **`docs/v1/SPEC.md` §10, the P58 row, verbatim:** *"Migrate the per-kind DB adapters (postgres,
> mariadb, mysql, clickhouse, mongodb, redis, kafka, sqs, s3, rabbitmq — `src/engine`'s TypeScript,
> running as a Node child process per P51's own deliberately-partial scope) into native Go, and
> remove the Node engine subprocess entirely: no vendored Node runtime, no stdio/JSON transport to a
> sidecar, adapters called in-process from Go."*
>
> This is the direct continuation of P51–P57. P51's own row named it: *"Incrementally migrating
> individual DB adapters out of the Node engine into native Go later (the per-kind
> `adapters/registry.ts` loader map is already the right shape for it) is named as the natural future
> direction this architecture leaves open, and is explicitly **not** designed in this phase."* This
> document designs it.
>
> Every count, line reference and code claim below was read out of the tree as it stands at the end
> of P57 (`git grep -c ""`, the actual files), not carried over from a prior plan's prose. Every Go
> library claim is marked **researched** (checked against the ecosystem now) or **must be proven in
> M0** (a named probe against a real container/broker before any product code depends on it). This
> repo's own standard from P55 §1.1 / P56 §1 / P57's preamble: a claim without a source is a guess,
> and this phase is far too large to be built on guesses.
>
> **Amendment, mid-phase, before M8 was planned or implemented:** RabbitMQ was dropped from v1's
> scope entirely — the connection kind, its TypeScript adapter, and every test/doc surface naming
> it were removed from the tree rather than ported to Go. It is never coming back as a Go-native
> adapter under this plan. Every count, table row and sequencing reference below that named
> RabbitMQ as one of the eleven kinds is now stale by exactly one kind; **ten kinds remain**, and
> M8 (§9) is SQS and S3 only. The SPEC.md quote above stays verbatim (docs/v1/ is never retro-edited)
> — it is a historical record of what v1 originally specified, not a current scope statement.

## 0. What this phase is, and what it is not

### 0.1 The three bodies of work

1. **A Go adapter substrate.** The `Adapter` interface, the `Caps` contract, the closed
   `AdapterError` code set, the columnar page codec (`TextColumnChunk` and its four builders), the
   op scheduler that today emits `op:start`/`op:end` over the wire, and the L2/L3 cache — all of it
   currently TypeScript inside `src/engine`, all of it moving into `shell/internal/`. That is
   **1 356 lines** the eleven adapters sit on top of (840 shared adapter modules + 410 cache + 106
   scheduler), and none of the eleven can move before it does. A further 600 lines
   (`control.ts`/`data.ts`/`rpc.ts`/`stdio-main.ts`) is the wire half: part of it — `data.ts`'s
   cache-aside discipline — is real behaviour that ports, the rest is transport that deletes.
2. **Eleven adapters, ported.** 12 891 lines of adapter TypeScript across eleven directories,
   rewritten against real Go drivers, each one keeping its own `Caps` row, its own error mapping, its
   own pagination strategy and its own cancellation mechanism exactly as `docs/ARCHITECTURE.md`'s
   per-engine table already documents them.
3. **The sidecar, removed.** `src/engine/` deleted; `shell/internal/enginehost/` (663 lines of
   spawner, framer, pending-call map, event fan-out and stream plumbing, plus 436 lines of its own
   tests and a 120-line fixture engine) deleted;
   `scripts/vendor-node.sh` and the vendored Node runtime deleted; `bun run build:engine` and its
   esbuild `--external` list deleted; `scripts/run-db-tests.sh`'s two-runtime split and
   `scripts/run-ipc-backend.sh` deleted; the Kafka native-module packaging gap
   (`AGENTS.md`'s P57 findings, still open) deleted along with the addon that caused it.

### 0.2 Not in this phase

- **No renderer feature change, and almost no renderer change at all.** §1.3 establishes that
  `src/shared/protocol/` survives as-is and that the whole diff under `src/` is one file
  (`src/renderer/bridge/port.ts`) plus the deletion of `src/engine/`. §7 makes that a checkable
  assertion rather than a claim.
- **No new adapter capability, no new engine, no new view.** Every `Caps` value is ported as-is
  except the two the Go ecosystem genuinely changes (D8, D14) — and both of those are *gains*,
  recorded as such, not features smuggled in.
- **No re-measurement gate.** The JSON-inflation fix (§1.4) is measured and recorded, not gated. A
  regression against Electron's old numbers is a bug to fix, not a reason to stop.
- **No `src/main`-style behavioural rewrite.** Where an adapter's TypeScript encodes a hard-won
  behaviour — redis's HSCAN reordering, kafka's EOF clamp, rabbitmq's `%2F` vhost encoding, sqlite's
  rowid fallback, s3's temp-file-then-rename download — the Go port reproduces it. §7's "what gets
  worse" is honest that this is the phase's single largest risk.
- **No `docs/v1/plans/p57-pending-ci-workflows/` resolution.** That directory is still present at
  the end of P57 (checked), meaning `.github/workflows/` is still stale from P57 M7. P58 makes it
  *more* stale (§4.9) and M11 owes the same staged-file treatment if this session's push scope is
  the same. It is not this phase's job to fix P57's OAuth-scope problem.

### 0.3 Why this is six sub-phases, not one — and the checkpoint that gates the deletion

P51–P57 split a comparably-sized migration into six phases, each with its own Opus plan, and
`AGENTS.md` forbids batching unrelated work into one phase. P58 is *larger* than P52–P57's `src/main`
port by line count (14 847 lines of engine TypeScript against P52's 3 406 lines of `src/main`), and
its risk is differently shaped: P52–P57 ported code whose behaviour was already pinned by a passing
test suite in the same language; P58 ports code whose behaviour is pinned by 12 888 lines of specs
that **do not port** — they exercise a TypeScript module directly.

Two things follow, and they are the reason for the shape of §9.

> **The coexistence property, and it is load-bearing.** The Node sidecar and Go-native adapters can
> serve different `ConnectionKind`s **simultaneously**, exactly the way Electron and Wails coexisted
> through P52–P56. §1.6 shows the mechanism is small and §4.6 designs it. This is what makes six
> sub-phases each independently shippable rather than one big-bang: an adapter ported to Go stops
> paying the sidecar hop the day it lands, while the other ten keep working untouched.

> **C1 — the coexistence proof.** After M5, one real Postgres connection is served end to end in Go —
> connect, tree, describe, definition, a paged read over the data plane, a count, a console batch, a
> staged mutation, a server-side cancel — **while the Node child is still running and still serving
> the other ten kinds in the same session.** If C1 cannot be reached, the substrate is wrong and the
> cost is one adapter, not eleven.

> **C2 — the zero-traffic proof.** Before M10 (the deletion milestone) starts, a full manual pass
> across all eleven connection kinds must leave `enginehost`'s own request counter at **zero** — the
> Node child is spawned, idle, and answers nothing. Deleting a sidecar that is still being called by
> a kind nobody remembered is the one failure this phase can make that looks fine in every test and
> breaks a real user's connection.
>
> **Amended, not reversed (`docs/v1/plans/P58f-cutover.md` D2, P58e's own OQ-2 asked the question).**
> There never was an `enginehost`'s own request counter — `enginehost` is a transport layer that
> cannot distinguish adapter traffic from lifecycle traffic, and three kind-agnostic paths (`ping`,
> `cache:configure`, `cache:clear`) survive a perfectly migrated app by design, so "the counter reads
> zero" was never a literal instrument that could exist. **P58e's own interim instrument is ratified
> as C2's permanent definition**: a warning-emitting counter lives in `adapterhost.Router`, counts
> only connection-scoped requests actually routed to the Node child, and logs a `slog.Warn` naming
> the kind and op on every one. That instrument itself is deleted in M10 along with everything else
> that references the Node child, once C2 has been run and recorded for the last time (P58e M9.4's
> own run: ten of ten kinds passed, the log line's grep returned 0, and the child was confirmed alive
> and idle throughout — not merely silent).

The sub-phases:

| Sub-phase | Scope | Why these together |
|---|---|---|
| **P58a** | The Go substrate + Postgres, the pathfinder | Nothing can move before the substrate. Postgres is the reference adapter (`caps.ts`'s own table is written postgres-first) and the only one that exercises *every* `Adapter` method including keyset pagination, side-connection cancellation, a query console and staged transactional mutations — so it proves the substrate rather than a subset of it |
| **P58b** | MySQL/MariaDB, SQLite, ClickHouse | The rest of the SQL family. They share `sql-text.ts`'s keyset planner and `sql-mutate.ts`'s guards with Postgres, so this sub-phase exercises the substrate three more times with **no new page shape and no new pagination strategy** — only new dialects. Grouped because dialect-porting is one skill applied three times, not three unrelated problems |
| **P58c** | MongoDB, Redis | The two adapters that produce a page shape the SQL family never does (`DocumentPage`, `KeyValuePage`) and that each carry their own hand-written expression language (`mongo/literal.ts`, 338 lines; `redis/console.ts`). Grouped because "a new page builder plus an original parser" is the same problem twice |
| **P58d** | SQS, S3 | The two *service-protocol* SQL-adjacent adapters sharing one SDK (`aws-sdk-go-v2`), with no new driver decision this plan has not already settled. (RabbitMQ was dropped from scope — see the amendment note above — so this sub-phase is smaller than originally planned) |
| **P58e** | Kafka | Alone, deliberately. It is the only adapter whose driver choice is a genuine decision (D7), the only one with a non-trivial consumer model, and the one carrying the still-open native-module packaging gap. Isolating it late means it can take a second pass without blocking the four sub-phases that do not depend on it — and it must land before P58f, because the cutover cannot happen while any kind is still Node-served |
| **P58f** | Cutover | `src/engine/`, `internal/enginehost/`, the vendored Node, the build and packaging steps, the test tiers and the docs. Everything whose removal is only safe once all ten kinds are native |

**Each sub-phase gets its own Opus plan under `docs/v1/plans/` before implementation**, per
`AGENTS.md`. That is not double-planning: it is this repo's own established shape for adapter work —
P8 (mongo), P9 (redis), P10 (kafka/sqs), P17 (s3), P34 (mysql), P35 (sqlite), P36 (clickhouse) and
P37 (rabbitmq) each got a dedicated plan for a *single* adapter, because a single adapter's driver
semantics are enough material for one. This document settles what those plans must not relitigate:
the substrate (§4.1–§4.6), the wire contract (D1–D5), the driver picks (D6–D8), the test story
(D12–D14) and the sequencing (§9).

## 1. What reading the current tree and the Go ecosystem found

### 1.1 The eleven adapters, measured

Counted for this plan with `git grep -c "" -- src/engine`, not estimated. **119 files, 14 847
lines** (SPEC.md's P51 row says 14 743 — the tree has grown 104 lines since P51 was written; the
larger number is current).

| Directory | Lines | Files | Notable |
|---|---:|---:|---|
| `adapters/postgres/` | 1 726 | 10 | the reference adapter; keyset, console, staged mutations, `pg_cancel_backend` |
| `adapters/mysql-family/` + `mariadb/` + `mysql/` | 1 782 | 22 | one shared core, two thin profiles (P34 D1) |
| `adapters/clickhouse/` | 1 473 | 10 | offset-only pagination, no addressable row, `KILL QUERY … SYNC` |
| `adapters/sqlite/` | 1 430 | 10 | `node:sqlite`, `caps.cancel === false`, rowid keyset fallback |
| `adapters/mongo/` | 1 382 | 10 | includes `literal.ts` (338 lines): a hand-written JSON5-lite/BSON-constructor parser |
| `adapters/rabbitmq/` | 1 209 | 9 | **no driver at all** — HTTP management API over `fetch` |
| `adapters/redis/` | 1 153 | 8 | `read.ts` alone is 394 lines: seven redis types plus s3-object reuse |
| `adapters/kafka/` | 1 150 | 8 | assign-at-offset browse, never joins a group (§1.7) |
| `adapters/s3/` | 915 | 8 | the only `caps.fileTransfer` engine; `transfer.ts` writes files itself |
| `adapters/sqs/` | 671 | 8 | the smallest adapter |
| `adapters/` shared (`adapter.ts`, `errors.ts`, `sql-text.ts`, `sql-mutate.ts`, `abort.ts`, `live.ts`, `registry.ts`) | 840 | 7 | the substrate M1 ports |
| `cache/` (`lru.ts`, `pages.ts`, `counts.ts`, `index.ts`) | 410 | 4 | L2/L3, M3 ports |
| `control.ts`, `data.ts`, `rpc.ts`, `scheduler/ops.ts`, `stdio-main.ts` | 706 | 5 | the wire half — M4 replaces, M10 deletes |

The two shared SQL modules are worth naming separately because they are the phase's densest
per-line risk: `sql-text.ts` (378 lines) holds `computeEffectiveOrder`, `assertKeysetSupported`,
`resolveFetchColumns`, `buildScanOrderBy`, `buildKeysetPosition`, `whereClause`, `parseCountValue`,
`primaryKeyFromIndexes` and `resolveKeyShape` — the keyset-eligibility rule and cursor arithmetic
that P39 iter3 and P48 collapsed out of four adapters into one place. `sql-mutate.ts` (138 lines)
holds `orderedOps`, `assertColumnsKnown`, `assertAffectedExactlyOne`, `assertKeyIsPrimaryKey` and
the `ValueRenderer`/`renderRowOp` dialect renderer. These two files are the highest-value port in
the whole phase and the one place `tests/unit/sql-text.spec.ts` already provides a dependency-free
oracle to port alongside them.

### 1.2 SPEC.md §10's own P58 row lists ten adapters; there are eleven

The row's parenthetical reads *"postgres, mariadb, mysql, clickhouse, mongodb, redis, kafka, sqs,
s3, rabbitmq"* — **`sqlite` is missing.** `registry.ts`'s `loaders` map has eleven entries
(re-counted for this plan), `docs/ARCHITECTURE.md`'s per-database mapping table has eleven rows, and
the sidecar cannot be removed while any one kind still needs it. This is a typo in the row, not a
scope decision; M11 fixes it. Naming it here so no sub-phase plan reads the row as a scope
authority and quietly leaves 1 430 lines behind.

### 1.3 The wire contract survives; exactly one field's *encoding* does not

This is the finding that bounds the phase's blast radius, and it is the P58 analogue of P57 §1.1.

Read for this plan across `src/shared/protocol/`:

- **`data-ops.ts` (202 lines) is unchanged.** `DATA_OP`'s nine op strings, `ReadRequestWire`,
  `CountRequestWire`, `PreviewRequestWire`, `MutateRequestWire`, `ExecuteRequestWire`,
  `ObjectDownloadRequestWire`, `PageCursor`, `CacheStats`, `PORT_EVENT.cacheStats` — every one of
  them describes what the renderer asks for and what it gets back. None of it says *who* answers.
- **`engine-ops.ts` (122 lines) is unchanged as a type surface**, and stops being a *wire* schema.
  `ENGINE_OP`'s eight strings and `ENGINE_EVENT`'s three are already consumed on the Go side through
  `enginehost/ops.go`'s own constant table; once the adapters are in-process, those constants
  describe a Go function call, not a frame. `ResolvedConnectionConfig` stays exactly as it is — it is
  the shape `internal/connections`' `resolve()` already builds.
- **`port.ts` (22 lines) is unchanged.** `PortRequest`/`PortResponse`/`PortEvent` are the data
  plane's own envelope and the data plane survives (D2).
- **`page.ts` (633 lines) keeps every type.** `TabularPage`/`DocumentPage`/`KeyValuePage`/
  `StreamPage`, `PagePosition`, `ColumnDescriptor`, `TextColumnChunk`, `isNull`/`cellText`/
  `isTruncated`/`chunkByteSize`/`pageByteSize`, `assertPageStructure` and every constant
  (`MAX_CELL_BYTES`, `MAX_PAGE_SIZE`, `OBJECT_BODY_PREVIEW_BYTES`, …) stay, because the renderer's
  grid, document, key-value and stream views read them directly. What leaves is the *builder* half —
  `ColumnScratch`, `createTabularPageBuilder`, `createDocumentPageBuilder`,
  `createKeyValuePageBuilder`, `createStreamPageBuilder`, `truncateUtf8ToBoundary` — which only ever
  ran inside the engine, and the four `*EnvelopeSchema` zod schemas, whose only consumer was the
  engine boundary.

**The one thing that does change is `TextColumnChunk`'s representation on the wire, and it changes
for the better** — see §1.4 and D5. That change is confined to `src/renderer/bridge/port.ts`'s
existing `reviveChunks` function, which P57 M4 already wrote for exactly this field.

The consequence: **`src/renderer/views/**`, `src/renderer/state/**`, `src/renderer/workbench/**`,
`src/renderer/bridge/{control,data}.ts` and every `.vue` file are untouched.** §7 checks this with a
`git diff --stat` assertion, the same instrument P57 §5.2 used.

### 1.4 The JSON-inflation regression is a Node-side artifact, and it disappears with the Node side

`docs/ARCHITECTURE.md`'s Process model section names this explicitly and names P58 as the fix:

> *"**Known regression: the engine stdio hop JSON-encodes bulk data.** … a binary blob inflates to
> roughly 5–6 bytes per original byte on the wire before `reviveChunks` even runs, plus the transient
> heap both the `stringify` and the `parse` need. This is a genuine memory and CPU regression against
> the Electron architecture and it is **not fixed** — the named direction is a future phase (P58)
> migrating the adapters to native Go, which removes the Node sidecar and this hop with it."*

`docs/v1/SPEC.md`'s P52–P57 row carries the measured figure: *"roughly 11x text inflation, 48x
transient heap inflation for a 100KB chunk, empirically measured."* The two numbers do not conflict
— 5–6× is the analytic per-byte cost of `{"0":1,"1":2,…}` for an arbitrary blob, 11× is the measured
figure for a real 100 KB chunk (small values encode to more characters per byte than large ones) —
and both should be reproduced against the same fixture in M2 rather than quoted at each other.

**Why the mechanism dissolves rather than merely moving.** Today a page crosses three encodings:
the engine's `JSON.stringify` (`stdio-main.ts`'s `writeFrame`), Go forwarding those bytes verbatim
(`bridge/stream.go`), and the renderer's `JSON.parse` + `reviveChunks`. After P58 a page is built in
Go memory by the same adapter that produced the rows and is encoded **exactly once**, at the
renderer boundary. There is no intermediate process, so there is no intermediate serialization.

**And the one remaining encode gets cheaper for free**, which is the part worth stating precisely
rather than assuming: Go's `encoding/json` marshals a `[]byte` as **base64**, not as an
object-keyed-by-index. A 100 KB `TextColumnChunk.data` becomes ~133 KB of base64 instead of ~1.1 MB
of `{"0":72,"1":101,…}`. The `offsets`/`truncated` fields are `[]uint32` and would marshal as JSON
number arrays (~7 bytes per 4-byte value), so D5 encodes all four buffers as base64 of their exact
little-endian bytes for one consistent, ~1.33× wire cost.

The transient-heap half improves by more than the wire half: Go writes the encoded frame directly
into the stream's buffer, and the renderer's decode is one `atob`-class pass into an exactly-sized
`Uint8Array` rather than building a 100 000-key JS object and then walking it with `Object.values`.

**This is the phase's motivating win, and it is worth being clear that it is not the only one.**
Removing the sidecar also removes: a second runtime in the bundle, a supervision state machine
(`enginehost/host.go`, 422 lines), a hand-rolled length-prefixed framer, a bounded-queue backpressure
scheme, a 64 MiB per-frame ceiling Electron never had (P54's finding), a native-addon ABI question,
an unresolved native-module packaging gap, and a whole second test-runner story. The inflation fix is
the one users would notice; the rest is what stops costing maintenance.

### 1.5 `registry.ts` really is the right shape, and so is the Go side it plugs into

P51's row claimed the per-kind loader map was "already the right shape" for incremental migration.
Checked: `adapters/registry.ts` is 33 lines, a `Partial<Record<ConnectionKind, (deps) => Promise<Adapter>>>`
with eleven entries and one `createAdapter(kind, deps)` function. It is a lookup table keyed on
exactly the value a Go router would key on.

The Go side is equally cooperative. `internal/connections/service.go` (532 lines) already routes
every control-plane operation through `s.deps.Host.Call`/`CallTimeout` — **five call sites**
(`onPreconnectExit`, `Remove`, `Test`, `attemptConnect`, `Disconnect`), all of them one line.
`internal/tree/service.go` (204 lines) does the same for children/describe/definition — **three call
sites**. Neither service parses an adapter's response beyond `json.Unmarshal`-ing it into a model
type it already owns. So swapping "call the Node child" for "call the in-process adapter" is a change
to **eight call sites plus one interface**, not a rewrite of either service. The remaining `Host`
consumers are `Subscribe` (`connections.watch`, `oplog.Start`), `PushCacheConfig` and `Alive`/`PID`
(`bridge/engine.go`) — four more, each a one-line swap.

*Corrected (P58a's OQ-2): there is a ninth call site, and it does not fit the "route by
`ConnectionKind`" model the other eight do.* `internal/bridge/ops.go:39`'s stop-button handler calls
`Host.Call(ENGINE_OP.cancel, {opId})` — a bare op id, with no connection id and therefore no kind to
route on. A kind-keyed router cannot answer "cancel op X" without first knowing which backend owns
op X. P58a resolves this (its own decision A13) by routing cancellation on **op ownership** — each
backend registers the op ids it started, and cancel is dispatched to whichever backend currently
owns the id — rather than by kind. Any later sub-phase's router work must preserve this: cancel is
the one operation that is never a kind lookup.

Worth recording because it is not obvious from the file names: `enginehost.Host` is *already*
effectively an interface at every call site (`Call`, `CallTimeout`, `Subscribe`, `Alive`, `PID`,
`AttachStream`, `SendData`, `Stop`). D4's router slots in behind that same shape.

### 1.6 The data plane's Go half is 46 lines, and it is the only thing that has to change to route per kind

`bridge/stream.go` is 46 lines. Its whole body is:

```go
func ServeEngineStream(host *enginehost.Host, conn StreamSession) {
	detach := host.AttachStream(conn)
	defer detach()
	for {
		frame, err := conn.Receive()
		if err != nil { return }
		if err := host.SendData(frame); err != nil { … }
	}
}
```

Go never unmarshals a data-plane frame in either direction — that is `docs/ARCHITECTURE.md`'s
current "Bulk data passes through Go, unread" invariant, which P57 D18 deliberately rewrote rather
than dropped.

**To route per kind, Go has to read each inbound *request*'s envelope.** A `DATA_OP.read` request is
a few hundred bytes (`opId`, `tabId`, `connectionId`, `path`, `projection`, `filter`, `sort`,
`pageSize`, `cursor`) and carries `connectionId` at the top level of `payload`; the outbound
*response* is where the bulk is. So the honest statement of what changes is narrower than it first
looks, and D3 makes it explicit rather than letting the invariant quietly lapse.

### 1.7 The Kafka adapter never joins a consumer group — the reason for the native addon was Kafka 4, not groups

This correction matters because it changes the Go driver decision, and because the assumption in the
other direction is easy to make.

Read from `adapters/kafka/read.ts` (337 lines) and `docs/v1/plans/P32-kafka-client-migration.md`:

- The browse consumer is constructed with a **constant** `group.id` (`kira-studio-browse`),
  `enable.auto.commit: false`, `enable.auto.offset.store: false`, `enable.partition.eof: true`,
  `auto.offset.reset: 'error'`, then `assign()`s exactly the partitions in its window at explicit
  start offsets and `consume(n, cb)`s until the page is full. `read.ts`'s own comment: *"No
  JoinGroup, no SyncGroup, no Heartbeat, no LeaveGroup, no OffsetCommit, no OffsetFetch — the broker
  never creates group state and `kira-studio-browse` never appears in `listGroups()`."*
- P32's own header states the two reasons for the native client: **Kafka 4 compatibility** (the
  group-join path is *precisely* what broke against a Kafka 4 broker) and `kafkajs` having stalled.
  `docs/ARCHITECTURE.md`'s Stack section says the same: *"`@confluentinc/kafka-javascript` (native,
  heavier, but actively maintained where `kafkajs` has stalled)."*
- P32 D13/D14 recorded two capability **losses** the new client forced: it exposes *no*
  `DescribeConfigs` and *no* `describeCluster` on either API surface, so a topic's Configuration
  section and the connection's cluster id have no replacement today.

So the requirement a Go Kafka client must satisfy is: **admin metadata** (topics with partitions/
leader/replicas/ISR, group listing, group describe), **watermarks** (per-partition low/high, and
offsets-by-timestamp), **direct partition consumption at exact offsets with per-partition
end-of-log detection**, and **produce with key + headers**. Consumer-group *membership* is
explicitly not required — which removes the single feature that most differentiates Go's Kafka
clients from each other. D7 decides on that basis.

### 1.8 Per-engine Go driver availability, researched

| Engine | Recommendation | Status | Notes |
|---|---|---|---|
| PostgreSQL | `github.com/jackc/pgx/v5` | **researched** | The de-facto standard; actively maintained through 2026. Cancellation stays the adapter's *existing* design — `SELECT pg_cancel_backend($1)` on a side connection — rather than `pgconn.CancelRequest`, which opens its own unencrypted socket (jackc/pgx#2340) and would change the connection's TLS posture. Use `pgx`'s native interface, not `database/sql`, for typed row scanning and `CopyFrom`-free explicit control |
| MariaDB / MySQL | `github.com/go-sql-driver/mysql` via `database/sql` | **researched** | The standard driver, wire-compatible with both servers, which is what makes the existing one-core/two-profile split (`mysql-family/` + two thin profiles) port unchanged. `KILL QUERY <threadId>` on a side connection needs only `SELECT CONNECTION_ID()` |
| SQLite | `github.com/mattn/go-sqlite3` | **researched; already in `shell/go.mod` (v1.14.50)** | Same unmodified SQLite amalgamation the app-storage layer already links, which is the whole reason `docs/ARCHITECTURE.md`'s Storage row says migrations "behave identically". D8 covers the interrupt-scoping hazard and the capability *gain* |
| ClickHouse | `github.com/ClickHouse/clickhouse-go/v2` | **researched** | Official, actively released (v2 published August 2026). Its context-cancellation story is weak (ClickHouse/clickhouse-go#1388: no way to cancel a running query via context), which is irrelevant here — the adapter already cancels with `KILL QUERY WHERE query_id = '<id>' SYNC` on a second connection, and that design ports unchanged and is *why* it was chosen in P36 |
| MongoDB | `go.mongodb.org/mongo-driver/v2` | **researched** | The official driver; v1 formally deprecated in 1.17.8, v2.6.x current in 2026. `bson.MarshalExtJSON` is the direct analogue of the `bson` npm package's `EJSON.stringify` the document page builder depends on |
| Redis | `github.com/redis/go-redis/v9` | **researched** | The maintained client (`redigo` is the older, lower-level alternative and is not recommended here). `SCAN`/`HSCAN`/`SSCAN`/`ZSCAN` iterators, `CLIENT KILL`, and full context plumbing |
| Kafka | `github.com/twmb/franz-go` + `pkg/kadm` | **researched; the assign-at-offset browse must be proven in M0** | D7 |
| SQS | `github.com/aws/aws-sdk-go-v2/service/sqs` | **researched** | Official, and `aws-sdk-go-v2/config`'s `WithSharedConfigProfile` is the direct analogue of the named-AWS-profile authentication the adapter already requires |
| S3 | `github.com/aws/aws-sdk-go-v2/service/s3` | **researched** | Same SDK. `GetObject`'s response body is an `io.ReadCloser`, so `transfer.ts`'s temp-file-then-rename download becomes `io.Copy` into an `os.CreateTemp` sibling plus `os.Rename` — structurally identical, no streaming primitive missing |
| RabbitMQ | **no library — `net/http`** | **researched** | The adapter has *no dependency today*: it speaks the `rabbitmq_management` HTTP API over `fetch`. `docs/ARCHITECTURE.md`'s RabbitMQ section explains why AMQP was never a candidate (AMQP 0-9-1 has no list-queues/list-exchanges/list-bindings at all). Go's own `net/http` + `net/url` covers it entirely, and `url.PathEscape` is a better home for the `%2F` default-vhost rule than a hand-rolled `encodeSegment()`. **This makes RabbitMQ the simplest of the eleven, not the hardest** — the opposite of the intuition its 1 209 lines suggest |
| Test containers | `github.com/testcontainers/testcontainers-go` | **researched** | Modules exist for postgres, mysql, mariadb, redis, mongodb, kafka, rabbitmq, clickhouse and localstack, all actively maintained through 2026. D12 |

**What is not a driver problem and must not be treated as one:** `AGENTS.md`'s Docker section
(`mirror.gcr.io` retagging, the ClickHouse `ulimit` subclass, the `403` on
`production.cloudfront.docker.com`) describes **daemon- and image-level** facts. Retagging happens
in the Docker daemon, so every one of those workarounds applies to `testcontainers-go` unchanged and
none of them needs re-deriving. The one that *does* change is the Bun-specific hang
(`@testcontainers/postgresql` never resolving under `bun run`, P57's finding): that is a Bun runtime
quirk with no Go analogue, so a Go test tier is expected to be *simpler* here, not harder — which is
worth confirming in M0 rather than assuming.

### 1.9 What `src/engine` holds that is not an adapter

Easy to under-scope, so enumerated:

- **`scheduler/ops.ts` (106 lines).** `runOp` mints an op id, emits `op:start`, runs the adapter call
  under an `AbortController`, emits `op:end` with status/duration/rows/command, and refuses a
  duplicate op id. `cancelOp` aborts locally *and* forwards to `adapter.cancel(opId)` — §5.1's rule
  that cancellation is never merely local. In Go this becomes `context.Context` plus a
  `map[string]context.CancelFunc`, and the two events become direct calls into `internal/oplog`
  instead of wire events (D10).
- **`cache/` (410 lines).** L2 (byte-budgeted page LRU, default 64 MB) and L3 (counts, 5-minute TTL,
  marked stale after a local mutation), plus a 1 Hz-throttled `cache:stats` emission. Not L1 — that
  is already `metadata_cache` in Go (`internal/storage/repos/metadata_cache.go` + `internal/tree`).
  `tests/unit/engine-cache.spec.ts` exists and is the direct oracle for the Go port.
- **`adapters/live.ts` (18 lines).** The `Map<connectionId, Adapter>` registry, Adapter rule 6.
- **`adapters/abort.ts` (43 lines).** `withAbortRace(ctx, run, opts)` — the cancel-arrives-after-the-
  callback-resolved race that postgres and mysql-family both hit. In Go this is `select` on
  `ctx.Done()` versus a result channel, i.e. the idiom rather than a helper; whether it stays a
  shared function is a P58a implementation call, not a design decision.
- **`control.ts`/`data.ts`/`rpc.ts`/`stdio-main.ts` (600 lines).** The wire half. `data.ts`'s
  cache-aside logic (the `handleRead`/`handleCount` hit/miss discipline, the
  `invalidateAfterMutation`-in-a-`finally` rule from P43 F12/D17) is real behaviour and ports; the
  rest is transport and deletes.

### 1.10 `tests/db/` is 12 888 spec lines, and it is a ready-made acceptance spec

`tests/db/` is 16 621 lines total across 36 files: eleven specs (12 888 lines), eleven container/
fixture support modules (1 438 lines) and eleven seed fixtures (2 279 lines). Per
`docs/ARCHITECTURE.md`'s Testing section, each spec covers *"connect/disconnect, tree enumeration,
describe, definition, first page, deep page, count, projection, sort, filter, cancel-mid-query
(asserted **server-side** — the query must actually be gone from `pg_stat_activity` / `SHOW
PROCESSLIST` / `currentOp`), cache hit/miss behaviour, add/delete row, command preview correctness"*
against a realistically seeded dataset (wide tables, NULLs, unicode, large text/blob, nested JSON,
composite PKs, self-referencing and multi-hop FKs, ≥ 1 M rows).

That is precisely the acceptance spec each ported adapter needs, and D12 makes porting it
**adapter-first-test-first**: an adapter's Go spec lands and fails before its Go adapter lands.

Two things about it are not portable and must be named rather than discovered:

1. **The seed fixtures are portable; the assertions' error *text* is not.** Adapter rule 4 requires
   the driver's message preserved verbatim, so every spec assertion that matches a driver error
   string is asserting a *JavaScript* driver's wording. Those must be re-baselined against the Go
   driver's own message, one at a time, never by loosening the assertion to a substring.
2. **`tests/db/sqlite.spec.ts` gates on `sqliteAvailable()`** because this sandbox's Bun lacks
   `node:sqlite`. A Go port has no such gate — `mattn/go-sqlite3` needs only cgo, already present.
   That is a strict improvement and should be recorded as one.

### 1.11 `tests/ipc/`'s backend half is the one test tier with no Go successor

`tests/ipc/<adapter>/<adapter>.backend.spec.ts` (seven adapters) *"drives the real
`handleFrame`/`dispatch` stack against a real container with no renderer at all"* — i.e. it imports
`src/engine/control.ts` and `src/engine/rpc.ts` directly. Once those files are gone, the tier's
subject is gone.

What is at stake is not the specs but the tier's **anti-drift guarantee**, stated in
`docs/ARCHITECTURE.md` as: *"a frontend spec cannot mock a shape the backend has stopped producing
without that same fixture module's own backend assertion failing first."* That property is what
makes the seven `*.frontend.spec.ts` specs — and, transitively, much of `tests/ui/`'s fixture
discipline — trustworthy. D13 preserves the property by moving the *generator* to Go while leaving
the `*.fixture.ts` files themselves in place, byte-compatible, exactly as P57 D15 preserved the tree
half of the same harness rather than dropping it.

### 1.12 What the sidecar's removal deletes outside `src/engine/`

Grepped, so M10 has a checklist rather than a memory:

| Item | Size | Fate |
|---|---:|---|
| `shell/internal/enginehost/` (`host.go`, `stream.go`, `frame.go`, `config.go`, `ops.go` + tests + `testdata/engine-fixture.mjs`) | 663 + 436 test + 120 fixture | **Deleted**; `ops.go`'s op-name constants move to the adapter package |
| `shell/internal/enginetest/` + `testdata/engine-fixture.mjs` | 309 lines | **Deleted** — a fixture engine with no engine to fix |
| `shell/main.go`'s `resolveEngine()`, `nodeVersion()`, `firstExisting()` and the `enginehost.Start` block | ~50 lines | **Deleted**; `deps.NodeVersion` retires with them |
| `scripts/vendor-node.sh` + `shell/runtime/node/` | vendored runtime | **Deleted** |
| `package.json`'s `build:engine` script and its `--external:` list | 1 line | **Deleted** |
| `package.json`'s ten runtime `dependencies` (`@aws-sdk/*` ×3, `@clickhouse/client`, `@confluentinc/kafka-javascript`, `bson`, `ioredis`, `mariadb`, `mongodb`, `pg`) + `@types/pg` + the `trustedDependencies` entry | — | **Deleted**; `dependencies` reduces to `zod` alone (still imported by `src/shared` and therefore by the renderer) |
| `scripts/run-ipc-backend.sh`, `scripts/run-db-tests.sh` | 2 scripts | **Deleted** (D12/D13) |
| `scripts/wails-dev-setup.sh`'s node/engine prerequisites | partial | **Edited** |
| `scripts/sign-bundle.sh` / `scripts/verify-packaging.sh`'s A1/A2/N1/N2 node-and-engine checks, including the honestly-flagged Kafka native-module `note` | partial | **Edited**; the Kafka note is deleted because its subject is |
| `docs/ARCHITECTURE.md` Stack / Invariants / Adapter contract / Per-engine facts / Process model / Testing | — | **Edited** (M11) |
| `.github/workflows/{ci,release}.yml` — still stale from P57 M7 (`docs/v1/plans/p57-pending-ci-workflows/` is present) | — | **Edited** or re-staged (§4.9) |

## 2. Decisions

**D1 — `src/shared/protocol/`'s types are unchanged, and this is a rule rather than an observation.**
§1.3 is the evidence. No `DATA_OP` string changes, no request or response interface changes, no page
type changes. A sub-phase that finds itself wanting a protocol change has found a substrate bug and
must fix the substrate — because the moment the protocol moves, `src/renderer/views/**`,
`tests/ui/`'s 18 spec files and `tests/ipc/`'s seven fixture modules all come into scope, and this
phase is far too large to also be a renderer phase. The single exception is D5's encoding change,
which is deliberately confined to one function that already exists for this exact field.

**D2 — the data plane stays a stream. It does not become bound calls.** The tempting reading is
that with no separate process there is no reason for a raw byte channel. Four things say otherwise,
and the fourth is decisive:

1. **`cache:stats` is an unsolicited push** (`PORT_EVENT.cacheStats`, emitted at up to 1 Hz by
   `cache/index.ts`'s throttled emitter and consumed by the status bar and the settings dialog).
   Bound calls are request/response only; a push needs `Events.On` — and `AGENTS.md`'s P57 findings
   record, twice and emphatically, that `tests/ui/`'s `mockRuntime.ts` *"has no `Events.On`
   (push-event) mechanism at all — a structural gap, not a per-scenario mocking gap."* Moving
   `cache:stats` onto events would make it structurally untestable in the tier that tests it.
2. **Every bound-call error is a real HTTP 422** (`transport_http.go`, P57's finding), which the
   webview's devtools logs as a failed resource load whether or not the page catches it. A stop
   button that cancels a read produces a *handled* `E_CANCELLED` — routine, and it would become
   console noise on every cancel.
3. **There is no serialization saving.** Wails marshals a bound method's return value with
   `encoding/json` over HTTP (`runtime.ts`'s `JSON.stringify` body, `transport_http.go`'s response);
   the stream marshals with `encoding/json` too. The bytes are the same bytes. The win in §1.4 comes
   entirely from deleting the Node hop, not from the choice of Wails primitive.
4. **`src/renderer/bridge/{port,data}.ts` stay put.** D1's whole point. Moving the data plane onto
   bindings would rewrite `port.ts` completely and touch `data.ts`'s thirteen importers' error
   semantics. Keeping the stream means `port.ts`'s diff is D5's decoder and nothing else.

*Named alternative, rejected:* a third Wails primitive (a second named stream for pushes, bound calls
for requests). It buys nothing over one stream and doubles the transport surface.

**D3 — `bridge/stream.go` survives, repurposed from a byte forwarder into the data-plane server; and
`docs/ARCHITECTURE.md`'s bulk-data invariant is rewritten, not quietly dropped.** P52 §7.2 → P57 D18
already set the precedent that this invariant gets *rewritten with evidence* each time the
architecture moves under it. Its current text — *"Bulk data passes through the Go process without
being parsed, copied or re-encoded"* — has no subject once Go is the producer. The replacement, which
must land in the same commit as the code:

> **Bulk data is produced and encoded exactly once, in the process that owns the window.** A result
> page is built in Go by the adapter that read it, held in the Go-side L2 cache as native structures,
> and serialized a single time when a renderer asks for it. There is no second process, no
> intermediate encoding, and no re-decode.

This is a strictly stronger guarantee than the one it replaces, and §1.4's measurement is what backs
it. The narrower, honest statement about *requests* belongs beside it: Go now parses every
data-plane request envelope, because it is the thing answering them.

**D4 — Go-native and Node-served adapters coexist, routed by `ConnectionKind`, for the whole
migration.** §1.5's evidence: `registry.ts` is a kind-keyed lookup and the Go side calls the host
from nine places behind one shape. §4.6 designs the router. This is what makes P58a–P58e each ship
value independently instead of being five months of unlanded work, and it is the same shape that let
Electron and Wails coexist through P52–P56 — a shape this repo has already proven it can operate.

*The cost, named:* during the migration, `internal/enginehost` and the Go adapter host both exist,
and a bug can hide in the seam between them. The mitigations are C2 (§0.3) and the router's own
single-source-of-truth kind table (§4.6), not vigilance.

**D5 — `TextColumnChunk`'s four buffers travel as base64 of their exact little-endian bytes.** §1.4.
`data` and `nulls` are `[]byte` and Go's `encoding/json` already does this; `offsets` and `truncated`
are `[]uint32` and get an explicit `MarshalJSON` that writes the same base64-of-LE-bytes form, so all
four decode through one renderer-side function rather than two. `src/renderer/bridge/port.ts`'s
`reviveChunks` — written by P57 M4 for precisely this field, recognising a chunk by its four field
names appearing together — keeps its recognition logic and swaps its `toTypedArray` body from
`ctor.from(Object.values(v))` to a base64 decode. Everything downstream (`assertChunkStructure`,
`cellText`, `isNull`, `isTruncated`, `chunkByteSize`) sees real `Uint8Array`/`Uint32Array` exactly as
it does today.

*Amended (P58a's OQ-3): this is a narrowing, not a same-day swap.* D4's coexistence property means
the ten still-Node-served kinds keep emitting the old index-keyed JSON form (`{"0":1,"1":2,…}`)
throughout P58a-P58e, while the newly-native kinds emit base64 as each one lands. `reviveChunks`
therefore carries **both** decode branches for the whole coexistence window — detecting which form
it received (a base64 string is not a JS object with numeric-string keys) rather than assuming one —
and only P58f, once every kind is native, deletes the index-keyed branch as dead code. Any sub-phase
plan that reads this decision as "the decoder becomes base64-only at M2" has read it wrong; M2 makes
base64 the format *newly-native* adapters use, nothing more.

*Named alternative, deliberately deferred:* a binary envelope on a raw `Stream('engine')` — a JSON
header frame plus the chunk bytes appended verbatim — which would take the wire cost from ~1.33× to
1.0×. Rejected **for this phase** on three grounds: it reopens P57 D2 (whose reasoning — malformed
frames raising `error` inside `_decode` instead of throwing in the poll dispatch — is unrelated to
this phase and still correct); it makes `tests/ui/`'s `mockStream` fake speak a hand-rolled binary
format; and the remaining win is 25% of a cost that D5 has already cut by ~88%. It should be
revisited only if M2's own measurement shows the base64 encode itself on a profile, and the plan
that revisits it owns that measurement.

**D6 — one driver per engine, taken from §1.8's table, and every one of them is either already a
dependency or the ecosystem's clear default.** `shell/go.mod` gains eight modules and loses none:
`pgx/v5`, `go-sql-driver/mysql`, `clickhouse-go/v2`, `mongo-driver/v2`, `go-redis/v9`, `franz-go`
(+ `kadm`), `aws-sdk-go-v2` (config + s3 + sqs), and `testcontainers-go` (test-only). `mattn/go-sqlite3`
is already there. RabbitMQ adds nothing. `package.json`'s ten runtime dependencies all leave (§1.12).
The net dependency count across both ecosystems falls.

> **Superseded (`docs/v1/plans/P58b-mysql-sqlite-clickhouse.md` B7, then closed by implementation —
> P58f OQ-1 table).** This sentence's `mattn/go-sqlite3` line did not survive contact with a real
> probe: §1.5 of P58b found it coerces SQLite's storage-class-faithful values to the column's
> *declared* type, which the adapter's value codec cannot tolerate, and `modernc.org/sqlite` (pure
> Go) does the faithful thing by default. B7 picked `modernc.org/sqlite` for the adapter alone,
> still expecting `mattn/go-sqlite3` to remain for `internal/storage`'s own database — but that
> module shipped for both consumers by the time the migration finished, making the whole product's
> own Go code cgo-free (only Wails' own macOS bindings still need `CGO_ENABLED=1`), a materially
> better outcome than this decision predicted. `mattn/go-sqlite3` is not in `shell/go.mod` at all
> as of P58f M10.

**D7 — Kafka uses `github.com/twmb/franz-go` with `pkg/kadm`.** This is the phase's highest-risk
single decision and it gets the most reasoning.

*What the adapter actually needs* (§1.7): admin metadata, per-partition low/high watermarks,
offsets-by-timestamp, direct partition consumption at exact offsets with per-partition end-of-log
detection, produce with key and headers. Consumer-group **membership** is not needed at all.

*Why franz-go:*

- **It is pure Go.** No cgo, no `librdkafka`, no `.node` addon, no ABI question, and — directly —
  `AGENTS.md`'s still-open finding that *"no build step in this repository vendors
  `@confluentinc/kafka-javascript`'s native module … a real packaged build today would have Kafka
  connections fail at `require()` time"* stops existing rather than being fixed. That finding's own
  closing words are *"plausibly moot once a future phase removes the Node engine sidecar entirely"*;
  choosing a pure-Go client is what makes it moot rather than relocating it into a Go cgo build.
- **`kgo.ConsumePartitions` is a direct expression of what `read.ts` already does.** Its own
  documentation describes it as *"a way to explicitly consume from subsets of partitions in topics,
  or to consume at exact offsets"*, and it is explicitly incompatible with group consuming — which is
  the correct constraint for this adapter, not a limitation. `read.ts`'s `assign()`-with-explicit-
  offsets loop maps onto it one for one.
- **`kadm` covers the whole admin surface, including the two things the current client cannot do.**
  `ListStartOffsets`/`ListEndOffsets` replace `fetchTopicOffsets`; `ListOffsetsAfterMilli` replaces
  `fetchTopicOffsetsByTimestamp`; `ListGroups`/`DescribeGroups` replace `listGroups`/`describeGroups`;
  and `DescribeTopicConfigs`/`DescribeCluster` **recover the two capabilities P32 D13/D14 recorded as
  outright losses** — a topic's Configuration section and the connection's cluster id. A migration
  that gives back documented losses is a materially better outcome than one that merely preserves
  parity, and it should be claimed in `docs/ARCHITECTURE.md` when it lands, not silently.
- **Per-partition end-of-log detection gets *stronger*.** Today the adapter relies on librdkafka's
  `partition.eof` event plus a `MAX_EMPTY_POLLS` heuristic to notice a compacted or retention-deleted
  hole inside `[next, end)` (P43 iter2 F19/D26). franz-go's `FetchPartition` carries
  `HighWatermark` on every fetch response, so "this partition has nothing more before the frozen
  end" is a value read off the response rather than an event that may or may not fire. The
  `MAX_EMPTY_POLLS` fallback should be ported anyway — it costs nothing and the bug it was written
  for was real — but it stops being load-bearing.
- **Int64 offsets stop needing a guard.** `read.ts`'s `toNativeOffset` exists only because the native
  JS API types offsets as `number` and a silent truncation would produce *"a page of
  plausible-but-wrong messages, the worst failure mode a DB client can have"*. Go's `int64` makes the
  whole function unnecessary. Delete it; do not port it.

*Named alternatives and why not:*

- **`confluentinc/confluent-kafka-go`** — the same `librdkafka` the current Node addon wraps, so
  behavioural parity would be maximal and the port most mechanical. Rejected because it is cgo: it
  reintroduces exactly the class of dependency this phase exists to delete, it makes cross-compiling
  and code-signing a nested binary a live concern again, and it would keep a variant of the packaging
  gap alive. Choosing it would mean the phase removes a native module from the Node side and adds one
  to the Go side. It stays the named fallback if M0's probe fails, and the fallback's cost — a cgo
  dependency and a re-opened packaging question — must be written down at the moment it is taken, not
  discovered later.
- **`segmentio/kafka-go`** — pure Go, actively released (April 2026), and the most commonly
  recommended for simplicity. Rejected on admin surface: its design centres on `Reader`/`Writer`
  abstractions built for group consumption, and its administrative API (topic metadata, group
  describe, offsets-by-timestamp) is thinner than `kadm`'s. This adapter is 90% admin work and 10%
  consumption, which is the shape franz-go serves best and kafka-go serves least.

*What M0 must prove before P58e starts* (a throwaway Go program against a real `confluentinc/cp-kafka`
container, pulled via `mirror.gcr.io` per `AGENTS.md`): list topics with partition metadata; list and
describe groups; read start/end offsets; resolve offsets by timestamp; consume a bounded batch from
two named partitions at exact start offsets **without any group ever appearing in `ListGroups`**;
read `HighWatermark` off a fetch; produce a record with a key and two headers; describe a topic's
configs.

**D8 — SQLite is `mattn/go-sqlite3`, each op gets its own dedicated connection, and `caps.cancel`
becomes `true`.** Three parts:

1. **The driver.** Already in `go.mod`, already linking the same amalgamation the app-storage layer
   uses, which is what `docs/ARCHITECTURE.md`'s Storage row leans on. A second SQLite implementation
   (`modernc.org/sqlite`, pure Go) in the same binary would be a needless second copy with different
   edge-case behaviour.
2. **The capability change.** `docs/ARCHITECTURE.md` currently states, correctly, that
   `caps.cancel` is *"permanently `false`: `node:sqlite` has no `sqlite3_interrupt` and the whole API
   is synchronous … this is a fact about the driver, not a gap."* That fact was about `node:sqlite`,
   and it stops being true. `mattn/go-sqlite3` honours `context.Context` in `QueryContext`/
   `ExecContext` and interrupts the running statement. So SQLite gains a real, server-side stop
   button and its `caps.cancel` flips to `true`. This is the phase's one genuine capability
   *addition*, and it must be landed with the `docs/ARCHITECTURE.md` sentence rewritten in the same
   commit — a stale "permanently false" would be worse than no comment.
3. **The hazard, and the mitigation, both named.** `sqlite3_interrupt` is *connection-wide*, not
   statement-wide, and `mattn/go-sqlite3` has a documented history here (issues #488 "context
   cancellation can cause subsequent operation to fail", #745 "racy context cancellation", #681
   "misuse of sqlite3_interrupt"): a cancellation goroutine outliving its statement can interrupt the
   *next* query on the same connection. The mitigation is structural, not a retry: **every op
   acquires its own `*sql.Conn` from the pool for its whole lifetime and returns it at the end**, so
   an interrupt can only ever reach the statement it was aimed at. The `tests/db/sqlite.spec.ts`
   port must include a case that runs a cancel and then immediately runs an unrelated query on the
   same adapter, asserting the second one succeeds — the exact regression those issues describe.

> **Part 1 superseded, parts 2 and 3 ported onto the replacement driver
> (`docs/v1/plans/P58b-mysql-sqlite-clickhouse.md` B7/§1.5).** The driver is `modernc.org/sqlite`,
> not `mattn/go-sqlite3` — see D6's own amendment for why. Parts 2 and 3 both survive, restated
> against the actual driver: `modernc.org/sqlite` also has no side-connection cancel mechanism, so
> `caps.cancel` still flips from the old `node:sqlite`-era permanent `false` to a real `true`, now
> through the driver's own `interruptOnDone` semantics turning a cancelled per-op context into a
> real `sqlite3_interrupt` (`shell/internal/adapters/sqlite/adapter.go`). The hazard is the same
> shape under a different driver — `sqlite3_interrupt` is still connection-wide, not
> statement-wide — so the mitigation is unchanged: every op still gets its own dedicated `*sql.Conn`
> for its whole lifetime. The specific `mattn/go-sqlite3` GitHub issue numbers this section cited
> (#488, #745, #681) document the hazard in the driver that was *not* shipped; they no longer apply
> literally, but the class of bug they describe is exactly what the per-op-connection mitigation
> still guards against.

**D9 — the L2/L3 cache moves into Go as `shell/internal/enginecache`, and `cache:configure` stops
being a wire op.** `cache/lru.ts`'s byte-budgeted `Map`-backed LRU has a direct Go shape (a map plus
`container/list`, or an insertion-ordered slice — an implementation call). Two behaviours must port
exactly because tests already pin them: the *"an entry larger than half the budget is not cached at
all"* refusal, and `invalidateAfterMutation`'s pages-drop-but-counts-only-marked-stale asymmetry
(P43 F12/D17, which is in a `finally` deliberately). `enginehost.PushCacheConfig` (called from
`main.go` at startup and on a settings change) becomes a direct method call.
`tests/unit/engine-cache.spec.ts` is the oracle for the port and is deleted once its Go successor
passes the same cases.

**D10 — the op scheduler becomes `context.Context` plus a cancel registry, and `op:start`/`op:end`
become direct calls into `internal/oplog` rather than wire events.** `internal/oplog/wire.go` (199
lines) currently subscribes to `enginehost.Host.Subscribe()` and reconciles those two topics into
`op_log` rows. After P58 the adapter host calls it directly. Two properties must survive verbatim,
because both were paid for: `runOp`'s duplicate-op-id refusal (*"a duplicate id would corrupt the op
log's primary key and let the stop button cancel the wrong query"*), and `cancelOp`'s two-step —
abort locally **and** call `adapter.cancel(opId)`, because §5.1's rule is that cancellation is always
forwarded to the server. `oplog`'s own engine-down reconciliation path loses its trigger and needs a
replacement: with no child process to exit, the "mark every in-flight op as failed" case now fires on
adapter-level connection loss instead. Deciding exactly which signal replaces `EventEngineDown` is a
P58a design item, not an implementation detail to discover at M10.

**D11 — `mongo/literal.ts` is ported to Go by hand, not replaced with a library and never with
anything `eval`-shaped.** 338 lines: a tokenizer and recursive-descent parser for Mongo shell-style
literal text — unquoted keys, single-quoted strings, comments, and a closed set of BSON constructor
calls (`ObjectId(...)`, `ISODate(...)`, `Decimal128(...)`, `Long(...)`). Its own header states the
reason: *"No eval, no Function, no third-party expression evaluator — user-supplied console/filter
text must never reach a JS evaluator."* The same rule holds in Go and for the same reason. This is
the single largest piece of genuinely original logic in the eleven adapters, it is the one place a
subtle port bug would be least visible, and it clears `AGENTS.md`'s own unit-test bar without
argument (*"a parser or splitter with several interacting lexical rules"*) — so it gets a real Go
unit test with the same cases the existing tokenizer's behaviour implies, written before the port.

**D12 — `tests/db/` becomes Go tests under `shell/internal/adapters/<engine>/`, driven by
`testcontainers-go`, ported adapter by adapter *before* that adapter's Go implementation.** The
scenario list (§1.10) is the acceptance spec; the seed fixtures (`tests/db/fixtures/`, 2 279 lines of
SQL and TS seeders) port to Go seeders reading the **same `.sql` files**, unchanged, so the dataset
a Go adapter is judged against is byte-identical to the one its TypeScript predecessor passed. Three
rules:

- **Test-first, per adapter.** The Go spec lands and fails, then the adapter lands and it passes.
  This is the only mechanism that catches a lost behaviour, because a Go adapter written first will
  always look correct to its own author.
- **Error-text assertions are re-baselined, never loosened.** §1.10's second point.
- **`tests/db/<engine>.spec.ts` is deleted only when its Go successor passes**, per adapter, in the
  sub-phase that ports that adapter — never as a batch in M10.

*Named alternative, rejected:* keeping `tests/db/` as-is and testing the Go adapters only through the
wire protocol (the `tests/e2e-real/` shape). Rejected because `tests/db/`'s value is precisely that
it reaches *below* the wire — its cancel cases assert server-side (`pg_stat_activity`, `SHOW
PROCESSLIST`, `currentOp`), which no wire-level test can see.

**D13 — `tests/ipc/`'s backend half moves to Go and keeps generating the same `*.fixture.ts` files.**
§1.11. The seven `*.backend.spec.ts` files are replaced by a Go equivalent that drives the same
sequence against the same containers and writes the same fixture modules, so:

- the seven `*.frontend.spec.ts` specs and the seven `*.fixture.ts` modules **do not change**;
- `KIRA_IPC_FIXTURES=write` keeps working, from `go test` instead of `run-ipc-backend.sh`;
- the anti-drift guarantee survives with its exact wording intact.

The fixture files' formatting convention (raw `JSON.stringify` then `bunx biome check --write`,
`AGENTS.md`'s note) carries over — a Go writer emits the same shape and the same Biome pass runs
after it. The adapter-specific non-determinism freezes already recorded (`sortStreamByKey` for
kafka's arrival-order interleave, ClickHouse's `.inner_id.<uuid>`, kafka's coordinator host:port,
redis's HSCAN reordering) must be reproduced in the Go generator, and are the most likely thing to be
forgotten.

**D14 — `EngineService.Status()` stays bound and stays honest.** The renderer's status pill reads
`engineStatus` (`{alive, pid}`) — the very pill P57 existed to un-stick. With no child process,
`alive` becomes `true` once the adapter host is constructed and `pid` becomes the app's own pid: the
engine *is* this process now. That is one line of Go, keeps `control.ts` and
`workbench/state/engine.ts` out of the diff (D1), and is not a lie. Retiring the pill entirely is a
UI decision for a later phase, and this plan deliberately does not make it. `AppService.Info`'s
`NodeVersion` field, by contrast, has no honest value left and is removed — checked, and
`docs/v1/plans/P57-cutover.md` D7 already records that `control.appInfo` has **zero callers** in
`src/renderer`, so nothing observes it.

> **Corrected premise (`docs/v1/plans/P58f-cutover.md` §1.9, ratified as P58f D11).** This
> paragraph names the wrong surface. `EngineService.Status()` — the bound call returning `{alive,
> pid}` this paragraph fixes — has **zero renderer callers**;
> `tests/ui/support/bootSnapshots.ts:21` says so outright (*"`engineStatus` is deliberately absent —
> nothing in the renderer ever calls it"*), confirmed against the real source:
> `workbench/state/engine.ts` reads the status pill from the **data-plane `ping`**'s
> `PingPayload.enginePid`, not from this bound call at all; `bridge/control.ts`'s `engineStatus`
> binding was already dead code before P58. Fixing `Status()` alone, as written above, would leave
> the pill reading `down` on every launch once the child it pings stops existing, since nothing
> forwards `ping` in-process. `EngineService.Status()` still stays bound, for the reason given above
> (deleting a bound service costs a binding regen and a `control.ts` edit for nothing) — but the
> change that actually keeps the pill honest is answering the data-plane `ping` locally, which is
> what `docs/v1/plans/P58f-cutover.md` D11 does.

**D15 — the vendored Node runtime, `build:engine`, the two shell test scripts and the Kafka
native-module packaging gap all retire in the same milestone.** They are one thing wearing four
names: every one of them exists only because a Node process runs adapter code. Splitting them across
milestones would leave `verify-packaging.sh` asserting a `runtime/node/bin/node` that a passing build
no longer produces — the same class of half-applied-cutover failure P57 §0.3 was written to prevent,
and P57 D11 applied to the bundle identity for the same reason.

**D16 — every adapter call runs behind a `recover()` at the op boundary.** Today an adapter panic
kills a child process and `enginehost` reports `E_ENGINE_DOWN`; every connection errors, and the
window, the tabs, the settings and the op log all survive — `docs/v1/plans/P51-wails-go-node-engine-spike.md`
names that blast radius as one of the architecture's virtues. After P58 the same panic takes the
whole app down with the user's unsaved tab state. `runOp`'s Go successor recovers, logs the panic
with its stack under `scope=adapter`, and converts it to an `E_INTERNAL` `AdapterError` for that one
op. This does not restore the old isolation — §7 says so plainly — but it converts "the app
disappears" into "one operation failed", which is the difference that matters to a user.

*Resolved (P58a's OQ-1): `E_INTERNAL` is not one of `errors.ts`'s eight closed `AdapterErrorCode`
values, and it stays that way.* The wire keeps carrying the literal string `"E_INTERNAL"` on a
recovered panic without widening the TypeScript type — `viewOp.ts`'s `classify` already treats any
unrecognised code as `kind: 'error'`, which is the correct renderer behaviour for a fault the closed
set was never meant to name. Adding a ninth code to a set every sub-phase's adapter is written
against would be a wider, riskier change for a case that should never fire in a correctly-ported
adapter.

**D17 — validation at the adapter boundary is hand-written Go decoders, matching
`internal/storage/model/`'s established precedent, not a zod-equivalent library.** `docs/ARCHITECTURE.md`'s
Validation row already reads *"Zod (TypeScript side) / hand-written model decoders (Go side)"* and
already records that P52–P57 moved SQLite row validation this way, with P55 §1.6's reasoning that
*"a naive `json.Unmarshal` is not a substitute for zod's `safeParse`"* — the explicit validators are
what make the "reject the bad row" path reachable at all. The same discipline applies to
`readRequestWireSchema` and its seven siblings: each becomes a `Validate()` on a Go request struct.
After M10, the Validation row's TypeScript half narrows to connection-dialog input only.

**D18 — the eleven adapters keep their current file decomposition.** `client.ts`/`catalog.ts`/
`read.ts`/`query.ts`/`mutate.ts`/`definition.ts`/`console.ts`/`errors.ts`/`caps.ts`/`index.ts` become
`client.go`/`catalog.go`/`read.go`/… in a package per engine. This is not aesthetic: P39's three
iterations and P48's audit put specific logic in specific files for specific reasons, and a
port that also reorganises loses the ability to diff a Go file against its TypeScript ancestor when
something behaves differently — which, on a 14 847-line port, is the debugging tool of last resort.
Reorganisation is a P59 code-review outcome, not a P58 one.

**D19 — `mysql-family/`'s one-core-two-profiles structure is preserved.** `mariadb/` and `mysql/`
are 68 and 69 lines respectively — a server label and an `applyEngineOptions`, re-exporting
everything else. Go's equivalent is one `mysqlfamily` package plus two tiny packages holding a
`Profile` struct. Collapsing them into one adapter with a `kind` switch would undo P34 D1 for no
gain and would make the MySQL-has-no-SEQUENCE-engine difference an `if` instead of a profile value.

**D20 — no adapter gains a connection pool it does not have today.** Each adapter is
single-connection (Adapter rule 6: *"one instance ↔ one `connections` row"*), with side connections
used only for cancellation. `database/sql` hands out a pool by default, so every SQL adapter must set
`SetMaxOpenConns` explicitly to match today's shape — sqlite additionally per D8. Getting this wrong
is invisible until a user's server hits a connection limit they did not expect from a client showing
one connection in its UI.

## 3. Target tree

```
shell/internal/adapters/                  NEW   the substrate + ten engines
  adapter.go              NEW  the Adapter interface, OpCtx, ConnectInfo, ReadRequest, CountRequest,
                               TreeChildren, and Adapter rules 1-8 carried over as doc comments
  caps.go                 NEW  Caps + the ten cap literals (one per engine package)
  errors.go               NEW  AdapterError, the closed code set, mapError contract, unsupported(),
                               noQueryConsole(), assertWritable(), assertNotCancelled(),
                               throwIfCancelled(), requireConnected()
  registry.go             NEW  kind -> constructor, registry.ts's successor (33 lines -> ~40)
  live.go                 NEW  the map[connectionID]Adapter (live.ts)
  sqltext.go              NEW  sql-text.ts (378 lines): keyset planning, whereClause, order rules
  sqlmutate.go            NEW  sql-mutate.ts (138 lines): op ordering, guards, dialect rendering
  postgres/     …/mysqlfamily/ …/mariadb/ …/mysql/ …/sqlite/ …/clickhouse/
  mongo/        …/redis/  …/kafka/  …/sqs/  …/s3/
shell/internal/page/                      NEW   the columnar codec (page.ts's builder half)
  chunk.go                NEW  TextColumnChunk + base64 marshalling (D5)
  builder.go              NEW  the four page builders, ColumnScratch, UTF-8 boundary truncation
shell/internal/enginecache/               NEW   L2 pages + L3 counts (cache/, D9)
shell/internal/adapterhost/               NEW   runOp/cancelOp, the data-op dispatcher, the
                                                per-kind router (D4), the cache-aside from data.ts
shell/internal/bridge/stream.go           REWRITTEN  data-plane server, not byte forwarder (D3)
shell/internal/bridge/engine.go           EDITED     Status() reports this process (D14)
shell/internal/connections/service.go     EDITED     nine Host.Call sites -> the adapter host
shell/internal/tree/service.go            EDITED     three Host.Call sites -> the adapter host
shell/internal/oplog/wire.go              EDITED     direct calls, not event subscription (D10)
shell/internal/enginehost/                DELETED    (M10)
shell/internal/enginetest/                DELETED    (M10)
shell/main.go                             EDITED     resolveEngine/nodeVersion/enginehost.Start out
shell/go.mod                              EDITED     eight modules in, none out

src/engine/                               DELETED    119 files / 14 847 lines (M10)
src/renderer/bridge/port.ts               EDITED     reviveChunks decodes base64 (D5) — the ONLY
                                                     src/ edit in the whole phase
src/shared/protocol/**                    UNCHANGED  D1 — proof, not aspiration
src/renderer/{views,state,workbench}/**   UNCHANGED  D1

tests/db/                                 DELETED    per adapter, as its Go successor passes (D12)
tests/ipc/**/*.backend.spec.ts            DELETED    replaced by a Go generator (D13)
tests/ipc/**/*.fixture.ts                 UNCHANGED  byte-compatible — the point of D13
tests/ipc/**/*.frontend.spec.ts           UNCHANGED
tests/ipc/support/harness.ts              REPLACED   by the Go generator's own harness
tests/ui/                                 UNCHANGED
tests/e2e-real/                           EDITED     no vendored-node prerequisite; more engines
                                                     reachable (§5.5)
tests/unit/engine-cache.spec.ts           DELETED    subject moves to Go (D9)
tests/unit/sql-text.spec.ts               DELETED    subject moves to Go (§1.1) — after the Go port
                                                     asserts the same cases

package.json                              EDITED     10 deps + @types/pg + trustedDependencies out;
                                                     build:engine, test:db, test:ipc:be out
scripts/vendor-node.sh                    DELETED
scripts/run-db-tests.sh                   DELETED
scripts/run-ipc-backend.sh                DELETED
scripts/wails-dev-setup.sh                EDITED     no node/engine prerequisites
scripts/sign-bundle.sh                    EDITED     no nested node binary; Kafka note deleted
scripts/verify-packaging.sh               EDITED     A1/A2/N1/N2 rewritten (§4.9)
tsconfig.node.json                        EDITED     src/engine + tests/db out
.github/workflows/{ci,release}.yml        EDITED     or re-staged (§4.9)
docs/ARCHITECTURE.md                      EDITED     Stack, Invariants, Adapter contract, Per-engine
                                                     facts, Process model, Caching, Testing
docs/PACKAGING.md                         EDITED
docs/PERF.md                              EDITED     the inflation measurement, re-taken
AGENTS.md                                 EDITED     P58 findings; Docker/Kafka/SQLite/ClickHouse/
                                                     RabbitMQ/tests-ipc sections rewritten
docs/v1/SPEC.md                           EDITED     the P58 row + its missing sqlite (§1.2)
```

## 4. Designs

### 4.1 The Go adapter contract

`adapter.ts`'s interface ports almost verbatim; the two shape changes are Go idioms, not redesigns.

```go
type Adapter interface {
	Kind() model.ConnectionKind
	Caps() Caps

	Connect(ctx context.Context, cfg model.ResolvedConnectionConfig, op *OpCtx) (ConnectInfo, error)
	Disconnect(ctx context.Context) error

	Children(ctx context.Context, path model.NodePath, op *OpCtx) (TreeChildren, error)
	Describe(ctx context.Context, path model.NodePath, op *OpCtx) (model.ObjectMeta, error)
	Definition(ctx context.Context, path model.NodePath, op *OpCtx) (model.ObjectDefinition, error)

	Cancel(opID string) (bool, error)

	Read(ctx context.Context, req ReadRequest, op *OpCtx) (page.Page, error)
	Count(ctx context.Context, req CountRequest, op *OpCtx) (CountResult, error)

	Preview(plan model.MutationPlan) ([]string, error)
	Mutate(ctx context.Context, plan model.MutationPlan, op *OpCtx) (model.MutationResult, error)
	Execute(ctx context.Context, req model.ConsoleRequest, op *OpCtx) ([]page.Page, error)
	DownloadObject(ctx context.Context, req model.ObjectDownloadRequest, op *OpCtx) (model.ObjectTransferResult, error)
}
```

- **`ctx context.Context` replaces `OpCtx.signal`.** `AbortSignal` was carried *inside* `OpCtx`
  because JavaScript has no ambient cancellation; Go's convention is a leading `ctx`, and every
  driver in §1.8 takes one. `assertNotCancelled`/`throwIfCancelled` become `ctx.Err()` checks,
  keeping their two distinct messages verbatim (they differ on purpose — one reports a cancel that
  landed before the call started).
- **`*OpCtx` keeps what is genuinely op-scoped**: `OpID`, `SetCommand(text)` (Adapter rule 3: called
  *before* the statement is issued), `SetRows(n)`, `OnProgress`.
- **`Preview` gains an `error` return.** In TypeScript it is `preview(plan): string[]` and throws;
  Go's convention is an error return, and hiding a failure behind a panic would defeat D16.
- **Adapter rules 1–8 move across as the interface's doc comment**, with rule 1 rewritten: *"an
  adapter imports nothing from `electron`"* becomes *"an adapter imports nothing from
  `wailsapp/wails` and nothing from `internal/bridge` or `internal/shell`"* — the same property (the
  adapter layer is independently testable and shell-agnostic) restated against the shell that now
  exists. `internal/shell/app.go`'s own header already establishes the "nothing else imports
  pkg/application" discipline this extends.

### 4.2 The page codec and the chunk wire encoding

`page.ts`'s builder half ports to `internal/page`. `ColumnScratch`'s growable-then-exactly-sized
discipline (D4's corollary: *"a view over an oversized buffer clones the slack"*) matters as much in
Go as in JS — `append` over-allocates, so `finish()` must copy into an exactly-sized slice, and the
Go port must not "simplify" that away.

Two things get *easier* in Go and should be recorded as such rather than quietly enjoyed:

- **`truncateUtf8ToBoundary` becomes trivially correct.** Its JS form walks back over continuation
  bytes because `TextEncoder` hands out bytes with no boundary information. Go strings are already
  UTF-8 and `utf8.DecodeLastRune` answers the question directly. The behaviour must stay identical —
  cut at `MAX_CELL_BYTES`, back off to a rune boundary, drop the incomplete rune.
- **The null-vs-empty-string distinction is unchanged and still load-bearing.** `page.ts`'s comment:
  *"A NULL row has `offsets[i] === offsets[i+1]`; an empty string does too, which is why the bitset
  is the only thing that distinguishes them (§8.5 requires they render differently)."* A Go port that
  represents a cell as `string` loses the distinction; it must be `*string` or an explicit
  `(value string, isNull bool)` pair all the way down.

The wire encoding (D5), stated exactly:

```go
type Chunk struct {
	Data      []byte   // base64 by encoding/json's own []byte handling
	Offsets   Uint32LE // rowCount+1 entries, base64 of little-endian bytes
	Nulls     []byte   // ceil(rowCount/8)
	Truncated Uint32LE // sorted row indices
}
```

`Uint32LE` is a `[]uint32` with a `MarshalJSON` writing `base64(LE bytes)`. The renderer's decoder,
in `port.ts`, replaces one function body:

```ts
function toTypedArray<T>(v: unknown, ctor: …): T   // was: ctor.from(Object.values(v))
                                                    // now: decode base64 -> bytes -> ctor over its buffer
```

`isChunkLike`'s four-field-name recognition, and `reviveChunks`'s tree walk over every page kind's
differently-named chunk fields (`data`, `ids`/`bodies`, `fields`/`values`,
`keys`/`headers`/`attrs`/`timestamps`/`bodies`), are unchanged — P57 M4 already got that part right
and this phase should not touch it.

**M2 owes a measurement, not a claim**: the same 100 KB chunk, encoded both ways, wire bytes and
peak transient heap on each side, recorded in `docs/PERF.md` beside the 11×/48× figures it replaces.

### 4.3 The op scheduler and the op log

`runOp` becomes a Go function of the same shape: mint or accept an op id, refuse a duplicate, derive
a cancellable context, record `op:start` into `internal/oplog`, run the closure, record `op:end` with
status (`ok`/`error`/`cancelled`, decided by whether the context was cancelled), duration, rows,
command and error. `cancelOp` stays two-step (D10). The `running` map becomes a mutex-guarded
`map[string]cancelEntry`.

The one genuinely new question is D10's last paragraph: `oplog`'s reconciliation currently keys off
`EventEngineDown`, which will never fire again. The replacement must be decided in P58a and written
down — the honest candidates are per-connection (an adapter's `Disconnect`/`MarkAllErrored` path
fails that connection's in-flight ops) plus a process-shutdown sweep. Leaving in-flight `op_log` rows
with no terminal status is a real, user-visible defect (the Operations panel shows them running
forever), which is why this is a design item and not an implementation detail.

### 4.4 The L2/L3 cache in Go

`internal/enginecache` mirrors `cache/index.ts`'s surface: `ReadPage`, `StorePage`, `Count`,
`StoreCount`, `DropTarget`, `InvalidateAfterMutation`, `DropPagesOnly`, `DropConnection`, `Clear`,
`Stats`, `Configure`, `OnStatsChanged`. The 1 Hz emission throttle ports as a timer; the
`statsChanged` comparison before emitting ports too, because *"an idle app posts nothing"* is a real
property the status bar depends on.

Two invariants to carry with their reasons attached, because both look like bugs to a reader who
does not know why:

- **The half-budget refusal**: an entry larger than half the L2 budget is not stored, with a warning
  — *"one 40 MB page must not evict every other page in a 64 MB budget."*
- **`invalidateAfterMutation` runs in a `finally`**, not on success only (P43 F12/D17): six adapters
  mutate without a transaction, so a partially-applied plan still changed the server and its cached
  pages are now wrong.

The Go cache holds native `page.Page` values, so a cache hit is a pointer copy plus one JSON encode
at the boundary — where today it is a hit in Node, a `JSON.stringify`, a pipe, and a `JSON.parse`.
That is the cache's own share of §1.4's win and is worth measuring separately from a cold read.

### 4.5 `bridge/stream.go` becomes the data-plane server

```go
func ServeEngineStream(host *adapterhost.Host, conn StreamSession) {
	detach := host.AttachStream(conn)   // still needed: cache:stats is an unsolicited push (D2)
	defer detach()
	for {
		frame, err := conn.Receive()
		if err != nil { return }
		go host.HandleDataFrame(frame, conn)   // see below on concurrency
	}
}
```

Three properties of today's loop that must not be lost:

- **Concurrency.** Today the engine's Node event loop interleaves concurrent data ops and the reader
  goroutine never blocks. A Go handler that ran inline would serialise every read behind the slowest
  one. Each frame is handled on its own goroutine, and the *response* write is what needs
  serialising — Wails' `StreamConn.Send` blocks (P54's correction of P52 §7.2: `TrySend` is the
  non-blocking one), so a single writer goroutine draining a bounded channel preserves both the
  ordering-agnostic concurrency and the backpressure shape `enginehost/stream.go` implements today.
- **Backpressure.** `enginehost`'s bounded queue (64 frames / 32 MiB) plus blocking `Send` is what
  stops an unbounded response backlog. The adapter host inherits the same bound; without it, a
  renderer that stops draining while a script issues reads grows the Go heap without limit — and
  unlike today there is no OS pipe to push back through.
- **The 64 MiB frame ceiling.** `enginehost/stream.go`'s `maxDataFrameBytes` mirrors Wails'
  own `streamMaxFrameBytes` (`pkg/application/stream_transport.go:50`). It is a property of the
  Wails stream, not of the sidecar, so it survives and its drop-with-a-named-log-line behaviour
  survives with it. `MAX_PAGE_SIZE` is 10 000 rows and `MAX_CELL_BYTES` is 64 KiB, so a pathological
  page can still approach it; the ceiling must be re-tested against a base64-encoded page rather than
  assumed to have got safer.

### 4.6 The per-kind router (D4)

One table, in one file, is the whole mechanism:

```go
// nativeKinds is the single source of truth for which connection kinds are served in-process.
// A kind is added here in the same commit its Go adapter lands, and never earlier.
var nativeKinds = map[model.ConnectionKind]bool{ /* grows M5 -> M9 */ }
```

- **Control plane.** `internal/connections` and `internal/tree` stop calling `enginehost.Host`
  directly and call an `EngineBackend` interface with the same nine method shapes. Two
  implementations: `adapterhost.Host` (in-process) and `enginehost.Host` (the child). A tiny
  `routing` implementation dispatches on the connection's kind. Once `nativeKinds` is complete, the
  routing implementation and the `enginehost` one both delete and the call sites keep their shape —
  which is why introducing the interface in M4 costs nothing later.
- **Data plane.** `HandleDataFrame` unmarshals the request envelope (`kind`, `id`, `op`,
  `payload.connectionId`), looks up that connection's kind, and either answers in-process or writes
  the original frame verbatim to `enginehost.SendData` exactly as today. `cache:stats`,
  `cache:clear` and `cache:configure` are not connection-scoped: during coexistence, L2/L3 exists on
  both sides, so `cache:stats` must report the **sum** and `cache:clear` must clear **both**. This is
  the single ugliest thing in the transition and it is temporary by construction — but leaving it
  implicit would produce a status bar that under-reports cache size for five sub-phases, which is
  exactly the kind of silently-wrong number `AGENTS.md`'s P57 findings warn about (the
  `byteSize: 0` fixture that made every leak assertion pass vacuously).
- **The kind of a connection id** is already known Go-side: `internal/connections`' state map and
  `ConnectionsRepo.Get` both carry it, so the router needs no new storage.

### 4.7 Per-adapter driver mapping — what each sub-phase plan owes

Each sub-phase plan must produce, per adapter, a table with one row per `Adapter` method mapping the
TypeScript call to its Go equivalent, plus explicit rows for the three things most easily lost:

1. **Cancellation.** The exact mechanism from `docs/ARCHITECTURE.md`'s per-database table:
   `pg_cancel_backend(pid)` / `KILL QUERY <threadId>` / `KILL QUERY WHERE query_id = '<id>' SYNC` /
   context + `killOp` / abort the SCAN loop + `CLIENT KILL` / disconnect the assigned consumer / SDK
   context cancel / HTTP request cancel — each on a *side* connection where it is one today.
2. **Pagination.** The `PaginationStrategy` value and the exact cursor/token encoding, since the
   token is opaque to the renderer but must round-trip identically across a page boundary.
3. **Error mapping.** Each adapter's `errors.ts` maps its driver's thrown errors onto the closed
   `AdapterErrorCode` set; the Go driver's error types are different objects entirely, so every
   mapping is re-derived, and RabbitMQ's two-function shape (`mapHttpError`/`mapNetworkError`, which
   exists to keep the `notFoundHint` distinction P37 built) is preserved rather than collapsed.

### 4.8 The renderer's change, in full

One function body in `src/renderer/bridge/port.ts` (§4.2). Nothing else. `data.ts` is untouched,
`control.ts` is untouched, `env.d.ts` is untouched, every view is untouched. §8 checks it.

### 4.9 Packaging, build and CI

- `bun run build` (Vite → `shell/frontend/dist`) is unchanged.
- `bun run build:engine` is deleted; `predev`/`wails-dev-setup.sh` lose their node/engine
  prerequisite checks.
- `wails3 task darwin:package` produces a bundle with no `Contents/MacOS/runtime/` at all.
  `sign-bundle.sh` loses its nested-binary `codesign` pass (the whole reason it had one) and
  `verify-packaging.sh`'s A1 loop reduces to the bundle itself; A2 (engine bundle + node binary
  present at `resolveEngine()`'s paths) is **deleted, not weakened**, and the `note` about the
  unvendored Kafka native module is deleted because its subject is.
- **The bundle shrinks by a whole Node runtime.** `docs/PERF.md`'s L-D app-size lever and §2.3's RSS
  numbers both need re-taking; a V8 isolate is ~35 MB of the current baseline by P51's own figure,
  and the on-disk runtime is more.
- **CI.** `.github/workflows/{ci,release}.yml` are *already* stale from P57 M7 —
  `docs/v1/plans/p57-pending-ci-workflows/` is still present at the end of P57, meaning that session's
  push lacked the `workflow` OAuth scope. P58 makes them staler (`test:db`, `test:ipc:be`,
  `build:engine` all disappear). M11 must either land both files or extend that same staged directory
  with a P58 revision and say plainly in `AGENTS.md` that it is still pending. Silently leaving two
  broken workflows is not an option; leaving them broken *and unrecorded* is the failure mode to
  avoid.

### 4.10 The Go container harness (D12)

`testcontainers-go` per engine, with `shell/internal/adapters/testsupport/` as the Go analogue of
`tests/db/support/`. Three carried-over facts, none of which needs re-deriving:

- **`mirror.gcr.io` retagging is a daemon-level workaround** (`AGENTS.md`'s Docker section) and
  applies unchanged: the Go module asks for `postgres:17`, the daemon already has that tag pointing
  at the mirrored image. No Go code references the mirror.
- **ClickHouse's `ulimit` problem** (`@testcontainers/clickhouse` hardcoding
  `nofile: {hard: 262144}` against this sandbox's fixed 20 000 ceiling) must be re-checked against
  `testcontainers-go`'s own ClickHouse module, which may not set it at all — in which case
  `tests/ipc/clickhouse/container.ts`'s `NoUlimitClickHouseContainer` subclass has no Go
  counterpart and the workaround simply disappears. **Check, do not assume in either direction.**
- **The Bun/testcontainers hang has no Go analogue.** P57's finding was specific to `bun run`;
  `testcontainers-go` runs under the Go toolchain. Expect the postgres wait strategy to just work,
  and record it in `AGENTS.md` when it does, because a whole paragraph of that file becomes historical.

Go tests gate on Docker the way `isDockerAvailable()` does today: a helper that skips with a legible
message, never a silent pass.

## 5. Testing plan

### 5.1 What survives untouched, and why that is the load-bearing claim

- **`tests/ui/`** entirely — 36 tests across 18 spec files, both wire planes mocked. D1 and D5 keep
  the mocked shapes valid; `tests/ui/support/mockStreamBrowser.js` needs its chunk fields emitted as
  base64 rather than index-keyed objects, which is a fixture-generator change, not a spec change.
  (And per `AGENTS.md`'s P57 finding about `byteSize: 0`: the generator must compute *real* byte
  sizes with `page.ts`'s own formula, which it already does after that fix — do not regress it while
  changing the encoding.)
- **`tests/ipc/**/*.frontend.spec.ts`** (7 specs) and **`tests/ipc/**/*.fixture.ts`** (7 modules) —
  unchanged, byte-compatible. D13 exists to guarantee this and §8 makes it a criterion.

  > **Amended count (`docs/v1/plans/P58f-cutover.md` §1.11/§5.1).** Six, not seven, by the time D13
  > landed — `rabbitmq` is one of the seven `*.backend.spec.ts` files that ever existed
  > (`clickhouse`, `kafka`, `mariadb`, `mysql`, `rabbitmq`, `redis`, `sqs`), but RabbitMQ was already
  > dropped as a supported connection kind before this phase started (D6: *"RabbitMQ adds
  > nothing"*), so it was never a candidate for a Go fixture generator. The Go generator
  > (`shell/internal/ipcfixture`) covers `clickhouse`, `kafka`, `mariadb`, `mysql`, `redis`, `sqs` —
  > six adapters, six `*.fixture.ts` modules, unchanged and byte-compatible exactly as this
  > paragraph requires. `postgres` and `sqlite` were never in the seven above and generate no
  > fixture of their own either, for unrelated reasons specific to each (see
  > `docs/ARCHITECTURE.md`'s Testing section).
- **`tests/e2e-real/`** — both specs keep working; their fixtures lose the vendored-node and
  `build:engine` prerequisites.
- **`tests/unit/`**'s renderer specs — unchanged except the two whose subject moves to Go
  (`engine-cache.spec.ts`, `sql-text.spec.ts`), each deleted only after its Go successor asserts the
  same cases, per `AGENTS.md`'s "deleting a test whose subject moved is correct; the thing to check
  is that the Go test actually covers the same assertion."

### 5.2 The `src/` non-change, asserted

Every sub-phase from P58a to P58e ends with:

```
git diff --stat src/ -- ':!src/renderer/bridge/port.ts' ':!src/engine'
```

returning empty. If it is not empty, either D1 was broken or the substrate has a coupling this plan
did not find — and the implementer should stop and say so rather than absorb it. This is P57 §5.2's
instrument, re-pointed.

### 5.3 The Go adapter tier (D12)

Per adapter, in the sub-phase that ports it, **before** the adapter: a Go test file per engine under
`shell/internal/adapters/<engine>/`, driven by `testcontainers-go` against the same seed fixtures,
covering the scenario list in §1.10 verbatim — including the server-side cancellation assertion,
which is the one thing no other tier can check.

Two additions to the ported list, both because the Go port creates the risk:

| Test | Adapter | Why it is new |
|---|---|---|
| a cancel followed immediately by an unrelated query on the same adapter succeeds | sqlite | D8's `sqlite3_interrupt` connection-wide hazard, exactly the shape of mattn/go-sqlite3#488/#745 |
| a browse never creates group state (`ListGroups` is unchanged before and after) | kafka | P10 D6's promise, made structural by P32 and re-proven against a different client |

### 5.4 Unit-level Go tests, against `AGENTS.md`'s bar

The bar is deliberately high (*"a unit test now exists only for genuinely complex or deeply-nested
logic — parsers, cursor/pagination boundary arithmetic, cache eviction, crypto, concurrency"*).
Four things in this phase clear it without argument, and they are the four:

| Subject | Why it qualifies |
|---|---|
| `sqltext.go`'s keyset planner (`computeEffectiveOrder`, `assertKeysetSupported`, `buildKeysetPosition`) | cursor/pagination boundary arithmetic with several interacting rules; `tests/unit/sql-text.spec.ts` is the existing oracle |
| `mongo/literal.go`'s tokenizer/parser | D11: a parser with several interacting lexical rules |
| `enginecache`'s LRU eviction, half-budget refusal and the mutation-invalidation asymmetry | cache eviction/invalidation with rules that interact; `tests/unit/engine-cache.spec.ts` is the oracle |
| `page`'s chunk codec — null-vs-empty, UTF-8 boundary truncation, the offsets/nulls/truncated invariants, and the base64 round trip | boundary arithmetic with a documented trap (the null/empty-string collision) |

Everything else gets nothing. Adapter CRUD round-trips are covered by §5.3 against a real container,
which is where they belong.

### 5.5 `tests/e2e-real/` gets cheaper, and should be allowed to grow — once

`P57-e2e-revisit.md` built this tier on `go build -tags server`. After P58 every adapter is in-process,
so a real-backend spec no longer needs the vendored Node runtime or a built engine bundle at all —
`tests/e2e-real/sqlite-real.spec.ts` becomes dependency-free beyond the Go toolchain. Adding one
spec per newly-native engine is tempting and mostly wrong: this tier is deliberately small and its
job is *wiring*, not adapter coverage (§5.3's job). The one addition worth making is a spec for the
S3 `objectDownload` file-write contract, which `P57-e2e-revisit.md` §7 left conditional and which is
the last full-stack behaviour with no automated home.

> **Struck (`docs/v1/plans/P58f-cutover.md` D17, closing P58d's own OQ-5).** This proposal cannot be
> built, on either side of P58. `tests/e2e-real/` is the `-tags server` build with no native window
> at all (`docs/ARCHITECTURE.md`'s Process model), and a real `objectDownload` file-write exercises
> Wails' AppKit save panel — a UI surface that requires a real desktop session and does not exist in
> server mode. Nobody should re-propose this spec: the coverage it would have provided stays exactly
> where §6's manual macOS checklist below already puts it (**"A real S3 download through the AppKit
> save panel"**), a human procedure, not an automatable one.

### 5.6 The fixture-generator port (D13)

One Go test-only command, per adapter, that drives the same sequence and writes the same
`*.fixture.ts` module. Two guards, because this is where drift will hide:

| Test | Asserts |
|---|---|
| regenerate-and-diff | Re-running the generator against a fresh container produces a fixture module byte-identical to the committed one, modulo the frozen non-deterministic fields — the property `KIRA_IPC_FIXTURES=write` has today |
| every frozen field is named | Each adapter's generator lists the fields it freezes (kafka's coordinator host:port, ClickHouse's `.inner_id.<uuid>`, timestamps, ephemeral ports, generated ids) in one place, so a new non-determinism produces a diff rather than a silent freeze |

## 6. The manual and macOS checks this phase owes

As with P55 §10, P56 §6 and P57 §6, the implementing session records each result **including "not
available in this session"** rather than leaving it implied.

| Check | Why it cannot be closed from Linux | What "pass" looks like |
|---|---|---|
| **Bundle size and cold start without the vendored Node** | Both are properties of a real packaged `.app` | New numbers in `docs/PERF.md` §3 and the L-D lever row |
| **Total RSS after the sidecar's removal** | `docs/PERF.md` §2.2/§2.3's own methodology needs real hardware; the Linux/WebKitGTK figure is explicitly not an answer for macOS | A recorded number, with the V8-isolate saving separated from the driver-memory-now-in-process cost |
| **`sign-bundle.sh` with no nested executable** | The bundle layout is whatever `create:app:bundle` produces on darwin | All `codesign` lines succeed; `--verify --deep --strict` exits 0 |
| **`verify-packaging.sh` against a real bundle** | Every artifact check reads the `.app` | Exits 0, with A2 removed rather than skipped |
| **A real S3 download through the AppKit save panel** | Wails' dialogs are AppKit and need a user; still the coverage `s3.spec.ts` took with it (P57 D16) | An object downloads to a chosen path, written by Go this time |
| **A Kafka connection in a packaged build** | The thing the current native-module gap would break | Connect, browse a topic, produce a message — the first time this has ever been verifiable in a packaged bundle |

That last row is worth naming as a milestone in itself: `AGENTS.md` currently records that *"a real
packaged build today would have Kafka connections fail at `require()` time."* P58 is the phase that
makes that sentence false, and the check is what proves it.

## 7. Scope boundary, and what is genuinely lost

**`src/` changes, enumerated**: `src/renderer/bridge/port.ts`'s `toTypedArray` body, and the deletion
of `src/engine/`. That is the entire list, and §5.2 checks it rather than asserting it.

**What gets worse.**

1. **14 847 lines of mature, container-tested code are rewritten, and the tests that pinned them do
   not port.** Every adapter carries fixes nobody would think to look for: redis's HSCAN reordering,
   kafka's EOF clamp (P43 iter2 F19/D26), rabbitmq's `%2F` single-`encodeSegment()` rule, sqlite's
   primary-key → unique-index → rowid fallback chain, s3's temp-file-then-rename download, mongo's
   `killOp` fallback, the `invalidateAfterMutation`-in-a-`finally` asymmetry. A Go port that reads
   correct can still have lost one. **D12's test-first rule is the only real mitigation, and it is
   the single most important process decision in this plan** — not the driver picks, which are
   reversible.
2. **The engine's process isolation is genuinely gone, not merely relocated.** Today an adapter
   crash costs "reconnect your databases" (P51 named this as one of the architecture's virtues over
   the deleted Tauri-sidecar plan); the window, the tabs, the settings and the op log all survive
   in a different process. After P58 a panic in a driver takes the app down with the user's unsaved
   tab state. D16's `recover()` converts most of that into a failed operation, but a `recover()`
   cannot save a process from a cgo segfault or an OOM. This is a real, permanent reduction in blast
   radius protection and `docs/ARCHITECTURE.md`'s "Why a separate engine process" section must be
   rewritten to say so rather than deleted.
3. **The separately-capped, separately-reclaimable engine heap disappears.** `advanced.engineMemoryCapMb`
   (`--max-old-space-size`) has no successor: Go has no per-subsystem heap cap, and a driver that
   holds memory now holds it in the process that owns the window. The setting itself should be
   removed rather than left in the settings dialog doing nothing.
4. **Every adapter's error text changes.** Adapter rule 4 preserves the server's message verbatim,
   so the messages users see are the *driver's*, and Go drivers word things differently from JS ones.
   Nothing is lost in substance, but every error-text assertion is re-baselined and any user-facing
   string a support conversation might quote is now different.
5. **The fast TypeScript adapter loop is gone.** `bun test tests/db/postgres.spec.ts` is replaced by
   `go test ./internal/adapters/postgres` — comparable, but the whole `bun test`-with-hot-fixtures
   iteration style around adapters ends.
6. **`tests/ipc/`'s backend half is rewritten in a different language against the same contract**
   (D13). The tier survives; its implementation does not, and a generator bug now produces fixtures
   that are self-consistently wrong.
7. **During P58a–P58e the app carries two adapter hosts and a cache split across two processes**
   (§4.6). Temporary, bounded by C2, and the price of six shippable sub-phases instead of one
   big-bang — but it is real complexity that exists for months.
8. **MySQL loses `allowPublicKeyRetrieval`, a real if narrow security-posture regression**
   (`docs/v1/plans/P58b-mysql-sqlite-clickhouse.md` B22, closing that phase's own OQ-4). The old
   client gated whether the server's RSA public key could be requested over a plaintext connection;
   `go-sql-driver/mysql` requests it unconditionally, with no opt-in gate the adapter could withhold.
   `mysql/client.ts`'s `applyEngineOptions` becomes empty and the MySQL connection profile keeps
   existing only for its server label. This is the phase's first genuine security-posture loss, not
   merely a cosmetic or error-text difference — three sub-phases asked for it to be added to this
   list and none did until now.

**What gets better.**

1. **The JSON-inflation regression is fixed, and by more than removing the hop** — §1.4: one encode
   instead of three, and that one encode drops from ~5–11× to ~1.33×.
2. **The whole sidecar apparatus retires**: a supervision state machine, a hand-rolled framer, a
   bounded-queue backpressure scheme, a vendored second runtime, a native-addon ABI question, an
   unresolved packaging gap, two shell test-runner scripts, and `--external` lists in three places.
3. **A packaged Kafka connection works for the first time** (§6).
4. **Kafka regains `DescribeConfigs` and `DescribeCluster`** — two capabilities P32 D13/D14 recorded
   as losses (D7).
5. **SQLite gains real cancellation** — `caps.cancel` flips from a permanent `false` to `true` (D8).
6. **Ten npm runtime dependencies leave.** `package.json`'s `dependencies` reduces to `zod`.
7. **`AGENTS.md`'s "Bun is tooling only" becomes literally true** — no shipped JavaScript executes
   outside the webview.
8. **The bundle loses a whole Node runtime and a V8 isolate** from both disk and baseline RSS.
9. **Int64 offsets, native UTF-8, and typed nulls** remove three whole classes of JS-side workaround
   (`toNativeOffset`'s safe-integer guard, `truncateUtf8ToBoundary`'s continuation-byte walk, and the
   `string | null` plumbing that made the null/empty-string distinction fragile).
10. **MongoDB's document view stops lying about what is stored, for whole-number doubles**
    (`docs/v1/plans/P58c-mongo-redis.md` OQ-4). `bson.Raw` keeps the on-disk BSON type tag; the old
    JS driver's decode-then-`EJSON.stringify` round trip does not, so a stored double that happens to
    be a whole number (e.g. `3.0`) rendered as `{"$numberInt":"3"}` — indistinguishable from a value
    that was actually stored as an int32. Go renders the same value as `{"$numberDouble":"3.0"}`,
    matching what is actually on disk. This is a genuine rendering-fidelity gain for the general case,
    even though the one worked example this plan and P58c both used to illustrate it
    (`widgets.price` in the committed fixture) turned out, once checked against a real container, not
    to exhibit the divergence itself — both drivers pick the BSON type from the stored value, not
    from the arithmetic that produced it, so that particular field renders identically either way.
    The underlying engineering point, and the gain it describes, are both real; only that one example
    was not.

## 8. Acceptance criteria

1. **C1 is recorded** (§0.3) — one Postgres connection served entirely in Go while the Node child
   still serves the other ten kinds in the same session, with the six-item checklist of §9 M5. The
   commit message or `AGENTS.md` entry says so explicitly.
2. **C2 is recorded** before M10 starts — a full manual pass across all eleven kinds leaves the
   engine child's request counter at zero.
3. `bun run lint`, `bun run typecheck` (all four projects), `bun run test:unit`, `bun run test:go`,
   `bun run test:ui`, `bun run test:ipc:fe` are green.
4. `go test ./internal/adapters/...` is green against real containers for every engine — or, where
   Docker is unavailable in the session, that is **stated** rather than implied, per engine.
5. **`git diff --stat tests/ipc` shows no change to any `*.fixture.ts` or any `*.frontend.spec.ts`**
   (D13).
6. `git diff --stat src/ -- ':!src/renderer/bridge/port.ts' ':!src/engine'` is empty (§5.2).
7. `grep -rn "enginehost\|vendor-node\|build:engine\|runtime/node\|src/engine" shell/ src/ scripts/ package.json docs/ tests/`
   returns nothing outside historical references in `docs/v1/plans/` and `AGENTS.md`'s findings logs.
8. `package.json`'s `dependencies` is `{"zod": …}` and nothing else; `trustedDependencies` is gone.
9. `bun run build && bun run package` produces a signed bundle with **no** `Contents/MacOS/runtime/`;
   `bun run verify:packaging` exits 0 against it (macOS only — otherwise recorded as unavailable).
10. `docs/PERF.md` carries a **re-taken** measurement replacing the 11×/48× inflation figures, plus
    new bundle-size and RSS numbers or an explicit note that the hardware was unavailable.
11. `AGENTS.md` gains a **"P58 implementation findings"** entry on the P52–P57 pattern, and the
    sections whose subject this phase removes are rewritten rather than left: **Native Kafka driver**
    (no addon at all now), **SQLite adapter** (no `node:sqlite`, no Bun gate, and cancellation now
    exists), **`tests/ipc/`** (no vendored Node, no `run-ipc-backend.sh`), **Docker** (whichever
    Bun-specific hangs and ClickHouse `ulimit` workarounds turn out to have no Go analogue),
    **ClickHouse/RabbitMQ** (test-running instructions). Things already worth writing down before
    implementation starts, to be confirmed or corrected there:
    - **The Kafka adapter never joins a consumer group**, and the native addon was chosen for Kafka 4
      compatibility, not for group support (§1.7) — the single most load-bearing correction in this
      plan.
    - **`sqlite3_interrupt` is connection-wide**, so a per-op dedicated connection is mandatory, not
      hygiene (D8).
    - **Go's `encoding/json` base64-encodes `[]byte` but number-array-encodes `[]uint32`** — which is
      why D5 gives all four chunk buffers an explicit encoding rather than relying on the default.
    - **Wails' `StreamConn.Send` blocks** (P54's correction, still true) — the adapter host needs its
      own bounded queue and single writer, since there is no OS pipe left to push back through.
    - **The 64 MiB Wails frame ceiling is a property of the stream, not of the sidecar**, and must be
      re-tested against base64-encoded pages.
12. `docs/ARCHITECTURE.md` is updated per §3, **including the rewritten bulk-data invariant (D3), the
    rewritten "Why a separate engine process" section (§7 item 2), the SQLite `caps.cancel` sentence
    (D8) and the Kafka capability recovery (D7)**; `docs/v1/SPEC.md`'s P58 row is updated and its
    missing `sqlite` fixed (§1.2).

## 9. Sequencing

Twelve milestones across six sub-phases. **M0–M5 are additive and end at C1; M6–M9 are the remaining
adapters; M10–M11 are the cutover.** Hard rules, in priority order:

> **R1 — nothing in M10 starts before C2 is recorded.** The app is buildable and shippable at every
> point up to M10 with the sidecar still present; after M10 it is not, and a kind nobody noticed was
> still Node-served becomes a broken connection in a shipped build.
>
> **R2 — M1–M4 (the substrate) land before any adapter.** Eleven adapters written against a substrate
> that is still moving is eleven rewrites.
>
> **R3 — each adapter's Go tests land, and fail, before that adapter's implementation** (D12). This is
> a rule about commits, not about a milestone boundary, and it applies inside M5–M9 equally.
>
> **R4 — M0 before M5, and specifically M0's Kafka probe before P58e is planned.** M0 is cheap
> (throwaway programs, no product code) and it is where a driver decision is allowed to be wrong.

**P58a — the substrate and the pathfinder**

- **M0 — driver claims proven, not assumed.** One throwaway Go program per engine against a real
  container, proving the eight riskiest claims in §1.8: franz-go's assign-at-exact-offset browse with
  no group state and `HighWatermark` on the fetch (D7's full probe list); pgx side-connection
  `pg_cancel_backend`; `mattn/go-sqlite3` interrupting one statement without touching the next on a
  *different* connection; `clickhouse-go` accepting `KILL QUERY … SYNC` on a second connection while
  the first is blocked; `go-redis` SCAN-family iteration plus `CLIENT KILL`; `mongo-driver`'s
  `MarshalExtJSON` matching the current `EJSON` output for the fixture documents, plus `killOp`;
  `aws-sdk-go-v2` aborting a `GetObject` mid-body; `net/http` reaching the management API with a
  `%2F` vhost. Plus: `testcontainers-go` starting every one of the eleven images in this sandbox,
  which is what tells us how much of `AGENTS.md`'s Docker section survives. **No product code lands in
  M0.** Its deliverable is a findings section in this document's successor entries, and — if the
  Kafka probe fails — D7's fallback taken *explicitly*, with its cgo cost written down.
- **M1 — `internal/adapters`: contract, caps, errors, registry, live map, `sqltext.go`,
  `sqlmutate.go`.** No engine yet. Ends when `go build ./internal/adapters/...` passes and
  `sqltext`'s keyset planner passes the cases `tests/unit/sql-text.spec.ts` asserts today.
- **M2 — `internal/page`: the codec, the four builders, and D5's chunk encoding**, plus the renderer's
  one-function decoder change and the `tests/ui` fixture generator's matching change. Ends with the
  measurement §4.2 owes, recorded in `docs/PERF.md`. This is deliberately its own milestone because
  it is the only milestone that touches `src/`, and isolating that makes §5.2's assertion meaningful
  for every milestone after it.
- **M3 — `internal/enginecache`: L2/L3, the throttled stats emission, `Configure`.** Ends with the Go
  successor to `tests/unit/engine-cache.spec.ts` green.
- **M4 — `internal/adapterhost` and the router.** `runOp`/`cancelOp` (D10), the data-op dispatcher
  with `data.ts`'s cache-aside logic, the `EngineBackend` interface behind `internal/connections`' and
  `internal/tree`'s eight call sites (§1.5), the `nativeKinds` table (empty), and `bridge/stream.go`'s
  rewrite (§4.5). **`nativeKinds` is empty at the end of M4, so behaviour is unchanged and every
  existing test still passes** — which is exactly what proves the seam is right before any adapter
  depends on it.
- **M5 — Postgres, native. C1.** Tests first (R3), then the adapter, then `nativeKinds["postgres"] = true`.
  C1's checklist, in one session: the app boots; a Postgres connection connects and its tree expands;
  describe and definition render; a table opens and pages forward and back; a count returns; a console
  batch runs; a staged mutation commits; a long query's stop button leaves `pg_stat_activity` clean;
  **and a MariaDB connection in the same session still works, served by the Node child.** That last
  item is the coexistence proof and is the reason C1 is not just "Postgres works".

**P58b — the rest of the SQL family**

- **M6 — MySQL/MariaDB, SQLite, ClickHouse.** Three adapters, `nativeKinds` grows by four kinds
  (mariadb, mysql, sqlite, clickhouse). SQLite carries D8's capability change and its own new
  regression test. Ends with `tests/db/{mysql,mariadb,sqlite,clickhouse}.spec.ts` deleted and their Go
  successors green.

**P58c — document and key-value**

- **M7 — MongoDB and Redis.** Carries D11 (`literal.go` and its unit test, written first). Ends with
  `tests/db/{mongo,redis}.spec.ts` deleted and their Go successors green.

**P58d — the service-protocol tier**

- **M8 — SQS, S3.** S3 carries `caps.fileTransfer` and the temp-file-then-rename download. (RabbitMQ
  was dropped from scope before this milestone was planned or implemented — see the amendment note
  at the top of this document.)

**P58e — Kafka**

- **M9 — Kafka, on franz-go** (D7), against M0's already-proven probe. Ends with `nativeKinds`
  complete — all ten — and `tests/db/kafka.spec.ts` deleted, along with
  `scripts/run-db-tests.sh`'s whole reason for existing.

**P58f — cutover**

- **M10 — the deletions.** After C2. `src/engine/` (119 files), `internal/enginehost/`,
  `internal/enginetest/`, `main.go`'s engine block, `scripts/vendor-node.sh`,
  `scripts/run-{db-tests,ipc-backend}.sh`, `package.json`'s ten dependencies and two scripts, the
  routing indirection (both `EngineBackend` implementations collapse to one), `tsconfig.node.json`'s
  `src/engine` and `tests/db` includes, and the packaging/`verify-packaging.sh` changes of §4.9.
  Also D13's fixture-generator port, which must be green **before** the TypeScript backend specs are
  deleted, not after — the same M5-before-M6 discipline P57 §9's second hard rule established.
- **M11 — documentation and CI.** §3's doc list in full, the `AGENTS.md` findings entry (§8 criterion
  11), the SPEC row and its missing sqlite, `docs/PERF.md`'s re-taken numbers, and the workflows
  (§4.9) — landed if the session's push scope allows, staged and recorded if not. Last, so it
  describes what actually landed.

**Why this order and not a riskiest-first one.** The instinct is to do Kafka first because it is the
biggest unknown. M0 is what satisfies that instinct correctly: it answers Kafka's real question — can
a pure-Go client express an assign-at-offset browse with the admin surface this adapter needs — in a
throwaway program, before any substrate exists to be shaped wrongly around the answer. Doing the
*adapter* first would instead mean writing the substrate around the hardest, least representative
engine in the set: Kafka has no SQL, no keyset pagination, no describe, no mutations beyond produce,
and no transaction. Postgres exercises every method; Kafka exercises the fewest.

## 10. Environment notes for the implementing session

- **A fresh container has none of the toolchain.** Go, plus
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` for anything that builds
  `internal/shell` or the root `main` package. `./internal/adapters/...` needs neither — it is
  cgo-for-sqlite only, like `./internal/storage/...` — so the fast adapter loop is
  `go test ./internal/adapters/<engine>` and never `./...`.
- **Install `wails3` pinned** to `shell/go.mod`'s exact version, never `@latest` (P55's finding —
  `@latest` resolved to beta.16 against a beta.15 runtime).
- **Docker**: `nohup dockerd > /tmp/dockerd.log 2>&1 & disown` on Claude Code's Linux containers,
  `colima start` on macOS. Pull every image through `mirror.gcr.io` and retag to the plain name
  (`library/` prefix for unnamespaced official images, none for already-namespaced ones) — the
  retag lives in the daemon, so `testcontainers-go` finds the plain name with no code change.
- **`bunx playwright install webkit`** plus the system libs its post-install warning names is worth
  retrying each session — P57's own finding is that an earlier session's "cannot reach the download
  host" verdict did not hold in a later one.
- **A background process started in one shell invocation cannot be signalled from a later one**
  (P51's finding, still true). Start, poll, test and tear down inside one Bash invocation, with a
  120–150 s timeout for anything that builds the Wails app.
- **Screenshotting the headless WebKitGTK window** (`xdotool search --name`, `import -window <id>`)
  is still the only way to tell a rendered app from a blank page here, and C1 needs it.
- **`shell/frontend/bindings` is git-ignored** and must be regenerated
  (`wails3 generate bindings -b -i -ts -names`) in a fresh container before `bun run build` will
  resolve its imports. P58 changes no bound method signature except `EngineService.Status`'s
  semantics and `AppService.Info`'s `NodeVersion` removal (D14), so one regeneration at M10 is enough
  — but a fresh container needs one regardless.
- **After M10, `scripts/wails-dev-setup.sh` no longer needs the vendored Node**, which removes the
  most common "why won't the app start" failure a fresh session hits today.
