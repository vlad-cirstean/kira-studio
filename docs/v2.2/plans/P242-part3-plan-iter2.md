# P242 Part 3 plan, iter2: scripts in ADE

SPEC row P242 Part 3 (Space only). Baseline: `P242-part2-plan-iter2.md` section 3.9 and iter1
`P242-plan.md` 2.4-2.6, 2.8. Planned against `f6b5c8863` (v2.0 after P242 Part 1 and 2). Where this
file and either baseline differ, this file wins.

Discovery: `codegraph_explore` (index re-synced first: `codegraph sync .`) over `internal/scriptruns`
(`RunArgs`, `Preview`, `plan`, `Start`, `startSmart`, `startTerminal`, `takeLaunch`, `Begin`, `Run`,
`decide`), `internal/scripts` (`BuiltinVars`, `VarsUsed`, `Compose`, `ParamValues`, `ToolArgs`,
`ResolveDir`, `Dir`), Automations frontend (`AutomationsModuleContext`, `ScriptRunsSeam`,
`RunScriptDialog`, `RunScriptDialogHost`, `useScriptRunDialogStore`, `ParamsForm`, `RunPreview`,
`runsQueries`). `apps/kira-space/**` is not in the index; read directly: `ade/{runs,rebase,launches,
board,vars,steps,agenttools,recover,setup}.go`, `adeflow/parse.go`, `bridge/adewire/wire.go`,
`agentnotify/agentnotify.go`, `appwire/{appwire,wire}.go`, `bridge/events.go`, frontend `ade/v2/{board/
taskMenu.ts,plan/useTaskMenu.ts,plan/AdeBranchRow.vue,panel/headerActions.ts,run/AdeRunDialog.vue,
workflows/AdeStepCard.vue,board/runMessage.ts}`, `state/agentNotify.ts`, `workbench/
automationsModule.ts`; plus `internal/claudeheadless/{mcp,outcomes,space,suffix}.go`.

## 0. Requirements carried

- R1 ADE variables (`task jira repo branch base worktree`) resolve in a script run that has a task:
  prompt (smart) and env `KIRA_*` (both kinds).
- R2 Task/branch picker popup when a value is ambiguous (no task given; more than one branch).
- R3 Worktree toggle per script: from ADE, run in the branch worktree or the script's own folder.
- R4 Normal scripts invocable from an ADE task or branch.
- R5 Workflow `smart_script:` step.
- R6 `run_outcome` kind `automation`.
- R7 Task chip and task panel block show the task's script runs.
- R8 OS notification when a run ends.
- R9 Every preview shows resolved interpolated values through `VarText` (prompt, env, folder, step
  card, ADE Run dialog).
- R10 No credential reads (P233 and Part 2 hold: user MCP config read only as Part 2 does; nothing
  new read).
- R11 Flow-test coverage gate green, both `exempt.txt` empty. Tests only per CLAUDE.md bar.
- R12 shadcn-vue, Tailwind, VueUse, Pinia, TanStack. Space only; Studio changes limited to the shared
  code and the shared migration.

## 1. Current tree (verified)

- `scriptruns.plan` builds `Preview` from the script and `ParamValues`; built-in vars stay literal
  (no values); `Compose` substitutes only names present in `rendered`. `Preview.Suffix` =
  `ScriptReportSuffix`; allowed extra = `FinishStepTool` only. `Dir` from `scripts.ResolveDir`.
- `startSmart`: trigger `manual`, grant `{RunID}` on the service's own lazy `claudeheadless.Server`
  (`Options{Dir, OnFinish}`, no Space, no Outcomes). `startTerminal`: launch token, `Begin` sets
  trigger `manual` for any token.
- `Run` has no task or branch fields; `script_runs` likewise (Space `0028`, Studio `0035` latest).
- `custom_scripts` has no `use_ade_dir`. Nothing in Space references scriptruns from ADE.
- ADE: `runVars{Task, Jira, Repo, Branch, Worktree}` (no `base`); `TaskBoard.launch` holds a run with
  note `waiting for rebase` while `RunningRebaseOn`; `releaseRebaseGate` -> `launchHeldLocked`.
  `launchGate` creates a missing worktree and returns `setupGateError` while setup is not ready (it
  never waits). `rebaseBlockers` and `checkNoBackgroundRun` refuse on a busy branch. `Recover` keeps
  held runs pending until their gate opens.
- `superviseAgent` builds `Spec` without model, budget, tools, isolation; `agentOutcome` ignores the
  `result` event. `allowedTools(step, space)` always adds `finish_step` and `run_outcome`.
- `adeflow` step keys: `id name runs_on before on_failure timeout prompt allowed_tools`; `prompt`
  required. `adewire.PipelineStep` and `stepDef` mirror them; `writer.go` `stepOrder`.
- `RunOutcomes` lists ADE runs, kinds `rebase|step`; tool schema refuses other kinds.
- `agentnotify.HandleRuns` notifies ADE run ends under `Enabled && OnRunEnded`; Click -> `Reveal`;
  reveal pushes `kira:agent:reveal-terminal` / `-task`. `FocusState` has no run tab.
- Frontend: `RunDialogRequest{scriptId, prefill}`; `RunScriptDialog` uses `ctx.runs.preview/start`;
  `RunPreview` folder `MODE_LABEL` covers `kira|fixed|home`. Space `automationsModule.ts`
  `showAutomations` = `modeStore.setMode('automations')`. Task menu (`taskMenuModel`) and branch row
  menu (`AdeBranchRow.onMenu`) exist; branch panel header (`headerActions`).
- Docs drift found: `docs/ARCHITECTURE.md` migration high-water marks still say Studio `0034`, Space
  `0026`; actual `0035` / `0028`. Fixed in this phase's docs commit (pre-existing, on the spot).
- Coverage gate: both `exempt.txt` empty.

## 2. Decisions (planner defaults; user may override)

- D1 **Gate truth lives in the board.** A smart run in a worktree takes a *claim* through
  `TaskBoard.ClaimWorktree` under the task mutex; ADE launch, rebase plan and interactive session
  start read the same claim map under the same mutex. No cross-mutex race. Claims are in memory; a
  restart has none.
- D2 **Only smart runs gate.** A normal script in a terminal tab neither holds ADE runs nor is refused
  on a busy branch (a dev server must not freeze the pipeline; the user controls that terminal).
- D3 **Choosing a task makes it an ADE run** in either entry (Automations or ADE): ADE vars resolve,
  `use_ade_dir` applies, trigger `ade`, Space tools and `run_outcome` granted (Part 2 D5).
- D4 **Task required when an ADE variable is used.** Space Automations entry: no task chosen and the
  script uses one -> `missing: ["task"]`. A script with no ADE variable shows no task picker and
  runs as today (`manual`).
- D5 **`base`** = the branch's base name (`sb.Base`), else the repo's main branch name.
- D6 **Missing worktree is not a preview blocker.** Preview shows the predicted path (`freePath`) with
  `created on Run`; Start creates it through `ClaimWorktree` (`launchGate`). A worktree still being
  prepared is a blocker (`the worktree of <branch> is still being prepared`). Start creates the
  worktree before hashing, so a predicted path that differs answers `E_CONFLICT` (check again).
- D7 **Workflow smart steps are ADE runs**, not `script_runs`: ADE logs, ADE outcome, ADE
  notification, board surfaces with `SmartBadge`. The Automations list shows only runs started
  through `scriptruns`.
- D8 **Smart step prompt is the script body**, composed with the run vars and the step params, then
  `SpaceSuffix` (when the workflow enables Space tools) and `FinishStepSuffix`. The ADE Run dialog's
  message edit does not apply to a smart step: the dialog shows the composed body read-only, and the
  server ignores a stored step message for a smart step. Resume, retry, send-back and Take over keep
  today's paths; resume and retry launch with the script's flags again.
- D9 **Smart step tools**: script built-ins and MCP choices, isolated (`Isolated: true`, user MCP file
  per run as Part 2), plus `finish_step`, `run_outcome`, Space tools when the workflow enables them.
  Step `allowed_tools` refused beside `smart_script`. Timeout = step `timeout`, else the script's.
  Model and budget from the script.
- D10 **One result mapping.** Part 2's `decide` rows for the `result` event (budget, turn limit,
  `is_error`, cost, denials) move to `claudeheadless/result.go`; `scriptruns.decide` and the ADE smart
  step both call it. No behaviour change for script runs.
- D11 **Notification**: smart script runs (any trigger) in Space. `failed` under `Enabled`; `blocked`
  under `Enabled && OnNeedsInput`; `done` under `Enabled && OnRunEnded`; `cancelled` never. Title
  `Automation failed · <name>`, `Automation needs you · <name>`, `Automation done · <name>`; body
  reason or summary (existing `body` rule). Suppressed while a focused window shows that run's tab.
  Click opens the run tab in Automations. Normal script runs: no notification (their tab shows it).
- D12 **Chip clears when seen.** Task card chip: the task's running smart/normal runs (spinner, name,
  elapsed), else its newest ended run when `failed|blocked` and not seen. Opening that run's tab, or
  its row in the panel block, marks it seen (VueUse `useStorage`, per viewer, last 200 ids). No
  dismiss column, no new bound method (Needs you `automation` stays dropped, Part 2 P4).
- D13 **From ADE, a smart run opens its tab in Automations without switching mode** (chip and panel
  block show it); a normal script opens its terminal tab and switches to Automations (it is
  interactive).
- D14 **`run_outcome` kind `""` unchanged** (`rebase` + `step`); `automation` lists the task's script
  runs only.
- D15 **No new bound methods.** `ListArgs` gains `TaskID`; `RunArgs` gains task fields; Preview gains
  `needs` and `ade`. Coverage gate needs no exemption.
- D16 **No stream split.** Frontend depends on regenerated bindings from the Go types; tests/support,
  appwire and docs are shared. One sequential implementer.

## 3. Design

### 3.1 Shared Go: scripts and scriptruns

`internal/scripts`:

- `CustomScript`/`CustomScriptFields` gain `UseAdeDir bool json:"useAdeDir"` (default true on create;
  `repo.go` `selectColumns`, insert, update). Studio stores it, never shows it.
- `DirModeWorktree = "worktree"` (a `Dir.Mode` value only; never stored). `Dir` gains
  `Branch string json:"branch"` (label `repo · branch`) and `Pending bool json:"pending"` (created on
  Run).
- `BuiltinEnv(name) string`: `KIRA_TASK|JIRA|REPO|BRANCH|BASE|WORKTREE`.

`internal/scriptruns`:

```go
// ADE is Kira Space's task board as script runs see it; nil in Studio.
type ADE interface {
    Tasks() ([]TaskChoice, error)                         // live tasks, newest first
    Context(taskID, branchID string) (ADEContext, error)   // vars + branch choices
    ClaimWorktree(ctx context.Context, branchID, script string) (path string, release func(), err error)
    Busy(branchID string) string                           // "" or why a smart run cannot claim it now
    Tools() (claudeheadless.SpaceTools, claudeheadless.Outcomes)
}
type TaskChoice struct { ID, Title string }               // json id, title
type BranchChoice struct { ID, Label string; Disabled bool; Why string } // json id, label, disabled, why
type ADEContext struct {
    TaskID, TaskTitle string
    Vars     map[string]string // task jira; with a branch also repo branch base worktree
    Branches []BranchChoice    // mine branches; drafts disabled "not created yet"
    Branch   *BranchChoice     // chosen: given, or the only enabled one
    Worktree string            // existing path, else predicted
    Pending  bool              // worktree not created yet
    Preparing string           // setup gate text, "" when ready
}
```

- `Service.ADE ADE` (Space appwire sets it after the board is wired).
- `RunArgs` gains `TaskID`, `BranchID string`. Studio (`ADE == nil`) with a `TaskID` ->
  `E_INVALID` `tasks exist only in Kira Space`.
- `Preview` gains `Needs{Tasks []TaskChoice, Branches []BranchChoice} json:"needs"` (empty slices when
  nothing is asked) and `ADE *RunADE json:"ade"` (`{taskId, taskTitle, branchId, branchLabel}`, nil
  without a task).
- `plan` (with `ADE`):
  1. `adeVars := VarsUsed(body or command, nil)` filtered to built-ins.
  2. No `TaskID`: when `adeVars` non-empty, `Needs.Tasks = ADE.Tasks()` and `Missing` gains `task`;
     stop there for ADE resolution.
  3. `TaskID` set: `ctx := ADE.Context(TaskID, BranchID)`. Branch needed when a branch-bound var
     (`repo branch base worktree`) is used or `UseAdeDir` is on. Needed and `ctx.Branch == nil` ->
     `Needs.Branches = ctx.Branches`, `Missing` gains `branch`. A given `BranchID` not in the
     enabled list -> `E_INVALID` `that branch cannot run this script now`.
  4. Values: `rendered` and env gain the built-ins (`FromVar` = var name, so `VarText` chips them);
     `EnvVar` order: built-ins, then params.
  5. Folder: `UseAdeDir` and a branch -> `Dir{Mode: worktree, Path: ctx.Worktree, Branch, Pending}`;
     `ctx.Preparing` -> blocker. Else `ResolveDir` as today.
  6. Smart with a task: `Suffix = SpaceSuffix + "\n\n" + ScriptReportSuffix`; extra allowed =
     `FinishStepTool, RunOutcomeTool, SpaceToolNames...`. Smart in the worktree:
     `ADE.Busy(branch)` -> blocker (`a run is working on <branch>`, `a rebase is running on
     <branch>`, `automation <name> is running in this worktree`).
  7. Hash adds task id, branch id, and dir mode.
- `Start`: when the plan has a worktree folder and the run is smart: `ClaimWorktree` first (creates
  the worktree, takes the claim), re-plan, then hash check; any later failure calls `release`. A
  normal script with a pending worktree: `ClaimWorktree` creates it and releases at once (normal runs
  do not hold the claim, D2).
- Smart run: `smartRun` keeps `release`; the run's goroutine calls it after `FinishByRun` (the board
  then launches held runs). Grant `{RunID, TaskID, Space: true}` when a task is set. `mcpServer()`
  builds `Options{Dir, OnFinish, Space, Outcomes}` from `ADE.Tools()` when `ADE != nil`.
- `Run` and `launch` gain `TaskID, TaskTitle, BranchID, BranchLabel string`; trigger `ade` when
  `TaskID` set, else `manual` (smart) / launch trigger (normal, `Begin` takes it from the launch).
- `ListArgs.TaskID`: `Repo.ListByTask(taskID, limit)` (index below). `Repo.ListByTask` also backs
  the board's `run_outcome`.
- `Close()` order unchanged; releases run inside each run's goroutine (board no-ops when closed:
  `launch` returns `errBoardClosed`).

`internal/claudeheadless/result.go` (D10): `ResultOutcome(res *Result, exit int, budgetUSD float64)
(runoutcome.Outcome, bool)` for the budget, turn-limit and `is_error` rows; `ApplyResult(out
runoutcome.Outcome, res *Result) runoutcome.Outcome` for cost and denials (sort, cap 50, reason
suffix when not done). `scriptruns.decide` calls both; same rows, same order.

### 3.2 Storage (identical bodies)

Space `0029_p242_scripts_in_ade.sql`, Studio `0036_p242_scripts_in_ade.sql` (Studio too: `scripts.Repo`
and `scriptruns.Repo` are shared):

```sql
ALTER TABLE custom_scripts ADD COLUMN use_ade_dir INTEGER NOT NULL DEFAULT 1 CHECK (use_ade_dir IN (0, 1));
ALTER TABLE script_runs ADD COLUMN task_id TEXT NOT NULL DEFAULT '';
ALTER TABLE script_runs ADD COLUMN task_title TEXT NOT NULL DEFAULT '';
ALTER TABLE script_runs ADD COLUMN branch_id TEXT NOT NULL DEFAULT '';
ALTER TABLE script_runs ADD COLUMN branch_label TEXT NOT NULL DEFAULT '';
CREATE INDEX script_runs_task ON script_runs (task_id, created_at DESC);
```

`scriptruns.columns`, `scan`, `Insert` updated. Migration tests (both apps, existing pattern): a
pre-migration row reads back `useAdeDir true`, empty task fields.

### 3.3 Space Go: board side (`apps/kira-space/internal/ade`)

New `automation.go` on `*TaskBoard`, implementing `scriptruns.ADE`:

- `Tasks`: `ListLive`, title via `taskTitle`.
- `Context`: `loadTaskCtx`; vars `task` (`taskTitle`), `jira`; per mine branch: label
  `nick · name`; drafts disabled `not created yet`; with a chosen or single enabled branch: `repo`
  nick, `branch`, `base` (D5), `worktree` (`worktreeOf`, else `freePath` + `Pending`), `Preparing`
  from `SetupByBranch` + `setupGateError` text.
- `Busy(branchID)` under the task mutex: `HasActiveStepRunOn`, `RunningRebaseOn`, existing claim.
- `ClaimWorktree(ctx, branchID, script)`: under the task mutex: `Busy` -> error; `launchGate`
  (creates worktree; setup gate error passed through); record `claims[branchID] = script`; return
  `release` that, under the task mutex, deletes the claim and calls `launchHeldLocked(sb)`.
- `Tools()`: the board itself (it implements both interfaces).
- `TaskBoard` gains `claims map[string]string` (guarded by `runMu`), helper `claimOn(branchID)
  string`.
- Gates (D1): `launch` holds with note `waiting for automation <name>` when `claimOn(sb.ID) != ""`
  (after the rebase check); `rebaseBlockers` adds `automation <name> is running in <branch>`;
  `checkNoBackgroundRun` adds `automation <name> is running in <branch>`.
- `Start()` (after `Recover`): pending runs whose note starts `waiting for automation` launch through
  `launchHeldLocked` (no claim survives a restart).
- `RunOutcomes`: `q.Kind == "automation"` -> `deps.ScriptRunsOf(taskID, limit)`; entry `{runId, kind
  "automation", step: script name, repo/branch from `branch_label`, state, finishedAt, outcome}`. Kind
  `""` unchanged (D14). `claudeheadless/outcomes.go`: kind accepts `automation`; schema text
  `rebase, step or automation (script runs started for this task). Default rebase and step.`
- Deps: `TaskBoardDeps.Scripts *scripts.Repo`, `ScriptRunsOf func(taskID string, limit int)
  ([]scriptruns.Run, error)`, `ScriptsHome string` (app home, for a smart step's own folder).

Workflow smart step:

- `adeflow/parse.go`: step keys add `smart_script` (string 1..200) and `params` (mapping name ->
  scalar or list of scalars; names `^[a-z][a-z0-9_]{0,31}$`). With `smart_script`: `prompt` and
  `allowed_tools` refused (`prompt is not allowed with smart_script`, `allowed_tools is not allowed
  with smart_script`), `prompt` not required. `params` without `smart_script` refused. Syntax only.
- `writer.go`: `stepOrder` gains `smart_script`, `params` (after `timeout`); params scalar for one
  value, list for more.
- `adewire.PipelineStep` gains `SmartScript string json:"smartScript"`, `Params map[string][]string
  json:"params"`; `stepDef` same.
- `startRun` agent stage, `def.SmartScript != ""`: `smartStep(def)` -> script by name among smart
  scripts (`could not start: smart script "x": not found` / `2 scripts have that name`);
  `ParamValues(script.Params, def.Params)` (error or missing -> `could not start: smart script "x":
  <why>`); prompt = `Compose(body, vars+params)` + suffixes (D8); cwd = worktree unless
  `!UseAdeDir` -> `ResolveDir(script, ScriptsHome)` + `PrepareDir`. Stored step message ignored.
- `superviseAgent` for a smart step: `Spec{Model, MaxBudgetUSD, Tools, AllowedTools: ToolArgs(script,
  extra), Isolated: true, MCPConfigPaths: WriteUserConfig(...)}` (server gone -> launch fails with
  that text), env adds `KIRA_PARAM_*` and built-in `KIRA_*`, `OnResult` captured; outcome:
  `ResultOutcome` first, else today's `agentOutcome`, then `ApplyResult`.
- Space appwire: `TaskBoardDeps.{Scripts, ScriptRunsOf, ScriptsHome}`; after `wireAdeTask`, `runs.ADE =
  w.AdeBoard`. Wire order already creates `runs` before the board.

### 3.4 Space Go: notification

- `agentnotify`: `KindAutomation Kind = "automation"`; `Note.ScriptRunID`; `FocusState.ActiveScriptRunID`;
  `HandleScriptRun(r scriptruns.Run)`: smart runs only; tracks `running -> ended` like `HandleRuns`
  (own map, same bound); prefs per D11; suppressed when a focused live window reports that run id;
  cooldown key `automation:<id>`. `Click` reads `scriptRunId`.
- Appwire: `scriptruns.Service.Emit` also calls `w.AgentNotify.HandleScriptRun(r)`; `revealNote`: a
  note with `ScriptRunID` focuses `AnyRealKey` and emits `ChannelAgentRevealScriptRun`
  (`kira:agent:reveal-script-run`, `{runId, label}`; not on the phone allowlist).

### 3.5 Frontend (shared workbench)

- `packages/shared/domain/scripts.ts`: `useAdeDir: z.boolean()`; dir mode enum adds `worktree`; dir
  `branch`, `pending`. `scriptRuns.ts`: run `taskId taskTitle branchId branchLabel`; preview `needs`,
  `ade`; `ScriptRunArgs` `taskId`, `branchId`.
- `module.ts`: `AutomationsModuleContext.ade: boolean` (Space true, Studio false);
  `ScriptRunsSeam.list(limit, taskId?)`.
- `runDialog.ts`: `RunDialogRequest` gains `taskId?`, `branchId?`, `from?: 'automations' | 'ade'`.
  Store unchanged otherwise (one concern).
- `RunScriptDialog.vue`: `taskId`/`branchId` refs seeded from the request, sent in args; new child
  `run/AdeContextFields.vue` (`<script setup lang="ts">`, Tailwind):
  - Task (only when `needs.tasks` non-empty): `Popover` + `Command` combobox (search, one pick),
    `data-testid="run-task"`.
  - Branch (only when `needs.branches` non-empty): `RadioGroup`, items `repo · branch`, disabled with
    `why` as hint, `data-testid="run-branch"`. Nothing remembered between dialogs.
  - Context line when `preview.ade`: `VarText` `[task chip] · [branch chip]`.
  Start success: normal -> terminal tab + `showAutomations()` when `from === 'ade'` (D13); smart ->
  `openRunTab` only.
- `RunPreview.vue`: `MODE_LABEL.worktree = 'Worktree of '` + `{name:'branch'}` chip, then
  `{name:'folder'}` chip; `pending` adds `(created on Run)`. Env rows already chip `fromVar`
  (built-ins now carry it).
- `ScriptDialog.vue`: when `ctx.ade`, a `Switch` `Run in the task's worktree when started from ADE`
  (`data-testid="script-use-ade-dir"`), default on; saved as `useAdeDir`.
- `runs/RunsSection.vue`: trigger label `ADE · <taskTitle>` for trigger `ade`.
- `runs/runsQueries.ts`: `useTaskScriptRuns(taskId)` key `['scriptRuns','task',taskId]`, limit 50,
  patched by the same push (upsert when `run.taskId` matches); `useSeenRuns()` (VueUse `useStorage`
  `kira.automations.seenRuns`, last 200 ids, D12). `ScriptRunView` marks its run seen on mount.

### 3.6 Frontend (Space)

- `workbench/automationsModule.ts`: `ade: true`; `list` passes `taskId`.
- `ade/v2/automation/useRunAutomation.ts`: builds menu items from `useCustomScriptsStore().records`
  (normal and smart; smart items `icon: 'sparkle'`), each opens `useScriptRunDialogStore().open({
  scriptId, taskId, branchId?, from: 'ade' })`. Empty list -> one disabled item `No automations yet`.
- Task menu: `taskMenu.ts` `TaskMenuInput.automations: TaskMenuItem[]`, cmd `{kind: 'automation',
  scriptId}`, submenu `Run automation` (id `ade-task-automation`) after `Show sessions`;
  `useTaskMenu.ts` maps the cmd. Review tasks get it too (normal scripts are useful there).
- Branch row menu (`AdeBranchRow.vue`, created mine branches): submenu `Run automation` with the
  branch preset. Branch panel header: `headerActions.ts` kind `automation` (`Run automation…`,
  grey) opening the same submenu at the button (`openContextMenuAt`).
- `ade/v2/automation/AdeAutomationChip.vue` on `AdeTaskCard.vue` (D12; `AdeChip`, `SmartBadge` for
  smart, `RunElapsed` while running, red `failed`, amber `needs you`, `AdeTip` with the reason;
  click opens the run tab (smart) or activates the terminal tab (normal) and switches to Automations).
  Source: `useScriptRuns()` live list filtered by `taskId`.
- `ade/v2/automation/AdeAutomationsBlock.vue` in `AdeTaskPanel.vue`: `useTaskScriptRuns`; rows with
  `RunStatusBadge`, name, `branchLabel`, `RunElapsed`, Stop, expand -> `RunOutcomeBlock`; empty
  block hidden.
- Workflow editor: `workflows/AdeStepCard.vue` `ToggleGroup` `Prompt | Smart script`
  (`data-testid="ade-wf-step-mode"`); smart: `NativeSelect` of smart scripts (label `✦ name`; a name
  not found shows `not found` in red), `ParamsForm` bound to `step.params`, and a read-only preview of
  the script body via `VarText` (params as chips with their values; built-ins chipped with value
  `{name}` and the existing note `filled in per run`); tools field hidden. `board/workflowForm.ts`:
  `newStep` sets `smartScript: ''`, `params: {}`; switching mode clears the other side. `wire.ts`
  `PipelineStep` mirror.
- `run/AdeRunDialog.vue`: when the stage's first step is a smart step, the message editor is
  replaced by the composed body via `VarText` (`task`, `jira`, params chipped; per-branch vars
  `{repo} {branch} {worktree}` literal) plus `SmartBadge`; no message sent (D8).
- Step views (`AdeStageBlock.vue`, run rows): `SmartBadge` on steps with `smartScript`.
- `state/agentNotify.ts`: report `activeScriptRunId` (active `script-run` tab in the automations
  workspace while mode is `automations`); `onAgentRevealScriptRun` -> `setMode('automations')`,
  `openRunTab(runId, label)`. `bridge/control.ts`, `bridge/index.ts` channel subscription.

## 4. Files (ownership, one implementer)

| Area | Files |
|---|---|
| Shared Go | `internal/scripts/{scripts,repo,smart,workdir}.go`, `internal/scriptruns/{run,repo,preview,service,smart_run,launch,bound,ade}.go` (`ade.go` new), `internal/claudeheadless/{result.go (new),outcomes.go}` |
| Space Go | `ade/{automation.go (new),board.go,runs.go,rebase.go,launches.go,workflows.go,steps.go,agenttools.go}`, `adeflow/{parse,writer}.go` + `adeflow_test.go`/`writer_test.go` cases, `bridge/adewire/wire.go`, `bridge/events.go`, `agentnotify/agentnotify.go`, `appwire/{appwire,wire}.go`, `storage/migrations/0029_p242_scripts_in_ade.sql` + `migrate_scripts_in_ade_test.go`, `frontend/bindings/**` (regenerated) |
| Studio Go | `storage/migrations/0036_p242_scripts_in_ade.sql` + migrate test, `frontend/bindings/**` (regenerated) |
| Shared TS | `packages/shared/domain/{scripts,scriptRuns}.ts` |
| Workbench | `automations/{module.ts,ScriptDialog.vue}`, `automations/run/{runDialog.ts,RunScriptDialog.vue,RunPreview.vue,AdeContextFields.vue (new)}`, `automations/runs/{runsQueries.ts,RunsSection.vue,ScriptRunView.vue}` |
| Space frontend | `workbench/automationsModule.ts`, `bridge/{control,index}.ts`, `state/agentNotify.ts`, `ade/v2/{wire.ts,board/taskMenu.ts,board/workflowForm.ts,plan/useTaskMenu.ts,plan/AdeBranchRow.vue,plan/AdeTaskCard.vue,panel/headerActions.ts,panel/AdeBranchPanel.vue,panel/AdeTaskPanel.vue,panel/AdeStageBlock.vue,run/AdeRunDialog.vue,workflows/AdeStepCard.vue}`, new `ade/v2/automation/{useRunAutomation.ts,AdeAutomationChip.vue,AdeAutomationsBlock.vue}` |
| Studio frontend | `workbench/automationsModule.ts` (`ade: false`, `list` signature) |
| Tests | Space `flows/adeflow/automation_test.go` (new), `flows/notifyflow/notify_test.go`, `flows/termflow/smart_test.go` (Space ADE-less case unchanged), Studio `flows/termflow/smart_test.go` (one case), Space `tests/ui/ade-v2-automations.spec.ts` (new), `tests/ui/support/{ipcChannels,mockRuntime,bootSnapshots}.ts` (both apps as needed), Space `tests/e2e-real/ade-automation-real.spec.ts` (new), Space `internal/realclaude/automation_test.go` |
| Docs | `docs/ARCHITECTURE.md` (Automations + ADE sections, high-water marks fixed to 0036/0029), `docs/DEV_ENVIRONMENT.md` (realclaude row paths add `apps/kira-space/internal/ade/automation.go`), SPEC row + `plans/P242-part3-result.md` |

## 5. Tests

P236 conventions: real processes, temp homes, fake `claude` on PATH, no mocks in Go flows. No new unit
tests: `plan` needs, claims and step parse rows are reached by flows below (CLAUDE.md bar). The
`adeflow` parse/writer cases extend the existing table tests. Coverage gate: no new bound method;
both `exempt.txt` stay empty.

### 5.1 Space flows `flows/adeflow/automation_test.go` `TestAutomationRun`

1. Automations entry, script uses `{branch}`: Preview without task -> `needs.tasks` lists the live
   task, `missing [task]`. With task, two mine branches + one draft -> `needs.branches` 3, draft
   disabled `not created yet`, `missing [branch]`. Branch preset -> no needs.
2. Resolution: prompt parts carry `task branch base worktree` values as vars; env `KIRA_TASK`,
   `KIRA_BRANCH`, `KIRA_BASE` exact; `allowedTools` has `finish_step`, `run_outcome` and the Space
   tools; suffix starts with `SpaceSuffix`.
3. Folder: `useAdeDir` on -> cwd = worktree (fake `.cwd`), trigger `ade`, row task/branch fields set;
   off -> `<home>/automations/<id>`. Branch without worktree -> preview `pending`, Start creates it.
4. Gate: smart run (`waitFile`) in the worktree -> ADE step launch held with note `waiting for
   automation <name>`; rebase plan blocker; session start refused; run ends -> step launches. Reverse:
   step running -> Preview blocker `a run is working on <branch>`, Start `E_INVALID`. Restart with a
   held step -> board Start launches it.
5. Workflow step: `smart_script` + `params` -> prompt (`.prompt`) = body with vars and params +
   `FinishStepSuffix`; `.args` has `--model`, `--tools`, isolation flags, script tools + finish_step;
   unknown name, duplicate name, missing required param, value not an option -> run failed `could not
   start: smart script "x": …`; step `timeout` wins over the script's; a fake `result` with
   `error_max_budget_usd` -> step failed, budget reason, cost on outcome.
6. `run_outcome` kind `automation` (call through the grant, as `outcome_test.go` does) lists the failed
   script run with its reason; kind `""` lists no script run.
7. Normal script from ADE: Start token, terminal Open prints `$KIRA_BRANCH`; run trigger `ade`; a busy
   branch does not refuse it (D2).
8. `ListArgs{TaskID}` returns only that task's runs (covers the bound field).

`flows/notifyflow`: failed smart run notifies `Automation failed · <name>`; done does not unless
`OnRunEnded`; blocked under `OnNeedsInput`; stopped never; focused run tab suppresses; Click with
`scriptRunId` emits `kira:agent:reveal-script-run`.

Studio `termflow/smart_test.go`: Preview with `taskId` -> `E_INVALID` `tasks exist only in Kira
Space`; `useAdeDir` round-trips.

Parse/writer table rows (`adeflow_test.go`, `writer_test.go`): `smart_script` with params scalar and
list; `prompt` beside it refused; `allowed_tools` beside it refused; `params` alone refused; writer
round-trip keeps key order.

### 5.2 Playwright UI (Space, mocked bridge) `tests/ui/ade-v2-automations.spec.ts`

Task menu `Run automation` submenu lists scripts with sparkle icon for smart; opens the run dialog
with task preset; branch radio shown for two branches, draft disabled with hint; prompt chips
`[data-testid=var-chip][data-var=branch]`; folder line `Worktree of` with branch chip; Automations
entry task combobox; branch row and header entries preset the branch; chip states running (elapsed,
Playwright clock), failed (reason tip), cleared after opening the run tab; task panel block rows and
Stop; step card toggle writes `smart_script` + `params` YAML, tools field hidden, body preview chips;
ADE Run dialog shows the smart body read-only; editor `Switch` present in Space only (Studio
`automations-smart.spec.ts` asserts it absent).

### 5.3 e2e-real (Space) `tests/e2e-real/ade-automation-real.spec.ts`

Fake claude: run a smart script from the task menu in the worktree (`Running` chip, then the run tab
shows `Succeeded`); a held ADE step shows `waiting for automation` then runs.

### 5.4 Real claude (opt-in, haiku, `--max-budget-usd 0.05`)

`apps/kira-space/internal/realclaude/automation_test.go` `TestSmartScriptRun` subtest `in task
worktree`: prompt asks for `task_info` then `finish_step` -> `done`, `reported`, cost > 0, the
`.args`-equivalent log shows the Space tools allowed. Rows to run at phase end: Smart scripts, ADE
runs (`superviseAgent` changed), Claude config isolation (`TestRealClaudeSettingsUntouched`: smart step
argv).

### 5.5 Checks

Per commit: `go build ./...`, `gofmt`, `go vet` (golangci-lint where it runs), `bun run typecheck`,
`bun run lint`, `bun run lint:dead`. Once at the end: `test:flows:space`, `test:flows:studio`
(coverage gates), `go test` of touched shared packages, both apps' UI suites, Space visual,
`test:e2e-real:space`, real-claude rows above. Hooks green on every commit; never `--no-verify`.

## 6. Commits

1. `refactor(claudeheadless): share the result event outcome rows`
2. `feat(scripts): worktree option and task fields on script runs` (migrations both apps, repos, TS)
3. `feat(scriptruns): ADE context, task and branch needs, worktree claim`
4. `feat(space): board automation seam, gates both ways, run_outcome automation`
5. `feat(space): smart script workflow step`
6. `feat(space): automation notification and reveal`
7. `feat(workbench): task and branch pickers in the run dialog, worktree switch`
8. `feat(space): run automations from tasks and branches, chip and panel block, step card`
9. `test(space): ADE automation flows, UI and e2e-real`
10. `test: real claude smart script in a task worktree`
11. `docs: scripts in ADE`

## 7. Orchestrator verification checklist

- [ ] Codegraph: this planner's run shows `codegraph_explore` calls; implementer executes a named plan.
- [ ] Seam: `rg -n "runs.ADE = " apps/kira-space/internal/appwire` hits; `rg -n "ClaimWorktree"
      internal/scriptruns apps/kira-space/internal/ade` hits both.
- [ ] Gate both ways: `rg -n "waiting for automation" apps/kira-space/internal/ade` hits `launch`;
      flow case 4 passes.
- [ ] VarText (R9): `rg -n "VarText" packages/workbench/src/automations/run
      apps/kira-space/frontend/src/ade/v2/{workflows,run,automation}` hits RunPreview, RunScriptDialog,
      AdeContextFields, AdeStepCard, AdeRunDialog.
- [ ] Workflow step: `rg -n "smart_script" apps/kira-space/internal/adeflow` hits parse and writer.
- [ ] `run_outcome`: `rg -n '"automation"' internal/claudeheadless/outcomes.go
      apps/kira-space/internal/ade/agenttools.go` hits.
- [ ] Notification: `rg -n "HandleScriptRun" apps/kira-space/internal` hits agentnotify and appwire.
- [ ] One result mapping: `rg -n "error_max_budget_usd" internal apps` hits only `claudeheadless/result.go`
      (plus tests and fakes).
- [ ] Migrations: Space `0029` and Studio `0036` bodies identical; ARCHITECTURE high-water marks
      updated (0036/0029).
- [ ] No credential reads: `git diff f6b5c8863 -- internal apps | rg -n "keychain|security find|\.credentials"`
      empty.
- [ ] Bound methods: none added (`git diff` of `scriptruns/bound.go` shows only `ListArgs`); both
      coverage gates green; both `exempt.txt` empty.
- [ ] Frontend rules: new `.vue` are `<script setup lang="ts">`, no `<style>`; no new Pinia store;
      queries via TanStack; seen-runs via VueUse `useStorage`; `package.json`/lockfile and `go.mod`
      unchanged.
- [ ] Studio: no ADE UI (`rg -n "use-ade-dir" apps/kira-studio` empty outside tests asserting absence).
- [ ] Real claude: result quotes PASS and spend per row in 5.4.
- [ ] Hooks green on every commit; SPEC row Done with `plans/P242-part3-result.md`.

## 8. Not in Part 3

Recurring scripts (Part 4). Needs you `automation` kind (dropped, Part 2 P4). A failed-automation line
in ADE step prompts (iter1 idea; not in the SPEC row). Dismiss stored server-side (D12 uses per-viewer
seen state). Notifications for normal script runs (D11). Popup routing across windows (P246).
