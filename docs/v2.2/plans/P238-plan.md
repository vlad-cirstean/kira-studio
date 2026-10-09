# P238 plan: desktop notification when a Kira Space agent finishes or needs input

SPEC row P238. User's words: "Use those [P233 hooks] to send an OS/system notification when the
agent finishes, so I go check what it said or whether it has to ask something."

Base: `v2.0` at `a6637fbdf`. Stream C, first of two (P238 then P239 on the same branch; both edit
`internal/agenthooks`, `appwire`, `main.go`, settings model and `ClaudeCodePane.vue`). One
sequential Sonnet implementer.

Discovery: `codegraph_explore` over `agenthooks` (`Manager.ComposeLaunch`, `Server`, `handleHook`,
`hookRequest`, `truncateMessage`, `buildHooksDocument`), `internal/terminal` (`BoundService.Open`,
`Registry.AgentSessions`, `Registry.WindowOf`), `appevent` channels, workbench `agentActivity.ts`
reducer. `apps/kira-space/**` read directly (not indexed): `appwire/wire.go` `wireTracker`,
`ade/tracker.go` `HandleEvent`, `bridge/adetask.go` `FocusSession`, `adeagent/process.go`
`Script`, `storage/model/settings.go`, `ClaudeCodePane.vue`. Wails notifications read from the
module cache (`wails/v3@v3.0.0-beta.21/pkg/services/notifications`).

## 1. Facts

- Hook events reach `wireTracker`'s `agenthooks.Options.OnEvent` for every Kira-launched
  claude-code PTY: terminal agent tabs and ADE TUI sessions (stage, review, take over). Hook env
  is only set there (P233), so every event is a Kira session by construction.
- ADE headless runs do NOT go through hooks: `adeagent.Script` builds `claude -p ... --mcp-config
  ... --setting-sources ...`, no `--settings`. Their end is visible only as a run state change on
  the board's `OnRuns` (`adewire.Run.State`: pending, running, stuck, failed, back, done).
- Measured with the real CLI 2.1.295 here: the Stop payload carries `last_assistant_message` (the
  reply text). The listener drops it today (`hookRequest` has no such field).
- `Notification` hook `notification_type` values the reducer already knows: `permission_prompt`,
  `idle_prompt`, `auth_success`; the CLI docs also list `elicitation_dialog`. Check the current
  hooks reference page before coding the set.
- Wails v3 beta.21 ships `pkg/services/notifications` (MIT, same module as Wails; no new
  dependency, no licence issue). macOS: needs a bundle identifier (Space has
  `com.kirathecat.kira-space`) and a signed bundle; authorization via
  `RequestNotificationAuthorization`. Click arrives through `OnNotificationResponse` with
  `Response.UserInfo` = the `Data` map sent. Linux uses D-Bus. The app ships for macOS only.
- Terminal tab id is the terminal id (`createTerminalsStore` routes by tab id); `TabRecord`
  (`storage/model/tabs.go`) has `WorkspaceID` and a JSON `State`. Confirm where the tab title lives
  before using it.

## 2. Design

### 2.1 `internal/agenthooks`

- `hookRequest.LastAssistantMessage string \`json:"last_assistant_message"\``; `Event.
  LastAssistantMessage string \`json:"lastAssistantMessage"\``, truncated with `truncateMessage`
  (200 bytes, rune-safe) like `Message`. Update the doc comment "nine fields" to ten.
- `packages/shared/domain/agent.ts` `AgentEvent.lastAssistantMessage: string`.
- `internal/agenthooks/server_test.go`: extend the existing payload test with the new field and a
  300-byte multi-byte message (bounded). No new test file.

### 2.2 New package `apps/kira-space/internal/agentnotify`

```go
type Kind string // "finished" | "needs-input" | "run-ended" | "test"
type Note struct {
    ID, Title, Body string
    Kind            Kind
    TerminalID, WindowKey, RecordID, TaskID string
}
type Sink interface{ Send(Note) error }
type Prefs struct{ Enabled, OnFinished, OnNeedsInput, OnRunEnded, IncludeMessage bool }
type Target struct{ Name, WindowKey, RecordID, TaskID string } // Name: task title, else tab title, else repo name, else basename(cwd)
type Deps struct {
    Prefs    func() Prefs
    Describe func(terminalID, cwd string) Target
    Alive    func(windowKey string) bool
    Focus    func(windowKey string) bool       // AdeTask.FocusWindow
    Reveal   func(n Note)                       // emits to the window, see 2.4
    Now      func() time.Time
}
type Notifier struct { /* mu; sink; focus map[windowKey]FocusState; wake map[terminalID]bool; last map[key]time.Time */ }
func New(d Deps) *Notifier
func (n *Notifier) SetSink(s Sink)                 // nil -> drop
func (n *Notifier) HandleEvent(ev agenthooks.Event)
func (n *Notifier) HandleRuns(runs []adewire.Run)
func (n *Notifier) ReportFocus(f FocusState)       // {WindowKey, Focused bool, Module, ActiveTerminalID, AdeTaskID}
func (n *Notifier) Click(data map[string]any)
var Cooldown = 10 * time.Second                    // exported var; a flow test shortens it, P231 WithTrackerGrace precedent
```

Rules (the one piece with interacting rules; flow tests in 3.1 pin each):

1. `Prefs.Enabled` false: nothing.
2. Wake tracking per terminal, same set as `agentActivity.ts` `WAKE_TOOLS` (`Monitor`,
   `ScheduleWakeup`): `PreToolUse` naming one arms; `UserPromptSubmit`, `SessionStart`, `Stop`
   clear (after the decision). `SessionEnd` forgets the terminal.
3. `Stop`: kind `finished` unless wake was armed (the session is waiting on a monitor, not done).
   Needs `OnFinished`.
4. `Notification` with type `permission_prompt` or `elicitation_dialog`, or an empty type with a
   non-empty message (older CLI): kind `needs-input`. Needs `OnNeedsInput`. `idle_prompt` and
   `auth_success`: nothing (a Stop already covered "finished"; `idle_prompt` repeats it a minute
   later).
5. Runs: keep last state per run id; a transition from `running` into `done`, `failed` or `stuck`:
   kind `run-ended`. Needs `OnRunEnded`. First sight of a run (app start) records state only.
6. Suppress when the target window is alive, focused, and showing that session: same
   `ActiveTerminalID`, or for an ADE record the ADE module with that task open (`Module == "ade"`
   and `AdeTaskID == TaskID`). For `run-ended`: ADE module focused on that task.
7. Cooldown per (terminal or run id, kind): one note per `Cooldown`.
8. Title: `Claude finished · <Name>`, `Claude needs input · <Name>`, `ADE run <state> · <Name>`.
   Body: `IncludeMessage` ? one line of the bounded message (whitespace collapsed) : a fixed
   phrase ("Open Kira Space to read the reply"). Run body: `Run.Summary` or `Run.Note`, bounded to
   200 bytes the same way.
9. `Note.ID`: `<kind>:<terminalId|runId>` so a newer note replaces the older one in Notification
   Center (Wails darwin replaces by identifier).

`Describe` (built in `appwire`, not in the package): ADE record via `Tracker` live map + task row
(title, branch); else the tab row for that id in `repositories.Tabs` (title from `State` if
present) and its workspace's code repo name; else `filepath.Base(cwd)`. Window key from
`terminal.Registry.WindowOf`. For runs: task title from the board engine.

### 2.3 Sinks and platform split

- `agentnotify/sink_darwin.go` (`//go:build darwin && !server`): `WailsSink` over
  `*notifications.NotificationService`. First `Send`: `CheckNotificationAuthorization`; if false,
  `RequestNotificationAuthorization` once (the OS asks the user once; that is the platform's
  permission, not Kira prompting for anything else). Denied: log once at info, keep dropping.
  `Send` uses `SendNotification` with `Data: {terminalId, windowKey, recordId, taskId, kind}` and
  `ThreadID: "kira-agents"`.
- `apps/kira-space/notify_darwin.go` (package main, `darwin && !server`): `notifyServices(wired)
  []application.Service` creates `notifications.New()`, registers
  `ns.OnNotificationResponse(func(r){ wired.AgentNotify.Click(r.Response.UserInfo) })`, calls
  `wired.AgentNotify.SetSink(agentnotify.NewWailsSink(ns))`, returns `application.NewService(ns)`.
- `apps/kira-space/notify_other.go` (`!darwin || server`): returns nil, logs once
  "desktop notifications: macOS only" at debug. Keeps the D-Bus service out of the Linux and
  server builds (a failed `ServiceStartup` would stop the app), and keeps `-tags server` compiling.
- `main.go`: `Services: append(wired.Bound(), notifyServices(wired)...)`.

### 2.4 Wiring (`apps/kira-space/internal/appwire`)

- `Wired.AgentNotify *agentnotify.Notifier` and `Wired.AgentNotifySvc *bridge.AgentNotifyService`.
- `wireTracker`'s `OnEvent` adds `notifier.HandleEvent(ev)` after the tracker and emit. The
  notifier is built before `wireTracker` (its `Describe` closes over `w`, resolved lazily).
- `wireAdeTask`'s `OnRuns` adds `notifier.HandleRuns(ev.Runs)`.
- `Reveal`: ADE record -> `w.AdeTask.FocusSession(ctx, {SessionID: RecordID})` (focus + existing
  `open-session` push); terminal -> `Focus(windowKey)` then `EmitTo(windowKey,
  "kira:agent:reveal-terminal", {terminalId})`; run -> focus any real window
  (`w.Windows.AnyRealKey`) and `EmitTo(key, "kira:agent:reveal-task", {taskId})`. New channel
  constants in `apps/kira-space/internal/bridge/events.go` (Space only, not `appevent`). Not added
  to the mobile allowlist.
- `Alive`: `w.Windows` key lookup (find the registry's existing key query; `Keys()` exists).

### 2.5 Bound service (Space 20 -> 21)

`apps/kira-space/internal/bridge/agentnotify.go`:

```go
type AgentNotifyService struct{ N *agentnotify.Notifier }
type ReportFocusArgs struct{ WindowKey string; Focused bool; Module, ActiveTerminalID, AdeTaskID string }
func (s *AgentNotifyService) ReportFocus(a ReportFocusArgs) error // validate windowKey non-empty, ids <= 128 bytes
func (s *AgentNotifyService) SendTest() error                      // kind "test", ignores cooldown and focus, honours Enabled
```

Add to `Wired.Bound()` (update its count comment and the package doc "20 bound services").

### 2.6 Settings (`claudeCode` leaves, all default `true`)

`notifyEnabled`, `notifyOnFinished`, `notifyOnNeedsInput`, `notifyOnRunEnded`,
`notifyIncludeMessage`. Files: `storage/model/settings.go` (struct, defaults, patch),
`storage/repos/settings.go` (`appsettings.Leaf` read + `UpsertOptional` write, the
`keepAwakeWithAgents` pattern; key-value rows, no migration), `frontend/src/state/settingsDomain.ts`
(zod schema + defaults). `Prefs` reads `repositories.Settings.GetAll` on each event (cheap, the
`HeadlessSettingSources` pattern).

### 2.7 Frontend (`apps/kira-space/frontend/src`)

- `workbench/settings/ClaudeCodePane.vue`: a "Notifications" `Field` group under the keep-awake
  field: master `Switch` (`settings-claude-code-notify`), four sub-`Switch`es disabled while the
  master is off (`settings-claude-code-notify-finished`, `-needs-input`, `-run-ended`,
  `-include-message`), each with the reset `TooltipIconButton` like the existing leaf, and a
  "Send test notification" shadcn `Button` (`settings-claude-code-notify-test`) calling
  `control.agentNotifySendTest()`. `FieldDescription`: notes go to the OS notification centre; on
  macOS the first one asks for permission; message text leaves the app only into the local
  notification centre.
- `state/agentNotify.ts`: `installAgentNotifyFocus()` called once from `main.ts`. VueUse
  `useWindowFocus` + `useDocumentVisibility`; watches mode store, active tab id (terminal tabs) and
  the ADE board UI store's open task; `watchDebounced` 150 ms -> `control.agentNotifyReportFocus`.
  Also subscribes `control.onAgentRevealTerminal` (switch mode to `terminal`, activate the tab whose
  id is `terminalId`; find the tabs store action that activates a tab) and
  `control.onAgentRevealTask` (mode `ade`, `useAdeBoardUiStore()` open task). No Pinia store: no
  shared state is created (CLAUDE.md one-concern rule; nothing to hold).
- `bridge/control.ts`: the two bound calls and two listeners.
- Tailwind only, shadcn primitives only, `<script setup lang="ts">`.

## 3. Tests

### 3.1 Go flow: `apps/kira-space/internal/flows/notifyflow/` (new package, Stream C)

`main_test.go` (`flowharness.Main`), `notify_test.go`. Each test: `app := flowharness.New(t)`;
`sink := &recSink{}`; `app.W.AgentNotify.SetSink(sink)`; `agentnotify.Cooldown` shortened where
needed (restored in `t.Cleanup`). Events go through the real path: open a claude-code terminal
(fake claude idles), take its env from `app.W.AgentHooks.ComposeLaunch(id, "claude")` (same
socket/token), pipe hook JSON into the real `hook` shim next to `SettingsPath()` (the
DEV_ENVIRONMENT "Stop hook path" recipe). No direct `HandleEvent` calls.

| Test | Asserts |
|---|---|
| `TestStopNotifies` | one note, kind `finished`, title has the repo name, body has the `last_assistant_message`, `Data` has terminal and window ids |
| `TestNeedsInputNotifies` | `permission_prompt` -> `needs-input` with the message |
| `TestIgnoredNotifications` | `idle_prompt`, `auth_success` -> none |
| `TestWakeArmedStopSilent` | `PreToolUse` `Monitor` then `Stop` -> none; next `UserPromptSubmit` + `Stop` -> one |
| `TestFocusedTabSuppresses` | `ReportFocus{focused, ActiveTerminalID: id}` -> none; other tab active -> one; window blurred -> one |
| `TestCooldown` | two Stops within `Cooldown` -> one; after it -> two |
| `TestPrefsToggles` | `Settings.Set` each leaf off -> that kind silent, master off -> all silent, `IncludeMessage` off -> fixed body; leaves persist across `app.Restart()` (re-`SetSink` after restart) |
| `TestAdeStageSessionNote` | ADE `LaunchStage` session: note names the task title, `RecordID` set |
| `TestRunEndedNotifies` | fake claude scenario run ends `done` -> one `run-ended`; a run already `done` at boot -> none |
| `TestClickRevealsTerminal` | `Click(data)` -> window manager fake focus on that key, Events recorder has `kira:agent:reveal-terminal` for that window only |
| `TestClickRevealsAdeSession` | ADE record -> `open-session` push (FocusSession path) |
| `TestSendTest` | bound `SendTest` -> one `test` note even while focused; nothing when master off |

The Notifier rules are covered here end to end; no separate unit test (CLAUDE.md bar: the flow
tests already pin every rule through the real path).

### 3.2 UI tier: `apps/kira-space/tests/ui/settings-agent-notify.spec.ts`

Mock bridge (`apps/kira-space/tests/fixtures/**`, extend the mock control for the two new calls):
toggles render with defaults on; master off disables the four; Save writes the `claudeCode.notify*`
patch (control log); reset buttons; test button calls `agentNotifySendTest`; a
`reveal-terminal` push switches to the terminal module and activates that tab.

No new `e2e-real` spec: `apps/kira-space/tests/e2e-real/fixtures.ts` is Stream A's; the real
backend path is covered by 3.1.

## 4. Docs (`docs/ARCHITECTURE.md`, Stream C owns it)

- New subsection "Agent notifications (P238)" under the ADE section: event -> rule table, focus
  reporting, platform split, settings leaves, the headless-run route via `OnRuns`.
- Bound count 20 -> 21 wherever stated; `ChannelAgentEvent` payload gains `lastAssistantMessage`.
- Known open items: macOS notifications need the signed bundle and user permission; none on the
  Linux/server builds; a dev build run outside a bundle cannot post (Wails checks the bundle id).

## 5. Commits

1. `feat(agenthooks): keep last_assistant_message on Stop`.
2. `feat(space): agent notifier with focus suppression and cooldown` (package + wiring + bound service).
3. `feat(space): native macOS notification sink`.
4. `feat(space): notification settings and focus reporting` (frontend).
5. `test(space): notification flows and settings UI spec`.
6. `docs: agent notifications`.

## 6. Verification checklist (orchestrator)

- `grep -rn "notifications.New()" apps/kira-space/*.go` hits only `notify_darwin.go`; its build line is `darwin && !server`.
- `grep -n "LastAssistantMessage" internal/agenthooks/http.go internal/agenthooks/agenthooks.go`; `grep -n lastAssistantMessage packages/shared/domain/agent.ts`.
- `grep -n "notifier.HandleEvent\|HandleRuns" apps/kira-space/internal/appwire/wire.go` (real callers, not scaffolding).
- `grep -c "application.NewService" apps/kira-space/internal/appwire/appwire.go` is 21.
- `go build ./...`, `go build -tags server ./apps/kira-space/...`, `GOOS=darwin CGO_ENABLED=0 go vet ./apps/kira-space/internal/agentnotify/` (pure-Go files; the cgo darwin build cannot run here, DEV_ENVIRONMENT).
- `CGO_ENABLED=1 go test ./apps/kira-space/internal/flows/notifyflow/ -race -v`, `bun run test:flows:space`, P236's coverage gate (after rebase) passes with `AgentNotifyService` methods covered.
- `bunx playwright test --config=apps/kira-space/playwright.config.ts --project=ui settings-agent-notify settings-claude-code`.
- `bun run lint`, `bun run typecheck`, `bun run lint:dead`, golangci-lint, `bun run setup` regenerated bindings.
- Mac handover (user): signed build; start a Claude terminal tab, ask a question, switch to another app: banner "Claude finished · <repo>" with the reply's first line; click focuses the window and tab; while looking at that tab, no banner; a permission prompt gives "needs input"; ADE headless run end gives "ADE run done"; toggles in Settings > Claude Code work; "Send test notification" works; first use asks macOS permission once.
