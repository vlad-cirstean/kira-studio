# v0.2.17 code review, round 1

Base: `e2938bbd13e7f810c6dabecce44ae3821886f91a` (tag `v0.2.16`; no earlier review session in git).
Scope: `git diff v0.2.16 HEAD`, P349-P355, 169 files. Ranked by severity.

Areas with nothing real found: P349 icon and `verify-packaging.sh` S15/A7; P350 `collapseRuns`
(`projectLayoutInput` folds the oldest row's edges into the placeholder); P351 `ToolbarSeparator`
and U104; P353 `CreateTask` day, estimate, archive confirm; P354 `Focus`
unhide via `InvokeSync` (Wails runs inline on the main thread, no deadlock), forward/copy,
`lockTarget`; P355 `BranchChip`/`branchParts`. Removed code (`RangeCommits`, `AdeChangesTab`,
`AdeReviewCompose`, `askReviewAgent.ts`, `ErrEstimateShrink`, i18n keys) leaves no orphan caller.

## R1-1 High: idle prune deletes another repo's in-progress backfill

- Where: `apps/kira-space/internal/storage/repos/githostchangerequests.go:161-164`
  (`PruneIdle`), with `apps/kira-space/internal/gitsession/crsync.go:426-434` (`prepare`) and
  `crsync.go:499-535` (`backfill`).
- Defect: `PruneIdle` drops every repo except `keep` where
  `max(last_full_sync_at, last_delta_at, last_checks_at) < before`. A fresh backfill persists its
  state after every page with all three times `0`. `LastFullSyncAt` is only set on completion. So a
  repo mid-backfill always counts as idle.
- Failure: repo B starts its first backfill (large repo, many runs; R1-2 stretches it to hours).
  User opens repo C. C's first run calls `PruneIdle(now-30d, keyC)` and deletes B's rows and sync
  state. If B's run is in flight, B's next `PutSyncState` rewrites the state with its cursor. The
  backfill then finishes `BackfillComplete=true` without the pages read before the prune: the
  newest-updated PRs. The watermark is already past them, so deltas never re-read them. The index
  reports `complete`, and the UI shows "no PR" for those branches (`#applyIndex` treats a missing
  branch as none). If B is between runs instead, B restarts from page 1 (wasted budget).
- Fix: stamp an activity time on every `PutSyncState` (or treat `backfill_complete = 0 AND
  backfill_cursor <> ''` as active) and prune on that. Simplest: prune by
  `max(synced_at)` of the repo's rows, or add `updated_at` to `git_host_sync_state` written on each
  put (new migration).

## R1-2 Medium: backfill continuation is blocked by MinGap, runs every 5 or 15 min

- Where: `apps/kira-space/internal/gitsession/crsync.go:230-233` (`loop`), `174-183` (`tick`),
  `210` (`trigger`).
- Defect: a run that stops at `PageCap` sets `more`; `loop` arms the timer for `ContinueDelay`
  (5s). `tick` then calls `trigger(false)`, which refuses while `now-lastStart < MinGap` (30s).
  `lastStart` is the run's start, and a 10-page run via `gh` takes roughly 10-20s, so the refusal
  hits. `tick` then re-arms with `waitLocked`, the full `FocusedInterval` (5 min) or
  `BlurredInterval` (15 min).
- Failure: backfill reads 1000 PRs per 5 min focused, per 15 min blurred. A 10k-PR repo stays
  `complete=false` for about 50 min to 2.5 h. Per-branch host lookups keep running all that time,
  and R1-1's exposure window grows. The flow harness sets `Disabled` and `MinGap: 1ns`, so no test
  exercises the production timer path.
- Fix: let a continuation bypass MinGap (for example `trigger(continuation bool)` skips the gap when
  `more` was set), or arm `max(ContinueDelay, MinGap - now.Sub(lastStart))`.

## R1-3 Medium: index fills `byBranch` with every historical PR head, so merged PR heads in history get graph badges

- Where: `packages/git-ui/src/state/changeRequests.ts:252-268` (`#applyIndex`), fed by
  `apps/kira-space/internal/gitsession/crsync.go:722-759` (`ChangeRequestIndex`, every same-owner
  row ever, closed and merged included).
- Defect: before P352, `byBranch` held only branches the UI asked about (existing refs). Now it
  holds every head branch in the repo's PR history, including deleted branches of merged PRs.
  `changeRequestsHeadedAt` (`changeRequests.ts:623`) badges any row whose sha equals a `byBranch`
  record's `headSha`. `rowHasBadges` (`packages/git-ui/src/lib/columns.ts:406-415`) then gives that
  row the taller badge height.
- Failure: in a merge-commit workflow repo, every merged PR's head commit is in main's history.
  Each one gets a `#N merged` badge and a taller row along the whole loaded history. Before P352,
  none did, and its own doc says badges sit on branch tips. `rebuildAncestry` also seeds from every
  one of those heads on each rebuild.
- Fix: limit `byBranch` to branch names that exist in refs (local or remote), or to open PRs plus
  existing branch names. Filter server-side (ref inventory) or client-side against `RefsState`
  before assignment.

## R1-4 Medium: whole index re-sent and re-diffed on every `changeRequestsChanged`

- Where: `apps/kira-space/internal/gitsession/crsync.go:722-759`,
  `apps/kira-space/internal/gitrpc/changerequests.go:49-70`, `changeRequests.ts:228-268`.
- Defect: `branch.changeRequestIndex` reads every same-owner row of the repo (full history) and
  sends up to 5 records per branch. The client uses only `changeRequests[0]`. Every sync run that
  changes a row emits `changeRequestsChanged`: each backfill run, each delta with a change, each
  checks refresh. The client then re-fetches everything and runs `sameRecords` (`JSON.stringify`
  per record, twice).
- Failure: a 20k-PR repo sends a payload of several MB, about 20k branches, after every run during
  backfill (each 5s once R1-2 is fixed) and after each delta later. Each payload means a SQLite
  full scan, Go JSON encoding, socket transfer, a JS parse and a Map rebuild on the UI thread.
- Fix: send one record per branch, the only one read (drop the `maxBranchChangeRequests` list
  from the wire, or cap it at 1). Apply R1-3's filter server-side so only relevant branches
  travel. Optionally coalesce events to one per run end (already the case) and skip
  intermediate backfill runs until `complete`.

## R1-5 Low: delta overflow falls back to a full-history re-walk

- Where: `apps/kira-space/internal/gitsession/crsync.go:568-573` (`delta`), `499-535` (`backfill`).
- Defect: a delta that hits `PageCap` before the watermark sets `BackfillComplete=false` with
  `BackfillCursor=walk.cursor`. The following `backfill` runs page to the end of history. It never
  stops at the old watermark, although everything older is already ingested.
- Failure: after more than 1000 PR updates between syncs (a busy monorepo after a week offline),
  the app re-reads the repo's whole history. That costs GraphQL budget, and the index stays
  incomplete for the whole walk.
- Fix: keep the pre-delta watermark in the sync state (for example `delta_floor`). Let the resumed
  walk use `deltaStop` against that floor and mark complete once it is reached.

## R1-6 Low: blame line re-runs on every change request sync

- Where: `apps/kira-space/frontend/src/views/repo/blameLine.ts:227-235`.
- Defect: its `repo.changed` listener does not filter `kind`, so it handles the new
  `changeRequestsChanged` too. Each one clears the blame cache and re-runs `refresh()`, a git
  blame, though host data cannot change blame. Every other listener filters `refsChanged`, and
  `repoScopedReload.ts` skips this kind.
- Fix: return early on `event.kind === 'changeRequestsChanged'`, or listen for `refsChanged` and
  `worktreeChanged` only.

## R1-7 Low: `raise` seam and test restate a 4-line body (test bar)

- Where: `internal/shell/registry.go:159-172` (`focuser`, `raise`),
  `internal/shell/registry_internal_test.go`.
- Defect: the `focuser` interface and the `raise(onMain, unhide, w)` indirection exist only so the
  test can assert call order. The test restates the function body. CLAUDE.md's unit test bar
  excludes "anything that mostly restates a short function body".
- Fix: inline the calls back into `Focus` as `application.InvokeSync(unhideApp)` then
  `Show`/`UnMinimise`/`Focus`, keep a one-line why-comment, and delete the test and the `focuser`
  seam.

## R1-8 Low: inline title edit can clear title of task with no Jira key

- Where: `apps/kira-space/frontend/src/ade/v2/panel/AdeTaskPanel.vue:55-61` (`allowEmpty: true`),
  `apps/kira-space/internal/ade/board_writes.go:164-188` (`UpdateTask`).
- Defect: `CreateTask` rejects a task with no title and no Jira key ("a task needs a title or a
  Jira key"). `UpdateTask` trims the title but never checks that invariant. The panel's new title
  edit allows empty.
- Failure: user clears the title of a task without a Jira key. The save succeeds. The task now
  shows a fallback label, a state `CreateTask` forbids. `ClearJira` on a task with empty title
  reaches the same state.
- Fix: in `UpdateTask`, read the stored task and reject `invalid("a task needs a title or a Jira
  key")` when the resulting title and Jira key are both empty. Set `allowEmpty` only when the task
  has a Jira key, so the inline error shows before commit.
