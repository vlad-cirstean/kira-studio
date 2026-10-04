# P147 plan: ADE v2 wave 4 — send-back, Take over, interactive launch, archive, restart recovery ‖ Workflows, Repos, run UI

Serial step 0, then two streams in one `P`. Stream A (Go) and Stream B (frontend) in separate
worktrees off one base. Implements preplan §4 P147, the P143 contract's P147 rows, P146 §8
carry-forward and P145 §8's P147 B items. Nothing from P148+.

Inputs: `SPEC.md` P147 row, P145/P146 results; `plans/P143-ade-v2-preplan.md` (§3 rules, §4 P147, §5
matrix, §6 D1-D16); `plans/P143-wire-contract.md` (frozen; §4 P147 methods, §5 `adeTaskOpenSession`);
`plans/P145-*` (§8, F6, F11, F13); `plans/P146-*` (R-decisions, §8, `## Result`, notes);
`design/ade-v2/SPEC2.md`, `mockup.html` (views `plan`, `pipelines`, `repos`), `workflows/*.yaml`;
`docs/ARCHITECTURE.md` "ADE v2 run engine (P146)". Base `B0`: `v2.0` tip after step 0 (§2) lands
(current tip `e41420b8`).

**Status: proposed.** No open preplan item left (O2-O5 resolved earlier). Gaps found here are resolved
with the recommended option (R-table).

## 0. Findings from the current tree

- Engine (`internal/ade/runs.go`, `steps.go`): `back:<step>` is a plain failure (`retryLimit` 0,
  `nextAction` idles). `Run.Loops` exists in model, repo and wire, always 0. Processes run on `b.ctx`
  only: no per-run cancel, so no `StopRun` and no wait-for-exit. `launch` clears `note` on start.
  `completeRun` → `advanceLocked`. `RetryRun` accepts `failed|stuck` latest attempt (fresh session,
  composed prompt, `loops` 0).
- `adeagent.Spec` has `SessionID` only (`--session-id`); no resume. `Server.Register(runID)` writes a
  per-run MCP config; `finishStep` answers `Recorded. Stop now.`; `recordFinish` stores the last call,
  applied at process exit.
- Quit (R18): rows stay `running`; setups stay `running`. Nothing at boot turns them stuck.
  `AdeSessionsRepo.StopAllRunning` touches v1 rows only (`task_id = ''`). Config files of killed
  runs stay in `<home>/ade/runs/`.
- Pending runs: note set once at insert (`waiting for worktree setup`); a later setup failure never
  rewrites it (P146 open item).
- `Tracker` (`ade/tracker.go`) is v1-shaped: `PrepareArgs{CodeRepoID, Branch, NewWorkID, Cwd, Resume,
  Message}`, intent → `Compose` inserts a v1 row (`Store.Insert`), resume = `MarkRunning` on the same
  record; message appended as a quoted positional; `Send` works by record id for any composed record;
  `Recover` = v1 `StopAllRunning`. The terminal is spawned by the renderer (`TerminalHostView` →
  `terminal.Open` → `ComposeAgent` → `Tracker.Compose`), so every TUI launch needs a mounted terminal:
  none exists in v2 until P148 B's Sessions tab.
- v1 `AdeService.FocusSession` (`bridge/ade.go`): `Registry.WindowOf(terminalId)` → `FocusWindow` →
  `EmitTo(window, …)`. v1 `Queue.Archive`/`ArchiveRisk` hold the risk/remove logic (`atRisk`,
  `WorktreeStatus`, `WorktreeRemovePreflight`, `worktreeRemove` op with confirm token, close terminals).
- `TaskBoard` has no archive write; `Board.history` already maps archived tasks (`toWireHistory`,
  `ListArchived`, `BranchesArchived`).
- `AddExistingBranch` attaches a branch without a worktree; SPEC2 §6.1 lists "Add existing branch",
  "Start" and "Take over in a new worktree" as setup triggers. Only `StartRun` creates worktrees today.
- No workflow-switch method: `CreateTask` sets the first stage; promoted/added tasks have
  `workflowId ''` (F13). `SetTaskWorkflow` is P147 A in the contract, but the panel Workflow select
  (P147 B) needs it — an ordering dependency (§2).
- Frontend: `ade/v2/shell/AdeShell.vue` has `Backlog` + `Plan` tabs; `adeBoardUi.view` is
  `'plan' | 'backlog'`. `AdeActionCell.vue` renders tag + Force push only (F11). `taskCell` /
  `branchTag` / `buildTaskProgress` / `branchProgress` already model `▶ Run`, `Approve`, `Retry`,
  `Done ›`, `Finish ✓`, `Take over`, `▶ <Stage>`, `↩ sent back`, `· fix N`, `⚙ preparing`,
  `✕ setup failed` + `See error`. `scriptStageAction` ignores `stuck`. `usePlanModel` ticks `now`
  every 60 s (too coarse for `⚙ preparing 3m 40s`). `buildCard` passes `sessions: []`.
- No native file/folder picker in the bridge; mockup uses typed paths (`~/code/oss`). Shadcn
  primitives present: dialog, input, textarea, switch, native-select, toggle-group, tabs, tooltip,
  badge, field. No new primitive needed.
- P145 methods for B: `WorkflowYaml`, `ValidateWorkflowYaml`, `SaveWorkflow` (whole `Workflow`,
  `wf.id` = file stem; F6 refusal `fix the YAML error on line N first`), `SaveWorkflowYaml` (writes any
  text), `ImportWorkflow` (absolute path; existing target refused), `NewWorkflow` (slug, `-2`…),
  `UpdateRepo`, `AddFolder`, `SetFolderWatch`, `RemoveFolder`; `codeWorkspaceImportRepo(path)`.

### 0.1 Real CLI behavior (verified, CLI 2.1.289, scratch dir, `--model haiku`)

- `claude -p --output-format stream-json --verbose --session-id <uuid>` then
  `claude -p … --resume <uuid>`: `system/init.session_id` and `result.session_id` are the **same uuid**
  on resume, and context carries over (asked to remember `PELICAN`, resumed run answered `PELICAN`).
  `--fork-session` is the opt-in for a new id; we never pass it.
- Resume also worked from a different cwd; the engine still resumes in the recorded worktree.
- Variadic flags (`--add-dir`, `--allowedTools`, `--mcp-config`) swallow a following positional;
  `claude … --add-dir a b -- "msg"` works (`--` ends options). Verified in `-p`.
- `--mcp-config`, `--allowedTools`, `--add-dir`, `--resume` are general flags (not print-only).
- Interactive `claude --resume <id>` in a pty (`script -qfc`) starts; this sandbox shows the
  first-run theme picker, so the resumed TUI conversation itself is not observable here (no claim).

## 0.2 Coverage (SPEC2 slice of P147 → where)

| SPEC2 § | Item | Here |
|---|---|---|
| §3 | `Workflows` · `Repos` tab entries | B §4.2 |
| §4.1 | Live stage progress, percent, bar tip; branch row own progress incl. `↩ sent back`, `· fix N` | B §4.5 (R29) |
| §4.2 | Task stage action (`▶ Run`, `Approve`, `Retry`, `Done ›`, `Finish ✓`, `✓ merged`); `Take over`, `▶ <Stage>`, Archive → P148 B | B §4.5 (R22, R23) |
| §4.2 | Branch `⚙ preparing`, `✕ setup failed` + `See error`; `▶ Start` → P148 B | B §4.6 |
| §5 | User stage interactive launch with prompt + context | A R15 (dialog P148 B) |
| §5 | Agent stage Run dialog, approval, stuck/failed lines, Retry | B §4.5 (R24) |
| §5 | Take over (`claude --resume`, same worktree, `(resumed)` row) | A R13, R14 (UI P148 B) |
| §5 | Release extras | B §4.5 |
| §5 | Per-repo run lines (glyph · repo · bar · `n/m` · Log/Output/Retry · note) | B §4.5 (R28) |
| §5 | Send back, 3 rounds, `↩ sent back`, `· fix N`, chain continues | A R3-R6; B display |
| §5 | Script Output / Retry | B §4.5 |
| §5 / D7 | Restart recovery | A R9 |
| §5.1 | Workflows page, stage / step editor, panel Workflow select (switch restarts), `Edit workflows ↗` | B §4.3, §4.5; step 0 R1/R2 |
| §5.1.1 | Form / YAML, path, Copy YAML, Import, `+ New`, validation, last-valid message, folder watch, empty state (D2) | B §4.3 (R25-R27) |
| §5.1.2 | Editor note with hover text; suffix shown in the Run dialog | B §4.3, R24 |
| §6.1 | Setup triggers: Start, Take over in a new worktree, Add existing branch | A R12, R19 |
| §6.1 | Graph, panel header, Details → Worktree setup, Retry setup | B §4.6 |
| §6.3 | Repos page | B §4.4 |
| §7 | Workflow block one per stage (D11), Release, header phase action | B §4.5 |
| §9 | Start / Start step (single branch) | A R16 |
| §10 | Archive per task (risk, stop, delete worktrees, history) | A R18 (dialog P148 B) |
| — | Contract `Send`, `FocusSession`, `StopRun`, open-session channel | A R8, R17 |
| P146 open | Pending run note after a failed setup | A R10 |
| P145 §8 | Workflows page methods, F6 text, Repos page, F11 buttons | B §4.3-§4.5 |

Not P147: Sessions tab, terminals, Needs you, merge dialog / fix menu / Merge-Re-merge (M1), Rebase /
Queue after dialogs (U1 (a)), headless-sources draft binding: all P148 B (SPEC row, P146 result).

## 1. Decisions

Restated (preplan §6), implemented here: D3 (Take over of a running run requires stopping it first:
`stopIfRunning`; confirm dialog P148 B), D6 (headless flags unchanged; resume keeps them), D7
(restart: `running` → `stuck`, `interrupted by restart`, no auto-resume), D8, D11 (one block per
stage), D12, D13 (`back:` only to an earlier step of the same stage; scripts never send back), D15.

| # | Decision | Why |
|---|---|---|
| R1 | **Step 0 (serial, before `B0`)**: `SetTaskWorkflow` lands alone (engine, repo delete, bridge, `index.ts`, test). No wire change | Panel Workflow select is P147 B and needs it; without it no UI-made task ever gets a workflow (F13), so no run UI is reachable. Same shape as P146 R1 |
| R2 | `SetTaskWorkflow`: same id → no-op, returns the task. Any run of the task `running` → `E_INVALID` `stop its running agents first`. Else in one tx: delete the task's runs and their run logs, set `workflow_id`, stage = first stage + snapshot (`stageSnapshot`), `''` id clears workflow and stage. Clears the task's in-memory step messages. Emits board | "Switching workflow restarts at its first stage" (SPEC2 §5.1). Runs are keyed by stage/step id; two workflows sharing an id (`impl`, `release`) would show old runs as started. Session rows keep their (now dangling) `run_id`; Sessions tab (P148) still lists them |
| R3 | **Send-back** (`back:T` on step F, branch b, run failed): round n = 1 + count of F's runs on b in state `back`. n ≤ 3: F's run → `back`, note `<reason> → back to <T name> (n of 3)`; insert T attempt+1 on b with `loops = n`, note `sent back by <F name>: <reason>` (kept while running), resuming T's latest run's Claude session on b (`claude -p --resume <id>`), prompt `<F name> failed on <branch>: <reason>. Fix the implementation.` + finish_step suffix. n > 3: F's run → `failed`, note `<reason> (sent back 3 times)`. `<reason>` = finish_step summary, else the failure note | SPEC2 §5 text and mockup notes verbatim. Session id is kept on resume (§0.1). Gate rules apply (worktree ready) |
| R4 | **Chain** (pure, `steps.go` `chainRerun`): per target branch walk the stage's steps in order with `round = max loops of done latest runs so far`; first step whose latest run on b is `done` or `back` with `loops < round` is re-queued on b (attempt+1, `loops = round`, no approval gate); a missing, running, pending, stuck or failed run stops the walk. Runs before `nextAction`. Steps never run on b are left to `nextAction` | "Afterwards the chain continues from there" incl. steps between T and F (`ci` back to `impl` reruns `tests`). Loops as a round epoch needs no schema change. Earns a table test (interacting rules) |
| R5 | T not run on b (`once` / `only` target elsewhere) or T's run has no session row: F's run → `failed`, note `cannot send back: <T name> did not run on <branch>` / fresh session with the composed prompt + failure line respectively | No cross-branch resume; never silently drop the rule |
| R6 | `RetryRun` keeps the retried run's `loops` (fresh session, composed prompt as P146) | A retried fix run stays in its round, so R4's chain still reruns what follows |
| R7 | Per-run cancel: `context.WithCancelCause(b.ctx)` + done channel per live run (agent and script). Causes: `stopped` → `stuck` note `stopped by you`; `takeOver` → `stuck` note `taken over in Claude Code`; `archived` → `failed` note `stopped: task archived`. No failure rule, no advance on a user stop. Quit (`b.ctx`) unchanged (R18) | One mechanism for StopRun, Take over, Archive. Stuck = "needs a decision" (Retry / Take over) |
| R8 | `StopRun(runId)`: latest attempt `running` → cancel and wait for exit (bounded by `GracefulCancel`); `pending` → `stuck` `stopped by you` (no launch on setup ready); other states → `E_INVALID` | Wire method; caller UI is P148 B |
| R9 | **Restart recovery** `TaskBoard.Recover()`, called once from `main.go` right after construction, before `Start` and before any window: runs `running` → `stuck`, note `interrupted by restart`, `finishedAt` now; v2 session rows `running` (headless and TUI) → `stopped`; setups `running` → `failed`, log line `interrupted by restart`; pending runs of a failed setup get note `worktree setup failed`; `<home>/ade/runs/*.mcp.json` deleted. No auto-resume | D7. Boot has no live process or PTY from the previous life |
| R10 | Setup failure (any cause) rewrites the branch's pending runs' note to `worktree setup failed`; `RetrySetup` sets them back to `waiting for worktree setup` | Closes P146 open item "run held behind a failed setup keeps note `waiting…`" |
| R11 | **v2 TUI sessions through `Tracker`**: `PrepareArgs` gains `TaskID, BranchID, StageID, StepID, Resumes, ExtraArgs []string`; `Compose` inserts a v2 row (`mode tui`, `task_id`, `code_repo_id` NULL) when `TaskID != ''`; a non-empty message is appended as ` -- <quoted>`; `ExtraArgs` (quoted) go after the base command, before hooks' composition and `--`. New dep `OnStopped(recordID)` from `Reconcile`/`Close`. v2 resume of a stopped TUI row reuses the record (v1 path). `main.go` wires `OnChange` to both v1 `AdeSessionsChanged` and `AdeTaskSessionsChanged` | One tracker, one compose path (hooks, activity, Send, Reconcile). `--` per §0.1 |
| R12 | **Launch gate** (shared by `TakeOver`, `StartBranch`, `LaunchStage`): the branch's worktree exists and `setupReady`; worktree missing on a created branch → `ensureWorktree` + `startSetup`; ready at once (no script) → launch, else `E_INVALID` `preparing the worktree of <branch>; try again when it is ready`. Setup `running`/`failed` → `E_INVALID` naming it | SPEC2 §6.1: nothing runs until setup finished; Start/Take over in a new worktree trigger setup. Wire result is `Launch` only, so no pending variant |
| R13 | **`TakeOver(sessionId, stopIfRunning)`**. Headless row: live task required; run running and `!stopIfRunning` → `E_INVALID` `the run is still running; stop it first` (D3); else stop (R7 `takeOver`) and wait. Gate R12 on the row's branch; cwd = recorded cwd when it exists. New TUI record: `resumes` = headless Claude id, `claude_session_id` = same id, task/branch/stage/step copied, `run_id ''`; command `claude --resume <id>`. Stopped TUI row → resume that record (v1 path). Running TUI row → `E_INVALID` `already open`. Returns `Launch{terminalId, sessionId: record id, command, cwd}` | SPEC2 §5 Take over. Fixture `launch.json` shape |
| R14 | **Finish from a taken-over TUI**: when the run being taken over is the latest attempt of the current stage in `stuck`/`failed`, the TUI command also gets `--mcp-config <run cfg> --allowedTools mcp__kira-ade__finish_step` (new `Register(runID)`); a `finish_step` call for a TUI-bound run applies **at call time**: `done` → `done` + advance (R4 chain, next step); `failed` → failure rule (retry / R3 / stop); `needs_input` → stays `stuck`, note = summary. A call for a run no longer stuck/failed is ignored. Registration released on `OnStopped` of that TUI record. TUI exit without a call leaves the run as it was | The resumed context already holds the finish_step instruction. Without it a taken-over step could only ever finish through Retry (a fresh headless run), so Take over would never complete a step. No contract change |
| R15 | **`LaunchStage(taskId, message)`**: current stage `user` with `session: true`; no running TUI row of this task + stage (else `E_INVALID` `a <Stage> session is already running`); gate R12 on every created mine branch that has a setup row. cwd = first created mine branch's worktree, else first repo's `code_repos.root`; every other worktree / root via `--add-dir`. Task-level row (`branch_id ''`, `stage_id`). Message `''` → `<Stage>: <title>` · `- Jira: KEY URL` · per created branch `- Repo: <nick> · Branch: <name> · Worktree: <path>` or per repo `- Repo: <nick> (read only, in <root>)` · `- Notes: <notes>` · stage prompt with `{task} {jira} {repo} {branch} {worktree}` (joined, unquoted) | SPEC2 §5 example and mockup `stage` dialog lines. Read-only is by instruction, as in SPEC2 |
| R16 | **`StartBranch(branchId, message)`**: created branch (`name != ''`), live task, any kind; no running TUI row and no running headless run on the branch (else `E_INVALID` naming it; P148's dialogs use `Send` then); gate R12. Branch-level row. Message `''` → SPEC2 §9 "Start step": `Task:` · `- Jira:` · `- Repo: … · Branch: … · Worktree: …` · `Step: <first not-done step>` when the current stage is agent | §9; P148 B's merge / rebase / queue dialogs launch "new session" through this with their own text |
| R17 | **`Send(sessionId, message)`** → `Tracker.Send` (v2 record ids work as is); headless row → `E_INVALID` `a background run takes no input; use Take over`. **`FocusSession(sessionId, taskId)`** ports v1: running TUI row → `WindowOf` → `FocusWindow` → `EmitTo` `kira:adetask:open-session` `OpenSessionEvent{taskId, branchId, sessionId}`; `false` otherwise | Contract §4/§5 |
| R18 | **`ArchiveRisk(taskId)`**: one `BranchRisk` per task branch with a linked worktree (not the repo root): `dirty`, `unmerged` (ahead of main unless merged, via `atRisk`), `worktree`, `blocked` (first preflight blocker). **`ArchiveTask(taskId)`**: any `blocked` → `E_INVALID` listing them, nothing changed. Else: cancel live runs (R7 `archived`) and running setups of the task, close its running TUI terminals (`CloseTerminal` dep), remove every linked worktree with the discard token, set `archived_at` on the task and its branches, drop its plan row, emit board + sessions. Branches and notes kept | SPEC2 §10, ARCHIVE_TIP. Risk confirmation is the P148 B dialog (it shows `ArchiveRisk` first); the contract's `TaskArgs` has no discard flag, so archive is the confirmed delete |
| R19 | `AddExistingBranch` for a `mine`/`parked` branch not checked out anywhere: `ensureWorktree` (existingBranch) + `startSetup` after the attach. Review branches get none until Start / Take over (R12). A worktree failure does not fail the add: the branch stays attached, error logged, setup row absent | SPEC2 §6.1 trigger list. Read-only review items should not cost a prepare script per add |
| R20 | No migration in P147. P148 A's v1-drop migration stays `0011` | R2-R10 need no schema change |
| R21 | B: Workflows and Repos are views of `adeBoardUi` (`view: 'plan' \| 'backlog' \| 'workflows' \| 'repos'`, plus `workflowFile`, `repoId` selection) | One concern: board navigation (P146 R20). `Edit workflows ↗` must switch view and select |
| R22 | B: stage actions rendered this wave: `▶ Run` (agent: Run dialog; script: `StartRun` directly, as mockup), `Approve`, `Retry` (script stage: `RetryRun` each failed/stuck latest run), `Done ›` / `Finish ✓` (`StageDone`), `✓ merged` tag. **Not rendered** (P148 B): `Take over`, `▶ <Stage>`, `▶ Start`, Archive. When the first match is one of those, the cell shows the tag only | F11: buttons land with delivery. Take over / stage / Start need the Sessions tab terminal; Archive needs its dialog |
| R23 | B: `scriptStageAction` treats `stuck` as `failed` (`Retry`); step rows offer `Retry` on `failed` and `stuck` runs | Restart recovery (R9) and StopRun (R8) leave script and agent runs stuck; D7 "user acts with Retry". Mockup shows Retry on failed; stuck without Take over would be a dead end until P148 |
| R24 | B: Run dialog message = TS mirror of Go `composePrompt` default with per-run placeholders literal: `Task: <title>` · `- Jira: KEY URL` · `- Repo: {repo} · Branch: {branch} · Worktree: {worktree}` · `Step 1/N: <name>` · step prompt with `{task}`/`{jira}` filled and per-repo placeholders literal. The finish_step text shows **read-only under** the textarea (same frame). Unedited → `message: ''`; edited → the text. Branch-name inputs for not-created mine branches, placeholder = `feat/<slug(title)>` (Go `slug` mirrored) | Server substitutes per run and always appends the suffix (P146 R16); suffix inside the editable text would duplicate it. No "create a branch" lines: the app creates branches before Claude runs (P146 R14) |
| R25 | B: Workflows page Import YAML = typed absolute path field (`Import`), as the mockup's folder/repo path fields; `+ New` → `NewWorkflow({name: 'New workflow'})`, opens it in Form mode; Import opens YAML mode | No picker in the bridge; `ImportWorkflow` takes a path |
| R26 | B: Form edits save through `SaveWorkflow` (debounced 500 ms, flushed on mode switch / page leave); new stage / step ids `stage-N` / `step-N` (first free), never changed by renames. Per step `Allowed tools` input (comma or newline separated → `allowedTools`), help `Passed as --allowedTools; deny rules still win.` F6 refusal shown inline with a `Switch to YAML` link | D6 field must be editable without YAML; ids are run keys |
| R27 | B: YAML mode: `useDebounceFn` 300 ms → `ValidateWorkflowYaml` for the message (`✓ valid · the form and the plan use this file` / `✕ line N: … (the last valid version stays in use)`; `line 0` → `✕ <message> …`); `SaveWorkflowYaml` debounced 800 ms, flushed on blur / mode switch / page leave | SPEC2 §5.1.1; P145 §8 |
| R28 | B: Log / Output open inline under the run line (`AdeRunLog`: `ReadLog` pages + `onAdeTaskLog` append, mono, max-h 240 px, follows tail, `stderr` red; `truncated` → muted first line `… earlier output dropped`). Same component for the Worktree setup log | D3 (step rows); Sessions tab is P148 |
| R29 | B: live progress: `onAdeTaskRuns` merges `Run`s into the cached `Board` (`setQueryData`, by id, append unknown); the board push that follows reconciles. `now` ticks 1 s while any setup is `running` (`useIntervalFn` pause/resume), else 60 s | Snappy todo/state updates; `⚙ preparing 3m 40s` needs seconds |

## 2. Step 0 (serial, orchestrator lands on `v2.0` before creating worktrees)

One Sonnet implementer, one commit `feat(kira-space): ade SetTaskWorkflow restarts a task's workflow`:

- `internal/ade/taskworkflow.go`: `TaskBoard.SetTaskWorkflow(ctx, args) (adewire.Task, error)` per R2,
  under the task mutex (`taskMu`), workflow from `deps.Workflows.Get` (unknown → `E_INVALID`
  `workflow %q not found`), `stageSnapshot`, `notifyBoard`; clears `stepMsgs` entries with the task
  prefix.
- `storage/repos/adetask.go`: `ResetWorkflow(taskID, workflowID, stageID, stageJSON string) error` in one
  tx: `DELETE FROM ade_log_chunks/ade_logs WHERE kind='run' AND id IN (runs of task)`, `DELETE FROM
  ade_runs WHERE task_id = ?`, `UPDATE ade_tasks SET workflow_id, stage_id, current_stage_json`
  (`RequireOneRow`); `HasRunning(taskID) (bool, error)`.
- `bridge/adetask.go`: `SetTaskWorkflow` (`validateAdeTaskID`; `workflowId` `''` or ≤ 64 chars
  `[a-z0-9_-]`); `frontend/src/bridge/index.ts`: `adeTaskSetTaskWorkflow`.
- Test: one case in `runengine_test.go` (switch with finished runs → runs and logs gone, first stage;
  running run → `E_INVALID`; same id no-op).
- Checks: hook, `go build ./...`, `go test ./apps/kira-space/internal/ade/... ./apps/kira-space/internal/storage/...`,
  `bun run typecheck`. `B0` = this commit. Counts after: 39 methods.

## 3. Stream A: send-back, Take over, launches, archive, recovery

Uses `codegraph_explore` before Read/Grep for any symbol not pinned to a file:line here (CLAUDE.md).

### 3.1 Engine (`internal/ade`)

- `steps.go`: `chainRerun(steps []stepView) []rerun` (R4) and `sendBackTarget(def, steps) (idx int, ok bool)`
  (parses `back:<id>`, earlier step only). `nextAction` unchanged: a `back:` failure is decided once,
  when the outcome is recorded (below), so a capped `failed` run is never re-handled.
- `runs.go`:
  - Live-run registry: `map[runID]*liveRun{cancel context.CancelCauseFunc, done chan struct{}}` under
    `runMu`; `launch` creates the child ctx; `superviseAgent`/`superviseScript` read `context.Cause`
    after exit and map it per R7 before the quit check.
  - `advanceLocked`: refresh snapshot → `plan` → `chainRerun` (queue each) → `nextAction` (start / retry
    / approval).
  - `completeRun` and the R14 apply route a `failed` outcome of a `back:` step through `sendBack`
    before writing it.
  - Send-back per R3/R5: `countRuns(task, stage, step, branch, state)` repo read; fix run inserted via
    `queueRun` with `loops`, `note`, and a `resume` spec (T's session Claude id + fix prompt);
    `launch` keeps the note for a fix run; the new headless session row has `resumes` = that Claude id
    and `claude_session_id` = the same id.
  - `RetryRun` carries `loops` (R6). `StopRun` (R8). Setup failure / retry note rewrite (R10) in
    `setup.go` `runSetup` end and `RetrySetup`.
  - `recordFinish` checks the TUI-bound set (R14) and applies via `applyFinishLocked(runID, status,
    summary)` on a goroutine taking the task mutex.
- `recover.go`: `TaskBoard.Recover() error` per R9 (repo writes: `RecoverRunning(now)` returning the
  changed runs, `StopAllTaskRunning(now)` on `ade_sessions` with `task_id <> ''`, `FailRunningSetups(now)`;
  log line through `Logs.Append`; glob-delete `AgentDir/*.mcp.json`).
- `launches.go`: launch gate (R12), `TakeOver` (R13/R14), `LaunchStage` (R15), `StartBranch` (R16),
  `Send`/session lookups (R17 engine half), message composers `composeStageMessage`,
  `composeStartMessage` in `vars.go`. New deps on `TaskBoardDeps`: `Tracker *Tracker`,
  `CloseTerminal func(terminalID string) error`, `ClaudeBin` reused.
- `archive.go`: `ArchiveRisk`, `ArchiveTask` (R18), reusing `atRisk`, `toDirtyEntries`, entry
  `WorktreeStatus`/`WorktreeRemovePreflight`, the `worktreeRemove` op through `b.conn`; setup cancel
  needs a per-setup cancel (same registry shape as runs, keyed by branch id). Repo:
  `ArchiveTask(taskID, now)` (task + branches `archived_at`, plan row delete).
- `board_writes.go` `AddExistingBranch`: R19 after the attach, outside the repo mutex it already holds
  (call `ensureWorktree` after unlocking).
- `tracker.go` per R11 (`pendingIntent` v2 fields; `Compose` v2 insert through a new
  `AdeSessionsRepo.InsertTUI` validating the v2 CHECK; `OnStopped`).

### 3.2 `adeagent`

- `Spec.Resume string`: when set, argv uses `--resume <id>` instead of `--session-id <id>`; everything
  else per P146 R9 (prompt on stdin, flags, Setsid). Argv builder stays a pure func; its golden test now
  earns its keep (two shapes).
- `Server.Register` allowed again for a run id after release (TUI binding). Reply text unchanged.

### 3.3 Bridge and wiring

- `bridge/adetask.go`: `StopRun`, `TakeOver`, `LaunchStage`, `StartBranch`, `Send`, `FocusSession`,
  `ArchiveRisk`, `ArchiveTask` with validation (`validateAdeItemID` ids; `message` ≤
  `adeMaxMessageBytes`). `AdeTaskService` gains `Registry *terminal.Registry` and `FocusWindow
  func(string) bool` (func field, not bound) and an emit helper `AdeTaskOpenSession(e, windowKey,
  adewire.OpenSessionEvent)` (`EmitTo`, `adewire.ChannelOpenSession`).
- `main.go`: `TaskBoard.Recover()` before `Start()`; `Tracker` and `CloseTerminal` into
  `TaskBoardDeps`; `Tracker.OnChange` also broadcasts `AdeTaskSessionsChanged`; `Tracker.OnStopped` →
  `TaskBoard.OnTUIStopped`; `FocusWindow` assigned with the v1 one.
- `frontend/src/bridge/index.ts`: 8 `adeTask*` entries + `onAdeTaskOpenSession`. Totals: 47 methods,
  9 channels (contract §4/§5 complete).

### 3.4 Tests (Stream A)

- `steps_test.go`: `chainRerun` table (between steps, back step, missing run stops, approval ignored,
  round from loops), `nextAction` idles on a capped `back:` failure.
- `tracker_test.go`: v2 compose inserts a task row with `--` before the message and extra args before
  it; resume of a stopped v2 row; `OnStopped` fires.
- `runengine_test.go` (fake claude: the test binary reads `--resume` and records it; scenarios by env):
  `back:impl` round trip (tests fails once → `back` + fix run `loops 1` resumed with the same Claude id
  and the fix prompt on stdin → chain reruns tests → done); 3-round cap → `failed` `(sent back 3 times)`;
  `ci back:impl` reruns `tests` between; `back` target `once` on another branch → R5 note; `needs_input`
  → stuck (P146 case kept); StopRun running and pending; Recover (seeded running run, running setup,
  running headless + TUI rows, stale config file); setup failure rewrites pending note; TakeOver:
  running without stop → `E_INVALID`, with stop → run `stuck` `taken over…`, TUI record shape, command,
  then a `finish_step done` over the run's MCP config (the test as the TUI) → run `done` and the next
  step starts; `LaunchStage` and `StartBranch` gates and default messages; `ArchiveRisk` dirty/unmerged;
  `ArchiveTask` blocked refusal, then removal + runs stopped + history entry; `AddExistingBranch` creates
  the worktree and setup for `mine`, none for `review`.
- Bounded waits, no sleeps as sync (P146 harness).

### 3.5 Commits (Stream A)

Each: pre-commit hook passes normally, `gofmt -l` empty, `go build ./...`, `go vet ./apps/kira-space/...`.
Never `--no-verify` to finish. Notes file written incrementally.

1. `feat(kira-space): ade per-run stop, StopRun and restart recovery` — R7-R10, `recover.go`, repo writes.
2. `feat(kira-space): ade send-back rounds with claude -p --resume` — R3-R6, `steps.go`, `adeagent` resume, `steps_test.go`.
3. `feat(kira-space): v2 TUI sessions in the ade tracker` — R11, `tracker.go`, `InsertTUI`, `tracker_test.go`.
4. `feat(kira-space): ade Take over, stage launch and single-branch Start` — R12-R17 engine half.
5. `feat(kira-space): ade task archive and worktree setup on add` — R18, R19.
6. `feat(kira-space): AdeTaskService P147 methods and open-session channel` — bridge, `main.go`, `index.ts`.
7. `test(kira-space): ade engine send-back, recovery, take over and archive` — `runengine_test.go`.
8. `docs(v2.0): P147 stream A notes` — `plans/P147-streamA-notes.md`.

### 3.6 Stream A end checks

`go test ./apps/kira-space/...` (gitsock rule §6.4), `go test -race
./apps/kira-space/internal/{ade,adeagent,adeflow}/...`, `bun run lint:go`, `bun run lint:dead`,
`go mod tidy` diff empty, `git diff B0 -- go.mod go.sum package.json bun.lock` empty.
**Real `claude` smoke** (skip only if absent/unauthenticated, say so): scratch Go test on the engine
harness with `ClaudeBin=claude` (deleted after), two-step agent stage `impl` → `tests` (`back:impl`,
`allowed_tools: ["Write", "Bash(touch *)"]`): tests prompt `If the file .ade-fixed is missing in the
current directory, call finish_step with status "failed" and summary "fixed marker missing". Otherwise
call it with status "done".`; impl prompt `If this message mentions "fixed marker missing", create an
empty file .ade-fixed in the current directory. Then call finish_step with status "done".`. Expect
tests `back` → impl fix run `loops 1` on the **same** Claude session id → tests attempt 2 `done`.
Record ids and states in the A notes.

## 4. Stream B: Workflows page, Repos page, run UI, setup UI

Imports only `ade/v2/wire.ts` (rule 5), `ade/v2/board/*`, shared stores/components. Consumes only:
P144-P146 methods already in `index.ts`, step 0's `adeTaskSetTaskWorkflow`, `codeWorkspaceImportRepo`,
channels `onAdeTaskBoard`, `onAdeTaskWorkflows`, `onAdeTaskRepos`, `onAdeTaskRuns`, `onAdeTaskLog`.
Library use: Tailwind utilities (no scoped `<style>`), shadcn-vue (Dialog, Input, Textarea, Switch,
NativeSelect, ToggleGroup, Tooltip, Badge, Field), VueUse (`useDebounceFn`, `useClipboard`,
`useIntervalFn`, `onKeyStroke`), Pinia (`adeBoardUi`), TanStack Query. No new package, no new primitive.
Uses `codegraph_explore` before Read/Grep for any symbol not pinned here (CLAUDE.md).

### 4.1 Data and state

- `ade/v2/queries.ts`: `useWorkflowYaml(fileName)`; mutations `useSetTaskWorkflow`, `useStartRun`,
  `useApprove`, `useRetryRun`, `useStageDone`, `useRetrySetup`, `useSaveWorkflow`, `useSaveWorkflowYaml`,
  `useImportWorkflow`, `useNewWorkflow`, `useUpdateRepo`, `useAddFolder`, `useSetFolderWatch`,
  `useRemoveFolder`, `useImportRepo` (`codeWorkspaceImportRepo` then invalidate repos and
  `hydrateCodeRepos`); `workflowsKey` exported.
- `ade/queries.ts` `installAdeSignals`: `onAdeTaskWorkflows` → invalidate workflows (+ open YAML query);
  `onAdeTaskRuns` → R29 merge.
- `adeBoardUi`: R21 view union, `workflowFile`, `repoId`, `openWorkflow(file)`.
- `board/runMessage.ts` (pure): R24 composer, `FINISH_STEP_SUFFIX` (SPEC2 §5.1.2 verbatim),
  `branchSlug` (Go `slug`: lowercase `[a-z0-9-]`, collapsed, ≤ 40, `task` fallback).
- `board/actions.ts`: R23; `board/workflowForm.ts` (pure): form ↔ `Workflow` helpers (next free
  ids, move up/down, kind switch defaults as mockup: script `runsOn each repo`, `onFailure stop`,
  `timeout 10m`; agent step `each repo`, `auto`, `stop`, `1h`; `back:` options = earlier steps).

### 4.2 Shell

Tab bar right side after `+ Add task`: `Workflows` · `Repos` (plain text tabs, same TabsTrigger style),
switching `ui.view`. `Needs you` stays P148.

### 4.3 Workflows page (`ade/v2/workflows/*`, SPEC2 §5.1, §5.1.1, §5.1.2)

- Left column: header `Workflows` · `Import YAML` · `+ New`; rows `name` · stages `Spec › Implement ›
  Review › Release` (truncate) · `used by N`; a file whose current text is invalid shows a red `✕`
  tip with its error; explanation paragraph (mockup text verbatim). Import: R25 path row
  (`~/…/workflow.yaml`, Enter / `Import`; error inline).
- Empty state (no workflow file): one muted line `No workflows yet. Workflows are YAML files in
  <dir>.` with `Import YAML` and `+ New` (D2).
- Editor header: `Form | YAML` (ToggleGroup) · file path (mono, truncates, tooltip) · `Copy YAML`
  (`useClipboard` on `WorkflowYaml.yaml`, label `Copied` 1.5 s).
- Form (R26): Name + `Prompt variables: {task} {jira} {repo} {branch} {worktree}`; stage cards `n.` ·
  kind badge (`user` blue / `agent` amber / `script` green) · name · type NativeSelect (`user`,
  `agent (background)`, `script`) · Task status NativeSelect (4 values) · ↑ ↓ ✕. User: switch `Opens an
  interactive Claude Code session` + `Session prompt`. Script: `Command` textarea + help, `Runs on`
  (`once`, `each repo`, `only <nick>` per repo), `On failure` (`stop`, `retry 1`, `retry 2`), `Timeout`.
  Agent: step cards `2.1` · name · ↑ ↓ ✕; `Runs on`, `Before it` (`start automatically` | `wait for my
  approval`), `On failure` (+ `↩ send back to <earlier step>`), `Timeout`, `Allowed tools`, `Prompt`,
  note `+ finish_step instruction is added to this prompt automatically (hover to read it)` (full
  text tooltip; mentions script values are shell-quoted when needed, P146 carry-forward). `+ Add step`,
  `+ Add stage`. A workflow with a broken file opens in YAML mode.
- YAML (R27): mono Textarea, message line under it.

### 4.4 Repos page (`ade/v2/repos/*`, SPEC2 §6.3)

- Left: `Folders` + `Every git repo inside is imported.`; rows `path · N repos · watch switch · ✕`
  (`SetFolderWatch`, `RemoveFolder`); path field + `+ Add folder` (`AddFolder`, result `imported N`
  inline). `Repos`: rows nickname chip (repo color) / full name (mono, truncates) / `3 envs · 1
  integration branches`; path field + `+ Add repo` (`useImportRepo`).
- Right (selected repo): `Nickname` (+ help), `Repo`, `Path`, `Source` (`imported from <folder>` /
  `added individually` · `used by tasks on the plan` / `not on the plan`); `Prepare worktree` script
  textarea + `Timeout`; `Integration branches` (comma separated); `Environments` rows name · script · ✕,
  `+ Add environment`. Each field commits on blur / Enter through `UpdateRepo` with only that leaf set;
  error inline under the field.

### 4.5 Plan and panel run UI

- Task cell (`AdeActionCell`): tag + the R22 action button (tone from `TaskAction.tone`); `▶ Run`
  on an agent stage opens the Run dialog. Panel task header shows the same action.
- Run dialog (`ade/v2/run/AdeRunDialog.vue`, R24): title `Run <Stage> in the background`; branch name
  per not-created mine branch (repo chip + input); editable message + `Reset`; read-only suffix block;
  `Run in background` → `StartRun`; error inline; Esc / Cancel.
- Workflow block (`ade/v2/panel/AdeWorkflowBlock.vue`, Task tab, after Estimate; hidden for review and
  parked): `Workflow` NativeSelect (valid workflows; `Pick a workflow…` placeholder when none) →
  `SetTaskWorkflow` (error inline), `Edit workflows ↗` → `openWorkflow`. One block per stage (D11):
  `done | now | next` chip · current block's action button (R22) · name · `2/5` (agent) · mode text
  (`user · interactive Claude Code` / `agent · background claude -p` / `script` / `user`); current block
  amber outline. Agent and script blocks list steps: state box · status text (`done | running | stuck ·
  needs you | failed | pending | waiting for approval`) · `n.` · name · scope (script: command, mono) ·
  `needs approval` · `↩ on failure: back to <name>` / `on failure: retry N`; `Approve` on the gated step.
  Run lines under a started step (mockup `hasRuns` rule): glyph (`✓ ● ↩ ! ✕ ○`) · repo chip · mini bar ·
  `4/10` / `done` / `sent back` / state · `Log` (agent runs that started) / `Output` (script runs) /
  `Retry` (failed, stuck; R23) · note (`fix round n of 3` when loops and no note). Log / Output: R28.
- Release block: stage id `release`, current or done: per mine created branch `repo chip · name ·
  main ✓/— chip · merged-into chips` (click → branch mode).
- Live progress (R29): card segments / label / percent and branch line 2 update from pushes.

### 4.6 Worktree setup UI (SPEC2 §6.1)

- Branch row: `⚙ preparing 3m 40s` (blue, no action) and `✕ setup failed` + `See error` (selects
  the branch, Details tab, scrolls to Worktree setup).
- Branch panel: header work status chip `preparing` / `setup failed`; header action `Retry setup` when
  failed (`RetrySetup`). Details → `Worktree setup` block after PR row: `status chip (preparing | ready |
  failed) · [Retry setup] · <duration> · prepare-worktree script of <repo>`; log (R28) for running and
  failed; hidden when ready.

### 4.7 Mock runtime and specs (`apps/kira-space/tests/ui/`)

- `support/mockRuntime.ts`/`ipcChannels.ts`: FQNs for every method above (`AdeTaskService.*`,
  `CodeWorkspaceService.ImportRepo`); workflows default from `fixtures/ade-v2/workflows.json`,
  YAML from `workflow-yaml.json`, validation from `workflow-validation.json`, repos from `repos.json`,
  log page from `log-page.json`; helpers to emit `runs` / `log` events.
- `ade-v2-workflows.spec.ts`: empty state; list facts; select → form fields; edit name → one debounced
  `SaveWorkflow` with ids unchanged; add step + back option; Allowed tools → `allowedTools`; F6 error
  text; YAML mode valid / invalid messages and `SaveWorkflowYaml`; Copy YAML; Import path → arg; `+ New`.
- `ade-v2-repos.spec.ts`: folder add / watch / remove args; repo select; nickname / prepare / timeout
  / targets / env edits → `UpdateRepo` patches with one leaf; `+ Add repo` → `ImportRepo` path.
- `ade-v2-run.spec.ts`: workflow select → `SetTaskWorkflow`; `▶ Run` dialog default text, suffix
  read-only, branch names → `StartRun` args (`message ''` unedited, text when edited); emitted runs
  event updates percent and step lines; `Approve`, `Retry` (failed and stuck), `Done ›`, `Finish ✓`
  args; send-back lines (`↩ sent back`, `· fix 1`, note); Log opens with page + appended chunk; script
  Output; Release block; no `Take over` / `▶ Start` / Archive buttons (R22).
- `ade-v2-plan.spec.ts` / `ade-v2-panel.spec.ts` (extend): preparing tag ticks; `See error` selects the
  branch with the log; `Retry setup` arg.
- Unit: extend `ade-v2-board-parity.spec.ts` for R23's row only.

### 4.8 Commits (Stream B)

Each: pre-commit hook passes normally; `bun run typecheck`; touched specs run.

1. `feat(kira-space): ade v2 workflows page list, YAML mode and import` (+ shell tabs, store views).
2. `feat(kira-space): ade v2 workflow form editor`.
3. `feat(kira-space): ade v2 repos page`.
4. `feat(kira-space): ade v2 panel workflow block, run lines and logs` (+ workflow select, Release).
5. `feat(kira-space): ade v2 run dialog and stage actions` (+ live runs merge, R23).
6. `feat(kira-space): ade v2 worktree setup UI`.
7. `test(kira-space): ade v2 workflows, repos and run UI specs`.
8. `fix(kira-space): align ade v2 workflows, repos and run UI with the mockup`.
9. `docs(v2.0): P147 stream B notes` — `plans/P147-streamB-notes.md` (commits, mockup verdict, deviations).

### 4.9 Stream B end checks

`bun run test:unit`, `bun run lint:all`, `bun run test:ui:space` (webkit + `libavif16` per
`DEV_ENVIRONMENT.md`), `bun run lint:dead`, `scripts/check-ade-colours.sh`, mockup comparison (§6.3).

## 5. Streams verdict, ownership, worktrees

**Split holds** after step 0. Zero file overlap; no ordering dependency:

- B calls only methods and channels already in `index.ts` at `B0` (P144-P146 + step 0) and
  `codeWorkspaceImportRepo`. A's 8 new methods and `onAdeTaskOpenSession` have no B caller until P148.
- A's engine changes (send-back, recovery, notes, add-existing setup) only change run / setup data B
  renders through the frozen wire; B's mock specs do not depend on them.
- A never touches `frontend/src/ade/**`, `tests/{ui,unit,visual}`, `knip.json`; B never touches Go,
  `index.ts`, `main.go`, `go.mod`.
- No wire change. A stream needing one stops (preplan §3 rule 1).

| Path | Step 0 | A | B | Closing |
|---|---|---|---|---|
| `internal/ade/taskworkflow.go`, `repos/adetask.go` (`ResetWorkflow`, `HasRunning`), `bridge/adetask.go` + `index.ts` (`SetTaskWorkflow` only), its `runengine_test.go` case | ✓ | | | |
| `apps/kira-space/internal/**` except `internal/gitsock/**` (incl. `ade`, `adeagent`, `bridge`, `storage`) | | ✓ | | |
| `apps/kira-space/main.go`, `frontend/src/bridge/index.ts`, `go.mod`/`go.sum` (expected unchanged) | | ✓ | | |
| `docs/v2.0/plans/P147-streamA-notes.md` | | ✓ | | |
| `apps/kira-space/frontend/src/ade/**` except `ade/wire.ts`, `ade/v2/wire.ts` | | | ✓ | |
| `knip.json`, `scripts/check-ade-colours.sh`, `packages/theme/src/components/ui/**` (none expected) | | | ✓ | |
| `apps/kira-space/tests/ui/**`, `tests/unit/ade-*` | | | ✓ | |
| `docs/v2.0/plans/P147-streamB-notes.md` | | | ✓ | |
| `docs/v2.0/SPEC.md`, preplan, this plan's `## Result`, `docs/ARCHITECTURE.md` notes | | | | ✓ |

**Untouchable by A and B:** `apps/kira-space/internal/gitsock/**` and its tests (P152);
`scripts/mutation/**`, `tools/mutation/**` (P151); `ade/wire.ts` (v1), `ade/v2/wire.ts`,
`internal/bridge/adewire/**`, `tests/fixtures/ade-v2/**`, `packages/shared/**`, `main.ts`, `state/**`,
`workbench/**`, `package.json`, `bun.lock`. A stream needing any of these stops and reports.

Run from `/home/user/kira-studio`, base `B0` (after step 0):

```sh
git worktree add -b v2.0-p147-a /home/user/kira-studio-p147-a B0
git worktree add -b v2.0-p147-b /home/user/kira-studio-p147-b B0
sh scripts/prepare-dev-environment.sh   # inside each worktree
```

Check each worktree is at `B0`. Orchestrator lands nothing on `v2.0` while A and B run except a
rule-1 amendment and P152's own landing (gitsock only). A stopped stream resumes from its last
commit, never from scratch.

Landing after both pass their end checks: `merge --ff-only v2.0-p147-a` (rebase first if P152
landed); in B's worktree `git rebase v2.0` (a real conflict = wrong ownership: stop, report);
`merge --ff-only v2.0-p147-b`; wave-end suite (§6.4); closing step (§7); remove worktrees, delete
branches, `git push origin v2.0`.

## 6. Acceptance

### 6.1 Step 0 and Stream A (checked by the orchestrator)

- `grep -c` bound `AdeTaskService` methods = `adeTask*` entries in `index.ts` = 47; `onAdeTaskOpenSession`
  present; `kira:adetask:open-session` emitted from `FocusSession` (grep the call).
- Real callers: `chainRerun` and the send-back path from `advanceLocked`; `Spec.Resume` set from the
  fix-run path (grep); `Recover()` called in `main.go` before `Start()`; `InsertTUI` from
  `Tracker.Compose`; `CloseTerminal` from `ArchiveTask`; `ensureWorktree` from `AddExistingBranch`.
- argv: `--resume` replaces `--session-id` only in resume shape; token never on argv; ` -- ` precedes the
  TUI message (tests).
- Engine tests of §3.4 pass; real-claude send-back smoke recorded (§3.6).
- Contract untouched since `B0`: `git diff B0 -- apps/kira-space/frontend/src/ade/v2/wire.ts
  apps/kira-space/internal/bridge/adewire apps/kira-space/tests/fixtures/ade-v2 packages/shared` empty.
- No migration file added (`ls internal/storage/migrations` unchanged since `B0`).

### 6.2 Stream B

- No file under `ade/v2/` imports `ade/wire.ts`; no scoped `<style>`; no `defineComponent`; one store
  per concern (grep).
- Real callers in `frontend/src/ade/v2/**` for `adeTaskSetTaskWorkflow`, `adeTaskStartRun`,
  `adeTaskApprove`, `adeTaskRetryRun`, `adeTaskStageDone`, `adeTaskRetrySetup`, `adeTaskReadLog`,
  `onAdeTaskRuns`, `onAdeTaskLog`, `adeTaskValidateWorkflowYaml`, `adeTaskSaveWorkflowYaml`,
  `adeTaskSaveWorkflow`, `adeTaskImportWorkflow`, `adeTaskNewWorkflow`, `adeTaskUpdateRepo`,
  `adeTaskAddFolder`, `adeTaskSetFolderWatch`, `adeTaskRemoveFolder`, `codeWorkspaceImportRepo` (grep each).
- No `Take over`, `▶ Start`, Archive or `▶ <Stage>` button rendered (grep + spec).
- UI specs of §4.7 pass; `check-ade-colours.sh` passes.

### 6.3 Mockup comparison (B end, again at wave end)

Throwaway Playwright Chromium script (scratchpad), 1440×900: mockup `pipelines` (Form and YAML),
`repos`, `plan` with `T_bill` selected (Task tab Workflow block, per-repo run lines), `T_push` (send-back
lines), Run dialog, branch `b_searchui` Details (Worktree setup failed with log), against the built test
app on the mock runtime with fixtures. Read both images; list differences. Accepted: no `Take over`,
`▶ <Stage>`, `▶ Start`, Archive (R22), no Sessions tab / Needs you (P148), run dialog without "create a
branch" lines and with the suffix read-only (R24), Import as a path field (R25), `Allowed tools` field
(R26), app fonts, fixture-vs-mockup data. Anything else (geometry, field order, chips, tones, block
outline, step line layout) is a defect fixed before landing. Verdict + image paths in the B notes.

### 6.4 Wave end (landed tip)

- `go build ./...`, `go test ./apps/kira-space/...`, `go test -race
  ./apps/kira-space/internal/{ade,adeagent,adeflow}/...`, `bun run test:unit`, `bun run lint:all`,
  `bun run test:ui:space`. Failures fixed in follow-up commits on `v2.0`.
- **gitsock (P152).** Never skip, `-run`-exclude or retry-until-green. On failure: signature must match
  P152's (`E_INTERNAL: read |0: file already closed` or the `file.read` / `review.comment.add` error
  responses, a different test per run, passes alone with `-run '^Name$' -count=5`); run
  `go test -count=3 ./apps/kira-space/internal/gitsock/...` with an isolated `KIRA_SPACE_HOME` on the tip
  and on `B0`, record both. Same signature, comparable rate → record under P152. Else → P147 regression:
  root-cause and fix. If P152 has landed, gitsock must be green.
- **Live run** (server-tag recipe, `DEV_ENVIRONMENT.md` P126; local `Locate` patch reverted after; real
  `claude`): temp home, two scratch repos (`api` with prepare script `sleep 5; echo prepared`, `web`);
  Playwright Chromium on `/?window=main`:
  1. Repos page: nickname `api` → `API`; card chips show `API`.
  2. Workflows page: empty state; Import YAML by path of a scratch `smoke.yaml` (user stage `plan`
     `session: false`; agent stage `impl` with steps `impl` and `tests` (`back:impl`) as §3.6; script
     stage `release` `echo {branch}`); YAML mode shows `✓ valid`; a broken edit shows `✕ line N` and the
     list keeps the last valid stages; fix it back.
  3. Add a task with both repos; panel Workflow select `smoke`; `Done ›`; `▶ Run` dialog, default text,
     `Run in background`; `api` shows `⚙ preparing Ns` then runs; `tests` on `api` shows `↩ sent back`,
     `impl` `· fix 1`, then `tests` done; Log shows `▸` / `result:` lines; `Done ›`; script `▶ Run`;
     Output shows the branch; `Finish ✓` → task tag `✓ merged` (workflow finished), no Archive button
     (R22).
  4. Restart: start the stage again on a second task with a `sleep 120` script, kill the server, restart:
     run `stuck` `interrupted by restart`, `Retry` reruns it.
  Screens in scratchpad; result in the plan `## Result`.

## 7. Closing step (serial subagent, after landing)

- `## Result` here (commits, counts, gitsock record, real-claude smoke, live run, mockup verdict,
  licenses: none new, deviations); `## P147 result` in `SPEC.md` and row status.
- `SPEC.md` P148 row and preplan §4 P148 B / §5: Take over UI uses `TakeOver` (R13, R14: a taken-over
  stuck/failed run can be finished from the TUI); merge / rebase / queue dialogs launch through
  `StartBranch` or `Send` (R16, R17); `▶ <Stage>` through `LaunchStage` (R15); Archive dialog shows
  `ArchiveRisk` then `ArchiveTask` (R18, no discard flag).
- Preplan §5 matrix: §6.1 "Add existing branch" trigger → P147 A (R19); §5 workflow switch → P147
  step 0 (R1).
- `knip.json`: dry-run dropping the `ade/v2/wire.ts` / `ade/v2/board/*.ts` entries; drop only if
  `bun run lint:dead` stays clean (expected not before P148).
- `docs/ARCHITECTURE.md` short notes under "ADE v2 run engine": send-back rounds (resume keeps the
  Claude session id, loops as round epoch), per-run stop causes, restart recovery, TUI `--` message
  rule, finish_step from a taken-over TUI, archive. Known open items: keep the todo item; add none
  unless the live run finds one. Full ade rewrite stays P149.
- Remove worktrees; push.

## 8. Carry-forward

- P148 A: nothing new from P147 (no migration taken; v1 `Tracker` fields stay until v1 rows drop;
  `Tracker.Recover` v1 path can go with v1 tables).
- P148 B: Sessions tab mounts the terminal for every `Launch` (`TerminalHostView` with `command`/`cwd`,
  terminal id from `Launch`); Take over everywhere with the D3 confirm → `TakeOver{stopIfRunning:
  true}`; `▶ <Stage>` dialog → `LaunchStage` (default text mirrors R15); `▶ Start` → `StartBranch`
  (R16); merge / rebase / queue dialogs: running session → `Send`, else `StartBranch` with the dialog
  text; `RecordMerge` on finish (D14); Archive dialog → `ArchiveRisk` then `ArchiveTask`; Needs you
  `Open` → `FocusSession` + `onAdeTaskOpenSession`; render the R22 actions this wave left out;
  `buildCard` gets real sessions (`Sessions()` + `onAdeTaskSessions`).
- P150: amends `ArchiveTask` (unpin, purge, review windows) per its own plan.
- Open for the user (unchanged): todo progress unobservable in `claude -p` 2.1.289.
