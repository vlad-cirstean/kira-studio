# P174: Studio result loading, browse semantics and staged edits

Source: `SPEC.md` row P174 (P168 Part 4 F8, Part 6 F8, Part 4 F15, Part 5 F4 binary half, Part 11
F7). All four decisions user-approved before planning:

1. One console/MCP result cap (rows + bytes) for every engine and `dbmcp` `run_query`. Result
   carries a `truncated` flag. Cursor closes early at the cap. No whole-result materialisation
   before the cap.
2. SQS read-only browse must not consume. Peek where the API allows, else explicit warning.
   Read-only connection never raises receive count if avoidable.
3. Binary Kafka/SQS payloads get an encoding marker the renderer understands. No replacement
   characters. Tombstone null half already landed.
4. Staged edits survive paging, sort, filter, projection and Refresh, keyed by primary key. No
   silent drop.

Base: `249c547` (branch `p168-stream-a`).

## Current behavior (read from source)

### Console results (F8)

Every engine buffers the whole result, then builds one unpaged page:

- `postgres/console.go` `runRaw` (`:40-83`) appends every row to `out [][]*string`; `execute`
  (`:212-280`) holds every statement's rows until `lookupTypeNames` runs, then `buildPage`.
- `mysqlfamily/console.go` `runRaw` (`:63-121`) same shape; `buildPage` (`:129-147`).
- `sqlite/console.go` `runOneStatement` (`:35-91`) streams into a `TabularPageBuilder` but never
  stops.
- `clickhouse/console.go` `runRowReturning` (`:101-130`) streams via `StreamQuery`; `onRow` has no
  way to stop the scan (`query.go` `streamRows` `:129-167`).
- `mongo/console.go` `runCursorOp` (`:294-311`) calls `cursor.All`, then `docsToPage` (`:235`).
- `redis/console.go` `execute` (`:429-490`) sends the user's command verbatim; `KEYS *`,
  `HGETALL`, `SMEMBERS`, `LRANGE 0 -1` etc. come back as one RESP reply go-redis reads whole;
  `resultToPage` (`:172`) converts all of it.
- `adapterhost/data.go` `Dispatcher.Execute` (`:202-234`) passes `model.ConsoleRequest{Path,
  Statements}` only. No cap field exists.
- `dbmcp/tools.go` `runQuery` (`:177-225`) calls `Router.Execute`, then `renderPage` with
  `maxRows` (200 default, 2000 max). `render.go` (`:862-937`) slices the already-full page;
  `Truncated: returned < pg.RowCount`. The adapter already fetched everything.
- `page.PagePosition` (`page/builder.go:33-40`, `wire.fbs` `table PagePosition`) has `has_more`
  but no truncation flag. `UnpagedPosition` is what every console page uses.

### SQS browse (F15)

`sqs/read.go` `pollQueue` (`:225-276`) loops `ReceiveMessage` with the queue's own visibility
timeout, read-only connection or not, and stores receipt handles. Each receive hides the message
from real consumers for the timeout and raises `ApproximateReceiveCount`. With a redrive policy,
`maxReceiveCount` receives move the message to its DLQ. `StreamView.vue:963` already shows a
generic "each poll consumes" `Alert`; nothing differs for read-only connections.

SQS has no peek API: every `ReceiveMessage` raises the receive count. Only the hiding is
avoidable (`VisibilityTimeout: 0` on the receive call).

### Binary payloads (F4)

`kafka/read.go` `buildStreamRow` (`:88-121`) passes key and value through
`strings.ToValidUTF8(…, "�")`; `headersToPlain` (`:69-85`) does the same per header value. SQS
`pushMessage` (`sqs/read.go:162-191`) passes `m.Body` through. SQS rejects a body outside its
allowed Unicode set at `SendMessage`, so an SQS body is always valid UTF-8; SQS binary data lives
only in `BinaryValue` attributes, already base64 in the `headers` cell (`encodeHeaders`). The
renderer (`views/stream/page.ts` `streamRow`) decodes every cell as UTF-8 text.

### Staged edits (Part 11 F7)

`views/grid/pendingChanges.ts` keys `edits: Map<number, PendingEdit>` and `deletes: Set<number>`
by page-relative row index. `views/grid/state.ts` `load` → `apply` (`:166-173`) calls
`clearPending(tabId)` on every landed page: paging, sort, filter, projection, Refresh. Primary key
is resolved only at commit (`buildPlan` → `primaryKeyOf`, reading the *current* page). Gates that
exist only because of the silent drop: `viewCommands.ts` `registerPendingGuard` (sibling reload
skipped while staged), Generate Data lockout (`DataView.vue:150-162`, `DataToolbar.vue:134-138`),
`menu.ts` `editReferencedRow` `newTab: true` comment (`:110-125`).

## Decisions

### D1. Console result cap

- One policy type in `page`: `type ResultCap struct { Rows, Bytes int }` plus
  `func (c ResultCap) Reached(rows, bytes int) bool`. Default policy in `adapters`:
  `DefaultConsoleCap = page.ResultCap{Rows: 10_000, Bytes: 64 << 20}`. 10,000 matches the data
  tab's largest page size (`views/shared/page/sizes.ts`); 64 MiB bounds one result set's held
  cell bytes regardless of width.
- `Bytes` counts cell text bytes the builder actually holds (post 64 KiB cell truncation).
- `model.ConsoleRequest` gains `Cap page.ResultCap`; zero value means `DefaultConsoleCap`
  (`adapters.ConsoleCapFor(req)` resolves it, and clamps any field above the default down to it).
- `adapterhost.ExecuteRequestWire` gains `Cap page.ResultCap \`json:"-"\``: Go callers only
  (`dbmcp`, tests). The renderer cannot set it; no TS wire change.
- Truncation semantics: an engine checks the cap *before* appending the next row. Cap reached and
  another row exists → stop, `truncated = true`. Exactly-cap results report `false`. So
  `truncated` always means "at least one more row existed".
- Flag lives on `PagePosition`: new `truncated:bool` field appended at the end of `table
  PagePosition` in `wire.fbs` (backward-compatible slot). Go `PagePosition.Truncated bool
  \`json:"truncated,omitempty"\`` (`omitempty` keeps the `ipcfixture` goldens unchanged for
  untruncated pages). TS `PagePosition.truncated: boolean`. Helper
  `page.CappedPosition(rowCount int, truncated bool)`. `has_more` stays false on console pages:
  there is no continuation.
- Early close per driver (record in ARCHITECTURE):
  - SQLite (`database/sql` + modernc): `rows.Close()` resets the statement. Real stop.
  - ClickHouse: close the HTTP body. Console row-returning requests add
    `cancel_http_readonly_queries_on_client_close=1` (allowed: console requests use `readonly=2`
    or none, `query.go:73`), so the server cancels the read on disconnect.
  - MongoDB: `cursor.Close` kills the server cursor. Real stop.
  - PostgreSQL (pgx v5.11) and MySQL/MariaDB (go-sql-driver 1.10): `rows.Close()` drains the
    remaining rows off the wire without allocating them. Memory is bounded; server and network
    time are not. Declined: `CancelRequest` after the cap aborts the read-only `BEGIN READ ONLY`
    wrap and fails later statements in the batch; a server-side `DECLARE CURSOR` only covers
    `SELECT`. The Stop button remains the way to end a long drain.
  - Redis: see D2.
- `dbmcp` `run_query` passes `Cap: page.ResultCap{Rows: maxRows}` (bytes stay default). Render
  sets `Truncated: returned < pg.RowCount || pg.Position.Truncated`. `rowCount` now means rows
  fetched, a lower bound when truncated; the `run_query` tool description states it.
- `queryplan.FromPages` and the renderer's `console/plan.ts` `parseExplainPages` refuse a page
  with `position.truncated` (an incomplete plan), same error family as the existing truncated-cell
  refusal.
- Console UI: `ConsoleView.vue` shows a shadcn `Alert` above the result grid when the active
  page's `position.truncated` is true: "Result stopped at N rows (console limit). Narrow the query
  to see the rest." No cap numbers duplicated in TS.

### D2. Redis console bounded forms

go-redis cannot stream one RESP reply. For commands with a bounded equivalent, `execute` rewrites
after validation (read-only gate and denylist run on the user's own command first):

| User command | Run as |
|---|---|
| `KEYS pattern` | `SCAN` loop, `MATCH pattern COUNT 1000`, dedup, stop at cap |
| `HGETALL` / `HKEYS` / `HVALS` | `HSCAN` loop, project to the original reply shape |
| `SMEMBERS` | `SSCAN` loop |
| `LRANGE key s e` / `ZRANGE key s e` (index form, any `WITHSCORES`, `REV`) | clamp `e` to `s + cap` after resolving negatives via `LLEN`/`ZCARD` |
| `ZRANGEBYSCORE` / `ZRANGEBYLEX` / `ZRANGE … BYSCORE|BYLEX` without `LIMIT` | append `LIMIT 0 cap+1` |
| `XRANGE` / `XREVRANGE` without `COUNT` | append `COUNT cap+1` |

The reply is shaped back to what the original command returns, so `resultToPage` and
`hashReadPage` stay unchanged. `op.SetCommand` keeps the user's text. Every other command (`SUNION`,
`SINTER`, `SDIFF`, `EVAL`/`FCALL`, module commands, `GET` of a huge string) is read whole by
go-redis; the page is still capped at build time with `truncated`. That residue goes to
ARCHITECTURE "Known open items".

### D3. SQS read-only browse

- No peek exists. On a read-only connection `pollQueue` passes `VisibilityTimeout: 0` to
  `ReceiveMessage`: messages stay visible to real consumers, and a FIFO message group is not
  locked. It stores no receipt handles (delete is blocked on read-only anyway).
- Receive count still rises. So:
  - `fetchVisibilityTimeout` becomes `fetchQueueAttributes`: one `GetQueueAttributes` call for
    `VisibilityTimeout` and `RedrivePolicy`. `maxReceiveCount` parsed from the redrive JSON.
  - `StreamPage` gains `max_receive_count:int = null` (SQS-only, like
    `visibility_timeout_seconds`).
  - `StreamView.vue`: the existing `stream-poll-warning` `Alert` gets a read-only variant: "Polling
    keeps messages visible, but each poll still raises every received message's receive count."
    Plus, when known, "This queue moves a message to its dead-letter queue after N receives."
  - First Poll (or Refresh) per tab on a read-only SQS connection asks through the existing
    `confirmDialogStore.confirmDialog`, naming the receive-count effect. Confirmation lasts for the
    tab's runtime (`rt.receiveAcknowledged`, not persisted).
- Writable connections keep the current behavior (queue's own visibility timeout, receipt handles
  for Delete) and the current warning text, plus the redrive sentence when known.
- `dbmcp` cannot reach SQS (`caps.SQL` false, no read tool), confirmed: nothing to change there.

### D4. Binary payload marker

- `Chunk` gains `binary:[uint]` in `wire.fbs`: sorted row indices whose cell text is standard
  base64 of raw bytes that were not valid UTF-8. Optional (absent decodes as empty), so no
  existing encoder changes behavior. Mirrors `truncated:[uint]`.
- `page` helper `BytesCell(b []byte) (text string, binary bool)`: valid UTF-8 → as-is; else
  base64. `columnScratch` records binary rows; `StreamRow` gains `KeyBinary, BodyBinary bool`.
- Kafka `buildStreamRow`: key and value through `BytesCell`. Header values: a non-UTF-8 value
  becomes `{"base64":"…"}` in the headers JSON instead of a replacement-character string.
- SQS body: also through `BytesCell` for one uniform contract; by AWS's own constraint it never
  fires. Stated in ARCHITECTURE, not tested.
- Renderer: `page.ts` `isBinary(chunk,row)`; `stream/page.ts` `StreamRow` gains `keyBinary`,
  `bodyBinary`. `StreamView.vue` key and body cells show a shadcn `Badge`
  (`@theme/components/ui/badge`) reading `base64` before the text; cell-editor dock shows the same text with
  `dataType: 'base64'`. Copy copies the base64 text. Search matches the base64 text (stated in
  ARCHITECTURE).
- Kafka produce (`produce.go`) unchanged: composing binary is out of scope.

### D5. Staged edits keyed by primary key

- `pendingChanges.ts`: `edits: Map<string, PendingEdit>` and `deletes: Map<string, PendingDelete>`
  keyed by a canonical row key: `JSON.stringify` of `[name, value]` pairs of the table's full
  primary key (`rt.meta.primaryKey` via the existing `fullPrimaryKeyOf` accessor), sorted by name.
  Each entry stores its own `key: Record<string, string|null>` captured at stage time.
- Staging requires the full primary key in the current page. `SlickGridHost.vue`
  `hasPrimaryKey()` becomes "every `rt.meta.primaryKey` column present in the page" (falls back to
  "some PK column" until meta loads, exactly today's check). This moves today's commit-time
  `UnaddressableRowError` to edit time: the cell is not editable rather than failing on Commit.
- Row ↔ key mapping per page: a non-reactive `Map<string, number>` built once per
  `pageVersion` for the tab (pk key → page row), plus `rowKeys: string[]`. Store API keeps its
  row-based signatures (`stageEdit(tabId, row, …)`, `stagedValue(tabId, row, col)`,
  `isPendingDelete(tabId, row)`) and translates internally, so most call sites do not change.
  `dataSource.ts`'s hot path reads `rawPendingFor` plus the per-page `rowKeys` snapshot.
- `buildPlan` uses each entry's stored key; no `primaryKeyOf` at commit. Rows staged off the
  current page still commit.
- `state.ts` `load` → `apply` no longer calls `clearPending`. `clearPending` stays on tab close
  (`tabs.ts:155`) and after a successful commit.
- Pending count badge (`DataView.vue` `pendingCount`) counts every staged entry, on-page or not.
  Toolbar adds "N staged change(s) not on this page" text when some are off-page, so nothing is
  invisible.
- Projection hiding a staged column: the change stays and commits; the Preview command panel
  already shows it.
- Edits to a primary-key column: the entry's key is the pre-edit key, so the update addresses the
  original row.
- Removed as dead once survival lands: `viewCommands.ts` pending-guard registry and its `'data'`
  registration (only registrant: confirm by grep), the Generate Data pending lockout (its only
  stated reason is the reload drop; mask-preview lockout stays), and the stale `menu.ts` comment.
  Insert rows (`inserts`) are already page-independent.

## Steps

Each step ends with typecheck, lint and Go build passing in a normal commit. Docker suites run
once at phase end (step 13).

1. **Wire: `PagePosition.truncated`, `Chunk.binary`, `StreamPage.max_receive_count`.**
   `packages/shared/protocol/wire.fbs`; regenerate with `bun run generate:wire` (Go
   `apps/kira-studio/internal/page/wire/*`, TS `packages/shared/protocol/wire/*`).
   `internal/page/builder.go` (`PagePosition.Truncated`, `CappedPosition`, `ResultCap`, builder
   row/byte counters and `Bytes()`, `StreamRow.KeyBinary/BodyBinary`,
   `StreamPage.MaxReceiveCount`), `internal/page/scratch.go` (binary row list),
   `internal/page/chunk.go` (`Chunk.Binary`, `BytesCell`), `internal/page/encode.go`.
   `packages/shared/protocol/page.ts` (types, `unpagedPosition`, TS builders, `isBinary`),
   `packages/shared/protocol/frame.ts` (decode). Fix every TS `PagePosition` literal `tsc` flags.
   Commit: `feat(page): add truncated position flag, binary cell marker and SQS receive limit`.
2. **Cap plumbing.** `internal/storage/model/console.go` (`ConsoleRequest.Cap`),
   `internal/adapters/adapter.go` (`DefaultConsoleCap`, `ConsoleCapFor`, contract comment on
   `Execute`), `internal/adapterhost/wire.go` (`ExecuteRequestWire.Cap`),
   `internal/adapterhost/data.go` (pass through). Commit: `feat(adapters): console result cap
   policy`.
3. **SQL consoles.** `sqlite/console.go`, `postgres/console.go` (stream into a builder with
   OID-named columns, swap in resolved columns after `lookupTypeNames` via a `page` helper that
   recomputes `ByteSize`), `mysqlfamily/console.go` (stream inside `runRaw`),
   `clickhouse/console.go` + `clickhouse/query.go` (`onRow` returns `bool` to stop; `read.go`
   caller returns `true`; console adds the cancel-on-close setting via `extraParams`). Pass the
   resolved cap from each `adapter.go` `Execute` into `execute`. Commit: `feat(adapters): stop SQL
   console reads at the result cap`.
4. **MongoDB console.** `mongo/console.go`: `runCursorOp` iterates `cursor.Next` into a
   `DocumentPageBuilder`, stops at cap, closes the cursor; `docsToPage` callers that already hold a
   bounded slice (`insertMany` ids, single docs) unchanged. `mongo/adapter.go` passes the cap.
   Commit: `feat(mongo): stop console cursors at the result cap`.
5. **Redis console.** `redis/console.go` (+ new `redis/consolebound.go` for D2's rewrite table if
   `console.go` passes ~600 lines), `redis/adapter.go`. Unit test (see Tests). Commit:
   `feat(redis): bounded console forms for collection reads`.
6. **dbmcp + plans.** `dbmcp/tools.go` (pass `Cap`), `dbmcp/render.go` (`Truncated`),
   `dbmcp/server.go` (`run_query` description: `rowCount` is rows fetched),
   `queryplan/parse.go` (refuse truncated page), `dbmcp/render_test.go` only if an existing case
   breaks. Commit: `feat(dbmcp): run_query reads stop at maxRows`.
7. **Console UI.** `frontend/src/views/console/ConsoleView.vue` (truncation `Alert`),
   `frontend/src/views/console/plan.ts` (refuse truncated page). Commit: `feat(console): show
   when a result stopped at the cap`.
8. **SQS read-only browse.** `sqs/read.go` (`fetchQueueAttributes`, read-only
   `VisibilityTimeout: 0`, no handles, `MaxReceiveCount`), `sqs/adapter.go` (pass read-only flag
   to `pollQueue`). Commit: `fix(sqs): read-only poll keeps messages visible`.
9. **SQS UI.** `frontend/src/views/stream/StreamView.vue` (warning variants, first-poll confirm),
   `frontend/src/views/stream/state.ts` (`maxReceiveCount`, `receiveAcknowledged` on the runtime).
   Update `stream-poll-warning` text assertions in `tests/ipc/sqs/*` if any match the old text.
   Commit: `feat(stream): warn and confirm before a read-only SQS poll`.
10. **Binary marker.** `kafka/read.go` (`buildStreamRow`, `headersToPlain`), `sqs/read.go`
    (`pushMessage` body), `frontend/src/views/stream/page.ts`, `StreamView.vue` (badge, dock
    `dataType`). Commit: `feat(stream): mark binary Kafka keys and payloads as base64`.
11. **Staged edits by primary key.** `frontend/src/views/grid/pendingChanges.ts`,
    `views/grid/state.ts` (drop `clearPending` in `apply`; drop pending-guard registration),
    `views/grid/SlickGridHost.vue` (`hasPrimaryKey`, invalidation watches iterate on-page rows via
    the store's mapping), `views/grid/slick/dataSource.ts`, `views/grid/slick/rowValues.ts`,
    `views/grid/paste.ts`, `views/grid/menu.ts`, `views/grid/DataToolbar.vue`,
    `views/grid/DataView.vue` (badge, off-page note, Generate Data gate),
    `frontend/src/state/viewCommands.ts` (remove guard registry). Comments in
    `views/shared/celleditor/state.ts` / `state/cellSelection.ts` only if they now lie. Unit test
    (see Tests). Commit: `feat(grid): staged edits survive reload, keyed by primary key`.
12. **Docs.** `docs/ARCHITECTURE.md`: Adapter contract (`Execute` cap, `truncated`), Per-database
    mapping SQS read policy paragraph (`:156-159`), SQS section (read-only receive, redrive),
    Kafka section (binary marker), MongoDB/Redis section (bounded forms), Database MCP `run_query`
    (`rowCount` lower bound), UI architecture write-model paragraph (`:1937-1948`: PK-keyed
    survival), Known open items (Redis residue from D2; pg/MySQL drain-not-stop). Fill this
    plan's Result section. Commit: `docs: P174 result cap, SQS browse, binary marker, staged edits`.
13. **Phase-end verification** (Docker), fixes as follow-up `fix:` commits. See below.

## Tests

Only where the CLAUDE.md bar is met.

- **Adapter conformance suites (exempt, updated for the cap).** One cap scenario per engine in its
  existing `*_test.go`, using `ConsoleRequest.Cap`: cap+1 rows → `RowCount == cap`,
  `Position.Truncated`; exactly cap rows → not truncated; a byte-cap case on one engine
  (SQLite, no Docker) with a small `Bytes`. Files: `sqlite/sqlite_test.go`,
  `postgres/postgres_test.go`, `mysqlfamily/mysqlfamily_test.go`, `clickhouse/clickhouse_test.go`,
  `mongo/mongo_test.go`, `redis/redis_test.go` (`KEYS` via SCAN, `LRANGE 0 -1`, `HGETALL`).
  `sqs/sqs_test.go`: read-only poll then immediate second poll sees the same message;
  `MaxReceiveCount` set on a queue with a redrive policy. `kafka/kafka_test.go`: invalid-UTF-8
  key, value and header round-trip as base64 with the binary row index set. Extend through the
  existing `testsupport` `Scenario`/`Requires` seam where the suite uses it.
- **Unit: Redis bounded rewrite** (`redis/console_internal_test.go`): a rule table with
  interacting cases (negative indices, `REV`, `WITHSCORES`, `LIMIT`/`COUNT` already present,
  `BYSCORE` inside `ZRANGE`). Meets the "decision structure too large" bar.
- **Unit: PK-keyed pending store** (`apps/kira-studio/tests/unit/grid-pending-by-primary-key.spec.ts`):
  stage edit + delete, replace the page (reordered, row missing), assert mapping, delete/edit
  exclusivity, commit plan carries stored keys, staging refused without full PK. Meets the
  "cache invalidation with interacting rules" bar.
- Nothing else: page builder counters, `CappedPosition`, `BytesCell`, render flag, UI banners are
  thin and get no dedicated test.

## Verification

Fast, per commit: `bun run typecheck`, `bun run lint`, `go build ./...`,
`go vet ./apps/kira-studio/...`, `bun run test:unit` for the new spec.

Phase end, **needs Docker** (`docs/DEV_ENVIRONMENT.md`):

- `go test ./apps/kira-studio/internal/adapters/...` for postgres, mysqlfamily, clickhouse, mongo,
  redis, kafka, sqs (LocalStack). SQLite runs without Docker.
- `go test ./apps/kira-studio/internal/dbmcp/... ./apps/kira-studio/internal/queryplan/...`.
- `KIRA_IPC_FIXTURES` suite: `omitempty` should keep goldens unchanged; it is already stale per
  Known open items. Do not widen into regenerating it unless a P174 field causes a new diff.
- `bun run test:ipc:fe:studio` SQS/Kafka frontend specs (poll warning text, body rendering).
- Manual (server build): console `SELECT generate_series(1, 20000)` on Postgres shows 10,000 rows
  and the banner; grid: stage edit, next page, sort, Refresh, back: edit still shown, Commit
  applies it.

If Docker is absent in the session, say so in the Result section and leave step 13 open; never
report it done.

## File ownership (for concurrency with P175)

| Path | Change |
|---|---|
| `packages/shared/protocol/wire.fbs` | fields |
| `packages/shared/protocol/wire/*` (generated) | regen |
| `packages/shared/protocol/page.ts`, `frame.ts` | types, decode |
| `apps/kira-studio/internal/page/*` (incl. `wire/` generated) | cap, marker |
| `apps/kira-studio/internal/storage/model/console.go` | `Cap` |
| `apps/kira-studio/internal/adapters/adapter.go` | cap policy |
| `apps/kira-studio/internal/adapters/{sqlite,postgres,mysqlfamily,clickhouse,mongo,redis}/{console.go,adapter.go,*_test.go}`; `clickhouse/query.go`, `clickhouse/read.go`; new `redis/consolebound.go` | cap |
| `apps/kira-studio/internal/adapters/sqs/{read.go,adapter.go,sqs_test.go}` | browse, marker |
| `apps/kira-studio/internal/adapters/kafka/{read.go,kafka_test.go}` | marker |
| `apps/kira-studio/internal/adapterhost/{wire.go,data.go}` | cap pass-through |
| `apps/kira-studio/internal/dbmcp/{tools.go,render.go,server.go,render_test.go}` | cap |
| `apps/kira-studio/internal/queryplan/parse.go` | truncated refusal |
| `apps/kira-studio/frontend/src/views/console/{ConsoleView.vue,plan.ts}` | banner, refusal |
| `apps/kira-studio/frontend/src/views/stream/{StreamView.vue,state.ts,page.ts}` | SQS, marker |
| `apps/kira-studio/frontend/src/views/grid/{pendingChanges.ts,state.ts,SlickGridHost.vue,DataView.vue,DataToolbar.vue,menu.ts,paste.ts,slick/dataSource.ts,slick/rowValues.ts}` | staged edits |
| `apps/kira-studio/frontend/src/state/viewCommands.ts` | guard removal |
| `apps/kira-studio/frontend/src/views/shared/celleditor/state.ts`, `state/cellSelection.ts` | comments only, if stale |
| `apps/kira-studio/tests/unit/grid-pending-by-primary-key.spec.ts` (new) | test |
| `apps/kira-studio/tests/ipc/sqs/*`, `tests/ipc/kafka/*` | text assertions only, if they break |
| `docs/ARCHITECTURE.md` | **shared with P175** |
| `docs/v2.0/plans/P174-result-loading.md` | this plan |
| `docs/v2.0/SPEC.md` | **shared with P175** (row status only) |

P174 touches no Wails bridge type, so it never regenerates `frontend/bindings`.

### Concurrency with P175

P175 owns: `frontend/src/api/state/*` (`apiQueries.ts`, `raw.ts`), `CookiesPane.vue`, HTTP/gRPC
`ResponsePane.vue`, `RawExchangePane.vue`, the dotenv bulk editor, `internal/httpclient`
(cookie jar), `internal/bridge/http.go` (`HttpDeleteCookie`), likely regenerated
`frontend/bindings`, and its UI specs.

Code overlap: none. Ordering dependency: none (P174 changes the data-plane page wire and grid;
P175 changes the API client and its Go bridge). Shared files: `docs/ARCHITECTURE.md` (different
sections: P174 adapter/SQS/Kafka/MCP/grid write model, P175 HTTP/API client) and
`docs/v2.0/SPEC.md` (row status). Both are documentation, but CLAUDE.md asks for zero overlap.
Two clean options: (a) give doc ownership to neither stream and have the orchestrator apply both
streams' ARCHITECTURE/SPEC edits at landing; or (b) accept same-file, different-hunk edits and
resolve at rebase. Verdict: P174 can run concurrently with P175 under option (a), or under (b) if
the orchestrator accepts doc-only overlap. Step 12 stays P174's either way; under (a) its
ARCHITECTURE hunks land as one commit after rebase.

UI test fixtures: P174 adds no `tests/ui/*` spec and does not touch `tests/ui/fixtures.ts`. P175
adds UI specs there. No conflict.

## Commits

Steps 1-12 each one commit as named above (step 5, 8 or 11 may split into two if the hook-clean
diff is large; same prefix). Phase-end fixes: `fix:` commits per root cause.

## Result

Steps 1-11 done, one commit each: `d21a03e`, `3183d1f`, `abacd4d`, `1f6314a`, `83c0023`, `efea829`,
`37d97c5`, `5a1a9b2`, `61c4eb1`, `66b5fb6`, `5349ad1`. Step 12 (docs) is the last commit. Follow-up
fixes: `30d2b3d` (test encoder wrote a null `Chunk.binary` offset under `forceDefaults`, broke
every UI spec's grid load), `f26b7e3` (`interaction.spec.ts` asserted the old drop-on-reload rule).

Checks run:

- `bun run typecheck`, `bun run lint`, `go build ./...`, `go vet ./...`: pass.
- `bun test apps/kira-studio/tests/unit`: 810 pass.
- `go test` for `page`, `queryplan`, `dbmcp`, `adapterhost`, `adapters`, `adapters/redis`,
  `adapters/sqs`, `adapters/kafka`: pass (no Docker). SQLite cap scenarios run in `adapters/sqlite`.
- `bun run lint:dead`: only the 6 duplicate-export groups and 8 config hints already present on
  the base; nothing from P174.
- Playwright `ui` project, full run: 303 pass, 4 fail. Reruns alone: `slick-grid.spec.ts:544`,
  `:1221` and `cell-editor.spec.ts:332` pass (timing under 100% workers; 332 takes 56 s of its 60 s
  budget). `interaction.spec.ts:1100` failed on the old drop-on-reload rule; spec updated, passes.

Deviations:

- SQS read-only hide time is 1 second, not 0: the AWS SDK omits `VisibilityTimeout: 0` from the
  request (indistinguishable from unset). Dedupe by `MessageId` covers a message re-received inside
  one poll.
- TS `PagePosition.truncated` is optional (decoded `|| undefined`) so existing fixtures stay valid.
- PostgreSQL keeps raw rows, capped, before `bytea` normalisation instead of streaming into the
  builder.
- Redis also rewrites `ZREVRANGE`. New helper files `adapters/consolecap.go` and
  `adapters/testsupport/consolecap.go`.
- The pending-guard registry, stale-marker, `pageStale` field and `page-stale-strip` alert are
  removed with the survival change; the Generate Data pending lockout is removed, mask-preview
  lockout stays. Two pk-guard unit specs are folded into `grid-pending-by-primary-key.spec.ts`
  (staging is refused without a full primary key, so the commit-time throw is gone).

Not run, step 13 left open: Docker-backed adapter suites (postgres, mysqlfamily, clickhouse, mongo,
redis, kafka, sqs/LocalStack), the cap scenarios on those engines, the SQS read-only second-poll
check, `test:ipc:fe:studio`, and the manual 20,000-row Postgres console pass. No Docker in this
session.
