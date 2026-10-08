# P225 plan: git graph loses commits and lines, Show more breaks it further

Base: `717fe5ef2` (P225/P226 SPEC rows), branch `v22-fix-A`.

## Ask (user's words)

"The git graph is still broken the commits disappear. Also the show more got broke. This is a new
regression since last day. Fix it."

One sequential Sonnet implementer. No stream split: both fixes meet in the graph rendering path
(`rowSvg.ts`, `CommitGrid.vue`) and share one regression spec.

## Reproduction (done while planning, on this tree)

Scratch Playwright spec against the real Space bundle (`build:test:space`, WebKit), real layout
worker, real SlickGrid. Fixture: 3000 commits, 500-row chunks, 1000-row pages through
`installGitStreamMock`'s `graphStreamOpens` (open 1 = page 1, each Load more = next page), merges
every 10 rows, long edges (row `250k+6` gets second parent `+703`, crossing chunks and pages), ref
badges, a 4-parent fan in deeper rows. Steps: open repo, scroll, click a row, Load more, scroll,
Load more, Refresh, click. Per step it dumped each visible row's SVG path starts and node `cx`.
Then the same spec ran with `packages/git-ui` (and git-core/git-ipc) checked out at `a6c1aee25^`
(pre-P220) and at `19fef8a8b` (oldest commit in this shallow clone, 6 Oct).

Two defects, both deterministic, both platform-independent:

**A. Commits in outer lanes lose their node (clipped).** HEAD: graph column 69px =
`graphColumnWidth(4)`, the lane count of the first 500-row chunk only. The full first page needs 8
lanes. Rows 543-581: 7 of 43 visible nodes sit past 69px and are cut by the row SVG's
`clip-path: inset(-2px 0)`. After Load more, rows 1065-1102: 7 of 42 nodes cut. Screenshot shows
`feature-552`/`feature-572` rows with no dot. Pre-P220 the same fixture gives 17px: everything past
half of lane 0 is cut.

Cause: `CommitGrid.vue` `handleChunkLayout` applies the P220 seed once (`graphSeedPending`), on the
first layout that has lanes. `GraphViewState.#queueLayoutRebuild` (F11) starts that first relayout
as soon as chunk 1 lands, so its `laneCount` covers 500 rows, not the page. Later chunks and every
Load more raise `laneCount`, but the column never follows (`docs/ARCHITECTURE.md` states this as
intended: "later lane growth does not widen the column"). P220 replaced "17px, everything clipped"
with "first-chunk width, deeper lanes clipped"; it did not fix the symptom, only moved it down the
list.

**B. A merge's second-parent line is drawn on top of another lane (vanishes).** Node check on the
pure layout (`layoutAppend` + `LayoutStore`): history `0:[1,3] 1:[2] 2:[3] 3:[]` yields edge `0->3`
as `fromLane 0, toLane 0, kind merge-in`. Lane 1 is allocated (`laneCount` 2) but nothing is drawn
in it; the line runs over lane 0. In the browser: rows 957-958 before Load more draw four distinct
runs (x 56.5/43.5/17.5/30.5); right after Load more all four sit at x 17.5. Same output at
`a6c1aee25^` and `19fef8a8b`.

Cause: `lanes.ts` step 3b appends a second parent as `EDGE_KIND_BRANCH_OUT` from the claimed lane
P into a new lane N (`toLane = N`). When that parent row is later claimed by another lane C, step 2
calls `EdgeBuffer.patchConvergence(edge, C)`, which overwrites `toLane` with C and sets kind
merge-in. The edge record has no field left that holds N. `rowSvg.ts` `edgeCommand` draws a
merge-in edge's pass-through rows at `fromLane` (P), so the line lands on P's lane. Only the
straight-then-converge case was covered (G21 D3, `lanes.test.ts`); branch-out-then-converge never
was. Real trigger: "Merge branch 'main' into feature" and any merge whose second parent is also
reached by another lane. Load more exposes it on page 1 because P93 relays out the whole store on
every page: lanes reshuffle and an edge that was unresolved (fine) now converges (collapsed).

### Why "new since last day"

No code from the last 36 hours introduces either defect. A exists since P92 item 1 (user-set
column, clip at edge); B since G21 D3. P220 (yesterday) widened the first-mount column from 17px,
so lanes past lane 0 became visible for the first time on new repo tabs: B became visible, and A
moved from "all lanes gone" to "deeper lanes gone". Checked and ruled out: P203 `77bcc9dd3` (re-walk
now clean, no `ShaTable` errors that the 6 Oct build still throws on Refresh), the P213 CSS-to-
utility commits `130cb157c`/`58b821b03` (all generated utilities present in the built CSS, rows and
SVGs render; no overlap or gap between rows in any step), `2661cc30d`/`ee150dd34`/`7710ada90` (PR
badge only), Go side (no change to `gitsession` walk/stream since 6 Oct; `Walk.Stream` resume from
`marks[loadedRows]` works).

### Why existing specs missed it

- `repo-graph-lines.spec.ts`: one 300-row chunk, two lanes, both reached in the first chunk;
  `exhausted: true` so no Load more; only lane-0 pixel coverage near the top is checked.
- `repo-graph-rewalk.spec.ts`: 10 linear rows, one lane.
- `repo-graph-lifecycle.spec.ts`: bootstrap only.
- No Space UI spec clicks Load more. `graphView.test.ts` covers `loadMore` with a fake layout client;
  `lanes.test.ts` covers only straight-then-converge.

### Observed, not changed (see Deferred decisions D6)

After Load more, any Refresh or auto-refresh (`repo.changed` refsChanged, e.g. a fetch) drops the
list back to one page: Go `Walk.resetLocked` empties the walk, and `Walk.Stream` reads one page when
`cachedThrough == 0`, ignoring `resumeThroughRow`. Loaded commits vanish. Behaviour since G16 and
accepted by P203's spec ("a re-walk from row 0 with a shorter first page"). Not a regression.

## Fix A: graph column follows lane growth until the user resizes it

File: `packages/git-ui/src/components/CommitGrid.vue`.

- Replace `let graphSeedPending = false` with `let graphAutoWidth = false`. Comment: first-ever
  mount, the column tracks `laneCount` (capped at the default) until the user drags it.
- `onMounted`, inside the existing `props.initialScrollRow === undefined` branch: set
  `graphAutoWidth = true`; if `laneCount > 0` apply `graphSeedWidth()` now (as today). Drop the
  `else graphSeedPending = true`.
- New helper `growGraphColumn(): void`: return unless `graphAutoWidth` and `laneCount > 0`;
  `next = graphSeedWidth()`; return unless `next > widths.value.graph`; set widths, then
  `rebuildColumns()`. Grow-only (D2). Do not emit `update:columnWidths` (D3).
- `handleChunkLayout`: replace the one-shot block with `growGraphColumn()`, keep
  `grid.invalidateRowHeights()` after it.
- `setColumnWidth`: when `column === 'graph'`, set `graphAutoWidth = false` (the user's drag wins
  for the rest of this mount). Put it before the early return so a drag to the same value also
  ends auto mode.
- `graphSeedWidth()` unchanged: `min(DEFAULT_COLUMN_WIDTHS.graph, max(minWidthFor('graph'),
  graphColumnWidth(laneCount)))` (D1).
- Update the doc comments above `handleChunkLayout`/`graphSeedWidth` and the P220 comments: the
  seed now tracks growth. Rebuild count is bounded: at most `DEFAULT_GRAPH_LANE_CAP` steps.

Restored tabs (`initialScrollRow` set) keep the persisted width, as today.

## Fix B: an edge keeps the lane it runs in

Model change: every edge record carries three lanes. `fromLane` = source node lane, new `runLane` =
the lane the edge occupies on pass-through rows, `toLane` = target node lane. Straight: all equal.
Branch-out: `fromLane P`, `runLane N`, `toLane N`. Straight then converge: `L, L, C`. Branch-out then
converge (the bug): `P, N, C`.

- `packages/git-core/src/graph/types.ts`: `EDGE_STRIDE = 7`; add `EDGE_RUN_LANE = 6` with a doc line
  (set once at append, never patched). Update the `EDGE_STRIDE` doc ("six adjacent words" → seven)
  and `EdgeKind` doc (merge-in bends from `runLane`).
- `packages/git-core/src/graph/edges.ts`: `append` writes `EDGE_RUN_LANE = toLane`.
  `patchConvergence` unchanged in behaviour (touches `EDGE_TO_LANE`/`EDGE_KIND` only); doc: the run
  lane survives, which is what keeps a branch-out edge in its own lane.
- `packages/git-core/src/index.ts`: export `EDGE_RUN_LANE`.
- `packages/git-core/src/graph/lanes.ts`: no logic change. Fix the step-2 comment and module doc
  (convergence patches the target lane only; the run lane stays).
- `packages/git-ui/src/graph/layoutStore.ts`: `EdgeSegment` gains `readonly runLane: number`;
  `readSegment` reads `EDGE_RUN_LANE`. `#applyPatches` unchanged (patch `toLane` is the target lane).
- `packages/git-ui/src/graph/rowSvg.ts` `edgeCommand`: derive the shape from lanes, not kind:
  - `row === fromRow`: node centre to row bottom, `fromLane -> runLane` (bezier if they differ,
    else vertical).
  - `row === toRow` (resolved): row top to node centre, `runLane -> toLane` (bezier if they
    differ, else vertical).
  - otherwise: full-height vertical at `runLane`.
  This reproduces today's output for every straight, branch-out and straight-then-converge edge
  (their `runLane` equals the lane today's code draws), and fixes branch-out-then-converge. Keep
  the overdraw rules exactly as today (top overdraw only on pass-through/target rows, bottom only on
  source/pass-through rows). Rewrite the function doc (G21 D3c paragraph) to the three-lane rule.
  `EDGE_KIND_MERGE_IN` import goes if unused (D5).
- Anything else constructing an `EdgeSegment` or reading edges by stride: grep `EDGE_STRIDE`,
  `fromLane`, `toLane` across `packages/` and `apps/kira-space-vscode/` and add `runLane`. Known:
  `rowSvg.test.ts`, `layoutStore.test.ts`, `lanes.test.ts`, `graphColumn.test.ts` fixtures.

## Regression tests (write first, run on the unfixed tree, record the failures)

### `apps/kira-space/tests/ui/repo-graph-paging.spec.ts` (new)

Real component, real worker, real paint path. Reuse `installGitStreamMock` (5th arg
`graphStreamOpens`), `buildGraphStreamChunk`, `buildPackedChunk`, the `REPO`/`CONTROL`/`REPO_OPEN`/
`refs.list` shapes from `repo-graph-lines.spec.ts`. `refs.list` lists only `main` (one tip, identity
row plan). Mock results: `repo.open`, `refs.list`, `graph.refresh: {}`,
`graph.loadMore: { started: true }`, `graph.status: { loaded: 2000, remaining: 0, exhausted: true }`.

Support change: `buildGraphStreamChunk` options gain `remaining?: number` (default keeps today's
`exhausted === false ? 1 : 0`), so page 1 chunks can say `remaining: 1000`.

Fixture: 2000 commits, sha from row index, subjects `commit <n>`, chunks of 500 rows (chunks after
the first use `dictionary: []`, `dictionaryBase: 2`, as `repo-graph-rewalk.spec.ts` does). Open 1 =
rows 0-999 (2 chunks, `exhausted: false`, `remaining: 1000`); open 2 = rows 1000-1999 (2 chunks,
last `exhausted: true`). Shape constraints, verified with a scratch bun script over `layoutAppend`
before writing assertions (scratch only, not committed):

- Rows 0-999 never need more than 2 lanes: simple merges `b:[b+1,b+2]`, side commit joins main a few
  rows down; plus B shapes `k:[k+1,k+3]`, `k+1:[k+2]`, `k+2:[k+3]` (second parent converges).
- One B shape across the page boundary: row 990 second parent 1003, 991-1002 the main line. Before
  Load more the edge is unresolved (drawn fine); after Load more it converges.
- Rows 1000-1999 need 5 lanes (a fan every 50 rows, e.g. `r:[r+1,r+11,r+21,r+31]`, side lines
  joining main), never more than 6 (`DEFAULT_GRAPH_LANE_CAP`, so the fixed width can show all).
- A few ref decorations (tag every 37 rows) for variable row heights.

Helpers (in the spec): `visibleRows(page)` (rows intersecting `.slick-viewport-top.slick-viewport-left`);
`clippedNodes(page)`: per visible row, every `svg.kv-graph-svg circle` with
`cx + r > svg.getBoundingClientRect().width`; `stackedRuns(page)`: per visible row, parse every
`M<x>,-0.5 V<rowHeight+0.5>` full-height run from the row SVG's `path` `d` strings, report rows where
two runs share an x, or a run shares the x of that row's own node `circle` (a lane holds one open
edge or one node per row, so either case means a line is drawn on top of another). The node case is
the one the minimal B shape trips: the collapsed run passes through rows `k+1`/`k+2` on the node
lane; two runs at one x only show up when several converging edges collapse onto one lane.

Test 1 (A): "outer-lane commits keep their node across scroll, click and Load more".
Open repo; wait for graph SVGs. Scroll to the end of page 1, assert `clippedNodes` empty. Click a
visible row; assert empty. Click the Load more button (`getByRole('button', { name: /^Load / })`
inside `repo-graph-host`); assert row `1999` reachable (scroll to bottom, `.slick-row[data-row="1999"]`
visible, subject `commit 1999`) and the button gone. Scroll into the 5-lane region of page 2; assert
`clippedNodes` empty. Unfixed tree fails: page-2 nodes past the first-chunk width.

Test 2 (B): "a merge's second-parent line keeps its own lane, before and after Load more".
Open; scroll over a page-1 B shape; assert `stackedRuns` empty. Scroll to rows 990-999; assert empty.
Load more; assert empty again at rows 990-1003 and at the page-1 B shape. Unfixed tree fails at the
first page-1 B shape (and at 991-1002 after Load more).

Collect `console`/`pageerror` errors in both tests and assert none.

### `packages/git-core/src/graph/lanes.test.ts` (one new test; complex lane logic)

"branch-out edge that converges keeps its run lane": input `0:[1,3] 1:[2] 2:[3] 3:[]`, one pass:
edge `0->3` has `fromLane 0`, `runLane 1`, `toLane 0`, kind merge-in. Same input paged at row 3
(chunk 1 rows 0-2 with row 3 unresolved, chunk 2 row 3 with `resolvedParentSlots`): after applying
patches as the existing paged test does, edges equal the one-pass run, `runLane` included. Extend
`edgeAt` with `runLane`. Unfixed tree: fails to compile/run on `EDGE_RUN_LANE`, which counts; also
confirm by assertion that today's record has no lane 1 (`toLane 0`, `fromLane 0`).

## Verification

1. Write both tests. On the unfixed tree: `bun run build:test:space`, then
   `node node_modules/.bin/playwright test --config=apps/kira-space/playwright.config.ts --project=ui repo-graph-paging`.
   Record each test's decisive failing line (clipped node list, stacked-run rows).
2. Implement A and B. Re-run step 1: both pass. Run the other graph specs:
   `repo-graph-lines repo-graph-lifecycle repo-graph-rewalk repo-graph-pr-badge repo-graph-failures`.
3. `bun run test:unit` (git-core lanes, git-ui rowSvg/layoutStore/graphColumn/graphView).
4. `bun run typecheck`, `bun run lint`, `bun run lint:dead`.
5. Full Space UI suite once at the end: `bun run test:ui:space`. Fix any failure, pre-existing or not
   (CLAUDE.md rule).
6. `test:webview` once: the VS Code webview renders the same `rowSvg.ts`. If the container cannot
   run it, say so in the result with the reason (`docs/DEV_ENVIRONMENT.md`).
7. Count check: grep confirms `graphSeedPending` gone, `EDGE_RUN_LANE` read in `layoutStore.ts` and
   `runLane` used in `edgeCommand`.

## Commits (Conventional Commits, each with the session trailers)

1. `test(space): graph paging regression spec` (spec + `graphStreamFixture.ts` `remaining` option),
   and `test(git-core): ...` lanes case. Commit tests together with the fix they guard if the
   pre-commit hook rejects a red test; record the pre-fix failure output in the result either way.
2. `fix(git-ui): graph column follows lane growth until the user resizes it`.
3. `fix(graph): keep a converging branch-out edge in its own lane` (git-core types/edges/lanes doc,
   git-ui layoutStore/rowSvg, test fixture updates).
4. `docs: P225 result`.

## Docs

- `docs/v2.2/SPEC.md`: P225 status Done; `## P225 result` section (root causes A and B with the
  evidence lines, why not new code, why specs missed it, pre-fix failure lines, checks run, Mac
  handover). Keep it short, like P220's.
- `docs/ARCHITECTURE.md`, commit-grid paragraph (~line 3672): replace "seeds once ... later lane
  growth does not widen the column" with the auto-width rule (tracks `laneCount` up to the six-lane
  default until a user drag; grow-only; not persisted). Add one sentence on the three-lane edge
  record (`fromLane`/`runLane`/`toLane`; convergence patches only `toLane`).
- Known open items: add D6 (Refresh drops loaded pages) only if the user confirms it is unwanted;
  otherwise nothing.

## Mac handover check

Platform-independent causes, but the user saw it on macOS WebKit. On the Mac build:
1. Open a never-opened repo with deep history (more than 5000 commits, many branches). Scroll past
   the first few hundred commits: commits on outer lanes keep their dots up to the column edge.
2. Find a "Merge branch 'main' into …" commit: its second-parent line runs in its own lane down to
   the main commit, not on top of the feature line.
3. Click Load more: lines above stay where they were (no lines collapsing onto lane 0), new commits
   show dots.
4. Drag the graph column narrower, Load more again: the column keeps the dragged width.
5. Load more, then fetch or click Refresh: the list drops back to one page. Tell the user this is the
   existing re-walk behaviour (D6) and ask whether "commits disappear" meant this.

## Deferred decisions (defaults chosen)

- D1 Auto width cap stays six lanes (`DEFAULT_GRAPH_LANE_CAP`, P92's choice). Lanes 7+ still clip
  until the user drags wider. Alternative: cap at `GEOMETRY.maxLanes` (12).
- D2 Grow-only. A refresh resets `laneCount` to 0 and the re-walk's first chunk may need fewer
  lanes; shrinking would make the column jump on every auto-refresh.
- D3 Auto width is not emitted or persisted. A restored tab keeps its persisted width (default 95
  unless dragged), as today.
- D4 `UncommittedChangesStrip` sizes its graph cell from `App.vue`'s `columnWidths.graph` (default
  95), not the grid's auto width, so it can be misaligned on a first-ever mount. Pre-existing since
  P92; not touched here. Candidate follow-up row.
- D5 `EDGE_KIND` stays in the record (tests and patches use it); the renderer stops branching on it.
- D6 Refresh/auto-refresh after Load more drops back to one page (Go `Walk.Stream` reads one page
  after a reset). Pre-existing, unchanged. Ask the user whether this is part of "commits
  disappear"; if yes, a new SPEC row: re-walk reads pages up to `resumeThroughRow`.
- D7 P225 stays one phase with two fixes (A, B), one implementer. If the orchestrator prefers, split
  as `P225 Part 1` (A) and `P225 Part 2` (B); the spec's two tests map one-to-one.
