# P142 code review (round 2 of 2)

Status: in progress.

Head: `b43281ed`. Part A base `22cd3de7` (P141 fix commits `108ada87..b43281ed`). Part B base `771512bc`
(areas P141 skimmed or never reached). One Opus reviewer, three dimensions: architecture/security,
correctness, performance. CodeGraph via stdio fallback `cgx.mjs` (`codegraph_explore`).

## Findings

### F1 Resume refused for 2 min after an abandoned launch

- Dimension: correctness. Severity: low.
- `apps/kira-space/internal/ade/tracker.go:266` (`Prepare`), `recordHeldLocked` at `:190`.
- Problem: P141 F3 refuses a resume while any *pending* intent names the record. A pending intent
  only clears in `Compose` or after `PendingTTL` (2 min, `tracker.go:27`). `terminal.BoundService.Open`
  runs `ValidateOpen` before `ComposeAgent` (`internal/terminal/bound.go:80-92`), and the renderer can
  fail before `Open` at all. Any such failure leaves the intent behind; a retry of the same resume
  in the next 2 min fails with `ErrSessionRunning` ("session is already running") though nothing runs.
  Before P141 the retry succeeded.
- Fix: refuse in `Prepare` only when `byRecord` holds the record; on a pending duplicate, drop the
  older intent for that record. Close the double-resume race in `Compose` instead: under `t.mu`,
  refuse (`ErrSessionRunning`) when `byRecord` already holds `intent.RecordID`, and reserve it
  before `MarkRunning`.

## Part A notes (verified clean)

- `gitRepoIDOf` cache (`queue.go:346`): ade's `Conn` never releases a hold before `Close`, and a
  code repo's root is immutable (`CodeReposRepo` has no relocate), so a cached id always maps to a
  live entry for the same root. `Conn.Entry` miss falls back to the full open.
- `tipReachableFromMain = hasMain && depths[b]==0` (`queue.go:798`): depths is `AheadBehind(tip,
  mainTip)` ahead count, set for every found branch when `hasMain`; zero ahead iff tip is an
  ancestor of main. Equivalent to the removed `Ancestors` call.
- Push vs invalidation (`mutations.ts`, `queries.ts`): every write whose `onSettled` was dropped
  calls `notifyChanged` on success (`queue.go:1257-1368, 1468, 1604, 1741`); `installAdeSignals`
  invalidates snapshot and PRs on that push. Failed writes are transactional except Archive and
  Refresh, which still invalidate on error. BindNewWork keeps its snapshot invalidation (Go pushes
  sessions only).
- `applyActivity` (`queueActivity.ts`) reproduces `useQueue`'s `acts`/`agents`/`panel.running`
  exactly (same `activityKind` rule, same `actRank` sort). No other `useQueue` output reads
  activity. `AdeAllAgentsView` reads activity straight from the store via `buildAllAgents`, so
  `NO_ACTIVITY` there loses nothing.
- Session id quoting: `uuid.Parse` plus `quotePOSIX`; no frontend code parses the command.
- `ErrReviewNotesOnly`, `UpdateNewWork` repo/live scoping, `ListByRepo`, notes-by-itemId (`nw:`
  prefix matches `queue.go:1271`; `:` cannot appear in a git branch name): correct.
- `RequirePathPrefix` (`adapters/tree.go`): s3 uses only the bucket segment; redis picks its DB from
  segment 0 in `Adapter.Mutate`. Deeper paths carry no other meaning in either mutate.
