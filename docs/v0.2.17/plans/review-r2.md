# v0.2.17 code review, round 2

Base: `e2938bbd13e7f810c6dabecce44ae3821886f91a` (tag `v0.2.16`), same as round 1. Head `80917390f`.
Scope: `git diff v0.2.16 HEAD`, P349-P355 plus round 1 fixer commits `62aa3cd81`..`80917390f`
(treated as unreviewed). Ranked by severity.

Checked, nothing real found:

- Migrations 0048/0049: up-only framework (`internal/sqlitex`), so no down step exists to break.
  0048 adds `updated_at NOT NULL DEFAULT 0` and backfills existing rows to now. 0049 adds
  `delta_floor DEFAULT 0`. Both apply cleanly to a DB at 47; `SyncState`/`PutSyncState` read and
  write the new columns.
- Contract 51: Go `ContractVersion` and TS `CONTRACT_VERSION` both 51. `BranchChangeRequest{name,
  changeRequest}` matches across `gitrpc/wire.go`, `contract.ts`, `index.ts`, `#applyIndex`,
  specs and fixtures. The shape change lands inside unreleased 51.
- `delta_floor` logic (`crsync.go:519-537`, `577-583`): cut at floor minus skew, cleared on
  completion, reset by an account/schema drop.
- New tests can fail: `TestChangeRequestIndexDeltaOverflowStopsAtFloor` reads 4 pages and stays
  incomplete without the floor. `TestGitHostChangeRequestsRepo_PruneIdleKeepsActiveBackfill` drops
  `b` without `updated_at`. `TestChangeRequestIndexSkipsDeletedMergedBranch` lists `gone` without
  the filter. `TestContinueWaitHonoursMinGap` fails if the MinGap term is dropped (see R2-4 for
  what it misses).
- `Focus` inline `InvokeSync(unhideApp)`: Wails `dispatchOnMainThread` runs inline on the main
  thread, so no deadlock.
- Blame `changeRequestsChanged` skip. `allowEmpty` getter: `useInlineEdit` reads `opts.allowEmpty`
  on each commit, so the getter takes effect.
- P349-P351, P353-P355 rest: no `<style>` blocks, Options API, TODOs or orphan callers in the diff.
- `flows/adeflow` under `-race` at ~654 s is not a failing check. No hook, `package.json` script
  or workflow passes `-race`. The configured run (`go test`, no `-race`) took 96 s here.

## R2-1 Medium: idle prune races another entry's first run and leaves an empty index marked complete

- Where: `apps/kira-space/internal/gitsession/crsync.go:417-442` (`prepare`: reads state, then
  prunes, `pruned` is per `crSyncer`), `crsync.go:461` (`PutSyncState`),
  `apps/kira-space/internal/storage/repos/githostchangerequests.go:142-166` (upsert,
  `PruneIdle`).
- Defect: every RepoEntry's first run prunes all repos except its own key. Another entry's run can
  already hold that repo's state in memory. `PutSyncState` is an upsert, so that run later
  recreates the deleted state row with `backfill_complete = 1`. The deleted change request rows
  are not recreated. Round 1's `updated_at` fix covers an active backfill only. It does not cover
  a repo whose last write is older than 30 days.
- Failure: the app is reopened after more than 30 days with repos B and C restored. Both syncers
  start 2 s after boot. B's `prepare` loads its complete state. C's `prepare` then prunes B's rows
  and state, and B prunes C the same way. Each run deltas from its old watermark. A 304 probe
  stores nothing; a changed probe stores only rows newer than the watermark. Each run then writes
  `complete=true`. Older open and merged requests are gone for good: deltas never go below the
  watermark, and `refreshChecks` only reads stored open rows. git-ui trusts a complete index. It
  skips `resolveBranch` and `#revalidateBranches`, and `indexedOpen` serves the open snapshot. So
  those branches show no badge until a schema bump or an account change.
- Fix: prune once per process, before any syncer reads state. For example, `Registry` runs
  `CRStore.PruneIdle(now-retention, "")` once on first `Acquire`, before `newRepoEntry`. Drop the
  per-entry `pruned`/`keep` path. Alternative: make the sync-state write in `crRun.sync` an
  `UPDATE` that only touches an existing row, and on zero rows restart the backfill.

## R2-2 Low: refs read failure makes a complete index drop every merged or closed branch

- Where: `apps/kira-space/internal/gitsession/crsync.go:760-781` (`ChangeRequestIndex`).
- Defect: when `e.Refs(ctx)` fails, `live` stays empty. The index then lists only open requests
  but still reports `Complete: st.BackfillComplete`. `#applyIndex` (`changeRequests.ts`) treats a
  complete index as the full truth and replaces `byBranch` with it.
- Failure: a transient refs error during a reload (a git timeout, a locked repo) clears every
  merged/closed badge on live branches. They return only on the next successful index load.
- Fix: on a `Refs` error, return `Complete: false`. The client then only adds rows and keeps what
  it has.

## R2-3 Low: title/Jira guard reads outside the update transaction

- Where: `apps/kira-space/internal/ade/board_writes.go:182-199` (`UpdateTask`),
  `apps/kira-space/internal/storage/repos/adetask.go:257-318` (`AdeTaskRepo.UpdateTask`).
- Defect: the invariant is checked against a `GetTask` read taken before, and outside,
  `AdeTaskRepo.UpdateTask`'s own transaction. `TaskBoard.UpdateTask` holds no task mutex.
- Failure: two windows patch one task at once. One clears the title and the other clears the Jira
  key. Each check sees the other field still set, both commits land, and the task ends up with
  neither, the state `CreateTask` forbids.
- Fix: move the check into `AdeTaskRepo.UpdateTask` after the patch is applied to `cur`, inside the
  transaction. Return a sentinel there, map it to `BadRequest` in `adeTaskCatalog`, and drop the
  extra `GetTask`.

## R2-4 Low: R1-2 fix's loop wiring has no test

- Where: `apps/kira-space/internal/gitsession/crsync.go:236-238` (`loop`),
  `apps/kira-space/internal/gitsession/crsync_test.go:69-81`.
- Defect: the test covers only the pure `continueWaitLocked` arithmetic. If `loop` went back to the
  old `max(ContinueDelay, …)` expression, the test would still pass. Every flow rig sets
  `Disabled`, so no test runs the timer-driven continuation that R1-2 was about. This is
  concurrency and timing logic, which the CLAUDE.md test bar does cover.
- Fix: add one `githostflow` test with `Disabled: false`, `StartDelay: 1ms`, `MinGap: 300ms`,
  `ContinueDelay: 1ms`, `PageCap: 1`, `FocusedInterval: 1h` and 250 requests on the fake forge.
  Assert `index().Complete` within a few seconds, with no explicit sync. Before the fix, the
  continuation slips to the 1 h interval and the test fails. The bounded wait keeps it deterministic.

## R2-5 Low: index read scans the repo's whole history on every refs change

- Where: `apps/kira-space/internal/gitsession/crsync.go:755`,
  `apps/kira-space/internal/storage/repos/githostchangerequests.go:91-99`
  (`ChangeRequestsForRepo`). Called through `packages/git-ui/src/state/changeRequests.ts`
  `#revalidate` and the `changeRequestsChanged` handler.
- Defect: round 1's fix shrank the payload but kept the read. Every `branch.changeRequestIndex`
  call loads and scans every same-owner row of the repo, which is the full PR history. The Go
  code then keeps one row per head branch. git-ui calls it on every `refsChanged` (commit, checkout,
  fetch) and after every sync run that changed rows.
- Failure: for a repo with tens of thousands of PRs, each ref change costs a full table range read
  and struct scan. The cost grows with history, not with branch count.
- Fix: select one row per head branch in SQL, e.g. `row_number() OVER (PARTITION BY head_ref ORDER
  BY updated_at DESC, number DESC) = 1`. The existing `(repo_key, head_owner, head_ref)` index
  serves it.
