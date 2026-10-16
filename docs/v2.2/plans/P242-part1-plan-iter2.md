# P242 Part 1 plan, iter2: Automations rename, shared run outcome, script runs

SPEC row P242 Part 1. Design baseline: `P242-plan.md` (iter1) sections 2.1, 2.2, 2.5, 2.8. This file
replaces iter1's section 4 for Part 1. Parts 2 and 3 keep iter1 as baseline and get their own plans.

User requirements carried:

- R1 executing state visible for as long as it runs; final ok or failed with the reason.
- R2 same for every headless Claude run and every normal script run.
- R3 works in Studio too (Automations module exists there; no ADE, tasks, branches, workflows).
- R4 every interpolated value shown in UI previews its resolved value and is visibly marked as a
  variable (`VarText`, from P240).
- R5 rename Terminal to Automations, thorough: labels, ids, test ids, mode key, docs, tests. No
  router and no i18n library exist (`rg "vue-router|vue-i18n|i18next"` over both frontends and
  `packages`: empty), so no routes or i18n keys to rename.
- R6 working directory per script: picked folder, default `<app home>/automations/<id>`, never
  `$HOME`; legacy rows keep `$HOME` with a notice.
- R7 shadcn-vue, Tailwind, VueUse, Pinia, TanStack per CLAUDE.md.

Base: `v2.0` at `4cd805f38`. P236-P239 and P244 landed. P240 is being implemented in
`/home/user/kira-sE` (branch `p240-E`). P241 is not implemented.

Discovery: `codegraph_explore` over the Automations panel and stores (`TerminalPanel`,
`QuickCommandsDialog`, `createCustomScriptsStore`, `module.ts`, `createTerminalTabs`,
`createTerminalsStore`, `TerminalHostView`, `terminalTabKind`, `terminalTabStateSchema`), the PTY
side (`terminal.BoundService`, `OpenArgs`, `ValidateOpen`, `Registry.Open`, `newSession`,
`OpenWithCoalescedOutput`, `DefaultCwd`), `quickcommands`, `kirapaths.Home`, and the memory import
UI (`ImportStatus`, `ImportJobDetail`, `memoryImport.ts`). `apps/kira-space/**` Go and frontend are
not in the index; read directly: `internal/ade/{runs,launches,live,recover,setup,deploy}.go`,
`internal/gitsession/worktree.go` (prepare), `internal/bridge/adewire/wire.go` (`Run`),
`storage/repos/adetask.go` (`RecoverRunning`), migrations list, `frontend/src/workbench/
{modes,terminalModule}.ts`, `ade/v2/board/{stageBlocks,runMessage}.ts`, `flows/termflow/
terminal_test.go`, `flowharness/harness.go`; P240-plan-iter2, P241-plan section 2.4.

## 0. What changed vs iter1

1. **No P241 dependency.** Iter1 had Part 1 refactor P241's `AdeRunOutcome`. P241 is not
   implemented. Part 1 now owns `internal/runoutcome` and `ade_runs.outcome_json`; P241 later
   embeds `runoutcome.Outcome` and adds only its rebase fields (section 8).
2. **Rename is thorough (R5).** Iter1 kept the internal key `terminal`. Now the module key, module
   folder, context, test ids, Go package `quickcommands`, its user-visible error prefix and the
   persisted window mode move to `automations`. Real terminals keep the word (rule 3.1).
3. **Execution inventory (R2).** Every script and headless Claude execution in the tree is listed
   with its live and final surface (section 2). Only terminal-tab scripts lack both; ADE runs gain
   the shared outcome; prepare/setup/env scripts take their reason text from `runoutcome`.
4. **Go decides a script launch.** `OpenArgs.ScriptID`: Go loads the stored command, resolves and
   creates the directory, records the run. Iter1 trusted the frontend's cwd and command.
5. **Close cause on the registry.** Iter1 hooked only `BoundService.Close`. Window close and app
   quit also end script tabs; `Registry` now reports why a session closes.
6. **ADE worktree toggle moves to Part 2.** Part 1 has no way to run a script from ADE, so a
   `useAdeDir` switch would do nothing. Needs orchestrator/user ack (section 10, item 1).
7. **Variables (R4).** Directory previews render through P240's `VarText`.
8. **Dropped from iter1 Part 1:** Go `CopyText` (no Go caller until P241), `dismissed`,
   `task_id`, `branch_id`, `schedule_id` columns (added by the part that writes them), unit test
   on `ForProcess` (flow tests reach every Part 1 row).
9. **Coverage gate missing.** P236-result names a bound-method gate with `exempt.txt`;
   `git ls-files | rg exempt` is empty on `v2.0`. Part 1 still calls each new bound method from a
   flow test. Reported to the orchestrator (section 10, item 4).

## 1. Current tree (verified)

- Panel `packages/workbench/src/terminal/TerminalPanel.vue`: header `Quick commands`, `+`
  `Add quick command…`, menus `New quick command`, empty `No quick commands`; test ids
  `terminal-panel`, `quick-command-*`, `quick-commands-*`. `runScript` opens a terminal tab with
  `cwd = script.workingDir || ctx.defaultCwd()` (`$HOME`) and `launch {command,label,color,
  kind:'script'}`. Dialog `QuickCommandsDialog.vue` (ids `custom-script-*`). localStorage key
  `kira.quickCommands.collapsedCollections`.
- Mode key `terminal`: `AppMode` (`packages/shared/domain/mode.ts`), `SpaceMode`
  (`state/modeDomain.ts`), `MODE_ORDER`/`MODES` in both `workbench/modes.ts` (label `Terminal`,
  icon `terminal-bash`), workspace id `'terminal'` in both `workbench/terminalModule.ts`,
  `state/workspace.ts` (Space), `state/agentNotify.ts` `setMode('terminal')` (Space), tab scope of
  `terminalTabKind` in both `state/tabKinds.ts`. Persisted: `windows.mode` (`WindowModes` in both
  `storage/model/window.go`; unknown values normalize to the default mode, so a rename without a
  data migration would drop users out of the module), `tabs.workspace_id` (terminal tabs are not
  persisted, so expected zero rows; migrated anyway).
- Go: `terminal.BoundService.Open` builds `OpenParams`, `OpenWithCoalescedOutput` wires `onExit`.
  `Registry.Open/Close/CloseWindow/CloseAll` in `session.go`. Exit code `-1` for a signal.
  `DefaultCwd` = `$HOME`. `quickcommands.CustomScriptFields.Validate` errors are user-visible
  (`quickcommands: name is required` in the dialog).
- Frontend terminal session: `createTerminalsStore` `TerminalSession.status
  starting|running|exited|failed`, `exitCode`; `TerminalHostView.vue` footer after exit.
  `TabKindDef.badge?(tab)` exists, unused by the terminal kind.
- ADE (`internal/ade/runs.go`): `outcome{state,note,summary,exit,noAdvance}`; `agentOutcome`,
  `superviseScript`, `stopOutcome` (`stopped by you`, `taken over in Claude Code`,
  `task archived`), `recordOutcomeLocked` writes `state/note/summary/exit_code`. Recover:
  `RecoverRunning(now, "interrupted by restart")`. Board shows run glyph while running and note
  after (`board/stageBlocks.ts`).
- Homes: Studio `$KIRA_HOME` else `~/.kira-studio`, Space `$KIRA_SPACE_HOME` else `~/.kira-space`
  (`kirapaths.Home`); harness fields `KiraHome`, `SpaceHome`; both harnesses have `Restart`.
- Migrations: Space last `0025_p223_mobile_lan.sql`, Studio last
  `0033_p219_quick_command_collections.sql`.
- `VarText`: not on `v2.0`; written in `/home/user/kira-sE` (`packages/theme/src/varText.ts`,
  `components/VarText.vue`), `TextPart = string | {name, value}`.

## 2. Execution inventory (R1, R2)

| Execution | Running shown | Final + reason shown | Part 1 change |
|---|---|---|---|
| Script in a terminal tab (Automations, both apps) | no (xterm only) | exit code footer, no reason, no record | run record, live state, elapsed, outcome, runs list, status bar (3.3, 3.6) |
| ADE agent step (headless `claude -p`) | stage glyph | state + note | stored `runoutcome.Outcome` (3.5) |
| ADE script step | stage glyph | state + note | stored outcome (3.5) |
| ADE worktree prepare (`setup.go`) | `AdeSetupProgress` | setup state + note | reason via `ForProcess` |
| Git worktree prepare (`gitsession/worktree.go`) | op progress stream | op error | reason via `ForProcess` |
| ADE env sha script (`deploy.go`) | n/a (60 s sync) | returned error | reason via `ForProcess` |
| Memory import (`claude -p` per chunk) | job `running` + progress | job/file `reason` | none: already meets R1 |
| Memory add gate (`claude -p`) | mutation pending | mutation error | none: already meets R1 |

Memory runs stay out of the Automations runs list (iter1 open question 1, still open).

## 3. Design

### 3.1 Rename rule (R5)

Rename everything that names the **module** (Terminal) or the **item** (quick command). Keep every
name that denotes a real terminal: `internal/terminal`, `TerminalService`, tab kind `terminal`,
`TerminalHostView`, `TerminalTabView`, `terminalRenderer*`, `useTerminalMount`, repo terminals,
Docker `Terminal` tab, `+` menu item `Terminal`, `No terminal open`, `New terminal`. Keep
`customScript*` names, `CustomScriptsService`, `custom_scripts` tables: "script" is the new item
name already. Migration files are immutable history.

| Old | New |
|---|---|
| mode key `terminal` (types, `MODE_ORDER`, `MODES`, workspace id, tab scope, `setMode`) | `automations` |
| mode label `Terminal`, icon `terminal-bash` | `Automations`, `run-all` |
| `packages/workbench/src/terminal/{TerminalPanel.vue, QuickCommandsDialog.vue, TerminalStart.vue, TerminalNewTab.vue, module.ts, scriptActions.ts, createCustomScriptsStore.ts}` | `packages/workbench/src/automations/{AutomationsPanel.vue, ScriptDialog.vue, AutomationsStart.vue, AutomationsNewTab.vue, module.ts, scriptActions.ts, createCustomScriptsStore.ts}` (`git mv`) |
| `TerminalModuleContext`, `terminalModuleKey`, `useTerminalModule`, `TerminalScriptsSeam` | `AutomationsModuleContext`, `automationsModuleKey`, `useAutomationsModule`, `ScriptsSeam` |
| `apps/*/frontend/src/workbench/terminalModule.ts`, `createTerminalModule` | `automationsModule.ts`, `createAutomationsModule` |
| `QuickCommandsSnapshot`, `quickCommandsSnapshotSchema`, `quickCommandsSnapshotOf` | `ScriptsSnapshot`, `scriptsSnapshotSchema`, `scriptsSnapshotOf` |
| Go `internal/quickcommands` (and error prefix `quickcommands:`) | `internal/scripts` (`scripts:`) |
| header `Quick commands`; `Add quick command…`; `New quick command`; `No quick commands`; `It will no longer appear in Quick commands.` | `Automations`; `New script…`; `New script`; `No scripts`; `It will no longer appear in Automations.` |
| dialog `Add quick command` / `Edit quick command`, field `Script` | `New script` / `Edit script`, field `Command` |
| test ids `terminal-panel`, `quick-command-*`, `quick-commands-*`, `custom-script-*`, `terminal-start*` | `automations-panel`, `script-*`, `automations-*`, `script-dialog-*`, `automations-start*` |
| localStorage `kira.quickCommands.collapsedCollections` | `kira.automations.collapsedCollections` (copy old value once, then remove the old key; reads in try/catch) |
| Go/TS comments naming the Terminal module or quick commands | Automations / scripts |
| specs `terminal-module.spec.ts` (Studio ui, visual + its snapshot dir), `terminal-quick-commands.spec.ts` (Space), flow `termflow/quickcommand_test.go` | `automations-module.spec.ts`, `automations-scripts.spec.ts`, `termflow/script_test.go` |

`AutomationsStart.vue` empty state: title `No terminal open` stays; it gains a line `Run a script
from the panel, or open a terminal.` (the module is no longer only terminals).

Bindings: `wails3 task common:generate:bindings` regenerates both apps' `frontend/bindings/**`
(the `internal/quickcommands/models.ts` path moves). Never hand-edit.

### 3.2 `internal/runoutcome` (new, shared)

```go
package runoutcome
type Status string // done | failed | blocked | cancelled
type Source string // agent | exit | timeout | start | user | restart
type Outcome struct {
    Status    Status `json:"status"`
    Reason    string `json:"reason"`              // one line; set unless done
    Source    Source `json:"source"`
    Reported  bool   `json:"reported"`            // the agent reported (finish_step)
    ExitCode  *int   `json:"exitCode,omitempty"`
    LastError string `json:"lastError,omitempty"` // last stderr line, 1 KiB cap
    Summary   string `json:"summary,omitempty"`   // agent's one line
}
type Kind int // KindScript | KindAgent
type End int  // EndExit | EndTimeout | EndStartErr | EndUser | EndWindow | EndQuit | EndRestart
type Process struct { Kind Kind; End End; ExitCode int; Err error; Timeout, App string }
func ForProcess(p Process) Outcome
func (o Outcome) Ended() bool // Status != ""
```

`ForProcess` table (the one wording source):

| Case | Status | Source | Reason |
|---|---|---|---|
| exit 0, script | done | exit | `` |
| exit N > 0, script | failed | exit | `exited with status N` |
| exit -1, no close cause | failed | exit | `ended by a signal` |
| exit, agent without report | failed | exit | `no report: claude exited with status N` (N = 0: `no report: Claude ended without calling finish_step`) |
| timeout | failed | timeout | `timed out after <d>` (agent: `no report: ` prefix) |
| could not start | failed | start | `could not start: <err>` |
| tab closed or Stop | cancelled | user | `stopped by you` |
| window closed | cancelled | user | `its window closed while it ran` |
| app quit | failed | restart | `Kira <App> quit while it ran` |
| found running at start | failed | restart | `interrupted: Kira <App> closed while it ran` |

Callers that phrase a whole sentence (git prepare `the prepare script ...`, env script `the
script ...`) prefix the reason; their existing tests are updated to the new tail
(`timed out after 10m` replaces `did not finish within 10m and was stopped`). Implementer runs
`rg -n "did not finish within|exited with status|ended without finish_step|interrupted by restart"
apps internal` and updates every assertion.

`model.AdeRun` `State` keeps the board vocabulary. Mapping for script runs:
`done|failed|cancelled` from the outcome status.

### 3.3 `internal/scriptruns` (new, shared) and terminal hooks

```go
type Trigger string // terminal (Part 1); manual, ade, scheduled reserved by the CHECK
type Run struct {
    ID, ScriptID, ScriptName, Color, Kind, Trigger, State, TerminalID, Cwd, Command string
    Outcome    *runoutcome.Outcome
    CreatedAt  int64
    StartedAt, FinishedAt *int64
}
type Service struct { /* repo, emit, app name, app home, clock */ }
func (s *Service) Begin(scriptID, terminalID string) (Launch, error) // Launch{RunID, Cwd, Command}
func (s *Service) Failed(runID string, err error)                     // spawn failed
func (s *Service) Exited(terminalID string, code int, cause terminal.CloseCause)
func (s *Service) List(limit int) ([]Run, error); Get(id string) (Run, error)
func (s *Service) Stop(id string) error  // closes the run's PTY with cause user
func (s *Service) ResolveDir(scriptID string) (Dir, error) // preview, no side effect
func (s *Service) Recover() error        // running -> failed/restart; purge
```

- `Begin`: loads the script (`scripts.Repo.Get`), `ResolveDir` + create (3.4), inserts `running`
  (`started_at = created_at = now`, trigger `terminal`), emits. A dir blocker inserts a `failed`
  run (`start`, `could not start: <blocker>`), emits, and returns the blocker as `E_INVALID`.
- `internal/terminal`: `OpenArgs.ScriptID string` (only with `launchKind: script`;
  `ValidateOpen` refuses it otherwise). `BoundService.Scripts ScriptLauncher` (interface field, not
  a method: nothing new is bound) with `Begin`, `Failed`, `Exited`. When `ScriptID != ""`, `Open`
  calls `Begin` first and spawns with the returned `Cwd` and `Command` (args' cwd/command are
  ignored: what runs is the stored script). Spawn error -> `Failed`.
- `Registry` gains `type CloseCause int` (`CauseNone|CauseUser|CauseWindow|CauseQuit`), recorded
  per session before signalling in `Close` (user), `CloseWindow` (window), `CloseAll` (quit).
  `OnExit` passes it (`OpenWithCoalescedOutput`'s `onExit` becomes `func(code int, cause
  CloseCause)`; the Arbiter path ignores the args). `BoundService.Open` wires
  `Scripts.Exited(terminalID, code, cause)` for script launches.
- Stop from the runs list: `Service.Stop` -> `Registry.Close(terminalID)` (cause user). The tab
  stays open and shows the outcome.
- Push `kira:scriptRuns:changed`, payload the changed `Run`, to every window.
- Retention: after each finish and at `Recover`, delete finished runs past the newest 500.
- Concurrency: one row per `Begin`; `Exited` updates only a `running` row with that terminal id
  (idempotent; a second exit is a no-op).
- `Recover` runs at start before the bound services register.

Bound shim per app `bridge.ScriptRunsService` (embeds a shared `scriptruns.Bound`): `List`, `Get`,
`Stop`, `ResolveDir`. Wire `Run` mirrors the struct; `outcome` null while running.

### 3.4 Working directory (R6)

Per script: `dirMode` `kira` (default for new) | `fixed` (`workingDir` absolute) | `home` (legacy
only). `scripts.CustomScriptFields.Validate`: `fixed` needs an absolute `workingDir`; `home` refused
on create and on a change from another mode (`scripts: the home folder is no longer offered`);
`kira` clears `workingDir`.

`ResolveDir(script)`:
1. `fixed` -> `workingDir`; missing or not a directory -> blocker `<path> does not exist`. Never
   created.
2. `home` -> `$HOME` (`terminal.DefaultCwd`); empty -> blocker `your home folder could not be
   resolved`.
3. `kira` -> `<app home>/automations/<script id>`. `Begin` creates it (`MkdirAll 0700`, then
   `Lstat` both `automations/` and the leaf: a symlink or non-directory -> blocker `<path> is not
   a real folder: remove it`).

Result `Dir{Path, Mode, Base, Blocker}` (`Base` = app home for `kira`, `$HOME` for `home`). Deleting
a script removes its `kira` folder best effort, only when `Lstat` confirms a real directory under
`<app home>/automations/`. Plain terminal tabs keep `$HOME`.

### 3.5 ADE runs get the stored outcome (Space)

- `ade_runs.outcome_json`; `model.AdeRun.Outcome *runoutcome.Outcome`; `AdeRunPatch.Outcome`;
  wire `adewire.Run.Outcome *runoutcome.Outcome` (`json:"outcome"`).
- `outcome` (internal type in `runs.go`) gains `out runoutcome.Outcome`; `recordOutcomeLocked`
  writes it and sets `note` = `Reason` (board, notifier and Needs you keep reading `note`).
- `agentOutcome`: finish `done` -> done/agent/Reported/Summary; `needs_input` -> blocked/agent,
  reason = summary; `failed` -> failed/agent, reason = summary or `the agent reported failure
  without a reason`; no finish -> `ForProcess` agent rows. `applyTUIFinish` same mapping.
- `superviseScript`: `ForProcess` script rows. `stopOutcome`: cancelled/user with the existing
  texts (`stopped by you`, `taken over in Claude Code`, `stopped: task archived`).
- `LastError`: `logSink` keeps the last stderr line (1 KiB cap); set on failed exit/timeout.
- `RecoverRunning(now, outcomeJSON)`: writes the restart outcome; note = its reason.
- Frontend: `ade/v2/wire.ts` `outcome: runOutcomeSchema.nullable().default(null)` (fixture
  `board.json` keeps parsing unchanged); `board/stageBlocks.ts` note = `outcome?.reason || note ||
  fix-round text`. Richer ADE outcome UI (Copy for agent on runs, rebase extras) is P241's.

### 3.6 Frontend surfaces (R1, R3, R7)

New shared code in `packages/workbench/src/automations/runs/`:

- `runsQueries.ts`: TanStack `useScriptRuns()` (`['scriptRuns','list']`), `useScriptRunByTerminal
  (id)` (select over the list), `useStopScriptRun()` mutation, `useResolveDir(scriptId)`
  (`['scriptRuns','dir',id]`). `useScriptRunsSync()` subscribes once and patches the list with
  `queryClient.setQueryData` (no polling). Over a `ScriptRunsSeam` on the module context.
- `useElapsed(startedAt, finishedAt)`: VueUse `useNow({interval: 1000, controls: true})`, paused
  unless running; `formatElapsed` (`0:42`, `12:03`, `1:02:03`).
- `RunStatusBadge.vue`: icon (`loading~spin` running, `check` done, `error` failed,
  `circle-slash` cancelled, `question` blocked) + label (Running, Succeeded, Failed, Cancelled,
  Needs you) + elapsed; `data-testid="run-status"`, `data-state`.
- `RunOutcomeBlock.vue`: status, reason, source label, exit code, `Copy for agent` (VueUse
  `useClipboard`), `Run again`. `compact` prop for the tab footer.
- `runText.ts`: `copyText(run, lastLines?)`: `Script "<name>" <label> after <elapsed>.`, `Reason:`,
  `Exit code:`, `Working directory:`, `Command:` (first 20 lines), `Last output:` (when given).
- `RunsSection.vue`: collapsible `Runs` section in the panel, newest first, 50 shown, filter
  `All | Running | Failed` (shadcn `ToggleGroup`), row = name, `RunStatusBadge`, reason one line,
  `Stop` while running, click focuses its tab if open.
- `RunsStatusItem.vue`: `▶ N running` when N > 0 (`data-testid="status-runs"`); click switches to
  `automations` and expands `Runs`. Mounted in both apps' `StatusBar.vue`, every mode.

Panel and dialog:

- `AutomationsPanel.vue`: rename strings and ids; a row with a running run shows a spinner and
  elapsed in place of `play`; `runScript` calls `openTerminalTab({cwd: dir.path, launch: {...,
  scriptId}})` after `ResolveDir` (blocker -> panel error line, no tab). `RunsSection` below the
  list.
- `ScriptDialog.vue`: `Working directory` shadcn `RadioGroup`: `Kira automations folder` | `Choose
  folder…` (native dialog, existing `chooseFolder`). Preview line under it (R4): `VarText` parts
  `[{name: 'Kira home', value: base}, '/automations/', {name: 'script id', value: id or 'set on
  save'}]`; legacy `home` rows show `Runs in your home folder ` + `{name: 'HOME', value: base}` +
  `, the old default. New scripts use the Kira automations folder.` and a `Use automations folder`
  button. A `fixed` path is the user's literal text: plain, no chip. Blocker in `FieldError`.
- Terminal tab of a script: `terminalTabState.scriptId` (`.default('')`); `terminalTabKind`
  `badge(tab)` from the terminals store session status (spinner while running, `check`/`error`
  after) via a `sessionStatus(tabId)` arg the apps pass; `TerminalHostView.vue` shows a
  `RunStatusBadge` strip and, after exit, a compact `RunOutcomeBlock` instead of the plain footer
  for script tabs; `Copy for agent` there adds the last 40 xterm lines (the renderer strips
  escapes). Non-script tabs keep today's footer.
- Studio (R3): every surface above is shared; Studio passes no ADE context. Nothing in Part 1 is
  Space-only except 3.5.

No new Pinia store: runs are server state (TanStack). Every new `.vue`: `<script setup
lang="ts">`, Tailwind only, no `<style>`.

### 3.7 Variable marking scope (R4)

A var chip marks a value the app substitutes into fixed copy or a path the user did not type:
Kira home, script id, `$HOME`. Run data (names, reasons, cwd of a finished run, counts) is data,
not a variable. Part 2 extends this to prompt and env previews.

## 4. Files (ownership list)

Go, shared:

| File | Change |
|---|---|
| `internal/runoutcome/outcome.go` | new |
| `internal/scriptruns/{run,repo,service,bound,workdir}.go` | new |
| `internal/quickcommands/*` -> `internal/scripts/*` | rename, `DirMode`, validation, folder cleanup on remove |
| `internal/terminal/{validate,bound,service,session}.go` | `ScriptID`, `Scripts` field, close cause, exit wiring |

Go, Space:

| File | Change |
|---|---|
| `internal/ade/{runs,launches,live,recover,setup,deploy,logsink}.go` | outcomes via `runoutcome` |
| `internal/gitsession/worktree.go` | prepare reason via `ForProcess` |
| `internal/storage/model/{adetask,window}.go` | `Outcome`, mode list |
| `internal/storage/repos/{adetask,repos,scriptruns}.go` | outcome column, `RecoverRunning`, runs repo wiring |
| `internal/storage/migrations/0026_p242_automations.sql`, `migrate_automations_test.go` | new |
| `internal/bridge/{scriptruns,customscripts,events}.go`, `adewire/wire.go` | shim, channel, `Run.Outcome` |
| `internal/appwire/{appwire,wire}.go`, `main.go` | build, `Recover`, hook into terminal, register, shutdown order |
| `internal/flows/termflow/{doc,terminal_test,automation_test}.go`, `flows/journeyflow/restart_test.go`, `flows/adeflow/outcome_test.go` | import rename, new tests |

Go, Studio:

| File | Change |
|---|---|
| `internal/storage/model/{window,tabs}.go` | mode list, comment |
| `internal/storage/repos/repos.go` | runs repo |
| `internal/storage/migrations/0034_p242_automations.sql`, `migrate_automations_test.go` | new |
| `internal/bridge/{scriptruns,customscripts,events,terminal}.go` | shim, channel |
| `internal/appwire/wire.go`, `main.go` | build, hook, register |
| `internal/flows/termflow/{doc,helpers_test,quickcommand_test->script_test,automation_test}.go` | rename, new tests |

Frontend, shared packages:

| File | Change |
|---|---|
| `packages/shared/domain/{runOutcome,scriptRuns}.ts` | new zod |
| `packages/shared/domain/{scripts,mode,tabs}.ts` | `dirMode`, snapshot rename, mode key, `scriptId` |
| `packages/workbench/src/automations/**` | moved files (3.1) + `runs/**` new |
| `packages/workbench/src/terminal/{TerminalTabView.vue,TerminalHostView.vue,terminalHost.ts,useTerminalMount.ts}` | context rename, script strip and footer |
| `packages/workbench/src/tabs/terminalTabKind.ts` | `badge` |
| `packages/workbench/src/state/{createTerminalTabs,createTerminalsStore}.ts` | `scriptId` |
| `packages/workbench/src/{util/collectionMenu.ts,components/InlineRenameInput.vue}`, `packages/theme/src/SwatchRadio.vue` | comments only |

Frontend, apps (each of `apps/kira-space/frontend/src`, `apps/kira-studio/frontend/src`):

| File | Change |
|---|---|
| `workbench/{modes.ts,StatusBar.vue}`, `workbench/terminalModule.ts -> automationsModule.ts`, `App.vue` | key, label, icon, context, status item |
| `state/{tabKinds,tabDomain,terminalTabs,customScripts}.ts` | key, badge arg, snapshot rename |
| `bridge/{index,control}.ts` | `scriptRuns*` calls, `onScriptRunsChanged`, `terminalOpen(..., scriptId)` |
| Space only: `state/{modeDomain,workspace,agentNotify}.ts`, `ade/v2/wire.ts`, `ade/v2/board/stageBlocks.ts` | key; outcome |
| Studio only: `state/settings.ts` | comment |
| `frontend/bindings/**` | regenerated |

Tests:

| File | Change |
|---|---|
| Studio `tests/ui/{automations-module (renamed), mode-switch, color-rails}.spec.ts`, every spec with `data-mode="terminal"` or a renamed id | update |
| Studio `tests/visual/automations-module.spec.ts` + snapshots | renamed, baselines regenerated |
| Space `tests/ui/{automations-scripts (renamed), modules, color-rails, settings-agent-notify, git-panel-tab, memory-module, repo-workspace, ade-v2-workflows}.spec.ts` | update |
| `apps/*/tests/ui/automations-runs.spec.ts` | new (5.2) |
| `apps/*/tests/ui/support/{ipcChannels,mockRuntime}.ts` | channel and bound names |
| Studio `tests/e2e-real/terminal-real.spec.ts`; Space `tests/e2e-real/{terminal-real,commands-real,multiwindow-real}.spec.ts` | ids, labels |
| `apps/*/tests/e2e-real/automations-real.spec.ts` | new (5.3) |

Docs (deferred commit, section 7): `docs/ARCHITECTURE.md` (Automations module, `runoutcome`,
`scriptruns`, run dir rule, close cause), root `README.md`, `apps/kira-space/README.md`,
`docs/v2.2/SPEC.md` (row status, result, row wording per section 10).

Not touched: `packages/theme/src/{varText.ts,components/VarText.vue}` (P240 owns; imported only),
`packages/workbench/src/{state/contextMenu.ts,components/ContextMenu.vue}`,
`packages/shared/domain/shortcuts.ts`, `ade/v2/**` except the two files above, `go.mod`,
`package.json`, lockfile.

## 5. Tests

### 5.1 Go flow (P236 harness, real PTY, temp homes, default settings)

`apps/kira-studio/internal/flows/termflow/automation_test.go` and
`apps/kira-space/internal/flows/termflow/automation_test.go`, same cases; Go-generated fixtures
for the UI specs come from these where the shape is Go's:

1. Exit 0 with `sleep 1`: `ScriptRuns.Get` mid-run is `running` with `startedAt`; then `done`,
   `exitCode 0`, `finishedAt > startedAt`; one `kira:scriptRuns:changed` per transition.
2. `exit 3`: `failed`, source `exit`, reason `exited with status 3`.
3. `Terminal.Close` mid-run: `cancelled`, `stopped by you`. `ScriptRuns.Stop` mid-run: same, tab
   session gone.
4. Window close mid-run (`CloseWindow` / harness window close): `cancelled`, `its window closed
   while it ran`.
5. Quit mid-run then `Restart`: `failed`, source `restart`, `Kira <App> quit while it ran`. A row
   inserted as `running` by raw SQL before `Restart`: `interrupted: ...`.
6. Dirs: new script runs in `<home>/automations/<id>` (`pwd` output, mode 0700); `ResolveDir` on a
   `fixed` missing folder returns the blocker and `Open` refuses with it plus a `failed`/`start`
   run; `automations` symlinked elsewhere -> blocker; a row inserted by raw SQL with
   `dir_mode='home'` runs in the harness `$HOME`; `home` refused on create.
7. Go authority: `Open` with `ScriptID` and a forged `command` runs the stored command.
8. Retention: 510 finished rows -> 500 after a finish.
9. Remove script: its `kira` folder is gone; a symlinked folder is left alone.

Space `flows/adeflow/outcome_test.go` (fakeagent): agent `finish_step done` -> outcome
done/agent/Reported; no finish, exit 0 -> `no report: Claude ended without calling finish_step`;
script stage `exit 2` -> failed/exit `exited with status 2` with `LastError` from stderr; Stop ->
state `stuck`, outcome cancelled/user; restart with a running run -> failed/restart. Existing
adeflow assertions on notes updated to the new texts.

Migration tests (both apps, beside existing `migrate_*_test.go`): `windows.mode 'terminal'` ->
`'automations'`; `custom_scripts` rows with and without `working_dir` -> `fixed`/`home`; Space
`ade_runs.outcome_json` exists, empty.

Unit tests: none (CLAUDE.md bar; flow tests reach every `ForProcess` row Part 1 produces;
timeout and start rows through existing adeflow timeout and could-not-start tests, updated).

### 5.2 Playwright UI, mocked bridge, both apps: `tests/ui/automations-runs.spec.ts`

1. Mode tab label `Automations`, `data-mode="automations"`; panel header, empty state, `+` and menu
   texts.
2. Run a script: `terminalOpen` called with `scriptId`; push `running` -> row spinner and tab badge;
   Playwright clock +65 s -> elapsed `1:05`; status bar `▶ 1 running`.
3. Push `failed` with reason: row and `Runs` show `Failed`, reason, tab footer `RunOutcomeBlock`;
   status bar item gone.
4. `Copy for agent` writes the expected text (clipboard support helper).
5. `Stop` calls `scriptRunsStop` with the id.
6. Filter `Failed` hides succeeded runs.
7. Dialog: radio default `Kira automations folder`, preview `var-chip[data-var="Kira home"]` with
   the mocked base; `Choose folder…` sets `fixed`, preview plain; legacy row shows the notice with a
   `HOME` chip and `Use automations folder` switches mode; blocker shown for a missing folder.
8. Boot with `windowsEnsure` mode `automations` restores the module.

### 5.3 e2e-real, both apps: `tests/e2e-real/automations-real.spec.ts`

Real Go, real PTY, temp homes:
1. Create a script `pwd; sleep 2; exit 3` with the default folder; run: row shows `Running` and
   elapsed ticks; terminal prints `<KIRA home>/automations/<id>`; then `Failed`,
   `exited with status 3`; status bar count 1 then gone.
2. Run `sleep 30`, `Stop` from `Runs`: `Cancelled`, `stopped by you`; tab footer shows it.
3. Relaunch (`relaunch()` fixture): mode stays `automations`; run list keeps both runs.

### 5.4 Checks

Per commit: `go build ./...`, `go build -tags server ./apps/kira-space/...`, golangci-lint,
`bun run typecheck`, `bun run lint`, `bun run lint:dead`. Once at the end: `test:flows:space`,
`test:flows:studio`, `go test ./internal/{runoutcome,scriptruns,scripts,terminal}/...`, every touched
UI spec plus `ade-v2-run`, `ade-v2-panel`, both visual suites' Automations spec, both e2e-real
`terminal-real`, `automations-real`, Space `commands-real`, `multiwindow-real`.

Commits (Conventional, one per group): `feat(runoutcome): shared run outcome`;
`refactor(space): ADE and prepare outcomes via runoutcome`; `refactor!: rename quickcommands to
scripts`; `feat(scriptruns): run store, terminal close cause and script launch`; `feat: script
working directory`; `feat(workbench): run status, runs list, status bar`; `refactor!: rename
Terminal module to Automations`; `test: automation flows, UI and e2e-real specs`; then the
deferred `docs: automations`.

## 6. Overlap with P240 (`P240-plan-iter2.md` section 3)

P240 files: `ade/v2/board/{reviewCode,taskMenu}.ts`, `ade/v2/review/useReviewCode.ts`,
`ade/v2/plan/{useTaskMenu.ts,AdeTaskCard.vue,AdeBranchRow.vue}`,
`ade/v2/panel/{AdeTaskPanel,AdeBranchPanel,AdeStageBlock}.vue`, `ade/v2/shell/AdeShell.vue`,
`ade/v2/AdeTip.vue`, `packages/shared/domain/shortcuts.ts`, `packages/theme/src/varText.ts`,
`packages/theme/src/components/VarText.vue`, `packages/workbench/src/state/contextMenu.ts`,
`packages/workbench/src/components/ContextMenu.vue`, `tests/ui/ade-v2-review-open.spec.ts`,
`tests/e2e-real/ade-review-open-real.spec.ts`, `internal/flows/adeflow/review_test.go`,
`docs/ARCHITECTURE.md`, `docs/v2.2/SPEC.md`.

| Item | Result |
|---|---|
| Product and test files | zero overlap. Part 1's ADE files are `ade/v2/wire.ts` and `board/stageBlocks.ts`, neither in P240's list. Both add files to `flows/adeflow` (`outcome_test.go` vs `review_test.go`): different files, same package, no shared helper edited. |
| `packages/theme/src/{varText.ts,VarText.vue}` | ordering dependency: Part 1 imports them, never edits them. |
| `docs/ARCHITECTURE.md`, `docs/v2.2/SPEC.md` | overlap: Part 1's doc edits move to one commit after both land (the P236-P239 streams' precedent). |
| `packages/shared/domain/**` | different files (`shortcuts.ts` vs `scripts/mode/tabs/runOutcome/scriptRuns.ts`). |
| Behaviour | Part 1 uses context menus (`MenuItem` with string `hint`), unchanged by P240's widening. P240 board fixture untouched by Part 1 (`outcome` defaults). |

**Verdict: concurrent run is possible as a second stream, under three conditions.**

1. P240 commits its VarText group first and that commit is on `v2.0`; the Part 1 worktree branches
   from it (both streams then share that base). Without it, run sequentially after P240.
2. Part 1 leaves `docs/ARCHITECTURE.md` and `docs/v2.2/SPEC.md` alone until P240 has landed.
3. User approval of the order change (section 8): the SPEC row says Part 1 runs after P241.

No ordering dependency remains past those: Part 1 adds no shortcut, menu hint type or ADE plan
component; P240 adds no mode key, bound method, migration or terminal code.

## 7. Landing

Separate worktree (pre-commit hooks lint the whole tree). After both streams verify: rebase onto
`v2.0` in either order (a conflict means a missed file above), then the Part 1 docs commit, then
regenerate nothing (bindings already in the branch). `go.mod` unchanged, so no `go.sum` race.

## 8. Order against P241

- SPEC row: `Runs after P241`. This plan needs nothing from P241. Running Part 1 before P241 changes
  the row order: the user's call (CLAUDE.md row-order rule). If approved, P241's plan needs an
  iter2: its `RunOutcome` becomes `runoutcome.Outcome` embedded plus rebase fields
  (`ConflictedFiles`, `LastGitError`, `Tried`, `Verified`, `RebaseInProgress`, `Aborted`,
  `OntoRef`, `OntoTip`, `Branches`, `Pushed`), its migration takes Space `0027` and skips
  `outcome_json` (Part 1 adds it), its synthesis table uses `ForProcess` (stop is `cancelled`,
  state stays `stuck`).
- If P241 lands first instead: Part 1 moves P241's generic outcome fields into `runoutcome`,
  `model.AdeRunOutcome` embeds it (JSON keys unchanged), skips `outcome_json` in its migration and
  takes the next free Space number. 3.5 then edits P241's code paths, not the pre-P241 ones.

## 9. Orchestrator verification checklist

- [ ] Rename: `rg -n -i "quick.?command" apps packages internal README.md docs/ARCHITECTURE.md
      -g '!**/migrations/0*.sql'` empty; `rg -n "'terminal'" apps/*/frontend/src/workbench/modes.ts
      packages/shared/domain/mode.ts` empty; `rg -n "label: 'Automations'"` hits both `modes.ts`;
      `ls packages/workbench/src/terminal` holds only real-terminal files.
- [ ] Data: both migrations contain `UPDATE windows SET mode = 'automations'`, `dir_mode`,
      `CREATE TABLE script_runs`; Space also `outcome_json`.
- [ ] Shared outcome has real callers: `rg -n "runoutcome\.ForProcess" internal/scriptruns
      apps/kira-space/internal/ade apps/kira-space/internal/gitsession`.
- [ ] Go authority: `rg -n "ScriptID" internal/terminal/bound.go` and `Scripts.Begin` called in
      `Open`; both appwires set `Scripts`.
- [ ] Never `$HOME` by default: `rg -n "defaultCwd" packages/workbench/src/automations/AutomationsPanel.vue`
      empty; flow case 6 asserts the `automations/<id>` cwd.
- [ ] R4: `rg -n "VarText" packages/workbench/src/automations` hits `ScriptDialog.vue`.
- [ ] Every new bound method (`ScriptRuns.List/Get/Stop/ResolveDir`, both apps) is called in a
      flow test (`rg` per name in `internal/flows`).
- [ ] Frontend rules: new `.vue` files `<script setup lang="ts">`, no `<style>`; no new Pinia store;
      `package.json`, lockfile, `go.mod` unchanged.
- [ ] Counts: 9 termflow cases per app, 5 adeflow cases, 2 migration tests, 8 UI cases per app,
      3 e2e-real cases per app; all green with the suites in 5.4.
- [ ] Hooks green on every commit, no `--no-verify`; docs commit after P240 landed; SPEC row Part 1
      `Done` with result.

## 10. Decisions for the orchestrator or user

1. ADE worktree toggle (`useAdeDir`) moves from Part 1 to Part 2, where ADE invocation exists.
   SPEC row wording changes accordingly. Needs ack: it moves scope between parts, it does not drop it.
2. SPEC row says "rename ... (user-facing only)"; the user's later ask is a thorough rename. Plan
   follows the later ask (3.1); SPEC row wording updates in the docs commit.
3. Memory headless runs keep their own surfaces (section 2); listing them under Automations runs is
   still iter1's open question 1.
4. P236's bound-method coverage gate and `exempt.txt` are not in the tree; flag for a follow-up.
5. Order: running Part 1 before P241 (section 8) needs the user's approval.
