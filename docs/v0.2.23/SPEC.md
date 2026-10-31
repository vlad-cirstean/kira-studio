# v0.2.23

Branch `chapter/v0.2.23`. First `P` is 404 (highest in v0.2.22 is P403).

Source: user request. Phases run top to bottom. Ends with one code review round, then close, then PR.

| Phase | Title | Status |
|---|---|---|
| P404 | Board: archived tasks inline, session indicator, weekend pattern, branch status colors | Done |
| P405 | Later and Backlog: move tasks between Plan, Later, Backlog | Done |
| P406 | Nanoid branch names for agent-created worktrees | Done |
| P407 | Stage handover: session context notes and stage-change dialogs | Done |
| P408 | Branch and worktree requests: approval dialog, multi-branch MCP tool | Done |
| P409 | Finishing a task returns every artifact via MCP | Done |
| P410 | Task plus button: terminal or ad hoc Claude session in worktree | Done |
| P411 | Task statuses: move to Workflow page, fully customizable | Done |
| P412 | Review: stale-changes indicator, PR link in review agent prompt | Done |
| P413 | Review comment dialog: fix overflow and editing, compact gutter | Done |
| P414 | Status bar: running ADE agents, interface font, tooltips | Todo |
| P415 | Operations panel: shared git primitives, all git ops, session and MCP ops | Todo |
| P416 | Move automation runs into Operations panel | Todo |
| P417 | Jira via acli behind an issue-tracker abstraction, CLI setup in Settings | Todo |
| P418 | Review window: uncommitted changes, committed vs uncommitted split, agent panel off by default | Todo |
| P419 | Git module: editable files (read only by default, Edit button, save button or shortcut) | Todo |
| P420 | Kira Studio: validation proof MCP tool and window | Todo |
| P421 | Code review (2 rounds) | Todo |
| P422 | Close chapter v0.2.23 | Todo |

## Rows

### P404 Board: archived tasks inline, session indicator, weekend pattern, branch status colors

- Archived tasks show their name on the board. User can resume the agent session of an archived task.
- Drop the Archived tab entirely. Keep archived tasks reachable some more efficient way.
- "Load history" button takes too much vertical space and shows distracting detail. Make it compact.
- Mark weekend days with a pattern or similar.
- Restore colors for branch statuses (merged etc.).
- Each task shows an indicator of its running sessions. Today no way to tell whether the agent finished.

**Result.** History entries use `taskTitle` (derived name). Today's archive rows always show, name first. Archived tab, page and store removed; compact History toggle (tooltip carries count) plus `AdeArchivedFinder` search popover. Resume on stopped archived sessions: Restore, then Take over (`resumeArchived`). Weekend bands hatched (U105 exempts `AdeDayBand.vue`). Branch tags keep tone again (`AdeChip` has `data-tone`). Card shows session state (`input`, `running`, `finished`) via `taskSessionsOf`; click opens Sessions tab. Tests: Go `TestArchiveRisk`, `TestResumeArchivedSession` (contract keys added), adeflow and ade packages pass; `bun test` timeline 26 pass; full `ui` project 789 pass; visual 20 pass after re-recording `plan-branches-stacked`; hooks pass.

### P405 Later and Backlog: move tasks between Plan, Later, Backlog

- Alongside archive, a task can move to backlog. Plan and backlog move tasks back and forth.
- Backlog tab: reorder by drag and drop. Remove the reorder arrows at the start of a task.
- Split into 2 sections: Later and Backlog. Plan to Later is a direct move. Backlog holds things that may never be picked up.
- Rename the Backlog tab to Later. Remove the item count from the tab.
- Quick add goes to Later.
- Reorder tabs: Needs you, then Plan, then Later (Later after Plan). Planner confirms against current order.

**Result.** Shelf model on `ade_task_plan` (migration 0055 adds `backlog`): Later is undated non-review, Backlog is the flagged rows, review items never shelve. New `ShelveTask` (before-id placement, one transaction) and `CaptureTask` (top of Later). Migration 0056 folds `ade_backlog` rows into repo-less Backlog tasks and drops the table; backlog item API, channel and mobile read removed. Desktop: Later tab (Needs you, Plan, Later; no count) with Later and Backlog drag lists in one Sortable group, task menu and panel "Move to backlog"/"Move to later", quick add via `CaptureTask`; Plan tail band is "Further out", dated work only, refuses drops. Mobile: `LaterScreen` on the board with `later/items` and `shelf/move` routes. Tests: Go `TestShelves`, `TestMigration56FoldsBacklogIntoTasks`, mobileflow reworked; contracts `ade-shelf`, `mobile-board`; timeline and parity units updated, `bun test` 1966 pass; `ui` 786 pass, mobile 83 pass, visual 20 pass, `go test ./...` pass; lint, `lint:dead`, hooks pass.

### P406 Nanoid branch names for agent-created worktrees

Worktrees the agent creates use a nanoid as branch name. Agent-chosen names cause many issues.

**Result.** `request_branch` takes only `repo`; Kira Space names new branches `kira/<10-char nanoid>` (`claimBranchName` generated mode, 5 tries on a taken name). New `internal/shortid` shares the nanoid alphabet with memory ids. `ensureWorktree` takes a `newBranchName` value; `validateAgentBranch` gone. Prompts, goldens, contract, ARCHITECTURE and site docs updated; name-validation table moved to `adeflow` `TestTaskBranchEditRefusals`. Real `claude` ADE, smart script and memory gate rows pass; `ade-v2-automations` and `automations-tabs` UI specs pass.

### P407 Stage handover: session context notes and stage-change dialogs

- Every agent session, interactive ones included, can record context about what it did for the next stage.
- If the session reports finished work, show a "move to next stage" dialog carrying that context.
- Manual stage change shows the same dialog, with a place to add notes by hand.
- No handover exists between stages today. Notes are visible only at task creation and never again: make notes transparent. Everything automatic, yet visible and editable manually later.

**Result.** Migration 0057 adds `ade_task_handovers`: one handed row per stage move, one open draft per (task, stage). MCP tool `handover` (`notes`, `finished`) goes to every task session without a run (manual, branch Start, review agent); `Grant.StepID` makes a late call fail with "The task moved on". `StepDone` and `SetTaskStep` take `notes` and turn the draft into a handed row in one transaction; a finished run inserts a `run` row from its summaries. A finished draft raises routed prompt `handover` (reopens at start, closes on move, dismiss, delete, archive). Next stage gets task notes and handover in step, manual, review and start prompts (`ade.handoverBlock`, `ade.handoverLine`). Desktop: `AdeStageDialog` for every step move, `AdeHandoverPrompt`, `AdeHandoverList` in Notes tab and archived panel, Task tab rows, Run dialog block, session dialog mirror. Mobile Back/Next takes optional notes. Tests: flows/adeflow `TestStageHandover` (`ade-handover`), `ade-v2-handover.spec.ts`, mobile writes spec; ADE real `claude` row passes. Deviations: adewire and bridge landed with the engine commit; `UpdateHandover` returns only an error; the review agent now gets Space tools through the shared grant path.

### P408 Branch and worktree requests: approval dialog, multi-branch MCP tool

- Agent branch/worktree request triggers an approval dialog for the user.
- MCP tool accepts multiple branches in one call, so the user usually sees one prompt.
- Remove the "Kira space tools" check; always on.
- Agent prompt states branches are created only via this MCP tool.

**Result.** Tool `request_branch` is now `request_branches` (`repos`, 1 to 20): one blocking call, one routed `branch-request` prompt, per repo `created`, `existing`, `denied`, `timeout` or `failed`. Engine `ade/branchrequest.go`: validate under the task lock, wait unlocked (30 min, one request per task, one resolver), create approved repos under the lock again. Grant release, session stop, archive and quit abandon it. Kira Space tools always on: `kira_space_mcp` is ignored on load and dropped on save; Run on an agent step leaves an unnamed branch to the agent, script and review steps derive `feat/<slug>`. Prompts say create branches only with `request_branches`; budgets and goldens updated. Desktop dialog (`AdeBranchRequestDialog`, store `adeBranchRequest`, routed prompt, Task tab row); Escape only hides. Tests: flows/adeflow `TestBranchRequest` (contract `ade-branch-request`), `ade-v2-branch-request.spec.ts`, real `claude` `TestAdeBranchRequest`; `go test ./...`, `bun run test:unit`, `ui` 799, mobile 83, visual (5 workflow editor snapshots re-recorded for the removed switch), lint, `lint:dead`, `lint:go`, `lint:claude` pass. Real `claude` ADE, smart script, memory and DB MCP rows pass (`TestMemoryMcpFollowsDocs` failed once on a haiku-chosen project, passed on rerun). 65 s question: the CLI does not wait; it cuts an MCP call at 60 s ("timed out after 60s"). `MCP_TOOL_TIMEOUT=2100000` lifts it, so every `claude` launch now sets it (headless env, `hooks.Server.Env` for TUI); `TestAdeBranchRequest` holds the call 65 s and passes. No long-poll fallback needed. The same test found a second gap: a run at a repo root could not write the new worktree, so the run sandbox now allows the per-repo `wt/<repo>` folders for unnamed branches (macOS Seatbelt not verifiable here). Deviations: adewire types, `branchRequestId` and fixtures landed in commits 2 and 3; the always-on space note also reaches manual, review and start messages and the Run dialog suffix; a smart-script step counts as an agent step for the unnamed-branch rule; ARCHITECTURE known open items: P199 unnamed-branch item removed, `declare_repos` item narrowed.

### P409 Finishing a task returns every artifact via MCP

Finish returns all artifacts created: PRs, Jira, docs, deployments, everything.

**Result.** Table `ade_task_artifacts` (migration 0058) stores agent and user reports; detected ones (tracker link, branches, commits, change requests, deployments) derive on read. Aggregator `ade/artifacts.go`: `ArtifactSource` seam (`TaskBoardDeps.ArtifactSources`, P417 plugs in), 5 s per source, failure becomes a gap, dedup by URL or (kind, repo, ref), detected beats stored. MCP `report_artifacts` (20 per call, 200 per task); `finish_step` and `handover(finished:true)` append header plus compact JSON `{"artifacts","gaps"}`, capped at 100. Bridge `Artifacts`, `AddArtifact`, `RemoveArtifact`; Artifacts tab in task and archived panels, list in the Done stage dialog. Tests: flows/adeflow `TestTaskArtifacts` (contract `ade-artifacts`), tests/ui/ade-v2-artifacts.spec.ts, real `TestAdeReportArtifacts`. Full Go, unit, ui (806), mobile, visual, lint, lint:dead, lint:go, lint:claude and the ADE and smart-script `claude` rows pass. Fixed on the way: githostflow Open count (rig keeps forge offline during its run), `ade-automation` contract (new tool).

### P410 Task plus button: terminal or ad hoc Claude session in worktree

Task gets a plus button. It starts a terminal or an ad hoc Claude session in that task's worktree.

**Result.** `AdeTaskService.StartAdHoc(branchId)` opens an agent TUI on a branch worktree with no first message; it shares `StartBranch`'s rules and grant (`startBranch` helper). Plus menu `sessions/AdeTaskLaunchMenu.vue` on the card head and the Sessions tab bar: per worktree a Terminal (Git module tab via `openRepoTerminalTab`) or an agent session; disabled items show the reason inline. Tests: flows/adeflow `TestAdHocSession` (contract `ade-adhoc`), tests/ui/ade-v2-task-launch.spec.ts, real `TestAdeAdHocSession` (in the ADE row). Full Go, unit, ui (814), mobile, visual (plan-branches snapshot re-recorded for the new icon), lint, lint:dead, lint:go, lint:claude and the ADE `claude` row pass. Dropdown items are picked by keyboard in the UI spec (the menu floats off-screen in the mock runtime). `httpclient` and `appupdate` tests failed once under concurrent load, pass alone; adeflow `-race` needs `-timeout 25m` under load.

### P411 Task statuses: move to Workflow page, fully customizable

- Task statuses live on the Workflow page, not Settings.
- Remove the unclear mapping and hardcoding. Defaults ship with the app but are fully customizable, with more color options.
- Changing a status leaves existing work items as they are.

**Result.** Editor moved from Settings to a Task statuses row on the Workflows page (`workflows/statuses/AdeTaskStatuses.vue`). A status is id, name, color (16 `--kira-status-*` colours), position; categories and the first-of-category rule are gone. Four default slots (`new`, `step`, `review`, `finished`) in `ade_task_status_defaults` name each automatic change; empty keeps the current status. Step `status:` empty uses the slot of its kind; parser and writer no longer inject seed ids. Delete requires a reassign target for every removed id, archived tasks included. Edits never touch existing tasks. Migration 0059 seeds slots from the first status per old category (test `migrate_ade_task_status_defaults_test.go`). Tests: flows/adeflow `TestTaskStatuses`, tests/ui/ade-v2-task-status.spec.ts. Full Go, unit, ui (817), mobile (83), visual (4 settings snapshots re-recorded: Settings nav lost a row), lint, lint:dead, lint:go, lint:claude pass. Three plan commits merged into one (feat(ade) editor): the old Settings pane could not typecheck against the new wire alone. No `claude` row run: no Claude integration change.

### P412 Review: stale-changes indicator, PR link in review agent prompt

- Review window shows whether changes are stale. The check runs today before approving a PR; show the indicator up front.
- Review agent prompt includes the PR link.

**Result.** Title bar badge `ade-review-head` (`useReviewHead`, shares the `changeRequest.reviewState` query): "At {short} head" or warn "Stale" (`common.stale.status`), tooltip lists local and host shas; open change request with a local tip only. Shared rule `headStale`, also used by the submit dialog. Refreshes on mount, focus, 60 s staleness and git-stream `repo.changed` refsChanged of the window's repo; no polling, no wire change. Prompts: `changeRequestURL` var on `ade.review.message` repo lines and `ade.review.round.message`; `changeRequestURL` helper in `ade/review.go` (task link first, else branch lookup, never blocks a launch); goldens, budgets, var docs updated. Tests: contract `ade-review-actions` key `#stale` (githostflow), four `ade-v2-review.spec.ts` cases, `TestReviewAgentLinksChangeRequest` (githostflow: lookup, no host) and `TestReviewAgentLinksPR` (adeflow: GitHub task link on a writable and a read-only fork review). Full run: `go test ./...`, `bun run test:unit` 1966, `ui` 820, mobile 83, visual 20 (no re-record), lint, `lint:dead`, `lint:go`, `lint:claude` pass. Real `claude` prompt registry row plus `TestAdeReviewStep`/`TestAdeReviewLost` and `test:claude:studio` pass (`TestMemoryMcpThroughClaude` failed once on model-chosen tool args, passed twice on rerun). Pre-existing flakes fixed: `TestFirstRunJourney` (waits for every branch run) and the wheel-scroll `ui` spec (retries the scroll). Deviations: tooltip attribute is `data-head` (Radix owns `data-state`); round message link is set in a new `roundMessage` helper, not `roundVars`, so followups make no host call; the fake forge has no branch links, so the task-link path is covered in adeflow with GitHub, not githostflow; stale label reuses `common.stale.status`.

### P413 Review comment dialog: fix overflow and editing, compact gutter

- Comment dialog is taller than the viewport. Fix.
- Messages cannot be edited. Fix.
- Gutter columns eat space. Proposal: plus icon replaces the line number; hunk checkmark becomes its own empty row (line 1, then checkmark row, then empty line, then line 2). If not feasible, report back.

**Result.** Feasibility verdict: both proposals feasible, both shipped, nothing declined. Plus replaces the line number: Monaco 0.56 `lineNumberClassName` hides the hovered line's digits and draws the `add` codicon; click on `GUTTER_LINE_NUMBERS` opens the composer. A commented line keeps its number, tinted; click opens the thread. Tradeoffs: clicking a number no longer selects the line (`selectOnLineNumbers: false`, right pane; drag and the context menu still work); the hovered number is hidden under the pointer; keyboard route is the context menu "Add review comment". Hunk mark as its own row: one-line view zone above each hunk's first changed line, mark in the zone's margin node (`ReviewHunkMark.vue`). Zones are not model lines, so anchors, ranges, `getLineChanges` and `revealCommentLines` keep their coordinates, and the diff editor aligns the left pane. Tradeoffs: one extra line of height per hunk; a pure deletion hunk has no mark (as before). Glyph margin gone on both panes: measured `.margin` width per pane before 64px (original) and 82px (modified), after 46px both.

Overflow: a thread is a spacer view zone plus an overlay widget (`ReviewThread.vue`), width of the visible editor, height capped at `max(12 lines, 80% of editor height)`, re-laid out by a ResizeObserver; the wheel scrolls the box, not the editor; the compose textarea autosizes and takes focus; action buttons wrap. The spacer zone sets `showInHiddenAreas` so a thread beside a collapsed region stays visible. Edit: new `review.comment.edit` (id, body, kind; keeps range, state and reply, clears `sentAt`), `ContractVersion` 55 to 56, store/session/rpc/transport, edit mode in the thread, Escape cancels, Ctrl/Cmd+Enter submits, errors show inline. Keystroke leak: suspected, tested first on the base, not reproduced (textarea keys behave normally), so no containment fix was added. Monaco forces a glyph margin onto the original pane side by side; `reviewDecorations.ts` switches it back off on change. `.margin-view-zones` is lifted over the number overlays (z-index 2) and `ReviewHunkMark` stops pointer events, else the mark click never lands.

Tests: Go flow `TestCommentEdit` with contract `git-review-edit`; UI specs for overflow, edit (ok and error), keystroke containment, gutter (no glyph margin, hover plus, comment tint, hunk row side by side and inline, mark click), context menu route; shared fixtures moved to `tests/ui/support/reviewHunkDiff.ts`; new visual baseline `review-diff-gutter`, existing baselines unchanged. Full run: `go test ./...`, `bun run test:unit` 1966, `ui` 828, mobile 83, visual 21, lint, `lint:dead`, `lint:go`, `lint:claude` pass. No real `claude` tests: no Claude integration code changed. No pre-existing failures found. Deviations: none from the plan; the review banner keeps the z-index 10 rule, the thread no longer needs it.

### P414 Status bar: running ADE agents, interface font, tooltips

- Status bar shows running agents from the ADE module, next to running processes.
- Status bar widgets use the interface font and look better.
- Review tooltips: they look odd and the text is hard to follow.

### P415 Operations panel: shared git primitives, all git ops, session and MCP ops

- Operations panel lists every git op, whatever the module.
- Git and ADE modules share one git implementation: same primitives, same abstractions.
- Also list other ops, e.g. opening an agent session.
- Also list ops done over MCP.

### P416 Move automation runs into Operations panel

Historical runs, success or failed, live in the Operations panel. Automation panel keeps only running ones. Persist errors; keep copy.

### P417 Jira via acli behind an issue-tracker abstraction, CLI setup in Settings

- Jira calls go through `acli`, as GitHub already goes through `gh`.
- From a Jira ID or link, fetch only: title, status, and the associated PRs from the dedicated section.
- Put `acli` behind an issue-tracker abstraction: more trackers come later.
- Settings gets a section on how to install and log in to `gh` and `acli`.

### P418 Review window: uncommitted changes, committed vs uncommitted split, agent panel off by default

- Review window also shows uncommitted changes, and they can be reviewed (comments, hunk checks) like committed ones.
- Clear separation between committed and uncommitted work.
- Agent panel in the review window is off by default.

### P419 Git module: editable files (read only by default, Edit button, save button or shortcut)

- Git module lets the user edit files; today it has no editing.
- Read only by default; an Edit button switches to edit mode.
- Save via a Save button or a keyboard shortcut.
- No autocomplete or other editor extras.

### P420 Kira Studio: validation proof MCP tool and window

App: Kira Studio (not Kira Space). Dedicated MCP tool for validation proof, shaped like the query editor: query plus results.

- Generic: reuses the existing data views, but the agent pushes arbitrary data from its own tools and picks how to show it (e.g. Elastic log hits pushed into an SQL data view when they map). Only plain data views for now; no visualisation view.
- Each step carries a short description of what it does.
- Grouped by session. The agent starts a session, does its operations, closes it. The user is notified only on close.
- Opens in a new window. History of older sessions; only the last 30 are kept; manual delete. Session names are unique.
- An agent can modify an existing session. The user sees old and new and accepts the new.
- Order matters everywhere: create, edit, display.
- Window design closely follows the Kira Space review window.
- Screenshot button: one tab or all tabs in order. Dropdown to save to disk; default is copy to clipboard.
- Scroll position and click-highlighted data persist per tab and match the screenshot exactly.

### P421 Code review (2 rounds)

Two rounds. Each round: one Opus review over the full diff since `main` (base: the chapter's branch point), findings file under `plans/`, then one Sonnet fixer. Round 2 covers the full diff again, including round-1 fixes.

### P422 Close chapter v0.2.23

Hand-written close per CLAUDE.md "Closing a chapter". Push, open PR to `main`.
