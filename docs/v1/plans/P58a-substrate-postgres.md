# P58a — the Go adapter substrate and the Postgres pathfinder (M0–M5, ending at C1)

> **Parent:** `docs/v1/plans/P58-go-native-adapters.md`. That document's §0.3 splits P58 into six
> sub-phases and assigns **P58a** the milestones **M0–M5**: prove the riskiest driver claims with
> throwaway probes (M0), build `internal/adapters` (M1), `internal/page` (M2),
> `internal/enginecache` (M3), `internal/adapterhost` plus the coexistence router (M4), and the
> Postgres adapter itself (M5) — ending at **C1**, one real Postgres connection served end to end
> in Go while a MariaDB connection in the same session is still served by the Node child.
>
> **What this document may not relitigate.** The parent's Decisions (its D1–D20), its research
> (§1), its target tree (§3), its designs (§4), its testing plan (§5) and its sequencing (§9) are
> settled. Where this plan deviates from a parent *design* (its §4, which is design rather than
> decision), it says so in the open and gives the reason; where it finds something the parent's
> research got wrong or did not cover, §1 says so with the file and line that proves it; where the
> gap is genuinely not P58a's to close, §10 names it as a question for the parent's author instead
> of quietly answering it.
>
> **Decision numbering.** P58a's own decisions are **A1–A21**. Every reference to a parent decision
> is written **P58 D<n>** in full — never a bare `D<n>` — so the two numberings can never be
> confused in a cross-reference.
>
> Every claim below was read out of the tree as it stands at `e68b954` (the commit that added the
> parent plan), with `git grep`, `wc -l` and the actual files — not carried over from the parent
> plan's prose. Where the parent's own summary and the tree disagree, §1 records the tree.

## 0. What this sub-phase is, and what it is not

### 0.1 The six bodies of work

1. **M0 — probes.** Throwaway Go programs, no product code, proving the two claims P58a's own
   critical path rests on (`pgx` cancelling a backend from a side connection; `testcontainers-go`
   starting a Postgres container *in this sandbox*) plus two cheap ones that cost minutes and
   would cost days if wrong (pgx's text-mode row scanning and backend-PID exposure; Go's
   `encoding/json` treatment of `[]byte` vs `[]uint32`). §6.
2. **M1 — `shell/internal/adapters`.** The `Adapter` interface, `Caps`, the closed error set and
   its seven helpers, the registry, the live map, `sqltext.go` and `sqlmutate.go`. 840 lines of
   TypeScript, plus the Go-side data-plane model types that do not exist yet (§1.3). No engine.
3. **M2 — `shell/internal/page`.** The columnar codec: `TextColumnChunk`, `ColumnScratch`, the four
   builders, UTF-8 boundary truncation, `byteSize`, and the base64 chunk encoding (P58 D5) — plus
   the renderer's one-function decoder change, which must accept **both** encodings for the
   duration of coexistence (§1.2, A9). The only milestone in P58a that touches `src/`.
4. **M3 — `shell/internal/enginecache`.** L2 pages, L3 counts, the byte-budgeted LRU, the 1 Hz
   throttled stats emission, `Configure`.
5. **M4 — `shell/internal/adapterhost` and the router.** `runOp`/`cancelOp`, the data-op
   dispatcher with `data.ts`'s cache-aside discipline, the `Backend` seam behind
   `internal/connections`' and `internal/tree`'s call sites **plus `internal/bridge/ops.go`'s,
   which the parent's §1.5 enumeration missed** (§1.1), the empty `nativeKinds` table, and
   `bridge/stream.go`'s rewrite into a data-plane server. Behaviour is unchanged at the end of M4
   and every existing test still passes — that is what proves the seam.
6. **M5 — Postgres, native, and C1.** Tests first (P58 D12 / its R3), then the ten-file `postgres`
   package, then `nativeKinds["postgres"] = true`, then C1's checklist (§7).

### 0.2 Not in this sub-phase

- **No second adapter.** `nativeKinds` gains exactly one entry. MariaDB, MySQL, SQLite,
  ClickHouse, MongoDB, Redis, Kafka, SQS, S3 and RabbitMQ are all still Node-served at the end of
  P58a, and every one of them must still work — that is half of what C1 proves.
- **No deletion of anything.** `src/engine/` is untouched. `internal/enginehost/` is untouched
  except for one new sink adapter (§4.10). `tests/db/postgres.spec.ts` stays until its Go successor
  is green, and is deleted in P58a's last commit — not in P58f, per P58 D12's third rule.
  `tests/unit/{sql-text,engine-cache}.spec.ts` likewise.
- **No M0 probe for the other nine engines.** The parent's M0 (its §9) lists eight probes across
  eleven drivers. P58a runs the Postgres ones and the container one. §10 OQ-5 asks the parent's
  author whether the Kafka probe should nonetheless run here, since it is the only probe whose
  failure changes a `go.mod` decision (P58 D7's cgo fallback) — that is not P58a's call.
- **No renderer feature change, and one renderer *file* change.** `src/renderer/bridge/port.ts`'s
  `toTypedArray` body, and nothing else. §5.2 asserts it.
- **No `mongo/literal.go`, no `franz-go`, no `aws-sdk-go-v2`.** `shell/go.mod` gains exactly two
  modules in P58a: `github.com/jackc/pgx/v5` and `github.com/testcontainers/testcontainers-go`
  (plus their transitive requirements and testcontainers' `modules/postgres`).

### 0.3 The one thing in P58a that is hard to walk back, and the milestone that isolates it

Everything M1, M3, M4 and M5 add is additive Go: new packages, one new interface behind nine
existing call sites, one new `nativeKinds` entry. Deleting them restores the previous behaviour.

**M2 is different**, because it edits `src/renderer/bridge/port.ts`, which is the decoder for
*every* page from *every* engine, nine of which are still produced by the Node child. The parent's
P58 D5 describes the change as swapping `toTypedArray`'s body from `ctor.from(Object.values(v))`
to a base64 decode. Taken literally that breaks all ten Node-served kinds the moment it lands, and
keeps them broken for five sub-phases. §1.2 is the evidence; A9 is the resolution; the reason M2 is
its own milestone with its own commit is so that this one file's change is never mixed into a
diff with anything else.

## 1. What re-reading the tree found

### 1.1 There is a ninth `Host.Call` site, it is the stop button, and it cannot route by `ConnectionKind`

The parent's §1.5 enumerates the control-plane call sites as *"five call sites (`onPreconnectExit`,
`Remove`, `Test`, `attemptConnect`, `Disconnect`)"* in `internal/connections/service.go` and
*"three call sites"* in `internal/tree/service.go`, then lists *"the remaining `Host` consumers"* as
`Subscribe` (×2), `PushCacheConfig`, and `Alive`/`PID`.

Grepped for this plan (`grep -rn "EngineHost\.\|\.Host\.Call" --include=*.go shell/internal`), that
list is missing one:

```go
// shell/internal/bridge/ops.go:39
_, err := s.Deps.EngineHost.Call(enginehost.OpCancel, map[string]any{"opId": args.OpID})
```

`OpsService.Cancel` is **the stop button**. If M4's router does not cover it, C1's own
"a long query's stop button leaves `pg_stat_activity` clean" step fails, because the cancel goes to
the Node child, which has no op with that id and no adapter for that connection.

It is also the one call site that **cannot** be routed by `ConnectionKind`, because its only
argument is an `opId`. `adapter:cancel`'s payload (`engineOpPayloadSchema[ENGINE_OP.cancel]`) is
`{opId}` and nothing else, and `scheduler/ops.ts`'s `cancelOp` resolves the connection from its own
`running` map. So the router's discriminator for cancel has to be **"does the in-process scheduler
know this op id"**, not the connection's kind — see A13.

A tenth consumer, `internal/shell/app.go:89`'s `RegisterEngineStream(app, host *enginehost.Host)`,
also takes the concrete host and must take the router instead (§4.10). Neither is a large change;
both are the kind of thing that is only cheap if it is on the list before implementation starts.

### 1.2 The chunk encoding cannot flip in one step: ten kinds keep producing index-keyed chunks until P58f

`src/renderer/bridge/port.ts:77` today:

```ts
function toTypedArray<T>(v: unknown, ctor: { from(v: number[]): T }): T {
  return ctor.from(Object.values(v as Record<string, number>));
}
```

`reviveChunks` (`port.ts:81`) walks every response payload and rebuilds any object carrying
`data`/`offsets`/`nulls`/`truncated` together. It is the **only** decoder, and after M4 it receives
frames from **two producers**: `src/engine/stdio-main.ts`'s `writeFrame` (`JSON.stringify`, which
emits a TypedArray as `{"0":72,"1":101,…}`) for the ten Node-served kinds, and the new Go data-plane
server (base64, P58 D5) for Postgres.

Swapping the body outright at M2, as P58 D5's text reads, means every Node-served page fails
`assertChunkStructure` from M2 until P58f. That is not a hypothetical: it is exactly the failure
`AGENTS.md`'s P57 findings entry describes (*"every real data-view read failed downstream with
`chunk.data is not a Uint8Array`"*), which is why `reviveChunks` exists at all.

A9 resolves it: `toTypedArray` accepts a `string` (base64) **or** an index-keyed object, deleted
down to the base64 branch alone in P58f when the last Node producer goes. The diff stays one
function body, so P58 D5's own "confined to one function that already exists for this exact field"
property survives intact — it just holds two branches for five sub-phases instead of one.

### 1.3 The Go side has no data-plane types at all — an inventory of what P58a must author

Go has never parsed a data-plane frame (`bridge/stream.go`'s own comment: *"Go never unmarshals a
data-plane frame in either direction"*), so `internal/storage/model` carries only what the
*control* plane needed. Checked file by file in `shell/internal/storage/model/`:

| Type | TS home | Go today | Owed by |
|---|---|---|---|
| `NodePath`, `PathSegment`, `TreeNode`, `ColumnMeta`, `IndexMeta`, `ForeignKeyMeta`, `ObjectMeta` | `domain/tree.ts` | **exists** (`model/tree.go`) | — |
| `ObjectDefinition`, `ConstraintMeta` | `domain/definition.ts` | **exists** (`model/definition.go`) | — |
| `SortSpec`, `SortTerm` | `domain/queries.ts` | **exists** (`model/queries.go`, with a hand-written `UnmarshalJSON` for the discriminated union) | — |
| `ConnectionSummary`, `Settings` | `domain/connection.ts`, `domain/settings.ts` | **exists** | — |
| `ResolvedConnectionConfig` | `protocol/engine-ops.ts` | exists as **`connections.ResolvedConfig`**, in the wrong package (§1.4) | M1 (A3) |
| `MutationRowOp`, `MutationPlan`, `MutationResult` | `domain/mutations.ts` | **missing** | M1 (A4 — and its key-order trap) |
| `ConsoleRequest` | `domain/console.ts` | **missing** | M1 |
| `ObjectDownloadRequest`, `ObjectTransferResult` | `domain/object-store.ts` | **missing** | M1 |
| `PageCursor` | `protocol/data-ops.ts` | **missing** | M1 |
| `Caps`, `PageKind`, `PaginationStrategy` | `shared/caps.ts` | **missing** (`ConnectionState.Caps` is `any`) | M1 |
| `TextColumnChunk`, `PagePosition`, `ColumnDescriptor`, the four page types | `protocol/page.ts` | **missing** | M2 |
| `ReadRequestWire`, `CountRequestWire`, `PreviewRequestWire`, `MutateRequestWire`, `ExecuteRequestWire`, `ObjectDownloadRequestWire`, `InvalidateRequestWire`, and their responses | `protocol/data-ops.ts` | **missing** | M4 |
| `CacheStats` | `protocol/data-ops.ts` | **missing** | M3 |

Two of these carry a trap that a naive port walks straight into: `MutationRowOp`'s
`key`/`changes`/`values` (A4) and `Caps`'s optional `maxPageSize` (A2).

### 1.4 `ResolvedConfig` is in `internal/connections`, and the `Adapter` interface cannot reach it there

The parent's §4.1 writes `Connect(ctx, cfg model.ResolvedConnectionConfig, op *OpCtx)`. There is no
such type. The shape exists as `connections.ResolvedConfig` (`internal/connections/resolve.go:14`),
declared there deliberately — its own comment: *"declared here rather than in
`internal/storage/model` for the same reason the TS declares it in the protocol file … it is the one
shape that carries a secret, and only the engine channel ever sees it."*

That reasoning held while `enginehost.Call` took an `any` payload. It stops holding the moment an
in-process `Adapter` has to name the type: `internal/adapters` importing `internal/connections`
would invert the layering and violate the ported Adapter rule 1 (§4.1). A3 moves the type to
`model`, keeping the secret-carrying warning in its doc comment where it belongs.

### 1.5 Two shell behaviours over-reach the moment a connection is served in-process

Both are `engine:down` consequences that are correct today and become wrong at M5:

1. **`connections.watch()` → `MarkAllErrored("engine process exited")`**
   (`internal/connections/service.go:121-129, 505`). It flips **every** connected/connecting
   connection to `error`. After M5, a Postgres connection is not affected by the Node child dying —
   marking it errored is a false report and it also stops the preconnect script for a connection
   that is still live.
2. **`oplog.handleEngineDown`** (`internal/oplog/wire.go:180`) finishes every op still in its
   `inFlight` map with `"engine process exited"`. After M5 that map contains Go-native ops too.

(1) is a real user-visible defect and A15 narrows it. (2) is self-healing — `OpsRepo.Finish` is an
unconditional `UPDATE … WHERE id = ?` (`repos/ops.go:46-57`), so the Go op's own real `op:end`
overwrites the premature row when it arrives — which is why A14 can leave `internal/oplog`
**byte-unchanged** in P58a rather than editing it as the parent's §3 target-tree row anticipates.

### 1.6 The Postgres adapter, measured

`git grep -c "" -- src/engine/adapters/postgres` for this plan: **10 files, 1 726 lines.**

| File | Lines | What the Go port owes |
|---|---:|---|
| `index.ts` | 393 | the `Adapter` impl: path-shape validation for children/describe/definition/read/count/mutate/execute, the `ClientSet` lifecycle, `runningByOp` + `trackerFor`'s identity-checked release, and `cancel()`'s side connection |
| `catalog.ts` | 375 | eleven catalog queries (`listDatabases`, `listSchemas`, `listRelationsAndFunctions`, `getRelationInfo`, `listColumns`, `listIndexes`, `getReadTarget`, `queryForeignKeyEdges`, `listForeignKeys`, `listReferencedBy`) — SQL text ports verbatim; only the driver call and row scanning change |
| `definition.ts` | 243 | `buildDefinition`: seven catalog queries and the `CREATE TABLE`/`CREATE VIEW` composition, including `columnLine`'s generated-over-identity-over-default precedence and the serial-sequence ordering |
| `read.ts` | 208 | `quoteIdent`, `typeClassFor`, `normalizeCellText` (the `\x` → `0x` bytea rule), `readPage`, `countRows` |
| `console.ts` | 133 | `runRaw` (field metadata + identity parsers), `buildPage`, `lookupTypeNames`, `execute`'s one-`setCommand`-per-batch rule |
| `query.ts` | 116 | `runQuery`/`runCommand`: `setCommand` before issue, `assertNotCancelled`, backend-pid tracking, `withAbortRace`, error mapping, `logParams` |
| `mutate.ts` | 107 | `resolveTablePath` (postgres's own three-segment shape), `preview`, `mutate`'s fresh-catalog validation + BEGIN/COMMIT/ROLLBACK |
| `client.ts` | 110 | `buildClientConfig` (sslmode mapping, `application_name`, `statement_timeout: 0`) and `ClientSet`'s 8-entry LRU of one client per database |
| `errors.ts` | 25 | `mapError`: five SQLSTATE/errno branches onto the closed code set |
| `caps.ts` | 26 | the 21-field literal |

Three properties are worth naming before anyone starts, because each is a place a correct-looking
port loses behaviour:

- **`cancel()` is the only method that opens a connection of its own** — `index.ts:349` builds a
  fresh `Client` from `buildClientConfig(this.cfg)`, runs `SELECT pg_cancel_backend($1)`, and ends
  it in a `finally`. It is not pooled, not reused, and not the `ClientSet`'s. §4.11 keeps that.
- **`runningByOp`'s release closure does an identity check** (`index.ts:380-387`): a multi-statement
  op (mutate's `BEGIN`/…/`COMMIT`, console's "Run all") registers a new `RunningQuery` per
  statement under one op id, and an earlier statement settling after a later one has started must
  not unregister the later one. `tests/db/postgres.spec.ts` test 33 is the regression test.
- **`ClientSet` is deliberately not a pool** (`client.ts:46-48`): *"one `Client` per (connection,
  database), never a `Pool`, because `pg_cancel_backend` needs a known backend pid and a Pool does
  not reliably tell you which backend ran your query."* This is P58 D20's postgres row, and pgx
  makes it easy to get wrong (`pgxpool` is the ergonomic default).

### 1.7 `tests/db/postgres.spec.ts` — 34 scenarios, 1 633 lines, and how much of it ports

Counted for this plan. The 34 tests split cleanly:

- **28 port as-is** against the Go adapter through the same seeded fixture (`tests/db/fixtures/
  0001_seed.sql`, read unchanged by the Go seeder per P58 D12): 1, 3–6, 8–21, 23, 25–28, 31–34.
- **3 assert driver error *text* or code** and must be re-baselined against pgx's own wording, never
  loosened (P58 §1.10's first non-portable point): 2 (`E_AUTH`), 23 (`E_NOT_FOUND` message), 29
  (a failing statement's message).
- **2 drive the scheduler, not the adapter** (7 and 30) and become tests of
  `internal/adapterhost` rather than of `internal/adapters/postgres`. Test 7 in particular
  constructs a whole fake `Adapter` to prove `cancelOp` forwards to `adapter.cancel` — in Go that is
  a test of `adapterhost.Host.Cancel` with a stub `adapters.Adapter`, plus the *real* server-side
  assertion (`pg_stat_activity` goes quiet) kept exactly as it is, because P58 D12's rejected
  alternative is precisely "test it above the wire".
- **1 is a pure caps assertion** (8) and becomes a one-line Go test.

The `waitUntil`-on-`pg_stat_activity` pattern (spec lines 53–63, 371–396) is the single most
valuable thing in the file and ports verbatim: it is the only instrument in the repo that can tell
"we stopped waiting" from "the server stopped working".

### 1.8 `pgx`: what is settled, and the two things M0 must actually check

Settled by P58 D6/§1.8 and not reopened here: `github.com/jackc/pgx/v5`, native interface (not
`database/sql`), and cancellation stays `SELECT pg_cancel_backend($1)` on a side connection rather
than `pgconn.CancelRequest` (which opens its own unencrypted socket).

What that decision does **not** state, and what M5 cannot be written without:

1. **The backend PID must be readable from a live connection.** `query.ts:48` reads
   `(client as {processID?: number}).processID` — node-postgres exposes it as a property. pgx's
   analogue is `conn.PgConn().PID()`; if it were not exposed, the whole cancellation design would
   need a `SELECT pg_backend_pid()` round trip per connection instead, which is a different
   `ClientSet` shape. Probe PG-1.
2. **Every cell must arrive as the server's own text, unconverted.** `read.ts` and `console.ts` both
   run with `types: { getTypeParser: () => (v) => v }` — an identity parser — because the page codec
   stores text and any per-type JS conversion would have to be undone. pgx converts to Go types by
   default. The analogue is a text-format query plus `RawValues()`/scanning into `*string`, and
   whether that is available on the *same* connection as the typed catalog queries determines
   whether one connection can serve both. Probe PG-2.

Neither is a research question about the ecosystem — both are five-minute questions against a real
server, which is exactly what M0 is for.

### 1.9 Environment facts that already hold, and need no re-deriving

- **`./internal/adapters/...` needs no GTK/WebKit headers.** P58 §10 states it; confirmed against
  the tree: `internal/adapters` (new) will import only stdlib, `internal/storage/model`,
  `internal/page` and `pgx`. `libgtk-4-dev`/`libwebkitgtk-6.0-dev` are needed only for
  `internal/shell` and the root `main` package — so P58a's fast loop is
  `go test ./internal/adapters/... ./internal/page/... ./internal/enginecache/...` and never `./...`.
  cgo is still on (`mattn/go-sqlite3` is already a dependency of `internal/storage`), so
  `CGO_ENABLED=0` is not an option for the module as a whole.
- **Docker, the mirror and the retag are daemon-level** (`AGENTS.md`'s Docker section):
  `nohup dockerd > /tmp/dockerd.log 2>&1 & disown`, then
  `docker pull mirror.gcr.io/library/postgres:17-alpine && docker tag mirror.gcr.io/library/postgres:17-alpine postgres:17-alpine`.
  `testcontainers-go` asks for `postgres:17-alpine` and the daemon already has it. **No Go code
  references the mirror.**
- **The Bun/testcontainers hang has no Go analogue** — `AGENTS.md` records it as specific to
  `bun run`, and it is the reason `scripts/capture-postgres-tree.ts` exists at all. M0's TC-1 is
  what turns "expected to be simpler" into a recorded fact.
- **`shell/frontend/bindings` is git-ignored** and must be regenerated in a fresh container before
  `bun run build` resolves its imports. P58a changes no bound method *signature*, so one
  regeneration per fresh container is enough.
- **A background process started in one shell invocation cannot be signalled from a later one**
  (`AGENTS.md`, P51). C1's app run — start, screenshot, exercise, tear down — is one Bash
  invocation with a 120–150 s timeout.

## 2. Decisions

**A1 — `internal/adapters` is the Go package name, and `AdapterError` becomes `adapters.Error`.**
Go convention is to avoid stutter (`adapters.AdapterError` reads badly at every call site, and
there are hundreds). The **wire code strings are unchanged** — that is the part P58 D1 protects and
it is protected by A5's constant table, not by the Go type's name. `adapters.Error` /
`adapters.New(code, msg, cause)` / `adapters.Unsupported(...)`.

**A2 — `Caps` is a Go struct with exact JSON tags, and `maxPageSize` is a `*int` with
`omitempty`.** `capsSchema` (`src/shared/caps.ts:83-106`) declares 21 required fields and one
`.optional()`. A non-pointer `int` with `omitempty` would omit a legitimate `maxPageSize: 0` (not
reachable — the schema requires positive) but, worse, a plain `int` without `omitempty` would emit
`"maxPageSize": 0` for the ten adapters that have none, which `capsSchema.parse` rejects
(`z.number().int().positive()`). Pointer plus `omitempty`. The struct field order follows
`caps.ts`'s declaration order so the two files diff against each other.

**A3 — `connections.ResolvedConfig` moves to `model.ResolvedConnectionConfig`.** §1.4. The move is
mechanical (four references: `resolve.go`'s two constructors, `service.go`'s two `Host.Call`
payloads) and carries its doc comment — including the *"this is the one shape that carries a
secret"* warning — with it. Rejected alternative: declaring a second, structurally identical type in
`internal/adapters`. Two types that must stay in sync, for the aesthetics of package placement, is
how a password field ends up on only one of them.

**A4 — `MutationRowOp`'s `key`/`changes`/`values` are an order-preserving type, not a Go map.**
This is the single most easily-missed correctness item in M1. `sql-mutate.ts`'s `renderRowOp` emits
columns in `Object.entries(...)` order, which for a JSON-parsed object is the wire's own key order —
and `tests/db/postgres.spec.ts` test 21 asserts the exact emitted text:

```
INSERT INTO "app"."composite_pk" ("tenant_id", "entity_id", "name") VALUES ('3', '1', 'new tenant')
DELETE FROM "app"."composite_pk" WHERE "tenant_id" = '2' AND "entity_id" = '1'
```

A `map[string]*string` randomises that on every run: the preview dialog would show a different
column order each time it opened, and the test would flake rather than fail. `model.RowValues` is a
slice of `{Name string; Value *string}` with an `UnmarshalJSON` that reads the object through
`json.Decoder`'s token stream to keep order, and a `MarshalJSON` that writes it back in the same
order. It gets a unit test (§5.3), because "JSON object key order" is exactly the class of thing
that is invisible until it is wrong in production.

**A5 — the eight `AdapterErrorCode` strings are a Go constant table, and nothing else is ever put
in it without a matching renderer change.** `src/renderer/views/shared/viewOp.ts:21-33` branches on
`E_CANCELLED` and on `DISCONNECTED_CODES = {E_ENGINE_DOWN, E_CONNECT}`; `src/renderer/state/
tabs.ts:603` does the same. A renamed or added code silently stops matching, and the failure mode
is a tab that never offers "Reconnect & load". The eight, verbatim from `errors.ts:4-12`:
`E_CONNECT`, `E_AUTH`, `E_CANCELLED`, `E_TIMEOUT`, `E_NOT_FOUND`, `E_QUERY`, `E_UNSUPPORTED`,
`E_ENGINE_DOWN`. See OQ-1 for `E_INTERNAL`, which P58 D16 assumes exists and does not.

**A6 — every helper in `errors.ts` ports with its message byte-identical, and the two cancellation
messages stay distinct.** `assertNotCancelled` → `"operation was cancelled before it started"`;
`throwIfCancelled` → `"operation was cancelled"`. `errors.ts:66-70` says the difference is
deliberate. In Go both become `ctx.Err()` checks (`adapters.CheckNotStarted(ctx)` and
`adapters.CheckCancelled(ctx)`), and the two names are kept apart for the same reason.

**A7 — `Cancel` takes a `context.Context`; `Kind()` returns `string`.** Two deviations from the
parent's §4.1 signature block, both forced by the tree rather than chosen. `cancel()` opens a
network connection and runs a query (`index.ts:349-365`) — a Go method that does I/O without a
context is a bug waiting for a hang, and pgx requires one. And there is no `model.ConnectionKind`
type in Go: `model.ValidConnectionKind(v string) bool` is the whole of it
(`model/connection.go:62-63`), and inventing a named string type now would ripple through
`ConnectionSummary`, the repos and the bridge for no gain in P58a.

**A8 — `BuildKeysetPosition` takes a row count plus a `CellAt` closure, not a generic row slice.**
The TypeScript is generic over `Row` only so each adapter can hand in its own row representation
via `cellAt`. Go generics would work but produce a type parameter that every caller has to spell out
for no benefit; `DisplayRowCount int` + `CellAt func(row, col int) *string` expresses exactly the
same dependency and keeps the function non-generic. Its behaviour — including
`hasMore`/`nextToken`/`prevToken`'s four-way cursor-mode rules — ports unchanged.

**A9 — `port.ts`'s `toTypedArray` accepts base64 *and* the index-keyed object, for the duration of
coexistence.** §1.2. The function grows one branch:

```ts
function toTypedArray<T>(v: unknown, ctor: …): T {
  if (typeof v === 'string') return /* base64 → bytes → ctor over its buffer */;
  return ctor.from(Object.values(v as Record<string, number>));  // Node engine; deleted in P58f
}
```

The second branch carries a comment naming P58f as its removal milestone. This is a narrowing of
P58 D5's own wording, not a contradiction of it: D5's substantive claim (base64 on the wire, one
renderer function, everything downstream unchanged) holds exactly.

**A10 — `tests/ui/`'s fixtures are not re-encoded in P58a.** The parent's §5.1 says
`mockStreamBrowser.js` needs its chunk fields emitted as base64. With A9's dual decoder it does not:
the existing index-keyed fixtures keep decoding through the second branch, which is also free
coverage that the branch works. Re-encoding them in P58a would mean regenerating fixtures whose
producer has not changed, and would put `tests/ui/` in P58a's diff for no behavioural reason. The
fixture generator flips in P58f, in the same commit that deletes the second branch. (P58 §5.1's
`byteSize: 0` warning still applies to whoever does that: real byte sizes, computed with the page
codec's own formula.)

**A11 — the `Backend` seam is a consumer-declared interface per consumer, not one shared
`EngineBackend` type.** This repo already does this three times: `tree.Connected`
(`tree/service.go:20`), `oplog.EventSource` (`oplog/wire.go:21`), `enginehost.Sink`
(`enginehost/stream.go:18`) — each a small interface declared in the package that *uses* it, with a
comment saying so (P54 D14's discipline). P58a follows it: `connections.Backend` (4 methods),
`tree.Backend` (3 methods), `bridge.Canceller` (1 method). One concrete `adapterhost.Router`
satisfies all three structurally. This costs nothing over a single shared interface and buys two
things: each consumer's test can keep using a two-line stub, and P58f deletes three small
declarations rather than a package.

**A12 — `nativeKinds` is a `map[string]bool` in `adapterhost/router.go`, and a kind is added in the
same commit as its adapter's tests going green — never earlier.** P58 §4.6, restated as a rule about
commits. In P58a it goes from empty (M4) to `{"postgres": true}` (M5's last commit).

**A13 — cancel routes on op ownership, not on connection kind.** §1.1. `adapterhost.Router.Cancel(ctx, opID)`
asks its own scheduler first; if the op is unknown in-process it forwards to `enginehost.Call(OpCancel, …)`.
Op ids are UUIDs — renderer-minted for data ops (`ReadRequestWire.opId`), scheduler-minted for
control ops (`scheduler/ops.ts:35`) — so they never collide across the two hosts, and "unknown
here" is a safe discriminator. The forward is unconditional rather than gated on
`len(nativeKinds) < 11`, so the same code path is correct on the day the Node child is deleted (it
just stops being reached).

**A14 — `internal/oplog` is byte-unchanged in P58a; `adapterhost` satisfies the existing
`oplog.EventSource` interface, and `main.go` merges the two sources.** The parent's §3 target tree
marks `oplog/wire.go` EDITED for P58 D10. It does not have to be, and it should not be: `wire.go`'s
`consume` loop is *"the only reader and writer of `inFlight`, so that map needs no mutex — nobody
should add one"* (`wire.go:88-89`), and a second producer calling into it directly is exactly how
that comment gets violated. Instead `adapterhost` exposes
`Subscribe() (<-chan enginehost.Event, func())`, emitting `op:start`/`op:end` with payloads
marshalled to match `opStartEventSchema`/`opEndEventSchema`, and a ~30-line
`enginebackend.Merge(a, b EventSource) EventSource` fans the two channels into one. oplog's diff in
P58a is zero; P58f collapses the merge and may then convert to a typed direct call if it wants to.
*Cost, named:* one `json.Marshal`/`json.Unmarshal` round trip per op-log event, in-process. At op-log
volumes (one row per user-visible operation) that is not a cost worth a mutex.

**A15 — `connections.MarkAllErrored` is narrowed to Node-served connections.** §1.5. The
`engine:down` handler marks only connections whose kind is **not** in `nativeKinds`; a Go-native
connection is unaffected by the Node child exiting, because it is. Without this, killing the Node
child at M5 would drop a live Postgres connection and stop its pre-connect script. This gets an
explicit M4 acceptance check (§8) and is an optional extra step in C1 (§7).

**A16 — during coexistence `cache:stats` sums the two caches' *counters* and reports the
*configured* budget once, not twice.** P58 §4.6 says `cache:stats` must report the sum and
`cache:clear` must clear both, and it is right about `l2Bytes`/`l2Entries`/`l2Hits`/`l2Misses`/
`l3Entries` — those are counters and sum correctly. `l2BudgetBytes` is **not** a counter: both
caches are configured with the same `settings.cache.l2BudgetMb`, so summing it would report 128 MB
for a 64 MB setting and the Settings → Cache dialog would show a budget the user never set. The
router reports the configured budget once. This is a "silently wrong number" of exactly the class
`AGENTS.md`'s P57 findings warn about, and it is temporary by construction.

**A17 — `ping` keeps being answered by the Node child through P58a.** `src/renderer/workbench/
state/engine.ts:18` pings over the data plane and reads `pong.enginePid` into the status pill; the
handler is `rpc.ts:16`. The router forwards `ping` verbatim like any other unrouted data op, so the
pill keeps reporting the child's pid and nothing in the renderer changes. P58f flips it to the app's
own pid, in the same commit as P58 D14's `EngineService.Status()` change. Answering it in Go at M4
would make the pill report the app pid while the child is still doing most of the work — a true
statement that reads as a false one.

**A18 — one writer goroutine owns the renderer stream; both producers enqueue into it.** §4.10.
`bridge.ServeEngineStream` currently attaches the renderer connection **as `enginehost`'s sink**
directly, so `enginehost`'s `streamWriter` is the only thing calling `conn.Send`. After M4 the Go
side also produces frames, and `application.StreamConn.Send` blocks (P54's correction, still true —
`TrySend` is the non-blocking one). Two goroutines calling a blocking `Send` on one session is a
data race waiting to be discovered on macOS. The router owns one bounded queue (64 frames /
32 MiB, matching `enginehost/stream.go:28-29`) and one writer; `enginehost`'s sink becomes a small
adapter that enqueues into that queue and returns `enginehost.ErrStreamFull` when it is full —
which makes `enginehost`'s existing backoff-and-stop-draining behaviour, and therefore the OS pipe
backpressure onto the Node child, work unchanged.

**A19 — the Go container harness lives at `shell/internal/adapters/testsupport/` and skips
legibly.** P58 §4.10. `testsupport.RequireDocker(t)` calls `t.Skip` with the same class of message
`tests/db/support/docker.ts`'s `DOCKER_UNAVAILABLE_MESSAGE` carries — never a silent pass, never a
hard failure that makes `go test ./internal/adapters/...` unusable on a box without a daemon.
`testsupport.StartPostgres(t)` memoizes one container per test binary and seeds it by executing
`tests/db/fixtures/0001_seed.sql` **read from the repo, unmodified** (P58 D12), located relative to
the module root rather than the test's own directory.

**A20 — the Postgres package keeps its ten-file decomposition, one Go file per TypeScript file.**
P58 D18, applied. `index.ts` → `adapter.go` (Go has no `index` convention and `postgres/index.go`
would read as a package index); the other nine keep their names. The point is diffability: when a
Go behaviour disagrees with the TypeScript, `postgres/read.go` and `postgres/read.ts` are the two
files to put side by side.

**A21 — `tests/db/postgres.spec.ts`, `tests/unit/sql-text.spec.ts` and
`tests/unit/engine-cache.spec.ts` are deleted inside P58a, each in the commit after its Go successor
is green, and never before.** P58 D12's third rule and `AGENTS.md`'s own standard (*"deleting a test
whose subject moved is correct; the thing to check is that the Go test actually covers the same
assertion"*). §5.3's and §5.4's tables are that check, written before the deletion rather than
recalled after it.

## 3. Target tree

```
shell/internal/adapters/                    NEW    M1
  adapter.go              NEW  Adapter, OpCtx, ConnectInfo, ReadRequest, CountRequest,
                               CountResult, TreeChildren, Progress; Adapter rules 1-8 as the
                               interface's doc comment, rule 1 rewritten (§4.1)
  caps.go                 NEW  Caps (A2) + PageKind/PaginationStrategy constants
  errors.go               NEW  Error, the eight codes (A5), Unsupported, NoQueryConsole,
                               AssertWritable, CheckNotStarted, CheckCancelled, RequireConnected
  registry.go             NEW  kind -> constructor; registry.ts's successor
  live.go                 NEW  the mutex-guarded map[connectionID]Adapter (live.ts)
  sqltext.go              NEW  sql-text.ts's 18 exported functions (§4.4)
  sqlmutate.go            NEW  sql-mutate.ts's 9 exported functions (§4.5)
  sqltext_test.go         NEW  tests/unit/sql-text.spec.ts's 17 cases, ported one for one
  sqlmutate_test.go       NEW  renderRowOp column-order + orderedOps stability (A4)
  testsupport/            NEW  M5   docker gate, container start, seed-SQL loader (A19)
  postgres/               NEW  M5   ten files (A20) + postgres_test.go
shell/internal/page/                        NEW    M2
  chunk.go                NEW  TextColumnChunk, Uint32LE, base64 marshalling (P58 D5), isNull/
                               cellText/isTruncated/chunkByteSize/pageByteSize
  scratch.go              NEW  ColumnScratch: grow, appendValue, truncateUTF8ToBoundary, finish
  builder.go              NEW  the four builders + PagePosition + UnpagedPosition + the page types
  page_test.go            NEW  null-vs-empty, UTF-8 boundary, reverse(), base64 round trip
shell/internal/enginecache/                 NEW    M3
  lru.go                  NEW  ByteLru: byte budget, insertion-order touch, half-budget refusal
  pages.go                NEW  L2: key derivation, hit/miss counters, drop by target/connection
  counts.go               NEW  L3: TTL/DROP windows, stale marking, the 128 B nominal cost
  cache.go                NEW  the facade + the 1 Hz throttled stats emitter
  cache_test.go           NEW  tests/unit/engine-cache.spec.ts's 8 cases, ported one for one
shell/internal/adapterhost/                 NEW    M4
  host.go                 NEW  RunOp/CancelOp, the running map, the recover() boundary (P58 D16),
                               op:start/op:end emission, Subscribe (A14)
  data.go                 NEW  the data-op dispatcher + data.ts's cache-aside discipline
  wire.go                 NEW  the eight data-plane request structs + Validate() (P58 D17)
  router.go               NEW  nativeKinds (A12), the control-plane routing, Cancel (A13),
                               the cache-stats merge (A16)
  stream.go               NEW  the single-writer bounded queue + the enginehost sink adapter (A18)
shell/internal/enginebackend/               NEW    M4
  merge.go                NEW  Merge(a, b oplog.EventSource) — ~30 lines (A14)
shell/internal/storage/model/               EDITED M1
  connection.go           EDITED ResolvedConnectionConfig moves here from connections (A3)
  mutations.go            NEW   MutationRowOp, MutationPlan, MutationResult, RowValues (A4)
  console.go              NEW   ConsoleRequest
  objectstore.go          NEW   ObjectDownloadRequest, ObjectTransferResult
  cursor.go               NEW   PageCursor + its discriminated-union UnmarshalJSON
shell/internal/connections/service.go       EDITED M4  Host -> Backend (A11); MarkAllErrored
                                                       narrowed (A15)
shell/internal/connections/resolve.go       EDITED M1  ResolvedConfig -> model (A3)
shell/internal/tree/service.go              EDITED M4  host -> Backend (A11)
shell/internal/bridge/ops.go                EDITED M4  Cancel -> the router (§1.1)
shell/internal/bridge/stream.go             REWRITTEN M4 data-plane server, not byte forwarder
shell/internal/shell/app.go                 EDITED M4  RegisterEngineStream takes the router
shell/main.go                               EDITED M4  build the router, merge the op sources
shell/go.mod                                EDITED M0/M5 pgx/v5, testcontainers-go (+ modules/postgres)

shell/internal/oplog/**                     UNCHANGED  A14 — deliberately, not by omission
shell/internal/enginehost/**                UNCHANGED  the child is untouched in P58a
src/engine/**                               UNCHANGED  P58f deletes it
src/shared/protocol/**                      UNCHANGED  P58 D1
src/renderer/bridge/port.ts                 EDITED M2  toTypedArray gains a base64 branch (A9)
src/renderer/**                             UNCHANGED  everything else — §5.2 asserts it

tests/db/postgres.spec.ts                   DELETED M5 last commit (A21)
tests/db/support/postgres.ts                DELETED M5 last commit — its only consumer goes
tests/db/fixtures/0001_seed.sql             UNCHANGED  the Go seeder reads this exact file
tests/unit/sql-text.spec.ts                 DELETED M1 last commit (A21)
tests/unit/engine-cache.spec.ts             DELETED M3 last commit (A21)
tests/ui/**                                 UNCHANGED  A10
tests/ipc/**                                UNCHANGED  P58a ports no fixture generator
package.json                                EDITED M5 last commit: `test:db` loses its postgres arm
docs/PERF.md                                EDITED M2  the re-taken inflation measurement
docs/ARCHITECTURE.md                        EDITED M4  the bulk-data invariant (P58 D3)
AGENTS.md                                   EDITED M5  the P58a findings entry
```

## 4. Designs

### 4.1 The `Adapter` contract in Go

`adapter.ts`'s interface, translated method for method. Deviations from the parent's §4.1 sketch are
A7 (`Cancel`'s context, `Kind()`'s type) and the concrete `OpCtx`.

```go
// Package adapters is the Go analogue of src/engine/adapters/: the Adapter contract every engine
// implements, the Caps declaration the UI reads instead of a kind check, the closed error-code set
// the renderer branches on, and the two dialect-agnostic SQL helpers four adapters share.
//
// Rules that hold for every adapter, present and future:
//
//  1. An adapter imports nothing from github.com/wailsapp/wails, nothing from internal/bridge and
//     nothing from internal/shell. It is a plain Go package — this is what makes the per-engine
//     tests able to drive it directly and what keeps the adapter layer shell-agnostic.
//     (adapter.ts's rule 1 said "imports nothing from electron", against the shell of its day.)
//  2. Every method that talks to the server takes a context.Context and honours cancellation. A
//     method that ignores ctx.Done() is a bug even if the underlying driver "is fast".
//  3. op.SetCommand() is called before the statement is issued, not after it returns — an op that
//     is cancelled mid-flight must still show what it was running.
//  4. Errors are *adapters.Error with a code from the closed set and the server's own message
//     verbatim in Message. Wrapping starts and ends there.
//  5. Children() returns an empty slice for a leaf, never an error.
//  6. An adapter is single-connection. One instance <-> one connections row. live.go owns the map.
//  7. Read() and Count() obey the same identifier rule as the catalog code, via quoteIdent. Every
//     identifier they emit came out of a catalog query in the same op.
//  8. A page is built with internal/page's builders. There is one codec.
type Adapter interface {
	Kind() string
	Caps() Caps

	Connect(ctx context.Context, cfg model.ResolvedConnectionConfig, op *OpCtx) (ConnectInfo, error)
	Disconnect(ctx context.Context) error

	Children(ctx context.Context, path model.NodePath, op *OpCtx) (TreeChildren, error)
	Describe(ctx context.Context, path model.NodePath, op *OpCtx) (model.ObjectMeta, error)
	Definition(ctx context.Context, path model.NodePath, op *OpCtx) (model.ObjectDefinition, error)

	// Cancel forwards a cancel for an in-flight op to the server. Reports false when the op was
	// unknown or the server refused; never an error for "already finished". An adapter with
	// Caps().Cancel == false reports false unconditionally.
	Cancel(ctx context.Context, opID string) (bool, error)

	Read(ctx context.Context, req ReadRequest, op *OpCtx) (page.Page, error)
	Count(ctx context.Context, req CountRequest, op *OpCtx) (CountResult, error)

	// Preview never executes and never touches the network (P5 D6). It returns an error rather
	// than panicking, so a malformed plan is a failed op and not a recovered panic (P58 D16).
	Preview(plan model.MutationPlan) ([]string, error)
	Mutate(ctx context.Context, plan model.MutationPlan, op *OpCtx) (model.MutationResult, error)
	Execute(ctx context.Context, req model.ConsoleRequest, op *OpCtx) ([]page.Page, error)
	DownloadObject(ctx context.Context, req model.ObjectDownloadRequest, op *OpCtx) (model.ObjectTransferResult, error)
}

type Deps struct {
	Log func(level, message string) // "info" | "warn" | "error"
}

type ConnectInfo struct {
	ServerVersion string            `json:"serverVersion"`
	Details       map[string]string `json:"details,omitempty"`
}

type ReadRequest struct {
	Path       model.NodePath
	Projection []string // nil = every column
	Filter     *string
	Sort       *model.SortSpec
	PageSize   int // already validated <= page.MaxPageSize at the dispatcher boundary
	Cursor     model.PageCursor
}

type CountRequest struct {
	Path   model.NodePath
	Filter *string
}

type CountResult struct {
	Value int64
	Exact bool
}

// TreeChildren carries P43 iter2 D21's optional truncation flag: Truncated is true only when the
// adapter hit its own round budget with more still to come. A pointer, not a bool, so the eight
// adapters that cannot truncate say nothing rather than saying false eight times.
type TreeChildren struct {
	Nodes     []model.TreeNode
	Truncated *bool
}
```

`OpCtx` keeps exactly what is op-scoped once `context.Context` has taken over cancellation:

```go
type Progress struct {
	Message string
	Done    *int
	Total   *int
}

// OpCtx is the op-scoped half of scheduler/ops.ts's RunOpCtx. Cancellation is not here — that is
// the context. The mutex is not decorative: a driver callback may call SetCommand from a goroutine
// other than the one running the op (postgres's console batch does).
type OpCtx struct {
	OpID       string
	OnProgress func(Progress)

	mu      sync.Mutex
	command string
	rows    *int
}

func NewOpCtx(opID string) *OpCtx
func (c *OpCtx) SetCommand(text string)   // Adapter rule 3
func (c *OpCtx) SetRows(n int)
func (c *OpCtx) Command() string
func (c *OpCtx) Rows() *int
```

`NewRecordingOpCtx()` (test-only, in `adapters`) is the Go analogue of
`tests/db/postgres.spec.ts`'s `makeCtx()` recording variant: it keeps every `SetCommand` call in a
slice so a test can assert how many round trips an operation issued (spec tests 31/32 depend on it).

### 4.2 `Caps`

```go
type Caps struct {
	Tabular         bool   `json:"tabular"`
	Documents       bool   `json:"documents"`
	KeyValue        bool   `json:"keyValue"`
	Stream          bool   `json:"stream"`
	KeyBrowser      bool   `json:"keyBrowser"`
	DefaultPageKind string `json:"defaultPageKind"`
	SQL             bool   `json:"sql"`
	Definition      bool   `json:"definition"`
	Describe        bool   `json:"describe"`
	Projection      bool   `json:"projection"`
	ServerFilter    bool   `json:"serverFilter"`
	ExactCount      bool   `json:"exactCount"`
	Pagination      string `json:"pagination"`
	ForeignKeys     bool   `json:"foreignKeys"`
	CanInsert       bool   `json:"canInsert"`
	CanUpdate       bool   `json:"canUpdate"`
	CanDelete       bool   `json:"canDelete"`
	Writable        bool   `json:"writable"`
	Transactions    bool   `json:"transactions"`
	Cancel          bool   `json:"cancel"`
	FileTransfer    bool   `json:"fileTransfer"`
	MaxPageSize     *int   `json:"maxPageSize,omitempty"` // A2
}
```

Postgres's literal (`postgres/caps.go`), value for value from `caps.ts:3-25`: `Tabular: true`,
`Documents/KeyValue/Stream/KeyBrowser: false`, `DefaultPageKind: "tabular"`, `SQL: true`,
`Definition: true`, `Describe: true`, `Projection: true`, `ServerFilter: true`, `ExactCount: true`,
`Pagination: "keyset"`, `ForeignKeys: true`, `CanInsert/CanUpdate/CanDelete: true`,
`Writable: true`, `Transactions: true`, `Cancel: true`, `FileTransfer: false`, `MaxPageSize: nil`.

### 4.3 The error model

```go
type ErrorCode string

const (
	CodeConnect     ErrorCode = "E_CONNECT"
	CodeAuth        ErrorCode = "E_AUTH"
	CodeCancelled   ErrorCode = "E_CANCELLED"
	CodeTimeout     ErrorCode = "E_TIMEOUT"
	CodeNotFound    ErrorCode = "E_NOT_FOUND"
	CodeQuery       ErrorCode = "E_QUERY"
	CodeUnsupported ErrorCode = "E_UNSUPPORTED"
	CodeEngineDown  ErrorCode = "E_ENGINE_DOWN"
)

type Error struct {
	Code    ErrorCode
	Message string // the server's own message, verbatim (rule 4)
	Cause   error
}

func (e *Error) Error() string { return e.Message }
func (e *Error) Unwrap() error { return e.Cause }
func New(code ErrorCode, message string, cause error) *Error
func CodeOf(err error) (ErrorCode, bool)   // errors.As, for the dispatcher and the router
```

The seven helpers, messages byte-identical to `errors.ts`:

| TS | Go | message |
|---|---|---|
| `unsupported(kind, what)` | `Unsupported(kind, what string) error` | `"<what> is not supported for <kind>"` |
| `noQueryConsole(kind)` | `NoQueryConsole(kind string) error` | `"<kind> has no query console"` |
| `assertWritable(readOnly)` | `AssertWritable(readOnly bool) error` | `"connection is read-only"` |
| `assertNotCancelled(ctx)` | `CheckNotStarted(ctx context.Context) error` | `"operation was cancelled before it started"` |
| `throwIfCancelled(ctx)` | `CheckCancelled(ctx context.Context) error` | `"operation was cancelled"` |
| `requireConnected(handle)` | `RequireConnected[T any](h *T) (*T, error)` | `"adapter is not connected"` |
| `toWireError(err)` | *(moves to `adapterhost`)* | — |

`toWireError` does **not** live in `adapters`: it produces the `{message, code}` envelope the wire
carries, which is a boundary concern. `adapterhost` owns two conversions instead —
`toWire(err) WireError` for data-plane responses, and `toIPCErr(err) *ipcerr.Error` for control-plane
returns, the latter preserving the code so `internal/connections`' existing `errorMessage`/`wrapErr`
handling (`service.go:136-156`) keeps behaving as it does with an `enginehost` error today. Keeping
both in `adapterhost` is what lets `internal/adapters` import nothing from `internal/bridge`
(Adapter rule 1).

Postgres's `mapError` (`postgres/errors.go`) ports as a `mapError(err error) error` over pgx's
`*pgconn.PgError.Code` for the SQLSTATE branches (`28P01`/`28000` → `E_AUTH`, `57014` →
`E_CANCELLED`) and over `net.OpError`/`net.DNSError`/`os.ErrDeadlineExceeded` for the three Node
errno branches (`ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT` → `E_CONNECT`), defaulting to `E_QUERY`. The
errno branch is the one place where a literal port is impossible — Go does not surface libuv errnos
— and it is re-derived against real failures in M5's tests (a refused port, an unresolvable host),
not guessed.

### 4.4 `sqltext.go` — `sql-text.ts`'s 378 lines, function by function

Every exported function, its Go signature, and what has to be watched.

| `sql-text.ts` | Go | Notes |
|---|---|---|
| `buildOrderBy(terms, quote)` | `BuildOrderBy(terms []OrderTerm, quote func(string) string) string` | `direction.toUpperCase()` → `strings.ToUpper` |
| `buildKeysetPredicate(cols, dir, mode, first, ph)` | `BuildKeysetPredicate(columns []string, direction, mode string, firstParamIndex int, placeholder func(int) string) string` | the operator table `(mode=="after")==(dir=="asc") ? ">" : "<"` ports literally |
| `encodePageToken(key, fp)` | `EncodePageToken(key []string, fingerprint string) string` | payload struct field order `{v,k,f}`; **`base64.RawURLEncoding`** — Node's `'base64url'` is unpadded |
| `decodePageToken(token, fp)` | `DecodePageToken(token, expected string) ([]string, error)` | two distinct messages, both verbatim: `"malformed page token"` and the 2-line fingerprint-mismatch sentence |
| `requestFingerprint(parts)` | `RequestFingerprint(parts any) string` | sha1 → hex → first 16 chars. Deterministic within a process is all that is required (a token is only ever decoded by the process that minted it); use a struct, not a map, so the encoding reads like the TS |
| `resolveProjection(cols, requested)` | `ResolveProjection(columns []model.ColumnMeta, requested []string) ([]model.ColumnMeta, error)` | `requested == nil` → return the input slice itself (spec 11c asserts identity); dedupe then sort by `Position` |
| `safeInt(value, label)` | `SafeInt(value int, label string) (int, error)` | Go int is integral; only the `< 0` arm survives, message `"invalid <label>: <value>"` |
| `whereClause(filter)` | `WhereClause(filter *string) string` | always parenthesised — `WHERE (<filter>)` |
| `parseCountValue(raw)` | `ParseCountValue(raw any) (int64, error)` | int64 rather than float64: `count(*)` is `int8` and JS's `Number` was the lossy half. Message verbatim |
| `primaryKeyFromIndexes(idx)` | `PrimaryKeyFromIndexes(indexes []model.IndexMeta) []string` | nil when there is none |
| `resolveKeyShape(raw, idx)` | `ResolveKeyShape(raw []model.ColumnMeta, indexes []model.IndexMeta) KeyShape` | `KeyShape{Columns, PrimaryKey, UniqueKeys}`; the all-NOT-NULL unique-index filter ports as written |
| `stripOneTrailingSemicolon(t)` | `StripOneTrailingSemicolon(text string) string` | `regexp.MustCompile(";\\s*$")`, package-level |
| `singleStatusPage(text, dt)` | `SingleStatusPage(text, dataType string) *page.TabularPage` | the `dataType` parameter exists because ClickHouse spells it `String`; keep it |
| `assertKeysetSupported(w, t, e)` | `AssertKeysetSupported(wantsKeyset, isTextSort, eligible bool) error` | message verbatim |
| `computeEffectiveOrder(sort, cols, tb)` | `ComputeEffectiveOrder(sort *model.SortSpec, columns []model.ColumnMeta, tiebreaker []string) (EffectiveOrder, error)` | the five-branch eligibility rule, unchanged: text sort → ineligible; unknown column → `E_NOT_FOUND`; mixed directions → ineligible, terms kept; no tiebreaker → ineligible, direction kept; else append the tiebreaker's not-already-sorted columns in the requested direction |
| `resolveFetchColumns(proj, all, order, resolveHidden?)` | `ResolveFetchColumns(projected, all []model.ColumnMeta, order EffectiveOrder, resolveHidden func(string) (model.ColumnMeta, error)) (FetchColumns, error)` | `resolveHidden` nil → the default by-name lookup with `E_QUERY "keyset tiebreaker column not found: <name>"`. sqlite passes its own in P58b |
| `buildScanOrderBy(sort, order, rev, quote)` | `BuildScanOrderBy(sort *model.SortSpec, order EffectiveOrder, reverseRows bool, quote func(string) string) string` | a text sort is emitted verbatim; `reverseRows` flips every direction |
| `buildKeysetPosition(args)` | `BuildKeysetPosition(args KeysetPositionArgs) (page.PagePosition, error)` | A8's non-generic shape. Four rules survive exactly: `strategy` reports keyset even on an offset-0 page when the sort is eligible; `hasMore` is true for any `before` fetch with rows; `hasForward`/`hasBackward` differ by cursor mode; a NULL in a tiebreaker column is `E_QUERY "keyset tiebreaker column \"<name>\" was NULL"` |

`EffectiveOrder` and `FetchColumns` are plain structs mirroring the TS interfaces:

```go
type OrderTerm struct{ Column, Direction string }

type EffectiveOrder struct {
	Terms           []OrderTerm
	KeysetEligible  bool
	KeysetColumns   []string
	KeysetDirection string
}

type FetchColumns struct {
	Columns          []model.ColumnMeta
	KeysetColumnIdx  map[string]int
}
```

### 4.5 `sqlmutate.go` — `sql-mutate.ts`'s 138 lines

| `sql-mutate.ts` | Go | Notes |
|---|---|---|
| `orderedOps(ops)` | `OrderedOps(ops []model.MutationRowOp) []model.MutationRowOp` | **`sort.SliceStable`** — `Array.prototype.sort` is stable and two ops of the same kind must keep their plan order |
| `assertColumnsKnown(cols, names)` | `AssertColumnsKnown(columns []model.ColumnMeta, names []string) error` | message verbatim |
| `assertAffectedExactlyOne(kind, n)` | `AssertAffectedExactlyOne(kind string, n int64) error` | message verbatim |
| `assertKeyIsPrimaryKey(pk, key, qn)` | `AssertKeyIsPrimaryKey(primaryKey []string, key model.RowValues, qualifiedName string) error` | both messages verbatim; the comparison sorts **copies** of both name lists |
| `literalRenderer(v)` | `LiteralRenderer(value *string) string` | `nil` → `NULL`; `'` doubled |
| `createParamRenderer(ph)` | `NewParamRenderer(placeholder func(int) string) ValueRenderer` | `type ValueRenderer func(value *string, params *[]any) string` |
| `whereFromKey(...)` *(private)* | `whereFromKey(...)` | iterates `RowValues` **in order** (A4); `IS NULL` for a nil value |
| `renderRowOp(rel, op, render, params, quote)` | `RenderRowOp(relationSQL string, op model.MutationRowOp, render ValueRenderer, params *[]any, quote func(string) string) string` | iterates `Changes`/`Values` **in order** (A4) |
| `resolveDatabaseTablePath(path)` | `ResolveDatabaseTablePath(path model.NodePath) (database, table string, err error)` | unused by postgres (it has its own three-segment `resolveTablePath`), but ported in M1 because P58b's three adapters all need it and M1 is the substrate milestone |

`model.RowValues`, the A4 type:

```go
// RowValues is domain/mutations.ts's rowValuesSchema (Record<string, string | null>) with its key
// order preserved. Order is load-bearing: sql-mutate.ts's renderRowOp emits INSERT columns and
// WHERE terms in Object.entries() order, which for a JSON-parsed object is the wire's own order,
// and preview()'s exact text is asserted (tests/db/postgres.spec.ts test 21). A Go map would
// randomise the preview dialog's column order on every open.
type RowValues []RowValue
type RowValue struct {
	Name  string
	Value *string
}
func (v *RowValues) UnmarshalJSON(b []byte) error // json.Decoder token stream
func (v RowValues) MarshalJSON() ([]byte, error)
func (v RowValues) Names() []string
func (v RowValues) Get(name string) (*string, bool)
```

### 4.6 `internal/page` — the codec

`page.ts`'s builder half ports verbatim in behaviour; three things change shape and one gets easier.

**`TextColumnChunk` and its wire form (P58 D5):**

```go
type Chunk struct {
	Data      []byte   `json:"data"`      // packed UTF-8; encoding/json emits base64
	Offsets   Uint32LE `json:"offsets"`   // rowCount+1 entries
	Nulls     []byte   `json:"nulls"`     // ceil(rowCount/8) bytes
	Truncated Uint32LE `json:"truncated"` // sorted row indices
}

// Uint32LE marshals as base64 of its exact little-endian bytes, so all four of a chunk's buffers
// decode through one renderer-side function. encoding/json's default for []uint32 is a JSON number
// array (~7 bytes per 4-byte value); this is the reason D5 gives all four an explicit encoding
// rather than relying on the []byte default alone.
type Uint32LE []uint32
func (v Uint32LE) MarshalJSON() ([]byte, error)
func (v *Uint32LE) UnmarshalJSON(b []byte) error
```

`UnmarshalJSON` exists so the Go test tier can round-trip a page through JSON and compare — it is
never used in production, where Go only ever encodes.

**`ColumnScratch`.** The growable-then-exactly-sized discipline is the whole point and must not be
"simplified": `append` over-allocates, so `finish()` copies into an exactly-sized slice. The struct
mirrors the TS field for field (`buffer`, `used`, `rowStart []int`, `isNullRow []bool`,
`truncatedRows map[int]struct{}`), and `finish(rowCount int, reversed bool) Chunk` keeps the
choose-the-copy-order trick rather than materialising a reversed intermediate.

**Null vs. empty string.** `page.ts`'s own note — *"A NULL row has `offsets[i] === offsets[i+1]`; an
empty string does too, which is why the bitset is the only thing that distinguishes them"* — is a
rendering requirement, and Go makes it easy to lose by typing a cell as `string`. Every value that
reaches `AppendRow` is a `*string`, all the way from the driver's row scan. This is a named
acceptance criterion for M2 and M5, and a unit test.

**`truncateUTF8ToBoundary` gets simpler and must behave identically.** The JS walks back over
continuation bytes because `TextEncoder` gives no boundary information; Go has
`utf8.DecodeLastRune`. Cut at `MaxCellBytes`, back off to a rune boundary, drop the incomplete
rune — same output, fewer lines.

**Constants**, from `page.ts:175-197`: `MaxCellBytes = 64 << 10`, `MaxPageSize = 10_000`,
`DocumentTruncateBytes = MaxCellBytes`, `DocumentTruncateBytesSingle = MaxCellBytes * 64`,
`ObjectBodyPreviewBytes = DocumentTruncateBytesSingle`, `ObjectBodyEditBytes = MaxCellBytes * 16`,
`ObjectUploadMaxBytes = 5 << 30`, `columnEnvelopeBytes = 64`.

**`pageByteSize`** ports its formula exactly, including the `(name.length + dataType.length) * 2`
UTF-16 estimate — the L2 budget is only as honest as this number, and changing it would silently
change eviction behaviour relative to the TypeScript the tests were written against. Note that
`.length` in JS is UTF-16 code units and Go's `len(s)` is bytes: use `utf8.RuneCountInString`-based
counting only if a name is non-ASCII, or accept the byte count and record the difference. **Decision
for the implementer: use `len([]rune(s))`**, which equals JS `.length` for the entire BMP and
differs only for astral-plane identifiers, and note it in a comment.

**The renderer half (A9)** is `src/renderer/bridge/port.ts`'s `toTypedArray` and nothing else:
`isChunkLike`'s four-field recognition and `reviveChunks`'s tree walk over every page kind's
differently-named chunk fields are correct as they stand and must not be touched.

**M2 owes a measurement, not a claim** (P58 §4.2): the same 100 KB chunk encoded both ways — wire
bytes and peak transient heap on each side — recorded in `docs/PERF.md` beside the 11×/48× figures
it replaces. The producer for the base64 side is the Go codec; for the index-keyed side, the
existing Node engine. Both are runnable in P58a because both still exist, which is the one window
in the whole phase where a like-for-like measurement is cheap.

### 4.7 `internal/enginecache`

`cache/index.ts`'s surface, one method for one method: `Configure`, `ReadPage`, `StorePage`,
`Count`, `StoreCount`, `DropTarget`, `InvalidateAfterMutation`, `DropPagesOnly`, `DropConnection`,
`Clear`, `Stats`, `OnStatsChanged`.

Four behaviours port with their reasons attached, because each looks like a bug to a reader who
does not know why:

1. **The half-budget refusal** (`lru.ts:56-63`): an entry larger than half the budget is not stored
   at all, with a warning — *"one 40 MB page must not evict every other page in a 64 MB budget."*
2. **`invalidateAfterMutation`'s asymmetry** (`index.ts:86-90`, P43 F12/D17): drops the target's
   pages, only *marks* its counts stale. The pager keeps the last known total, greyed.
3. **`clearPages` resets hits and misses** (`pages.ts:62-68`): the hit rate is read as "since last
   clear" in two user-facing places.
4. **The 1 Hz throttle plus the `statsChanged` comparison** (`index.ts:30-47`): *"an idle app posts
   nothing"* is a property the status bar depends on. In Go this is a `time.AfterFunc` guarded by a
   mutex, not a ticker — a ticker would fire while idle.

Two Go-specific notes. First, the TypeScript modules are **process-global singletons**
(`pages.ts:35-37`, `counts.ts:27`); the Go port is a `*Cache` value constructed by `main.go` and
held by the router, because a package-level singleton is untestable in a `go test` binary that runs
cases in one process (the existing spec has to call `clearPages()` between cases for exactly this
reason). Second, `ByteLru`'s insertion-order iteration comes free from JS `Map`; Go maps have no
order, so it is a `map[string]*list.Element` plus a `container/list` — the standard shape, and the
one P58 D9 names as an implementation call.

`CacheStats` (`data-ops.ts:194-201`) is six ints: `l2Bytes`, `l2BudgetBytes`, `l2Entries`,
`l2Hits`, `l2Misses`, `l3Entries`. A16 governs how the router merges two of these during
coexistence.

The L2 key derivation (`pages.ts:9-33`) ports exactly, including the normalisation that turns "the
user re-picked the same three columns in a different order" into a hit: sort the projection, trim
the filter to nil when blank, canonicalise the sort, and include the cursor.

### 4.8 `internal/adapterhost` — the scheduler, the dispatcher and the cache-aside

**`RunOp`** is `scheduler/ops.ts:31-87` in Go: accept or mint an op id; **refuse a duplicate**
(`E_QUERY "duplicate operation id: <id>"` — *"a duplicate id would corrupt the op log's primary key
and let the stop button cancel the wrong query"*); derive a cancellable context; emit `op:start`;
run the closure behind a `recover()` (P58 D16); emit `op:end` with `ok`/`error`/`cancelled` decided
by whether the context was cancelled, plus duration, rows, command and error; delete from the
running map in a `defer`.

```go
type Host struct {
	deps    adapters.Deps
	cache   *enginecache.Cache
	live    *adapters.LiveMap
	events  *notify.Emitter[enginehost.Event]   // A14: satisfies oplog.EventSource

	mu      sync.Mutex
	running map[string]runningOp                 // opID -> {cancel context.CancelFunc, connectionID string}
}

func (h *Host) RunOp(ctx context.Context, spec OpSpec, fn func(context.Context, *adapters.OpCtx) (any, error)) (string, any, error)
func (h *Host) CancelOp(ctx context.Context, opID string) (bool, error)
func (h *Host) Subscribe() (<-chan enginehost.Event, func())
```

`CancelOp` stays two-step and in this order (`ops.ts:89-106`): cancel the context, which unblocks
the local wait immediately; then call `adapter.Cancel(ctx, opID)`, which is what actually kills the
server-side work. §5.1's rule is that cancellation is always forwarded, and `query.ts:77-80`'s
comment is emphatic that the local abort alone is not a cancel — *"do not 'fix' it by trying to make
the query itself abort here."*

**`recover()` at the op boundary** (P58 D16): the recovered value is logged with its stack under
`scope=adapter`, and converted to a failed op. See OQ-1 for which code it carries.

**The data dispatcher** (`data.go`) is `rpc.ts` + `data.ts` in Go, one method per `DATA_OP` string,
with `data.ts`'s cache-aside discipline reproduced exactly:

- `data:read` — L2 probe first; a hit is `source: "cache"` and **is not an op** (it must not reach
  the op log: *"a cache hit is not a database operation"*). A miss runs the op, then stores.
- `data:count` — `refresh` bypasses the L3 hit; a hit is `source: "cache"` with its own `stale` flag.
- `data:preview` — never an op, never touches the server.
- `data:mutate` — the op, then `cache.InvalidateAfterMutation` **in a `defer`**, not on success only
  (P43 F12/D17: six adapters mutate without a transaction, so a partially applied plan still changed
  the server).
- `data:execute` — no cache interaction at all, either direction.
- `data:objectDownload` — no cache interaction; op kind `transfer`, not `read`.
- `data:invalidate` — `scope: "pages"` calls `DropPagesOnly` (the post-mutation reload, which must
  leave the stale count intact); anything else calls `DropTarget`.
- `cache:stats` / `cache:clear` — not connection-scoped; A16.
- `ping` — forwarded to the Node child (A17).

Every request struct gets a `Validate() error` (P58 D17), matching `internal/storage/model`'s
hand-written-decoder precedent rather than importing a zod-alike: `pageSize` ∈ {10,100,1000,10000},
`filter` ≤ 4096 chars, `statements` non-empty, `cursor`'s discriminated union, `destPath` absolute.
These are the checks `readRequestWireSchema` and its seven siblings do today, and the reason they
are explicit is P55 §1.6's: a naive `json.Unmarshal` is not a substitute for `safeParse`.

**`E_ENGINE_DOWN` when there is no live adapter** — `data.ts:51`'s comment is load-bearing and its
reasoning survives verbatim: not `E_NOT_FOUND`, because several adapters throw that for an ordinary
query-time condition against a live connection, and `viewOp.ts`'s `DISCONNECTED_CODES` must not gate
a tab behind "Reconnect & load" for an unknown column.

### 4.9 The router and the nine call sites

```go
// adapterhost/router.go
//
// nativeKinds is the single source of truth for which connection kinds are served in-process.
// A kind is added here in the same commit its Go adapter's tests go green, and never earlier (A12).
var nativeKinds = map[string]bool{ /* empty at M4; {"postgres": true} at M5 */ }

type Router struct {
	host  *Host              // in-process
	child *enginehost.Host   // the Node sidecar; nil once P58f lands
	conns KindLookup         // connectionID -> kind
}

type KindLookup interface{ KindOf(connectionID string) (string, bool) }
```

`KindOf` needs no new storage: `internal/connections`' own state map and `ConnectionsRepo.Get` both
carry the kind already (`model.ConnectionSummary.Kind`), so `KindLookup` is satisfied by a
two-line method on `*repos.ConnectionsRepo` (with the connections service's in-memory map as the
fast path).

The nine call sites and what each becomes:

| # | Site | Today | After M4 |
|---|---|---|---|
| 1 | `connections.onPreconnectExit` (`service.go:98`) | `Host.Call(OpDisconnect, …)` | `backend.Disconnect(ctx, id)` |
| 2 | `connections.Remove` (`service.go:296`) | `Host.Call(OpDisconnect, …)` | `backend.Disconnect(ctx, id)` |
| 3 | `connections.Test` (`service.go:346`) | `Host.CallTimeout(OpTest, …, ConnectTimeout)` | `backend.Test(ctx, cfg)` |
| 4 | `connections.attemptConnect` (`service.go:426`) | `Host.CallTimeout(OpConnect, …, ConnectTimeout)` | `backend.Connect(ctx, cfg)` |
| 5 | `connections.Disconnect` (`service.go:468`) | `Host.Call(OpDisconnect, …)` | `backend.Disconnect(ctx, id)` |
| 6 | `tree.Children` (`service.go:103`) | `host.Call(OpChildren, …)` | `backend.Children(ctx, id, path)` |
| 7 | `tree.Describe` (`service.go:142`) | `host.Call(OpDescribe, …)` | `backend.Describe(ctx, id, path, tabID)` |
| 8 | `tree.Definition` (`service.go:178`) | `host.Call(OpDefinition, …)` | `backend.Definition(ctx, id, path, tabID)` |
| 9 | `bridge.OpsService.Cancel` (`ops.go:39`) | `EngineHost.Call(OpCancel, …)` | `canceller.Cancel(ctx, opID)` — **A13** |

Sites 1–5 and 9 route on the connection's kind except 9, which routes on op ownership (A13); 3 and 4
route on `cfg.Kind` directly (there is no connection state yet). Sites 6–8 route on the connection's
kind.

Two shapes are preserved deliberately. **The 20-second connect/test timeout**
(`enginehost.ConnectTimeout`) becomes a `context.WithTimeout` at the same two call sites, and the
30-second default (`enginehost.DefaultTimeout`) applies to the rest — a Go-native adapter has no
transport that could hang forever, but a driver dial certainly can, and dropping the timeout because
"there is no IPC any more" would be a real regression. **The return shapes are unchanged**: the
`Backend` methods return the same structs the two services already `json.Unmarshal` into, so
`ChildrenResult`, `DescribeResult`, `DefinitionResult` and the `attemptConnect` result decoding are
untouched. For the Node-backed implementation that means one marshal/unmarshal that used to be
implicit; for the Go one it means none at all.

The two remaining `enginehost` consumers, `PushCacheConfig` (`main.go:117`, `bridge/settings.go:37`)
and `Alive`/`PID` (`bridge/engine.go`), also route through the router: `Configure` pushes the budget
to **both** caches, and `Status()` keeps reporting the child (A17's reasoning — the pill's subject
does not change until the child is gone).

### 4.10 `bridge/stream.go` as the data-plane server

```go
// StreamSession is unchanged (Send + Receive); *application.StreamConn still satisfies it
// structurally, so this package still imports no Wails.

func ServeEngineStream(router *adapterhost.Router, conn StreamSession) {
	session := router.AttachStream(conn) // starts the single writer goroutine (A18)
	defer session.Close()
	for {
		frame, err := conn.Receive()
		if err != nil {
			return
		}
		go router.HandleDataFrame(session, frame)
	}
}
```

Four properties of today's loop that must not be lost, and how each survives:

- **Concurrency.** Today the Node event loop interleaves concurrent data ops and the Go reader
  goroutine never blocks. A handler run inline would serialise every read behind the slowest one, so
  each frame is handled on its own goroutine. Responses are correlated by `id`, so out-of-order
  completion is already the contract.
- **One writer.** A18. `session` owns a bounded channel and one goroutine draining it into
  `conn.Send`. Both producers — `HandleDataFrame`'s responses and the Node child's frames — enqueue.
- **Backpressure onto the child.** The `enginehost.Sink` the router installs returns
  `enginehost.ErrStreamFull` when the queue is full, which `enginehost/stream.go:105-140`'s existing
  backoff already handles by retrying and, transitively, by stopping its read loop — so the OS pipe
  still pushes back on the Node child exactly as it does today. Deleting this would replace a bounded
  queue with an unbounded Go heap, and unlike today there is no pipe left to push back through.
- **The 64 MiB frame ceiling.** `maxDataFrameBytes` mirrors Wails' own `streamMaxFrameBytes` and is
  a property of the stream, not of the sidecar, so it moves to the session with its
  drop-with-a-named-log-line behaviour. `MaxPageSize` is 10 000 rows and `MaxCellBytes` is 64 KiB, so
  a pathological page can still approach it, and base64 inflates by 1.33× — M2 re-tests the ceiling
  against a base64-encoded page rather than assuming it got safer.

`internal/shell/app.go`'s `RegisterEngineStream(app, host)` takes the router instead (§1.1).

### 4.11 The `postgres` package, file by file

`pgx/v5`'s native interface (`*pgx.Conn`, not `database/sql`), one `*pgx.Conn` per (connection,
database) in an 8-entry LRU — `ClientSet` ported as written, and explicitly **not** `pgxpool`
(§1.6, P58 D20).

| Go file | Ports | Key points |
|---|---|---|
| `client.go` | `client.ts` | `buildConfig` → `pgx.ParseConfig` from the URI or from host/port/user/password; `RuntimeParams["application_name"] = "kira-studio"`; `statement_timeout=0` (the app cancels explicitly — a silent server-side timeout would make the stop button's contract a lie); the sslmode mapping (`require`/`prefer` → `TLSConfig{InsecureSkipVerify: true}`, `verify-full` → a verifying config, `disable` → nil, anything else → a warning and ignore); `ConnSet` with `Get(ctx, database)`, `Primary(ctx)`, `CloseAll(ctx)` and the LRU eviction that never evicts the primary |
| `query.go` | `query.ts` | `runQuery`/`runCommand`: `op.SetCommand` **before** the statement (rule 3), `CheckNotStarted`, `track(RunningQuery{BackendPID: conn.PgConn().PID()})` with the identity-checked release, the text-mode/identity-parser path (probe PG-2's answer decides whether this is `QueryExecModeSimpleProtocol` + `RawValues`, or a per-query result-format override), and `mapError` on every exit. `withAbortRace` becomes a `select` on `ctx.Done()` versus a result channel — P58 §1.9 leaves "whether it stays a shared helper" to P58a: **it does not.** pgx honours `ctx` natively for the wait; the helper existed only because `pg` and `mariadb` are callback-shaped. The *release* still runs on every exit, via `defer` |
| `read.go` | `read.ts` | `QuoteIdent` (NUL check, `"` doubling), `TypeClassFor` (array check first, then the five regex families), `NormalizeCellText` (`\x` → `0x` for `binary`), `ReadPage`, `CountRows`. `ReadPage` is the densest function in the package: projection → effective order → keyset support assertion → fetch columns → column descriptors → `pageSize+1` probe → keyset predicate or `OFFSET` → the five-line SQL assembly → text rows → builder → `reverse()` when the cursor was `before` → `BuildKeysetPosition` |
| `catalog.go` | `catalog.ts` | the eleven queries, SQL text unchanged. Row scanning changes: `ARRAY(...)`/`array_agg` columns come back as Postgres arrays — pgx scans them into `[]string` directly, where node-postgres did the same; `oid::text` stays text; `reltuples::bigint` stays a nullable int with the **−1 means never analysed** rule preserved in both places it appears (`listRelationsAndFunctions`'s `detail` and `getRelationInfo`'s `rowEstimate`) |
| `definition.go` | `definition.ts` | `buildDefinition`'s seven queries and the composition. `columnLine`'s precedence (generated STORED > identity > default, then NOT NULL) and the statement ordering (`CREATE SEQUENCE` ×n, `CREATE TABLE`, `ALTER SEQUENCE … OWNED BY` ×n, constraints, indexes, comments) are asserted by spec test 20 and port literally. `generatedAt` is `time.Now().UTC().Format(time.RFC3339Nano)` — matching `model.NowISO`'s existing shape |
| `mutate.go` | `mutate.ts` | `resolveTablePath` (postgres's own three-segment form, with its own message), `Preview` (synchronous, no catalog, no network), `Mutate`'s fresh `getReadTarget` in the same op, the per-op guards, the one `SetCommand` for the whole batch, and `BEGIN`/…/`COMMIT` with `ROLLBACK` on any failure |
| `console.go` | `console.ts` | `runRaw` (field metadata: name + type OID, identity-parsed), `buildPage` (a zero-field result becomes `SingleStatusPage("<command> <rowCount>", "text")` — documented as an approximation of the server's command tag, not the literal string), `lookupTypeNames` (one `pg_type` query for every OID in the batch), and `Execute`'s one-`SetCommand`-per-batch rule |
| `errors.go` | `errors.ts` | §4.3's `mapError` |
| `caps.go` | `caps.ts` | §4.2's literal |
| `adapter.go` | `index.ts` | the `Adapter` implementation, `runningByOp`, `trackerFor`'s identity-checked release, `connect`'s assign-the-handle-before-opening-anything rule (P13 D1 — *"a probe failure … leaks it"*), `disconnect`'s idempotence, and `Cancel`'s side connection |

`Cancel`, written out, because it is the method C1 turns on:

```go
// Cancel opens a connection of its own — not the ConnSet's, and never pooled — runs
// pg_cancel_backend against the tracked backend pid, and closes it. index.ts:344-366's shape.
func (a *Adapter) Cancel(ctx context.Context, opID string) (bool, error) {
	a.mu.Lock()
	running, ok := a.runningByOp[opID]
	delete(a.runningByOp, opID)
	cfg := a.cfg
	a.mu.Unlock()
	if !ok || cfg == nil {
		return false, nil
	}

	side, err := pgx.ConnectConfig(ctx, buildConfig(*cfg, "", a.deps.Log))
	if err != nil {
		a.deps.Log("warn", fmt.Sprintf("postgres cancel(%s) failed: %v", opID, err))
		return false, nil
	}
	defer side.Close(context.Background())

	var cancelled bool
	if err := side.QueryRow(ctx, "SELECT pg_cancel_backend($1)", running.BackendPID).
		Scan(&cancelled); err != nil {
		a.deps.Log("warn", fmt.Sprintf("postgres cancel(%s) failed: %v", opID, err))
		return false, nil
	}
	return cancelled, nil
}
```

Three details that are easy to lose: the op is removed from `runningByOp` **before** the side
connection is opened (so a second cancel is a no-op, which spec test 33 asserts); every failure is
logged and reported as `false` rather than returned as an error (`cancel()` *"never throws for
'already finished'"*); and `defer side.Close(context.Background())` uses a fresh context, because
the op's own context is very likely already cancelled by the time this runs.

## 5. Testing plan

### 5.1 What survives untouched

- **`tests/ui/`** entirely — 36 tests, 18 spec files, both wire planes mocked. A10 keeps the
  fixtures as they are.
- **`tests/ipc/`** entirely — no fixture, no frontend spec and no backend spec changes in P58a. The
  backend tier still imports `src/engine/control.ts`, which still exists and still works.
- **`tests/e2e-real/`** — both specs. `sqlite-real.spec.ts` still drives the Node engine (SQLite is
  P58b's), and the Wails `-tags server` harness is unaffected.
- **`tests/unit/`**'s renderer specs, except the two whose subject moves (A21) and one addition:
  `port.ts`'s dual decoder gets a small case in the existing `tests/unit/bridge-port.spec.ts`
  asserting both encodings revive to real typed arrays. That is the only new TypeScript test in
  P58a, and it exists because A9's second branch is exactly the kind of compatibility shim that gets
  deleted by someone who does not know why it is there.

### 5.2 The `src/` non-change, asserted

Every milestone from M1 onward ends with:

```
git diff --stat src/ -- ':!src/renderer/bridge/port.ts'
```

returning empty. (P58 §5.2's form additionally excludes `src/engine`; P58a does not need that
exclusion because it touches nothing there, and the narrower assertion is the stronger one. If it is
ever non-empty, either P58 D1 was broken or the substrate has a coupling this plan did not find —
stop and say so rather than absorb it.)

### 5.3 The Go unit oracles, ported case by case

**`sqltext_test.go` ← `tests/unit/sql-text.spec.ts`.** All 17 cases, in order, with the spec's own
numbering carried into the Go test names so the two can be diffed:

| # | Case | Go test |
|---|---|---|
| 1 | a text sort is never keyset-eligible | `TestComputeEffectiveOrder_TextSortIneligible` |
| 2 | mixed directions disqualify keyset, terms kept | `..._MixedDirections` |
| 3 | absent tiebreaker disqualifies, direction kept | `..._NoTiebreaker` |
| 4 | tiebreaker appended, deduping an already-sorted column | `..._TiebreakerDedupe` |
| 5 | no sort at all is asc and eligible on the tiebreaker | `..._NoSort` |
| 6 | unknown sort column is `E_NOT_FOUND` | `..._UnknownColumn` |
| 7 | token round-trips under a matching fingerprint | `TestPageToken_RoundTrip` |
| 8 | mismatched fingerprint refused, naming why | `TestPageToken_FingerprintMismatch` |
| 9 | malformed token and wrong-shape payload both refused | `TestPageToken_Malformed` |
| 10 | the operator flips with both direction and mode (4 assertions) | `TestBuildKeysetPredicate` |
| 11a–d | projection: ordinal order, dedupe, nil identity, unknown column | `TestResolveProjection_*` |
| 12 | `safeInt` refuses negatives | `TestSafeInt` |
| 13 | strips exactly one trailing semicolon, with whitespace (4 assertions) | `TestStripOneTrailingSemicolon` |
| 14 | an `after` page with a next page: strategy, both tokens | `TestBuildKeysetPosition_After` |
| 15 | a `before` page always reports `hasMore` | `..._Before` |
| 16 | an offset page at 0 never has a `prevToken` | `..._OffsetZero` |
| 17 | an offset page at >0 gets a `prevToken` when eligible | `..._OffsetNonZero` |

Two Go-only additions, both because the port creates the risk: `EncodePageToken` produces
**unpadded** base64url (a padded token would be a silently different string), and
`RequestFingerprint` is stable across repeated calls with the same input.

**`sqlmutate_test.go`** — no TypeScript oracle exists, and three cases clear `AGENTS.md`'s bar
because A4 says they will otherwise be wrong invisibly: `RenderRowOp` emits INSERT columns in wire
order; `whereFromKey` emits WHERE terms in wire order with `IS NULL` for nils; `OrderedOps` is
stable within a kind. The fixture is spec test 21's exact three-op plan and its three exact expected
strings.

**`page_test.go`** — four subjects (P58 §5.4): null vs. empty string survive a round trip through
the chunk; `truncateUTF8ToBoundary` cuts on a rune boundary and drops the incomplete rune;
`finish(rowCount, reversed=true)` produces the same chunk as building the rows in reverse; and a
`Chunk` marshals to four base64 strings and unmarshals back byte-identically.

**`cache_test.go` ← `tests/unit/engine-cache.spec.ts`.** All eight cases: LRU eviction by budget;
`Get` touches; the half-budget refusal; `deleteWhere` updates bytes and size; `setBudget` shrinks
immediately; L2 never exceeds its budget after twenty stores; `Clear` resets hits and misses; L3 is
bounded at exactly 2 048 entries (256 KiB / 128 B). The last one is the case whose exactness the
spec's own comment argues for, and it must stay exact rather than becoming a range.

### 5.4 The Go Postgres tier

`shell/internal/adapters/postgres/postgres_test.go`, driven by `testcontainers-go` against
`postgres:17-alpine` seeded from `tests/db/fixtures/0001_seed.sql` (unchanged) plus the 1 M-row
`big_rows` insert, gated by A19's Docker skip. §1.7's mapping is the scope: 28 scenarios ported
as-is, 3 re-baselined against pgx's wording, 2 moved to `adapterhost`, 1 collapsed to a caps
assertion.

Per **P58 D12**, this file lands **and fails** before `postgres/*.go` exists — R3 is a rule about
commits, not milestones, and §9's M5 commit list encodes it.

The one scenario that no other tier can check, and therefore the one that must not be softened:
**cancel, asserted server-side.** A `SELECT pg_sleep(30)` is started through `RunOp`; the test polls
`pg_stat_activity` until it is `active`; `CancelOp` is called; the op rejects with `E_CANCELLED`;
and the test polls `pg_stat_activity` again until the query is **gone**, with a 2-second deadline.
The second poll is the assertion — the first only proves the query started.

### 5.5 What P58a deliberately does not test

- **The coexistence router's ten Node-served kinds**, beyond C1's manual MariaDB step. An automated
  two-backend test would need eleven containers and would be testing `enginehost`, which has its own
  passing tests.
- **Packaging.** No bundle changes in P58a; `verify-packaging.sh` is untouched and still correct.
- **The base64 wire encoding end to end through `tests/ui/`.** A10 — the mocked tier still speaks the
  index-keyed form, deliberately, and C1 is where the base64 path is exercised against a real page.

## 6. M0 — the probes, concretely

Four throwaway programs under `/tmp` (never committed; **no product code lands in M0**), each
answering one question with a printed PASS/FAIL. The deliverable is a findings section appended to
this document and, for anything surprising, an `AGENTS.md` entry.

| Probe | What it runs | Asserts | If it fails |
|---|---|---|---|
| **TC-1** | `testcontainers-go` + `modules/postgres` starting `postgres:17-alpine` (mirror-retagged), running `SELECT 1`, terminating | The container starts and the wait strategy resolves in this sandbox — i.e. `AGENTS.md`'s Bun/testcontainers hang genuinely has no Go analogue (P58 §4.10 says "confirm, do not assume") | The Go test tier needs a hand-rolled `docker run` harness instead of `testcontainers-go`, which changes A19 and P58 D12's mechanism for all six sub-phases → stop and raise it |
| **PG-1** | `pgx.Connect`; read `conn.PgConn().PID()`; start `SELECT pg_sleep(30)` on it in a goroutine; open a **second** `pgx.Conn` and run `SELECT pg_cancel_backend($1)` with that pid; assert the first query returns SQLSTATE `57014` and that `pg_stat_activity` shows no `pg_sleep` afterwards | The whole cancellation design: the pid is reachable, the side connection works, and the cancelled query's error carries `57014` so `mapError` produces `E_CANCELLED` | P58 §1.8's own named alternative, `pgconn.CancelRequest`, with its unencrypted-socket caveat recorded — and `postgres/caps.go`'s `Cancel` re-examined |
| **PG-2** | On one `pgx.Conn`: a typed catalog-style query (`SELECT oid::text, relname FROM pg_class LIMIT 1`) **and** a text-mode data query over a table with `bytea`, `numeric`, `timestamptz`, `json` and NULL columns, scanning every column as `*string`; print the exact text of each | Identity/text-mode scanning is available per query on the same connection, and the server's own text form arrives unconverted — including `bytea` as `\x…`, which `NormalizeCellText` rewrites to `0x…` | `ConnSet` needs a second, text-mode connection per database, which changes `client.go`'s shape and doubles the backend count — a real design change, recorded before M5 starts |
| **JS-1** | Marshal a struct with a `[]byte`, a `[]uint32` and a `Uint32LE` | `[]byte` → base64 string; `[]uint32` → a JSON number array; `Uint32LE` → base64 of LE bytes. Pure Go, no container, two minutes | P58 D5's encoding needs rethinking before M2 — but this is a confirmation, not a discovery: it is stated in P58 §8's criterion-11 list and this makes it a checked fact |

Ordering: JS-1 and TC-1 first (they need nothing and everything else needs Docker), then PG-1 and
PG-2 against the container TC-1 proves.

**OQ-5, resolved: run the Kafka probe here too**, alongside the four above, as a fifth M0 probe
(**KF-1**) — franz-go's `kgo.ConsumePartitions` at explicit offsets against a real `confluentinc/
cp-kafka` container, asserting no `JoinGroup`/`SyncGroup` traffic (`kadm.DescribeGroups` sees no
group named `kira-studio-browse` afterward) and `FetchPartition.HighWatermark` matching the topic's
actual high-water mark. It is the one M0 probe with a `go.mod`/packaging decision attached (P58 D7's
own fallback, `confluent-kafka-go`, is cgo) — discovering that in P58e rather than now would mean
the "no native modules" claim moves late, exactly the failure mode P58 §9's R4 exists to prevent.
The other seven probes (`mattn/go-sqlite3`, `clickhouse-go`, `go-redis`, `mongo-driver`,
`aws-sdk-go-v2`, RabbitMQ) stay out of P58a's scope — none of them carries a decision that would
change if deferred to its own sub-phase, unlike Kafka's.

## 7. C1 — the checklist

The parent's §0.3 states C1 in a paragraph and its §9 M5 in a sentence. This is the step-by-step
version. **All of it runs in one Bash invocation** (`AGENTS.md`, P51: a background process started in
one invocation cannot be signalled from a later one), with a 150-second tool timeout.

**Preparation**

1. `nohup dockerd > /tmp/dockerd.log 2>&1 & disown`; wait for `API listen on /var/run/docker.sock`.
2. Pull and retag both images: `postgres:17-alpine` and `mariadb:11.4`, each via
   `mirror.gcr.io/library/…` (`AGENTS.md`'s Docker section).
3. Start both containers with the `tests/db/` seed fixtures (`0001_seed.sql`, `0002_mariadb_seed.sql`).
4. `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config xdotool imagemagick`;
   `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.15` (**pinned**, P55's finding);
   `scripts/vendor-node.sh` and `bun run build:engine` (the child is still required in P58a);
   `wails3 generate bindings -b -i -ts -names`; `bun run build`.
5. Start the app under `xvfb-run`, backgrounded, in this same invocation. Poll a log file for
   readiness rather than sleeping a fixed interval; the first build takes ~60 s.

**The proof — Postgres, in Go**

6. Screenshot the window (`xdotool search --name`, `import -window <id>`) and confirm the app
   rendered rather than showing a blank page. This is the only way to tell the two apart here.
7. Create a Postgres connection pointing at the container; **Test** it (site 3) and connect it
   (site 4). The status pill shows connected and a `PostgreSQL 17…` server version.
8. Expand the tree: connection → `kira_test` → `app` → the relations (sites 6). Confirm tables,
   views, matviews, functions and sequences all appear, with `~N rows` details on tables.
9. Open a table's **definition** view (site 8) and its metadata (site 7). Confirm the composed
   `CREATE TABLE` renders with constraints and indexes.
10. Open `app.big_rows` as a data tab. Confirm the first page renders **with real cell text** — this
    is the base64 chunk path's end-to-end proof (A9's first branch).
11. Page **forward** and then **back** with the pager. Confirm the rows differ, that the back page
    matches the first, and that the tab shows keyset paging (a `nextToken`/`prevToken` pair rather
    than an offset), which is `BuildKeysetPosition` working against a real 1 M-row table.
12. Trigger the **count**. Confirm an exact number; trigger it again and confirm it comes back
    instantly from L3 (`source: "cache"`).
13. Open the **query console** on the connection and run a two-statement batch, one returning rows
    and one not. Confirm two result pages and **one** op-log row.
14. Stage a cell edit and commit it. Confirm the preview dialog shows the exact `UPDATE …` text with
    the columns in the order they were staged (A4), that the mutation applies, and that the tab's
    page reloads while the count shows as stale-but-present rather than blank.
15. Run `SELECT pg_sleep(30)` in the console and press **stop** (site 9, A13). Confirm the op ends as
    `cancelled`, and — from a `psql`/side connection in the same shell invocation — that
    `pg_stat_activity` has no `pg_sleep` row afterwards. **This is the step that would silently pass
    with a broken cancel path, so the server-side check is not optional.**
16. `ps --forest` / the log: confirm the Node child process is **still running** throughout.

**The coexistence proof — MariaDB, still on Node**

17. In the **same session**, create and connect a MariaDB connection to the second container.
18. Expand its tree, open a table, page it once, and run a count. All of this is served by the Node
    child.
19. Confirm the op log shows both connections' operations interleaved, with correct kinds and
    durations — i.e. A14's merged event source is delivering both hosts' `op:start`/`op:end`.
20. Confirm the status bar's cache figures are plausible: L2 bytes greater than either side alone
    (A16's summed counters) and the budget equal to the configured 64 MB, **not** 128 MB.

**The optional extra, worth doing once**

21. Kill the Node child (`kill <pid>`). Confirm the **MariaDB** connection flips to error and the
    **Postgres** connection stays connected and still serves a read (A15). If Postgres also flips,
    `MarkAllErrored` was not narrowed.

**Recording.** C1 is recorded in the M5 commit message and in `AGENTS.md`'s P58a findings entry,
naming which of steps 6–21 passed and which could not be run, per P55 §10 / P56 §6 / P57 §6's
standard of recording "not available in this session" rather than leaving it implied.

## 8. Acceptance criteria

**Per milestone**

- **M0** — all four probes have a recorded PASS or a recorded FAIL with its consequence taken
  explicitly (§6). No product code committed.
- **M1** — `go build ./internal/adapters/...` and `go vet` pass; `go test ./internal/adapters/`
  green, covering §5.3's 17 + 3 cases; `tests/unit/sql-text.spec.ts` deleted in the last commit of
  the milestone, not before; `git diff --stat src/` empty.
- **M2** — `go test ./internal/page/` green; `bun run test:unit` green including the new dual-decoder
  case; `docs/PERF.md` carries the re-taken measurement; `git diff --stat src/ -- ':!src/renderer/bridge/port.ts'`
  empty; `tests/ui/` unchanged (A10).
- **M3** — `go test ./internal/enginecache/` green over §5.3's eight cases;
  `tests/unit/engine-cache.spec.ts` deleted in the milestone's last commit.
- **M4** — `nativeKinds` is **empty**, and the whole existing suite (`bun run lint`,
  `bun run typecheck`, `bun run test:unit`, `bun run test:go`, `bun run test:ui`,
  `bun run test:ipc:fe`) is green with behaviour unchanged; the app boots and a MariaDB connection
  still works end to end; `internal/oplog` has a zero diff (A14); `MarkAllErrored` is narrowed and
  has a Go test proving a native-kind connection is not marked (A15); the cache-stats merge reports
  the configured budget once and has a test (A16); `docs/ARCHITECTURE.md`'s bulk-data invariant is
  rewritten in the same commit as the code (P58 D3).
- **M5** — `go test ./internal/adapters/postgres/` green against a real container, or explicitly
  recorded as Docker-unavailable; `nativeKinds` is `{"postgres": true}`; **C1 recorded** (§7);
  `tests/db/postgres.spec.ts` and `tests/db/support/postgres.ts` deleted in the last commit.

**Phase-level**

1. C1's checklist is recorded with a per-step result.
2. `bun run lint`, `bun run typecheck` (all four projects), `bun run test:unit`, `bun run test:go`,
   `bun run test:ui`, `bun run test:ipc:fe` are green.
3. `go test ./internal/adapters/... ./internal/page/... ./internal/enginecache/... ./internal/adapterhost/...`
   is green.
4. `git diff --stat src/ -- ':!src/renderer/bridge/port.ts'` is empty.
5. `git diff --stat tests/ui tests/ipc` is empty.
6. `git diff --stat shell/internal/oplog shell/internal/enginehost` shows only the new
   `enginehost` sink adapter, if one was needed there rather than in `adapterhost`.
7. `AGENTS.md` gains a **"P58a implementation findings"** entry on the P52–P57 pattern, carrying at
   minimum: M0's four results; whether `testcontainers-go` behaves in this sandbox (and therefore
   how much of the Docker section's Bun-specific prose becomes historical); pgx's text-mode answer;
   and anything the router turned up about the seam.
8. `docs/ARCHITECTURE.md`'s bulk-data invariant is the rewritten one (P58 D3), and its Adapter
   contract section names `shell/internal/adapters/` alongside `src/engine/adapters/` for the
   duration of coexistence rather than pretending one of them does not exist.
9. `docs/PERF.md` carries M2's measurement.

## 9. Sequencing

Six milestones, in order, with the commits inside each. The parent's hard rules apply unchanged: its
**R2** (the substrate lands before any adapter) is the shape of M1→M4; its **R3** (an adapter's Go
tests land and fail before its implementation) is encoded in M5's commit list; its **R4** (M0 before
M5) is why M0 is first.

**M0 — probes** *(no commits to `shell/`)*
1. `docs: record P58a M0 probe results` — this document gains a findings subsection.

**M1 — `internal/adapters`**
2. `feat(model): add the data-plane model types the adapter contract needs` — `ResolvedConnectionConfig`'s
   move (A3), `MutationRowOp`/`MutationPlan`/`MutationResult`/`RowValues` (A4), `ConsoleRequest`,
   `ObjectDownloadRequest`/`ObjectTransferResult`, `PageCursor`.
3. `feat(adapters): the Adapter contract, Caps and the closed error set` — `adapter.go`, `caps.go`,
   `errors.go`, `live.go`, `registry.go` (with an empty loader table).
4. `test(adapters): port sql-text.spec.ts's cases as the Go keyset planner's oracle` — the test
   file, failing.
5. `feat(adapters): sqltext.go — the keyset planner and cursor arithmetic` — green.
6. `feat(adapters): sqlmutate.go — op ordering, guards and the dialect renderer` + its three
   order-sensitive tests.
7. `test: delete tests/unit/sql-text.spec.ts, its subject now in Go` (A21).

**M2 — `internal/page`**
8. `feat(page): the columnar chunk codec and its base64 wire encoding` — `chunk.go`, `scratch.go`,
   `page_test.go`.
9. `feat(page): the four page builders` — `builder.go`.
10. `fix(renderer): decode chunk buffers from base64 as well as index-keyed objects` — A9, plus the
    `tests/unit` case. **The only `src/` commit in P58a.**
11. `docs(perf): re-take the chunk-encoding measurement against both encodings`.

**M3 — `internal/enginecache`**
12. `test(enginecache): port engine-cache.spec.ts's cases` — failing.
13. `feat(enginecache): L2 pages, L3 counts and the byte-budgeted LRU` — green.
14. `feat(enginecache): the throttled cache-stats emitter and Configure`.
15. `test: delete tests/unit/engine-cache.spec.ts, its subject now in Go` (A21).

**M4 — `internal/adapterhost` and the router**
16. `feat(adapterhost): the op scheduler, its cancel registry and the panic boundary` — `host.go`,
    with the duplicate-op-id and two-step-cancel tests (spec tests 7 and 30's Go homes).
17. `feat(adapterhost): the data-op dispatcher and data.ts's cache-aside discipline` — `data.go`,
    `wire.go`.
18. `refactor(connections,tree,bridge): call an engine Backend, not enginehost directly` — A11's
    three consumer-declared interfaces and the nine call sites, with `enginehost.Host` adapted to
    them. **No routing yet**; every call still reaches the child. Existing tests unchanged and green.
19. `feat(adapterhost): the per-kind router, with nativeKinds empty` — `router.go`, A13's cancel
    ownership, A16's cache merge.
20. `feat(bridge): serve the data plane from Go, with one writer and both producers` — `stream.go`'s
    rewrite (A18), `app.go`'s signature, `docs/ARCHITECTURE.md`'s rewritten invariant.
21. `feat(oplog): merge the two engine event sources` — `enginebackend/merge.go`, `main.go`'s wiring;
    `internal/oplog` unchanged (A14).
22. `fix(connections): a native-kind connection is not errored by the Node child exiting` — A15.

**M5 — Postgres, and C1**
23. `test(postgres): the Go acceptance spec, against a real container` — `testsupport/` (A19) and
    `postgres_test.go`, **failing** (P58 D12 / R3).
24. `feat(postgres): client, query and error mapping` — `client.go`, `query.go`, `errors.go`,
    `caps.go`.
25. `feat(postgres): the catalog and the tree` — `catalog.go`, and `adapter.go`'s
    connect/disconnect/children/describe.
26. `feat(postgres): read, count and the definition view` — `read.go`, `definition.go`.
27. `feat(postgres): mutations and the query console` — `mutate.go`, `console.go`.
28. `feat(adapterhost): serve postgres in-process` — `nativeKinds["postgres"] = true`. **C1 runs
    here**; the commit message records its result.
29. `test: delete tests/db/postgres.spec.ts, its subject now in Go` (A21), plus `package.json`'s
    `test:db` postgres arm.
30. `docs: P58a findings — the substrate, the router and the Postgres pathfinder` — `AGENTS.md`.

**Why M2 before M3 and M4.** M2 is the only milestone that touches `src/`, and isolating it makes
§5.2's assertion meaningful for every milestone after it (P58 §9's own reasoning). It also has to
precede M4, because the dispatcher's read path returns a `page.Page` and there is nothing to return
until the codec exists.

**Why the router lands empty (commit 19) before any adapter.** A seam with no traffic through it is
a seam whose bugs are all visible as "nothing changed" failures in an existing green suite. A seam
introduced together with its first user makes every failure ambiguous between the two.

## 10. Open questions for the parent plan's author

Each of these affects P58b–P58f as much as P58a, or contradicts something the parent settled. None
is silently resolved here; where P58a needs a working assumption to proceed, it is stated as
*interim* and marked reversible.

**OQ-1 — `E_INTERNAL` is not in the closed `AdapterErrorCode` set, but P58 D16 requires it.**
D16 says a recovered adapter panic is *"converted to an `E_INTERNAL` `AdapterError` for that one
op."* `src/engine/adapters/errors.ts:4-12` declares eight codes and `E_INTERNAL` is not among them;
it exists only in `internal/bridge/ipcerr` as a Go-side bridge code. Three options, and the choice
is the parent's because it changes the closed set for all eleven adapters:
(a) widen `AdapterErrorCode` to nine and add the code to `errors.ts` (a `src/shared` change that
P58 D1 forbids — though `errors.ts` is under `src/engine`, not `src/shared`, so it may be allowed);
(b) map a recovered panic to `E_QUERY`, keeping the set closed at eight but reporting an internal
fault as a query fault; (c) emit the string `E_INTERNAL` over the wire without adding it to the
TypeScript type, relying on the renderer's fall-through (`viewOp.ts`'s `classify` returns
`kind: 'error'` for any unrecognised code, which is the desired behaviour).
**P58a interim: (c)**, because it is behaviourally correct today and reversible in one constant.
Recorded in `errors.go`'s comment as pending this answer.

**OQ-2 — P58 §1.5's call-site enumeration is one short, and the missing one is the stop button.**
§1.1 above. `internal/bridge/ops.go:39` is a `Host.Call` site the parent's "eight call sites plus one
interface" does not cover, and it cannot route on `ConnectionKind`. P58a resolves it (A13) because
M4 owns the router — but the parent's §1.5 and §4.6 should be amended so P58b–P58e's plans do not
inherit the wrong count, and so nobody later "simplifies" A13's op-ownership discriminator into a
kind lookup.

**OQ-3 — P58 D5's decoder swap breaks the ten Node-served kinds for five sub-phases if taken
literally.** §1.2 and A9. P58a implements the dual decoder and P58f deletes the compatibility
branch. This is a narrowing rather than a contradiction, but D5's text and the parent's §3
target-tree row for `port.ts` (`reviveChunks decodes base64`) should say "decodes base64 **and**, until
P58f, the Node engine's index-keyed form", or the branch reads as an unexplained leftover to
whoever writes P58f.

**OQ-4 — the parent's §3 marks `internal/oplog/wire.go` as EDITED; A14 argues it should not be, and
D10's "which signal replaces `EventEngineDown`" is only half answerable in P58a.** A14 keeps oplog
byte-unchanged by fanning the two event sources in. The half that stays open is the *post-P58f*
question: with no child process at all, what fires the "mark every in-flight op as failed" path?
P58a's answer for its own scope is "adapter-level connection loss and a shutdown sweep, both emitted
by `adapterhost` as ordinary `op:end` events", which is complete for the coexistence window. Whether
P58f keeps the event shape or converts oplog to typed direct calls is a P58f design decision that
should be recorded as such rather than assumed either way.

**OQ-5 — resolved.** Accepted as recommended: the Kafka probe (KF-1) runs inside P58a's own M0,
alongside the four Postgres/container probes — see §6. The other seven engines' probes stay deferred
to their own sub-phases, none of them carrying a decision that would change if deferred.

**OQ-6 — `docs/ARCHITECTURE.md`'s Adapter contract section describes one adapter layer; there will
be two for five sub-phases.** The parent's §3 lists `docs/ARCHITECTURE.md` as edited in M11, at the
very end. That leaves the Adapter contract section describing only `src/engine/adapters/` while
`shell/internal/adapters/` also exists and serves real connections — for the whole of P58a–P58e.
P58a's §8 criterion 8 takes the minimal position (name both, for the duration), but whether the
per-engine facts table gains a "served by" column during coexistence is a documentation-policy call
that spans all six sub-phases.

## 11. Environment notes for the implementing session

- **A fresh container has none of the toolchain.** Go; `apt-get install -y libgtk-4-dev
  libwebkitgtk-6.0-dev pkg-config` for anything that builds `internal/shell` or the root `main`
  package. **`./internal/adapters/...`, `./internal/page/...` and `./internal/enginecache/...` need
  none of it** — so the fast loop through M1–M3 is `go test ./internal/adapters/...` and never
  `./...`. M4 and C1 do need the headers.
- **Install `wails3` pinned** to `shell/go.mod`'s exact version (`v3.0.0-beta.15`), never `@latest`
  — P55's finding: `@latest` resolved to beta.16 against a beta.15 runtime.
- **`shell/frontend/bindings` is git-ignored** and must be regenerated
  (`wails3 generate bindings -b -i -ts -names`) before `bun run build` resolves its imports.
- **`shell/runtime/` is git-ignored too**, and P58a still needs both halves of it: `scripts/vendor-node.sh`
  for `runtime/node/bin/node` and `bun run build:engine` for `runtime/engine/engine.cjs`. The app
  refuses to start without the engine bundle (P56 D12), and P58a does not change that — the child is
  still serving ten kinds.
- **Docker**: `nohup dockerd > /tmp/dockerd.log 2>&1 & disown` here; `colima start` on macOS. Pull
  every image through `mirror.gcr.io` and retag to the plain name (`library/` for unnamespaced
  official images). The retag lives in the daemon, so `testcontainers-go` finds the plain name with
  no code change.
- **A background process started in one shell invocation cannot be signalled from a later one**
  (P51's finding, still true). Start, poll, test and tear down inside one Bash invocation, with a
  120–150 s timeout for anything that builds the Wails app.
- **Screenshotting the headless WebKitGTK window** (`xdotool search --name`, `import -window <id>`)
  is the only way here to tell a rendered app from a blank page, and C1 step 6 needs it.
- **`bunx playwright install webkit`** plus the system libs its post-install warning names is worth
  retrying each session — P57's finding is that an earlier session's "cannot reach the download
  host" verdict did not hold in a later one.
- **Comparing a struct containing an `any` field with `==` panics at runtime** rather than failing to
  compile (P55's finding). `model.ConnectionState.Caps` is such a field and P58a now puts a real
  `adapters.Caps` value in it — use `go-cmp` (already a dependency), never `==`.

## 12. M0 results (run for real in this sandbox)

All five probes pass, run against `postgres:17-alpine` and `confluentinc/cp-kafka:8.0.7` (both
pulled via `mirror.gcr.io` and retagged, per `AGENTS.md`'s Docker section — the daemon was already
running in this session with no `dockerd` bootstrap needed). Two results are genuine findings that
change or sharpen an §1/§6 claim rather than merely confirming one; both are folded back into the
relevant design section, not just recorded here.

- **JS-1 — PASS, as designed.** `[]byte` → base64; a bare `[]uint32` → a plain JSON number array (not
  base64) — confirming D5's own premise that `offsets`/`truncated` need the explicit `MarshalJSON`
  wrapper, not just a type alias; the wrapper's LE-byte encoding round-trips correctly
  (`[0,5,10]` → `AAAAAAUAAAAKAAAA`, verified by hand-decoding).
- **TC-1 — PASS.** `testcontainers-go` starts a real Postgres container in ~2.1s in this sandbox, no
  Bun-style hang, confirming §4.10/A19's premise that the Go test tier has no analogue of P57's
  `bun run` Testcontainers hang.
- **PG-1 — PASS, with one probe-design correction worth keeping.** `pg_cancel_backend` on a side
  connection reliably produces SQLSTATE `57014` on the cancelled query. The first run's
  `pg_stat_activity` check read a stale `query LIKE '%pg_sleep%'` count of 1 immediately after
  cancellation — not evidence the query was still running, but `pg_stat_activity.query` showing the
  backend's *last-run* statement text while it briefly sits `idle`/`idle in transaction (aborted)`.
  Filtering on `state != 'idle'` (not just query text) reads 0 immediately, no added delay needed.
  **This is the real check `postgres/client.go`'s own cancellation verification should use** —
  `state`, not a text match against `query`.
- **PG-2 — genuinely failed on the first attempt, and the fix is better than §6's own guessed
  fallback.** pgx v5's default extended-query protocol returns `bytea` (and other binary-capable
  types) in **binary** wire format, which cannot scan into `*string` at all
  (`cannot scan bytea (OID 17) in binary format into **string`). §6's own "if it fails" column
  guessed this would force a second, dedicated text-mode connection per database, doubling
  `ConnSet`'s backend count. **That guess is wrong, and the real fix is smaller**: passing
  `pgx.QueryExecModeSimpleProtocol` as a per-query option forces the simple query protocol for that
  one call, which returns every value in text format — on the *same* connection, mixed freely with
  ordinary (extended-protocol, typed) queries on other calls. Confirmed: `bytea` arrives `\x`-prefixed
  exactly as the current TypeScript adapter's `NormalizeCellText` expects, `numeric`/`timestamptz`/
  `json` all decode as their expected text forms, and `NULL` scans to a nil `*string`. **Design
  consequence for M5**: `client.go`'s data-reading queries (`read`/`preview`/console `execute`) pass
  `pgx.QueryExecModeSimpleProtocol`; catalog/typed queries (tree, describe, definition) do not need
  it and keep the default extended protocol. No second connection, no `ConnSet` shape change.
- **KF-1 — PASS in full, including both capabilities P32 D13/D14 recorded as lost.** franz-go's
  `kgo.ConsumePartitions` at explicit start offsets consumed all 10 produced records across both
  partitions with `kadm.ListGroups` reporting **zero** groups afterward (no `kira-studio-browse`
  ever created) — the no-group claim §1.7 makes is not just true of the current adapter's design,
  it is what franz-go's own client does by construction when you never call `Subscribe`. Each
  partition's `FetchTopicPartition.HighWatermark` matched `kadm.ListEndOffsets`'s own value exactly.
  `kadm.DescribeTopicConfigs` and `kadm.Metadata` (giving the cluster id) both succeeded — the two
  capabilities P32 D13/D14 recorded as permanently lost under the native NAN-addon client are real
  and available under franz-go/kadm, confirming D7's own recovery claim rather than merely its driver
  choice. **D7 needs no fallback; the primary recommendation is fully validated.**

None of these results changes P58a's own decisions — §3's `query.go` row already named this exact
fork and left it for "probe PG-2's answer" to decide (*"QueryExecModeSimpleProtocol + RawValues, or
a per-query result-format override"*); PG-2 settles it as the former, with no second connection.
No `go.mod` change, no target-tree change, no milestone re-sequencing.
`docs/v1/plans/P58-go-native-adapters.md` does not need updating for these: D7 stands as written,
and PG-1/PG-2's findings are implementation detail inside M5's own Postgres adapter, not a
substrate-level decision the parent plan makes.

## 13. M1-M5 results (run for real in this sandbox)

All five milestones are done. `go test ./... -race` is green across every package; `bun run lint`,
`bun run typecheck` (all four projects), `bun run test:unit`, `bun run test:go`, `bun run test:ui`
(36/36), and `bun run test:ipc:fe` (8/8) are all green. `nativeKinds` is `{"postgres": true}`.
`tests/db/postgres.spec.ts` is deleted. `tests/db/support/postgres.ts` is **not** deleted, a
deliberate deviation from §8's own M5 bullet — AGENTS.md's own P58a findings section explains why
(other tests gained real dependencies on it since this plan was written). Real bugs found and
fixed during implementation — a local-abort/pgx-context-cancellation race in the Cancel path, a
missing base64 branch in `toTypedArray`, a stale `build:wails` script reference, and three
placeholder `"postgres"` kind literals in pre-existing M4 tests — are written up in AGENTS.md's own
"P58a — Go substrate + Postgres adapter" findings section rather than duplicated here.

**C1, recorded.** This sandbox has no real X display for §7's own literal `xdotool`/screenshot
steps; the proof ran instead through this repo's own established real-app substitute for that
class of check (`tests/e2e-real/`, P57's replacement for interactive-GUI e2e testing) — the same
real `-tags server` Go binary, real bindings, real Postgres container, and real UI code paths, just
reached over `http://127.0.0.1` from a headless browser tab instead of a physical window.

| Step | Result |
| --- | --- |
| 1-5 (Docker, images, app build/boot) | PASS — `tests/e2e-real/postgres-real.spec.ts`'s own fixture |
| 6 (app rendered) | PASS — substitute's own equivalent (`status-bar` present) |
| 7 (connect; real server-version handshake) | **PASS** |
| 8 (tree expansion; relation kinds; `~N rows`) | **PASS** |
| 9 (definition view) | not run at the UI layer — covered by `postgres_test.go`'s own Describe-adjacent cases |
| 10 (real cell text via the base64 chunk path) | **PASS** — and is what surfaced the `toTypedArray` bug |
| 11 (page forward/back, keyset) | **PASS** — added as a second `postgres-real.spec.ts` test against real `app.big_rows`; asserts `data-pagination="keyset"`, not just row identity |
| 12 (count, then a cache hit) | not run at the UI layer — `postgres_test.go`'s `TestPostgres_Count` |
| 13 (two-statement console batch, one op-log row) | not run at the UI layer — `postgres_test.go`'s `TestPostgres_ExecuteOnePagePerStatement` |
| 14 (staged edit's preview text and landing) | not run at the UI layer — `postgres_test.go`'s `TestPostgres_PreviewNeverExecutes`/`TestPostgres_MutateUpdate` |
| 15 (stop button; `pg_stat_activity` clean afterward) | server-side half **PASS** via `postgres_test.go`'s `TestPostgres_Cancel` (real `pg_cancel_backend`, a real running backend); not driven through the UI's own stop button this session |
| 16 (Node child still running throughout) | not run this session — covered structurally by M4's `adapterhost` integration tests |
| 17-20 (MariaDB coexistence, interleaved op-log, summed cache stats) | not run this session — MariaDB has no Go adapter yet (P58b); M4's own router-forwarding tests already cover the mechanism against a real Node child |
| 21 (kill Node child, only MariaDB errors) | not run this session, same reason as 17-20 |

The load-bearing steps for this milestone specifically — 7, 8, and above all 10 and 11, the ones
that actually exercise the new Go-native data plane's wire format end to end — all passed for real
and surfaced one genuine, previously-undetected bug (the `toTypedArray` base64 branch). Steps 12-16
are verified below the UI layer, at the adapter/dispatcher layer, in this session; steps 17-21 are
deferred to whichever future session first has a native and a Node-served connection live side by
side for real, which will be closer to P58b than to this one.
