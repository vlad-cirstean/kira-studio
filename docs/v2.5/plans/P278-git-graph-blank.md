# P278 plan: Git graph commits go blank

Ask (SPEC row P278): Space git graph commits go blank on click or scroll; `Show more` and refresh appear
to do nothing. Root-cause it, bisecting from `e1318c7b9` (user's sync-repaint fix), `026f51230`,
`2ae54bbcf` through P262-P267 and P277. Guard written FIRST, shown failing on the current tree, kept
permanently: `apps/kira-space/tests/ui/graph-blank-rows.spec.ts` (Space `ui` project, mock-bridge native
stream, realistic multi-page history). Asserts after load, scroll to end and back, row click, `Show more`,
refresh, and a relayout race. Fix at cause; no timing loosening, no retries, no longer waits. Go flow test
only if the cause is Go-side (it is not, section 2).

Base: `v2.0` at `8ec5c5237`.

Discovery ran through `codegraph_explore`: `CommitGrid.vue` (`handleChunkLayout`, `scheduleResize`,
watchers, `onMounted`), `createCommitDataView`/`buildColumns`/`messageFormatter` (`lib/columns.ts`),
`createGraphFormatter`/`readSlice`, `GraphViewState` (`#applyChunk`, `#rebuildLayout`, `rebuildOrder`,
`#drainLayoutRebuilds`, `openStream`, `#runLoadSteps`), `PackedStreamState.applyChunk`, `GraphOrderState`,
`buildRowPlan`/`collapseBuckets`/`identityRowPlan`, `useGraphVisible`, `CommitStore`. Targeted reads:
`graphView.ts` 33-205 and 392-563, `CommitGrid.vue` 440-1311, `App.vue` 160-440 and 975-1017,
`packedStream.ts`, `layoutClient.ts`, `cancellableTimer.ts`, `usePaneResize.ts`, `ResizeHandle.vue`,
`Button.vue`, `gitsession/walk.go` `Stream`/`readFirstPagesLocked`, SlickGrid 5.20.0 `slick.grid.ts`
(`setColumns`, `invalidate`, `updateRowCount`, `ensureRowPositionIndexer`, `resizeCanvas`),
`gitStreamMock.ts`, `graphPagingFixture.ts`, `gitUiPortFixtures.ts`, `repo-graph-paging.spec.ts`,
`repo-graph-refresh.spec.ts`, `e2e-real/fixtures.ts`, `graphView.spec.ts`, `docs/ARCHITECTURE.md`
"Graph restart and PR facts".

## 1. Evidence

Probes were throwaway specs (deleted, not committed). Load average under 1 for every run.

### 1.1 Mock-bridge probes (Space `ui`, WebKit)

Fixture: 2 pages (5000 + 1240 rows, 500-row chunks), blocks of 20 rows (15 on `main`, 5 exclusive to a
side branch; every other side tip listed in `refs.list`, so the rest fall in the `other` group), a tag
every 37 rows, a merge every 60. Collapse on (the default). Checks per step: every row intersecting the
viewport has a non-empty `message-subject` (or placeholder text) and a graph `svg` with children; at
least `floor(viewportHeight / 46) - 1` rows visible; grid host bottom equals SlickGrid viewport bottom; a
screenshot pixel test per row band (paint, not only DOM).

1. Load, 20 wheel steps, scroll to end and top, row click, scroll to end, `Load`, 10 wheel steps, click,
   Refresh: no blank row, no paint blank, no page error. One defect only: after `Load` the toolbar row
   below the grid unmounts, the grid host grows 30 px, the SlickGrid viewport keeps its old height
   (`host bottom 931 viewport bottom 901`) until the next width change. Same at `afd51239d` (pre-fix).
2. Interaction during streaming (first open held, chunks released one at a time, 6 scroll+click
   bursts 3 ms apart per chunk): clean.
3. Microtask race: `Worker.prototype.onmessage` wrapped so an armed action (scroll by -400 px, dispatch
   `scroll`, click a row) runs 0-3 microtasks after the layout worker's reply is handled, i.e. after
   `plan.value` publishes and before the Vue flush and `handleChunkLayout`. Relayouts triggered by the
   collapse toggle, 8 injections hit: clean at base.
4. Refs ahead of the graph: `refs.list` answers `main` moved to a sha not in the store (`__sequence`),
   clock frozen so the auto-refresh never fires, `repo.changed refsChanged` emitted. `aria-rowcount`
   4422 to 255. HEAD's group is empty; the whole history collapses into placeholders. Fails at base.
   Same at `e1318c7b9` (4422 to 258, run with base's `gitStreamMock.ts`, since `e1318c7b9`'s mock has
   no `__sequence`).

The original `e1318c7b9` theory (the plan watcher's microtask gap) is not reachable by user input: input
events are tasks, the gap is inside one microtask checkpoint. Probe 1 passes at `afd51239d` (the commit
before `e1318c7b9`, sync repaint absent) and probe 3 passes at base.

### 1.2 Real backend probe (`e2e-real`, Chromium, `-tags server` binary)

Repo: `git clone --no-local` of this repository (6237 commits, 37 branches, 3 tags), page size 5000.
Load, 15 wheel steps of 3000 px, click, then 6 storms: `git commit --allow-empty` on the checked-out
branch, 8 wheel steps 120 ms apart, a row click. Samples:

- `storm0.1: only 13 rows visible, scrollTop 0, rowcount 13; ... | 1295 more commits on side-v2.0 |
  3694 more commits on v0.2.0`
- `storm0.3: only 10 rows visible, scrollTop 0, rowcount 10`
- `storm3.2` and `storm5.3`: `rowcount 0` (whole grid empty).
- Of 54 storm samples, 16 bad at base and 17 at `e1318c7b9`. Every sample before the storms and after
  settling is clean. No console error at base (the `e1318c7b9` run logged a `null.map` error from the
  base-tree Wails bindings copied into the worktree; unrelated).

This is the user's symptom: the list collapses to a dozen placeholder rows or nothing, the viewport snaps
to the top, clicks land on placeholders, and `Show more`/Refresh are ignored because `loading` is
`refreshing` (`LoadMoreButton.handlePress`, `RefreshButton.doRefresh` both return while busy).

### 1.3 Bisect

Commands run (read-only, plus a temporary worktree under the scratchpad, removed):

- `git log e1318c7b9..HEAD -- packages/git-ui packages/git-core` (63 commits), `git diff -M e1318c7b9
  HEAD` over `CommitGrid.vue`, `graphView.ts`, `packedStream.ts`, `layoutClient.ts`, `rowSvg.ts`,
  `RepoGraphView.vue`, `LoadMoreButton.vue`, `RefreshButton.vue`, `readTokens.ts`, theme CSS.
- `git show d768141f3` and `54af4c2d8` (P277 stream B).
- `git log -S lastRebuiltWidth` (width-only dedupe since `19fef8a8b`, Oct 6, before `e1318c7b9`).
- Worktree builds at `afd51239d` and `e1318c7b9` (`build:test`, `-tags server`) running probes 1, 4
  and 1.2.

Result: the reproduced behaviour is identical at `e1318c7b9` and base. No commit in the window changes
it. The report "regressed again" is the same cause `e1318c7b9` never fixed; it shows whenever refs move
often (ADE agents committing, auto-fetch, Space's own ops).

## 2. Causes, ranked

1. **Confirmed, primary: tips run ahead of the store.** `RefsState` reloads at once on `refsChanged`
   (and `applyOpResult` sets HEAD synchronously); `App.vue`'s tips watcher (383-395) calls
   `graphOrder.setTips` and `graphView.rebuildOrder()`. The graph refresh waits for
   `AUTO_REFRESH_COALESCE_MS` plus the re-walk. `buildRowPlan` then runs with group 0's tip (HEAD) on
   a sha the store lacks: group 0 is empty, every other row lands in a branch or the `other` group, and
   `collapseBuckets` contracts them. A moved non-HEAD branch does the same to its own rows.
2. **Confirmed: a refresh empties the list before refilling it.** `PackedStreamState.applyChunk`
   (89-92) clears the store on the first `from: 0` chunk; `#resetLayout` publishes `identityRowPlan(0)`;
   the grid drops to 0 rows and `scrollTop` to 0, then refills chunk by chunk. `loading` stays
   `refreshing` throughout.
3. **Confirmed, minor: a height-only resize never reaches SlickGrid.** `scheduleResize` (718-745)
   returns when the width is unchanged, so `resizeCanvas()` never runs; rows below the stale
   `viewportH` are never rendered (30 px strip after `Load` unmounts the toolbar row).
4. **Not a cause of the report, closed anyway: plan publish and grid repaint are two steps.**
   `#rebuildLayout` sets `plan.value`; the grid's row count follows on the Vue flush (`plan` watcher,
   `grid.invalidate()`) and the listeners after it. Same-task code in that window sees a grid sized for
   the old plan. Fix 2 must swap the store in that same window, so the two become one step (section 6).
5. **Rejected:** P277 stream B (`d768141f3`: constants moved to `refreshTiming.ts`, mock timers only);
   `026f51230` (adds the viewport ResizeObserver, same width dedupe); `2ae54bbcf` (before
   `e1318c7b9`); `252024ef8` (`createCancellableTimer`: same coalesce and min-gap semantics);
   `d8143dab4` (`usePaneResize` listens on the handle and, while dragging, on `window` only);
   `a20f994f9`, `446474f71`, `e02ba98da` (comments and moves in `CommitGrid.vue`); theme CSS
   (`git.css` unchanged; scrollbar rules moved under `pointer: fine`); `Button` `pending` (disables
   while loading, same as before).

No Go change: the host re-walk (`gitsession.Walk.Stream`) reads every page up to `keepRows` before
emitting, as designed. No Go flow test.

## 3. Guard spec first: `apps/kira-space/tests/ui/graph-blank-rows.spec.ts`

Commit it before any fix; run it at base and record which tests fail in section 11.

### 3.1 Support changes

- `tests/ui/support/graphBranchHistoryFixture.ts` (new): the 1.1 shape, sized to keep the spec fast:
  `PAGE_SIZE` 1000, `HISTORY_ROWS` 2000, `CHUNK_ROWS` 250, `BLOCK` 20. Exports `historyRows(from, to)`,
  `historySha(n)`, `HEAD_NEXT_SHA` (`'ab'.repeat(20)`, parent `historySha(0)`, subject `head moved`),
  `rewalkRows(withHead, count)` (optionally `HEAD_NEXT`, then rows 0 to count - 1), `refsList(headSha)` (`main` plus
  every other side tip), `pageChunks(rows, from, to, last)`. Reuses `buildPackedChunk` and
  `buildGraphStreamChunk`.
- `gitStreamMock.ts`: `graphStreamHoldOpen?: number` (default 0) names the open `graphStreamHoldAfter`
  applies to; `__kiraGitDelivered` counts chunks delivered per open, read by a new
  `gitStreamDelivered(page, open)`. Existing callers unchanged.
- `tests/ui/support/layoutWorkerProbe.ts` (new): `installLayoutWorkerProbe(page)` via `addInitScript`
  wraps `Worker.prototype.onmessage` so each worker reply bumps `window.__kiraLayoutReplies` and,
  when armed, runs an action `depth` microtasks after the app's own handler. Exports
  `layoutReplies(page)`, `armAfterLayout(page, depth, action)`. Test support only; no product hook.
- Shared assertion helper in the spec: `expectGridHealthy(page, { rowCount? })` checks, in one
  `evaluate`: every viewport row has non-empty subject or placeholder text and an `svg[data-testid=
  "graph-svg"]` with at least one child; visible row count is at least the viewport height over the badge
  row height (`--kira-graph-row-h`, read from the page, not a literal) minus one, or the plan length,
  whichever is smaller; grid host bottom equals viewport bottom (2 px tolerance); `aria-rowcount`
  equals `rowCount` when given. Fails with the offending rows listed.
- Every test installs the layout worker probe. Waits are on state: `layoutReplies` increments, `gitStreamDelivered`, `gitStreamRequests` counts,
  the `Load` button gone, the Refresh button not `aria-busy`. `waitForTimeout` is not used.

### 3.2 Tests

1. **load, scroll, click, Show more (collapse off and on).** Load page 1; toggle collapse off
   (`graph-collapse-toggle`): `aria-rowcount` = 1000. Healthy after load, after 20 wheel steps to the
   end and back to the top, after clicking a mid row's message cell. `Show more`: rows 2000, healthy at
   the end of the list (fails at base: the 30 px strip, cause 3). Toggle collapse on: row 0 to 14 show
   `commit 0` to `commit 14` (HEAD's group never collapses), healthy.
2. **refs move ahead of the graph (cause 1, fails at base).** Collapse on. `freezeClock` (P277 helper),
   scroll to 3000 px, record `aria-rowcount` R, `scrollTop` S, visible subjects V. Emit `refsChanged`;
   `refs.list` answers `__sequence: [refsList(historySha(0)), refsList(HEAD_NEXT_SHA)]`. Wait for the
   `refs.list` request count to grow and one more layout reply. Assert R, S, V unchanged and healthy.
   Then `runCoalesceWindow`; the refresh's re-walk (open 1) delivers `HEAD_NEXT` plus rows 0-999; wait
   for Refresh not busy. Assert row 0 subject `head moved`, `aria-rowcount` R + 1, the top visible row
   is the commit that was there before (sha anchor, 6.3), healthy.
3. **refresh keeps the list until the re-walk lands (cause 2, fails at base).** Show more first (2000
   rows), scroll mid, record R, S, V. Click Refresh with open 2 held after 1 chunk
   (`graphStreamHoldOpen: 2`, `graphStreamHoldAfter: 1`). Wait for `gitStreamDelivered(page, 2) === 1`
   plus 2 frames. Assert R, S, V unchanged, healthy (base: store reset to 250 rows, plan empty then
   short). Open 2 re-walks the same 2000 rows (no new commit: no tips change). `gitStreamRelease`; wait
   for Refresh not busy. Assert R and S unchanged, healthy.
4. **relayout race (cause 4, guard).** `installLayoutWorkerProbe`. For depth 0 to 3, for collapse
   toggle and a placeholder click: arm an action that scrolls 400 px up, dispatches `scroll`, and clicks
   the second-to-last rendered row, recording that row's subject. Trigger the relayout; wait for the
   layout reply count plus 2 frames. Assert healthy, the `aria-selected="true"` row's subject equals the
   recorded subject, no page error. Expected at base: health passes (probe 3); the selection check is
   new, record its base result. Either way it stays.

Every test also collects `pageerror` and console errors and asserts none.

## 4. Fix 1: tips reconcile against the store (cause 1)

`packages/git-ui/src/state/graphOrder.ts`:

- `setTips` keeps the requested list as is. `rebuild(store, generation)` builds from
  `effectiveTips(store)`, not the raw list, then records it as the applied list.
- Rule per requested tip at index i:
  - sha in `store` (`rowOfSha >= 0`): use it.
  - else i is 0 and the previously applied group-0 tip's sha is in `store`: use the previous sha with
    the new key and label (HEAD moved past the loaded history, or a detached HEAD changed key).
  - else a previously applied tip with the same key has its sha in `store`: use that sha.
  - else use it unchanged (an old branch beyond the loaded pages: an empty group, as today).
- `reset()` clears the applied list too.
- Every `#rebuildLayout` calls `rebuild`, so the next relayout after the re-walk delivers the new sha
  adopts the requested tip. No new trigger needed.

Unit tests (`graphOrder.spec.ts`, CLAUDE.md bar: four interacting rules): HEAD moved beyond the store
keeps group 0 expanded on the old sha; HEAD adopts the new sha once loaded; a moved side branch keeps
its rows grouped; a detached HEAD key change; a tip absent with no previous stays empty.

## 5. Fix 2: canvas follows height (cause 3)

`CommitGrid.vue` `scheduleResize`: track `lastResizedHeight` (host `clientHeight`) beside
`lastRebuiltWidth`. Width changed: today's path. Width same, height changed: `grid.resizeCanvas()` and
record the height. Same height and width: return.

## 6. Fix 3: one synchronous publish (cause 4) and an atomic refresh (cause 2)

### 6.1 One publish step

- `GraphViewState.#publish(plan, layoutChunk | undefined)`: replaces the publish blocks in
  `#rebuildLayout` (539-547) and `#resetLayout` (486-493). Sets `layout`, `#layoutPlan`, `plan.value`,
  `laneCount`, then calls every listener synchronously: `onPlanPublished((plan) => void)` replaces
  `onChunkLayout`; `LayoutRange` is deleted (grouped mode moves any display row, so a range never
  named the stale rows). `rebuildOrder` and the drain loop stop notifying.
- `CommitGrid.vue`: `handleChunkLayout` becomes `handlePlanPublished`: `raiseLaneFloor()`,
  `grid.invalidate()` (row count, row-height index, rendered rows, render), first-layout mark,
  `applyInitialScrollRow` retry. Backgrounded (`graphVisible` false): set `pendingRebuildOnVisible` and
  skip grid work, as the generation watcher does today; a hidden grid takes no input. The `plan` watcher (1100-1108) is deleted. The `generation` watcher
  keeps only its PR ancestry part and the backgrounded deferral; its grid calls go (the publish that
  accompanies every reset now repaints). Doc comments citing `43c8f760d`/`e1318c7b9` are replaced by
  one line: the grid repaints inside the publish, never later.

### 6.2 Staged restart

- `PackedStreamState` gains an opt-in `stageRestarts` constructor flag (GraphViewState passes `true`;
  `review.ts` keeps resetting in place).
- With it: a `from: 0` chunk while the live store has rows starts a staging `CommitStore`; that chunk
  and the rest append there. `loadedRows`, `remaining`, `exhausted`, `lastChunkSource`, `generation`
  stay untouched. `applyChunk` returns `{ staged: true }` for staged chunks.
- Staging completes when `staging.rowCount >= targetRows` (the live row count at restart) or the chunk
  is exhausted, or when the stream ends (`openStream`'s `finally`, before `await #layoutDrain`; a history
  that shrank). `reset()` and a corrupted staged chunk discard it (corrupted: today's re-open from 0).
- On completion `GraphViewState` sets `#pendingStore = staging` and queues a relayout. `#rebuildLayout`
  builds from `#pendingStore ?? store`; when it publishes a build from the pending store it first calls
  `store.replaceWith(pending)`, then applies the deferred scalars, bumps `generation`, then `#publish`,
  all synchronously. A stale build (another rebuild started later) publishes nothing; the later one
  also builds from `#pendingStore`, so the swap is never lost.
- `CommitStore.replaceWith(other)` (`packages/git-core/src/store/commitStore.ts`): moves every private
  field of `other` into this instance (fields lose `readonly`), leaves `other` empty. Keeps every
  captured `store` reference valid (`createCommitDataView`, `createGraphFormatter`, `SelectionState`,
  `PrState`). No unit test (a move, CLAUDE.md bar).
- `#resetLayout` stays for repo switch and the non-staged path.

### 6.3 Auto-refresh viewport anchor

`App.vue` (990-1011): capture the top row's sha (`graphView.store.shaAt(getViewportTop())`), restore
with `rowOfSha` then `scrollToTopRow`. Rows shift by the number of new commits; the sha is the stable
anchor. Unknown sha after refresh: no restore (today's out-of-range behaviour).

### 6.4 Unit tests (`graphView.spec.ts`)

- "restart from row 0": plan and store keep the old 10 rows while the 3-row re-walk streams, swap to 3
  at stream end; the invariant (plan never exceeds store rows) keeps its `flush: 'sync'` watcher.
- New: a `rebuildOrder` racing the staged swap still swaps (concurrency, CLAUDE.md bar); `reset()`
  during staging discards it and the new repo streams progressively.
- "plan and layout publish together": listeners now see the published plan synchronously.

## 7. Other guards

- `repo-graph-refresh.spec.ts` "a refresh keeps the scroll position" (P277 open entry): rerun idle
  after the fix; the staged swap removes the shrink it raced. If it now passes under the P277 load
  recipe (`docs/DEV_ENVIRONMENT.md`), say so in section 11; P278 does not edit it otherwise.
- `repo-graph-paging.spec.ts`, `repo-graph-lifecycle.spec.ts`, `repo-graph-badges.spec.ts`,
  `repo-graph-columns.spec.ts`, `repo-graph-widths.spec.ts`, `repo-graph-branch-order.spec.ts`,
  `repo-graph-rewalk.spec.ts`, `repo-graph-stream-lanes.spec.ts`: unchanged, must pass.
- `docs/ARCHITECTURE.md` "Graph restart and PR facts": replace the restart paragraph with the staged
  swap, the reconciled tips rule and the single publish step.

## 8. Execution

One Sonnet implementer, sequential. Fixes 2 and 3 both edit `CommitGrid.vue`; fix 1 is one file plus
its spec, too small for a stream; every fix is verified against the one spec commit. No zero-overlap
split exists.

Commits, each passing `bun run typecheck` and `bun run lint`:

1. `test(space): graph blank rows guard` (section 3). Run at base, record per-test results in section 11.
2. `fix(git-ui): commit grid canvas follows a height-only resize` (section 5).
3. `fix(git-ui): row plan uses only tips the loaded history holds` (section 4 plus unit tests).
4. `refactor(git-ui): publish plan, layout and grid repaint in one step` (6.1).
5. `fix(git-ui): refresh swaps the re-walked history in at once` (6.2, 6.3, 6.4).
6. `docs: P278 architecture notes` (section 7).

After each fix commit, run `graph-blank-rows.spec.ts` alone and note which tests flipped. Then once, idle:
`bun run test:unit`, `bun run test:ui:space`. Fix at cause, commit per group.

One-off real-backend check after commit 5 (not committed): recreate 1.2 as a temporary `e2e-real` spec
(clone of the working repo into the fixture's `work` dir, 6 empty commits with 8 wheel steps 120 ms apart
each, the 3.1 health check per sample). Accept: 0 bad samples, `aria-rowcount` never below its pre-storm
value. Delete the temporary spec; record counts in section 11.

## 9. Verification (orchestrator, real checks)

1. `git log --format=%s` shows the spec commit before every fix commit; section 11 lists base failures
   for tests 1-3 with their decisive line.
2. `rg -n "waitForTimeout|toPass|retries" apps/kira-space/tests/ui/graph-blank-rows.spec.ts`: none.
   `git diff 8ec5c5237 -G'timeout: *[0-9]' -- apps/kira-space/tests/ui`: no timeout raised.
3. `rg -n "onChunkLayout|LayoutRange" packages/git-ui/src`: none. `rg -n "onPlanPublished"
   packages/git-ui/src`: definition in `graphView.ts`, caller in `CommitGrid.vue`.
4. `rg -n "watch\(\s*\(\) => props.graphView.plan" packages/git-ui/src/components/CommitGrid.vue`: none.
5. `rg -n "replaceWith" packages/git-core/src/store/commitStore.ts packages/git-ui/src/state/graphView.ts`:
   both hit. `rg -n "stageRestarts" packages/git-ui/src/state`: `packedStream.ts` and `graphView.ts` only.
6. `rg -n "effectiveTips|rowOfSha" packages/git-ui/src/state/graphOrder.ts`: hit.
7. `bun run test:ui:space` and `bun run test:unit` green in the implementer's log; the spec green alone 5
   times in a row idle.
8. Implementer's tool log shows `codegraph_explore` calls for any discovery beyond this plan.

## 10. Decisions (final)

- Spec on the mock bridge, no permanent `e2e-real` spec: probe 1.1.4 reproduces cause 1 there
  deterministically; CLAUDE.md keeps `e2e-real` for what cannot be split.
- History 2000 rows in the spec, not 6240: same branch and collapse shapes, faster; probes showed size
  did not matter.
- Collapse off for the row-count check in test 1: only then does `aria-rowcount` equal loaded rows.
- Race injection by wrapping the layout worker's `onmessage` in an init script: hits the real gap
  without a product test hook.
- Tips reconciled in `GraphOrderState`, not by delaying the tips watcher: `applyOpResult` and refs
  reloads both move tips; the plan builder is the one place both meet the store.
- Previous tip sha, not "drop the tip": dropping HEAD's tip promotes another group to index 0 and still
  reorders the list.
- Staged swap instead of a viewport-only restore: the store empty mid-refresh is the blank; restoring
  scroll later cannot show rows that are not loaded.
- `replaceWith` on the same `CommitStore` instance: a new instance would break every captured reference.
- Staging opt-in: review's restarts come from target changes, where an empty list is correct.
- Single publish step with `grid.invalidate()` in the listener: the swap must reach the grid in the same
  task, and grouped plans move rows anywhere, so a range-scoped invalidate was never sufficient.
- Sha anchor for the auto-refresh restore: row indices shift with new commits.
- `scheduleResize` resizes the canvas on height change without rebuilding columns: column widths depend
  on width only.
- No Go change, no Go flow test: the host re-walk behaves as designed.
- Single implementer: fixes 2 and 3 share `CommitGrid.vue`; fix 1 is too small for a stream.

## 11. Result

Pending.
