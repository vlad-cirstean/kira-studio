# P148 Stream A notes

Base 4dc1d3fb, branch v2.0-p148-a. `codegraph_explore` calls: 4 (bridge glue symbols, queue.go kept helpers, ade_sessions repo/model, gitsession stack/reflog).

## Commits

1. `refactor(kira-space): drop v1 ade bridge entries and wire types from the frontend`
2. `refactor(kira-space): move v2 git fact helpers out of the v1 queue`
3. `feat(kira-space)!: remove the v1 ade service, queue and channels`
4. `feat(kira-space)!: migration 0011 drops v1 ade tables and session columns`
5. `refactor(kira-space): remove v1-only gitsession stack and reflog reads`
6. this file (plus comment cleanups)

## R6 migration check

Scratch test (deleted after) migrated a temp DB to 0010, seeded one row in each of the six v1 tables plus one v1 and one v2 `ade_sessions` row, applied 0011. Result: six tables gone, v1 session row gone, v2 headless row intact (all columns), `PRAGMA foreign_key_check` empty, `ade_sessions_task` index present, `schema_version` 11.

## Deviations and findings

- `gitfacts.go` also holds `PairFact`, `resolvedRef` (used by board_facts) beyond the plan list; `Commit`, `Jira`, `adeConnID`/`adeConnLabel` had no v2 caller and were deleted (lint `unused`).
- Storage: `ErrEstimateShrink`, `checkEstExtends`, `maxColorSlots`, `boolToInt` (repos) and `AdeBranchKind*`/`ValidAdeBranchKind` (model) were v2-used and moved into `adetask.go` files before `adequeue.go` was deleted.
- `bridge/ade.go` survivors: validators plus `adeMaxMessageBytes`/`adeMaxBranchBytes` moved to `bridge/adetask_validate.go` (only validators `adetask.go` calls).
- Ported tests: `TaskBoard.ForcePush` success and stale-lease (`board_remote_test.go`), moved review branch `Refresh` (RefsChanged 1, rerun facts). `TestMainDisplay` moved to `gitfacts_test.go`. Shared git fixtures extracted to `gitrepo_test.go` (names `runGitQueue`, `initQueueRepo` kept to limit churn). `rebasecheck_test.go` retargeted to `boardHarness`.
- `tracker_test.go` reshaped to task rows; `ResumeWrongRepo` merged into the existing task-mismatch case, `Recover_StopsLeftover` deleted (Tracker.Recover removed; `TaskBoard.Recover` stops rows), `PrepareResumeRecreatesMissingCwd` rewritten to missing cwd = `ErrInvalidInput`, file cwd = `ErrResumeCwdNotDir`, plus `Prepare` without task = `ErrInvalidInput`.
- `Tracker.List`/`ListByRepo`/`Recover`/`withLiveActivity` deleted (no v2 caller).
- Out of ownership, for the orchestrator/Stream B: `apps/kira-space/tests/ui/support/mockRuntime.ts:87` comment still names `AdeService`.
- `go.mod`, `go.sum`, `package.json`, `bun.lock` unchanged vs base; `go mod tidy` no diff.

## End checks

`go test ./apps/kira-space/...` green; `go test -race` on ade, adeagent, adeflow, gitsession green; `bun run lint:go` 0 issues; `bun run lint:dead` exit 0; `bun run typecheck` clean.
