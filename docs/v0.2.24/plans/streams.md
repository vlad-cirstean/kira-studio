# v0.2.24 stream split

Split plan for `docs/v0.2.24/SPEC.md` rows P423-P433. Base: `d803205be` (`chapter/v0.2.24` tip). P434 review and
P435 close run after every stream lands; not in any stream. Discovery ran through `codegraph_explore` (githost
contract, `github` provider, registry, `providers.New`; `issuetracker` contract, `jira` client, registry, `wireTrackers`;
`CliToolsPane`, `state/cliTools.ts`, `bridge/clitools.go`; Studio `adapters/registry.go`, `MonacoHost` completion
provider, `saved_queries` repo, `ConsoleSavedMenu`; `internal/proof/validate.go`, `ProofWindow`, `ProofStepView`;
`internal/shell` `OpenWindow`/`WindowOpenerDeps`/`Chord`, Studio `main.go`, `ProofService.OpenWindow`, Space review
window; `adeflow` parse/writer, `ade/steps.go`, `ade/sandbox.go`, `internal/harness` claude provider, `agentsandbox`
launch env; `OpLogPanel`, `createOpLogStore`, both `OperationsPanel.vue`, `oplog/log.go`; `queryClient.ts`,
`MainView.vue` keep-mounted, Space file views), then Read/Grep for migrations, i18n catalog, package manifests, bridge
registries and test support.

User asked for 3 parallel streams (overrides the 2-stream cap). Verdict: a clean 3-way split holds for P423-P432.
P433 cannot run in parallel with anything: it sweeps every view the other phases add. It runs after all three streams
land, on the chapter branch. Details in "Cross-stream dependency".

This file is the split only. Each phase still gets its own Opus plan under `plans/`, written in its stream's worktree
against that worktree's then-current tree.

## Findings that drive the split

- **Two apps, separate trees.** Kira Studio (`apps/kira-studio`) has the DB adapters, console, saved queries, `dbmcp`
  and the P420 proof window. Kira Space (`apps/kira-space`) has `githost`, `issuetracker`, ADE workflows and its own op
  log. P424-P426 touch Studio only. P423, P427-P431 touch Space only. P432 touches the shared op-log panel in both.
- **No Kibana or Elastic adapter exists.** `adapters/registry.go` registers kinds from each package's `init()`;
  `packages/shared/domain/connection.ts` `connectionKindSchema` lists the kinds. P424 adds a new kind, package and
  console language. Studio `saved_queries` has kinds `filter` and `console` only (`scanSavedQueryRow`); P425 extends it.
- **No chart library in any manifest.** Root `package.json` holds the shared frontend deps. Discover's hit histogram
  (P424) and proof visualisations (P426) want the same library, so both sit in one stream.
- **Proof views are `table|document|keyvalue`** (`proofViewSchema`, Go `validate.go` `StepInput`). P426 adds chart
  views end to end: Go validation, MCP tool schema in `internal/llmprompts`, TS schema, `ProofStepView`.
- **Git host contract is role-based.** `githost.Provider` (Remotes, Auth, ChangeRequests, URLs) plus optional
  `ChangeRequestSync`, `ChangeRequestReviews` (`ReviewTarget`, `SubmitReview`, `Comment`), `ChangeRequestSearch`,
  `BranchLinks`, `CLISetup`. One provider today (`githost/github` over `gh`); `providers.New(gh, extra...)` and the
  flowharness `fakehost.Forge` implement the roles. P423 adds `githost/azure` over `az`; P427 adds a detail-read role
  (description, comments, checks) both providers and `Forge` implement; P429 widens `Comment` for attachments.
- **Issue tracker contract** (`issuetracker.Provider`: `ParseRef`, `Status`, `Issue`) returns key, title, status, PR
  summary only. P428 adds assignee, description, comments; P429 adds posting. `jira` client runs `acli jira workitem
  view --json --fields` through a recording tool runner (`oplog.NewRecordingToolRunner`) built in `wireTrackers`.
- **Settings CLI pane is data-driven.** `CliToolsPane.vue` renders every `CLISetup` provider from `IssueTrackerService
  .Tools`; adding `az` is a provider `Setup()` plus registration, no pane edit beyond copy.
- **Windows.** `internal/shell.OpenWindow` + `WindowOpenerDeps.Ephemeral`; Space review window and Studio proof window
  are the precedents for a dedicated window. No global hotkey code exists anywhere; `shell.Chord` builds menu
  accelerators only. Space `main.go` wires windows; it is touched only by P430.
- **Stage settings land in four layers**: workflow YAML (`adeflow/parse.go` `step`, `writer.go`), wire
  (`adewire.WorkflowStep`, frozen mirror `frontend/src/ade/v2/wire.ts`), run launch (`ade/steps.go` `workflowSteps`,
  `ade/sandbox.go` `applySandbox` already merges env into `harness.HeadlessSpec`), and provider
  (`internal/harness/claude`, registry in `internal/harness/providers`). Only P431 touches any of them.
- **Op log panel is shared**: `packages/workbench/src/components/OpLogPanel.vue` and `state/createOpLogStore.ts`, used
  by `apps/kira-space/frontend/src/workbench/OperationsPanel.vue` and
  `apps/kira-studio/frontend/src/workbench/panels/OperationsPanel.vue`. Only P432 edits them.
- **Frontend data defaults** live in `packages/workbench/src/state/queryClient.ts` (`staleTime: Infinity`, no
  `gcTime` override) and `packages/workbench/src/components/MainView.vue` (`KEPT_MAX = 4`, per-kind `keepMounted`).
  P433 owns those and audits every view, including the ones P424-P432 add.
- **Shared registries.** Space: `frontend/src/bridge/index.ts` (the `control` object, 614 lines),
  `internal/appwire/appwire.go` (bound services), `tests/ui/support/ipcChannels.ts`, `mockRuntime.ts`,
  `internal/storage/migrations/embed.go` (ordered version list; latest `0060_p415_op_log.sql`). Studio: its own
  `bridge`/`appwire`, `migrations/embed.go` (latest `0046_p420_validation_proof.sql`). Root: `go.mod`, `go.sum`,
  `package.json`, `bun.lock`, `packages/theme/src/i18n/en.json` (14.3k lines, top keys `space`, `studio`, `backend`, ...),
  `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `docs/v0.2.24/SPEC.md`. Wails bindings are generated, not tracked.

## Dependency graph (verified against code)

- P427 needs P423: the PR view serves GitHub and Azure Repos; the Azure detail read is the `githost/azure` provider.
- P428 needs only v0.2.23 P417 (`issuetracker`, `jira`), already on the base.
- P429 needs P427 and P428: it posts from both views and widens the roles they add.
- P430 needs P427 and P428: popup actions open the PR view and the issue viewer. It parses links through
  `githost.Registry.ParseLink` (Azure links from P423) and `issuetracker.Registry.ParseRef`. "Later" capture is the
  existing `adeTaskCaptureTask` bridge call; no ADE edit.
- P425 needs P424: saving targets the Kibana console tab and kind P424 adds.
- P426 has no code dependency on P424, but shares the chart library choice and visual language with Discover's
  histogram. Same stream, after P424, so the library lands once.
- P431 and P432 depend on nothing in this chapter.
- P433 depends on every phase that adds or changes a view or query: P424-P432.

No other edge. P431 does not touch `githost`/`issuetracker`; P432 does not touch `oplog` producers (P423's `az` runner
reuses `oplog.NewRecordingToolRunner` as `jira` does, a call only); P423-P430 do not touch `ade`, `adeflow`,
`adewire` or `internal/harness`.

## Streams

| Stream | Order | App |
|---|---|---|
| A | P424, P425, P426 | Kira Studio |
| B | P423, P427, P428, P429, P430 | Kira Space (git host, tracker, capture) |
| C | P431, P432 | Kira Space ADE + shared op-log panel (both apps) |
| tail | P433, then P434, P435 | whole tree, chapter branch, after A, B, C land |

Each order is the SPEC table order, so the "top to bottom within a stream" rule holds.

### Cross-stream dependency

None among A, B, C. Every edge above stays inside one stream. P433 is the one unavoidable cross-stream dependency
(it needs all of A, B, C); per the rule it cannot share a stream with all three, so it leaves the parallel phase
entirely and runs after landing. That also gives P433 a clean "before" heap baseline on the integrated tree.

### Ownership

Zero overlap. A path not listed is read-only for every stream; a stream that finds it must edit one stops and reports
to the orchestrator before editing.

**Stream A (Studio)**

- `apps/kira-studio/**`, except the two paths Stream C owns below.
- `apps/kira-studio/internal/adapters/kibana/` (new), its conformance tests, `testdata/`.
- `apps/kira-studio/internal/storage/migrations/**` (reserves every Studio migration number: 0047 upward).
- `apps/kira-studio/internal/dbmcp/**`, `apps/kira-studio/internal/proof/**`, `apps/kira-studio/frontend/src/proof/**`.
- `internal/llmprompts/**` (proof tool descriptions and args).
- `packages/shared/domain/connection.ts`, `queries.ts`, `proof.ts`, `console.ts`, `editor.ts`, new
  `packages/shared/domain/kibana.ts`.
- Root `package.json` and `bun.lock` (chart library). Only A changes them.
- New shadcn-vue primitive dirs under `packages/theme/src/components/ui/` that A's plans name (e.g. `chart`).
- `docs/ARCHITECTURE.md` sections: "Adapter contract", "Per-engine adapter facts" (new Kibana subsection), Studio
  proof subsection.
- `docs/DEV_ENVIRONMENT.md`: Kibana/Elasticsearch container section.

**Stream B (Space git host, tracker, capture)**

- `apps/kira-space/internal/githost/**` (new `githost/azure/`), `apps/kira-space/internal/issuetracker/**`,
  `apps/kira-space/internal/clisetup/**`, `apps/kira-space/internal/gitrpc/changerequests.go`,
  `apps/kira-space/internal/gitsession/crreview.go`, `crsync.go`.
- `apps/kira-space/internal/bridge/**` except `adewire/**` and `ops.go`; includes `bridge/clitools.go`,
  `issuetracker.go`, `githost.go`, new view/comment/capture services.
- `apps/kira-space/internal/appwire/**`, `apps/kira-space/main.go`, `apps/kira-space/internal/appshell/**`.
- `apps/kira-space/internal/flowharness/**` (fakehost, fakeacli, new fake az). Stream C uses existing options only
  (`WithProvider`).
- `apps/kira-space/internal/storage/**` (reserves every Space migration number: 0061 upward; settings model).
- `apps/kira-space/internal/flows/**` except `adeflow/**`; `internal/flows/coverage/exempt.txt`.
- `internal/shell/**`, `internal/appevent/**`, new `internal/hotkey/` (or wherever P430's plan puts it).
- `go.mod`, `go.sum` (hotkey library). Only B changes them.
- Space frontend: `src/bridge/**`, `src/App.vue`, `src/main.ts`, `src/state/**` except `ops.ts`/`opsDomain.ts`,
  `src/workbench/settings/**`, `src/workbench/SettingsDialog.vue`, new `src/hostview/` (PR and issue views),
  new `src/capture/` (popup).
- `apps/kira-space/tests/ui/support/**` except `adeV2.ts`, `adeReviewStep.ts`; `tests/contract/` new fixtures B adds;
  `tests/claude/**` only if a phase changes Claude integration (none expected).
- New shadcn-vue primitive dirs B's plans name.
- `docs/ARCHITECTURE.md` sections: "Git host abstraction (P318)", "Issue tracker abstraction (P417)", new PR view,
  issue viewer and capture subsections; `docs/DEV_ENVIRONMENT.md`: `az` section.

**Stream C (ADE stage settings, op-log panel)**

- `apps/kira-space/internal/ade/**`, `apps/kira-space/internal/adeflow/**`, `apps/kira-space/internal/bridge/adewire/**`,
  `apps/kira-space/internal/flows/adeflow/**`.
- `internal/harness/**`, `internal/flowtest/fakeprovider/**`, `internal/agentsandbox/launch.go` if launch env needs it.
- Space frontend `src/ade/**` (incl. frozen `ade/v2/wire.ts`, `ade/v2/queries.ts`, `ade/v2/workflows/**`).
- `apps/kira-space/tests/ui/support/adeV2.ts`, `adeReviewStep.ts`, existing `tests/contract/ade-*.json` fixtures.
- Op log UI: `packages/workbench/src/components/OpLogPanel.vue`, `packages/workbench/src/state/createOpLogStore.ts`,
  `packages/workbench/src/lib/opLog*` and other op-log-only files there, `packages/shared/domain/ops.ts`,
  `apps/kira-space/frontend/src/workbench/OperationsPanel.vue`, `apps/kira-space/frontend/src/state/ops.ts`,
  `opsDomain.ts`, `apps/kira-space/internal/bridge/ops.go`, `apps/kira-space/internal/oplog/**` (only if an interaction
  needs it), `apps/kira-studio/frontend/src/workbench/panels/OperationsPanel.vue`,
  `apps/kira-studio/frontend/src/state/ops.ts`.
- `docs/ARCHITECTURE.md` sections: "Workflows", "Agent harness (P316)", op-log panel text.
- Amendment (P431 plan): new `apps/kira-space/tests/ui/ade-v2-stage-settings.spec.ts`, new
  `tests/contract/ade-stage-settings.json`, new `tests/claude/stagesettings_test.go` (C adds only this file there; B's
  `tests/claude/**` claim is "none expected"), ADE-only fixtures `tests/fixtures/ade-v2/workflows.json` and
  `tests/unit/support/adeV2Fixtures.ts`. B touches none of them.
- Amendment (P432 plan): `apps/kira-space/tests/claude/memory_test.go` (pre-existing flaky `TestMemoryMcpThroughClaude`
  prompt fix; C adds only this file there, B's claim stays "none expected"). Op-log panel tests: Space
  `tests/ui/{operations,operations-memory,list-keyboard,automations-ops}.spec.ts`, `tests/contract/space-ops-ade.json`,
  new `tests/visual/operations.spec.ts` and its snapshots; Studio `tests/ui/{operations,font-roles,automations-ops}.spec.ts`,
  new `tests/visual/operations.spec.ts` and its snapshots (carve-outs from A's `apps/kira-studio/**`);
  `packages/workbench/src/testing/ui/scenarios/automationsOps.ts`; new op-log-only files
  `packages/workbench/src/components/OpLogDetail.vue`, `OpLogCodeBlock.vue`, `packages/workbench/src/lib/opLogTree.ts`
  (+ `.spec.ts`). An existing A or B visual baseline that moves only because of the panel is re-recorded by whichever
  stream lands second, per the baseline rule below.

Consequences named so no stream drifts across:

- B never edits `ade/**`, `adewire/**`, `ade/v2/wire.ts`: new PR/issue wire types live in `githost`/`issuetracker`
  and new bridge files; B imports `useCaptureTask`-style helpers from `ade/v2/queries.ts`, never edits them.
- C adds no bridge method: P431's catalog rides on the existing workflows result (`adewire.WorkflowsResult` gains a
  field), so `bridge/index.ts`, `appwire.go`, `ipcChannels.ts`, `mockRuntime.ts` stay B's. P432 is UI over existing
  `OpsService{Recent, Cancel}`; a new backend call means stop and report.
- A adds no Go module: Kibana is plain REST through `apps/kira-studio/internal/httpclient`. If a phase needs one, stop
  and report (B owns `go.mod`).
- B and C add no npm dependency (tiptap, markdown-it, VueUse `useDropZone`, `@vue-flow/core` already exist). A need
  for one means stop and report (A owns `bun.lock`).
- C adds no Space migration (stage settings live in workflow YAML; panel prefs use `usePersistedState`). B holds the
  Space numbers; A holds the Studio numbers.

### Files every stream must touch: rules

- `packages/theme/src/i18n/en.json`: each stream adds keys only under its own subtrees. A: `studio.kibana.*`,
  `studio.proof.*`, `studio.console.*`, `backend.studio.*`. B: `space.hostView.*`, `space.capture.*`,
  `space.settings.*`, `backend.space.githost*`/`issuetracker*`/`capture*`. C: `space.ade.workflows.*`,
  `space.operations.*`, `studio.operations.*`, `workbench.opLog.*`, `backend.space.ade*`. Keys are disjoint, so a
  rebase conflict here is textual adjacency only: resolve as the union of both sides, then
  `bun scripts/copy/check-catalog.ts --unused` and `bun run typecheck` must pass. This is the one named exception to
  "a conflict means the boundary was wrong".
- `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`: each stream edits only its listed sections; same union rule on
  adjacency conflicts. "Known open items": append-only per stream, union on conflict.
- `docs/v0.2.24/SPEC.md`: no stream edits it. Its adjacent table rows (P423/P424, ...) would conflict on every
  rebase. Each implementer writes its Result section at the end of its own phase plan file
  (`plans/P4xx.md`). The orchestrator marks the row Done and copies the Result into SPEC.md on `chapter/v0.2.24` after
  that stream lands. A phase split (`P<n> Part 2`) is recorded in the plan file and applied to SPEC.md the same way.
- Visual/screenshot baselines: a stream regenerates only baselines of its own specs. A baseline both B and C change
  (a full-window Space capture) is re-generated by whichever stream lands second, after its rebase.
- New shadcn-vue primitives: each phase plan lists the ones it adds. The orchestrator checks no two stream plans add
  the same one before implementation; a duplicate goes to the stream whose phase runs first, the other imports it after
  landing (or uses an existing primitive).

## Per phase

### P423 Azure Repos via `az` (Stream B)

- Scope: `githost/azure` provider implementing every role GitHub implements (`Provider`, `ChangeRequestSync`,
  `ChangeRequestReviews`, `ChangeRequestSearch`, `BranchLinks`, `CLISetup`) over `az repos`/`az devops invoke`;
  remote parsing for `dev.azure.com` and `*.visualstudio.com` (https and ssh `v3/` forms); registered via
  `providers.New(gh, azure)`; `Setup()` steps (`brew install azure-cli`, `az extension add --name azure-devops`,
  `az login`, `az devops configure --defaults organization=...`, check). Settings pane shows it with no pane change.
- Risks: `az` has no GraphQL or ETag probe, so `ChangeRequestSync.Probe`/`Page` need a REST path through
  `az devops invoke` or a documented narrower sync; az output and exit codes vary by extension version; `az` startup is
  slow (Python), so discovery TTLs and timeouts matter; auth is per organization, not per host.
- Libraries: `internal/toolexec` runner (as `jira`), `oplog.NewRecordingToolRunner`, existing `CliToolsPane`.
- Tests: `githost/azure` parse tests over `testdata/` az JSON (several interacting rules: remote forms, state
  mapping); flow test through `githostflow` with a fake az runner + UI spec of the Settings card (new feature split at
  IPC). No claude test.

### P424 Kibana Discover-grade query editor (Stream A)

- Scope: new `kibana` connection kind (Kibana URL, auth: API key or basic, space id), adapter package registered via
  `init()`; data view list, field caps, Discover search (KQL and Lucene) with time range, sort, size; results through
  the existing document page builder; hit-count histogram; Monaco language + completion source for fields, values
  (terms suggestions), operators and syntax, as Discover's autocomplete.
- Risks: Kibana's Discover search and value-suggestion endpoints are partly `internal/` and version-dependent; no
  open-source standalone KQL parser on npm (Kibana's `@kbn/es-query` is not published) so a KQL tokenizer may be
  hand-rolled; that requirement must be named per the library rule; time zone handling; large hits vs page limits
  (`MAX_PAGE_SIZE`).
- Libraries: Monaco completion seam in `MonacoHost.vue` (`completionSources`), document page builder, chart library
  (picked here; license checked per feature), TanStack Query for data views/fields, shadcn-vue popover/select.
- Tests: adapter conformance suite `adapters/kibana/*_test.go` per capability (exempt bar); complete-suite scenarios
  in the P25 harness with a Kibana + Elasticsearch container; KQL tokenizer/completion-context unit test (interacting
  rules); flow test + UI spec. No claude test.

### P425 Kibana save and update queries (Stream A)

- Scope: save the current Kibana query (query text, language, data view, time range, filters) under a name; list,
  load, rename, pin, update in place, delete. Reuses `saved_queries` and `ConsoleSavedMenu`/`SavedListMenu` with a new
  body kind, or Kibana's own saved-query objects, per the open question below.
- Risks: `scanSavedQueryRow` drops unknown kinds; a new kind needs Go model, repo, migration if `kind` is
  constrained, and TS schema in step; "update" must not silently fork a copy; conflict if the saved object changed in
  Kibana meanwhile (server-side option).
- Libraries: TanStack Query mutations + invalidation (`consoleSaved` key pattern), shared `useTextPrompt`.
- Tests: flow test (save, update, list, load) + UI spec. No unit test (CRUD). No claude test.

### P426 Proof tool visualisation (Stream A)

- Scope: new proof views (bar, line, area, pie, metric; final set in the P426 plan) with a payload shape the agent
  fills from its own tool output (e.g. Elasticsearch aggregations); Go validation and caps in `internal/proof`,
  `proof_add_step` schema/description in `internal/llmprompts`, TS schema in `proof.ts`, chart renderer in
  `ProofStepView`; screenshot and view-state persistence work for charts as for grids; edit/compare shows old and new.
- Risks: screenshot path (`modern-screenshot`) must capture canvas/SVG charts exactly; payload size caps; chart theming
  in both themes; prompt text must teach the agent the payload without ambiguity.
- Libraries: chart library from P424, `modern-screenshot` (existing), shadcn-vue chart primitive if one fits.
- Tests: proofflow flow test + UI spec; claude test row for dbmcp/proof (`bun run test:claude*`) since agent-facing
  tool text changes. Proof `validate.go` table tests only if the chart payload rules interact.

### P427 PR view (Stream B)

- Scope: one PR for GitHub and Azure: title, state, author, branches, description (Markdown), comments (read,
  conversation + review threads summary), checks status, reviewers, labels, links. New optional githost role for the
  detail read; GitHub via `gh pr view --json` / GraphQL, Azure via `az repos pr show` + threads; `fakehost.Forge`
  implements it. Opened from a task's host link and (P430) from capture. Window vs workbench tab decided in the plan,
  following the review window precedent.
- Risks: comment volume (pagination, caps); Markdown rendering must sanitise; rate limits through the existing
  per-repo breaker; Azure thread model differs from GitHub's.
- Libraries: markdown-it (existing), TanStack Query (push-invalidated, explicit refresh), shadcn-vue, Tailwind.
- Tests: flow test (fakehost) + UI spec; provider parse tests for GitHub/Azure JSON with testdata. No claude test.

### P428 Jira issue viewer (Stream B)

- Scope: one issue: key, title, status, type, priority, assignee, reporter, labels, description (ADF to Markdown or
  HTML), comments (read), linked PRs from P417. Extends `issuetracker.Issue` (or a separate detail call) and `jira`
  client fields; fakeacli covers it.
- Risks: acli `--fields` output for ADF descriptions and comments is undocumented and large (the P417 output cap
  `toolexec.ErrOutputTooLarge` already bites); comments may need `acli jira workitem comment list` if it exists.
- Libraries: existing tracker cache, markdown-it, TanStack Query.
- Tests: `jira` parse tests over testdata (ADF conversion has interacting rules); flow test + UI spec.

### P429 PR and issue comments with attachments (Stream B)

- Scope: compose and post a comment in the PR view and the issue view; attach files by picker or drag and drop;
  progress, size limits, error states; posted comment appears without a manual refresh.
- Risks: see open question 3 (GitHub has no public attachment upload API; `gh` cannot attach); Azure attachments go
  through `az devops invoke` (PR attachments REST); Jira via acli if supported. Body caps (`MaxHostCommentBytes`).
- Libraries: tiptap + `@tiptap/markdown` (existing) for the composer, VueUse `useDropZone`, TanStack mutations.
- Tests: flow test (post with and without attachment on fakehost and fakeacli) + UI spec incl. drag and drop.

### P430 Clipboard capture hotkey (Stream B)

- Scope: global hotkey registered while the process runs; popup window reads the clipboard once; classifies GitHub/
  Azure PR link (opens PR view), Jira key/link (opens issue viewer), else Later (`adeTaskCaptureTask`); Enter confirms
  the preselected action. macOS `RegisterEventHotKey` (no Accessibility), Windows `RegisterHotKey`, Linux X11; Wayland
  through the `org.freedesktop.portal.GlobalShortcuts` portal or a documented desktop-shortcut fallback.
- Risks: library choice (e.g. `golang.design/x/hotkey`, MIT, no Wayland) vs portal over D-Bus; hotkey conflicts with
  other apps need a visible failure state and a configurable chord; popup must show over other apps without stealing
  the Dock state; clipboard read is text only (Wails v3 beta.28).
- Libraries: chosen Go hotkey library (B owns `go.mod`), `internal/shell` window plumbing, existing settings store.
- Tests: classification logic is small (likely no unit test); flow test (capture IPC with a fake hotkey/clipboard
  seam) + UI spec of the popup. Real-hardware check of the hotkey on macOS is manual, noted in the plan.

### P431 Stage settings injection (Stream C)

- Scope: provider-keyed stage-settings catalog in `internal/harness` (each provider declares settings, type, range,
  mapping to env/flag/config); Claude declares auto compact limit (mapping verified against Claude Code's documented
  env or setting at plan time); workflow YAML `settings:` per step parsed/written in `adeflow`; `adewire.WorkflowStep`
  + frozen `wire.ts` gain the field (contract change, fixtures updated); applied in the run launch spec; absent means
  provider default; editor renders fields from the catalog.
- Risks: wire contract is frozen (P143 rule 1): additive field only; YAML writer must keep files without the block
  unchanged (`applySandbox` precedent); TUI vs headless launch paths both need it; unknown provider keys must fail
  validation, not vanish.
- Libraries: shadcn-vue field components, existing inspector patterns (`AdeStepAgentFields.vue`).
- Tests: `adeflow` parse tests extended (interacting validation rules); flow test (step launches with the env/flag) +
  UI spec; claude test row for launch config since Claude integration changes.

### P432 Operations panel overhaul (Stream C)

- Scope: redesign looks and interactions of the shared `OpLogPanel` and both apps' wrappers: hierarchy, density,
  status and duration display, expand/detail, filters, keyboard, context menu, running state. Studio and Space both
  inherit it.
- Risks: virtualized list row heights (`OP_ROW_PX`) and detail lines; behaviour parity across both apps' columns and
  menus; visual baselines in both apps.
- Libraries: shadcn-vue (toggle, dropdown, tooltip, collapsible), Tailwind, TanStack Virtual (existing), VueUse.
- Tests: no new feature, so no flow test; update both apps' UI specs and visual baselines for the panel.

### P433 Frontend data and memory sweep (tail, after landing)

- Scope: both apps. Audit `queryClient.ts` defaults (add `gcTime` policy), per-query overrides (`staleTime: 0` sites,
  `gcTime: 0` sites), `MainView` `KEPT_MAX` and `keepMounted` kinds, Pinia stores holding large data, page stores
  (`views/shared/page/store.ts` retention), Monaco models kept per tab, virtual lists. Tab switch never loses state
  and never refetches from UI interaction alone.
- Risks: releasing memory can reintroduce refetch on switch; Monaco model disposal vs draft retention
  (`RepoFileView` relies on cached models).
- Measurement (required by the row): heap per tab/view before and after, via the perf Playwright projects
  (`playwright.perf.config.ts` in both apps) with CDP `HeapProfiler.collectGarbage` + `Runtime.getHeapUsage` (or
  `Performance.getMetrics` JSHeapUsedSize) after opening a fixed set of tabs. "Before" is taken on the integrated
  tree right after A, B, C land, committed in the P433 plan.
- Tests: unit tests only for cache eviction rules with interacting conditions; refetch-on-switch guarded by UI specs
  that count IPC calls (`tests/ui/support/ipcCalls.ts`).

## Landing procedure

1. Orchestrator, on `chapter/v0.2.24` at the commit holding this file:
   `git worktree add -b chapter/v0.2.24-stream-a /home/user/kira-worktrees/v0.2.24-stream-a`, same for `-b`
   and `-c`. Run `bun install` and `scripts/codegraph-setup.sh` in each worktree before spawning any subagent there.
2. Stream branches are local only: `.githooks/pre-push` refuses them, and nobody pushes them.
3. Inside each worktree: per phase, Opus plan (committed), then Sonnet implementer, sequentially, per CLAUDE.md. At
   most one subagent active per stream; up to three streams concurrently, as the user asked.
4. A stream is done when its last phase is implemented, its expensive suites ran once and are green, and its hooks pass
   on normal commits.
5. Rebase order: the first stream to finish rebases first. When all finish together, land A, then C, then B (fewest
   union-file conflicts first; B is largest). Each: `git -C <worktree> rebase chapter/v0.2.24`, resolve only the named
   union files, rerun fast checks (`bun run typecheck`, `bun run lint`, Go build/test of touched packages), then on
   the main checkout `git merge --ff-only chapter/v0.2.24-stream-<x>`.
6. After each landing the orchestrator updates SPEC.md rows of that stream (Done + Result copied from the plan files)
   in its own commit, then pushes `chapter/v0.2.24`.
7. After all three land: `git worktree remove` each, `git branch -d chapter/v0.2.24-stream-{a,b,c}`, push.
8. Tail on `/home/user/kira-studio`: P433 (plan, implement, measure), then P434 two review rounds over the diff since
   `main`, then P435 close.
9. A worktree survives a container restart: resume a stopped stream from its last commit and its plan files.

## Open questions for the user

1. P424/P425: does the Kibana connection talk to Kibana's HTTP API (data views, Discover's KQL/Lucene search, as in
   Discover) or to Elasticsearch directly? Is ES|QL in scope, or KQL and Lucene only?
2. P425: save queries in Kira (local `saved_queries`, per connection) or as Kibana saved queries (server-side, visible
   in Kibana's own Discover)?
3. P429: GitHub has no public API to upload comment attachments, and `gh` cannot attach files. Options: (a) attach on
   Azure and Jira only and show GitHub as unsupported, (b) upload elsewhere (e.g. a gist for text files) and link it,
   (c) inline small text attachments as fenced blocks. Which?
4. P426: "Elastic brings visualisations": generic charts the agent fills from any data (assumed), or rendering Kibana's
   own saved visualisations?
5. P432: confirm the overhaul applies to both apps (the panel component is shared), not Kira Space only.

## Decisions (orchestrator, user said work autonomously)

1. Kibana HTTP API (data views, KQL and Lucene). ES|QL out of scope.
2. Saved queries live in Kira, local, per connection.
3. Attachments on Azure and Jira only. GitHub shows unsupported.
4. Generic agent-filled charts, not Kibana saved visualisations.
5. Overhaul applies to both apps (shared panel).
