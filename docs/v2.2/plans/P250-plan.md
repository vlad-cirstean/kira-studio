# P250 plan: e2e coverage of v2.2 additions, split at the IPC boundary

Base: `v2.0` at `af14ac15f` (P249, P251 landed). Planned against current tree (re-read source, CodeGraph
discovery).

SPEC row: every new v2.2 feature covered by tests that run the real backend and the real frontend
together; split at the IPC boundary allowed; real containers where needed; audit first, gaps list in
`plans/`, then fill; no duplicate coverage; `exempt.txt` stays empty; real-claude tests stay opt-in.

"Covered" here means the CLAUDE.md rule as P249 shaped it: per scenario one backend flow test
(`apps/*/internal/flows/*`, real services through `flowharness`) and one frontend spec (real UI,
mocked bridge) asserting the same result, tied by one contract fixture (`apps/*/tests/contract/*.json`,
written and asserted by `(*App).Contract`, read by `contract(...)` in `tests/ui/support/contract.ts`).
This file is the gaps list the row asks for; §3 is the audit, §4-§5 the fill.

## 1. Current state

- Contract machinery (P249): `internal/flowtest/contract.go`, both `flowharness` `Contract`/`Mask`,
  `packages/workbench/src/testing/ui/contract.ts` (`createContract`), per-app
  `tests/ui/support/contract.ts`. Regen: `KIRA_CONTRACT=write go test -run <Test> ./<pkg>`. Keys:
  `Service.Method[#tag]`, `args:Service.Method[#tag]`, `git:<method>[#tag]`, `event:<channel>[#tag]`.
- Space fixtures (19): `ade-{automation,base,board,review-open,run,task}`, `automations`, `commands`,
  `git-{commit-detail,path,remote,review,stash}`, `memory`, `repos`, `restart`, `schedule-{confirm,now}`,
  `smart`. Studio (13): `api-{boot,curl,grpc,http,postman,restart}`, `automations`, `dbmcp`,
  `paste-credentials`, `schedule-{confirm,now}`, `smart`, `terminal`. Every fixture has a UI consumer.
- Flow packages with no contract call: Space `claudeflow`, `mobileflow`, `notifyflow`, `promptflow`,
  `usageflow`, `windowflow`; Studio `appflow`, `dockerflow`, `promptflow`, `windowflow`.
- e2e-real after P249: Space `boot-real`, `multiwindow-real`, `prompts-two-windows-real`,
  `terminal-real`; Studio `docker-real`, `mariadb-real`, `multiwindow-real`, `postgres-real`,
  `prompts-two-windows-real`, `sqlite-real`, `terminal-real`.
- Coverage gate: both `flows/coverage/exempt.txt` empty.
- Mobile phone app: `apps/kira-space/tests/mobile/*.spec.ts` against a scripted Node server
  (`tests/mobile/support/mockServer.ts`) fed by hand-made `tests/fixtures/ade-v2/*.json`; no contract.
- SPEC table drift: P236, P237, P238, P239, P244 still read `Todo` though their result files and
  commits landed (D2).
- Disk: 2.2 GB free on `/` at planning time (`df -h /`); `/tmp/claude-0` 4 GB, `/tmp` go-build and
  Playwright caches ~0.9 GB, Docker images 8.3 GB (needed by the complete suites). §8.

## 2. Feature list (Done rows P210-P251, user-visible behaviours)

Excluded: P216 (removed), P218 (cancelled). Process-only rows (no app behaviour): P215 (test speed),
P217/P227/P235 (reviews), P231/P232/P236-tests/P237/P249 (test infra), P234 (docs), P251 (Wails bump:
proven by the e2e-real wiring anchors `boot-real`, `sqlite-real`). Visual-only rows (no behaviour, owned
by the visual suites): P213, P229, P245.

- P210 memory embedding search: hybrid search finds a fact by keyword; semantic state not installed /
  unavailable / ready shown in Settings.
- P211 memory bulk import: pick folder, estimate, start; per-file results; paused job with reason;
  retry and resume.
- P212 Part 1 + P223 mobile web: phone pairing with desktop approval prompt (code + origin); read-only
  board tabs; LAN-only server, trust network, plaintext warning; device tokens expire.
- P212 Part 2 mobile writes: backlog add (idempotent), reorder, stage Next/Prev, TUI reply, terminal
  attach; desktop shows the hold overlay and Reconnect.
- P214 memory manual add: free-text box; gate splits, challenges, stores; outcomes listed.
- P219 collections: Space scripts in collections (move menu); Studio API request move menu; Studio
  script collections; working-dir folder dialog.
- P220 git: graph lines stay on click/scroll; default tab Repos; last tab persists.
- P221 memory settings: semantic download and Connect Claude Code live in Settings > Memory.
- P222 add-repo dialog: restyle, per-repo colour, deployment environments (script prints deployed SHA).
- P224 STT removed: retired speech model deleted at startup.
- P225/P228 graph: Load more keeps paging; resized columns survive Load more.
- P226 colour bars: one rail component and tone mapping everywhere.
- P230 ADE Refresh all: repo with remote fetched, repo without rescanned, no git error.
- P233 Claude settings untouched: hooks per session; user settings files byte-identical.
- P236 more real-flow coverage: journeys, restart persistence, two windows, error paths, concurrency.
- P238 desktop notifications: Stop / needs-input / run ended; click reveals window and tab; focused
  tab suppresses; cooldown; per-kind toggles; test button.
- P239 usage limits: 5-hour/weekly % and reset in ADE status bar; tooltip and source; warn/error tones;
  off switch.
- Status bar move (`b3784eeff`): Studio cache readout moved to Settings > Cache (usage, hit rate, Clear
  caches); Claude usage item left-aligned with dashboard icon.
- P240 Review code: every entry point opens the branch review; disabled/hidden rules; picker.
- P241 base and rebase: base picked at create; Change base; headless rebase; conflict reported, Abort;
  outcome on board, panel, Needs you; `run_outcome` MCP tool.
- P242 Part 1 automations: run store with live state, outcome, runs list, Stop, Copy for agent, status
  count; working dir per script; legacy `$HOME` rows keep running with a notice.
- P242 Part 2 smart scripts: AI badge, params, run dialog preview, one-off prompt, done/failed with
  summary.
- P242 Part 3 scripts in ADE: task/branch picker, worktree toggle, chip and panel block, step waits for
  a running automation, `smart_script:` step, notification.
- P242 Part 4 recurring: cron with preview; confirm popup; run now; overlap skip with reason; missed
  runs skipped; headless; failure notification; ADE task target.
- P243 git without the extension: every git op over the native stream; leftover `git.sock` removed at
  startup.
- P244 docker: Terminal tab opens no session until New session; engine dropdown text clear; no CPU/RAM
  in side list.
- P246 prompt routing: window-triggered prompt in its window; generic in the main window only; queued
  with no window; system notification per prompt; answer anywhere clears it.
- P247 workflow branching: results with routes and loop budgets; graph editor saves `results`; result
  and route shown on board, panel, Needs you, notification.
- P248 paste credentials: parse in renderer, review, apply; Update credentials writes user/password,
  reconnects a live connection.

## 3. Gap audit

Verdicts: covered (pair + shared fixture); unlinked (both halves exist, no shared fixture: link);
backend only; UI only; neither; e2e-real; n/a (no UI surface: backend flow alone is the full check).
"Work" names the §5 item.

| Feature / behaviour | Backend flow | UI spec | Shared fixture | Verdict | Work |
|---|---|---|---|---|---|
| P210 keyword hit | memoryflow TestStoreThroughGate | memory-module contract tests | memory | covered | - |
| P210/P221 semantic state, download cancel | memoryflow TestSemanticNotInstalled, TestInstallSemanticModelCancelled | settings-memory (3) | none | unlinked | S13 |
| P210 real vector search | none (needs model download) | none | - | neither | D9 out |
| P211 import lifecycle, paused, retry | memoryflow TestImportLifecycle, TestImportRetries | memory-import (2) | none | unlinked | S12 |
| P212/P223 pairing + desktop prompt | mobileflow TestPhonePairing, TestMobilePairingRoutes | mobile pairing.spec, mobile-access 'pairing prompt' | none | unlinked | S15 |
| P223 device expiry | none (mobileweb unit only) | mobile pairing.spec 'expired', mobile-access 'expiry' | none | UI only | S15 |
| P223 trust network, LAN bind, plaintext | mobileflow TestEnableTrustPort | mobile-access (5) | none | unlinked | S15 |
| P223 subnet refusal | mobileweb unit | none (phone never reaches) | - | n/a | - |
| P212 board tabs read-only | mobileflow TestPhoneReadsRealAde | mobile tabs.spec | none (hand fixtures) | unlinked | S16 |
| P212 Part 2 backlog add, Next | mobileflow TestPhoneWrites | mobile writes.spec | none | unlinked | S16 |
| P212 Part 2 hold overlay, Reconnect | mobileflow TestPhoneTerminalAttach | ade-tui-takeover (2) | none | unlinked | S17 |
| P214 free-text add, challenge, stored | memoryflow TestStoreThroughGate, TestGateRejectsOrFails | memory-module 'Add memory' | memory (Recent only) | unlinked | S14 |
| P219 Space collections | termflow TestCollectionsMoveAndDelete | automations-scripts contract | commands | covered | - |
| P219 Space folder dialog | termflow TestScriptFolders | automations-scripts 'Choose folder' | none | unlinked | S10 |
| P219 Studio API request move | apiflow TestMoveRenameGrpcItem | collections 'moves to another collection' | none | unlinked | T2 |
| P219 Studio script collections | termflow TestScriptCollections | automations-module 'moves between collections' | none | unlinked | T3 |
| P219 Studio folder dialog | termflow TestScriptInPickedFolder | automations-module contract | terminal | covered | - |
| P220 graph lines, tab persistence | n/a (render, localStorage) | repo-graph-lines, git-panel-tab | - | UI only, by design | - |
| P222 colour | repoflow TestImportViaFolderPicker | repos-dialog contract | repos | covered | - |
| P222 environments, deployed SHA | none | repos-dialog 'Add environment', ade-v2-panel 'Details lists every environment' | none | UI only | S11 |
| P224 retired model removed | none | n/a | - | neither (no UI) | S20 |
| P225/P228 paging, resized Load more | gitflow TestGraphPagesToEnd, TestGraphLoadMoreHonorsStoredPageSize | repo-graph-paging | graph chunk golden | covered | - |
| P226 colour rails | n/a (render rule) | color-rails both apps | - | UI only, by design | - |
| P230 Refresh all | adeflow TestRefreshDefaultSettings | ade-v2-plan contract | ade-board | covered | - |
| P233 settings untouched: terminal, ADE run, TUI stage, restart | claudeflow TestClaudeSettingsUntouched; claude suite TestRealClaudeSettingsUntouched | n/a | - | n/a | - |
| P233 settings untouched: smart script run, smart step | none (both suites) | n/a | - | neither | S21, C1 |
| P236 journeys, restart | journeyflow, apiflow TestRestartKeepsApiState | memory-module, collections contract | restart, api-restart | covered | - |
| P236 two windows | windowflow (both) | - | - | e2e-real (multiwindow-real) | - |
| P236 run error path (no claude) | adeflow TestRunWithoutClaudeOnPath | none asserts the reason shown | none | backend only | S18 |
| P236 concurrency | gitflow/mobileflow races | n/a (mock bridge serialises) | - | backend only, by design | - |
| P238 reveal on click | notifyflow TestClickRevealsTerminal, TestClickRevealsAdeSession | settings-agent-notify 'reveal-*' | none | unlinked | S4 |
| P238 kinds, focus, cooldown, toggles | notifyflow (12) | settings-agent-notify (toggles) | - | n/a (OS sink, no UI) | - |
| P239 status line feed, run feed, expiry | usageflow TestStatusLineFeed, TestRunStreamFeed, TestExpiredWindowDropped | claude-usage (9) | none | unlinked | S5 |
| Status bar: usage item left-aligned | n/a | none | - | UI only, missing | S5 |
| Status bar: Studio cache pane | adapterhost unit TestAttachStream_PushesCacheStatsOnChange (frame boundary) | none (only budget field) | - | UI missing | T1 |
| P240 Review code | adeflow TestReviewOpenFacts | ade-v2-review-open contract | ade-review-open | covered | - |
| P241 base, rebase, conflict, Abort | adeflow TestTaskBase, TestRebaseRun | ade-v2-base-rebase contract | ade-base | covered | - |
| P241 Needs you lists failed rebase | (TestRebaseRun) | ade-v2-base-rebase 'Needs you lists' (hand mock) | none | unlinked | S7 |
| P241 `run_outcome` MCP | adeflow TestRunOutcomes | n/a | - | n/a | - |
| P242.1 run lifecycle, outcomes | termflow TestScriptRun* (both) | automations-runs contract (both) | automations | covered | - |
| P242.1 legacy `$HOME` notice | termflow TestScriptFolders (both) | automations-runs 'legacy home' (both) | none | unlinked | S10, T4 |
| P242.2 smart done/failed | termflow TestSmartScript(Space) | automations-smart contract | smart | covered (Space: done only) | S23 |
| P242.3 ADE automation, step wait | adeflow TestAutomationRun, TestAutomationStep | ade-v2-automations contract | ade-automation | covered | - |
| P242.3 notification on end | notifyflow TestAutomationNotifies | n/a | - | n/a | - |
| P242.4 confirm, run now | termflow TestScheduleConfirm, TestRunScheduleNow (both) | automations-recurring contract (both) | schedule-confirm, schedule-now | covered | - |
| P242.4 overlap skip with reason | termflow TestScheduleOverlap (both) | automations-recurring 'Skipped with its reason' (both) | none | unlinked | S8, T5 |
| P242.4 missed runs, restart | termflow TestScheduleRestart | n/a (nothing shown) | - | n/a | - |
| P242.4 ADE task target picker | adeflow TestScheduleADE (target set in Go; `ListTasks` never called) | automations-recurring 'task picker' (hand mock) | none | UI only | S9 |
| P243 stash, detail, remote, review, path | gitflow, reviewflow, appflow | repo-* contract tests | git-* | covered | - |
| P243 blame | gitflow TestBlameLine | none answers `blame.line` | none | backend only | S19 |
| P243 worktree list | gitflow TestWorktreeAddRemove | repo-workspace 'lists its worktrees' (port fixture) | none | unlinked | S19 |
| P243 `git.sock` removed at startup | none (`main.go` only) | n/a | - | neither (no UI) | S20 |
| P244 terminal opt-in, dropdown, side list | dockerflow TestExecSession (complete, Docker) | docker-module (3) | none | unlinked (opt-in) / UI only (layout) | T7 |
| P246 schedule popup routes, queue, notify | promptflow TestScheduleConfirmRoutes (both) | prompts 'oldest prompt first', automations-recurring 'no popup in a window the router did not target' | none | unlinked | S6, T6 |
| P246 git credential route (Space) | gitflow TestCredentialRoutes | prompts 'git credential only in target window' | none | unlinked | S6 |
| P246 MCP approval route (Studio) | dbmcpflow TestDbMcpApprovalRoutes | prompts 'MCP approval only in target window' | none | unlinked | T6 |
| P246 two real windows | - | - | - | e2e-real (prompts-two-windows-real) | - |
| P247 loop rounds and budget | adeflow TestBranching | ade-v2-run 'loops back', 'spent loop' (hand mock, max 3) | none | unlinked; hides bug | S1, S2 |
| P247 editor saves results | adeflow TestBranching 'saved results round trip' | ade-v2-workflows 'route select ... saves it in results' | none | unlinked | S3 |
| P248 paste, Update credentials | dbflow TestPostgresUpdateCredentials (complete) | connection-paste-credentials contract | paste-credentials | covered | - |

Summary: 60 rows. Covered 15; unlinked 23; UI only or missing 7 (2 by design); backend only 3 (1 by
design); neither 4 (1 out by D9); e2e-real 2; n/a 6. Work items: 30 (S1-S21, S23, T1-T7, C1; no S22).

## 4. Work list, streams, counts, runtime

### 4.1 Streams

Space and Studio work is file-disjoint: no item touches `packages/**`, `internal/**` (root), root
`package.json` or docs. No ordering dependency between them.

| Stream | Owns (zero overlap) |
|---|---|
| A (Space) | `apps/kira-space/**` (flows, `internal/appwire/**`, `main.go`, `frontend/src/ade/v2/board/stageBlocks.ts`, `tests/{ui,mobile,contract,claude}/**`) |
| B (Studio) | `apps/kira-studio/**` (flows, `tests/{ui,contract}/**`) |

Close-out files (`docs/v2.2/SPEC.md`, `docs/v2.2/plans/P250-result.md`, `docs/ARCHITECTURE.md` test
counts) belong to neither; the orchestrator's close-out pass edits them after landing.

Default: one sequential implementer, A then B (D1). Reason: 2.2 GB free disk cannot hold a second
worktree with its own `node_modules` and two frontend builds; B is ~20% of the work. A shared item
that turns out to need `packages/**` or root `internal/**` stops the stream and is recorded in
`plans/P250-findings.md` (D12).

### 4.2 Ordered commits (Conventional Commits; per commit: `bun run lint`, `bun run typecheck`, `go vet`
on touched packages, `lint:go` on touched Go; expensive suites once at the end, §8)

Stream A:

1. `fix(space): count a fix round against its result's loop budget` - S1 (flow subtest, UI test that
   fails before the fix, `stageBlocks.ts` fix).
2. `test(space): branching and workflow results contracts` - S2, S3.
3. `test(space): notification and usage contracts` - S4, S5.
4. `test(space): prompt routing contracts` - S6.
5. `test(space): ADE needs, error path and environments contracts` - S7, S11, S18.
6. `test(space): automations folder, overlap, task picker, smart failed contracts` - S8, S9, S10, S23.
7. `test(space): memory contracts` - S12, S13, S14.
8. `test(mobile): phone contracts and device expiry` - S15, S16, S17.
9. `test(space): git blame and worktree contracts` - S19.
10. `refactor(space): run startup file cleanups in appwire` + flow test - S20.
11. `test(space): settings untouched by smart runs` - S21, C1.

Stream B:

12. `test(studio): collection move, legacy folder, overlap contracts` - T2, T3, T4, T5.
13. `test(studio): prompt routing contracts` - T6.
14. `test(studio): docker exec opt-in contract` - T7 (needs Docker for `KIRA_CONTRACT=write`).
15. `test(studio): cache pane readout` - T1.

Then: end-of-phase run (§8), fixes grouped by root cause, `docs: P250 result` (result file with
measured counts and times; SPEC row and D2 status flips).

### 4.3 Counts and runtime (estimates; P249 measured Space flows 3 min 41 s, Studio 1 min 26 s, UI ~2-5 s
per test, load average ~22)

- New flow tests/subtests: 9 (S1, S9, S11, S15 expiry, S20, S21 x2, S23, C1 counted separately).
  Contract calls added to ~20 existing flow tests. Flow suites: +~1 min Space, +~10 s Studio.
- New UI tests: 10 (S1, S5 x2, S9, S18, S19 blame, S23, T1 x2, S9 unsaved). Converted to contract:
  ~30 Space (incl. 6 mobile), ~7 Studio. UI suites: +~1 min wall (parallel projects).
- Mobile specs run in two projects (`mobile-ios`, `mobile-android`): 6 converted tests run twice.
- Claude suite: one subtest with two runs, haiku, ~0.02 USD, ~40 s.
- New fixtures: Space ~16, Studio ~6.

## 5. Per-pair scenarios

Conventions for every item: backend half calls `app.Contract(t, "<scenario>", "<key>", got[, Mask])`
after the Go assertions; run `KIRA_CONTRACT=write` once, read the JSON (no secrets, no machine paths),
commit it with the test. UI half reads `contract('<scenario>', '<key>', { schema? })`, uses a
`packages/shared/domain` zod schema where one exists, and asserts the same visible result the flow
asserts. Where the UI fixture board uses its own ids (`T_push`, `impl`, `tests`), keep fixture ids and
copy contract values (state, loops, note, outcome, max) onto them (P249 precedent). Confirm each bound
name against `apps/<app>/frontend/bindings/**` before writing a key. Name UI tests `contract: ...`.

### Stream A (Space)

S1 P247 fix round budget (bug). Files: `internal/flows/adeflow/branching_test.go`,
`tests/ui/ade-v2-run.spec.ts`, `frontend/src/ade/v2/board/stageBlocks.ts`.
- Given workflow stage `build` with `impl` then `review`; `review` results `approved` (next) and
  `changes` (next `impl`, `max: 2`) via `reviewResults(2)`; fake agent acts `done`,
  `result:changes`, `done`, `result:approved`.
- When the task starts and `review` reaches `done`.
- Then (Go) the second `impl` run has `Loops == 1`, `State == "done"`, `Note == ""`, outcome reason
  `""`; the first `review` run is `back` with note containing `(1 of 2)`. Contract `ade-branching`:
  `AdeTaskService.Workflows` (the `changes` result, `max: 2`), `AdeTaskService.Run#impl-rerun`,
  `AdeTaskService.Run#review-back`.
- Then (UI) new test `contract: a fix round counts against its result's loop budget`: workflows from
  `branchingWorkflows()` with the `changes` result's `max` taken from the contract; T_push's `impl` run
  gets the rerun values, its `tests` run the review-back values. `stage(page,'impl')` run line
  `ade-run-note` reads `fix round 1 of 2`; the tests line note contains `(1 of 2)`.
- Before the fix the UI test fails on `fix round 1 of 3` (record the failing line in the commit body).
- Fix: `runLine(r)` hardcodes `of 3` (`stageBlocks.ts:102`). Pass the loop budget of the back edge
  into it: in `buildStageBlocks`, `s.runs.map((r) => runLine(r, backMax(steps, s.id)))`;
  `backMax` = largest `max` among results of the other steps of the stage whose `next === s.id`, 0 when
  none; note `fix round ${r.loops} of ${max}`, or `fix round ${r.loops}` when `max` is 0. Update the
  `RunLine.note` doc comment. Legacy `back:` rules still read `of 3` (`implicitResults` uses
  `DEFAULT_LOOP_MAX`). D6.

S2 P247 spent loop. Same files. Existing subtest `a spent loop budget stops the stage` records
`AdeTaskService.Run#review-spent` (route `stop`, note `... (sent back 2 times)`) into `ade-branching`.
UI test `a spent loop shows the result and that the stage stopped` reads that run instead of its hand
outcome; asserts the stop note text from the contract.

S3 P247 editor saves results. Files: `adeflow/branching_test.go`, `tests/ui/ade-v2-workflows.spec.ts`.
Subtest `saved results round trip through the bound methods` records `args:AdeTaskService.SaveWorkflow`
(the args it sends) and `AdeTaskService.Workflows#saved` into `ade-workflow-results`. UI test `the route
select sets where a result goes and saves it in results`: build the same route in the graph editor,
Save, assert the logged `SaveWorkflow` args `toMatchObject` the contract args' `results`.

S4 P238 reveal. Files: `flows/notifyflow/*_test.go`, `tests/ui/settings-agent-notify.spec.ts`.
`TestClickRevealsTerminal` and `TestClickRevealsAdeSession` record the emitted event payloads:
`event:kira:agent:reveal-terminal`, `event:kira:agent:reveal-task` into `notify-reveal`. UI tests
`reveal-task ...` and `reveal-terminal ...` emit the contract payload (`emitWailsEvent`), ids swapped
to the fixture task/tab ids, and assert the module switch and visible tab as today.

S5 P239 usage and status bar. Files: `flows/usageflow/usage_test.go`, `tests/ui/claude-usage.spec.ts`.
- `TestStatusLineFeed` records `ClaudeUsageService.Get#session` and `event:kira:claude:usage#session`;
  `TestExpiredWindowDropped` records `#expired`; `TestRunStreamFeed` records `#run`. Mask `resetsAt`,
  `updatedAt` (relative to wall time).
- UI: new `contract: a session snapshot shows both windows and its source` (set `resetsAt`/`updatedAt`
  from `FIXED_NOW`; text equals `5h ${round(five)}% · wk ${round(seven)}%`; tooltip source line for
  `session`); convert `one window only ...` to `#expired`; new `contract: a run snapshot names the run
  source` (tooltip source line for `run`, text from `ClaudeUsageItem.vue`).
- UI only: new `the usage item sits in the left group` - with the ADE module open, the item's bounding
  box ends left of the `RunsStatusItem` box and left of half the viewport; icon is `dashboard`.

S6 P246 Space routing. Files: `flows/promptflow/prompts_test.go`, `flows/gitflow/*credential*_test.go`
(where `TestCredentialRoutes` lives), `tests/ui/prompts.spec.ts`, `tests/ui/automations-recurring.spec.ts`.
`TestScheduleConfirmRoutes` records `PromptsService.MainWindow`, `PromptsService.List#two-waiting`,
`PromptsService.List#queued` (no window, empty target) into `prompts-route`. `TestCredentialRoutes`
records the routed credential entry `PromptsService.List#credential` into `git-credential-route`. UI:
`the oldest prompt shows first with a count ...` uses `#two-waiting` with targets mapped to the page's
window key; `a waiting run shows no popup in a window the router did not target` uses the same list
with the other key; `a git credential shows only in the window the router targets` uses
`#credential`.

S7 P241 Needs you. File: `tests/ui/ade-v2-base-rebase.spec.ts` only (backend half exists:
`ade-base` `AdeTaskService.Run#rebase-conflict`). Convert `Needs you lists the failed rebase and Open
selects the branch` to place that contract run on the fixture branch; assert the Needs you row shows
the contract reason and conflicted files.

S8 P242.4 overlap (Space). Files: `flows/termflow/schedule_test.go`, `tests/ui/automations-recurring.spec.ts`.
`TestScheduleOverlap` records `ScriptRunsService.List#skipped` (masked times) into `schedule-overlap`.
UI `the runs list shows Skipped with its reason ...` reads it; asserts the Skipped label and the
contract reason text.

S9 P242.4 ADE task picker. Files: `flows/adeflow/schedule_test.go`, `tests/ui/automations-recurring.spec.ts`.
- Given an ADE task with one branch and a saved normal script.
- When `ScriptRuns.Preview({scriptId, listTasks: true})`, then `CustomScripts.Update` with
  `schedule.taskId` set to the listed task.
- Then (Go) `pv.Needs.Tasks` lists the task title; the stored schedule keeps `taskId`; with
  `scriptId: ""` record what Preview returns (error code or empty needs). New
  `TestSchedulePickerListsTasks`; contract `schedule-task-picker`: `ScriptRunsService.Preview#list-tasks`,
  `args:CustomScriptsService.Update#task`, `ScriptRunsService.Preview#unsaved`.
- Then (UI) convert `the editor targets an ADE task through the task picker` (preview response and
  expected Update args from contract); new `an unsaved script asks to save before picking a task`:
  New recurring script, choose `schedule-where-task`, `schedule-task-save` visible, no
  `scriptRunsPreview` call carries `listTasks`. D7.

S10 P242.1 legacy folder + P219 folder dialog (Space). Files: `flows/termflow/automation_test.go`,
`tests/ui/automations-runs.spec.ts`, `tests/ui/automations-scripts.spec.ts`. `TestScriptFolders`
records `ScriptRunsService.ResolveDir#legacy` (home mode), `CustomScriptsService.Create#picked`
(picked folder) into `script-folders`. UI `a legacy home script offers the automations folder` reads
`#legacy`; `Choose folder… switches the script to a fixed folder` asserts its Update args match
`#picked`'s fields.

S11 P222 environments. Files: new `flows/adeflow/env_test.go`, `tests/ui/repos-dialog.spec.ts`,
`tests/ui/ade-v2-panel.spec.ts`.
- Given an imported repo with a task branch (adeflow helpers).
- When `AdeTask.UpdateRepo` sets environments `prod` = `git rev-parse HEAD` and `broken` = `true`,
  then `AdeTask.Refresh`.
- Then (Go) `AdeTask.Repos` lists both; board facts give `prod` the HEAD SHA and the branch deployed
  where HEAD contains it; `broken` carries error `the script printed no commit sha`
  (`ade/deploy.go`). New `TestRepoEnvironments`; contract `repo-env`: `args:AdeTaskService.UpdateRepo`,
  `AdeTaskService.Repos`, `AdeTaskService.Board` branch facts (or the call the panel reads).
- Then (UI) `Add environment writes nothing until name and command are filled` asserts the one
  UpdateRepo it sends equals the contract args' `environments`; `Details lists every environment ...`
  renders the contract facts: `prod` deployed, `broken` shows its error.

S12 P211 import. Files: `flows/memoryflow/import_test.go`, `tests/ui/memory-import.spec.ts`.
`TestImportLifecycle` records `MemoryImportService.Choose`, `MemoryImportService.Job#done`;
`TestImportRetries` records `MemoryImportService.Job#paused` into `memory-import`. Note
`TestImportLifecycle` has a `Complete` gate in its file: put the contract call in the default-suite
part, or write under `KIRA_FLOW_COMPLETE=1`. UI both tests read the estimate, per-file results and
paused reason from the contract.

S13 P210/P221 memory settings. Files: `flows/memoryflow/{store,semantic}_test.go`,
`tests/ui/settings-memory.spec.ts`. `TestSemanticNotInstalled` records
`MemoryService.SemanticStatus#not-installed`; `TestInstallSemanticModelCancelled` records the
cancelled status/error `#cancelled`; `TestConnectClaudeCode` records `MemoryService.McpStatus` and
`MemoryService.InstallClaudeCode` into `memory-settings`. The three UI tests read them.

S14 P214 manual add. Files: `flows/memoryflow/store_test.go`, `tests/ui/memory-module.spec.ts`.
`TestGateRejectsOrFails` (challenge case) and `TestStoreThroughGate` add `args:MemoryService.Store#free-text`,
`MemoryService.Store#challenged`, `MemoryService.Store#stored` to `memory`. UI `Add memory: free text,
a challenge shows questions, resubmit sends clarifications, stored lists outcomes` answers Store from
the contract and asserts the sent args equal `#free-text`.

S15 P212/P223 pairing and expiry. Files: `flows/mobileflow/{access,prompts}_test.go`,
`tests/mobile/support/mockServer.ts`, `tests/mobile/pairing.spec.ts`, `tests/ui/mobile-access.spec.ts`.
- `TestPhonePairing` records `http:POST /api/pair#approved`, `http:GET /api/me#paired`. New subtest
  `an expired device is refused`: plant the device's expiry in the past through `app.DB()`, then
  `GET /api/me` answers 401 with the expired body; record `http:GET /api/me#expired`.
  `TestMobilePairingRoutes` records `event:kira:mobile:pairing#request`.
- `mockServer.ts`: let a test override `/api/me` and `/api/pair` bodies from contract values (state
  field, no new server).
- Mobile UI: `approval lands on the app and shows the three tabs` and `an expired device returns to
  the pairing screen with a notice` answer from the contract. Desktop UI: `the pairing prompt shows the
  code and origin ...` emits the contract event.

S16 P212 reads and writes. Files: `flows/mobileflow/{reads,writes}_test.go`, `tests/mobile/{tabs,writes}.spec.ts`.
`TestPhoneReadsRealAde` records `http:GET /api/ade/backlog` (masked times); `TestPhoneWrites`
records `args:POST /api/ade/backlog/items` and its response, into `mobile-board`. Mobile `Backlog lists
items in priority order ...` serves the contract backlog; `adding a backlog item sends it once with an
idempotency key` asserts the body equals the contract args (key aside). Day-grouped Plan tab stays on
hand fixtures (flow dates are wall-clock).

S17 P212 Part 2 hold overlay. Files: `flows/mobileflow/terminal_test.go`, `tests/ui/ade-tui-takeover.spec.ts`.
`TestPhoneTerminalAttach` records `event:kira:mobile:terminals#held` (and `#released`) into
`mobile-terminal`. UI `a hold shows the overlay and the strip badge; Reconnect reclaims the terminal`
emits the contract payload with the fixture terminal id; asserts overlay, badge, and the
`mobileReclaimTerminal` args.

S18 P236 error path. Files: `flows/adeflow/errors_test.go`, `tests/ui/ade-v2-run.spec.ts`.
`TestRunWithoutClaudeOnPath` records `AdeTaskService.Run#no-claude` into `ade-run-errors`. New UI
`contract: a run without claude on PATH shows its reason` places it on the fixture step; the step
status reads failed and `ade-run-note` equals the contract reason; Retry visible.

S19 P243 git. Files: `flows/gitflow/{blame,ops_local}_test.go`, `tests/ui/repo-workspace.spec.ts`,
`tests/ui/support/gitUiPortFixtures.ts` if the list fixture lives there.
- `TestBlameLine` records `git:blame.line#line-2` into `git-blame`. New UI `contract: the status bar
  blames the cursor line`: a repo workspace with a git record, `installGitStreamMock` answers
  `blame.line` with the contract; put the cursor on that line; status bar blame shows author and
  summary from the contract. (Replaces the gap the comment at `repo-workspace.spec.ts:386` names; keep
  that test.)
- `TestWorktreeAddRemove` records `git:worktree.list#after-add` into `git-worktree`. UI `a repo
  workspace: expanding a row lists its worktrees ...` answers `worktree.list` from the contract.

S20 P224/P243 startup cleanups (no UI). Files: `main.go`, `internal/appwire/*.go`,
`flows/appflow/startup_test.go` (new).
- Move `removeLegacyGitSocket` from `main.go` into `appwire.Build` next to `removeRetiredModels`
  (both run after the instance lock: `main` acquires it before `Build`). D8.
- Given a flowharness app; plant `<space home>/git.sock`, `git.sock.lock` and a retired model dir
  (name from `modelstore.RemoveRetired`'s list) under `memory.Home()`.
- When `app.Restart(t)`.
- Then all three are gone; a kept model dir (embed) survives. No contract (no UI surface).

S21 P233 smart runs, fake claude. File: `flows/claudeflow/isolation_test.go`. Add subtests
`smart_script_run` (create smart script, Preview, Start, wait done) and `ade_smart_step` (workflow agent
step with `smart_script:` naming it, start the task, wait done). Each: settings snapshot unchanged;
recorded launch argv (fakeagent call file) carries `--setting-sources ''` and no `--settings` path
inside the fake home.

S23 P242.2 smart failed (Space). Files: `flows/termflow/*smart*_test.go`, `tests/ui/automations-smart.spec.ts`.
`TestSmartScriptSpace` gains the failed outcome (fake agent reports failed with a reason) recorded as
`ScriptRunsService.Get#failed` in `smart`; the `contract: a smart script run ends ${outcome.label}`
loop gains the failed case (Studio already has it).

C1 Claude suite (open item 1). File: `apps/kira-space/tests/claude/settings_test.go`.
`TestRealClaudeSettingsUntouched` gains `t.Run("smart script run")` (`smartRun` helper from
`automation_test.go`, prompt `Reply with the word ok.`, tools Read only) and `t.Run("ade smart step")`
(save a workflow whose agent step has `smart_script:` naming a haiku smart script, run it via
`startRun`); `check` after each. Runs only via `bun run test:claude:space -run
TestRealClaudeSettingsUntouched`; never in hooks or CI.

### Stream B (Studio)

T1 cache pane (status bar move). Files: `tests/ui/settings-apply-on-save.spec.ts` (or new
`tests/ui/settings-cache.spec.ts`), `tests/ui/support/mockStream.ts` if it cannot push a port event.
- New `the status bar has no cache readout; Settings > Cache shows usage and hit rate`: push a
  `cache:stats` port event (`encodeFrame` already encodes `cacheStats`) with l2Bytes 1 MiB, budget 64
  MiB, hits 3, misses 1; status bar has no `cache-size`; Cache pane `Current usage` reads `1 MB / 64 MB`
  (format via `formatBytes`), `Hit rate` reads `75% (3/4)`.
- New `Clear caches sends cache:clear`: click `settings-clear-caches`; the mock stream logged one
  `cache:clear` op.
- Backend half: existing `adapterhost` unit `TestAttachStream_PushesCacheStatsOnChange` (frame
  boundary; the data plane has no bound method and no flowharness client). D10.

T2 P219 API request move. Files: `flows/apiflow/*_test.go` (`TestMoveRenameGrpcItem`, add an HTTP
request move if it only moves gRPC), `tests/ui/collections.spec.ts`. Record
`args:CollectionsService.Move` (or the bound move name) and `CollectionsService.Tree#after-move` into
`api-move`. UI `collections — a request moves to another collection from its context menu` asserts
sent args and renders the tree from the contract.

T3 P219 script collections. Files: `flows/termflow/*_test.go` (`TestScriptCollections`),
`tests/ui/automations-module.spec.ts`. Record `args:CustomScriptsService.Update#move` and
`CustomScriptsService.List#after-move` into `script-collections`. UI `a script moves between
collections from its context menu` asserts args and the row under the new collection.

T4 P242.1 legacy folder (Studio). Same as S10's legacy half: `TestScriptFolders` records
`ScriptRunsService.ResolveDir#legacy` into `script-folders`; `automations-runs` `a legacy home script
offers the automations folder` reads it.

T5 P242.4 overlap (Studio). Same as S8 on `apps/kira-studio`: `schedule-overlap`.

T6 P246 Studio routing. Files: `flows/promptflow/prompts_test.go`, `flows/dbmcpflow/*_test.go`,
`tests/ui/prompts.spec.ts`, `tests/ui/automations-recurring.spec.ts`. `TestScheduleConfirmRoutes`
records `PromptsService.MainWindow`, `PromptsService.List#two-waiting` into `prompts-route`;
`TestDbMcpApprovalRoutes` records `PromptsService.List#approval` into `dbmcp-route`. UI: `the oldest
prompt shows first with a count ...`, `a waiting run shows no popup in a window the router did not
target`, `an MCP approval shows only in the window the router targets` read them.

T7 P244 docker exec opt-in. Files: `flows/dockerflow/*_test.go` (`TestExecSession`, Docker-gated),
`tests/ui/docker-module.spec.ts`. Record `args:<exec open method>` and its result into `docker-exec`
(write needs `KIRA_FLOW_DOCKER=require` and a running `dockerd`). UI `terminal: no session opens until
New session is clicked ...`: no exec-open call before the click; after it, the logged args equal the
contract args (container id swapped to the fixture's). Dropdown overlap and side-list stats stay UI
only (layout).

## 6. Open items (from the brief)

1. `TestRealClaudeSettingsUntouched` has no smart-step case: in. C1 (real) plus S21 (fake, default
   suite). Real run once at phase end.
2. ADE task picker needs a saved script: behaviour fix out (D7); coverage in (S9 pins the current
   rule both halves and links the saved-script path).
3. `:complete` flow suites never ran: in. Run `test:flows:space:complete` and
   `test:flows:studio:complete` once at phase end with `dockerd` up; images already local
   (`postgres:17-alpine`, `alpine:3.20`, `bash:5.2`); pull via `mirror.gcr.io` only if missing
   (`docs/DEV_ENVIRONMENT.md`). Failures get fixed in this phase (CLAUDE.md), or become a named
   follow-up row if outside scope.
4. P247 `fix round N of 3`: S1 (test exposes it at max 2; fix uses the back edge's `max`).

## 7. Decisions (defaults in force unless the user overrides)

1. One sequential implementer, Stream A then B. Streams are disjoint (§4.1) but disk (2.2 GB) rules
   out a second worktree. If disk is freed to >= 15 GB, two worktrees per §4.1 are allowed.
2. SPEC status drift: close-out flips P236, P237, P238, P239, P244 to `Done` (results and commits
   landed) and fills the P244/P246/P247/P248 result stubs with pointers to their plan results.
3. "Covered" requires a shared contract fixture; existing hand-mocked UI tests are converted in place,
   not duplicated (SPEC: no duplicate coverage).
4. One link per behaviour: the scenario whose visible result depends on backend data. UI-side rules
   (validation text, layout, localStorage) stay UI only.
5. No new e2e-real spec. Two-window routing and keystroke order stay on the existing anchors.
6. S1 fix: denominator from the back edge's `max` (largest when several edges point at the step);
   no denominator when none. Alternative: drop `of N` entirely (pure one-liner, loses the budget).
7. Schedule task picker for an unsaved script: not changed in P250 (feature work; the hint already
   explains it). Alternative: a script-independent task list call; own SPEC row if the user wants it.
8. `removeLegacyGitSocket` moves into `appwire.Build` so a flow test can reach it (S20).
   Alternative: leave in `main.go` and assert in `boot-real` (adds to e2e-real; rejected by D5).
9. P210 real embedding search with the downloaded model: out (model download per run; the semantic
   path is unit-tested in `internal/memory/embed`). Keyword half covered by `memory`.
10. Cache pane backend half is the existing frame-level unit test; no flowharness data-port client is
    built for one readout. Alternative: a `flowharness` data-port helper plus a dbflow subtest.
11. Docker-gated contract (T7) is written once here with Docker; the default UI suite reads the
    committed file, so the UI half runs without Docker.
12. Anything that needs `packages/**` or root `internal/**` stops and goes to
    `plans/P250-findings.md` before it is done in a separate commit (keeps §4.1 ownership honest).
13. Complete suites (open item 3) and one claude run (C1) are part of the end-of-phase verification.

## 8. Load and disk guardrails, end-of-phase verification

Guardrails:
- Before any build: `df -h /` must show >= 6 GB free. Reclaim only regenerable caches:
  `rm -rf /tmp/go-build* /tmp/go-link-* /tmp/playwright-transform-cache-*`,
  `apps/*/test-results`, `playwright-report`. Never `go clean -cache`, never `docker image prune`
  before the complete suites (they need the images). Stale worktrees (`git worktree list`) are the
  orchestrator's call, not the implementer's.
- Per commit: fast checks only (lint, typecheck, `go vet`, `lint:go` on touched packages, the one
  flow package or UI spec being edited, e.g. `go test -run TestBranching ./apps/kira-space/internal/flows/adeflow/`
  and `playwright test --config=apps/kira-space/playwright.config.ts --project=ui ade-v2-run`).
- golangci-lint refuses to run in parallel: run it alone; on a lock error wait 60 s and retry.
- Run suites one at a time, never two Go suites or a Go suite plus Playwright together (4 CPUs; P249
  saw load ~22 and a load flake in `adeflow.TestScheduleADE`). A flake: rerun that test alone with
  `-count=3`; a real failure gets a root-cause fix.

End-of-phase (once, in this order; record pass counts and wall times in `P250-result.md`):
1. `bun run lint`, `bun run typecheck`, `bun run lint:go`, `bun run lint:dead`, `bun run lint:claude`.
2. `bun run test:unit`.
3. `bun run test:flows:space` (coverage gate, `exempt.txt` empty), then `bun run test:flows:studio`.
4. Start `dockerd` (`docs/DEV_ENVIRONMENT.md`), then `bun run test:flows:space:complete`, then
   `bun run test:flows:studio:complete`.
5. `bun run test:ui:space`, `bun run test:ui:space-mobile`, `bun run test:ui:studio`.
6. `bun run test:e2e-real:space`, `bun run test:e2e-real:studio` (unchanged specs; confirms nothing
   regressed through the S20 move and the Wails bump).
7. `bun run test:claude:space -run TestRealClaudeSettingsUntouched` (spends ~0.03 USD; CLAUDE.md
   rule for Claude-integration changes).
8. `git status` clean of regenerated fixtures: rerun steps 3 and the complete Studio dockerflow
   package without `KIRA_CONTRACT` and confirm no diff.

Estimated wall time under normal load: lint/typecheck 3 min, unit 1 min, flows 5 + 2 min, complete
Space ~6 min, complete Studio ~12-15 min (containers), UI Space ~10 min, mobile ~2 min, UI Studio ~8
min, e2e-real ~3 min, claude ~2 min. About 55-60 min total; x2 under load.

Orchestrator checks before accepting: every §5 item's flow test calls `.Contract(` with its
scenario and its UI spec calls `contract('<scenario>'`; `ls apps/*/tests/contract/` gains the §5
scenarios; `stageBlocks.ts` has no literal `of 3`; `exempt.txt` both empty; `grep -n "smart"
apps/kira-space/tests/claude/settings_test.go` shows both subtests; result file lists the complete
suite pass counts.
