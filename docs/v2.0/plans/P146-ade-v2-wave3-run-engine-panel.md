# P146 plan: ADE v2 wave 3 — worktree setup and headless run engine ‖ panel, Notes, Backlog, merged/deployed UI

Serial step 0, then two streams in one `P`. Stream A (Go) and Stream B (frontend) in separate
worktrees off one base. Implements preplan §4 P146, the P143 contract's P146 rows, and P145 §8
carry-forward. Nothing from P147+.

Inputs: `plans/P143-ade-v2-preplan.md` (§3 rules, §4 P146, §5 matrix, §6 D1-D16, O3-O5),
`plans/P143-wire-contract.md` (frozen; §4 P146 methods, §5 channels, W16), `plans/P145-*` (plan §8,
notes), `design/ade-v2/SPEC2.md`, `design/ade-v2/mockup.html`, `design/ade-v2/workflows/*.yaml`,
`SPEC.md` P146 row and P145 result. Base `B0`: `v2.0` tip after step 0 (§3) lands.

**Status: proposed.** Open items resolved below with the recommended option (O3, O4, O5). One new
scope move (M1, §1), same shape as P145's user-approved U1 (a).

## 0. Findings from the current tree

- `ade_sessions` (0004): `code_repo_id NOT NULL`, CHECK `(branch = '') <> (new_work_id = '')`, index
  `ade_sessions_repo`. `AdeSessionsRepo.List`/`ListByRepo`/`StopAllRunning` read every row
  (`storage/repos/adesessions.go`). Callers: `Tracker.List`/`ListByRepo`/`Recover`, `main.go`
  `adeSessionsFor`, bridge v1 `Sessions`. No table references `ade_sessions`, so a rebuild needs no
  FK juggling. Migrations run in one tx with `_foreign_keys=1` (`internal/sqlitex/sqlitex.go:49,167`).
- 0008 has `ade_runs` (full `Run` columns) and `ade_worktree_setup` (no log). `AdeTaskRepo` reads runs
  (`RunsByTask`) and setups; it has no run/setup writes and no `SetBranchName`. No log storage exists.
- `TaskBoard` (`ade/board.go`) owns one `gitsession.Conn`, per-repo mutexes, `openRepo`,
  `notifyBoard`. Worktree add runs through `entry.RunOp(ctx, conn.ID, label, OpRequest{Kind:
  "worktreeAdd", Mode, Path, Branch, StartPoint})` (`gitsession/ops.go:1158`,
  `prepareWorktreeAdd` re-runs preflight). Board reports `worktreeBasePath = <home>/wt`.
- Prepare script: leaf `GitRepoSettings.WorktreePrepareScript` + `WorktreePrepareTimeout`
  (P145 F2). `gitsession.RunPrepare` is git-ui's runner (sha-confirm gate, `NotAWorktree`), not
  reusable as-is for ade; its pieces are: `gitprepare.ResolveShell`, `BuildEnv`, `NewOSRunner`,
  `Spec.Timeout`/`OnBatch`, and unexported `prepareTimeout` (`worktree.go:546`). `deploy.go`
  `runEnvScript` already runs scripts through `gitprepare` from `ade`.
- `Tracker` (`ade/tracker.go`, `command.go`): TUI only, `TrackerDeps.ClaudeBin` test seam,
  `quotePOSIX`. Stays v1 until P147.
- MCP precedent: Studio `internal/dbmcp` (`mcp.NewServer`, `mcp.AddTool`,
  `NewStreamableHTTPHandler{Stateless}`, `auth.RequireBearerToken`, `http.NewCrossOriginProtection`).
  Its `mcpauth` lives under `apps/kira-studio/internal/` — Go's `internal` rule blocks Space from
  importing it. Root `internal/tokenauth` (`Mint`, `Hash`, `Verify`) is importable.
  `go-sdk v1.8.0` is already a direct dependency; `auth.TokenInfo` has `UserID` (carries the run id).
- `internal/procgroup.GracefulCancel` + `Setsid` is the kill pattern (gitprepare, gitclient).
- adeflow: step `timeout` is required (≤ 24h), `back:` refused on script stages, `only <repo>`
  syntax-only (`adeflow/parse.go`).
- Frontend board logic already fixes the step rules the backend must match
  (`ade/v2/board/progress.ts`): targets = task's `mine` branches in task order; `once` = first;
  `only <nick>` by repo nickname; latest attempt per (stage, step, branch); step state =
  worst-of (stuck > failed > running/back > pending; done when all done); `approval` only when
  pending, `before: approval`, not the first step, previous step done. `labels.ts`
  `integrationChips`/`deploymentChips`/`branchLine2` exist; integration tip ends
  `Right-click to re-merge.`
- Settings leaf (W16): `model.AdeSettings` (`storage/model/settings.go:57`), `repos/settings.go`
  `readAde`/upsert, zod `adeSettingsSchema` (`frontend/src/state/settingsDomain.ts:89`). Settings UI:
  `workbench/settings/AdvancedPane.vue` (draft-based dialog).
- Frontend: `ade/v2/shell/AdeShell.vue` (Plan tab only), `ade/v2/state/adeBoardUi.ts`
  (`selectedTaskId`), `ade/queries.ts` `installAdeSignals`. shadcn primitives present: tabs, popover,
  tooltip, badge, dialog, input, textarea, switch, native-select, dropdown-menu, field, resizable.
  No `context-menu`, no `select`.
- `knip.json` ignores six `@tiptap/*` deps "until P146's Notes tab"; `package.json` still has them.
  P145 B deleted (restore from `13e99974`): `AdeNotesEditor.vue`, `notesExtensions.ts`,
  `AdePanelResizeHandle.vue`, `AdeChangesTab.vue`, `AdeEstimateField.vue`,
  `tests/unit/ade-notes-markdown.spec.ts`. `AdePanelResizeHandle` documents a real requirement
  against reka `ResizablePanelGroup` (nested group hung the render process, P132 Part 1 §0.1).

### 0.1 Real `claude -p` behavior (verified, CLI 2.1.289 in this sandbox, scratch repo, `--model haiku`)

- `--help` lists `--allowedTools <tools...>` (variadic), `--setting-sources <user,project,local>`,
  `--mcp-config <configs...>` (variadic), `--session-id <uuid>`, `--output-format stream-json`.
  stream-json in `-p` needs `--verbose`.
- `--session-id <uuid>` is honored (`system/init.session_id` = the uuid). Without it, a child
  started from inside a Claude session inherits the parent's id, so always pass it.
- Un-allowed tools are denied in `-p`: a `system/permission_denied` event, an error `tool_result`,
  and `result.permission_denials[]`. `--allowedTools "Bash(touch *)"` allows exactly that.
- **`--setting-sources` effect in a fresh (untrusted) worktree:** project `permissions.allow` is
  ignored (debug: `Ignoring 1 permissions.allow entry from .claude/settings.json: this workspace has
  not been trusted`), but project `permissions.deny` is honored: with `user,project,local` a repo
  deny rule beat `--allowedTools`; with `user` the same command ran.
- Todo progress: this CLI has no `TodoWrite` tool. It uses `TaskCreate {subject, description}`
  (result `Task #N created successfully: …`) and `TaskUpdate {taskId, status: "completed"}`; these
  ran without being in `--allowedTools`. Older CLIs emit `TodoWrite {todos:[{content,status}]}`.
- Not verified here (no claim): MCP tool permission in `-p` — the runner always allows
  `mcp__kira-ade__finish_step` explicitly (R9), so the outcome does not depend on it.

## 1. Decisions

Restated (preplan §6), implemented here: D3 (run and setup logs persisted, readable live through
`ReadLog`/`adeTaskLog` without Take over), D6 (no default permission mode; `--allowedTools` from the
step; deny wins; `--setting-sources` from the setting), D8 (no cap, queue or setting), D9 (Jira
display only), D10 (status derived, read-only in the panel), D12 (`once` in first branch's
worktree, created first), D13 (script stages never send back), D15, D16 (estimate extend-only).

| # | Decision | Why |
|---|---|---|
| R1 | **Step 0 (serial, before `B0`)**: settings leaf `ade.headlessSettingSources: 'user' \| 'all'` (Go model, `repos/settings.go` read/upsert/validate, zod) with default `all`; `StartRunArgs.branchNames` comment changes from `'' = Claude picks` to `'' = derived from the task title` in `adewire/wire.go` and `ade/v2/wire.ts` (comment only, no key/type/value-set change); P143 contract §12 amendment line | B's settings switch reads the leaf A would otherwise add: an ordering dependency. Headless runs need the worktree before Claude starts, so the app names the branch (R14) |
| R2 | **O5: default `all`** (`--setting-sources user,project,local`); `user` = `--setting-sources user` | §0.1: in a fresh worktree, repo allow rules are ignored anyway, repo deny rules are honored only with `project`. `all` keeps D6's "deny rules still win"; `user` is the opt-out for repo hooks/config |
| R3 | **O3:** parked toggled by a `Not merging` switch in the Task tab (`UpdateTask kind task\|parked`); hidden for review tasks. A review task holds any number of branches: no `+ Add repo…`, `+ Add branch` allowed | Wire already permissive (W17); mockup offers no toggle, so the smallest surface in the panel that owns the task fields |
| R4 | **O4:** `{jira}` = key only | D9, preplan assumption |
| R5 | **M1: merge dialog, right-click fix menu, Merge / Re-merge buttons move to P148 B**, next to the Rebase / Queue after dialogs (U1 (a)). P146 B shows Merged into / Deployed to rows and line-2 chips with tooltips, no action. `labels.ts` integration tip drops `Right-click to re-merge.` until P148 | Merge is a Claude dialog (SPEC2 §6). Delivery (`StartBranch`/`Send`) lands P147 A, its terminal (Sessions tab) P148 B. The fix menu's other entries (Rebase onto, Re-merge, Merge) need the same delivery; a menu with only Force push live is half-implemented. Closing step updates `SPEC.md` P146/P148 rows, preplan §4/§5 and P145 §8 (`RecordMerge` caller → P148 B) |
| R6 | Panel header actions this wave: task mode none (stage actions P147 B per P145 F11; Archive P148 B); branch mode Force push only. Branch Details `Worktree setup` block is P147 B (preplan) | Only actions whose delivery exists |
| R7 | Migration `0010_p146_ade_runs.sql` (§2.1): `ade_sessions` rebuild, `ade_logs` + `ade_log_chunks`, index on `ade_runs (state)` | Preplan; logs need a store (W10) |
| R8 | Logs in SQLite. Per log (run id or branch id) keep the **tail 2 MiB**; dropping head chunks sets `truncated`. One chunk ≤ 8 KiB (longer lines cut with `…`). Writes batched every 250 ms (`gitprepare` batch cadence); each batch also emits `adeTaskLog` | P143 §11 asks P146 to fix the cap. Failures sit at the end, so keep the tail |
| R9 | Headless spawn: `$SHELL -l -c 'exec <claude> -p --output-format stream-json --verbose --session-id <uuid> --mcp-config <file> --setting-sources <src> [--allowedTools <tool>…]'` (args `quotePOSIX`-ed), cwd = worktree, **prompt on stdin** (closed after write), Setsid + `procgroup.GracefulCancel`, timeout from the step. `--allowedTools` = step `allowed_tools` + `mcp__kira-ade__finish_step` (always). No `--permission-mode`, no `--strict-mcp-config` | §0.1. Login shell = same PATH as the TUI path. Variadic flags would swallow a positional prompt; stdin also keeps the prompt off argv |
| R10 | `finish_step` MCP server (`internal/adeagent`): one loopback listener on `127.0.0.1:0`, started on first run, stopped on `Close`. Bearer token per run (`tokenauth.Mint`, server-wide salt, map hash → run id; `TokenInfo.UserID` = run id). Config file `<KIRA_SPACE_HOME>/ade/runs/<runId>.mcp.json`, dir `0700`, file `0600`, deleted when the process exits; token forgotten then. Last call wins; outcome applied at process exit | Ephemeral port is safe here: config is written per run with the bound port (dbmcp F11's fixed-port concern is about a stale external registration). Token never on argv |
| R11 | Todo `[n, m]` from both `TodoWrite` (`completed` / total of `todos`) and `TaskCreate`/`TaskUpdate` (created − deleted; done = ids whose last status is `completed`) | §0.1: current CLI has no `TodoWrite` |
| R12 | Step machine (§2.5): `StartRun` starts the stage's first step whatever its `before`; later steps start on `auto` or wait for `Approve`. Failure rules: `stop` → failed; `retry N` → up to N automatic new attempts, then failed; `needs_input` → stuck; **`back:<step>` → failed with no send-back round this wave** (P147 A raises it to 3 rounds with `--resume`). No automatic stage advance: `StageDone` moves on | Matches `progress.ts`/`actions.ts` (Done › when all steps done). `back:` as "0 rounds" is the SPEC2 end state of an exhausted send-back, not a stub; no B caller can start runs before P147 |
| R13 | "Changes apply from next step on": before starting each next step, refresh the task's stage snapshot from the live workflow if that stage id still exists with the same kind; else keep the snapshot. Next step = first step in snapshot order not `done` | P145 §8 carry-forward; P143 W13 |
| R14 | Branch creation on `StartRun`: every not-created `mine` branch of the task gets `branchNames[id]` or, when `''`, `feat/<slug(task title)>` (lowercase, `[a-z0-9-]`, ≤ 40, `-2`… on collision with an existing ref). Worktree `<home>/wt/<code_repos.name>/<last segment>` (`-2`… if the path exists), `newBranch` from the branch's base (or main). A created branch without a worktree gets `existingBranch`. A branch already checked out somewhere (incl. the repo root) runs there, gate open, no setup row. No prepare script configured → setup row `ready`, exit 0, log line `no prepare script configured` | §9 path rule; SPEC2 §6.1 gate. Repo name, not nickname: nicknames change, paths must not |
| R15 | Variables `{task} {jira} {repo} {branch} {worktree}`: prompts get raw values; script commands get each value single-quoted (`quotePOSIX`). `{task}` = title, else Jira key, else first branch name, else `New task`; `{repo}` = nickname or name | Task titles and branch names in a shell command are an injection path. Mirrors `labels.ts taskTitle` (PR title step skipped: needs `gh`) |
| R16 | `StartRun.message` non-empty replaces the composed prompt of the first step for every run of that step, variables substituted per run; `''` → composed default (SPEC2 §9 "Start step" shape + step prompt). The `finish_step` suffix (SPEC2 §5.1.2, verbatim) is appended server-side to every agent prompt, always | P147 B's Run dialog sends the edited text; suffix "can't be removed" |
| R17 | `Run.sessionId` = `ade_sessions.id` (matches fixtures). Headless session `activity`: `working` while the process lives, `idle` after | Fixture `sessions.json` |
| R18 | App quit: `Close` kills live processes and setups, writes no terminal state; rows stay `running`. P147 A's restart recovery (D7) turns them `stuck` / `interrupted by restart` | D7 owns restart semantics; writing `failed` on quit would contradict it |
| R19 | Panel resize: restore `AdePanelResizeHandle.vue` (VueUse), width in `Settings.ade.panelWidth` (0 = half) | Named requirement in that file against nested reka `ResizablePanelGroup` |
| R20 | New UI selection/navigation state goes in `adeBoardUi` (`view: 'plan' \| 'backlog'`, `selectedBranchId`, last refresh summary per repo, in memory). Backlog selection stays component-local | One concern (board view state); `→ Plan as task` must switch view and select |

## 2. Stream A: run engine, setup gate, `finish_step`, migration 0010

### 2.1 Migration `0010_p146_ade_runs.sql`

Register `{Version: 10, Name: "p146_ade_runs", File: "0010_p146_ade_runs.sql"}`.

```sql
-- P146: ade_sessions gains task-level and headless rows; v1 rows copied (task_id = '').
CREATE TABLE ade_sessions_new (
  id TEXT PRIMARY KEY,
  code_repo_id TEXT REFERENCES code_repos (id) ON DELETE CASCADE,  -- NULL for task-level rows
  branch TEXT NOT NULL DEFAULT '', new_work_id TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'tui' CHECK (mode IN ('tui','headless')),
  task_id TEXT NOT NULL DEFAULT '', branch_id TEXT NOT NULL DEFAULT '',
  stage_id TEXT NOT NULL DEFAULT '', step_id TEXT NOT NULL DEFAULT '', run_id TEXT NOT NULL DEFAULT '',
  resumes TEXT NOT NULL DEFAULT '',
  claude_session_id TEXT NOT NULL, cwd TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','stopped')),
  terminal_id TEXT, started_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL,
  CHECK (
    (task_id = '' AND mode = 'tui' AND code_repo_id IS NOT NULL AND (branch = '') <> (new_work_id = ''))
    OR (task_id <> '' AND branch = '' AND new_work_id = '' AND (mode = 'tui' OR run_id <> ''))
  )
);
INSERT INTO ade_sessions_new (id, code_repo_id, branch, new_work_id, claude_session_id, cwd, state,
  terminal_id, started_at, last_active_at)
  SELECT id, code_repo_id, branch, new_work_id, claude_session_id, cwd, state, terminal_id,
    started_at, last_active_at FROM ade_sessions;
DROP TABLE ade_sessions;
ALTER TABLE ade_sessions_new RENAME TO ade_sessions;
CREATE INDEX ade_sessions_repo ON ade_sessions (code_repo_id);
CREATE INDEX ade_sessions_task ON ade_sessions (task_id);
-- run log (id = run id) and worktree setup log (id = branch id); tail kept, see truncated.
CREATE TABLE ade_logs (
  kind TEXT NOT NULL CHECK (kind IN ('run','setup')), id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
  next_seq INTEGER NOT NULL DEFAULT 1, bytes INTEGER NOT NULL DEFAULT 0,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
  PRIMARY KEY (kind, id)
);
CREATE TABLE ade_log_chunks (
  kind TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL,
  at INTEGER NOT NULL, stream TEXT NOT NULL CHECK (stream IN ('stdout','stderr','event')),
  text TEXT NOT NULL,
  PRIMARY KEY (kind, id, seq),
  FOREIGN KEY (kind, id) REFERENCES ade_logs (kind, id) ON DELETE CASCADE
);
CREATE INDEX ade_runs_state ON ade_runs (state);
```

Check the copy on a copy of a real v1 DB (acceptance §6.1). `LogPage.done` is derived (run or
setup no longer `running`), not stored.

### 2.2 Storage

- `model/adesession.go`: `AdeSession` gains `Mode, TaskID, BranchID, StageID, StepID, RunID,
  Resumes`; `Validate` per the CHECK (v1 rule when `TaskID == ""`). Consts `AdeSessionModeTUI|Headless`.
- `repos/adesessions.go`: select columns widened; `List`, `ListByRepo`, `StopAllRunning` gain
  `WHERE task_id = ''` (v1 only). New: `ListTask()` (v2 rows, newest active first),
  `InsertHeadless(rec)`, `MarkStopped` reused (`terminal_id` stays NULL for headless).
- `repos/adetask.go` writes: `SetBranchName(id, name)` (unique-name violation → sentinel
  `ErrBranchNameTaken`), `InsertRun`, `UpdateRun(id, patch)` (state, todo, note, summary, session,
  exit code, started/finished), `LatestRuns(taskID)`, `GetRun`, `UpsertSetup(row)`, `GetSetup`,
  `SetStage(taskID, stageID, stageJSON)`.
- `repos/adelogs.go` (`AdeLogsRepo`, registered in `repos.New`): `Reset(kind, id, taskID)` (delete
  chunks, zero counters), `Append(kind, id, chunks) ([]LogChunk with seq, error)` in one tx (assign
  seq from `next_seq`, add bytes, drop oldest chunks while `bytes > 2 MiB`, set `truncated`),
  `Page(kind, id, afterSeq, limit=500)`.
- `model/settings.go` / `repos/settings.go`: done in step 0.

### 2.3 Worktree setup and gate (`internal/ade/setup.go`)

- `ensureWorktree(ctx, task, branch) (path string, created bool, err)` per R14, under the repo mutex;
  `SetBranchName` before `RunOp` so the board shows the name; `RunOp` error → `E_INVALID` with
  git's message. Base for `newBranch`: stored `base`, else main short name.
- `startSetup(branch, path)`: `UpsertSetup{running}`, `Logs.Reset(setup)`, goroutine on
  `b.ctx`: script + timeout from `GitRepoSettings` (timeout parse falls back to
  `gitprepare.DefaultPrepareTimeout`; export `gitsession.ParsePrepareTimeout` from the existing
  `prepareTimeout` rather than copy it), `gitprepare` OS runner with `ResolveShell`/`BuildEnv`,
  `OnBatch` → log append. End: `ready` (exit 0) or `failed` (non-zero, timeout, cancel; last log
  line names it, e.g. `timed out after 15m`). Emits board; on `ready` calls `runs.onSetupReady(branchID)`.
- One setup per branch at a time (map guarded by `b.mu`). `RetrySetup(branchID)`: setup must be
  `failed` (else `E_INVALID`), reruns `startSetup`.
- Gate: `setupReady(branch, worktree)` = row `ready`, or no row and a worktree exists (R14).

### 2.4 Headless agent runner and `finish_step` (`internal/adeagent`, new leaf package)

No dependency on `ade`, `bridge` or storage.

- `stream.go`: `Parser` fed stdout lines; emits `LogLine{stream, text}` and `Todo{done, total}`
  changes. Mapping: `system/init` → `session <id>`; assistant `text` → text; `tool_use` →
  `▸ <Tool> <short input>` (Bash `command`, file tools `file_path`, else name); `tool_result` with
  `is_error` → `✕ <first line>`; `system/permission_denied` → `denied: <tool>`; `result` →
  `result: <subtype> · <num_turns> turns`. Unparseable line → raw `stdout`. Todo per R11.
  Reader: `bufio.Reader` lines up to 16 MiB (stream-json lines get large).
- `process.go`: `Spec{ClaudeBin, Dir, Prompt, SessionID, MCPConfigPath, SettingSources,
  AllowedTools, Timeout, Env}` → `Run(ctx, spec, onLine, onStderr) (Exit{Code, TimedOut,
  Cancelled}, error)` per R9. `ClaudeBin` defaults `claude` (test seam, as `TrackerDeps.ClaudeBin`).
  Argv builder is a pure func with a golden test only if it grows a branch beyond R9's list.
- `mcp.go`: `Server` per R10: `Start()`, `Register(runID) (configPath string, release func())`,
  `Close()`. Tool `finish_step` input `{status: "done"|"failed"|"needs_input", summary: string}`
  (jsonschema descriptions from SPEC2 §5.1.2); invalid status → tool error. Handler reads
  `req.Extra.TokenInfo.UserID`, calls `OnFinish(runID, status, summary)`, answers `Recorded.
  Stop now.` Loopback only, `Stateless: true`, `RequireBearerToken`, cross-origin protection,
  `ReadHeaderTimeout` (dbmcp `http.go` shape).
- `suffix.go`: `FinishStepSuffix` = SPEC2 §5.1.2 text verbatim.

### 2.5 Step machine (`internal/ade/runs.go`, `steps.go`, `vars.go`)

- `steps.go` (pure, unit-tested): `stepTargets(stage step, branches, repos) ([]branchID, error)`
  (same rule as `progress.ts`; `only <nick>` matches nickname, else name; unresolved → error naming
  the repo); `stepState(latest runs)` (worst-of); `nextAction(stage, latest runs, targets)` →
  one of `startStep(i)`, `awaitApproval(i)`, `retry(run)`, `idle`, `stageComplete`. Encodes R12.
- `vars.go`: `substitute(text, vars, quote bool)`, `composePrompt(task, step, branch, message)`
  (R15, R16; SPEC2 §9 "Start step" lines: `Task:`, `- Jira: KEY URL`, `- Repo: … · Branch: … ·
  Worktree: …`, `Step n/m: <name>`, prompt, suffix).
- `runs.go` on `TaskBoard` (new deps: `Logs`, `Sessions *repos.AdeSessionsRepo`, `Agent
  *adeagent.Server`, `ClaudeBin`, `HeadlessSettingSources func() string`, `OnRuns(event)`,
  `OnLog(event)`, `OnSessions()`):
  - `StartRun(args)`: task has a workflow; current stage is agent or script; every step's latest
    run absent (else `E_INVALID` `already started`); every step's targets resolve (whole stage,
    R12); `branchNames` keys are this task's not-created `mine` branches. Then `ensureWorktree` for
    every `mine` branch (R14; `once` first-branch creation is covered), start setups, insert attempt-1
    runs for step 1's targets: gate open → `running` + spawn; else `pending`, note
    `waiting for worktree setup`. Returns run ids.
  - Spawn (agent): `ade_sessions` headless row (`claude_session_id` = new uuid), `Agent.Register`,
    `adeagent.Run` in a goroutine on `b.ctx`; parser lines → run log; todo → `UpdateRun` + `adeTaskRuns`.
    Exit: finish status `done` → done; `failed` → failure rule; `needs_input` → stuck (note = summary);
    none → failed `ended without finish_step`; timeout → failed `timed out after <t>`; cancelled by
    `Close` → nothing written (R18). Session row → stopped. Then `advance(task)`.
  - Spawn (script): `gitprepare` runner in the worktree with the substituted command, stage
    timeout; output → run log; exit 0 → done, else failed `exited with status N` → failure rule
    (`stop`/`retry N`). `runsOn ''` defaults `once`.
  - `advance(task)` under a per-task mutex: refresh snapshot (R13), `nextAction`, act. Retry =
    new attempt (fresh session, same composed prompt). Every state change: `UpdateRun`, `OnRuns`
    with the changed runs, `notifyBoard`.
  - `onSetupReady(branchID)`: start that branch's `pending` runs of the current step.
  - `Approve(args)`: stage current, step pending, `before: approval`, previous step done → start.
  - `RetryRun(runID)`: latest attempt of its (stage, step, branch), state `failed` or `stuck`,
    stage still current → new attempt.
  - `StageDone(taskID)`: user stage, or agent/script stage whose steps are all `done`; else
    `E_INVALID`. Next stage → `SetStage(next.id, snapshot)`; after the last → `stageId 'done'`,
    `currentStage null`. Returns the task.
  - `ReadLog(kind, id, afterSeq)` → `LogPage` (`done` from run/setup state).
  - `Sessions()` → `SessionsResult` from `ListTask` (`cwdMissing` for stopped rows, as v1).
  - `Close` (from `TaskBoard.Close`): cancel `b.ctx` (kills processes and setups), `Agent.Close`.

### 2.6 Bridge and wiring

- `bridge/adetask.go`: the 7 P146 methods (`StartRun`, `Approve`, `RetryRun`, `StageDone`,
  `RetrySetup`, `ReadLog`, `Sessions`) with validation (ids via `validateAdeItemID`; branch names
  `validateAdeBranchName`; `message` ≤ `adeMaxMessageBytes`; `kind` in `run|setup`; `afterSeq ≥ 0`).
  Emit helpers `AdeTaskRunsChanged(ev, RunsChangedEvent)`, `AdeTaskLogAppended(ev, LogEvent)`,
  `AdeTaskSessionsChanged(ev)` on `adewire.ChannelRuns|Log|Sessions` (Broadcast).
- `main.go`: `wireAdeTask` passes the new deps (`HeadlessSettingSources` reads
  `Settings.GetAll().Ade.HeadlessSettingSources` fresh per run); no new teardown call
  (`adeTaskBoard.Close()` already runs).
- `frontend/src/bridge/index.ts`: 7 `adeTask*` entries + `onAdeTaskRuns`, `onAdeTaskLog`,
  `onAdeTaskSessions`. Totals after P146: 38 methods, 8 channels.

### 2.7 Tests (Stream A)

Earn the bar per preplan accept and CLAUDE.md:
- `adeagent/stream_test.go`: todo extraction (TodoWrite; TaskCreate/TaskUpdate incl. deleted and
  out-of-order ids), log mapping incl. permission denial and oversize line. Fixture lines in
  `testdata/` shaped like §0.1's real output.
- `ade/steps_test.go`: `stepState` and `nextAction` tables (gates, retry counts, `back:`, stuck,
  first-step approval, R13 reorder).
- `ade/runengine_test.go` (integration, real temp git repos, fake claude = the test binary
  re-executed via `TestMain` + env scenario, which calls `finish_step` with the go-sdk MCP client
  over the config's URL and token): `each repo` over two repos with todo progress and auto next
  step; approval gate + `Approve`; `needs_input` → stuck + `RetryRun`; `failed` + `retry 1`;
  exit without `finish_step`; timeout; `back:` → failed; setup gate (sleeping script → pending
  then running; failing script → `failed`, `RetrySetup`); no-script `ready`; `once` creates the
  first branch only when it runs there; `only <nick>` unresolved → `E_INVALID`; script stage
  exit codes and quoted variables; log cap truncation + `ReadLog` paging; headless session rows;
  wrong bearer token rejected; `StageDone` rules. Bounded waits, no sleeps-as-sync.

### 2.8 Commits (Stream A)

Each: pre-commit hook passes normally, `gofmt -l` empty, `go build ./...`,
`go vet ./apps/kira-space/...`. Never `--no-verify` to finish.

1. `feat(kira-space): ade sessions rebuild, run log and run writes` — 0010, models, repos.
   Extra: `go test ./apps/kira-space/internal/storage/... ./apps/kira-space/internal/ade/...`.
2. `feat(kira-space): ade worktree creation and setup gate` — `setup.go`, `ParsePrepareTimeout`.
3. `feat(kira-space): headless claude runner and stream-json parser` — `adeagent/{stream,process,suffix}.go`, test.
4. `feat(kira-space): finish_step MCP server` — `adeagent/mcp.go`.
5. `feat(kira-space): ade step machine and script stages` — `steps.go`, `vars.go`, `runs.go`, `steps_test.go`.
6. `feat(kira-space): AdeTaskService P146 methods and channels` — `adetask.go`, `main.go`, `index.ts`.
7. `test(kira-space): ade run engine with a fake claude` — `runengine_test.go`.
8. `docs(v2.0): P146 stream A notes` — `plans/P146-streamA-notes.md` (commits, end checks, real
   smoke output, deviations). Write it incrementally if the stream halts.

### 2.9 Stream A end checks

`go test ./apps/kira-space/...` (gitsock rule §6.4), `go test -race
./apps/kira-space/internal/{ade,adeagent,adeflow}/...`, `bun run lint:go`, `bun run lint:dead`,
`go mod tidy` diff empty, `git diff B0 -- go.mod go.sum package.json bun.lock` empty.
**Real `claude -p` smoke** (claude is installed here; skip only if `claude` is absent or unauthenticated, and
say so): server-tag build (§6.4 recipe), temp home, one scratch repo with a prepare script
(`echo prepared`), workflow `smoke.yaml` with one agent step (`allowed_tools: []`, prompt `Create a
todo list of two items, complete both, then finish.`, timeout `5m`) and one script stage
(`echo {branch}`); bound calls `CreateTask` → `StartRun` → poll `Board`: setup `ready`, run `done`
with `todo [2,2]`, `summary` set, session row `headless`/`stopped`, `ReadLog` shows `▸`/`result:`
lines; `StageDone` → script stage `StartRun` → `done` with `'feat/…'` in its log. Record output in the A notes.

## 3. Step 0 (serial, orchestrator lands on `v2.0` before creating worktrees)

One Sonnet implementer, one commit `feat(kira-space): ade headless setting sources leaf`:
`storage/model/settings.go` (`AdeSettings.HeadlessSettingSources`, default `"all"`, patch field,
`ValidAdeHeadlessSettingSources`), `storage/repos/settings.go` (read/upsert leaf
`ade.headlessSettingSources`), `frontend/src/state/settingsDomain.ts` (`z.enum(['user','all'])
.default('all')`), the two `branchNames` comments (R1), `plans/P143-wire-contract.md` §12 line.
Checks: hook, `go build ./...`, `go test ./apps/kira-space/internal/storage/... ./apps/kira-space/internal/bridge/adewire/...`,
`bun run typecheck`. Fixtures untouched (comment-only). Then `B0` = this commit.

## 4. Stream B: panel, Notes, Backlog, merged/deployed UI

Imports only `ade/v2/wire.ts` (rule 5), `ade/v2/board/*`, shared stores/components. Consumes only
P144/P145 methods and the step-0 settings leaf: `Board`, `Prs`, `Refresh`, `ForcePush`,
`UpdateTask`, `AddTaskRepo`, `CandidateBranches`, `AddExistingBranch`, `Backlog`,
`AddBacklogItem`, `UpdateBacklogItem`, `MoveBacklogItem`, `DeleteBacklogItem`,
`PromoteBacklogItem`, `Workflows`, `Repos`; channels `onAdeTaskBoard`, `onAdeTaskBacklog`,
`onAdeTaskRepos`. Library use: Tailwind utilities (no scoped `<style>`), shadcn-vue (Tabs, Tooltip,
Badge, Dialog, Input, Textarea, Switch, NativeSelect, Field), VueUse (`useDebounceFn`,
`useClipboard`, `onKeyStroke`, `useDraggable` in the resize handle), Pinia, TanStack Query, TipTap
(restored). No new package; no new shadcn primitive expected.

### 4.1 Restore (from `13e99974`, then adapt to v2)

`AdeNotesEditor.vue` + `notesExtensions.ts` (→ `ade/v2/notes/`), `AdePanelResizeHandle.vue`,
`AdeChangesTab.vue` (v2 `Branch.files`/`commits`), `AdeEstimateField.vue` (extend-only error from
`UpdateTask` shown inline), `tests/unit/ade-notes-markdown.spec.ts`. No restored file imports
`ade/wire.ts`. Drop the six `@tiptap/*` entries and their comment from `knip.json`
`ignoreDependencies`.

### 4.2 Data and state

- `ade/v2/queries.ts`: `useBacklog`; mutations `useUpdateTask` (optimistic, rollback),
  `useAddTaskRepo`, `useUpdateBacklogItem`, `useMoveBacklogItem` (optimistic), `useDeleteBacklogItem`,
  `usePromoteBacklogItem`. Refresh mutation stores its result in `adeBoardUi` (R20).
- `ade/queries.ts` `installAdeSignals`: `onAdeTaskBacklog` → invalidate backlog; `onAdeTaskRepos`
  → invalidate repos and `useCodeReposStore().hydrateCodeRepos()` (P145 §8).
- `adeBoardUi`: `view`, `selectedBranchId` (`selectTask` clears it, `selectBranch` keeps the task),
  `refreshSummary[codeRepoId]` (R20).

### 4.3 Panel (`ade/v2/panel/*`, SPEC2 §7 minus Workflow block and Sessions)

- Right of the Plan, `AdePanelResizeHandle`, width from `Settings.ade.panelWidth` (0 = half),
  committed through the settings store. Opens on selection; empty when nothing selected.
- **Task mode** header: color square · status chip (`status.ts`) · title (2-line clamp, tooltip,
  SPEC2 §5.2); mono line `<day span> · N branches in <repos> · k/n steps` (from `timeline.ts` /
  `progress.ts`); review note for review tasks. No actions (R6). Tabs `Task` · `Notes`.
- **Task tab**: `Name` (placeholder = default title, save on blur/Enter), `Status` read-only chip +
  `follows the workflow: <why>` (D10), `Jira` (key link + copy, or paste field → parse with
  `jira.ts` → `UpdateTask`; ✕ → `clearJira`), `GitHub` (link chip `PR`/`issue` + `repo#n`, copy, ✕;
  or paste field), `Estimate` (`AdeEstimateField`), `Not merging` switch (R3), **Branches**: one row
  per branch `git status chip · repo · merged-into chips · branch name` (click → branch mode), then
  `+ Add repo…` NativeSelect (`nickname · full name`, repos the task lacks; not for review) →
  `AddTaskRepo`, and `+ Add branch` → Add popover in attach mode (`adding to: <task>`,
  `AddExistingBranch{taskId}`), the P145 §8 carry-forward.
- **Notes tab**: only the TipTap editor, full panel height, debounced save → `UpdateTask notes`.
- **Branch mode**: `← <task title>` link; header outlined task-color square · git status chip ·
  branch name (wraps, `break-all`); mono line `repo · base X · ↑a ↓b`; action Force push when
  `actions.ts` offers it (opens the existing `AdeForcePushDialog`). Tabs `Details` · `Changes`.
  Details: Branch row and PR row (`Prs`) with status chips; **Merged into** rows (`merged | stale |
  not merged` chip · target · note), **Deployed to** rows (`deployed | stale | not deployed |
  unknown` chip · env · note or error). No Merge / Re-merge buttons (R5).

### 4.4 Plan additions

- Branch row line 2: context text · integration chips (`dev ✓` muted / `stg ⚠` amber) · thin
  divider · deployment chips (`▲staging ✓` / `▲prod ⚠`; `unknown` muted `?` with the error tip),
  each with its tooltip, from `labels.ts`. Nothing for not merged / not deployed.
- `labels.ts`: integration stale tip without `Right-click to re-merge.` (R5).
- Repo chip after a fetch: `just now · 3 refs changed · 1 merged into develop` (one
  `· N merged into T` per target; errors stay inline), from `refreshSummary`, until the next
  fetch; the `<n>m ago` clock keeps running.

### 4.5 Backlog page (`ade/v2/backlog/*`, SPEC2 §11.1)

- Tab bar: `Backlog` tab before `Plan` with a grey count badge (`items.length`).
- List (left): capture input at top (Enter → `AddBacklogItem`, added on top); rows `↑` `↓`
  (`MoveBacklogItem` ±1) · `→ Task` · `✕` (`DeleteBacklogItem`, no confirm, as mockup) · added
  `ago` · text (inline edit, Enter/blur → `UpdateBacklogItem`) · quiet trailing facts
  (`PAY-140 · issue web-app#882 · notes`), one line, truncating (§5.2). Click selects.
- Panel (right, 520px, panel look): chip `backlog · not planned` · title · `captured <ago>`;
  actions `→ Plan as task`, `Delete`; fields Title, Jira (paste link or key → key link, copy, ✕; no
  sync, D9), GitHub (paste PR/issue link → chip, copy, ✕), Notes (same TipTap editor).
- `→ Task` / `→ Plan as task` → `PromoteBacklogItem` → `view = 'plan'`, select the new task.
- Empty state: one muted line.

### 4.6 Settings switch

`workbench/settings/AdvancedPane.vue`: Switch field `Background agents ignore repo settings` bound to
draft `ade.headlessSettingSources` (`user` on, `all` off), description `Runs claude -p with
--setting-sources user. Off: repo .claude settings also load; their deny rules still apply.`,
reset-to-default like the other leaves.

### 4.7 Mock runtime and UI specs (`apps/kira-space/tests/ui/`)

- `support/mockRuntime.ts`/`ipcChannels.ts`: `AdeTaskService` FQNs for every method B now calls;
  backlog defaults from `fixtures/ade-v2/backlog.json`; mutations emit board/backlog pushes.
- `ade-v2-panel.spec.ts`: select task → header facts, status read-only; Name/Jira/GitHub/Estimate/
  Not merging → `UpdateTask` args; estimate shrink error shown; `+ Add repo…` → `AddTaskRepo`;
  `+ Add branch` attach → `AddExistingBranch{taskId}`; Notes typing → one debounced `UpdateTask`;
  branch click → branch mode Details (Merged into / Deployed to rows incl. `stale`, `unknown`),
  Changes tab, `← task`; Force push from header; resize persists `panelWidth`.
- `ade-v2-plan.spec.ts` (extend): line-2 chips and tooltips; refresh summary text from
  `refresh.json`.
- `ade-v2-backlog.spec.ts`: badge count; capture; ↑/↓ args; inline edit; panel fields; `→ Plan as
  task` switches to Plan and selects; delete.
- Settings spec (extend the existing settings UI spec or add one): switch writes
  `ade.headlessSettingSources`.

### 4.8 Commits (Stream B)

Each: pre-commit hook passes normally; `bun run typecheck`; touched specs run.

1. `feat(kira-space): restore ade notes editor, resize handle and changes tab for v2` (+ knip ignore
   drop, notes spec). Extra: `bun run lint:dead`.
2. `feat(kira-space): ade v2 panel task mode and notes tab`.
3. `feat(kira-space): ade v2 panel branch mode and merged/deployed line`  (+ refresh summary).
4. `feat(kira-space): ade v2 backlog page`.
5. `feat(kira-space): headless setting sources switch; repos push refreshes code repos`.
6. `test(kira-space): ade v2 panel and backlog UI specs`.
7. `docs(v2.0): P146 stream B notes` — `plans/P146-streamB-notes.md` (commits, mockup verdict,
   deviations).

### 4.9 Stream B end checks

`bun run test:unit`, `bun run lint:all`, `bun run test:ui:space` (webkit + `libavif16` per
`DEV_ENVIRONMENT.md`), `bun run lint:dead` (tiptap now used), mockup comparison (§6.3).

## 5. Streams verdict, ownership, worktrees

**Split holds** after step 0. Zero file overlap; no ordering dependency:

- B calls only P144/P145 methods and channels already in `index.ts`, and the step-0 settings leaf.
  A's 7 methods and 3 channels have no B caller until P147.
- A never touches `frontend/src/ade/**`, `workbench/**`, `knip.json` or `tests/{ui,unit,visual}`;
  B never touches Go, `index.ts`, `settingsDomain.ts`, `go.mod`.
- No wire change beyond step 0's comment. A stream needing one stops (preplan §3 rule 1).

| Path | Step 0 | A | B | Closing |
|---|---|---|---|---|
| `storage/model/settings.go`, `storage/repos/settings.go`, `frontend/src/state/settingsDomain.ts`, `adewire/wire.go` + `ade/v2/wire.ts` (comment), `plans/P143-wire-contract.md` | ✓ | | | |
| `apps/kira-space/internal/**` except `internal/gitsock/**` and step-0 files (incl. `migrations/0010_*.sql`, `embed.go`, new `internal/adeagent/`, `gitsession` export) | | ✓ | | |
| `apps/kira-space/main.go`, `frontend/src/bridge/index.ts`, `go.mod`/`go.sum` (expected unchanged) | | ✓ | | |
| `docs/v2.0/plans/P146-streamA-notes.md` | | ✓ | | |
| `apps/kira-space/frontend/src/ade/**` except `ade/wire.ts`, `ade/v2/wire.ts`, `ade/state/agentSessions.ts` | | | ✓ | |
| `apps/kira-space/frontend/src/workbench/settings/AdvancedPane.vue` | | | ✓ | |
| `knip.json`, `scripts/check-ade-colours.sh`, `packages/theme/src/components/ui/**` (new primitives only, if any) | | | ✓ | |
| `apps/kira-space/tests/ui/**`, `tests/unit/ade-*` | | | ✓ | |
| `docs/v2.0/plans/P146-streamB-notes.md` | | | ✓ | |
| `docs/v2.0/SPEC.md`, preplan, this plan's `## Result`, P145 plan §8 note, `docs/ARCHITECTURE.md` notes | | | | ✓ |

**Untouchable by A and B:** `apps/kira-space/internal/gitsock/**` and its tests (P152, concurrent
third stream); `scripts/mutation/**` (P151); `ade/wire.ts` (v1), `tests/fixtures/ade-v2/**`,
`packages/shared/**`, `main.ts`, `state/**`, `workbench/**` except `AdvancedPane.vue`,
`package.json`, `bun.lock`. A stream needing any of these stops and reports.

Run from `/home/user/kira-studio`, base `B0` (after step 0):

```sh
git worktree add -b v2.0-p146-a /home/user/kira-studio-p146-a B0
git worktree add -b v2.0-p146-b /home/user/kira-studio-p146-b B0
sh scripts/prepare-dev-environment.sh   # inside each worktree
```

Check each worktree is at `B0`. Orchestrator lands nothing on `v2.0` while A and B run except a
rule-1 amendment and P152's own landing (gitsock only; A and B rebase over it trivially).
A stopped stream resumes from its last commit, never from scratch. Implementers call
`codegraph_explore` before Read/Grep for any symbol not pinned to a file:line here.

Landing after both pass their end checks: `merge --ff-only v2.0-p146-a` (rebase first if P152
landed); in B's worktree `git rebase v2.0` (a real conflict = wrong ownership: stop, report);
`merge --ff-only v2.0-p146-b`; wave-end suite (§6.4); closing step (§7); remove worktrees, delete
branches, `git push origin v2.0`.

## 6. Acceptance

### 6.1 Stream A (checked by the orchestrator)

- 7 P146 methods bound and in `index.ts` (38 total; `grep -c` both sides = 38); `kira:adetask:runs`,
  `kira:adetask:log`, `kira:adetask:sessions` emitted from real call sites.
- 0010 applied to a copy of a real v1 DB: v1 session rows present with `task_id = ''`, v1
  `AdeSessionsRepo.List` returns them, headless rows excluded from it.
- Real callers: `adeagent.Run` from `runs.go`; `--allowedTools` built from `PipelineStep.AllowedTools`
  (grep); `--setting-sources` from the setting; `FinishStepSuffix` appended in `composePrompt`;
  `ParsePrepareTimeout` used by `setup.go`.
- Token never on argv (grep the argv builder); config file mode `0600` asserted in the engine test.
- Contract untouched since `B0`: `git diff B0 -- apps/kira-space/frontend/src/ade/v2/wire.ts
  apps/kira-space/internal/bridge/adewire apps/kira-space/tests/fixtures/ade-v2 packages/shared` empty.
- Real `claude -p` smoke recorded (§2.9).

### 6.2 Stream B

- `@tiptap/*` gone from `knip.json`; `bun run knip` clean with TipTap imported from the Notes tab.
- No file under `ade/v2/` imports `ade/wire.ts` (grep). No scoped `<style>`, no Options API, one
  store per concern.
- UI specs of §4.7 pass; `check-ade-colours.sh` passes.
- No Merge/Re-merge/Rebase/Queue/context-menu UI and no `Right-click` text (R5) (grep).

### 6.3 Mockup comparison (B end, again at wave end)

Throwaway Playwright Chromium script (scratchpad), 1440×900: mockup `plan` view with T_bill selected
(Task, Notes tabs), a branch selected (Details, Changes), and `inbox` (Backlog) view, against the
built test app on the mock runtime with fixtures. Read both images; list differences. Accepted: no
Workflow block (P147), no Sessions tab (P148), no header stage actions / Archive (R6), no Merge /
Re-merge buttons or fix menu (R5), no Worktree setup block (P147), app fonts, fixture-vs-mockup data.
Anything else (panel geometry, header facts, field order, chips, backlog row layout, 520px panel,
off-token colors) is a defect fixed before landing. Verdict + image paths in the B notes.

### 6.4 Wave end (landed tip)

- `go build ./...`, `go test ./apps/kira-space/...`, `go test -race
  ./apps/kira-space/internal/{ade,adeagent,adeflow}/...`, `bun run test:unit`, `bun run lint:all`,
  `bun run test:ui:space`. Failures fixed in follow-up commits on `v2.0`.
- **gitsock (P152, concurrent, out of scope).** Never skip, `-run`-exclude or retry-until-green. If
  `internal/gitsock` fails: signature must match P152's (`E_INTERNAL: read |0: file already closed`
  or the `file.read`/`review.comment.add` error responses, a different test per run, passes alone with
  `-run '^Name$' -count=5`); run `go test -count=3 ./apps/kira-space/internal/gitsock/...` with an
  isolated `KIRA_SPACE_HOME` on the tip and on `B0`, record both counts. Same signature, comparable
  rate → record under P152. Anything else → P146 regression: root-cause and fix. If P152 has landed
  by then, gitsock must be green.
- Live smoke (server-tag recipe, `DEV_ENVIRONMENT.md` P126; local `Locate` patch reverted after):
  temp home, two scratch repos (one with `develop`, a squash-merged branch, an env script); Playwright
  Chromium on `/?window=main`: select a task → Task tab edits persist across reload; Notes typing
  persists; `+ Add repo…` adds a branch row; branch mode shows `Merged into develop: merged`;
  Backlog capture → `→ Plan as task` opens it on the Plan; the settings switch round-trips. Plus
  §2.9's real `claude -p` run on the landed tip.

## 7. Closing step (serial subagent, after landing)

- `## Result` here (commits, counts, gitsock record, real smoke, mockup verdict, licenses: none new,
  deviations); `## P146 result` in `SPEC.md` and row status.
- R5 (M1): `SPEC.md` P146 row drops fix menu + merge dialog, P148 row adds them (with Merge /
  Re-merge buttons and the `Right-click to re-merge.` tooltip text); preplan §4 P146/P148 B and §5
  rows (§6 "Row text, fix menu, panel Merged into, Merge dialog"); P145 plan §8 `RecordMerge`
  caller → P148 B.
- Preplan §6: O3, O4, O5 marked resolved with R3, R4, R2.
- `knip.json`: dry-run dropping `src/ade/v2/wire.ts` / `src/ade/v2/board/*.ts` entries; drop only if
  `bun run knip` stays clean (expected not before P148).
- `docs/ARCHITECTURE.md` short notes: headless runner flags and the verified `--setting-sources`
  behavior (§0.1), `finish_step` MCP server (loopback, per-run token, config file), logs tail cap,
  `ade_sessions` v2 rows. Full ade rewrite stays P149.
- Remove worktrees; push.

## 8. Carry-forward

- P147 A: send-back (`back:` rounds 0 → 3, `claude -p --resume <session>` with the failure
  appended); restart recovery turns rows left `running` by R18 into `stuck` / `interrupted by
  restart` and stops their headless session rows; `StopRun`; Take over resumes a headless
  `ade_sessions` row (`resumes` column ready); TUI v2 rows use `task_id` with `mode 'tui'`.
- P147 B: Run dialog sends `StartRun.message` (R16; per-repo placeholders stay literal when the step
  fans out); Workflow block, step rows, Log (`ReadLog` + `onAdeTaskLog`), Output, Retry, Approve,
  `Done ›`/`Finish ✓` (`StageDone`); worktree setup UI (`RetrySetup`, setup log); live progress via
  `onAdeTaskRuns`. Workflow editor notes: script variables are inserted single-quoted (R15).
- P148 A: `checkEstExtends` lives in v1 `repos/adequeue.go`; keep it (or move it to `adetask.go`)
  when deleting v1.
- P148 B: merge dialog (`Also push develop` off, develop worktree template, `RecordMerge` on finish,
  D14), right-click fix menu (shadcn `context-menu` add), Merge / Re-merge buttons, re-add the
  `Right-click to re-merge.` tip (R5); Sessions tab reads `Sessions()` + `onAdeTaskSessions`.

## Result

Streams landed fast-forward on `v2.0` from `2ad7fdea` (`B0`). Notes: `P146-streamA-notes.md`,
`P146-streamB-notes.md`.

**Commits:** 18 from `B0` to `4248d638` (A 8 plus notes, B 8 plus notes), then closing commits.

**Counts:** 38 `AdeTaskService` methods, 38 `adeTask*` entries; migration `0010`; `test:unit` 1739
pass; `test:ui:space` 85 pass; `go build ./...`, `go test ./apps/kira-space/...`, `go test -race` on
`ade`, `adeagent`, `adeflow`, `gitsession`, `lint:all` all exit 0 on the landed tip.

**gitsock (P152).** Green on this tip's single run (`ok ... gitsock 59s`). No flake seen; not
re-measured with `-count=3` since nothing failed.

**Real `claude -p` smoke.** Ran in Stream A on its tip, as a scratch Go test (deleted) on the engine
harness with `ClaudeBin=claude` (CLI 2.1.289): setup `prepared`, headless session row `stopped`,
`finish_step` over MCP reached the engine (`done`, summary stored), script stage logged
`feat/fix-login`. Not re-run on the landed tip: no UI caller can start a run before P147 B, and
the engine code is unchanged since Stream A. Todo `[n, m]` not observed live (carry-forward).

**Live smoke (landed tip, server-tag build, local `Locate` patch reverted).** Temp home, two scratch
repos (`api` with `develop` and a squash-merged `feat/sq`, prepare script set; `web`), Playwright
Chromium on `/?window=main`. Ran: Task tab rename persists across reload; Notes typing persists;
`+ Add repo…` adds a branch row (1 to 2); Existing branch `feat/sq` added, Refresh all, branch mode
shows `Merged into develop: merged`; Backlog capture then `→ Plan as task` opens the new task in the
panel; settings switch round-trips (`ade.headlessSettingSources = "user"` stored, shown after
reload). Not run live: worktree setup, step machine and `finish_step` through the bridge (no UI
caller until P147 B; covered by engine tests with a fake claude and the Stream A real-claude
smoke).

**Mockup verdict.** Matches `mockup.html` within the accepted list (B notes). Branch-mode screenshot
re-read at wave end; no new defect.

**Closing items.** M1 (R5) recorded in `SPEC.md` P146/P148 rows, preplan §4/§5 and P145 plan §8.
Preplan O3, O4, O5 marked resolved (R3, R4, R2). `knip.json` dry run: dropping the `ade/v2/wire.ts`
and `ade/v2/board/*.ts` entries fails `lint:dead`, so both stay (comment updated). ARCHITECTURE.md
gains run-engine notes and two Known open items.

**Licenses:** none new. `go.mod`, `go.sum`, `package.json`, `bun.lock` unchanged.

**Deviations / carry-forward:**
- Todo progress unobservable in `claude -p` 2.1.289 (no TodoWrite/TaskCreate/TaskUpdate tool).
  Open question for the user.
- `{branch}` prints unquoted when `quotePOSIX` deems it safe.
- Run held behind a failed setup keeps note `waiting for worktree setup`.
- Headless-sources switch writes immediately, not on dialog Save. Draft-bound version needs
  `SettingsDialog.vue` and `settings/types.ts`; assigned to P148 B (SPEC row).
- 23 test files in `gitrpc`, `gitsession`, `ade`, `bridge` still open the real `review.db`: new
  SPEC row P154 after P153.
- `codegraph_explore`: not recorded after context compaction in Stream A (A notes).
