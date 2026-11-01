# P433 plan: frontend data and memory sweep

Goal: tab switch keeps view state and does not refetch; frontend RAM stays minimal and returns to
baseline on close. Both apps (Studio, Space).

## Scope and base

- Stream D, worktree `kira-worktrees/v0.2.24-stream-d`, branch `chapter/v0.2.24-stream-d`.
- Base `24b452bb9` (chapter/v0.2.24 with stream A P424-P426 landed). Stream B (P429-P430) and C
  (P432) still in flight; sweep covers frontends as they stand on this base.
- Discovery: 16 `codegraph_explore` calls, then targeted reads of config/docs not indexed.
- Manifest ownership (`streams.md`): no edit to `package.json`/`bun.lock` (A) or `go.mod` (B). No new
  dependency needed; every fix uses TanStack Query, Pinia, VueUse or Monaco already present.

### Out of scope, owned by other streams

Never touch in this phase:

- Stream B: `apps/kira-space/frontend/src/hostview/**`, settings surfaces, capture code.
- Stream C: `OperationsPanel.vue` (both apps), `packages/workbench` `OpLog*`, `createOpLogStore`,
  `state/ops.ts`.

Follow-up: re-sweep those areas plus anything B and C add (hostview views, new panels) after both
land. Orchestrator adds it to `SPEC.md` as its own phase; this plan does not edit `SPEC.md`.

### Conflict risk with stream B (accepted)

B owns `apps/kira-space/internal/bridge/**`, `src/bridge/**`, `src/state/**` (except ops),
`internal/flows/**`, `tests/ui/support/**`, and has touched `ade/v2/readQueries.ts`,
`ade/v2/queries.ts`, `useReviewWorking.ts`. Space fixes P1 and P2 below edit
`internal/bridge/codeworkspace.go`, `src/bridge/` types and `internal/flows/repoflow`. Keep those
edits additive and small so rebase conflicts stay mechanical. Step order puts Space bridge work
last, so it can wait for B to land if the orchestrator prefers.

## Measurable questions

1. Q1: Does switching away from a tab and back fire any read IPC? Target: 0 for every view whose
   data has a push signal or is immutable.
2. Q2: Same after 6 min away (past default `gcTime` 5 min)? Target: 0 for bounded-cardinality keys.
3. Q3: Does view state survive switch (scroll, cursor, page index, sidebar search)? Target: yes.
4. Q4: JS heap delta per open tab, per kind. Report only; no target, informs measure-gated items.
5. Q5: Does heap grow across repeated switch rounds? Target: flat within noise (no leak).
6. Q6: Does heap return to baseline after closing all tabs? Target: within noise of baseline.

## Method

- New `tests/perf/heap-tabs.spec.ts` in each app (`apps/kira-studio`, `apps/kira-space`).
- Add `heap` project, `browserName: 'chromium'`, to each `playwright.perf.config.ts`. Chromium gives
  CDP: `HeapProfiler.collectGarbage` then `Runtime.getHeapUsage` per sample. WebKit project keeps
  reporting RSS through `tests/perf/perfProbe.ts` `descendantsRssMb`. Report-only, same as existing
  probes.
- Scenario, scripted, fixed seed data:
  1. Load app, GC, sample baseline.
  2. Open fixed tab set. Studio: data grid, document, keyvalue, stream, definition, console (SQL),
     Kibana Discover, gRPC request, HTTP request. Space: repo graph, repo file (large file), diff,
     local file. GC and sample after each open: per-kind delta (Q4).
  3. Three switch rounds through all tabs, GC and sample after each (Q5). Count read IPC per switch
     (Q1): Space `tests/ui/support/ipcCalls.ts` `calls(control, channel)`; Studio gets the same
     helper (step 1).
  4. `page.clock` (`tests/ui/support/clock.ts`) advance 6 min, one more round, count reads (Q2).
  5. Close all tabs, GC, sample (Q6).
- Run without root scripts (A owns `package.json`): `bunx playwright test -c
  playwright.perf.config.ts heap-tabs --project heap` in each app dir. Command goes in
  `docs/DEV_ENVIRONMENT.md` "Perf probes".
- Before numbers: step 1 commits them to `docs/v0.2.24/plans/P433-measurements.md`. After numbers:
  last step appends to same file. Note: baseline is pre-B/C tree, not integrated chapter tree.

## Findings

### Studio

- **S1 keyvalue refetch and page reset on every mount.**
  `views/shared/keyvalue/KeyValuePane.vue:122-131` watches `host.value?.path` with
  `immediate: true`, so `load(viewKey)` runs on every mount. `views/shared/keyvalue/state.ts:58-86`
  `load()` without cursor resets `pageIndex` to 0 on a cursor-paged page: user loses page on tab
  switch. Affects keyvalue tab and browse preview. Every other view guards with
  `!store.runtime[tab.id]` in `onMounted` (`DataView.vue:178`, `DocumentView.vue:316`,
  `StreamView.vue:57`, `DefinitionView.vue:90`, `BrowseView.vue:329`).
- **S2 gRPC schema refetch after GC.** `views/grpcrequest/schemaQuery.ts:120-160` `useGrpcSchema`
  keeps default `gcTime` 5 min. Return after 5 min re-runs server reflection.
- **S3 Discover data view and histogram refetch.** `views/console/kibana/useDiscover.ts:47-53` data
  view `staleTime: 5 * 60_000`: refetch on remount after 5 min. `:102-119` histogram key
  `['kibana','histogram',tab.id,runSeq,interval]`, `gcTime: 30_000`: ES aggregation re-runs after
  30 s away. Key includes `runSeq`, so raising `gcTime` alone accumulates old runs.
- **S4 app-owned lists refetch after GC.** `api/state/history.ts:61`, `:92` (item-scope lists left
  to default `gcTime`), `views/httprequest/cookies.ts:37` jar cookies, `api/state/apiQueries.ts`
  app-wide lists. All push-invalidated by `api-data-changed` already, so GC refetch is pure waste.
- **S5 menu-open refetch of app-owned saved queries and history.** `staleTime: 0` (or manual reload
  in `onMounted`) because no change event exists: `views/shared/FilterHistoryMenu.vue:30-42`,
  `views/console/ConsoleSavedMenu.vue:31-39`, `views/console/kibana/DiscoverSavedMenu.vue:33-38`,
  `views/stream/StreamFilterHistoryMenu.vue:27-33`. Go side: `internal/bridge/queries.go`
  `QueriesService` writes (`Save`, `SaveConsole`, `SaveDiscover`, `Update`, `UpdateDiscover`,
  `Delete`, `Touch`, `HistoryRecord`) emit nothing. A write in another window is invisible without
  refetch, which is why `staleTime: 0` exists.
- **S6 console cursor and scroll lost on switch.** `views/console/ConsoleView.vue:75`
  `cursorPos = ref(0)`; MonacoHost scroll position not kept. Violates P375 rule (per-tab UI state in
  runtime store).
- **S7 Discover field sidebar search lost on switch.** `views/console/kibana/FieldSidebar.vue:35`
  `search = ref('')`, plus show-more expansion. Same P375 violation.
- **S8 stale comment.** `views/shared/page/store.ts:3-7` says three views never call
  `setVisibleWindow`; all do now. Doc fix only.

### Space

- **P1 repo file re-read on every remount.** `views/repo/RepoFileView.vue:85-118` `mount()` calls
  `loadFileContent` (`views/repo/fileContent.ts:20-49` → `control.codeWorkspaceReadFile`, up to
  8 MiB `MaxReadBytes`) unless editing. Then `getOrCreateModel` (`monaco.ts:108-127`) full-string
  compares against cached model. Model already survives unmount (`editors.ts`), so read is wasted
  when file is unchanged. Rev-pinned file is immutable: no read needed at all.
- **P2 diff sides re-read on every remount.** `views/repo/useDiffEditor.ts:68-87` `loadDiffSides`
  re-reads through `codeWorkspaceReadDiff` / `reviewWorkingDiffOptions` (`fetchQuery`,
  `staleTime: 0`, `ade/v2/review/useReviewWorking.ts:21-27`). Commit diff (`left !== null`, both
  sides rev-pinned) is immutable.
- **P3 local file refetch every switch.** `views/repo/LocalFileView.vue:35-39` `useQuery
  ['openedFile', path]` with `gcTime: 0`.
- **P4 Monaco scroll and cursor lost on remount.** Models survive in `editors.ts`, view state does
  not. Applies to repo file, local file, diff editor.

### Measure-gated (decide from Q4/Q5 numbers, no change planned)

- **M1** Studio page stores have no aggregate byte budget (Go L2 is 64 MB,
  `internal/enginecache/pages.go:15`). Decode/view caches are window-bounded by `setVisibleWindow`;
  only act if Q4 shows a kind over 50 MB per tab.
- **M2** Space `ade/v2/readQueries.ts:72-78` `useLog` `gcTime: 30_000` trades refetch for memory on
  large logs. Keep unless Q4 shows log payload small. B-touched file, so any change waits for B.
- **M3** Space keeps up to 4 repo graphs mounted (`MainView.vue:20` `KEPT_MAX = 4`,
  `tabKinds.ts:104-121`). Lowering it trades RAM for cold refetch. Keep unless Q4 shows a graph over
  100 MB.
- **M4** Console results capped at `MAX_RESULTS_PER_TAB = 50` (`views/console/state.ts:143`,
  `evictOldestResults` `:145`). Bounded; act only on Q4.

### Nothing real found

- Listeners and timers: only document scroll listener (`views/shared/slick/kiraSlickGrid.ts:390`)
  is removed on dispose (`:526`); only `setTimeout` sites (`bridge/port.ts:138`, git-ui
  `layoutClient.ts:83`) are bounded.
- Space workspace close drops tree, search and transport state (`state/workspace.ts:110-123`).
- Tab close `dropResources` exists for every Studio and Space tab kind.
- `staleTime: 0` sites reading external state with no push signal stay as named exceptions (see
  Fix F1 docs): `state/cliTools.ts:14`, `state/agentUsage.ts:28` (poll), `QuitPrompt.vue:21`,
  `memory/queries.ts`, automations (`ScriptDialog:115`, `scheduleQueries:27`, `ScheduleFields:121`,
  `RunScriptDialog:79`, `McpToolsField:22`, `McpServerTools:25`), `docker-ui/src/queries.ts` (poll),
  Space `ade/v2/queries.ts` external git reads (`repoBranches` `:560`, `rebasePreview` `:573`).
  Requirement: they read state Kira does not own and cannot observe.
- `gcTime: 0` large one-shot payloads already right: `ApprovalResponse.vue:36`,
  `PreviewCommandPanel.vue:77`, `ScheduleConfirmDialog.vue:51`.

## Fixes

### F1 gcTime policy (S2, S4, S3 part)

- `packages/workbench/src/state/queryClient.ts`: keep default 5 min `gcTime` globally. Input-keyed
  transient keys (`kqlCompletion.ts:167`, `FilterEditor.vue:59`, memory search, preview keys, docker
  per-id) would grow without bound under `Infinity`.
- Export named constant `KEEP_WHILE_OPEN = Infinity` with one-line comment: only for keys with
  bounded cardinality (singleton, app-wide list, or per-open-tab key removed in that kind's
  `dropResources`).
- Apply to: `useGrpcSchema` (key per tab; add `queryClient.removeQueries` for it to gRPC kind
  `dropResources`), `api/state/history.ts` item-scope lists, `httprequest/cookies.ts`, app-wide
  lists in `apiQueries.ts`.

### F2 Discover (S3)

- Data view: `staleTime: Infinity`, `gcTime: KEEP_WHILE_OPEN`. Data view list is external (Kibana);
  refresh stays on existing explicit refresh action. Confirm one exists; if not, keep current 5 min
  `staleTime` and only raise `gcTime`.
- Histogram: drop `runSeq` from key, key by `[tab.id, interval]`, set result through
  `queryClient.setQueryData` on each run, or keep `runSeq` and `removeQueries` older runs for tab on
  each new run. Choose second (smaller diff, keeps query lifecycle). `gcTime: KEEP_WHILE_OPEN`;
  Discover kind `dropResources` removes `['kibana','histogram',tab.id]`.

### F3 keyvalue mount guard (S1)

- Store `loadedPath` in keyvalue runtime entry. `KeyValuePane.vue` watch skips `load` when runtime
  page exists and `loadedPath === path`. Path change or reconnect still loads. Keeps `pageIndex`.

### F4 saved queries change event (S5) — behaviour change

- Go: `QueriesService` emits `saved-queries-changed {connectionId, kind}` after each successful
  write, through same emitter pattern `MaskRulesService.broadcastRules` uses
  (`internal/bridge/maskrules.go`). History record emits `filter-history-changed
  {connectionId, path}`.
- Frontend: one listener in Studio event wiring invalidates matching query prefixes. Menus move to
  TanStack Query with `staleTime: Infinity`; `StreamFilterHistoryMenu.vue` manual `onMounted` reload
  becomes `useQuery`.
- Additive wire contract only: new event names, no changed payloads.

### F5 runtime UI state (S6, S7)

- Console: `consoleViewStore` runtime entry gains `cursor` and `scrollTop`; ConsoleView restores on
  mount, writes on change (VueUse `watchDebounced` for scroll).
- FieldSidebar: `search` and show-more flag move to Discover runtime entry. Session-only, not
  persisted (P375).

### F6 Space file reads (P1, P2, P3) — B overlap

- P1: `CodeWorkspaceReadFileArgs` (`internal/bridge/codeworkspace.go:76`) gains optional
  `ifStat {size, mtimeNs}`. `internal/codeworkspace/files.go:139` `ReadFile` stats first; equal
  returns `{kind: 'unchanged'}`, no content. `FileContent` gains `stat`. `RepoFileView` passes
  cached model stat; on `unchanged` reuses model, skips compare. Rev-pinned file: skip IPC when
  `peekModel` hits.
- P2: commit diff (`left !== null`) reuses cached models, no IPC. HEAD-vs-worktree: same stat gate
  on worktree side; HEAD side reused until `repo.changed` `refsChanged`.
- P3: `LocalFileView.vue` `gcTime: KEEP_WHILE_OPEN`, `staleTime: Infinity`, local-file kind
  `dropResources` removes key. Invalidation: existing opened-files watch event if present; else keep
  `staleTime: 0` and apply only the `gcTime` change (refetch on mount stays, deliberate: external
  file, no watcher). Implementer confirms which by `codegraph_explore` on `OpenedFilesService`.

### F7 Monaco view state (P4)

- `editors.ts` entries hold `editor.saveViewState()` result, saved on unmount; restored with
  `restoreViewState` on mount. Disposed with model on close. Diff editor same via
  `IDiffEditorViewState`.

### F8 docs (S8 and policy)

- `views/shared/page/store.ts:3-7` comment fixed.
- `docs/ARCHITECTURE.md`: query policy around lines 717-721 and 754 (`KEEP_WHILE_OPEN` rule,
  named `staleTime: 0` exceptions with requirement), 1113 (Studio tabs unmount; state lives in
  runtime store), 1870 (`keepMounted` and Monaco view state), saved-queries event in event list.
  Known open items (~3208): add follow-up re-sweep entry only if orchestrator does not add phase.
- `docs/DEV_ENVIRONMENT.md` "Perf probes" (~889): heap probe command and Chromium-only note.

## Tests

Split at IPC boundary for every behaviour change.

- F4: Go flow test in `internal/flows/dbflow` (extend `sqlite_test.go` saved-queries journey):
  save, update, delete, history record each emit expected event and payload. UI spec
  `tests/ui/saved-queries-sync.spec.ts`: menu open, external event, menu shows new entry; second
  open fires zero `queriesListConsole` calls.
- F6 P1: Go flow test in `internal/flows/repoflow`: `ReadFile` with matching `ifStat` returns
  `unchanged`; after write returns content. UI spec in Space `tests/ui/`: open file, switch away and
  back, `calls(control, 'codeWorkspaceReadFile')` unchanged.
- F1/F2/F3/F5/F7 (frontend-only, no IPC contract change): UI specs only. Studio
  `tests/ui/tab-switch-retention.spec.ts`: per kind, switch away and back, assert zero read calls,
  page index kept (keyvalue), cursor kept (console), sidebar search kept (Discover); `page.clock`
  +6 min, still zero reads (gRPC schema, history). Space spec: scroll position kept in repo file and
  diff. Studio IPC counter helper added under `tests/ui/support/` (Studio side, not B-owned).
- No unit tests: each fix is one or two conditions.

## Steps and commits

Fast checks (typecheck, lint, build) per commit through pre-commit hook. UI and perf suites once,
step 9.

1. `test: add tab heap probe` — both perf configs `heap` project, both `heap-tabs.spec.ts`, Studio
   IPC counter helper. Run probe, commit before numbers in `P433-measurements.md`.
2. `fix(studio): keep keyvalue page across tab switch` — F3.
3. `feat(workbench): KEEP_WHILE_OPEN gcTime policy` — F1 constant plus Studio gRPC, API history,
   cookies, apiQueries; matching `dropResources` removals.
4. `fix(studio): keep Discover data view and histogram` — F2.
5. `fix(studio): keep console cursor and Discover sidebar state` — F5.
6. `feat(studio): saved-queries change events` — F4 Go plus frontend plus flow test.
7. `fix(space): keep Monaco view state across remount` — F7, P3 local file.
8. `feat(space): stat-gated file and diff reads` — F6 P1/P2 plus repoflow test. B overlap; hold for
   B landing if orchestrator says so.
9. `test: tab-switch retention specs` — UI specs both apps. Run full UI suites both apps, Go flow
   tests, perf probe. Fixes as follow-up commits.
10. `docs: P433 measurements and architecture` — after numbers, F8 docs, S8 comment.

## Risks

- Holding data with `KEEP_WHILE_OPEN` raises RAM; each such key must have a removal in
  `dropResources`. Q6 (return to baseline) catches a missed one.
- Wider `gcTime` on input-keyed keys leaks; policy confines it to bounded keys.
- Stat gate: equal size and mtime with changed content (sub-ns write, coarse FS clock). Accept;
  editor already reloads on worktree change event. Document.
- Monaco view state on disposed model: restore only when entry model is still live.
- F4 event fan-out per write is cheap (local SQLite), but each window invalidates; menus only refetch
  when open or next opened.
- Conflicts with B on Space bridge and flows (step 8) and with C only if C edits `queryClient.ts` or
  workbench tab plumbing; rebase mechanically, ownership boundary otherwise disjoint.
- Before numbers come from pre-B/C tree; after numbers from same tree, so comparison stays valid.
  Integrated-tree numbers belong to the follow-up re-sweep.

## Result

Done. Commits `4b79adc8f` to `c7c3ae7ec` on `chapter/v0.2.24-stream-d`, one per step 1-10.
Before/after numbers: `P433-measurements.md`.

Landed:
- Heap probe (`heap` project in both apps, `packages/workbench/src/testing/ui/heapProbe.ts`).
- F1 `KEEP_WHILE_OPEN` plus gRPC schema/history, API history, cookies, apiQueries (S2).
- F2 Discover data view and histogram kept (S3). F3 keyvalue page kept (S1). F4 mask rules kept (S4).
- F5 console cursor and Discover sidebar state kept.
- F4 Go events `savedQueriesChanged` and `filterHistoryChanged`; saved-query menus drop `staleTime: 0`.
  Flow test in `dbflow/sqlite_test.go`, UI spec `saved-queries-sync.spec.ts`.
- F7 Monaco view state kept across remount (Space).
- F6 stat-gated file and diff reads (`ifStat`, `ifHeadOid`, kind `unchanged`); Go test in
  `repoflow/workspace_test.go`, UI spec `repo-file-gate.spec.ts`.
- Retention specs `tab-switch-retention.spec.ts` (4 tests). F8 docs in `ARCHITECTURE.md`,
  `DEV_ENVIRONMENT.md`, S8 header comment in `page/store.ts`.

Tests: Studio UI 680 passed (one load timeout, passed on lone rerun). Space UI 882 passed. Go
tests for both apps passed. Pre-commit hooks passed on every commit.

Deviations:
- P3 (Space local-file refetch) skipped. No OpenedFiles watcher exists, so a skipped read is unsafe;
  retaining text only adds memory.
- Plan premises corrected: gRPC schema keyed by source, not tab; cookies keyed by typed URL;
  StreamFilterHistoryMenu has no IPC; nothing to change there.
- Tree saved-filters stay on right-click fetch. Double invalidation on saved-query writes accepted.
- Space gate cuts payload, not call count.
- Stream-history `useQuery` conversion not done.

Open items:
- Studio Discover leaks about 4 MB per mount round, +33 MB after close-all. Not query-related.
  Hypothesis, unverified: per-mount registration in `kqlLanguage.ts`. In `ARCHITECTURE.md` Known open items.
- Space repo file/diff still grows about 0.7 MB per round, +2.8 MB per open/close cycle.
- Stat gate can miss a same-size edit inside timestamp granularity.
- Kibana data view picker list (60 s) and other `staleTime: 0` external reads stay as named exceptions.
- Studio before numbers predate the `grpcHistoryList` mock snapshot.
- Re-sweep needed after Streams B and C land: hostview, settings, capture, OperationsPanel, OpLog.
