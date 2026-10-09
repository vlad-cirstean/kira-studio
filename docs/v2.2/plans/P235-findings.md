# P235 review findings

Base: `605f63e3f` (P227 close-out). Head reviewed: `dc09e6be4`. Scope: P228-P234 (column fit, git module
look, ADE refresh, P231 Space flow fixes, P232 Studio flow fixes, P233 hook shim gate, P234 docs).

Six findings: one med, five low. Areas with nothing real: P233 hook gating (shim exits unless both
`KIRA_AGENT_HOOK_TOKEN` and `KIRA_TERMINAL_ID` are set; hooks ride only `--settings` on Kira launches;
Studio does not use `agenthooks`; no path writes `~/.claude/settings.json`), `appwire` composition roots
(build and teardown order match the pre-move `main.go`), `orderedWrites` (lane identity check covers
drop-then-reopen; a failed write does not stall the lane), git transport `ensureOpen` (`Conn.Open` is
idempotent per connection, a closed channel never reconnects), ADE refresh and remote-only worktree
fixes, Docker flow harness (label-scoped cleanup, no prune).

## F1 (med) gRPC unary calls now fail at 30 s with no way to raise it

- Files: `apps/kira-studio/internal/grpcclient/call.go:56-57,155`, `apps/kira-studio/internal/bridge/grpc.go:209-210,250`.
- Dimension: functional correctness.
- Wrong: `defaultUnaryTimeout` is 30 s, and the comment says it "matches httpclient's default request
  timeout". It does not: `api.requestTimeoutMs` defaults to 0 (no timeout) since P90. Before P232 a
  unary call had no deadline; Stop ended it. `GrpcCallArgs.timeoutMs` exists, but the frontend never
  sends it, so the override is dead outside tests. `TimeoutMs` is also unvalidated: a negative value
  becomes an already-expired deadline.
- Scenario: a unary RPC that legitimately takes 45 s (report build, slow backend). It now fails with
  `E_TIMEOUT no response from host:port within 30s`, every time, and no setting changes that.
- Fix: P232 A-1's silent-server case is already covered by the 5 s dial bound. Derive the unary
  default from the global `api.requestTimeoutMs` (0 = none) in the bridge. If the user wants a
  separate gRPC setting, ask them first. Clamp `TimeoutMs` to `0..3_600_000` like
  `httpclient/options.go:77`. Correct the comment, and the matching sentence in
  `docs/ARCHITECTURE.md:52`.

## F2 (low) every schema Describe adds a blank "grpc" row to the Operations panel

- File: `apps/kira-studio/internal/bridge/grpc.go:161-172`.
- Dimension: architecture/maintainability.
- Wrong: when `opId` is set, Describe runs through `Host.RunOp`, so it emits `op:start` and `op:end`.
  `Incognito` only skips the op_log write. `oplog/wire.go:194` still pushes the live record. The
  record has no command (`SetCommand` is never called), so it lands in the ring
  (`createOpLogStore.ts`, `MAX_RECORDS`) and counts toward `runningCount` while it runs.
- Scenario: type a gRPC target and edit it a few times. Each debounced describe, and each abort
  (shown as cancelled), leaves an unlabelled `grpc` row in the panel. These rows push real
  query and call rows out of the 500-row ring.
- Fix: register the cancel without op events. One option is a small `Host` method that adds a
  derived context to `running` for `CancelOp`, with no emit. If RunOp stays, at least call
  `op.SetCommand("describe → " + args.Target)` with the unresolved target, so the row is legible.

## F3 (low) an abort during variable resolution never cancels the Describe

- File: `apps/kira-studio/frontend/src/views/grpcrequest/schemaQuery.ts:91-105`.
- Dimension: functional correctness and resources.
- Wrong: `describeSchema` awaits target and metadata resolution (`Promise.all`,
  `loadDynamicGenerator`), and only then calls `signal.addEventListener('abort', …)`. An `AbortSignal`
  that is already aborted never fires a listener added later.
- Scenario: the user edits the target while the previous query is still resolving variables.
  TanStack aborts the old query during the await. The old Describe still dials, then holds a
  goroutine and a connection for up to 15 s against a target nobody wants.
- Fix: after the awaits, check `signal?.aborted` and throw before calling `grpcDescribe`. Or create
  `opId` and register the listener before the first await.

## F4 (low) a graph drag that lands on the stored width leaves the grid stale

- File: `packages/git-ui/src/components/CommitGrid.vue:446-455`.
- Dimension: functional correctness.
- Wrong: `setColumnWidth` sets `graphAuto = false` first. Then it returns early when the clamped
  value equals `widths.value.graph`. In auto mode the drawn width is the lane floor, not the stored
  width, so the early return skips `rebuildColumns()` and `emitGraphWidth()`. `graphWidth()` already
  reports the new width.
- Scenario: first-ever mount, stored graph 200, lane floor 43, column drawn at 43. The user drags the
  graph handle to exactly 200 (or presses keys until it reaches 200). The column stays 43 wide, and
  the handle and the uncommitted strip stay at 43. New rows paint 200 px SVGs that get clipped. This
  lasts until some unrelated rebuild runs.
- Fix: compare against the effective width (`graphWidth()` before the change), or always rebuild
  when `graphAuto` flipped.

## F5 (low) server-build `EmitTo` broadcasts payloads that carry no window key

- File: `internal/shell/emitto_server.go:5-9`.
- Dimension: architecture/correctness (`-tags server` sandbox build only).
- Wrong: the comment says "Listeners filter by their own ids". Several `EmitTo` channels carry no id
  that a listener could filter on:
  - `SignalTo` sends the close-flush request with a nil payload (`internal/shell/closeflush.go:142`).
  - `AdeTaskOpenSession` sends `OpenSessionEvent`, which has task, branch and session ids but no
    window (`apps/kira-space/internal/bridge/adetask.go:46`).
  - `ChannelMobileOpenLaunch` (`mobilelaunch.go:57`) has the same gap.
- Scenario: in `e2e-real` with two pages, closing one window makes every page run its
  flush-before-close. Focusing an ADE session opens it in every page.
- Fix: add the target window key to those payloads and filter on it in the frontend listeners. Or
  narrow the comment and record the limitation in `docs/DEV_ENVIRONMENT.md`.

## F6 (low) P233 result cites a commit that is on no branch

- File: `docs/v2.2/SPEC.md:662`.
- Dimension: maintainability (docs).
- Wrong: "net-reverted by `67f8e9ba3`". That object exists, but no branch contains it, because it is
  a pre-rebase hash. The commit on `v2.0` is `10852247c` (`refactor(space,studio): drop MCP injection
  and legacy cleanup from P233`).
- Fix: replace the hash with `10852247c`.
