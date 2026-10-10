# P261 plan: git graph broken after P258

User report (verbatim): "The real issue is that it seems the graph is even more broken now. Not only
the labels aren't on another row than the commit text, but it's even worse than before. Add a repo,
edit some column widths. Maybe close the app and try again. I don't know how to say it but it's like
totally broken." Follow-up: graph worked fine about a week ago, broke in the last ~2 days; bisect it
and fix the root cause, not only add tests.

Base: `v2.0` at `b15b8e52c` (includes P258). One sequential Sonnet implementer (no split: every fix
lands in `packages/git-ui` grid/badge/graph-state files plus the same Space specs).

## 1. Method

- Discovery: `codegraph_explore` (main checkout index, same commit) for `CommitGrid`,
  `handleChunkLayout`, `fitColumns`, `buildRefBadges`, `TokenReader`, `createGraphFormatter`,
  `GraphViewState.#rebuildLayout`/`layoutCurrent`/`rebuildOrder`, `viewState`.
- Real stack, no mocks: `go build -tags server` Space binary, real SQLite and git, `build:test:space`
  frontend, Playwright WebKit (Chromium for one cross-check) at 1440x960, 1280x760 and 1100x800.
  Temporary probe specs under `tests/e2e-real/` (deleted, not committed).
- Repos: (a) generated repo, 214 commits, 6 long-named feature branches merged with `--no-ff`, 8
  tags, `origin` remote refs, HEAD tip carrying 4 refs; (b) shared sparse clone of this repo's own
  history: 5314 commits, 30 local branches, remote branches, an annotated tag, up to 6 refs per row.
- Steps: import via `CodeWorkspaceService.ImportRepo`, open graph, close detail pane, drag graph/
  author/date handles, drag detail pane, switch repo, switch module (Agents, back to Git), scroll,
  toggle collapse, narrow window, reload, kill and relaunch the server, reopen.
- Measured per state: row heights and tops (overlap), cell lefts/widths vs handle positions, badge
  strip and subject rects, SVG rect vs row and graph cell, viewport client/scroll sizes, lanes drawn
  per rendered row (`graph-svg` child count) polled every 500 ms, persisted widths after
  reload/relaunch.
- Bisect: throwaway worktree with linked deps, per-commit `vite build` + `go build -tags server`,
  same scripted scenario. Commits before P232's `NewHostLocator` find git on macOS only, so the
  throwaway tree patched `NewPlatformLocator` to `exec.LookPath` (test-only, never committed).

Shots (`P261-shots/`):

- `c0-real-1280.png`: a week ago (`1db2db17f`, before `a6c1aee25`). 19px rows, decorated rows 36px,
  badges on their own line above the subject.
- `p256-real-1280.png`: P256 end (`368a5148a`). 28px rows, decorated 45px, badges on own line, `+2`
  visible.
- `head-real-1280.png`: HEAD. One 28px line; badge strip cut mid-badge (`origin/p26`), `+2` gone.
- `head-real-1100-full-columns.png`: HEAD, detail closed, 1100px window: badges cut to a lone icon or
  one letter (`o`).
- `head-lanes-while-loading.png` / `c0-lanes-while-loading.png`: rows painted with an empty graph
  column while the 5.3k-commit history streams, at HEAD and a week ago.

## 2. Bisect

Candidates touching the grid in the window (`git log` over `packages/git-ui`, `gitrpc`,
`gitsession`, `bridge`, `repo/git`, `views/repo`): `a6c1aee25`/`4fd3624a6`/`64a73dd93`/`3ed5de420`/
`148f7d81c` (graph column width seeding and fit), P245 `1b4b6e6fb`..`7da62b3c6`, P256 `75b0db9fb`
`9c77e2aab` .. `368a5148a`, P257 `1cf98a7c4`/`5db938f91`, P258 `351dae01f`..`fd509dd53`. P259 has no
commit on `v2.0` yet.

| Build | Rows | Badges | Lanes during stream | Widths after relaunch |
|---|---|---|---|---|
| `c0` `1db2db17f` (week ago) | 19 / 36px | own line, whole, `+2` | empty 2.5-3.5 s | restored |
| P256 end `368a5148a` | 28 / 45px | own line, whole, `+2` | empty 2.5-4.8 s | restored |
| HEAD `b15b8e52c` | 28px | inline, cut mid-badge, refs and `+N` hidden | empty 2.3-6 s | restored |

Breaking commit: **`765a0fc85` refactor(git-ui): single-line commit rows, no HEAD band** (P258). It
moved badges inline (the "labels not on another row" report, undoing G-UX item 2b) and added
`BADGES_ROW_CLASS` `max-w-1/2 overflow-hidden` around badges that never shrink, so badges are cut
mid-label and later refs plus the `+N` chip vanish. `351dae01f` (Studio badge tones) and P245
`1b4b6e6fb` (19px to 28px row density) change the look only; no defect traced to them. Width
seeding/fit commits (`a6c1aee25`..`148f7d81c`), P256 and P257 showed no defect in this scenario.

## 3. Defects and root causes

### F1 Badges inline with the subject (`765a0fc85`)

P258 D1 replaced the two-row message cell (badge line over subject, G-UX item 2b, a user ask) with
one flex row and deleted the variable-height machinery: `CELL_MESSAGE_BADGES_CLASS`,
`rowMetadata` `height`/`rowHasBadges`, `expandedRowHeight`, `enableVariableRowHeight`,
`--kira-graph-row-h-compact`/`--kira-graph-row-h` pair, `compactRowHeightPx`, the two-regime
`nodeCenterY` in `graphColumn.ts`/`rowSvg.ts`. The user wants the badge line back.

### F2 Badges cut mid-label, whole refs and `+N` hidden (`765a0fc85`)

`columns.ts` `BADGES_ROW_CLASS` = `flex ... shrink min-w-0 max-w-1/2 overflow-hidden`. Inside it,
`buildRefBadges` builds `flex items-center gap-1 shrink-0` and every badge is `badgeVariants` (base
`shrink-0 whitespace-nowrap`, `packages/theme/src/components/ui/badge/variants.ts:10`). Nothing can
shrink, so the strip clips at half the message cell. Measured: real repo HEAD row at 1280 shows
`v2.0`, `origin/v2.0`, `origin/p26`, and the `+2` chip is clipped away; `origin/p258-impl` +
`p258-impl` renders as `origin/p258` with the second branch invisible. The `+N` tooltip, the only
place naming hidden refs, is unreachable when the chip is clipped. Any message cell under ~700px
(detail pane open on a laptop, or author/date widened) hits it.

### F3 Rows paint with an empty graph column while history streams (pre-existing, P93)

Present at `c0` and P256 too; not a regression, but it is what "close the app and try again" shows
on a large repo: after open, reload or relaunch the graph column stays empty until the stream ends
(measured 2.3-6 s at 5.3k commits; lanes appear when "Loading… (N remaining)" ends).

Root cause, `packages/git-ui/src/state/graphView.ts` `#rebuildLayout` (510-547): it publishes
`this.plan.value = plan` synchronously, then awaits the worker. `layoutCurrent` (484) is
`#layoutPlan === plan.value`, false until the worker answers, and `graphColumn.ts` `readSlice` draws
no lanes while false. `CommitGrid.vue`'s `plan` watcher (1066) invalidates on the publish, so rows
re-render laneless. During a stream the drain loop (`#drainLayoutRebuilds`, 619) starts the next
rebuild right after each one lands, and the tips watcher's `rebuildOrder()` (`App.vue:391-404`)
runs extra rebuilds whose `#layoutClient.reset()` marks the in-flight submit stale. So `plan` is
almost always one worker round trip ahead of `layout`; lanes show for about one frame per relayout.

### Not reproduced (tried, measured)

- Column width persistence: graph/author/date drags survive reload and server relaunch, per repo
  tab (`TabViewStateStore`); restored before first grid build (`App.vue` sets `columnWidths` in the
  same tick as `repoState`, `CommitGrid` reads it at setup).
- Header vs body mismatch: the grid has no header row (`showColumnHeader: false`); every resize
  handle sits at its cell boundary minus 2px (`-ml-0.5`) in every state.
- Row overlap or unequal heights at HEAD: none; all rendered rows 28px, contiguous.
- SVG vs row: SVG height equals row height, x equals graph cell left, width equals graph column.
- Horizontal page scroll or viewport overflow: `scrollWidth == clientWidth` in every state.
- Stale `invalidateAllRows`/`render` paths: `handleChunkLayout` redraws correctly; the generation/
  search/pr/stack watchers defer while hidden and replay on `graphVisible`.

Not graph, noted only: after reload the Space graph host shows the first imported repo, not the last
opened one. Out of P261 scope.

### Why P258 specs and baselines missed F1-F3

- Fixtures (`tests/visual/git-module.spec.ts`, `gitUiPortFixtures.ts`) carry at most 2 short refs
  per row on 10 rows at 1400px: the strip never reaches half the cell.
- `repo-graph-columns.spec.ts` asserts equal heights and node-on-subject only; nothing asserts every
  badge is whole or that `+N` is visible.
- Mocked streams deliver one or two chunks with layout landing at once; no spec samples lanes while
  later chunks keep arriving.
- F1 was a plan default (P258 D1), so specs were rewritten to assert it.

## 4. Defaults for user review

- D1: Decorated rows get the badge line back above the subject (two-line, taller row); plain rows
  stay one 28px line. Variable height returns for decorated rows only.
- D2: Badges never clip mid-badge. Ref badges become shrinkable (`shrink min-w-0`, label
  `min-w-0 truncate`, icon and check glyph `shrink-0`); the `+N` chip stays `shrink-0`. Up to 3
  visible plus `+N` (unchanged rule); the `+N` tooltip lists all refs. No `max-w-1/2` cap: the badge
  line owns the full message width.
- D3: Row density stays the app's 28px (P245); no return to the 19px rows of a week ago. Decorated
  row height = row height + badge line (`--kira-graph-h-xs`), the P256 45px recipe.
- D4: Studio badge tones (P258) stay; the PR badge shares the badge line.
- D5: F3 fixed in P261: `#rebuildLayout` publishes `plan` together with its layout (same
  synchronous block as `layout.append`), so a row never renders against a plan whose layout has not
  landed. New rows appear one worker round trip after their chunk, lanes included.
- D6: HEAD row keeps no band (P258 D2).
- D7: No new `e2e-real` spec: every behaviour here is UI-side (IPC unchanged) and reproducible with
  the mocked transport plus realistic fixtures. Real-stack probes stay a planning tool.

## 5. Changes

### 5.1 Badge line (F1, D1, D3) - `columns.ts`, `CommitGrid.vue`, `graph/graphColumn.ts`, `graph/rowSvg.ts`, `graph/geometry.ts`, `theme/readTokens.ts`, `theme/git.css`

Restore from `765a0fc85` (reverse hunks of these files), keeping everything else P258 did (Studio
tones, muted author/date, no HEAD band, `kira-*` runtime classes, `data-testid` hooks):

- `git.css`: `--kira-graph-row-h-compact: max(var(--kira-row-height), calc(var(--kira-graph-h-xs) +
  2px))`, `--kira-graph-row-h: calc(var(--kira-graph-row-h-compact) + var(--kira-graph-h-xs))`;
  `--spacing-graph-row-compact` points at the compact token again, `--spacing-graph-row` returns
  only if a caller needs it.
- `readTokens.ts`: track both lengths; `compactRowHeightPx` beside `rowHeightPx`.
- `columns.ts`: decorated message cell is `grid grid-rows-[var(--kira-graph-h-xs)_1fr]`, badge line
  `row-start-1`, subject `row-start-2`; plain cell keeps today's single flex line (no empty track).
  `rowMetadata` returns `height` for a row with a ref or PR badge (`rowHasBadges`, `prsFor`);
  `RowMetadataContext` regains `expandedRowHeight`.
- `CommitGrid.vue`: `rowHeight: compactRowHeightPx`, `enableVariableRowHeight: true`,
  `expandedRowHeight: () => rowHeightPx(tokenReader)`; graph formatter gets per-row height
  (`grid.getRowHeight(row)`) plus compact height. `handleChunkLayout` = `raiseLaneFloor()`,
  `invalidateRowHeights()`, `invalidateAllRows()`, `render()` (P92 item 4 needs the index rebuild,
  P258 found rows need the redraw). Token listener and `scheduleAncestryRebuild` keep both calls.
  Root keeps `min-h-graph-row-compact`; restored doc comments trimmed to the why.
- `graphColumn.ts`/`rowSvg.ts`/`geometry.ts`: node centre sits `compact / 2` above the row bottom
  (subject line); edges span the full row height.

### 5.2 Whole badges (F2, D2) - `columns.ts`, `refBadges.ts`, `badgeClass.ts`

- `BADGES_ROW_CLASS` = `flex items-center gap-1 min-w-0 overflow-hidden` (no `max-w-1/2`, no
  `shrink` games: the line is its own grid row).
- `buildRefBadges` container: `flex items-center gap-1 min-w-0` (drop `shrink-0`).
- `buildBadgeElement`: `refBadgeClass(variant, 'shrink min-w-0', ...)`; `BADGE_LABEL_CLASS` =
  `min-w-0 max-w-47.5 truncate`; icon and check glyph `shrink-0`.
- `buildOverflowBadge` and `buildPrBadge`: `shrink-0`.
- `overflow-hidden` on the line stays only as a last resort below the width of 3 icons plus `+N`.

### 5.3 Plan and layout land together (F3, D5) - `state/graphView.ts`

- `#rebuildLayout`: build `plan` into a local; do not assign `this.plan.value` before the await.
  After `layout.append(layoutChunk)`, assign `this.plan.value = plan` and `#layoutPlan = plan` in
  the same synchronous block. A stale submit (`LayoutClientStaleError`) publishes nothing.
- `layoutCurrent` stays (identity mode, reset), now true whenever a plan is visible.
- Check every reader of `graphView.plan` and `graphOrder.plan` (`CommitGrid`, `gridKeyboard`,
  `App.vue` toggle/reveal/selection, `columns.ts` collapsed rows, `LoadMoreButton`) still holds
  with the one-round-trip delay; `rebuildOrder()` already notifies listeners after the await.
- First confirm the mechanism with a mocked multi-chunk stream (5.4's spec) failing before the fix.

## 6. Tests

Geometry and persistence are UI-side; IPC is unchanged, so no Go flow test (CLAUDE.md test rule).

- New fixture helper in `tests/ui/support/gitUiPortFixtures.ts`: `realisticRows(n)`: n rows, merges
  every 12 rows, 6 long branch names, tags, remote refs, one row with 6 refs including a PR-free
  current branch. Reused by the specs below and the visual spec.
- `tests/ui/repo-graph-badges.spec.ts` (new), at 1280x760, detail open and closed:
  - decorated row: badge line bottom <= subject top; row height = plain row height + badge line;
    rows contiguous, no overlap; graph node `cy` within 2px of subject centre.
  - every visible badge whole: badge rect inside the message cell, label either fully shown or
    ellipsized (`scrollWidth > clientWidth` only on the label, never on the badge box).
  - a 6-ref row shows 3 badges plus a visible `+3`, whose tooltip names all 6.
  - after dragging the author handle wide (message cell narrow) the same holds.
- `tests/ui/repo-graph-columns.spec.ts`: replace "decorated and plain rows share one height" with
  the badge-line geometry; keep the overlap spec (`holdAfter`).
- `tests/ui/repo-graph-stream-lanes.spec.ts` (new): `realisticRows(1500)` in 6 chunks released one
  by one (`holdAfter` + `gitStreamRelease`) with a refs change between chunks; after each release,
  once layout lands, every rendered row's `graph-svg` has its node circle. Fails at base (F3).
- `tests/ui/repo-graph-widths.spec.ts` (new): drag graph, author and date handles, relaunch with the
  persisted tab state; widths and handle positions restored, each handle at its cell boundary
  +-2px, viewport `scrollWidth == clientWidth`.
- `packages/git-ui/src/state/graphView.test.ts`: concurrency case (qualifies under the unit-test
  rule): two overlapping relayouts, the first stale; `plan` never changes before its layout lands;
  `layoutCurrent` stays true across both.
- Visual: `tests/visual/git-module.spec.ts` decorates one row with 5 long refs; re-record
  `git-graph` and `git-graph-detail` only.
- Update specs P258 changed for the inline strip (`repo-graph-columns`, `repo-commit-meta` only if
  it reads grid badges, `repo-graph-pr-badge`).

## 7. Commit groups

1. `fix(git-ui): ref badges on their own line above the subject` (5.1).
2. `fix(git-ui): badges shrink instead of clipping, +N always visible` (5.2).
3. `fix(git-ui): publish the row plan with its layout` (5.3) + `graphView.test.ts` case.
4. `test(space): realistic-history graph specs for badges, lanes and widths` (6, UI specs + helper).
5. `test(space): git graph baselines with long refs` (visual re-record).
6. `docs: P261 result` (`plans/P261-result.md`, SPEC row Done, ARCHITECTURE git grid facts if any
   changed: two row heights, plan/layout swap).

## 8. Verification (targeted; disk ~2 GB free, machine loaded)

- Per commit (hook): `bun run typecheck`, biome, check scripts. If the hook is too slow for the
  worktree, `bun run typecheck:git` plus `bun test packages/git-ui/src` while iterating, full hook on
  each real commit.
- `bun test packages/git-ui/src/state/graphView.test.ts packages/git-ui/src/components`.
- `bun run build:test:space` once, then `node node_modules/.bin/playwright test
  --config=apps/kira-space/playwright.config.ts --project=ui repo-graph` (all `repo-graph-*` specs,
  includes the three new ones) and `repo-commit-meta`.
- `node node_modules/.bin/playwright test --config=apps/kira-space/playwright.config.ts
  --project=visual git-module --update-snapshots`, then once more without the flag.
- Real-stack recheck (not committed): rebuild the server-test binary, repeat §1's 5.3k-commit open /
  resize / relaunch scenario in WebKit at 1280x760; expect lanes on the first painted rows, whole
  badges, `+N` visible, badge line above subject.
- Check `df -h /` before each build; clear `apps/kira-space/test-results` after runs.
