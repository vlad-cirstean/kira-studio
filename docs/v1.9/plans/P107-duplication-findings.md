# P107 duplication findings

Audit of the whole implementation — both apps' Go and TypeScript/Vue, every `packages/*` — for
near-duplicate logic (tier 1) and duplicated flows/chains (tier 2). Tree audited: `c2ce9969` (tip of
`v1.9-p107-plan`, after P104). Every entry names exact instances, what repeats, what differs, and one
concrete consolidation shape. A Sonnet subagent implements the consolidation from this document,
same phase (user-directed change to the phase's original "findings only" design; see the P107 row
in `SPEC.md`).

Line numbers are as of `c2ce9969`. Paths are repo-relative. `Studio` = `apps/kira-studio`,
`Space` = `apps/kira-space`, `A` = `apps/kira-studio/internal/adapters`.

## 0. Method

Four sweeps over the CodeGraph index (`.codegraph/codegraph.db`, `nodes`/`edges` tables, read via
`bun:sqlite`; `sqlite3` binary absent), then per-candidate verification with `codegraph_explore`
and comment-blind `diff` of whole files.

- S1 body hash: every `function`/`method` node's source, comments and whitespace stripped, hashed;
  second pass also identifier-blind. 81 exact groups, 108 blind groups.
- S2 name collisions: same symbol name, ≥2 files, same language. 244 groups (most benign: `New`,
  `Close`, `preview`; each read, kept only where bodies match).
- S3 callee fingerprint: per function, ordered callee list from `calls` edges; pairs with LCS ratio
  ≥0.7 and ≥6 callees. 78 pairs.
- S4 file pairs: 46 file pairs the above flagged, diffed comment-blind (`sed` strips `//` lines),
  counts recorded per entry where decisive.

Generated code (`page/wire`, `gitwire`, `shared/protocol/wire`, `git-ipc/src/generated`) and
cross-language mirrors (`mask.go`/`mask.ts`, `page/encode.go`/`encodeFrame.ts`, `queryplan` Go vs
`console/planParsers` TS) are excluded before counting — see §3.

Summary: 25 tier-2 findings, 28 tier-1 findings, 12 declines.

## 1. Tier 2 — flows and chains

### T2-1 Relational read/mutate trio: mysqlfamily, postgres, sqlite

Instances (each column is one adapter; the three files share one structure):

- `quoteIdent`: `A/postgres/read.go:21-26`, `A/sqlite/read.go:18-23` (byte-identical, `"`
  doubling), `A/mysqlfamily/read.go:16-21` (backtick doubling), `A/clickhouse/read.go:21-28`.
- `readReq` struct: `A/mysqlfamily/read.go`, `A/postgres/read.go`, `A/sqlite/read.go` (same
  fields).
- `buildKeysetWhere`: `A/mysqlfamily/read.go:80-100` == `A/sqlite/read.go:104-124`;
  `A/postgres/read.go:78-102` differs only in `$N` placeholders vs `?`.
- `buildPageSQL`: `A/mysqlfamily/read.go:104-124` == `A/sqlite/read.go:128-148`;
  `A/postgres/read.go:106-124` same minus placeholder style.
- `readPage`: `A/mysqlfamily/read.go:127-224`, `A/postgres/read.go:127-244`,
  `A/sqlite/read.go:151-265` (S3 0.96: same callee chain — projection resolve, effective order,
  fetch columns, keyset where, page SQL, scan, `BuildKeysetPosition`).
- `countRows`: `A/mysqlfamily/read.go:227-248`, `A/postgres/read.go:263-284`,
  `A/sqlite/read.go:268-289` (S3 1.00).
- `binaryColumnsOf`: `A/mysqlfamily/mutate.go:31-39`, `A/postgres/mutate.go:23-31`,
  `A/sqlite/mutate.go:30-38` (identical).
- `preview`: `A/mysqlfamily/mutate.go:42-59` == `A/sqlite/mutate.go:41-58`;
  `A/postgres/mutate.go:47-64` same shape.
- `mutate`: `A/mysqlfamily/mutate.go:62-132`, `A/postgres/mutate.go:67-140`,
  `A/sqlite/mutate.go:63-134` (S3 0.91: begin tx, per-op build via `adapters.BuildSQLMutation`,
  exec, affected-row check, commit/rollback).
- `setCommand`: `A/mysqlfamily/query.go:28-36`, `A/postgres/query.go:33-41`,
  `A/sqlite/query.go:147-155`.

Differs only in: placeholder function (`?` vs `$N`), identifier quote rune, driver connection type
(`*sql.Conn` vs `*pgx.Conn`), mysqlfamily's extra `threadID` for kill-tracking, postgres's `track`
callback.

Shape: extend the shared base package `A/` (already home to `sqltext.go`, `sqlmutate.go`,
`relationalpage.go`):

- `A/sqltext.go`: `QuoteIdentDouble(name string) string` and `QuoteIdentBacktick(name string) string`;
  each adapter's `quoteIdent` becomes a package-level `var quoteIdent = adapters.QuoteIdentDouble`.
- `A/relationalread.go` (new): `type ReadReq struct` (the shared fields), `BuildKeysetWhere(req
  ReadReq, order EffectiveOrder, fingerprint string, placeholder func(int) string, quote
  func(string) string) (string, []any, error)`, `BuildPageSQL(...)`, plus a `RelationalReader`
  interface `{ Query(ctx, sql, args) (Rows, error) }` with a thin `database/sql` and `pgx` adapter
  so `ReadPage`/`CountRows` live once. `threadID`/`track` pass through as an optional
  `func(context.Context) context.Context` hook rather than a parameter fork.
- `A/sqlmutate.go`: `BinaryColumnsOf`, `PreviewSQLMutation`, and `RunSQLMutation(ctx, tx
  SQLExecer, ops, opts)` carrying the begin/exec/verify/commit chain; per-adapter `mutate` shrinks
  to tx open + call.
- `setCommand` → one `adapters.SetCommandSQL(dialect, name, value)` if the three bodies differ only
  in quoting; otherwise leave (verify at implementation time).

Callers: each adapter's `Adapter.Read`/`Adapter.Count`/`Adapter.Mutate`/`Adapter.Preview`, and
`A/clickhouse` for `quoteIdent` only. Conformance suites (`A/*/*_test.go`) cover every capability
this touches; run all four after the move.

### T2-2 `ConnSet` LRU pool with single-flight dial: postgres, mysqlfamily, redis

Instances:

- `get` (single-flight dial, LRU touch, eviction): `A/postgres/client.go:196-256`,
  `A/mysqlfamily/client.go:294-351`, `A/redis/client.go:165-214`.
- `dialInFlight` struct: `A/postgres/client.go:172`, `A/mysqlfamily/client.go:258` (comment in
  mysqlfamily says "see postgres/client.go's own doc comment" — acknowledges the copy).
- `touchLocked`: `A/postgres/client.go:312-320` == `A/mysqlfamily/client.go:423-431`;
  `A/redis/client.go:294-302` (int key).
- `detachLRULocked`: `A/postgres/client.go:336-356` == `A/mysqlfamily/client.go:445-465`;
  `A/redis/client.go:308-324`.
- `CloseAll`/`closeAll`: `A/postgres/client.go:360-375`, `A/mysqlfamily/client.go:469-485`,
  `A/redis/client.go:280-292`.

Differs only in: key type (`string` database vs `int` db index), entry type (`*connEntry` vs
`*goredis.Client`), dial function, close function.

Shape: `A/connset.go` (new): `type ConnSet[K comparable, C any] struct` with
`NewConnSet[K, C](opts ConnSetOptions[K, C])` where options carry `Dial func(ctx, K) (C, error)`,
`Close func(context.Context, C)`, `Max int`, `Log`. Methods `Get`, `CloseAll`, `Evict`, plus the
single-flight and LRU internals once. Each adapter keeps its own `connEntry` as `C` and its dial.

Callers: `Adapter.Connect`/`Disconnect`/every per-database op in the three adapters;
`A/*/client_test.go` where present.

### T2-3 Adapter `Disconnect`/`trackerFor`: mysqlfamily, postgres, clickhouse

Instances: `trackerFor` `A/mysqlfamily/adapter.go:416-434` == `A/postgres/adapter.go:427-445`;
`A/clickhouse/adapter.go:94-112` same shape. `Disconnect` `A/mysqlfamily/adapter.go:110-121` and
`A/postgres/adapter.go:94-109` (same chain: mark closed, cancel trackers, pool `CloseAll`).

Differs only in: pool field name, one extra clickhouse abort path.

Shape: `A/tracker.go` (new): `type QueryTracker` holding the op-id → cancel map with
`TrackerFor(opID string) TrackQuery` and `CancelAll()`; adapters embed it. `Disconnect` bodies
collapse to `a.tracker.CancelAll(); a.pool.CloseAll(ctx)` once T2-2 lands.

### T2-4 Row-op mutate loop: redis, mongo, s3, kafka, sqs

Instances: `mutateDB` `A/redis/mutate.go:167-211`, `mutateDB` `A/mongo/mutate.go:171-218`,
`mutate` `A/s3/mutate.go:216-258`, `produce` `A/kafka/produce.go:91-140`, `mutateQueue`
`A/sqs/mutate.go:86-150`. Same chain in all five: `readOnly` guard, iterate `plan.Ops`, per-op
switch on `op.Kind`, accumulate `Affected`, wrap per-op error with op index, build
`model.MutationResult`.

Also within this cluster:

- `parseProduceHeaders` `A/kafka/produce.go:23-44` == `parseHeaders` `A/sqs/mutate.go:23-44`.
- `preview` `A/kafka/produce.go:62-72` == `A/sqs/mutate.go:70-80` (differ in noun only).
- `valueFrom` `A/redis/mutate.go:37-43` == `A/s3/mutate.go:42-48`.

Differs only in: the per-op body (engine call), and the op-kind set each engine supports.

Shape: `A/rowops.go` (new): `RunRowOps(ctx, plan model.MutationPlan, readOnly bool, apply
func(ctx, i int, op model.RowOp) (affected int64, err error)) (model.MutationResult, error)` owning
guard, loop, error wrapping, result assembly. `ParseHeaderJSON(raw *string) (map[string]string,
error)` and `ValueFrom(values model.RowValues, label string) (string, error)` in the same file;
`PreviewProduce(plan, target string)` for kafka/sqs. Five adapters' mutate functions become the
`apply` closure only.

### T2-5 testsupport `Start<X>`/`Stop<X>` and mysql/mariadb start+seed

Instances (`A/testsupport/`): `StartClickhouse` `clickhouse.go:43-53`, `StartKafka`
`kafka.go:52-62`, `StartKafkaSasl` `kafka_sasl.go:64-74`, `StartMariadb` `mariadb.go:40-50`,
`StartMongo` `mongo.go:49-59`, `StartMysql` `mysql.go:39-49`, `StartPostgres`
`postgres.go:79-89`, `StartRedis` `redis.go:67-77`, `StartS3` `s3.go:67-77`, `StartSqs`
`sqs.go:41-51` — ten identical bodies (`t.Helper()`, `fixture.get(startX)`, `t.Fatalf` on error)
plus ten `Stop<X>` one-liners over `fixture.stop`. `startMysql` `mysql.go:57-107` vs
`startMariadb` `mariadb.go:58-109` and `seedMysqlExtras` `mysql.go:133+` vs `seedMariadbExtras`
`mariadb.go:132+`: same container-run/wait/seed chain, differ in image and DSN builder
(`mysqlfamily_seed.go` already shares the seed SQL runner; the surrounding chain is not shared).

Shape: `fixture.go`: `func (f *fixture[T]) start(t *testing.T, start func() (*T, error)) *T` —
each `Start<X>` becomes `return xFixture.start(t, startX)`; keep the exported names (tests call
them). `mysqlfamily.go` (new): `startMysqlFamily(spec mysqlFamilySpec) (*MysqlFamilyFixture,
error)` with `spec` carrying image, env, DSN builder and extras seed; `MysqlFixture`/`MariaFixture`
become aliases or thin wrappers over one type.

### T2-6 `mcpinstall` (Studio) vs `gitvsix` (Space): tool exec and install

Instances: `Studio/internal/mcpinstall/exec.go` vs `Space/internal/gitvsix/exec.go` — 7
comment-blind differing lines total: `realRun` 71-99 / 95-130, `firstLineBounded` 44-53 / 51-60,
`Error` 37-42 / 44-49. `install.go`: `isExecutable` 97-103 / 150-156, `detailFor` 136-145 /
191-200, `locateClaude` 107-121 vs `locateCode` 162-176 (same PATH/candidate walk, different
binary name). `isExecutable` also at `Space/internal/ghclient/discovery.go:23-29` and
`Space/internal/gitclient/discovery.go:55-61`.

Differs only in: binary name, candidate path list, error-type name.

Shape: repo-root `internal/toolexec` (new; same pattern as P100's hoists): `Run(ctx, RunSpec)
(Result, error)` (the bounded-output runner), `FirstLineBounded`, `IsExecutable(path) bool`,
`Locate(name string, candidates []string) (string, error)`, and one `ExecError` type. The four
packages import it; `mcpinstall`/`gitvsix` keep only their install logic.

### T2-7 `bridge/terminal.go` Studio vs Space, plus two output coalescers

Instances (Studio `internal/bridge/terminal.go` / Space `internal/bridge/terminal.go`, 45
comment-blind differing lines): `DefaultCwd` 90-96 / 41-47, `validLaunchKind` 123-130 / 68-75
(also `Space/internal/bridge/gitreposettings.go:88-95`), `Open` 168-237 / 104-153 (S3 0.95),
`Write` 241-253 / 156-168, `Resize` 257-268 / 171-182, `Close` 271-277 / 185-191, `push` 318-332
/ 225-239, `onTimer` 334-341 / 241-248, `finish` 345-353 / 250-258, `flushLocked` 355-368 /
260-273. Same coalescer (mutex, pending buffer, timer, `done` flag, flush to emitter) again in
`Studio/internal/bridge/grpc.go:392-444` (`grpcCoalescer`) and
`Space/internal/bridge/codeworkspace.go:478-532` (`searchCoalescer`).

Differs only in: Studio's extra launch kinds and repo-cwd lookup, the emitted event name, the
element type of the coalesced batch.

Shape: repo-root `internal/appevent/coalescer.go` (new): `type Coalescer[T any] struct` with
`NewCoalescer[T](interval time.Duration, flush func(batch []T, done bool))`, `Push(T)`,
`Finish()`; the four coalescers become instances. Terminal service: generic half (`Write`,
`Resize`, `Close`, output pump, `validLaunchKind` over a caller-supplied kind set) moves to
repo-root `internal/terminal` as `terminal.Service` with an `Emitter` interface; each app's bound
`TerminalService` stays (P103 §2.3: bound service types drive binding generation) but delegates.

### T2-8 Ordered emitter + FIFO request queue: `dbmcp/approval.go` vs `gitsock/pairing.go`

Instances: `Studio/internal/dbmcp/approval.go` vs `Space/internal/gitsock/pairing.go`:
`Pending` 141-145 / 105-109, `snapshotLocked` 147-153 / 111-117, `nextSeqLocked` 157-160 /
121-124, `emitOrdered` 164-175 / 128-139, `removeLocked` 276-284 / 306-314, `Request` 180-220 /
156-197 (S3 0.71: enqueue, emit ordered snapshot, wait on decision channel or ctx).

Differs only in: request payload type, decision type, how the wait ends (ctx vs callback).

Shape: repo-root `internal/notify/ordered.go` (new, next to the existing `notify` package):
`type OrderedEmitter[T any]` with `Emit(payload T)` guaranteeing sequence ordering under the
broker's lock, and `type PendingQueue[R any]` with `Add`, `Remove(id)`, `Snapshot()`. Both
brokers keep their own `Request` but lose the queue/sequence internals.

### T2-9 Local socket bootstrap: `bridge/agenthooks.go`, `gitaskpass/broker.go`, `gitsock/server.go`

Instances: `Studio/internal/bridge/agenthooks.go:74-160` (`New`-equivalent) vs
`Space/internal/gitaskpass/broker.go:70-132` (`New`): mkdtemp under app home, socket file named
`s`, chmod 0700/0600, random hex token, listen, spawn accept loop. `randHex`
`agenthooks.go:162-168` == `broker.go:153-159`. `acceptLoop` `broker.go:219-232` vs
`Space/internal/gitsock/server.go:152-167` (same accept/temporary-error/backoff loop).

Differs only in: what each connection handler does; token length.

Shape: repo-root `internal/localsock` (new): `Listen(opts Options) (*Listener, error)` returning
dir, socket path, token; `(*Listener).Serve(handle func(net.Conn))` owning the accept loop;
`RandHex(n int) (string, error)`. Three call sites keep their handlers only.

### T2-10 Cross-app storage layer

Instances (Studio `internal/storage/...` / Space `internal/storage/...`):

- `db.go` `OpenAt` 37-59 / 30-47.
- `migrate.go` 15-30 / 14-26 (whole file), plus `Space/internal/gitreview/migrate.go` (see
  T1-8).
- `migrations/embed.go` `All` (three copies: both apps plus `Space/internal/gitreview`).
- `repos/windows.go` `Exists` 57-67 / 56-66, `Create` 70-89 / 69-88, `EnsureExists` 106-136 /
  94-124, `SetBounds` 170-183 / 127-140.
- `repos/layout.go` `scanAll` 27-52 / 23-45, `GetAll` 54-59 / 47-52.
- `repos/repos.go` `Close` 85-92 / 58-65.
- `model/window.go` `Validate` 53-61 / 30-38.
- `model/tabs.go` `IsJSONObject` 65-72 / 45-52.

Differs only in: the `//go:embed` directory (must stay per package, P103 §2.3), Studio's extra
tables in the same repos.

Shape: repo-root `internal/appstorage` (new): `OpenAt(path string, migrations fs.FS) (*sql.DB,
error)` (folds `migrate.go`), `type WindowRepo` and `type LayoutRepo` over `*sql.DB` with the
methods above, `RepoSet.Close`, `ValidateWindowBounds`, `IsJSONObject`. Each app's `storage`
keeps its `//go:embed` and composes the shared repos with its own extra ones. `embed.go` `All`
stays per package (declined per P103 §2.3) — only the callers of it dedupe.

### T2-11 `gitsession` op slots

Instances: `Space/internal/gitsession/remote.go:23-73` (`remoteOpSlot`: `claim`, `setKillable`,
`release`, `tryCancel`, `forceCancel`), `stack.go:520-559` (`restackSlot`), `worktree.go:396-435`
(`prepareOpSlot`) — the last two are identical; `remoteOpSlot` adds `kind` and `killable`.

Shape: `Space/internal/gitsession/opslot.go` (new): one `opSlot` struct with the superset
(`kind`, `killable`); `restackSlot`/`prepareOpSlot` become `opSlot` fields. Callers: the three
files' own methods only.

### T2-12 `gitrpc` handler template

Instances (`Space/internal/gitrpc/`): `handleRefsList` `refs.go:15-32`, `handleStatusGet`
34-51, `handlePreflightCheckout` 53-70, `handlePreflightRevert` 72-89, `handleStackList`
`stack.go:19-36`, `handlePreflightRestack` 38-55, `handleStackRestack` 60-77, `handleCommitDetail`
`detail.go:69-89`, `handleWorkingDetail` 219-236, `handleBlameLine` 195-214. Each: decode params
into a typed struct, `r.sessions.Get(conn, repo)` with the same error mapping, call one session
method, encode result.

Differs only in: param type, session method, result type.

Shape: `Space/internal/gitrpc/handle.go` (new): `func handleRepoCall[P, R any](r *Router, ctx,
c *gitsession.Conn, params json.RawMessage, call func(ctx, *gitsession.Session, P) (R, error))
(any, error)`; each handler becomes a one-line registration. `handleSearchRun`,
`handleGraphStream`, `handleFileRead` keep their bodies (streaming/extra steps).

### T2-13 Embedded-service lifecycle: `bridge/agenthooks.go` vs `bridge/dbmcp.go`

Instances (`Studio/internal/bridge/`): `statusLocked`/`Status` `agenthooks.go:36-48` /
`dbmcp.go:64-87`, `startLocked` 52 / 113, `stopLocked` 105-113 / 163-172, `startIfEnabled`
122-136 / 179-193, `stop` 140-144 / 197-201, `SetEnabled` 160-182 / 218-240. Same chain:
settings-gated enable, mutex, start-once, status snapshot, stop-and-clear, emit status event.

Differs only in: the started thing (hooks server vs MCP server), status payload fields.

Shape: `Studio/internal/bridge/embedded.go` (new): `type embeddedService[S any] struct` with
`start func() (S, error)`, `stop func(S)`, `status func(S) Status`; `SetEnabled`, `Status`,
`startIfEnabled`, `stop` once. The two bound services stay (binding generation) and embed it.

### T2-14 gRPC history vs HTTP response history

Instances: `Studio/internal/storage/repos/grpc_history.go` vs `response_history.go`: `List`
242-267 / 253-278, `Adopt` 324-337 / 338-351, `SweepOrphans` 341-349 / 357-365.
`Studio/internal/bridge/grpchistory.go` vs `responsehistory.go`: `Adopt` 71-80 / 83-92,
`Delete` 43-51 / 56-64.

Differs only in: table name, the row struct.

Shape: `Studio/internal/storage/repos/history.go` (new): `type historyTable[T any] struct{ table
string; scan func(*sql.Rows) (T, error) }` with `List`, `Adopt`, `SweepOrphans`,
`Delete`; both repos become instances. Bridge `Adopt`/`Delete` collapse to pass-through once
the repo methods share one signature.

### T2-15 Window open/reopen chain in both `main.go`

Instances: `Studio/main.go` vs `Space/main.go`: `open` 629-658 / 345-367, `openNew` 662-685 /
371-394, `reopen` 690-712 / 398-420, `toShellWindowRecord` 601-608 / 332-339 (S1 exact).

Differs only in: window options struct literal, the app's `WindowStore` type.

Shape: repo-root `internal/shell/openwindow.go` (new, `shell` already exists post-P103):
`OpenWindow(app, store WindowStore, rec WindowRecord, opts WindowOptions)`, `OpenNewWindow`,
`ReopenWindows`, `ToWindowRecord`. Both `main.go` call them with their own options.

### T2-16 Paged view stores: documents, grid, keyvalue, stream

Instances (`Studio/frontend/src/views/`):

- Navigation: `documents/state.ts` vs `grid/state.ts` — `goNext` 170-181 / 269-280, `goPrev`
  183-194 / 282-293, `goFirst` 199-203 / 261-265, `goLast` 207-216 / 297-306, `goToPage`
  218-225 / 308-315, `resetTokens` 233-237 / 319-323, `setProjection` 257-262 / 332-337,
  `setSort` 264-269 / 354-359.
- `runCount`: `documents/state.ts:133-157`, `grid/state.ts:232-255`,
  `shared/keyvalue/state.ts:151-174`, `stream/state.ts:175-204`.
- `defaultRuntime`: `grpcrequest/state.ts:103-115`, `console/state.ts:83-97`,
  `browse/state.ts:57-72`, `documents/state.ts:40-55`, `grid/state.ts:54-71`,
  `shared/keyvalue/state.ts:37-51`, `stream/state.ts:53-69`.
- `pageStoreEntries`: five copies, one per store above (documents, grid, keyvalue, stream,
  browse).
- Row accessors: `documentRow` `console/resultPages.ts:61-73` == `documents/page.ts:29-41` ==
  `shared/document/rows.ts:96-109`; `keyValueRow` `resultPages.ts:76-83` ==
  `shared/keyvalue/page.ts:31-42`; `cell` `resultPages.ts:43-55` == `grid/page.ts:30-42`.
- Search: `documents/search.ts` (53 lines) vs `grid/search.ts` (50; 21 differing lines) vs
  `shared/keyvalue/search.ts` (51; 26 differing).

Differs only in: page/row type, the bridge method each `runCount`/`load` calls, per-view extra
state (grid's column widths, stream's offsets).

Shape: `Studio/frontend/src/views/shared/page/createPagedViewStore.ts` (new): a Pinia store
factory `createPagedViewStore<P, R>(id, { load, count, ... })` returning the tokens, page
navigation, `runCount`, `setProjection`, `setSort`, `resetTokens`, `defaultRuntime` and
`pageStoreEntries` once; each view store wraps it and adds its own fields. Row accessors move to
`views/shared/page/rows.ts` (`documentRow`, `keyValueRow`, `cell`); `resultPages.ts` and the
three `page.ts` files import them. `views/shared/page/usePagedSearch.ts` holds the shared search
composable; the three `search.ts` keep only the per-view matcher.

### T2-17 SlickGrid hosts: `ConsoleSlickGrid.vue` vs `SlickGridHost.vue`

Instances (`Studio/frontend/src/views/console/ConsoleSlickGrid.vue` /
`views/grid/SlickGridHost.vue`): `gutterFormatter` 113-121 / 160-169, `tooltipAttrs` 147-156 /
445-454, `buildColumns` 174-250 / 471-570, `recordOffsetSample` 279-285 / 807-813, `velocity`
287-299 / 815-833, `onViewportScroll` 301-306 / 841-856, `onGridRendered` 343-359 / 1075-1098,
`refreshSelEdges` 370-389 / 934-956, `computeCellFillHash` 402-422 / 954-979,
`onCellRangeSelecting` 427-433 / 1001-1007, `toPageRowSelection` 451-464 / 1455-1472,
`onSelectedRangesChanged` 468-475 / 1552-1562, `onColumnsResized` 483-491 / 1437-1449, `onCopy`
575-593 / 1839-1869, `rowsForColumnOps` 558-562 and `visibleRowsInSpan` 564-570 vs
`grid/slick/rowValues.ts:76-81` / 90-101.

Differs only in: `SlickGridHost` has editing, column menus and keyset paging on top; the
console host is read-only.

Shape: `Studio/frontend/src/views/shared/slick/useSlickGridHost.ts` (new composable) returning
the column builder, gutter/tooltip formatters, scroll velocity sampler, selection-edge refresh,
fill-hash, range selection handlers, copy handler and column-resize persistence; both `.vue`
files call it and keep only their own additions. `rowsForColumnOps`/`visibleRowsInSpan` in
`ConsoleSlickGrid.vue` are deleted for the `grid/slick/rowValues.ts` exports (move that file to
`views/shared/slick/`).

### T2-18 `MetadataTable.vue` vs `FieldRowsTable.vue`

Instances (`Studio/frontend/src/views/grpcrequest/MetadataTable.vue` /
`views/httprequest/FieldRowsTable.vue`): `onContainerKeydown` 149-205 / 193-260,
`headerValueToken` 59-64 / 116-121, `rowValueCandidates` 66-72 / 123-131, `updateField` 98-103 /
133-138, `toggleEnabled` 105-110 / 140-145, `removeRow` 112-116 / 147-152, `textInputsIn`
141-147 / 185-191.

Differs only in: `FieldRowsTable` carries a `kind` prop (headers/params/form) and a description
column; `MetadataTable` is the headers case without description.

Shape: delete `MetadataTable.vue`; `GrpcRequestView.vue` renders `FieldRowsTable` with
`kind="headers"` (add a `hideDescription` prop if the gRPC surface must stay narrower). Move
`FieldRowsTable.vue` to `views/shared/fields/`.

### T2-19 Text prompt (name/rename) flow

Instances: `Space/frontend/src/repo/GitPanel.vue:129-146` (`promptText`, `submitPrompt`,
`cancelPrompt` + template scrim), `Studio/frontend/src/views/console/FilterHistoryMenu.vue:42-65`
and `ConsoleSavedMenu.vue:27-55` (same three functions and scrim); `rename` 117-122 / 74-79 and
`saveCurrent` 129-141 / 85-98 in the two console menus.

Shape: `packages/workbench/src/prompt/useTextPrompt.ts` (`open(initial, onSubmit)`, `submit`,
`cancel`, `value`, `visible`) plus `TextPromptDialog.vue` built on shadcn-vue `Dialog` +
`Input` (replaces the hand-rolled scrim, per P104's no-hand-rolled-primitive rule). Three call
sites keep their `onSubmit` only.

### T2-20 Drag reorder handlers

Instances: `Studio/frontend/src/api/EnvironmentsView.vue:133-165`,
`api/VariableSetView.vue:325-359`, `views/grid/ColumnsMenu.vue:71-87`,
`packages/workbench/src/components/TabStrip.vue:169-175` (same dragstart/dragover/drop index
bookkeeping and array splice).

Shape: `packages/workbench/src/util/useDragReorder.ts`: `useDragReorder(list: Ref<T[]>, onMove?)`
returning `onDragStart(i)`, `onDragOver(i)`, `onDrop(i)`, `dragIndex`. `@vueuse/core` has no
reorder composable; `@vueuse/integrations`' `useSortable` needs `sortablejs` (not installed, and
these four sites use native drag events, not a sortable list widget) — so hand-written, once.

### T2-21 Terminal view mount: `TerminalView.vue` vs `RepoTerminalView.vue`

Instances: `Studio/frontend/src/views/terminal/TerminalView.vue:53-90` ==
`Space/frontend/src/views/repo/RepoTerminalView.vue:38-75` (xterm create, fit addon, links addon,
renderer loader, resize observer, output subscription, dispose) — 38 comment-blind differing
lines of 130 / 92 total, all outside the mount block.

Shape: `packages/workbench/src/terminal/useTerminalMount.ts` composable next to the already-shared
`terminalRenderer.ts`/`terminalRendererLoader.ts` (or hoist the whole view if the templates also
match — verify at implementation). Both views keep their tab-runtime wiring.

### T2-22 UI test support: `mockRuntime.ts` and fixture helpers

Instances: `Space/tests/ui/support/mockRuntime.ts` vs `Studio/tests/ui/support/mockRuntime.ts`:
`canonical` 123-135 / 411-429, `runtimeErrorBody` 137-149 / 431-446 (also
`Studio/tests/e2e-real/support/passthrough.ts:43-53`), `serveWailsRuntimeJs` 163-170 / 460-467,
`installControlMocks` 179-284 / 478-653, `findSnap` 245-253 / 579-587, `emitWailsEvent` 293-304
/ 663-674. Fixtures: `connectAndExpandControl` `Studio/tests/ui/support/mariadbFixture.ts:332-357`
== `mongoFixture.ts:150-175` (+ `postgresFixture.ts:225-255`), `orderItemsPage` 314-329 /
98-113, `orderItemsFixture` 362-404 / 280-322, `*ConnectionSummary` in the three fixture files.

Shape: `packages/workbench/src/testing/ui/mockRuntime.ts` (next to the `server.ts` P103 Part 1
already placed there) takes the runtime core (`canonical`, `runtimeErrorBody`,
`serveWailsRuntimeJs`, `installControlMocks` parameterized by the app's binding table,
`findSnap`, `emitWailsEvent`); each app's `mockRuntime.ts` keeps its service table.
`Studio/tests/ui/support/engineFixture.ts` (new): `connectAndExpandControl`, `orderItemsPage`,
`orderItemsFixture(engine)`, `connectionSummary(engine)`; the three fixtures import it.

### T2-23 Blame resolver: `blameLine.ts` vs `blameWidget.ts`

Instances: `Space/frontend/src/views/repo/blameLine.ts` vs `apps/kira-space-vscode/src/blameWidget.ts`:
`cancelPending` 151-155 / 84-91, same debounce-then-request-then-supersede flow with an abort
controller and a "still current" check; hosts differ (Monaco vs VS Code decorations). Medium
confidence: the flow matches, the surrounding host API does not.

Shape: `packages/git-core/src/blame/blameResolver.ts`: `createBlameResolver(request)` with
`resolve(line)`, `cancel()`, debounce + abort + supersede once; both hosts keep rendering only.
Implement after the higher-confidence entries; drop if the extracted core is under ~20 lines.

### T2-24 VS Code webview providers and virtual URIs

Instances (`apps/kira-space-vscode/src/`): `resolveWebviewView` `panelView.ts:57-81` vs
`reviewView.ts:58-81` (options, html, message pump, dispose). `resolveVirtualUri`
`diffToolbar.ts:50-59` == `reviewMarking.ts:92-101` (its doc comment says "reused here rather
than re-derived", yet the body is a copy, not an import); `reviewDocumentUri` `reviewMarking.ts:103-111` ==
`reviewComments.ts:45-53`; `reviewAnchorFor` `reviewComments.ts:33-40` shares the prefix.

Shape: `src/webviewBase.ts`: `createWebviewProvider(spec)` used by both; `src/virtualUri.ts`:
`resolveVirtualUri`, `reviewDocumentUri`, `reviewAnchorFor` once, three files import.

### T2-25 Per-repo state map: Space `stateFor` ×3

Instances: `Space/frontend/src/repo/state/search.ts:101-108`, `fileTree.ts:157-164`,
`worktrees.ts:29-41` — same "get-or-create per repo key, reactive map" pattern in three Pinia
stores.

Shape: `Space/frontend/src/repo/state/perRepo.ts`: `createPerRepoState<T>(init: () => T)`
returning `{ stateFor(repoId), drop(repoId), all }`; three stores use it. One store, one concern
still holds — the helper is not a store.

## 2. Tier 1 — helpers and narrow functions

### T1-1 `abbreviateUnits`/`abbreviateCount`/`trimTrailingZero` ×6

`A/postgres/catalog.go:474-514`, `A/mysqlfamily/catalog.go:432-473`, `A/sqlite/catalog.go:696-737`,
`A/clickhouse/catalog.go:422-463`, `A/redis/catalog.go:27-68`, `A/kafka/catalog.go:18-57` (kafka
takes `int64`, others `int`). Comments claim "deliberately duplicated per package rather than
shared" / "No shared Go home exists for it yet" — stale, the shared base package `A/` exists.
Shape: `A/format.go`: `AbbreviateCount(n int64) string`; delete six copies and both comments.

### T1-2 `itoaPositive` ×5, `itoa` ×2

`A/clickhouse/client.go:188-200`, `A/postgres/read.go:248-260`, `A/sqlite/adapter.go:107-119`,
`A/testsupport/sqlite.go:102-114` (exact), `A/mongo/adapter.go:151-163`; `itoa`
`A/sqlmutate.go:51-73`, `Studio/internal/enginecache/lru.go:105-125`. Shape: delete all seven,
call `strconv.Itoa`/`strconv.FormatInt`.

### T1-3 `joinSemicolons` ×4, `joinComma` ×3, inline join loops ×4

`A/clickhouse/console.go:119-128`, `A/mysqlfamily/mutate.go:134-143`, `A/postgres/mutate.go:142-151`,
`A/sqlite/console.go:115-124`; `joinComma` `A/mysqlfamily/definition.go:133-142`,
`Studio/internal/enginecache/pages.go:47-56`, `Studio/internal/queryplan/mysql.go:175-184`; loops
`A/redis/mutate.go:180-186`, `A/mongo/mutate.go:187-193`, `A/kafka/produce.go:101-107`,
`A/sqs/mutate.go:95-101`. Shape: `strings.Join(parts, "; ")` / `", "` at each site (loops fold
into T2-4's `RunRowOps`).

### T1-4 `quoteIdent` ×4

Listed under T2-1; consolidate there (`adapters.QuoteIdentDouble`/`QuoteIdentBacktick`).

### T1-5 `clampInt` ×2

`Studio/internal/httpclient/options.go:41-49` == `internal/shell/window.go:137-145`. Shape:
`min(max(v, lo), hi)` inline (Go 1.27 builtins); delete both.

### T1-6 Settings leaf helpers duplicating `internal/appsettings`

`leaf`/`leafValid` `Studio/internal/storage/repos/settings.go:246-256` / 260-273 and
`Space/internal/storage/repos/helpers.go:43-53` / 57-70 duplicate `internal/appsettings/repo.go`
`Leaf` 103-113 / `LeafValid` 117-130; `upsertSettingsLeaf` `Studio/.../settings.go:227-240`
duplicates `appsettings.UpsertLeaf` 12-25 (Space already calls `UpsertLeaf`); `ValidLogLevel`
`Studio/internal/storage/model/settings.go:177-184` duplicates `appsettings.ValidLogLevel` 117-124.
Shape: delete the copies, import `appsettings` (P103 Part 4 left these behind).

### T1-7 `requireOneRow` ×2

`Studio/internal/storage/repos/collections.go:564-573` == `Space/internal/storage/repos/helpers.go:28-37`.
Shape: `internal/sqlitex.RequireOneRow(res sql.Result, what string) error`.

### T1-8 `gitreview/db.go` re-implements `sqlitex`

`Space/internal/gitreview/db.go` `buildDSN` 26-35 == `internal/sqlitex/sqlitex.go:45-54`
`BuildDSN`; `ensureOpen` 41-86 duplicates `sqlitex.Open` 64-82; `gitreview/migrate.go` copies
`storage/migrate.go`'s runner. Its comments ("Deliberately duplicated rather than exported and
reused"; `migrate.go:10-12`: importing `internal/storage` "would make a studio-module package a
compile-time dependency") predate P100: `internal/sqlitex` is repo-root, and Space's own
`internal/storage` is in the same module now. Shape: call `sqlitex.BuildDSN`/`sqlitex.Open` and
T2-10's `appstorage.OpenAt`; delete the local copies and both comments.

### T1-9 `randHex` ×2

Listed under T2-9; `localsock.RandHex`.

### T1-10 `wrapErr` ×2

`Studio/internal/connections/service.go:192-201` vs `Studio/internal/tree/service.go:77-85` (same
`ipcerr` code mapping). `internal/ipcerr` has `New`/`Internal`/`BadRequest`/… constructors but
no wrap. Shape: `ipcerr.Wrap(err error, code, message string) *Error` in `internal/ipcerr`; both
services call it.

### T1-11 `hasScheme` ×2

`Studio/internal/httpclient/client.go:112-124` vs `Studio/internal/postman/url.go:53-67`. Shape:
`Studio/internal/httpclient.HasScheme` exported; `postman` imports it.

### T1-12 `bsonDGet` ×2

`A/mongo/definition.go:34-41` vs `A/mongo/read.go:330-337`. Shape: keep one, package-level.

### T1-13 `paramDescriptionsEqual` ×2

`Studio/internal/postman/write.go:241-251` vs `Studio/internal/logsession/session.go:318-328`.
Shape: `maps.Equal` at both sites; delete both.

### T1-14 `valueFrom` ×2

Listed under T2-4; `adapters.ValueFrom`.

### T1-15 `floatingPosition.ts` ×2

`packages/kira-ui/src/util/floatingPosition.ts:47-77`, 82-95 vs
`packages/workbench/src/util/floatingPosition.ts:54-93`, 98-111 — identical except the CSS
variable prefix (`--kui-float-max-*` vs `--kira-float-max-*`). `kira-ui/index.ts` already
exports `computeFloatPosition`/`pointReference`/`autoUpdate`. Shape: delete the workbench copy;
workbench imports `@kira/kira-ui` and passes the prefix as an option (`maxVarPrefix`).

### T1-16 `onSave`/`onSaveAs` ×2

`Studio/frontend/src/views/httprequest/HttpRequestView.vue:198-210` / 212-219 vs
`views/grpcrequest/GrpcRequestView.vue:149-161` / 163-170. Shape:
`views/shared/request/useRequestTabSave.ts` composable taking the store's `save`/`saveAs` and
tab runtime.

### T1-17 `CollectionsPanel.vue` panel search

`Studio/frontend/src/api/CollectionsPanel.vue:56-86` re-implements
`packages/workbench/src/util/panelSearch.ts` `usePanelHeaderSearch` 7-49. Shape: call the
composable; delete the inline copy.

### T1-18 `base64ToBytes` ×2

`Studio/frontend/src/views/grid/celleditor/binary.ts:30-39` vs
`packages/workbench/src/state/createTerminalsStore.ts:41-46`. Shape:
`packages/shared/domain/base64.ts` `base64ToBytes` (`packages/shared` has no `src/`; `domain/`
is its TS root); both import.

### T1-19 `copyOrReportError` ×2

`Studio/frontend/src/views/console/resultMenu.ts:197-203` vs `views/documents/menu.ts:21-28`.
Shape: `packages/workbench/src/util/clipboard.ts` (exists post-P103) gains `copyOrReportError`;
VueUse `useClipboard` underneath.

### T1-20 Busy-flag async handlers ×6

`Studio/frontend/src/workbench/settings/ConnectedEditorsPane.vue:33-40`,
`DatabaseMcpPane.vue:37-44`, 47-54, 57-64, `ClaudeCodePane.vue:22-29`, 34-41 — same
`if (busy) return; busy = true; try { await x } finally { busy = false }`. Shape:
`packages/workbench/src/util/useBusyAction.ts` returning `{ busy, run }`; or VueUse
`useAsyncState` where its `isLoading` fits (prefer VueUse; verify the re-entrancy guard holds).

### T1-21 `retryBootstrap` ×2

`packages/git-ui/src/App.vue:1126-1131` == `packages/git-ui/src/views/ReviewView.vue:388-393`.
Shape: export from the git-ui bootstrap store; `ReviewView` calls it.

### T1-22 `onDocumentPointerDown` ×5

`packages/git-ui/src/App.vue:1455-1464`, `components/BaseSelector.vue:96-100`,
`components/BranchPicker.vue:541-545`, `components/SearchBox.vue:232-236`,
`packages/kira-ui/src/components/KuiContextMenu.vue:51` — click-outside-to-close. Shape: VueUse
`onClickOutside`; add `@vueuse/core` to `packages/git-ui` and `packages/kira-ui` dependencies
(neither lists it today; root already carries it).

### T1-23 `#requestDetail` abort + still-current ×2

`packages/git-ui/src/state/detail.ts:108-132` vs `state/working.ts:75-92`. Shape:
`packages/git-ui/src/state/latestRequest.ts` `createLatestRequest<T>()` with
`run(fn)` that aborts the previous and drops stale results; both stores use it.

### T1-24 `worktreeLabel` ×2

`packages/git-ui/src/components/pickerModel.ts:94-98` ==
`Space/frontend/src/repo/state/worktrees.ts:201-205`. git-ui's `exports` map only exposes `.`
and `./icons`, so Space cannot import from `components/`. Shape: move to
`packages/git-core/src/worktree/label.ts`; both import `@kira/git-core`.

### T1-25 `growUint32` ×2

`packages/git-core/src/graph/edges.ts:22-31` vs `packages/git-core/src/store/intern.ts:88-97`.
Shape: `packages/git-core/src/util/typed.ts` `growUint32`.

### T1-26 vscode `resolveVirtualUri`/`reviewDocumentUri`/`reviewAnchorFor`

Listed under T2-24; `src/virtualUri.ts`.

### T1-27 `findChangeInDetail` ×2

`Space/frontend/src/repo/git/hostHandlers.ts:122-138` vs
`apps/kira-space-vscode/src/proxyHandlers.ts:176-188`. Shape: `packages/git-core/src/detail/find.ts`
`findChangeInDetail(detail, path)`.

### T1-28 `explicitContentType` ×2

`packages/api-core/src/curl/parse.ts:107-113` == `packages/api-core/src/raw/parse.ts:43-49`.
Shape: `packages/api-core/src/http/headers.ts` `explicitContentType`.

## 3. Declines and out of scope

Each with the requirement that keeps it separate.

- `typeClassFor` ×4 (postgres/mysqlfamily/sqlite/clickhouse catalog): same name, engine-specific
  type tables; only the `switch` skeleton repeats.
- `resolveFields` redis vs datagrip: S2 name collision, bodies unrelated.
- Bound Wails bridge services cross-app (`TerminalService`, `SettingsService`, …): bound struct
  types drive binding generation and `@bindings/*` paths (P103 §2.3); only their internals dedupe
  (T2-7, T2-13).
- Bridge `GetRequest`/`Delete` thin wrappers over repos: one-line pass-throughs; a helper would
  be longer than the duplication.
- Simple CRUD repos (`connections.go`, `environments.go`, …): per-table SQL, no shared logic
  beyond `database/sql` calls.
- `A/sqlite/client.go` `buildDSN` 91-103 vs `sqlitex.BuildDSN`: different pragmas and
  read-only mode for user databases; genuinely different.
- `storage/migrations/embed.go` `All` ×3: `//go:embed` resolves inside its own package (P103
  §2.3).
- `codeLanguageForContentType` (api-core) vs its Studio sibling: deliberately narrower (P-series
  D10 decision recorded in `api-core`), quoted there.
- git-ui `onOpenFile` ×3, `blockerText` ×2, `runRestack`: different shapes/enums/delegation.
- vscode `asExplicitTarget` ×2: different target unions.
- Generated FlatBuffers: `Studio/internal/page/wire`, `Space/internal/gitwire`,
  `packages/shared/protocol/wire`, `packages/git-ipc/src/generated`.
- Cross-language mirrors: `mask.go`/`mask.ts`, `page/encode.go`/`encodeFrame.ts`,
  `internal/queryplan/*.go` vs `views/console/planParsers/*.ts` (both live; `plan.ts` consumes
  both). `queryplan/mysql.go` vs `mariadb.go` and `planParsers/mysql.ts` vs `mariadb.ts` differ in
  real column sets, not skeleton only.

## 4. Implementation order

Sequential, one Sonnet subagent, commit per finding (`refactor:`), fast checks per commit, full
suites once at the end (`test:go`, `test:unit`, `test:ui:studio`, `test:ui:space`, adapter
conformance suites for T2-1 through T2-5).

1. Go base helpers first, smallest blast radius: T1-1, T1-2, T1-3, T1-5, T1-6, T1-7, T1-8,
   T1-10, T1-11, T1-12, T1-13.
2. Adapter tier: T2-1 (with T1-4), T2-2, T2-3, T2-4 (with T1-14), T2-5.
3. Repo-root hoists: T2-6, T2-7, T2-8, T2-9 (with T1-9), T2-10, T2-15.
4. Space Go: T2-11, T2-12. Studio Go: T2-13, T2-14.
5. Frontend: T1-15, T1-17, T1-18, T1-19, T1-20, T2-16, T2-17, T2-18, T2-19, T2-20, T2-21, T1-16.
6. Git packages and vscode: T1-21 through T1-28, T2-23, T2-24, T2-25.
7. Test support: T2-22.

Closing check: re-run the S1 exact sweep (`sweep.ts` method in §0) and require every remaining
exact group to be one §3 decline by name.
