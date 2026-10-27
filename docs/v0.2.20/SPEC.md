# v0.2.20

Branch `chapter/v0.2.20`. First `P` is 374 (highest in `docs/HISTORY.md` is P373).

Source: user request. Phases run top to bottom.

| Phase | Title | Status |
|---|---|---|
| P374 | Script params redesign + shared branch-style components | Todo |
| P375 | Studio keeps filter value and results across tab changes | Todo |
| P376 | Terminal: Shift+Enter inserts newline | Todo |
| P377 | Foreign-branch review tasks: convert to work item, open normal task view | Todo |
| P378 | Finished/stopped agents behind a dropdown | Todo |
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

### P375 Studio keeps filter value and results across tab changes

Changing tabs in studio drops the filter value and filtered results. Keep both per tab.

### P376 Terminal: Shift+Enter inserts newline

Earlier request said Cmd+Enter; correct key is Shift+Enter. Fix in every terminal.

### P377 Foreign-branch review tasks

Other people's branches default to review. Add a menu action to convert one into a normal work item. Clicking a review task opens the branch view; it must open the normal task view like any other task.

### P378 Finished/stopped agents behind a dropdown

Finished and stopped agents take too much screen space. Move them into a dropdown.

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
