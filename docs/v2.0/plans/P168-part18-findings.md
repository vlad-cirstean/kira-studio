# P168 Part 18 findings: `git-core` and `git-ui` logic

Plan: `P168-part18-git-ui-logic.md`. Base `c9e3647`; HEAD reviewed `6882b22` (plan commit only on
top). Reviewer reports only; no source edited. Paths as in plan: `GC` = `packages/git-core/src`,
`GU` = `packages/git-ui/src`, `IPC` = `packages/git-ipc/src`.

## Checks (at `6882b22`)

- `bun test packages/git-core/src packages/git-ui/src/state packages/git-ui/src/graph`: 375 pass,
  0 fail, 33 files, 4.0 s.
- `bun run typecheck:git`: clean.
- `KIRA_GIT_DIFFERENTIAL=1 go test -count=1 -v -run 'Conformance|Differential'
  ./apps/kira-space/internal/gitsearch/`: `TestConformanceCorpus_NonEmpty`,
  `TestConformanceCorpus_AgreesWithCompileAndMatchFields`, `TestDifferential` (0.74 s) all PASS.
- Probes: throwaway `GU/state/zzprobe*.test.ts`, deleted before each commit.

## Block status

- Block 1 (bridge, Part 17 consumers): done.
- Block 2 (graph data and layout): done.
- Block 3 (graph and review session state): done.

## Findings

(Severity order within each block; ids are stable once committed.)

### Block 1: bridge and Part 17 consumers

Nothing real in `GU/bridge/client.ts`, `latestRequest.ts`, `repoScopedReload.ts`,
`pendingSlot.ts`, `bootstrap.ts`. Ops-side error exits found while checking candidate 6 are
reported under block 5.

### Block 2: graph data and layout

**F1 (medium): grouped graph paints lanes from the previous layout for one worker round trip
after every plan rebuild.** `GU/state/graphView.ts:462-466` publishes `plan.value` before
`#layoutClient.submit` resolves (`:477`); `layout` is replaced only at `:495-497`.
`CommitGrid.vue:1041-1043` (Part 19) watches `plan` and calls `grid.invalidate()` at once, so the
formatter repaints with the new plan and the old `LayoutStore`. `readSlice`
(`GU/graph/graphColumn.ts:40-58`) guards only `row >= layout.rowCount`; every other row reads
`layout.laneOf(row)`/`segmentsInRow(row)` keyed to the OLD display rows. Scenario: grouped mode
(App passes a `GraphOrderState`), a page lands or auto-refresh adds a commit to group 0; every
display row below the insertion point shifts by one, so each visible row briefly shows the lane,
colour and edges of the commit that used to sit there. Collapse toggle and tip changes
(`rebuildOrder`, `:512-516`) do the same; `rebuildOrder`'s own doc comment names the stale paint
but only repaints after it. Duration is one full-store worker pass (O(rows); hundreds of ms on a
200k-row repo). Identity mode is unaffected (rows never move). Code-read.
Fix: record which plan a layout was built for and draw no lanes on a mismatch. E.g. a
`layoutPlan` field on `GraphViewState` set in the same synchronous block as
`layout.clear()/append()` (`:495-497`); `createGraphFormatter` takes a `layoutPlan` accessor and
`readSlice` returns the `lane: undefined` slice when `layoutPlan() !== plan()`. Text stays
first-paint; lanes fill in when the matching layout lands (the drain/`rebuildOrder` listeners
already repaint then). Touches `CommitGrid.vue` call site (`needs-other-part-file:
packages/git-ui/src/components/CommitGrid.vue (Part 19)`, Stream B, editable).

**F2 (low): `LayoutStore.#collectLongSegments` scans every long edge above the row, per rendered
row.** `GU/graph/layoutStore.ts:410-422` walks `#longEdges[0, upperBound)`; entries whose edge
closed long ago are skipped one by one. Every rebuild is now one full-store chunk
(`graphView.ts:474,495-496`), so `#applyPatches`/`#demoteIfNowShort` never run on this caller and
the "hundreds, not thousands" bound (`:52-59`) rests only on history shape. Probe (verified): a
200k-row synthetic history with one 80-row second-parent edge every 20 commits gives 9,996 long
edges; `segmentsInRow` for 60 rows costs 6.9 ms at the bottom of history vs 0.24 ms at the top
(one viewport render; half a 60 Hz frame on scroll near the bottom of a large monorepo).
Fix: index long edges by row block at `append` time (e.g. `LONG_EDGE_ROWS`-sized blocks, each
holding the refs of long edges that cover it; an unresolved edge registers to `rowCount`), so a
row query scans only its block. Memory is sum(span)/64 refs. Keep `segmentsInWindow` equality.

**F3 (low): literal NUL byte in `GC/graph/rowPlan.ts:108`.** `const OTHER_KEY = '<0x00>other'`
holds a raw `0x00` (`od -c` shows `'\0other'`). Git classifies the whole file as binary:
`git log -p -- packages/git-core/src/graph/rowPlan.ts` prints "Binary files ... differ", so
`git diff`, review tooling and `git grep` skip the file's text. Verified. Fix: write
`'\u0000other'` (same runtime value).

**F4 (low): a layout worker that fails to load leaves every later `submit()` pending forever.**
`GU/graph/layoutClient.ts:161-163` rejects the pending submits on `onerror`, but a module worker
whose script fails to load (CSP `worker-src` drift, chunk 404 after an extension update while a
webview stays open) is dead; later `postMessage` calls get no reply. `#drainLayoutRebuilds`
(`graphView.ts:560-579`) then awaits forever with `#layoutDraining = true`, so no later chunk
starts a drain and the graph column stays blank for the session with only one console line. The
synchronous `SecurityError` case already falls back (`:106-112`); the asynchronous load failure
does not. Code-read.
Fix: in `onerror`, if no response has ever arrived, terminate the worker and swap in
`createMainThreadWorker()` (re-post the still-pending requests, or reject them and let the next
rebuild submit to the fallback).

**F5 (low): dead code on the graph path.**
- `GC/graph/stashRows.ts` (`buildStashRowFilter`, `applyStashRowFilter`, exported at
  `GC/index.ts:18-19`): no caller anywhere in the repo (`git grep`), no test.
- `LayoutStore.segmentsInWindow` (`GU/graph/layoutStore.ts:227-242`): doc says it is
  `segmentsInRow`'s test oracle; no test or caller uses it.
- The frontier/resume path: `#rebuildLayout` calls `#layoutClient.reset()` before every `submit`
  (`graphView.ts:474`), so `frontier` is always `undefined` on submit and
  `LayoutStore.#applyPatches`/`#demoteIfNowShort` never see a patch in production.
  `layoutClient.ts:1-26` ("a page's layout resumes because this file threads the previous
  response's frontier") and `layoutStore.ts:115-124` still describe incremental paging.
  `layoutAppend`'s incremental contract stays covered by `lanes.test.ts`, so keep it.
Code-read. Fix: delete `stashRows.ts` and its two exports, and `segmentsInWindow`; drop the
`frontier` tracking from `createLayoutClient` (keep `reset()` as the stale marker) and rewrite the
two doc comments to the full-relayout model.

### Block 3: graph and review session state

**F6 (medium): `ReviewCommentsState.pending` latches true when the target changes mid-request.**
`GU/state/reviewComments.ts:91-110` (`remove`) and `:121-141` (`clear`) clear `pending` only
when `this.#target === target` still holds; `setTarget` (`:50-57`) never resets it. Scenario:
user clicks Remove on a comment; before the reply, the session retargets (base override, stale
banner acknowledged, branch switch, `review.target` push). The reply lands, the guard fails,
`pending` stays true; `ReviewCommentsPane.vue:95,148` disable Remove and Clear for the rest of the
view's life. Same defect G30 #6 fixed in `reviewFiles.ts:102-110`. Verified (probe: remove in
flight, `setTarget` to another branch, resolve: `pending` reads `true`).
Fix: `this.pending.value = false` in `setTarget`, mirroring `reviewFiles.ts:110`.

**F7 (medium): expanded branch groups re-collapse after every restart-at-zero re-walk.**
`GU/state/graphOrder.ts:86-96` prunes `#expandedKeys` to keys with at least one row in the plan
just built. After `graph.refresh` (manual or the auto-refresh every `refsChanged` schedules,
`graphView.ts:136-141`), the re-opened stream restarts at row 0 (`packedStream.ts:74-77` resets
the store), and the first `#rebuildLayout` runs with only the first chunk(s) loaded. A group whose
rows all sit past that point (an older branch) has no row in that plan, so its key is deleted;
when the rest of the rows land, the group is collapsed again. Scenario: user expands
`feature/old`, then commits on any branch or a fetch moves a ref; the auto-refresh re-collapses
`feature/old`. Verified (probe: expand `b`, rebuild on a 4-row partial store, rebuild on the full
store: plan length 13, not the expanded 15).
Fix: prune against the tip list, not the loaded rows: keep a key while some `#tips[i].key`
matches it (or it is the `other` key). That still drops dead branch names (the stated purpose)
without depending on how much history has streamed in.

**F8 (low): a deterministic corrupt chunk re-opens the stream forever.**
`GU/state/packedStream.ts:79-88` hands every `appendPacked` failure to `onCorrupted`;
`graphView.ts:521-527` and `review.ts:404-413` re-open from row 0 with no attempt limit. When the
server sends the same bad chunk every time (a `dictionaryBase` or row-offset bug, a malformed
packed buffer), the client loops: each pass re-walks history server-side and nests one more
`await` inside the previous stream's `onChunk`. A failure of the recovery stream itself rejects
into the old stream's queue, which is already `done`, so `rpc.ts:224-226` drops it: no error ever
reaches the user. Verified (probe: transport that always emits a chunk with a wrong
`dictionaryBase`, delivered by macrotask: 38 re-opens in 50 ms, unbounded; delivered by microtask
it starves the event loop).
Fix: count consecutive corruptions per open in `PackedStreamState` (reset on a successful
`applyChunk`); after one retry, stop re-opening and surface an error state (`GraphViewState`
announcement / `ReviewSessionState.phase = 'error'` with the assert message). Run the re-open
outside the old `onChunk` (`queueMicrotask`/`void`) so its failure is not swallowed.

**F9 (low): a second review mark while one is in flight is dropped silently.**
`GU/state/reviewFiles.ts:250-253` returns at once while `pending` is true. `FileTree.vue:622,750`
(Part 19) checkboxes are not disabled on `pending`, and the window spans the mark request plus
the `#loadDiff` re-fetch (`:268`). Scenario: tick file A, then tick file B within that window; B's
`mark` returns with no request, no `markError`, no announcement; B's checkbox snaps back. The
`pending` comment (`:67-69`) assumes only the two header buttons call `mark`. Code-read.
Fix: queue marks instead of dropping them (chain each `mark` onto the previous one's promise,
dropping only an identical same-path/same-state duplicate), keeping `pending` true until the queue
drains; or disable the tree checkboxes on `pending` (`needs-other-part-file:
packages/git-ui/src/components/FileTree.vue (Part 19)`).

## Candidate fates (plan §9)

1. Dropped. Webview-side cancel is local: the webview's own `createRpcClient` rejects with a
   local `TransportError('cancelled')` and posts `cancel`; `createRpcServer`'s `cancel` handler
   deletes `activeWork` first, so no `res` is ever posted (`IPC/rpc.ts:403-405,466-472`). The
   extension never aborts an upstream call except on webview cancel or server dispose (webview
   gone). A forwarded `transport-closed` (extension socket drop mid-request) arrives as
   `RpcError`; announcing it is correct, since the view is alive and the request failed. The
   `transport-closed` skip in `App.vue:312`/`ReviewView.vue:126` exists only for the view's own
   dispose, which is still a local `TransportError`. Code-read.
2. Dropped as its own finding. No path needs to branch on an `E_*` code: reconnect re-opens via
   `onReconnect`; `E_FRAME_TOO_LARGE` is parked (§6.7). Raw-message exits are covered by the
   OpsState error-exit finding (block 5).
3. Confirmed stale; grouped into the comments finding (block 7).
4. Folded into F8. The re-open itself is safe: `openStream` aborts the old controller, and
   `createRpcClient`'s abort listener marks the old entry `done` and RESOLVES (`rpc.ts:323-333`),
   so the old credit gate blocks nothing. (Plan §6.3's premise that a superseded `openStream`
   awaiter gets `TransportError('cancelled')` does not hold: abort resolves; no caller sees a
   cancel.) Only the swallowed recovery error is real, reported in F8.
8. Reported as F1.
9. Confirmed as dead code, reported inside F5. The O(rows) relayout per rebuild is the P93 §5.1
   design (rows scatter into groups), bounded in count by F11 coalescing; not re-reported.
10. Reported as F2 (probe numbers there).
11. Reported as F3.
12. Reported as F8 (verified).
16. Reported as F9.
17. Dropped. Both stores persist JSON (VS Code `getState`, Space `viewStateStore.ts`), which cannot
    carry `NaN`/`Infinity` (they serialize to `null` and fail the `typeof` gate). `loadedRows` is
    never read on restore (`App.vue:1320-1329` reads `columnWidths`, `detailWidth`, `scrollRow`);
    rehydration replays the host cache instead. `scrollRow` bounds belong to `CommitGrid.vue`
    (Part 19).
18. Dropped. Lanes past 12 clamp to the twelfth column by documented design (`rowSvg.ts:76-83`,
    `hitTest.ts:18-30`); `graphColumnWidth` and `laneAt` agree on the clamp.
