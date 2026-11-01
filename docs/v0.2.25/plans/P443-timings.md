# P443 timings

Raw Playwright JSON stays out of the repo. Tables come from `bun scripts/ui-timings.ts`. Host: 4 cores, 15 GB, Playwright 1.64.1.

## Before

Commit `f5f48f839`, clean tree, no fix applied yet.

Preconditions (quoted):

- Studio start: `19:45:39 up 10:04,  0 user,  load average: 0.68, 1.98, 5.75`; `pgrep -fa 'playwright|WebKit|chrome|go test|golangci'` empty.
- Space start: `20:05:56 up 10:25,  0 user,  load average: 0.93, 8.52, 10.35`; same pgrep, empty.
- `df -h /`: 3.8G free. Plan asked 6 GB; 3.8 GB is what this host has and no shared cache is deleted. Runs finished without disk errors.
- Max 1-min load during run (sampled every 30 s): Studio 18.78, Space 19.64. Four WebKit workers saturate the host by design; load before start was below 1.
- Studio build (`build:test:studio`): 9 s. Space build (`build:test:space`): 9 s. Under 60 s, so no build-skip script.
- Studio tests: 1087 s Playwright wall (`ui` + `ui-clipboard` + `ui-timing`). Space tests: 1162 s (`ui`).
- Failures: none in either app. `budgets.spec.ts:382` passed; its keystroke line read `keystroke -> completion popup: p50=39.0ms p95=55.0ms` (budget 50 ms), so the Known open item did not reproduce in this run.
- Boot check for step 6: Studio `ui` median 4.1 s vs minimum 1.6 s (2.6x); Space median 4.8 s vs minimum 1.4 s (3.4x). Ratio is above 2x, so boot does not dominate.

### Studio Before

Playwright wall time (stats.duration): 1087.2 s

| project | tests | passed | failed | timed out | skipped | sum s | wall s | parallelism | median s | min s |
|---|---|---|---|---|---|---|---|---|---|---|
| ui | 701 | 701 | 0 | 0 | 0 | 3995.5 | 1009.7 | 3.96 | 4.1 | 1.6 |
| ui-clipboard | 2 | 2 | 0 | 0 | 0 | 15.1 | 8.5 | 1.78 | 7.6 | 6.6 |
| ui-timing | 4 | 4 | 0 | 0 | 0 | 66.6 | 66.8 | 1.00 | 11.6 | 5.6 |

#### ui: slowest 30 files

| file | tests | sum s | % of project sum |
|---|---|---|---|
| tests/ui/slick-grid.spec.ts | 22 | 302.2 | 7.6 |
| tests/ui/console.spec.ts | 9 | 149.6 | 3.7 |
| tests/ui/autocomplete.spec.ts | 15 | 141.4 | 3.5 |
| tests/ui/api-ui-consistency.spec.ts | 32 | 137.5 | 3.4 |
| tests/ui/sql-schema.spec.ts | 12 | 131.2 | 3.3 |
| tests/ui/grpc-request.spec.ts | 25 | 109.4 | 2.7 |
| tests/ui/console-explain.spec.ts | 9 | 106.1 | 2.7 |
| tests/ui/copy-coverage.spec.ts | 26 | 104.4 | 2.6 |
| tests/ui/control-sizing.spec.ts | 20 | 103.4 | 2.6 |
| tests/ui/cell-editor.spec.ts | 4 | 103.2 | 2.6 |
| tests/ui/console-format.spec.ts | 10 | 98.3 | 2.5 |
| tests/ui/ui-leftovers.spec.ts | 19 | 96.6 | 2.4 |
| tests/ui/http-request.spec.ts | 16 | 71.6 | 1.8 |
| tests/ui/automations-module.spec.ts | 19 | 69.9 | 1.7 |
| tests/ui/interaction.spec.ts | 1 | 68.1 | 1.7 |
| tests/ui/docker-module.spec.ts | 17 | 66.9 | 1.7 |
| tests/ui/proof-window.spec.ts | 9 | 62.8 | 1.6 |
| tests/ui/list-keyboard.spec.ts | 12 | 58.4 | 1.5 |
| tests/ui/kibana-saved.spec.ts | 4 | 51.0 | 1.3 |
| tests/ui/view-connection-drop.spec.ts | 7 | 50.1 | 1.3 |
| tests/ui/tree.spec.ts | 4 | 47.2 | 1.2 |
| tests/ui/tabs.spec.ts | 4 | 46.0 | 1.2 |
| tests/ui/tab-filter-state.spec.ts | 6 | 45.4 | 1.1 |
| tests/ui/proof-chart.spec.ts | 5 | 44.9 | 1.1 |
| tests/ui/collections.spec.ts | 14 | 44.4 | 1.1 |
| tests/ui/docker-edit.spec.ts | 8 | 42.2 | 1.1 |
| tests/ui/consistency.spec.ts | 14 | 42.1 | 1.1 |
| ../../packages/workbench/src/testing/ui/scenarios/automationsEditor.ts | 7 | 42.1 | 1.1 |
| tests/ui/http-history.spec.ts | 7 | 40.8 | 1.0 |
| tests/ui/data-view.spec.ts | 1 | 39.7 | 1.0 |

#### ui: slowest 30 tests

| file:line | title | s | status |
|---|---|---|---|
| tests/ui/interaction.spec.ts:1093 | interaction completeness — grid menus, selection, copy/paste, shortcuts | 68.1 | passed |
| tests/ui/cell-editor.spec.ts:333 | cell editor — autodetect, beautify, override, NULL/empty/truncated, read-only | 47.1 | passed |
| tests/ui/slick-grid.spec.ts:360 | SlickGrid spike — §7.4(a)'s eight sandbox-provable exit criteria | 43.0 | passed |
| tests/ui/data-view.spec.ts:1055 | data view — pagination, count, projection, sort, filter, search, stop, NULLs | 39.7 | passed |
| tests/ui/slick-grid.spec.ts:850 | P22 iter2-onset — a fresh gesture sizes its runway from that gesture, not from before it | 37.7 | passed |
| tests/ui/leaks.spec.ts:281 | leak sweep — tab/store symmetry, connection delete purges the tree | 37.7 | passed |
| tests/ui/tree.spec.ts:167 | project tree — expansion, caching, disconnect/reconnect, search, filters, menus | 34.5 | passed |
| tests/ui/slick-grid.spec.ts:572 | P22 iter2-pacing — a catch-up render never shares a frame with a scroll-driven one | 31.1 | passed |
| tests/ui/cell-editor.spec.ts:842 | cell editor — UUID generate, timestamp translate pane, hex/base64 decoded pane | 30.8 | passed |
| tests/ui/console.spec.ts:48 | Query console — open, run statement/all, errors, saved queries | 28.6 | passed |
| tests/ui/slick-grid.spec.ts:1259 | P22 Pass B C9 — the pacing invariant holds with N staged insert rows on screen | 27.3 | passed |
| tests/ui/definition.spec.ts:148 | Definition tab — Structure/Source, columns menu, notes, read-only, cache and refresh | 24.5 | passed |
| tests/ui/kibana-saved.spec.ts:68 | contract: Discover saves, updates and reopens a query, and flags unsaved edits | 20.0 | passed |
| tests/ui/console.spec.ts:380 | Query console — a filter change clears the tabular selection, and a gutter click selects the whole row (P19 D8) | 18.7 | passed |
| tests/ui/autocomplete.spec.ts:855 | console lint — Mongo diagnostics (D24) | 18.6 | passed |
| tests/ui/mutations.spec.ts:224 | mutations — edit, add, delete, preview, commit, discard, read-only guard | 18.6 | passed |
| tests/ui/console.spec.ts:465 | Query console — the one-cell selection highlight clears (not jumps) when its own row is filtered out (finding 2) | 18.0 | passed |
| tests/ui/console.spec.ts:271 | Query console — result-set strip, new-vs-reuse toggle, find toolbar (P40) | 17.7 | passed |
| tests/ui/console.spec.ts:802 | Query console — a tabular selection copies as TSV/CSV/JSON, rows/columns/ranges alike (P19 D9/D10) | 17.4 | passed |
| tests/ui/sql-schema.spec.ts:182 | a rejected Save shows the error and leaves the dialog open | 16.4 | passed |
| tests/ui/connections.spec.ts:330 | connection dialog CRUD, colors, and D7/D9 secret handling | 15.8 | passed |
| tests/ui/console.spec.ts:538 | Query console — result-tab right-click: close, close others, close to the right (P42) | 15.8 | passed |
| tests/ui/tabs.spec.ts:265 | the tab strip scrolls once tabs overflow it (P31 D6/D7) | 15.7 | passed |
| tests/ui/grid-copy-menu.spec.ts:69 | console grid — right-click copy acts on the selection and matches the keyboard | 15.6 | passed |
| tests/ui/cell-editor.spec.ts:1264 | cell editor — owned by the view, never shows another tab's cell | 15.4 | passed |
| tests/ui/grid-copy-menu.spec.ts:191 | data grid — right-click copy matches the keyboard per selection kind | 15.3 | passed |
| tests/ui/tooltips.spec.ts:169 | tooltips — app-owned surface: delay, disabled controls, popovers, a11y | 15.0 | passed |
| tests/ui/tabs.spec.ts:119 | tabs — independent state, context menu, colours | 14.2 | passed |
| tests/ui/console-explain.spec.ts:287 | Query console — not explainable (an UPDATE) disables the button | 14.2 | passed |
| tests/ui/proof-chart.spec.ts:176 | contract: the copied screenshot holds the chart and never a tooltip | 14.1 | passed |

#### ui: failures (0)


#### ui-clipboard: slowest 30 files

| file | tests | sum s | % of project sum |
|---|---|---|---|
| tests/ui/grid-copy-menu.spec.ts | 2 | 15.1 | 100.0 |

#### ui-clipboard: slowest 30 tests

| file:line | title | s | status |
|---|---|---|---|
| tests/ui/grid-copy-menu.spec.ts:69 | console grid — right-click copy acts on the selection and matches the keyboard | 8.5 | passed |
| tests/ui/grid-copy-menu.spec.ts:191 | data grid — right-click copy matches the keyboard per selection kind | 6.6 | passed |

#### ui-clipboard: failures (0)


#### ui-timing: slowest 30 files

| file | tests | sum s | % of project sum |
|---|---|---|---|
| tests/ui/budgets.spec.ts | 1 | 37.8 | 56.8 |
| tests/ui/slick-grid.spec.ts | 2 | 15.7 | 23.6 |
| tests/ui/perf.spec.ts | 1 | 13.0 | 19.6 |

#### ui-timing: slowest 30 tests

| file:line | title | s | status |
|---|---|---|---|
| tests/ui/budgets.spec.ts:382 | interaction budgets — scroll, cell→editor, cached tab switch, cached tree expand | 37.8 | passed |
| tests/ui/perf.spec.ts:106 | perf tripwires — scroll frame time, DOM cell bound, retained bytes | 13.0 | passed |
| tests/ui/slick-grid.spec.ts:933 | P22 Pass B C6 — select-all completes within the 150ms sandbox gate, wide and tall | 10.2 | passed |
| tests/ui/slick-grid.spec.ts:1040 | P22 Pass B C12 T7 — select-all stays within the 150ms sandbox gate with 10 000 search matches active | 5.6 | passed |

#### ui-timing: failures (0)



### Space Before

Playwright wall time (stats.duration): 1162.0 s

| project | tests | passed | failed | timed out | skipped | sum s | wall s | parallelism | median s | min s |
|---|---|---|---|---|---|---|---|---|---|---|
| ui | 953 | 953 | 0 | 0 | 0 | 4571.0 | 1160.0 | 3.94 | 4.8 | 1.4 |

#### ui: slowest 30 files

| file | tests | sum s | % of project sum |
|---|---|---|---|
| tests/ui/ade-v2-workflows.spec.ts | 40 | 281.1 | 6.1 |
| tests/ui/ade-v2-review.spec.ts | 47 | 176.2 | 3.9 |
| tests/ui/ade-v2-panel.spec.ts | 28 | 161.4 | 3.5 |
| tests/ui/ade-v2-plan.spec.ts | 28 | 139.3 | 3.0 |
| tests/ui/ade-v2-run.spec.ts | 21 | 122.4 | 2.7 |
| tests/ui/ade-v2-sessions.spec.ts | 15 | 98.2 | 2.1 |
| tests/ui/ade-v2-base-rebase.spec.ts | 16 | 93.7 | 2.1 |
| tests/ui/copy-coverage-git.spec.ts | 17 | 92.3 | 2.0 |
| tests/ui/repo-workspace.spec.ts | 22 | 88.7 | 1.9 |
| tests/ui/ade-v2-review-open.spec.ts | 14 | 88.1 | 1.9 |
| tests/ui/ade-v2-task-status.spec.ts | 13 | 86.9 | 1.9 |
| tests/ui/ade-v2-task-branches.spec.ts | 13 | 84.5 | 1.8 |
| tests/ui/ade-v2-automations.spec.ts | 13 | 75.8 | 1.7 |
| tests/ui/ade-v2-sessions-menu.spec.ts | 11 | 75.7 | 1.7 |
| tests/ui/repo-graph-keep-state.spec.ts | 7 | 72.6 | 1.6 |
| tests/ui/ade-v2-dialogs.spec.ts | 10 | 62.0 | 1.4 |
| tests/ui/consistency.spec.ts | 12 | 61.4 | 1.3 |
| tests/ui/repo-review-interaction.spec.ts | 11 | 57.2 | 1.3 |
| tests/ui/agent-usage.spec.ts | 13 | 56.7 | 1.2 |
| tests/ui/repo-graph-paging.spec.ts | 4 | 56.7 | 1.2 |
| tests/ui/ade-v2-sandbox.spec.ts | 8 | 55.3 | 1.2 |
| tests/ui/copy-coverage.spec.ts | 10 | 54.6 | 1.2 |
| tests/ui/ade-v2-launch.spec.ts | 8 | 53.5 | 1.2 |
| tests/ui/ade-v2-archived.spec.ts | 9 | 52.9 | 1.2 |
| tests/ui/repo-file-edit.spec.ts | 9 | 52.2 | 1.1 |
| tests/ui/repos-dialog.spec.ts | 17 | 52.2 | 1.1 |
| tests/ui/ade-v2-review-step.spec.ts | 14 | 50.9 | 1.1 |
| tests/ui/ade-v2-task-launch.spec.ts | 8 | 48.4 | 1.1 |
| tests/ui/graph-blank-rows.spec.ts | 4 | 46.7 | 1.0 |
| tests/ui/repo-graph-columns.spec.ts | 10 | 45.5 | 1.0 |

#### ui: slowest 30 tests

| file:line | title | s | status |
|---|---|---|---|
| tests/ui/graph-blank-rows.spec.ts:330 | a relayout that races a scroll and a click leaves the rows painted and the click on its row | 21.7 | passed |
| tests/ui/repo-graph-paging.spec.ts:365 | a resized graph column keeps every node after Load more | 19.5 | passed |
| tests/ui/repo-graph-paging.spec.ts:332 | columns resized wide never push the graph out of view | 15.1 | passed |
| tests/ui/repo-graph-paging.spec.ts:239 | outer-lane commits keep their node across scroll, click and Load more | 13.7 | passed |
| tests/ui/graph-blank-rows.spec.ts:213 | rows stay painted through scroll, click and Show more, collapsed or not | 12.7 | passed |
| tests/ui/automations-tabs.spec.ts:52 | ADE: one tab per script and task; a live repeat focuses instead of starting | 11.9 | passed |
| tests/ui/repo-graph-keep-state.spec.ts:206 | a refresh while the graph is hidden defers to one in-place refresh on show | 11.8 | passed |
| tests/ui/repo-graph-keep-state.spec.ts:231 | closing the workspace unmounts the kept graph; reopening mounts cold | 11.6 | passed |
| tests/ui/ade-v2-launch.spec.ts:145 | a launch behind a running prepare script shows its progress and waits | 11.5 | passed |
| tests/ui/repo-graph-keep-state.spec.ts:139 | "Open in graph" from a file scrolls the hidden graph to the commit once shown | 11.5 | passed |
| tests/ui/repo-graph-widths.spec.ts:101 | dragging the author, date and graph handles moves that boundary with the pointer | 11.2 | passed |
| tests/ui/ade-v2-flat-steps.spec.ts:132 | contract: the inspector switches field groups per kind, keeps Advanced closed, and saves kinds | 10.7 | passed |
| tests/ui/repo-graph-keep-state.spec.ts:101 | opening a diff and returning keeps the graph mounted with scroll and selection | 10.7 | passed |
| tests/ui/repo-workspace.spec.ts:421 | contract: a repo workspace: the status bar blame item follows the cursor, and never shows on a revision-pinned tab (P76) | 10.5 | passed |
| tests/ui/ade-v2-sessions-menu.spec.ts:115 | the row menu opens by right-click and Shift+F10 | 10.1 | passed |
| tests/ui/repo-file-gate.spec.ts:135 | switching away from a file and a diff and back sends the previous stat and shows the same text | 10.1 | passed |
| tests/ui/consistency.spec.ts:152 | a 5000-line run log renders a window of rows and follows the tail | 9.9 | passed |
| tests/ui/ade-v2-workflows.spec.ts:511 | the step menu skips a step, and the last runnable step cannot be skipped | 9.9 | passed |
| ../../packages/workbench/src/testing/ui/scenarios/automationsEditor.ts:190 | prompt completion: a bare { lists params, a secret is never offered, Enter is a newline | 9.4 | passed |
| tests/ui/repo-graph-keep-state.spec.ts:163 | switching to the ADE module and back keeps the graph mounted | 9.3 | passed |
| tests/ui/ade-v2-panel.spec.ts:441 | the step mover goes back, picks any step and is off while a run is live | 9.3 | passed |
| tests/ui/repo-graph-keep-state.spec.ts:178 | a date-format change applies to the already-mounted graph | 9.2 | passed |
| tests/ui/ade-v2-workflows.spec.ts:295 | Delete removes the selected step after asking | 9.2 | passed |
| tests/ui/ade-v2-workflows.spec.ts:305 | steps add from the graph button and from the step menu, by kind | 9.1 | passed |
| tests/ui/ade-v2-workflows.spec.ts:321 | the step menu makes a step the start and removes one after asking | 9.1 | passed |
| tests/ui/repo-graph-badges.spec.ts:140 | dragging the author column wide leaves the badges whole and the +N chip visible | 8.8 | passed |
| tests/ui/ade-v2-task-menu.spec.ts:35 | Mark as not merging, Copy task id and Archive call their backends | 8.8 | passed |
| tests/ui/copy-coverage.spec.ts:54 | plan board, task card menu and day menu | 8.6 | passed |
| tests/ui/repo-graph-keep-state.spec.ts:255 | opening a diff and returning keeps the commit detail pane open | 8.6 | passed |
| tests/ui/ade-v2-workflows.spec.ts:277 | a result added in the inspector gets its own connector | 8.4 | passed |

#### ui: failures (0)



## Worker sweep

Subset, `--project=ui`, idle start (1-min load below 1 before each run), 4 cores.

- Studio (7 files, 124 tests, 25% of `ui` sum): slick-grid, console, autocomplete, api-ui-consistency, sql-schema, grpc-request, console-explain.
- Space (8 files, 212 tests, 25% of `ui` sum): ade-v2-workflows, ade-v2-review, ade-v2-panel, ade-v2-plan, ade-v2-run, ade-v2-sessions, ade-v2-base-rebase, copy-coverage-git.

| app | --workers | wall s (stats.duration) | effective parallelism | failed | timed out |
|---|---|---|---|---|---|
| studio | 2 | 354.1 | 1.98 | 0 | 0 |
| studio | 3 | 328.4 | 2.96 | 0 | 0 |
| studio | 4 | 314.5 | 3.92 | 0 | 0 |
| studio | 6 | 297.5 | 3.93 | 0 | 0 |
| space | 2 | 350.1 | 1.97 | 0 | 0 |
| space | 3 | 291.9 | 2.95 | 0 | 0 |
| space | 4 | 288.7 | 3.91 | 0 | 0 |
| space | 6 | 296.2 | 3.91 | 0 | 0 |

Reading:

- `--workers=6` never ran 6 workers: parallelism stays 3.9. Each `ui` project sets `workers: '100%'` (4 here), and a project value narrows the CLI/top-level pool, never widens it. The 6 rows are a second 4-worker sample; they give the noise floor (Studio 314.5 vs 297.5 s, Space 288.7 vs 296.2 s: up to 6%).
- Scaling is linear to 3 workers and flat to 4 inside that noise. No failure or timeout at any count.
- Choice: keep `'100%'` (4). Raising the pool past the 4 cores needs a top-level and project change, and 6 workers on 4 cores would add load-induced timeouts for no measured gain (the sweep cannot show a gain). No config change.
- Sharding: not added. `--shard` on one 4-core host splits the same cores.

## After

Commit `a5e8a1236` plus the ade-v2-dialogs hover fix (committed next). Studio `ui` + `ui-clipboard` (what `bun run test:ui:studio` now runs), Space `ui`, each once.

Preconditions (quoted):

- Studio start: `22:24:08 up 12:43,  0 user,  load average: 0.96, 8.84, 11.94`; pgrep empty.
- `ui-timing` start: `22:44:40 up 13:03,  0 user,  load average: 0.97, 8.56, 12.10`; pgrep empty.
- Space start: `22:46:58 up 13:06,  0 user,  load average: 0.91, 5.97, 10.65`; pgrep empty.
- `df -h /`: 3.8G free (see Before).
- Max 1-min load during run: Studio 18.20, Space 18.48.
- Builds: Studio 9 s, Space 10 s.
- Failure: Space `ade-v2-dialogs.spec.ts:45 a blank message disables Send` (Send stayed enabled after `fill('   ')`, 5 s expect timeout), under load 18. File not touched by this phase. Lone rerun, `--repeat-each=10` of the file: 99 of 100 passed; the one failure was a different test, `:147 Details lists Merge and Re-merge buttons and the stale tip invites a right click` (tooltip never opened). Further 120 runs of both: `:147` failed again once, `:45` 0 of 60. Cause of `:147`: reka tooltips open on pointermove, and the pointer already rested on the row; fixed in the spec by moving the pointer to a corner first (same note as `support/tooltip.ts` in Studio). After the fix: 150 of 150 pass. `:45` did not reproduce (1 failure in 170 runs of the file, all under or after load); left as a single load flake.

### Studio After

Playwright wall time (stats.duration): 1053.8 s

| project | tests | passed | failed | timed out | skipped | sum s | wall s | parallelism | median s | min s |
|---|---|---|---|---|---|---|---|---|---|---|
| ui | 701 | 701 | 0 | 0 | 0 | 4134.8 | 1043.8 | 3.96 | 4.3 | 1.5 |
| ui-clipboard | 2 | 2 | 0 | 0 | 0 | 14.4 | 8.0 | 1.80 | 7.2 | 6.4 |

#### ui: slowest 30 files

| file | tests | sum s | % of project sum |
|---|---|---|---|
| tests/ui/slick-grid.spec.ts | 22 | 275.9 | 6.7 |
| tests/ui/console.spec.ts | 9 | 161.4 | 3.9 |
| tests/ui/autocomplete.spec.ts | 15 | 141.6 | 3.4 |
| tests/ui/api-ui-consistency.spec.ts | 32 | 126.4 | 3.1 |
| tests/ui/sql-schema.spec.ts | 12 | 120.3 | 2.9 |
| tests/ui/console-explain.spec.ts | 9 | 118.6 | 2.9 |
| tests/ui/console-format.spec.ts | 10 | 117.6 | 2.8 |
| tests/ui/grpc-request.spec.ts | 25 | 115.8 | 2.8 |
| tests/ui/control-sizing.spec.ts | 20 | 115.5 | 2.8 |
| tests/ui/copy-coverage.spec.ts | 26 | 111.5 | 2.7 |
| tests/ui/cell-editor.spec.ts | 4 | 103.4 | 2.5 |
| tests/ui/http-request.spec.ts | 16 | 90.3 | 2.2 |
| tests/ui/ui-leftovers.spec.ts | 19 | 88.2 | 2.1 |
| tests/ui/automations-module.spec.ts | 19 | 86.1 | 2.1 |
| tests/ui/docker-module.spec.ts | 17 | 75.1 | 1.8 |
| tests/ui/proof-window.spec.ts | 9 | 66.6 | 1.6 |
| tests/ui/list-keyboard.spec.ts | 12 | 63.2 | 1.5 |
| tests/ui/kibana-saved.spec.ts | 4 | 57.9 | 1.4 |
| tests/ui/interaction.spec.ts | 1 | 50.4 | 1.2 |
| tests/ui/docker-edit.spec.ts | 8 | 48.6 | 1.2 |
| ../../packages/workbench/src/testing/ui/scenarios/automationsRecurring.ts | 10 | 46.9 | 1.1 |
| ../../packages/workbench/src/testing/ui/scenarios/automationsEditor.ts | 7 | 46.7 | 1.1 |
| tests/ui/view-connection-drop.spec.ts | 7 | 45.9 | 1.1 |
| tests/ui/collections.spec.ts | 14 | 45.4 | 1.1 |
| tests/ui/consistency.spec.ts | 14 | 45.3 | 1.1 |
| tests/ui/tree.spec.ts | 4 | 45.2 | 1.1 |
| tests/ui/proof-chart.spec.ts | 5 | 44.2 | 1.1 |
| tests/ui/http-variables.spec.ts | 9 | 43.9 | 1.1 |
| tests/ui/tab-filter-state.spec.ts | 6 | 42.4 | 1.0 |
| tests/ui/data-view.spec.ts | 1 | 42.1 | 1.0 |

#### ui: slowest 30 tests

| file:line | title | s | status |
|---|---|---|---|
| tests/ui/interaction.spec.ts:1093 | interaction completeness — grid menus, selection, copy/paste, shortcuts | 50.4 | passed |
| tests/ui/cell-editor.spec.ts:333 | cell editor — autodetect, beautify, override, NULL/empty/truncated, read-only | 46.6 | passed |
| tests/ui/data-view.spec.ts:1056 | data view — pagination, count, projection, sort, filter, search, stop, NULLs | 42.1 | passed |
| tests/ui/leaks.spec.ts:281 | leak sweep — tab/store symmetry, connection delete purges the tree | 39.4 | passed |
| tests/ui/slick-grid.spec.ts:360 | SlickGrid spike — §7.4(a)'s eight sandbox-provable exit criteria | 38.5 | passed |
| tests/ui/slick-grid.spec.ts:856 | P22 iter2-onset — a fresh gesture sizes its runway from that gesture, not from before it | 34.3 | passed |
| tests/ui/console.spec.ts:48 | Query console — open, run statement/all, errors, saved queries | 33.0 | passed |
| tests/ui/tree.spec.ts:167 | project tree — expansion, caching, disconnect/reconnect, search, filters, menus | 32.9 | passed |
| tests/ui/cell-editor.spec.ts:842 | cell editor — UUID generate, timestamp translate pane, hex/base64 decoded pane | 31.3 | passed |
| tests/ui/definition.spec.ts:148 | Definition tab — Structure/Source, columns menu, notes, read-only, cache and refresh | 29.1 | passed |
| tests/ui/slick-grid.spec.ts:575 | P22 iter2-pacing — a catch-up render never shares a frame with a scroll-driven one | 27.0 | passed |
| tests/ui/slick-grid.spec.ts:1269 | P22 Pass B C9 — the pacing invariant holds with N staged insert rows on screen | 24.9 | passed |
| tests/ui/kibana-saved.spec.ts:68 | contract: Discover saves, updates and reopens a query, and flags unsaved edits | 23.9 | passed |
| tests/ui/autocomplete.spec.ts:857 | console lint — Mongo diagnostics (D24) | 20.5 | passed |
| tests/ui/console.spec.ts:271 | Query console — result-set strip, new-vs-reuse toggle, find toolbar (P40) | 19.7 | passed |
| tests/ui/mutations.spec.ts:224 | mutations — edit, add, delete, preview, commit, discard, read-only guard | 19.6 | passed |
| tests/ui/console.spec.ts:465 | Query console — the one-cell selection highlight clears (not jumps) when its own row is filtered out (finding 2) | 19.5 | passed |
| tests/ui/console.spec.ts:380 | Query console — a filter change clears the tabular selection, and a gutter click selects the whole row (P19 D8) | 18.9 | passed |
| tests/ui/grid-copy-menu.spec.ts:69 | console grid — right-click copy acts on the selection and matches the keyboard | 18.2 | passed |
| tests/ui/console.spec.ts:802 | Query console — a tabular selection copies as TSV/CSV/JSON, rows/columns/ranges alike (P19 D9/D10) | 18.1 | passed |
| tests/ui/console.spec.ts:538 | Query console — result-tab right-click: close, close others, close to the right (P42) | 16.3 | passed |
| tests/ui/grid-copy-menu.spec.ts:191 | data grid — right-click copy matches the keyboard per selection kind | 16.1 | passed |
| tests/ui/console-explain.spec.ts:287 | Query console — not explainable (an UPDATE) disables the button | 16.0 | passed |
| tests/ui/cell-editor.spec.ts:1264 | cell editor — owned by the view, never shows another tab's cell | 15.5 | passed |
| tests/ui/connections.spec.ts:330 | connection dialog CRUD, colors, and D7/D9 secret handling | 15.2 | passed |
| tests/ui/console.spec.ts:933 | Query console — a Mongo document result copies as JSON, one row or all displayed (P19 D6/D11) | 15.0 | passed |
| tests/ui/tabs.spec.ts:266 | the tab strip scrolls once tabs overflow it (P31 D6/D7) | 14.9 | passed |
| tests/ui/proof-chart.spec.ts:176 | contract: the copied screenshot holds the chart and never a tooltip | 14.9 | passed |
| tests/ui/console-format.spec.ts:328 | Query console — Format leaves the caret in the statement it was in, so Run statement still targets it (P19 D12) | 14.6 | passed |
| tests/ui/sql-schema.spec.ts:182 | a rejected Save shows the error and leaves the dialog open | 14.4 | passed |

#### ui: failures (0)


#### ui-clipboard: slowest 30 files

| file | tests | sum s | % of project sum |
|---|---|---|---|
| tests/ui/grid-copy-menu.spec.ts | 2 | 14.4 | 100.0 |

#### ui-clipboard: slowest 30 tests

| file:line | title | s | status |
|---|---|---|---|
| tests/ui/grid-copy-menu.spec.ts:69 | console grid — right-click copy acts on the selection and matches the keyboard | 8.0 | passed |
| tests/ui/grid-copy-menu.spec.ts:191 | data grid — right-click copy matches the keyboard per selection kind | 6.4 | passed |

#### ui-clipboard: failures (0)



### Space After

Playwright wall time (stats.duration): 1040.8 s

| project | tests | passed | failed | timed out | skipped | sum s | wall s | parallelism | median s | min s |
|---|---|---|---|---|---|---|---|---|---|---|
| ui | 953 | 952 | 1 | 0 | 0 | 4090.5 | 1038.3 | 3.94 | 4.2 | 1.3 |

#### ui: slowest 30 files

| file | tests | sum s | % of project sum |
|---|---|---|---|
| tests/ui/ade-v2-workflows.spec.ts | 40 | 237.1 | 5.8 |
| tests/ui/ade-v2-review.spec.ts | 47 | 167.1 | 4.1 |
| tests/ui/ade-v2-panel.spec.ts | 28 | 162.4 | 4.0 |
| tests/ui/ade-v2-plan.spec.ts | 28 | 135.5 | 3.3 |
| tests/ui/ade-v2-run.spec.ts | 21 | 108.0 | 2.6 |
| tests/ui/ade-v2-base-rebase.spec.ts | 16 | 87.4 | 2.1 |
| tests/ui/ade-v2-sessions.spec.ts | 15 | 86.8 | 2.1 |
| tests/ui/repo-workspace.spec.ts | 22 | 81.9 | 2.0 |
| tests/ui/ade-v2-task-branches.spec.ts | 13 | 77.4 | 1.9 |
| tests/ui/ade-v2-review-open.spec.ts | 14 | 76.5 | 1.9 |
| tests/ui/ade-v2-automations.spec.ts | 13 | 73.7 | 1.8 |
| tests/ui/copy-coverage-git.spec.ts | 17 | 71.8 | 1.8 |
| tests/ui/ade-v2-task-status.spec.ts | 13 | 70.8 | 1.7 |
| tests/ui/ade-v2-sessions-menu.spec.ts | 11 | 61.4 | 1.5 |
| tests/ui/ade-v2-archived.spec.ts | 9 | 57.7 | 1.4 |
| tests/ui/ade-v2-dialogs.spec.ts | 10 | 54.4 | 1.3 |
| tests/ui/repo-graph-keep-state.spec.ts | 7 | 53.0 | 1.3 |
| tests/ui/agent-usage.spec.ts | 13 | 52.8 | 1.3 |
| tests/ui/repos-dialog.spec.ts | 17 | 50.4 | 1.2 |
| tests/ui/repo-graph-paging.spec.ts | 4 | 49.2 | 1.2 |
| tests/ui/repo-review-interaction.spec.ts | 11 | 48.2 | 1.2 |
| tests/ui/ade-v2-archive.spec.ts | 7 | 47.8 | 1.2 |
| tests/ui/ade-v2-sandbox.spec.ts | 8 | 46.9 | 1.1 |
| tests/ui/ade-v2-launch.spec.ts | 8 | 46.0 | 1.1 |
| tests/ui/ade-v2-task-launch.spec.ts | 8 | 45.0 | 1.1 |
| tests/ui/ade-v2-artifacts.spec.ts | 7 | 44.9 | 1.1 |
| tests/ui/ui-leftovers.spec.ts | 10 | 44.1 | 1.1 |
| tests/ui/repo-file-edit.spec.ts | 9 | 43.7 | 1.1 |
| tests/ui/ade-v2-review-step.spec.ts | 14 | 43.1 | 1.1 |
| tests/ui/ade-v2-add-link.spec.ts | 6 | 42.4 | 1.0 |

#### ui: slowest 30 tests

| file:line | title | s | status |
|---|---|---|---|
| tests/ui/graph-blank-rows.spec.ts:330 | a relayout that races a scroll and a click leaves the rows painted and the click on its row | 18.6 | passed |
| tests/ui/repo-graph-paging.spec.ts:365 | a resized graph column keeps every node after Load more | 16.8 | passed |
| tests/ui/repo-graph-paging.spec.ts:332 | columns resized wide never push the graph out of view | 12.7 | passed |
| tests/ui/repo-graph-paging.spec.ts:239 | outer-lane commits keep their node across scroll, click and Load more | 11.8 | passed |
| tests/ui/graph-blank-rows.spec.ts:213 | rows stay painted through scroll, click and Show more, collapsed or not | 11.1 | passed |
| tests/ui/automations-tabs.spec.ts:52 | ADE: one tab per script and task; a live repeat focuses instead of starting | 10.9 | passed |
| tests/ui/ade-v2-launch.spec.ts:145 | a launch behind a running prepare script shows its progress and waits | 10.1 | passed |
| tests/ui/ade-v2-add-link.spec.ts:28 | contract: pasting a PR link resolves and adds it | 9.7 | passed |
| tests/ui/ade-v2-dialogs.spec.ts:45 | a blank message disables Send | 9.5 | failed |
| tests/ui/repo-workspace.spec.ts:421 | contract: a repo workspace: the status bar blame item follows the cursor, and never shows on a revision-pinned tab (P76) | 9.3 | passed |
| tests/ui/repo-graph-keep-state.spec.ts:231 | closing the workspace unmounts the kept graph; reopening mounts cold | 8.8 | passed |
| tests/ui/ade-v2-panel.spec.ts:441 | the step mover goes back, picks any step and is off while a run is live | 8.5 | passed |
| tests/ui/ade-v2-task-menu.spec.ts:35 | Mark as not merging, Copy task id and Archive call their backends | 8.3 | passed |
| tests/ui/ade-v2-flat-steps.spec.ts:132 | contract: the inspector switches field groups per kind, keeps Advanced closed, and saves kinds | 8.2 | passed |
| tests/ui/ade-v2-workflows.spec.ts:512 | the step menu skips a step, and the last runnable step cannot be skipped | 8.1 | passed |
| tests/ui/repo-graph-keep-state.spec.ts:101 | opening a diff and returning keeps the graph mounted with scroll and selection | 8.1 | passed |
| tests/ui/repo-graph-keep-state.spec.ts:139 | "Open in graph" from a file scrolls the hidden graph to the commit once shown | 8.0 | passed |
| tests/ui/ade-v2-artifacts.spec.ts:81 | contract: Add sends AddArtifact with the form values | 8.0 | passed |
| tests/ui/ade-v2-sessions-menu.spec.ts:115 | the row menu opens by right-click and Shift+F10 | 7.9 | passed |
| tests/ui/repo-graph-widths.spec.ts:101 | dragging the author, date and graph handles moves that boundary with the pointer | 7.9 | passed |
| tests/ui/repo-graph-paging.spec.ts:260 | a merge's second-parent line keeps its own lane, before and after Load more | 7.9 | passed |
| tests/ui/ade-v2-panel.spec.ts:86 | name, Jira, GitHub and Not merging write UpdateTask patches | 7.9 | passed |
| tests/ui/ade-tui-takeover.spec.ts:51 | contract: a hold shows the overlay and the strip badge; Reconnect reclaims the terminal | 7.8 | passed |
| ../../packages/workbench/src/testing/ui/scenarios/automationsEditor.ts:190 | prompt completion: a bare { lists params, a secret is never offered, Enter is a newline | 7.8 | passed |
| tests/ui/ade-v2-add-link.spec.ts:110 | attach mode sends the task id | 7.8 | passed |
| tests/ui/repo-graph-keep-state.spec.ts:255 | opening a diff and returning keeps the commit detail pane open | 7.7 | passed |
| tests/ui/ade-agent-missing.spec.ts:7 | contract: launching a step without the claude CLI shows the install message | 7.6 | passed |
| tests/ui/repo-file-gate.spec.ts:135 | switching away from a file and a diff and back sends the previous stat and shows the same text | 7.6 | passed |
| tests/ui/ade-v2-flat-steps.spec.ts:55 | contract: Move task here and the step mover send SetTaskStep with the target step | 7.6 | passed |
| tests/ui/ade-v2-panel.spec.ts:186 | typing in Notes saves once, debounced | 7.6 | passed |

#### ui: failures (1)

- tests/ui/ade-v2-dialogs.spec.ts:45 a blank message disables Send (failed)


### ui-timing on demand (bun run test:ui:timing:studio)

| project | tests | passed | failed | timed out | skipped | sum s | wall s | parallelism | median s | min s |
|---|---|---|---|---|---|---|---|---|---|---|
| ui-timing | 4 | 4 | 0 | 0 | 0 | 71.1 | 71.5 | 0.99 | 12.0 | 5.2 |

Gated values logged by the run (budget in parentheses; idle host, load 0.97 at start):

| gate | p50 ms | p95 ms |
|---|---|---|
| console keystroke -> completion popup (p50 <= 50) | 36.0 | 48.0 |
| cell -> editor | 21.0 | 27.0 |
| cached tab switch | 162.0 | 240.0 |
| cached tree expand | 29.0 | 40.0 |
| scroll frame time (`perf.spec.ts`) | 40.0 | 51.0 |

All four tests pass. Before run keystroke p50: 39.0 ms (p95 55.0).

## Delta

| app / project | tests B -> A | wall s B -> A | sum s B -> A | failed B -> A |
|---|---|---|---|---|
| Studio `ui` | 701 -> 701 | 1009.7 -> 1043.8 | 3995.5 -> 4134.8 | 0 -> 0 |
| Studio `ui-clipboard` | 2 -> 2 | 8.5 -> 8.0 | 15.1 -> 14.4 | 0 -> 0 |
| Studio `ui-timing` | 4 -> 4 (moved to on-demand script) | 66.8 -> 71.5 (separate run) | 66.6 -> 71.1 | 0 -> 0 |
| Studio `test:ui:studio` total (Playwright wall) | 1087.2 -> 1053.8 | | | |
| Space `ui` | 953 -> 953 | 1160.0 -> 1038.3 | 4571.0 -> 4090.5 | 0 -> 1 (flake, see After) |

Reading:

- Studio `ui` wall is 3% higher (inside the measured 6% run-to-run noise); the sum of test time shows the same. Sleeps are not where the time goes: the removed sleeps total well under a minute of test time and the `ui` project is bound by 4 workers on 4 cores doing 700 boots plus page work. The `test:ui:studio` total drops 33 s only because `ui-timing` left the script.
- Space `ui` wall is 10.5% lower. The changes touching Space (2 barrier rewrites in `ade-v2-review`, one in `repo-order`, `ui-leftovers-git`, a shared drag helper) cannot account for 120 s of 4 workers; treat most of it as run-to-run variance (the sweep showed up to 6%), not a result.
- Selection: a Studio-only change now runs Studio (about 1054 s) and skips Space (about 1038 s saved); a Space-only change saves about 1054 s. A `packages/**` change runs both and saves nothing.
