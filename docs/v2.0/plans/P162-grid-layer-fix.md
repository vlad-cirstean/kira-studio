# P162 plan: grid canvas layer fix, Studio grids and git graph

Ships round 2 of [P162-grid-gap-bisect.md](P162-grid-gap-bisect.md) (R2.6 causes, R2.7 fix list).
Context: [P162-canvas-grid-investigation.md](P162-canvas-grid-investigation.md). Canvas migration
dropped by user decision (P165: no gain, worse memory on the user's Mac). SlickGrid stays.

Base: the commit that lands this plan. Single sequential implementer. A sibling session also
commits on `v2.0`: stage only the files named here, never `git add -A`, do not push.

## 1. Decisions

| # | Change | Ship? |
|---|---|---|
| D1 | Studio `.slick-grid-host .grid-canvas { contain: layout paint; }` | Yes |
| D2 | Studio header `.slick-header-columns { will-change: transform }` | Keep, unchanged |
| D3 | Studio per-cell borders | Keep, unchanged |
| D4 | Git graph `.kv-commit-grid .grid-canvas { contain: layout paint; }` | Yes |
| D5 | Overscan/runway, `content-visibility`, JS in `onGridRendered` | No (user decision) |

### D1 Studio canvas containment

Evidence: R2.2/R2.4/R2.5, headless WPE, 3 interleaved runs each, quiet machine. `contain: layout
paint` on the canvas: 30 to 47-51 fps, p95 ~69 to ~31 ms, frames over 50 ms -99 %, scroll RSS rise
~193 to ~86 MB. Best single change measured; `isolation: isolate` is 3-6 fps less.

Mechanism (R2.3, inferred): rows are stacking contexts (`contain: layout`, `.slick-row` rule) and
cells have `z-index: 1` (`slick.grid.css`). Runway rows above the viewport overlap the header
strip's `will-change` layer; without a stacking context on the canvas each overlapping row gets its
own compositing layer, rebuilt on every mount/unmount. The canvas boundary puts all rows in one
context.

Exact CSS. Add to `apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css` directly after
the `.slick-grid-host .slick-row` rule (line 192-214):

```css
/* P162: one stacking context and paint boundary for every row. Without it, runway rows that
   overlap the header strip's `will-change` layer each get a compositing layer in WebKit, rebuilt
   on every row mount (bisect R2.3: ~30 ms per mutating frame). */
.slick-grid-host .grid-canvas {
  contain: layout paint;
}
```

Applies to data grid (`SlickGridHost.vue`) and console grid (`ConsoleSlickGrid.vue`): both import
`slickTheme.css` and root at `.slick-grid-host`. Selector matches every pane canvas
(`.grid-canvas-left` gutter, `.grid-canvas-right` data), which is intended.

No cascade conflict: `slick.grid.css` sets only `.grid-canvas{position:relative;outline:0}`.

What `contain: paint` could clip, checked against current source. It clips to the canvas box;
SlickGrid sizes the canvas to the sum of column widths (`getCanvasWidth`) and at least the viewport
height (`th = Math.max(rowsHeight, viewportH - scrollbar)`, `slick.grid.ts` 6466). Rows are
`width: 100%` of the canvas and cells sit inside rows.

- FK/PK nav buttons (`.cell-nav-btn`): absolute inside the cell (`left: 4px`, 16 px). Inside.
- Selection fill and edges (`kira-cell-selected`, `sel-t/r/b/l`): cell classes, inset box-shadow.
  Inside.
- Search and staged layers (`search-match`, `kira-staged`, `pending-edit`): cell classes. Inside.
- Inline editor (`.slick-cell.editable`, `z-index: 11`, input `outline-offset: -1px`): already
  confined to its row by `.slick-row { contain: layout }` (D8 note). Inside.
- Insert-row `<input>` (`grid-cell-insert`): inside the cell.
- Pending-row rails (`.kira-gutter::before`, 2 px at `left: 0`): inside the gutter cell.
- Hover rule, type colours, NULL/truncated markers (`::after`): cell content. Inside.
- Row focus ring: none in Studio (`.slick-cell:focus{outline:none}`, no row outline rule).
- SlickGrid range decorator (`slick-range-decorator`, appended to `getActiveCanvasNode()`, offset
  -1 px, 2 px dashed): the only canvas child outside rows. Its outer 1 px at the canvas right edge
  is newly clipped when the drag range ends on the last column and the canvas is narrower than the
  viewport. Top/left edges coincide with the viewport clip already. Transient drag affordance;
  accepted, no compensation.
- Tooltips: `AttributeTooltip` binds to `headerRowEls` (header, outside the canvas); reka content
  portals to body. Unaffected.
- `FkPreviewPopover`: `position: fixed` sibling of `.slick-grid-mount` inside `.slick-grid-host`,
  not a canvas descendant. Unaffected.
- Context menus: workbench `contextMenu` store, portal. Unaffected.
- Empty states (`.no-rows`): siblings of the mount. Unaffected.
- Header, sort indicators, select zones, resize handles (`.slick-resizable-handle`, `right:
  -2px`): in `.slick-header-columns`, outside the canvas. Unaffected.
- Frozen gutter: own canvas (`.grid-canvas-left`), contained the same way. Scroll sync is pane
  `scrollTop`, not paint. Unaffected.
- Containing block for `position: fixed`: rows are already containing blocks (`contain: layout`),
  so nothing inside a cell changes. No fixed element is a direct canvas child.
- Drag-select autoscroll, `scrollRowIntoView`, `getCellFromEvent`: geometry/JS, not paint.
  Unaffected.

Compensations: none.

### D2 Header `will-change`: keep

R2.3: dropping it gives the same gain (+19 fps) alone. It was added for P22 §14.2's horizontal
header repaint (91 % fewer header paints, Chromium CDP) and the real-Mac flicker report. Not
re-measured without it (R2.11). D1 fixes the same cause from the row side without touching the
header. R2.4: both together give nothing over D1 alone (48.5-53.4 fps versus 47-51). Keep it. The
Mac A/B (section 4) offers H1 for information only; dropping it is a separate user call.

`tests/ui/tooltips.spec.ts` depends on this strip being a containing block (its comment at
line 311). Keeping D2 leaves that test untouched.

### D3 Cell borders: keep

Worth +5-7 fps on top of D1 (R2.4), but no cheaper equivalent was found: inset `box-shadow` far
worse (runs never finished), row `border-bottom` partial. No measured construct qualifies. Leave
`.slick-grid-host .slick-cell` `border-right`/`border-bottom` as is. Removing or redesigning grid
lines is a visual design call for the user, out of this phase.

### D4 Git graph canvas containment

Host: `packages/git-ui/src/components/CommitGrid.vue`. Plain `SlickGrid` (not `KiraSlickGrid`), no
`slick.grid.css` and no `slickTheme.css`; structural rules live in its own unscoped `<style>`
under `.kv-commit-grid`. Same SFC style ships to Kira Space desktop and the VS Code webview
(`apps/kira-space-vscode`, built by `scripts/build-vscode.ts`).

Which round-2 parts apply:

- Header `will-change` trigger: absent. `showColumnHeader: false`; no header strip exists. Column
  resize handles are `KuiColumnResizeHandle` siblings of `host` (absolute, `kv:z-2`), no
  `will-change`/transform. `grep will-change|isolation|contain packages/git-ui/src` finds nothing.
  The R2.3 penalty condition is not present by inspection.
- Row stacking contexts: present by another route. `rowTopOffsetRenderType: 'transform'` gives
  every row an inline `transform: translateY()` (a stacking context per row). Cells have no
  `z-index` (no `slick.grid.css`), so no cell-level contexts.
- Borders: `.kv-commit-grid .slick-cell { border: none }`. Nothing to apply.
- Overscan: `minRowBuffer: 3`. Untouched (D5).

So the equivalent is canvas containment only: it bounds every row's stacking context and paint
under one canvas context, so any composited layer above the grid (a webview overlay, a future
header, a different engine's overlap heuristics in WKWebView or Chromium) cannot split rows into
per-row layers. Expected neutral in the sandbox; the user asked for the same fix applied, not a
measurement. No git graph perf measurement in this phase.

Exact CSS. Add to `CommitGrid.vue` `<style>`, directly after the `.kv-commit-grid .slick-viewport`
rule (line 1352-1354):

```css
/* P162: one stacking context and paint boundary for every row (each row is a stacking context
   via its translateY transform), so no row can be promoted to its own compositing layer. */
.kv-commit-grid .grid-canvas {
  contain: layout paint;
}
```

What `contain: paint` could clip, checked against current source:

- Graph SVG overdraw (`.kv-graph-svg`, `overflow: visible`, `clip-path: inset(-2px 0)`, 0.5 px
  vertical overdraw): spills only between adjacent rows, which stay inside the canvas. At the
  canvas top and bottom edges the viewport clip already applies. Horizontally the SVG's own
  `clip-path` already cuts at the cell edge. No change.
- HEAD ring/halo (`.kv-graph-head-ring`, `.kv-graph-head-halo`): SVG content, same clip-path.
- Row focus ring (`.slick-row:focus-visible`, `outline-offset: -1px`): inside the row.
- HEAD row bar (`.kv-row-head`, inset box-shadow): inside.
- Ref/PR badges, current-badge ring (`.kv-badge-current`, `box-shadow 0 0 0 1px`): inside cells
  that are already `overflow: hidden`.
- Search highlight (`.kv-search-hit`), text selection (`enableTextSelectionOnCells`): inside cells.
- Tooltips: one hoisted `AttributeTooltip` sibling of `host`, reka content portals out.
- Row context menus, branch picker, force-delete popup: reka `DropdownMenu`/`Popover`, portals.
- Canvas width: `computeMessageWidth` fills the host, so the canvas spans the viewport. Nothing
  sits beyond its right edge.
- `position: fixed` containing block: rows are already containing blocks (transform). No fixed
  canvas child.
- Focus restore (`focus({ preventScroll: true })`, transform-positioned rows): layout/JS.
  Unaffected.

Compensations: none.

## 2. Tests

No new test. Two one-line CSS rules; nothing meets CLAUDE.md's bar for a dedicated test (no
parser, boundary arithmetic, concurrency). Rely on existing suites plus a perf probe for the
Studio grids.

### 2.1 Which suites cover these grids

Studio (`bun run test:ui:studio` builds then runs `ui` + `ui-timing`; narrow by file):

- `tests/ui/slick-grid.spec.ts`: selection, ranges, editor, nav, clipboard, scroll. Main guard.
- `tests/ui/scroll-trace.spec.ts`: `__kiraScrollTrace`, late cells.
- `tests/ui/cell-editor.spec.ts`: header select zone, editor dock.
- `tests/ui/data-view.spec.ts`, `tests/ui/console.spec.ts`: hosts end to end.
- `tests/ui/tooltips.spec.ts`: header tooltip containing-block case (D2 kept, must stay green).
- `tests/visual/data-view.spec.ts`, `tests/visual/console.spec.ts` (`bun run test:visual:studio`):
  pixel baselines of both grids.

Git graph:

- `apps/kira-space/tests/ui/repo-workspace.spec.ts`, `repo-graph-lifecycle.spec.ts`
  (`bun run test:ui:space`).
- VS Code webview: `apps/kira-space-vscode/tests/interaction/graph-*.spec.ts`,
  `branch-picker.spec.ts`, `floating-geometry.spec.ts`, `tests/layout/webview-layout.spec.ts`
  (`bun run test:webview`, needs neither VS Code nor xvfb).
- Unit: `bun run test:unit` (covers `packages/git-ui/src`; no CSS assertions, run once as a sanity
  pass).
- No visual baseline exists for the git graph (`apps/kira-space/tests/visual` holds only
  `settings`).

### 2.2 Visual baselines without false failures

`docs/DEV_ENVIRONMENT.md` "tests/visual/* pixel diffs": this sandbox's fonts differ from the CI
image, so baselines can fail with a uniform glyph-antialiasing diff unrelated to code. Never run
`test:visual:update:*` from here.

Procedure (compare sandbox against sandbox, not against the CI baseline):

1. Before commit 1, at the plan commit: `bun run test:visual:studio`. Record pass/fail per test
   and the diff pixel count Playwright prints. Copy every `*-actual.png` under
   `test-results/` for the data-view and console specs into the scratchpad (`visual-base/`).
2. After commit 2: rerun. Copy the new `*-actual.png` files to `visual-fix/`.
3. Compare each pair byte for byte (`cmp`). If bytes differ, view both images (Read tool) and
   Playwright's `*-diff.png`. Expected: identical. `contain` changes no painted pixel inside the
   canvas.
4. Any pair that differs is a real change: inspect the diff image. If it is the range decorator's
   right-edge 1 px (section 1, D1), note it; anything else is a regression to fix.
5. Same failing set and identical actuals before and after means no regression, whatever the CI
   baseline says.

Passing tests write no actual image. If every visual test passes in step 1, step 5 reduces to
"still all pass".

### 2.3 Perf probe (Studio only)

Command, headless, from repo root:

```sh
bun run build:test:studio
NCOLS=20 bunx playwright test --config=apps/kira-studio/playwright.perf.config.ts grid-scroll
```

The `grid-scroll` filter matches both `grid-scroll.spec.ts` (data grid) and
`console-grid-scroll.spec.ts` (console grid). If `bunx playwright` reports "No tests found", use
`node node_modules/.bin/playwright` (DEV_ENVIRONMENT.md perf section).

Gate each run on `load1 <= 1.0` (`/proc/loadavg`); record `load1` per run. 3 runs at base (before
commit 1), 3 runs after commit 1. Then one `TRACE=1` run after the fix for uncovered px (expect 0,
as in R2.4). Record per grid: fps avg, mean p95 ms, total frames over 50 ms, RSS lines if printed.
Reference expectation from R2.2: base ~30 fps, p95 ~69 ms; fixed ~47-51 fps, p95 ~31 ms. A
result well short of that means the rule is not applied: check the built CSS (section 5).

## 3. Pre-existing failures

- `bun run lint:dead` (knip): P165 Result noted pre-existing unused exports
  (`packages/shared/protocol/page.ts`, git-ui row menu, repo schemas). Run it at the start. Fix
  every finding per CLAUDE.md: confirm zero callers with `codegraph_explore` before deleting an
  export, then remove the export or the dead code. Commit as its own group (commit 0). If a finding
  needs a real design decision or another subsystem's rework, add it as a named follow-up phase row
  in `docs/v2.0/SPEC.md` instead, and say so in the Result.
- Any failure in the suites in section 2.1 that also fails at the plan commit: fix it in this pass
  (own commit, `fix(...)`), unless it is the sandbox visual font drift (section 2.2), which is not
  a code failure.

## 4. Mac verification handover

The user A/Bs on a real Mac. The R2.8 helper and snippets assume an unfixed build; on the shipped
build use the off-switches below. Paste the helper first (R2.8):

```js
window.kiraAB = (id, css) => { const o = document.getElementById(id); if (o) { o.remove(); return `${id} OFF`; } const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.append(s); return `${id} ON`; };
```

| Snippet | Maps to | Where |
|---|---|---|
| `kiraAB('ab-canvas-off', '.slick-grid-host .grid-canvas{contain:none !important}')` | Turns D1 off (= R2.8 H0 base) | Kira Studio, data or console grid |
| `kiraAB('ab-hdr-wc', '.slick-grid-host .slick-header-columns{will-change:auto !important}')` | R2.8 H1, not shipped (D2 kept), information only | Kira Studio |
| `kiraAB('ab-no-borders', '.slick-grid-host .slick-cell{border-right:none !important;border-bottom:none !important}')` | R2.8 H4, not shipped (D3 kept), information only | Kira Studio |
| `kiraAB('ab-graph-canvas-off', '.kv-commit-grid .grid-canvas{contain:none !important}')` | Turns D4 off | Kira Space git graph; VS Code webview via Developer: Open Webview Developer Tools |

Per toggle, follow R2.8 protocol steps 1-5: Layers tab layer count and memory, Activity Monitor
footprint plateau over 10 s of sustained scroll, `__kiraScrollTrace` `gapFrames`/`uncoveredMax`/
`frameP95` over one hard flick (Studio dev build only). Expected if R2.3 holds on macOS: with D1
off, dozens of `slick-row` layers; with D1 on, one canvas layer. For the git graph, also check
graph lines meet without seams, the HEAD ring and badges render, row hover/selection and the
context menu work. Report per toggle: layer count, footprint plateau, gap frames, frame p95.

Rollback, one line each:

- D1: delete the `.slick-grid-host .grid-canvas { contain: layout paint; }` rule in
  `slickTheme.css`. Fallback if only the clip is the problem: `isolation: isolate` in its place
  (R2.2, 3-6 fps less, no clip).
- D4: delete the `.kv-commit-grid .grid-canvas { contain: layout paint; }` rule in
  `CommitGrid.vue`.

## 5. Steps and commits (single sequential implementer)

Fast checks per commit: the pre-commit hook (`bun run lint` + `bun run typecheck`). Run
`bun run lint:dead` after commits 0, 1 and 2. Expensive suites once, after commit 2.

0. (Only if knip reports findings at the start) `chore: drop unused exports flagged by knip`.
   Before anything else: run the base visual pass (2.2 step 1) and the base probe (2.3) at the
   plan commit, results kept in the scratchpad until commit 3.
1. `perf(studio): contain grid canvas paint for data and console grids`:
   `slickTheme.css` rule (D1). Then the after-probe (2.3).
2. `perf(git-ui): contain commit graph canvas paint`: `CommitGrid.vue` rule (D4).
3. Expensive verification, once: `bun run test:ui:studio` narrowed to the five specs in 2.1
   (pass the file names after the script's own args, or run `playwright test
   --config=apps/kira-studio/playwright.config.ts --project=ui <files>` after
   `bun run build:test:studio`), visual pass (2.2 steps 2-5), `bun run test:ui:space` narrowed to
   the two graph specs, `bun run test:webview`, `bun run test:unit`. Fixes for anything found land
   as follow-up `fix(...)` commits.
4. `docs(v2.0): P162 result`: this plan's `## Result` (probe tables base/after with `load1`,
   visual comparison outcome, suites run and their status, knip outcome, `codegraph_explore` call
   count in the implementer run, deviations), `docs/v2.0/SPEC.md` P162 row status to Done with
   headline numbers, and one sentence in `docs/ARCHITECTURE.md`'s "Data/console grid rendering"
   row: canvas `contain: layout paint` in `slickTheme.css` and `CommitGrid.vue`, with the reason
   (per-row compositing layers, P162). No Known open item: the pending Mac A/B is a verification
   step, not a limitation.

## 6. Orchestrator verification

- `git diff <plan-commit>..HEAD --stat`: only `slickTheme.css`, `CommitGrid.vue`, docs, and any
  knip cleanup files.
- `grep -n "grid-canvas" -A2 apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css
  packages/git-ui/src/components/CommitGrid.vue`: each shows `contain: layout paint;`.
- `grep -n "will-change: transform" apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css`:
  still one hit (D2 kept). `.slick-grid-host .slick-cell` still has both borders (D3 kept).
- Built output carries the rules (catches a dropped rule): after `bun run build:test:studio`,
  `grep -l "grid-canvas{contain:layout paint}" apps/kira-studio/frontend/dist*/assets/*.css`; after
  `bun run build:vscode`, the same grep over its output directory (see `scripts/build-vscode.ts`)
  for the `.kv-commit-grid .grid-canvas` rule.
- Result has base and after probe numbers for both Studio grids, 3 runs each, with `load1`; after
  is clearly above base (expect roughly R2.2's 30 to 47-51 fps).
- Result states the visual comparison method and outcome, and lists the suites run green.
- `bun run lint:dead` green, or each remaining finding moved to a named SPEC row.
- Real `codegraph_explore` calls are not required for the implementer (named fixes), but required
  for any knip deletion's caller check.

## 7. Risks

- Headless WPE is the only engine that showed the penalty (headed WebKitGTK pinned at 60 fps for
  every variant, R2.9). The Mac gain is unproven until section 4 runs. The change is cheap and
  low-risk either way.
- `contain: paint` clips at the canvas box: only the range decorator's 1 px right edge in one
  geometry is newly clipped (section 1). Fallback: `isolation: isolate`.
- Git graph: no measured gain; risk is visual only (graph seams, HEAD ring), covered by the
  webview and Space UI suites and the Mac check.
- Probe noise: sibling sessions share the machine. Gate on `load1`, report spread, never compare
  against a run from another batch.

## 8. Out of scope

- Dropping the header `will-change` (D2), cell border redesign (D3).
- Overscan/runway changes, JS runway or `onGridRendered` changes, `content-visibility` (user
  decisions).
- Git graph perf measurement (user decision).
- Canvas grid migration (dropped), P165 prototype code under `proto/grid/`.
- R2.10 open questions (stock-versus-app per-row layer difference, residual ~35 MB RSS).
- The Mac A/B itself (user-run, section 4).

## Result

Commits (branch `v2.0`, base `77871697`): `d2ceb523` perf(studio) D1, `26847d76` perf(git-ui) D4.
Commit 0 skipped: `bun run lint:dead` exits 0. It prints only "Duplicate exports" notes (same-value
aliases such as `BASE_LEAD_PX`/`OVERSCAN_PX`, deliberate) and knip config hints, no unused export.
Green after each commit. No `codegraph_explore` call (named fixes, no deletion).

### Probe (headless WPE, `NCOLS=20`, `load1` gate <= 1.0, no GPU)

Mean over the 5-flick ladder per run. Console grid first, data grid second.

| Grid | Runs | load1 | fps base | fps after | mean p95 base | mean p95 after | frames >50 ms base | after | RSS rise (sum of 5) base | after |
|---|---|---|---|---|---|---|---|---|---|---|
| Console | 3 | 0.79-0.95 | 42.6 / 40.4 / 42.0 | 61.8 / 61.6 / 61.4 | 42.6 / 48.0 / 45.2 ms | 17.8 / 17.8 / 18.6 ms | 24 / 81 / 42 | 0 / 1 / 0 | 186 / 203 / 200 MB | 148 / 142 / 146 MB |
| Data | 3 | 0.79-0.95 | 33.8 / 34.2 / 34.2 | 52.8 / 51.8 / 52.4 | 63.6 / 63.4 / 63.4 ms | 28.2 / 29.0 / 28.2 ms | 619 / 575 / 609 | 1 / 1 / 0 | 233 / 221 / 223 MB | 113 / 109 / 113 MB |

Data grid: +18 fps, p95 -35 ms, frames over 50 ms -99.8 %, scroll RSS rise about -50 %. Matches
R2.2 (30 to 47-51 fps). Spread across runs under 1 fps. Console grid gains the same way (the plan
set no console expectation). `TRACE=1` run after the fix: `uncoveredPx` max 0, gap frames 0 over
all 5 flicks (data grid). That one run had `load1` 2.05, not gated; it checks coverage, not speed.
Built CSS carries both rules: `.slick-grid-host .grid-canvas{contain:layout paint}` in Studio dist,
`.kv-commit-grid .grid-canvas{contain:layout paint}` in the Space and VS Code webview bundles.
Git graph: no perf measurement (user decision).

### Visual (sandbox against sandbox)

Base (plan commit): 13 passed, 1 failed: `console.spec.ts` console.png, 36 px diff vs the CI
baseline (font drift, section 2.2). After D1: 14 passed, same spec included. No actual images
remain to `cmp` (passing tests write none). The base failure did not reproduce; treat as sandbox
flake, not a code change. Diff `d2ceb523` touches only the new rule.

### Suites

| Suite | Result |
|---|---|
| Studio ui: slick-grid, scroll-trace, cell-editor, data-view, console, tooltips | 32 passed |
| `tests/visual` (`test:visual:studio`) after | 14 passed |
| Space ui: repo-workspace, repo-graph-lifecycle | 23 passed |
| `test:webview` | 60 passed |
| `test:unit` | 1771 pass, 0 fail |
| `lint:dead` | exit 0 |

Running bare `playwright` hits a global binary (version mismatch, "test() not expected"); use
`node_modules/.bin/playwright`. Header `will-change: transform` (one hit) and cell borders
untouched: the diff is 13 added lines.

### Deviations

None to scope. Probe filter `grid-scroll` also matches `proto-grid-scroll.spec.ts` (3 more
minutes per run); runs used the regex `tests/perf/(console-)?grid-scroll`.

### Mac handover

Paste the section 4 `kiraAB` helper first, then toggle on the shipped build:

| Snippet | Turns off |
|---|---|
| `kiraAB('ab-canvas-off', '.slick-grid-host .grid-canvas{contain:none !important}')` | D1 (Studio data or console grid) |
| `kiraAB('ab-graph-canvas-off', '.kv-commit-grid .grid-canvas{contain:none !important}')` | D4 (Space git graph; VS Code webview via Open Webview Developer Tools) |
| `kiraAB('ab-hdr-wc', '.slick-grid-host .slick-header-columns{will-change:auto !important}')` | Header `will-change`, information only, not shipped |
| `kiraAB('ab-no-borders', '.slick-grid-host .slick-cell{border-right:none !important;border-bottom:none !important}')` | Cell borders, information only, not shipped |

Per toggle, run section 4 protocol: Layers tab count, Activity Monitor footprint over 10 s of
scroll, `__kiraScrollTrace` `gapFrames`/`uncoveredMax`/`frameP95` over one hard flick. Report
layer count, plateau, gap frames, p95. Graph: check seams, HEAD ring, badges, hover, menu.

## Result: header will-change and border removal reverted

Mac report: white and dotted cell borders, header and frozen gutter lag while scrolling. Reverted
71d7c6a28 and 60ed063c8 (`will-change: transform` on `.slick-header-columns`, cell borders,
`tooltips.spec.ts` compensation, data-view baseline). Both stay out. `contain: layout paint` on
`.grid-canvas` (slickTheme.css, CommitGrid.vue) kept.

Open: Mac A/B must show whether `contain: layout paint` alone also causes the gutter lag. Paste the
section 4 `kiraAB` helper, then:

`kiraAB('ab-canvas-off', '.slick-grid-host .grid-canvas{contain:none !important}')`

Compare gutter and header lag with it on and off.

## Result: Mac report, borders restored

- Mac report after the border/header commits: white dotted cell borders, header and gutter lag.
- Transparent borders then made the cell lines vanish on the Mac (background leaks between cells).
  Real borders are wanted: `.slick-cell` `border-right`/`border-bottom` restored as shipped 10-05.
- Grid CSS now identical to 10-05 (`will-change` and `contain: layout paint` in place).
- Sandbox, 20 columns: solid borders 51.4 fps, transparent 54.3, `border: 0` 54.5.
- Gutter/header lag cause still open: Mac A/B `ab-canvas-off`; else JS pane sync, fix needs sticky
  header/gutter in one scroller.
