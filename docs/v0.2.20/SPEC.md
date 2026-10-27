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
| P379 | ADE tasks: customizable statuses, manual moves both ways | Todo |
| P380 | Automation scripts reuse one tab per script | Todo |
| P381 | Reorder collections and other folders | Todo |
| P382 | MCP show-results customizable per connection | Todo |
| P383 | Code review, 1 round (Opus review, Sonnet fix) | Todo |
| P384 | Close chapter, open PR | Todo |

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

### P380 Automation scripts reuse one tab per script

Running the same automation script reuses its existing tab.

### P381 Reorder collections and other folders

Drag reorder for collections and other folder trees.

### P382 MCP show-results customizable per connection

Result display settings for MCP "show results" set per connection.

### P383 Code review

One round, per `CLAUDE.md`. Base: last commit of `v0.2.19` (`902cf7e`). Findings file under `plans/`.

### P384 Close chapter, open PR

Hand-written fold per `CLAUDE.md`. Open PR per `docs/DEV_ENVIRONMENT.md`.
