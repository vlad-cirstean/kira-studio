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

### F4 (low) Part 4 F12, Go and protocol half: stream tombstones encode as empty text

- `apps/kira-studio/internal/page/builder.go:320-326` (`StreamRow.Body string`), `:352-353`
  (`Push` always passes a non-nil pointer); `adapters/kafka/read.go:113-116` (`body := ""` when
  `rec.Value == nil`), `:69-70` (nil header value becomes `""`); `adapters/sqs/read.go:185`
  (`aws.ToString(m.Body)`); `packages/shared/protocol/page.ts` `createStreamPageBuilder` row type.
- Scenario: kafka record with null value (compaction tombstone) and a record with `""` value both
  reach the renderer and `dbmcp` as `""`. Code read.
- Confirmed claims (plan §7): the wire already carries a per-row null bit (`Chunk.nulls`;
  `columnScratch.appendValue(nil, ...)` sets it, `scratch.go:67-70`), so a null body needs no
  `wire.fbs` change. `dbmcp/render.go:263-269` `cellAt` already maps the null bit to `nil`, and
  `streamMessage.Body` is `*string` (`render.go:247`): `dbmcp` emits `"body": null` with no edit.
  Renderer side: confirmed in block 5.
- Fix (null half, Stream A): `StreamRow.Body` to `*string`; `Push` passes `row.Body` straight to
  `appendValue`; kafka sets `Body` nil when `rec.Value == nil`; kafka `headersToPlain` emits JSON
  `null` for a nil header value; sqs passes `m.Body` as-is. TS `createStreamPageBuilder` row type
  `body: string | null`, `push` writes null via the existing null path. Update the `dbmcp`
  `render_test.go` builders and any kafka/sqs test literal. Re-capture `ST/ipc/kafka` and the kafka
  IPC fixture only if the seed has a tombstone (it does not today: fixture shape unchanged).
- Binary half (`strings.ToValidUTF8` at `kafka/read.go:89,115`): `design-decision`. Needs a choice
  between a per-row encoding flag (new chunk or bitset in `StreamPage`, a `wire.fbs` change plus
  `ST/support/encodeFrame.ts`) and a text marker. A marker sent before the renderer understands it
  is ambiguous text (plan §7). Fixer files it as its own `SPEC.md` phase.
- Renderer half routed: `needs-other-part-file: apps/kira-studio/frontend/src/views/stream/page.ts
  (Part 12, Stream C)`; appended to `P168-routed-from-streamA.md` F12 entry.

### F5 (low) Oversized error frames and a failed `Send` silently strand every later request

- `apps/kira-studio/internal/adapterhost/dataframe.go:273-280` (`respondError`, no size bound),
  `session.go:121-124` (`writeLoop` closes the `Session` on any `Send` error),
  `bridge/stream.go` `ServeEngineStream` (keeps calling `Receive`).
- Responses are capped at `maxResponsePayloadBytes`; error frames are not. Wails `Send` returns
  `ErrStreamTooLarge` above 64 MiB (`wails/v3 pkg/application/stream.go:235`). `writeLoop` then
  closes only the `Session`; the Wails conn stays open, so the renderer gets no `onclose`.
  `ServeEngineStream` keeps receiving, and `HandleDataFrameAsync` returns at once on a closed
  session. Every later data request is dropped with no answer; data ops have no client timeout.
- Scenario: an engine error echoing a huge statement (console paste of a 70 MB literal into an
  engine that quotes input back). Today only reachable through driver text, so low likelihood;
  the failure is total and silent. Code read plus Wails source.
- Fix: cap the error message in `respondError` (for example 64 KiB, cut on a rune boundary with a
  `…` suffix). In `writeLoop`, on `ErrStreamTooLarge` log and continue; close only on
  `ErrStreamClosed`. Optionally give `StreamSession` a `Close()` so a dead writer closes the conn
  and the renderer sees `onclose`.

## Suspects (plan §9)

1. Concurrent `Router.Connect` on one id: dropped. `Router.Connect`'s only caller is
   `connections.Service.attemptConnect` (`git grep`), serialized per id by `inFlight`;
   `Service.Disconnect` aborts and waits for the attempt (`abortInFlight`). The residual
   Disconnect/Connect overlap is F2.
2. `CancelOp` ctx: confirmed as F1. Forwarding to the newer adapter is harmless: engines pop by
   opId from their own tracker (unknown id is a no-op); mongo matches `command.comment == opId`,
   a UUID, so no collision.
4. Validation errors carry no code: open until block 5 (renderer handling).
10. `enqueueResponse` frame size: confirmed as F5 (error frames only; responses are pre-checked).
12. Encode panics: dropped. `encodeSource`/`EncodePage`/`encodeTypeClass`/`encodeStrategy`/
    `encodeRedisType` panics are reached only from `encodeResponse` inside `HandleDataFrame`'s
    `recover`. `pushCacheStats` encodes only `CacheStats` (no enum, no page): no panic path.
    `encodeError` panic falls back to `internalErrorFrame` (id 0; that request then hangs, but the
    builder cannot panic on a small string).

## Coverage

- Block 1 (contract and callees): done. `wire.fbs` read field by field (mirror checks in blocks 3
  and 5); `adapters/{adapter,registry,live}.go` read as callee; regeneration identical.
- Block 2 (adapterhost core): done. `host.go`, `throttle.go`, `op.go`, `router.go`, `data.go`,
  `wire.go` read in full. Throttle input is validated upstream (`connections/input.go:82-87`:
  finite, 0.01-1000), so NaN/Inf/burst edge cases are unreachable. `safeRun` puts only `%v` of the
  panic value in the error; stack goes to the log. `op:end` always emits after `safeRun`; the
  running entry is deleted in a defer. Mutate's invalidation `defer` is registered after path
  decode. Generation snapshot after miss check is safe (store refused on any later bump).
- Block 3 (data frames, session, page Go side): done. `session.go`, `dataframe.go`, `frame.go`,
  `page/{chunk,scratch,builder,encode}.go` read in full. `maxDataFrameBytes` matches Wails
  `streamMaxFrameBytes` (64 MiB, beta.21). Cancel travels over Wails RPC (`bridge/ops.go`), not this
  stream, so a full slot pool cannot block a cancel. `queuedBytes` overshoot is bounded by producers
  racing the check; pages are already resident, so no real memory change. int32 casts
  (`AffectedRows`, cache stats counters, frame id, `RowCount`) cannot overflow at real values
  (`RowCount` <= 10,000). `truncateUTF8ToBoundary` back-off bounded at 3 bytes, matching TS.
  `createUint32Vector` fast path keeps 4-byte alignment (length prefix aligned by `Prep`).
  Ignored `AppendRow` errors (`clickhouse/console.go:119`, `read.go:228`, `postgres`/`mysqlfamily`
  `console.go:144`, `sqltext.go:447`) are width-safe by construction (row built from the same
  header). `FieldsAreColumns` is Go-only by design (`dbmcp` masking); no renderer path reads it.
