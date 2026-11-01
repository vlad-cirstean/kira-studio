# v0.2.25 stream split

Split plan for `docs/v0.2.25/SPEC.md` rows P436-P444. Base: `6ba267359` (`chapter/v0.2.25` tip, same commit as
`chapter/v0.2.24` tip). Discovery ran through `codegraph_explore` (ADE `AdeSessionStrip`, `useSessionMenu`,
`AdeSessionsTab`, `AdeStoppedMenu`/`AdeStoppedList`, `AdeSessionActions`, `AdeAllSessions`, `useRestartSession`,
`AdeSessionsRepo`, `adewire.Session`; both apps' `workbench/modes.ts`, `automationsModule.ts`, `WorkbenchShell.vue`,
shared `ModeSwitcher.vue`, `WorkbenchTitleBar.vue`, `TitleBar.vue`, `createModeStore`, `AppMode`, `SpaceMode`; Studio
`dbmcp` `ApprovalBroker`, `runQuery`/`reviewResponse`, `Server`/`buildMCPServer`, `DbMcpApprovalDialog`,
`bridge/dbmcp.go`, `bridge/docker.go`; Space `oplog.Origin`/`WithOrigin`, `mcpRecorder`, `recordSessionEnd`), then
Read/Grep for i18n catalog, migrations, window-mode lists, package manifests, root configs, tests and docs.

Numbering note: the request named P442 as review and P443 as close. `SPEC.md` is authoritative: P442 is the slow
test audit, P443 the review, P444 the close. No renumber or reorder is needed for this split, so `SPEC.md` is
untouched. Its intro says "two phases in parallel"; the user's later ask for 3 streams overrides it.

User asked for 3 parallel streams (overrides the 2-stream cap). Verdict: a clean 3-way split holds for P436-P440,
with one named docs hand-off (README and site card, see "Serial hand-off"). P441 and P442 cannot run in parallel
with anything: both sweep the whole tree. They run after all three streams land, on the chapter branch, then P443
and P444.

This file is the split only. Each phase still gets its own Opus plan under `plans/`, written in its stream's worktree
against that worktree's then-current tree.

## Findings that drive the split

- **ADE session UI is one folder.** `apps/kira-space/frontend/src/ade/v2/sessions/`: `AdeSessionStrip.vue` (running
  tabs, `@contextmenu` to `useSessionMenu`), `useSessionMenu.ts` (today: Restart for a running TUI, Copy session ID),
  `AdeSessionsTab.vue` (strip + pane + dropdown), `AdeStoppedMenu.vue` (the sessions dropdown: a `Popover` of
  stopped sessions with a count) over `AdeStoppedList.vue`, `AdeSessionActions.vue` (headless Take over / Stop).
  `AdeAllSessions.vue` (needs page) and `plan/AdeTaskSessions.vue` show the same sessions elsewhere. P436 and P437
  both edit this folder, so they share a stream.
- **Restart exists; Close does not.** Bridge has `adeTaskRestartSession` (`AdeTaskService.RestartSession`) and
  `adeTaskStopRun` (headless run). No "close interactive session" call exists. `Tracker.recordSessionEnd` already
  logs a user stop of a TUI session, and `AdeSessionsRepo.MarkStopped` is the exit path. P436's plan decides between
  closing the terminal through an existing call and a new `adeTask*` bridge method; either way the files sit in
  Stream A.
- **Mode strip is shared; module lists are per app.** `packages/workbench/src/components/ModeSwitcher.vue` renders
  every mode tab (icon + `.mode-label` text, `data-testid="mode-tab"`, `data-mode`, `aria-pressed`), mounted by
  `WorkbenchTitleBar.vue` in both `App.vue`s. Each app lists modules in its own `workbench/modes.ts`
  (`MODE_ORDER`, `MODES`; label, icon, panel). `ModeDef` lives in `packages/workbench/src/modes.ts`. No mode shortcut
  and no mode attention state exist today; P438's "shortcut if any" and "attention states stay visible" find nothing
  to keep, and its plan decides whether to add either.
- **P438 and P439 meet only in Studio module registration, which P438 does not need.** P439 adds a `kubernetes` mode:
  Studio `modes.ts` (`MODE_ORDER` + entry), `packages/shared/domain/mode.ts` (`AppMode`), Studio
  `internal/storage/model/window.go` (`WindowModes.Valid`). P438 changes the strip's rendering (shared component) and
  the Automations label, which comes from i18n `common.module.automations.label`, not from `modes.ts`. Icon
  `run-all` fits "Runs". So P438 needs no edit in Studio `modes.ts`, and the new Kubernetes tab gets the icon-only
  look and tooltip for free from `ModeSwitcher`. Resolution in "Ownership".
- **Automations rename is mostly catalog values.** 14 catalog strings mention Automations or automation:
  `common.module.automations.label`, `automations.dialog.*` (2), `automations.dir.kira.label`,
  `automations.runs.none.emptyHint`, `backend.notify.automation.*` (3), `space.ade.automation.none.empty`,
  `space.ade.board.taskMenu.runAutomation.label`, `space.ade.branchRequest.source.automation.label`,
  `space.operations.clearHint.hint`, `studio.operations.clear.hint`, `workbench.statusBar.runs.tooltip`. No Go or Vue
  source hardcodes the visible word. Elsewhere: `README.md`, `apps/kira-space/README.md`, `site/` (3 files),
  `docs/ARCHITECTURE.md` (28 lines, 21 in "UI architecture"), `docs/DEV_ENVIRONMENT.md` (2), and test text in
  `automationsRuns.ts`, `automationsOps.ts` scenarios and Studio/Space automations specs.
- **Internal key `automations` is wired into persisted state.** Both apps' `WindowModes.Valid` (`window.go`), Studio
  migration 0039 layout keys `modes.automations.*`, tab `workspaceId: 'automations'`, `internal/scripts`
  `automationsDir`, `automations-mcp` config dir, i18n namespace `automations.*`, ipc errors
  `automations.script.gone.error`. A mode-key rename touches Studio `modes.ts`, `AppMode`, `window.go` and a Studio
  migration, all of which Stream C also edits. Constraint below.
- **"Run" already means three things.** ADE step runs ("Background run" in `space.ade.headless.*`), script runs
  (`automations.runs.*`, Operations panel rows `run:<id>`, P416), and Operations history. P438's collision audit
  works on the Runs-module side and on keys it owns.
- **Docker is Studio-only.** Backend `internal/docker` (root), wire shim `apps/kira-studio/internal/bridge/docker.go`,
  UI `packages/docker-ui` + `apps/kira-studio/frontend/src/docker/`, mode `docker` in Studio `modes.ts`
  (`tabStrip: false`). Space imports no `docker-ui`. The DB MCP server (`apps/kira-studio/internal/dbmcp`) is
  Studio-only too. P440 exposes Kubernetes reads through that server, so P439's host app must be Studio. This split
  confirms Kira Studio next to Docker; P439's plan records the confirmation.
- **No Kubernetes code exists.** `kubectl` appears only in Studio `preconnect` (a pre-connect command). `go.mod` has no
  `client-go`. P439's plan picks `client-go` (Apache-2.0) or a `kubectl` runner through `internal/toolexec`; the
  former changes `go.mod`, the latter may need nothing.
- **Approval flow is SQL-shaped.** `dbmcp.ApprovalRequest` carries `ConnectionID`, `Kind`, `Class`, `Statement`,
  `Target` (host, database, path); `ApprovalBroker` is a generic FIFO with timeout and prompt routing;
  `DbMcpApprovalDialog.vue` renders a statement. Permission modes are per connection (migrations 0020-0022,
  0045). P440 adds a per-cluster ask/allow setting and a cluster-shaped request; its plan decides reuse vs a sibling
  request kind. All in Stream C.
- **P415 origin stamping is Space-only.** `oplog.Origin`/`WithOrigin` live in `apps/kira-space/internal/oplog`
  (`mcpRecorder` stamps MCP tool calls). Studio's equivalent is `adapterhost.WithOpSource(ctx, OpSourceMCP)`, applied
  to every DB MCP handler in `withPanicRecovery`, with the `op_log.source` column (migration 0043). Shared middleware
  `internal/mcpcall.Record` (P415 Part 2) is root. P440 reuses the Studio seam; no Space `oplog` edit.
- **Shared registries.** Space: `frontend/src/bridge/index.ts`, `internal/appwire/**`,
  `tests/ui/support/{ipcChannels,mockRuntime}.ts`, `internal/storage/migrations/embed.go` (latest
  `0060_p415_op_log.sql`). Studio: its own `bridge`, `appwire/{appwire,wire}.go`, test support, migrations (latest
  `0048_p426_proof_chart_view.sql`). Root: `go.mod`, `go.sum`, `package.json` (workspaces list), `bun.lock`,
  `knip.json`, `biome.json`, `scripts/copy/check-copy.ts` (all three list `docker-ui`), `internal/llmprompts/**`,
  `packages/theme/src/i18n/en.json`, `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `README.md`, `site/`,
  `docs/v0.2.25/SPEC.md`. Wails bindings are generated, not tracked.
- **Mode-tab selectors in tests are testid-based.** Every spec and scenario selects
  `[data-testid="mode-tab"][data-mode="<key>"]`. Only Studio `mode-switch.spec.ts` reads `.mode-label` (label ink
  geometry) and asserts `toHaveCount(4)`. Only `automationsRuns.ts` asserts the tab text `/Automations/`.

## Dependency graph (verified against code)

- P437 needs P436 in practice: both rewrite `useSessionMenu`/`AdeSessionsTab` and the dropdown's per-row actions
  (Close and Restart belong in the redesigned dropdown's rows too). Same stream, P436 first.
- P440 needs P439: its MCP tools call P439's read operations (namespaces, kinds, resources, describe, logs) and its
  per-cluster setting keys on P439's cluster identity.
- P438 needs nothing in this chapter.
- P439 needs nothing outside Stream C: a new mode entry renders through whatever `ModeSwitcher` draws.
- P441 needs every earlier phase landed: it bumps manifests and fixes API breaks across all code the streams add.
- P442 needs P441: it measures suite times on the final dependency set and edits specs every stream touched.
- P443 needs P436-P442; P444 needs P443.

No other edge. Stream A touches no mode, Automations or Studio file. Stream B touches no ADE session file, no bridge,
no Go service, no migration. Stream C touches no Space file.

## Streams

| Stream | Order | Scope |
|---|---|---|
| A | P436, P437 | Kira Space ADE sessions |
| B | P438 | Shared mode strip (both apps), Automations to Runs copy |
| C | P439, P440 | Kira Studio Kubernetes module and its MCP tools |
| tail | P441, P442, then P443, P444 | whole tree, chapter branch, after A, B, C land |

Each order is the `SPEC.md` table order, so the "top to bottom" rule holds inside every stream and across the tail.

### Cross-stream dependency

None in code among A, B, C. Every edge above stays inside one stream. P441 and P442 depend on all three and touch
files every stream owns, so they leave the parallel phase entirely.

### Serial hand-off (docs only)

`README.md` (line 7 lists Studio modules "Studio, Api, Automations and Docker") and `site/src/data/content.ts`
(module cards: Automations at line 72, Docker at line 77) need both B's rename and C's new Kubernetes entry, on the
same or adjacent lines. B owns both files while streams run. Ownership passes to C once B has landed: C's P439 plan
puts its README and site card edits in a final commit made after C rebases onto a chapter branch that holds B. If C
finishes everything else before B lands, C waits for B for that one commit. This is the only ordering constraint
between streams, and it is docs text, not code.

### Ownership

Zero overlap. A path not listed is read-only for every stream; a stream that finds it must edit one stops and reports
to the orchestrator before editing.

**Stream A (Space ADE sessions)**

- `apps/kira-space/frontend/src/ade/**` (sessions, needs, plan, panel, state, queries, `ade/v2/wire.ts`).
- `apps/kira-space/internal/ade/**`, `apps/kira-space/internal/bridge/adetask*.go`,
  `apps/kira-space/internal/bridge/adewire/**`, `apps/kira-space/internal/bridge/terminal.go`,
  `apps/kira-space/internal/bridge/agentsessions.go`.
- Space registries: `apps/kira-space/frontend/src/bridge/**`, `apps/kira-space/internal/appwire/**`,
  `apps/kira-space/frontend/src/state/**`, `apps/kira-space/internal/storage/**` (reserves every Space migration
  number: 0061 upward).
- `apps/kira-space/internal/flows/adeflow/**`, `apps/kira-space/internal/flowharness/**`, root `internal/terminal/**`
  (only if closing a TUI session needs a registry change).
- Space tests: `tests/ui/support/**`, `tests/ui/ade-v2-{sessions,archived,archive}.spec.ts`,
  `tests/ui/status-agents.spec.ts`, new session specs, `tests/ui/copy-coverage.spec.ts`, `tests/contract/ade-*.json`,
  `tests/visual/ade-*.spec.ts` and snapshots, `tests/claude/**` only if a phase changes Claude launch (none
  expected).
- `docs/ARCHITECTURE.md`: "### Interactive sessions" under "ADE: Kira Space task planner".

**Stream B (mode strip, Automations to Runs)**

- `packages/workbench/src/components/{ModeSwitcher,WorkbenchTitleBar,TitleBar}.vue`,
  `packages/workbench/src/modes.ts` (optional fields only; a new required `ModeDef` field would break C's entry),
  `packages/workbench/src/automations/**`, `packages/workbench/src/testing/ui/scenarios/automations*.ts`.
- Space: `frontend/src/workbench/{modes,automationsModule}.ts`, `frontend/src/workbench/{WorkbenchShell,StatusBar}.vue`,
  `frontend/src/App.vue`.
- Studio carve-outs from C's `apps/kira-studio/**`: `frontend/src/workbench/automationsModule.ts`,
  `frontend/src/workbench/{WorkbenchShell,StatusBar}.vue`.
- Tests. Studio: `tests/ui/mode-switch.spec.ts`, `tests/ui/automations-*.spec.ts`,
  `tests/ui/{copy-wording,copy-coverage,consistency,ui-leftovers}-docker-automations.spec.ts`,
  `tests/visual/automations-module.spec.ts` and snapshots. Space: `tests/ui/modules.spec.ts`,
  `tests/ui/automations-*.spec.ts`, `tests/ui/ade-v2-automations.spec.ts`, `tests/ui/copy-wording.spec.ts`.
- Docs: `README.md`, `apps/kira-space/README.md`, `site/**` (see hand-off), Automations wording in
  `docs/ARCHITECTURE.md` "UI architecture" and wherever else the word appears, Automations wording in
  `docs/DEV_ENVIRONMENT.md`.

**Stream C (Studio Kubernetes)**

- `apps/kira-studio/**`, except B's carve-outs above.
- Includes: new Kubernetes backend (`apps/kira-studio/internal/kubernetes/` or root `internal/kubernetes/`, P439
  plan picks), `apps/kira-studio/internal/{bridge,appwire,dbmcp,oplog,storage}/**` (reserves every Studio migration
  number: 0049 upward), `internal/storage/model/window.go` (`WindowModes`), Studio `frontend/src/workbench/modes.ts`,
  `frontend/src/App.vue`, `frontend/src/bridge/**`, `frontend/src/state/**`, `DbMcpApprovalDialog.vue`, Studio
  `tests/ui/support/**`, `tests/ui/copy-coverage.spec.ts`, `tests/ui/copy-wording.spec.ts`,
  `tests/ui/consistency.spec.ts`, new `*kubernetes*` specs, Studio `tests/claude/**` (P440 changes agent-facing
  tools), Studio flow tests.
- `packages/shared/domain/mode.ts` (`AppMode`), new `packages/shared/domain/kubernetes.ts` if needed.
- New `packages/kube-ui/` if the P439 plan mirrors `docker-ui`; then also root `package.json`, `bun.lock`,
  `knip.json`, `biome.json`, `scripts/copy/check-copy.ts`. C is the only stream that changes any of them.
- `go.mod`, `go.sum` (only if P439 picks `client-go`). C is the only stream that changes them.
- `internal/llmprompts/**` (Kubernetes tool texts), `internal/mcpcall/**` (only if reuse needs a change).
- New shadcn-vue primitive dirs C's plans name.
- `docs/ARCHITECTURE.md`: new "Kubernetes module" section after "Docker module (P200, Kira Studio)"; "Database MCP
  server (v1.7)" section. `docs/DEV_ENVIRONMENT.md`: Kubernetes test cluster section (kind or k3s, if used).
- After B lands: `README.md` and `site/src/data/content.ts` Kubernetes entries, new
  `site/src/content/docs/docs/studio/kubernetes.md`, `site/src/content/docs/docs/{reference/mcp-tools.md,
  studio/database-mcp.md}` tool rows.

Consequences named so no stream drifts across:

- B keeps `data-testid="mode-tab"`, `data-mode` and `aria-pressed` on every mode tab, and makes the module label the
  tab's accessible name. Every other stream's specs keep working unchanged.
- B keeps the mode key `automations` and every other internal identifier listed in "Findings". A key rename would
  edit `modes.ts`, `AppMode`, `window.go` and a Studio migration that C owns. If P438's plan finds the rename
  worthwhile, it stops and reports; the orchestrator asks the user whether to run it after C lands.
- B edits no Studio `modes.ts`, `App.vue`, bridge or Go file. Visible module name comes from the catalog value.
- B makes Studio `mode-switch.spec.ts` count-agnostic (derive the expected tabs from `MODE_ORDER`, not a literal 4),
  so C's fifth mode needs no edit there.
- A adds no npm or Go dependency. B adds none either. A need for one means stop and report (C owns `bun.lock` and
  `go.mod`).
- A adds a Space migration only if P436/P437 truly need one; B and C add none in Space.

### Files every stream must touch: rules

- `packages/theme/src/i18n/en.json`: each stream adds or edits keys only under its own subtrees.
  A: `space.ade.{sessionTab,sessionList,allSessions,headless}.*`, new `space.ade.sessions*.*`,
  `backend.space.ade*`. B: values of the 14 keys listed in "Findings", plus `common.module.*`, `automations.*`,
  `workbench.statusBar.*`, new `workbench.modeSwitcher.*`. C: new `studio.kubernetes.*` or top-level `kubernetes.*`
  (mirrors `docker.*`), `studio.dbMcp.*`, new `common.product.kubernetes.*`, `backend.studio.kubernetes*`. A run-word
  collision B finds inside A's subtrees is reported to the orchestrator, which routes it to A while A runs, or to
  P443 after. Keys are disjoint, so a rebase conflict here is textual adjacency only: resolve as the union of both
  sides, then `bun scripts/copy/check-catalog.ts --unused` and `bun run typecheck` must pass. This is the one named
  exception to "a conflict means the boundary was wrong".
- `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`: A and C edit only their listed sections. B's edit is a word
  substitution on lines that mention the module. On conflict take the other stream's line and re-apply B's
  substitution. "Known open items": append-only per stream, union on conflict.
- `docs/v0.2.25/SPEC.md`: no stream edits it. Each implementer writes its Result section at the end of its own phase
  plan file (`plans/P4xx.md`). The orchestrator marks the row Done and copies the Result into `SPEC.md` on
  `chapter/v0.2.25` after that stream lands. A phase split (`P<n> Part 2`) is recorded in the plan file and applied
  to `SPEC.md` the same way.
- Visual baselines: a stream regenerates only baselines of its own specs, plus the rule below. B changes the title bar
  in every full-window capture of both apps; C adds a fifth Studio tab to the same captures; A changes ADE captures.
  Whichever stream lands last re-records the full-window baselines that moved, after its rebase.
- New shadcn-vue primitives: each phase plan lists the ones it adds. The orchestrator checks no two stream plans add
  the same one before implementation; a duplicate goes to the stream whose phase runs first, the other imports it after
  landing (or uses an existing primitive).

## Per phase

### P436 Session tab context menu: Close and Restart (Stream A)

- Scope: `useSessionMenu` gains Close session; Restart, today shown only for a running TUI, gets the plan's rule for
  headless and stopped sessions. Close ends the interactive terminal (TUI) or stops the run (headless, existing
  `StopRun`), with a confirm only if the plan finds work can be lost.
- Risks: closing a TUI races `Tracker.Reconcile` and `recordSessionEnd`; a phone-held terminal (`mobileTerminals`)
  needs a defined outcome; selected-tab fallback after close.
- Tests: flow test (close and restart through the bridge, op-log row) + UI spec of the menu. No unit test.

### P437 Sessions dropdown redesign (Stream A)

- Scope: `AdeStoppedMenu`/`AdeStoppedList` looks and interactions (grouping, search or filter, keyboard, per-row
  actions incl. P436's), consistent with `AdeAllSessions`.
- Risks: popover focus rules (`open-auto-focus`), take-over closing the popover, long lists.
- Libraries: shadcn-vue (popover, command, dropdown), Tailwind, VueUse.
- Tests: no new backend feature expected, so UI spec and visual baseline updates.

### P438 Runs rename, icon-only module tabs (Stream B)

- Scope: `ModeSwitcher` renders icon only with a shadcn-vue tooltip (label, shortcut if one exists) and an accessible
  name; active state unchanged; the 14 catalog values, READMEs, site and docs say Runs; collision audit for "run".
- Risks: mode key stays `automations` (see above); centering math in `ModeSwitcher` once labels go; Studio label-ink
  geometry tests in `mode-switch.spec.ts` change meaning.
- Tests: UI specs in both apps (accessible name, tooltip) through the shared scenario files; visual baselines.

### P439 Kubernetes module, read only (Stream C)

- Scope: Studio mode `kubernetes` next to `docker`; cluster from kubeconfig contexts; namespace and kind pickers;
  resource list, describe, logs, each with a filter; Studio module look.
- Risks: client choice (`client-go` size vs `kubectl` presence), auth plugins (exec credential), large lists and log
  streams, cluster unreachable states.
- Tests: flow test + UI spec per feature; real-cluster check only if the plan sets up kind/k3s (then a
  `docs/DEV_ENVIRONMENT.md` section).

### P440 Kubernetes MCP tools with per-cluster approval (Stream C)

- Scope: read-only tools on the DB MCP server; per-cluster ask/allow setting, default ask; approval dialog; op-log
  source `mcp` through `adapterhost.WithOpSource` or the Kubernetes service's own seam.
- Risks: approval request shape (SQL fields vs cluster fields); log volume through MCP (caps); prompt text.
- Tests: `dbmcpflow` flow test + UI spec of the dialog; claude test row for dbmcp (`bun run test:claude:studio`).

### P441 Dependency update, incl. Wails (tail)

Alone on `chapter/v0.2.25` after A, B, C land. It changes `go.mod`, `go.sum`, every `package.json`, `bun.lock`, tool
versions and Wails bindings, then fixes breaks anywhere; nothing else can run beside it. Workflow files go through
`docs/pending-workflows/` per `docs/DEV_ENVIRONMENT.md`.

### P442 Slow test audit (tail)

After P441, alone. It edits specs and configs every stream touched and needs the final dependency set for its
before/after numbers.

## Landing procedure

1. Orchestrator, on `chapter/v0.2.25` at the commit holding this file:
   `git worktree add -b chapter/v0.2.25-stream-a /home/user/kira-worktrees/v0.2.25-stream-a`, same for `-b` and `-c`.
   Run `bun install` and `scripts/codegraph-setup.sh` in each worktree before spawning any subagent there.
2. Stream branches are local only: `.githooks/pre-push` refuses them, and nobody pushes them.
3. Inside each worktree: per phase, Opus plan (committed), then Sonnet implementer, sequentially, per CLAUDE.md. At
   most one subagent active per stream; up to three streams concurrently, as the user asked.
4. A stream is done when its last phase is implemented, its expensive suites ran once and are green, and its hooks pass
   on normal commits. Stream C's P439 README/site commit waits for B (hand-off above).
5. Rebase order: the first stream to finish rebases first, except that B lands before C finalizes its hand-off
   commit. When all finish together, land A, then B, then C. Each: `git -C <worktree> rebase chapter/v0.2.25`,
   resolve only the named union files, rerun fast checks (`bun run typecheck`, `bun run lint`, Go build/test of
   touched packages), re-record moved full-window baselines if this is the last stream, then on the main checkout
   `git merge --ff-only chapter/v0.2.25-stream-<x>`.
6. After each landing the orchestrator updates `SPEC.md` rows of that stream (Done + Result copied from the plan files)
   in its own commit, then pushes `chapter/v0.2.25`.
7. After all three land: `git worktree remove` each, `git branch -d chapter/v0.2.25-stream-{a,b,c}`, push.
8. Tail on `/home/user/kira-studio`: P441, then P442, then P443 two review rounds over the diff since `main`, then
   P444 close.
9. A worktree survives a container restart: resume a stopped stream from its last commit and its plan files.

## Decisions this split fixes

1. P439 host app: Kira Studio, next to Docker (Docker and the DB MCP server are Studio-only; P440 needs both in one
   app).
2. P438 keeps the internal mode key `automations` while streams run; a rename needs the user's call and runs after C.
3. P438's tab icon for Runs stays `run-all`; B does not edit Studio `modes.ts`.
4. P441 and P442 run alone after all streams.
