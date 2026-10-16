# P108 Part 6 — review plan: Studio engine data plane and page wire protocol

Chunk A5, stream A position 5 (pre-plan §5.5). Gate G2 met: Part 13 committed. One Opus reviewer
runs this plan and reports findings. It fixes nothing. One Sonnet fixer then lands the findings.
Tree surveyed: `a2d64e2` (Part 5 result recorded, Part 16 fixes landing concurrently in
`apps/kira-space/internal/gitsession/**`, no overlap).

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SA` = `SI/adapters`, `SF` =
`apps/kira-studio/frontend/src`, `SP` = `packages/shared/protocol`.

## 0. Method

- **`codegraph_explore`** for discovery: `Router.Connect`/`Disconnect`/`Test`/`Cancel`,
  `Host.RunOp`/`CancelOp`, the live-adapter registry (`GetLiveAdapter`/`SetLiveAdapter`/
  `DeleteLiveAdapter`) and every `connections.Service` path reaching `Backend.Connect`/
  `Disconnect` (`attemptConnect`, `finalizeAbortedAttempt`, `Disconnect`, `Remove`,
  `onPreconnectExit`). Blast radius of any registry or `Host` change checked the same way.
- **Driver source in the module cache** where a claim depends on it: `pgx/v5@v5.11.0`
  (`pgconn` default dialer keepalive, ctx watcher), `SA` core (`QueryTracker.Drain`,
  `ConnSet.CloseAll`, per-engine `Close` callbacks taking the entry mutex).
- **Mirror check by reading both halves side by side:** `SI/page/encode.go` +
  `SI/adapterhost/frame.go` against `SP/frame.ts`; `SI/page/{chunk,scratch,builder}.go` against
  `SP/page.ts`; `SP/wire.fbs` as the contract. Generated `SI/page/wire` and `SP/wire/` are
  boundary only.
- **Op-kind vocabulary cross-check:** every `Kind` string `Router`/`Dispatcher` pass to `RunOp`
  against `model.opKinds` (Go), `opKindSchema` (`shared/domain/ops.ts`) and `throttledKinds`.
- **`go test -race`** over every own Go package. Docker-backed `ipcfixture`/`e2e-real` suites skip
  without Docker.

## 1. Own file set

Production files first; tests read where they are the package's own guard.

- **`SI/adapterhost`** (~1.8k prod): `router.go` (connection lifecycle, tree/dbmcp seams),
  `host.go` (scheduler, `RunOp`, `CancelOp`, event fan-out), `data.go` (`Dispatcher`,
  cache-aside), `dataframe.go` (frame routing, response size guard), `frame.go` (FlatBuffers
  envelope), `session.go` (single-writer queue, backpressure, in-flight slots), `throttle.go`,
  `op.go`, `wire.go` (request shapes, `Validate`).
- **`SI/enginecache`** (~660 prod): `cache.go`, `pages.go` (`PageCacheKey`), `counts.go` (L3
  TTL/stale), `lru.go` (`ByteLru`).
- **`SI/page`** (~840 hand-written): `encode.go`, `builder.go`, `chunk.go`, `scratch.go`.
- **`SI/tree`** (`service.go`, 303), **`SI/oplog`** (`wire.go`, 292).
- **`SI/ipcfixture`** (harness, frozen fixtures, decode/write) and its Docker-gated tests.
- **`SP`**: `frame.ts`, `page.ts`, `data-ops.ts`, `port.ts`, `wire.ts`, `wire.fbs`.
- **`SF/bridge`**: `port.ts`, `data.ts`, `index.ts`, `control.ts`, `apiControl.ts`.
- **`packages/shared/domain`**: `mutations.ts`, `ops.ts`, `object-store.ts`, `tree.ts`.
- **Tests/infra**: `apps/kira-studio/tests/{ipc,e2e-real,support}/**`,
  `tests/unit/bridge-{port,unwrap}.spec.ts`, `packages/db-fixtures/**`.

## 2. One hop: callers

- **`SI/connections`** (Part 3, settled): `Service.attemptConnect` calls `Backend.Connect` with
  the attempt's own cancellable ctx; `Disconnect`, `Remove`, `finalizeAbortedAttempt` and
  `onPreconnectExit` (async goroutine, no attempt cancel) call `Backend.Disconnect` with
  `context.Background()`; `Test` calls `Backend.Test` with `context.Background()`. D11 dedupes
  concurrent `Connect` per id; `Disconnect` is not serialized against it (F4 only cancels).
- **`SI/bridge`**: `stream.go` `ServeEngineStream` (`AttachStream`, `HandleDataFrameAsync`),
  `ops.go` (`Router.Cancel`), `events.go` (`oplog.OnUpdate` to `CHANNEL.opUpdate`),
  `TreeService` over `tree.Service`.
- **`SI/dbmcp`**: `QueryRunner.Execute`, `ClassifyStatement`.
- **`main.go`**: `wireAdapters` (`NewRouter`, `oplog.New(router.Host())`), teardown order.
- **TS**: every `SF` store/view calling `bridge/data.ts`; `state/ops.ts` (`onOpUpdate` upsert by
  id, unknown id prepends a row); `decodeFrame`'s only caller `SF/bridge/port.ts`.

## 3. One hop: callees

- **`SA` core** (Parts 4/5, settled): `Adapter` contract, live registry (`SA/live.go`),
  `QueryTracker.Drain` (ctx-bounded select, no bound under `Background`), `ConnSet.CloseAll`
  (per-entry `Close` takes the entry mutex an in-flight op holds), every engine's `Disconnect`
  (all return nil), `Cancel` (side connection).
- **`SI/storage`** (Part 3): `model.opKinds`/`ValidOpKind`, `OpsRepo.Append/Finish`,
  `MetadataCacheRepo`, `model.DecodePath`.
- **`@workbench/bridge`** (`rpc.ts` `unwrap`/`trust`/`on`), `SP/events.ts` (Part 13, settled).

## 4. Edge cases to weight

- **Connect/disconnect/reconnect ordering (Part 4 and Part 5 hand-offs, verify fresh).**
  `Router.Connect`'s reconnect branch calls `existing.Disconnect(context.Background())` before and
  outside `RunOp`: not in the op log, not reachable by the attempt's ctx, so
  `connections.Service.Disconnect`'s `cancelInFlight` cannot abort it. In-flight ops on the old
  adapter are not locally cancelled first. Size the hang against `Drain(Background)`, the entry
  mutex in `CloseAll`, and Go's default TCP keepalive on a dead network. Same question for the
  failed-connect `Disconnect(Background)` and `Test`'s deferred one. `Router.Disconnect`:
  concurrent with a reconnect (`onPreconnectExit`'s async call is the named case), does its
  by-id `DeleteLiveAdapter` remove the *new* adapter, drop its cache, clear its fresh throttle?
  Double `Disconnect` of one adapter. Error path leaving an adapter registered.
- **Cancellation.** `CancelOp` resolves the adapter by connection id at cancel time: an op still
  running on a replaced adapter. Session close cancelling every op. Throttle-queued ops.
- **Cache invalidation (`enginecache`).** Read/Count store after `runOp` returns: a miss in flight
  across `InvalidateAfterMutation`, `DropTarget`, `DropConnection`, `Clear` or a reconnect — does a
  pre-invalidation result land as a fresh entry? Stale-count mark overwritten. Key normalization
  (filter trim, projection nil vs `[]`, sort canonical form). Half-budget refusal, budget 0.
  L3 TTL/drop boundaries.
- **Op-log consistency.** Every `RunOp` kind must be a valid `OpKind` or `op:start` is dropped
  and `op:end` goes down the unmatched path. Event fan-out drops on a full subscriber buffer:
  lost `op:start`/`op:end` under burst. Incognito paths. Shutdown reconciliation order.
- **Wire mirror at boundaries.** Empty page (rowCount 0: offsets `[0]`, empty nulls), zero-page
  `ExecuteResponse`, empty `statements`, optional scalars (`offset`, `ttl_ms`, `memory_bytes`,
  `visibility_timeout_seconds`) absent vs zero, int32 casts (`row_count`, `affected_rows`,
  `offset`, `id`), max page size vs `maxDataFrameBytes`, multi-page copy rule, UTF-8 truncation
  parity (Go `truncateUTF8ToBoundary` vs TS `truncateUtf8ToBoundary`), enum drift.
- **`port.ts`.** `ready` gating, timer starting before open ack, `rejectAllPending`, a frame that
  fails to decode after its envelope parsed (data ops carry no timeout), request after close.
- **Session backpressure.** Byte budget vs frame cap, `enqueueResponse` never dropping, slot
  starvation, writer exit on `Send` error.
- **Tree L1.** Cache-aside write after a reconnect's freshness floor; truncated listings.
- **Test harness.** `ipcfixture` live adapters never disconnected (global registry, fixed ids);
  `e2e-real` build lock with no stale-lock recovery.

## 5. Watch items (pre-plan §5.5)

- Wire mirror `encode.go`/`frame.go` against `frame.ts` (P107 I2-40 decoder consolidation, I2-45
  `sumChunkBytes`).
- `ExecuteResponse` copy-on-multi-page rule.
- `Mutate` invalidates even on failure (P43 F12).
- A cache hit never enters the op log.
- `port.ts`: `ready` gating, timeouts before the open ack, `rejectAllPending`.

## 6. Out of scope

Generated `SI/page/wire`, `SP/wire/`. Adapter-internal `Disconnect`/`Cancel` bodies (Parts 4/5,
settled) except as callee behavior this chunk's ordering depends on. `connections.Service`'s own
state machine (Part 3) except where a fix here changes its contract. `main.go` teardown (Part 7).
A fix touching `SA/live.go` or `storage/model/ops.go` is same-stream, allowed under pre-plan
§3.3.
