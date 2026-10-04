# P149 plan: ADE v2 closing — full suites, SPEC2 audit, live mockup comparison, architecture docs

Serial, one sequential implementer (Sonnet). No streams: every step reads the previous step's
findings, and the docs rewrite needs the audit's verdicts. Implements the `SPEC.md` P149 row,
preplan `P143-ade-v2-preplan.md` §4 P149 and §5 matrix, and the P146-P148 carry-forwards. Nothing
from P150 (review code) and no mutation-testing work (P151).

Inputs: `docs/v2.0/SPEC.md` (P143-P148 results, P149/P153/P154 rows);
`plans/P143-ade-v2-preplan.md` (§3 rules, §5 coverage matrix, §6 D1-D16);
`plans/P143-wire-contract.md`; `plans/P144`-`P148` wave plans (R-tables, `## Result`) and all ten
`P14[4-8]-stream{A,B}-notes.md`; `design/ade-v2/SPEC2.md`, `design/ade-v2/mockup.html`,
`design/ade-v2/workflows/{standard,bugfix,chore}.yaml`; v1 `design/SPEC.md` §3.1 and §9;
`docs/ARCHITECTURE.md`; `docs/DEV_ENVIRONMENT.md` (server-tag recipe, webkit, visual font drift).
Base `B0` = `cee4112c` (`v2.0` tip).

**Status: proposed.** The `SPEC.md` row still reads "pending user approval"; the orchestrator
confirms approval before spawning the implementer.

## 0. Findings from the current tree (planning pass)

- v1 is gone from code: `grep -rn AdeService` over `*.go`/`*.ts`/`*.vue` is empty. It survives
  only in `docs/ARCHITECTURE.md` (7 hits) plus v1 prose: the `ade.Tracker`/"agent merge queue"
  paragraphs (~2190-2310: `queue.go`, `facts.go`, P135 dependency nodes, P136 work types,
  `useQueue.ts`), the five P129 Part 3-7 paragraphs in "Git module" (~2713-2912: `AdeRepoTabs`,
  `AdeRepoView`, `useQueue`, `adeUi`, `adeActions`, All agents tab), and a stray `AdeService`
  mention in the `TerminalService` paragraph (~2469).
- v2 facts are scattered as four bullet blocks under "Go packages" (~3159-3215: P145, P146, P147,
  P148), the last saying "Full ADE rewrite of this document stays P149". The P144 `rebaseChecker`
  line (~2267) sits inside the v1 queue prose.
- go-git: not in `go.mod`. Conflict pairs and the rebase-conflict check use
  `git merge-tree --write-tree` (`ade/rebasecheck.go`, `gitsession.RepoEntry.MergeTreeConflicts`);
  integration and deploy facts use `git cherry` plus `patch-id` (`gitclient`).
- Engine wiring: `main.go` `wireAdeTask` builds `ade.TaskBoard` (own `gitsession.Conn` `ade-board`,
  `adeflow.Reader` over `<home>/workflows`, `adeagent` `finish_step` server, `Tracker` for TUI
  sessions), calls `Recover()` then `Start()`. Bridge: `AdeTaskService` (47 methods), 9 channels.
- Frontend: everything under `frontend/src/ade/v2/` (`backlog board dialog needs notes panel plan
  repos run sessions shell state workflows`) plus `ade/AdeView.vue`, `ade/queries.ts`,
  `ade/state/agentSessions.ts`. Tests: 13 `tests/ui/ade-v2-*.spec.ts`, 5 `tests/unit/ade-v2-*`
  plus `ade-notes-markdown.spec.ts`, 23 fixtures. No `ade` visual spec (`tests/visual` holds
  `settings.spec.ts` only).
- Samples: `adeflow/adeflow_test.go` `TestParse_designSamples` parses all three sample YAMLs. Not
  yet shown: each one imported and validated through the running app.
- Literal-text spot check against SPEC2 (grep under `frontend/src/ade`, `internal/ade*`): most
  strings present. Differences found: SPEC2 §7 `Read-only log of a headless run…` vs app (and
  mockup line 904) `Read-only log of a background run. Use Take over to continue it yourself in
  Claude Code.`; SPEC2 §4.2 `Spec is done; move to Implement` is built in `board/actions.ts:68`;
  `Also push develop` is composed in `dialog/compose.ts:497`; v1 tag `↻ rebases` absent (v2 shows
  ripple as a dashed amber outline, `AdeTaskCard.vue:53`, and the `On merge` line in
  `AdePlanHeader.vue`). Settings leaf `ade.allAgentsFilter` is still `'active' | 'older'` while
  All sessions labels read `Running` / `Stopped` (R19): audit whether the values still match use.
- `claude --version` here: `2.1.289`, the same CLI P146-P148 used.
- Highest `P` across every `docs/*/SPEC.md`: `P154`. A new follow-up row is `P155`, then `P156`…

## 1. Decisions

| # | Decision |
|---|---|
| R1 | **Fix in P149 vs. new row.** Fix in P149 when all hold: inside `ade` (Go `internal/ade*`, `bridge/adetask*`, `frontend/src/ade/**`, ade specs, docs); no wire-contract change; no migration; no new dependency; no open design choice for the user; about 150 changed lines or less per finding. Anything else becomes a new `SPEC.md` row (`P155`, `P156`, …) appended at the end with the finding, evidence and suggested scope, marked "Added at end by P149; no other phase renumbered." Never fix half of a finding. |
| R2 | **Source precedence.** User decisions (D1-D16, every wave's R-table, accepted deviations) beat SPEC2 and the mockup. Then the mockup wins for literal text and look (SPEC2 says the mockup is updated in place), SPEC2 wins for behaviour. A SPEC2-vs-mockup text clash where the app follows the mockup is "accepted, mockup text" — no change. |
| R3 | **Accepted deviations are not re-flagged.** The list in §6 is closed input. A comparison finding that matches one is recorded as "accepted (ref)". |
| R4 | **Pre-existing failures.** A failing test, lint or typecheck in `ade`, `adeflow`, `adeagent`, `gitsession` or Space frontend: fix on the spot (CLAUDE.md), after confirming it predates P149 (`git diff --stat B0` touches none of the failing files). A failure owned by an existing row stays there: `internal/terminal` `TestSessionCloseKillsProcessGroup` is P153; a test touching the real `review.db` is P154; `gitsock` flake is P152 (done — a recurrence is a new row). A failure in another subsystem (Kira Studio, webview, visual font drift per `DEV_ENVIRONMENT.md`) is a new row, not a P149 fix. |
| R5 | **Audit record.** `plans/P149-audit.md` is the audit's durable record: per-item verdict and evidence. Committed after each step (§3-§6) before any fix for that step starts, updated in place as fixes land (verdict then names the commit or the new row). It stays after close: the audit is this phase's deliverable. |
| R6 | **ARCHITECTURE layout.** One new top-level section `## ADE: Kira Space task planner (v2.0)` right before `## Database MCP server (v1.7)`. It replaces all v1 ADE prose and the four P145-P148 bullet blocks. Elsewhere, ADE mentions shrink to a one-line pointer to that section. End state: `grep -c AdeService docs/ARCHITECTURE.md` = 0; no `useQueue`, `AdeRepoView`, `AdeRepoTabs`, `AdeAllAgents`, `queue.go`, `agent merge queue`, `ade_new_work`, `work_type` except one history sentence: v1 per-repo merge queue (P129-P140) removed in P148, migration `0011`. |
| R7 | **Facts carried from v1 prose** only after a codegraph lookup confirms the code still does it (e.g. `Tracker` grace window and `Reconcile`, window-scoped PTYs, resume cwd rules, askpass credential routing, `vue-draggable-plus` `forceFallback`, hand-rolled panel resize, `@tiptap/markdown` choice, `check-ade-colours.sh`). A fact the code no longer matches is dropped, not reworded. |
| R8 | **Unobserved items** (§7) get one real attempt each. Observed → recorded with evidence, the matching Known open item deleted or narrowed. Not observable here → the reason is recorded, and the Known open item stays (worded with the exact blocker). No item is reported as observed on mock-runtime evidence alone. |
| R9 | **No new committed tests by default.** Throwaway Playwright and seeding scripts live in the scratchpad. A fix may add a spec only under CLAUDE.md's unit-test bar or to an existing `ade-v2-*` UI spec when the fix is a UI regression. |

## 2. Steps overview (implementer order)

1. §3 baseline suites on `B0`.
2. §4 SPEC2 and design §9 audit (static: greps, tests, code reads).
3. §5 sample workflows in the app (live).
4. §6 screen-by-screen mockup comparison (live, plus mock runtime where live data cannot reach).
5. §7 unobserved items (live, real `claude`).
6. Fixes (R1), committed per logical group as they land.
7. §8 docs: `ARCHITECTURE.md` rewrite, Known open items, `SPEC.md` rows, `DEV_ENVIRONMENT.md` if a new environment fact appears.
8. §9 final suites on the tip, `## Result`.

Steps 3-5 share one server-tag session setup (§6.1); run them in one live session where practical.
Commit `P149-audit.md` at the end of every step, so an interrupted run resumes from the last step
recorded there.

**CodeGraph.** Steps 2, 6 (each finding's blast radius) and 7 (every carried fact, R7) are
discovery: load `codegraph_explore` via `ToolSearch` (`"codegraph"`) and call it before `Read`/
`Grep` for any symbol or call-graph question. Record the call count in `## Result`. Literal-string
greps for UI text are fine without it.

## 3. Baseline suites (on `B0`)

Run each, record pass/fail counts and the one decisive failing line in `P149-audit.md` §Suites:

- `go build ./...`; `go vet ./apps/kira-space/...`
- `go test ./...` (whole repo; container-backed Studio suites skip without Docker — record which).
- `go test -race ./apps/kira-space/internal/{ade,adeagent,adeflow,gitsession}/...`
- `bun run typecheck`; `bun run lint:all` (biome, tokens, theme classes, `check-ade-colours.sh`,
  class conflicts, golangci-lint, knip)
- `bun run test:unit`
- `bun run test:ui:space` (webkit; `scripts/prepare-ui-tests.sh` if webkit is missing)
- `bun run test:visual:space`
- `bun run test:ui:studio`; `bun run test:webview`; `bun run test:visual:studio`

Classify every failure per R4 before moving on. Visual diffs: check for the uniform font-drift
signature first (`DEV_ENVIRONMENT.md`); never `--update-snapshots` from here.

## 4. SPEC2 coverage and design §9 audit

One checklist row per item: `§ · item · owning phase (preplan §5) · evidence · verdict`. Evidence is
a real check: a file:line from `codegraph_explore` or a grep, plus the spec or Go test that covers
it (name it), or "live §6 Sx". Verdicts: `ok`, `ok (accepted: ref)`, `gap → fixed <sha>`,
`gap → P15x`. A requirement with no evidence anywhere is a silently dropped requirement: flag it
loudly at the top of the file.

Items per section (minimum; split further where a section lists several behaviours):

- **Intro (v1 rules kept):** actions only in the left column; activity icons; Claude dialog
  (editable message, Reset, busy check, Override two-click, push switch default off, "ask if
  unclear" line); archive safety; rich-text notes; days, weekends, day off, overflow, history;
  colour slots never reassigned; conflicts in memory (D1: git CLI).
- **§1:** outcome check: one task with branches in two repos, planned and run as one unit (live S1/S2).
- **§2:** each model concept present in `adewire` and storage; base marker three variants + tooltip
  text + `no branch yet · from <base>`; cross-task `on <branch>`, `↻ <branch>` + Rebase; review
  item placement above its dependent/conflicting task; parked task.
- **§3:** tab order and badges (Backlog grey, Needs you amber); capture box text, Enter adds to top,
  `added to backlog`; `+ Add task` opens popover from any screen, new task selected on Plan;
  Workflows/Repos at right; no repo tabs; header Refresh all first; chips only for repos used by a
  plan task; show/hide hides tasks with no visible branch; per-chip `↻`; autofetch default off;
  refresh summary text.
- **§4:** per-task day/order/merge order; first 10 incl. review items, days after hidden, both
  buttons' exact text; history button text; drag applies with no dialog; no split-across-days.
- **§4.1:** card geometry (10px radius, `#3a3e48`-equivalent token, 4px edge, review blue, parked
  dashed, 10px gap); 68px header, line 1 facts order, line 2 title two-line clamp + tooltip; stage
  progress segments (widths, colours), label forms, bar + percent, both tooltips; `!` circle only, its
  tooltip and click targets; branch row own progress forms (`n/m`, `· stuck`, `· failed`,
  `· waiting`, `↩ sent back`, `· fix 1`, `<stage> ✓`); branch row line 1 order and line 2 order,
  `▲` envs, stale amber.
- **§4.2:** task action first-match table incl. Archive only once workflow finished; branch tag
  first-match table incl. `⚙ preparing`, `✕ setup failed` + See error, `▶ Start` only on a branch
  that never had a session (`board/actions.ts` and the `ade-v2-*` unit specs covering it).
- **§5:** derived status rules and read-only panel text; user stage dialog text (Spec example
  shape); agent stage headless runs; Run dialog contents; Approve gate; stuck/failed → Take over;
  Take over everywhere it is listed; Release extras; per-repo run lines; send back template,
  `· fix N`, 3-round cap; script stages (variables, output inline red lines, Retry); default
  Release = script (samples).
- **§5.1/§5.1.1:** Workflows page list, editor fields, stage/step cards, `+ Add stage`/`+ Add step`,
  "changes apply from next stage/step" rule; Form | YAML, path, Copy YAML, Import YAML, `+ New`,
  validation messages (valid and both error shapes), last valid stays in use, folder watch; reader
  aliases `manual`/`automated`; panel Workflow select restarts at first stage, `Edit workflows ↗`.
- **§5.1.2:** `finish_step` tool and outcomes, auto suffix text (exact), editor note + hover text,
  suffix in the dialog message, `ended without finish_step`, timeout = failed, scripts by exit code.
- **§5.2:** each long-text rule on each surface it names (cards, panel headers, branch names, lists,
  stage labels ~150px).
- **§6:** merged/stale/not merged compute (incl. patch-id), after-rebase stale, recorded merge only
  on dialog finish (D14); row text abbreviations and tooltips; fix menu items and `Nothing to fix`;
  Details Merged into rows with Merge/Re-merge; merge dialog template (exact text, develop worktree
  path, `Also push develop` default off).
- **§6.1:** triggers (pipeline creation, Start, Take over, Add existing branch), gate, states, log,
  `⚙ preparing 3m 40s`, Details block, `Retry setup`, Needs you row.
- **§6.2:** env scripts on startup/Refresh/chip; deployed/stale/not deployed incl. env moved back;
  row `▲env` text and tooltips; Details Deployed to rows.
- **§6.3:** Folders (watch switch, imports every repo, `+ Add folder`), Repos rows, right-hand
  fields and help texts, repo pickers `nickname · full name`, `+ Add repo…` select (D15: same list
  as the Git module).
- **§7:** panel resizable default half; task header (mono line, phase action, Archive purple when
  merged); Sessions tab (badges, interactive first, headless status bar, read-only log, note,
  `Finished / stopped` + Take over, TUI input); Task tab fields (D10 read-only status, Jira per R4,
  GitHub row, Estimate extend-only); Workflow blocks per stage (D11); Branches list, `+ Add repo…`,
  `+ Add branch`; Notes tab full height; branch mode header, mono line, actions list, tabs.
- **§8:** New task (repo chips, at least one, `Add to Later`), Existing branch search across all repos
  newest first, review item for someone else's branch, `adding to: <task>`.
- **§9:** Start task/step templates, repo-named rebase/queue messages, worktree path rule
  `~/wt/<repo>/<last segment>`.
- **§10:** archive dialog template (every branch at risk), stops agents, deletes worktrees, history
  row text with repos.
- **§11:** kinds, tones, actions, ordering (accepted: SPEC2 rank), empty text, footer counts (D9: no
  CI count), All sessions toggle grouped by task, tab badge = item count.
- **§11.1:** layout + 520px panel, capture both ways, row contents and order, `→ Task`, panel fields,
  `→ Plan as task` carries title/Jira/GitHub/notes and opens the task, order persisted; task panel
  GitHub row.
- **§12:** every interface field maps to a wire field or a documented decision (P143 parity is the
  baseline; re-check only fields changed since).
- **§13:** each dropped item absent from the UI and backend (one row each: grep for the old label or
  control); ripple + `On merge` kept (and where they render).

**Design §9 (decisions to keep), re-checked for v2:** one row per rejected item, with the v2 check
or "superseded by SPEC2 §x" where SPEC2 changes it (tab bar replaces "no global top bar" only as
far as SPEC2 §3 says; dashed full-width Load buttons are SPEC2 §4). Include at least: no buttons in
boxes, no loose activity icons, no animated activity icons (`grep -rn "animate-\|@keyframes"` under
`frontend/src/ade`: empty at `B0`), no on-screen legends, no auto-generated branch names, agents
never push by default, no invented steps in messages, not always onto main, no Jira/PR tabs, no
per-agent names, no fixed-width panel, no fixed ruler, no global refresh in the tab bar, history
not always visible, no preset estimate chips, status before title in link rows, All sessions not
listing everything by default.

**Preplan §5 matrix:** confirm every row's owning phase actually landed it (a phase `## Result` or
notes deviation moving it counts only if the receiving phase then landed it — trace M1, U1 (a),
R-moves to their final home).

## 5. Sample workflows in the app

Live, in the §6.1 session. For each of `standard.yaml`, `bugfix.yaml`, `chore.yaml`:

1. Workflows page empty state → `Import YAML` with the sample's path (R25 path field).
2. Expect it in the list with its stage chain and `used by 0`; open YAML mode: `✓ valid · the form
   and the plan use this file`; Form shows every stage and step with the right kind, runs on,
   before, on failure, timeout.
3. Introduce one indentation error in YAML mode: red `✕ line N: …`; the plan still uses the last
   valid file; revert.
4. Create a task on each workflow: stage progress segments match the stage list.

Also copy one sample into `<home>/workflows/` from the shell: it appears without reload (watch).
A sample that fails any step is a finding (R1).

## 6. Screen-by-screen mockup comparison

### 6.1 Setup

- **Browser:** Playwright Chromium, viewport 1440x900, `deviceScaleFactor: 1`, dark scheme. Same
  viewport for mockup and app. Full-page and per-region screenshots into the scratchpad
  (`shots/p149/{m,a,k}-<screen>.png`: mockup, live app, mock-runtime app). Nothing committed.
- **Mockup:** open `docs/v2.0/design/ade-v2/mockup.html` from a local static server; route its
  external Vue/font requests to `node_modules` copies if offline (P145 B notes). Drive states by
  clicking its UI (views `plan`, `inbox` = Backlog, `needs`, `agents` = All sessions, `pipelines`
  = Workflows, `repos`; dialogs `run`, `stage`, `start`, `rebase`, `queue`, `merge`, `archive`).
- **Live app (server-tag recipe, `DEV_ENVIRONMENT.md`):** `bun run build:space`; `go build -tags
  server -o <scratch>/kira-space ./apps/kira-space`; temp `KIRA_SPACE_HOME`;
  `WAILS_SERVER_HOST=127.0.0.1`. Before first request seed `windows('main')` and `code_repos` rows;
  after start `SettingsService.Set {"git":{"gitPath":"<git>"}}`. No `Locate` patch needed (P148). If
  one becomes needed, it is never committed and is reverted before the session ends. Start, drive,
  and kill the server inside one shell invocation (background processes cannot be signalled from a
  later call). Kill leftover `claude` processes at the end.
- **Live data, shaped like the mockup:** scratch bare remotes plus clones `api` and `web-app`
  (nicknames set on the Repos page), `main` and `develop`, integration branch `develop` on
  `web-app`, environments `staging` and `prod` whose scripts `echo` a chosen sha (one containing a
  branch, one missing a commit → `▲staging ✓`, `▲prod ⚠`); a second author's branch for a review
  item; a folder import with watch on. Tasks: one two-repo task on `standard` (Spec done, Implement
  running), one bugfix task, one parked, one review item, one archived (history), more than 10 items
  for the cap, a backlog with three items, a scratch workflow `p149-smoke` (agent step using the
  `until [ -f flag ]` loop for a live run; a `needs_input` step for stuck; a script stage that fails
  once) — samples stay as imported in §5.
- **Mock runtime supplement:** `bun run build:test:space` + the UI suite's mock runtime on
  `tests/fixtures/ade-v2/board.json` (fixtures were transcribed from the mockup). Use it only for
  states live data cannot reach in the sandbox (e.g. todo `n/m` progress, which `claude -p` 2.1.289
  never reports), and mark those rows `k-` (mock).

### 6.2 Screens

Compare in this order; each screen gets one audit row with verdict and image names.

| # | Screen | States to capture |
|---|---|---|
| S1 | Plan | tab bar + badges, capture box, `+ Add task`; header Refresh all + chips (+ after-fetch text); ruler (today, weekend, day off, overflow); cards (header line 1/2, stage progress, `!`); branch rows line 1/2 incl. base marker, merged/deployed, own progress; left action column task + branch; `↓ Load all items · N more` / `Show only the first 10 again`; `↑ Load history` + history rows; ripple outline + `On merge` on selection; drag a card to another day (no dialog) |
| S2 | Task panel | header; Task tab (Name, Status read-only, Jira, GitHub, Estimate, Workflow blocks with per-repo step lines, Release block, Branches, `+ Add repo…`, `+ Add branch`); Notes tab full height |
| S3 | Sessions tab | task and branch scope; TUI tab with terminal; headless tab (status bar, read-only log, note, Take over, Stop R15); `Finished / stopped` list |
| S4 | Branch panel | `← task`, header, mono line, actions; Details (Branch, PR, Worktree setup preparing/failed + log, Merged into with Merge/Re-merge, Deployed to); Changes |
| S5 | Fix menu | right-click on a stale/behind/unpushed branch; empty `Nothing to fix` |
| S6 | Add popover | New task (repo chips, Add to Later); Existing branch (search, newest first); from `+ Add branch` (`adding to:`) |
| S7 | Backlog | list rows, inline edit, ↑/↓, `→ Task`, ✕, panel fields, `→ Plan as task` |
| S8 | Needs you | each kind live where reachable (stuck run, failed, approval, setup failed, stale merge, question), footer, empty state; All sessions toggle |
| S9 | Workflows | empty state; list; Form (user/agent/script stage cards, step cards, finish_step note + hover); YAML valid/invalid |
| S10 | Repos | Folders, Repos list, right-hand fields and help texts, environments rows |
| S11 | Dialogs | Run, `▶ <Stage>`, `▶ Start`, Rebase, Queue after, Merge (push switch on/off text), Archive (risk + Delete anyway), Force push confirm, Take over confirm (D3, app only), busy alert / Override |

Per screen check: layout and order, exact text, tones (green/amber/red/blue/grey, Claude orange),
sizes the SPEC2 names (card radius/edge/gap, 68px header, 520px backlog panel, ~150px stage label,
~110px base chip), truncation and tooltips with a long title and a long branch name (seed one of
each). Measure sizes with `getBoundingClientRect` in the script, not by eye.

### 6.3 Outcome per difference

`match` · `accepted (ref)` (§6.4 list, D/R) · `data` (fixture/live data differs, not UI) · `defect`
(fix per R1, recapture, record before/after names) · `new difference` (not a defect, not accepted:
list it in `## Result` for the user, no change).

### 6.4 Accepted deviations (closed input, R3; listed for the user in `## Result`)

- P144 A: owner `""` for own commits; workflow syntax errors without `✕` prefix in the wire
  (`line` field); `lastCommitAt` in ms; parked ↔ task kind sync; credential event re-keyed to
  `codeRepoId`; `layeringtest.RunAllowing` for `adewire`.
- P144 B: extra `board/branchGraph.ts`; Needs-you order by SPEC2 §11 rank (mockup orders by tone);
  `stuck` read from `Run.state` only; `✕ conflict` + Rebase from `conflictsIfRebased`, `checking…`,
  `conflict check failed`; `▲env ?` chip for `unknown`; rebase target `''` = branch base; task title
  rule (title, Jira key, PR title, branch, `New task`); `b_deps` `✓ clean` not `CI failing` (D9).
- P145 A: `gitrpc.Router.SetRepoSettings` fan-out; prepare timeout lives in `git_repo_settings`
  (old per-repo values not copied); deploy scripts at startup, on env change and each repo refresh,
  60s fixed timeout, failure = `unknown`; bridge size guards.
- P145 B: v1 helpers rewritten as v2 files; no pull-to-open history gesture (button only); Force
  push and day-off share `AdeConfirmDialog`; `adeBoardUi.historyReach`; `On merge` line in the Plan
  header (mockup: panel).
- P146 A: `quotePOSIX` leaves safe words unquoted; held-behind-failed-setup note
  `waiting for worktree setup`; todo progress null live (open question).
- P146 B: estimate extend-only, shrink refusal inline; Jira row key only (R4); Details lists every
  repo env and integration branch.
- P147 A: held fix runs lose `runOpts` across restart; v2 resume of a missing cwd = `ErrInvalidInput`
  (no recreation); `LaunchStage` read-only root lines for unborn/non-mine branches.
- P147 B: R22-R26 (no "create a branch" lines, suffix read-only, Import as a path field,
  `Allowed tools` single-line field); step and header `Retry` call `RetryRun`; Copy YAML asserted by
  label.
- P148 A: helpers moved (`gitfacts.go`, `adetask_validate.go`); `Tracker.List`/`Recover` removed.
- P148 B: R15 `Stop` on the headless status bar; R20 shared context-menu primitive; real xterm in
  the TUI pane; Take over confirm (D3); app fonts; All sessions `Running` / `Stopped` (R19); single
  headless-busy alert instead of the busy list; `took 1m 12s` placement; archive flow in
  `dialog/flow.ts`; Run dialog keeps `{repo}`/`{branch}`/`{worktree}` for a `once` step.

## 7. Unobserved items (real `claude` 2.1.289, live session)

Use the §6.1 server. The xterm is driven with Playwright keyboard input; read its text through the
xterm buffer (`term.buffer.active`) or screenshot. Record command, observation and evidence (DB row,
event, screenshot) in `P149-audit.md` §Unobserved.

1. **TUI first-run.** `▶ Spec` (or `▶ Start`) on a fresh worktree path. Capture what `claude` shows
   first (folder trust prompt, theme/onboarding, or none) and whether the initial message (argv
   after ` -- `, P147) is processed after the user accepts. If the message is lost, that is a
   defect: fix per R1 (e.g. pre-trust) or a new row.
2. **`▶ Start` click.** On a branch row of a created branch that never had a session: click
   `▶ Start`, check dialog text (§9 Start step template), Send → `StartBranch` → TUI tab selected in
   Sessions; second click is refused while the session runs (`a session is already open on …`).
3. **`Stop` hook ends a turn → `RecordMerge`.** Integration branch `develop` on a scratch repo;
   right-click → `Merge into develop` → dialog → new session. Answer any permission prompt in the
   xterm. When the turn ends, expect the agenthooks `Stop` event to reach `adeTurns`, the
   `merge:<branch>:develop` pending key to clear and `ade_branch_marks` to hold `recorded = 1` for
   that branch and target; branch row shows `dev ✓`. Also run the send-then-archive path once
   (archive with a dirty worktree → `Send to Claude, then archive`): task archives after the turn.
   If hooks never fire, find out why (hook server running, env reaching the PTY, Claude settings
   source) before calling it unobservable.
4. **Todo progress in `-p`.** One headless probe: `claude -p --output-format stream-json --verbose`
   with a prompt asking it to keep a todo list; list the tools offered in the `init` event. If no
   todo tool exists (as in P146-P148), keep the Known open item and list the question for the user
   again in `## Result`. If one appears, run a smoke step and confirm `todo` fills on the run row.

## 8. Docs

### 8.1 `docs/ARCHITECTURE.md` ADE section (R6, R7)

Write `## ADE: Kira Space task planner (v2.0)` with these subsections (terse, facts only, each claim
checked against code):

1. **Model and scope** — tasks own branches across repos; workflows of user/agent/script stages;
   runs per step per branch; derived status (D10); no data from v1 (D5).
2. **Process wiring** — `wireAdeTask`, `TaskBoard` deps, `Recover` before `Start`, push channels,
   `AdeTaskService` (47 methods), `adewire` frozen contract + fixture decode test, `layeringtest`
   allowance.
3. **Storage** — migrations `0008`-`0011` and what each holds; logs in `ade_logs`/`ade_log_chunks`
   (2 MiB tail, 8 KiB chunks, 250 ms batches); `ade_sessions` v2-only.
4. **Git facts** — board `Conn` `ade-board`, per-repo facts and caches, conflict pairs, rebase-conflict
   check, integration and deploy facts, refresh and autofetch, force push lease, askpass routing.
   **go-git note:** SPEC2 §6/§6.2 and design §3.1 ask for a native Go git library; declined (D1):
   go-git v5 `Merge` is fast-forward only, so it cannot answer "does A conflict with B".
   `git merge-tree --write-tree` (git >= 2.38, enforced by `gitclient.Discovery`; older git reports
   `failed`) touches no worktree, index, HEAD or ref, so it is safe beside running agents;
   `--is-ancestor`, `git cherry` and `patch-id --stable` cover merged/stale/deployed. `go.mod` has no
   go-git.
5. **Workflows** — YAML folder, reader, validation rules, aliases, `allowed_tools`, last-valid rule,
   `fsnotify` watch, no seeds (D2), writer keeps order/comments.
6. **Run engine** — headless argv, setting sources, `finish_step` MCP server and token, step machine,
   gates, retry, send-back rounds, `once` placement (D12), script stages, timeouts, stop causes,
   restart recovery (D7), no concurrency cap (D8).
7. **Interactive sessions** — `Tracker` (`Prepare`/`Compose`/`Reconcile`/`HandleEvent`/`Send`),
   grace window, window-scoped PTYs, `TakeOver`, `LaunchStage`, `StartBranch`, argv ` -- ` rule,
   resume cwd rules, `FocusSession` cross-window open.
8. **Worktree setup** — creation triggers, prepare script and per-repo timeout, states, gate.
9. **Frontend** — `ade/v2` layout, pure `board/` logic, Pinia stores (one concern each), TanStack
   queries and push signals, dialogs (`dialog/flow.ts`, `turnWatch.ts`, `adeDialogs`), Plan DnD,
   panel resize, notes editor, colour gate.
10. **Tests** — Go packages, `ade-v2-*` unit and UI specs, mock runtime, fixtures, what live smoke
    covered and what stays unobserved.

Then delete the v1 prose blocks and the P145-P148 bullet blocks named in §0, the P144
`rebaseChecker` line (folded into 4), and fix every cross-reference (`Kira Space's \`ade\` module`
pointers in UI architecture, the module-system paragraph, the `TerminalService` mention). Check:
`grep -nE "AdeService|useQueue|AdeRepoView|AdeRepoTabs|AdeAllAgents|agent merge queue|queue\.go|ade_new_work|work_type" docs/ARCHITECTURE.md`
returns only the one R6 history sentence.

### 8.2 Known open items

Re-verify each ADE-related entry against code (codegraph) and §7 results; keep only genuinely open
ones, reworded in v2 terms; delete resolved ones. Starting classification:

| Entry | Expected outcome |
|---|---|
| Todo progress unobservable in `-p` | keep unless §7.4 finds a todo tool |
| Held fix runs lose resume spec | keep; needs a run-row column (migration) → new row per R1 |
| Interactive `claude --resume` TUI unobservable | P148 saw a resumed TUI tab live; narrow to whatever §7.1 still cannot observe, or delete |
| Backgrounded `Bash` cannot arm `waiting` | keep (agent-hooks rule, not ADE-specific); drop the P129 framing only |
| Conflict pairs drop rename/delete conflicts | verify v2 `pairFacts` still filters by `shared`; keep with v2 names or delete |
| Linked worktree dirty state not watched | verify v2 read points (board load, Refresh, `ArchiveRisk`); keep reworded |
| Pending send-then-archive lives in the renderer | verify `adeDialogs`; keep reworded unless §7.3 changes it |
| No light theme; ade tones dark-only | keep; point at `ade/v2/tones.ts` and `palette.ts`, not `useQueue.ts` |

Every new open limitation P149 finds and does not fix gets an entry only if it is a real, current
limitation; a follow-up row in `SPEC.md` does not replace it when users can hit it.

### 8.3 `SPEC.md`

- Append each new follow-up row (`P155`…) per R1, with "Added at end by P149; no other phase
  renumbered."
- P149 row: status `Done (see P149 result)`, plan link.
- `## P149 result` (same shape as P148's): commits, counts, suites, audit summary (counts per
  verdict, link to `plans/P149-audit.md`), mockup verdict, unobserved items outcome, accepted
  deviations for the user (§6.4 summary plus any `new difference`), open questions for the user,
  carry-forward.

### 8.4 `DEV_ENVIRONMENT.md`

Only if §6-§7 find a new environment fact (e.g. how to clear `claude`'s first-run prompt in the
sandbox). Keep it to the server-tag recipe section.

## 9. End checks (on the final tip)

- Every §3 command again; same or better than baseline. Any remaining red is either fixed or a named
  row (R4); no `--no-verify` commit on the branch.
- `go test -race` as §3.
- `grep -rn AdeService --include=*.go --include=*.ts --include=*.vue .` (excluding `node_modules`):
  empty. `grep -c AdeService docs/ARCHITECTURE.md`: 0. §8.1 grep: only the history sentence.
- `go.mod`, `go.sum`, `package.json`, `bun.lock`: unchanged vs `B0` unless a fix needed a
  dependency (R1 forbids; would be a row instead).
- `P149-audit.md`: no row without a verdict; no `gap` without a commit or row.
- Every `P15x` row the result names exists in `SPEC.md`; table position equals number.

## 10. Commits (Conventional Commits, trailers per session)

1. `docs(v2.0): P149 baseline suites` — `P149-audit.md` §Suites.
2. `docs(v2.0): P149 SPEC2 and design audit` — §Audit rows.
3. `docs(v2.0): P149 sample workflows and mockup comparison` — §Samples, §Mockup.
4. `docs(v2.0): P149 unobserved items` — §Unobserved.
5. `fix(kira-space): …` / `test(kira-space): …` — one per logical group of findings (same file,
   module or root cause), each updating the matching audit rows.
6. `docs: ADE architecture rewrite` — §8.1.
7. `docs: ADE known open items` — §8.2.
8. `docs(v2.0): P149 follow-up rows and result` — §8.3, this plan's `## Result`.

Commit 1-4 land before any fix from that step. A step with no finding still commits its rows.

## Result

(Filled by the implementer: commits, counts, suites before/after, audit verdict counts, mockup
verdict per screen, unobserved items, accepted deviations, new rows, `codegraph_explore` call
count.)
