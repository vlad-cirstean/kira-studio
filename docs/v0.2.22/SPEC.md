# v0.2.22

Branch `chapter/v0.2.22`. First `P` is 396 (highest in v0.2.21 is P395). Rows carried over from v0.2.21 by user request.

Source: user request. Phases run top to bottom.

| Phase | Title | Status |
|---|---|---|
| P396 | Bug: three-finger swipe up moves focus to another space | Todo |
| P397 | Task repos and branches: add, edit and delete independently | Done |
| P398 | One project picker and one branch picker across the app | Done |
| P399 | Archived work stays viewable with all data | Done |
| P400 | Task board: no same-day delimiters, terminal-dark background, distinguishable task colors | Todo |
| P401 | Task board: 7-day window, Later section, no date control | Todo |
| P402 | Agents panel: drop tab delimiter, center action buttons, remove click border flash | Todo |
| P403 | Chapter close | Todo |

## Rows

### P396 Bug: three-finger swipe up moves focus to another space

Three-finger swipe up (macOS Mission Control, to see the apps on the space) moves focus to another space. Find the cause (likely window focus/activation handling) and fix.

### P397 Task repos and branches: add, edit and delete independently

A task can add repos and branches. Add edit and delete for both. Today, a repo added without a branch cannot get a branch added later; fix that.

**Result.** Row menu in the Task tab: add or change branch (existing or new name), change repo, remove branch, remove repo. Backend: `SetTaskBranch`, `UpdateTaskRepo`, `RemoveTaskBranch`, `RemoveTaskRepo`, `TaskBranchRisk`; store `DetachBranch` (hard delete if never created and run-less, else archive). Attach fills a not-created row, which fixes the bug. Refused while a session, launch or background run uses the row, and on review tasks. Git refs never change. Dirty or unmerged worktree asks confirm. Flow test `TestTaskReposAndBranches` plus UI spec `ade-v2-task-branches`. Branch form uses SecondaryTabs and a search list; P398 swaps in the shared pickers.

### P398 One project picker and one branch picker across the app

Several project and branch picker implementations exist, each flawed. Replace them with one shared project picker and one shared branch picker used everywhere. Remove the old implementations.

**Result.** `ProjectPicker` and `BranchPicker` in `packages/workbench/src/components/pickers/` (shadcn-vue Command, self-filtered, cap 50 with Show more, inline reasons for disabled options, create and custom entry). Replaced 14 old implementations at 16 call sites across ADE, memory, automations and git-ui; `AdeCandidateRow`, `AdeBasePicker`, `BaseSelector`, `ReviewBranchPicker`, the dead worktree datalist and `buildRefListSections` are gone. Backend: candidate branches per repo, base exclusions as codes (`self`, `stacked`), flow tests for both. git-ui toolbar popover renamed `RefsPopover`. Workflow step "Runs on" is now tabs plus a project picker. UI specs updated, new picker assertions added, four workflow-graph snapshots regenerated.

### P399 Archived work stays viewable with all data

Archived work must be visible in the UI. Opening an archived task shows its session, notes, links, PRs and all other data, unchanged from before archiving. Archiving must not drop or hide any of it.

**Result.** Archive keeps everything: review sessions stay pinned, log purge deleted, each branch's change request snapshotted (migration 0052). `ArchivedTask` read and `RestoreTask` (refuses when a branch name is live on another task), phone route `/api/ade/archived-task`. New Archived tab (searchable list plus full read-only panel: Task, Notes, Sessions; PR with "as of archive" hint, review comments, Restore). Plan history opens the same panel. Flow tests `TestArchivedTaskKeepsData`, `TestPhoneReadsArchivedTask`; UI spec `ade-v2-archived`. Not done: `TestArchiveRisk` pin assertion; phone UI stays out of scope.

### P400 Task board: no same-day delimiters, terminal-dark background, distinguishable task colors

Remove the delimiters between tasks in the same day. Change the board background to the darker grey terminals use. Keep the existing task colors; tasks are still hard to tell apart, so adjust contrast or spacing until they separate clearly.

### P401 Task board: 7-day window, Later section, no date control

Show only the next 7 days on the task board, unless work is scheduled later than that. Remove the date control that adds a new week. Work scheduled beyond the window sits in a Later section.

### P402 Agents panel: drop tab delimiter, center action buttons, remove click border flash

Remove the grey delimiter between the main tabs (Backlog, Plan) and the rest. Center-align the "type a thought" and "add task" buttons. Remove the white border that flashes on click of a task; it must not appear at all.

### P403 Chapter close

Run one code review round first (per CLAUDE.md "Code review"), fix findings, then close the chapter by hand and open the PR.
