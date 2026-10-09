# P241 plan iter2: task base branch, Change base, headless rebase with reported outcome

SPEC row P241. Re-plan of `P241-plan.md` against `v2.0` at `50c00573d` (P236-P240, P242 Part 1, P244
landed). Supersedes iter1; iter1 stays as history.

User's words, condensed: set the base of a new task and change it on a started one; a button next to
the task, no popup beyond the agent prompt shown first (as every ADE step); rebase done by headless
Claude (resolves conflicts); the agent reports done or failed with a reason to the kira-ade MCP, shown
to the user and passable to another agent.

Decisions already taken (user):

1. A failed, blocked or cancelled Change base keeps the new base. The branch shows `base changed,
   rebase pending` with Retry and Abort rebase.
2. Base resolution is remote-first: `origin/<base>` when it exists, else local `<base>`. Everywhere.
3. A branch whose base no longer resolves adds a `base missing` reason to P240's review rule.
4. Every base label renders through P240's `VarText` (`packages/theme`), so variable values are marked.
5. The stored outcome embeds the shared `runoutcome.Outcome`; no parallel outcome type.

Base: one sequential Sonnet implementer (storage, engine, MCP, bridge, UI are one order-dependent
chain). Stream relation to P243 Part 1, P243 Part 2 and P245 in section 8.

Discovery: `codegraph_explore` over the run outcome flow (`runoutcome.ForProcess`, `scriptruns`,
`agentOutcome`, `recordOutcomeLocked`) and the frontend rebase symbols. The index covers
`internal/**` and `packages/**`; `apps/kira-space/**` is not indexed (queries for
`superviseAgent`, `resolveBase`, `rebaseSpec` returned only other apps), so these were read directly:
`ade/{runs,live,launches,recover,board,board_facts,board_writes,setup,review,gitfacts}.go`,
`adeagent/{mcp,space,suffix}.go`, `bridge/{adetask.go,adewire/wire.go}`, `storage/model/adetask.go`,
migrations `0015`, `0026`, `agentnotify/agentnotify.go`, `flowharness/fakeagent/fakeagent.go`,
`flows/{adeflow/helpers_test.go,coverage/coverage_test.go}`, `realclaude/ade_test.go`; frontend
`ade/v2/{board/{actions,fixMenu,reviewCode,baseMarker,taskMenu,needsYou}.ts,panel/headerActions.ts,
dialog/{compose,flow}.ts,state/adeDialogs.ts,plan/AdeTaskCard.vue,wire.ts}`,
`packages/theme/src/{varText.ts,components/VarText.vue}`,
`packages/workbench/src/automations/runs/RunOutcomeBlock.vue`, `packages/shared/domain/runOutcome.ts`.

## 1. Deltas vs iter1 (what the current tree changed)

- **Outcome exists now.** P242 Part 1 landed `internal/runoutcome.Outcome` (`status done|failed|
  blocked|cancelled`, `reason`, `source agent|exit|timeout|start|user|restart`, `reported`,
  `exitCode`, `lastError`, `summary`), `ForProcess` (one wording source, incl. `no report: ...`),
  `ade_runs.outcome_json` (migration `0026`), `model.AdeRun.Outcome`, wire `Run.outcome`, TS
  `packages/shared/domain/runOutcome.ts`. Iter1's own `RunOutcome` struct, its synthesis table and the
  `outcome_json` column are dropped. P241 embeds `runoutcome.Outcome` (2.4) and adds one source,
  `verify`.
- **Stop is `cancelled`, not failed.** `stopOutcome` (`live.go`) gives `cancelled`/`user`/`stopped by
  you`, run state `stuck`. Restart gives `failed`/`restart`, state `stuck` via `RecoverRunning`. Rebase
  runs keep both paths unchanged; iter1's "patch recovered rebases to failed" is dropped.
- **Migration number** is `0027` (`0026` is P242's).
- **Real claude budget** is `--max-budget-usd 0.05` per test (DEV_ENVIRONMENT), not iter1's 0.10.
- **Copy for agent** uses `copyOrReportError` (`@workbench/util/clipboard`) like `RunOutcomeBlock.vue`;
  P242 Part 1 declined VueUse `useClipboard` with a stated reason in that util. P241 follows it.
- **Base-changed indicator** is new (user decision 1): persisted `base_pending_from` column, not
  derived from the run list.
- **Base missing** feeds P240's `reviewChoice` and the new tag rules (user decision 3).
- **VarText** labels for every base name (user decision 4); `rebaseActs` returns `TextPart[]`.
- **Remote-first** is fixed (user decision 2), not an open question. A new resolver, not a change to
  `resolveQueuedRef` (local-first is right for a branch's own name).
- **`run_outcome`** is shaped so P242 Part 2 ("`run_outcome` in Space") extends it to smart-script runs
  without a contract break (`kind` filter, 2.5).
- Iter1's open questions 1 and 3 are answered; 2, 4 and 5 stay as fixed choices (section 9).

## 2. Design

### 2.1 What exists today (verified)

- `ade_task_branches.base` (short name, `''` = main) and `queued_after` exist. No write path sets
  `base`; `CreateTaskArgs` has none.
- Three base resolvers with different order: `boardCtx.resolveBase` (`board_facts.go:82`: main, live
  planner branch by name, remote, local), `startPoint` (`setup.go:222`, via `resolveQueuedRef`: local
  first), `reviewSpellings` (`review.go:45`, local first).
- Rebase buttons: board tags (`actions.ts` `rebaseConflicts`, behind rule, `queueAfter`), branch panel
  header (`headerActions.ts` `rebaseMain`/`rebaseOnto`/`queueAfter`), row fix menu (`fixMenu.ts`
  `rebaseMain`/`rebaseOnto`). `specForBranchAction` maps `target ''` to `'main'`: a `develop`-based
  branch gets "Rebase onto main" (bug, fixed here).
- `flow.sendRebase` delivers `compose.rebaseMessage` into a TUI (`deliverToBranch`), `turnWatch` on
  `Stop`, then `SetQueuedAfter`. No verification, no outcome.
- `finish_step(status, summary)`; `FinishFunc(runID, status, summary)`; `recordFinish` stores the last
  call, `agentOutcome` applies it at exit; `finishState` maps `needs_input` to `blocked`/`stuck`.
- `agentnotify.HandleRuns` titles `ADE run <state> · <task>`.

### 2.2 Base model

On the branch row:

- `base` (existing): short ref name, `''` = repo main.
- `base_branch_id` (new): a live planner branch of the same repo it stacks on (any task, may be a
  draft). When set, `base` also holds that branch's name (`''` while it is a draft), so review,
  archive and a deleted parent keep a ref name.
- `base_pending_from` (new): display name of the previous base while a Change base on a created branch
  has not been completed by a verified rebase. `''` otherwise.
- `queued_after` unchanged (merge order after a review branch, Queue after).

One resolver `resolveBaseRef(sc, sb) baseRef` (`board_facts.go`), used by the board, `startPoint`,
`reviewSpellings` and the rebase engine:

1. `base_branch_id` names a live created branch: that branch's tip, `branchID` set.
2. `base_branch_id` names a live draft: unresolved, `reason parentDraft`.
3. `base` `''` or the main short name: main.
4. `base` names a live planner branch of the repo by name: that branch (today's rule).
5. `findRemoteRow(inv, remote, base)` (remote-first), else the local row.
6. Nothing: unresolved, `reason baseMissing`.

New `resolveBaseRow(inv, short, remote)` in `gitfacts.go` (remote then local) serves rules 5 and the
two git-ref callers. `resolveQueuedRef` stays for the branch's own name.

Wire `Branch` gains `baseMissing bool`, `basePendingFrom string`, `rebaseInProgress bool`.

Validation, `validateBase(tc, sb, choice)` in new `ade/base.go`, on every write:

- `choice.BranchID == sb.ID` or `choice.Ref == sb.Name`: `a branch cannot be its own base`.
- other repo: `the base must be a branch of the same repo`.
- cycle: `queueCycle` follows `BaseBranchID` first, then `QueuedAfter`, then `Base` by name:
  `that base would form a cycle (<name> is stacked on this branch)`.
- `choice.Ref`: `git check-ref-format --branch`, and present locally or on the default remote, else
  `branch "<x>" not found in <repo>`.

Writes:

- `CreateTaskArgs.Bases map[codeRepoId]BaseChoice` (missing = main). `AddTaskRepoArgs.Base *BaseChoice`.
- `SetBranchBase({branchId, base})`: draft branches only (`name == ''`). On a created branch:
  `the branch exists: use Change base, which rebases it`.
- Created branches change base only through `Rebase` with `Onto` (2.3).
- `StartRun`'s worktree prepare creates same-task draft parents first (topological by
  `base_branch_id`). A draft parent on another task: `base <name> is not created yet: start its task
  first`.

### 2.3 Headless rebase through the run engine

A rebase is an `ade_runs` row, `purpose 'rebase'`, `stage_id ''`, `step_id 'rebase'`, outside the
workflow. Reused for free: run log (`logsink`), headless session row, Stop, Take over, restart
recovery, `RunsChangedEvent`, P238 notification. `stage_id ''` never matches a stage, so `plan()`,
`progress.ts` and step views skip it; `HasRunning`/`HasRunningOn` count it (stage moves, `StartBranch`,
archive already wait).

Bound methods (`AdeTaskService`, `bridge/adetask.go`, validated in `adetask_validate.go`):

```go
type BaseChoice struct{ Ref, BranchID string } // both '' = repo main
type OntoArgs struct {
    BranchID  string      // branch to rebase; its created mine descendants restack after it
    Onto      *BaseChoice // nil = current base; set = Change base
    QueueWith string      // review branch id: rebase onto it, set QueuedAfter (Queue after)
    Push, Autostash bool
}
type RebaseArgs struct{ OntoArgs; Message string } // Message '' = default prompt
func (s *AdeTaskService) RebasePreview(ctx, OntoArgs) (adewire.RebasePreview, error)
func (s *AdeTaskService) Rebase(ctx, RebaseArgs) (adewire.RebaseStart, error)
func (s *AdeTaskService) AbortRebase(ctx, adewire.BranchArgs) error
func (s *AdeTaskService) SetBranchBase(ctx, adewire.SetBranchBaseArgs) error
func (s *AdeTaskService) RepoBranches(ctx, adewire.RepoBranchesArgs) (adewire.RepoBranches, error)
```

`RebasePreview` returns `{prompt, suffix, stack: [{branchId, name, worktree, ontoRef}], blockers:
[{branchId, kind, text}], noOp}`. Blocker kinds: `dirty` (cleared by `Autostash`), `running` (run on a
stack branch), `inProgress` (rebase/merge in progress: Abort first), `baseMissing`, `parentDraft`,
`noWorktree` (informational: the gate creates it), `setup` (prepare running: existing "Starts when
ready" wait via `ErrSetupPending`).

`Rebase` (`ade/rebase.go`, new), under the task mutex:

1. Load `tc`. Branch live, `mine`, created; task not archiving, not a review task.
2. Onto: `QueueWith` (same repo, cycle-checked) | `Onto` (`validateBase`) | current base via
   `resolveBaseRef`. Unresolved: refuse with the reason.
3. Stack: branch plus created `mine` descendants, depth first; child = live branch whose
   `base_branch_id`, else `queued_after`, else `base` name points at the parent.
4. Per stack branch: no `running`/`pending` run (`a background run is working on <name>`);
   `launchGate` worktree (may return `ErrSetupPending`); no in-progress operation (2.7); clean unless
   `Autostash`. TUI busy stays a client alert with Override (today's behaviour; `tracker.go` untouched).
5. Record `ontoTipBefore` and each stack branch's `before` tip.
6. No-op (branch contains onto tip, each child contains its parent tip): store the base change, clear
   `base_pending_from`, return `{noOp: true}`. No run.
7. Store the base change. Created branch with `Onto`: `base`, `base_branch_id`, and
   `base_pending_from = <old base display>` unless already set (keeps the first pending origin).
   `QueueWith`: `SetQueuedAfter`.
8. Insert run (`purpose rebase`, attempt = prior rebase runs on the branch + 1, `spec_json` =
   `RebaseSpec{OntoRef, OntoName, OntoTipBefore, ChangeBase bool, Stack[{BranchID, Name, Worktree,
   ParentRef, Before}], Push, Autostash}`), insert headless session row, launch.

Launch: `superviseAgent` gains a purpose switch (no copy). For `rebase`: grant `{RunID, TaskID,
Space: false}`; allowed tools `Bash(git:*)`, `Read`, `Edit`, `Write`, `Grep`, `Glob`, `FinishStepTool`,
`RunOutcomeTool`; cwd = branch worktree; `rebaseTimeout = 20 * time.Minute` (package var, flow test
shortens it); setting sources as step runs (P233: `--mcp-config` temp file only). At exit it calls
`completeRebase` instead of `agentOutcome` + `recordOutcomeLocked`: no send-back, no `advanceLocked`.
Then `launchHeldLocked` per stack branch (2.6) and `notifyBoard`.

Prompt, server-owned, `ade/rebaseprompt.go` `composeRebasePrompt(spec)`. The dialog shows exactly
this (prompt shown first). `compose.rebaseMessage` is deleted: one template.

```
Rebase <branch> (repo <nick>) onto <ontoName>[, then restack the branches built on it:]
1. In <wt>: git fetch <remote> && git rebase [--autostash ]<ontoRef>
2. In <childWt>: git rebase [--autostash ]--onto <parent> <parentBefore>
[Do not modify <reviewBranch>.]
Resolve any conflicts by editing the files, then git add and git rebase --continue.
<"Then push each rebased branch with git push --force-with-lease" | "Do not push.">
```

Children use `--onto <parent> <parentBefore>` so the parent's old commits are not replayed. Fixed
`adeagent.RebaseReportSuffix`, appended to edited messages too, shown read-only under the textarea:

> When you are finished, call finish_step. status "done" only when every branch above is rebased and
> no rebase is in progress. status "failed" with reason, conflictedFiles, lastGitError and tried when
> you could not finish; leave a rebase in progress only when you could not resolve it, and say so.
> status "needs_input" with your question when you need a decision. Kira Space checks the result in
> git.

`RetryRun` refuses `purpose rebase` (`retry from the Rebase button: it shows the prompt first`). UI
Retry reopens the dialog with the run's spec.

### 2.4 Outcome: embed `runoutcome.Outcome`

`internal/runoutcome/outcome.go`: add `SourceVerify Source = "verify"`. TS
`runOutcome.ts` enum gains `'verify'`. Nothing else in the shared package changes.

`finish_step` gains optional fields; agent-facing statuses unchanged (workflows and
`FinishStepSuffix` keep working):

```go
type finishArgs struct {
    Status          string   `json:"status"`
    Summary         string   `json:"summary"`
    Reason          string   `json:"reason,omitempty"`          // why it failed / what is needed
    ConflictedFiles []string `json:"conflictedFiles,omitempty"`
    LastGitError    string   `json:"lastGitError,omitempty"`
    Tried           string   `json:"tried,omitempty"`
}
type Finish struct { Status, Summary, Reason string; ConflictedFiles []string; LastGitError, Tried string }
type FinishFunc func(runID string, f Finish)
```

Bounds: summary/reason/tried 1 KiB, lastGitError 4 KiB, conflictedFiles 200 x 1 KiB; over: tool error
naming the field. `FinishStepSuffix` gains one clause: `If it failed, give the reason.`

Stored outcome, `model.AdeRunOutcome` in `storage/model/adetask.go`, replaces `*runoutcome.Outcome` on
`model.AdeRun` and wire `Run.Outcome`:

```go
type AdeRunOutcome struct {
    runoutcome.Outcome                       // embedded: JSON keys unchanged, old rows decode as-is
    Report *AgentReport `json:"report,omitempty"` // finish_step extras: conflictedFiles, lastGitError, tried
    Rebase *RebaseFacts `json:"rebase,omitempty"`
}
type RebaseFacts struct {
    Verified, InProgress, Aborted bool
    OntoRef, OntoTip              string
    ConflictedFiles               []string // from git (agent's list stays in Report)
    Branches                      []BranchShas // {branchId, name, before, after, onBase}
    Pushed                        *bool
}
```

`finishState`: `Reason = cmpNonEmpty(f.Reason, f.Summary, fallback)`. Run `state` vocabulary unchanged
(done, failed, `stuck` for blocked/cancelled). `Run.Summary` stays the summary; notifier body uses
`outcome.reason` when set.

No report: existing `runoutcome.ForProcess` wording (`no report: Claude ended without calling
finish_step`, `no report: claude exited with status N`, `no report: timed out after 20m`, `could not
start: ...`), git facts attached. A no-report run whose git checks pass stays `failed` (user rule);
the panel's facts line says `git shows it rebased`.

Verification, `ade/rebaseverify.go` `verifyRebase(ctx, spec) RebaseFacts`, after every rebase exit
(report or not), after Abort, after Take-over finish, and in `Start` for rebase rows `Recover` left
`stuck`/`restart`. Per stack branch, in its worktree:

1. In-progress operation (2.7).
2. Unmerged paths from `WorktreeStatus`.
3. `HEAD` is `refs/heads/<name>`.
4. `merge-base --is-ancestor <ontoTipBefore> <tip>` (root); child: parent's `after`.
5. With `Push`: upstream equals new tip.

`decideRebaseOutcome(f *Finish, facts, end runoutcome.Process) AdeRunOutcome` (pure):

- agent `done`, checks pass: `done`, `Verified`.
- agent `done`, a check fails: `failed`, source `verify`, reason names the first failure
  (`verification failed: a rebase is still in progress in <wt>` / `<name> is not on top of <onto>` /
  `HEAD is detached in <wt>` / `<name> was not pushed`).
- agent `failed`/`needs_input`: that status (`blocked` for needs_input), agent reason, facts attached.
- no report: `ForProcess` outcome, facts attached.

`completeRebase`: writes outcome once (ignores a run no longer `running`); clears
`base_pending_from` on every stack branch only when the outcome is `done` + `Verified`. Last
`finish_step` wins (existing map); a call after release fails `no run behind this call`.

Take over: `finishableRun` accepts the latest rebase run of the branch; `applyTUIFinish` routes
`purpose rebase` through verify + decide.

### 2.5 Passable to another agent: `run_outcome`

- New MCP tool `run_outcome` on every grant with a `TaskID` (headless step, rebase, TUI with run or
  Space). Task-scoped. Args `{runId?, branch?, kind?: 'rebase'|'step', limit? 1..10}`; returns the
  task's runs newest first: `{runId, kind, stage, step, repo, branch, state, finishedAt, outcome}`
  (`outcome` = `AdeRunOutcome` JSON). Never another task's runs. P242 Part 2 adds `kind: 'script'`.
- `adeagent.Outcomes` interface (`RunOutcomes(ctx, taskID string, q OutcomeQuery) ([]RunOutcomeEntry,
  error)`), passed to `NewServer` next to `SpaceTools`; `TaskBoard` implements it in `agenttools.go`.
- `RunOutcomeTool` constant in `suffix.go`; added to `allowedTools` (step and rebase) and to
  `prepareWithGrant`'s list.
- Prompt context: `composePrompt` and the start message add one line per task branch whose latest
  rebase run ended not `done`: `- Last rebase of <branch> <failed|needs input|was stopped>: <reason>
  (run <id>; call run_outcome for details)`.
- UI "Copy for agent" on the outcome block: reason, source, conflicted files, last git error, tried,
  shas, run id, as plain text (`copyOrReportError`).

### 2.6 Gate: no step run on a branch being rebased

`launch()` and `launchHeldLocked` keep a run `pending`, note `waiting for rebase`, while a rebase run is
running on its branch; `completeRebase` releases them. `Rebase` refuses while a step run is
`running`/`pending` on the stack.

### 2.7 Worktree in-progress read and Abort rebase

- `gitsession.RepoEntry.WorktreeInProgress(ctx, path)`: `git -C <path> rev-parse --absolute-git-dir`,
  then `gitops.ReadInProgressStateFiles` + existing classifier. Board `computeBranch` sets
  `rebaseInProgress` for branches with a worktree (one extra call beside `WorktreeStatus`).
- `gitsession.RepoEntry.WorktreeAbort(ctx, path)`: same classifier, `gitops.AbortArgs(kind)` with
  `-C <path>` (rebase, merge, cherry-pick).
- `AbortRebase({branchId})`: refuses while a run is `running` on the branch (`stop the run first`);
  `no rebase is in progress in <wt>` when none; aborts; log line `aborted by you` on the latest rebase
  run; patches its `Rebase.Aborted true, InProgress false` (state unchanged); emits runs;
  `notifyBoard`. **Never reverts the base** (decision 1): `base_pending_from` stays. To go back, Change
  base to the previous base (the picker lists it first as `Previous base`, 2.8); a no-op or verified
  rebase onto it clears the pending mark. Works with no run too (hand-started rebase).

### 2.8 UI

Rules: `<script setup lang="ts">`, Tailwind utilities only, shadcn-vue primitives from
`@theme/components/ui` (`popover`, `command`, `switch`, `alert`, `button`, `badge`), VueUse where a DOM
composable is needed, TanStack Query for the new reads and mutations in `ade/v2/queries.ts`, no new
Pinia store (dialog state stays in `adeDialogs`, selection in `adeBoardUi`). Every base name renders
as a `TextPart` `{name: 'base', value}` through `VarText`; menu hints use `ContextMenu`'s `TextPart[]`.

- **Shared rule** `ade/v2/board/rebaseActions.ts` (new, pure):

  ```ts
  export type RebaseAct =
    | { kind: 'rebase'; id: string; label: TextPart[]; branchId: string; onto: OntoChoice; tip: TextPart[]; disabled: boolean }
    | { kind: 'queue'; id: string; label: TextPart[]; branchId: string; withId: string; tip: TextPart[]; disabled: boolean }
    | { kind: 'changeBase'; id: string; label: TextPart[]; branchId: string; tip: TextPart[]; disabled: boolean }
    | { kind: 'abortRebase'; id: string; label: TextPart[]; branchId: string; tip: TextPart[]; disabled: boolean };
  export function rebaseActs(i: RebaseActInput): RebaseAct[];
  ```

  `rebase`: stack root behind its base, `conflictsIfRebased` non-empty, or `basePendingFrom` set
  (label `Retry rebase onto [base]`). Label `Rebase onto [base]` with `baseNameOf` (P240). Fixes the
  `develop` -> main bug. `rebase` onto the file-sharing `after` branch (today's `rebaseOnto`). `queue`:
  conflicting review branch. `changeBase`: every mine branch not merged, not parked. `abortRebase`:
  `rebaseInProgress`. Disabled with tip while a stack run is `running`/`pending`
  (`A run is working on [branch]`) or base missing for `rebase`.
  Consumers: `actions.ts`, `fixMenu.ts`, `headerActions.ts`, `taskMenu.ts`, the card button. One
  dispatcher `adeDialogs.act(a)`: `rebase`/`queue`/`changeBase` open the Claude dialog, `abortRebase`
  opens `AdeConfirmDialog` (an irreversible git action keeps its confirm; it is not a "base changed"
  popup).
- **Button near the task**: `AdeTaskCard.vue` head gets `ade-card-change-base` (`TooltipIconButton`,
  icon `git-branch`, tip `Change base of [branch] (now [base])`) beside Review code. One branch: opens
  the dialog. Several: a shadcn-vue `DropdownMenu` listing `repo · branch · [base]` (same shape as
  P240's picker). Branch row and branch panel header carry the same act via `rebaseActs`. Task
  context menu: `Change base…` item, submenu per branch when several.
- **Base picker** `ade/v2/AdeBasePicker.vue` (new): `Popover` + `Command` combobox over
  `RepoBranches({codeRepoId, branchId?})` (`{mainName, previous?, branches: [{name, local, remote,
  branchId, taskId, taskTitle, draft, excluded?: reason}]}`). Groups: `Previous base` (only with
  `basePendingFrom`), `Main`, `Planner branches` (task · branch; drafts labelled `not created`),
  `Branches`. Self and descendants shown disabled with the cycle reason. Items render via `VarText`.
  `data-testid="ade-base-picker"`, items `ade-base-option-<name>`.
- **New task** (`AdeAddPopover.vue`): one `Base` row per picked repo with the picker, default main.
  Sends `bases`.
- **Dialog** (`AdeClaudeDialog.vue`, `compose.ts` `DialogKind 'changeBase'`): picker at top for
  `changeBase`. Draft branch: picker only, button `Save base` (`SetBranchBase`). Created branch:
  message from `RebasePreview` (query key includes the pick: refetches), editable, read-only suffix
  block, blockers as `Alert`s, `Autostash` `Switch` only with a `dirty` blocker, push switch, busy
  alert as today, send label `Run in background`. `flow.sendRebase` calls the `Rebase` mutation and
  closes; no `deliverToBranch`, no `turnWatch`, no client `SetQueuedAfter`. `ade-dialog-send` testid
  unchanged. Merge, stage, start, archive stay TUI.
- **Indicator and tags** (`actions.ts`, first match, before `conflict`):
  - rebase run `running`: `⟳ rebasing` blue, `See log`.
  - `basePendingFrom` set: `⚠ base changed, rebase pending` amber, tip `Base changed from [old] to
    [new]. [reason of the last rebase, if any]`; actions `Retry rebase onto [new]`, `Abort rebase`
    (when `rebaseInProgress`), `See log`, `Take over` (when a stuck run exists).
  - latest rebase run `failed`/`stuck` without pending base: `✕ rebase failed` / `✋ rebase needs you`
    red, same actions with `Retry` reopening the dialog.
  - `rebaseInProgress` with no such run: `⚠ rebase in progress` amber, `Abort rebase`, `Start agent`.
  - `baseMissing`: `✕ base missing` red, tip `Base [x] no longer exists`, `Change base…`.
  - `baseMarker.ts` label and tip return `TextPart[]` and render via `VarText`; a pending base shows
    `⑂ [new]` with a dashed amber border.
- **P240 review rule** (`reviewCode.ts` `reviewChoice`): `baseMissing` returns disabled with
  `['Base ', base, ' no longer exists. Change the base first']`, checked after the draft rule.
- **Outcome block** `ade/v2/panel/AdeRunOutcome.vue` (new) in `AdeBranchPanel.vue` as `Last rebase`:
  status badge, reason, source, verified, conflicted files, last git error, tried, `before -> after`
  per branch, `rebaseActs` buttons, Copy for agent, `AdeRunLog`. Same block in the step run view for a
  failed step's `report` fields (conflictedFiles etc. optional).
- **Needs you** (`needsYou.ts`, `useNeedsAction.ts`): kind `rebase` after `failed`, `Open` selects the
  branch, `what` `Rebase of [branch] failed|needs you|pending`, `detail` reason.
- **Notification** (`agentnotify.HandleRuns`): `purpose rebase` titles `Rebase <done|failed|needs
  you|stopped> · <task>`; body = `outcome.reason` else summary.

### 2.9 Not done

- No automatic rebase and no popup when a base moves.
- Merge, archive, stage, start dialogs keep TUI delivery.
- No mobile exposure (not in `mobilewrite.go` allowlist).
- `ade_sessions.purpose` stays `''` for rebase sessions (CHECK would need a rebuild); the session view
  finds the run by `runId`.

## 3. Wire and storage

- `apps/kira-space/internal/storage/migrations/0027_p241_rebase.sql` (renumber if another lands first):
  ```sql
  ALTER TABLE ade_task_branches ADD COLUMN base_branch_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE ade_task_branches ADD COLUMN base_pending_from TEXT NOT NULL DEFAULT '';
  ALTER TABLE ade_runs ADD COLUMN purpose TEXT NOT NULL DEFAULT '' CHECK (purpose IN ('', 'rebase'));
  ALTER TABLE ade_runs ADD COLUMN spec_json TEXT NOT NULL DEFAULT '';
  CREATE INDEX ade_runs_branch_purpose ON ade_runs (branch_id, purpose);
  ```
- `model.AdeTaskBranch.{BaseBranchID, BasePendingFrom}`; `model.AdeRun.{Purpose, SpecJSON}`,
  `Outcome *AdeRunOutcome`; `AdeRunPatch.Outcome *AdeRunOutcome`; `AdeRebaseSpec`, `RebaseFacts`,
  `AgentReport`, `BranchShas`.
- `repos/adetask.go`: columns, scans, inserts; `SetBranchBase(id, base, baseBranchID, pendingFrom)`,
  `ClearBasePending(ids)`; `LatestRebaseRun(branchID)`; rebase attempt count; `RecoverRunning` returns
  purpose.
- `adewire/wire.go` + `frontend/src/ade/v2/wire.ts` (same keys): `BaseChoice`, `CreateTaskArgs.bases`,
  `AddTaskRepoArgs.base`, `SetBranchBaseArgs`, `OntoArgs`, `RebaseArgs`, `RebasePreview`,
  `RebaseBlocker`, `RebaseStart`, `RepoBranchesArgs`, `RepoBranches`, `AdeRunOutcome` (TS:
  `RunOutcome & {report?, rebase?}` from `@shared/domain/runOutcome`), `Run.purpose`,
  `Branch.{baseMissing, basePendingFrom, rebaseInProgress}`. Additive (P143 rule 1); record in result.
- `frontend/src/bridge/index.ts`, `frontend/bindings/**` (regenerated), `tests/ui/support/{ipcChannels,
  mockRuntime,adeV2}.ts`, `tests/unit/support/adeV2Fixtures.ts`: 5 methods.

## 4. Files (ownership: this phase, one implementer)

Go (`apps/kira-space/` unless rooted):

| File | Change |
|---|---|
| `internal/runoutcome/outcome.go` (repo root) | `SourceVerify` |
| `packages/shared/domain/runOutcome.ts` (repo root) | `'verify'` |
| `internal/storage/migrations/0027_p241_rebase.sql` | new |
| `internal/storage/model/adetask.go` | fields, `AdeRunOutcome`, spec and facts types |
| `internal/storage/repos/adetask.go` | columns, queries |
| `internal/ade/base.go` | new: `validateBase`, `SetBranchBase`, `RepoBranches` |
| `internal/ade/gitfacts.go` | `resolveBaseRow` |
| `internal/ade/board_facts.go` | `resolveBaseRef`, `baseMissing`, `basePendingFrom`, `rebaseInProgress` |
| `internal/ade/board_writes.go` | `CreateTask` bases, `AddTaskRepo` base, `queueCycle` |
| `internal/ade/setup.go` | `startPoint` via resolver, draft-parent order |
| `internal/ade/review.go` | base via resolver |
| `internal/ade/runs.go` | `recordFinish(Finish)`, `finishState` reason, purpose switch, gate, `RetryRun` refusal, `allowedTools` |
| `internal/ade/rebase.go` | new: `RebasePreview`, `Rebase`, `completeRebase`, `AbortRebase`, stack |
| `internal/ade/rebaseprompt.go` | new |
| `internal/ade/rebaseverify.go` | new: `verifyRebase`, `decideRebaseOutcome` |
| `internal/ade/rebaseverify_test.go` | new: decision table |
| `internal/ade/launches.go` | `applyTUIFinish(Finish)` + rebase path, `prepareWithGrant` tool, start message line |
| `internal/ade/vars.go` | prompt rebase lines |
| `internal/ade/board.go` | `NewServer` args, `Start` re-verifies recovered rebases, wire mapping |
| `internal/ade/agenttools.go` | `RunOutcomes` |
| `internal/adeagent/{mcp,space,suffix}.go` | `Finish`, `finish_step` fields, `run_outcome`, `Outcomes`, constants |
| `internal/adeagent/mcp_test.go` | adjust to new `FinishFunc` only |
| `internal/gitsession/worktree.go` | `WorktreeInProgress`, `WorktreeAbort` |
| `internal/bridge/adewire/{wire.go,wire_test.go}` | types, parity |
| `internal/bridge/{adetask.go,adetask_validate.go}` | 5 methods |
| `internal/agentnotify/agentnotify.go` | rebase title, reason body |
| `internal/flowharness/fakeagent/fakeagent.go` | record MCP results to `<KIRA_FAKE_DIR>/mcp-<tool>-<n>.json` |
| `internal/flows/adeflow/{base_test,rebase_test}.go` | new |
| `internal/flows/adeflow/helpers_test.go` | `waitRunID`, `cloneWithBranches` helpers |
| `internal/realclaude/ade_test.go` | `TestAdeRebaseRun` |

Frontend (`apps/kira-space/frontend/src/`):

| File | Change |
|---|---|
| `ade/v2/wire.ts`, `bridge/index.ts` | types, 5 methods |
| `ade/v2/queries.ts` | `useRepoBranches`, `useRebasePreview`, `useRebase`, `useAbortRebase`, `useSetBranchBase` |
| `ade/v2/AdeBasePicker.vue`, `ade/v2/AdeAddPopover.vue` | new picker; base rows |
| `ade/v2/board/{rebaseActions,actions,fixMenu,taskMenu,needsYou,reviewCode,baseMarker}.ts` | rule, tags, consumers |
| `ade/v2/panel/{headerActions.ts,AdeBranchPanel.vue,AdeRunOutcome.vue}` | via `rebaseActs`; outcome block (new) |
| `ade/v2/plan/{AdeTaskCard,AdeBranchRow,AdeActionCell}.vue`, `ade/v2/plan/useTaskMenu.ts` | card button, dispatch through `act`, VarText base marker |
| `ade/v2/dialog/{compose,flow}.ts`, `ade/v2/dialog/AdeClaudeDialog.vue` | `changeBase`, preview template, headless send |
| `ade/v2/state/adeDialogs.ts`, `ade/v2/needs/useNeedsAction.ts` | `act`, `changeBase`, `abortRebase`; `rebase` kind |

Tests and docs:

| File | Change |
|---|---|
| `apps/kira-space/tests/ui/ade-v2-base-rebase.spec.ts` | new |
| `apps/kira-space/tests/ui/{ade-v2-dialogs,ade-v2-review-open}.spec.ts` | rebase cases headless; base-missing review case |
| `apps/kira-space/tests/unit/ade-v2-dialog.spec.ts` | drop rebase-template cases |
| `apps/kira-space/tests/ui/support/{ipcChannels,mockRuntime,adeV2}.ts`, `tests/unit/support/adeV2Fixtures.ts` | methods, fixtures |
| `apps/kira-space/tests/e2e-real/ade-rebase-real.spec.ts`, `tests/e2e-real/support/ade.ts` | new spec; rebase scenario helper |
| `docs/ARCHITECTURE.md` | base model, rebase runs, outcome extension, `run_outcome` |
| `docs/DEV_ENVIRONMENT.md` | "ADE runs and sessions" row adds `TestAdeRebaseRun` |
| `docs/v2.2/SPEC.md`, `docs/v2.2/plans/P241-result.md` | status, result |

`flows/coverage/exempt.txt`: untouched, stays empty.

## 5. Tests

Unit bar (CLAUDE.md): one Go table test, `decideRebaseOutcome` (agent claim x five git checks x end
kind). Everything else is flow-level.

### 5.1 Go flow tests (`flows/adeflow`, P236 conventions)

Real git, real temp repos and bare remotes, default settings, fake `claude` via `fakeagent.Action{Sh,
MCP, Name}`; Sh snippets that may fail end with `|| true` (a failing Sh exits 4). Helpers: existing
`cloneWithMain`, `commitIn`, `gitOut`, `waitRun`, `logText`, `fakeFile`; new `waitRunID`,
`cloneWithBranches`.

`base_test.go` (7):

1. `CreateTask` with `bases {repo: {ref: develop}}`, `develop` remote-only: new branch's merge-base
   with `origin/develop` is its tip; board `base develop`, ahead/behind against it.
2. Remote-first: local `develop` stale, `origin/develop` ahead: new branch starts at `origin/develop`.
3. Stacked draft: B `base_branch_id` A, same task: `StartRun` creates A first, B starts at A's tip,
   board `baseBranchId A`.
4. Cross-task draft parent refused `is not created yet`.
5. `SetBranchBase`: created refused, draft accepted. Refusals: self, other repo, cycle, unknown ref.
6. Base deleted (local and remote): `baseMissing true`; `Rebase` refused `no longer exists`.
7. Base renamed to `dev`: `baseMissing`; `Rebase{Onto: dev}` clears it.

`rebase_test.go` (each asserts `purpose rebase`, state, `outcome` incl. `source`, `rebase` facts,
shas, log):

1. Done, verified: prompt file has `git rebase origin/main` and the suffix; `done`, `Verified`,
   board behind 0.
2. Claimed done, not rebased: `failed`, source `verify`, `is not on top of`.
3. Conflict left in progress + `finish_step failed` with reason and `conflictedFiles`: `failed`,
   `reason` = agent's, `report.conflictedFiles`, `rebase.inProgress`, board `rebaseInProgress`. Then
   `AbortRebase`: tip == before, `aborted`, log `aborted by you`.
4. Claimed done, rebase in progress: `failed`, `verify`, `still in progress`.
5. No report, clean rebase: `failed`, reason starts `no report`, facts `onBase`.
6. Crash (`fail`): `no report: claude exited with status 1`, `lastError` set.
7. Timeout (shortened `rebaseTimeout`, `sleep`): `failed`, source `timeout`.
8. `needs_input` with reason: state `stuck`, status `blocked`, reason.
9. Last finish wins; a call from a second process with the released config fails.
10. Restack A then B: B line `--onto A <A before>`, both `onBase`, no duplicated commits.
11. Change base done: base stored before the run (board mid-run shows `basePendingFrom main`); after
    verified done `basePendingFrom ''`, A on `develop`.
12. Change base failed: base stays `develop`, `basePendingFrom main`; `Rebase` retry (done) clears it;
    Change base back to main as no-op clears it too.
13. Queue: `QueuedAfter` set, `Do not modify` in prompt.
14. Dirty: preview `dirty` blocker; `Autostash` adds `--autostash`, dirty file kept.
15. Busy and gate: step run running refuses `Rebase`; step held `waiting for rebase`, launches after.
16. No-op: `{noOp: true}`, no run row.
17. Stop mid-run: `cancelled`, source `user`, state `stuck`, `rebase.inProgress`.
18. Restart: running row, `Recover` + `Start`: `failed`/`restart`, facts filled.
19. `run_outcome`: a step run's fake calls `run_outcome {kind: rebase}`; recorded result lists case 3's
    run with reason and files; a run of another task gets none.
20. Prompt context: next step prompt has `Last rebase of <branch> failed`.
21. Take over a failed rebase, test completes the rebase in git, TUI-grant `finish_step done`:
    `done`, `Verified`.
22. Step run `finish_step failed` with `reason`, `lastGitError`: outcome `reason` = reason,
    `report.lastGitError` set (the generic extension, not rebase only).

Coverage gate (`flows/coverage`): the 5 new bound methods are called by name in these files;
`exempt.txt` stays at 0 entries.

### 5.2 Go unit

`ade/rebaseverify_test.go`: one table over `decideRebaseOutcome`.

### 5.3 Playwright UI `tests/ui/ade-v2-base-rebase.spec.ts` (mocked bridge)

1. New task: two repos, repo 2 base `develop` via `ade-base-picker`: `CreateTask` gets `bases`.
2. Picker: self and descendants disabled with the cycle reason; `Previous base` group only with
   `basePendingFrom`.
3. Branch behind a `develop` base: tag action `Rebase onto develop` with a `var-chip[data-var=base]`;
   dialog shows preview prompt, read-only suffix, no session chips, `Run in background`; send calls
   `Rebase` with `message ''`; an edit sends the edited text.
4. Same act from header, fix menu, task menu: same label, same call.
5. Card button `ade-card-change-base`: one branch opens the dialog; two branches open the branch menu.
6. Change base, created branch: pick `develop`, preview refetched with `onto`, send `Rebase` with `onto`.
7. Change base, draft: `Save base` calls `SetBranchBase`, no prompt.
8. Dirty blocker shows Autostash; send disabled until on.
9. Running stack run: act disabled with tip.
10. `basePendingFrom` fixture: tag `base changed, rebase pending`, tip names old and new base as
    chips; `Retry rebase` opens the dialog; `Abort rebase` asks confirm then calls `AbortRebase`.
11. Failed rebase run: panel `Last rebase` shows reason, files, shas; Copy for agent writes clipboard.
12. Needs you lists the rebase; `Open` selects the branch.
13. `baseMissing`: tag `base missing`; Review code disabled with `no longer exists`.
14. No dialog opens on board load or on a `RunsChangedEvent` that moves a base: `ade-dialog` count 0.

### 5.4 e2e-real `tests/e2e-real/ade-rebase-real.spec.ts`

Real app server, real git, fake `claude` scenario (Sh runs real `git rebase`).

1. New task with base `develop` through the UI picker; run: branch starts at `origin/develop`.
2. Card `Change base` to `main` on the started task: dialog shows prompt; `Run in background`; fake
   rebases + `finish_step done`; board shows base main, no pending tag; `git merge-base` confirms.
3. Conflict scenario: fake leaves conflict + `finish_step failed`: tag `base changed, rebase pending`;
   panel reason; `Abort rebase` confirm: tag `rebase in progress` gone, pending tag stays, tip restored.

### 5.5 Real claude (P237, opt-in)

`realclaude/ade_test.go` `TestAdeRebaseRun`, row "ADE runs and sessions" becomes
`-run 'TestAdeHeadlessRun|TestAdeStageSession|TestAdeRebaseRun'`. Haiku, `--max-budget-usd 0.05` per
subtest, prompt from `composeRebasePrompt`:

- clean: main moved, no overlap: `done`, `Verified`.
- conflict (one-line, one file): `done` + `Verified`, or `failed`/`blocked` with non-empty
  `report.conflictedFiles` or `rebase.conflictedFiles`, or a `no report` failure on budget exhaustion.
  Never `done` with a failed check.

Run once at the end:

```
KIRA_REAL_CLAUDE=1 CGO_ENABLED=1 go test -tags realclaude ./apps/kira-space/internal/realclaude/ -run 'TestAdeHeadlessRun|TestAdeStageSession|TestAdeRebaseRun' -v -timeout 15m
```

Also run `-run TestRealClaudeSettingsUntouched` (P241 composes a new `claude` argv). Result quotes both
spend lines.

### 5.6 Checks

Per commit: `go build ./...`, `go vet`, `gofmt`, golangci-lint (P242 found it unusable here: record if
still so), `bun run lint`, `bun run typecheck`, `bun run lint:dead`. Once at the end:
`bun run test:flows:space` (includes coverage gate), `go test ./apps/kira-space/internal/{ade,adeagent,
gitsession,bridge/...,agentnotify}/... ./internal/runoutcome/...`, Space UI `ade-v2-*` plus
`automations-runs` (shared outcome schema), `test:unit`, `test:e2e-real:space` ADE specs, the 5.5 rows.

Commits (Conventional, per group): storage + runoutcome source; base model; finish_step + outcome +
`run_outcome`; rebase engine + bridge; fakeagent + flow tests; frontend wire/queries; picker + new
task; rule + buttons + dialog; outcome surfaces + indicator; UI spec; e2e-real; notifier; realclaude +
DEV_ENVIRONMENT row; docs + SPEC result.

## 6. Unchanged from iter1 on purpose

Server-owned prompt, `--onto` restack, purpose-switch in `superviseAgent`, pure decision function,
`AbortRebase` via worktree classifier, no Pinia store, TUI kept for merge/archive/stage/start.

## 7. Orchestrator verification checklist

- [ ] `rg -n "purpose IN \('', 'rebase'\)|base_pending_from|base_branch_id" apps/kira-space/internal/storage` hits migration and repo.
- [ ] Embedded outcome: `rg -n "runoutcome.Outcome$" apps/kira-space/internal/storage/model/adetask.go` shows the embedded field; `rg -n "type .*Outcome struct" apps/kira-space/internal` shows only `AdeRunOutcome` (no second status/reason/source struct).
- [ ] `rg -n "SourceVerify" internal/runoutcome apps/kira-space/internal/ade` hits definition and `rebaseverify.go`.
- [ ] Headless: `rg -n "deliverToBranch|turnWatch|setQueuedAfter" apps/kira-space/frontend/src/ade/v2/dialog/flow.ts` shows none inside `sendRebase`; `rg -n "adeTaskRebase\b|Rebase\(" apps/kira-space/frontend/src/ade/v2/queries.ts` hits.
- [ ] One template: `rg -n "rebaseMessage" apps/kira-space/frontend/src` empty; `composeRebasePrompt` defined and called by `RebasePreview` and `Rebase`.
- [ ] Engine: `rg -n "advanceLocked|decideSendBack" apps/kira-space/internal/ade/rebase.go` empty.
- [ ] MCP: `rg -n '"run_outcome"|conflictedFiles|lastGitError' apps/kira-space/internal/adeagent`; `RunOutcomeTool` in `runs.go` and `launches.go`.
- [ ] One button rule: `rg -n "rebaseActs" apps/kira-space/frontend/src/ade/v2` hits `actions.ts`, `fixMenu.ts`, `headerActions.ts`, `taskMenu.ts`; `rg -n "'rebaseMain'|'rebaseOnto'" apps/kira-space/frontend/src/ade/v2` empty.
- [ ] Button near task: `rg -n "ade-card-change-base" apps/kira-space/frontend/src apps/kira-space/tests` hits card and specs.
- [ ] VarText: `rg -n "name: 'base'" apps/kira-space/frontend/src/ade/v2/board` hits `rebaseActions.ts`, `baseMarker.ts`, `reviewCode.ts`.
- [ ] Remote-first: `rg -n "resolveBaseRow" apps/kira-space/internal/ade` hits `setup.go`, `review.go`, `board_facts.go`.
- [ ] No popup: dialog opens only from click handlers; UI case 14 green.
- [ ] P233: `git diff <base>..HEAD -- apps/kira-space/internal | rg -n "settings\.json|\.claude\.json"` shows no write path.
- [ ] Coverage gate green, `exempt.txt` empty (`wc -l` 0 or comment-only).
- [ ] Counts: `rg -c "^func Test|t.Run\(" apps/kira-space/internal/flows/adeflow/{base,rebase}_test.go` covers 7 and 22 cases; UI spec 14 tests; e2e-real 3.
- [ ] Frontend rules: no `<style>`, no Options API in touched `.vue`; `package.json`, lockfile, `go.mod` unchanged.
- [ ] Real check: 5.5 commands pass; result quotes spend.
- [ ] Hooks green on every commit, no `--no-verify`. SPEC P241 `Done`, result file written, ARCHITECTURE updated.

## 8. Overlap and ordering

Prior phases: P236 (Stream A), P238/P239 (Stream C), P240, P242 Part 1 have landed; P241 builds on
them, no wait left. Table order: P241 is the next `Todo` row above P242 Part 2.

**Beside P243 Part 1 (worktree `/home/user/kira-sH`, in flight).** Its files (plan section 5 and its
actual diff off `8aeb419d1`): `flows/{gitflow,reviewflow}/*`, `flowharness/stream.go`,
`tests/ui/repo-*.spec.ts`, `tests/ui/support/{gitStreamMock,gitUiPortFixtures}.ts`,
`packages/git-ipc/**`, `docs/DEV_ENVIRONMENT.md` (perf line, Kira Space git section), `SPEC.md`.

| Area | P241 | P243 Part 1 | Verdict |
|---|---|---|---|
| `flowharness/` | `fakeagent/fakeagent.go` | `stream.go` | disjoint |
| `flows/` | `adeflow` | `gitflow`, `reviewflow` | disjoint |
| `flows/coverage` | none (methods covered in `adeflow`) | none | disjoint, both keep 0 exemptions |
| `tests/ui/support` | `ipcChannels`, `mockRuntime`, `adeV2` | `gitStreamMock`, new fixture file | disjoint |
| `docs/DEV_ENVIRONMENT.md` | realclaude table row | perf line | **same file, different hunks** |
| `docs/v2.2/SPEC.md` | row, result | row, result | **same file, different lines** |

Verdict: **can run beside P243 Part 1** as two streams (cap 2 reached). No ordering dependency either
way; no runtime coupling (P243 Part 1 adds tests only). The two shared docs files are edited only in
each stream's closing docs commit; the second to land rebases onto `v2.0` and resolves the hunk. If
the orchestrator wants zero shared files, P241 defers its `DEV_ENVIRONMENT.md` row edit until P243
Part 1 has landed. P241 runs in its own worktree off `v2.0` `50c00573d` or later.

**Beside P243 Part 2: no.** Shared: `storage/migrations` (both take the next number), `storage/repos`,
`frontend/src/bridge/index.ts`, `frontend/bindings/**` (both regenerate), `tests/ui/support/{ipcChannels,
mockRuntime}.ts`, `docs/ARCHITECTURE.md`, `gitsession/worktree.go` (P241 adds two methods; Part 2
deletes prepare code there). Sequential; table order puts P241 first.

**Beside P245: file-disjoint on this plan's side.** P245 restyles `packages/git-ui/**` and the git
module's `kv:` indirection; P241 edits no `packages/git-ui` or `packages/theme` file (it only imports
`VarText` and existing shadcn-vue primitives). Risk: P245 changing shared theme tokens or
`VarText`/`ui/*` primitives would restyle P241's surfaces, not conflict. P245's own plan confirms its
file list against section 4. Table order still puts P242 Part 2/3, P243 and P244 rows before it; running
it early is the user's call.

**P242 Part 2 (later):** reads P241's `run_outcome` and `AgentReport`; adds `kind: 'script'`. P241
lands first per table order.

## 9. Fixed choices (no open questions left)

1. No report but git clean: `failed` with a facts line (user rule).
2. Rebase timeout 20 min, Claude's default model, not settings.
3. Merge and archive stay TUI; a later phase may move them.
4. Abort rebase never reverts the base; Change base back via `Previous base` clears the pending mark.
