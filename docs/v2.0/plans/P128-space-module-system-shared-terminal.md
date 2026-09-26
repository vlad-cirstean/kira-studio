# P128 — Kira Space module system; terminal module shared by both apps; `ade` slot registered

Plan for `docs/v2.0/SPEC.md`'s P128 row. Planned against `v1.9` at `195815f2` (P127 landed).

Kira Space today has one hard-wired workspace: `GitPanel`/`GitStart` mounted straight into its
shell. This phase gives it Kira Studio's module system, hoisted into `packages/workbench` so both
apps share one registry shape, one mode store, one switcher. Then three modules land in Space:
`git` (existing workspace, formalized), `terminal` (Studio's module, extracted once, both apps
consume it), `ade` (placeholder for P129).

Every path, symbol and count below was measured in this container against `195815f2`:
`codegraph_explore` for symbols, call graphs and blast radius; `rg` repo-wide for consumers;
`diff` between the two apps' terminal bridges and terminal tab views; Wails' own generator and
runtime source (`v3.0.0-beta.21`) for the binding-name rule §2.1 depends on.

---

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Package boundary for the shared module system | **`packages/workbench`** (`modes.ts`, `state/createModeStore.ts`, `components/ModeSwitcher.vue`, `components/TabStripNewButton.vue`). New package declined, same reasons as P127 §2.2 | §2.3 |
| Package boundary for the shared terminal module | **`packages/workbench/src/terminal/`**, beside `TerminalHostView.vue` and the renderer it already holds | §2.4 |
| One shared Go terminal surface without moving `@bindings` | **Repo-root `internal/terminal.BoundService`** carries the whole bound method set. Each app's `bridge/terminal.go` shrinks to `type TerminalService struct{ *terminal.BoundService }`. Binding FQNs, `@bindings` paths and UI mocks stay unchanged | §2.1 |
| Mode persistence per app | **Space mirrors Studio: per-window, persisted.** SPEC's own "mirror … `state/mode.ts`'s persisted per-window mode" rules out in-memory. Space migration `0003` adds `windows.mode`. Mode SQL and the bound `Ensure`/`SetMode` hoist to repo-root, used by both apps | §2.2 |
| `RepoTerminalView.vue`: fold in or stay | **Folds in.** It and Studio's `views/terminal/TerminalView.vue` are byte-identical bar comments; both delete. One shared `TerminalTabView.vue` renders the `terminal` tab kind in both apps. Repo scoping lives only in the opener (`openRepoTerminalTab`), which stays in the git module | §2.5 |
| Custom-scripts coupling | **Optional `scripts` seam** on the injected terminal module context. Studio injects its store; Space injects none, so its panel has no Quick commands section (P133's row expects exactly this) | §2.4 |
| Per-module branches in the shells (`showNewTab = modeStore.active === 'terminal'`) | **Removed.** `ModeDef` gains optional `newTab: Component`; each module owns its "+" | §2.3 |
| `ade` label and icon | `'Agents'`, codicon `robot` (confirmed present in `@vscode/codicons` 0.0.46-24's `codicon.css`). P129 may rename: a registry-only edit | §2.7 |
| One pass or parts? | One pass, one sequential Sonnet subagent | §3 |

---

## 1. Confirmed current state

### 1.1 Studio module system

| File | Contents |
|---|---|
| `packages/shared/domain/mode.ts` | `AppMode = 'studio' \| 'api' \| 'terminal'`. Also feeds `domain/tabs.ts`'s `TabScope = AppMode \| 'repo'` |
| `apps/kira-studio/frontend/src/workbench/modes.ts` | `ModeDef{label, icon, panel, start}`; `MODES: Record<AppMode, ModeDef>`. `terminal` entry lazy (`defineAsyncComponent`) over `../terminal/TerminalPanel.vue`/`TerminalStart.vue` |
| `apps/kira-studio/frontend/src/state/mode.ts` | `useModeStore`: `active` (default `'studio'`), `writeMode` via `control.windowsSetMode`, `useDebounceFn` at `MODE_WRITE_DEBOUNCE_MS = 150`, `flushModeWrite` on `control.onFlushBeforeClose`/`onWindowFlushBeforeClose`, `hydrateMode`, `setMode`, `activeTab`. Plus `workspaceKeyOf(tab)` over `STUDIO_TAB_KIND_MODE` |
| `workbench/TitleBar.vue` (135) | `MODE_ORDER`, switcher markup lines 55-81 (`data-testid="mode-tab"`, `:data-mode`, `mode-tab-icon`, `CodiconIcon :size="16"`, `.mode-label`), then panel toggles, Settings, `TitleBarWindowActions` |
| `workbench/WorkbenchShell.vue` (118) | `MODES[...].panel`/`.start` lookups; **per-module branch** `showNewTab = modeStore.active === 'terminal'` (line 35); `terminalModuleMenuItems` (single `new-terminal` item, disabled while `cwd === ''`); `onNewTab` anchors the menu under the button; `#new-tab` markup (`tab-strip-actions`, `tab-strip-new`, aria-label/tooltip "New tab", `aria-haspopup="menu"`); `#dock` OperationsPanel; `#status` StatusBar |
| `workbench/host.ts` | `activeWorkspace = modeStore.active` |
| `bridge/index.ts:293-305` | App-side `windowsEnsure(): Promise<AppMode>` (via `trust<WailsModels.WindowsEnsureResult>`) and `windowsSetMode` |
| `main.ts:338` | `modeStore.hydrateMode(await control.windowsEnsure())` before any other window-scoped hydrate |

### 1.2 Studio terminal module (the code to extract)

| File | Lines | Couplings to the app |
|---|---|---|
| `terminal/TerminalPanel.vue` | 259 | `useCustomScriptsStore` (records, `createCustomScript`, `removeCustomScript`), `useSettingsStore().openSettingsAt('Scripts')` ("Edit…", "Manage scripts…"), `useTerminalsStore().terminalDefaults.cwd`, `openTerminalTab({workspaceId: 'terminal', …, launch: {kind: 'script'}})`. Everything else already comes from `@theme`/`@workbench`/`@shared` |
| `terminal/TerminalStart.vue` | 53 | `useTerminalsStore().terminalDefaults.cwd`, `openTerminalTab({workspaceId: 'terminal', cwd})` |
| `workbench/WorkbenchShell.vue:35-61` | — | The terminal "+" menu (§1.1) |
| `views/terminal/TerminalView.vue` | 36 | Builds `TerminalHostDeps` from `settingsStore.appearance` and `terminalsStore`; renders `<TerminalHostView>` |
| `state/customScripts.ts` | — | Studio-only store (P85). Stays |

Test IDs `terminal-panel`, `quick-command-*`, `quick-commands-manage`, `tree-search`,
`toggle-search`, `terminal-start`, `terminal-start-new` are asserted by
`tests/ui/terminal-module.spec.ts` and `settings-scripts.spec.ts`. They move with the markup, unchanged.

### 1.3 Already shared terminal code — do not re-move

`packages/workbench/src/terminal/{TerminalHostView.vue, useTerminalMount.ts, terminalRenderer.ts,
terminalRendererLoader.ts}`; `state/createTerminalsStore.ts` (`terminalDefaults`,
`openTerminalSession`, …); `state/createTerminalTabs.ts` (`createOpenTerminalTab<K>`,
`TerminalLaunch`, `OpenTerminalTabOpts<K>`); `bridge/createCoreControl.ts`'s terminal methods.
Both apps' `state/terminals.ts`/`state/terminalTabs.ts` are one-line instantiations.

### 1.4 Kira Space: no module system

- No `workbench/modes.ts`, no `state/mode.ts`, no mode vocabulary anywhere.
- `workbench/WorkbenchShell.vue` (104): `<GitPanel/>` in `#panel`, `<GitStart/>` in `#empty`, the
  `view.find` keydown, and its own "+" (`showNewTab = workspaceStore.active !== GENERAL_WORKSPACE`,
  `onNewTab` calls `openRepoTerminalTab(repoId, record.root)`; aria-label "New terminal", tooltip
  "New terminal at repository root"). No `#dock`.
- `workbench/TitleBar.vue` (68): no switcher. Actions: `toggle-project-panel` ("Repositories"),
  `open-settings`, `TitleBarWindowActions`. `tests/ui/window-chrome.spec.ts` asserts that order.
- `workbench/host.ts`: `activeWorkspace = workspaceStore.active`.
- `state/workspace.ts` (96): `GENERAL_WORKSPACE = '__general__'`, `repoWorkspaceKey`/
  `repoIdOfWorkspace` (identity), `useWorkspaceStore` (`active`, `openRepos`, `lastRepoKey`,
  `activateWorkspace`, `openRepoWorkspace`, `closeRepoWorkspace`).
- `state/tabs.ts:107-118`: `activateNextTab`/`activatePrevTab`/`closeActiveTab` read
  `useWorkspaceStore().active`. `workspaceKeyOf = tab.workspaceId ?? GENERAL_WORKSPACE`.
- `state/repoTabs.ts:268`: `openRepoTerminalTab` opens a terminal in the repo's workspace.
- `repo/GitPanel.vue:51,95` reads `workspaceStore.active` (repo selection).
- `main.ts` (104): no `windowsEnsure`. Critical `Promise.all`, then optional `allSettled` including
  `hydrateTerminalDefaults`, then `ensureWorkspaceShell` per restored repo, then fall-forward onto
  the first restored repo (line 87).
- `workbench/tabViews.ts:7,20`: `terminal: TerminalTabView` imported from `views/repo/RepoTerminalView.vue`.
- Space `tests/visual/` covers Settings only; no title bar or shell baseline.

### 1.5 Go terminal bridges

`diff apps/kira-studio/internal/bridge/terminal.go apps/kira-space/internal/bridge/terminal.go`
after P127 differs only in: the `appcore` import path (both `appcore.Emitter` alias
`appevent.Emitter`), comments, and Studio's `agent := args.LaunchKind == terminal.LaunchKindClaudeCode`
plus `Agent: agent` in `OpenParams`. Space never sets `Registry.OnChange`, so `Agent` is inert there.

Each file: struct `{Emit appcore.Emitter; Registry *terminal.Registry}`, unexported `svc()`,
bound `Shutdown`, `DefaultCwd`, `Open`, `Write`, `Resize`, `Close`, and wire types
`TerminalOpenArgs` (json-tagged twin of `terminal.OpenArgs`), `TerminalOpenResult`,
`TerminalWriteArgs`, `TerminalResizeArgs`, `TerminalCloseArgs`, `TerminalDefaultCwdResult`.

Construction: Studio `main.go:383` (then `:388` sets `Registry.OnChange` for keep-awake), Space
`main.go:136`. No Go test references `TerminalService`. No frontend file imports the generated
terminal arg models (`rg TerminalOpenArgs` outside `bindings/` hits Go only).

### 1.6 Window mode persistence

- Studio: `bridge/windows.go` `WindowsService{Deps; OpenNewWindow}` with `Ensure`
  (`EnsureExists` then `GetMode`), `SetMode`, `OpenNew`. `storage/repos/windows.go:88-115`
  `GetMode`/`SetMode` SQL; `List` reads `mode` too. `storage/model/window.go:25-46`
  `validWindowModes`, `DefaultWindowMode`, `NormalizeMode`. Migration `0014_p22_window_mode.sql`.
  Tests: `repos/windows_test.go`, `migrate_window_mode_test.go`.
- Space: `bridge/windows.go` `WindowsService{OpenNewWindow}`, `OpenNew` only, a copy of Studio's.
  `storage/repos/windows.go` delegates wholly to `internal/appstorage.WindowRepo`. No `mode`
  column (migrations `0001`, `0002`). `main.go:146` constructs, `:271` assigns `OpenNewWindow`.
- `internal/appstorage/window.go:35-41,53-57`: comments state Space has no `mode` column.

### 1.7 Wails binding names (why §2.1 keeps `@bindings` stable)

Bindings are generated with `-names`: each call is `$Call.ByName("<pkg>.<Type>.<Method>")`.
Generator (`internal/generator/collect/service.go`) builds the FQN from the **registered service
type's** package and iterates `typeutil.IntuitiveMethodSet`, which includes methods promoted from
embedded fields. Runtime (`pkg/application/bindings.go`) does the same: `namedType.PkgPath()` plus
`ptrType.NumMethod()`, promoted methods included. So `apps/<app>/internal/bridge.TerminalService`
embedding `*terminal.BoundService` keeps FQN `…/apps/<app>/internal/bridge.TerminalService.Open`.
Only arg/result models move to `bindings/github.com/kirathecat/kira-studio/internal/terminal/models.ts`.
Bindings are gitignored and regenerated (`wails3 task common:generate:bindings`).

### 1.8 Where SPEC was off

- "The two bound surfaces … differ mainly by P86's `AgentHooks` composition". After P127 they
  differ only by the inert `Agent` flag (§1.5).
- "Mirror … persisted per-window mode". Space has no `mode` column; mirroring needs a migration.
- Studio `workbench/tabViews.ts:34-37` still calls Studio's terminal view "duplicated from (not
  shared with)" Space's; P107 I2-19 and P127 already made the two wrappers identical. Stale.
- `packages/workbench/src/bridge/createCoreControl.ts:19-20` says `windowsEnsure`/`windowsSetMode`
  stay app-side because Space has no mode. False after this phase.

### 1.9 Downstream constraints

- P129 design §2.4 puts an xterm terminal with a status strip inside `ade`. Keep
  `TerminalHostView` prop-driven with its default slot; the shared `TerminalTabView` is a thin
  wrapper, not a replacement.
- P133 grows the scripts seam with `update` and drops the Settings deep-link. The seam shape here
  must take that without a rename.
- P132 edits Space `WorkbenchShell.vue`/`TitleBar.vue` after this phase.

---

## 2. Scope decision

### 2.1 Go: one bound terminal surface

New `internal/terminal/bound.go`:

```go
type BoundService struct {
	Emit     appevent.Emitter
	Registry *Registry
}
func (b *BoundService) Open(args OpenArgs) (OpenResult, error)
func (b *BoundService) Write(args WriteArgs) error
func (b *BoundService) Resize(args ResizeArgs) error
func (b *BoundService) Close(args CloseArgs) error
func (b *BoundService) DefaultCwd() DefaultCwdResult
func (b *BoundService) Shutdown()
```

- Bodies move from Studio's `bridge/terminal.go` verbatim, including `ErrDuplicateSession` to
  `E_INVALID` and `Agent: args.LaunchKind == LaunchKindClaudeCode`. `Agent` in Space stays inert
  (no `OnChange`): no behaviour change in either app.
- `OpenArgs` (`validate.go`) gains the json tags `TerminalOpenArgs` carries; it becomes the wire
  type and `ValidateOpen` takes it directly (no conversion). New `OpenResult`, `WriteArgs`,
  `ResizeArgs`, `CloseArgs`, `DefaultCwdResult` with the same fields and tags as today's
  `Terminal*` types.
- A separate type, not new methods on `Service`: `Service` exports `OpenWithCoalescedOutput` and
  positional `Write`/`Resize`/`Close`; embedding it would bind those too.
- Each app's `bridge/terminal.go` becomes one doc comment plus
  `type TerminalService struct{ *terminal.BoundService }`. Construction:
  `&bridge.TerminalService{BoundService: &terminal.BoundService{Emit: …, Registry: terminal.NewRegistry()}}`.
  Studio's `terminalSvc.Registry.OnChange` and `d.terminalSvc.Registry` resolve through promotion.
- **Accepted residue:** the two per-app files stay byte-identical bar the package's doc comment.
  They exist only to give each binding an app-local FQN. Full hoist (register
  `*terminal.BoundService` directly) declined: new `@bindings-internal` alias per app, a second
  `bridgePkg` in `buildChannelMaps`, tsconfig and Vite alias edits — P103 §2.3's stated cost.
- **Gate:** after regenerating, each app's `bindings/.../internal/bridge/terminalservice.ts` lists
  the same six `ByName` strings as at `P128_START` (§5 command). Contingency if a promoted method
  is missing: one-line forwarding methods on the per-app type, recorded in the result section.

### 2.2 Go: window mode, one implementation

- `internal/appstorage/window.go` gains:

  ```go
  type WindowModes struct {
  	Default string
  	Valid   []string
  }
  func (m WindowModes) Normalize(mode string) string
  func (r *WindowRepo) GetMode(key string, modes WindowModes) (string, error)
  func (r *WindowRepo) SetMode(key, mode string, modes WindowModes) error
  ```

  Bodies are Studio's `repos/windows.go:92-115`, error prefix `appstorage/windows:`. Comments at
  lines 35-41, 53-57 rewritten: both apps carry `mode`.
- Studio `model/window.go`: `validWindowModes`/`DefaultWindowMode`/`NormalizeMode` become
  `var WindowModes = appstorage.WindowModes{Default: "studio", Valid: []string{"studio", "api", "terminal"}}`.
  `repos/windows.go` `List` uses `model.WindowModes.Normalize`; `GetMode`/`SetMode` delegate.
- Space `model/window.go`: `WindowModes{Default: "git", Valid: {"git", "terminal", "ade"}}`.
  `repos/windows.go` gains delegating `GetMode`/`SetMode`. Migration
  `0003_p128_window_mode.sql`: `ALTER TABLE windows ADD COLUMN mode TEXT NOT NULL DEFAULT 'git';`.
  No new test: an `ALTER TABLE` default is not the complex logic CLAUDE.md's test bar asks for;
  Studio's `migrate_window_mode_test.go` already covers the pattern.
- New repo-root `internal/windowsvc/windowsvc.go`: `Service{Windows Store; OpenNewWindow func()}`,
  `Store` interface (`EnsureExists`, `GetMode`, `SetMode`), bound `Ensure(EnsureArgs)
  (EnsureResult, error)`, `SetMode(SetModeArgs) error`, `OpenNew() error`. Bodies are Studio's
  `bridge/windows.go`. Both apps: `type WindowsService struct{ *windowsvc.Service }`, same FQN rule
  as §2.1. Space's `WindowsService` gains `Ensure`/`SetMode` this way; its copied `OpenNew` goes.
- `Store` is the app's own `*repos.WindowsRepo` (`deps.Repos.Windows`), so vocabulary stays per app.

### 2.3 TS: shared mode plumbing in `packages/workbench`

- `src/modes.ts`: `ModeDef{label; icon; panel: Component; start: Component; newTab?: Component}`,
  `type ModeRegistry<M extends string> = Record<M, ModeDef>`. Doc comment carries Studio's P1
  D6/C6 rationale.
- `src/state/createModeStore.ts`: `createModeStore<M extends string, X>({control, defaultMode,
  extend?})`. `control: {windowsSetMode(m: M): Promise<void>; onFlushBeforeClose;
  onWindowFlushBeforeClose}`. Body is Studio's store minus `activeTab`: debounce constant, flush
  wiring and comments move verbatim. `extend` follows `createKeepAwakeStore`'s precedent; Studio
  passes `activeTab` through it. Store id stays `'mode'`.
- `src/components/ModeSwitcher.vue` (generic `M`): props `order: readonly M[]`, `modes:
  ModeRegistry<M>`, `active: M`; emits `select`. Markup, classes, test IDs and comments are Studio
  `TitleBar.vue:50-81` byte-for-byte, so Studio's visual baseline holds.
- `src/components/TabStripNewButton.vue`: the `tab-strip-actions` wrapper, Tooltip, button
  (`tab-strip-new`). Props `label`, `tooltip`, `hasPopup?: boolean`; emits `click` with the button
  element (menu anchoring). Markup identical to both shells today.
- `createCoreControl.ts`: `CoreBindings.windows` gains `Ensure(a: {windowKey: string})` and
  `SetMode(a: {windowKey: string; mode: string})`; `CoreControl`/`createCoreControl` gain a fifth
  generic `M extends string` and `windowsEnsure(): Promise<M>`, `windowsSetMode(mode: M)`. Result
  shape restated (`{mode: string}`), same reason `FolderChoice` is. Header comment lines 19-20
  rewritten. Both apps' call sites pass their mode type; Studio's app-side copies go.
- `MODE_ORDER` moves from Studio `TitleBar.vue` into each app's `workbench/modes.ts`, beside
  `MODES`: one file lists a module.
- Shells: `#panel` and `#empty` read `MODES[modeStore.active]`; `#new-tab` renders
  `MODES[modeStore.active].newTab` when set. No `modeStore.active === '<id>'` anywhere.
- `packages/shared/domain/mode.ts`'s `AppMode` stays Studio's vocabulary (it types `TabScope`).
  Space's `SpaceMode` is app-local in `state/mode.ts`. Moving `AppMode` out of `shared` is not asked.

### 2.4 TS: shared terminal module in `packages/workbench/src/terminal/`

- `module.ts`:

  ```ts
  export interface TerminalScriptsSeam {
    records(): readonly CustomScript[];
    create(fields: CustomScriptFields): Promise<unknown>;
    remove(id: string): Promise<void>;
    openEditor(): void;
  }
  export interface TerminalModuleContext {
    defaultCwd(): string;
    openTerminalTab(opts: { cwd: string; launch?: TerminalLaunch }): void;
    host: TerminalHostDeps;
    scripts?: TerminalScriptsSeam;
  }
  export const terminalModuleKey: InjectionKey<TerminalModuleContext>;
  export function useTerminalModule(): TerminalModuleContext; // throws if not provided
  export function useNewTerminal(): { canOpen: ComputedRef<boolean>; open(): void };
  ```

  `openTerminalTab` binds the app's module workspace (`'terminal'` in both) so shared code never
  names a workspace key. `useNewTerminal` holds the one `cwd === ''` guard `TerminalStart` and the
  "+" menu both used. P133 adds `update` and drops `openEditor`.
- `git mv` Studio `terminal/TerminalPanel.vue`, `terminal/TerminalStart.vue` into this dir. Store
  and settings imports become `useTerminalModule()` reads. Every Quick-commands element sits under
  `v-if="ctx.scripts"`. Without a seam the panel shows a "Terminal" header and one "New terminal"
  action (`useNewTerminal`), test ID `terminal-panel-new`. Studio's rendered DOM is unchanged.
- New `TerminalNewTab.vue`: `TabStripNewButton` (label/tooltip "New tab", `hasPopup`) plus Studio's
  `terminalModuleMenuItems` menu, verbatim.
- New `TerminalTabView.vue`: props typed as `TerminalHostView`'s own `tab` prop
  (`{id: string; state: TerminalHostTabState}`), since `TerminalTabRecord` is per-app
  (`state/tabDomain.ts` in each). Renders `<TerminalHostView :tab :deps="useTerminalModule().host">`.
- Each app: `workbench/terminalModule.ts` exports `createTerminalModule(): TerminalModuleContext`
  from its own stores; `App.vue` provides it under `terminalModuleKey`, beside `workbenchHostKey`.
  Studio's includes `scripts` (customScripts store, `openEditor = () => openSettingsAt('Scripts')`).
  Space's omits it.
- Each app's `MODES.terminal`: `{label: 'Terminal', icon: 'terminal-bash', panel, start (both
  `defineAsyncComponent` as today), newTab: TerminalNewTab}`.

### 2.5 `RepoTerminalView.vue` folds in

- Byte-identical to Studio's `TerminalView.vue` bar comments (§1.5 diff, codegraph source).
- Both apps register the same `terminalTabKind`; a repo terminal and a module terminal are one tab
  kind differing only in `workspaceId`/`codeRepoId`, set by the opener.
- `openRepoTerminalTab` (git module producer: repo "+", worktree "Open terminal") stays in
  `state/repoTabs.ts`, unchanged. Repo terminals still render in the repo's workspace.
- Both apps' `workbench/tabViews.ts` point `terminal` at `@workbench/terminal/TerminalTabView.vue`.
  `views/terminal/TerminalView.vue` and `views/repo/RepoTerminalView.vue` delete.

### 2.6 Kira Space: `git` module and workspace switching

- `state/mode.ts`: `export type SpaceMode = 'git' | 'terminal' | 'ade'`;
  `useModeStore = createModeStore<SpaceMode>({control, defaultMode: 'git'})`.
- `workbench/modes.ts`: `MODE_ORDER: ['git', 'terminal', 'ade']`, `MODES`:
  `git` = `{label: 'Git', icon: 'source-control', panel: GitPanel, start: GitStart, newTab: GitNewTab}`.
- `repo/GitNewTab.vue`: Space's current "+" logic moved verbatim onto `TabStripNewButton` (label
  "New terminal", tooltip "New terminal at repository root"). Hides with no active repo, as today.
- `state/workspace.ts`: `visibleWorkspace()` returns `workspaceStore.active` in git mode, the mode
  id otherwise. `host.ts` `activeWorkspace` and `tabs.ts:107-118` read it. `workspaceStore.active`
  stays git-only: a module key never reaches `repoIdOfWorkspace`, `GitPanel` or `lastRepoKey`.
  `openRepoWorkspace`/`activateWorkspace` switch mode to `git`, so any path that opens a repo
  shows it.
- Tab hydration needs no change: terminal tabs never persist (`createTabsStore`'s default
  `persistable` drops `kind === 'terminal'`) and `ade` opens no tab, so no module key reaches
  `onHydrated`'s `openRepos` derivation. Space's Go `TabRecord.Validate` accepts any workspace id.
- `TitleBar.vue`: `<ModeSwitcher>` before the right-side actions; action order unchanged
  (`window-chrome.spec.ts`). Toggle label stays "Repositories" in every mode, same as Studio's
  static "Connections".
- `main.ts`: `modeStore.hydrateMode(await control.windowsEnsure())` first, as Studio's `:338`.
  Line 84's comment updated; fall-forward to the first repo stays.
- No `KeepAlive`, same as Studio: `MainView` remounts on workspace change today. Git state lives in
  Pinia and survives a round trip; `RepoGraphView` remounts exactly as on a repo switch now.
- UI mock (`tests/ui/support/`): FQN entries `windowsEnsure: 'WindowsService.Ensure'`,
  `windowsSetMode: 'WindowsService.SetMode'`; `WILDCARD_DEFAULTS` `{mode: 'git'}` and `null`;
  the "no windowsEnsure" comments at `mockRuntime.ts:90`, `bootSnapshots.ts:17` rewritten.
  Existing specs boot into `git`, so none change.

### 2.7 `ade` placeholder

`apps/kira-space/frontend/src/ade/AdePanel.vue` (header "Agents", nothing else) and `AdeStart.vue`
(EmptyState: `robot` icon, "Agents arrive in a later update" style title, no action), shaped like
`GitStart.vue`. Imported only from `workbench/modes.ts`: `ade: {label: 'Agents', icon: 'robot',
panel, start}`, no `newTab`. Test IDs `ade-panel`, `ade-start`. No Go, no store, no bridge.

### 2.8 Out of scope, confirmed not forgotten

- Space script storage (P133 says so).
- Settings' Scripts pane removal and the scripts edit dialog (P133).
- Operations dock in Space (P132).
- Per-mode panel toggle labels in either app.
- Mode-switch menu items or shortcuts in Space (Studio has Go menu items; Space's Go menu emits no
  accelerators, `WorkbenchShell.vue`'s own note). Not asked.

---

## 3. Split decision: one pass

~600 moved lines, ~350 new, the rest deletions and comments. One sequential Sonnet subagent. No
split: steps 1-3 (Go) regenerate bindings the frontend steps typecheck against; step 4's shared
store is what steps 5-8 import; step 5's module is what step 7 registers. No zero-overlap
ownership table exists (Space `WorkbenchShell.vue`, `bridge/index.ts`, `mockRuntime.ts` are
touched by several steps).

---

## 4. Steps and commits

Every commit passes the pre-commit hook (`bun run lint`, `bun run typecheck`) and `go build ./...`.
Record `P128_START=$(git rev-parse HEAD)` and save both apps' generated
`bindings/**/internal/bridge/{terminalservice,windowsservice}.ts` `ByName` lines before step 1.
Regenerate bindings after each Go step.

1. **`refactor(terminal): one shared bound terminal surface`**
   Add `internal/terminal/bound.go` and wire types (§2.1); `OpenArgs` json tags. Both
   `bridge/terminal.go` to embedding only. Both `main.go` constructions. Rewrite
   `internal/terminal/service.go`'s "Open stays per-app" doc. Regenerate; run the FQN gate.
2. **`refactor(storage): hoist window mode read/write to appstorage`**
   `WindowModes`, `GetMode`, `SetMode` (§2.2). Studio model and repo delegate. Studio tests pass
   unchanged.
3. **`refactor(windows): one shared bound windows surface; Kira Space persists per-window mode`**
   `internal/windowsvc`, both `bridge/windows.go` to embedding, Space migration `0003`, Space model
   and repo, both `main.go`. Studio `bridge/index.ts:302` restates `{mode: string}` instead of
   `WailsModels.WindowsEnsureResult` (model moved). Regenerate; FQN gate for `windowsservice.ts`
   (Space gains `Ensure`, `SetMode`).
4. **`refactor(workbench): shared mode registry, store and switcher`**
   §2.3 files. Studio: `state/mode.ts` onto the factory, `modes.ts` imports `ModeDef` and gains
   `MODE_ORDER`, `TitleBar.vue` renders `ModeSwitcher`, `bridge/index.ts` drops its
   `windowsEnsure`/`windowsSetMode`. Space `bridge/index.ts` passes a temporary `string` for `M`
   (next steps narrow it). `test:ui:studio mode-switch` passes.
5. **`refactor(workbench): shared terminal module`**
   `ModeDef.newTab`, `TabStripNewButton`. §2.4 files; `git mv` panel and start. Studio
   `workbench/terminalModule.ts`, `App.vue` provide, `MODES.terminal.newTab`, `WorkbenchShell.vue`
   drops `showNewTab`/`terminalModuleMenuItems`/`onNewTab`, `tabViews.ts` uses `TerminalTabView`.
   Delete Studio `terminal/`, `views/terminal/TerminalView.vue`; remove `biome.json`'s override
   for `apps/kira-studio/frontend/src/terminal/**`. `test:ui:studio terminal-module
   settings-scripts mode-switch` pass.
6. **`feat(space): module registry with the git module`**
   §2.6: `state/mode.ts`, `workbench/modes.ts` (git only), `repo/GitNewTab.vue` (onto
   `TabStripNewButton`), `WorkbenchShell.vue` registry lookups, `TitleBar.vue` switcher,
   `visibleWorkspace`, `host.ts`, `tabs.ts`, `main.ts`, mock support. `bridge/index.ts` narrows
   `M` to `SpaceMode`. `test:ui:space` unchanged count, all pass.
7. **`feat(space): register the shared terminal module`**
   Space `workbench/terminalModule.ts` (no scripts), `App.vue` provide, `MODES.terminal`,
   `tabViews.ts` to `TerminalTabView`; delete `views/repo/RepoTerminalView.vue`.
8. **`feat(space): ade module placeholder`** — §2.7.
9. **`test(space): module switching`** — §5.2.
10. **`docs: ARCHITECTURE records the shared module system and terminal module (P128)`** — §4.2.
11. Result section in `docs/v2.0/SPEC.md` (`## P128 result`), per chapter convention.

Comment rewrites land in the step that makes each stale: Studio `tabViews.ts:34-37`,
`createCoreControl.ts:19-20`, `appstorage/window.go`, Space `WorkbenchShell.vue`/`TitleBar.vue`
headers ("exactly one module", "no mode switcher"), `repo-workspace.spec.ts:139,567` (comment-only),
`scripts/check-theme-classes.sh` (~321, ~588: `TerminalPanel` path, "both apps' `WorkbenchShell.vue`
keep `tab-strip-actions`" now names `TabStripNewButton.vue`).

### 4.1 File inventory

Blast radius from `codegraph_explore`: `TAB_VIEWS` has one caller per app (`workbench/host.ts`);
`openRepoTerminalTab` callers stay in the git module; `useModeStore` readers in Studio are
`TitleBar.vue`, `WorkbenchShell.vue`, `host.ts`, `main.ts`, `App.vue`, `state/tabs.ts`,
`shortcuts/state.ts`, `views/definition/columnsMenu.ts`; the factory keeps `useModeStore`'s name and
API, so none of them change.

New:
- `internal/terminal/bound.go`
- `internal/windowsvc/windowsvc.go`
- `apps/kira-space/internal/storage/migrations/0003_p128_window_mode.sql`
- `packages/workbench/src/modes.ts`
- `packages/workbench/src/state/createModeStore.ts`
- `packages/workbench/src/components/ModeSwitcher.vue`
- `packages/workbench/src/components/TabStripNewButton.vue`
- `packages/workbench/src/terminal/{module.ts, TerminalNewTab.vue, TerminalTabView.vue}`
- `apps/kira-studio/frontend/src/workbench/terminalModule.ts`
- `apps/kira-space/frontend/src/{state/mode.ts, workbench/modes.ts, workbench/terminalModule.ts}`
- `apps/kira-space/frontend/src/repo/GitNewTab.vue`
- `apps/kira-space/frontend/src/ade/{AdePanel,AdeStart}.vue`
- `apps/kira-space/tests/ui/modules.spec.ts`

Moved (`git mv`):
- `apps/kira-studio/frontend/src/terminal/{TerminalPanel,TerminalStart}.vue` to
  `packages/workbench/src/terminal/`

Deleted:
- `apps/kira-studio/frontend/src/views/terminal/TerminalView.vue`
- `apps/kira-space/frontend/src/views/repo/RepoTerminalView.vue`

Edited, Go:
- `internal/terminal/{validate.go, service.go}`, `internal/appstorage/window.go`
- Both apps' `internal/bridge/{terminal.go, windows.go}`, `main.go`
- `apps/kira-studio/internal/storage/{model/window.go, repos/windows.go}`
- `apps/kira-space/internal/storage/{model/window.go, repos/windows.go}`

Edited, frontend:
- `packages/workbench/src/bridge/createCoreControl.ts`
- Studio: `state/mode.ts`, `workbench/{modes.ts, TitleBar.vue, WorkbenchShell.vue, tabViews.ts}`,
  `bridge/index.ts`, `App.vue`
- Space: `workbench/{WorkbenchShell.vue, TitleBar.vue, host.ts, tabViews.ts}`,
  `state/{workspace.ts, tabs.ts}`, `bridge/index.ts`, `main.ts`, `App.vue`

Edited, tests, config, docs:
- Space `tests/ui/support/{mockRuntime.ts, ipcChannels.ts, bootSnapshots.ts}`;
  `tests/ui/repo-workspace.spec.ts` (comments only)
- `biome.json`, `scripts/check-theme-classes.sh`, `docs/ARCHITECTURE.md`, `docs/v2.0/SPEC.md`

### 4.2 `docs/ARCHITECTURE.md`

- ~L1202-1230 (`AppMode`/`TabScope`): add Space's `SpaceMode`, the shared `ModeDef`/
  `ModeRegistry`/`createModeStore`, and `newTab`.
- ~L1293 (MainView fallback): `MODES[...].start` now in both apps.
- ~L2233 (bound services list): `TerminalService`/`WindowsService` are per-app embeddings of
  `internal/terminal.BoundService`/`internal/windowsvc.Service`; the FQN rule (§1.7).
- ~L2440-2444, ~L2495 (Space "exactly one module", no switcher): rewrite for `git`/`terminal`/`ade`,
  `visibleWorkspace`, per-window mode.
- ~L2869-2890 (terminal): one shared module, `TerminalModuleContext`, optional scripts seam; repo
  terminals share the tab view.

---

## 5. Verification

Measure `test:unit`, `test:ui:studio`, `test:ui:space`, `test:visual:*` at `P128_START` first.

| Command | Expected |
|---|---|
| `go build ./...`, `go vet ./...`, `bun run lint:go` | Clean |
| `go test ./internal/terminal/ ./internal/appstorage/ ./internal/windowsvc/ ./apps/kira-studio/internal/... ./apps/kira-space/internal/...` | Pass; both layering tests pass, exemption sets unchanged |
| FQN gate: `rg -o 'ByName\("[^"]+' apps/*/frontend/bindings/**/internal/bridge/{terminal,windows}service.ts` vs the saved list | Terminal: identical. Windows: Space adds `Ensure`, `SetMode`; nothing else changes |
| `bun run typecheck`, `bun run lint`, `bun run lint:dead` | Clean; knip adds no finding |
| `bun run build:studio`, `bun run build:space` | Clean |
| `bun run test:unit` | Baseline unchanged |
| `bun run test:ui:studio` | Baseline unchanged, all pass; no spec file edited |
| `bun run test:ui:space` | Baseline plus §5.2's tests, all pass; existing specs edited in comments only |
| `bun run test:ipc:fe:studio` | Unchanged |
| `bun run test:visual:studio`, `:space` | No diff |

### 5.1 Visual baseline

Run `bun run test:visual:studio` at `P128_START`. If it passes, the sandbox renders like the
baselines, and after step 5 it must pass with no re-record: `ModeSwitcher` and
`TabStripNewButton` render Studio's exact markup. If the untouched run shows
`docs/DEV_ENVIRONMENT.md`'s uniform glyph drift, compare against the `P128_START` run's own
actuals instead and say so in the result section. Space's visual suite covers Settings only;
unchanged.

### 5.2 New Space UI coverage

`apps/kira-space/tests/ui/modules.spec.ts`, 3 tests (module switching is multi-step, cross-store
state; the new surface otherwise has no coverage):

1. Boot honours `windowsEnsure` (`{mode: 'terminal'}` snapshot): terminal panel and
   `terminal-start` visible, `GitPanel` absent.
2. Clicking a mode tab schedules exactly one debounced `windowsSetMode` with the new mode.
3. Round trip: open a repo, switch to `terminal`, open a terminal via `terminal-start-new`; the tab
   strip shows only it; switch to `git`, the repo's tabs return and the terminal tab is absent;
   switch to `ade`, `ade-start` visible and no "+".

### 5.3 Live run

A Wails window may not run in this sandbox. If it can, launch both apps: Studio terminal module
(run a quick command, "+" menu, restart keeps the mode); Space (switch modes, restart keeps the
mode, repo terminal still opens at the repo root). If not, say so plainly in the result section.

---

## 6. Closing audit

Account for every hit.

| Check | Command | Pass |
|---|---|---|
| Studio terminal module gone from the app | `ls apps/kira-studio/frontend/src/terminal apps/kira-studio/frontend/src/views/terminal apps/kira-space/frontend/src/views/repo/RepoTerminalView.vue` | All absent |
| One terminal tab view | `rg -l 'TerminalHostView' apps` | Empty |
| No per-app terminal bound methods | `rg -n 'func \(s \*TerminalService\)\|func \(s \*WindowsService\)' apps` | Empty |
| Per-app bridge files embedding only | For `f` in `terminal.go windows.go`: `diff <(rg -v '^\s*//' apps/kira-studio/internal/bridge/$f) <(rg -v '^\s*//' apps/kira-space/internal/bridge/$f)` | Empty; each file holds one struct embedding one field |
| Mode SQL in one place | `rg -n 'SET mode\|SELECT mode' apps internal --glob '*.go'` | `internal/appstorage/window.go` only, plus Studio `List`'s column list |
| No app-side mode plumbing | `rg -n 'windowsEnsure:\|windowsSetMode:\|MODE_WRITE_DEBOUNCE_MS\|useDebounceFn\(writeMode' apps/*/frontend/src` | Empty |
| No per-module branches | `rg -n "modeStore\.active === '\|mode === '(studio\|api\|terminal\|git\|ade)'" apps/*/frontend/src` | Empty |
| `ade` isolated | `rg -ln "ade/Ade" apps/kira-space/frontend/src` | `workbench/modes.ts` only |
| Shared code imports no app | `rg -n "apps/\|from '@/\|@bindings" packages/workbench/src/{modes.ts,state/createModeStore.ts,components/ModeSwitcher.vue,components/TabStripNewButton.vue,terminal}` | Empty |
| Shared Go imports no app | `go list -e -deps ./internal/terminal/ ./internal/windowsvc/ ./internal/appstorage/ \| rg /apps/` | Empty |
| Scripts only behind the seam | `rg -n 'customScripts\|openSettingsAt' packages/workbench/src/terminal` | Empty |
| Existing specs untouched | `git diff --stat $P128_START -- apps/kira-studio/tests apps/kira-space/tests/ui/*.spec.ts` | Empty for Studio; Space only `repo-workspace.spec.ts` comment lines (`git diff -U0 \| rg '^[+-][^+-]' \| rg -v '^[+-]\s*//'` empty) and new `modules.spec.ts` |
| Stale biome override | `rg -n 'kira-studio/frontend/src/terminal' biome.json knip.json` | Empty |

---

## 7. Risks

| Risk | Handling |
|---|---|
| Wails skips promoted methods, so a binding vanishes | §1.7 source read says it does not; step 1's FQN gate proves it on the real generator; forwarding-method contingency (§2.1) |
| `BoundService` exposes an unintended method | Separate type from `Service`; FQN gate lists exactly six methods |
| Moved models break a consumer | `rg` found none outside `bindings/`; `test:ipc:fe:studio` and typecheck catch the rest |
| Studio visual drift from the extracted switcher or "+" | Byte-identical markup; §5.1 runs at `P128_START` first |
| Module keys leak into repo logic in Space | `workspaceStore.active` stays git-only; `visibleWorkspace` is the only reader that sees module keys; module tabs never persist; §5.2 test 3 |
| Space existing specs boot into the wrong mode | Wildcard `windowsEnsure` answers `git`, the migration default |
| `defineAsyncComponent` entries from a package path break chunking | Same dynamic `import()` as today, only the path changes; `build:studio` output shows the terminal chunk still split |
| P129 needs terminal rendering inside `ade` | `TerminalHostView` stays prop-driven with its slot; the context's `host` deps are reusable |
| Parallel work on P126 or later rows | P126 touches Space appearance only; re-check Space's migration number at step 3 |
