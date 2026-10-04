# P143-P149 preplan: `ade` v2 (task planner)

Phasing plan only, not an implementation plan. Every phase below still gets its own Opus plan
under `plans/` before implementation (`CLAUDE.md` loop). That plan restates and may tighten the
stream split proposed here; it must not loosen it. **Status: proposed, pending user approval.
User decisions on the former open questions recorded in §6.**

## 0. Inputs and base

- Base commit `dd61fc8` (branch `v2.0`). Inputs: `docs/v2.0/design/ade-v2/SPEC2.md` (delta on
  `docs/v2.0/design/SPEC.md`), `design/ade-v2/mockup.html` (views: `plan`, `inbox` = Backlog,
  `needs`, `agents` = All sessions, `pipelines` = Workflows, `repos`), `design/ade-v2/workflows/
  {standard,bugfix,chore}.yaml`.
- Highest `P` across every `docs/*/SPEC.md`: `P142`. New phases: `P143`-`P149`.
- SPEC2 § refs below are SPEC2's own; "design §" means the v1 `design/SPEC.md`.

## 1. Audit: current tree vs SPEC2

Kira Space `ade` today (P129 Parts 1-7, P135-P140) is per-repo branch planning.

| Area | Today | SPEC2 effect |
|---|---|---|
| Agent runtime | `internal/ade/tracker.go` (`Tracker.Prepare/Compose/Reconcile/HandleEvent/Send`), `command.go` (`claude --session-id`, `claude --resume`), interactive PTY only via `terminal.Registry`; hook activity via `internal/agenthooks` (`Manager.ComposeLaunch`) | **Extend.** TUI launch kept for user stages, Start, Take over. New: headless `claude -p --output-format stream-json` runner (no PTY), per-run session ids, `claude -p --resume` for send-back, TUI `--resume` of a headless id |
| Sessions store | `storage/repos/adesessions.go`, table `ade_sessions` (0004), keyed by `code_repo_id` + `branch`/`new_work_id` | **Extend.** Add `mode` (`tui`/`headless`), `task_id`, `step_id`, `branch_id`, `resumes`. Existing v1 rows stay unread |
| Queue / git facts | `internal/ade/queue.go` (`Queue.snapshotLocked`, `Refresh`, `ForcePush`, `Archive`, `ArchiveRisk`, `reconcileNewWork`), `facts.go` (`pairFacts` via `git merge-tree --write-tree`, `atRisk`), LRU caches (`hashicorp/golang-lru`) | **Reuse per repo**, re-keyed from per-repo items to task branches. New facts: integration merged/stale, deployments, base marker inputs, rebase-conflict check (D1). v1-only parts (new-work rebind heuristics, per-repo plan, dependencies, work types) go |
| Queue store | `storage/repos/adequeue.go`, tables `ade_branches`, `ade_new_work`, `ade_plan`, `ade_colors` (0005), `ade_dependencies`/`ade_blockers` (0006), `work_type` (0007) | **Replace.** New task model (§12). No data migration: v1 tables dropped, app starts empty (D5) |
| Bridge | `internal/bridge/ade.go` (`AdeService`, ~1500 lines, 19+ bound methods), TS `frontend/src/bridge/index.ts` + `ade/wire.ts`; bindings generated, not tracked | **Replace** with a new task-based surface; v1 methods removed last (P148) |
| Prepare script | `internal/gitprepare` (fixed `PrepareTimeout` 15m), per-repo leaf `GitRepoSettings.WorktreePrepareScript`, run from `gitsession/worktree.go` for git-ui's worktree add | **Extend.** Per-repo timeout (§6.3), state/log persisted per worktree, gate agent starts (§6.1) |
| Repos | `code_repos` (`name`, `root`, `repo_id`, `sort_order`), `CodeReposRepo`, `bridge/codeworkspace.go` (`ImportRepo`, `RenameRepo`, `ReorderRepos`, `RemoveRepo`); shared with the Git module | **Extend.** Nickname, folders + watch, integration branches, environments, prepare timeout |
| MCP | `apps/kira-studio/internal/dbmcp` (HTTP MCP on `modelcontextprotocol/go-sdk`, `internal/mcpauth` tokens) — Studio only | **New in Space:** `finish_step` MCP server, same SDK, same auth pattern |
| YAML | `go.yaml.in/yaml/v3` indirect only; no YAML in Space | **New:** workflow files in a `workflows/` subfolder of the app home folder, no seeded defaults (D2), folder watch via `fsnotify` (already direct) |
| Frontend | `frontend/src/ade/*` (35 `.vue`, 30 `.ts`): `AdeView` -> `AdeRepoTabs` + `AdeRepoView` / `AdeAllAgentsView`; `useQueue.ts` (2400 lines, pure); TanStack `queries.ts`/`mutations.ts`; Pinia `adeUi`, `adeActions`, `adeDrag`, `adeTerminals`, `agentSessions`; `AdeClaudeDialog` + `dialogCompose.ts`/`dialogFlow.ts`; TipTap notes; xterm via terminal module | **Replace** views and `useQueue`; **reuse** Claude dialog machinery (busy check, override, editable message, Reset, push switch), notes editor, estimate field, activity icons, terminals, tab strip, panel resize, day controls |
| Tests | `tests/unit/ade-*.spec.ts` (queue parity/rules, dialog rules), `tests/ui/ade-*.spec.ts` (mock control runtime `tests/ui/support/mockRuntime`) | v1 specs deleted with v1 code; v2 specs written against the mock runtime |

Design §3.1 / SPEC2 §6, §6.2 "native Go git": previously declined app-wide (`docs/ARCHITECTURE.md`
~line 2240: go-git v5 `Merge` is fast-forward only; `git merge-tree --write-tree` used, no worktree
touched). **D1 satisfies SPEC2 this way:** `git` CLI through `gitclient` for every operation
(`--is-ancestor`, `git cherry`/`patch-id --stable`, fetch, push, worktree, rebase); go-git
(`github.com/go-git/go-git/v5`, Apache-2.0, actively maintained v5 line, v5.19.2 in the module cache,
not yet in `go.mod`) only for the plain merge-conflict check. After every refresh, every visible
branch is checked for conflicts if rebased onto the latest base; results feed the existing conflict
tags. go-git v5 has no three-way merge, so that check is built on its object plumbing (merge-base,
tree walk, per-path three-way compare); the P144 plan verifies it against `merge-tree` results
(§6 open item O1).

**Migration need:** one Space migration (`0008`) adds task tables, extends `ade_sessions`, adds repo
config tables. No v1 row migration (D5). A later migration (P148) drops v1 tables once nothing
reads them; v1 UI is gone from P145, so v1 rows are unreachable from then.

## 2. Phase list and waves

Waves follow `CLAUDE.md`'s streams rule: one `P` per wave, two named streams in separate worktrees
off one base, zero file overlap, no ordering dependency inside the wave. **Pipelining makes that
honest:** Stream B (frontend) in wave N consumes only bridge methods that landed in wave N-1 or
earlier; Stream A (backend) owns all IPC glue. No stubbed method ever exists.

| Phase | Mode | Stream A (backend) | Stream B (frontend) | Size |
|---|---|---|---|---|
| P143 | serial | Contract freeze: wire types (Go + TS), IPC method/channel names, fixtures | — | M |
| P144 | wave 1 | Task store, migration, workflow reader, board snapshot, CRUD surface | Pure board logic on fixtures | A L · B L |
| P145 | wave 2 | Workflow editing + watch, repos config, folders, integration + deploy facts | New shell, Plan timeline, task cards, Add, ported git dialogs; v1 frontend removed | A L · B XL |
| P146 | wave 3 | Worktree setup gate + headless run engine + `finish_step` MCP + script stages | Panel (task + branch), Backlog page, merged/deployed UI, fix menu, merge dialog | A XL · B L |
| P147 | wave 4 | Send-back, Take over, interactive stage launch, single-branch Start, task archive, restart recovery | Workflows page, Repos page, run UI (progress, steps per repo, Run dialog, Approve/Retry/Done), setup UI | A L · B XL |
| P148 | wave 5 | v1 backend removal, drop v1 tables | Sessions tab + Take over, `▶ <Stage>`, `▶ Start`, task Archive dialog, Needs you + All sessions, History per task | A M · B L |
| P149 | serial | Closing: full UI + Go suites, live run vs mockup, `ARCHITECTURE.md`, open items | — | M |

Sizes: S < 300 changed lines, M 300-1000, L 1000-2500, XL > 2500. Any planner may split an
XL stream into `Part 1`/`Part 2` of the same `P` (agent split rule), still two streams per part.

## 3. Cross-wave rules (every wave plan restates them)

1. **Contract is frozen at P143.** A stream needing a wire change stops; orchestrator lands a
   serial amendment commit on `v2.0` (both sides + fixtures), both streams rebase, then resume.
2. **Stream A owns IPC glue**: `apps/kira-space/internal/**`, `apps/kira-space/main.go`, `go.mod`/
   `go.sum`, `frontend/src/bridge/index.ts`, `frontend/src/ade/v2/wire.ts`. B reads them, never
   writes.
3. **Stream B owns** `frontend/src/ade/**` except `ade/v2/wire.ts`, `frontend/src/state/**` touches
   it needs (none planned; `UiState2` lives in Pinia, not settings), `packages/theme/src/components/
   ui/**` additions (shadcn-vue `add`), `scripts/check-ade-colours.sh`, `apps/kira-space/tests/ui/**`,
   `apps/kira-space/tests/unit/ade-*`, `apps/kira-space/tests/visual/**`.
4. **Fixtures** `apps/kira-space/tests/fixtures/ade-v2/*.json` frozen at P143; changed only through
   rule 1. A's Go decode test and B's typed fixture imports both read them.
5. **v2 code imports only `ade/v2/wire.ts`**, never v1 `ade/wire.ts` (so P148 A can delete it).
6. **Docs are serial**: `docs/v2.0/SPEC.md` result sections and `docs/ARCHITECTURE.md` are written
   by one post-landing subagent after both streams rebase, never by a stream.
7. Generated bindings (`frontend/bindings/`, untracked) regenerate in each worktree's build; no
   ownership needed.
8. Landing per wave: both streams verified independently, rebase onto `v2.0` in any order, remove
   worktrees, run the wave's expensive suite once on the landed tip, fix in follow-up commits.

## 4. Phases

### P143 ADE v2 contract freeze (serial)

- **Scope.** Wire contract for the whole v2 surface, frozen: Go wire structs (`bridge/adev2_wire.go`)
  and TS mirror (`frontend/src/ade/v2/wire.ts`) for SPEC2 §12 (`Task`, `Branch`, `Run`, `Session`,
  `Workflow`, `Stage`, `PipelineStep`, `Plan`, `BacklogItem`, `Repo`, `Folder`, `WorktreeSetup`,
  `Deployment`, integration status, `AdeSettings`, run log chunk) plus result/args/event shapes. Workflow
  `PipelineStep` carries `allowed_tools` (D6); `Branch` carries `conflictsIfRebased` (D1); `Task.status`
  is derived, read-only (D10); no dependency nodes, work types or top-5 field (D16). Method and push-channel list for
  P144-P148 written into the P143 plan (name, args, result, owning wave). Fixtures transcribed from
  `mockup.html` mock data. Go test decoding every fixture with `DisallowUnknownFields` into the Go
  wire types (the one mechanism keeping two languages' contract identical across streams; earns
  the test bar).
- **Deps.** None. **Files.** The two wire files, fixtures dir, one Go test. **SPEC2:** §2, §12
  (shape only). **Libraries:** none new.
- **Accept.** `bun run lint`, `bun run typecheck`, `go build ./...`, `go test ./apps/kira-space/
  internal/bridge/...`, `bun run lint:go`. Fixture count matches the plan's own list.

### P144 wave 1: task store ‖ board logic

**Stream A — task store, workflow reader, snapshot, CRUD.**
- Migration `0008` (no v1 data migration, D5): `ade_tasks`, `ade_task_branches`, `ade_runs`, `ade_task_plan` (day/order/
  queuedAfter/unpushed), `ade_backlog`, `ade_task_colors`, repo config (`ade_repo_config`:
  nickname, integration branches, prepare timeout; `ade_repo_envs`; `ade_folders`), `ade_worktree_setup`,
  `ade_sessions` new columns. Models + `storage/repos/adetask*.go`. Repo config reads/writes the shared
  `code_repos` list (D15), no parallel repo table.
- Workflow reader: `internal/adeflow` parses/validates YAML (`go.yaml.in/yaml/v3`, promoted to
  direct; MIT/Apache-2.0; plus go-git v5 for D1), line-numbered errors, `manual`/`automated` aliases, `back:<step>` (must name an earlier step of the same stage; script stages take none; stage and step
  ids are separate namespaces, D13), `allowed_tools` (D6) and `only <repo>` validation, durations.
  Workflows dir: `workflows/` under the app home folder; nothing seeded or embedded (D2). Missing or
  empty dir is a valid empty list. Read-only this wave.
- Board snapshot: tasks + branches with per-repo git facts by reusing `Queue`'s fact code
  (ahead/behind, files, commits, dirty, pairs, merged, worktree) keyed by task branch; after every
  refresh, a go-git rebase-conflict check of every visible branch against the latest base (D1); base marker
  inputs (base branch, base owner/task). Refresh per repo + Refresh all (repos used by tasks only).
- Bound methods: task CRUD (add new task with repos, rename, Jira key/url and GitHub link stored and displayed only, no sync (D9), estimate
  (extend-only, D16), notes, color), add existing branch (new task or attach; review item), plan set (day/order, drag
  semantics, queued after), backlog CRUD/reorder/promote-to-task, workflow list/get, repos list
  (nickname), snapshot, refresh, force push, push channel `ade:board`.
- **SPEC2:** §2 (model, base marker data, cross-task relationships), §3 (refresh semantics, repo
  chips data), §4 (per-task plan data), §5.1.1 (schema, reader, aliases, defaults), §8 (backend),
  §11.1 (storage), §12.

**Stream B — pure board logic** (`frontend/src/ade/v2/board/*.ts`, pure, fixture-driven):
- Port of `useQueue` to tasks: per-task day/order/span, merge order (merge day, start day,
  position), capacity/overflow, overdue, weekends/days off, Later, first-10 cap with load-all and show-first-10-again (D4),
  history list, ripple + "On merge" (§13 says keep), review item placement above dependents/conflicts,
  parked.
- Stage progress model (segments, current label, percent: done runs 1, running by todo fraction,
  averaged over repos), per-branch progress line, derived task status (§5, read-only, D10), task action first-match
  (§4.2), branch tag/action first-match (§4.2 incl. `⚙ preparing`, `✕ setup failed`), base marker
  text, merged/deployed short labels (`dev`/`stg`/`rel`, `▲env`), Needs-you item derivation and
  ordering (§11), long-text helpers (§5.2 rules that are logic, not CSS).
- Unit tests only for the hard parts: merge order/spans/capacity, progress averaging, the two
  first-match decision tables, Needs-you ordering.
- **SPEC2:** §4 (logic), §4.1 (progress logic), §4.2 (rules), §5 (status), §11 (derivation).

**Ownership (zero overlap).**

| Path | A | B |
|---|---|---|
| `apps/kira-space/internal/**`, `main.go`, `go.mod`, `go.sum` | ✓ | |
| `apps/kira-space/internal/storage/migrations/0008_*.sql` | ✓ | |
| `frontend/src/bridge/index.ts`, `frontend/src/ade/v2/wire.ts` | ✓ | |
| `frontend/src/ade/v2/board/**` | | ✓ |
| `apps/kira-space/tests/unit/ade-v2-*.spec.ts` | | ✓ |

**No ordering dependency:** B imports only P143 types/fixtures; A adds no file B reads besides the
frozen `wire.ts`.
**Accept.** Per commit: lint, typecheck, `go build`, `go vet`. End of stream A: `go test ./apps/
kira-space/...`, `bun run lint:go`, migration up on a copy of a real v1 DB. End of stream B:
`bun run test:unit`. Wave end: both suites on the landed tip.

### P145 wave 2: config + facts ‖ shell + timeline

**Stream A.** Workflow write (form edits rewrite the file through `yaml.Node`, keeping order/
comments), import, copy, new (the `workflows/` dir is created on first write); `fsnotify` watch of the workflows dir; last-valid-version rule;
validation result method (`✓ valid` / `✕ line N: …`). "Changes apply from next stage/step on":
snapshot current stage per task. Repos: nickname, folders add/remove/watch (`fsnotify`, BSD-3)
importing every git repo found, add single repo, integration branches, environments with
deployed-SHA scripts (run via existing `gitprepare` shell plumbing), prepare script + timeout
(lift `PrepareTimeout` to a per-repo value). Integration facts: merged / stale / not merged per
branch × target from git facts (`--is-ancestor`, then patch-id set via `git cherry`), `intoNote`;
a merge is recorded by the app only when its own merge dialog finishes (D14); rebase marks merged
targets stale. Deployment facts: run env scripts on startup/Refresh/chip,
deployed / stale / not deployed, missing count, env-moved-back detection (last seen SHA stored).
Refresh result summary (`3 refs changed · 1 merged into develop`). Fix-menu data (per-branch
available fixes).
**SPEC2:** §5.1 (backend), §5.1.1 (write, watch, import), §6 (compute, after-rebase, recorded
merge on dialog finish), §6.2 (compute), §6.3 (backend), §3 (fetch summary).

**Stream B.** Replace `AdeView` root: tab bar (`Backlog` grey badge · `Needs you` amber badge ·
`Plan`; right: capture box, `+ Add task`, `Workflows`, `Repos`), capture box (Enter adds to top,
`added to backlog`), plan header (Refresh all first, repo chips with show/hide and per-repo `↻`),
timeline per task (§4: 10-item cap + `↓ Load all items · N more` / `Show only the first 10 again`,
`↑ Load history` button, drag with no dialog via `vue-draggable-plus`), task card (§4.1 card
geometry, header line 1 facts + stage progress + `!`, line 2 title 2-line clamp), branch rows
(line 1 repo · base marker · `!` · owner · name; quiet line 2 context only this wave), left action
column (task stage action rendered from B's P144 rules; git tags/actions). Add popover (§8: New task
with repo chips → Add to Later, select new task, switch to Plan; Existing branch across all repos).
Port Claude dialog for Rebase / Queue after / Force push with repo-named templates (§9). Delete v1
frontend files and v1 unit/UI specs no longer reachable. Tab bar entries `Backlog`, `Workflows`,
`Repos`, `Needs you` land with their pages (P146/P147/P148), never as placeholders.
**Libraries:** shadcn-vue (Tabs, Popover, Tooltip, Badge, ContextMenu), Tailwind utilities only,
VueUse (`onKeyStroke`, `useElementSize`), Pinia (`adeBoardUi` store: selection, show/hide repos,
`showAllItems`, `showHistory`), TanStack Query over P144 methods, `vue-draggable-plus` (MIT).
**SPEC2:** §3, §4, §4.1 (except live run progress), §4.2 (git column), §5.2, §8, §9 (rebase/queue
templates), §13 (drops applied in UI).

**Ownership.** A: as P144 A. B: `frontend/src/ade/**` except `ade/v2/wire.ts`; `packages/theme/src/
components/ui/**` (new shadcn primitives only); `scripts/check-ade-colours.sh`; `apps/kira-space/
tests/{ui,unit,visual}/**` ade files. **No ordering dependency:** B consumes P144 methods only;
A's new methods are unused by B until P146/P147.
**Accept.** Per commit fast checks. Stream B end: `bun run test:ui:space` (ade v2 specs on mock
runtime), visual baselines updated. Stream A end: `go test`, golangci-lint, a real repo with
`develop` + squash-merge fixture for patch-id cases (integration-shaped Go test is justified:
merged/stale/patch-id rules interact). Wave end: both suites + live `bun run dev:space` smoke.

### P146 wave 3: run engine ‖ panel + facts UI

**Stream A.** Worktree creation for task branches (new branch from base, `~/wt/<repo>/<last
segment>` per §9, reuse `gitsession` worktree add), prepare script run with per-repo timeout,
states `preparing`/`ready`/`failed` + full log persisted, Retry setup, gate (no step/Start/Take
over until ready). Headless runner: spawn `claude -p --output-format stream-json --session-id
<uuid> --mcp-config <app server>` (permissions per D6: no default mode set by the app; `--allowedTools` from the step's
`allowed_tools`; deny rules still win; `--setting-sources` per the app setting) in the branch worktree, stream-json
line parser (TodoWrite → `todo [n,m]`, log events), timeout kill (`procgroup`), exit without
`finish_step` → `failed: ended without finish_step`. `finish_step(status, summary)` MCP tool on
an app-local HTTP MCP server (`modelcontextprotocol/go-sdk`, MIT→Apache-2.0 transition, both
fully open; auth via a per-run token on the `internal/mcpauth` pattern). Mandatory prompt suffix
appended server-side. Step machine: `once`/`each repo`/`only <repo>` fan-out, gates `auto`/
`approval`, `stop`/`retry 1`/`retry 2`, worst-of-runs step state, stage advance, user stage Done/
Finish, Approve, Retry. Script stages: variables `{task} {jira} {repo} {branch} {worktree}`,
multi-line command, timeout, exit code, full output. Run log persisted per run (bounded; plan sets cap) and readable live without Take over (D3). App setting
`AdeSettings.headlessSettingSources`: ignore repo-committed settings via `--setting-sources user`.
Installed `claude --help` lists `--allowedTools` and `--setting-sources <user,project,local>`; the P146
plan re-verifies both against the installed CLI, confirms `-p` denies un-allowed tools, and picks the
default. `runs_on: once` runs in the first branch's worktree in task order, created first if missing
(D12). No concurrency cap, queue or setting (D8). Script stages never send back (D13).
Push channel for run progress. Unit tests: step state aggregation, gate/retry transitions, stream-
json todo extraction.
**SPEC2:** §2 (Run, Step, Session headless), §5 (agent stages, per-repo runs, script stages,
release script), §5.1.2, §6.1 (backend).

**Stream B.** Panel (resizable, default half; reuse `AdePanelResizeHandle`): task mode header
(color · status chip · 2-line title; mono line; actions), tabs `Task` · `Notes` (`Sessions N`
lands whole in P148), Task tab (Name, Status read-only and derived (D10), Jira key/url display only, GitHub row, Estimate, Branches list +
`+ Add repo…` select + `+ Add branch`), Notes tab (TipTap, full height). Branch mode (`← task`,
header, mono line, actions, Details: Branch + PR rows, Merged into rows with Merge/Re-merge,
Deployed to rows; Changes tab reused). Branch row line 2 merged/deployed text with stale amber and
tooltips. Right-click fix menu (shadcn ContextMenu). Merge dialog (Claude dialog, `Also push
develop` default off, develop worktree template). Refresh chip summary. Backlog page (§11.1: list +
520px panel, capture input, ↑/↓, `→ Task`, ✕, inline edit, Jira/GitHub/Notes fields, `→ Plan as
task` opening the new task).
**SPEC2:** §6 (display, menu, panel, merge dialog), §6.2 (display), §7 (panel except Workflow block
and Sessions), §11.1, §3 (fetch summary display).

**Ownership.** Same split as P145. **No ordering dependency:** B consumes P144/P145 methods; A's
run methods unused by B until P147.
**Accept.** Stream A end: `go test` incl. a fake `claude` script (stream-json fixture, finish_step
call over MCP) — existing `TrackerDeps.ClaudeBin` precedent; real `claude -p` smoke once if
available in env. Stream B end: `test:ui:space`. Wave end: both + live smoke.

### P147 wave 4: interactive + archive ‖ workflow and run UI

**Stream A.** Send-back: on `back:<step>` failure, resume the earlier step's session on that
branch (`claude -p --resume <id>`) with failure output appended (template from §5), `↩ sent back`,
`· fix N`, note, chain continues, max 3 rounds then `failed`. Take over: TUI session resuming a
headless id through `Tracker.Prepare` (resume of a headless record, `resumes` link, same worktree),
from running or finished runs; stops the headless process first if running; B's confirm dialog says the run must be stopped first (D3). Interactive user
stage launch with the stage prompt + task context (§5 example; read-only main checkouts when no
worktree). Single-branch Start / Start step (§9). Archive per task: risk over every branch, stop
all headless + TUI sessions, delete all worktrees, history by task. Restart recovery: runs left
`running` by a previous process become `stuck`, note `interrupted by restart`; no auto-resume; user acts
manually with Take over / Retry / Run (D7). Workflow switch restarts at first stage.
**SPEC2:** §5 (Take over, Release extras data, send back, workflow switch), §9, §10 (backend).

**Stream B.** Workflows page (§5.1/§5.1.1 UI: empty state with `Import YAML` / `+ New` when the dir holds no workflow (D2); list with stages, `used by N`, `+ New`, `Import
YAML`; editor Form | YAML switch, path, Copy YAML; stage cards with type badge/select/status
select/↑↓✕; script/user/agent fields; nested step cards; `+ finish_step instruction…` note with
hover text; YAML mode mono textarea with live validation message). Repos page (§6.3). Run UI:
live stage progress + percent on cards, per-branch progress line 2, task action column live
states (`▶ Run`, `Approve`, `Take over` (link only until P148), `Retry`, `Done ›`, `Finish ✓`,
`✓ merged` + Archive gating), panel Workflow block (select + `Edit workflows ↗`, one block per
stage, agent steps with one line per repo: glyph · repo · mini bar · `4/10` · Log (read-only live log, D3)/Output/Retry ·
note), Run dialog (branch name per repo, editable message with step prompt + finish_step text),
Release block (`main ✓/—` + merged-into chips). Worktree setup UI (`⚙ preparing 3m 40s`,
`✕ setup failed` + See error, Details → Worktree setup with log, Retry setup).
**Libraries:** shadcn-vue (Switch, Select, Textarea, Card), VueUse (`useClipboard`,
`useDebounceFn` for YAML validate), TanStack Query mutations. YAML parsing stays server-side (one
validator; no JS YAML lib).
**SPEC2:** §4.1 (live progress), §4.2 (stage actions), §5 (UI of stages/runs), §5.1, §5.1.1 (UI),
§5.1.2 (editor note, dialog text), §6.1 (UI), §6.3 (UI), §7 (Workflow block, Release).

**Ownership.** Same split. **No ordering dependency:** B consumes P144-P146 methods; A's new
methods unused by B until P148.
**Accept.** Stream A end: `go test` (fake claude: needs_input → stuck, failed → back:impl round
trip, 3-round cap). B end: `test:ui:space`. Wave end: live run of a workflow (the zip samples
under `design/ade-v2/workflows/`, imported by hand, never shipped) on a scratch two-repo task with real `claude` if available (flags per D6).

### P148 wave 5: v1 backend removal ‖ sessions, take over, Needs you

**Stream A.** Delete v1-only backend: `AdeService` v1 methods, `Queue` new-work rebind,
dependencies/blockers, work type, per-repo plan; v1 `ade/wire.ts` and its `bridge/index.ts`
entries; migration `0009` dropping v1 tables, no data migration (D5). Keep shared fact code used by v2.
**SPEC2:** §13 (dropped items, backend).

**Stream B.** Sessions tab (task: spec sessions + all runs; branch: its own): tab strip with
`TUI` / dashed `claude -p` badges, interactive first; headless status bar + read-only log + note +
Take over; TUI tab terminal (reuse terminal module); `Finished / stopped` list with Take over.
Take over wiring everywhere (Sessions bar, step rows, Needs you), opening `TUI … (resumed)` tab; on a
running headless run a confirm dialog says the run must be stopped first (D3). Read-only live log of a
headless run reachable without taking over from Sessions tab, step rows and Needs you (D3).
`▶ <Stage>` dialog with stage prompt. `▶ Start` on branch rows. Task Archive dialog (§10 template,
every branch at risk) reusing archive-at-risk flow. Needs you page (§11: kinds, ordering, one
action each (`interrupted by restart` stuck runs included), footer counts, `All sessions` toggle grouped by task, tab badge count). History rows
per task with repos.
**SPEC2:** §4.1 (`!` click targets), §5 (Take over UI), §7 (Sessions tab), §10 (UI), §11.

**Ownership.** A: `internal/**`, migrations, `bridge/index.ts`, `ade/wire.ts` (v1, deleted). B: as
before. **No ordering dependency:** v1 frontend callers were deleted in P145 B; B uses only
P144-P147 methods.
**Accept.** Stream A: `go test`, `lint:go`, `knip` clean for removed TS. B: `test:ui:space`. Wave
end: both + `bun run lint:dead`.

### P149 ADE v2 closing (serial)

Full `go test ./...`, `test:unit`, `test:ui:space`, `test:visual:space`, `lint:all`. Live Kira Space
run compared to `ade-v2/mockup.html` screen by screen (plan, backlog, needs, all sessions,
workflows, repos, panel modes, dialogs). Re-audit SPEC2 §13 drops and design §9 decisions.
`docs/ARCHITECTURE.md` ade section rewritten; "Known open items" updated. **SPEC2:** §1 (outcome
check), §13 (audit). Size M.

## 5. Coverage matrix (SPEC2 § -> phase)

| SPEC2 § | Item | Phase |
|---|---|---|
| intro | v1 rules still apply (layout, icons, dialog, archive safety, notes, days, colors, conflicts) | P145 B (UI), P144 A (conflicts) |
| §1 | Why | P149 (outcome check) |
| §2 | Model table: Task, Workflow, Stage, Run, Branch, Step, Session, Integration, Prepare, Environment, Review item, Parked | P143 (shape), P144 A (store) |
| §2 | Base marker (3 variants, tooltip, `no branch yet · from`) | P144 A (data), P144 B (text), P145 B (render) |
| §2 | Cross-task `on <branch>`, `↻ <branch>` + Rebase | P144 A (facts), P144 B (rules), P145 B |
| §3 | Tab bar, capture box, Add task button | P145 B (bar, Plan, capture, Add); page entries with their pages (P146-P148 B) |
| §3 | Plan header, repo chips, show/hide, `↻`, Refresh all scope | P144 A (fetch), P145 B (UI) |
| §3 | Fetch summary incl. `merged into develop` | P145 A, P146 B |
| §4 | Per-task day/order/merge order | P144 B (logic), P144 A (store), P145 B |
| §4 | First 10 + Load all; history button | P144 B, P145 B |
| §4 | Drag without dialog; split-across-days dropped | P145 B |
| §4.1 | Card geometry, header lines, title wrap | P145 B |
| §4.1 | Stage progress segments, label, percent, tooltips | P144 B (logic), P147 B (live) |
| §4.1 | `!` circle + click targets | P144 B, P145 B (render), P148 B (targets) |
| §4.1 | Branch row own progress | P144 B, P147 B |
| §4.1 | Branch row line 1/line 2 incl. merged/deployed | P145 B (line 1), P146 B (line 2) |
| §4.2 | Task row status tag + stage action | P144 B (rules), P147 B |
| §4.2 | Branch row tags/actions incl. preparing/setup failed, ▶ Start | P144 B (rules), P145 B (git), P147 B (setup), P148 B (Start) |
| §5 | Task status derived, read-only; §7 toggle dropped (D10) | P144 B, P146 B |
| §5 | User stages: dialog with prompt + context | P147 A, P148 B |
| §5 | Agent stages: headless runs, Run dialog, approval, stuck/failed | P146 A, P147 B |
| §5 | Take over (confirm dialog if running, D3) | P147 A, P148 B |
| §5 / §7 | Read-only live headless log, persisted per run (D3) | P146 A, P147 B (step rows), P148 B (Sessions, Needs you) |
| §5 | Restart recovery: `running` -> `stuck` (D7) | P147 A, P148 B (Needs you) |
| §5 | Release extras | P147 B |
| §5 | Per-repo runs, todo progress, panel lines | P146 A, P147 B |
| §5 | Send back (3 rounds) | P147 A, P147 B (display) |
| §5 | Script stages, Output, Retry | P146 A, P147 B |
| §5.1 | Workflows page, stage/step editor, panel Workflow select | P145 A, P147 B |
| §5.1.1 | YAML files, reader, aliases, `allowed_tools`; no defaults (D2) | P144 A |
| §5.1.1 | Form/YAML switch, Copy, Import, validation, last-valid, folder watch, empty state | P145 A, P147 B |
| §5.1.2 | `finish_step` MCP, auto suffix, outcomes, no-call failure | P146 A, P147 B (editor note/dialog) |
| §5.2 | Long text rules | P144 B (helpers), P145-P148 B (each surface) |
| §6 | Merged/stale/not merged compute, after rebase, recorded merge on dialog finish only (D14) | P145 A |
| §6 | Rebase-conflict check of every visible branch after refresh (D1) | P144 A |
| §6 | Row text, fix menu, panel Merged into, Merge dialog | P146 B |
| §6.1 | Prepare script run, states, gate, persist | P146 A |
| §6.1 | Graph/panel/Needs you display | P147 B, P148 B |
| §6.2 | Deploy compute | P145 A |
| §6.2 | Deploy display | P146 B |
| §6.3 | Repos page backend, same list as Git module `code_repos` (D15) | P145 A |
| §6.3 | Repos page UI, repo pickers `nickname · full name` | P147 B (page), P145 B (pickers) |
| §7 | Panel task mode header, Task tab, Notes tab | P146 B |
| §7 | Workflow block, one per stage (D11) | P147 B |
| §7 | Sessions tab | P148 B |
| §7 | Branch mode | P146 B (+ setup P147 B) |
| §8 | Add new task / existing branch | P144 A, P145 B |
| §9 | Start task / Start step / repo-named rebase templates, worktree path rule | P146 A (paths), P147 A, P145 B (templates), P148 B (Start) |
| §10 | Archive per task | P147 A, P148 B |
| §11 | Needs you page, All sessions, badge | P144 B (derivation), P148 B |
| §11.1 | Backlog | P144 A, P146 B |
| §12 | Data model | P143, P144 A |
| §13 | Dropped items, plus P135 dependency nodes, P136 work types and top-5 filter (D16, D4) | P145 B (UI), P148 A (backend), P149 (audit) |
| §13 | Ripple + "On merge" kept | P144 B, P145 B |

## 6. Decisions (user-approved) and open items

Former open questions Q1-Q16 answered. Each wave plan restates the decisions it implements.

| # | Decision |
|---|---|
| D1 | Git: `git` CLI for all ops. go-git (`github.com/go-git/go-git/v5`, Apache-2.0, maintained) only for the plain merge-conflict check. After every refresh, check every visible branch for conflicts if rebased onto the latest base; surface as the existing conflict tags. SPEC2 "native Go git" satisfied this way. |
| D2 | Workflow YAMLs live in a `workflows/` subfolder of the app home folder. No seeded defaults. Zip YAMLs (`design/ade-v2/workflows`) are optional samples, not shipped. Workflows page has an empty state (`Import YAML` / `+ New`). |
| D3 | Take over of a running headless run: confirm dialog saying the run must be stopped first. Read-only live log of headless runs reachable without taking over (Sessions tab, step rows, Needs you); logs persisted per run. |
| D4 | Top-5 "my work" filter (P136) becomes top-10 as SPEC2 §4: first 10 items, `Load all` button, `Show only the first 10 again`. |
| D5 | v1 ade tables dropped, no data migration, app starts empty. |
| D6 | Headless `claude -p` loads `~/.claude/settings.json` plus the worktree's `.claude/settings.json` and `settings.local.json`; un-allowed tools denied in `-p` mode. App sets no default mode. Per-step `allowed_tools` from YAML via `--allowedTools`; deny rules still win. App setting for `--setting-sources user` (ignore repo-committed settings); default decided in the P146 plan after verifying against the installed `claude --help`. `allowed_tools` added to YAML schema and wire types. |
| D7 | App restart: `running` runs become `stuck`, note `interrupted by restart`. No auto-resume; user acts manually. |
| D8 | No concurrency limit for now. No cap, queue or setting. |
| D9 | Jira sync and CI status out of scope: stored Jira key/url displayed only, no CI badge. |
| D10 | Task status derived from workflow (SPEC2 §5), read-only. §7's 5-button toggle dropped. |
| D11 | Panel: one block per stage (§5.1), not three fixed phase blocks. |
| D12 | `runs_on: once` runs in the first branch's worktree in task order; created first if missing. |
| D13 | Script stages cannot send back. `back:` target must be an earlier step of the same stage. Stage ids and step ids are separate namespaces. |
| D14 | App records a merge only when its own merge dialog finishes; otherwise merged/stale from git facts (ancestor / patch-id). |
| D15 | Repos page = same list as Git module `code_repos`; repo added once. |
| D16 | P135 dependency nodes and P136 work types dropped (workflow + base markers/`↻` tags replace them). Estimate field kept, extend-only. |

**Still open (not answered by the user; the owning phase's plan proposes, user confirms):**

- O1. go-git has no three-way merge. The P144 plan verifies the plumbing-based conflict check agrees
  with `git merge-tree --write-tree` on a fixture set. If it cannot, ask the user before falling
  back to `merge-tree` for that check.
- O2. Backlog storage (old Q17): app SQLite shared across windows, not browser storage? Plan assumes SQLite.
- O3. Parked tasks / review items (old Q18): where is `parked` toggled; can a `review` task hold more than one branch?
- O4. `{jira}` script variable (old Q19): key only, or `KEY URL`? Plan assumes key only (D9: no sync).
- O5. Default for the `--setting-sources` app setting: decided in the P146 plan (D6).

## 7. Deviation note

`CLAUDE.md` runs phases strictly one at a time. This plan keeps that: P143-P149 run in order, and
the only concurrency is two streams inside one wave phase, per the streams rule (cap 2, zero
ownership overlap, explicit no-ordering confirmation). The user asked for two-stream parallelism
explicitly. Each wave plan re-verifies its ownership table against the current tree; if a split
fails that check, that wave runs as one sequential implementer.

SPEC2 "native Go git" (§6, §6.2) is met by D1: `git` CLI for all operations, go-git only for the
rebase-conflict check. This reverses the app-wide go-git decline for that one use; `docs/ARCHITECTURE.md`
records it in P149.
