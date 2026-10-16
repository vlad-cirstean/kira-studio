# P168 Part 18: review plan, `git-core` and `git-ui` logic

Chunk B5, Stream B position 5 of 10 (pre-plan `P168-prep-plan.md` §5.17). One Opus reviewer runs
this plan and reports findings. It fixes nothing. One Sonnet fixer follows (§10).
Tree surveyed: `c9e3647` (`p168-stream-b`, on `v2.0` with Part 17 fixes landed).

Paths repo-relative. `GC` = `packages/git-core/src`, `GU` = `packages/git-ui/src`, `IPC` =
`packages/git-ipc/src`, `PF` = `apps/kira-space/frontend/src`, `VS` = `apps/kira-space-vscode/src`.
Line numbers are as of `c9e3647`; re-read before citing.

SPEC row and orchestrator agree on this file name (`P168-part18-git-ui-logic.md`).

## 0. Gates waived, and the routing tag

User decision for this stream: gates G0 and G1 (pre-plan §3.2) stay **waived**; G2 (Part 9, shared
frontend base) stays waived for Stream B as in Part 17. Part 8 and Part 9 are not yet reviewed
(no plan file for either). SPEC dependency "`git-ipc` (Part 17) settled" holds: Part 17's fixes
and findings-file drop (`c9e3647`) are on `v2.0`.

- Own production files import no `@workbench` module. Production imports are `vue`, `slickgrid`
  (type `Formatter` only, `GU/graph/graphColumn.ts:7`), `@kira/git-core`, `@kira/git-ipc`. The
  only `@workbench` import is the test helper `@workbench/testing/unit/async` (10 test files). So
  the G2 waiver leaves no production path here on an unreviewed base.
- **Any finding whose fix needs a file owned by another Part** carries
  `needs-other-part-file: <path> (Part N)`. The orchestrator routes it.
  - Stream A file (Parts 2-9, incl. `packages/{workbench,theme,kira-ui,shared}`) or Stream C file
    (Parts 10-13): the Stream B fixer never edits it. The orchestrator appends it to
    `docs/v2.0/plans/P168-routed-from-streamB.md` (same entry shape as its existing Part 17 F2
    entry).
  - Stream B file (Parts 14-17 closed, 19-23 later): same stream, sequential. The fixer may edit it
    when a Part 18 fix requires it and names each such file in the commit body. The tag still names
    it. Typical: `GU/components/**`, `GU/App.vue`, `GU/main.ts` (Part 19), `IPC/**` (Part 17),
    `PF/repo/git/**`, `PF/views/repo/**` (Part 22), `VS/**` (Part 23),
    `apps/kira-space/internal/gitsearch/**` (Part 15, Go half of search parity).

Routed files: `P168-routed-from-streamA.md`, `-from-streamB.md`, `-from-streamC.md` and
`P168-routed-to-stream-a.md` hold no item owned by Part 18 (checked at `c9e3647`).

## 1. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Call `mcp__codegraph__codegraph_explore` with
  `projectPath=/home/user/kira-studio-streamB` before any Read/Grep on a symbol, call-path or
  blast-radius question. If the tool is not listed, load it with `ToolSearch "codegraph"`. The
  orchestrator greps the run's tool log for real calls. Index: `.codegraph/codegraph.db` present
  but built at 07:07, before Part 17's fix commits (07:35-07:51); run
  `sh scripts/codegraph-setup.sh` in the worktree if a result disagrees with disk. Seeds per block
  (§10):
  1. Bridge and errors: `BridgeClient` (`init`, `onReconnect`, `stream`, `request`, `dispose`),
     `createLatestRequest`, `runLatest`, `RepoScopedReload` (`fireAndForget`, `isCurrent`),
     `createPendingSlot`; `IPC` `RpcError`, `TransportError`, `toWireError`, `createRpcClient`
     `stream`; every `TransportError && code ===` site.
  2. Graph data and layout: `CommitStore` (`appendPacked`, `layoutInput`, `rowOfSha`, `clear`),
     `ShaTable`, `intern.ts`, `layoutAppend`, `lanes.ts`, `edges.ts`, `colors.ts`, `stashRows.ts`,
     `buildRowPlan` (`rankTips`, `assignRowRanks`, `collapseBuckets`), `identityRowPlan`,
     `projectLayoutInput`, `createLayoutClient`, `LayoutClientStaleError`, `layout.worker.ts`,
     `LayoutStore` (`append`, `#applyPatches`, `#collectLongSegments`, `#demoteIfNowShort`,
     `segmentsInRow`), `createGraphFormatter`, `readSlice`, `buildRowSvg`, `edgeCommand`,
     `hitTest`, `graphColumnWidth`, `graphVisibility.ts`.
  3. Graph and review session state: `GraphViewState` (`openStream`, `#runLoad`, `loadMore`,
     `loadAll`, `revealSha`, `refresh`, `reset`, `#applyChunk`, `#queueLayoutRebuild`,
     `#drainLayoutRebuilds`, `#rebuildLayout`, `#scheduleAutoRefresh`, `dispose`),
     `PackedStreamState`, `GraphOrderState`, `SelectionState`, `ReviewSessionState` (`setTarget`,
     `#resolve`, `#open`, `loadMore`, `#checkForChange`, `#abortAll`), `ReviewFilesState`,
     `ReviewCommentsState`, `resolveBase`, `reviewRanges.ts`.
  4. Search: `compileQuery`, `escapeRegExp`, `matchCommitFields`, `searchLoadedCommits`,
     `matchRef`, `SearchState`, `buildCommitHits`; Go mirror `gitsearch` `Compile`/`MatchFields`
     and `dialect.go` (read only); `conformance.test.ts`, `differentialRunner.ts`,
     `testdata/searchConformance.json`.
  5. Ops and side state: `OpsState` (`#runPreflighted`, `#runSimple`, `#runRemote`,
     `#stashAndCarry`, `#applyResult`, `undo`, `refreshUndo`, `runPull`, `runPush`, checkout,
     reset, cherry-pick, revert, worktree prepare), `RefsState`, `StackState`, `StashState`,
     `WorktreeState`, `PrState`, `RepoSettingsState`, `RepoState`, `SettingsState`, `DetailState`,
     `createDetailActions`, `WorkingDetailState`, `fileListCursor.ts`, `clipboardActions.ts`,
     `liveAnnouncements.ts`, `viewState.ts` (`parsePersistedViewState`), `bootstrap.ts`.
  6. `git-core` models and ports: `model/{operation,status,diff,remote,review,commit,ref,stash,
     tag,conflict,repo}.ts`, `preflight/{reset,tag,types}.ts`, `settings/schema.ts`
     (`coerceSettings`, `repoSettingKeys`, `SETTINGS`), `util/{nulSplit,nfcPath,dateFormat,assert,
     typed}.ts`, `ports/*`, `detail/find.ts`, `worktree/label.ts`, `testing/packedChunk.ts`.
- **CodeGraph over-links TS names.** `load`, `reload`, `reset`, `dispose`, `refresh`, `stream`,
  `Status`, `Settings`, `search.ts`, `state.ts`, `layout` collide with Studio, Space `frontend`,
  `workbench` and Go. Confirm every cross-package claim with `git grep` of real import lines
  (`from '@kira/git-core'`, `from '@kira/git-ui'`, `from '@kira/git-ipc'`, relative `'../state/'`).
  §4 and §5 were verified that way.
- **Probes** as throwaway `.test.ts` under `GU/state` or `GC/**` (bun, `@workbench/testing/unit/
  async` helpers), deleted before the findings commit, never committed. Prefer a probe over prose
  for every race, cancellation, ordering or layout-arithmetic claim. Mark each claim "verified" or
  "code-read".
- **Checks** (baseline at `c9e3647`, all green):
  - `bun test packages/git-core/src packages/git-ui/src/state packages/git-ui/src/graph`: 375
    pass, 0 fail, 33 files, 4.0 s.
  - `bun run typecheck:git` (git-ipc, git-core, vscode, git-ui, kira-ui): clean, 11 s.
  - `bunx biome check` over the own paths: 125 files, clean.
  - `go test -count=1 -run 'Conformance|Differential' ./apps/kira-space/internal/gitsearch/`:
    ok; `TestDifferential` **skips** unless `KIRA_GIT_DIFFERENTIAL=1` (then ok, 0.8 s). Run it with
    the variable set.
  - If a finding touches a caller: `bun run typecheck:space-web`, `bun test` over the touched
    `apps/kira-space/tests/unit` spec. If deps or bindings fail a check:
    `bun install --frozen-lockfile` and `bun run setup`. A red check is a finding.

## 2. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `c9e3647`.

**Part 18: 126 files, 20,843 code lines (tests 6,705). Unchanged from `f40cd35`.** One commit since
`f40cd35` touches a Part 18 file: Part 15 fixer `e187f7e` (F13, Go regex dialect) added six rows to
`GC/../testdata/searchConformance.json` (+72, non-code, not in the line count). No Part 16 or Part
17 fixer edited a Part 18 file (`git log f40cd35..HEAD` on the own paths).

Drift elsewhere since Part 17's plan (`5ad54fb`, surveyed `30ec62f`):
- Part 17: 85 files, 23,594 to 23,653 (tests 14,003 to 14,038). Part 17 fixes.
- Part 16: 19,279 to 19,286.
- Stream A/C fixes on `v2.0`: Part 4 76 files 16,751; Part 5 119 files 21,695; Part 11 135 files
  30,837; Part 13 154 files 26,924.
- Totals: streams A 258,177, B 183,558; 2,900 owned, 0 orphans, 3,540 tracked (docs 487).
- Script label: `[A]` printed for Parts `<= 13`; Parts 10-13 are Stream C (carried from Part 10).

## 3. Own file set (126 files)

69 production code files (14,138 lines), 33 test files (6,705), plus `GC/../package.json`,
`GC/../tsconfig.json`, `testdata/searchConformance.json` (527 lines). No `.vue` file is owned.

- **`GC`** (50 prod, 6,005; 19 tests, 3,477):
  - `graph/` (7, 1,320): `rowPlan` 515, `lanes` 284, `edges` 173, `types` 172, `layout` 73,
    `stashRows` 62, `colors` 41. Tests `rowPlan.test` 338, `lanes.test` 178. No direct test for
    `edges.ts`.
  - `model/` (12, 1,583): `operation` 493, `diff` 209, `status` 192, `review` 166, `reviewRanges`
    150, `remote` 103, `commit` 83, `stash` 60, `ref` 53, `conflict` 35, `repo` 20, `tag` 19. Tests
    `operation.test` 411, `diff.test` 300, `reviewRanges.test` 296, `review.test` 292,
    `status.test` 171, `tag.test` 51.
  - `store/` (3, 1,076): `commitStore` 628, `shaTable` 262, `intern` 186. Tests `intern.test` 136,
    `shaTable.test` 123. **No direct test for `commitStore.ts`** (covered via `GU` state tests).
  - `preflight/` (3, 401): `types` 256, `reset` 74, `tag` 71. Tests `reset.test` 186, `tag.test` 82.
  - `search/` (3, 399): `matcher` 257, `query` 92, `differentialRunner` 50. Tests `matcher.test`
    291, `query.test` 118, `conformance.test` 91.
  - `settings/schema` 349 (test 178); `index` 220; `ports/*` 12 files 270 (interfaces only);
    `util/` 5 files 232 (`nulSplit` 124, `dateFormat` 53, `assert` 27, `nfcPath` 15, `typed` 13;
    tests `nulSplit` 93, `nfcPath` 73, `dateFormat` 69); `testing/packedChunk` 112;
    `detail/find` 23; `worktree/label` 20.
- **`GU/state`** (28 prod, 6,573; 12 tests, 2,823): `ops` 1,853, `graphView` 589, `search` 507,
  `review` 483, `pr` 409, `liveAnnouncements` 349, `reviewFiles` 293, `stash` 207, `viewState`
  199, `reviewComments` 167, `stack` 154, `detailActions` 142, `detail` 125, `refs` 123,
  `repoSettings` 117, `graphOrder` 111, `packedStream` 107, `worktrees` 99, `working` 88, `repo`
  83, `latestRequest` 79, `repoScopedReload` 71, `selection` 63, `pendingSlot` 48,
  `fileListCursor` 34, `clipboardActions` 33, `settings` 21, `bootstrap` 19. Tests: `pr.test` 653,
  `ops.test` 430, `stack.test` 276, `graphView.test` 257, `reviewFiles.test` 243,
  `buildCommitHits.test` 216, `viewState.test` 204, `repoSettings.test` 161, `review.test` 125,
  `working.test` 116, `repo.test` 81, `refs.test` 61. No direct test for `search.ts` beyond
  `buildCommitHits`, `liveAnnouncements`, `stash`, `worktrees`, `detail`, `detailActions`,
  `reviewComments`, `graphOrder`, `packedStream`, `latestRequest` (via `reviewFiles.test`).
- **`GU/graph`** (8 prod, 1,372; 2 tests, 405): `rowSvg` 426, `layoutStore` 436, `layoutClient`
  189, `graphColumn` 146, `geometry` 65, `palette` 47, `layout.worker` 33, `hitTest` 30. Tests
  `rowSvg.test` 211, `layoutStore.test` 194.
- **`GU` other** (4, 188): `bridge/client.ts` 128, `index.ts` 35, `graphVisibility.ts` 19,
  `shims-vue.d.ts` 6.
- Excluded: `.gitkeep` files under `GC/{graph,model,ports,store,util}` and
  `GU/{graph,state}` (assets, pre-plan §6).

## 4. One hop: callers (git grep of import lines)

- **Part 19 (`GU` rest, same stream, next):** 48 files import own modules by relative path. By
  module: `state/ops` 25, `state/detailActions` 12, `state/{stash,refs,detail}` 7 each,
  `state/{viewState,pr,graphView}` 6 each, `state/{worktrees,stack,search}` 5 each, `state/repo`
  4, `state/review` 3, `bridge/client` 3, `state/{working,settings,selection,reviewFiles,
  reviewComments,repoSettings,liveAnnouncements,graphOrder,bootstrap}` 2 each,
  `graph/{rowSvg,palette,geometry}` 2 each, `state/clipboardActions`, `graph/{hitTest,
  graphColumn}` 1 each. `graphVisibility.ts`: `App.vue`, `components/CommitGrid.vue`, `main.ts`.
  `App.vue:130-184` constructs one of each state class per mount; `components/review/
  ReviewView.vue` constructs the review set. Part 19 also imports `@kira/git-core` in 25 files.
- **`@kira/git-ui` package entry (`GU/index.ts`) outside the package:**
  - Space `PF` (Part 22): `repo/git/viewStateStore.ts` (`PersistedViewState`, `ViewStateStore`),
    `repo/RepoReviewView.vue`, `views/repo/RepoGraphView.vue` (`MountHandle`, from `main.ts`, Part
    19), `repo/git/gitUiModule.ts` (lazy `import('@kira/git-ui')`), `repo/fileIcon.ts`
    (`@kira/git-ui/icons`, Part 19).
  - Space ADE (Part 21): `ade/v2/review/AdeReviewFiles.vue` (`MountHandle`; constructs
    `NullViewStateStore` per CodeGraph).
  - VS Code (Part 23): `webview/main.ts` (`DEFAULT_COLUMN_WIDTHS`, `DEFAULT_DETAIL_WIDTH`,
    `mount`, `NullViewStateStore`, `PersistedViewState`, `parsePersistedViewState`,
    `ReviewTarget`, `ViewStateStore`).
- **`@kira/git-core` outside the two packages:**
  - VS Code `src` (Part 23, 16 files): `extension.ts` (`coerceSettings`, `nfcPath`,
    `repoSettingKeys`, `SETTINGS`, `SettingKey`, `Logger`, `VirtualDocumentSource`),
    `proxyHandlers.ts` (`findChangeInDetail`, port types, `FileChange`, `DocumentRef`),
    `reviewMarking.ts` (`clampRanges`, `coverage`, `hunkChangeBlock`, `normalizeRanges`,
    `selectionToRange`), `goToFile.ts` (`mapLineAcrossDiff`), `blameState.ts`
    (`formatRelativeDate`), `blameWidget.ts` (`nfcPath`), `connection.ts`, `diffToolbar.ts`,
    `ports/*` (7: port interfaces, `nfcPath`). Test support: `tests/interaction/support/
    {commitMetaHarness.entry,fakeGraphHost,fakeReviewHost}.ts` (`CommitStore`, `buildPackedChunk`).
  - Space `PF` (Part 22): `repo/git/hostHandlers.ts` (`findChangeInDetail`, `mapLineAcrossDiff`),
    `repo/state/worktrees.ts` (`worktreeLabel`), `views/repo/blameLine.ts`
    (`formatAbsoluteDate`, `formatRelativeDate`), `views/repo/reviewDecorations.ts` (the same five
    `reviewRanges` exports as vscode). Tests: `tests/perf/graph-scroll.spec.ts`,
    `tests/ui/support/graphStreamFixture.ts` (`buildPackedChunk`),
    `tests/unit/repo-go-to-file-handler.spec.ts`.
  - Go (Part 15): `gitsearch/conformance_test.go` reads `testdata/searchConformance.json`;
    `gitsearch/differential_test.go` runs `GC/search/differentialRunner.ts` under bun.
- **Space transport sharing (context for §6.1):** one `createRpcClient` per repo workspace
  (`PF/repo/git/transport.ts`), wrapped per mount so a mount's `BridgeClient.dispose()` releases
  only its own `on`/`stream` subscriptions (`transport.ts:203,267-270`). Graph tab and review tab
  hold separate `BridgeClient`s over that one client.
- **Drift from pre-plan §5.17:** callers add ADE `AdeReviewFiles.vue` (Part 21), the Go
  `gitsearch` tests (Part 15) and Space/vscode test support. `GU/main.ts` is Part 19, so
  `MountHandle` consumers are Part 19's callers reached through this chunk's `index.ts`.

## 5. One hop: callees

- **Part 17 (closed): `@kira/git-ipc`**, from `GU` own files only (38 imports): contract types
  (`ParamsOf`, `ResultOf`, `StreamChunkOf`, `EventPayload`, `OpRequest`, `OpResult`, `RefRow`,
  `UndoSlotSnapshot`, preflight results, ...), `Transport`, `TransportError` (7 own files:
  `graphView`, `latestRequest`, `pr`, `review`, `search`, `stash`, plus `bridge/client.ts` types).
- **`git-core` imports nothing but `node:*` and `bun:test`.** It does not import `@kira/git-ipc`
  (B3 rule). It carries **structural copies** of wire types instead: `model/remote.ts`
  (`RemoteOpRequest`/`RemoteOpResult`, `PullStrategy`), `model/review.ts` (`LineRange`),
  `settings/schema.ts` (`HostKind`), `detail/find.ts` (`FileChange` element shape),
  `search/matcher.ts` (`RefRow` shape), `model/operation.ts` (`InProgressKind`). Two comments say
  no `wireConformance.test.ts` guards the copies. Part 17's plan (§4) listed `git-core` as an
  `@kira/git-ipc` importer; the import-line grep shows it is not.
- **Part 9 (unreviewed, waived):** `@workbench/testing/unit/async` (tests only).
- **External:** `vue` 3.5.42 (`shallowRef`, `markRaw`, `watch`), `slickgrid` 5.20.0 (type only),
  browser `Worker` (`layoutClient.createRealWorker`, Vite module worker), `performance.mark`.
- **Not used by own files:** Pinia, TanStack Query, VueUse (git-ui's `package.json` lists
  `@vueuse/core`; own files import none of these). See §6.8.

## 6. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. This chunk is the client-side model
of git state: every view in the graph panel, the review view (Space native, ADE review window,
VS Code webview) and parts of the VS Code extension read it. Items marked "suspect" were seen
during planning but not verified; confirm or drop each, never report unverified.

### 6.1 Bridge to `git-ipc`, and Part 17's contract changes

- **Part 17 fixes to check against every own consumer** (`614f647`, `c83845d`, `6906a4f`, §7):
  - `toWireError` (`IPC/rpc.ts:98-104`) now keeps a string `code` on a forwarded error. In the VS
    Code webview (`VS/webview/main.ts`, served by `createRpcServer` in `VS/proxyHandlers.ts`), an
    upstream `TransportError('transport-closed' | 'cancelled')` now reaches the webview as
    `RpcError` with `code` `'transport-closed'`/`'cancelled'` (before: `code` `'TransportError'`).
    Every own and Part 19 check is `err instanceof TransportError && err.code === ...`
    (`GU/state/{graphView:321,latestRequest:37,pr:192,review:252,334,442,search:487,stash:183}`;
    Part 19 `App.vue:312`, `ReviewView.vue:126`, `NoRepositoryPanel.vue:48`,
    `ReviewCommitRow.vue:164,190`). **Suspect:** in the webview a forwarded cancel or host-socket
    close fails the `instanceof` test and surfaces as an error toast or `error` status. Not a
    regression (the class test failed before too), but now fixable by code alone. Judge whether a
    real path forwards one (extension socket drop mid-request, proxy abort).
  - Missing handler now answers `E_UNKNOWN_METHOD` (`IPC/rpc.ts:399-400,439-440`) instead of a
    `TypeError` code. `git grep` finds no own or Part 19 code branching on `'TypeError'`; Part 19
    `components/rowMenuModel.ts:200` comment names `E_UNKNOWN_METHOD`. Confirm nothing degrades.
  - `kind` dropped from `WireError`/`RpcError`. `git grep` at planning: no own, Part 19, Space
    `repo`/`views/repo` or vscode code reads `.kind` on a caught error. Confirm.
  - Exported `WireErrorCode` union (`IPC/contract.ts:1036-1052`, type at `:1040`). **No TS consumer in `GU`,
    `GC`, `PF/{repo,views/repo}` or `VS` branches on any server `E_*` code** (planning grep).
    Judge whether a path needs to: `graph.loadMore`/`review.*` after the repo was released
    (`E_BAD_REQUEST`, Part 16 F5 mapping), `E_GIT_UNAVAILABLE` (git binary missing) on
    `search.run` or `graph.stream`, `E_FRAME_TOO_LARGE` on `commit.detail`/`refs.list` (§6.7). Part
    17 dropped its own candidate #1 ("no client needs it"); re-report only with a concrete path.
  - Per-method stream supersede removed from `createRpcClient` (`c83845d`). Graph tab and review
    tab now run concurrent `graph.stream`s on one client. Each own caller supersedes through its
    own `AbortController` (`GraphViewState.openStream` `#abortController`, `ReviewSessionState`
    `#streamController`). Check: nothing relied on the transport killing a stream another caller
    or another instance opened; `GraphViewState.#applyChunk` `onCorrupted` re-open
    (`graphView.ts:521-527`) still ends the corrupted stream; two `graph.stream`s on one Go
    `Conn` (plain walk and ranged walk, separate slots per Part 17 F8) do not block each other
    through credit. **Seen, stale:** `graphView.ts:161-162` ("matching W2's own supersede-on-reopen
    rule for the transport underneath") and `:522-523` ("W2's supersede-on-reopen rule") describe
    the removed rule.
- `BridgeClient.init` memo cleared on rejection (G12 D6); concurrent `init()` callers share one
  promise; `dispose()` resets `connectionState` to `'connecting'`, so a late `init` resolution
  after dispose writes `'connected'` into a dead client?
- `onReconnect` (`client.ts:56-79`): fires only on non-`connected` to `connected`; seeded
  `initialHostConnection` of `'connected'` then a `connected` re-push does nothing. A reconnect
  while `init()` is still pending; handlers registered but never unsubscribed by a state class.
- `createLatestRequest` (`latestRequest.ts:28-43`): `isStillCurrent` checked after resolve and
  after reject; `controller` reset in `finally` only when still own. `runLatest` `setLoading`
  ordering across superseded runs.
- `createPendingSlot`: second `ask()` before resolve leaves the first promise pending forever
  (documented). Find every `ask()` caller that can reach it twice (double-click, palette plus
  menu) and whether `busy` then sticks.
- `RepoScopedReload.fireAndForget` swallows and logs: any user-initiated path routed through it
  loses its error.

### 6.2 State classes, lifecycle and the Pinia boundary

- Design as found: each mount (`App.vue`, `ReviewView.vue`) owns plain classes with `shallowRef`
  fields and `markRaw` stores, reset via `setRepoId`/`reset()`, never replaced. No Pinia, no
  TanStack Query in `GU` (see §6.8 for the rule question). Review defects of that design, not the
  choice itself.
- `dispose()` coverage: every class that subscribes (`bridge.on`, `watch`, timers,
  `onReconnect`) unsubscribes. Map construct sites (`App.vue:130-184`, `ReviewView.vue`) to
  dispose sites (`App.vue:1701-1713`, retry `:1303-1304`). Planning read: `App.vue` disposes
  every class except `detailState`, `selection` and `graphOrder`; check whether those hold a
  subscription, and the review set in `ReviewView.vue`. Part 19 owns the call sites; the leak is reportable here when
  a class has no `dispose` at all.
- Repo switch (`applyRepoIdToStates`, `App.vue:473-512`): every class drops in-flight work and
  stale results for the old `repoId`; events (`repo.changed`, `remote.progress`,
  `worktree.progress`, `repoSettings.changed`, `stack.progress`) filter on `repoId`; a result
  landing after the switch never writes into the new repo's state (`#repo.repoId !== repoId`
  guards in `ops.ts`; check `undo()` at `ops.ts:1490-1505`, which applies `result` with no
  post-await repo check, and every `#runSimple`/`#runPreflighted`).
- Reconnect: server's new `Conn` holds no repo; every class re-establishes or fails visibly.
- `busy` flag in `OpsState`: cleared on every exit path including a thrown preflight request
  (`runPull` awaits `remote.pullPreflight` before setting `busy`; a rejection propagates to the
  Part 19 caller: caught?).
- Shared mutable views: `shallowRef` arrays replaced vs mutated in place (a mutation Vue cannot
  see); `markRaw` stores read in templates through a reactive revision counter.

### 6.3 Graph data, layout worker and virtualization

- `CommitStore.appendPacked` (628 lines, no direct test): packed chunk decode against
  `graphChunkCodec.ts`/`gitwire.fbs` (Part 17, settled), `ShaTable` growth and `rowOfSha` on a
  40-hex vs short sha, `intern.ts` string table, `clear()` resetting every index, a chunk that
  does not continue the store (`from !== rowCount`, restart-at-zero handled in
  `PackedStreamState.applyChunk:74-77`; `from > rowCount` gap?).
- `PackedStreamState.applyChunk` `onCorrupted` path: logs, re-opens from row 0; a corruption that
  repeats deterministically (bad server data) loops forever?
- Layout pipeline (`graphView.ts:462-579`): `#rebuildLayout` sets `plan.value` **before** the worker
  answers, so `plan` and `layout` are skewed for one round trip. `readSlice`
  (`graphColumn.ts:33-92`) guards `row >= layout.rowCount` only; a plan that grew or shrank
  (collapse toggle, new tips) against a layout still keyed to the old display rows paints wrong
  lanes or hits `plan.entryAt` assert? Probe with a collapse toggle mid-relayout.
- `layoutClient`: `#rebuildLayout` calls `reset()` before every `submit()`, so `frontier` is
  always `undefined` on submit (full re-layout per rebuild). Confirm; if so, the frontier and
  `layoutAppend` resume path are dead on this caller (cost: O(rows) worker pass per relayout on a
  200k-row repo; F11 coalescing bounds count, not size). Worker `onerror` rejects pending; later
  submits to a worker that threw at module load hang?
- `LayoutStore.#collectLongSegments` (`layoutStore.ts:410-418`): loops every long edge up to the
  binary-search bound per rendered row. Cost with thousands of long edges (monorepo merge
  history); `#demoteIfNowShort` bound claim. `segmentsInRow` assert on `row >= rowCount`.
- `rowPlan.ts`: `rankTips`, `assignRowRanks` with tips not in the loaded rows, a tip sha
  appearing twice, `MIN_COLLAPSIBLE` boundary, `storeLength` lag (P108 F1),
  `projectLayoutInput` with a parent hidden inside the same placeholder, `forkParentOf` set only
  via `_setForkParent` on an internal cast (`rowPlan.ts:503-506`; identity plan ignores it).
- **Seen: literal NUL byte in source.** `GC/graph/rowPlan.ts:108` `const OTHER_KEY = '<NUL>other'`
  holds a raw `0x00`, so git treats the whole file as binary: `git diff`, `git log -p`,
  `git grep` and review tooling show "Binary files differ" and skip it. Confirm and report
  (low; fix `'\u0000other'`).
- `graphColumnWidth` caps at `maxLanes` 12: lanes above 12 clip or overflow the column?
  `hitTest.ts` lane math against `geometry.ts`. `graphVisibility.ts` rules.
- `createGraphFormatter`: one `reusable` array shared across calls (safe only while SlickGrid calls
  formatters synchronously); `window.__kiraRowBuildSamplesMs` unbounded push when set.
- `GraphViewState`: `revealSha` loop termination (no-progress guard G16 D8), `loadAll`
  unbounded on a huge repo, auto-refresh coalescing (`AUTO_REFRESH_COALESCE_MS`,
  `AUTO_REFRESH_MIN_GAP_MS`) vs `loading` watcher deferral, `reset()` racing `#drainLayoutRebuilds`
  (F11 comment), `dispose()` while a drain awaits.
- Every `openStream` awaiter gets `TransportError('cancelled')` when its own instance
  re-opens (abort listener rejects). Callers: `App.vue:278,1367` (Part 19), `graphView.ts:331,
  526`. Confirm each swallows `cancelled`; the corrupted-chunk re-open awaits a new stream inside
  the old stream's `onChunk`, while the old stream's credit gate waits on that `onChunk`.

### 6.4 Search: client matcher, tail merge, Go parity

- `compileQuery` (`GC/search/query.ts:66-92`): flags `''`/`'i'`, never `u`. Whole-word wrapper
  with lookbehind; `regex` mode text ending in `\`; empty after trim; `shaPrefix` 4-40 hex in any
  mode.
- **Go dialect parity (Part 15 F13, `e187f7e`):** Go `gitsearch/dialect.go` now rewrites `\x`,
  `\u{}`, `[\b]`, `[\S]` to JS non-`u` semantics, with six conformance rows. Check further
  divergence the corpus does not pin: case-insensitive folding (`i` without `u` folds ASCII plus
  simple Unicode; Go `(?i)` folds Unicode, e.g. `ſ`/`s`, Kelvin `K`/`k`), `\w`/`\b` on non-ASCII,
  `.` vs line terminators (` `), `\d`, surrogate pairs (JS non-`u` sees UTF-16 units; Go sees
  runes), `{n,m}` limits (Go 1000 cap). A divergence makes the loaded scan and the git tail
  disagree for one query: a hit counted in one half only. Add a corpus row per confirmed case and
  run `TestDifferential` with `KIRA_GIT_DIFFERENTIAL=1`.
- `expect.supported: false` rows (lookaround, backreference): what does the TS side do with a
  pattern Go refuses? The client scan matches, the tail reports unsupported: the UI states it?
- `buildCommitHits` merge (`GU/state/search.ts:92-159`, tested): `overlapCount` only for rows
  that were loaded hits; tail hit for a row loaded after the tail ran; rows that reset
  (`generation` bump) between scan and tail.
- `SearchState` (507 lines, untested beyond the merge): debounce, `SKIP_TAIL_MAX_ROWS` 20,000
  skip rule (`search.ts:328`), cancellation on query change (`search.ts:487`), ref hits vs PR arm
  (`matchRef`), scope switch mid-scan, repo switch mid-tail. `search.run` limit now clamped to
  `DefaultSearchLimit*10` server-side (`eeed257`); git-ui omits `limit` (`search.ts:23-24`), so
  unaffected. Confirm `total` vs `hits.length` display when the tail truncates.
- **Seen, stale:** `GC/search/conformance.test.ts:10`, `differentialRunner.ts:3`,
  `matcher.ts:8` and the corpus `_comment` name `apps/kira-studio/internal/gitsearch`; the package
  lives in `apps/kira-space/internal/gitsearch`. Low.

### 6.5 Ops, review and side state machines

- `OpsState` (1,853 lines): each op's confirm dialog (`PendingSlot` x6), `busy` guard, repo-change
  guard after every await, `#stashAndCarry` (stash, op, pop; pop conflict; op failure leaves the
  stash), undo slot refresh (P108 F4), worktree prepare progress (`worktree.progress` trimmed in
  place, F7), remote progress, `OpResult.error.kind` vocabulary against `IPC` `OpErrorKind`
  (incl. `DirtyWorktree` from Part 15, partial-op and undo-refusal results from Part 16 F6/F11).
- `ReviewSessionState`: `setTarget` with `open.base`/`open.pane` (P166 scope, `ReviewTarget.base`/
  `pane`), `#sessionGeneration`, four controllers aborted on every retarget, `loadMore`'s
  `finally` re-open guarded by identity, `#checkForChange` banner (D39) vs override base,
  `refsChanged` during `resolving`.
- `ReviewFilesState.mark` (`reviewFiles.ts:250-275`): returns silently while `pending` (a second
  toggle is dropped, no announcement); `onMarked` host hook (P166 scope) runs before `#loadDiff`
  and can throw into the `catch` as a mark error.
- `ReviewCommentsState`, `PrState` (`gh` absent, unauthenticated, rate-limited; cache per branch),
  `StackState` (restack cancel), `StashState`, `WorktreeState`, `RepoSettingsState` (user write
  never dropped as superseded, `repoSettings.changed` from another surface), `DetailState`/
  `createDetailActions` (12 Part 19 importers), `WorkingDetailState`, `fileListCursor`.
- `liveAnnouncements.ts` (349 lines, untested): composed strings carry branch names, paths and
  server messages; announcement de-duplication (same text twice is not re-read by a screen
  reader).
- `viewState.ts`: `parsePersistedViewState` version 8 gate; `scrollRow`/`loadedRows` negative,
  `NaN`, huge (a rehydration that loads 10^7 rows); `columnWidths` non-finite; `repoId` for a repo
  no longer open.

### 6.6 `git-core` models and structural wire copies

- Diff each structural copy (§5) against `IPC/contract.ts` at `c9e3647`: field names, optionality,
  union members. A field added to the wire since the copy was made is silently absent in
  `git-core` consumers (vscode `proxyHandlers.ts`, Space `hostHandlers.ts`). No test pins them;
  judge whether a type-level assignability check (one `satisfies` line in a `GU` test, which may
  import both packages) is proportionate.
- `model/operation.ts`: in-progress detection from state files (rebase-apply vs `git am` F3,
  merge, cherry-pick, revert, bisect), unmerged paths; stale comment at `:123` ("Part 17's own
  boundary, not yet reviewed": Part 17 is now reviewed).
- `model/status.ts`, `model/diff.ts` (hunk parsing, `\ No newline`, CRLF, binary marker, rename
  with similarity), `util/nulSplit.ts` (trailing NUL, empty record, odd field count),
  `util/nfcPath.ts` (NFD vs NFC on macOS paths), `util/dateFormat.ts` (future timestamps,
  timezone, epoch 0).
- `model/reviewRanges.ts` (`normalizeRanges`, `clampRanges`, `coverage`, `hunkChangeBlock`,
  `selectionToRange`): 1-based inclusive ranges, empty file, range past EOF, overlapping and
  adjacent ranges; used by vscode `reviewMarking.ts` and Space `reviewDecorations.ts`.
  `reviewRanges.ts:3` says it "imports only types from `@kira/git-ipc`"; it imports none.
- `model/review.ts` `resolveBase`: upstream naming the same branch, `originHead` absent,
  duplicate candidates.
- `settings/schema.ts` `coerceSettings`: unknown keys, wrong types, out-of-range numbers; parity
  with Go `RepoSettingsSnapshot` keys (Part 17 confirmed 11 `kiraSpace.*` keys on the wire).
- `preflight/{reset,tag}.ts` decision tables against Go `gitpreflight` (Part 15, read only).
- `testing/packedChunk.ts` ships under the package `exports` map (`./testing/packedChunk`):
  production bundles never import it (grep).

### 6.7 Parked: count caps with a `truncated` flag (Part 17 F4 remainder)

`commit.detail` and `refs.list` still have no count cap below the 8 MiB frame cap; Part 17 parked
the cap values as a product call needing a `CONTRACT_VERSION` bump. **Do not re-report.** The git-ui
display side belongs here once decided. The reviewer only notes, in coverage, which own state
classes would need a `truncated` path (`DetailState`, `RefsState`, `SearchState` ref arm) and how
they handle `E_FRAME_TOO_LARGE` today (error string to the user).

### 6.8 Conventions (`CLAUDE.md`)

- No `.vue` file is owned; `<script setup>` rules land in Part 19.
- **Pinia, TanStack Query, VueUse rule.** `CLAUDE.md` puts shared client state in Pinia and
  bridge-fetched server state in TanStack Query. `GU` state is plain classes over `BridgeClient`
  with hand-rolled latest-request sequencing. P99 scoped `packages/git-ui` out; no later phase
  moved it (grep `docs/`). The package mounts several independent roots per page (graph, review,
  ADE review window, VS Code webview), each with its own transport. Report a concrete defect the
  hand-rolled code causes (lost cancellation, stale write, missing retry); a library migration is
  a `design-decision`, never a fixer edit.
- Comments: stale ones seen in §6.1, §6.3, §6.4, §6.6. Report each real one, grouped as one low
  finding.
- Raw timers/listeners in own files (`setTimeout` in `graphView.ts:403`, worker
  `onmessage`/`onerror`): no Vue scope in a plain class, so VueUse does not apply; do not report
  on that ground alone.

### 6.9 Tests against the `CLAUDE.md` bar

- Qualifying logic (lanes, row plan, layout store patches, nulSplit, review ranges, search merge,
  stack, pr cache, ops sequencing): check each spec still drives current code.
- Candidates to judge as restated bodies: `tag.test` 51, `refs.test` 61, `repo.test` 81,
  `working.test` 116.
- Gaps worth a guard only where a finding's fix needs one: `CommitStore.appendPacked` decode,
  plan/layout skew (§6.3), a Go/JS dialect divergence (corpus row, not a new test file).

### 6.10 Pre-plan watch items (§5.17)

`BridgeClient` (§6.1), review session state (§6.5), graph order and visibility (§6.3), search store
(§6.4).

## 7. Earlier contract changes Part 18 must handle

- **Part 17 fixer (`git-ipc`, landed):**
  - `614f647` (F1, F2): `toWireError` keeps string `code`; missing handler answers
    `E_UNKNOWN_METHOD`; `kind` dropped from `WireError`/`RpcError`; `WireErrorCode` union exported
    from `contract.ts` and `index.ts`. Go `wireError.Kind` removal routed to Part 8
    (`P168-routed-from-streamB.md`); TS ignores the field meanwhile.
  - `c83845d` (F8): per-method stream supersede removed; concurrent same-method streams on one
    client complete independently.
  - `6906a4f` (F9): socket frame chunks joined once (no consumer impact).
  - `eeed257` (F4 partial): `search.run` `limit` clamped server-side.
  - Go-only: `04bcf28` (drop `mapConnError`), `93d357c` (`review.snapshot` marshals once;
    `review.fileDiff` `tooLarge.bytes` now raw patch size: check any own display of that number),
    `4d4a118` (test isolation).
  - Review: every own consumer against these (§6.1); whether any own code now should branch on
    `E_*`.
- **Part 16 `11f097d` (F5):** `ErrRepoNotHeld`/`ErrRepoTornDown` to `E_BAD_REQUEST`,
  `ErrStoreClosed` to `E_GIT_UNAVAILABLE`. TS side unverified by that fixer; Part 17 found no
  consumer needing it. Covered by §6.1.
- **Part 15 `e187f7e` (F13):** Go regex dialect matches JS non-`u` for `\x`, `\u{}`, `[\b]`,
  `[\S]`; six corpus rows in this chunk's `searchConformance.json`. Covered by §6.4.
- **Part 15 `61774dd`:** `reset --keep` refusal crosses as `OpResult` error kind `DirtyWorktree`.
  Check `OpsState` and `liveAnnouncements` render it.

## 8. What earlier fixes already changed (do not re-report)

- **P166/P167 scope (`git diff 743af03 HEAD` on own paths: 3 files, +87/-3):**
  `GU/state/review.ts` (`ReviewTarget.base`/`pane`, `setTarget(repoId, branch, open?)`),
  `GU/state/reviewFiles.ts` (`onMarked` host hook), `testdata/searchConformance.json` (Part 15
  rows). New code is in scope; report a real failure scenario only.
  `docs/v2.0/plans/P16{6,7}-code-review.md` are gone (fixed).
- **Parts 14-17 fixes edited no Part 18 file** except `e187f7e`'s corpus rows. Part 17 F8 (graph
  and review streams cross-cancelling) is fixed: do not re-report the cross-cancel; a remaining
  consumer gap is reportable.
- **Parked design decisions, do not re-report:** Part 17 F5 (prepare script approval gate), Part
  17 F7 (pairing identity), Part 17 F4 remainder (count caps with `truncated`, §6.7).
- **Earlier fixes in code (comments name them):** P108 F1 (`RowPlan.storeLength`, plan lagging
  store), P108 F4 (undo slot refresh on `repo.changed`, `ops.ts:322-327`), P108 F7 (bootstrap
  retry), P108 F2/F3 (stale menus/dialogs on repo switch, `App.vue`, Part 19); F11
  (`#applyChunk` does not await relayout; drain coalescing), F10 (auto-refresh rejection logged),
  F6 (`PendingSlot.abandon`), F7 (`worktree.progress` trimmed in place), G16 D8 (no-progress
  guard), G12 D6 (`init` memo cleared on rejection), F2 (`onReconnect`); P107 I2-22
  (`runLatest`), I2-23 (`PendingSlot`), I2-27 (`buildPackedChunk`); G30 round 1, G31 round 2,
  G32 round 3 review fixes (about 40 citations in own files, incl. G32 #7 repo-change guard
  after dialogs). Verify they hold; do not re-report them as new.
- **Known open items (`docs/ARCHITECTURE.md`), do not re-report:** native graph and VS Code
  extension hold independent `Conn`s per repo; native `review.session.save/load` has no expiry; no
  standalone merge or rebase operation; no full-stack Space tier.

## 9. Unverified candidates

Leads from planning, **not findings**. Each needs a real scenario, a probe or a code read before
it is reported. Drop any that does not hold; say so in the coverage notes.

1. Webview: a forwarded upstream `transport-closed`/`cancelled` now arrives as `RpcError` with that
   `code`; every `instanceof TransportError` check misses it and shows an error (§6.1).
2. No own consumer branches on any `E_*` code; a path that should (repo released, git missing,
   frame too large) shows raw text (§6.1, §6.7).
3. Stale comments describing the removed transport supersede (`graphView.ts:161-162,522-523`).
4. Corrupted-chunk re-open awaits a new stream inside the old stream's `onChunk`; old stream's
   credit gate and rejection interplay (`graphView.ts:521-527`).
5. `undo()` applies its result with no post-await repo check (`ops.ts:1490-1505`).
6. `runPull`/`runPush` preflight rejection propagates before `busy` is set; caller handling.
7. A state class constructed per mount with no `dispose()` (subscriptions leak on unmount).
8. `plan.value` set before the layout lands; `readSlice` paints a new plan against an old layout
   (collapse toggle, tips change) (`graphView.ts:462-466`, `graphColumn.ts:33-58`).
9. `layoutClient` frontier always reset before submit: full re-layout per rebuild on large repos.
10. `LayoutStore.#collectLongSegments` scans every long edge up to the bound per row.
11. Literal NUL in `rowPlan.ts:108` makes git treat the file as binary.
12. `PackedStreamState` corruption re-open loops forever on deterministic bad data.
13. JS non-`u` `i` folding vs Go `(?i)` Unicode folding, and other dialect gaps the corpus lacks.
14. Stale `apps/kira-studio/internal/gitsearch` paths in four search files.
15. Structural wire copies in `git-core` drifted from `contract.ts` (no conformance check).
16. `ReviewFilesState.mark` drops a second toggle silently while one is pending.
17. `parsePersistedViewState` accepts non-finite or huge `scrollRow`/`loadedRows`.
18. `graphColumnWidth` 12-lane cap clips wider graphs.
19. `reviewRanges.ts:3` and `operation.ts:123` comments are stale.

## 10. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, one pass, in this block order** (bridge contract first, since every later block
  judges error and cancellation exits against it). About 14.1k production lines plus 6.7k test
  lines; read tests where they are the sole guard of a claim.
  1. **Bridge and Part 17 consumers:** `GU/bridge/client.ts`, `state/{latestRequest,
     repoScopedReload,pendingSlot,bootstrap}.ts`, every `TransportError` site (own and Part 19,
     read); `IPC/rpc.ts` (read). §6.1, §7.
  2. **Graph data and layout:** `GC/graph/*`, `GC/store/*`, `GC/testing/packedChunk.ts`,
     `GU/graph/*`, `GU/graphVisibility.ts`. Probes for §6.3 skew and edge cases.
  3. **Graph and review session state:** `GU/state/{graphView,packedStream,graphOrder,selection,
     review,reviewFiles,reviewComments,viewState}.ts`; `GC/model/{review,reviewRanges}.ts`.
     §6.2, §6.3, §6.5.
  4. **Search:** `GC/search/*`, `testdata/searchConformance.json`, `GU/state/search.ts`; Go
     `gitsearch/{dialect,query,matcher,literal}.go` (read). Run `TestDifferential` with
     `KIRA_GIT_DIFFERENTIAL=1`. §6.4.
  5. **Ops and side state:** `GU/state/{ops,refs,stack,stash,worktrees,pr,repoSettings,repo,
     settings,detail,detailActions,working,fileListCursor,clipboardActions,
     liveAnnouncements}.ts`. §6.2, §6.5.
  6. **`git-core` models, preflight, settings, util, ports:** remaining `GC` files and
     `GU/index.ts`; structural-copy diff against `IPC/contract.ts`. §6.6.
  7. **Tests and conventions:** 33 specs against the bar; §6.8, §6.9; confirm every guard claim
     cited in findings.
- **Resumable:** write `docs/v2.0/plans/P168-part18-findings.md` as blocks finish, and commit it
  after **every** block (`docs(v2.0): P168 Part 18 findings, block <n>`; normal commit, hooks
  green, explicit `git add <path>`). An interrupted run reads the file, resumes at the first block
  not marked done, and never re-derives a committed block.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a
  concrete failure scenario (inputs, sequence, observed outcome), a proposed fix, "verified" or
  "code-read". Tag `needs-other-part-file: <path> (Part N)` when the fix needs another Part's file
  (§0). Tag `design-decision` when it needs one; the fixer turns it into its own `SPEC.md` phase.
- The findings file states base commit (`c9e3647`), HEAD reviewed, checks run and results (incl.
  `TestDifferential` with the variable set), findings, the fate of each §9 candidate (reported as
  `F<n>` or dropped with reason), then coverage per block: reviewed, skimmed (with reason), not
  reached. No unexplained gap. A chunk with nothing real says so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 18 findings`, before any fixer starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 18`, under
  §0's routing (Stream B files editable when required, each named in the commit body; Stream A/C
  files never, routed by the orchestrator to `P168-routed-from-streamB.md`). A fix re-runs
  `bun test packages/git-core/src packages/git-ui/src/state packages/git-ui/src/graph`,
  `bun run typecheck:git`, `bun run lint`; plus `typecheck:space-web` when a Space caller changed,
  `go test ./apps/kira-space/internal/gitsearch/...` with `KIRA_GIT_DIFFERENTIAL=1` when the corpus
  or a Go dialect file changed. It deletes the findings file when done. Chunk lands per pre-plan
  §3.4 before Part 19's plan starts.

## 11. Out of scope

- `git-ui` components, `App.vue`, `MountRoot.vue`, `main.ts`, icons, lib, theme, testing (Part 19):
  read only where an own state or graph contract is consumed; a defect there is tagged.
- `git-ipc` internals (Part 17, closed): report only a Part 18-visible break, tagged.
- Go `gitsearch` (Part 15, closed) beyond dialect parity with `GC/search`.
- Space `frontend` hosts (`repo/git/**`, `views/repo/**`, Part 22), ADE (Part 21), VS Code
  extension (Part 23): contract only.
- Part 9 (`@workbench`) test helper; parked decisions (§8); known open items (§8).
- Generated code, docs, excluded files (pre-plan §6).
