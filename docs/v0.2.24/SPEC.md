# v0.2.24

Branch `chapter/v0.2.24`. First `P` is 423 (highest in v0.2.23 is P422). Draft: opens after v0.2.23 merges.

Source: user request. Phases run top to bottom, two phases in parallel where file ownership allows (worktree per stream). Scope is closed: any further phases go to v0.2.25. Ends with two code review rounds, then close, then PR.

| Phase | Title | Status |
|---|---|---|
| P423 | Azure Repos support via `az` CLI, same capabilities as GitHub | Done |
| P424 | Kibana: Discover-grade query editor with autocomplete | Done |
| P425 | Kibana: save and update queries | Done |
| P426 | Validation proof MCP tool: visualisation support | Done |
| P427 | Pull request view for GitHub and Azure Repos | Done |
| P428 | Jira issue viewer | Done |
| P429 | PR and issue comments: post, attachments, drag and drop | Done |
| P430 | Clipboard capture hotkey: link or text into Kira Space | Done |
| P431 | Stage settings injection in the workflow editor (auto compact limit) | Done |
| P432 | Operations panel overhaul: looks and interactions | Done |
| P433 | Frontend data and memory sweep: keep state across tabs, minimal RAM | Done |
| P434 | Code review (2 rounds) | Done |
| P435 | Close chapter v0.2.24 | Done |

## Rows

### P423 Azure Repos support via `az` CLI, same capabilities as GitHub

- Azure Repos goes through the `az` CLI, as GitHub goes through `gh`.
- Same capabilities the GitHub host has today (change requests, status, checks, branch links, discovery).
- Settings CLI section (from v0.2.23 P417) gains `az` install and login steps.
- Host abstraction stays provider-neutral.

**Result:** Azure Repos host through `az` with GitHub parity (change requests, status, checks, branch links, discovery); Settings CLI section gains `az` install and login steps. Azure success-path JSON fixtures are hand-written, unchecked against a real org; `az` calls are not in the op log.

### P424 Kibana: Discover-grade query editor with autocomplete

- Kibana support with the query capabilities of the Discover tab.
- Autocomplete suggestions as Discover offers (fields, values, operators, syntax).

**Result:** Discover-grade Kibana editor: hand-rolled Go KQL compiler, field/value/operator autocomplete, hits histogram (ECharts 6.1.0, vue-echarts 8.3.2). `/internal/search/es` is an internal Kibana API (Known open item).

### P425 Kibana: save and update queries

- Save a query for later use; update a saved query. Very important.

**Result:** Save and update Kibana queries (migration 0047, `queriesUpdateDiscover`, Cmd/Ctrl+S, saved menu, tab link, column selection). Flow test plus UI specs.

### P426 Validation proof MCP tool: visualisation support

- Elastic brings visualisations. Extend the v0.2.23 P420 validation proof tool so the agent can present data as a visualisation, not only plain data views.

**Result:** Proof tool `chart` view (line, bar, stacked bar, pie, scatter): migration 0048, Go validation, `ProofChart.vue`, 3 visual baselines, `TestProofChartThroughClaude`. Bar and scatter cap 1000 points (capture time). `budgets.spec.ts` cached tree expand missed 53 ms vs 50 ms once under load; recheck on idle host.

### P427 Pull request view for GitHub and Azure Repos

- One PR, not lists or boards.
- Description, comments (read), checks status, plus the other most common details, kept simple.

**Result:** One-PR view for GitHub and Azure Repos in a Space host-view window: description, comments (read), checks, common details. Provider-neutral `HostViewService`; Markdown rendered with escaping.

### P428 Jira issue viewer

- One issue, not lists or boards.
- Title, description, common details (assignee etc.), comments (read).
- Builds on the v0.2.23 P417 issue-tracker abstraction.

**Result:** Jira issue viewer in the same host-view frame: fields, sidebar, comments. Hand-rolled ADF-to-Markdown converter (candidate libraries lacked escaping and link-scheme filtering).

### P429 PR and issue comments: post, attachments, drag and drop

- Post comments in the PR view and the issue view.
- Comments can carry attachments; drag and drop supported.

**Result:** Post comments and replies on PRs and issues with a Markdown composer. No attachments on any host (user decision, iter2): Kira never touches a CLI's credentials, and no driven CLI uploads a comment attachment. Narrows the spec lines on attachments and drag and drop. Live acli post unverified (Known open items).

**Part 2: Docker no credential reads.** Plan `plans/P429-part2-docker-no-credential-reads.md`. `buildTLS` hands PEM paths to `go-connections/tlsconfig.Client`; current context comes from `docker context show` (cached until client rebuild), never `config.json`. G5 covers `internal/docker`. Moves the Docker half of v0.2.25 P443 here. `go test -race ./internal/docker/...` and dockerflow pass.

### P430 Clipboard capture hotkey: link or text into Kira Space

- Generic capture from any app: copy, press a global hotkey, Kira Space opens a quick-capture popup and reads the clipboard. No Accessibility permission; no selection reading.
- Popup recognises the content and preselects an action so Enter confirms: GitHub or Azure PR link opens the PR view, Jira key or link opens the issue viewer, anything else goes to Later.
- Global hotkey needs no Accessibility on macOS (`RegisterEventHotKey`); Wayland uses a portal or the desktop's shortcut settings.
- No tray icon. The hotkey works while the app process runs (macOS keeps it running with no window). On Windows and Linux it works only while the app is running; no background mode.
- Out of scope: tray icon, clipboard watcher (reads every copy), URL scheme, Share/Services menu, browser extension.

**Result:** Global capture hotkey opens quick-capture popup; clipboard classified, action preselected (PR link, Jira key, else Later). Default chord `CmdOrCtrl+Shift+K`, user-customisable in Settings > Capture (`capture.enabled`, `capture.hotkey`), re-registered live with conflict status. Bridge types are TS interfaces, not zod. Windows/Linux work only while app runs.

### P431 Stage settings injection in the workflow editor (auto compact limit)

- Workflow editor can inject settings per stage. First and only setting for now: the auto compact limit.
- Provider-neutral: Claude is the only provider today, more come. Settings are a provider-keyed catalog (each provider declares which stage settings it supports, their types, ranges and how they map onto its launch config/env/flags); the editor renders from the catalog.
- Applied when the stage's agent session launches; absent means provider default.

**Result:** Stage `settings` in workflow YAML, wire, editor (Advanced) and headless/TUI launches; Claude `auto_compact_window` maps to `--autocompact` (100k to 1M). A user-exported `CLAUDE_CODE_AUTO_COMPACT_WINDOW` overrides the flag (Known open item).

### P432 Operations panel overhaul: looks and interactions

- Panel works but looks and interactions feel off and clunky. Redesign both.

**Result:** Operations panel overhaul in both apps on the shared `OpLogPanel` shell: toolbar, facets, detail pane, tree of steps, narrow-width layout, copy actions. Memory-tool prompt fix; flaky UI waits hardened.

### P433 Frontend data and memory sweep: keep state across tabs, minimal RAM

- Deep sweep over how the frontend handles data.
- Switching tabs never loses state or data, and never refetches only because the user interacts with the UI.
- Memory use is as low as practical: audit kept-alive views, query caches (TanStack gcTime/staleTime), stores, large lists and editors, and release what is not needed.
- Measure before and after (heap per tab/view); goal is a great experience with the least RAM.

**Result:** State kept across tabs in both apps (`KEEP_WHILE_OPEN`, Discover data view and histogram, keyvalue page, mask rules, Monaco view state). Saved-query and filter-history reads drop `staleTime: 0` via Go events. Space repo file and diff reads gated on stat (`unchanged` answer). Heap probe and before/after numbers in `P433-measurements.md`. Space `closed2 - closed` 2.8 to 0.3 MB: target met. Studio Discover growth per round about 3.7 to about 0.6 MB after iter2: target 0.5 missed, JIT code suspected, Known open items entry kept, reworded. Skipped Space local-file refetch: no OpenedFiles watcher, so a skipped read is unsafe. Named exceptions kept: Kibana data view picker (60 s) and `staleTime: 0` reads of data Kira does not own. Studio UI 675 passed, Space UI 940 passed, Go tests passed.

### P434 Code review (2 rounds)

Two rounds. Each round: one Opus review over the full diff since `main`, findings file under `plans/`, then one Sonnet fixer.

**Result:** Two review rounds. Round 1 found 8, round 2 found 4; all fixed.

### P435 Close chapter v0.2.24

Hand-written close per CLAUDE.md "Closing a chapter". Push, open PR to `main`.

**Result:** Final verification on the integrated tree: typecheck, `lint:all`, `go test ./...`, flows, Space UI 938 and Studio UI 682 pass; `budgets.spec.ts` cached tree expand p50 32 ms on an idle host (budget 50 ms). Fixed on the way: terminal unregisters before signalling done (flaky `TestTwoWindowsIsolation`), i18n catalog test exempts the stage settings catalog, Discover retention spec stays under the data view `gcTime`. Chapter folded by hand into `docs/HISTORY.md`; `docs/v0.2.24/` removed; PR opened to `main`.
