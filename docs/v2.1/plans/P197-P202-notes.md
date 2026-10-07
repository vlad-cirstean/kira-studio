# P197-P199, P202 notes

Stream E. Plan: `P197-P202-plan.md`. Q1 decision (user): keep boundary; Space Git window still refuses `worktree.prepare`.

## P197 Skip a workflow stage

Landed: `skip` on `adewire.Stage`, `adeflow` parse/write (`skip: true` only when set; all-skipped workflow rejected), `ade/stages.go` (`firstRunnable`, `nextRunnable`) used by `stageSnapshot`, `StageDone`; `SetTaskStage` refuses a skipped target. UI: stage card right-click menu, `skipped` chip, mover and stage block menus, `skipped` segment and block state.

Deviations:
- Menu primitive: workbench singleton `ContextMenu.vue` (shadcn-vue `DropdownMenu`), not a new shadcn `ContextMenu`. Every right-click menu in both apps uses it.
- No mock-runtime change: UI mock replies are static fixtures; refusal lives in Go (`stages_test.go`).
- `withSkip` helper dropped: card patches its own stage; `runnableCount` covers the last-runnable guard (`canSkip`).
- A skipped stage the task already sits on stays current; its block shows `now`, not `skipped`.
- Fixtures: `skip: false` added to stage objects in `board.json`, `task.json`, `workflows.json`; unit fixtures too.

## P198 Task context menu

Landed: `board/taskMenu.ts` (pure descriptors), `plan/useTaskMenu.ts`, wired on the card box (right-click), card head (Shift+F10, ContextMenu key), task action cell, review row cells, and a `⋯` "More actions" button in the task panel header. Spec `ade-v2-task-menu.spec.ts`.

Deviations:
- Handler sits on the whole card box, not only the head; branch rows still stop propagation. Review cards have no head, so their reachable spots are the box edge, the `review` tag cell and the panel button.
- Right-click calls `stopPropagation` so the enclosing day band's menu does not replace it.
