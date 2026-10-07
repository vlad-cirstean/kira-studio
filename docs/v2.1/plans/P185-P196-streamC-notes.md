# Stream C notes (P190-P194, P196)

Branch `v2.1-stream-C`, base `ba8419e`. One commit per area; no `--no-verify`.

## P190 One repository list, one import dialog

- Direction check (read + test, no failing direction found): both import paths write `code_repos`, and every Go mutation
  path (`ImportRepo`, `RenameRepo`, `ReorderRepos`, `RemoveRepo`, `AddFolder`, `SetFolderWatch`, `RemoveFolder`, the folder
  watcher rescan) already fires `OnReposChanged` / `OnRepos` (`kira:adetask:repos`). `installAdeSignals` runs at boot, so
  the push was never gated on `ade` being open. The real defect: list sync lived in `ade` code and the dialogs were
  duplicated. No Go change needed.
- `state/coderepos.ts` `initCodeRepos` (called from `main.ts`) subscribes to the push before the first read and re-reads
  on each push. Removed the duplicate re-hydrate in `ade/queries.ts`.
- New `repo/ReposDialog.vue` (repos list + import, scan folders add/watch/remove via native picker), `repo/state/reposDialog.ts`
  (open state; `show()` also switches to Git and unhides the project panel), `repo/state/reposQueries.ts` (folder
  mutations moved from `ade/v2/queries.ts`). Opened from the Git panel header ("Manage repositories…") and `GitStart.vue`;
  mounted once in `GitPanel.vue`.
- `ade`: Repos page lost folder list and both add inputs (keeps per-repo config) and points at the Git module dialog;
  `AdeView.vue` empty state does the same.
- Tests: `ade-v2-repos.spec.ts` (dialog folder add/watch/remove, import, push re-reads list with `ade` closed).

## P191 Agents: git refresh

Repro (Go, `board_refresh_test.go`): `Refresh(nil)` and `Refresh([ids])` both fetch every board repo and advance
`FETCH_HEAD` (`lastFetchAt`); a repo with no live task branches refreshes when named. So the plan's suspected mismatch
(UI chips vs Go repo set) does not occur on the real path: `board.repos` and `Refresh([])` are both the repos with live
branches. Defects found and fixed instead:

1. "Refresh all" relied on an implicit Go-side set; the UI now sends the explicit ids it shows, so rows and chips always
   agree (`AdePlanView.vue`; spec asserts the three ids).
2. `refreshRepo` ran env scripts (up to 60 s each, sequential per environment) before the fetch, so a slow deploy check
   held the fetch back and the chip sat on "fetching…". Scripts now run beside the fetch (`internal/ade/board.go`).
3. `AdeReviewSync.vue` dropped a per-repo fetch error row: a failed fetch showed nothing. Now shown in the popover.

Not reproducible in this sandbox: a private remote needing credentials through the relay; error rows for that path were
already surfaced in the plan chips.

## P192 Stage move

`TaskBoard.SetTaskStage` (`runs.go`), `AdeTaskService.SetTaskStage`, wire `SetTaskStageArgs`, `useSetTaskStage` (optimistic
patch), `AdeStageMover.vue` in the workflow block (Back/Next + shadcn `DropdownMenu`, off while a run is live). Go test
covers both directions, `done`, unknown stage and the live-run guard.

## P193 Stage-named session tabs

`sessionView.ts`: tab `<stage> · <step> · <repo>` (headless) / `<stage> · <repo|spec>` (TUI), review stays `Review agent`;
`stoppedLabel`/`allLabel` carry the stage too. Stage resolved from the session's `stageId` against the task's workflow, then
`currentStage`, then the id. New `AdeSessionId.vue` (full Claude session id, VueUse `useClipboard`) in both panes; empty id
shows "waiting for session id". Copy uses `navigator.clipboard.write` (VueUse), so the spec stubs `write`.

## P194 Look and behaviour

- Shell: `AdeShell.vue` nav on chrome with `tabChipVariants`; pages sit in bordered rounded `bg-bg` panels with `gap-0.5`;
  new `packages/workbench/src/components/PanelHeader.vue` (used by Backlog, Needs, Workflows, Repos: four files). Studio and
  Space panels with inline header classes untouched.
- Panel tabs (`AdePanelFrame.vue`) and the session strip use `tabChipVariants`.
- Inputs/Buttons/NativeSelect/Textarea in `ade`: dropped `h-[..px]`, `size-[..px]`, `min-h-[..px]`, `h-5/6/7`, and
  `text-kira-*` overrides; native elements mapped to `h-control`, `h-control-lg`, `size-control`. Remaining fixed sizes are
  timeline geometry (task card 68 px, glyph boxes, progress bars), not form controls.
- Plan keeps timeline and tones; `check-ade-colours.sh` passes. The new nav no longer uses the amber underline.
- Before/after screenshots: not attached. Space has no `ade` visual snapshots (only `settings.spec.ts` under `tests/visual`).

## P196 Explicit workflow save

- Migration `0017_p196_ade_task_workflow_snapshot.sql` (`workflow_json`, `workflow_hash`). `taskwf.go`: `taskWorkflow`
  (snapshot, else live), `snapshotWorkflow` (idempotent, first wins), hash = sha256 of the workflow JSON `Reader.record`
  stores. Snapshot happens at first run (`StartRun`), first session (`LaunchStage`, `StartBranch`, take over) and first
  stage move (`StageDone`, `SetTaskStage`). `StageDone`, `SetTaskStage` and `refreshSnapshot` read `taskWorkflow`.
- Wire: `Task.workflow` (snapshot, null until started) and `Task.workflowOutdated`; fixtures updated (the wire parity test
  requires it). Frontend plan model and session names read `task.workflow ?? live`.
- Editors: Save/Discard (`AdeWorkflowSaveBar.vue`), Cmd/Ctrl+S, no autosave or flush-on-unmount; validation debounce kept.
  Leaving with edits (list switch, import/new, mode toggle, shell tab change) asks through the shared `ConfirmDialog`.
- Selector: `Badge` "updated — applies to new work only" with tooltip.
- Deviation: `SetTaskWorkflow` is not refused for a started task. Today it resets the task (deletes runs and logs) when no run
  is live; that stays, and the reset now also clears the snapshot (the task is not started again). Refusing would remove the
  only way to restart a task on another workflow.
- Backfill: at boot (`Recover`), a live task with runs and no snapshot gets the current live file as its snapshot (the
  original version is gone).
- Open: unsaved editor edits are lost when the whole `ade` module is switched away (no guard outside the shell tabs).

## Verification

- `go test -race` ./internal/{ade,storage/...,bridge/...,adeflow,codeworkspace}: pass. `go vet ./apps/kira-space/...`: clean.
- `bun run lint`, `bun run typecheck` (pre-commit, each commit), `bun run lint:dead`: clean.
- `bun test apps/kira-space/tests/unit packages/workbench/src`: 168 pass.
- Space UI project (all 180 specs): pass. One WebKit "Page crashed" on `ade-v2-review` "sync button stays visible" in a
  loaded run, passed on rerun.
- Pre-existing, unrelated: Space visual `settings.spec.ts` (4 specs) fails at base `ba8419e` too (font rendering in this
  container; no file under the Settings dialog changed). `golangci-lint` here is built with Go 1.25 and cannot load the
  repo's Go 1.27 config, so `lint:go` did not run.

## Proposed ARCHITECTURE.md edits

- Repo list: one Pinia store fed by the boot-time `kira:adetask:repos` subscription; one dialog in the Git module.
- Workflows: a task follows the live file until its first run, session or stage move, then runs its own snapshot
  (`ade_tasks.workflow_json`); `Task.workflowOutdated` flags drift; editor edits save explicitly.
