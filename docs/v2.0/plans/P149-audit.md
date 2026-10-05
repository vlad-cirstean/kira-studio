# P149 audit record

Durable record of the P149 closing audit (plan `P149-ade-v2-closing-audit.md`, R5). Base `B0` =
`cee4112c`. Verdicts: `ok`, `ok (accepted: ref)`, `gap -> fixed <sha>`, `gap -> P15x`.
Steps recorded: see the `## Samples (step 3)

Live server-tag run (`KIRA_SPACE_HOME` temp, `WAILS_SERVER_HOST=127.0.0.1`), Playwright Chromium 1440x900.

| Check | Observation | Verdict |
|---|---|---|
| Empty state | `No workflows yet. Workflows are YAML files in <home>/workflows.` | ok |
| Import YAML (path field, R25) of `standard.yaml`, `bugfix.yaml`, `chore.yaml` | List rows: `Bugfix \| Triage > Fix > Release \| used by 0`, `Maintenance \| Update > Release`, `Standard feature \| Spec > Implement > Review > Release`; no error marker | ok |
| YAML mode message | `valid - the form and the plan use this file` for all three | ok |
| Form fidelity | bugfix: Triage user, Fix agent with 4 steps (`each repo`, auto/approval, `stop`/`retry 1`/`retry 2`, 30m/1h/1h/15m, send-back targets listed per earlier step), Release script. chore: Update agent (2 steps), Release script. standard: Spec user, Implement agent (`Plan from spec` once, 20m; `Implement` retry 1 2h; `Write tests`/`Make CI green` back:impl 1h; `Open PRs` approval 15m), Review user, Release script. Equal to the sample files | ok |
| Indentation error | all three: `line 5: unexpected content here (check the indentation) (the last valid version stays in use)`, list row shows the error marker; revert returns `valid` | ok |
| Plan uses last valid file | covered by `GO TestReader_lastValidSurvivesBreakage` plus the live `(the last valid version stays in use)` message; seeded tasks then counted `used by 1 / 11 / 6` | ok |
| Stage progress segments | cards show one segment per stage; stage label per the task's `current_stage` snapshot. First seed lacked `current_stage_json`, so no progress rendered: seed artifact, not a defect (`ade_tasks.current_stage_json` is written by the run engine) | ok |
| Folder watch | a sample copied into `<home>/workflows/` from the shell appeared in the list without reload | ok |

## Mockup (step 4)

Mockup served statically, app live (server build). Same viewport and scheme. Images stay in the
scratchpad (`shots/{m,a}-*.png`), not committed. Measured with `getBoundingClientRect`, not by eye.

Measurements (S1/S7): card radius `10px`, left edge `4px`, header `68px`, gap between cards `10px`,
title clamp 2 lines (`titleH` 31 for a 100-character title), card width 600; ruler `Today, Tue 6, Wed 7,
Thu 8, Fri 9`; `Load all items` shows `N more`, then `Show only the first 10 again` (10 cards
collapsed, 18 after load all); plan header `Refresh all` plus a per-repo `just now - no changes`
chip; backlog panel `519px` (520 minus a 1px border). Stage label cell widths 39-98px, below the
~150px cap. Drag of a card to another day: no dialog, `plan_day` and position written (`2026-10-06,2`
to `2026-10-05,0`).

| # | Screen | Compared states | Verdict |
|---|---|---|---|
| S1 | Plan | tab bar and badges, capture, header chips, ruler, cards, `!`, branch rows (base marker `⑂`, `dev`/`▲env` chips), load all, history row, ripple, drag | match; `data`: fixture vs live data |
| S2 | Task panel | header line (`Blocked`, title, actions, facts), Task tab, Notes tab full height, ripple | match; accepted: P146 B (Workflow block, extend-only estimate), app theme background |
| S3 | Sessions tab | `Nothing running.`, `Finished / stopped` list with `Take over`, read-only log, TUI tab | match; accepted: R15 `Stop`, real xterm, Take over confirm (D3) |
| S4 | Branch panel | `<- task`, header, actions, Details (Merged into, Deployed to), Changes, Sessions | match except one defect: stale-deploy note read `1 commit of this branch are missing`. gap -> fixed `351be864` |
| S5 | Fix menu | right-click on stale/behind branch | accepted: R20 (shared context-menu primitive) |
| S6 | Add popover | New task, Existing branch | match |
| S7 | Backlog | list, panel, promote | match; panel 519px |
| S8 | Needs you | kinds, footer, All sessions | match; accepted: rank order (SPEC2 §11), `Running`/`Stopped` labels (R19) |
| S9 | Workflows | Form, YAML | match |
| S10 | Repos | folders, repos, env rows | match |
| S11 | Dialogs | Spec (`Spec · interactive Claude Code`), Start, Rebase, Re-merge (path `/root/wt/<repo>/_develop` for the home-based worktree root, SPEC2 shows `~/wt`), Archive risk, Take over confirm | match; accepted: `~` expands to the real home |

## Findings

- **F1 (gap -> P155):** settings leaf `ade.allAgentsFilter` (`active`/`older`, P129) has no writer and
  no reader in v2 (`AdeAllSessions.vue:14` keeps a local ref with `running`/`stopped`, R19). Removing
  the leaf touches `settings.go`, its model, bindings and the settings schema: a wire change, so R1
  sends it to a row.
- **F2 (gap -> fixed `351be864`):** `deploy.go` wrote `1 commit of this branch are missing`.
  `missingNote` picks `is` for one. No dedicated test (unit-test bar: one-condition format).
- **F3 (gap -> P156):** held fix runs lose `runOpts` across restart (accepted P147 A, needs a run-row
  column and so a migration). Carried as a row because users can hit it.

## Unobserved (step 5)

Environment: `claude` 2.1.289, no Claude account in the sandbox (no credentials), so the interactive
TUI cannot authenticate; `claude -p` works. Server tag build: the terminal emitter's `EmitTo(windowKey)`
needs a native window, so terminal output is dropped in this build (the WebSocket carried
`kira:agent:sessions` but no `kira:terminal` frame). A throwaway `EmitTo` fallback patch (never
committed, reverted with `git checkout`) confirmed that but the TUI still showed nothing to type
into, because `claude` itself waits at its own first screen.

| # | Item | Observation | Outcome |
|---|---|---|---|
| 1 | TUI first run | In a pty (`pty_probe.py`), fresh worktree: `Let's get started. Choose the text style ...` theme picker; Enter leads to `Select login method` (Claude account / Console / 3rd-party). No folder-trust prompt reached because login comes first. The initial argv message is therefore not processed here | partly observed. Known open item narrowed: after login, trust prompt and the ` -- ` message need an authenticated sandbox |
| 2 | `▶ Start` click | Dialog `Start Claude Code (interactive)`, body `Task: ... Repo: api - Branch: feat/csv-export - Worktree: /root/wt/acme-api/csv-export`; Send -> `StartBranch` -> Sessions tab selected with the TUI tab; `ade_sessions` row `tui / b_csv_api / running`; second `StartBranch` -> 422 `a session is already open on feat/csv-export` | observed, ok |
| 3a | Stop hook ends turn -> `RecordMerge` | Right-click/panel `Re-merge into develop` -> dialog (`Merge feat/usage-billing into develop`, target `web-app / feat/usage-billing / new session`) -> Send opens a real `claude --session-id <id> --settings <hooks.json> -- <message>` process with `KIRA_AGENT_HOOK_TOKEN` and `KIRA_TERMINAL_ID` in its environment. Interactive `claude` cannot authenticate, so the Stop was produced by the same hook shim `claude` calls (`/tmp/kira-agent-*/hook`, POST to the unix socket with the process' env and a `Stop` JSON body) after a real `git merge` in the develop worktree. Result: `ade_branch_marks` gains `('b_bill_web','target','develop',<tip>,recorded=1)`. A first attempt killed the launched TUI process, then ran `claude -p --settings <hooks.json>` with its env: the merge ran for real (merge commit created) but no mark appeared; the TUI's terminal was already gone, cause not isolated further | observed through the shim (hook server, env, socket, event, `adeTurns`, `RecordMerge` real); not observed with claude's own firing of Stop. Known open item reworded, not deleted |
| 3b | Archive with dirty worktree | Task panel `Archive` with `dirty.txt` uncommitted: dialog `Archive: work would be lost`, risk line `web-app: 1 uncommitted, 2 unmerged commits. Tell Claude what to do with it, or delete the worktrees anyway.`, button `Send to Claude, then archive`; Send closes the dialog, opens a TUI session on the branch, task stays unarchived (`archived_at` null) until the turn ends | observed up to the turn end; archive after the turn not observed (needs authenticated TUI). Stays in the open items |
| 4 | Todo progress in `-p` | `claude -p --output-format stream-json --verbose` (2.1.289), prompt asking for a todo list: `init` tools hold no todo tool (`TodoWrite`/`TaskCreate`/`TaskUpdate` absent); the model searched with `ToolSearch`, found none and said so | observed: no todo tool; Known open item stays, question for the user repeated in `## Result` |

## Progress` list at the end.

**Silently dropped requirements:** none found (every SPEC2 item below has evidence).

## Suites

### Baseline on `B0` (tree = `5a70b19f`, plan commit only)

Bindings regenerated first (`wails3 task common:generate:bindings`): no diff.

| Suite | Result | Decisive line |
|---|---|---|
| `go build ./...` | pass | rc 0 |
| `go vet ./apps/kira-space/...` | pass | rc 0 |
| `go test ./...` | 73 packages ok, 1 FAIL | `--- FAIL: TestSessionCloseKillsProcessGroup (10.21s)  session_test.go:171: condition not met within 4s` (`internal/terminal`): owned by P153, no fix here (R4). Container-backed Studio suites skip without a Docker daemon (37 packages report `no test files` or skipped). |
| `go test -race` ade, adeagent, adeflow, gitsession | pass | rc 0 |
| `bun run typecheck` | pass | rc 0 |
| `bun run lint:all` | pass | rc 0 (knip prints 9 configuration hints, no findings) |
| `bun run test:unit` | pass | `1764 pass, 0 fail, 14799 expect() calls, 180 files` |

| `bun run test:ui:space` | 153 pass, 1 fail | `ade-v2-dialogs.spec.ts:163 Details lists Merge and Re-merge ... expect(getByText('Right-click to re-merge.')).toBeVisible() failed`. Predates P149 (`git diff --stat B0` touches no ade file). Reproduced alone in 1 of 3 runs: a flaky hover (panel opening re-lays the row out under the pointer). Fixed in `fix` commit below (R4). |
| `bun run test:visual:space` | 3 pass, 1 fail | `settings.spec.ts:9 settings dialog: Advanced pane`, `1227 pixels (ratio 0.01) are different`. Not font drift: the diff image marks only the new `Background agents ignore repo settings` row (P148 B R21 added it; baseline predated it). Only that baseline regenerated, other three untouched (R4). |
| `bun run test:ui:studio` | 300 pass, 1 fail | `leaks.spec.ts:289 leak sweep ... Test timeout of 120000ms exceeded` (`mouse.move: Page closed`). Passes alone in 34 s, twice. Load timeout while the pre-commit hook ran beside it, Kira Studio subsystem, no defect reproduced: no change, no row (R4). |
| `bun run test:webview` | pass | `60 passed (26.9s)` |
| `bun run test:visual:studio` | pass | `14 passed (21.4s)` |

### After the baseline fixes (same tree plus the two test commits)

`ade-v2-dialogs` "Details lists Merge and Re-merge" 6 of 6 runs green alone; `test:visual:space`
`4 passed`.

Retry review (`2387223f`): accepted as a real spec race, not a masked defect. Clicking the branch row
opens the panel, which shrinks the plan column; the row (and the `dev ⚠` chip) moves after the
pointer is already placed. A tooltip opens on `pointerenter`, so a hover issued before the layout
settles leaves the pointer off the chip and no new enter fires. App behaviour is correct: a real
user's pointer moves again. `toPass` re-issues the hover on the settled layout. Product code
unchanged.

## Audit: SPEC2 coverage (step 2, static)

Evidence codes: `UN` = `tests/unit/ade-v2-*.spec.ts` (`board-parity` compares the board logic with the
mockup's own logic, so a text or rule drift fails it), `UI` = `tests/ui/ade-v2-*.spec.ts`, `GO` =
Go test in `internal/ade*`, `GR` = literal grep (frontend/src/ade, internal/ade*), `L` = live (§Mockup,
§Unobserved). A literal-string pass over 85 SPEC2 strings found 80 verbatim in non-test code; the
other 5 are the accepted forms listed in "Literal text".

### Intro (v1 rules kept)

| Item | Owner | Evidence | Verdict |
|---|---|---|---|
| Actions only in the left column | P145 B | `AdeActionCell.vue`, `AdeBranchRow.vue` hold buttons; card header has none (`UI plan` card geometry test) | ok |
| Activity icons, none animated | P145 B | `AdeActivityIcon.vue`; `grep animate-\|@keyframes` under `frontend/src/ade`: empty | ok |
| Claude dialog: editable message, Reset, busy check, Override, push switch off, "ask if unclear" | P148 B | `UN dialog` (blank disables send, busy block + override, headless block no override, push switch); `UI dialogs`; `compose.ts:292` template carries the ask line | ok |
| Archive safety | P147 A / P148 B | `GO TestAtRisk_*`, `UI archive` (4 flows); `UN dialog` risk line | ok |
| Rich-text notes | P146 B | `UI panel` "typing in Notes saves once, debounced"; `ade-notes-markdown.spec.ts` | ok |
| Days, weekends, day off, overflow, history | P145 B | `UN timeline` (weekend skip, day off, worked weekend, overflow, overdue, Later) | ok |
| Colour slots never reassigned | P144 A | `ade_tasks.color` stored at create; `GR` no writer of `color` outside create | ok |
| Conflicts in memory, git CLI (D1) | P144 A | `GO TestPairFacts_*`, `TestRebaseChecker_*`; `git merge-tree --write-tree`, no go-git in `go.mod` | ok (accepted: D1) |

### §1 outcome and §2 model

| Item | Owner | Evidence | Verdict |
|---|---|---|---|
| One task, branches in two repos, planned and run as one unit | P149 | `L` S1/S2 (§Mockup) | see §Mockup |
| Task, Workflow, Stage, Run, Branch, Step, Session, Integration, Prepare, Environment, Review item, Parked present | P143/P144 A | `adewire` types; migrations 0008 (tasks, task_branches, task_plan, runs, backlog, repo_config, repo_integration, repo_envs, folders, worktree_setup, workflow_last_valid), 0009 (branch_marks, env_state), 0010 (sessions, logs, log_chunks); `UN`/`GO` exercises each | ok |
| Base marker: `⑂`, `⑂ <base>`, blue for someone else's | P145 B | `board/baseMarker.ts`; `UN board-parity` "base marker label and tone equal the mockup"; `UI plan` base markers | ok |
| Base tooltip `starts from X (li's branch), not main` | P144 B | `baseMarker.ts:19,33` (curly apostrophe, same as mockup line 1818) | ok (accepted: mockup text) |
| `no branch yet · from <base>` | P144 B | `baseMarker.ts:43`, `usePlanModel.ts:120`; `UN board-parity` context chips | ok |
| Cross-task `on <branch>`, `↻ <branch>` + Rebase, never for a branch on someone else's | P144 B | `actions.ts` rules `sharesFiles`, `waitingOnReview`; `UN board-parity` tag/actions | ok |
| Review item above its dependent/conflicting task | P144 B | `UN timeline` "review item sits right above the first task that builds on it" | ok |
| Parked task | P144 B | `UN timeline` (parked not numbered); `UI panel` Not merging switch | ok |

### §3 navigation, §4 timeline

| Item | Owner | Evidence | Verdict |
|---|---|---|---|
| Tab order Backlog, Needs you, Plan; right: capture, `+ Add task`, Workflows, Repos; badges grey/amber | P145 B | `shell/AdeShell.vue`; `UI backlog` "tab precedes Plan and counts the items"; `UI needs` badge | ok |
| Capture box text, Enter adds to top, `added to backlog` | P145 B | `GR`; `UI add` first test | ok |
| `+ Add task` from any screen, new task selected on Plan | P145 B | `AdeAddPopover.vue:119` (icon + `Add task`); `UI add` "New task creates a branchless task ... and selects it" | ok |
| No repo tabs; Refresh all first; chips only for repos used by a plan task; show/hide; per-chip `↻`; after-fetch text | P145 A/B | `UI plan` chip tests (hide/show, refresh ids, fetch summary); `GR` no `RepoTabs` in code | ok |
| Autofetch default off | P145 A | `DefaultGitSettings().FetchAutoIntervalMinutes: 0`; `board.go` echoes it | ok |
| Per-task day/order/merge order | P144 B | `UN timeline` sort test, `UN dropplan` | ok |
| First 10 incl. review items, later days hidden, both buttons' text, history button | P144 B/P145 B | `UN timeline` cap tests (10, 11, review counts, hidden repo); `UI plan` "first 10 ... loads all and collapses back", "loads the archived history" | ok |
| Drag applies, no dialog; no split-across-days | P145 B | `UI plan` "dragging a card ... writes the plan once, with no dialog" | ok |
| Card geometry 10px/4px/68px/10px gap | P145 B | `UI plan` "a card is a 10px rounded box with a 4px task edge, a 68px header and 10px gaps" (measured) | ok |
| Header line 1/2, two-line clamp + tooltip | P145 B | `UI plan` "card shows its stage, progress, span and clamped title" | ok |
| Stage progress segments, label, percent, both tooltips | P144 B | `UN progress` (average, todo null, tooltip); `UN board-parity` "stage label, percent and segment widths equal the mockup", "workflow and bar tooltips equal the mockup" | ok |
| `!` circle only, tooltip, click targets | P145 B/P148 B | `UI launch` "the ! circle on a stuck branch takes the run over"; `needsYou.ts` | ok |
| Branch own progress forms (`n/m`, `· stuck`, `· failed`, `· waiting`, `↩ sent back`, `· fix N`, `<stage> ✓`) | P144 B | `progress.ts:252-289`; `UN progress` "names the first unfinished step ..."; `UI plan` "a branch row shows its own progress" | ok (todo `n/m` null live: accepted P146 A) |
| Branch row line 1 / line 2 order, `▲` envs, stale amber | P145 B/P146 B | `UN board-parity` "context, merged and deployed chips equal the mockup"; `UI plan` "line 2 shows merged and deployed chips with stale in amber and tooltips" | ok |

### §4.2 action column

| Item | Owner | Evidence | Verdict |
|---|---|---|---|
| Task cell first-match: `✓ merged` + Archive only when workflow finished | P144 B | `actions.ts:168`; `UN board-parity` "status chip and stage action equal the mockup" | ok |
| `▶ <Stage>`, `Done ›` (tip `Spec is done; move to Implement`), `Finish ✓` | P144 B | `actions.ts:68` builds the tip from stage names (grep for the literal finds none: built string) | ok |
| Agent: Take over (red) > Approve > `▶ Run` > `Done ›`; script: `▶ Run` / Retry / `Done ›` | P144 B | `actions.ts:120-146`; `UN board-parity` "stuck script run offers Retry (R23)"; `UI run` Approve/Retry/Done | ok |
| Branch first-match table incl. `⚙ preparing`, `✕ setup failed` + See error, `▶ Start` only on a never-sessioned branch | P144 B/P147 B/P148 B | `actions.ts:244-367`; `UN board-parity` tag test; `UI panel` setup tests; `UI launch` "▶ Start launches the branch" | ok |
| `CI failing` rung | P144 B | absent by D9 (`needsYou.ts:5`, `b_deps` shows `✓ clean`) | ok (accepted: D9) |

### §5 workflows, stages, sessions

| Item | Owner | Evidence | Verdict |
|---|---|---|---|
| Derived status rules, read-only panel text | P144 B/P146 B | `UN progress` "workflow states"; `UI panel` "status is read-only" | ok (accepted: D10) |
| User stage dialog (Spec example shape) | P147 A/P148 B | `UN dialog` "stage: title line, Jira, writable and read-only repos, notes, substituted prompt" | ok |
| Agent stage headless runs, Run dialog, Approve gate, stuck/failed -> Take over | P146 A/P147 B | `GO TestRunEngine_*`; `UI run` (dialog default text + suffix, Approve, Retry) | ok |
| Take over everywhere (Sessions bar, step rows, Needs you, `!`, task action, stopped list), confirm when live (D3) | P147 A/P148 B | `UI sessions` (confirm on running, none on stuck, stopped list), `UI launch`, `UI needs` | ok |
| Release extras: branches with `main ✓/—`, merged-into | P147 B | `panel/AdeStageBlock.vue:212`; `UI run` "a script run offers Output, and the Release block lists the branches" | ok |
| Per-repo run lines | P146 A/P147 B | `UI run` "a pushed runs event updates the step line" | ok |
| Send back template, `· fix N`, 3-round cap | P147 A | `GO TestRunEngine_sendBack`, `TestSendBackTarget`, `TestChainRerun`; `UI run` send-back | ok |
| Script stages: variables, Output, red lines, Retry | P146 A/P147 B | `GO TestRunEngine_scriptStage`; `UI run` | ok |
| Default Release = script (samples) | P144 A | samples parse (`TestParse_designSamples`); live import in §Samples | see §Samples |

### §5.1 / §5.1.1 / §5.1.2 workflows page, YAML, finish_step

| Item | Owner | Evidence | Verdict |
|---|---|---|---|
| Workflows list, editor fields, stage/step cards, `+ Add stage`/`+ Add step`, next-stage rule | P145 A/P147 B | `UI workflows` (list, form saves, new step id, send back); `GR` strings | ok |
| Form/YAML switch, path, Copy YAML, Import YAML, `+ New` | P147 B | `UI workflows` (Copy YAML, Import, `+ New`); Import is a path field (accepted: P147 B R24) | ok (accepted: P147 B) |
| Validation messages (valid + both error shapes), last valid stays, folder watch | P144 A/P147 B | `GO TestReader_lastValidSurvivesBreakage`, `TestWatch_*`; `UI workflows` YAML tests; errors carry `line` without `✕` in the wire (accepted: P144 A) | ok (accepted: P144 A) |
| Reader aliases `manual`/`automated` | P144 A | `adeflow/parse.go:27`; `GO TestParse_aliasMapsToWireKind` | ok |
| Panel Workflow select restarts at first stage; `Edit workflows ↗` | P147 | `GO TestRunEngine_setTaskWorkflow`; `UI run` select + Edit workflows | ok |
| `finish_step` tool, outcomes, suffix text exact, editor note + hover, suffix in the dialog | P146 A/P147 B | `adeagent/suffix.go` (text identical to SPEC2); `GO TestFinishStepServer`; `UI run` "default message and the read-only suffix" | ok |
| `ended without finish_step`; timeout = failed; scripts by exit code | P146 A | `runs.go:28,547,581`; `GO TestRunEngine_retryAndTimeout` | ok |

### §5.2 long text

| Item | Owner | Evidence | Verdict |
|---|---|---|---|
| Cards / panel header title 2-line clamp + tooltip; branch names one line + tooltip; branch panel header wraps; lists one line; stage label ~150px | P145-P148 B | `UI plan` clamped title; measured in §Mockup S1/S4 with a long title and branch name | see §Mockup |

### §6 integration, §6.1 setup, §6.2 deployments, §6.3 repos

| Item | Owner | Evidence | Verdict |
|---|---|---|---|
| merged/stale/not merged incl. patch-id; after-rebase stale; recorded merge only on dialog finish (D14) | P145 A | `GO TestIntegration_mergeShapes`, `_staleAfterMarks`, `_recordMerge`; `UI dialogs` "recorded only after a Stop", "a session that ends first records nothing" | ok |
| Row text abbreviations + tooltips | P146 B | `UI plan` chips/tooltips; `UN board-parity` | ok |
| Fix menu items, `Nothing to fix` | P148 B | `UI dialogs` fix menu tests; shared context-menu primitive (accepted: R20) | ok (accepted: R20) |
| Details Merged into rows with Merge/Re-merge | P148 B | `UI dialogs` "Details lists Merge and Re-merge buttons" | ok |
| Merge dialog template, develop worktree path, `Also push develop` default off | P148 B | `compose.ts:292,497`; `UN dialog` merge tests | ok |
| §6.1 triggers, gate, states, log, `⚙ preparing 3m 40s`, Details block, Retry setup, Needs you row | P146 A/P147 B/P148 B | `GO TestRunEngine_setupGate`, `_addExistingBranchWorktree`; `UI panel` setup tests; `UI needs` "See error opens the branch" | ok |
| §6.2 scripts at startup/Refresh/chip; deployed/stale/not deployed; env moved back; `▲env` text | P145 A/P146 B | `GO TestDeployment_scriptStates`; `UI plan`/`UI panel` env rows | ok |
| §6.3 Folders (watch, `+ Add folder`), Repos rows, fields + help texts, `nickname · full name` pickers, `+ Add repo…` select | P145 A/P147 B | `GO TestScanFolder_rules`, `TestAddFolder_*`, `TestFolderWatch_*`; `UI repos`; picker: task panel `AdeTaskTab.vue:191` shows `nickname · full name`; New task chips and workflow scope show the nickname only, as the mockup does (lines 1967, 2764) | ok (accepted: mockup text) |
| D15 repos list = Git module `code_repos` | P145 A | `wireAdeTask` passes `repositories.CodeRepos`; `UI repos` | ok |

### §7 panel, §8 Add, §9 templates, §10 archive

| Item | Owner | Evidence | Verdict |
|---|---|---|---|
| Panel resizable, default half | P146 B | `UI panel` "dragging the handle persists the panel width"; `AdePanel.vue` | ok |
| Task header: mono line, phase action, Archive purple when merged | P146 B | `board/panelFacts.ts:38`; `headerActions.ts` | ok |
| Sessions tab: badges, interactive first, headless bar, read-only log, note, `Finished / stopped`, TUI input | P148 B | `UI sessions` (strip order, bar + log + Stop, stopped list); note text: app/mockup `Read-only log of a background run. Use Take over to continue it yourself in Claude Code.` vs SPEC2 `... headless run ...` | ok (accepted: mockup text, R2) |
| Task tab: Name, Status read-only (D10), Jira key only (R4), GitHub, Estimate extend-only | P146 B | `UI panel` (4 tests) | ok (accepted: P146 B) |
| Workflow blocks per stage (D11), Branches list, `+ Add repo…`, `+ Add branch`, Notes full height | P146 B/P147 B | `UI panel`, `UI run`; `AdeStageBlock.vue` | ok |
| Branch mode: `← task`, header, mono line, actions, Details/Changes/Sessions | P146 B | `UI panel` "a branch opens Details ...; Changes; back to the task" | ok |
| §8 New task (repo chips, at least one, `Add to Later`), Existing branch (all repos, newest first, review item for others, `adding to:`) | P144 A/P145 B | `UI add` (3 tests), `UI panel` "+ Add branch attaches" | ok |
| §9 Start step/task templates, repo-named rebase/queue, worktree path `~/wt/<repo>/<last segment>` | P146 A/P147 A/P148 B | `UN dialog` "start: ...", "uses the repo name with slashes as dashes"; `GO TestRunEngine_*` paths | ok (quotePOSIX leaves safe words unquoted: accepted P146 A) |
| §10 archive template (all branches at risk), stops agents, deletes worktrees, history row | P147 A/P148 B | `GO TestRunEngine_archive`; `UI archive` (5 tests) | ok |

### §11 Needs you, §11.1 Backlog, §12 model, §13 dropped

| Item | Owner | Evidence | Verdict |
|---|---|---|---|
| Kinds, tones, actions, ordering by SPEC2 rank, empty text, footer counts without CI (D9), All sessions grouped, badge = items | P144 B/P148 B | `UN board-parity` (items, rank order, badge, footer drops CI); `UI needs` (8 tests) | ok (accepted: P144 B rank, D9) |
| All sessions filter labels `Running` / `Stopped` (R19) | P148 B | `AdeAllSessions.vue:14` local `ref('running'\|'stopped')` | ok (accepted: R19) |
| Settings leaf `ade.allAgentsFilter` (`active`/`older`) | P129 | written nowhere, read nowhere (§Findings F1) | gap -> P155 |
| Backlog: layout, 520px panel, capture both ways, row contents, `→ Task`, panel fields, `→ Plan as task`, order persisted, task GitHub row | P144 A/P146 B | `UI backlog` (9 tests), `UI panel` GitHub write | ok |
| §12 interface fields map to wire fields | P143 | P143 parity baseline; fields changed since: `Run.sessionId`, `allowedTools`, `lastCommitAt` ms (accepted P144 A/P146) | ok |
| §13 dropped items absent from UI and backend | P145 B/P148 A | `grep -i` over `frontend/src/ade`, `internal/ade*`, `bridge/adetask*` for `Open in TUI`, `All agents`, `Inbox`, `Agent N`, `work_type`, `dependency`, `RepoTabs`, `top-5`, `preset`: all empty; `grep -rn AdeService` in `*.go/*.ts/*.vue`: empty | ok |
| Ripple + `On merge` kept | P144 B/P145 B | `UN timeline` "lists stacked children and branches that must rebase after the selection"; `AdePlanHeader.vue` renders it (accepted: P145 B moved from panel to Plan header) | ok (accepted: P145 B) |

## Audit: design `SPEC.md` §9 (decisions to keep), re-checked for v2

| Rejected item | v2 check | Verdict |
|---|---|---|
| Git-graph lanes, long connectors, category columns, full-width bars, merge-order strip, numeric priority beside merge numbers | none in `frontend/src/ade` (no lane or strip component; `plan/` holds card, band, header, chip, row only) | ok |
| On-screen legends | `grep -i legend` under `frontend/src/ade`: empty | ok |
| Sentence-length statuses | status chips are single words/tags (`actions.ts` tags) | ok |
| Markdown editor with Edit/Preview | notes = TipTap WYSIWYG (`AdeNotesEditor.vue`) | ok |
| Buttons inside boxes | card header has no buttons; actions in `AdeActionCell.vue` (`UI plan` card test) | ok |
| Loose activity icons beside color squares; animated icons | icons only on branch rows; no `animate-`/`@keyframes` | ok |
| Dialog repeating the op as summary + preview | `AdeClaudeDialog.vue` shows message only | ok |
| Auto-generated branch names | branch names typed per repo or Claude-chosen (`Run` dialog) | ok |
| Agents pushing by default | push switch default off (`compose.ts:497` area; `UN dialog` push off/on) | ok |
| Invented steps in agent messages | templates carry task, Jira, repos, notes, step name only (`UN dialog`) | ok |
| Always rebasing onto main | `Rebase onto main` / `onto <branch>` both exist (`UN dialog`) | ok |
| Global top bar | superseded by SPEC2 §3: tab bar replaces it; no global refresh in it (Refresh all lives in the Plan header) | ok (superseded: SPEC2 §3) |
| Jira/PR tabs | links in Task tab / Details rows | ok |
| Per-agent names (`Agent 1/2/3`) | `grep "Agent [0-9]"`: empty | ok |
| Typing branch names by hand | Existing branch picker searches; draft branch names optional per repo (SPEC2 §9) | ok |
| Extra details on queue rows | queue rows removed in P148 | ok (superseded: SPEC2 §11) |
| Fixed-width panel; fixed 4-day ruler | resizable panel; ruler from settings (`horizonDays`) | ok |
| Separate `Not merging` timeline row | parked = dashed card (`UN timeline`) | ok |
| Small hidden refresh icon; global refresh in tab bar | chip `↻` visible; Refresh all in Plan header | ok |
| History always visible; Load buttons | `↑ Load history` button (`UI plan`) | ok (superseded: SPEC2 §4) |
| Preset estimate chips | `AdeEstimateField.vue` number + unit | ok |
| Status after title in link rows; card-style link blocks | `AdeLinkRow.vue` status first | ok |
| All sessions not listing everything by default | default filter `running` | ok |

## Audit: preplan §5 matrix, landing traced

Every row's owning phase landed it. Moves traced to their final home: M1 (merge dialog, fix menu,
Merge / Re-merge) P146 B -> P148 B (`UI dialogs`); U1 (a) (Rebase / Queue after dialogs) P145 B ->
P148 B (`UI dialogs`); R19 `Add existing branch` worktree P147 A (`GO TestRunEngine_addExistingBranchWorktree`);
`Start` P148 B (`UI launch`); setup display P147 B (`UI panel`); Take over P148 B (`UI sessions`);
Needs you P148 B (`UI needs`). No matrix row is unlanded.

## Progress

- [x] Step 1: baseline suites (UI/visual/Studio rows may still be filling)
- [x] Step 2: SPEC2 + design §9 audit (static)
- [x] Step 3: sample workflows in the app
- [x] Step 4: 11-screen mockup comparison
- [x] Step 5: unobserved items
