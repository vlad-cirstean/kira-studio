# P173: Space git RPC and git-ui contract decisions

Source: `SPEC.md` row P173. Origin: P168 Part 17 F4 (rest), Part 16 F12, Part 18 F12, Part 19 F4.
Stream C. One sequential implementer. Every decision below is the user's; this plan records the
design, not an open choice.

**Start rule: implementation waits until P172 (Stream B) has landed on `v2.0`.** P173 edits 14
source files P172 also edits (see "Overlap with P172"), including the contract version both
phases bump. Rebase this worktree onto `v2.0` after P172 merges, then start step 1. Never run the
two implementers concurrently. P174 (Stream A, Studio) shares no source file; only
`docs/ARCHITECTURE.md` can conflict (text merge at landing).

## Current behavior (read from source at `bc41c80`)

### (1) Frame cap

- `apps/kira-space/internal/gitsock/frame.go:17-20`: `maxFrameBytes = 8 << 20`. Comment is stale:
  says the largest payload is a `RepoSummary`. `readFrame` allocates `make([]byte, n)` as soon as
  the header arrives, before any body byte. `writeFrame` copies header and body into a fresh buffer.
- `gitsock/server.go:249`: `rpcstream.Handlers.MaxFrameBytes = maxFrameBytes`. `rpcstream`
  (`internal/rpcstream/session.go:122-135`, `sendResult`) refuses a larger body with
  `E_FRAME_TOO_LARGE`.
- `bridge/gitstream.go:28-30`: `maxGitStreamFrameBytes = 8 << 20`, "reuses gitsock's own cap".
- `packages/git-ipc/src/socketChannel.ts:47`: `MAX_FRAME_BYTES = 8 * 1024 * 1024`, both
  directions (`drainFrames`, `post`).
- `streamChannel.ts` (Wails native stream) has no cap of its own.
- Wails v3.0.0-beta.21 (`pkg/application`): `streamMaxFrameBytes = 64 << 20`
  (`stream_transport.go:50`), so 32 MiB fits. Per-window out queue is 8 MiB / 256 frames, but
  `enqueue` admits one frame of any size into an empty queue (`stream_server.go:84`,
  `len(w.out) == 0 || …`), then blocks the producer. Global out budget 256 MiB. No Wails change
  needed.
- Stale "8 MiB frame cap" text: `gitsock/handshake.go:20`, `:25`; `gitsock/handshake_test.go:130`;
  `gitrpc/wire.go:165`.
- Pre-auth: `runHandshake` reads the hello with the same `readFrame` and cap
  (`handshake.go:85`). No connection-count cap in `server.go`. An unauthenticated same-user
  process can make the server allocate `maxFrameBytes` per connection for up to
  `handshakeReadTimeout` (10 s).
- Per-session queue: `rpcstream.NewSession` `sendCh` holds 16 frames, count-bounded, not
  byte-bounded.

### (2) Auto-fetch

- `gitsession/autofetch.go:139-179` `autoFetchTick`: `err != nil` from `RunRemote` disables;
  `!result.OK` disables unless `Kind == "OperationInProgress"`. `disabled` is also teardown's flag
  (`stopAutoFetch`), so a failure stop can never clear.
- Fetch kinds come from `gitops/errors.go` `ClassifyRemoteError` → `classifyOpErrorRules`. A fetch
  can produce: `AuthFailed` (prompt disabled, 401), `NetworkFailed` (`could not resolve host`,
  `connection refused`, `connection timed out`, and the catch-all `unable to access '` — which also
  matches HTTP 403/5xx and TLS errors), `RemoteNotFound`, `LockHeld` (`index.lock`, "another git
  process"), `Cancelled` (`remote.cancel` hits the shared slot, `setKillable(true)` at
  `remote.go:390`), `OperationInProgress`, `NotFound`, `Unknown`.
- `Cancelled` today disables auto-fetch: a user cancelling a remote op in any window while the
  silent tick holds the slot kills auto-fetch for the entry's life. Bug, fixed here.
- `RunRemote` error paths: `ErrRepoTornDown` (`entry.go:431`), spawn errors, ref read errors.
- Settings copy (`frontend/src/workbench/settings/GitPane.vue:143-145`) already promises "disables
  the timer until the next explicit fetch". Code never re-arms. Fixed here.
- Auto-fetch runs only for entries a non-quiet acquirer opened (VS Code via `gitsock`). The native
  Space conn opts out (`gitstream.go:216`), but shares the `RepoEntry`, so a marker must reach both
  hosts.
- Interval: `git.fetchAutoIntervalMinutes`, 0-1440, default 0.
- Nothing is logged: `RunRemote` with `conn == nil` starts no op (`remote.go:286-292`).

### (3) Regex search

Already documented as a limit (`docs/ARCHITECTURE.md:2916-2919`, Kelvin-sign case folding). User
decision: do nothing. Only a one-sentence decision note.

### (4) Failure visibility

- `packages/git-ui/src/App.vue:290-302`: one `sr-only` polite live region, fed by
  `opsState.announcement`, `detailState.announcement`, `graphView.announcement` and
  `reportAsyncError`. Sighted users see nothing for an op failure.
- `state/ops.ts`: 31 `composeOpFailureAnnouncement`/`#announceRejection` sites; `#runRemote`
  (`:1810`), `#runSimple` (`:1880`), `#announceRejection` (`:1866`).
- `state/graphView.ts:532-551`: `onCorrupted` re-opens; `onUnrecoverable` and a failed re-open only
  set `CORRUPTED_ANNOUNCEMENT`. A rejected `openStream` from `LoadMoreButton` reaches only
  `reportAsyncError`; from bootstrap it reaches the visible `boot-error-banner`.
- Visible precedents in the same file: `ConnectionBanner`, `ConflictBanner`,
  `boot-error-banner` (`App.vue:1730-1766`).
- Theme has shadcn-vue `Alert` (`packages/theme/src/components/ui/alert`, variants `destructive`,
  `warn`, `note`; root sets `role="alert"`). No toast primitive in theme, no `vue-sonner` anywhere.
  Kira Space has no toast channel by design (`workbench/TitleBar.vue:29`).
- **The ops panel is not in `packages/git-ui`.** It is Kira Space's Operations dock:
  `apps/kira-space/frontend/src/workbench/OperationsPanel.vue` over the shared
  `packages/workbench/src/components/OpLogPanel.vue`, fed by `apps/kira-space/frontend/src/state/ops.ts`
  (`createOpLogStore`) from Go's `apps/kira-space/internal/oplog` ring (500 records, in memory, lost
  on quit) through `bridge/ops.go` `OpsService` and `kira:op:update`.
- What already lands there: every `RunOp`, `UndoRun`, `RunRemote` (non-nil conn) and `RunRestack`
  with `StatusError` plus message — from the native conn and from every paired VS Code conn, since
  Space's Go process serves both. So push rejected, checkout refused and fetch auth failure are
  already recorded, in Space's dock, for both hosts. VS Code has no ops panel of its own.
- Not recorded today: auto-fetch failures, graph stream failures (reads are never logged), and
  failures before an op starts (request validation, transport rejection, client-side busy guard).

## Decisions

### D1. Frame cap 32 MiB everywhere it is defined

`maxFrameBytes = 32 << 20` in `gitsock/frame.go`; `maxGitStreamFrameBytes = maxFrameBytes`'s
value (32 MiB) in `bridge/gitstream.go` (separate package, keep a separate const, same value,
comment names the twin); `MAX_FRAME_BYTES = 32 * 1024 * 1024` in `socketChannel.ts`. One number on
all three, as today. No truncation, no result-shape change.

### D2. Pre-handshake read cap 64 KiB

The hello is small (label clamped to 200 bytes, client id 256). `conn` gains a per-connection read
limit: `newConn` starts it at `handshakeMaxFrameBytes = 64 << 10`; `handleConn` raises it to
`maxFrameBytes` after `runHandshake` succeeds, before `rpcstream.NewSession`. Unauthenticated
allocation drops from 32 MiB to 64 KiB per connection. `readFrame` takes the limit as a parameter;
`writeFrame` keeps `maxFrameBytes`.

### D3. Memory consequences, accepted

Recorded in `ARCHITECTURE.md`, no further code:
- Go per frame: `readFrame` allocates the declared size once; `encodeBody` plus `writeFrame` hold
  two copies of an outgoing body transiently (64 MiB peak for one max frame).
- Go per session: `sendCh` holds up to 16 frames, so the theoretical worst case rises from 128 MiB
  to 512 MiB, reached only by a paired client (or the app's own webview) issuing 16 concurrent
  near-cap requests. Writers block on the socket/Wails queue, so nothing grows past that. A byte
  budget would be new infrastructure for a trusted peer; not added.
- Wails: one oversize frame admitted into an empty per-window queue; global 256 MiB budget.
- JS: socketChannel joins the frame once (`Buffer.concat`), then UTF-8 decode and `JSON.parse`;
  the extension then posts to the webview (one structured clone). Peak about 4-5x frame size,
  transient, only on repositories that failed outright before.

### D4. Auto-fetch outcome classification

Pure function `autoFetchOutcome(kind string) autoFetchVerdict` in `autofetch.go`, three verdicts:

| Verdict | Kinds | Effect |
|---|---|---|
| `busy` | `OperationInProgress`, `Cancelled` | reschedule at the normal interval; failure count unchanged |
| `transient` | `NetworkFailed`, `LockHeld` | reschedule with backoff (D5); failure count +1 |
| `permanent` | `AuthFailed`, `RemoteNotFound`, `RemoteRefMissing`, `NotFound`, `Unknown`, any other kind | stop, set marker, log once (D6) |

Plus the existing busy paths (`Repo.Writing()`, no remote picked) unchanged. A Go error from
`RunRemote`: `ErrRepoTornDown` stops silently (entry is going away, no marker); any other error is
`permanent` with kind `Unknown` and `err.Error()` as message.

Evidence: `NetworkFailed`'s patterns are transport failures plus the `unable to access '`
catch-all. Some catch-all hits are permanent (403, TLS). Retrying them costs one fetch per cap
period (D5), so a misclassified permanent failure is cheap; stopping on a real outage would wrongly
need user action after every laptop sleep. `LockHeld` is another git process, gone in seconds.
`Cancelled` is a user cancelling the shared slot, never the remote's fault. `AuthFailed` cannot
self-heal: the tick has no prompter by construction (D23). `RemoteNotFound` needs a config change.
`Unknown` stops because the app cannot tell, and silent infinite retry would hide a real problem.

### D5. Backoff schedule

`nextAutoFetchDelay(interval time.Duration, failures int) time.Duration`:
`min(interval << failures, max(interval, 60 * time.Minute))`, shift clamped (`failures` capped at
16 before shifting) so it never overflows. `failures == 0` returns `interval`. Examples: interval 1
min → 2, 4, 8, 16, 32, 60, 60 …; 5 min → 10, 20, 40, 60; 120 min → 120 (never slower than the
user's own cadence). No attempt limit: an offline night must not stop auto-fetch. Success resets
`failures` to 0.

Rationale for the 60 min cap: a machine back online resumes within an hour; one failing `git
fetch` per hour is negligible load.

### D6. Stop state, marker, re-arm, log

- `autoFetchState` splits `disabled` (teardown only, permanent) from `stopped *AutoFetchStopped`
  (`Kind`, `Message`, `At` ISO string; cleared by re-arm) and adds `failures int`.
  `startAutoFetch`/`rescheduleAutoFetch` refuse while either is set.
- On stop: one op-log record via a new one-shot `oplog.Log.Record(meta, status, errMsg)` (finished
  record, `DurationMs` 0): kind `"autoFetch"`, source `"Auto-fetch"`, status `error`, message
  `"<remote>: <kind> — <first stderr line>"`. Only the stop is logged, never each retry.
- Re-arm: `RunRemote` with a non-nil conn, kind `fetch` or `pull`, `result.OK`, clears `stopped`
  and `failures`, then calls `EnsureAutoFetch` (keeps the C14-3 non-quiet gate). This makes the
  shipped settings copy true. A settings interval change does not clear `stopped` (the stop is
  about the remote, not the cadence).
- Wire: `AutoFetchStatus = { state: 'stopped'; kind: OpErrorKind; message: string; at: string }`.
  `StatusSummary.autoFetch: AutoFetchStatus | null` (`RepoEntry.Status` fills it; null while
  running, paused or never armed). New event `autoFetch.changed: { repoId: string; autoFetch:
  AutoFetchStatus | null }`, emitted on stop and on re-arm. `RepoEntry` holds a
  `notify.Emitter[AutoFetchChange]`; `Conn.Open` subscribes beside `entry.Subscribe` and the hold's
  unsubscribe drops both. Status carries cold start and reconnect; the event carries the change.
- Marker: `AppToolbar.vue`, beside the Fetch/Pull/Push group, rendered whenever
  `opsState.autoFetch` is non-null (also when write controls are hidden): a `codicon-warning`
  `TooltipIconButton`-style trigger with visible text "Auto-fetch stopped", tooltip
  `"<kind text> — Fetch to resume."`, `data-testid="autofetch-stopped"`. Clicking runs Fetch when
  the toolbar's own Fetch is enabled, else no action (tooltip only). One live-region announcement
  when it appears.
- Contract: one bump for the phase (P172's number + 1, expected 43 → 44), history entries in both
  `contract.go` and `validate.ts`.

### D7. Visible failure notice: inline banner, not toast

`components/FailureBanner.vue` (new), shadcn-vue `Alert variant="destructive"` from
`@theme/components/ui/alert`, mounted in `App.vue` directly under `ConnectionBanner`, outside the
`v-if` chain, same host-agnostic slot as the other banners. Same component in both hosts, since
both mount `App.vue`.

Why banner over toast:
1. A failure must stay until seen. Toasts auto-dismiss (WCAG 2.2.1 timing) and are easy to miss
   while the eye is on the grid; a stuck graph stream is a state, not an event.
2. No toast primitive exists in theme or either host; adding `vue-sonner` means a new dependency
   plus a `Toaster` mount per host, and Kira Space deliberately has no toast channel.
3. A floating toast covers grid rows in the narrow VS Code panel; an inline banner pushes layout.
4. Precedent: `ConnectionBanner`, `ConflictBanner`, `boot-error-banner` in the same file.

Behavior:
- Shows the latest failure only (title = action + reason, e.g. "Push failed — not a
  fast-forward."; description = first server line where `composeOpFailureAnnouncement` already
  shows one; hint line per D8). Newest replaces older. History lives in the ops panel.
- Accessibility: pass `role="region"` and `aria-label="Last failure"` (Vue fallthrough overrides
  `Alert`'s `role="alert"`), so the existing `sr-only` live region stays the single announcer — no
  double read. Keep the live region and every `announce` call unchanged.
- Actions: Dismiss (icon button, `aria-label="Dismiss"`). Retry only for a graph stream failure
  (re-opens the stream from row 0 through the same path the toolbar Refresh uses; a read, safe to
  repeat). No Retry for write ops: re-issuing push/checkout from a banner would skip the
  originating surface's own preflight and confirmation (force-push typed confirm, checkout
  auto-stash dialog). Hint text tells the user what to do instead.
- Ops link: new optional `MountOptions.onShowOperations?: () => void`, threaded to `App.vue` as a
  prop. Kira Space's `RepoGraphView.vue` passes a function that opens the dock
  (`if (!layoutStore.panel.operations.visible) layoutStore.toggleOperationsPanel()`); the banner
  then shows a "Show in Operations" button. Under `'vscode'` the prop is absent and the hint ends
  "Details: Kira Space → Operations." For a failure the op log never saw (D9) neither appears.
- Clears on Dismiss, on repo switch (`handleRepoOpened`), and when a later op or remote op in the
  same `OpsState` settles OK.

Sources (one App-level `failure` ref, latest wins):
- `OpsState.lastFailure: Ref<FailureNotice | undefined>` — every failure branch in `ops.ts` goes
  through one private `#fail(actionLabel, error, logged: boolean)` that sets both `announcement`
  (unchanged text) and `lastFailure`. `#announceRejection` routes through it with `logged: false`.
  The busy-guard message stays announcement-only (not a failure of anything).
- `GraphViewState.streamFailure: Ref<FailureNotice | undefined>` — set in `onUnrecoverable`, in the
  failed re-open branch, and when a `LoadMore`/refresh `openStream` rejects (not `cancelled`).
- `reportAsyncError` in `App.vue` also sets the banner (`transport-closed` still ignored).

Pinia declined for this state: `packages/git-ui` keeps per-mount class state (`OpsState`,
`GraphViewState`), several graph mounts live in one Kira Space window, and a module-singleton store
would mix repos; the notice belongs to the `OpsState` that produced it.

### D8. Retry hint table

`state/failureNotice.ts` (new): `FailureNotice` type and `composeFailureNotice(action, error,
logged)`, reusing `composeOpFailureAnnouncement` for the title. `RETRY_HINT:
Partial<Record<OpErrorKind, string>>`, e.g. `NonFastForward` "Pull, then push again.",
`AuthFailed` "Check your credentials, then try again.", `NetworkFailed` "Check the network, then
try again.", `DirtyWorktree`/`UntrackedWouldBeOverwritten` "Commit or stash your changes first.",
`LockHeld` "Wait for the other git process to finish, then try again.", `HookRejected` "Fix what
the hook reported, then push again.", `ProtectedBranch` "Type the branch name to confirm.",
`RemoteNotFound` "Check the remote's URL."; default "Try again." Graph stream: "Retry reloads the
graph."

### D9. What the ops panel keeps

- Unchanged: op failures that started an op record (push rejected, checkout refused, explicit
  fetch auth failure), both hosts, already in Space's dock.
- New: auto-fetch stop (D6).
- New: server-side graph stream failure. `handleGraphStream` (`gitrpc/graph.go`): when `w.Stream`
  or the walk setup returns an error and `ctx.Err() == nil`, call new
  `Conn.RecordFailure(repoID, kind, message)` (gitsession), which looks up the held entry and writes
  one record via `oplog.Log.Record` (kind `"graph.load"`, source `conn.ClientLabel`). Cancellation
  and teardown log nothing.
- New: client-detected corruption. New request `graph.reportFailure: { repoId: string; reason:
  'corrupted' } → {}`. No free text from the client: Go composes the message ("graph data stream
  was corrupted; the graph was reset"). Called once from `GraphViewState`'s `onUnrecoverable` (and
  the failed re-open), fire-and-forget, errors swallowed. Allowlisted in `gitstream.go`
  `allowedMethods` (read-class: writes nothing to git) and forwarded in VS Code
  `proxyHandlers.ts`.
- Not kept, by design: failures before any op starts (validation, `E_GIT_UNAVAILABLE`, busy guard)
  and anything when the transport itself is down. They show in the banner only; the banner omits
  the ops link for them (`logged: false`).
- `oplog` package doc and `ARCHITECTURE.md:1299` ("Auto-fetch … and every read are not logged")
  change to: "user-initiated git writes, plus auto-fetch stops and graph-load failures".

## Steps

One commit per step, Conventional Commits. Fast checks (`go vet`, `go test` for touched Go
packages, `pnpm -r typecheck`, lint) per commit; Playwright once, step 6.

### Step 1: `feat(space): raise git frame cap to 32 MiB, cap the pre-handshake read`

- `apps/kira-space/internal/gitsock/frame.go`: D1 const and comment; `handshakeMaxFrameBytes`;
  `readFrame(r, limit)`; `conn.limit` field set by `newConn`, `setLimit` method.
- `gitsock/server.go`: raise limit after `runHandshake` succeeds, before `rpcstream.NewSession`.
- `gitsock/handshake.go`: comments at `:20`, `:25` (no 8 MiB number; name the 64 KiB hello cap).
- `gitsock/handshake_test.go:130`: comment.
- `gitsock/frame_test.go`: pass the limit explicitly in the existing at-cap / over-cap tests; one
  over-cap case at `handshakeMaxFrameBytes` (same table, not a new test function).
- `apps/kira-space/internal/bridge/gitstream.go:28-30`: 32 MiB, comment.
- `apps/kira-space/internal/gitrpc/wire.go:165`: comment number.
- `packages/git-ipc/src/socketChannel.ts:47`: 32 MiB, comment.
- Check: `grep -rn "8 << 20\|8 \* 1024 \* 1024\|8 MiB"` over `apps/kira-space/internal/{gitsock,
  gitrpc,bridge}` and `packages/git-ipc` finds no frame-cap leftover (`codeworkspace` 8 MiB file-read
  gates are unrelated, keep).
- Not breaking on its own: step 3's contract bump makes the handshake refuse a mismatched extension,
  so an 8 MiB-cap client never meets a 32 MiB-cap server in practice.

### Step 2: `fix(space): retry transient auto-fetch failures with backoff, stop on permanent ones`

- `apps/kira-space/internal/gitsession/autofetch.go`: D4 `autoFetchOutcome`, D5
  `nextAutoFetchDelay`, D6 state split, `stopAutoFetchFor(kind, message)`, `rearmAutoFetch()`;
  `autoFetchTick` rewritten over the verdicts; doc comments updated (drop "no toolbar marker
  exists yet").
- `gitsession/remote.go`: re-arm after a successful explicit `fetch`/`pull` (D6).
- `apps/kira-space/internal/oplog/log.go`: `Record(meta Meta, status, errMsg string) Record`;
  package doc (D9).
- `gitsession/oplog.go`: `recordFailure(kind, source, message)` on `RepoEntry`.
- Tests (CLAUDE.md bar: boundary arithmetic and a multi-rule decision structure):
  - `autofetch_test.go`: table test for `nextAutoFetchDelay` (0, 1, cap crossing, interval above
    cap, large `failures` clamp); table test for `autoFetchOutcome` over every kind in D4.
  - Extend `TestAutoFetch_NeverPromptsAndDisablesAfterAuthFailure` (rename to
    `…StopsAfterAuthFailure`): assert `stopped.Kind == "AuthFailed"` and exactly one op-log record.
  - New real-git `TestAutoFetch_NetworkFailureBacksOff`: remote URL on a closed local port
    (`connection refused` → `NetworkFailed`); assert not stopped, `failures == 1`, timer armed.
  - No test for re-arm (one condition).

### Step 3: `feat(git-ipc,space)!: auto-fetch status and graph failure report on the wire`

- `packages/git-ipc/src/contract.ts`: `AutoFetchStatus`, `StatusSummary.autoFetch`, event
  `autoFetch.changed`, request `graph.reportFailure`.
- `packages/git-ipc/src/validate.ts`: event and request keys, `CONTRACT_VERSION` +1, history.
- `packages/git-ipc/src/index.ts`: export `AutoFetchStatus`.
- `packages/git-core/src/model/status.ts` and `wireConformance.test.ts`, only if conformance
  requires the core `StatusSummary` mirror (check with `codegraph_explore` first).
- `apps/kira-space/internal/gitpreflight/status.go`: `AutoFetch *AutoFetchStatus json:"autoFetch"`.
- `gitsession/status.go`: fill it from `RepoEntry` state.
- `gitsession/autofetch.go`: emitter, `AutoFetchChange`.
- `gitsession/conn.go`: subscribe in `Open`, emit `autoFetch.changed`, unsubscribe with the hold;
  `RecordFailure(repoID, kind, message)`.
- `apps/kira-space/internal/gitrpc/contract.go`: version +1, history; wire types in `wire.go`.
- `gitrpc/handlers.go`: register `graph.reportFailure`; handler in `gitrpc/graph.go` beside
  `handleGraphStream`, plus D9's server-side failure record in `handleGraphStream`.
- `apps/kira-space/internal/bridge/gitstream.go`: allowlist `graph.reportFailure`.
- `bridge/gitstream_classification_coverage_test.go` (and `gitstream_test.go` if it lists counts):
  classify the new method.
- `apps/kira-space-vscode/src/proxyHandlers.ts`: `'graph.reportFailure': forward(…)`.
- `apps/kira-space-vscode/src/extension.ts`: forward `autoFetch.changed` to the graph provider.
- `apps/kira-space-vscode/src/panelView.ts`: `notifyAutoFetchChanged`.
- `rpc.test.ts`/contract-shape tests: update only where they enumerate methods or the version.
- Bump checks per `ARCHITECTURE.md:2708` (both numbers equal).

### Step 4: `feat(git-ui): show the auto-fetch stopped marker`

- `packages/git-ui/src/state/ops.ts`: `autoFetch: Ref<AutoFetchStatus | null>`, from
  `statusSummary` and the `autoFetch.changed` event (filtered by repoId), reset on repo switch.
- `packages/git-ui/src/bridge/client.ts` only if events need registering there.
- `packages/git-ui/src/components/AppToolbar.vue`: D6 marker.
- `packages/git-ui/src/state/liveAnnouncements.ts`: one composed announcement text.

### Step 5: `feat(git-ui): visible failure banner with retry hint in both hosts`

- `packages/git-ui/src/state/failureNotice.ts` (new): D8.
- `packages/git-ui/src/components/FailureBanner.vue` (new): D7, Tailwind `kv:` utilities, no
  `<style>` block, `<script setup lang="ts">`.
- `state/ops.ts`: `lastFailure`, `#fail`, route every failure branch (31 sites; grep confirms none
  left calling `composeOpFailureAnnouncement` directly outside `#fail`).
- `state/graphView.ts`: `streamFailure`; `graph.reportFailure` call (D9).
- `App.vue`: mount banner, `failure` ref, `reportAsyncError`, clear rules, Retry wiring,
  `onShowOperations` prop.
- `packages/git-ui/src/main.ts`: `MountOptions.onShowOperations`.
- `apps/kira-space/frontend/src/views/repo/RepoGraphView.vue`: pass `onShowOperations`.
- Confirm `Alert` utilities render styled in the VS Code webview bundle (the layout spec's
  screenshot or a computed-style check in step 6); if the extension's Tailwind source scan misses
  `packages/theme`, add the `@source` line in that build, same as `Button` already needs.

### Step 6: `test(e2e): failure banner and auto-fetch marker in Kira Space and the VS Code webview`

E2E only, as host verification; no unit tests.
- `apps/kira-space/tests/ui/repo-graph-failures.spec.ts` (new) over `support/gitStreamMock.ts`:
  failed `remote.run` (`NonFastForward`) shows banner with hint and "Show in Operations" that opens
  `[data-testid="operations-panel"]`; `status.get` with `autoFetch` stopped shows the marker; a
  corrupted graph chunk twice shows the stream banner, Retry re-opens.
- `apps/kira-space-vscode/tests/interaction/graph-failures.spec.ts` (new) over
  `support/fakeGraphHost.ts`: same banner (no ops button, text hint), marker via
  `autoFetch.changed`.
- Both assert the live region text still updates and the banner has no `role="alert"`.
- Run the full `apps/kira-space` UI suite and the extension's interaction/layout projects once;
  fix what breaks in follow-up commits.

### Step 7: `docs: record P173 decisions`

- `docs/ARCHITECTURE.md`:
  - Git module section near `:2857-2858`: frame cap 32 MiB, D2 hello cap, D3 memory note; method
    and allowlist counts recomputed from source (`:2857`, `:3336`), contract version.
  - `:1299` op log paragraph: D9 additions and gaps.
  - New "Auto-fetch" paragraph: D4 table, D5 schedule, D6 stop/marker/re-arm.
  - "Failure visibility" paragraph: D7 choice and reasons, where records live.
  - `:2916` search note: one sentence, "P173: accepted as is; no in-UI note, no Go-side shim
    (user decision)".
  - Known open items: "P173 failure banner and auto-fetch marker unobserved in a real VS Code host
    (P173)." Delete once checked in a real VS Code window against a running Kira Space.
- `apps/kira-space/frontend/src/workbench/settings/GitPane.vue:143-145`: copy now true; adjust only
  if wording no longer matches D6 ("stops after a credential or remote error; transient network
  errors retry").
- This plan: result section (commits, checks run, deviations).

## File ownership (Stream C, P173)

| File | Step |
|---|---|
| `apps/kira-space/internal/gitsock/frame.go`, `frame_test.go` | 1 |
| `apps/kira-space/internal/gitsock/server.go` | 1 |
| `apps/kira-space/internal/gitsock/handshake.go`, `handshake_test.go` | 1 (comments) |
| `apps/kira-space/internal/bridge/gitstream.go` | 1, 3 |
| `apps/kira-space/internal/bridge/gitstream_classification_coverage_test.go`, `gitstream_test.go` | 3 |
| `apps/kira-space/internal/gitrpc/wire.go` | 1, 3 |
| `apps/kira-space/internal/gitrpc/contract.go` | 3 |
| `apps/kira-space/internal/gitrpc/handlers.go` | 3 |
| `apps/kira-space/internal/gitrpc/graph.go` | 3 |
| `apps/kira-space/internal/gitsession/autofetch.go`, `autofetch_test.go` | 2, 3 |
| `apps/kira-space/internal/gitsession/remote.go` | 2 |
| `apps/kira-space/internal/gitsession/oplog.go` | 2 |
| `apps/kira-space/internal/gitsession/status.go` | 3 |
| `apps/kira-space/internal/gitsession/conn.go` | 3 |
| `apps/kira-space/internal/gitpreflight/status.go` | 3 |
| `apps/kira-space/internal/oplog/log.go` | 2 |
| `packages/git-ipc/src/socketChannel.ts` | 1 |
| `packages/git-ipc/src/contract.ts`, `validate.ts`, `index.ts`, `rpc.test.ts` | 3 |
| `packages/git-core/src/model/status.ts`, `wireConformance.test.ts` (only if needed) | 3 |
| `apps/kira-space-vscode/src/proxyHandlers.ts`, `extension.ts`, `panelView.ts` | 3 |
| `packages/git-ui/src/state/ops.ts` | 4, 5 |
| `packages/git-ui/src/state/liveAnnouncements.ts` | 4 |
| `packages/git-ui/src/state/failureNotice.ts` (new) | 5 |
| `packages/git-ui/src/state/graphView.ts` | 5 |
| `packages/git-ui/src/components/AppToolbar.vue` | 4 |
| `packages/git-ui/src/components/FailureBanner.vue` (new) | 5 |
| `packages/git-ui/src/App.vue`, `main.ts` (`bridge/client.ts` if needed) | 4, 5 |
| `apps/kira-space/frontend/src/views/repo/RepoGraphView.vue` | 5 |
| `apps/kira-space/frontend/src/workbench/settings/GitPane.vue` | 7 (copy, if needed) |
| `apps/kira-space/tests/ui/repo-graph-failures.spec.ts` (new), `tests/ui/support/*` | 6 |
| `apps/kira-space-vscode/tests/interaction/graph-failures.spec.ts` (new), `tests/interaction/support/*` | 6 |
| `docs/ARCHITECTURE.md` | 7 |
| `docs/v2.0/plans/P173-space-git-contract.md` | 7 (result section) |

### Overlap with P172 (Stream B, `docs/v2.0/plans/P172-space-socket-trust.md` §4)

Shared source files, exact:
- `apps/kira-space/internal/bridge/gitstream.go` (P172 steps 1, 2 comments; P173 steps 1, 3)
- `apps/kira-space/internal/bridge/gitstream_classification_coverage_test.go`, `gitstream_test.go`
- `apps/kira-space/internal/gitrpc/wire.go`, `contract.go`, `handlers.go`
- `apps/kira-space/internal/gitsock/handshake.go`, `handshake_test.go`, `server.go`
- `packages/git-ipc/src/contract.ts`, `validate.ts`, `rpc.test.ts`
- `apps/kira-space-vscode/src/extension.ts`, `proxyHandlers.ts`
- `docs/ARCHITECTURE.md`

Plus a semantic dependency: both bump `ContractVersion`/`CONTRACT_VERSION`; P173 must bump from
P172's landed value. Rule: **P173 implementation starts only after P172 is committed and merged to
`v2.0`**; the implementer rebases this branch first and re-reads every shared file. Concurrent
running is not allowed.

P174 (Stream A): no shared source file. `docs/ARCHITECTURE.md` only; resolve as a text merge.

## Verification

- Per step: `go vet` and `go test` for `./apps/kira-space/internal/{gitsock,gitsession,gitrpc,
  bridge,oplog,gitpreflight}/...`; `pnpm -r typecheck`; lint; `vitest` for `packages/git-ipc`.
- Step 6: Kira Space Playwright UI suite; extension interaction and layout projects.
- Frame cap: `frame_test.go` at-cap/over-cap with 32 MiB bodies; `socketChannel.test.ts` over-cap
  header. A real 32 MiB result through Wails is not exercised end to end (no repository of that
  size in the sandbox); state it in the result section.
- Limits: no real VS Code host (the interaction harness renders the webview bundle in Chromium
  against a fake host; recorded as a Known open item), no macOS (nothing here is OS-specific; the
  pre-handshake cap is platform-neutral Go).
- Orchestrator acceptance greps: `maxFrameBytes = 32 << 20`; `MAX_FRAME_BYTES = 32 * 1024 * 1024`;
  a real caller of `nextAutoFetchDelay` in `autoFetchTick`; `FailureBanner` mounted in `App.vue`;
  `Alert` imported in `FailureBanner.vue`; `graph.reportFailure` in `gitstream.go` allowlist and
  `proxyHandlers.ts`; `onShowOperations` passed in `RepoGraphView.vue`; no remaining direct
  `composeOpFailureAnnouncement` call in `ops.ts` outside `#fail`.

## Result

Commits (branch `p168-stream-c`): `24d8f86` frame cap, `b595308` auto-fetch backoff and stop,
`1c3f0d4` wire (contract 43 to 44), `e82700d` marker, `9bcc03a` banner, `2319b7f` e2e, plus the
docs commit.

Checks run: `typecheck`, `lint`, `lint:dead`, `go build`, `go vet`; `go test -race` on gitsession,
gitsock, gitrpc, bridge, oplog, gitpreflight; `bun test` for git-core, git-ipc, git-ui, kira-space-vscode;
Kira Space UI tier (171 tests, WebKit); extension interaction and layout projects (64 tests,
Chromium).

Deviations:
- `oplog.Log.Record` returns nothing.
- Go `AutoFetchStatus` lives in `gitpreflight`.
- Component and `App` prop is `showOperations`, not `onShowOperations` (Vue treats `on*` as a
  listener); `MountOptions.onShowOperations` keeps the plan's name.
- A user cancel (kind `Cancelled`) announces but raises no banner.
- `reportAsyncError` skips its generic banner while a stream failure is shown.
- The VS Code webview is read-only, so its e2e failure source is a corrupted graph stream, not a
  failed remote op; the remote-op banner is covered in Kira Space only.
- Found and fixed: the webview bundle put preflight above every unprefixed Tailwind utility
  (layer order by first import); `main.ts` now imports `tailwind.css` first.

Not verified: a real VS Code host, macOS, a real 32 MiB result through Wails.
