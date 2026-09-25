# P116 — Kira Space window-chrome parity: inventory + plan

Opus planning pass. Inventory and plan only — nothing here is implemented yet. Base: `533a5e4`.
Sites are `file:line` against that commit. The implementer re-reads each site before editing.

Path shorthands: `ST/` = `apps/kira-studio/`, `SF/` = `apps/kira-studio/frontend/src/`,
`KS/` = `apps/kira-space/`, `KF/` = `apps/kira-space/frontend/src/`, `WB/` =
`packages/workbench/src/`, `SH/` = repo-root `internal/shell/`.

## §0 Goal, method, acceptance

**Goal.** List every generic window-chrome item Kira Studio exposes, side by side with Kira Space.
Wire every real gap into Space through the shared layer. Name every non-fit and why.

**Method.**
- CodeGraph `codegraph_explore` first, on: both apps' menu templates and `shell.BuildMenu`; both
  `main.go` window/menu wiring (`OpenNewWindow`, `AttachReopen`, `MenuDeps`); keep-awake
  (`KeepAwakeService`, `keepawake.Controller`, `AttachSystemWake`, `initKeepAwake`); update check
  (`appupdate.Checker`, `UpdateService`, `useAppUpdateStore`); metrics (`metrics.Ticker`,
  `AnchorNeedles`, `useAppMetricsStore`); `WindowsService.OpenNew`; `createCoreControl`; the
  terminal `AgentSessions` seam.
- Read, side by side: both `TitleBar.vue`, `StatusBar.vue`, `App.vue`, `main.ts`; shared
  `WB/components/{TitleBar,StatusBar}.vue`; both `bridge/events.go`; `SH/{menu,accel}.go`;
  `.github/workflows/release.yml`; `KS/build/config.yml`.
- Scope: native menu bar, window lifecycle, title-bar actions, status-bar app-wide items, root
  always-mounted dialogs, settings bound to chrome. Per-view content (grids, repo graph) is out.

**Acceptance** (SPEC row's own wording, made concrete):
1. §1's inventory table is committed (this file).
2. Every §2 gap (G1-G7) is wired into Space. Each reuses a shared `SH/`, repo-root `internal/`, or
   `WB/` primitive. Studio binds the same primitive afterwards. No Space-only reimplementation.
3. §3's blocked item (B1) lands as a named follow-up row in `docs/v1.9/SPEC.md`, not a result-
   section line (CLAUDE.md's out-of-scope rule).
4. Every gap is manually exercised in a running Kira Space on macOS, per §5.3's checklist. The
   implementer does this. If its session has no macOS display, the phase stays open until someone
   runs the checklist on a Mac. Never report it done from a Linux sandbox's UI tier alone.
5. Studio behavior is unchanged. Its `test:ui:studio` stays green with no spec edits except import
   paths.
6. `bun run lint`, `bun run typecheck`, `bun run lint:go`, `bun run lint:dead`, `go build ./...`
   pass on every commit. No `--no-verify`.

**One phase, no Part split.** G1-G7 share one file set: `KS/main.go`, `KS/internal/appshell/menu.go`,
`KF/App.vue`, `KF/bridge/index.ts`, `WB/bridge/createCoreControl.ts`. Two independent pieces do not
exist.

## §1 Inventory

Verdicts: **present** (both apps, same primitive), **gap Gn** (§2), **non-fit Nn** (§3),
**blocked B1** (§3), **n/a** (Space-only, listed for completeness).

| # | Surface | Kira Studio | Kira Space | Verdict |
| --- | --- | --- | --- | --- |
| 1 | App menu | About (role, `SH/menu.go:104-109`) | same, `KS/internal/appshell/menu.go:16` | present |
| 2 | App menu | New Connection ⌘N, `ST/internal/appshell/menu.go:20` | — | non-fit N1 |
| 3 | App menu | New Request, `:26` | — | non-fit N1 |
| 4 | App menu | Import Postman Collection…, `:28` | — | non-fit N1 |
| 5 | App menu | Import DataGrip Connections…, `:29` | — | non-fit N1 |
| 6 | App menu | Settings… ⌘,, `:31` | — (title-bar button only) | gap G1 |
| 7 | App menu | Services, Hide, Hide Others, Show All (`SH/menu.go:114-121`) | same, `KS/internal/appshell/menu.go:17` | present |
| 8 | App menu | Quit ⌘Q, `ItemQuit` → `Quitter.RequestQuit` (`SH/menu.go:61-69,122`) | same, `KS/main.go:231-234` | present |
| 9 | Edit menu | Undo … Select All (`SH/menu.go:90-100`) | same, `KS/internal/appshell/menu.go:20` | present |
| 10 | View menu | Toggle Project Panel ⌘B, `ST/internal/appshell/menu.go:40` | — (title-bar button only, no shortcut) | gap G2 |
| 11 | View menu | Toggle Operations Panel ⌘J, `:41` | — | non-fit N2 |
| 12 | View menu | Command Palette… ⇧⌘P, `:43` | — | non-fit N3 |
| 13 | View menu | Find ⌘F, `:44` | renderer keydown, `KF/workbench/WorkbenchShell.vue:33-38` | present (different binding path) |
| 14 | View menu | Refresh F5, `:45` | — | non-fit N4 |
| 15 | View menu | Run Statement ⌘↩, `:46` | — | non-fit N4 |
| 16 | View menu | Run All ⇧⌘↩, `:47` | — | non-fit N4 |
| 17 | View menu | Format ⌥⇧F, `:48` | — | non-fit N4 |
| 18 | View menu | Reload + Open DevTools, dev builds only, `:50-56` | — (no View section) | gap G3 |
| 19 | Window menu | Next Tab ⌃Tab, `:62` | — | gap G4 |
| 20 | Window menu | Previous Tab ⌃⇧Tab, `:63` | — | gap G4 |
| 21 | Window menu | Close Tab ⌘W, `:64` | — | gap G4 |
| 22 | Window menu | New Window ⇧⌘N, `:66`; `ItemNewWindow` (`SH/menu.go:71-77`) | same, `KS/internal/appshell/menu.go:26` | present |
| 23 | Window menu | Minimize, Zoom (`SH/menu.go:132-138`) | same, `KS/internal/appshell/menu.go:28` | present |
| 24 | Window menu | Close Window ⇧⌘W (re-accelerated, `:68`) | Close Window ⌘W (`WindowMenuTail("")`) | gap G4 (follows Close Tab) |
| 25 | Window menu | no Enter Full Screen item | no Enter Full Screen item | parity; §3 note |
| 26 | Lifecycle | Dock reopen, `shell.AttachReopen`, `ST/main.go:529` | same, `KS/main.go:229` | present |
| 27 | Lifecycle | Multi-window restore, cascade, bounds (`SH/openwindow.go:67-145`) | same, `KS/main.go:236-255` | present |
| 28 | Lifecycle | Quit handshake, per-window close flush (`Quitter`, `CloseFlushCoordinator`, `LifecycleService`) | same, `KS/main.go:133-166,181` | present |
| 29 | Lifecycle | System-wake keep-awake re-arm, `ST/main.go:531`, `ST/internal/appshell/wake.go:20-24` | — | gap G5 |
| 30 | Title bar | Mode switcher, `SF/workbench/TitleBar.vue:65-94` | — | non-fit N5 |
| 31 | Title bar | Connections panel toggle, `:100-109` | Repositories toggle, `KF/workbench/TitleBar.vue:19-28` | present |
| 32 | Title bar | Operations panel toggle, `:110-119` | — | non-fit N2 |
| 33 | Title bar | Settings button, `:120-128` | same, `KF/workbench/TitleBar.vue:29-37` | present |
| 34 | Title bar | Keep-awake (caffeinate) toggle, `:129-140` | — | gap G5 |
| 35 | Title bar | New window button, `:141-149` | — | gap G6 |
| 36 | Title bar | Drag region, double-click zoom (`WB/components/TitleBar.vue:24`) | same | present |
| 37 | Status bar | Caret status (`WB/components/StatusBar.vue:16-22`) | same | present |
| 38 | Status bar | — | Blame item, `KF/workbench/StatusBar.vue:36-52` | n/a |
| 39 | Status bar | Update available, `SF/workbench/StatusBar.vue:110-123` | — | blocked B1 |
| 40 | Status bar | Claude Code agent sessions, `:124-132` | — | non-fit N6 |
| 41 | Status bar | App CPU/memory metrics, `:133-147` | — | gap G7 |
| 42 | Status bar | Cache size, `:148-156` | — | non-fit N7 |
| 43 | Status bar | Engine status, `:157-169` | — | non-fit N7 |
| 44 | Root | `TooltipProvider`, `SF/App.vue:98` | same, `KF/App.vue:32` | present |
| 45 | Root | `ConfirmDialog`, `:111` | same, `:39` | present |
| 46 | Root | `ContextMenu`, `:112` | same, `:40` | present |
| 47 | Root | `SettingsDialog` via `TitleBarBase` `#settings` teleport | same | present |
| 48 | Root | `CommandPalette`, `:113` | — | non-fit N3 |
| 49 | Root | Connection, DataGrip import, Api, object upload, fake data, DB MCP approval dialogs, `:105-110` | — | non-fit N1 |
| 50 | Root | — | `GitPairingDialog`, `GitCredentialDialog`, `KF/App.vue:37-38` | n/a |
| 51 | Settings | Keep awake while Claude Code runs (`ReasonAgent`, `ST/internal/bridge/keepawake.go:77-120`) | — | non-fit N6 |

Counts: 51 rows. 48 Studio items (rows 38, 50 are Space-only; row 25 has no item either side).
21 Space items: 19 matching a Studio item, 2 Space-only. Verdicts: 18 present, 11 gap rows
(7 gaps, G1-G7), 18 non-fit rows (7 groups, N1-N7), 1 blocked, 1 parity-by-absence, 2 n/a.

Root cause, confirmed: every gap is a P100 trim, never a shared-layer hole.
- `KF/workbench/TitleBar.vue:8-11` drops New window as redundant with the Go menu. That holds for
  the shortcut, not the button.
- `KF/App.vue:19-27` and `KF/main.ts:19-24` drop every menu channel and the keep-awake/metrics
  stores as "subsystems that don't exist in this app". Keep-awake and metrics are app-wide, not
  Studio-domain.
- `KS/internal/appshell/menu.go:11-14` defers a View section "once there is a frontend to route
  them to". The frontend exists now.
- Studio-side blockers: keep-awake, metrics and the wake hook live under `ST/internal/`. Go's
  `internal/` rule hides them from Space. Reuse needs a hoist to repo-root `internal/`, the P103
  precedent.

## §2 Gaps and design

Shared rule (P113 §4 decline #3, holds): bound Wails types and methods stay per app, since binding
generation needs them per app. Their internals are shared. Every design below follows it.

### H — shared-layer hoists (land first, Studio switched over, no behavior change)

**H1 Channel constants.** `internal/appevent/appevent.go:55-60` gains `ChannelOpenSettings`,
`ChannelToggleProjectPanel`, `ChannelTabNext`, `ChannelTabPrev`, `ChannelTabClose`,
`ChannelKeepAwake`, `ChannelAppMetrics`. Values are byte-identical to `ST/internal/bridge/events.go:17,
22,25-27,41,89`. Studio re-exports them, precedent `KS/internal/bridge/events.go:20-25`. TS side
already shares them (`packages/shared/protocol/events.ts:9,14,19,35,66`).

**H2 `keepawake` package.** `git mv ST/internal/keepawake internal/keepawake`. Tests move with it.
Add `internal/keepawake/toggle.go`: `Toggle{Ctl *Controller}` owns the manual reason. Methods:
`State() State` and `SetManual(on bool) State`. `State{Manual, Supported bool; Error string}` is
`statusLocked`'s body (`ST/internal/bridge/keepawake.go:43-52`). Studio's bound `KeepAwakeService`
(`:17-27`) keeps its wire type, its agent reason and its package-level triggers. It delegates the
manual half to `Toggle`. Wire shape and emit behavior stay identical.

**H3 System-wake hook.** Move `AttachSystemWake` from `ST/internal/appshell/wake.go:20-24` to
`SH/wake.go`. `SH/` already imports Wails `application`/`events` (`SH/wails.go` `AttachReopen`).
Studio's `ST/main.go:531` calls `shell.AttachSystemWake`.

**H4 `metrics` package.** `git mv ST/internal/metrics internal/metrics`. `AnchorNeedles`
(`ticker.go:20`) is Studio's app name, so it leaves the shared package. Add
`metrics.NewAppTicker(appName string) *Ticker`. It wraps the 5 lines at `ST/main.go:331-336`:
`NewCachedPIDs(AppProcessSet([]string{appName}, HelperNeedles), RescanEvery)` then
`NewTicker(…, Interval)`. Needle = `Taskfile.yml`'s `APP_NAME` in both apps (`"Kira Studio"`,
`"Kira Space"`). `ST/cmd/g1measure/main.go:28` defaults `-anchor` to a `"Kira Studio"` literal with
a one-line comment naming `ST/Taskfile.yml`'s `APP_NAME`. Update imports in `ST/main.go` and
`ST/internal/bridge/events.go:114,151`.
- CI: `.github/workflows/pr.yml:59` names `./apps/kira-studio/internal/metrics/...`. Fold the
  retarget to `./internal/metrics/...` into the existing
  `docs/pending-changes/.github__workflows__pr.yml.patch` (its `@@ -58,7 +66,7 @@` hunk already
  edits that list). Add a header line for P116. Never recreate the file, never touch `pr.yml`
  directly (`docs/DEV_ENVIRONMENT.md:20-40`).

**H5 Frontend control seam.** Move these from Studio's `studioControl` (`SF/bridge/index.ts:77,82,
87-89` area, `:311-317`, `:324-325`, `:341`) into `WB/bridge/createCoreControl.ts`:
`onOpenSettings`, `onToggleProjectPanel`, `onTabNext`, `onTabPrev`, `onTabClose`,
`keepAwakeStatus`, `keepAwakeSetManual`, `onKeepAwakeChanged`, `onAppMetrics`, `windowsOpenNew`.
- `CoreBindings` gains `windows: { OpenNew(): Promise<void> }` and
  `keepAwake: { Status(): Promise<unknown>; SetManual(a: { enabled: boolean }): Promise<unknown> }`.
  Studio passes its existing binding modules (a structural superset).
- Declare `KeepAwakeStatus` in `createCoreControl.ts`, the `FolderChoice` precedent (`:68-75`).
- Studio keeps `keepAwakeSetAgentAware` in `studioControl`.

**H6 Frontend stores.** Factory precedent: `WB/state/createLayoutStore.ts:31-35` (`control`,
`extend`).
- `WB/state/createKeepAwakeStore.ts`: store id `keepAwake`, body = `SF/state/keepAwake.ts:18-39`
  (status, `initKeepAwake`, `setKeepAwakeManual`). Studio's `state/keepAwake.ts` becomes
  `createKeepAwakeStore(control, ({ state }) => ({ setKeepAwakeAgentAware }))`.
- `WB/state/createAppMetricsStore.ts`: store id `appMetrics`, body = `SF/state/appMetrics.ts:6-23`.
  Studio's file becomes a one-line factory call.

**H7 Frontend components.** Both apps render the same markup, so hoist it.
- `WB/components/TitleBarWindowActions.vue`: the keep-awake `TooltipIconButton` and the New window
  `Button` (`SF/workbench/TitleBar.vue:41-56,129-149`). Props: `keepAwake: KeepAwakeStatus`. Emits:
  `toggle-keep-awake`, `new-window`. Keep `data-testid`s `toggle-keep-awake`/`new-window`, DOM order
  and `wails-no-drag` exactly. Studio's `workbench.spec.ts:62-90` asserts order.
- `WB/components/AppMetricsItem.vue`: the metrics `Tooltip` plus the `cpuLabel`/`memLabel`/
  `metricsTooltip` computeds (`SF/workbench/StatusBar.vue:29-48,133-147`). Prop:
  `sample: AppMetricsSample | null`. Keep `data-testid`s `app-metrics`, `app-metrics-cpu`,
  `app-metrics-mem`.
- Studio's `TitleBar.vue`/`StatusBar.vue` render these in place of the inlined markup.

### G1 Settings… ⌘, in Space's App menu

- `KS/internal/appshell/menu.go:15-18`: insert `shell.Item{Kind: shell.ItemEmit, Label:
  "Settings…", Accelerator: shell.Shortcuts["app.settings"].Accelerator(), Channel:
  appevent.ChannelOpenSettings}` then a separator, between `AppMenuHead` and `AppMenuTail`. Studio's
  shape, `ST/internal/appshell/menu.go:31-32`.
- `KS/main.go:231-234`: `MenuDeps` gains `OnEmit: events.Signal`. `events` is already built
  (`KS/main.go:107`); `Signal` comes from the embedded `appevent.Events`. Today `OnEmit` is nil. Any
  `ItemEmit` click would panic without it.
- `KF/App.vue`: `onMounted` subscribes `control.onOpenSettings(() => { settingsStore.settingsOpen =
  true })`. `onUnmounted` unsubscribes. Studio's shape, `SF/App.vue:56-93`.

### G2 View › Toggle Project Panel ⌘B

- New View section in `BuildTemplate`, between Edit and Window (Studio's order,
  `ST/internal/appshell/menu.go:71`): `ItemEmit` "Toggle Project Panel",
  `Shortcuts["view.toggleProjectPanel"]`, `appevent.ChannelToggleProjectPanel`.
- `KF/App.vue` subscribes `control.onToggleProjectPanel(layoutStore.toggleProjectPanel)`
  (`WB/state/createLayoutStore.ts:95`).

### G3 View › Reload, Open DevTools (dev builds only)

- `BuildTemplate` takes `isDev bool`, same signature as Studio's (`ST/internal/appshell/menu.go:17`).
  When true, the View section appends a separator, `ItemRole application.Reload` and
  `ItemRole application.OpenDevTools` (`:50-56`).
- `KS/main.go`: `isDev := app.Env.Info().Debug` (Studio, `ST/main.go:533`). Pass it to both
  `BuildTemplate` and `MenuDeps.IsDev`.

### G4 Window › Next Tab, Previous Tab, Close Tab; Close Window ⇧⌘W

- Window section items before New Window, Studio's order (`ST/internal/appshell/menu.go:61-68`):
  Next Tab (`tab.next`), Previous Tab (`tab.prev`), Close Tab (`tab.close`), separator. Channels
  `appevent.ChannelTabNext/Prev/Close`.
- `WindowMenuTail("")` becomes `WindowMenuTail(shell.Shortcuts["window.close"].Accelerator())`.
  Close Tab now claims ⌘W. This is the parameter `SH/menu.go:126-131` keeps for exactly this case.
  Update that doc comment: Space no longer passes `""`, so the "one real divergence" note goes.
- `KF/App.vue` handlers, scoped to the active workspace (Space's analogue of Studio's mode scope,
  `SF/state/tabs.ts:394-400`):
  - Next/Previous: `tabsStore.stepTab(workspaceStore.active, 1 | -1)` (`WB/state/createTabsStore.ts:551-557`).
  - Close: read `tabsStore.activeIdByWorkspace[workspaceStore.active]`; if set, `closeTab(id)`.
    `closeTab`'s pin guard makes ⌘W a no-op on the pinned repo-graph tab.
- **User-visible change, flag it in the result section:** ⌘W in Space closes the active tab, not
  the window. ⇧⌘W closes the window. Identical to Studio.
- Rewrite the stale comment at `KS/internal/appshell/menu.go:22-24`.

### G5 Keep-awake toggle, with system-wake re-arm

Go (`KS/`):
- `KS/internal/bridge/keepawake.go`: bound `KeepAwakeService{Emit appcore.Emitter; Toggle
  *keepawake.Toggle}` with `Status() KeepAwakeStatus` and `SetManual(KeepAwakeSetManualArgs)
  KeepAwakeStatus`. `SetManual` emits `ChannelKeepAwake` with `Emit`, not `EmitTo`
  (`ST/internal/bridge/keepawake.go:65-75`). Wire types `KeepAwakeStatus`/`KeepAwakeSetManualArgs`
  mirror Studio's field for field. No agent reason, no `SetAgentAware` (N6).
- `KS/main.go`:
  - Construct `keepawake.New(keepawake.NewPlatformDriver())` beside the other services
    (`:114-129`). Register the bound service in `Services` (`:171-182`).
  - `teardown` (`:139-166`): call `Ctl.Close()` first thing, Studio's reason at
    `ST/internal/bridge/keepawake.go:140-145`.
  - After `app` exists: `shell.AttachSystemWake(app, ctl.Rearm)` (H3).
- Linux: `NewPlatformDriver` returns the no-op driver, `Supported()` is false, the button hides.

Frontend (`KF/`):
- `bridge/index.ts:123`: pass `keepAwake: KeepAwakeService` bindings to `createCoreControl`.
- `state/keepAwake.ts`: `createKeepAwakeStore(control, () => ({}))`.
- `main.ts:48-58`: `keepAwakeStore.initKeepAwake()` joins the `Promise.allSettled` group, not the
  critical `Promise.all`. A keep-awake read failure must never block boot (F2's own reasoning).
- `workbench/TitleBar.vue`: render `TitleBarWindowActions` after the Settings button, Studio's DOM
  order. Toggle handler: `keepAwakeStore.setKeepAwakeManual(!status.manual)`, `.catch` logs,
  Studio's `SF/workbench/TitleBar.vue:42-46`. Rewrite the header comment (`:8-11`).

### G6 New window title-bar button

- `KS/internal/bridge/windows.go`: bound `WindowsService{OpenNewWindow func()}` with one method,
  `OpenNew() error`. Nil guard and error text as `ST/internal/bridge/windows.go:67-73`. No
  `Ensure`/`SetMode` (N5: those persist `AppMode`).
- `KS/main.go`: construct before `application.New`, register in `Services`, assign
  `windowsSvc.OpenNewWindow = openNew` after `:228`. Studio's shape, `ST/main.go:386-390,528`.
- `KF/bridge/index.ts`: pass `windows: WindowsService` bindings. `TitleBarWindowActions`'
  `new-window` handler calls `control.windowsOpenNew()`, `.catch` logs (`SF/workbench/TitleBar.vue:35-39`).

### G7 App CPU/memory status-bar item

Go (`KS/`):
- `KS/main.go`: `metricsTicker := metrics.NewAppTicker("Kira Space")`, then `Start()`. Studio
  starts it before `application.New` (`ST/main.go:335-336`) through the same deferred emitter, so
  mirror that.
- `KS/internal/bridge/events.go`: add `(*Events) AttachMetrics(src interface{ OnSample(func(metrics.Sample)) func() }) (detach func())`,
  emitting `ChannelAppMetrics` per sample. Studio's body, `ST/internal/bridge/events.go:151-153`.
  `Events` needs the raw emitter for this; add an `emit` field, Studio's shape (`:126-133`).
- `beforeFlush` (`KS/main.go:136-138`): detach, then `metricsTicker.Stop()`. Studio moved the stop
  out of teardown into `beforeFlush` for a reason (`ST/main.go` `wireLifecycle` comment); follow it.

Frontend (`KF/`):
- `state/appMetrics.ts`: `createAppMetricsStore(control)`.
- `main.ts`: `useAppMetricsStore(pinia).initAppMetrics()` synchronously before `app.mount`, Studio's
  placement (`SF/main.ts` `mountShell`).
- `workbench/StatusBar.vue`: render `<AppMetricsItem :sample="appMetricsStore.sample" />` in the
  `#right` slot. Rewrite the header comment (`:14-16`).

### Shared plumbing for G1-G7 in Space's frontend

- Rewrite the stale comments in `KF/App.vue:19-27` and `KF/main.ts:19-24`.
- Regenerate bindings: `wails3 task common:generate:bindings` (`docs/DEV_ENVIRONMENT.md:249-255`).
  Commit the new `KF/../bindings/**` modules for `WindowsService` and `KeepAwakeService`.
- UI test tier (`KS/tests/ui/support/`):
  - `ipcChannels.ts`: add `windowsOpenNew`, `keepAwakeStatus`, `keepAwakeSetManual`,
    `keepAwakeChanged`, `appMetrics`, `openSettings`, `toggleProjectPanel`, `tabNext`, `tabPrev`,
    `tabClose` keys, same values as `ST/tests/ui/support/ipcChannels.ts`. Update the "10 services"
    header count.
  - `mockRuntime.ts` `CHANNEL_TO_FQN`: the four new bound methods' FQNs.
  - `bootSnapshots.ts`: default `keepAwakeStatus` `{ manual: false, supported: false, error: '' }`,
    Studio's default.
- One new spec, `KS/tests/ui/window-chrome.spec.ts`. It is the sandbox-runnable proof, mirroring
  Studio's `ST/tests/ui/workbench.spec.ts:62-140`. Cases:
  1. New window button is rightmost; one click sends exactly one `windowsOpenNew`.
  2. Keep-awake button hidden when `supported: false`; shown when true; a click sends one
     `SetManual {enabled: true}`; a pushed `kira:keepAwake:changed` flips `aria-pressed` with no click.
  3. A pushed `kira:app:metrics` sample renders `app-metrics` with CPU and memory text.
  4. Pushed menu channels: `kira:open-settings` opens the Settings dialog;
     `kira:menu:toggle-project-panel` toggles the project panel; `kira:menu:tab-next` activates the
     next tab; `kira:menu:tab-close` closes the active non-pinned tab.

## §3 Non-fits, blocked, parity notes

**N1 Studio-domain commands and dialogs** (rows 2-5, 49). Connections, API requests, Postman and
DataGrip imports, object upload, fake data, DB MCP approval. Space has none of those subsystems.
Not window chrome.

**N2 Operations panel** (rows 11, 32). Space's layout store has no `toggleOperationsPanel`
(`KF/state/layout.ts:4-14`). Its shell never passes `#dock` (`KF/workbench/WorkbenchShell.vue:19-22`).

**N3 Command palette** (rows 12, 48). Studio's palette lists Studio's own commands, mode switches
included. Space registers one command, `view.find` (`KF/workbench/WorkbenchShell.vue:30-32`).
Building a palette is a new feature, not parity wiring.

**N4 Refresh, Run, Run All, Format** (rows 14-17). They dispatch into Studio's data/query view
command handlers (`SF/App.vue:84-87`). Space has no handler for any of them.

**N5 Mode switcher** (row 30), and `WindowsService.Ensure`/`SetMode`. Space has no `AppMode`
(`docs/ARCHITECTURE.md:2380-2386`).

**N6 Claude Code agent surfaces** (rows 40, 51). The agent-sessions item and the
keep-awake-with-agents reason both need AgentHooks and a `claudeCode` settings leaf. P100 removed
both from Space on purpose: `KS/internal/bridge/terminal.go:11-17`,
`KF/views/repo/RepoTerminalView.vue:8-17`, `KF/state/settingsDomain.ts:10-17`. Space's keep-awake
therefore composes the manual reason only.

**N7 Engine status, cache size** (rows 42, 43). Studio's in-process adapter engine and L2 page
cache. Space has neither.

**B1 Update-available notifier** (row 39) — real gap, blocked outside this phase's scope.
- Space ships no releases. `.github/workflows/release.yml` builds, stamps and publishes only
  Studio's DMG (`:88-95,116,177-181`) on `v*.*.*` tags. `KS/build/config.yml:14` stays `"0.0.0"`, a
  dev sentinel, so `appupdate.isReleaseBuild` is false and the checker never fetches
  (`ST/internal/appupdate/version.go:13-27`).
- `appupdate.Checker` hard-codes Studio's `releases/latest` (`checker.go:30-34`). Even a stamped
  Space build would compare its version against Studio's tag.
- Wiring it now would ship dead code. CLAUDE.md forbids half-implemented scope.
- Action (first implementer commit): append a SPEC row. Take the next free `P` number after scanning
  every chapter's `SPEC.md` (P119 at `533a5e4`). Suggested title: "Kira Space release feed and
  update notifier". Body: a Space release job (via `docs/pending-changes/`), a per-app tag scheme,
  `appupdate` hoisted to repo-root `internal/` and parameterized by repo/tag prefix, then
  `UpdateService` plus the status-bar item wired into Space through P116's shared seams. Row goes
  last, after P118.

**Full screen** (row 25). Neither template declares a menu item. Both windows get the traffic-light
full-screen button from Wails' defaults. Parity holds, so no gap. AppKit may auto-insert "Enter
Full Screen" once Space has a View menu (G2); record what §5.3 step 8 shows, change nothing.

**Also checked, not items:** Studio's own Quick Open channel is gone since P100
(`SF/bridge/index.ts:84-88`), and Space has no Quick Open either. Neither app has a Check for
Updates menu item; the status-bar notifier is Studio's only update surface.

## §4 Commit sequence, file ownership, implementer call

**Call: one sequential Sonnet implementer.** No stream split. H5-H7 and G1-G7 all touch
`WB/bridge/createCoreControl.ts`, `KS/main.go` and `KF/App.vue`, and G5-G7 depend on H2-H7 landing
first. That is real overlap plus an ordering dependency, CLAUDE.md's no-split case.

Commits, in order. Each lands as it completes; fast checks per commit.

1. `docs(v1.9): add <Pn> Kira Space release feed and update notifier row` — B1's SPEC row.
2. `refactor(shell): hoist menu, keep-awake and metrics channel constants to internal/appevent` — H1.
3. `refactor: hoist keepawake to repo-root internal, add Toggle` — H2. Studio delegates.
4. `refactor(shell): hoist AttachSystemWake to internal/shell` — H3.
5. `refactor: hoist metrics to repo-root internal, add NewAppTicker` — H4, including the
   pending `pr.yml` patch edit and `g1measure`.
6. `refactor(workbench): hoist window-chrome control methods into createCoreControl` — H5.
7. `refactor(workbench): add createKeepAwakeStore and createAppMetricsStore` — H6. Studio switched.
8. `refactor(workbench): add TitleBarWindowActions and AppMetricsItem` — H7. Studio switched.
   Run `test:ui:studio`'s `workbench.spec.ts` here once; it guards H7's DOM order.
9. `feat(kira-space): Settings…, View and tab commands in the native menu` — G1-G4, Go menu plus
   `KF/App.vue` subscriptions. `MenuDeps.OnEmit` and `IsDev` land here.
10. `feat(kira-space): keep-awake toggle with system-wake re-arm` — G5, Go and frontend. Includes
    bindings regeneration.
11. `feat(kira-space): New window title-bar button` — G6.
12. `feat(kira-space): app CPU/memory status-bar item` — G7.
13. `test(kira-space): window-chrome UI spec` — §2 spec plus support-file entries.
14. `docs: record shared keep-awake, metrics and window-chrome primitives` — see below.
15. `docs(v1.9): record P116 result` — `## P116 result` in SPEC.md: gaps wired, the ⌘W change,
    the B1 row number, the §5.3 checklist outcome.

Commit 14 touches:
- `docs/ARCHITECTURE.md:2040-2060`: keep-awake now runs in both apps, from repo-root
  `internal/keepawake`; Space composes the manual reason only.
- `docs/ARCHITECTURE.md:66,2225,2288-2300`: `internal/metrics` is repo-root now; the anchor needle
  is each app's `APP_NAME`.
- `docs/ARCHITECTURE.md` Kira Space banner (`:2375-2395`): one sentence listing Space's native
  menu and title-bar items.
- `docs/DEV_ENVIRONMENT.md:231`: `internal/metrics` is no longer Studio-only.

| Area | Files |
| --- | --- |
| Shared Go | `internal/appevent/appevent.go`, `internal/keepawake/**` (moved plus `toggle.go`), `internal/metrics/**` (moved), `internal/shell/{wake.go,menu.go}` |
| Studio Go | `ST/main.go`, `ST/cmd/g1measure/main.go`, `ST/internal/bridge/{events,keepawake}.go`, `ST/internal/appshell/wake.go` (deleted) |
| Space Go | `KS/main.go`, `KS/internal/appshell/menu.go`, `KS/internal/bridge/{events,keepawake,windows}.go` |
| Shared frontend | `WB/bridge/createCoreControl.ts`, `WB/state/{createKeepAwakeStore,createAppMetricsStore}.ts`, `WB/components/{TitleBarWindowActions,AppMetricsItem}.vue` |
| Studio frontend | `SF/bridge/index.ts`, `SF/state/{keepAwake,appMetrics}.ts`, `SF/workbench/{TitleBar,StatusBar}.vue` |
| Space frontend | `KF/bridge/index.ts`, `KF/state/{keepAwake,appMetrics}.ts`, `KF/workbench/{TitleBar,StatusBar}.vue`, `KF/App.vue`, `KF/main.ts`, `KS/frontend/bindings/**` |
| Space tests | `KS/tests/ui/window-chrome.spec.ts`, `KS/tests/ui/support/{ipcChannels,mockRuntime,bootSnapshots}.ts` |
| Docs | `docs/v1.9/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `docs/pending-changes/.github__workflows__pr.yml.patch` |

Resume rule: this doc plus the commit log is the full state. An interrupted run resumes at the
first commit above not yet in `git log`.

## §5 Verification

### §5.1 Per commit (fast)

- `go build ./...`, `bun run lint:go`, `go test` of each touched Go package
  (`./internal/keepawake/...`, `./internal/metrics/...`, `./internal/shell/...`,
  `./apps/kira-space/...` for Space Go commits).
- `bun run typecheck`, `bun run lint`.

### §5.2 Once, near phase end (full)

- `bun run test:go`.
- `bun run test:ui:studio`, `bun run test:ui:space` (includes the new spec), `bun run test:unit`.
- `bun run lint:dead`: every hoisted export has a real caller in both apps.
- Orchestrator greps (real checks, not subagent prose):
  - `grep -rn "apps/kira-studio/internal/\(keepawake\|metrics\)" --include=*.go .` → 0.
  - `ST/internal/appshell/wake.go` does not exist; `grep -rn "shell.AttachSystemWake" apps/*/main.go` → 2 hits.
  - `grep -rn "shell.OpenNewWindow\|OpenNewWindow = openNew" apps/kira-space/main.go` → the menu
    closure plus the `WindowsService` assignment.
  - `grep -rn "createKeepAwakeStore\|createAppMetricsStore" apps/*/frontend/src/state` → 4 hits, 2 per app.
  - `grep -rn "TitleBarWindowActions\|AppMetricsItem" apps/*/frontend/src/workbench` → 4 hits, 2 per app.
  - `grep -n "OnEmit\|IsDev" apps/kira-space/main.go` → both set.
  - `grep -n "ChannelOpenSettings\|ChannelTabClose\|Reload" apps/kira-space/internal/appshell/menu.go` → present.
  - `SPEC.md` has B1's new row.
  - The pending `pr.yml` patch names `./internal/metrics/...`.

### §5.3 Manual exercise in a running Kira Space (macOS; implementer's job)

Run `bun run dev:space` on a Mac, or open a packaged build. Record each step's outcome in the
result section. A Linux sandbox has no native menu bar and a no-op keep-awake driver, so it cannot
satisfy this step. If the implementer's session is Linux-only, it stops after §5.2 and says so.
The phase stays open until this checklist runs on a Mac.

1. App menu shows Settings… ⌘,. ⌘, opens the Settings dialog in the focused window only.
2. View › Toggle Project Panel, and ⌘B, hide and show the Repositories panel. The title-bar toggle's
   `aria-pressed` follows.
3. Dev build: View shows Reload and Open DevTools, and both work. Packaged build: neither shows.
4. With 3+ tabs open in a repo workspace: ⌃Tab and ⌃⇧Tab cycle and wrap. ⌘W closes the active
   tab. ⌘W on the pinned graph tab does nothing. ⇧⌘W closes the window.
5. Title-bar coffee button: click on, run `pgrep -fl caffeinate` (one process, argv names this
   app's pid). Click off, the process exits. Open a second window: its button shows the same state.
6. Keep-awake on, sleep and wake the Mac: `caffeinate` is running again after wake.
7. Title-bar New window button opens one cascaded window. ⇧⌘N still does the same.
8. Status bar shows CPU % and memory within 5 s. Values move under load (open a large repo). Note
   whether AppKit added an Enter Full Screen item under View (§3).
9. Quit with keep-awake on: no `caffeinate` process survives.
