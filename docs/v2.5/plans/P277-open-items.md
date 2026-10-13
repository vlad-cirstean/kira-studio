# P277 plan: Known open items cleanup

Ask (SPEC row P277): fix eight `docs/ARCHITECTURE.md` "Known open items" at root cause, then delete each
entry as it closes. (1) Space review sync popover never positioned under WebKit; restore a real click.
(2) Load-sensitive specs and tests; fix cause, no retries, no longer waits. (3) `ui-timing` failures; fix
performance or load behaviour, never loosen a budget. (4) Registry button links local images to Docker
Hub under the containerd store. (5) Semantic model download has no URL seam; add the install flow test.
(6) Missing `claude` shows the shell's raw text; check before launch, show a Kira error. (7) Unhiding one
imported repo mid-folder-scan is re-hidden. (8) `adapters/clickhouse` fails at `-count>1`; isolate per
run. Out of scope, entries stay: quit discarding unsaved edits; sandbox visual baselines; English-only
backend, git-core and `@vue-flow` text.

Hard rules for every implementer: never loosen a timing budget or an explicit sub-default timeout; no
retries (`toPass`, retry loops, `--retries`); no longer waits; no skipped tests; fix at root cause; every
fixed item gets a guard test (flow plus UI pairing where behaviour changes). An item that truly cannot be
fixed in the sandbox keeps its Known open items entry with a stated, measured reason.

Base: `v2.0` at `d5e597769`. Discovery ran through `codegraph_explore`: `PopoverContent`, `PopoverTrigger`,
`PointPopover`, `AdeReviewSync.vue`, `ResizeHandle`/`usePaneResize`, `CommitGrid` (`scrollToTopRow`,
`getViewportTop`), `GraphViewState`/`AUTO_REFRESH_COALESCE_MS`, `registryURL`/`splitRef`, `Image`,
`ContainerDetail`, `ResourceDetail.vue`, `embed.Spec`/`Default`, `modelstore.Install`, `embed.Client`,
`SemanticModelSection.vue`, `mcpinstall.locateClaude`, `toolexec.Locate`, `terminal.newSession`,
`Registry.Open`, clickhouse `nextQueryID`/`Cancel`, `OpsService.Cancel`, fakeagent recording. Targeted
reads where the index had no hit: `AdeReviewSync.vue`, `ade-v2-review.spec.ts`, `BranchPicker.vue`
(popover/tooltip nesting), reka-ui 2.10.5 `PopperAnchor.js`, `PopperContent.js`, `TooltipRoot.js`,
`PopoverTrigger.js`; `ade/command.go`, `tracker.go` `Prepare`; `repoconfig.go` `importFolder`,
`aderepoconfig.go` `SetFolderHidden`/`ApplyFolderHidden`; `adeflow/schedule_test.go`, `automation_test.go`
`waitCall`, `fakeagent.go` `pickAction`/`nextCount`/`recordEnv`; `testsupport/clickhouse.go`,
`clickhouse_test.go`; `grpcflow/describe_test.go`; `termflow/schedule_test.go`; spec files of item 2;
both `playwright.config.ts`; P271-P276 result sections.

Live probes at base (sandbox `dockerd`, containerd store `io.containerd.snapshotter.v1`):
`FROM scratch` built as `p277probe:dev` gets RepoDigest `p277probe@sha256:cfe2…` (item 4 confirmed);
engine `GET /distribution/<ref>/json` answers Hub `toomanyrequests` for a pulled `redis:8.10` and
`unauthorized` for the local build (unusable as a signal).

What P275 and P276 resolved incidentally: none of the eight entries. Flakes they recorded stay open and
join item 2 (2.2 table): `TestUnaryDeadline`, `TestDescribeCancel` (grpcflow), `TestScheduleHeadless/stop`
(Space termflow), Studio `grid-commit-in-flight` "inline edit open at Commit", Studio `ui-leftovers`
"Close others over a dirty tab", `ipcfixture` MySQL snapshot, Space `repo-graph-refresh` scroll.
`adapters/clickhouse` `QUERY_WITH_SAME_ID_IS_ALREADY_RUNNING` (P272, P273) is item 8.

## 1. Item 1: review sync popover (root cause found)

- `AdeReviewSync.vue:126-141`: `Popover` > `Tooltip` > `TooltipTrigger as-child` > `span` >
  `PopoverTrigger as-child` > `Button`.
- reka `TooltipRoot` renders its own `PopperRoot`. `PopoverTrigger` renders `PopperAnchor` unless the
  popover has a custom anchor; `PopperAnchor` injects the nearest `PopperRoot`, which is the tooltip's.
  The popover's own popper root never gets an anchor, so `useFloating` has no reference, `isPositioned`
  stays false and `PopperContent` keeps `transform: translate(0, -200%)`. Matches the entry exactly
  (box at y=-274). Not WebKit-specific; Space UI runs WebKit only.
- `BranchPicker.vue:416-434` already solves it: `PopoverAnchor as-child` wraps the tooltip, so
  `hasCustomAnchor` is set and the trigger renders no anchor. That is why other popovers position fine.
- Fix: same shape in `AdeReviewSync.vue` (`PopoverAnchor as-child` outside `Tooltip`). Keep the span (a
  disabled button receives no pointer events; the tooltip needs it).
- Guard: `ade-v2-review.spec.ts` both `dispatchEvent('click')` calls become real `.click()`; new assertion
  in "the sync button lists…": popover box `y >= 0`, top edge within 16 px below the trigger's bottom
  (align end: right edges within 2 px). Fails at base, passes after.
- Repo sweep (guard against recurrence): `rg -U 'TooltipTrigger[^>]*>\s*(<span>\s*)?<PopoverTrigger'`
  over `*.vue`; at base only `AdeReviewSync.vue` lacks the anchor (`BranchPicker` has it,
  `ConnectionGeneralTab` does not nest). Any new hit gets the same fix in the same commit.

## 2. Item 2: load-sensitive specs and tests

### 2.1 Method (all entries)

1. Load: 8 busy loops on 4 CPUs (`for i in $(seq 8); do (while :; do :; done) & done`; `stress-ng` is not
   installed), load average above 16 before starting. Kill the loops after each run.
2. Repro: UI `npx playwright test --config=apps/<app>/playwright.config.ts --project=ui <spec> -g
   '<title>' --repeat-each=40 --workers=8 --trace=retain-on-failure`; Go `go test -run '<name>'
   -count=40 ./<pkg>`. Record failures out of runs, the failing assertion and the trace's decisive step.
3. Classify the cause, one of: (a) wall-clock coupling in the test (`waitForTimeout`, `time.Sleep` as a
   synchroniser, a timer race against a sub-default timeout); (b) app race (state read or written before
   it settles); (c) test acts before its own precondition holds.
4. Fix: (a) drive app timers deterministically (Playwright `page.clock` installed before page scripts,
   `fastForward`/`runFor` past the app constant; Go `fakeclock`) or wait on an app-emitted signal; (b) fix
   the app, and give the race a deterministic guard; (c) wait for the precondition's own observable
   state. An explicit sub-default timeout is never raised or removed; `toPass` and retry loops are
   removed, not added.
5. Accept: same load, same command, 0 failures in 40 (Go 40). Record before/after counts in section 14.
6. Not reproduced in 3 x 40 runs under load and no type (a)-(c) cause visible in code: entry stays in
   Known open items with the counts. Never fix blind.
7. Findings go to `docs/v2.5/plans/P277-load-findings.md` (one line per entry: repro count, cause type,
   cause, fix commit), committed before the first fix and updated per fix commit. Close-out deletes it
   after moving the counts into section 14.

### 2.2 Entries, cause known or hypothesis to confirm first

| Entry | Where | Cause (status) | Fix direction |
|---|---|---|---|
| `TestScheduleADE` | `adeflow/schedule_test.go:80`, `internal/flowtest/fakeagent/fakeagent.go` `pickAction` | Found: fakeagent writes `.args` first, then `.cwd`, `.env`, `.mcpN`; `waitCall` waits for `.args` and the test reads `api-2.env` before it exists (type b, harness). Also `nextCount` read-modify-write races between concurrent fake processes. | fakeagent writes every side file first, `.args` last, each via write-temp-then-rename (`renameio`, already a dependency): `.args` is the "call recorded" marker. `nextCount` claims `n` with `O_CREATE|O_EXCL` on `<stem>-<n>.claim`, incrementing until it wins. Both apps share fakeagent, so every `waitCall`/`callFile` user gains it. |
| `TestDescribeCancel` | `grpcflow/describe_test.go:185` | Hypothesis: `time.Sleep(300ms)` then `Ops.Cancel`; under load Cancel lands before Describe registers its op, Cancel finds nothing, Describe runs to its timeout (types a and b). | Product: ops registry keeps an early-cancel tombstone for an unknown op id (60 s TTL, 256 entries max); registering a tombstoned id cancels at once. Test: replace the sleep with waiting for `flowharness.Silent`'s accepted-connection signal (add `Accepted()` channel if absent). |
| `TestUnaryDeadline` | `describe_test.go:230` | Hypothesis: 400 ms deadline expires during dial under load; error is classified as connect failure without "400ms". | Error classification names the call deadline whatever phase it expires in; no change to the 3 s bound. Confirm by repro first. |
| `TestScheduleHeadless/stop` | Space `termflow/schedule_test.go` | Hypothesis: run turns `running` before its stop handle is registered; Stop in that window is lost. | Register the stop handle before publishing `running`, or record a pending stop applied at registration. Deterministic guard: Go test with a gated start hook if the scheduler has one; otherwise the repro loop is the guard. |
| `ipcfixture` MySQL snapshot | `apps/kira-studio/internal/ipcfixture` | Unknown; needs `dockerd`. | Repro first (method 2.1), classify, fix. |
| Space `repo-graph-refresh` "refsChanged…other kinds do not" | `repo-graph-refresh.spec.ts:37` | Type a: `waitForTimeout(600)` and a 1 s poll racing `AUTO_REFRESH_COALESCE_MS` (250 ms) under load. | `page.clock`: fire the coalesce window by `fastForward`; assert the negative and positive counts after it, no wall wait. Keep the 1 s poll bound. |
| Space `repo-graph-refresh` "a refresh keeps the scroll position" (P271, P276) | same file `:53`; `git-ui/src/App.vue` `watch(graphView.loading)`, `CommitGrid.scrollToTopRow` | Unknown; trace first. Candidate: the viewport row is captured after the refresh reset the grid, or the restore runs before the new rows lay out. | App fix at cause. P278 (next phase) also edits `CommitGrid.vue`; P277 lands first, so no clash. |
| Space `repo-graph-paging` drag and `closeDetail` | `repo-graph-paging.spec.ts:283-300` | Found for `closeDetail`: type c plus a retry (`toPass`): Escape pressed before the detail pane opened is lost. Drag: unknown. | `closeDetail` waits for the pane's own visible state, presses Escape once, asserts the handle; `toPass` removed. Drag: repro, then fix. |
| Space `repo-graph-columns`, `-badges`, `repo-workspace` (1 s-class waits) | those specs | Unknown per test; repro each. | Per method. |
| Space `ade-v2-panel` handle-drag | `ade-v2-panel.spec.ts:283` | Hypothesis: `startWidth` read from `aria-valuenow` before the layout store hydrates the stored width (type c or b). | Wait on the hydrated width (or fix the panel so its first render already holds it). |
| Studio `sql-schema` "Schema (DDL)… dialog stages until Save (D3)" | `sql-schema.spec.ts:88` | Unknown; repro. | Per method. |
| Studio `tooltips` a11y | `tooltips.spec.ts:158` | Type a: `waitForTimeout(350/150/100)` against the 400 ms provider delay. | `page.clock` drives the tooltip delay and skip-delay timers. |
| Studio `http-timeline` failed-send | `http-timeline.spec.ts:316` | Unknown; repro. | Per method. |
| Studio `grid-commit-in-flight` | `grid-commit-in-flight.spec.ts:104,125` | Unknown; `waitForTimeout(300)` at `:154` is suspect (type a). | Per method. |
| Studio `ui-leftovers` "Close others over a dirty tab" | `ui-leftovers.spec.ts` | Unknown (60 s test timeout hit under load). | Per method; find what dominates the 60 s. |

Shared helper: `tests/ui/support/clock.ts` per app (new) wraps clock install and the app constants
(`AUTO_REFRESH_COALESCE_MS`, tooltip delays) imported from source, not copied.

## 3. Item 3: `ui-timing`

Metrics: console keystroke p50 (`budgets.spec.ts:918`, 50 ms), scroll frame p95 (80 ms), cached tree
expand p95 (`:893`, 50 ms), `perf.spec.ts:191` scroll p95 (80 ms). Budgets untouched.

1. Idle baseline: `uptime` 1-minute load below 1.5, no other suite running, then
   `npx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui-timing --no-deps` 3 times.
   Record every metric per run.
2. Load-behaviour check: run `bun run test:ui:studio` (ui then ui-timing in one invocation) from an idle
   start; at the moment ui-timing begins, record `uptime` and `ps` of leftover `WebKitWebProcess`,
   `playwright`, `vite` processes. If idle runs pass and the full run fails, the cause is load left by
   `ui` (leaked browsers or servers): fix the leak in the fixtures or config teardown so the machine is
   idle when ui-timing starts. No load-wait gate (that is a longer wait).
3. Idle failure: attribute each failing metric. Instrument with `performance.mark`/`measure` around the
   handler under test; for call-level attribution run the same spec once under Chromium with a CDP
   profile (`page.context().newCDPSession`, `Profiler`), then confirm the fix on WebKit. Fix the hot
   path (render work per keystroke, per scroll frame, per tree expand). Library-first (CLAUDE.md).
4. Accept: 3 consecutive ui-timing passes, idle, plus one full `bun run test:ui:studio` pass from idle.
5. A metric still over budget after a measured fix, with the residual attributed to sandbox CPU (for
   example WebKit software paint time with app work already under budget): its entry stays, rewritten
   with the new numbers and the attribution. Close-out decides from section 14's numbers.
6. Findings: `docs/v2.5/plans/P277-timing-findings.md`, same rules as 2.1 step 7.

## 4. Item 4: registry link for local images

Rule (final):

- Engine store type read once per endpoint from `Info().DriverStatus` (`driver-type`
  `io.containerd.snapshotter.v1`), cached on `Manager`, reset with the client.
- Classic store: today's rule (a RepoDigest proves a push or pull).
- Containerd store, reference names an explicit registry host: today's rule. Why: the name states the
  registry; an unpushed `ghcr.io/x/y:dev` is the user's naming choice.
- Containerd store, implied Docker Hub (no host): link only when Hub confirms the repository exists:
  `GET <hubAPI>/v2/repositories/<ns>/<repo>/` returns 200. 404 or any error: no link. Why: Hub's
  repository API is the exact page the link opens, is anonymous and not pull-rate-limited; the engine's
  distribution endpoint is rate-limited and unusable (probe above). A private Hub repo gets no link
  (anonymous 404): accepted.
- Cache: positive and negative per `<ns>/<repo>` for the Manager's life. Errors (network) are not cached.

Shape:

- List stays cheap: `Image.RegistryURL` and `ContainerDetail.RegistryURL` are removed from the list and
  inspect payloads. New bound method `DockerService.ImageRegistry(IDArgs) (RegistryLink{URL string},
  error)` resolves one image lazily. Why: one Hub call per image in the list would cost N requests per
  list load.
- UI: `useImageRegistry(imageId)` TanStack query in `packages/docker-ui/src/queries.ts`
  (`staleTime: Infinity`, keyed by image id); `ResourceDetail.vue` and `ContainerDetail.vue` read it.
  Button hidden while loading or empty.
- Seam: `docker.Manager.HubAPI` (default `https://hub.docker.com`), set from Studio `appwire.Options.DockerHubAPI`;
  flowharness points it at an `httptest` server.
- `internal/docker/registry.go` becomes the pure rule over (store, tags, digests, hub verdict);
  `registry_test.go` unit table only if the rule ends with 3 or more interacting branches (CLAUDE.md
  bar); the flow test is the primary guard.

## 5. Item 5: semantic model URL seam and install flow test

- `embed`: `HFBaseURL = "https://huggingface.co"`; `Default` file URLs built from it plus the pinned
  path. `func (s Spec) WithBaseURL(base string) Spec` returns a copy with every file URL's scheme and host
  replaced.
- Space `appwire.Options.EmbedSpec *embed.Spec` (nil: `embed.Default`); `bridge.MemoryService` takes the
  spec from wiring instead of `embed.Default` at `memory.go:87,315,316`. Why a whole-spec seam, not only a
  base URL: pinned SHA-256s make a success path impossible with fake bytes under `Default`; the test
  spec carries its own small files and hashes. The base-URL seam is still exercised: the checksum case
  uses `Default.WithBaseURL(srv.URL)`.
- `memorycli` (`run.go:44`, `ingest.go:44`) keeps `embed.Default`; no seam needed there.
- Flow tests (`memoryflow/semantic_test.go`), fake HF `httptest` server serving the pinned path layout:
  - `TestInstallSemanticModel`: test spec (two files of a few KB, real hashes); `InstallSemanticModel`
    returns nil; status passes `downloading` with growing `done` (server writes in chunks behind a gate
    the test opens); manifest present; files match; contract `MemoryService.SemanticStatus#downloading`
    and `#installed` (state after install as the service reports it with the fake worker command absent:
    record whatever the service truly reports, masked).
  - `TestInstallSemanticModelChecksum`: `Default.WithBaseURL(srv.URL)` serving wrong bytes for
    `model.onnx` path; error is the checksum Kira error; no `.part` or model file left; state
    `notInstalled`; contract `MemoryService.InstallSemanticModel#checksum`.
  - Existing `TestInstallSemanticModelCancelled` moves onto the fake server (no real network).
- UI (`settings-memory.spec.ts`): download click shows progress from `#downloading`, then the post-install
  state; checksum contract shows `memory-semantic-error` with the catalog text.

## 6. Item 6: missing `claude`

- One resolver: `toolexec.ResolveClaude(ctx, deps) (path string, probed []string, err error)`:
  `toolexec.Locate` (PATH plus `ClaudeCandidates`) first; on a miss, the user's login shell
  `$SHELL -l -i -c 'command -v claude'` with a 5 s timeout, because launches run through that shell
  (`terminal.newSession`) and a GUI app's PATH can differ from it. Both miss: `ErrClaudeMissing`.
  An absolute `ClaudeBin` (tests) passes through `IsExecutable`.
- Callers: Space `ade.Tracker.Prepare` (covers `LaunchStage`, review agent, step runs: every
  interactive launch builds its command there) before composing the command; `terminal.BoundService.Open`
  for `LaunchKindClaudeCode` (covers Studio and Space automations launches). Headless runs
  (`claudeheadless`) already exec `claude` directly and fail with an exec error: map that
  `exec.ErrNotFound` to the same Kira error in `claudeheadless/process.go`.
- Error: `ipcerr.T(ipcerr.CodeNotFound, "backend.core.claude.missing.body", {probed})`, catalog text
  (en.json, CLAUDE.md style): "Claude Code CLI not found. Install it, then try again. Looked in: {probed}."
  A pipeline step that cannot launch fails with that text as its outcome reason.
- No new Vue component: errors surface through each launch point's existing error display. If a launch
  point shows nothing, Stream A records it in its result lines and the sequential step C (9.2)
  adds the display (files owned by Stream B).
- Flow tests: Space `adeflow/claude_missing_test.go` `TestLaunchWithoutClaude` (harness `BinDir` without
  the fake `claude`, PATH limited to it, `SHELL` pointing at a stub that exits 1): `LaunchStage` returns
  the Kira error, no terminal opened, contract `AdeTaskService.LaunchStage#claudeMissing`. Studio
  `termflow` `TestClaudeCodeLaunchWithoutClaude`: `Terminal.Open` with `launchKind: claude-code` returns
  it, contract `TerminalService.Open#claudeMissing`.
- UI specs: Space `ade-claude-missing.spec.ts` (launch from the board shows the catalog text), Studio
  `terminal-claude-missing.spec.ts` (Claude Code launch shows the text in the tab's failed state).

## 7. Item 7: unhide re-hidden by a folder scan

- Cause (confirmed by reading): `importFolder` reads `folderHidden` at start; a flip during the scan
  hides the repos whose `source` row already exists; the user unhides one; scan end sees the flag changed
  and `ApplyFolderHidden` over all imported ids re-hides it. No per-repo version tells the scan its
  value is stale.
- Fix: migration adds `code_repos.hidden_rev INTEGER NOT NULL DEFAULT 0`. Every write of `hidden`
  (import, per-repo toggle, `SetFolderHidden`'s bulk UPDATE, `ApplyFolderHidden`) sets
  `hidden_rev = hidden_rev + 1` in the same statement. `importFolder` keeps each imported repo's rev as
  of import; `ApplyFolderHidden(path, []ImportedRev)` updates only rows whose `hidden_rev` still equals
  that rev. Why a counter, not a timestamp: no clock ties, one integer compare.
- Guards (concurrency: CLAUDE.md allows): `repos` package `TestApplyFolderHiddenSkipsChangedRepos` on
  real SQLite: import A and B at rev r; flip folder hidden (covers A, source set; B not yet); user
  unhides A; `ApplyFolderHidden` hides B and leaves A visible. `ade` package test drives `importFolder`
  with an import hook (`TaskBoard` test seam called after each repo import) that flips the folder and
  unhides the first repo mid-scan; asserts the final state. No UI spec: no UI behaviour changes; the
  existing unhide spec covers the visible path.

## 8. Item 8: `adapters/clickhouse` at `-count>1`

- Cause: `clickhouseMemo` starts one container per test process, so `-count=2` runs the same tests
  against state the first iteration mutated (inserts, DDL scratch tables, sentinel tables), with the
  same literal op ids (`op-1`, `op-13`, …), so a still-running query id from iteration 1 can collide
  (`QUERY_WITH_SAME_ID_IS_ALREADY_RUNNING`).
- Fix: `testsupport.ClickHouseRun(t)`: per top-level test invocation, admin drops `kira_test` (`SYNC`),
  recreates it, reruns the seed, re-grants (grants are idempotent statements already in
  `startClickHouse`; factor them into one function both call). Every test calls it first (after
  `StartClickHouse`). Op ids: helper `opCtx(t, name)` = `name + "-" + per-process run nonce + counter`;
  every literal `adapters.NewOpCtx("op-…")` in the package's tests switches to it.
- Guard: `go test -count=3 ./apps/kira-studio/internal/adapters/clickhouse/` passes (needs `dockerd`).
  Repro at base first: record which assertions fail at `-count=2`.
- Same pattern check: grep the other adapter packages for the memo plus mutation; fix any with the
  same defect only if `-count=2` fails there (record result either way).

## 9. Execution

### 9.1 Split: two streams, then a sequential step

Stream A (Go and cross-cutting items 4-8, Go entries of item 2) and Stream B (frontend-only: item 1,
UI entries of item 2) touch disjoint files (9.3) and share no ordering: A never reads B's changes and
B never reads A's. Item 3 does not run in a stream: it needs an idle machine, and two concurrent streams
are exactly the load that breaks its measurements. It runs as step C after both streams land.

Load during streams: Stream B's repros add deliberate load anyway; its acceptance runs (2.1 step 5)
happen in 9.4, after landing, on a machine running nothing else.

Worktrees per `CLAUDE.md`: both off `d5e597769`. Each stream: typecheck and lint per commit
(`bun run typecheck`, `bun run lint`, `bun run lint:go` alone, never two `golangci-lint` at once:
streams take turns, on a lock error wait 60 s, then rerun). `bun run build:space-mobile` once per
worktree before `lint:go`. Docker items need `dockerd` (already running in the sandbox; check `docker
info` first).

### 9.2 Order and commits

Stream A:

1. fakeagent ordering and claim (2.2 row 1). `fix(flowtest): fake agent records args last and claims call numbers atomically`.
2. Item 8. `test(clickhouse): isolate each run's database and op ids`.
3. Item 7 (migration, repos, ade, tests). `fix(ade): folder scan never re-hides a repo changed since import`.
4. Item 5 (embed, Space appwire/flowharness, bridge, flow tests, contracts, UI spec). `feat(memory): injectable model source, install flow test`.
5. Item 6 (toolexec, tracker, terminal, claudeheadless, en.json, flow tests, contracts, UI specs). `feat(claude): check the CLI before launch, show a Kira error`.
6. Item 4 (docker, docker-ui, appwire/flowharness, flow test, contract, UI spec). `fix(docker): registry link only for images a registry holds`.
7. Go entries of 2.2 (`TestDescribeCancel`, `TestUnaryDeadline`, `TestScheduleHeadless/stop`,
   `ipcfixture` MySQL): repro, findings lines, fix, one commit per root cause.

Stream B:

1. Item 1. `fix(ade-ui): anchor the review sync popover outside its tooltip`.
2. Repro pass over every UI entry of 2.2 under load; write `P277-load-findings.md`. `docs: P277 load findings`.
3. Fixes, one commit per root cause (`fix(...)` for app races, `test(...)` for spec-side causes), each
   updating its findings line.

Landing: each stream verified (its own commits pass typecheck, lint, its touched Go packages and specs
alone), rebased onto `v2.0` in either order (a conflict means the ownership table was wrong: stop and
report), worktrees removed. Do not push until close-out.

Step C (one Sonnet, after landing, idle machine): item 3 (section 3), plus any launch-point display
Stream A recorded for item 6. `perf(...)` commits per hot path; findings file commits.

### 9.3 File ownership (zero overlap)

| Stream | Owns |
|---|---|
| A | `internal/flowtest/fakeagent/**`; `apps/kira-studio/internal/adapters/{clickhouse,testsupport}/**`; `apps/kira-space/internal/storage/{migrations,repos}/**`; `apps/kira-space/internal/ade/**`; `internal/memory/embed/**`, `internal/memory/modelstore/**`; `apps/kira-space/internal/{bridge,appwire,flowharness}/**`; `apps/kira-studio/internal/{appwire,flowharness,ipcfixture,bridge,grpcclient}/**`; `internal/{toolexec,terminal,claudeheadless,docker}/**`; ops registry package (wherever `OpsService.Cancel` resolves); `packages/docker-ui/**`; `packages/workbench/src/memory/settings/**`, `packages/workbench/src/memory/queries.ts`; `packages/theme/src/i18n/en.json`; all Go `*_test.go` under `apps/*/internal/flows/**`; `apps/*/tests/contract/**`; `apps/*/tests/ui/support/{ipcChannels,mockRuntime}.ts`; new specs `apps/kira-space/tests/ui/ade-claude-missing.spec.ts`, `apps/kira-studio/tests/ui/terminal-claude-missing.spec.ts`; edits to `apps/kira-space/tests/ui/settings-memory.spec.ts`, `apps/kira-studio/tests/ui/docker-module.spec.ts` (or the docker spec that covers the registry button) |
| B | `apps/kira-space/frontend/src/ade/v2/{review,panel}/**`; `packages/git-ui/**`; `packages/theme/src/components/**`; `apps/kira-studio/frontend/src/**` (Studio views: grid, console, schema dialog, http timeline, tabs); `apps/*/tests/ui/support/clock.ts` (new), `apps/kira-space/tests/ui/support/{gitStreamMock,gitUiPortFixtures}.ts`; specs `ade-v2-review`, `ade-v2-panel`, `repo-graph-*`, `repo-workspace` (Space); `sql-schema`, `tooltips`, `http-timeline`, `grid-commit-in-flight`, `ui-leftovers` (Studio); `docs/v2.5/plans/P277-load-findings.md` |
| Neither (step C or close-out) | `apps/kira-studio/playwright.config.ts`, `apps/kira-space/playwright.config.ts`, `apps/*/tests/ui/fixtures.ts`, `budgets.spec.ts`, `perf.spec.ts` (never budget edits), `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `docs/v2.5/SPEC.md`, this plan, `P277-timing-findings.md` |

A file needed outside its stream's row: stop, record it in the findings file, and leave it for step C.
Never edit the other stream's file.

### 9.4 Serial test-and-fix (one Sonnet, after step C)

One suite at a time, idle start for each: `bun run lint`, `bun run lint:go`, `bun run typecheck`,
`go test ./... -count=1`, `bun run test:flows:space`, `bun run test:flows:studio`,
`KIRA_FLOW_DOCKER=require bun run test:flows:studio` docker packages, `go test -count=3
./apps/kira-studio/internal/adapters/clickhouse/`, `bun run test:unit`, `bun run test:ui:space`,
`bun run test:ui:studio` (ui plus ui-timing), visual both apps only if a changed surface has a
baseline (docker detail, memory settings: check). Then 2.1 step 5 acceptance runs for every fixed
entry. Then real `claude` rows (section 10). Fix at cause, commit per group.

### 9.5 Close-out (one Sonnet)

Delete each closed Known open items entry in `docs/ARCHITECTURE.md`; rewrite any that stays with its
measured reason; the "Load-sensitive" entry shrinks to the entries not closed, or goes. Delete the
`clickhouse -count>1` entry. `docs/DEV_ENVIRONMENT.md`: "Load, disk and test scope" loses the
"rerun alone" advice for closed entries; adds the 2.1 load recipe as the repro method. Architecture
notes: docker registry rule (store type, Hub check, lazy method), model source seam, claude resolver,
`hidden_rev`. Move findings counts into section 14; delete both findings files. SPEC P277 Done.
Commit `docs: P277 close-out`.

## 10. Real `claude` rows (opt-in, after 9.4)

Item 6 changes launch code (`ade.Tracker.Prepare`, `terminal` claude-code path, `claudeheadless`), so
run `bun run test:claude:space -run 'TestAdeHeadlessRun|TestAdeStepResults|TestAdeStageSession|TestAdeRebaseRun|TestSmartScriptRun'`
and `bun run test:claude:studio`. They prove the resolver finds a real `claude`. Report spend.

## 11. Tests summary

Split at the IPC boundary (same scenario, same contract):

| Scenario | Go flow | UI spec |
|---|---|---|
| Registry link: local unqualified image has none, Hub-known image has one | `dockerflow/registry_test.go` `TestImageRegistryURL` extended: commit an unqualified local tag (fake Hub 404) and tag the harness image under a name the fake Hub knows (200); `DockerService.ImageRegistry` per image; contracts `#local`, `#hub` | docker detail: button hidden for `#local`, shown and opening the URL for `#hub` |
| Model install success and checksum failure | `TestInstallSemanticModel`, `TestInstallSemanticModelChecksum` | `settings-memory.spec.ts`: progress then installed state; checksum error text |
| Launch without `claude` | `TestLaunchWithoutClaude` (Space), `TestClaudeCodeLaunchWithoutClaude` (Studio) | `ade-claude-missing.spec.ts`, `terminal-claude-missing.spec.ts` |

Backend-only (no UI behaviour): `TestApplyFolderHiddenSkipsChangedRepos` plus the `ade` scan-hook test
(item 7); clickhouse `-count=3` (item 8); fakeagent-backed `TestScheduleADE` under load (2.2).
UI-only (no backend change): item 1 real click and position; item 2 UI entries' acceptance loops.

No new unit tests beyond item 7's concurrency test and, only if it qualifies, item 4's rule table.

## 12. Verification (orchestrator, real checks)

1. `rg -n "dispatchEvent" apps/kira-space/tests/ui/ade-v2-review.spec.ts`: none. `rg -n "PopoverAnchor" apps/kira-space/frontend/src/ade/v2/review/AdeReviewSync.vue`: one hit.
2. `rg -n "toPass\(" apps/*/tests/ui/{repo-graph-*,ade-v2-panel,sql-schema,tooltips,http-timeline,grid-commit-in-flight,ui-leftovers,repo-workspace}.spec.ts`: none added; `repo-graph-paging` `closeDetail` has none.
3. `git diff d5e597769 -- apps/kira-studio/tests/ui/budgets.spec.ts apps/kira-studio/tests/ui/perf.spec.ts` shows no budget number changed; `git diff d5e597769 -G'timeout: *[0-9]' -- apps/*/tests/ui` shows no explicit timeout raised.
4. `rg -n "waitForTimeout" ` in the specs of 2.2: each remaining hit has a findings line saying why it is not a synchroniser.
5. Findings files list every 2.2 entry with before/after counts under the 2.1 load; section 14 holds them after close-out.
6. `rg -n "registryURL\(" internal/docker` shows the store-aware rule; `rg -n "ImageRegistry" packages/docker-ui/src` shows a real query and both detail components using it; `rg -n "RegistryURL" internal/docker/resources.go` none.
7. `rg -n "embed.Default" apps/kira-space/internal/bridge/memory.go`: none (spec from wiring); `rg -n "WithBaseURL" apps/kira-space/internal/flows/memoryflow`: used.
8. `rg -n "ResolveClaude" apps internal --glob '!*_test.go'`: callers in `ade/tracker.go` and `terminal/bound.go`; `backend.core.claude.missing.body` in en.json and both flow contracts.
9. `rg -n "hidden_rev" apps/kira-space/internal/storage`: migration plus every hidden write.
10. `go test -count=3 ./apps/kira-studio/internal/adapters/clickhouse/` green in the 9.4 log.
11. Item 3: three idle ui-timing runs and one full `test:ui:studio` with per-metric numbers in section 14, all within budget; or the entry rewritten with measured attribution.
12. Planner and implementer tool logs show `codegraph_explore` calls for discovery beyond this plan.
13. `docs/ARCHITECTURE.md` Known open items: every closed entry gone, each remaining one with a measured reason.

## 13. Decisions log (final)

- Item 1 fix is `PopoverAnchor` outside the tooltip: reka anchors to the nearest popper root, which the tooltip owns; `BranchPicker` precedent.
- Popover position asserted, not only visibility: the bug was an off-screen box that still counted as visible.
- Recorded P271-P276 flakes join item 2: same class, the row says "P230 and later", leaving them keeps "rerun alone".
- Load recipe 8 busy loops, 40 repeats: reproduces the "load above 16-20" condition the entries name, without a new tool.
- Timer-driven specs use `page.clock`, Go uses `fakeclock`: deterministic, no longer wait, no retry.
- Explicit sub-default timeouts never raised or removed: removing one falls back to a longer default wait.
- Non-reproducible entry stays open with counts: never fix blind.
- fakeagent writes `.args` last, atomically: one marker means "call fully recorded" for every test.
- `nextCount` claims with `O_EXCL`: concurrent fake calls never share a number.
- Early-cancel tombstone in the ops registry: a real user cancel can also beat registration.
- ui-timing runs in step C, not a stream: it needs an idle machine.
- No load-wait gate for ui-timing: a gate is a longer wait; leaked processes get fixed instead.
- Registry rule gated on containerd store and implied Hub: only that case lacks a pull signal.
- Hub repository API as the signal: it is the page the link opens; engine distribution endpoint is rate-limited.
- Lazy `ImageRegistry` method: N Hub calls per list load is too costly.
- Explicit-host references keep today's rule: the name states the registry.
- Whole `EmbedSpec` seam plus `WithBaseURL`: pinned hashes block a fake-bytes success path under `Default`.
- `memorycli` keeps `embed.Default`: no test needs its seam.
- Claude resolver tries PATH and candidates, then the login shell: launches use the login shell's PATH.
- Check in `Tracker.Prepare` and `terminal` Open for claude-code: every interactive launch passes one of them.
- Headless `exec.ErrNotFound` mapped to the same error: one message for one cause.
- `hidden_rev` counter with compare-and-set: no clock ties; skips repos changed since import.
- ClickHouse reseed per run plus unique op ids: per-run isolation without a container per test.
- Two streams plus step C: zero-overlap files and no ordering between A and B; item 3 isolated for measurement.
- Known open items deleted at close-out, not by streams: avoids both streams editing `ARCHITECTURE.md`.

## 14. Result

Pending.
