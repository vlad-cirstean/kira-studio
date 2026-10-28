# v0.2.20

Branch `chapter/v0.2.20`. First `P` is 374 (highest in `docs/HISTORY.md` is P373).

Source: user request. Phases run top to bottom.

| Phase | Title | Status |
|---|---|---|
| P374 | Script params redesign + shared branch-style components | Done |
| P375 | Studio keeps filter value and results across tab changes | Done |
| P376 | Terminal: Shift+Enter inserts newline | Done |
| P377 | Foreign-branch review tasks: convert to work item, open normal task view | Done |
| P378 | Finished/stopped agents behind a dropdown | Done |
| P379 | ADE tasks: customizable statuses, manual moves both ways | Done |
| P380 | Automation scripts reuse one tab per script; start only from the play icon | Done |
| P381 | Reorder collections and other folders | Done |
| P382 | MCP show-results customizable per connection | Done |
| P383 | Add a work item from a GitHub link, branch taken from the link | Todo |
| P384 | Review window: fresh diffs, uncommitted changes, reviewed files keep diff, hide agent panel | Todo |
| P385 | Postman import accepts partial data again | Todo |
| P386 | Code review, 1 round (Opus review, Sonnet fix) | Todo |
| P387 | Close chapter, open PR | Todo |

## Rows

### P374 Script params redesign + shared branch-style components

Script params UI is unusable. Fix:

- Drop `label`; keep `name` only (or reverse, planner decides from code). Both serve one purpose.
- Path params use dotted borders. Replace with the design the agent module uses for branches.
- Extract that branch design into shared components; agent module and script params both use them.
- Select-type params: render options as an inline list, 1 click to pick, no dropdown.

Result: plan `plans/P374.md`. Dropped `label` (Go `Param`, zod, hover, fixtures, contracts; stored rows load unchanged). New `ValueChip` base; `BranchChip` and new `PathChip` use it; `VarText` renders `kind: 'path'`. Folder lines in run preview, script dialog and ADE context use path/branch chips. `ParamsEditor` uses a segmented type picker plus a token hint. `ParamsForm` select is a radio list (leading None when optional), multiselect a checkbox list. Removed unused catalog keys `kiraHome`, `scriptId`. Checks: lint, typecheck, lint:go, Go flows, builds, lint:dead, automations UI specs (Studio 81, Space 59) pass.

### P375 Studio keeps filter value and results across tab changes

Changing tabs in studio drops the filter value and filtered results. Keep both per tab.

Result: plan `plans/P375.md`. Root cause: Studio tab views unmount on switch; filter inputs sat in component refs and find bars cleared scans on unmount. Inputs and open flags now live in per-view runtime stores (session-only, cleared on tab close). Find bar (grid, documents, key-value, console, stream): query, options, filter-rows toggle kept; `isOpen` prop tells tab switch from close; scan kept, rescans on remount only when page changed (`WeakRef` of scanned page). Also kept: browse and definition filters, HTTP/gRPC field, header, cookie, schema and history filters, variable set and environments filter, unapplied grid/document/stream filter-row drafts (`tab-next` shortcut fires no blur). New `tests/ui/tab-filter-state.spec.ts` (6 scenarios; fail without fix). Checks: lint, typecheck, lint:dead, build:studio, 223 UI specs across touched components, unit tests pass. Not done: gRPC and variable-tab UI scenarios (covered by the HTTP one, same pattern).

### P376 Terminal: Shift+Enter inserts newline

Earlier request said Cmd+Enter; correct key is Shift+Enter. Fix in every terminal.

Result: plan `plans/P376.md`. Custom key handler in `terminalRenderer.ts` (sole xterm host, all Studio/Space/phone terminals) now maps Shift+Enter to `ESC CR`; Cmd+Enter binding removed (sends `CR`). Updated U41 reason, `ARCHITECTURE.md` fact, Space spec (Meta+Enter `CR`, Shift+Enter `ESC CR`, Enter `CR`). Checks: lint, typecheck, lint:rules, lint:dead, build:space, build:studio, Shift+Enter UI spec pass. Not verified: macOS WKWebView with real Claude Code and zsh.

### P377 Foreign-branch review tasks

Other people's branches default to review. Add a menu action to convert one into a normal work item. Clicking a review task opens the branch view; it must open the normal task view like any other task.

Result: plan `plans/P377.md`. `UpdateTask` kind `task` now converts a review task: owner cleared, review branches become mine, engine gives each a worktree plus prepare script (`prepareAttached`). review -> parked and task -> review stay refused. Task menu item `Convert to work item` (`ade-task-make-task`). Review card row click/Enter selects the task; right-click opens the task menu (`AdeBranchRow` `taskRow`). Flow test `TestReviewConvert` with contract `ade-review-convert`; UI specs in `ade-v2-task-menu`, `ade-v2-panel`. Docs: `ARCHITECTURE.md`, `agents.mdx`. Checks: lint, typecheck, lint:go, lint:dead, Go flows, build:space, full Space UI suite (700) pass. Tooltip drops the plan's final period (catalog C7). Not verified: remote-only foreign branch conversion.

### P378 Finished/stopped agents behind a dropdown

Finished and stopped agents take too much screen space. Move them into a dropdown.

Result: plan `plans/P378.md`. New `AdeStoppedMenu` popover (`ade-stopped-trigger`, `ade-stopped-count`, `ade-stopped-popover`) beside the running strip in `ade-session-bar-row`; hidden when none stopped. Take over closes it. Archived panel keeps the list inline. New store field `revealSessionId`: explicit open of a stopped session opens the popover, marks and focuses its row. Deviations from plan: count is a `rowMeta` span, not `Badge variant="count"` (lint U101); popover `w-96` (U15); row selection via `rowVariants`, reveal via `revealElement` and `useFocus` in `AdeStoppedRow` (U18, U57, U62). Archive spec supplies a stopped `H_5` session, since fixtures have none. Docs: `agents.mdx`. Checks: lint, typecheck, lint:dead, build:space, UI specs `ade-v2-sessions`, `-archive`, `-panel`, `-needs` pass; full Space UI suite not run.

### P379 ADE task statuses

Customizable statuses per ADE task. User moves a task back and forth between statuses manually.

Result: plan `plans/P379.md`. Status now stored: table `ade_task_statuses` (migration 0051; 4 seeds, 6 tones, categories todo/active/review/done, 1-20 rows), tasks hold `status_id`, `status_by`, `status_step`. Engine `syncStatus` re-applies a step's status only when the workflow position key changes; manual move (`UpdateTask statusId`) sticks until then. Blocked is a derived chip. Step `status:` holds an id; legacy names load. New `AdeTaskService.SaveStatuses` (65 methods). UI: menu `Status` submenu, `AdeStatusPicker` in Task tab, Settings `Task statuses` pane (add, rename, tone, category, reorder, delete with reassign), inspector list with `Edit statuses`. Tests: `TestTaskStatuses` (contract `ade-task-statuses`), migration 0051 backfill test, `ade-v2-task-status.spec.ts` (10). Checks: lint, typecheck, lint:go, lint:dead, Go tests incl. all flows, build:space, full Space UI suite (703 + 10 new), mobile (81), unit pass. Deviations from plan: tracker `OnStarted` hook (first TUI session counts as started); backfill treats NULL `workflow_json` as todo; repo `insertTask` defaults status so CreateTask, AddExistingBranch, Promote inherit it; inspector status select landed in commit 1; `SaveStatuses` errors map to BadRequest with raw text; flow test adds `qa` as active (plan said review, which would block removing the only active status). Contract diff beyond the new file: step status ids and task `statusId`/`statusBy` only. Not done: phone status writes, kanban board.

### P380 Automation scripts reuse one tab per script; start only from the play icon

Running the same automation script reuses its existing tab. A script starts only from its play icon; clicking elsewhere on the row does not start it.

Result: plan `plans/P380.md`. Tab key `{scriptId, taskId, branchId}` stored in terminal and script-run tab state (`automations/scriptTabs.ts`). Live key tab: start focuses it, starts nothing (gated at play, menu `Run`/`Run now`, run dialog, Space ADE start). Finished key tab: replaced in place via new `OpenTabOpts.replace` (new tab id). Run views (history, chip, resume, agent reveal) share the placement. Row click selects, double-click/Enter edits; `script-play` button starts. Tests: `TestScriptRunTwice` both apps (contract `ScriptRunsService.List#twice`), `automations-tabs.spec.ts` both apps (5 shared + 1 Space ADE), existing specs moved to the play button. Checks: lint, typecheck, lint:dead, lint:go, flows both apps, builds, full Studio UI (627) and Space UI (718 + fixed smart spec). Deviations: terminal liveness also reads the run state by terminal id (`runStates.terminalRunState`), since a run can end before the exit event; `useLiveRunByScript` moved into `runsQueries.ts` (N10 line limit); second smart start in the spec differs by one-off prompt (mock keys by args). Not done: server-side refusal of concurrent runs, stop/restart from the play button.

### P381 Reorder collections and other folders

Drag reorder for collections and other folder trees.

Result: plan `plans/P381.md`. API collections: `CollectionsRepo.ReorderCollections` (dense via `sqlitex.ReorderSortOrder`, `ErrInvalidOrder` -> `E_BAD_REQUEST`, `updated_at` untouched), bridge `CollectionsService.ReorderCollections`; folders and requests reuse `MoveItems`. Tree: collection rows drag (`RowDrop` union, header top half = before, else after last visible row of block); mixed selection and active search refuse it; menu `Move up`/`Move down` on collection, folder, request (`list.moveUp`/`list.moveDown`). Automations: `custom_scripts` `Move` takes `beforeId` (one tx, dense target set, bad id -> bad request); scripts drag between collections via shared Sortable group; `Reorder`/`ReorderCollections` unchanged; menus in new `panelMenus.ts`; Escape cancels cross-list drop (module-level `dragCancelled`). Tests: `TestCollectionOrder` (contract `api-order`), extended `TestScriptOrder` both apps (contract `script-order`), `api-order.spec.ts` (6), shared scenario `automationsOrder.ts` registered in Studio `script-order.spec.ts` and Space `automations-order.spec.ts` (5 each), unit cases for `collectionOrderFor`. Contract diff: `beforeId: null` on script Move args only. Checks: lint, lint:go, lint:dead, typecheck, Go tests, builds, full Space UI (724), full Studio UI (631 pass, 2 failures fixed and rerun green). Fixes outside scope: script move contract expectation, gocritic `appendAssign` in `scripts/repo.go`, stale `script-dialog` visual baseline (predates run-folder chip restyle). Not done: macOS WKWebView drag feel.

### P382 MCP show-results customizable per connection

Result display settings for MCP "show results" set per connection.

Result: plan `plans/P382.md`. New per-connection `mcpReviewResults` (inherit, review, send; column `mcp_review_results`, migration 0045, default inherit). `dbmcp.reviewResults` gates `run_query`: inherit reads `dbMcp.previewResponses`, review always holds, send never. Repo scan coerces an unknown value to review (fail closed). Input normalizes `""` to inherit and refuses other values; `zeroExemptFields` clears it; DataGrip import sets inherit. Shared zod `mcpReviewResultsSchema` (default inherit). UI: segmented "Review results" control in the connection MCP tab (inherit label shows the app state), glance line in Settings > Database MCP for non-inherit rows, preview switch description mentions the override. Tests: `TestDbMcpReviewPerConnection` (contract `dbmcp-review-connection`), `dbmcp-review-connection.spec.ts` (3), `connection-dialog-tabs` review assertions; `connection-order` contract gains the field. Checks: lint, typecheck, lint:go, lint:dead, Go tests incl. all flows, build:studio, full Studio UI (all green but the `api-order` focus test), visual, `test:claude:studio` pass. Deviations from plan: migration registered in `embed.go`; fixtures and draft default landed in commit 1 (typecheck demands them); connection dialog moved from size `xl` to `2xl` (h-160) since the MCP tab no longer fit the fixed height (U2 bars a height class); create/update mocks in `tooltips`, `fake-data`, `mutations` specs gained the field; two visual baselines refreshed (connection dialog width, Database MCP pane text); i18n option keys split into `reviewInheritOn/Off.option` (no ICU select). Not done: per-connection render limits, default dialog view. Known flake, not caused here: `api-order.spec.ts` "Move up is disabled on the first, Alt+ArrowDown moves and keeps focus" fails under parallel load, passes alone; no files it touches changed in this phase.

### P383 Add a work item from a GitHub link

Add a work item by pasting a GitHub link (PR or branch URL). Derive the branch from the link and attach it.

### P384 Review window fixes

- Review window shows the latest committed changes. Find why it goes stale and when it refreshes; refresh on the right events.
- Show uncommitted changes, clearly separated from committed ones.
- Marking a file reviewed keeps its diff visible on return (as on GitHub), not the plain file.
- Add the missing button that hides the agent panel.

### P385 Postman import accepts partial data again

An earlier phase made the Postman import reject items with missing values. The export itself lacked that data. Revert to importing partial data too.

### P386 Code review

One round, per `CLAUDE.md`. Base: last commit of `v0.2.19` (`902cf7e`). Findings file under `plans/`.

### P387 Close chapter, open PR

Hand-written fold per `CLAUDE.md`. Open PR per `docs/DEV_ENVIRONMENT.md`.
