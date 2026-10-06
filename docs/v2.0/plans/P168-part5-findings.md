# P168 Part 5 findings: Studio engine data plane and page wire protocol

Plan: `P168-part5-data-plane.md`. Base commit `de8ec4c` (plan survey); HEAD reviewed `8b29250`
(`p168-stream-a`, rebased on `v2.0` `61e367f`). Reviewer reports only; fixer follows plan §8.

## Checks

- `go vet` over `adapterhost`, `enginecache`, `page`, `tree`, `oplog`, `ipcfixture`: clean.
- `go test -race -count=1` over `adapterhost`, `enginecache`, `page`, `tree`, `oplog`: all pass.
- Wire regeneration: pinned `flatc` 25.9.23 (SHA-256 verified) run into scratch, `diff -r` against
  `SI/page/wire`, `SP/wire/`, `SP/wire.ts`: identical. No drift.

## Findings

### F1 (low) `Host.CancelOp` forwards to `adapter.Cancel` with an unbounded ctx

- `apps/kira-studio/internal/adapterhost/host.go:315-318`; caller `bridge/ops.go:49` passes
  `context.Background()`.
- Postgres and mysqlfamily bound their own side connection (`cancelTimeout`). ClickHouse does not:
  `clickhouse/adapter.go:347` sends `KILL QUERY ... SYNC` through an `http.Client` with no
  `Timeout` (`clickhouse/client.go:192`, dial/TLS timeouts only). Mongo's `killOp`
  (`mongo/adapter.go:398-410`) runs a `$currentOp` aggregate on `Background` with no socket
  timeout.
- Scenario: ClickHouse server stalls (the usual reason a user clicks Stop). Local cancel fires, but
  `KILL ... SYNC` waits on the stalled server. The `Cancel` Wails call never resolves; one goroutine
  per click stays parked. Code read; not probed.
- Fix: in `CancelOp`, wrap `ctx` with `context.WithTimeout(ctx, cancelForwardTimeout)` (10 s, same
  as `disconnectTimeout`) before `adapter.Cancel`. One place covers every engine.

### F2 (low) A slow `Router.Disconnect` clears the throttle of a newer connection

- `apps/kira-studio/internal/adapterhost/router.go:236-250`.
- `Disconnect` wins teardown, then runs `disconnectAdapter` (up to `disconnectTimeout`, 10 s), then
  `DropConnection` and `SetThrottle(id, 0)`. `connections.Service.Disconnect` is not tracked in
  `inFlight`, so `Service.Connect` for the same id can run meanwhile. `attemptConnect` calls
  `SetThrottle(id, x)` (`connections/service.go:764`) then `Router.Connect`, which finds nothing
  live and installs a new adapter.
- Scenario: throttle 5/s, engine hung. User clicks Disconnect, then Connect within 10 s. The new
  adapter connects; the old `Disconnect` finishes and clears the limiter. New session runs
  unthrottled until the next connect or edit. Same window via `onPreconnectExit`'s async
  `Disconnect`. `DropConnection` also drops the new session's pages (harmless). Code read.
- Fix: keep a per-id connect epoch in `Router`, bumped under `teardown.lock` by `Connect` before
  `SetLiveAdapter`. `Disconnect` records the epoch when it wins teardown and skips
  `SetThrottle(id, 0)` and `DropConnection` when the epoch moved. Add a case to
  `router_reconnect_race_test.go`.

### F3 (low) Cache hits keep serving a connection being torn down

- `apps/kira-studio/internal/adapterhost/router.go:156-166,236-246`; `data.go:54-56,94-97`.
- `Connect` (reconnect) and `Disconnect` remove the live adapter, then wait up to 10 s in
  `disconnectAdapter`, and only then `DropConnection`. `Read`/`Count` check the cache before
  `requireLiveAdapter`, so during that window a cache hit answers `Source: "cache"` for a
  connection that has no adapter, including after an edit that points it at another server.
- Scenario: user edits host and saves (reconnect); old adapter hangs on close. A grid refresh in
  the window shows the old server's rows marked as cache. Code read.
- Fix: call `r.cache.DropConnection(id)` right after winning teardown, before
  `disconnectAdapter`, in both paths (generation bump also refuses any in-flight store).

## Suspects (plan §9)

1. Concurrent `Router.Connect` on one id: dropped. `Router.Connect`'s only caller is
   `connections.Service.attemptConnect` (`git grep`), serialized per id by `inFlight`;
   `Service.Disconnect` aborts and waits for the attempt (`abortInFlight`). The residual
   Disconnect/Connect overlap is F2.
2. `CancelOp` ctx: confirmed as F1. Forwarding to the newer adapter is harmless: engines pop by
   opId from their own tracker (unknown id is a no-op); mongo matches `command.comment == opId`,
   a UUID, so no collision.

## Coverage

- Block 1 (contract and callees): done. `wire.fbs` read field by field (mirror checks in blocks 3
  and 5); `adapters/{adapter,registry,live}.go` read as callee; regeneration identical.
- Block 2 (adapterhost core): done. `host.go`, `throttle.go`, `op.go`, `router.go`, `data.go`,
  `wire.go` read in full. Throttle input is validated upstream (`connections/input.go:82-87`:
  finite, 0.01-1000), so NaN/Inf/burst edge cases are unreachable. `safeRun` puts only `%v` of the
  panic value in the error; stack goes to the log. `op:end` always emits after `safeRun`; the
  running entry is deleted in a defer. Mutate's invalidation `defer` is registered after path
  decode. Generation snapshot after miss check is safe (store refused on any later bump).
