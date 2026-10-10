# P246 plan: popup routing across windows, system notifications

SPEC row P246 (both apps). Planned against `c10610314` (v2.0 after P242 Parts 1-4, P243 Part 1).
Table order puts P243 Part 2, P244, P245 before this row: implement after P243 Part 2 lands and
re-read every file this plan names first (section 8 lists the overlap).

Discovery: `codegraph_explore` (index synced first, `codegraph sync .`) over `shell.WindowRegistry`
(`AnyRealKey`, `Focus`, `Add`, `RowDecision`), `OpenWindow`/`ReopenWindows`, `appevent.Emitter`
(`EmitTo`), `scriptruns.Bound`/`confirm.go` (`MainWindow`, `ConfirmAccept`, `ConfirmDecline`),
`ScheduleConfirmHost`, `windowKey`, `dbmcp.ApprovalBroker`, `notify.PendingQueue`,
`DbMcpApprovalDialog`, `pairing.Broker`, `mobile.ts`, flow coverage gate, settings models. Read
directly (codegraph returned no match for these paths): `agentnotify/{agentnotify,sink_darwin}.go`,
`apps/kira-space/notify_{darwin,other}.go`, `bridge/{agentnotify,gitcredential,gitstream}.go`,
`gitcred/relay.go`, `gitsession/{conn,remote}.go`, `gitaskpass/prompt.go`, `appshell/stream.go`,
both appwires, Space `main.go` (`surfaceCredentialPrompts`), `createAppUpdateStore.ts`,
`state/gitCredential.ts`, `PairingRequestDialog.vue`, `GitCredentialDialog.vue`,
`schedule/confirmDialog.ts`, flowharness `shellfakes.go`, e2e-real fixtures and specs, Wails v3
beta.21 `pkg/services/notifications` and `application/stream.go` source.

## 0. Requirements carried

- R1 One central Go prompt router (`internal/prompts`), both apps. Every app-originated popup
  registers there with an origin: a window key, or none (generic).
- R2 One shared frontend host (`PromptHost`), mounted once per window, both apps.
- R3 Window-originated: shows in that window. Generic (cron, MCP, phone, background git, update):
  shows only in the main window = lowest-order real (non-ephemeral) window. Never in every window,
  never twice.
- R4 No window open: the prompt queues and shows on next window open or focus; the system
  notification still posts.
- R5 Each popup posts a system notification through the P238 sink. Click focuses the right window
  and that popup. Answering or dismissing anywhere clears the popup and the notification.
- R6 Covers: P242 Part 4 schedule confirm, MCP-initiated prompts (DB MCP approval), script and
  automation triggers, Space and Studio prompts that exist.
- R7 Studio notifications if feasible (it is: same Wails service, section 2 D12).
- R8 Flow tests per P236 conventions; e2e-real with two windows; coverage gate green, both
  `exempt.txt` empty. Unit tests only per CLAUDE.md bar.
- R9 shadcn-vue, Tailwind, VueUse, Pinia, TanStack; `<script setup lang="ts">`; no `<style>`.

## 1. Current tree (verified)

Popups the app raises today, by owner (renderer-local dialogs opened by a click are not listed):

| Popup | App | Owner (Go) | Shown in | Origin |
|---|---|---|---|---|
| Recurring confirm (`waiting` run) | both | `scriptruns` scheduler, `script_runs` rows | main window only (`AnyRealKey`) | generic |
| DB MCP approval | Studio | `dbmcp.ApprovalBroker` (FIFO, 120 s) | every window (`App.vue` root) | generic (MCP) |
| Git credential, relay | Space | `gitcred.Relay` (ADE board conn, gitsock conn) | every window; `surfaceCredentialPrompts` reopens or focuses `keys[0]` | generic |
| Git credential, native stream | Space | `gitsession.Conn.AskCredential` emits `credential.request` on that window's stream | that window | window |
| Mobile pairing request | Space | `pairing.Broker` (`mobileweb.NewBroker`) | every window | generic (phone) |
| Git pairing request | Space | `pairing.Broker` (`gitsock`) | every window | removed by P243 Part 2 |
| Update available | both | renderer poll (`createAppUpdateStore`), auto-opens | every window | generic |

- `WindowRegistry.AnyRealKey` = smallest key, not lowest order; keys are UUIDs, so "main" is
  random. Callers: Space `revealNote`, `MobileLaunches.Window`, both `runs.MainWindow`.
  `windowEntry` holds no order; `OpenWindow` has `rec.Order`. The last real window hides instead of
  closing and stays registered.
- `scriptruns.Bound.MainWindow` + `ScheduleConfirmHost` (`isMain`, `dismissed`) are Part 4's
  stand-in. `ScheduleConfirmDialog` Escape hides locally; `Not now` declines.
- `agentnotify` (Space only): `Note`, `Sink{Send}`, `WailsSink` (`darwin && !server`), one Wails
  `NotificationService` registered in `notify_darwin.go`, `OnNotificationResponse` routes to
  `Notifier.Click`. No remove call anywhere. Studio has no notification code.
- Wails v3 beta.21 notifications (MIT, already a dependency): `SendNotification`,
  `RemoveDeliveredNotification(id)`, `RemovePendingNotification(id)` are real on darwin
  (`RemoveNotification` is a darwin no-op). A same-id send replaces the shown notification. Linux
  build imports `godbus` (already indirect in `go.mod`).
- `application.StreamConn.Window()` returns the stream's window; its `Name()` is the window key
  (`EmitTo` uses `GetByName(windowKey)`). `ServeGitStream` does not take it today.
  `gitsession.Conn.RouteCredentials` is an existing seam (used by gitsock and the ADE board conn).
- Server build (`-tags server`): `EmitTo` broadcasts; a browser page is no registered window.
  e2e-real opens the page as the server's main window key (Part 4 recurring spec does this).
  `tests/e2e-real/dbmcp-real.spec.ts` sees the approval in a random-key page today.
- Flow harness registers windows with `app.W.Windows.Add(key, nil, detach)`.

## 2. Decisions (planner defaults; user may override)

- D1 **Scope = Go-raised prompts plus the update auto-open.** A dialog a click opens in a window
  (Run…, Run now, ConfirmDialog, editors) stays local: it already shows in its window, the user is
  there, no router entry, no notification.
- D2 **Router holds metadata only, owners keep state and answers.** Each owner (scriptruns, dbmcp,
  gitcred, pairing, update) keeps its queue and answer path and calls `prompts.Sink.Open/Close`.
  The router never stores secrets, statements or git prompt text.
- D3 **Main window = lowest `Order` real window, key as tiebreak.** `WindowRegistry` stores the
  order; `AnyRealKey` is replaced by `MainKey` everywhere (four callers).
- D4 **Target rule**, recomputed on every window add or remove: claimed window if registered, else
  origin if registered (ephemeral allowed: a review window's own prompt shows there), else main
  window, else `""` (queued). A hidden last window is registered, so its prompts show when the Dock
  reopens it.
- D5 **Claim.** `Review and run` in the runs list calls `Claim(id, windowKey)`: the entry moves to
  that window (never duplicated). Only kinds with a reopen path use it (schedule).
- D6 **Close answers.** Closing a routed popup answers it: DB MCP deny, mobile deny, credential
  dismiss (nil), update `Later`. Exception kept from Part 4: schedule Escape hides it in that window
  only (entry stays, notification stays); `Not now` declines; notification click or Claim shows it
  again.
- D7 **One popup per window at a time**, oldest targeted entry first (`CreatedAt`, then id),
  `N more waiting` line. A reveal push moves the named entry to the front in that window.
- D8 **Notifications coalesce per kind.** One OS notification per (kind) with id `prompt:<kind>`:
  title for one entry, count title for several (`3 queries wait for approval`). Same-id send
  replaces it. The last entry of a kind closing removes it (delivered and pending). Bounds an MCP
  loop to one banner.
- D9 **Suppressed while the target window is focused** at open. A queued or unfocused target
  posts. Setting `advanced.notifyPrompts` (default true, both apps) gates every prompt
  notification; Space agent notes keep their own `claudeCode.notify*` settings.
- D10 **Click** (`source: "prompt"` in the notification data) -> `Router.Reveal(kind)`: oldest entry
  of the kind; target `""` -> reopen a window (`shell.ReopenWindows`) and reroute; focus the target
  (`WindowRegistry.Focus` shows a hidden window); `EmitTo(target, kira:prompts:reveal, {id})`.
  Other clicks go to `agentnotify.Notifier.Click` as today.
- D11 **Text, no secrets.** Titles: `Run <script>?` / `Approve this query? · <connection>` /
  `Git needs a credential · <repo>` / `A phone asks for access · <label>` /
  `Kira <App> <version> is available`. Body: `Open Kira <App> to answer.` Never the statement, git
  prompt text, pairing code or params.
- D12 **Sink moves to shared `internal/desknotify`** (stdlib + Wails `notifications` types, no
  build tag): `Note{ID, Title, Body, Thread string; Data map[string]string}`,
  `Sink{Send(Note) error; Remove(id string) error}`, `WailsSink` over a small interface
  (`CheckNotificationAuthorization`, `RequestNotificationAuthorization`, `SendNotification`,
  `RemoveDeliveredNotification`, `RemovePendingNotification`) that `*notifications.NotificationService`
  satisfies. The sink then compiles and vets on Linux; only each app's `notify_darwin.go` glue
  (`notifications.New()`, service registration, click dispatch) stays darwin-only. `agentnotify`
  maps its `Note` onto it; its behaviour is unchanged. Studio gains `notify_darwin.go` /
  `notify_other.go` (same split as Space: no service off macOS or under `server`). No new module;
  Wails is MIT.
- D13 **Native stream credential prompts route too.** `RegisterGitStream` passes
  `c.Window().Name()` (`""` when nil, e.g. server build) to `ServeGitStream`, which sets
  `gconn.RouteCredentials` to `relay.AskFrom(ctx, windowKey, "Kira Space", req)`. One credential
  queue (the relay) for every source. The `credential.request` emit path in `gitsession.Conn`, the
  `credential.provide` stream request and their `@kira/git-ipc` contract entries, and the
  per-window queue in `state/gitCredential.ts` are deleted (dead once every Conn routes).
- D14 **`surfaceCredentialPrompts` is deleted.** It stole focus or reopened a window on every relay
  prompt (P178, VS Code era). D4 queueing plus the notification replace it.
- D15 **Update auto-open routes through Go.** The renderer watch that set `dialogOpen = true` calls
  `Prompts.Raise({kind: "update", ref: <version>})` instead (idempotent per id). `Later`, Escape and
  the frame close call `Prompts.Dismiss(id)` and keep writing `dismissedVersion`. The status-bar
  click still opens the dialog locally (D1). `Raise`/`Dismiss` accept kind `update` only
  (`E_INVALID` otherwise): every other kind is answered through its owner.
- D16 **Schedule.** `scriptruns.Service.Prompts` (nil-safe): `Open` when a `waiting` row is
  inserted, `Close` in `BeginWaiting` success and every `SkipWaiting` result. `Recover` runs before
  any entry exists. `ScriptRunsService.MainWindow`, the `mainWindow` seam and `Service.MainWindow`
  are removed; `ScheduleConfirmHost` keeps only the locally opened request (Run now).
- D17 **DB MCP / pairing / relay hooks.** `ApprovalBroker`, `pairing.Broker`, `gitcred.Relay` gain a
  `prompts.Sink` field set by appwire (nil = none). Open after enqueue; Close on every removal
  (answer, timeout, ctx cancel, abandon, shutdown, sibling purge). `Relay.Ask(ctx, source, req)`
  stays (origin `""`, so `ade/board.go` is untouched) and wraps new `AskFrom(ctx, origin, source,
  req)`.
- D18 **Bound surface.** New `PromptsService` per app embedding `prompts.Bound`: `List() []Routed`,
  `MainWindow() string`, `Claim({id, windowKey})`, `Raise({kind, ref})`, `Dismiss({id})`,
  `SendTest()`. Removed: `ScriptRunsService.MainWindow`. Push channels in `internal/appevent`:
  `kira:prompts:changed` (full routed list, broadcast), `kira:prompts:reveal` (`{id}`, `EmitTo`).
- D19 **Frontend.** `PromptHost` (shared) reads the list with TanStack Query (push replaces the
  cache, refetch on `useWindowFocus`), filters `target === windowKey`, renders the app's component
  for the head entry's kind. No new Pinia store: the host keeps its window-local hidden set and
  reveal override as refs. The existing kind dialogs drop their self-mounting and take
  `{ entry, more }`.
- D20 **Server build.** Router behaviour is identical; `EmitTo` already broadcasts and the host's
  target filter keeps it to one page. e2e-real opens the main window page through
  `PromptsService.MainWindow`.
- D21 **No stream split.** Go types feed regenerated bindings; appwire, flowharness, shared host
  and docs are shared across every kind. One sequential implementer.

## 3. Design

### 3.1 `internal/shell` registry

- `windowEntry` gains `order int`. `Add(key string, order int, win, detach)`; `AddEphemeral`
  unchanged. `OpenWindow` passes `rec.Order`. Callers in tests updated (`registry_test`,
  `closedecision_test`, `quit_test`, both `schedule_test.go`, harness helpers).
- `MainKey() (string, bool)`: lowest order, then smallest key, among non-ephemeral. Replaces
  `AnyRealKey` (deleted).
- `Has(key) bool`; `Focused(key) bool` (`win.IsFocused()`, false for a nil `win`, flow tests);
  `Focus` returns false for a nil `win`.
- `OnChange func()`, called outside the lock after `Add`, `AddEphemeral`, `removeAndCount`.

### 3.2 `internal/prompts` (new, stdlib + `internal/notify` + `internal/ipcerr` + `internal/desknotify`)

```go
type Kind string // "schedule" | "dbmcp" | "git-credential" | "mobile-pairing" | "update"
type Prompt struct {
    ID        string `json:"id"`        // "<kind>:<ref>"
    Kind      Kind   `json:"kind"`
    Ref       string `json:"ref"`       // owner's id the kind dialog answers
    Origin    string `json:"origin"`    // window key; "" generic
    Title     string `json:"title"`     // D11, no secrets
    CreatedAt int64  `json:"createdAt"` // unix ms
}
type Routed struct { Prompt; Target string `json:"target"` } // "" = queued
type Sink interface { Open(Prompt); Close(id string) }
type Windows interface { MainKey() (string, bool); Has(key string) bool; Focused(key string) bool; Focus(key string) bool }
type Deps struct {
    Windows Windows
    Emit    func([]Routed)                    // broadcast kira:prompts:changed
    Reveal  func(windowKey, id string)        // EmitTo kira:prompts:reveal
    Reopen  func()                            // shell.ReopenWindows; nil in flows
    Enabled func() bool                       // advanced.notifyPrompts
    App     string                            // "Studio" | "Space"
    Now     func() time.Time
}
func New(d Deps) *Router
func (r *Router) SetSink(s desknotify.Sink)
func (r *Router) Open(p Prompt)          // idempotent per ID; stamps CreatedAt when 0
func (r *Router) Close(id string)        // no-op when absent
func (r *Router) Claim(id, windowKey string) error
func (r *Router) Reroute()               // registry OnChange
func (r *Router) List() []Routed
func (r *Router) RevealKind(k Kind)      // notification click
func (r *Router) SendTest()
```

- One mutex over `entries map[id]*entry{Prompt; claimed string}`; emit through
  `notify.OrderedEmitter` (seq under lock, emit after), the pattern every broker here uses.
- `target(e)`: D4. `List` sorts by `CreatedAt`, id.
- Notification bookkeeping per kind (D8): on Open, if `Enabled()` and the new entry's target is not
  `Focused`, send `prompt:<kind>` with the kind's single or count title. On Close, the kind's
  remaining count: 0 -> `Sink.Remove`; else resend only when a note for the kind is shown (count
  title). Sink calls happen outside the lock; a nil sink drops them. `Data` = `{source: "prompt",
  kind}`.
- `RevealKind`: D10.
- `Bound{R *Router}` (embedded per app as `bridge.PromptsService`): `List`, `MainWindow`, `Claim`
  (`E_NOT_FOUND` for a closed id, `E_BAD_REQUEST` for empty fields), `Raise` and `Dismiss` (kind
  `update` only, D15; title built in Go from `App` and ref, ref capped 64 bytes), `SendTest`.

### 3.3 `internal/desknotify` (new) and P238 sink move

- `desknotify.{Note, Sink, WailsSink, NewWailsSink(svc notifier)}` per D12; the authorise-once and
  denied-latch logic moves verbatim from `agentnotify/sink_darwin.go` (deleted). `Remove` calls
  `RemoveDeliveredNotification` then `RemovePendingNotification`. Thread ids: agent notes keep
  `kira-agents`; prompts use `kira-prompts`.
- `agentnotify.Sink` becomes `desknotify.Sink`; `agentnotify.Note` maps to `desknotify.Note` with
  its id fields in `Data` (same keys as today). `Notifier.Click` unchanged.
- Space `notify_darwin.go`: one `notifications.New()`; sink shared by `wired.AgentNotify.SetSink`
  and `wired.Prompts.SetSink`; `OnNotificationResponse` dispatches `UserInfo["source"] == "prompt"`
  to `wired.Prompts.RevealKind`, else `wired.AgentNotify.Click`. Studio `notify_darwin.go` /
  `notify_other.go` mirror it with prompts only; `main.go` appends `notifyServices(wired)` like
  Space.

### 3.4 Owners

- `scriptruns`: `Service.Prompts prompts.Sink`. Open at the scheduler's waiting insert (title
  `Run <script>?`, ref run id, origin `""`). Close after `BeginWaiting` returns true and for every
  run `SkipWaiting` returns. Delete `MainWindow` field, `MainWindowKey`, `Bound.MainWindow`.
- `dbmcp.ApprovalBroker.Prompts`: Open in `Request` after enqueue (ref request id, title with the
  connection name); Close in `resolve` and `AbandonAll` per removed entry.
- `pairing.Broker`: `Config.Prompts prompts.Sink`, `Config.Kind prompts.Kind`, `Config.Title
  func(Request[M]) string`. Open in `Request`; Close in `answer` (head and purged siblings),
  `Cancel`, `ExpireOverdue`, `Shutdown`. `mobileweb.NewBroker` sets kind `mobile-pairing`.
- `gitcred.Relay`: `Prompts` field; `Prompt` gains `Origin string json:"origin"`; `AskFrom(ctx,
  origin, source, req)`; `Ask` = `AskFrom(ctx, "", source, req)`. Open after enqueue (title with
  `RepoLabel`), Close in `withdraw` and `Provide`. `SetOnAdded` and `onAdded` deleted with D14.
- Git stream (D13): `appshell.RegisterGitStream(app, router, relay)`; `bridge.ServeGitStream(router,
  conn, windowKey, relay)` routes credentials; `gitsession.Conn` loses `creds`, `credMu`, the emit
  path and the `credential.provide` handler; `gitrpc`/allowlist entries and `packages/git-ipc`
  contract entries for `credential.request`/`credential.provide` deleted; `transport.ts` handler
  and `dropCredentialRequests` deleted; `state/gitCredential.ts` reduces to the relay snapshot
  store (hydrate + push) and `answer(requestId, secret|null)`.
- Update (D15): `createAppUpdateStore` gains `raise`/`dismiss` seams from each app's bridge.

### 3.5 Wiring (both appwires)

- Registry created before any owner; `w.Prompts = prompts.New(...)`; `w.Windows.OnChange =
  w.Prompts.Reroute`; `Reveal` = `EmitTo(key, kira:prompts:reveal, {id})`; `Reopen` set in `main.go`
  (needs `WindowOpenerDeps`) through a `Wired.SetReopen(func())`; `Enabled` reads
  `advanced.notifyPrompts`.
- Owners get `w.Prompts` as their sink: `runs.Prompts`, Studio `dbMcp broker.Prompts`, Space
  `credentialRelay.Prompts`, mobile broker config.
- `PromptsService` appended to `Bound()` (Studio 29, Space count +1; update the doc comment counts
  and the harness bound-count test).
- Space: `revealNote` and `MobileLaunches.Window` use `MainKey`.

### 3.6 Settings

`advanced.notifyPrompts` bool default true: Go models, `DefaultSettings`, patch structs, repo leaf
read/write (both apps); TS settings domains (Studio `state/settingsDomain.ts`, Space
`state/settingsDomain.ts`); `AdvancedPane.vue` in both apps: Switch "Notify me when a popup waits
for an answer" plus `Send test notification` (`PromptsService.SendTest`, ignores focus, honours the
switch).

### 3.7 Frontend

- Domain `packages/shared/domain/prompts.ts`: `promptKindSchema`, `routedPromptSchema`.
- `packages/workbench/src/prompts/`:
  - `promptsQueries.ts`: `usePrompts()` (`useQuery(['prompts'])`, push `kira:prompts:changed`
    writes the cache, refetch on `useWindowFocus` true), `useClaimPrompt()` mutation.
  - `PromptHost.vue`: props `kinds: Partial<Record<PromptKind, Component>>`, seam `{ list, claim,
    onChanged, onReveal }` from each app's bridge. Visible = entries with `target === windowKey`,
    minus window-local `hidden`; head = reveal override if visible, else oldest. Renders
    `<component :is="kinds[head.kind]" :key="head.id" :entry="head" :more="n" @hide="hide(head.id)" />`.
    Reveal push and Claim clear `hidden` for that id.
- Kind dialogs take `entry`/`more` and no longer self-mount from broadcast state:
  `ScheduleConfirmDialog` (run looked up by `entry.ref` in `useScriptRuns`; Escape emits `hide`),
  Studio `DbMcpApprovalDialog` (renders when `dbMcpStore.approval.pending.requestId === entry.ref`),
  Space `GitCredentialDialog` (relay entry by `entry.ref`, label shows source and repo),
  `MobilePairingDialog` (broker head by `entry.ref`), shared `UpdateDialog` wrapper
  `UpdatePrompt.vue` for the routed kind; the local status-bar open keeps the existing
  `v-if="appUpdateStore.dialogOpen"` mount.
- `App.vue` both apps: drop the always-mounted DbMcp, credential, mobile pairing mounts; mount
  `<PromptHost :kinds="promptKinds" />` once. `ScheduleConfirmHost` keeps only `request`; store
  `useScheduleConfirmStore` loses `dismissed`/`dismiss`; `Review and run` calls `claim(id,
  windowKey)` instead of opening locally.
- Seams: each app's `bridge/index.ts` adds `prompts*` calls and the two channels; mock runtimes
  (`tests/ui/support/mockRuntime.ts`, `ipcChannels.ts`) add `PromptsService.*` and pushes.

## 4. Files (one implementer)

- Go shared: `internal/shell/{registry,openwindow}.go` (+ tests' call sites);
  `internal/prompts/{prompts,router,bound}.go`, `internal/prompts/router_test.go`;
  `internal/desknotify/{desknotify,wails}.go`; `internal/appevent/appevent.go`;
  `internal/pairing/pairing.go`; `internal/scriptruns/{service,schedule,scheduler,confirm,bound,repo}.go`.
- Studio: `main.go`, `notify_darwin.go`, `notify_other.go`; `internal/appwire/{appwire,wire}.go`;
  `internal/bridge/{prompts,dbmcp}.go`; `internal/dbmcp/approval.go`;
  `internal/storage/{model,repos}/settings.go`; `internal/flowharness/harness.go`;
  `internal/flows/promptflow/**` (new), `flows/termflow/schedule_test.go`,
  `flows/dbmcpflow/*` (if they assert `MainWindow`); frontend `App.vue`, `bridge/*`,
  `state/{settingsDomain,dbmcp,appUpdate}.ts`, `workbench/DbMcpApprovalDialog.vue`,
  `workbench/settings/AdvancedPane.vue`, `workbench/automationsModule.ts`; `tests/ui/support/*`,
  `tests/ui/prompts.spec.ts` (new), specs touching approval/update/schedule popups;
  `tests/e2e-real/{prompts-two-windows-real,dbmcp-real,automations-recurring-real}.spec.ts`;
  regenerated bindings.
- Space: `main.go`, `notify_darwin.go`; `internal/agentnotify/agentnotify.go` (sink type),
  `internal/agentnotify/sink_darwin.go` (deleted); `internal/appwire/{appwire,wire}.go`;
  `internal/appshell/stream.go`; `internal/bridge/{prompts,gitstream,gitcredential,mobile,events}.go`;
  `internal/gitcred/relay.go`; `internal/gitsession/{conn,remote}.go` and
  `{remote,concurrency}_test.go`; `internal/gitrpc/{contract,wire,handlers,remote,handle}.go`
  (`credential.provide`); `internal/mobileweb/pairing.go`;
  `internal/storage/{model,repos}/settings.go`; `internal/flowharness/{harness,stream}.go`;
  `internal/flows/promptflow/**` (new), `flows/termflow/schedule_test.go`,
  `flows/gitflow/{credential,matrix,complete}_test.go`, `flows/mobileflow/*`; frontend `App.vue`, `bridge/*`,
  `main.ts`, `repo/git/transport.ts`, `state/{gitCredential,settingsDomain,appUpdate}.ts`,
  `workbench/{GitCredentialDialog,MobilePairingDialog}.vue`, `workbench/settings/AdvancedPane.vue`,
  `workbench/automationsModule.ts`; `tests/ui/support/*`, `tests/ui/prompts.spec.ts` (new),
  `tests/ui/git-credential-relay.spec.ts`, `tests/unit/git-credential-queue.spec.ts` (deleted with
  the queue); `tests/e2e-real/{prompts-two-windows-real,automations-recurring-real}.spec.ts`;
  regenerated bindings.
- Shared frontend: `packages/shared/domain/prompts.ts`;
  `packages/git-ipc/src/{contract,validate}.ts`, `rpc.test.ts`; Space `tests/ui/support/ipcChannels.ts`;
  `packages/workbench/src/prompts/{PromptHost.vue,promptsQueries.ts,UpdatePrompt.vue}`;
  `packages/workbench/src/automations/{module.ts,schedule/*,runs/ScriptRunView.vue}`;
  `packages/workbench/src/state/createAppUpdateStore.ts`; `packages/workbench/src/testing/e2eReal.ts`
  (`openMainWindow(kira)` helper).
- Docs: `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `docs/v2.2/SPEC.md` (row status, result
  pointer), `docs/v2.2/plans/P246-result.md`.

## 5. Tests

### 5.1 Unit `internal/prompts/router_test.go` (interacting routing rules, coalescing, concurrency)

Fake `Windows` (orders, focus) and recording sink:

- Target: origin alive -> origin; origin gone -> main (lowest order, not smallest key; ephemeral
  never main); claim beats origin; no windows -> `""`; `Reroute` after add moves queued entries to
  the new main; closing main moves entries to the next order.
- Notifications: one note per kind; second entry -> count title, same id; closing to zero ->
  `Remove(prompt:<kind>)`; target focused at open -> no send; `Enabled` false -> no send;
  `RevealKind` picks the oldest, calls `Reopen` when none, `Focus` and `Reveal` with that id.
- `Open` twice is one entry; concurrent `Open`/`Close`/`Reroute` under `-race` leave a consistent
  list and the last emit equals `List()`.

### 5.2 Flow tests `flows/promptflow` (both apps; P236 conventions, real services)

Harness: register windows with orders (`app.W.Windows.Add(key, order, nil, …)`), fake sink via
`app.W.Prompts.SetSink`, fake clock for schedule.

- Both: `TestScheduleConfirmRoutes`: two windows (`b` order 0, `a` order 1, so the smallest key is
  not main) -> waiting run lists target `b`; `MainWindow` = `b`; remove `b` -> target `a`; remove
  `a` -> target `""`; add `c` -> target `c`; `Claim(id, d)` with `d` registered -> target `d`;
  `ConfirmAccept` -> entry gone, `Remove("prompt:schedule")`; decline path likewise; one note posted
  for two waiting runs (count title).
- Both: `TestUpdatePrompt`: `Raise` twice -> one entry; `Dismiss` -> gone; `Raise` kind `dbmcp` ->
  `E_INVALID`; `SendTest` posts once; `advanced.notifyPrompts` off -> no note.
- Studio: `TestDbMcpApprovalRoutes`: prompt-mode write through the real MCP server -> entry kind
  `dbmcp` targeted at main; deny via `DbMcpService` -> entry and note gone; timeout path (short
  `ApprovalTimeout` seam if one exists, else ctx cancel of the MCP request) closes it.
- Space: `TestCredentialRoutes` (in `gitflow`, real git, HTTPS remote needing auth, the existing
  credential helper scaffolding): ADE board fetch -> relay entry origin `""` target main; native
  stream conn opened with window key `w2` (the flow drives `ServeGitStream` with that key) ->
  origin `w2`, target `w2`; `Provide` -> closed; conn closed mid-prompt -> closed.
- Space: `TestMobilePairingRoutes` (`mobileflow` helpers): phone pairing request -> entry targeted
  at main; approve -> gone; expiry -> gone.
- Every new bound method called; `ScriptRunsService.MainWindow` callers removed; both `exempt.txt`
  empty.

### 5.3 Playwright UI (mocked bridge), both apps `tests/ui/prompts.spec.ts`

Host shows an entry only when `target` equals the page's window key; two entries -> head plus
`1 more waiting`; a reveal push for the second entry brings it to the front; schedule Escape hides
it and a reveal brings it back; `Review and run` calls `Claim` with the window key; a pushed list
without the entry closes the dialog; Studio DB MCP and Space credential and mobile kinds render from
routed entries; update auto-open calls `Raise`, `Later` calls `Dismiss`; AdvancedPane switch and
test button. Existing specs that mount the old dialogs updated to push routed entries
(`git-credential-relay`, approval, update, recurring).

### 5.4 e2e-real, both apps `tests/e2e-real/prompts-two-windows-real.spec.ts`

Two pages: main key (`PromptsService.MainWindow`) and a random key. Recurring script `* * * * *`
confirm on: popup appears in the main page within 75 s, never in the other page; `Not now` in the
main page -> runs list shows `Skipped` in both pages. Studio `dbmcp-real.spec.ts` and both
`automations-recurring-real.spec.ts` open the main page through `openMainWindow`.

### 5.5 Checks

gofmt, `go vet ./...`, `go build -tags server ./apps/...`, golangci-lint on changed packages,
`GOOS=darwin CGO_ENABLED=0 go vet ./internal/desknotify/ ./internal/prompts/` (now vettable, D12;
the main-package glue still needs cgo on a Mac), `bun run typecheck`, `bun run lint`,
`bun run lint:dead`, `test:flows:space`, `test:flows:studio` (coverage gate), `go test -race
./internal/prompts/ ./internal/shell/ ./internal/pairing/ ./apps/kira-space/internal/gitcred/
./apps/kira-space/internal/gitsession/`, both UI suites, both visual suites (regenerate only
baselines this phase changes), both e2e-real suites. No real `claude` row applies (no Claude
integration code changes).

## 6. Commits

1. `refactor(shell): window order and main window key` (registry, `MainKey`, `Has`, `Focused`,
   `OnChange`; callers)
2. `refactor: shared desktop notification sink` (`internal/desknotify`, agentnotify on it)
3. `feat(prompts): router, bound service, notifications` (package, unit test, appevent channels,
   both appwires and `PromptsService`, settings leaf, Studio notify glue)
4. `feat(prompts): route schedule, DB MCP, mobile pairing and update prompts` (owners, bound
   removal)
5. `feat(git): route credential prompts by window` (relay origin, stream key, dead stream path and
   contract entries removed, `surfaceCredentialPrompts` removed)
6. `feat(workbench): prompt host` (domain, host, kind dialogs, App.vue mounts, settings panes,
   seams, mocks, bindings)
7. `test: prompt routing flows, UI and e2e-real`
8. `docs: prompt routing` (ARCHITECTURE section "Prompt routing (P246)"; Agent notifications
   section points at `internal/desknotify`; Known open items: delete the P242 Part 4 popup entry,
   widen the macOS notifications entry to Studio and prompt notifications; DEV_ENVIRONMENT e2e-real
   main-window note; SPEC row `Done`; result file)

Hooks green on every commit; no `--no-verify`.

## 7. Orchestrator verification checklist

- [ ] `rg -n "AnyRealKey" apps internal` empty; `rg -n "MainKey\(" apps internal` hits the router,
      `revealNote`, `MobileLaunches`.
- [ ] Router real: `rg -n "prompts\.New\(" apps/*/internal/appwire` hits both;
      `rg -n "\.Prompts\b|Prompts:" internal/scriptruns apps/kira-studio/internal/dbmcp
      internal/pairing apps/kira-space/internal/gitcred` shows Open and Close callers in each owner.
- [ ] No broadcast popups left: `App.vue` of both apps mounts `PromptHost` and none of
      `DbMcpApprovalDialog`, `GitCredentialDialog`, `MobilePairingDialog` directly;
      `ScheduleConfirmHost` has no `mainWindow` query.
- [ ] Main window by order: unit and flow tests assert a lower-order window with a larger key wins.
- [ ] Queue: flow asserts target `""` with no windows and a target after `Add`.
- [ ] Origin: Space flow asserts a stream credential prompt targets its own window key.
- [ ] Notifications: flows assert one note per kind and `Remove` on the last answer; Studio
      `notify_darwin.go` exists with `//go:build darwin && !server`; `rg -n "RemoveDeliveredNotification"
      internal/desknotify` hits.
- [ ] Click: `rg -n "RevealKind" apps/*/notify_darwin.go` hits both.
- [ ] Dead code gone: `rg -n "credential.request|credential.provide|surfaceCredentialPrompts|SetOnAdded"
      apps packages internal` empty outside docs history; `rg -n "MainWindow" internal/scriptruns`
      empty.
- [ ] No secret in a prompt: `Prompt` struct has no statement, prompt text, code or params field.
- [ ] Settings: `advanced.notifyPrompts` in both Go models and both TS domains; panes show the
      switch and test button.
- [ ] Bound: `PromptsService` in both `Bound()`; coverage gate green; both `exempt.txt` empty.
- [ ] Frontend rules: new `.vue` files `<script setup lang="ts">`, no `<style>`; no new Pinia store;
      TanStack `useQuery` in `promptsQueries.ts`.
- [ ] Tests per bar: one unit file (`router_test.go`); flows, UI, e2e-real as section 5.
- [ ] Hooks green; SPEC P246 `Done` with result; result lists the Mac handover (section 9).
- [ ] Codegraph: this planner's run shows real `codegraph_explore` calls; the implementer executes a
      named plan (no call required).

## 8. Concurrent work and file ownership

No concurrent implementation with either phase below; table order runs P243 Part 2, then P246, then
P247. Planning ran in parallel, so the implementer re-reads each file before editing.

- **P243 Part 2** (VS Code extension and git server removal) overlaps on: Space `main.go`
  (`surfaceCredentialPrompts`, gitsock wiring), `internal/appwire/{appwire,wire}.go`,
  `internal/bridge/{gitstream,events}.go`, `internal/gitsession/conn.go` (`RouteCredentials` callers),
  `internal/gitcred/relay.go` (gitsock source label), `internal/pairing/pairing.go` (gitsock user),
  `packages/git-ipc/src/contract.ts`, Space `App.vue` (`GitPairingDialog`),
  `tests/ui/support/mockRuntime.ts`, harness bound-count test, `docs/ARCHITECTURE.md`. Must land
  first. If `gitsock` still exists when P246 starts, its pairing broker gets kind `git-pairing`
  through the same `pairing.Config` hook rather than being skipped.
- **P247** (workflow branching overhaul) is expected to own `apps/kira-space/internal/ade/**`,
  `apps/kira-space/internal/flows/adeflow/**`, `apps/kira-space/frontend/src/ade/**` and workflow
  domain files. P246 edits none of them (D17 keeps `ade/board.go` on `Relay.Ask`). Shared: Space
  appwire, `docs/ARCHITECTURE.md`, `docs/v2.2/SPEC.md` (append-only sections; rebase merges).

## 9. Not in P246, and the Mac handover

- Linux and Windows desktop notifications (P238 kept them off; unchanged).
- Notification action buttons (approve from the banner): a click only reveals.
- Agent notes (P238) keep their own focus rules and settings.
- Mac handover for the result file (user, signed builds of both apps): a due recurring script with
  two windows open shows the popup only in the first-opened window and posts one banner while
  another app is focused; clicking the banner focuses that window and the popup; answering in Kira
  removes the banner; with every window closed (app still running) the banner click reopens a
  window showing the popup; Studio DB MCP approval does the same; `Send test notification` works in
  both apps; first use asks the macOS permission once. Until then the Known open item stays.
