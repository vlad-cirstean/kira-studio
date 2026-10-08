# P220 plan: git graph lines vanish; Git panel tab resets

Base: `776abcbc3` (docs(v2.2): P219-P222 user fixes), branch `v22-fix-B`. Single sequential
implementer. The two parts touch disjoint files but are small; no stream split.

## Ask (user's words)

"git graph lines still dissapear on click and on scroll. Plus the default tab is repos in the git
module. I mean ofc persist the last one i moved to. Right now is always resetted."

Part 1: find the root cause of graph lane/edge lines vanishing, fix it, add a regression test that
fails before the fix. Part 2: Git panel default tab is Repos; the last tab the user picked persists
across module re-open and app restart.

## Part 1: graph lines

### Reproduction (done during planning, real component, WebKit)

Temporary Space UI spec (deleted, not committed) against `bun run build:test:space`: one repo, 300
linear commits via `installGitStreamMock`, first-ever mount (new repo tab, no persisted view state).
Measured per stage (initial, after a row click, after `scrollTop = 2000`):

- Graph cell and row `<svg>` width: `17` px at every stage. Header `style.width` `17px`.
- Lane 0 path: `M17.5,-0.5 V9.5 M17.5,9.5 V19.5`, node `cx=17.5`. Present in the DOM, never painted.
- Screenshot: half-clipped dots at the column's right edge, no vertical line anywhere.
- Resize handle reports `aria-valuenow="17" aria-valuemin="40"`: the width sits below the column's own
  minimum.
- After widening the column with the handle (`ArrowRight` x10, 112 px): lines render and survive both
  click and scroll. So row recycling, the formatter and the layout store are fine.
- Pixel check (screenshot decoded in-page via `createImageBitmap`): lane-coloured pixels only in
  x 14-16 at 17 px; x 14-20 (continuous line at x 17) at 112 px.

### Root cause

`CommitGrid.vue:855-870` seeds the graph width on a first-ever mount (`initialScrollRow` undefined)
from `graphColumnWidth(props.graphView.laneCount.value)`. At mount the layout worker has not answered
yet, so `laneCount` is `0` and `graphColumnWidth(0)` = `padLeft 11 + 0 + gutterPad 6` = 17 px. Lane 0's
centre is `laneX(0)` = 17.5 (`rowSvg.ts:80`). The row SVG is sized to the column width and carries
`clip-path: inset(-2px 0)` (P92 item 1: cut lanes past the column's right edge). That clip removes
every edge of lane 0 and half of each node. The seed never re-runs when the layout lands
(`handleChunkLayout`, `CommitGrid.vue:655`, deliberately does not rebuild columns since P92). The
seed also bypasses `minWidthFor('graph')` (40), and any later `setColumnWidth` on author/date emits the
whole `widths` object, so a 17 px graph width can reach persisted view state and survive restarts.

Every new repo tab is a first-ever mount (`TabViewStateStore` is per tab id), so this hits every newly
opened repository. Restored tabs open at the persisted width (95 px default) and look fine, which is
why it reads as intermittent.

Click and scroll: in the sandbox (Linux WebKit) lines are clipped from first paint. The user's
"disappear on click and on scroll" fits macOS WebKit painting a freshly inserted row's SVG before the
clip applies, then repainting it clipped when the row is re-rendered (a click invalidates the selected
row, a scroll recycles rows). Not verifiable here; the Mac check in Verification closes it.

### Why earlier fixes did not hold

- P203 (`77bcc9dd3`, v2.1) fixed a different defect with the same symptom wording: a re-walk from row 0
  left `plan` mapping old rows, `ShaTable: row N out of range` threw mid-render, rows went blank and a
  click re-rendered the broken grid. It touched `graphView.ts` `onReset` only; column width was never
  in scope. Its `#resetLayout()` also sets `laneCount` to 0 on every restart-at-zero, which keeps
  `laneCount` at 0 at any mount racing a re-walk.
- P92 item 1 introduced both halves of this bug together: the `laneCount`-derived seed and the
  horizontal `clip-path`. Before P92 the SVG overflowed visibly, so a narrow column still showed lanes.
- `130cb157c` (refactor, graph SVG CSS to `kv:` utilities) is not a cause: the built CSS still has
  `.kv\:\[clip-path\:inset\(-2px_0\)\]` and `.kv\:overflow-visible`, same rules as before.
- History before `19fef8a8b` is squashed; `git log -S`/`--grep` on graph files finds only the two
  commits above.

### Fix (file by file)

`packages/git-ui/src/components/CommitGrid.vue`

1. Graph floor: the graph column never sits below `minWidthFor('graph')` (`MIN_COLUMN_WIDTH`, 40 px).
   Apply it where `widths` is initialised from `props.columnWidths` (line 140), so an already
   persisted 17 px value heals on next mount. 40 px holds lane 0 plus a full node and stroke
   (`laneX(0) + headRingRadius + headRingStrokeWidth / 2` = 24.1).
2. Deferred seed: replace the mount-time seed block (lines 862-869). On a first-ever mount, seed
   immediately only when `laneCount > 0`; otherwise mark the seed pending and keep the incoming width
   (floored). In `handleChunkLayout`, when the seed is pending and `laneCount > 0`, compute
   `clamp(graphColumnWidth(laneCount), minWidthFor('graph'), DEFAULT_COLUMN_WIDTHS.graph)`, set it,
   call `rebuildColumns()` once, clear the flag. Never seed again for that mount, so a user drag always
   wins (P92 intent). Do not emit `update:columnWidths` for the seed: a derived width is not a user
   choice, same as today.
3. Update the comments that state the old behaviour: the P92 "one-lane repository opens at 30px"
   note at the seed, and `handleChunkLayout`'s doc comment (it now rebuilds columns exactly once, for
   the seed).

No change to `rowSvg.ts`, `graphColumn.ts`, `geometry.ts` or the `clip-path`: the clip is correct for a
column the user narrowed on purpose.

### Regression test

New `apps/kira-space/tests/ui/repo-graph-lines.spec.ts` (Space UI project, WebKit). Earns its keep:
the bug needs a real layout-worker round trip, a real SlickGrid and real paint, and it already
regressed once.

- Fixture: 300 commits with one side branch and a merge near the top (2 lanes), built with
  `buildPackedChunk`/`buildGraphStreamChunk` like `repo-graph-rewalk.spec.ts`.
- Helper `laneLineCoverage(page)`: screenshot a clip of the graph strip (first column, viewport top +
  margin, ~200 px tall), decode in-page (`atob` -> `Blob` -> `createImageBitmap` -> canvas; `fetch` of a
  `data:` URL is CSP-blocked, verified), resolve lane 0's colour from
  `getComputedStyle(path.kv-lane-0).stroke`, and return the fraction of pixel rows with a lane-0
  pixel at `x = floor(laneX(0))` (17). No new dependency.
- Case 1, first-ever mount: open the repo; wait until rows carry paths. Assert coverage >= 0.9 and
  `svg.kv-graph-svg` width >= `graphColumnWidth(2)`. Click a row; assert again. Scroll the viewport to
  row ~150; assert again. Fails before the fix (coverage 0, width 17).
- Case 2, restored tab with a bad persisted width: boot via `relaunch({ control: [tabsList ...],
  gitStream })` (pattern: `repo-workspace.spec.ts:496-530`), an active `repo-graph` tab whose
  `state.viewState` is a valid v8 `PersistedViewState` with `columnWidths.graph: 17`. Assert coverage
  >= 0.9 and graph width >= 40. Fails before the fix.

No unit test: the floor and the one-shot seed are short conditionals.

## Part 2: Git panel tab

### Root cause

- `apps/kira-space/frontend/src/repo/state/search.ts:305` `useRepoPanelTabStore` holds the tab in a
  plain `ref('repos')`. Nothing persists it, so an app restart starts at Repos.
- `apps/kira-space/frontend/src/repo/GitPanel.vue:73-80` watches `repoId` with `{ immediate: true }`:
  `if (!oldId && id) tab = 'files'; else if (!id) tab = 'repos'`. `GitPanel` unmounts when another
  module is shown (`modules.spec.ts:38`), so every re-open runs the watcher with `oldId` undefined and
  forces Files whenever a repo workspace is active. At boot `repoId` starts `''` (forces Repos), then
  the restored workspace flips it to Files. Net effect: the user's choice is overwritten on every
  module re-open, restart and first repo open. The comment above it (lines 58-62) states "Not
  persisted" as P84 §8.3's design; the user has now reversed that.

### Fix (file by file)

`apps/kira-space/frontend/src/repo/state/search.ts`

1. `useRepoPanelTabStore`: back `panelTab` with VueUse `useLocalStorage('kira.git.panelTab', 'repos')`
   (precedent: `ade/v2/state/adeBoardUi.ts:28-30`, `TerminalPanel.vue:60`). Getter returns the stored
   value only when it is `'repos' | 'files' | 'review'`, else `'repos'` (storage can hold junk).
   Update the store comment (persisted, default Repos, P220).

`apps/kira-space/frontend/src/repo/GitPanel.vue`

2. Delete the `repoId` watcher (lines 73-80) and its comment block (lines 58-66): no auto-switch on
   repo open, on mount, or on repo close.
3. `tab` computed getter: `repoId.value ? store tab : 'repos'`. With no repo workspace active, Files and
   Review have nothing to show, so the panel displays Repos without writing it; the stored choice comes
   back once a repo is active. Setter unchanged (writes the store). This also keeps the boot-time
   `repoId === ''` window from clobbering the stored value.
4. Check the `tab` watcher at lines 281-293 (review activation, `ensureReviewPanelWidth`) still behaves
   with an immediate `'review'` from storage on mount: it adds the active `repoId`, which is the
   intended cold-mount path. No change expected.

`apps/kira-space/frontend/src/repo/git/hostHandlers.ts:375` (`review.open`) keeps calling
`setRepoPanelTab('review')`; it now persists like any user switch. No change.

### Tests

New `apps/kira-space/tests/ui/git-panel-tab.spec.ts` (or a `describe` in `repo-workspace.spec.ts` if
the fixtures there fit better; implementer's call, say which in the Result):

- Fresh boot, open a repo from the Repos list: tab stays Repos (`git-panel-tab-repos` has class `on`).
  Fails before (flips to Files).
- Pick Review, switch to another module and back: Review still selected. Fails before (Files).
- Pick Review, `page.reload()` with a restored active repo workspace (tabsList fixture with
  `workspaceId`; `page.route` mocks survive reload): Review selected after boot. Fails before.

Existing specs: `repo-workspace.spec.ts` and `repo-graph-lifecycle.spec.ts` may rely on the old
auto-switch to Files after opening a repo. Run both; where a spec expected Files without clicking it,
add the explicit `git-panel-tab-files` click (the new intended flow), never restore the auto-switch.

## Verification (once, near phase end)

Fast checks per commit: the pre-commit hook (lint, typecheck). Then once:

1. `bun run build:test:space`, then `playwright test --config=apps/kira-space/playwright.config.ts
   --project=ui repo-graph-lines git-panel-tab repo-graph repo-workspace modules`.
2. Prove the regression specs fail before the fix: `git stash` the source changes (keep the specs),
   rebuild, run both new specs, record the failing assertion line each, restore.
3. Full `bun run test:ui:space` and `bun run test:unit` (git-ui `graphView.test.ts` and friends).
4. `bun run test:webview` (CommitGrid also ships in the VS Code webview; seed path is shared).
5. Visual: `bun run test:visual:space`; a graph baseline whose column width changes is expected only
   where it was below 40 px or seeded from 0 lanes. Update only those, and name them in the Result.
6. Mac handover in the Result: open a never-opened repo, confirm lines show, click rows, scroll; then
   switch modules and restart, confirm the Git panel tab is kept.

## Commits

1. `fix(git-ui): seed graph column width from the first layout, floor it at the column minimum`
   (CommitGrid.vue) plus `test(space): graph lines visible on first mount, click and scroll`
   (repo-graph-lines.spec.ts). Two commits, fix first.
2. `fix(space): keep the Git panel tab across module re-open and restart, default Repos` (search.ts,
   GitPanel.vue) and `test(space): Git panel tab persistence spec`. Spec adjustments to existing files
   go with the test commit.
3. Follow-up `fix(...)`/`test(...)` commits for anything verification finds (pre-existing failures
   included, per CLAUDE.md).
4. `docs(v2.2): P220 result`: `## Result` in this file (root cause confirmed, before/after evidence,
   suites run, visual baselines touched, deviations); `docs/v2.2/SPEC.md` P220 row status;
   `docs/ARCHITECTURE.md`: in the Git panel paragraph (around line 3666) one sentence that the
   Repos/Files/Review choice persists in `localStorage` (`kira.git.panelTab`), default Repos, shown as
   Repos while no repo is active; in the commit-grid notes one sentence that the graph width is seeded
   once from the first layout and floored at the column minimum because the SVG clips lanes past it.

## Deferred decisions

- Graph floor is 40 px (the drag minimum) for every repo, replacing P92's 30 px one-lane seed: one
  floor for seed, persisted value and drag.
- The column still does not grow when later history adds lanes (P92's choice, kept): lanes past the
  seeded width stay clipped until the user drags the handle. Auto-grow needs a "user set" flag in
  persisted view state (a version bump that discards everyone's state), out of scope here.
- The seed is not persisted until the user resizes a column, same as today.
- Tab storage is `localStorage`, shared by every Kira Space window of the profile, last write wins; not
  per window or per repo.
- With no repo workspace active the panel shows Repos but keeps the stored Files/Review choice.
- `review.open` from the host persists Review like a user click.
- macOS-specific paint timing (lines visible until click/scroll) is inferred, not reproduced; the Mac
  handover confirms it.

## Instruction for the implementer

Every fix here is named with file and line; `codegraph_explore` is not required for applying them. Use
it (load via `ToolSearch` "codegraph") if a spec fix leads into code you have not seen.
