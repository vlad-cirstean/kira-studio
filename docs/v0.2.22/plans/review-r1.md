# v0.2.22 code review, round 1

Base: `4f27707` ("v0.2.21 (#16)"). No review findings or fix close-out commit exists after it.
Head: `9513915`. Scope: `git diff 4f27707..HEAD`, phases P396-P402.

Owned area: `apps/kira-space/internal/ade/{taskbranches,archive,archived,board_writes,board,review,agenttools,base}.go`,
`storage/repos/adetask.go`, migrations 0052/0053, settings model/repo, `mobileweb` archived route,
`internal/shell` trace, `prompts/router.go`, ADE v2 panel/plan/archived/sessions/workflows UI,
`packages/workbench/src/components/pickers/*`, `lib/pickerOptions.ts`, git-ui `refOptions.ts` and picker callers.
One-hop callers checked: launch paths taking `taskMu` (StartBranch, TakeOver, LaunchStep, ClaimWorktree,
onSetupReady), `ensureWorktree`, `removeWorktree`, `stopTaskWork`, `resolveRepoHost`, `stepTargets`.

Counts: High 1, Medium 4, Low 7.

## High

### R1-H1 Change branch discards uncommitted work without a confirm

- File: `apps/kira-space/frontend/src/ade/v2/panel/AdeTaskBranchForm.vue:40-48`,
  `apps/kira-space/internal/ade/taskbranches.go:183`, `apps/kira-space/internal/ade/archive.go:269-272`.
- What: "Change branch" on a created row calls `SetTaskBranch` directly. `detachRow` then runs
  `removeWorktree`, which passes the confirm token on a `dirty` preflight and force-removes the worktree.
  Only the Remove items (`AdeTaskBranchMenu.remove`) read `TaskBranchRisk` and confirm.
- Failure: user edits files in `feat/a`, opens the row menu, picks "Change branch", selects `feat/b`.
  The uncommitted edits in the `feat/a` worktree are deleted with no prompt. SPEC P397 says a dirty or
  unmerged worktree asks confirm.
- Fix: for a non-draft row, read `TaskBranchRisk` before `submitBranch` and run the same
  blocked/confirm path as `remove()`; share one helper. Defence in depth: give `SetTaskBranch`,
  `RemoveTaskBranch` and `RemoveTaskRepo` a `discardChanges` flag and refuse a dirty worktree without it.

## Medium

### R1-M1 Row edits ignore a running prepare script

- File: `apps/kira-space/internal/ade/taskbranches.go:20-57` (`editableRow`), `:61-79` (`detachRow`).
- What: the guard checks TUI sessions, pending launches, runs, rebases and automation claims, not
  `b.setupLive`. `ArchiveTask` cancels and awaits setups first (`archive.go` `stopTaskWork`); detach does not.
- Failure: a branch is attached, its prepare script (`npm install`) is running. User removes the
  branch or changes it. `git worktree remove` deletes the directory under the script; the script keeps
  writing (can recreate a stray directory at the old path), then records its result on the archived
  row and calls `onSetupReady` for a branch no longer on the task.
- Fix: in `editableRow`, refuse while `setupLive[row.ID]` exists ("a prepare script is running on
  %s"), or cancel and await it the way `stopTaskWork` does before removing the worktree.

### R1-M2 Review-kind rows on a normal task get a menu that always fails, and become permanent

- File: `apps/kira-space/internal/ade/taskbranches.go:35-37`, `:171-176`;
  `apps/kira-space/internal/ade/board_writes.go` `resolveExisting` (kind from `resolveKind`);
  `apps/kira-space/frontend/src/ade/v2/panel/AdeTaskTab.vue:222-223`.
- What: `editableRow` refuses every row whose kind is review. `SetTaskBranch` (existing) and the
  draft fill in `attachExistingBranch` keep the resolved kind, so picking a branch whose tip author
  is someone else writes a review-kind row into a mine task. The UI hides the menu only for review
  tasks, not review rows.
- Failure: user picks a colleague's branch for a repo row. The row turns review-kind. Every later
  Change branch / Remove branch / Remove repo returns "a review branch cannot change". The row can
  never leave the task except by archiving the whole task.
- Fix: decide one rule and apply it on both sides. Either let detach handle review-kind rows of a
  non-review task (they usually have no worktree), or attach as mine/parked inside an existing
  task. Hide or disable the menu items the backend will refuse.

### R1-M3 Pinned review sessions are shared by name with later tasks

- File: `apps/kira-space/internal/ade/review.go:264-274` (`closeReviewWindows`),
  `apps/kira-space/internal/ade/archived.go:134-155` (`archivedComments`).
- What: archive no longer unpins or purges review sessions. Sessions are keyed by (git repo id,
  branch name), not by task. Detach and archive both free the name for reuse.
- Failure: task A on `feat/login` is archived with 6 review comments. Later task B creates or attaches
  `feat/login` again. B's review opens A's session with A's comments; comments made on B show in A's
  archived panel as if A had them.
- Fix: snapshot the comments into ADE storage at archive/detach (like the change-request snapshot) and
  read the archived view from that; or tag the session with the task id and start a fresh session when
  a live task takes a name whose pinned session belongs to an archived one. Minimum: filter archived
  comments by `CreatedAt <= archivedAt`.

### R1-M4 Open archived panel refetches host data on every board push

- File: `apps/kira-space/frontend/src/ade/v2/readSignals.ts:33`,
  `apps/kira-space/frontend/src/ade/v2/readQueries.ts` `useArchivedTask` (no `staleTime`),
  `apps/kira-space/internal/ade/archived.go:60-74`.
- What: every `onBoard` invalidates all `archivedKey` queries. Each refetch of `ArchivedTask` runs
  `resolveRepoHost` per repo (host API calls, up to 5 s each) and reads review comments. `notifyBoard`
  fires on run, setup, session and debounced repo changes.
- Failure: archived panel open while agents run on other tasks: dozens of GitHub/GitLab requests per
  minute for data that cannot change (the task is archived), eating the host rate limit the live board
  also needs. Same cost per phone GET of `/api/ade/archived-task`.
- Fix: drop the board-push invalidation of `archivedKey` (restore already invalidates it; archive of
  the selected task only changes `board.history`). Give `useArchivedTask` a `staleTime` (for example 60 s).
  Optionally split the live-PR lookup into its own query so the stored part never hits the host.

## Low

### R1-L1 Detach with a replacement drops dependents instead of re-pointing them

- File: `apps/kira-space/internal/storage/repos/adetask.go:488-495` (`DetachBranch`).
- What: branches with `queued_after = old.ID` are freed and branches with `base_branch_id = old.ID`
  fall back to a name, even when a replacement takes the same row.
- Failure: branch X is queued after repo row R (not created). User fills R via Add branch (the P397
  fix path). X silently loses its queue order.
- Fix: when `replacement != nil`, point `queued_after` and `base_branch_id` at `replacement.ID`
  (for a draft fill at least), and keep the fallback only for a true removal.

### R1-L2 Restore leaves the Archived tab selecting a live task

- File: `apps/kira-space/frontend/src/ade/v2/panel/AdeArchivedPanel.vue:93-101`,
  `apps/kira-space/frontend/src/ade/v2/queries.ts:442`.
- What: after restore, `archive.selectedTaskId` still holds the task, and the invalidated archived
  query refetches and gets "task is not archived".
- Failure: restore from the Archived tab, later return to it: the panel shows an error for a task that
  is not in the list.
- Fix: `archive.select(null)` on success when the selection is this task; `removeQueries` for this
  task's archived key instead of invalidating it.

### R1-L3 Archived comment kind and state render raw

- File: `apps/kira-space/frontend/src/ade/v2/panel/AdeArchivedPanel.vue:283-284`.
- What: `{{ c.kind }}` and `{{ c.state }}` print wire enum values, not catalog text.
- Fix: map both through catalog keys (the review UI's existing labels where they exist).

### R1-L4 Archived data now grows without bound, undocumented

- File: deleted `ade/logpurge.go` and `AdeLogsRepo.PurgeArchived`; `apps/kira-space/internal/ade/board.go:516`
  (`toWireHistory` over all archived tasks and branches on every board read).
- What: by SPEC P399 nothing is purged. Each log keeps a 2 MiB tail, but the number of logs, pinned
  review sessions and history rows grows forever, and every board read and push carries the whole history.
- Failure: a long-lived install accumulates GBs in `ade_logs` and a slower board read; no user control exists.
- Fix: add a `docs/ARCHITECTURE.md` "Known open items" entry naming the growth. Consider a user action
  to delete an archived task (cascades logs) and a paged history read for the Archived tab.

### R1-L5 Change-request snapshot is never cleared and skips detached rows

- File: `apps/kira-space/internal/ade/archive.go:192-211`, `storage/repos/adetask.go:1312-1331`.
- What: `SetBranchChangeRequests` writes only rows the host answered for; old `cr_*` values stay.
  Rows detached before archive never get a snapshot.
- Failure: restore, the PR is deleted or the remote renamed, archive again: the archived view shows the
  old PR as "as of archive". A removed row's PR is lost when the host is unreachable.
- Fix: clear `cr_*` for the task's rows in the same transaction before writing; snapshot best effort in
  `detachRow` too.

### R1-L6 Worktree removed before the detach transaction

- File: `apps/kira-space/internal/ade/taskbranches.go:61-79`.
- What: `removeWorktree` runs before `DetachBranch`; a failing transaction (for example
  `ErrBranchOnTask` from a racing attach of the replacement name) leaves the row live with its
  worktree gone. `ensureWorktree` recreates it on next launch, so recovery exists.
- Fix: run the DB transaction first, then remove the worktree (log a removal failure), or recreate
  the worktree on transaction failure.

### R1-L7 Remove confirm lists every dirty path

- File: `apps/kira-space/frontend/src/ade/v2/panel/AdeTaskBranchMenu.vue:88`.
- What: the confirm message joins every `risk.dirty` path into one string.
- Failure: a worktree with 3000 untracked build files produces an unreadable, very tall dialog.
- Fix: show the first N paths plus "and N more", like other risk summaries.

## Notes (not findings)

- P396 row is still Todo by design (Stage B needs the user's Mac trace). Chapter close P403 must
  resolve or re-scope it with the user. The `window raise` and `prompt raise` Info lines are trace
  aids; remove or drop them to Debug when the fix lands.
- `apps/kira-space/internal/storage/model/settings.go:59` still says "No UI reads them yet"; the Plan
  reads `historyDays`, `offDays` and the rest. Fix the comment while touching that file.

## Dimensions with nothing real

- Migrations 0052/0053: additive nullable columns and a delete of two retired leaves, run once by
  version; no ordering, idempotence or data-loss problem.
- Lock order: `attachExistingBranch` now takes task then repo mutex, matching `RequestBranch`,
  `SetTaskBranch` and archive; no holder of a repo mutex takes a task mutex.
- `RestoreTask`: name-conflict check and the partial unique index agree; one transaction.
- Phone route `/api/ade/archived-task`: read-only, id validated in the bridge, no worktree paths.
- Later band and midnight: `today` recomputes on the minute tick from local time; window keys and
  Later ordering (`LATER = 9999`) sort correctly.
- Shared pickers: filter and cap are linear and capped at 50 rendered rows; per-repo candidate keys
  with `staleTime: 0` refetch on open. No duplicate picker helpers left (`AdeBasePicker`,
  `AdeCandidateRow`, `BaseSelector`, `ReviewBranchPicker`, `SORTABLE_CHOSEN_CLASS` all gone).
- Security: nothing found.
