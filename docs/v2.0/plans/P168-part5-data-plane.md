# P168 Part 5: review plan, Studio engine data plane and page wire protocol

Chunk A4, Stream A position 4 (pre-plan `P168-prep-plan.md` §5.4). One Opus reviewer runs this
plan and reports findings. It fixes nothing. One Sonnet fixer follows (§8).
Tree surveyed: `de8ec4c` (`p168-stream-a`, rebased onto `v2.0`; Parts 2-4 fixed, Part 4 findings
file dropped). `v2.0` tip is the same commit.

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SF` = `apps/kira-studio/frontend/src`,
`ST` = `apps/kira-studio/tests`, `SP` = `packages/shared/protocol`, `SD` = `packages/shared/domain`.
Line numbers are as of `de8ec4c`; re-read before citing.

SPEC row and orchestrator agree on the name `P168-part5-data-plane.md`.

## 0. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Load it with `ToolSearch "codegraph"`, then call it
  with `projectPath=/home/user/kira-studio-streamA` before any Read/Grep on a symbol, call-path or
  blast-radius question. The orchestrator greps the run's tool log for real calls. Index: run
  `sh scripts/codegraph-setup.sh` if `.codegraph/` is missing; a DB lock held by the MCP server's
  own process means its watcher keeps the index synced. Seeds per area:
  - adapterhost: `Router.Connect`/`Disconnect`/`Test`/`takeLiveAdapterForTeardown`/
    `disconnectAdapter`/`Children`/`Describe`/`Definition`/`SchemaColumns`/`KeyTypes`/
    `ClassifyStatement`/`Cancel`, `Host.RunOp`/`safeRun`/`CancelOp`/`CancelOpsForConnection`/
    `emitJSON`/`Subscribe`, `runOp` (`op.go`), `throttleRegistry`, `Dispatcher`
    `Read`/`Count`/`Preview`/`Mutate`/`Execute`/`ObjectDownload`/`Invalidate`, `AttachStream`,
    `pushCacheStats`, `HandleDataFrame`/`HandleDataFrameAsync`/`handleDataOp`, `respond`/
    `respondError`/`oversizedPagePayload`/`safeEncodeError`, `Session` `enqueue`/
    `enqueueResponse`/`enqueueLocal`/`writeLoop`/`acquireSlot`/`Close`, `encodePayload`/
    `encodeResponse`/`encodeError`/`encodeEvent`/`estimateFrameSize`, `wire.go` `Validate`s.
  - enginecache: `Cache` (`ReadPage`/`CurrentGeneration`/`StorePageIfCurrent`/
    `StoreCountIfCurrent`/`InvalidateAfterMutation`/`DropTarget`/`DropPagesOnly`/
    `DropConnection`/`Clear`/`Configure`/`OnStatsChanged`/`scheduleEmitLocked`), `PageCacheKey`,
    `ByteLru`, `countStore`, `generationTracker`.
  - page: `EncodePage`, `encodeChunk`/`createUint32Vector`, `columnScratch`
    `appendValue`/`finish`/`truncateUTF8ToBoundary`, the four builders, `StreamRow`,
    `PageByteSize`/`ChunkByteSize`.
  - tree: `Service` `Children`/`Describe`/`Definition`/`SchemaColumns`/`KeyTypes`/`Invalidate`,
    `tryCache`/`cacheAside`/`putIfSinceUnchanged`/`sinceEpoch`/`resolvePath`.
  - oplog: `Wiring` `Start`/`Stop`/`consume`/`handleOpStart`/`handleOpEnd`/`finishInFlight`/
    `prune`.
  - ipcfixture: `harness.go` (`DataRead`/`DataExecute`), `frozen.go` (`FreezeConnectionSummary`),
    `decode.go` (`DecodePage`), `write.go` (`mustMarshalNoEscape`).
  - TS: `decodeFrame`/`decodePayload`/`decodePage`/`copyPageBuffers`/`decodeChunk` (`SP/frame.ts`),
    `assertPageStructure` and the builders (`SP/page.ts`), `data-ops.ts` zod schemas, `port.ts`
    (`request`/`ready`/`rejectAllPending`/`handleMessage`), `SF/bridge/index.ts` (`control`,
    `trust`/`unwrap` uses), `apiControl.ts`, `data.ts`, `ST/support/encodeFrame.ts`.
- **CodeGraph over-links names.** `Connect`/`Disconnect`/`Read`/`Count`/`Start`/`Push`/`Finish`
  exist in every engine, in Space and in `gitstore`; `decodeFrame` also exists in
  `git-ipc/streamChannel.ts`; `tree.Items` in `bridge/collections.go` is a different `tree`. Confirm
  every cross-package claim with `git grep` of import lines (Go's `internal/` rule makes those
  authoritative).
- **Library source** where a claim turns on library behavior: `github.com/google/flatbuffers/go`
  (builder growth, `CreateVectorOfTables` used for strings in `createStringVector`), the `flatbuffers`
  npm package (`ByteBuffer` views, `__vector_as_array` aliasing), `golang.org/x/time/rate`
  (`Wait` with ctx, burst), Wails v3 `application.StreamConn` (`Send` blocking, frame cap) and
  `@wailsio/runtime` `Stream` (open/close/error order, reconnect).
- **Scratch probes** in the session scratchpad or a throwaway `_test.go`/`.spec.ts` deleted before
  the findings commit, never committed, where a claim turns on runtime behavior (Go encode then TS
  decode of a crafted page; an oversized frame; a port request racing `onclose`).
- **Checks:** `go vet ./apps/kira-studio/internal/{adapterhost,enginecache,page,tree,oplog,ipcfixture}/...`;
  `go test -race` over the same six packages; `bun test ST/unit/bridge-port.spec.ts
  ST/unit/bridge-unwrap.spec.ts ST/unit/e2e-real-build-lock.spec.ts`; `bun run typecheck` (or the
  repo's tsc entry) for `SP`/`SD`/`SF/bridge`. **Docker daemon is up in this container** at plan
  time (`docker info` succeeds). Run the real-container backend half of the IPC tier
  (`go test ./apps/kira-studio/internal/ipcfixture/...`, six engines, compares against committed
  fixtures; never `KIRA_IPC_FIXTURES=write` during review), the frontend half
  (`bun run test:ipc:fe:studio`) and the real-backend tier (`bun run test:e2e-real:studio`, Node
  Playwright entrypoint per `docs/DEV_ENVIRONMENT.md`). If Docker is down, start it per
  `docs/DEV_ENVIRONMENT.md` Docker section (`dockerd`, `mirror.gcr.io`,
  `TESTCONTAINERS_RYUK_DISABLED=true`). Missing deps or bindings: `bun install --frozen-lockfile`
  and `bun run setup` (or `sh scripts/prepare-worktree.sh`). A red check is a finding.
- **Wire regeneration check:** `sh scripts/generate-wire.sh` into a scratch copy, diff against
  `SI/page/wire` and `SP/wire`. A diff means the committed generated code drifted from
  `SP/wire.fbs`: finding.

## 1. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `de8ec4c`. **Part 5: no line drift.** 110 files, 21,623 code
lines, 10,822 test lines, same as `f40cd35`. Part 5 files changed since the pre-plan: only the six
`SI/ipcfixture/testdata/*.fixture.json` and `ST/ipc/kafka/kafka.fixture.ts`, by Part 3
`c8e0b4f` (`keyTypes` added to control fixtures) and Part 4 `5ce6718`/`54f9ba4` (kafka
`exactCount: false`). JSON is not counted as code; the `.ts` edit was line-neutral.

Drift elsewhere, none touching another Part 5 file:
- Part 2: 148 files, 20,159 lines (tests 8,088): unchanged since Part 4's plan.
- Part 3: 142 to 143 files, 27,722 to 27,825 lines (tests 8,677 to 8,712).
- Part 4: 72 to 76 files, 15,798 to 16,747 lines (tests 7,277 to 7,754): its fixer's new tests.
- Part 11: 30,574 to 30,551. Part 13: 26,687 to 26,658 (tests 14,621 to 14,592). Both Stream C.
- Stream B: Part 14 16,073 to 16,275; Part 15 15,176 to 15,595; Part 16 18,792 to 18,911.
- Totals: streams A 256,934, B 183,061; 2,884 owned, 0 orphans, 3,517 tracked (docs 480).
- **Stream drift (SPEC `8a008bd`, not in the script):** Parts 10-13 are Stream C. The script
  still labels them `[A]`. Edit scope follows the SPEC (§8).

P166/P167: neither touched a Part 5 file (P166 findings `a37fdec` and P167 findings `8a98250`
name no Part 5 path; P167's one `SP` hit is `events.ts`, Part 9). Both findings files are deleted
on this branch and on `v2.0`. Review the whole chunk, not a diff.

## 2. Own file set (110 files)

54 production code files (10,801 lines), 50 test code files (10,822), 6 JSON fixtures. Per area
(prod files/lines; test files/lines):

- **`SI/adapterhost`** (9/2,036; 8/1,599): `router` 413, `host` 356, `dataframe` 289, `data` 242,
  `wire` 229, `frame` 206, `session` 204, `throttle` 68, `op` 29. Tests: `dataframe_test` 328,
  `host_test` 217, `data_test` 213, `router_test` 195, `router_reconnect_race_test` 194,
  `throttle_test` 172, `session_test` 142, `dataframe_cancel_test` 138.
- **`SI/enginecache`** (5/766; 3/397): `cache` 251, `lru` 186, `pages` 158, `counts` 112,
  `generation` 59. Tests: `lru_test` 150, `cache_test` 125, `generation_test` 122.
- **`SI/page`** (4/849; 1/59): `builder` 369, `encode` 282, `scratch` 123, `chunk` 75. Test:
  `scratch_test`. `SI/page/wire` generated, excluded.
- **`SI/tree`** (1/337; 1/795): `service` 337; `service_test` 795.
- **`SI/oplog`** (1/294; 1/315): `wire` 294; `wire_test` 315.
- **`SI/ipcfixture`** (6/1,234; 8/1,291; 6 JSON): `frozen` 584, `harness` 388, `decode` 111,
  `write` 84, `types` 36, `channels` 31. Tests (per engine, real containers): `redis_test` 380,
  `kafka_test` 193, `mariadb_test` 181, `fixture_assert_test` 152, `sqs_test` 142, `mysql_test`
  97, `clickhouse_test` 94, `harness_test` 52. `testdata/*.fixture.json` (clickhouse, kafka,
  mariadb, mysql, redis, sqs).
- **`SP`** (6/1,538): `page` 665, `frame` 474, `data-ops` 207, `wire.fbs` 140, `wire` 30, `port` 22.
  `events.ts` is Part 9; `SP/wire/` generated, excluded.
- **`SD`** (4/469): `connection` 224, `tree` 154, `object-store` 62, `mutations` 29.
- **`SF/bridge`** (5/956): `index` 381, `apiControl` 348, `port` 157, `data` 59, `control` 11.
- **`packages/db-fixtures`** (13/2,322): seeds `0001_seed.sql` 332, `0002_mariadb_seed.sql` 291,
  `0005_kafka_seed.ts` 121, `0008_mysql_seed.sql` 310, `0009_sqlite_seed.sql` 309,
  `0010_clickhouse_seed.sql` 367; `support/` `mariadb` 144, `postgres` 128, `sqlite` 121, `kafka`
  99, `docker` 55, `common` 31, `connectionConfig` 14. Consumed by the Part 3/4 conformance
  suites (`git grep db-fixtures` hits `postgres_test`, `mysqlfamily_test`, `clickhouse_test`,
  `kafka_test`, `mongo_test`, `redis_test`, `s3_test`, plus `kafka/client.go` comment) and by
  `ST/e2e-real`.
- **`ST/ipc`** (13/4,421): per engine `<kind>.fixture.ts` (generated by `ipcfixture`, committed)
  and `<kind>.frontend.spec.ts`; `support/types.ts` 116.
- **`ST/e2e-real`** (10/1,067): `fixtures.ts` 265, `mariadb-real` 239, `postgres-real` 181,
  `multiwindow-real` 135, `sqlite-real` 112, `support/{kafka,mariadb,passthrough,postgres,sqlite}.ts`.
  Kept (`CLAUDE.md`).
- **`ST/support`** (2/479): `encodeFrame.ts` 370 (a third copy of the wire encoder, for tests),
  `seeds/md5Rows.ts` 109.
- **`ST/unit`** (3/399): `bridge-port.spec.ts` 260, `bridge-unwrap.spec.ts` 73,
  `e2e-real-build-lock.spec.ts` 66.

## 3. One hop: callers (git grep of import lines)

- **Go importers of `adapterhost`** (production): `main.go` (`NewRouter`, `Router.Host`,
  `PushCacheConfig`), `appcore/deps.go` and `appshell/stream.go` (`*Router`), `bridge/stream.go`
  (`StreamSession`, `AttachStream`, `HandleDataFrameAsync`), `bridge/ops.go` (`Router` as
  `Canceller` and `tree.Backend`), `bridge/http.go` and `bridge/grpc.go` (`OpSpec` into
  `Host.RunOp`: API requests share the op log and throttle machinery), `dbmcp/{server,tools,
  explain,access}.go` (`Router`, `ExecuteRequestWire`, `ExecuteResponse`, `ClassifyStatement`).
  All Part 6 except `bridge/http.go`/`grpc.go` callers of Part 7 code. `connections.Service`
  (Part 2, closed) reaches `Router` through `connections.Backend` (`Connect`/`Disconnect`/
  `SetThrottle`). Test-only: `ipcfixture/*_test.go`, `dbmcp/run_query_approval_test.go`,
  `bridge/http_test.go`.
- **`enginecache`**: `adapterhost` and `main.go` (`NewCache`) only; `ipcfixture/harness.go`.
- **`tree`**: `main.go` (`tree.New`), `appcore/deps.go`, `bridge/tree.go` (result types),
  `dbmcp/server.go` (`*tree.Service`, results); tests in `dbmcp`, `ipcfixture`.
- **`oplog`**: `main.go` (`oplog.New(router.Host(), repositories.Ops, retentionDays)`),
  `adapterhost/host.go` (event names).
- **`page`**: every engine in Parts 3-4 (builders, `Page`), `adapters/{adapter,caps,
  relationalpage,sqlmutate,sqltext}.go`, `testsupport`, `dbmcp/render.go` (`TabularPage`,
  `DocumentPage`, `KeyValuePage`, `StreamPage`, `CellText`/`IsNull`/`IsTruncated`,
  `MaxCellBytes`), `queryplan/parse.go`. A `page` API change ripples into Parts 3-4 (Stream A,
  editable) and Part 6.
- **TS, `SF/bridge/data.ts`** (15 importers): `main.ts`, `state/{cacheStats,objectStore}.ts`,
  `views/{console,documents,grid,stream}/state.ts`, `views/grid/{fkPreview,pendingChanges,
  fakeData/generate}.ts`, `views/shared/{immediateMutation,keyvalue/mutations,keyvalue/state}.ts`,
  `workbench/{GenerateDataDialog,settings/CachePane}.vue`.
- **TS, `SF/bridge/control.ts`/`index.ts`**: 43 files across `state/` (17), `views/*`, `api/state`,
  `project/`, `workbench/`. `apiControl.ts` is imported only by `index.ts` (composition root).
- **`port.ts`**: imported by `data.ts`, `index.ts`-free; test `bridge-port.spec.ts`.
  `decodeFrame` (Studio) has exactly one caller, `port.ts:93` (verified).
- **`SP` importers outside Part 5**: `SF/views/{grid,console,documents,stream,shared/*}`,
  `SF/state`, `SF/theme`, tests (`ui`, `unit`, `perf`, `fixtures/explain-plans`), the excluded
  `frontend/proto`. Most are Stream C (Parts 11-13).
- **`SD/{tree,connection}.ts`**: 46 and 47 importers (Stream C mostly); `mutations.ts`,
  `object-store.ts`: 3 each.

## 4. One hop: callees

- **`SI/adapters` core and engines** (Parts 3-4, closed): `Adapter` interface,
  `CreateAdapter`/`SetLiveAdapter`/`GetLiveAdapter`/`DeleteLiveAdapter` registry, `OpCtx`
  (`NewOpCtx`, `SetRows`/`SetCommand`/`SetPath`), error codes (`New`, `CodeEngineDown`,
  `CodeCancelled`, `CodeTimeout`, `CodeQuery`, `CodeUnsupported`), `StatementClassifier`,
  `ConnectInfo`, `Caps`. Part 4 contracts this chunk now relies on: engines' `Connect` returns on
  ctx cancel (Part 4 fixes `d10a101`, `5ce6718`); mongo `Cancel` handles detached ops (`4a1f4e6`);
  redis console no longer re-sends (`32fb921`).
- **`SI/storage`** (Part 2, closed): `model.DecodePath`/`EncodePath`/`NodePath`, `PageCursor`,
  `SortSpec`, `MutationPlan`/`MutationResult`, `ConsoleRequest`, `ObjectDownloadRequest`,
  `ValidateTreeNodes`/`ValidateObjectMeta`, `UTF16Len`; `repos.ConnectionsRepo`,
  `MetadataCacheRepo`, `OpsRepo`.
- **`SI/connections`** (Part 2, closed): `Backend`, `ConnectResult`, `StateOf`/`Since` (tree's
  freshness epoch).
- Root `internal/*` (Part 8, later): `kiratime`, `ipcerr`, `notify`. `@workbench/bridge/rpc`
  (`on`/`trust`/`unwrap`), `@workbench/testing` (Part 9, later). `SP/events.ts` (`CHANNEL`,
  Part 9).
- Generated wire code (`SI/page/wire`, `SP/wire/`), Wails bindings (`SF/bindings`, generated).

## 5. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Security first: this chunk carries
every renderer and agent data request to the engines, and decides op logging, cancellation,
caching and back-pressure for all of them.

### 5.1 Router lifecycle, op scheduling and cancellation

- **Reconnect and teardown** (`router.go:141-252`). `Connect` cancels ops, CAS-takes the old
  adapter, disconnects it bounded (`disconnectTimeout`), drops cache, creates and connects the new
  one inside `RunOp`, then `SetLiveAdapter`. Weigh: two concurrent `Connect` on one id (both pass
  the take, both install: the loser's adapter leaks live or is overwritten without
  `Disconnect`); `Disconnect` landing between `RunOp(connect)` success and `SetLiveAdapter`
  (finds nothing, returns; the new adapter then installs on a connection the service believes
  disconnected); `Connect` failure path's `Disconnect` on `context.Background()`-derived bound
  ignoring caller cancel; `SetThrottle(id, 0)` in `Disconnect` versus `connections.Service`
  re-applying it on reconnect (`service.go:412,764`): ordering when Disconnect and Connect race.
  `router_reconnect_race_test.go` covers two cases; check what it does not.
- **Op registration window.** `requireLiveAdapter` runs before `RunOp` registers the op
  (`data.go:62,71`; `router.go:257-261`). A `CancelOpsForConnection` in that window misses the op;
  it then runs on an adapter already torn down (expect `E_ENGINE_DOWN`/not connected: confirm
  the code, and that nothing panics on a nil client).
- **`Host.RunOp`** (`host.go:195-268`). Duplicate opId refused with `CodeQuery`: renderer opIds are
  renderer-generated; a retried request with the same id while the first is still running.
  Queued-on-throttle op: no `op:start`/`op:end` (by design); `limiter.Wait` on `derived` but
  `throttleMaxWait` 30 s timeout error text. Status `cancelled` only when `derived.Err() ==
  context.Canceled`: a session close (session ctx cancel) reads as cancelled, a deadline as error.
  `safeRun` panic boundary: does `op:end` still emit, and is the running entry always deleted.
  `emitJSON` delivery to `Subscribe`rs: blocking or dropping when `oplog` lags; a dropped
  `op:end` leaves a permanently "running" row until `finishInFlight` at stop.
- **`Host.CancelOp`** (`host.go:306-320`): local cancel then `adapter.Cancel(ctx, opID)` on
  whatever adapter is live **now** for that connection id: after a reconnect it is the new
  adapter, asked to cancel an opId it never ran (engines must treat unknown ids as no-op: check
  mongo's `$currentOp` path does not kill an unrelated op with a colliding comment). `ctx` is
  `context.Background()` from `bridge/ops.go:49`: an `adapter.Cancel` that blocks (network
  `killOp`) has no bound.
- **Tree ops** (`tree/service.go:220,319`) call the backend with `context.Background()` and no
  opId: not cancellable by the user, unbounded on a hung server. `KeyTypes` accepts any number of
  paths (the 200 cap is a renderer convention, not enforced). Weigh both against Part 4's lifecycle
  fixes.
- **Throttle** (`throttle.go`): `set` replaces the limiter on a live edit while ops wait on the
  old one (they keep the old rate); `perSec` NaN/Inf from settings; burst rounding at 0.4/s.

### 5.2 Data-frame session, back-pressure and size caps

- **`Session`** (`session.go`). `sessionQueueFrames` 64, `sessionQueueBytes` 32 MiB,
  `maxDataFrameBytes` 64 MiB, `sessionMaxInFlightOps`. `enqueueResponse` blocks until room or close
  and never checks `maxDataFrameBytes` itself (relies on `respond`'s pre-check; `respondError`
  messages are unbounded driver text). `enqueue` drops oversized frames silently (`return nil`):
  for an event frame fine; check no response path reaches it. `writeLoop` calls `Close` on a
  `Send` error: pending renderer requests then wait for `onclose` (does Wails close the renderer
  side?). `queuedBytes` accounting under concurrent producers (add after send vs. subtract in
  `writeLoop`: transient negative, budget overshoot by up to one frame per producer).
- **`HandleDataFrameAsync`** blocks the receive loop while all slots are busy: a burst of
  `ops:cancel`-free reads stalls `ping` and `cache:stats` behind them; a long op holding every slot
  blocks the frame that would cancel it? (Cancel goes over Wails RPC, not this stream: confirm.)
- **`HandleDataFrame`** silently drops unparseable frames and non-`req` kinds: the renderer
  request then hangs forever (data ops have no timeout). A frame with a valid id but bad JSON
  payload is answered (`decodeAndValidate` error), but with no error code (plain `fmt` errors):
  check the renderer's code-based handling (`viewOp.ts` `DISCONNECTED_CODES`).
- **Response size** (`dataframe.go:224-271`). `oversizedPagePayload` pre-check on the estimate,
  post-encode check on the real size. The page was already fully materialised in Go before either
  check runs: that half is Part 4 F8 (do not re-report, §6). In scope: an oversized response
  answered as `E_QUERY` "too large" while the page was still cached in L2 (`StorePageIfCurrent`
  ran first in `Read`): every later read hits the cache and fails the same way until evicted.
  `Mutate`/`Count` int32 and float64 casts (`AffectedRows` > 2^31, counts > 2^53).
- **Error frames** (`frame.go:145`, `safeEncodeError`): message size, code mapping for non-
  `adapters.Error` errors (panic text with stack goes to the log only? confirm no stack in the
  frame).

### 5.3 Page wire mirror (both halves here)

- **Go encode against TS decode**: `page/encode.go` + `adapterhost/frame.go` against
  `SP/frame.ts`, with `SP/wire.fbs` as the contract and `ST/support/encodeFrame.ts` as a third
  copy. Check every field both ways: optional scalars (`TtlMs`, `MemoryBytes` absent vs 0),
  `VisibilityTimeoutSeconds` nil, `PagePosition.Offset` nil for keyset pages, `Strategy` enum,
  `NextToken`/cursor strings, `RedisType` enum incl. `object`, `TypeClass` mapping, `generated`
  and `isPrimaryKey` flags, `FieldsAreColumns` (Go field: is it on the wire?), `Source` enum,
  `RowCount` int32. A field present in Go and absent in TS (or the reverse) is a finding.
- **Chunk invariants**: offsets length `rowCount+1`, nulls `ceil(rowCount/8)`, truncated sorted;
  `assertPageStructure` (`SP/page.ts`) runs only in `data.ts` read/execute: which paths bypass it
  (events, cache stats, ipc fixtures). A forged or truncated frame: `decodeChunk` returns views
  whose lengths the renderer trusts (`cellText` out-of-range offsets).
- **Builders** (`page/builder.go`, `scratch.go` against `SP/page.ts` `createColumnarBuilder`):
  UTF-8 truncation at `MaxCellBytes` on a rune boundary vs the TS `truncateUtf8` (byte-identical
  output required for fixture parity); `Reverse` for keyset `before`; `PageByteSize` UTF-16
  approximation documented; `DocumentTruncateBytesSingle` vs TS constant; `ObjectBodyEditBytes`.
  `TabularPageBuilder.AppendRow` error on width mismatch: callers that ignore it.
- **`ExecuteResponse` copy-on-multi-page** (`frame.ts:368-383`): single page stays zero-copy and
  pins the whole frame; multi-page copies every chunk. Check `ReadResponse` pinning and that
  console `releaseResult` assumptions hold (renderer side read only).
- **`port.ts`**: `ready` gating (requests before open; send after `closed` silently skipped while
  the pending entry stays until `onclose`); timeouts started before the open ack; a timed-out
  request whose late response arrives (ignored: fine) but whose server op keeps running (no cancel
  sent: control-plane requests only?); `rejectAllPending` on close; no reconnect after `onclose`
  (every later request rejects: does the app recover on Wails' own stream reconnect?); `nextId`
  overflow past int32 (Go `ID int`, wire `int32` in `FrameAddId`); event listeners never cleared.
- **zod mirrors** (`SP/data-ops.ts` against `adapterhost/wire.go` `Validate`): filter cap counts
  runes in Go (`wire.go:19`) and UTF-16 units in zod (`max(4096)`), unlike Part 2's
  `model.UTF16Len` rule; `pageSize` enum; `statements` min 1 vs Go; cursor `offset >= 0`;
  `opId` required in Go, `z.string()` (empty allowed) in TS; `ObjectDownloadRequestWire`
  `maxLocalFilePathChars`. Which side is authoritative, and does the renderer validate at all
  before sending.
- **Generated code drift**: §0 regeneration check.

### 5.4 Cache (L2 pages, L3 counts)

- **Keying** (`pages.go:62`): projection sorted for the key; does a hit return a page whose column
  order differs from the request's projection order, and does the renderer map columns by name or
  position? Filter trimmed for L2 key, untrimmed for L3 key (`counts.go:35`): `nil` vs `""` vs
  whitespace treated differently by the two layers. Cursor/token included; sort canonicalised.
- **Hit semantics**: a cache hit never enters the op log (contract) and returns before
  `requireLiveAdapter`: a hit for a connection that is disconnected but not yet dropped, or a
  reconnect whose `DropConnection` has not run yet. `Source: "cache"` on hit.
- **Invalidation**: `Mutate` invalidates in a `defer` even on failure (contract; confirm the defer
  is registered only after path decode, so a malformed request does not bump generations).
  `Execute` (console DML) never invalidates (documented: verify the renderer offers refresh).
  Generation snapshot taken after the miss check: a mutation between `ReadPage` miss and
  `CurrentGeneration` (window without the lock) caches a pre-mutation page as current?
- **Growth**: `generationTracker.target`/`conn` maps are never pruned (one entry per distinct
  path ever invalidated); `markTargetStale` and `DeleteWhere` scan every entry per mutation;
  `ByteLru` half-budget refusal; `Configure` lowering the budget evicts; L3 TTL (`countTTL`
  5 min, `countDropAfter` 30 min) evaluated only on read.
- **Stats push**: `scheduleEmitLocked` coalescing, `pushCacheStats` through `enqueueLocal` (drops
  on full queue: fine), subscription leak if `detach` is never called.

### 5.5 Tree service and op log

- **Tree** (`tree/service.go`): L1 metadata cache keyed by `Since` (F7, P108): a reconnect between
  fetch start and store; cache hit served without `requireConnected` (check `tryCache` order);
  truncated listings never cached; `Invalidate` with nil path; `ValidateTreeNodes` rejection drops
  the row; `KeyTypes` path decode error mapped to `ipcerr.Internal` (wrong code for bad input).
- **Op log** (`oplog/wire.go`): `handleOpStart`/`handleOpEnd` pairing by opId; an `op:end` without
  start (queued-cancel never emits either: fine); retention `prune` cadence; incognito ops kept out
  of the persisted log; `Command` text containing secrets (engines set it; check redaction is the
  engine's job and none is undone here); write failures on `OpsRepo` while the app runs; `Stop`
  draining.

### 5.6 Bridge TS surface

- `SF/bridge/index.ts`/`apiControl.ts`: every Wails binding wrapped in `unwrap(...).then(trust<T>)`.
  `trust` is an unchecked cast: list which results feed state without a schema check and could be
  `null` where the type says non-null (`r ?? []` used for some, not all). Event subscriptions
  (`on(CHANNEL.*)`) return unsubscribers: callers that never call them are Stream C's concern, but
  a bridge-side leak is in scope.
- `control.ts` re-export shim: still needed? (dead shim is a finding only if nothing imports it:
  45 files import `bridge/control`).

### 5.7 Fixtures and test tiers

- **`ipcfixture`**: `frozen.go` freezes volatile fields (ids, timestamps, coordinator host:port,
  ClickHouse `.inner_id`): a field not frozen makes the real-container comparison flaky; a field
  over-frozen hides a real regression. `fixture_assert_test` compares the committed fixture to a
  live capture: confirm it actually runs and fails on drift (Part 3 found the six fixtures stale
  and only skipped without Docker). `write.go` `SetEscapeHTML(false)`.
- **`ST/ipc` frontend specs** and **`ST/e2e-real`**: kept tiers. Report a spec that no longer
  guards what its name says, or a build lock (`e2e-real-build-lock.spec.ts`) that no longer
  matches `fixtures.ts`'s build step.
- **`db-fixtures`**: seed SQL consumed by conformance suites and e2e-real: a seed change ripples
  into Parts 3-4 assertions. Check seed scripts for non-determinism (random, `now()`) that a
  frozen fixture depends on.
- **Unit-test bar** (`CLAUDE.md`): `adapterhost`/`enginecache`/`page` tests cover concurrency,
  eviction, generation races, truncation: these clear the bar. Report only a true duplicate or a
  test restating a trivial body.

## 6. What earlier fixes already changed (do not re-report)

- **P108 Part 6** (v1.9; Part 5's v1.9 analogue): F3 `schemaColumns`/`keyTypes` throttled, F4
  generation-guarded `StorePageIfCurrent`/`StoreCountIfCurrent`, F6 `decodeFrame` resolves a
  payload decode failure as `{ok:false}`, F7 tree `putIfSinceUnchanged`. Also P2 R1/R2 (session
  ctx, bounded in-flight slots, frame-level `recover`), P58b nil `Children` to `[]`, P13 D2
  failed-connect disconnect, the `router_reconnect_race_test.go` F1/F2 fixes (cancel-before-
  teardown, CAS teardown), P5 C7/F8 multi-page copy. Verify they hold; do not re-report.
- **P168 Part 2** (closed): `connections.abortInFlight` waits on `Backend.Connect`; `model.UTF16Len`
  length rule; URI password moved to the secret store. No Part 5 file edited.
- **P168 Part 3** (closed): `c8e0b4f` added `keyTypes` to the six IPC fixtures. `ConnGuard`,
  `QueryTracker.PopRunningWith`, `ConnSet.Drop` in the adapter core.
- **P168 Part 4** (closed, `3911754`..`de8ec4c`): engines' `Connect` honours ctx; mongo Stop on
  detached ops; redis no console re-send, subcommand read-only gate, safe eviction; kafka
  `ExactCount: false` (fixtures `54f9ba4`), header order, partial produce; s3 ACL, bucket scope,
  bounded preview, non-regular uploads; awscfg URI secret. **Held, not fixed, by design
  decision: F8** (console results fully materialised, no row/byte cap, shared with SQL consoles)
  **and F15** (sqs browse on a read-only connection consumes messages). Do not re-report either,
  including Part 5's post-materialisation size check as a restatement of F8.
- **P166/P167**: no Part 5 file touched; findings files deleted. Nothing to skip.

## 7. Routed items owned by this Part

Read `docs/v2.0/plans/P168-routed-from-streamA.md`, `P168-routed-to-stream-a.md` and Stream C's
`P168-routed-from-streamC.md` (on `p168-stream-c`; not yet on `v2.0`:
`git show p168-stream-c:docs/v2.0/plans/P168-routed-from-streamC.md`).

- **Part 4 F12 (kafka tombstones and binary values): Part 5 owns the Go and protocol half and
  must fix it here.** Files: `SI/page/builder.go` (`StreamRow.Body` to `*string`,
  `StreamPageBuilder.Push`), `SP/page.ts` (`createStreamPageBuilder` row type), `SI/adapters/kafka/
  read.go:69-70,86-117` and `sqs/read.go` `pushMessage` (Stream A, Part 4 closed, editable),
  `dbmcp/render.go` stream renderer (Part 6, Stream A, editable as one hop), `ipcfixture` and
  `ST/ipc/kafka` fixtures if the captured shape changes. The wire already carries a per-row null
  bit in `bodies`, so a null body needs no schema change and renders as today's empty text in the
  current renderer: the Go half lands safely alone. The binary half (base64 plus a marker or flag)
  needs a renderer that understands it; a marker emitted first would be ambiguous text. Reviewer:
  confirm both claims (null bit decoded by `frame.ts`, `views/stream/page.ts` falls back to `''`),
  then file F12's Part 5 half as a finding with the exact edit set and the routing note below.
  **Renderer half routes to Stream C:** `SF/views/stream/page.ts` (Part 12) `streamRow` must check
  `isNull(page.bodies, row)` and show a null marker; any binary display. Tag
  `needs-other-part-file: apps/kira-studio/frontend/src/views/stream/page.ts (Part 12, Stream C)`.
  If the binary half needs a `wire.fbs` change, regenerate with `scripts/generate-wire.sh` and
  update `ST/support/encodeFrame.ts`.
- **Part 4 F20 (`packages/shared/caps.ts` table): not Part 5.** The §8 script assigns
  `packages/shared/caps.ts` to Part 13 (Stream C); `SP/page.ts` only re-exports its `PageKind`
  type. Already routed out; do not re-report or fix here.
- **Stream C Part 10 F6** (`SI/bridge/collections.go` not-found code): Part 6. Not Part 5.
- **Stream C Part 10 F18** (`HttpDeleteCookie` by name only): Go half in `SI/bridge/http.go`
  (Part 6) and the cookie jar (`SI/httpclient`, Part 7). Part 5 owns `SF/bridge/apiControl.ts:104`
  (`httpDeleteCookie(url, name)`), whose signature must widen to domain and path once the Go
  binding does. Part 6/7's fixer makes that one-hop edit with the Go change (Wails bindings are
  generated from Go, so the TS edit cannot land first). Not a Part 5 finding; do not re-report.
- **Part 14 F4** (`localsock` `wg.Add` race, `P168-routed-to-stream-a.md`): Part 8. Not Part 5.

## 8. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, one pass, in this block order** (Go core first, then the wire's two halves, then
  consumers, then tests). About 10.8k production lines plus 10.8k test lines: read tests only where
  they are the sole guard of a claim, or in block 7.
  1. **Contract and callees**: `SP/wire.fbs`, the adapter registry and `OpCtx` as callee only
     (`SI/adapters/{adapter,registry}.go`), wire regeneration check (§0).
  2. **adapterhost core**: `host`, `throttle`, `op`, `router`, `data`, `wire`.
  3. **Data frames and session**: `session`, `dataframe`, `frame`; Go side of `SI/page`
     (`chunk`, `scratch`, `builder`, `encode`).
  4. **enginecache**: `cache`, `pages`, `counts`, `lru`, `generation`.
  5. **TS half of the wire and bridge**: `SP/{frame,page,data-ops,port,wire}.ts`, `SD/{mutations,
     object-store,tree,connection}.ts`, `SF/bridge/{port,data,index,apiControl,control}.ts`.
     Routed F12 claims (§7) confirmed here.
  6. **tree and oplog**: `tree/service.go`, `oplog/wire.go`.
  7. **Fixtures and tests**: `ipcfixture` (`harness`, `frozen`, `decode`, `write`, `types`,
     `channels`, per-engine tests), `ST/{ipc,e2e-real,support}`, `ST/unit/{bridge-*,
     e2e-real-build-lock}`, `packages/db-fixtures`; unit tests per package. Real-container and
     e2e-real runs here if not done earlier.
- **Resumable:** write `docs/v2.0/plans/P168-part5-findings.md` as blocks finish, and commit it
  after **every** block (`docs(v2.0): P168 Part 5 findings, block <n>`; normal commit, hooks
  green, explicit `git add <path>`). Mark each block done in the file's coverage section. An
  interrupted run reads the file, resumes at the first block not marked done, and never
  re-derives a committed block.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a
  concrete failure scenario (inputs, sequence, observed outcome; say which probe or real run
  confirmed it), and a proposed fix. Tag `design-decision` when it needs one; the fixer turns it
  into its own `SPEC.md` phase.
- **Edit scope tag.** The fixer may edit Part 5 files and Stream A one-hop files (Parts 2-4
  closed, Parts 6-9 later; pre-plan §3.3). A finding whose fix needs a file outside that set
  carries `needs-other-part-file: <path> (Part N)`. That covers every Stream C file (Parts 10-13:
  e.g. `SF/views/**`, `SF/state/**`, `SF/api/**`, `packages/shared/caps.ts`, `SD/{streamFilter,
  console,...}.ts`) and every Stream B file (Parts 14-23). The orchestrator routes those; the Part
  5 fixer never edits them.
- The findings file states base commit (`de8ec4c`), HEAD reviewed, checks run and results (vet,
  race, bun unit, typecheck, wire regeneration diff, ipcfixture real-container run, ipc frontend,
  e2e-real, with images), findings, then coverage per block: reviewed, skimmed (with reason), not
  reached. No unexplained gap. A chunk with nothing real says so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 5 findings`, normal commit, hooks green, before any fixer
  starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 5`. A fix
  re-runs `go build ./apps/kira-studio/...`, `go vet` and `go test -race` over the six Part 5 Go
  packages, plus `SI/bridge`, `SI/dbmcp`, `SI/adapters/...` when a caller or contract changed;
  `bun test` for touched TS specs and the typecheck; `test:ipc:fe:studio` and the `ipcfixture`
  real run when the wire or a page shape changed (regenerate fixtures with
  `KIRA_IPC_FIXTURES=write`, then `bunx biome check --write`, only for an intended shape change);
  `test:e2e-real:studio` when `port.ts`, `frame.ts` or `adapterhost` dataframe code changed. A
  `wire.fbs` change regenerates via `scripts/generate-wire.sh` and updates
  `ST/support/encodeFrame.ts`. It deletes the findings file when done. Routed renderer halves go
  to a routing doc (`P168-routed-from-streamA.md`) with exact file and change. Chunk lands per
  pre-plan §3.4 before Part 6's plan starts.

## 9. Candidate suspects (unconfirmed; verify, do not assume)

Raised during planning discovery. Each is a lead, not a finding.

1. Concurrent `Router.Connect` on one id, or `Disconnect` between connect success and
   `SetLiveAdapter`, leaves a live adapter the service thinks is gone (`router.go:156-190`).
2. `Host.CancelOp` forwards to whatever adapter is live now, with an unbounded ctx from
   `bridge/ops.go:49` (`host.go:315-318`).
3. Tree `Children`/`KeyTypes` use `context.Background()`: not cancellable, unbounded
   (`tree/service.go:220,319`); `KeyTypes` path count unbounded.
4. Validation errors from `decodeAndValidate` carry no error code (`dataframe.go:122-127`).
5. Filter length counted in runes in Go, UTF-16 units in zod (`wire.go:19` vs `data-ops.ts:70`).
6. An oversized page cached in L2 before `respond` rejects it: every later read fails from cache
   (`data.go:87` then `dataframe.go:235`).
7. L2 key sorts projection; cached page column order may not match a later request's order
   (`pages.go:63-66`).
8. `generationTracker` maps never pruned (`generation.go:45-58`).
9. `port.ts` has no recovery after `onclose`; `nextId` exceeds int32 after long uptime only in
   theory (check `FrameAddId(int32(id))` against Go `ID int`).
10. `enqueueResponse` does not bound frame size; an error frame from a huge driver message
    (`session.go:160`, `dataframe.go:273-280`).
11. `emitJSON` back-pressure to `oplog`: blocked producer or dropped `op:end` (`host.go:293`).
12. `encodeSource` and `EncodePage` panic on unknown values; recovered by `HandleDataFrame` but
    not on the `pushCacheStats` event path (`frame.go:197-205`, `encode.go:39`).

## 10. Out of scope

- Engines (Parts 3-4, closed) beyond the contract this chunk relies on; F8/F15 (§6).
- `bridge`, `appshell`, `appcore`, `dbmcp` internals and `main.go` wiring (Part 6), beyond how they
  call this chunk.
- `storage`, `connections` (Part 2, closed).
- `SP/events.ts`, `@workbench/*`, root `internal/*` (Parts 8-9, later): record only as a callee
  note when it breaks a Part 5 contract.
- Frontend views and stores (Stream C): read only for reachability and mirrors; fixes tagged per
  §8.
- Generated code (`SI/page/wire`, `SP/wire/`, Wails bindings), docs, excluded files (pre-plan §6);
  generated code is checked only for drift (§0).
