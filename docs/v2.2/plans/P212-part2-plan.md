# P212 Part 2 plan: mobile agents web writes and phone terminal attach

SPEC row: "Mobile agents web writes (amendment): backlog add and reorder, TUI input for stuck
agents, start/next/prev workflow stage, phone attach of the Claude Code terminal (desktop shows
disconnected plus a reconnect button)". Stream B, worktree `/home/user/kira-v21-G`, branch
`v2.1-stream-G`, base `42a875211` (P212 Part 1 landed).

Paths repo-relative. `KS` = `apps/kira-space`, `KSF` = `apps/kira-space/frontend`, `ADE` =
`KSF/src/ade/v2`, `MOB` = `KSF/mobile`, `MW` = `KS/internal/mobileweb`, `WB` =
`packages/workbench/src`. Line numbers as of `42a875211`; re-read before editing.

Discovery ran through `codegraph_explore` against the main checkout's index (same commit; this
worktree has no `.codegraph/`). The implementer executes named changes and needs no CodeGraph run.
To discover anything this plan does not name, run `sh scripts/codegraph-setup.sh` in the worktree
first, then use `codegraph_explore`.

## 1. Requirements (user's words, expanded)

The phone app (tabs Backlog, Need You, Plan) stays read-only except:

- R1. Backlog: add a new item.
- R2. Backlog: reorder items (touch).
- R3. Respond to agents stuck in their Claude Code TUI: send text and keystrokes.
- R4. Start a workflow (run the task's current stage).
- R5. Move a task to the next or previous workflow stage.
- R6. Attach the phone to an agent's PTY at the phone's own size, so Claude Code reflows to a
  readable font. While the phone holds it, the desktop shows that terminal as taken over.
- R7. Desktop gets a button that reconnects the terminal to the desktop (desktop size back, phone
  detached).
- R8. Same rules as desktop: every write goes through the service methods desktop calls; no rule is
  duplicated on the server.
- R9. Security: CSRF and per-device cookie on every write; stronger gating for agent input, since
  terminal input is code execution as the user.
- R10. Live updates over the existing SSE hub; tests; docs.

## 2. What exists (discovery findings)

Mobile server (`MW`):

- `routes.go:36` `routes()` is the whole API; `appMux` (`:58`) wraps each row as
  `noStore(csrfGuard(deadline(path, withDevice(handle))))`. `deadline` (`:83`) special-cases
  `/api/events` and `/api/pair` by path. `route` (`:20`) has `method, path, access, handle`.
- `auth.go`: `withDevice` (`:96`) authenticates the `__Host-kira-space` cookie, rate limits per
  device (`deviceRate` 20/s burst 40), touches last-seen. `csrfGuard` (`:183`) runs
  `sameOriginRequest` (Origin must be this https host; `Sec-Fetch-Site` absent or `same-origin`) for
  non-safe methods only.
- `ratelimit.go` `limiterSet` (bounded, swept). `server.go:85-87` builds three sets.
- `server.go:119` TLS `NextProtos: []string{"http/1.1"}` over `tls.NewListener`: HTTP/1.1 only, so
  connections are hijackable and browsers open at most 6 per origin.
- `events.go` `Hub`: SSE fan-out with an allowlist `eventChannels` (`:18`); window-addressed
  `EmitTo` never reaches it (`appevent.Tap` forwards `Emit` only). `kira:mobile:*` channels are
  desktop only.
- `reader.go` `Reader` (read slice of `bridge.AdeTaskService`), `DeviceStore`.
- `respond.go` `writeServiceError` maps only `E_BAD_REQUEST`/`E_NOT_FOUND`; everything else is 500.
- `headers.go` CSP `connect-src 'self'`.
- `server.go:247` `Close`: cancels base ctx, `Hub.CloseAll`, `Shutdown` (does not track hijacked
  conns).
- `routes_test.go:47` `TestRoutes_NoPostBesidesPair` asserts read-only; `:13` walks allowlist incl.
  tempting paths `/api/ade/backlog/add`, `/api/terminal`.
- Storage: `mobile_devices` (`KS/internal/storage/migrations/0021_p212_mobile_devices.sql`), repo
  `KS/internal/storage/repos/mobiledevices.go` (`MobileDeviceRow`, `ByID`, `Insert`, `List`),
  projection `model/mobiledevice.go`. Settings `model.MobileSettings{Enabled, HTTPSPort, SetupPort}`
  (`model/settings.go:83`), TS mirror `KSF/src/state/settingsDomain.ts`, shared zod
  `packages/shared/domain/mobile.ts`.
- Bridge `KS/internal/bridge/mobile.go` `MobileAccessService` (Wails-bound) owns the server
  lifecycle via `embedded.Service`; `Revoke` calls `Server.Revoke` (`server.go:313`). Desktop
  channels `ChannelMobilePairing/Devices/Status` (`bridge/events.go:24-30`).
- Wiring `KS/main.go:139-243`: `mobileHub`, `appevent.NewTap`, `terminalRegistry` (`:174`),
  `wireTracker` (`:453`), `terminalSvc` (`:180`, `ComposeAgent`/`AbortAgent` func fields),
  `adeTaskSvc` (`:199`), `windows := shell.NewWindowRegistry()` (`:197`), `mobileSvc` (`:235`).

ADE services desktop calls (all in `KS/internal/bridge/adetask.go`, engine `KS/internal/ade`):

- Backlog: `AddBacklogItem` (`:333`, trims, `validateAdeName`), `MoveBacklogItem` (`:355`,
  `toIndex >= 0`), engine `board_writes.go:478/:521`, repo `adebacklog.go:104` `Move` clamps and
  rewrites dense in one tx. Desktop optimistic splice in `ADE/queries.ts:157` `useMoveBacklogItem`;
  desktop reorder is up/down buttons (`ADE/backlog/AdeBacklogPage.vue:52 onMove`).
- Stage: `SetTaskStage` (`:595`) -> engine `runs.go:878`: under `taskMu`, refuses no workflow,
  `HasRunning` ("stop its running agents first"), unknown or skipped stage; snapshots workflow;
  `SetStage`; `clearStepMessages`; `notifyBoard`. `"done"` is a valid target. Desktop prev/next in
  `ADE/panel/AdeStageMover.vue:21-32` (options = blocks plus Done; prev/next skip `skipped`; disabled
  while a run is `running`).
- Start: desktop `ADE/run/useTaskAction.ts:21`. Action from `ADE/board/actions.ts` `taskCell`:
  `run` (agent stage: opens `AdeRunDialog` for branch names and message; script stage: `StartRun`
  with `{branchNames: {}, message: ''}`), `stage` (user stage with session: `adeDialogs.stage` ->
  `LaunchStage`), `takeOver`, `approve`, `retry`, `done` (`StageDone`), `archive`. `StartRun`
  (`runs.go:218`) refuses user stages and an already-started stage; `''` names derive from the task
  title.
- Interactive launches (`LaunchStage` `launches.go:394`, `TakeOver` `:130`) return `adewire.Launch`
  `{terminalId, sessionId, command, cwd}`; the PTY is opened by the renderer
  (`ADE/dialog/deliver.ts:32 openLaunch` -> terminals store `openTerminalSession` -> bound
  `TerminalService.Open` with that window's key). Tracker `Prepare` holds a pending intent until
  Compose (PendingTTL 2 min). Duplicate deps object built in `ADE/state/adeTakeOver.ts:59-68` and
  `ADE/review/AdeReviewAgentPanel.vue:64-72`.
- Send: `AdeTaskService.Send` -> engine `launches.go:562` -> `Tracker.Send` (`tracker.go:616`):
  bracketed paste plus Enter into the record's terminal; refused for headless.
- Needs-you (`ADE/board/needsYou.ts`): `question` = TUI session with `activity === 'input'` (has
  `sessionId`); `stuck run` = headless run stuck (action Take over when it has a session).
- Errors: `adeTaskError` (`adetask.go:76`) maps sentinels to `E_INVALID`, `E_NOT_FOUND`,
  `E_PREPARING`.

Terminal/PTY layer (`internal/terminal`, shared with Kira Studio):

- `Registry` (`session.go:324`): one `Session` per id, indexed by window; `Write`, `Resize`
  (TIOCSWINSZ), `Close`, `WindowOf`, `CloseWindow`, `AgentSessions`, `OnChange`.
- `Service.OpenWithCoalescedOutput` (`service.go:108`) wires `OnData` to a 16 ms / 16 KiB coalescer
  that `EmitTo(windowKey, ChannelTerminal, Event{base64})`. No server-side scrollback; history lives
  only in the window's xterm.
- `BoundService` (`bound.go`) is the Wails surface both apps embed; `Write`/`Resize` take any id from
  the renderer.
- Desktop xterm: `WB/terminal/terminalRenderer.ts` (`getOrCreateTerminal`, `fitTerminal`,
  `applyTerminalAppearance`, deps `appearance/onTerminalOutput/writeTerminal`, cleanup via
  `WB/state/tabRuntime.ts cleanupTabRuntime`), `useTerminalMount.ts` (ResizeObserver -> resize).
  Kira Space ADE terminals start headless (`createTerminalsStore.attachHeadlessTerminal`) and render
  in `ADE/sessions/AdeTuiPane.vue` through `TerminalHostView`.
- Tracker (`KS/internal/ade/tracker.go:121`): `byRecord` record id -> terminal id.

Frontend:

- Mobile build `KSF/vite.mobile.config.ts` aliases `@ade`, `@shared`, `@theme`, `@workbench`; no
  `@bindings`. `MOB/api/http.ts` (`getJson`, `postJson`), `MOB/api/events.ts` (SSE),
  `MOB/state/useAgentsModel.ts` (cards, needs), screens in `MOB/screens/`, router `MOB/router.ts`.
- Libraries present: `@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0 (MIT), `vue-draggable-plus`
  0.6.1 (MIT, SortableJS MIT) wrapped by `WB/util/useSortableReorder.ts` (forceFallback, handle,
  `moveId` rule identical to `AdeBacklogRepo.Move`), `@vueuse/core` 15 (`useWebSocket`,
  `useLocalStorage`, `useEventListener`), shadcn-vue `dialog`, `switch`, `button`, `input`,
  `textarea`. Go: `github.com/coder/websocket` v1.8.15 (ISC) already in `go.sum` (indirect),
  `hashicorp/golang-lru/v2` (`expirable`) already used, `x/time/rate`.
- Tests: `KS/tests/mobile/` Playwright (`mobile-ios` WebKit, `mobile-android` Chromium) against a
  Node mock (`support/mockServer.ts`); Playwright 1.63 has `page.routeWebSocket`. Desktop
  `KS/tests/ui/mobile-access.spec.ts`, channel map `KS/tests/ui/support/ipcChannels.ts`.

## 3. Decisions (each with its driving requirement)

D-write-surface (R1, R2, R4, R5, R8). Each write is one `routes()` row, POST only. Handlers call the
same `AdeTaskService` methods desktop calls (validation and error mapping included) through a small
non-bound adapter `bridge.MobileWriter`. No ADE rule is reimplemented in `mobileweb`.

D-stale (R5, R4, R8). A phone acts on a board that may be seconds old. A stage move or start built
from stale state could jump two stages. Add optional `FromStageID` to `SetTaskStageArgs`,
`StartRunArgs` and `LaunchStageArgs`; the engine checks it inside the existing `taskMu` lock and
returns new `ade.ErrStale` (bridge `E_STALE`, HTTP 409). Desktop leaves it empty: behaviour
unchanged. This is the only correct place: a pre-check in `mobileweb` would race the lock.

D-idempotency (R1, R2, R9). Every phone POST except `/api/pair` requires an `Idempotency-Key`
header (UUID, generated per user intent, reused on retry). Server store: `expirable.LRU` keyed
`deviceID|key`, TTL 10 min, cap 1024. Hit with same method+path replays the stored status and body;
same key on another path is 422 `E_IDEMPOTENCY_MISMATCH`; a key still in flight is 409
`E_IN_FLIGHT`. Reorder is index-based like desktop (Move clamps); a replay after success returns the
cached result instead of moving twice.

D-permissions (R9). Two per-device flags in `mobile_devices` (migration 0022):
`can_write` ("Change backlog and stages") and `can_agent_input` ("Reply to agents and control their
terminals"). Plus a global setting `mobile.agentInput` (default false). Agent input needs both the
global switch and the device flag. Both are set only in the desktop Settings > Mobile access pane:
the desktop toggle is the explicit desktop confirmation. New pairings get `can_write = 1`,
`can_agent_input = 0`; existing rows get 0 for both (they were approved as read-only). Rejections:
403 `E_WRITE_OFF` / `E_AGENT_INPUT_OFF`, with a phone hint naming the pane.

D-rate (R9). New per-device `writeRate` 1/s burst 10 for every write row; terminal attach 1 per 2 s
burst 3 per device; inside a terminal socket, input frames 100/s burst 200 and resize 10/s burst 20
per connection (over limit: frame dropped, `{type:"throttled"}` sent once). Input frame cap 16 KiB;
socket read limit 64 KiB.

D-audit (R9). Every write and every attach/release/reclaim logs one `slog.Info("mobileweb: write",
"scope","mobileweb","device",id,"action",name, ids…)` line into the app log. No message text or
keystrokes are logged. Persisted audit table deferred (DD9).

D-reorder-ux (R2). Drag handle per row, reusing `WB/util/useSortableReorder.ts` (vue-draggable-plus,
forceFallback works with touch). Handle has `touch-none` so the list still scrolls everywhere else.
Up/down buttons rejected: two 44 px buttons per row crowd a phone row and need N taps for long
moves. `moveId` semantics equal `AdeBacklogRepo.Move`, so `toIndex = ids.indexOf(toId)`.

D-launch (R3, R4). `LaunchStage` and `TakeOver` produce a Launch whose PTY a desktop window must open
(window-owned PTYs, closed with the window). Keep that invariant: the server emits a desktop-only
`kira:mobile:openLaunch` with `EmitTo` to one real (non-ephemeral) window. That window runs the
same `openLaunch` desktop uses and acks via bound `MobileAccessService.LaunchOpened`. The phone
request waits for the ack (20 s), else 504 `E_LAUNCH_TIMEOUT`. No window: 409 `E_NO_WINDOW`.

D-reply (R3). Two levels. Quick reply: `POST /api/agent/sessions/{id}/send` reuses `Send` (paste
plus Enter) without taking the terminal. Full control: terminal attach (D-terminal). Both need
agent-input permission (sending text to Claude Code can run commands).

D-terminal-transport (R6). WebSocket via `github.com/coder/websocket` (ISC), promoted from
indirect to direct. Requirement SSE+POST cannot meet: keystrokes must arrive in order. On HTTP/1.1
the browser spreads concurrent POSTs over up to 6 connections, so two keystroke POSTs can reorder.
Serialising them client-side costs one round trip per key. Gorilla is BSD and also fine; coder is
already in the module graph and supports `context` and close reasons. Separate from the SSE hub:
the hub broadcasts small JSON to every phone; terminal bytes are per-session and per-device.

D-terminal-buffer (R6). Server-side ring per agent terminal, 1 MiB, absolute byte offsets, filled by
an output tap on every claude-code PTY from spawn. On attach the phone gets the ring then the live
tail. Reconnect sends `?from=<offset>`; replay resumes if the offset is still in the ring, else
`{type:"reset"}` plus the whole ring. The ring is the backpressure: each socket writer reads from its
own offset; a slow phone falls behind and resets, never blocks the PTY reader. Hand-rolled: no Go
ring library gives absolute-offset resumable reads (`container/ring` is per element,
`smallnest/ringbuffer` has no offsets). ~60 lines with a unit test.

D-takeover (R6, R7). Single controller per terminal, enforced in Go:

- `desktop` (default): window `Write`/`Resize` apply.
- `phone(device, connected)`: phone input and size apply; window `Write` dropped; window `Resize`
  recorded as "desktop size", not applied.
- `phone(device, offline, until)`: socket lost; same gate; after 60 s grace returns to `desktop`.
- Return to desktop resizes the PTY to the recorded desktop size (Claude Code redraws on SIGWINCH).
- Transitions to desktop: desktop Reconnect (explicit dims), phone Release button or leaving the
  terminal screen, grace expiry, 15 min without phone input, device revoked or its agent-input flag
  off, global agent input off, mobile server stop, PTY exit (entry dropped).
- A second device attaching while another holds: 409 `E_TERMINAL_BUSY`. The same device attaching
  again replaces its old socket (`{type:"replaced"}`).
- Desktop output never stops (desktop xterm keeps the full history behind an overlay); no desktop
  replay needed on reconnect.

D-terminal-scope (R9). Phone addresses a session by ADE session id, never a terminal id. Attach is
allowed only for a running TUI task session whose terminal is live and was launched as
`claude-code` (resolved through new `Tracker.TerminalOf`). Plain shell terminals are never reachable.

D-phone-terminal-ui (R6). xterm.js through the existing `WB/terminal/terminalRenderer.ts`
(`getOrCreateTerminal` with phone deps, `fitTerminal`, `applyTerminalAppearance`,
`cleanupTabRuntime` on leave). Socket via VueUse `useWebSocket` (auto reconnect, reactive URL with
`from`). Font size A-/A+ (8 to 20, default 12) in `useLocalStorage`; refit then resize. Key bar:
Esc, Tab, Shift-Tab, Ctrl-C, arrows (honour `term.modes.applicationCursorKeysMode`), Enter, sticky
Ctrl. Compose row (`Input` plus Send) for reliable iOS typing; paste through `term.paste()` (honours
bracketed paste). Layout follows `window.visualViewport` resize (soft keyboard).

D-confirm (R4, R5). Phone confirms every Start, Back, Next and Take over in one shadcn `Dialog`
(`MOB/components/ConfirmDialog.vue`); the text names the stage and what happens (agents start, run
stops). Mis-taps are common on a phone; these act on running work.

D-live (R10). No new phone SSE channel. Writes trigger the same `kira:adetask:*` pushes; phone
mutations also invalidate their query on success. Terminal hold state is desktop-only
(`kira:mobile:terminals`, carries device labels).

D-csp (R6). CSP `connect-src` becomes `'self' wss://<request Host>` (Host is already allowlisted by
`guard`). Older WebKit does not match `wss:` against `'self'`.

Shared-code refactors (R8, no duplication):

- `ADE/board/stageMoves.ts` `stageMoves(blocks, stageId, runs)` -> `{options, at, prev, next, live}`;
  `AdeStageMover.vue` and the phone both use it.
- `ADE/backlogOrder.ts` `withMovedItem(result, {id, toIndex})` (the splice in
  `useMoveBacklogItem.onMutate`); desktop and phone mutations both use it.
- `ADE/dialog/useLaunchOpener.ts` `useLaunchOpener()` -> `open(launch)` (track plus
  `openTerminalSession` plus `openLaunch`), replacing the inline deps in `adeTakeOver.ts:59` and
  `AdeReviewAgentPanel.vue:64`; the mobile launch handler uses it too.

## 4. Go design

### 4.1 Storage and settings (commit 1)

- `KS/internal/storage/migrations/0022_p212_mobile_permissions.sql`:
  `ALTER TABLE mobile_devices ADD COLUMN can_write INTEGER NOT NULL DEFAULT 0;`
  `ALTER TABLE mobile_devices ADD COLUMN can_agent_input INTEGER NOT NULL DEFAULT 0;`
- `repos/mobiledevices.go`: `MobileDeviceRow` gains `CanWrite, CanAgentInput bool`; columns list,
  `ByID`, `Insert`, `List` updated; new `SetPermissions(id string, write, agentInput bool) error`
  (`RequireOneRow`, refuses revoked rows: `AND revoked_at IS NULL`).
- `model/mobiledevice.go`: `CanWrite bool json:"canWrite"`, `CanAgentInput bool
  json:"canAgentInput"`. `packages/shared/domain/mobile.ts` `mobileDeviceSchema` mirrors.
- `model/settings.go`: `MobileSettings.AgentInput bool json:"agentInput"` (default false),
  `MobilePatch.AgentInput *bool`; TS `settingsDomain.ts` `mobileSettingsSchema` mirrors.
- `MW/pairing.go:132` `finishPairing` row sets `CanWrite: true`.
- `MW/reader.go` `DeviceStore` unchanged (reads go through `ByID`).

### 4.2 Stale guard in the engine (commit 2)

- `adewire/wire.go`: `FromStageID string json:"fromStageId,omitempty"` on `SetTaskStageArgs`
  (`:681`), `StartRunArgs` (`:574`), `LaunchStageArgs` (`:666`). TS `ADE/wire.ts` adds
  `fromStageId?: string` to the three.
- `ade/board_writes.go`: `var ErrStale = errors.New("ade: task moved on")`; helper
  `staleStage(tc *taskCtx, from string) error` returns
  `fmt.Errorf("%w: the task is now at another stage", ErrStale)` when `from != "" &&
  tc.task.StageID != from`.
- `runs.go:878` `SetTaskStage(ctx, taskID, stageID, fromStageID string)`: check right after
  `loadTaskCtx`, before the `stageID == tc.task.StageID` no-op. `bridge.SetTaskStage` passes
  `args.FromStageID`. Update the engine tests' call sites.
- `runs.go:218` `StartRun` and `launches.go:394` `LaunchStage`: same check after `loadTaskCtx`.
- `bridge/adetask.go:76` `adeTaskError`: `errors.Is(err, ade.ErrStale)` -> `ipcerr.New("E_STALE",
  …)`. `validateAdeItemID(args.FromStageID)` when non-empty in the three bridge methods.

### 4.3 mobileweb write routes (commit 4)

`route` becomes:

```go
type route struct {
	method string
	path   string
	access access
	perm   perm   // permNone | permWrite | permAgentInput
	kind   kind   // kindPlain | kindStream (SSE, long-poll) | kindUpgrade (WebSocket)
	action string // audit name; "" for reads
	handle func(http.ResponseWriter, *http.Request, repos.MobileDeviceRow)
}
```

`appMux` order per row: `noStore(csrfGuard(rt, deadline(rt, h)))`, where `h` for a device row is
`withDevice(requirePerm(rt, writeLimit(rt, idempotent(rt, audited(rt, handle)))))`.

- `csrfGuard(rt, next)`: same-origin check when `!isSafeMethod || rt.kind == kindUpgrade`.
- `deadline(rt, next)`: skips `kindStream` and `kindUpgrade` (replaces the path special case; a
  write deadline set before hijack would kill the socket after 30 s).
- `requirePerm`: `permWrite` needs `dev.CanWrite`; `permAgentInput` needs `dev.CanAgentInput &&
  s.cfg.AgentInputEnabled()`. 403 codes per D-permissions.
- `writeLimit`: `s.writeRate.allow(dev.ID)` for perm rows (new `limiterSet` 1/s burst 10);
  `attachRate` (every 2 s, burst 3) for the upgrade row.
- `idempotent` (POST rows only): new file `MW/idempotency.go`, type `idemStore` over
  `expirable.NewLRU[string, *idemEntry](1024, nil, 10*time.Minute)`. Entry `{route string,
  done chan struct{}, status int, body []byte}`. Header missing or not a UUID: 400
  `E_IDEMPOTENCY_KEY`. Captures the response through a small recording writer, stores it only for
  status < 500 (a 5xx may be retried with the same key and run again).
- `audited`: one `slog.Info` after the handler with device id, action and the ids from the request
  (handlers put them in a per-request value).
- Body: `http.MaxBytesReader` 64 KiB, `json.Decoder.DisallowUnknownFields`.
- `respond.go` `writeServiceError` adds: `E_INVALID` 422, `E_STALE` 409, `E_PREPARING` 409,
  `E_TERMINAL_BUSY` 409, `E_NO_WINDOW` 409, `E_LAUNCH_TIMEOUT` 504. Messages of these codes are
  the engine's user-facing text (already shown on desktop); still never internal errors.

New rows:

| Method, path | perm | action | calls |
|---|---|---|---|
| `POST /api/ade/backlog/items` `{text}` | write | `backlog.add` | `Writer.AddBacklogItem` |
| `POST /api/ade/backlog/move` `{id, toIndex}` | write | `backlog.move` | `Writer.MoveBacklogItem` |
| `POST /api/ade/tasks/stage` `{taskId, fromStageId, stageId}` | write | `task.stage` | `Writer.SetTaskStage` |
| `POST /api/ade/tasks/run` `{taskId, fromStageId}` | write | `task.run` | `Writer.StartRun` (names `{}`, message `""`) |
| `POST /api/ade/tasks/launch` `{taskId, fromStageId}` | write | `task.launch` | `Writer.LaunchStage` (D-launch) |
| `POST /api/agent/sessions/{id}/send` `{message}` | agentInput | `session.send` | `Writer.Send` |
| `POST /api/agent/sessions/{id}/take-over` `{}` | agentInput | `session.takeOver` | `Writer.TakeOver` (`stopIfRunning: true`, D-launch) |
| `GET /api/agent/sessions/{id}/terminal` (upgrade) | agentInput | `terminal.attach` | `Terminals.Serve` (4.6) |

`fromStageId` is required (non-empty) on the three task rows: the phone always knows what it saw.
`GET /api/me` adds `permissions: {write, agentInput}` (agentInput = device flag and global switch)
and `agentInputGlobal` so the phone can say which switch is off.

`MW/writer.go`: `type Writer interface` with the seven methods above (wire arg types from
`adewire`, `LaunchResult{SessionID string}`), and `Config` gains `Writer Writer`, `Terminals
TerminalBroker`, `AgentInputEnabled func() bool`. A nil `Writer` answers 503 `E_UNAVAILABLE`.

`MW/server.go`: `New` builds `writeRate`, `attachRate`, `idem`; `maintain` sweeps them;
`Close` calls `cfg.Terminals.ReleaseAll("server stopped")` before `Shutdown`; `Revoke` calls
`cfg.Terminals.ReleaseDevice(id)` after `Hub.DisconnectDevice`. New `SetDevicePermissions`-driven
release: `Server.PermissionsChanged(id)` calls `ReleaseDevice` when agent input went off.

`MW/headers.go`: CSP built per request with `connect-src 'self' wss://` + `r.Host`.

### 4.4 bridge adapter and launch rendezvous (commits 4, 5)

`KS/internal/bridge/mobilewrite.go` (not registered with Wails, so nothing new is bound):

```go
type MobileWriter struct {
	Svc      *AdeTaskService
	Launches *MobileLaunches
}
```

Each method forwards to the `AdeTaskService` method of the same name (its validation, its error
mapping). `LaunchStage` / `TakeOver`: get the `Launch`, then `Launches.Open(ctx, launch, taskID,
branchID)`.

`KS/internal/bridge/mobilelaunch.go`:

- `MobileLaunches{Emit appcore.Emitter, Window func() (string, bool), mu, waiters
  map[terminalID]chan string}`.
- `Open`: `Window()` (none: `E_NO_WINDOW`); register waiter; `EmitTo(key,
  ChannelMobileOpenLaunch, MobileOpenLaunchEvent{Launch, TaskID, BranchID})`; wait for ack, ctx
  or 20 s (`E_LAUNCH_TIMEOUT`); a non-empty ack string is the desktop's error, returned as
  `E_INVALID`.
- `Ack(terminalID, errText string)` resolves a waiter; unknown id is a no-op.
- `MobileAccessService.LaunchOpened(args MobileLaunchOpenedArgs{TerminalID, Error})` (bound) calls
  `Ack`.
- `internal/shell/registry.go`: `AnyRealKey() (string, bool)`: smallest non-ephemeral key
  (deterministic). main.go passes `windows.AnyRealKey` as `Window`.
- `bridge/events.go`: `ChannelMobileOpenLaunch = "kira:mobile:openLaunch"`,
  `ChannelMobileTerminals = "kira:mobile:terminals"`; both stay off `MW/events.go eventChannels`.

### 4.5 Terminal arbiter hook in `internal/terminal` (commit 7)

Shared package; Kira Studio passes nothing and stays byte-identical in behaviour.

```go
// Arbiter decides who drives an agent session's input and size, and sees its output.
// nil (Kira Studio) means the window always does.
type Arbiter interface {
	Opened(terminalID string, cols, rows int)
	Output(terminalID string, b []byte) // reader goroutine; must not block
	Exited(terminalID string)
	AllowWrite(terminalID string) bool
	AllowResize(terminalID string, cols, rows int) bool // records the window's size
}
```

- `BoundService.Arbiter Arbiter` (field, not a method: not bound).
- `Service.OpenWithCoalescedOutput(p, windowKey, terminalID, tap func([]byte), onExit func())`:
  `OnData` calls `tap` (when non-nil) then `coalescer.push`; `OnExit` calls `onExit` after
  `coalescer.finish`. Studio's single caller passes `nil, nil`.
- `BoundService.Open`: when `agent && b.Arbiter != nil`, pass `tap`/`onExit` bound to
  `args.TerminalID` and call `Arbiter.Opened(id, cols, rows)` after a successful open.
- `BoundService.Write` / `Resize`: when `b.Arbiter != nil` and the gate says no, return nil
  (silent, same as writing to a closed session).
- `KS/internal/ade/tracker.go`: `TerminalOf(recordID string) (string, bool)` reading `byRecord`
  under `mu`.

### 4.6 `KS/internal/mobileterm` (new, commit 8)

Files:

- `ring.go`: `Ring{buf []byte, start, end int64}` with `Append(b)`, `ReadFrom(off int64, max int)
  (data []byte, next int64, overrun bool)`, `Snapshot() (data []byte, end int64)`, `End()`. Cap
  1 MiB.
- `broker.go`: `Broker` implements `terminal.Arbiter` and `mobileweb.TerminalBroker`.
  - `New(Deps{Registry interface{Write; Resize}, Sessions func(sessionID string) (terminalID string,
    ok bool), Now, OnChange func([]Hold)})`.
  - `entries map[terminalID]*entry`; `entry{mu, ring, state, deviceID, label, conn *phoneConn,
    desktopCols, desktopRows, phoneCols, phoneRows, graceTimer, idleTimer, lastInput, notify chan
    struct{} (cap 1)}`.
  - `Opened`: create entry with desktop size. `Output`: `ring.Append` under `entry.mu`, non-blocking
    send on `notify`. `Exited`: close the conn with `{type:"exit"}`, drop entry, `OnChange`.
  - `AllowWrite`: state is desktop. `AllowResize`: record desktop size; true only in desktop.
  - `Attach(sessionID, dev, cols, rows, from int64) (*phoneConn, error)`: resolve terminal via
    `Sessions`; errors `E_NOT_FOUND`, `E_TERMINAL_BUSY` (other device). Same device: replace.
    Set phone state, stop grace, `Registry.Resize(phone size)` inside `entry.mu` (orders against
    a racing Reclaim).
  - `Input(c, b)`, `Resize(c, cols, rows)`: only when `c` is the entry's current conn; bump
    `lastInput`; reset idle timer.
  - `Disconnected(c)`: socket gone; state offline, start 60 s grace timer -> `toDesktop`.
  - `Release(c)`: phone said done -> `toDesktop`.
  - `Reclaim(terminalID, cols, rows)`: desktop button; `0,0` means recorded desktop size.
  - `ReleaseDevice(deviceID)`, `ReleaseAll(reason)`.
  - `toDesktop(e, reason)`: close conn with `{type:"reclaimed"|"released"|"timeout"|"revoked"}`,
    stop timers, `Registry.Resize(desktop size)` when it differs from the phone size,
    state desktop, `OnChange`.
  - `Holds() []Hold{TerminalID, SessionID, DeviceID, Label, Connected, Since, ReturnsAt}`.
  - Timers use `Deps.Now` plus `time.AfterFunc`; tests inject a fake clock through a `afterFunc`
    seam.
- `serve.go`: `(*Broker).Serve(w, r, dev repos.MobileDeviceRow, sessionID string)`:
  `websocket.Accept(w, r, &websocket.AcceptOptions{})` (default origin check, plus `csrfGuard`
  upstream), `SetReadLimit(64 KiB)`. Query `cols`, `rows` (validated with `terminal.ValidDim`),
  `from` (optional). Writes `{type:"hello", offset, cols, rows}` then the snapshot (or the tail
  from `from`, or `{type:"reset"}` plus snapshot when overrun) as binary frames of at most 32 KiB.
  Writer goroutine: waits on `notify` or a 25 s ping tick; `ReadFrom(offset)`; write timeout 10 s;
  error -> `Disconnected`. Reader loop: binary frame = input bytes (per-conn limiter, 16 KiB cap);
  text frame JSON `{type:"resize",cols,rows}` or `{type:"release"}`. Close codes: 4000 released,
  4001 reclaimed, 4002 replaced, 4003 exit, 4004 timeout, 4005 revoked/permission off; the phone
  stops reconnecting on 4000-4005.

`KS/main.go`: build `termBroker := mobileterm.New(...)` before `terminalSvc`; set
`BoundService.Arbiter: termBroker`; `Sessions` resolves via `adeTracker.TerminalOf` plus a check
that the record is a running TUI task session (`adeTracker.Get`); `OnChange` emits
`ChannelMobileTerminals`. Pass `termBroker` and `MobileWriter` into `MobileAccessService`.

### 4.7 MobileAccessService additions (commits 1, 5, 9)

Bound methods:

- `SetDevicePermissions(MobileDevicePermissionsArgs{ID, Write, AgentInput})` -> repo, emit devices,
  `server.PermissionsChanged(id)` (releases terminals when agent input went off).
- `SetAgentInputEnabled(MobileSetEnabledArgs)` -> settings patch, `termBroker.ReleaseAll` when off,
  emit status. `MobileStatus` gains `AgentInput bool`.
- `TerminalHolds() []mobileterm.Hold`, `ReclaimTerminal(MobileReclaimArgs{TerminalID, Cols, Rows})`.
- `LaunchOpened(MobileLaunchOpenedArgs)`.

`StartFn` passes `Writer`, `Terminals`, `AgentInputEnabled` (reads settings) into
`mobileweb.Config`.

Regenerate bindings with `wails3 task common:generate:bindings` (docs/DEV_ENVIRONMENT.md).

## 5. Frontend design

### 5.1 Shared refactors (commit 3)

- `ADE/board/stageMoves.ts` (pure): from `AdeStageMover.vue:21-32`. `AdeStageMover.vue` imports it.
- `ADE/backlogOrder.ts` (pure): `withMovedItem`. `ADE/queries.ts:157` uses it.
- `ADE/dialog/useLaunchOpener.ts`: used by `adeTakeOver.ts` and `AdeReviewAgentPanel.vue`.

### 5.2 Desktop (commits 5, 9)

- `KSF/src/bridge/index.ts`: `mobileSetDevicePermissions`, `mobileSetAgentInput`,
  `mobileTerminalHolds`, `mobileReclaimTerminal`, `mobileLaunchOpened`, `onMobileTerminals`,
  `onMobileOpenLaunch`.
- `ADE/dialog/mobileLaunch.ts` `installMobileLaunch()`: on `onMobileOpenLaunch`, `useLaunchOpener`
  opens it, `ui.openSession(...)`, acks `mobileLaunchOpened(terminalId, '' | message)`. Called from
  `KSF/src/ade/queries.ts installAdeSignals`.
- `KSF/src/state/mobileTerminals.ts` (Pinia, one concern: who holds which terminal):
  `hydrateThenSubscribe` over `mobileTerminalHolds` / `onMobileTerminals`; `holdOf(terminalId)`;
  `reclaim(terminalId)` (dims from `loadTerminalRenderer().fitTerminal(terminalId)`, else `0,0`).
- `ADE/sessions/AdeTuiPane.vue`: when `holdOf(terminalId)`: absolute overlay over
  `TerminalHostView` (Tailwind, `bg-bg/90`), text "Controlled from {label}" plus
  "phone offline, returns here at {time}" when not connected, `Button` "Reconnect here"
  (`data-testid="ade-tui-reconnect"`).
- `ADE/sessions/AdeSessionStrip.vue`: `CodiconIcon name="device-mobile"` on held tabs
  (`data-testid="ade-session-phone"`).
- `KSF/src/workbench/settings/MobileAccessPane.vue`: global `Switch` "Let phones reply to agents and
  control their terminals" with a warning paragraph in plain prose (anyone holding a phone with
  this on can run commands as you); per-device `Switch`es "Changes" and "Agent input" (agent input
  disabled while the global switch is off); a "Controlling n terminal(s)" note per device from
  `mobileTerminals`. `KSF/src/state/mobileAccess.ts` gains the two actions.

### 5.3 Phone (commits 6, 10)

- `MOB/api/http.ts`: `postJson(path, body, {signal, idempotencyKey})` sets `Idempotency-Key`.
- `MOB/api/adeWriter.ts`: one function per route.
- `MOB/state/useAdeWrites.ts`: TanStack `useMutation`s; variables carry `key:
  crypto.randomUUID()` minted by the caller per tap; `retry: 2` only for `E_NETWORK` (same key);
  backlog move uses `withMovedItem` optimistically with rollback; `onSuccess` invalidates the
  matching read key.
- `MOB/state/auth.ts`: keep `permissions` from `/api/me`.
- `MOB/components/ConfirmDialog.vue` (shadcn `Dialog`), `MOB/components/PermissionHint.vue`
  (Alert naming Settings > Mobile access).
- `MOB/screens/BacklogScreen.vue`: top `Input` plus "Add" (`data-testid="backlog-add"`,
  `backlog-add-submit`), clears on success; rows get a grip handle (`data-drag-handle`,
  `touch-none`, 44 px target) wired with `useSortableReorder(listRef, ids, onMove,
  {draggable: '[data-backlog-row]', handle: '[data-drag-handle]', direction: 'vertical'})`.
  Disabled with `PermissionHint` when `!permissions.write`.
- `MOB/state/useAgentsModel.ts`: `PlanCard` gains `action` (`taskCell` from `@ade/board/actions`)
  and `moves` (`stageMoves`), plus the task's running TUI sessions.
- `MOB/screens/PlanTaskCard.vue` expanded: "Back" / "Next" / "Start" buttons
  (`plan-stage-back`, `plan-stage-next`, `plan-start`), each through `ConfirmDialog`. Start maps
  action `run` -> `/tasks/run`, `stage` -> `/tasks/launch`; other kinds show no Start. Running TUI
  sessions list with "Terminal" link.
- `MOB/screens/NeedsScreen.vue`: `question` items: "Reply" (opens `MOB/components/ReplySheet.vue`,
  `Textarea` plus Send) and "Terminal"; `stuck run` with session: "Take over" (confirm, then
  "Terminal" once the session is running).
- Router: `{ path: '/terminal/:sessionId', name: 'terminal', component: TerminalScreen }` outside
  `AppShell` (full screen, no tab bar).
- `MOB/terminal/useRemoteTerminal.ts`: VueUse `useWebSocket(url, {immediate: false, autoReconnect:
  {retries: 10, delay: backoff}, heartbeat: false})`; `binaryType = 'arraybuffer'` set in
  `onConnected`; URL computed from `cols`, `rows`, `from`; tracks `offset` (hello offset plus bytes
  written); handles control frames; stops reconnecting on close codes 4000-4005 and sets a reason.
- `MOB/screens/TerminalScreen.vue`: header (session name, status, A-/A+, Release), xterm host,
  `MOB/terminal/KeyBar.vue`, compose row. Leaving the route sends `{type:"release"}` and closes.
  `useEventListener(window.visualViewport, 'resize', …)` sizes the host, debounced refit
  (`useDebounceFn` 100 ms) sends `resize`.
- `vite.mobile.config.ts`: manifest `description` drops "Read-only".

## 6. Security summary (security warning, plain prose)

Agent input lets a phone type into Claude Code, which can run shell commands as the user. The plan
therefore requires all of the following before a single byte reaches a PTY: HTTPS with the local CA,
the per-device HttpOnly SameSite=Strict cookie, the Origin check on the WebSocket handshake, the
global agent-input switch, the per-device agent-input flag set on the desktop, and a running ADE
Claude Code session as the target. The desktop shows every hold (overlay, strip badge, pane note)
and can take the terminal back at any time. Revoking a phone or turning either switch off ends its
sockets immediately. Keystrokes and message text are never logged.

## 7. Tests

Go (fast, per commit):

- `MW/routes_test.go`: replace `TestRoutes_NoPostBesidesPair` with
  `TestRoutes_WriteRowsAreGuarded` (every non-GET row besides `/api/pair` has `perm != permNone`,
  a non-empty `action`, and is POST; the upgrade row has `permAgentInput`). Keep the allowlist walk
  (tempting paths `/api/ade/backlog/add`, `/api/terminal` stay unreachable).
- `MW/guard_test.go`: write without Origin -> 403; WebSocket handshake with a foreign Origin -> 403;
  device without `can_write` -> 403 `E_WRITE_OFF`; global agent input off -> 403
  `E_AGENT_INPUT_OFF`; missing `Idempotency-Key` -> 400.
- `MW/idempotency_test.go`: replay returns cached body without a second call; other path -> 422;
  in-flight -> 409; 5xx not cached; TTL expiry (interacting cache rules).
- `mobileterm/ring_test.go`: append across wrap, `ReadFrom` at start, middle, end, overrun.
- `mobileterm/broker_test.go`: fake registry and clock. Attach resizes to phone size; desktop
  Write/Resize gated and recorded; second device busy; same device replaces; disconnect then grace
  expiry returns desktop size; reconnect inside grace keeps phone; idle timeout; Reclaim with 0,0
  uses recorded size; `ReleaseDevice`; `Exited` drops entry and closes conn.
- `mobileterm/serve_test.go`: httptest server plus `coder/websocket` client: hello and snapshot,
  input reaches fake registry, `from` resume, reset on overrun, Reclaim closes with 4001.
- `bridge/mobilelaunch_test.go`: ack resolves, error ack maps to `E_INVALID`, timeout, no window.
- Stale guard: no dedicated test (single `if`).

Playwright, once near phase end (`bun run test:ui:space-mobile`, `bun run test:ui:space`):

- `KS/tests/mobile/support/mockServer.ts`: `/api/me` with permissions, the seven POST routes
  (record body and `Idempotency-Key`, reply with fixture data, scriptable error), `state.permissions`.
- `KS/tests/mobile/writes.spec.ts`: add item (key header present, list refreshes after `emit`);
  drag a row by its handle to another position (request `toIndex`); Next and Back with confirm;
  Start run; stale 409 shows the message; write-off shows the hint and no controls.
- `KS/tests/mobile/agents.spec.ts`: Reply sends message; Take over confirm.
- `KS/tests/mobile/terminal.spec.ts` with `page.routeWebSocket`: hello plus snapshot renders; key
  bar Esc/Ctrl-C/arrows send the right bytes; A+ sends a resize; server `reclaimed` close shows
  "Back on the computer" and no reconnect; agent-input-off hint.
- Desktop `KS/tests/ui/mobile-access.spec.ts`: permission switches call the bound methods; global
  switch disables per-device agent input. New `KS/tests/ui/ade-tui-takeover.spec.ts`: a hold push
  shows the overlay and strip badge; Reconnect calls `ReclaimTerminal`. Update `ipcChannels.ts`.
- Visual baselines: Settings dialog snapshots change again; regenerate on the reference machine.

## 8. Docs (commit 12)

- `docs/ARCHITECTURE.md` "Mobile agents web": rewrite the "read-only" lines; add write routes and
  permissions, idempotency, stale guard, launch rendezvous, terminal arbiter, ring, takeover state
  machine, WebSocket transport and close codes, CSP change. Stack table: `coder/websocket` (ISC).
- `docs/DEV_ENVIRONMENT.md` mobile section: enabling agent input, trying a terminal attach, the
  `routeWebSocket` mock.
- Known open items: extend the P212 real-phone entry (iOS soft keyboard with xterm, WebSocket
  survival when the PWA backgrounds, touch drag on a real device). Add: Claude Code redraw after a
  phone-size resize and after reclaim is unobserved in the sandbox (no Claude account; see the
  existing P147 item).
- `docs/v2.2/SPEC.md`: implementer adds "P212 Part 2 result" and sets the row Done at the end.

## 9. Commit order (one sequential implementer)

No split into streams: commits 4-10 share `MW/routes.go`, `bridge/mobile.go` and `main.go`.
Fast checks (`go build ./...`, `go vet`, typecheck, lint) per commit; Playwright once at the end.

1. `feat(space): mobile device permissions and agent input setting` (4.1, 4.7 permission methods,
   pane switches, store actions, shared schema).
2. `feat(ade): stale stage guard on stage moves and starts` (4.2).
3. `refactor(ade): share stage moves, backlog reorder and launch opener` (5.1).
4. `feat(mobile): guarded write routes for backlog, stages and replies` (4.3, 4.4 adapter without
   launches; `launch` and `take-over` rows land in 5).
5. `feat(space): open phone-started launches in a desktop window` (4.4 rendezvous, 5.2 handler).
6. `feat(mobile): backlog add and reorder, stage moves, start and replies on the phone` (5.3 minus
   terminal).
7. `feat(terminal): arbiter hook for agent session output, input and size` (4.5).
8. `feat(space): phone terminal broker over WebSocket` (4.6, go.mod direct dep, CSP).
9. `feat(space): desktop takeover overlay and reconnect` (5.2 store, pane, strip, AdeTuiPane).
10. `feat(mobile): phone terminal screen` (5.3 terminal).
11. `test(mobile): write and terminal specs` (section 7 Playwright, fixes as follow-up commits).
12. `docs: mobile writes and terminal attach` (section 8, SPEC result).

## 10. Overlap notes

- Stream C (P213 Tailwind audit) skips P210-P212 files but cannot know this part's list. Part 2
  also edits `AdeStageMover.vue`, `AdeTuiPane.vue`, `AdeSessionStrip.vue`,
  `AdeReviewAgentPanel.vue`, `adeTakeOver.ts`, `ADE/queries.ts`, `MobileAccessPane.vue` and every
  `MOB/` file. The orchestrator tells stream C, or expects small rebase conflicts there.
- Stream A (P211) may touch `KS/main.go` and `bridge/events.go`; expect a trivial rebase.

## 11. Deferred decisions (user's call; plan implements the bold default)

- DD1. Phones paired before this part: **changes off until enabled in the pane**; alternative: on.
- DD2. Desktop confirmation for agent input: **per-device switch in the pane (plus the global
  switch)**; alternative: a desktop approval prompt at every attach.
- DD3. Phone offline grace before the terminal returns to the desktop: **60 s**.
- DD4. Auto-release while connected but idle: **15 min without input**; alternative: never.
- DD5. Ring per Claude Code terminal: **1 MiB**.
- DD6. Stage moves from the phone: **back/next only, next may reach Done**; alternative: any stage.
- DD7. Start from the phone: **default branch names and default message** (no Run dialog editing).
- DD8. Workflow choice (`SetTaskWorkflow`), Approve, Retry, Delete, Promote on the phone: **out**.
- DD9. Audit: **app log only**; alternative: persisted table listed in the pane.
- DD10. Quick reply gated by **agent input** (not by changes).
- DD11. Local authentication (Touch ID) to turn on agent input: **no**.

## 12. Orchestrator verification (before accepting the implementation)

Real checks, not the result prose:

- Routes: `rg -n 'http.MethodPost' apps/kira-space/internal/mobileweb/routes.go` lists exactly
  `/api/pair` plus the seven write rows; `rg -n 'permWrite|permAgentInput'` covers each.
- Same services: `rg -n 'Svc\.(AddBacklogItem|MoveBacklogItem|SetTaskStage|StartRun|LaunchStage|Send|TakeOver)'
  apps/kira-space/internal/bridge/mobilewrite.go` finds all seven; `rg -n 'Engine\.'
  apps/kira-space/internal/bridge/mobilewrite.go` finds none.
- Stale guard: `rg -n 'ErrStale' apps/kira-space/internal/ade/` hits `runs.go` (two) and
  `launches.go`.
- Idempotency: `rg -n 'expirable' apps/kira-space/internal/mobileweb/idempotency.go`.
- Library use: `rg -n 'coder/websocket' apps/kira-space/internal/mobileterm/serve.go`, not
  `// indirect` in `go.mod`; `rg -n 'useSortableReorder' apps/kira-space/frontend/mobile`;
  `rg -n 'useWebSocket' apps/kira-space/frontend/mobile/terminal`;
  `rg -n 'getOrCreateTerminal|fitTerminal' apps/kira-space/frontend/mobile`.
- Gate wired: `rg -n 'Arbiter' internal/terminal/bound.go apps/kira-space/main.go`; Studio's
  `apps/kira-studio/main.go` sets no `Arbiter`.
- Shared refactors used twice: `rg -n 'stageMoves' apps/kira-space/frontend` (desktop and mobile),
  `rg -n 'withMovedItem'`, `rg -n 'useLaunchOpener'` (three callers).
- Desktop-only channels: `rg -n 'kira:mobile' apps/kira-space/internal/mobileweb/events.go` empty.
- No terminal id on the phone wire: `rg -n 'terminalId' apps/kira-space/frontend/mobile` empty.
- Migration: `ls apps/kira-space/internal/storage/migrations | tail -1` is `0022_…`.
- No Options API, no scoped style: `rg -n '<style' apps/kira-space/frontend/mobile` empty.
- Checks: `go test -race ./apps/kira-space/internal/mobileweb/... ./apps/kira-space/internal/mobileterm/...
  ./apps/kira-space/internal/bridge/... ./apps/kira-space/internal/ade/... ./internal/terminal/...`,
  `bun run typecheck`, lint, `golangci-lint`, knip, `bun run test:ui:space`,
  `bun run test:ui:space-mobile`, `bun run build:space`; every hook green on a normal commit.
