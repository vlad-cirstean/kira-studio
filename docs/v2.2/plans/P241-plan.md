# P241 plan: task base branch, Change base, headless rebase with reported outcome

SPEC row P241. User's words, condensed: set the base branch of a new task and change it on a
started one; base-changed handling stays a button next to the task, no popup; rebases run as a
headless Claude run, prompt shown first as today; the agent reports done or failed with a reason to
the kira-ade MCP, shown to the user and readable by another agent.

Base: `v2.0` tip after Stream A (P236), Stream C (P238, P239) and P240 have landed. One sequential
Sonnet implementer (wire, engine and UI are one order-dependent chain; no stream split).

Discovery: `codegraph_explore` over the rebase dialog flow and the run engine. `apps/kira-space/**`
is mostly not in the index, so these files were read directly: `ade/v2/dialog/{compose,flow,
deliver,turnWatch,useDialogCtx}.ts`, `dialog/AdeClaudeDialog.vue`, `state/adeDialogs.ts`,
`board/{actions,fixMenu,branchGraph,needsYou,progress}.ts`, `panel/headerActions.ts`,
`panel/AdeBranchPanel.vue`, `plan/{AdeTaskCard,AdeBranchRow}.vue`, `AdeAddPopover.vue`, `wire.ts`;
Go `internal/ade/{runs,launches,sendback,agenttools,board_facts,board_writes,setup,rebasecheck,
recover,review,vars}.go`, `internal/adeagent/{mcp,space,process,suffix}.go`,
`internal/bridge/{adetask.go,adewire/wire.go}`, `storage/model/adetask.go`,
`storage/repos/adetask.go`, migrations `0008`, `0012`, `0015`, `gitops/conflict.go`,
`gitsession/ops.go` (`opAbort`), `flowharness/fakeagent`, `flows/adeflow`, `realclaude/ade_test.go`,
and Stream C's `agentnotify.HandleRuns` in `/home/user/kira-sC`.

## 1. What exists today

### 1.1 Base

- `ade_task_branches.base` (ref short name, `''` = repo main) and `queued_after` (branch id) exist.
  **No write path sets `base`**: `CreateTask`, `AddTaskRepo`, `AddExistingBranch` all leave it `''`.
  `CreateTaskArgs` has no base field.
- Reads: `startPoint` (`setup.go`) branches a draft from `base`, local ref first.
  `boardCtx.resolveBase` (`board_facts.go`) resolves `base` for ahead/behind: main, else a live
  planner branch of the repo **by name** (gives wire `baseBranchId`), else the remote-tracking ref,
  else local. Two resolvers, opposite local/remote preference.
- Stacking: frontend `branchGraph` parent = `plan.queuedAfter[id]` else `baseBranchId`.
  `queueCycle` (`board_writes.go`) follows `QueuedAfter`, then `Base` by name.
- `review.go` target base reads `sb.Base` directly.

### 1.2 Rebase buttons and dialog

Three openers, three rule sets:

- Board tag actions (`board/actions.ts` `behindMain`, `rebaseConflicts`, `conflict`) dispatch
  `dialogs.rebase(row.id, action)` from `AdeTaskCard.vue`. `specForBranchAction` maps
  `target: ''` to **`'main'`**: a branch whose base is a plain ref (`develop`) gets
  "Rebase onto main". Bug.
- Branch panel header (`panel/headerActions.ts`): `rebaseMain` (stack root, only when root
  `behind > 0`), `rebaseOnto` (the `after` file-sharing branch), `queueAfter` (conflicting review
  branch). Dispatched in `AdeBranchPanel.vue`.
- Branch row menu (`board/fixMenu.ts`): `rebaseMain`, `rebaseOnto`; dispatched in `AdeBranchRow.vue`.

All go to `adeDialogs.rebaseOnto/rebase` -> `compose.rebaseSpec` -> `AdeClaudeDialog.vue`. The dialog
shows the client-composed prompt (`compose.rebaseMessage`: `git fetch && git rebase <ontoRef>` per
worktree, then `git rebase <parent>` per stacked child, push line, "ask me before changing
anything"), editable, with a push switch, a busy alert (TUI `working`/`waiting` on the stack,
overridable) and a hard block when a headless run is running on the stack.

**Send today delivers to an interactive TUI session**, not headless: `flow.sendRebase` ->
`deliver` -> `Send` into a running TUI on the branch (session chip) or `StartBranch` (new TUI).
`turnWatch` waits for the hook `Stop`. `onto !== 'main'` then calls `SetQueuedAfter`. Nothing checks
the result: no verification, no outcome, the pending mark clears on `Stop`.

### 1.3 Run engine and kira-ade MCP

- Headless runs exist only as workflow step runs: `StartRun` -> `queueRun` -> `launch` ->
  `superviseAgent` (`adeagent.Run`: `claude -p --mcp-config <0600 file> --setting-sources ...
  --allowedTools ...`, prompt on stdin) -> `agentOutcome` -> `recordOutcomeLocked` (send-back rule,
  then `advanceLocked`). Run rows `ade_runs` (`stage_id`, `step_id` NOT NULL), log via `logsink`,
  headless session row in `ade_sessions` (`purpose` CHECK `''|'review'`).
- kira-ade MCP (`adeagent/mcp.go`, loopback HTTP, per-run bearer token): `finish_step(status:
  done|failed|needs_input, summary)`, last call wins, applied at process exit. Space tools
  (`task_info`, `declare_repos`, `request_branch`, `branch_status`) for Space grants.
- Failure synthesis exists, flat: no `finish_step` -> `failed`, note `ended without finish_step`;
  timeout -> `timed out after <t>`; start error -> `could not start: ...`. Stored as `note` and
  `summary` strings only. `needs_input` -> run `stuck`. Restart -> running runs `stuck`,
  `interrupted by restart` (`Recover`).
- **No structured outcome**: no reason/details/shas, nothing verified against git, no MCP tool to
  read another run's outcome. P238's notifier (`agentnotify.HandleRuns`, landed by Stream C) sends
  "ADE run <state> · <task>" with `Summary` else `Note` on any run end.
- Abort: git module has `opAbort` (`gitsession/ops.go`, `gitops.AbortArgs`) on the repo entry
  (main worktree). Nothing ADE-side; a half-done rebase in a task worktree has no UI.

## 2. Design

### 2.1 Base model

One concept, "base", stored on the branch row:

- `base` (existing): ref short name, `''` = repo main.
- `base_branch_id` (new): a live planner branch of the same repo the branch stacks on (any task,
  any kind). When set, `base` also holds that branch's name (or `''` while it is a draft), so
  review, archive and a deleted parent still have a ref name to fall back to.
- `queued_after` stays what it is: merge order after a review branch ("Queue after").

One resolver `resolveBaseRef(sc, sb)` in `board_facts.go` replaces `resolveBase` and the base half
of `startPoint`, and `review.go` uses it:

1. `base_branch_id` names a live, created branch -> that branch's tip (`branchID` set).
2. `base_branch_id` names a live draft -> unresolved, reason `parentDraft`.
3. `base` `''` or the main short name -> main.
4. `base` names a live planner branch of the repo by name -> that branch (today's behaviour).
5. Remote-tracking ref of the default remote, else local ref (today's board order).
6. Nothing -> unresolved, reason `baseMissing`.

`startPoint` switches to the same order (it is local-first today). Ahead/behind, the new branch's
start and the rebase target then all mean the same commit. Listed as open question 3.

Wire `Branch` gains `baseMissing bool` (rule 6) and `rebaseInProgress bool` (2.6). `baseBranchId`
comes from rule 1 or 4.

Validation, `validateBase(tc, sb, choice)` in a new `ade/base.go`, used by every write:

- `choice.BranchID == sb.ID` -> `a branch cannot be its own base`.
- other repo -> `the base must be a branch of the same repo`.
- cycle: extend `queueCycle` to follow `BaseBranchID` first, then `QueuedAfter`, then `Base` by
  name -> `that base would form a cycle (X is stacked on this branch)`. Covers "onto my own child".
- `choice.Ref` set: must exist locally or on the default remote
  (`resolveQueuedRef` on the inventory) -> `branch "x" not found in <repo>`; must pass
  `git check-ref-format --branch`.
- `choice.Ref` equal to the branch's own name -> same message as self.

Writes:

- `CreateTaskArgs.Bases map[codeRepoId]BaseChoice` (missing = main). `AddTaskRepoArgs.Base *BaseChoice`.
- `SetBranchBase({branchId, base})`: **draft branches only** (`name == ''`); refused on a created
  branch with `the branch exists: use Change base, which rebases it`.
- Created branches change base only through `Rebase` with `Onto` set (2.3): base stored and rebase
  launched under one task-mutex hold, after every precondition passed.
- A draft whose `base_branch_id` parent is a draft: `StartRun`'s `prepareWorktrees` creates
  same-task parents first (topological order by `base_branch_id`). A parent on another task that is
  still a draft refuses: `base <name> is not created yet: start its task first`.

### 2.2 Buttons: one rule, three surfaces (requirement 2)

No popup, ever. New pure module `ade/v2/board/rebaseActions.ts`:

```ts
export type RebaseAct =
  | { kind: 'rebase'; id: string; label: string; branchId: string; onto: OntoChoice; tip: string; disabled: boolean }
  | { kind: 'queue'; id: string; label: string; branchId: string; withId: string; tip: string; disabled: boolean }
  | { kind: 'changeBase'; id: string; label: 'Change base…'; branchId: string; tip: string; disabled: boolean }
  | { kind: 'abortRebase'; id: string; label: 'Abort rebase'; branchId: string; tip: string; disabled: boolean };
export function rebaseActs(i: RebaseActInput): RebaseAct[];
```

- `rebase`: shown when the stack root is behind its base (`behind > 0`), or when
  `conflictsIfRebased` is non-empty. Label `Rebase onto <base>` with the real base name (P240's
  `baseNameOf` from `board/reviewCode.ts`, so one spelling). Acts on the branch whose base is
  behind (stack root for a root base, the child for a stacked child). Fixes the `develop` -> main bug.
- `rebase` with `onto` = the `after` file-sharing branch (today's `rebaseOnto`).
- `queue`: conflicting review branch (today's `queueAfter`).
- `changeBase`: every created or draft mine branch, not merged, not parked.
- `abortRebase`: `branch.rebaseInProgress`.
- `disabled` + `tip` when a run of the stack is `running` or `pending` with the rebase gate
  (`A run is working on <name>`), or the base is missing for `rebase` (`Base <x> no longer exists:
  change the base`).

Consumers, all through it: `actions.ts` tag actions (`behindMain`, `rebaseConflicts`, `conflict`,
new rules in 2.6), `headerActions.ts`, `fixMenu.ts`. One dispatcher `adeDialogs.act(a: RebaseAct)`:
`rebase`/`queue`/`changeBase` open the dialog, `abortRebase` opens the existing `AdeConfirmDialog`
(an irreversible-ish action keeps a confirm, which is not a "base changed" prompt).
`AdeActionCell` keeps `Rebasing…` from the run state, not the in-memory `pending` set.

Task level: the task context menu (`board/taskMenu.ts`) gets `Change base…`, a submenu per branch
when the task has several (same shape P240 uses for Review code).

### 2.3 Headless rebase through the run engine (requirement 3)

A rebase is an `ade_runs` row with `purpose = 'rebase'`, `stage_id = ''`, `step_id = 'rebase'`,
outside the workflow. Reusing the run row gets the run log, headless session row, Stop, Take over,
restart recovery, the `RunsChangedEvent` push and P238's notification without new plumbing.
`stage_id = ''` never matches a stage, so `plan()`, `progress.ts` `latestRun` and step views ignore
it; `HasRunning`/`HasRunningOn` count it, so stage moves, `StartBranch` and archive already respect it.

Bound methods (`AdeTaskService`, `internal/bridge/adetask.go`, validated in `adetask_validate.go`):

```go
type BaseChoice struct{ Ref, BranchID string }             // both '' = repo main
type OntoArgs struct {
    BranchID  string      // branch to rebase; its created mine descendants restack after it
    Onto      *BaseChoice // nil = current base; set = new base, stored before launch (Change base)
    QueueWith string      // review branch id: rebase onto it and set QueuedAfter (Queue after)
    Push, Autostash bool
}
type RebaseArgs struct{ OntoArgs; Message string } // Message '' = default prompt
func (s *AdeTaskService) RebasePreview(ctx, OntoArgs) (adewire.RebasePreview, error)
func (s *AdeTaskService) Rebase(ctx, RebaseArgs) (adewire.RebaseStart, error)
func (s *AdeTaskService) AbortRebase(ctx, BranchArgs) error
func (s *AdeTaskService) SetBranchBase(ctx, SetBranchBaseArgs) error
func (s *AdeTaskService) RepoBranches(ctx, RepoBranchesArgs) (adewire.RepoBranches, error)
```

`RebasePreview` (read, TanStack Query keyed on the args) returns `{prompt, suffix, stack:
[{branchId, name, worktree, ontoRef}], blockers: [{branchId, kind, text}], noOp}`. Blocker kinds:
`dirty` (uncommitted entries; cleared by `Autostash`), `running` (a run on a stack branch),
`inProgress` (a rebase/merge already in progress in a worktree: `Abort rebase` first),
`baseMissing`, `parentDraft`, `noWorktree` (created branch checked out nowhere: the launch gate
creates it, so this one is informational), `setup` (prepare script running: same "Starts when
ready…" wait as today via `ErrSetupPending`).

`Rebase` (`ade/rebase.go`, new), under the task mutex:

1. Load `tc`; branch must be live, `mine`, created, task not archiving, not a review task.
2. Resolve onto: `QueueWith` (review branch, same repo, cycle-checked) | `Onto` (validated, 2.1) |
   current base via `resolveBaseRef`. Missing -> refuse.
3. Stack: branch plus created `mine` descendants, depth first, children = live branches whose
   `base_branch_id`, else `queued_after`, else `base` name points at the parent (server twin of
   `compose.stackOf`).
4. Preconditions per stack branch: no `running`/`pending` run (`a background run is working on
   <name>`); `launchGate` gives the worktree (creates it if missing, may return `ErrSetupPending`);
   no in-progress operation (2.6); clean unless `Autostash`. TUI busy (`working`/`waiting`) stays a
   client-side alert with Override, as today (the tracker's activity is not on the server path and
   `tracker.go` is not this phase's file).
5. Record shas: `ontoTipBefore`, per stack branch `before` tip.
6. No-op: branch already contains the onto tip and each child contains its parent tip -> store
   the base change only, return `{noOp: true}`. No run.
7. Store the base change (`SetBranchBase` repo write, or `SetQueuedAfter` for `QueueWith`).
8. Insert the run (`purpose rebase`, attempt = previous rebase runs on the branch + 1, `spec_json` =
   `RebaseSpec{OntoRef, OntoName, OntoTipBefore, Stack[{BranchID, Name, Worktree, ParentRef,
   Before}], Push, Autostash}`), insert the headless session row, launch.

Launch: `superviseAgent` gains a `kind` switch, not a copy. For `purpose rebase`: grant
`{RunID, TaskID, Space: false}`; allowed tools `Bash(git:*)`, `Read`, `Edit`, `Write`, `Grep`,
`Glob`, `finish_step`, `run_outcome`; cwd = branch worktree; timeout `rebaseTimeout = 20m`;
setting sources as step runs (P233: `--mcp-config` temp file only, no settings file written). At
exit it calls `completeRebase` instead of `agentOutcome`/`recordOutcomeLocked`: no send-back, no
`advanceLocked`. After the outcome: `launchHeldLocked` for each stack branch (2.5 gate), then
`notifyBoard` so ahead/behind recompute.

Prompt (`ade/rebaseprompt.go`, `composeRebasePrompt(spec)`), server-owned. The dialog shows exactly
this text (requirement: prompt shown before running). The client template `compose.rebaseMessage`
is deleted, so one template exists:

```
Rebase <branch> (repo <nick>) onto <ontoName>[, then restack the branches built on it:]
1. In <wt>: git fetch <remote> && git rebase [--autostash ]<ontoRef>
2. In <childWt>: git rebase [--autostash ]--onto <parent> <parentBefore>
[Do not modify <reviewBranch>.]
Resolve any conflicts by editing the files, then git add and git rebase --continue.
<push line: "Then push each rebased branch with git push --force-with-lease" | "Do not push.">
```

Children use `--onto <parent> <parentBefore>` (old parent tip from step 5), so the parent's
pre-rebase commits are not replayed; today's `git rebase <parent>` replays them. The fixed
`adeagent.RebaseReportSuffix` is always appended, also to an edited message, like
`FinishStepSuffix` on step runs. The dialog shows it read-only under the textarea. Text:

> When you are finished, call finish_step. status "done" only when every branch above is rebased
> and no rebase is in progress. status "failed" with reason, conflictedFiles, lastGitError and
> tried when you could not finish; leave a rebase in progress only when you could not resolve it,
> and say so. status "needs_input" with your question when you need a decision. Kira Space checks
> the result in git.

`RetryRun` refuses `purpose rebase` (`retry from the Rebase button: it shows the prompt first`);
the UI Retry reopens the dialog with the run's spec.

### 2.4 Outcome model (requirement 4)

`finish_step` stays the one report tool, extended with optional fields (agent-facing status values
unchanged, so existing workflows and `FinishStepSuffix` keep working):

```go
type finishArgs struct {
    Status          string   // done | failed | needs_input
    Summary         string   // one line (existing)
    Reason          string   `json:",omitempty"` // why it failed or what is needed
    ConflictedFiles []string `json:",omitempty"`
    LastGitError    string   `json:",omitempty"`
    Tried           string   `json:",omitempty"`
}
```

`FinishFunc` becomes `func(runID string, f Finish)`. Bounds: summary/reason/tried 1 KiB,
lastGitError 4 KiB, conflictedFiles 200 entries x 1 KiB, else a tool error naming the field.

Stored outcome, every agent run (step and rebase), `ade_runs.outcome_json`, wire `Run.outcome`:

```go
type RunOutcome struct {
    Status          string // done | failed | blocked   (needs_input -> blocked)
    Reason          string // one line, always set when not done
    Source          string // agent | verify | exit | timeout | restart | user
    Reported        bool   // finish_step was called
    Verified        bool   // rebase: every git check passed
    ConflictedFiles []string
    LastGitError    string
    Tried           string
    LastError       string // last stderr line, exit and timeout only
    RebaseInProgress bool  // rebase: re-read after exit (and after Abort)
    Aborted         bool   // rebase: Abort rebase ran
    OntoRef, OntoTip string
    Branches        []BranchShas // {branchId, name, before, after, onBase}
    Pushed          *bool  // rebase with Push: upstream equals the new tip
}
```

Run `state` stays the board's vocabulary: done -> `done`, failed -> `failed`, blocked -> `stuck`
(the existing "needs you" + Take over path). `Run.Summary` = reason (P238 notifier body).

Synthesis when the agent did not report (`Reported false`), status `failed`:

| Case | Source | Reason |
|---|---|---|
| exit 0, no `finish_step` | `exit` | `no report: Claude ended without calling finish_step` |
| exit non-zero | `exit` | `no report: claude exited with status N` |
| timeout | `timeout` | `no report: timed out after 20m` |
| could not start | `exit` | `could not start: <err>` |
| Stop button | `user` | `stopped by you` |
| app restart while running | `restart` | `interrupted by restart` |

`RunOutcome` also gets `LastError string`: the process's last stderr line, set for `exit` and
`timeout`. `LastGitError` stays the agent's own report.

Rebase verification, `verifyRebase(ctx, spec) rebaseFacts` (`ade/rebaseverify.go`), runs after
every rebase exit, report or not, plus after Abort and after restart recovery. Per stack branch,
in its worktree:

1. In-progress operation (rebase/merge/cherry-pick) via the new worktree read (2.6).
2. Unmerged paths from `WorktreeStatus` -> `ConflictedFiles` (merged with the agent's list).
3. `HEAD` is `refs/heads/<name>` (not detached, not another branch).
4. `merge-base --is-ancestor <ontoTipBefore> <tip>` for the root; for a child, parent's `after` tip.
   `ontoTipBefore` is used because the agent's fetch only moves the remote ref forward; checking a
   later autofetch tip would fail a correct rebase.
5. With `Push`: the upstream ref equals the new tip -> `Pushed`.

`decideRebaseOutcome(finish *Finish, facts, exit) RunOutcome` (pure):

- agent `done` and checks 1-5 pass -> `done`, `Verified`.
- agent `done` and a check fails -> `failed`, `Source verify`, reason names the first failing
  check (`verification failed: a rebase is still in progress in <wt>` / `... <name> is not on
  top of <onto>` / `... HEAD is detached in <wt>` / `... <name> was not pushed`).
- agent `failed`/`needs_input` -> that status, agent reason, git facts attached.
- no report -> table above, git facts attached (open question 2: a no-report run whose checks all
  pass still reads `failed` per the user's rule; the facts line says git shows it rebased).
- `Branches[].after` read from git in every case.

Idempotency: `finish_step` last call wins (existing map); calls after the process ended hit a
released grant (`no run behind this call`); the outcome is written once by `completeRebase` under
the task mutex, which ignores a run no longer `running`. Restart: `Recover` patches recovered
`purpose rebase` rows to `failed` + `restart` outcome (not `stuck`), and `Start` runs
`verifyRebase` for them in `goTracked` to fill git facts.

Take over (TUI resume of a failed/blocked rebase): `finishableRun` accepts the latest rebase run of
the branch; `applyTUIFinish` routes `purpose rebase` to the same verify + decide path.

Readable by another agent:

- New MCP tool `run_outcome` on every grant with a task (run and Space grants), task-scoped:
  args `{runId?, branch?, purpose?: 'rebase'|'step', limit? 1-10}`, returns the task's latest runs
  newest first: `{runId, purpose, stage, step, repo, branch, state, finishedAt, outcome}`. Added to
  `allowedTools` of step runs and to `SpaceToolNames`' sibling list for TUI launches.
- Prompt context: `composePrompt` and `composeStartMessage` add one line per task branch whose
  latest rebase run is `failed` or `stuck`: `- Last rebase of <branch> failed: <reason> (run
  <id>; call run_outcome for details)`.
- UI "Copy for agent" on the outcome block (VueUse `useClipboard`): reason, conflicted files,
  last git error, tried, shas, as plain text.

### 2.5 Gate: no step run on a branch being rebased

`launch()` and `launchHeldLocked` keep a run `pending` with note `waiting for rebase` while a
rebase run is running on its branch; `completeRebase` releases them. `Rebase` refuses while a step
run is `running` or `pending` on the stack. `StartBranch` already refuses on `HasRunningOn`.

### 2.6 Worktree in-progress read and Abort

- `gitsession.RepoEntry.WorktreeInProgress(ctx, path) (*gitpreflight.InProgressOperation, error)`:
  `git -C <path> rev-parse --absolute-git-dir`, then `gitops.ReadInProgressStateFiles` + the
  existing classifier. Board `computeBranch` sets `Branch.rebaseInProgress` for branches with a
  worktree (one extra git call per worktree, beside the existing `WorktreeStatus`).
- `gitsession.RepoEntry.WorktreeAbort(ctx, path)`: same classifier, `gitops.AbortArgs(kind)` run
  with `-C <path>`. Rebase, merge and cherry-pick all abort (the git module's `opAbort` set).
- `AbortRebase({branchId})`: refuses while a run is `running` on the branch
  (`stop the run first`); no-op error when nothing is in progress
  (`no rebase is in progress in <wt>`); runs the abort; appends `aborted by you` to the latest
  rebase run's log; patches its outcome `RebaseInProgress false, Aborted true` (state unchanged:
  still failed); emits runs; `notifyBoard`. Works without any run too (a rebase the user started
  by hand), shown via the `rebaseInProgress` tag.

### 2.7 UI

Frontend rules: `<script setup lang="ts">`, Tailwind only, shadcn-vue primitives, VueUse,
TanStack Query for the new reads/mutations in `ade/v2/queries.ts`, no new Pinia store (dialog state
stays in `adeDialogs`, board selection in `adeBoardUi`).

- `AdeBasePicker.vue` (new, `ade/v2/`): shadcn-vue `Popover` + `Command` combobox over
  `RepoBranches({codeRepoId})` (new read: `{mainName, branches: [{name, local, remote, branchId,
  taskId, taskTitle, draft}]}`). Groups: `Main`, `Planner branches` (task title · branch; drafts
  shown, labelled `not created`), `Branches`. Excludes self and descendants (cycle) with a
  disabled hint. `data-testid="ade-base-picker"`, items `ade-base-option-<name>`.
- New task (`AdeAddPopover.vue`): under the repo toggles, one `Base` row per picked repo with the
  picker, default `main`. Sends `bases`.
- Change base: `DialogKind 'changeBase'` in `compose.ts`; `AdeClaudeDialog.vue` shows the picker
  at the top. Draft branch: picker only, button `Save base` (`SetBranchBase`). Created branch:
  prompt preview from `RebasePreview` (query key includes the pick, so it refetches), then the
  existing message/push/busy UI.
- Rebase/queue/changeBase dialog kinds (headless): no session chips, template = preview `prompt`,
  read-only suffix block, blockers as `Alert`s, an `Autostash` `Switch` shown only with a `dirty`
  blocker, send label `Run in background`. `flow.sendRebase` calls the `Rebase` mutation and
  closes; no `turnWatch`, no client `SetQueuedAfter`. `ade-dialog-send` testid unchanged.
  Merge/stage/start/archive stay TUI (out of scope).
- Branch tag rules (`actions.ts`), first match, before `conflict`:
  - latest rebase run `running`: `⟳ rebasing` blue, action `See log`.
  - latest rebase run `failed`: `✕ rebase failed` red, tip = reason; actions `See log`, `Retry`,
    `Abort rebase` (when `rebaseInProgress`), `Take over`.
  - latest rebase run `stuck`: `✋ rebase needs you` red, same actions.
  - `rebaseInProgress` with no such run: `⚠ rebase in progress` amber, `Abort rebase`, `Start agent`.
  - `baseMissing`: `✕ base missing` red, `Change base…`.
  A `done` rebase run shows nothing on the row (verified; panel only).
- Branch panel (`AdeBranchPanel.vue`): `Last rebase` block (`panel/AdeRebaseOutcome.vue`, new):
  status, reason, source, verified, conflicted files, last git error, tried, `before -> after` per
  branch, buttons (same `rebaseActs`), `Copy for agent`, and the run's `AdeRunLog`.
- Needs you (`needsYou.ts`): new kind `rebase` ranked after `failed`, action `Open` (selects the
  branch panel), `what` = `Rebase of <branch> failed` / `needs you`, `detail` = reason.
- Notification: `agentnotify.HandleRuns` titles a `purpose rebase` run `Rebase <done|failed|needs
  you> · <task>`; body already uses `Summary` (= reason).

### 2.8 Not done

- No automatic rebase, no prompt when a base moves (requirement 2).
- Merge, archive, stage and start dialogs keep TUI delivery.
- No mobile web exposure (not in the mobile write allowlist).
- `ade_sessions.purpose` stays `''` for rebase sessions (its CHECK would need a table rebuild); the
  session view finds the run by `runId`.

## 3. Wire and storage

- Migration `apps/kira-space/internal/storage/migrations/0026_p241_rebase.sql` (renumber if A or C
  landed a 0026):
  ```sql
  ALTER TABLE ade_task_branches ADD COLUMN base_branch_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE ade_runs ADD COLUMN purpose TEXT NOT NULL DEFAULT '' CHECK (purpose IN ('', 'rebase'));
  ALTER TABLE ade_runs ADD COLUMN spec_json TEXT NOT NULL DEFAULT '';
  ALTER TABLE ade_runs ADD COLUMN outcome_json TEXT NOT NULL DEFAULT '';
  CREATE INDEX ade_runs_branch_purpose ON ade_runs (branch_id, purpose);
  ```
- `model.AdeTaskBranch.BaseBranchID`; `model.AdeRun.{Purpose, SpecJSON, OutcomeJSON}`;
  `AdeRunPatch.Outcome *string`; `model.AdeRunOutcome`, `model.AdeRebaseSpec` with JSON helpers.
- `repos/adetask.go`: column lists, scans, inserts; `SetBranchBase(id, base, baseBranchID)`;
  `LatestRebaseRun(branchID)`; `CountRuns` variant for rebase attempts; `RecoverRunning` returns
  purpose so `Recover` can patch.
- `adewire/wire.go` + `frontend/src/ade/v2/wire.ts` (same keys): `BaseChoice`,
  `CreateTaskArgs.bases`, `AddTaskRepoArgs.base`, `SetBranchBaseArgs`, `OntoArgs`, `RebaseArgs`,
  `RebasePreview`, `RebaseBlocker`, `RebaseStart`, `RepoBranchesArgs`, `RepoBranches`,
  `RunOutcome`, `BranchShas`, `Run.purpose`, `Run.outcome`, `Branch.baseMissing`,
  `Branch.rebaseInProgress`. Contract change under the P143 rule 1: additive only; record it in
  the result. `wire_test.go` keeps parity.
- `frontend/src/bridge/index.ts`, `tests/ui/support/ipcChannels.ts`, `tests/ui/support/mockRuntime.ts`
  (if it lists methods): 5 new methods.

## 4. Files (ownership: this phase, one implementer)

Go:

| File | Change |
|---|---|
| `apps/kira-space/internal/storage/migrations/0026_p241_rebase.sql` | new |
| `apps/kira-space/internal/storage/model/adetask.go` | fields, outcome and spec types |
| `apps/kira-space/internal/storage/repos/adetask.go` | columns, new queries |
| `apps/kira-space/internal/ade/base.go` | new: `BaseChoice` handling, `validateBase`, `SetBranchBase`, `RepoBranches` |
| `apps/kira-space/internal/ade/board_facts.go` | `resolveBaseRef`, `baseMissing`, `rebaseInProgress` |
| `apps/kira-space/internal/ade/board_writes.go` | `CreateTask` bases, `AddTaskRepo` base, `queueCycle` follows `BaseBranchID` |
| `apps/kira-space/internal/ade/setup.go` | `startPoint` via resolver |
| `apps/kira-space/internal/ade/review.go` | base via resolver |
| `apps/kira-space/internal/ade/runs.go` | `superviseAgent` kind switch, `agentOutcome` builds `RunOutcome`, rebase gate in `launch`/`launchHeldLocked`, `RetryRun` refusal, `prepareWorktrees` parent order |
| `apps/kira-space/internal/ade/rebase.go` | new: `RebasePreview`, `Rebase`, `completeRebase`, `AbortRebase`, stack |
| `apps/kira-space/internal/ade/rebaseprompt.go` | new: `composeRebasePrompt` |
| `apps/kira-space/internal/ade/rebaseverify.go` | new: `verifyRebase`, `decideRebaseOutcome` |
| `apps/kira-space/internal/ade/rebaseverify_test.go` | new: decision table (4.2) |
| `apps/kira-space/internal/ade/launches.go` | `finishableRun`/`applyTUIFinish` rebase path, start message rebase line |
| `apps/kira-space/internal/ade/vars.go` | `promptInput` rebase lines |
| `apps/kira-space/internal/ade/recover.go` | rebase rows failed + restart outcome |
| `apps/kira-space/internal/ade/board.go` | `recordFinish` signature, `Start` re-verifies recovered rebases, `RunOutcomes` for the tool |
| `apps/kira-space/internal/ade/agenttools.go` | `RunOutcome` tool implementation (`SpaceTools` gains it) |
| `apps/kira-space/internal/adeagent/mcp.go` | `finish_step` fields, `Finish`, `run_outcome` registration on run and Space grants |
| `apps/kira-space/internal/adeagent/space.go` | `RunOutcome` types, tool, name list |
| `apps/kira-space/internal/adeagent/suffix.go` | `RebaseReportSuffix`, `RunOutcomeTool` |
| `apps/kira-space/internal/adeagent/mcp_test.go` | existing tests adjusted to the new `FinishFunc` only |
| `apps/kira-space/internal/gitsession/{worktree.go or entry.go}` | `WorktreeInProgress`, `WorktreeAbort` |
| `apps/kira-space/internal/bridge/adewire/wire.go`, `wire_test.go` | types |
| `apps/kira-space/internal/bridge/adetask.go`, `adetask_validate.go` | 5 methods, validation |
| `apps/kira-space/internal/agentnotify/agentnotify.go` | rebase title |
| `apps/kira-space/internal/flowharness/fakeagent/fakeagent.go` | record MCP tool results to `<KIRA_FAKE_DIR>/mcp-<tool>-<n>.json` |
| `apps/kira-space/internal/flows/adeflow/{base_test,rebase_test}.go` | new (4.1) |
| P236 gate's `coverage/exempt.txt` | untouched: the 5 methods are covered by 5.1 |
| `apps/kira-space/internal/realclaude/ade_test.go` | `TestAdeRebaseRun` (4.4) |

Frontend (`apps/kira-space/frontend/src/`):

| File | Change |
|---|---|
| `ade/v2/wire.ts` | types |
| `bridge/index.ts` | 5 methods |
| `ade/v2/queries.ts` | `useRepoBranches`, `useRebasePreview`, `useRebase`, `useAbortRebase`, `useSetBranchBase` |
| `ade/v2/AdeBasePicker.vue` | new |
| `ade/v2/AdeAddPopover.vue` | base rows |
| `ade/v2/board/rebaseActions.ts` | new shared rule |
| `ade/v2/board/actions.ts` | tag rules use it; rebase outcome, in-progress, base-missing rules |
| `ade/v2/board/fixMenu.ts`, `ade/v2/panel/headerActions.ts` | via `rebaseActs` |
| `ade/v2/board/taskMenu.ts`, `ade/v2/plan/useTaskMenu.ts` | `Change base…` |
| `ade/v2/board/needsYou.ts` | `rebase` kind |
| `ade/v2/dialog/compose.ts` | `changeBase` kind, preview-driven rebase template, `rebaseMessage` removed |
| `ade/v2/dialog/flow.ts` | `sendRebase` headless, `saveBase` |
| `ade/v2/dialog/AdeClaudeDialog.vue` | picker, suffix block, blockers, autostash, send label |
| `ade/v2/state/adeDialogs.ts` | `act`, `changeBase`, `abortRebase`, preview wiring |
| `ade/v2/plan/{AdeTaskCard,AdeBranchRow,AdeActionCell}.vue` | dispatch through `act` |
| `ade/v2/panel/AdeBranchPanel.vue` | header via `act`, `AdeRebaseOutcome` |
| `ade/v2/panel/AdeRebaseOutcome.vue` | new |
| `ade/v2/needs/useNeedsAction.ts` | `rebase` kind |

Tests and docs:

| File | Change |
|---|---|
| `apps/kira-space/tests/ui/ade-v2-base-rebase.spec.ts` | new (4.3) |
| `apps/kira-space/tests/ui/ade-v2-dialogs.spec.ts` | rebase cases move to headless send (assert `Rebase` call, not `Send`/`StartBranch`) |
| `apps/kira-space/tests/unit/ade-v2-dialog.spec.ts` | delete rebase-template cases (template moved to Go); keep busy/headless block cases |
| `apps/kira-space/tests/fixtures/ade-v2/{board,repo-branches,rebase-preview}.json` | Go-generated fixtures updated/added via the existing fixture generator |
| `docs/ARCHITECTURE.md` | base model, rebase runs, outcome, `run_outcome` |
| `docs/DEV_ENVIRONMENT.md` | P237 table row "ADE runs and sessions" adds `TestAdeRebaseRun` |
| `docs/v2.2/SPEC.md` | status, result |

## 5. Tests

Unit-test bar (CLAUDE.md): one Go table test only, for `decideRebaseOutcome` (agent claim x five
git checks x exit kind: a decision structure too large to hold in one's head). Everything else is
flow-level.

### 5.1 Go flow tests (`internal/flows/adeflow`, real git, real temp repos, fake `claude`)

Fake scripts: `fakeagent.Action{Sh: "...", MCP: [{tool: "finish_step", args: {...}}], Name: ...}`
running real git in the worktree. Helpers: `cloneWithMain`, `commitIn`, `gitOut`, `waitRun`
(extended to find a run by id), `logText`, `fakeFile`.

`base_test.go`:

1. `CreateTask` with `bases: {repo: {ref: "develop"}}` (remote-only `develop`), `StartRun` with a
   `done` fake: the new branch's merge-base with `origin/develop` is `develop`'s tip; board
   `base == "develop"`, ahead/behind against it.
2. Stacked draft: task with two branches in one repo, B `base_branch_id` = A; `StartRun` creates A
   first; B starts at A's tip; board `baseBranchId == A`.
3. Cross-task draft parent refused with `is not created yet`.
4. `SetBranchBase` on a created branch refused; on a draft accepted.
5. Refusals: self, other repo, cycle (A on B, then B on A), unknown ref.
6. Base deleted: `git branch -D develop` + remote ref delete, refresh: `baseMissing true`;
   `Rebase` refused with `no longer exists`.
7. Base renamed: rename `develop` to `dev`: `baseMissing true`; `Rebase` with `Onto {ref: dev}`
   clears it.

`rebase_test.go` (every case asserts run `purpose rebase`, state, outcome fields, shas, log):

1. Done, verified: main moves (non-conflicting), fake `Sh: git fetch origin && git rebase
   origin/main` + `finish_step done`: `done`, `Verified`, `before != after`, `onBase`, branch
   behind 0 on the board, prompt file contains `git rebase origin/main` and the report suffix.
2. Claimed done, not rebased: fake only `finish_step done`: `failed`, source `verify`, reason
   `... is not on top of ...`.
3. Conflict left in progress: conflicting commit on main; fake `Sh: git rebase origin/main || true`
   + `finish_step failed` with `conflictedFiles`: `failed`, `RebaseInProgress true`,
   `ConflictedFiles` from git and agent; board `rebaseInProgress true`. Then `AbortRebase`: no
   rebase in progress, tip == `before`, outcome `Aborted true`, log line `aborted by you`.
4. Claimed done with rebase in progress: fake leaves conflict + `finish_step done`: `failed`,
   source `verify`, reason `a rebase is still in progress`.
5. No report: fake rebases cleanly, `nofinish`: `failed`, reason starts `no report`, facts show
   `onBase true`.
6. Crash: fake `fail` (exit 1): `failed`, `no report: claude exited with status 1`, `LastError`
   set.
7. Timeout: run with a test-shortened `rebaseTimeout` (package var) and fake `sleep`: `failed`,
   source `timeout`.
8. Blocked: `finish_step needs_input` with reason: state `stuck`, outcome `blocked`.
9. Idempotent: fake calls `finish_step failed` then `finish_step done` after a clean rebase: last
   wins, `done`; a `finish_step` from a second fake process holding the released config fails.
10. Restack: A on main, B stacked on A; main moves; rebase A: B rebased with
    `--onto A <A before>` (prompt line asserted), both `onBase`, B contains no duplicate of A's old
    commits (`git log --oneline` count).
11. Change base: A on main, `Rebase{Onto: {ref: develop}}`: base stored before the run (board
    during the run), A on top of `develop` after.
12. Queue: `QueueWith` a review branch: `QueuedAfter` set, `Do not modify` in prompt.
13. Dirty worktree: refused with `dirty` blocker in preview; with `Autostash`, prompt has
    `--autostash`, run succeeds, dirty file kept.
14. Busy: a running step run on the branch: `Rebase` refused. Rebase running, then the workflow
    advances to a step on that branch: step run held `waiting for rebase`, launches after.
15. No-op: branch already on base: `{noOp: true}`, no run row.
16. Stop: `StopRun` mid-run (`sleep` fake after a conflicting `git rebase`): `failed`, source
    `user`, `RebaseInProgress true`.
17. Restart: run left `running` in the DB, `Recover` + `Start`: `failed`, source `restart`, facts
    filled.
18. `run_outcome`: after case 3, a step run's fake calls `run_outcome {purpose: rebase}`; the
    recorded result JSON lists the failed rebase with reason and conflicted files. A run of another
    task never sees it.
19. Prompt context: the next step run's prompt file contains `Last rebase of <branch> failed`.
20. Take over: `TakeOver` the failed rebase session, then a `finish_step done` through the TUI
    grant (fake MCP call against the launch's config) after the test completes the rebase in git:
    outcome `done`, `Verified`.

P236's coverage gate then names `SetBranchBase`, `RebasePreview`, `Rebase`, `AbortRebase`,
`RepoBranches` in flow tests.

### 5.2 Go unit

`rebaseverify_test.go`: one table over `decideRebaseOutcome`.

### 5.3 Playwright UI spec `tests/ui/ade-v2-base-rebase.spec.ts`

Mocked bridge with Go-generated fixtures (`board.json` variants, `repo-branches.json`,
`rebase-preview.json`); assert calls via `control.log()`.

1. New task: pick two repos, set repo 2's base to `develop` in `ade-base-picker`;
   `adeTaskCreateTask` called with `bases`.
2. Picker excludes self and descendants (disabled with hint).
3. Branch behind a `develop` base: tag action reads `Rebase onto develop` (not main); click opens
   the dialog with the preview prompt; no session chips; send label `Run in background`;
   `ade-dialog-send` calls `adeTaskRebase` with `message: ''`; an edit sends the edited text.
4. Same action from the branch header and the fix menu: same label, same call (consistency).
5. Change base on a created branch: pick `develop`, preview refetched with `onto`, suffix block
   read-only, send calls `adeTaskRebase` with `onto`.
6. Change base on a draft: no prompt, `Save base` calls `adeTaskSetBranchBase`.
7. Dirty blocker shows the autostash switch; send disabled until it is on.
8. Running run on the stack: action disabled with the tip.
9. Failed rebase run in the board fixture: tag `✕ rebase failed`, panel `Last rebase` shows
   reason, conflicted files, shas; `Abort rebase` asks confirm, then calls `adeTaskAbortRebase`;
   `Retry` reopens the dialog (no direct call); `Copy for agent` writes the clipboard.
10. Needs-you lists `Rebase of <branch> failed`; `Open` selects the branch.
11. No dialog or popup opens on board load or on a `RunsChangedEvent` that moves a base
    (requirement 2): push `event-runs.json` with a rebase run, assert `ade-dialog` count 0.

### 5.4 Opt-in real claude (P237 suite)

`apps/kira-space/internal/realclaude/ade_test.go` gains `TestAdeRebaseRun`, extending P237's
**"ADE runs and sessions"** row (`docs/DEV_ENVIRONMENT.md` table, `-run 'TestAdeHeadlessRun|
TestAdeStageSession|TestAdeRebaseRun'`). Haiku, P237's per-test 0.10 USD guard. Two subtests:

- clean: main moved, no overlap; default prompt; expect `done`, `Verified`.
- conflict: one-line conflict in one file; expect either `done` + `Verified`, or `failed`/`blocked`
  with non-empty `ConflictedFiles`; never `done` with a failed check, never a silent no-report.

The implementer runs it once at the end; no other real `claude` spend. No probe needed for
planning: the fake covers the MCP contract.

### 5.5 Checks

Per commit: `go build ./...` (+ `-tags server`), golangci-lint, `pnpm` typecheck, biome lint,
`lint:dead`. Once at the end: `test:flows:space`, `go test ./apps/kira-space/internal/{ade,
adeagent,gitsession,bridge/...}`, the new UI spec plus `ade-v2-dialogs`, `ade-v2-panel`,
`ade-v2-plan`, `ade-v2-task-menu`, `ade-v2-review-open`, `ade-v2-run`, `ade-v2-force-push`,
`test:unit`, `test:e2e-real:space` (ADE specs), the realclaude row.

Commits (Conventional, one per group): storage; base model; outcome + MCP; rebase engine + bridge;
flow tests + fake; frontend wire/queries; picker + new task; dialog + buttons + outcome surfaces;
UI spec; notifier title; realclaude test + DEV_ENVIRONMENT row; docs + SPEC result.

## 6. Overlap and ordering

- **Stream A (P236)** owns `ade/v2/**`, `flows/**`, `flowharness/**`, `tests/e2e-real/**` and
  `tests/ui/ade-v2-panel.spec.ts`. P241 edits most of those trees. **P241 waits for A to land.**
- **Stream C (P238, P239)** owns `internal/agentnotify/**` (P241 edits `agentnotify.go`),
  `docs/ARCHITECTURE.md` (P241 adds facts) and `tests/fixtures/**` (P241 adds ADE fixtures).
  `ade/tracker.go` and `appwire/**` are not edited (`adeagent.NewServer` lives in `ade/board.go`).
  **P241 waits for C to land.**
- **Stream B (P237)** landed. P241 edits `realclaude/ade_test.go` and the `DEV_ENVIRONMENT.md` row;
  no conflict left.
- **P240** edits `plan/AdeTaskCard.vue`, `plan/AdeBranchRow.vue`, `panel/AdeBranchPanel.vue`,
  `board/taskMenu.ts`, `plan/useTaskMenu.ts`, all edited here too, and P241 reuses P240's
  `board/reviewCode.ts` `baseNameOf`. **P241 runs after P240 is implemented and committed.** Row
  order already says so.
- Migration number: `0026` assumes nobody else added one; renumber at implementation if A, C or
  P240 did (P240 is frontend only).

## 7. Orchestrator verification checklist

- [ ] `rg -n "purpose IN \('', 'rebase'\)" apps/kira-space/internal/storage/migrations` hits the
      new migration; `rg -n "base_branch_id" apps/kira-space/internal/storage` hits migration and repo.
- [ ] Headless, not TUI: `rg -n "startBranch|deliver\(|turns\.watch" apps/kira-space/frontend/src/ade/v2/dialog/flow.ts`
      shows no use inside `sendRebase`; `rg -n "adeTaskRebase\b" apps/kira-space/frontend/src`
      shows `queries.ts` and a caller in `flow.ts`.
- [ ] One template: `rg -n "rebaseMessage" apps/kira-space/frontend/src` is empty;
      `rg -n "composeRebasePrompt" apps/kira-space/internal/ade` shows definition plus callers in
      `RebasePreview` and `Rebase`.
- [ ] Engine path: `rg -n "purpose.*rebase|AdeRunPurposeRebase" apps/kira-space/internal/ade/runs.go`
      shows the `superviseAgent` switch; `rg -n "advanceLocked|decideSendBack" apps/kira-space/internal/ade/rebase.go` empty.
- [ ] Verification: `rg -n "is-ancestor|WorktreeInProgress" apps/kira-space/internal/ade/rebaseverify.go`.
- [ ] MCP: `rg -n "\"run_outcome\"|ConflictedFiles" apps/kira-space/internal/adeagent` shows the
      tool and the `finish_step` fields; `rg -n "RunOutcomeTool" apps/kira-space/internal/ade` shows
      it in `allowedTools`.
- [ ] Buttons share one rule: `rg -n "rebaseActs" apps/kira-space/frontend/src/ade/v2` hits
      `actions.ts`, `fixMenu.ts`, `headerActions.ts`; `rg -n "'rebaseMain'|'rebaseOnto'" apps/kira-space/frontend/src/ade/v2` empty.
- [ ] No popup: `rg -n "openDialog|dialogs\.(open|rebase|act)" apps/kira-space/frontend/src/ade/v2`
      shows only click handlers, none in a `watch`/event handler; UI spec case 11 passes.
- [ ] P233: `git diff <base>..HEAD -- apps/kira-space/internal | rg -n "settings\.json|\.claude\.json"`
      shows no write path; P237 `TestRealClaudeSettingsUntouched` row still green if run.
- [ ] New bound methods covered: P236 gate green in `test:flows:space`; `exempt.txt` unchanged.
- [ ] Counts: `rg -c "^func Test" apps/kira-space/internal/flows/adeflow/{base,rebase}_test.go`
      gives 7 and 20 (subtests allowed); UI spec has 11 tests.
- [ ] Frontend rules: no `<style>` and no Options API in touched `.vue`; new components
      `<script setup lang="ts">`; `package.json`/`pnpm-lock.yaml`/`go.mod` unchanged.
- [ ] Builds and suites in 5.5 green; every commit's hooks green, no `--no-verify`.
- [ ] Real check: `KIRA_REAL_CLAUDE=1 CGO_ENABLED=1 go test -tags realclaude ./apps/kira-space/internal/realclaude/ -run TestAdeRebaseRun -v -timeout 15m`
      passes; the result section quotes the spend line.
- [ ] Codegraph: the implementer is executing a named plan, no call required; any reviewer later
      needs real `codegraph_explore` calls.
- [ ] SPEC P241 `Done`, result filled; `docs/ARCHITECTURE.md` has the base model and outcome facts.

## 8. Open questions for the user

1. A failed rebase after Change base keeps the new base (the branch then shows behind it with
   `Rebase onto <new>`, `Abort rebase` restores the old tip). Alternative: revert the base on
   failure. Plan keeps it.
2. No report but git shows a clean, complete rebase: plan follows your rule (`failed`, `no
   report`) with a facts line saying git shows it rebased. Alternative: `done` with a warning.
3. Base resolution becomes remote-first everywhere (it already is for the board's behind count);
   a new branch then starts from `origin/develop` rather than a stale local `develop`. OK?
4. Rebase timeout 20 minutes, Claude's default model. Make either a setting?
5. Merge and archive dialogs still deliver to a TUI. Move them to headless too, as a later phase?
