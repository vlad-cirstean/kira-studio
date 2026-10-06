# P177: Space ADE decisions

Source: `SPEC.md` row P177. Origin: P168 Part 20 F12, Part 21 (two design items). Stream A. One
sequential implementer.

User decided all three items before planning. This plan records design, not open choices.

1. Purge run and setup logs (`ade_logs`, `ade_log_chunks`) 90 days after owning task is archived.
   Keep run, session and task rows as history.
2. Backlog Delete gets a simple confirm dialog. No undo.
3. `dayMenuFor` / `extendHorizon` past-day pruning: no change. Recorded here only; no code, test or
   doc edit.

## Current behavior (read from source at `429f91a`)

### Logs

- `0010_p146_ade_runs.sql`: `ade_logs (kind, id, task_id, next_seq, bytes, truncated)`, PK
  `(kind, id)`, `task_id REFERENCES ade_tasks (id) ON DELETE CASCADE`. `ade_log_chunks` PK
  `(kind, id, seq)`, FK `(kind, id) REFERENCES ade_logs ON DELETE CASCADE`. No index on
  `ade_logs.task_id`.
- `ade_tasks.archived_at INTEGER` (Unix ms, `0008`), no index. Set once by
  `AdeTaskRepo.ArchiveTask(taskID, now)` (`repos/adetask.go:931`), called from
  `TaskBoard.ArchiveTask` (`ade/archive.go:168`) with `b.deps.Now().UnixMilli()`. No unarchive path
  exists (grep for `archived_at = NULL` finds nothing), so `archived_at` only moves NULL to a value.
- `AdeLogsRepo` (`repos/adelogs.go`): `Reset(kind, id, taskID)` writes `task_id` for both kinds (run
  log keyed by run id, setup log keyed by branch id). Each log keeps a 2 MiB tail
  (`AdeLogTailBytes`). Nothing deletes a log except `ResetWorkflow` (run logs only) and the FK
  cascade on task delete.
- `Page` on a missing log returns an empty page (no error). `ReadLog` (`ade/runs.go:951`) reads it
  for run and setup kinds. The archived panel (`AdeArchivedPanel.vue`) renders no log, so a purged
  log has no visible UI change.
- `_foreign_keys=1` on every connection (`internal/sqlitex/sqlitex.go:49`), so deleting `ade_logs`
  rows cascades to `ade_log_chunks`. `_auto_vacuum=INCREMENTAL` applies on new DBs only. Kira Space
  has no freelist reclaim today.

### Existing periodic-job pattern

- `gitreview/reaper.go`: one sweep at open, then `time.NewTicker(sweepPeriod)` (`time.Hour`) in
  one goroutine, stopped on close. `sweepDB` runs one `DELETE`, then `PRAGMA incremental_vacuum`
  only when rows were removed.
- Studio `oplog.Wiring.prune`: prune at launch plus every N completed ops (different trigger, same
  "launch plus periodic" shape).
- `TaskBoard` owns background work through `goTracked` (Close waits on `wg`) and `b.ctx` (Close
  cancels it first). `Start()` (`ade/workflows.go:127`, `startOnce`) already launches
  `b.goTracked(func() { b.RunAllEnvScripts(b.ctx) })`. `main.go:494-498` calls `Recover()` then
  `Start()`.

The purge follows the reaper shape, hosted on `TaskBoard` lifecycle: one pass in `Start`, then
hourly, in a `goTracked` goroutine that exits on `b.ctx.Done()`.

### Backlog Delete

- `AdeBacklogPage.vue:65` `onRemove(id)` calls `remove.mutateAsync({ id })` through `run()`.
  Both delete entry points funnel there: row button `ade-backlog-delete`
  (`AdeBacklogRow.vue:102-108`, emits `remove`) and panel button `ade-backlog-panel-delete`
  (`AdeBacklogPanel.vue:86`, emits `remove`).
- Two confirm components exist:
  - `packages/workbench/src/components/ConfirmDialog.vue` + Pinia store
    `useConfirmDialogStore` (`packages/workbench/src/state/confirmDialog.ts`):
    `confirmDialog(message, { danger, confirmLabel }) => Promise<boolean>`. `danger` defaults to
    true, giving `dialog-danger` styling and label "Delete". Already mounted once in Kira Space
    `frontend/src/App.vue:77`. Kira Space precedent: `workbench/settings/ConnectedEditorsPane.vue:24`.
  - `ade/v2/AdeConfirmDialog.vue`: per-call-site component with local `open`/`run` props, error
    shown in-dialog, yes button always `dialog-primary`. No store.
- Choice: workbench `ConfirmDialog` + `useConfirmDialogStore`. Reasons: it has a store (the user
  named "component and its store"), its danger variant fits a destructive action, it is already
  mounted, and it adds no per-page dialog state. `AdeConfirmDialog` would need a new danger variant
  plus local open/target refs in the page for no gain; the page already shows mutation errors in
  `ade-backlog-page-error`.
- UI spec: `tests/ui/ade-v2-backlog.spec.ts:129` `'delete removes the item without a prompt'`
  asserts the one-click behavior and must change.

## Design

### Retention policy

- Eligible: task with `archived_at IS NOT NULL AND archived_at <= cutoff`, where
  `cutoff = now - 90 days` in Unix ms. Inclusive bound: a task archived exactly 90 days ago is
  purged.
- Deleted: every `ade_logs` row with that `task_id` (both `run` and `setup` kinds); chunks go by
  FK cascade. Nothing else is touched: `ade_tasks`, `ade_task_branches`, `ade_runs`,
  `ade_sessions`, `ade_worktree_setup` stay.
- Live tasks are never purged, however old their logs.
- Age basis is `ade_tasks.archived_at`, not chunk `at` or run `finished_at`: the user's rule is
  "90 days after the task is archived", and `archived_at` is set once and never cleared.

### Repo method

`AdeLogsRepo.PurgeArchived(cutoff int64) (int, error)` in `repos/adelogs.go`. Returns logs removed.

1. Select eligible tasks that still own a log:
   `SELECT id FROM ade_tasks t WHERE archived_at IS NOT NULL AND archived_at <= ? AND EXISTS (SELECT 1 FROM ade_logs l WHERE l.task_id = t.id) ORDER BY id`.
   The `EXISTS` keeps already-purged tasks out of every later sweep.
2. For each task id: `DELETE FROM ade_logs WHERE task_id = ?` in its own statement (autocommit,
   one implicit transaction per task). Sum `RowsAffected`. One task per transaction bounds how long
   the single SQLite writer is held: worst case one task's logs (N logs x 2 MiB), never every
   archived task at once. A first sweep after upgrade can face many eligible tasks; per-task
   statements let other writers interleave.
3. When the sum is > 0: `PRAGMA incremental_vacuum` (reaper precedent). On a DB without
   `auto_vacuum=INCREMENTAL` this is a no-op.
4. Wrap errors as `repos: purge archived ade logs: %w` / `repos: purge ade logs of task %s: %w` /
   `repos: incremental_vacuum after ade log purge: %w`, matching file style.

### Indexes (migration `0016_p177_ade_logs_purge.sql`)

```sql
-- P177: archived-task log purge lookups.
CREATE INDEX ade_logs_task ON ade_logs (task_id);
CREATE INDEX ade_tasks_archived ON ade_tasks (archived_at) WHERE archived_at IS NOT NULL;
```

- `ade_logs_task` serves step 1's `EXISTS` and step 2's `DELETE ... WHERE task_id = ?`. Without it
  both scan all of `ade_logs`. It also serves the existing `ON DELETE CASCADE` from `ade_tasks`
  (SQLite scans the child table on parent delete when the child FK column has no index).
- `ade_tasks_archived` (partial) serves step 1's range on `archived_at`; live tasks stay out of it.
- Chunk cascade uses `ade_log_chunks` PK `(kind, id, seq)` prefix; no index needed there.
- Add a `0016` line to `docs/ARCHITECTURE.md` ADE Storage list.
- Numbering: `0015` is current top. If another stream lands a Kira Space migration first, rename
  this file and its `embed.go` entry to the next free number at rebase and update the
  ARCHITECTURE.md line.

### Engine loop

New file `apps/kira-space/internal/ade/logpurge.go`:

```go
const (
	// archivedLogRetention is how long run and setup logs outlive their task's archive (P177).
	archivedLogRetention = 90 * 24 * time.Hour
	logPurgePeriod       = time.Hour
)
```

- `func (b *TaskBoard) purgeArchivedLogs()`: `cutoff := b.deps.Now().Add(-archivedLogRetention).UnixMilli()`;
  call `b.deps.Logs.PurgeArchived(cutoff)`. `slog.Warn("ade: purge archived logs", "scope", "ade", "err", err)`
  on error (best effort; next tick retries, reaper precedent). `slog.Info` with `"logs", n` when
  `n > 0`.
- `func (b *TaskBoard) runLogPurge()`: call `purgeArchivedLogs()` once, then
  `t := time.NewTicker(logPurgePeriod)`, `defer t.Stop()`, `select` on `b.ctx.Done()` (return) and
  `t.C` (purge).
- `Start()` (`ade/workflows.go`), inside `startOnce`, beside the `RunAllEnvScripts` launch:
  `b.goTracked(b.runLogPurge)`. Place it before the `RepoConfig.Folders()` early return so a folder
  list error never skips the purge.
- Close needs no change: `b.cancel()` ends the loop, `wg.Wait()` joins it.
- Hourly, not daily: the app may not stay up 24 h, and the indexed query is cheap. Purge happens
  off the boot path (goroutine), after `Recover()`.
- `deps.Logs` is required in production (`main.go` sets it). No nil guard: fix the one test that
  calls `Start()` without it instead (`ade/workflows_test.go:47`, add `Logs: r.AdeLogs`).

### Backlog confirm

`AdeBacklogPage.vue`:

```ts
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
const confirmDialogStore = useConfirmDialogStore();

async function onRemove(id: string): Promise<void> {
  const item = items.value.find((i) => i.id === id);
  if (!item) return;
  if (!(await confirmDialogStore.confirmDialog(`Delete this backlog item?\n\n${item.text}`))) return;
  await run(() => remove.mutateAsync({ id }));
}
```

- Default `danger: true` gives the red "Delete" button. Cancel, Escape, outside click and the close
  button all resolve false (existing store behavior).
- Template bindings `@remove="onRemove(item.id)"` / `@remove="onRemove(selected.id)"` stay; Vue
  discards the returned promise. Both entry points get the confirm through this one gate.
- `AdeBacklogRow.vue` / `AdeBacklogPanel.vue` unchanged.
- No unit test (no logic beyond one guard).

### Decision 3

`dayMenuFor` (`ade/v2/board/dayMenu.ts`) and `extendHorizon` (`AdePlanView.vue`) keep pruning past
`offDays` / `extraDays` on write (`c50bb3f`). Nothing changes.

## Steps

One commit per step. Run `go build ./apps/kira-space/...`, `go vet`, lint and typecheck per commit
(pre-commit hook covers them). Run the expensive UI suite once at step 5.

### Step 1: migration

- Add `apps/kira-space/internal/storage/migrations/0016_p177_ade_logs_purge.sql` (content above).
- Append `{Version: 16, Name: "p177_ade_logs_purge", File: "0016_p177_ade_logs_purge.sql"}` to
  `names` in `apps/kira-space/internal/storage/migrations/embed.go` (explicit ordered list; the
  `//go:embed *.sql` glob alone does not apply it).
- Commit: `feat(space): index ade log purge lookups`.

### Step 2: repo purge + boundary test

- Add `PurgeArchived` to `apps/kira-space/internal/storage/repos/adelogs.go` (design above). Doc
  comment: deletes logs of tasks archived at or before cutoff; chunks cascade; keeps every other
  row.
- New `apps/kira-space/internal/storage/repos/adelogs_test.go`, one test
  `TestAdeLogsRepo_PurgeArchived`. Meets the CLAUDE.md bar: inclusive cutoff boundary plus FK
  cascade plus "rows kept" interact. Use `storage.OpenAt(t.TempDir())` + `repos.New(db.DB)`
  (`coderepos_test.go` pattern).
  - Fixture: `cutoff := int64(1_000_000_000_000)`. Tasks via `AdeTasks.CreateTask`: A archived at
    `cutoff`, B archived at `cutoff+1`, C live. `ArchiveTask(id, ts)` sets `archived_at`.
  - Each task: `Reset(AdeLogRun, "run-"+id, id)` + `Append` one chunk; `Reset(AdeLogSetup, "br-"+id, id)`
    + `Append` one chunk. A also gets an `ade_runs` row via `AdeTasks.InsertRun` (minimal valid
    fields).
  - `PurgeArchived(cutoff)` returns 2 (A's run and setup logs).
  - A: `SELECT COUNT(*) FROM ade_logs WHERE task_id = 'A'` is 0 and
    `SELECT COUNT(*) FROM ade_log_chunks WHERE id IN ('run-A','br-A')` is 0 (cascade).
    `AdeTasks.GetTask("A")` still returns it with `ArchivedAt` set; `AdeTasks.GetRun("run-A")`
    still returns the run.
  - B and C: `Page` returns their one chunk each.
  - `PurgeArchived(cutoff)` again returns 0 (`EXISTS` filter, idempotent).
  - `PurgeArchived(cutoff+1)` returns 2 (B now eligible); C still intact.
- Run `go test ./apps/kira-space/internal/storage/repos/ -run PurgeArchived`.
- Commit: `feat(space): purge logs of tasks archived 90 days`.

### Step 3: engine loop

- New `apps/kira-space/internal/ade/logpurge.go` (design above).
- `apps/kira-space/internal/ade/workflows.go` `Start()`: add `b.goTracked(b.runLogPurge)`.
- `apps/kira-space/internal/ade/workflows_test.go:47`: add `Logs: r.AdeLogs` to deps.
- No new test: the loop is a ticker around one repo call (CLAUDE.md bar: thin wrapper); the
  cutoff subtraction is one line. Run `go test ./apps/kira-space/internal/ade/` to confirm Start
  and Close still join cleanly (race detector if the suite already uses it).
- Commit: `feat(space): run archived log purge at start and hourly`.

### Step 4: backlog confirm

- `apps/kira-space/frontend/src/ade/v2/backlog/AdeBacklogPage.vue`: `onRemove` as above.
- `apps/kira-space/tests/ui/ade-v2-backlog.spec.ts:129`: replace
  `'delete removes the item without a prompt'` with `'delete asks to confirm before removing'`:
  - Click row 4's `ade-backlog-delete`. Expect `[data-testid="confirm-dialog"]` visible with
    `confirm-dialog-message` containing the item's text. Expect
    `calls(control, IPC.adeTaskDeleteBacklogItem)` length 0.
  - Click `confirm-dialog-cancel`. Dialog hidden; still 0 calls.
  - Click `ade-backlog-delete` again, then `confirm-dialog-confirm`. Poll for 1 call with args
    `{ id: 'i4' }`.
  - Also cover the panel entry point in the same test or a second short one: select an item, click
    `ade-backlog-panel-delete`, expect `confirm-dialog` visible, cancel. Both routes share one gate,
    so one assertion that the dialog opens is enough.
- Update the file's header comment if it says "without a prompt" anywhere else.
- Commit: `feat(space): confirm before deleting a backlog item`.

### Step 5: docs + verification

- `docs/ARCHITECTURE.md`, ADE section only:
  - Storage list: add `` `0016`: `ade_logs_task`, partial `ade_tasks_archived` (P177 log purge). ``
  - Replace the "Run and setup logs" bullet's end, or add one bullet after it:
    "Retention (P177): run and setup logs of a task archived 90+ days ago are deleted
    (`AdeLogsRepo.PurgeArchived`, inclusive cutoff on `ade_tasks.archived_at`); task, branch, run,
    session and setup rows stay as history. Live tasks keep logs forever. `TaskBoard.Start` runs the
    purge once, then hourly; `PRAGMA incremental_vacuum` after a purge that removed rows."
  - Frontend subsection: one line "Backlog Delete confirms through the workbench
    `ConfirmDialog` store (P177); no undo."
- Run once: `bun run test:ui:space` (or at least `tests/ui/ade-v2-backlog.spec.ts` with that
  config), `go test ./apps/kira-space/internal/...`, typecheck and lint. Fix anything red on the
  spot, pre-existing or not (CLAUDE.md).
- Append a `## Result` section to this plan: commits, test outcome, any deviation with reason.
- Commit: `docs: P177 retention and backlog confirm`.

## File ownership (Stream A)

| File | Change |
|---|---|
| `apps/kira-space/internal/storage/migrations/0016_p177_ade_logs_purge.sql` | new |
| `apps/kira-space/internal/storage/migrations/embed.go` | `names` entry 16 |
| `apps/kira-space/internal/storage/repos/adelogs.go` | `PurgeArchived` |
| `apps/kira-space/internal/storage/repos/adelogs_test.go` | new |
| `apps/kira-space/internal/ade/logpurge.go` | new |
| `apps/kira-space/internal/ade/workflows.go` | one line in `Start` |
| `apps/kira-space/internal/ade/workflows_test.go` | add `Logs` dep |
| `apps/kira-space/frontend/src/ade/v2/backlog/AdeBacklogPage.vue` | confirm gate |
| `apps/kira-space/tests/ui/ade-v2-backlog.spec.ts` | delete test |
| `docs/ARCHITECTURE.md` | ADE section only (Storage, Frontend) |
| `docs/v2.0/plans/P177-space-ade-decisions.md` | Result section |

Not touched: `SPEC.md` (orchestrator owns row status), `AdeBacklogRow.vue`, `AdeBacklogPanel.vue`,
`packages/workbench/**`, `dayMenu.ts`, `AdePlanView.vue`.

## Concurrency with Stream B (P176) and Stream C (P173)

- P173 (Space git contract: `gitsock`, `gitrpc`, `packages/git-ui`, `apps/kira-space-vscode`):
  no overlap with the files above. P177 touches no git package. Only possible collision: a new
  Kira Space migration from P173 (`migrations/embed.go` would then overlap too). If so, the later
  lander renumbers its file and `embed.go` entry (see Indexes).
- P176 (Studio frontend, `apps/kira-studio/frontend/**`): no overlap. P177 touches no Studio file
  and no `packages/workbench` file (it only imports `useConfirmDialogStore`). If P176 changes the
  workbench `ConfirmDialog` testids or store signature, the backlog spec breaks; flag at rebase.
- Shared: `docs/ARCHITECTURE.md`. P177 edits only the "ADE: Kira Space task planner" section;
  P173 edits Git sections, P176 Studio sections. Text-disjoint hunks rebase cleanly.
- No ordering dependency on either stream. P177 can be implemented in parallel with both.

## Result

Commits: `51ef08b` migration 0016, `f16d285` repo purge + test, `332ecf4` engine loop, `3f5be19`
backlog confirm, docs commit (ARCHITECTURE.md + this section).

Checks: typecheck, lint, lint:go (0 issues), lint:dead, go build/vet, `go test -race` for `ade` and
`storage/repos`, `bun test apps/kira-space/tests/unit` pass. ADE UI specs (`ade-v2*`, 124 tests) pass.

Deviations: none. Migration 0016 was the next free number at commit time.
