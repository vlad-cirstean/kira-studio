# P168 Part 5 findings: Studio engine data plane and page wire protocol

Plan: `P168-part5-data-plane.md`. Base commit `de8ec4c` (plan survey); HEAD reviewed `8b29250`
(`p168-stream-a`, rebased on `v2.0` `61e367f`). Reviewer reports only; fixer follows plan §8.

Summary: 11 findings, 0 high, 1 medium (F11), 10 low. F4's binary half is tagged
`design-decision`. Routed: F4 renderer half to `P168-routed-from-streamA.md` (Part 12, Stream C).
Every other fix stays in Part 5 files plus Stream A one-hop files (kafka/sqs `read.go`, `dbmcp`
`render_test.go`).

## Checks

- `go vet` over `adapterhost`, `enginecache`, `page`, `tree`, `oplog`, `ipcfixture`: clean.
- `go test -race -count=1` over `adapterhost`, `enginecache`, `page`, `tree`, `oplog`: all pass.
- Wire regeneration: pinned `flatc` 25.9.23 (SHA-256 verified) run into scratch, `diff -r` against
  `SI/page/wire`, `SP/wire/`, `SP/wire.ts`: identical. No drift.
- `go test -race -count=1 ./apps/kira-studio/internal/ipcfixture/...` (real containers, Docker up,
  `TESTCONTAINERS_RYUK_DISABLED=true`, read mode): pass; all six `TestFixture_*` ran (no skip).
  Images as pinned in `adapters/testsupport` (clickhouse `clickhouse/clickhouse-server:26.3`, etc.).
- `bun test` `bridge-port`, `bridge-unwrap`, `e2e-real-build-lock` specs: 18 pass.
- Typecheck: green through every findings commit's pre-commit hook (all nine projects).
- `bun run test:ipc:fe:studio`: first run failed 7/7 on a missing browser
  (`chromium_headless_shell-1243`; container ships 1194, Playwright 1.63 wants 1243). After
  `playwright install chromium chromium-headless-shell`: 7 passed. Environment, not code.
- `bun run test:e2e-real:studio`: 6/6 fail, `Script not found "build:test"`: F11.

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

### F6 (low) An oversized page is cached in L2 and then refused from cache on every read

- `apps/kira-studio/internal/adapterhost/data.go:87` (`StorePageIfCurrent` before `respond`),
  `dataframe.go:235-239` (`oversizedPagePayload` refuses it), `enginecache/lru.go:86`
  (half-budget refusal is the only size gate).
- `cache.l2BudgetMb` accepts 8-1024 (`storage/model/settings.go:171`). At a budget of 130 MB or
  more, half the budget exceeds `maxResponsePayloadBytes` (64 MiB - 4 KiB). A page between those
  sizes is stored, then answered `E_QUERY` "too large". Each retry hits the cache and fails the same
  way without touching the server, while the dead entry holds up to half the budget and evicts
  useful pages.
- Scenario: budget 512 MB, 10,000-row page of a wide text table at ~80 MB. First read fails
  "too large" and caches 80 MB; the grid's retry and every reopen of that page repeat it.
  Code read. Not a restatement of Part 4 F8 (console materialisation): this is the grid `Read` path
  and the cache.
- Fix: in `Dispatcher.Read`, skip `StorePageIfCurrent` when
  `pageSizeEstimate(p.Size()) > maxResponsePayloadBytes` (share one helper with
  `oversizedPagePayload`).

### F7 (low) Wire zod schemas in `SP/data-ops.ts` and `SP/page.ts` are dead and already drifted

- `packages/shared/protocol/data-ops.ts:38-42,64-74,86-93,104-108,129-133,147-153,167-173,
  187-193` (`pageCursorSchema` and the seven `*RequestWireSchema`); `packages/shared/protocol/
  page.ts:7-15,31-38,72-79,575-618` (`typeClassSchema`, `columnDescriptorSchema`,
  `pagePositionSchema`, the four `*PageEnvelopeSchema`, `pageEnvelopeSchema`).
- `git grep` outside the defining file finds no runtime caller of any of them (only docs and one
  comment in `views/grid/fkPreview.ts:63`). `data.ts` sends requests unvalidated; Go `Validate`
  (`adapterhost/wire.go`) is the only gate. `cacheStatsSchema` is used only as a `z.infer` type
  source.
- Drift already present: filter cap counts UTF-16 units in zod (`max(4096)`) and runes in Go
  (`wire.go:19`), against the Part 2 `model.UTF16Len` rule; zod accepts `opId: ""`, Go rejects
  it. `page.ts:58-64` and `fkPreview.ts:63` describe "this validated wire schema" and an
  `E_BAD_REQUEST` that Go never sends: Go validation errors leave with no code at all
  (`dataframe.go:137-139` plus `respondError` taking a plain `fmt` error).
- Scenario: a maintainer tightens `readRequestWireSchema` believing it guards the wire; nothing
  changes. A renderer bug sending a 4,100-char astral filter passes Go's rune count. Code read.
- Fix: delete the unused schemas (keep the TS interfaces; derive `CacheStats` as a plain
  interface); correct the `page.ts` and `fkPreview.ts` comments (`fkPreview.ts` is Stream C:
  comment-only, route with F4's note or leave). In Go: count the filter with `model.UTF16Len`, and
  wrap `decodeAndValidate` failures in `adapters.New(adapters.CodeQuery, ...)` so they carry a code.

### F8 (low) Tree service leaks raw `*adapters.Error` to Wails: every engine code arrives as `E_INTERNAL`

- `apps/kira-studio/internal/tree/service.go:220-222,245-251,264-270,286-299,319-322` return the
  backend error unchanged; `:77` cites a `wrapErr` helper that does not exist; `:155,315` map a
  path decode failure to `ipcerr.Internal`.
- The renderer reads codes only from `ipcerr.Error`'s JSON `Error()` string
  (`packages/workbench/src/bridge/rpc.ts:28-55`, default `E_INTERNAL`). `adapters.Error.Error()`
  is the bare message (`adapters/errors.go:39`). So `E_ENGINE_DOWN` (adapter gone while the service
  still says connected, the F2/F3 teardown window), `E_CANCELLED` (user stopped the op in the
  Operations panel), `E_TIMEOUT` (throttle wait) and `E_QUERY` all reach the renderer as
  `E_INTERNAL`. A malformed path is reported as an internal fault, not bad input.
- Scenario: user cancels a slow `Describe` from the Operations panel; the definition tab shows
  "operation was cancelled" as an error with code `E_INTERNAL`. Today no tree caller branches on
  the code (`views/definition/state.ts:69-77`, `views/grid/state.ts:113-118`), so impact is
  wrong codes plus a broken P55 D5 contract, not a visible misroute. Code read.
- Fix: add the missing helper in `tree/service.go`: map `*adapters.Error` to
  `ipcerr.New(string(ae.Code), ae.Message)`, pass `*ipcerr.Error` through, wrap the rest with
  `ipcerr.Wrap`; apply it to every backend return. Use `ipcerr.BadRequest` for path decode errors.

### F9 (low) IPC fixture tier: backend asserts a hand-synced JSON copy, and one mask outlived its reason

- `apps/kira-studio/internal/ipcfixture/fixture_assert_test.go:16-22,104-125` (read mode compares
  against `testdata/<kind>.fixture.json`), `write.go:61-83` (`KIRA_IPC_FIXTURES=write` writes only
  `tests/ipc/<kind>/<kind>.fixture.ts`); `frozen.go` `configSectionMaskedPlaceholder` (kafka
  "Configuration" section masked wholesale).
- The `.fixture.ts` header says "The backend spec asserts every run's real response against this
  file". It does not: the Go assertion reads the JSON copy, which nothing regenerates ("produced
  once via `bun run`"). The frontend spec mocks from the `.ts`. A `.ts` edit (or a write-mode
  capture without a manual JSON update) lets the two halves drift silently, which is the exact
  split the anti-drift rule exists to prevent. Probe: loaded all six `.ts` modules with bun and
  compared to the JSON copies, key order normalised: five identical; clickhouse differs only in
  `serverVersion` (`26.3.33.24` vs `26.3.32.14`), which the assertion masks. In sync today, by hand.
- The kafka Configuration mask's own rationale ("every committed fixture reflects the pre-E11
  state ... zero rows") is no longer true: `kafka.fixture.ts:173+` carries real rows and
  `kafka.frontend.spec.ts:135` asserts 33 of them. The backend never checks those rows, so a Go
  regression in `DescribeTopicConfigs` mapping passes the backend half while the frontend half keeps
  mocking the old shape.
- Fix: make write mode emit both files from one capture (or make read mode parse the `.ts`
  module's two JSON arrays and delete `testdata/*.json`). Add a guard (bun unit spec, or Go reading
  both) that fails when they disagree modulo masks. Drop the kafka Configuration mask and re-capture
  with `KIRA_IPC_FIXTURES=write`; if config defaults genuinely vary by broker patch, mask values,
  not the section, and say so in the comment.

### F10 (low) No test crosses the real Go encoder into the TS decoder for non-tabular pages

- `apps/kira-studio/internal/ipcfixture/harness.go:173-260` calls `Dispatcher` directly and
  decodes `page.Page` in Go (`decode.go:71`): no FlatBuffers encode. The IPC frontend half decodes
  frames built by the TS test encoder (`tests/support/encodeFrame.ts`, a third copy of
  `page/encode.go` + `adapterhost/frame.go`). Only `tests/e2e-real/{postgres,mariadb,sqlite}`
  send a real Go frame through `decodeFrame`, all tabular.
- Gap: document, keyvalue and stream encoding (`encode.go:73-132`) and the optional scalars
  (`ttl_ms`/`memory_bytes`/`visibility_timeout_seconds` absent vs 0, `offset` null on keyset pages,
  `RedisType.object`, null bits in fixed columns) are never checked Go-to-TS. A Go-side mirror slip
  (for example writing `ttl_ms` 0 for a no-TTL key) passes every tier, because both test encoders
  agree with the TS decoder, not with Go. This is codec edge-case logic across two languages: it
  clears the `CLAUDE.md` test bar.
- Fix: a Go test in `adapterhost` encodes one response per page kind (each optional field both
  absent and set, a null row, a truncated row, a keyset position) through `encodeResponse` and
  writes golden bytes to `testdata/`; a bun unit spec decodes each with `decodeFrame` and asserts
  the logical page. Regenerate the golden files with the same `KIRA_IPC_FIXTURES=write` switch.

### F11 (medium) `test:e2e-real:studio` cannot run: fixture calls a removed `build:test` script

- `apps/kira-studio/tests/e2e-real/fixtures.ts:125`:
  `execFileSync('bun', ['run', 'build:test'], { cwd: ROOT_DIR, ... })`. Root `package.json` has
  `build:test:studio` and `build:test:space`, no `build:test`. The comment above the function
  (`fixtures.ts:108-110`) already names `build:test:studio`.
- Real run (this review, Docker up, Playwright chromium-headless-shell 1243 installed):
  `bun run test:e2e-real:studio` fails all 6 specs in `buildPrerequisites` with
  `error: Script not found "build:test"`. Decisive line: `Error: Command failed: bun run build:test`
  at `fixtures.ts:125`.
- Impact: the kept real-backend tier (`CLAUDE.md`) is dead, and it is the only tier that sends a
  real Go FlatBuffers frame through `decodeFrame` (see F10). Pre-commit hooks do not run it, so the
  break is silent.
- Fix: `['run', 'build:test:studio']`. Then run `bun run test:e2e-real:studio` and fix whatever
  the now-reachable specs report, same phase.

## Suspects (plan §9)

1. Concurrent `Router.Connect` on one id: dropped. `Router.Connect`'s only caller is
   `connections.Service.attemptConnect` (`git grep`), serialized per id by `inFlight`;
   `Service.Disconnect` aborts and waits for the attempt (`abortInFlight`). The residual
   Disconnect/Connect overlap is F2.
2. `CancelOp` ctx: confirmed as F1. Forwarding to the newer adapter is harmless: engines pop by
   opId from their own tracker (unknown id is a no-op); mongo matches `command.comment == opId`,
   a UUID, so no collision.
4. Validation errors carry no code: confirmed, folded into F7. Impact is cosmetic: the renderer
   treats a missing code as a generic error (`views/shared/viewOp.ts:21` gates only
   `E_ENGINE_DOWN`/`E_CONNECT`).
5. Filter rune vs UTF-16 count: confirmed, folded into F7 (the zod side is dead code).
3. Tree ops on `context.Background()`: dropped as a finding. Each runs inside `Host.RunOp` with a
   minted opId, so the Operations panel can cancel it (`CancelOp`), and `Router.Disconnect`/
   reconnect cancels it (`CancelOpsForConnection`). Only an abandoned renderer call keeps it
   running, which matches the data-op contract (stop button, never a timeout). `KeyTypes` path
   count is unbounded server-side (renderer caps 200, `BrowseView.vue`); a cap needs a renderer bug
   to matter, and the op is throttled (`keyTypes` in `throttledKinds`). Path decode code: F8.
6. Oversized page cached: confirmed as F6 (only above a 130 MB budget; default 64 MB refuses any
   page over 32 MB).
7. Projection order on a sorted L2 key: dropped. Every SQL adapter's `ResolveProjection`
   (`adapters/sqltext.go:253`) orders by ordinal position, so column order never depends on request
   order; the grid maps by name (`views/shared/page/columns.ts` `resolveColumnOrder`).
8. `generationTracker` growth: dropped. One small map entry per distinct path ever invalidated by a
   user action; bounded by objects touched in one app run. Not worth pruning logic.
9. `port.ts` recovery and `nextId`: dropped (block 5 coverage). The real stranding path is
   F5, where Go stops answering without closing the conn.
11. `emitJSON` back-pressure: dropped. `eventSub` (`host.go:59-122`) queues without bound and
    without blocking the producer; `drain` is the only sender; `close` drains before closing the
    channel. No `op:end` is dropped; ops still running at `Stop` are finished as "app exited" by
    `finishInFlight`. Queue growth only if the SQLite write wedges, which `Stop`'s `stopWait`
    already bounds at quit.
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
- Block 4 (enginecache): done. `cache.go`, `pages.go`, `counts.go`, `lru.go`, `generation.go`
  read in full. L2 key trims the filter, L3 key does not: only a cache-efficiency difference, since
  every engine trims before use (`adapters.WhereClause`, mongo `literal.go:701`, kafka JSON filter)
  and invalidation matches on connection/path meta for all filter variants. Stats timer firing after
  `detach` enqueues into a dead session's buffered channel: harmless. `Update` keeps LRU position
  (intended). Generation guard holds for every drop path.
- Block 5 (TS wire half and bridge): done. `SP/{frame,page,data-ops,port,wire}.ts`,
  `SD/{connection,tree,mutations,object-store}.ts`, `SF/bridge/{port,data,index,control}.ts` read
  in full; `apiControl.ts` read for `trust` uses. Field-by-field mirror against `wire.fbs` and
  `page/encode.go`: optional scalars (`ttl_ms`, `memory_bytes`, `visibility_timeout_seconds`,
  `offset`) written only when non-nil and decoded as null when absent; tokens absent means null;
  `Strategy`/`RedisType` (incl. `object`)/`Source`/`TypeClass` enums map 1:1 both ways; `generated`
  and `is_primary_key` both carried. No field present on one side only (except Go-only
  `FieldsAreColumns`, by design). F12 claims confirmed: `frame.ts` passes the `nulls` buffer through
  untouched; `views/stream/page.ts:40` ignores it and shows `''`. Renderer half appended to
  `P168-routed-from-streamA.md`. `assertPageStructure` runs only on `read`/`execute` (events and
  cache stats carry no chunks); it does not check offset monotonicity, but frames come only from
  this process and out-of-range offsets clamp in `subarray` (no crash). `port.ts`: requests before
  open wait on `ready`; `onclose` rejects every pending entry and sets `closed` before
  `rejectAllPending`, so no entry leaks; a timed-out control request leaves its server work
  running (only `ping`/`cache:*`/`invalidate` carry timeouts: cheap). No reconnect after `onclose`
  is by design (Wails supersedes per page load). `nextId` past int32 needs 2^31 requests:
  theoretical. Every array-typed `trust` in `index.ts`/`apiControl.ts` has `?? []`. `control.ts`
  shim still imported by 47 files: not dead. `SD` path codec mirrors `model.EncodePath`/
  `DecodePath`.
- Block 6 (tree, oplog): done. `tree/service.go`, `oplog/wire.go` read in full;
  `bridge/tree.go` read as caller. Cache hit served before `requireConnected` is P24 D5 by design.
  `putIfSinceUnchanged` guards a reconnect between fetch start and store. Truncated listings never
  cached. `Invalidate(nil)` drops the connection's rows. oplog: `op:start`/`op:end` pair by opId;
  `op:end` always follows `op:start` (`safeRun` recovers); an unmatched `op:end` falls back to kind
  `test` as designed; incognito ops never touch `OpsRepo` but still emit live; prune every 500
  completions plus at start; `ReconcileInterrupted` at start covers hard kills. `Command` text is
  stored as the engine set it (redaction is the engine's job; nothing here re-expands it). No oplog
  finding.
- Block 7 (fixtures and tests): done. `ipcfixture/{harness,frozen,decode,write,types,channels}.go`,
  `fixture_assert_test.go`, `clickhouse_test.go` read in full; other per-engine tests skimmed (same
  shape, all green live). `frozen.go` masks reviewed: `serverVersion`, tokens, endpoint,
  coordinator, `refresh:false`, node-order sort are each justified; kafka Configuration is not
  (F9). `SetEscapeHTML(false)` in `write.go` confirmed. `ST/ipc/*` frontend specs: green; kafka spec
  read for the config assertion. `ST/e2e-real/fixtures.ts` read (F11); the other e2e-real specs not
  reached at runtime because of F11; read only for their `decodeFrame` coverage (tabular only).
  `ST/support/encodeFrame.ts` read as the third encoder copy (F10). `ST/unit/{bridge-port,
  bridge-unwrap,e2e-real-build-lock}` green; build-lock spec still matches `fixtures.ts`'s lock
  functions. `packages/db-fixtures`: seeds scanned for `now()`/`UUID()`/`random` defaults; none
  reaches a frozen fixture (live comparison passes). Unit-test bar: a few thin Go tests exist
  (`TestByteLru_UpdateOnMissingKeyIsNoop`, `TestTruncateUTF8ToBoundary_NoTruncationNeeded`,
  `TestThrottle_SetToZeroRemovesLimiter`); `CLAUDE.md` makes the bar forward-only, so not reported.
  No true duplicate found.

### Coverage statement

Every one of the 110 owned files was reviewed, except as listed: `ST/ipc/<kind>.frontend.spec.ts`
(kafka read; other five skimmed: they passed live and only mock from the fixtures F9 covers);
`ST/e2e-real/{mariadb,postgres,multiwindow,sqlite}-real.spec.ts` and `support/*.ts` (skimmed: the
tier cannot start, F11; re-review after the fix runs them); `SD/connection.ts` (read for wire use
only: its validation mirror is Part 2's, closed); `packages/db-fixtures/support/*.ts` and seed SQL
(scanned for non-determinism only: consumed by Parts 3-4 suites, which pass); per-engine
`ipcfixture/*_test.go` other than clickhouse (skimmed). Generated `SI/page/wire`, `SP/wire/`
checked for drift only (none).
