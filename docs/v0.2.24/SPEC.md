# v0.2.24

Branch `chapter/v0.2.24`. First `P` is 423 (highest in v0.2.23 is P422). Draft: opens after v0.2.23 merges.

Source: user request. Phases run top to bottom, two phases in parallel where file ownership allows (worktree per stream). More phases to be added before the review. Ends with two code review rounds, then close, then PR.

| Phase | Title | Status |
|---|---|---|
| P423 | Azure Repos support via `az` CLI, same capabilities as GitHub | Todo |
| P424 | Kibana: Discover-grade query editor with autocomplete | Todo |
| P425 | Kibana: save and update queries | Todo |
| P426 | Validation proof MCP tool: visualisation support | Todo |
| P427 | Pull request view for GitHub and Azure Repos | Todo |
| P428 | Jira issue viewer | Todo |
| P429 | PR and issue comments: post, attachments, drag and drop | Todo |
| P430 | Clipboard capture hotkey: link or text into Kira Space | Todo |
| P431 | Operations panel overhaul: looks and interactions | Todo |
| P432 | Code review (2 rounds) | Todo |
| P433 | Close chapter v0.2.24 | Todo |

## Rows

### P423 Azure Repos support via `az` CLI, same capabilities as GitHub

- Azure Repos goes through the `az` CLI, as GitHub goes through `gh`.
- Same capabilities the GitHub host has today (change requests, status, checks, branch links, discovery).
- Settings CLI section (from v0.2.23 P417) gains `az` install and login steps.
- Host abstraction stays provider-neutral.

### P424 Kibana: Discover-grade query editor with autocomplete

- Kibana support with the query capabilities of the Discover tab.
- Autocomplete suggestions as Discover offers (fields, values, operators, syntax).

### P425 Kibana: save and update queries

- Save a query for later use; update a saved query. Very important.

### P426 Validation proof MCP tool: visualisation support

- Elastic brings visualisations. Extend the v0.2.23 P420 validation proof tool so the agent can present data as a visualisation, not only plain data views.

### P427 Pull request view for GitHub and Azure Repos

- One PR, not lists or boards.
- Description, comments (read), checks status, plus the other most common details, kept simple.

### P428 Jira issue viewer

- One issue, not lists or boards.
- Title, description, common details (assignee etc.), comments (read).
- Builds on the v0.2.23 P417 issue-tracker abstraction.

### P429 PR and issue comments: post, attachments, drag and drop

- Post comments in the PR view and the issue view.
- Comments can carry attachments; drag and drop supported.

### P430 Clipboard capture hotkey: link or text into Kira Space

- Generic capture from any app: copy, press a global hotkey, Kira Space opens a quick-capture popup and reads the clipboard. No Accessibility permission; no selection reading.
- Popup recognises the content and preselects an action so Enter confirms: GitHub or Azure PR link opens the PR view, Jira key or link opens the issue viewer, anything else goes to Later.
- Global hotkey needs no Accessibility on macOS (`RegisterEventHotKey`); Wayland uses a portal or the desktop's shortcut settings.
- Out of scope: clipboard watcher (reads every copy), URL scheme, Share/Services menu, browser extension.

### P431 Operations panel overhaul: looks and interactions

- Panel works but looks and interactions feel off and clunky. Redesign both.

### P432 Code review (2 rounds)

Two rounds. Each round: one Opus review over the full diff since `main`, findings file under `plans/`, then one Sonnet fixer.

### P433 Close chapter v0.2.24

Hand-written close per CLAUDE.md "Closing a chapter". Push, open PR to `main`.
