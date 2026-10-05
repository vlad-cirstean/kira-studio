# P162 bisect: app data grid versus stock SlickGrid

Investigation only. No product code changed. Base: `87a65ea9` (v2.0). Stopped early by user decision;
remaining variants listed in §5.

Question: why does the data grid run 30-35 fps (p95 59-71 ms) at 10 000 x 20 in headless WPE while
stock SlickGrid runs 53-61 fps (p95 20-30 ms)?

## Verdict

- Cost is paint/compositing, not JS and not style/layout. Forced style+layout right after each
  `render()`: p50 3 ms, p95 8 ms, max 38 ms. `renderMs` p95 2 ms (previous doc).
- Frames that mount new cells cost about 50 ms in the app versus about 18 ms in stock, almost
  independent of how many cells arrive (1-40 cells: 49-54 ms; 41-100: 53-65 ms). Total cells built
  per flick is the same in both (app 3.5-8.1k, stock 4.1-9.1k). A fixed per-mutation penalty, not
  per-cell work.
- Biggest measured lever: make `.grid-canvas` a stacking context (`isolation: isolate`). Frames
  over 50 ms drop about 90 %, p95 roughly halves, fps +8 to +19 against the paired base.
- Second: cell borders. Removing them gains about +3.5 fps alone.
- Stock with the app's full CSS bundle, frozen gutter, cell classes/attributes and 5 clipping
  ancestors stays at 45-61 fps. Best app variant reaches 39-48 fps. A gap of roughly 10 fps stays
  unexplained (§6).

## 1. Method

- Engine: Playwright WebKit (WPE, software rendering), 4 vCPU, window 1440x960, grid viewport
  1104x729 plus 56 px frozen gutter. Flick ladder: `FLICK_LADDER` from `perfProbe.ts` (5 flicks).
- App variants: scratch copy of the repo under the scratchpad, probe copied to `bisect.spec.ts`.
  Runtime flags (`window.__bisect`) added to scratch `SlickGridHost.vue`/`kiraSlickGrid.ts`; CSS
  variants built by editing the scratch `dist` CSS file (not CSSOM edits: WebKit CSSOM mutation
  confounds timings, see `noTwProps`/`noHover` CSSOM rows).
- Stock: standalone page, SlickGrid 5.20.0 browser bundle, same data generator, same column widths
  (read from the app), same viewport position/size, `enableMouseWheelScrollHandler: false`, row
  height 28.
- Row value = mean over the 5 flicks: fps avg, mean p95 ms, total frames over 50 ms.
- **Noise.** The machine is shared with sibling sessions (`vue-tsc` and builds observed at 60-98 %
  machine CPU). Unmodified base drifted 23-34 fps over the session. Runs after the 3rd matrix were
  gated on <25 % machine busy. Read every variant against the base run in the same batch (the
  "paired base" column), never against an older base.

## 2. Measurements

Repo probe, unmodified (`NCOLS=20 grid-scroll`, 2 runs): data grid 34.4 fps / p95 62.4 / 548 and
34.6 / 63.4 / 520. Console grid in the same runs: 41.0 / 46.8 / 77 and 41.6 / 44.8 / 40.

### 2.1 Stock, adding app factors

| Variant | fps | p95 | >50 | Runs |
|---|---|---|---|---|
| stock plain (no frozen, stock CSS) | 60.7 | 20.2 | 1 | 1 |
| + frozen gutter | 61.4 | 18.6 | 1 | 1 |
| + full app CSS bundle, `.slick-grid-host`, dark | 61.6 / 61.3 | 17.8 / 18.8 | 0 / 0 | 2 |
| all: frozen + app CSS + cell classes + cell attrs + NULL class + sortable | 59.0 / 58.4 | 21.6 / 21.8 | 0 / 1 | 2 |
| all, later batch (2nd started at 65 % busy) | 54.7 / 44.8 | 25.4 / 32.6 | 2 / 3 | 2 |
| all + 5 `overflow:hidden` ancestors, 6 px radius | 51.1 | 29.6 | 3 | 1 |
| all + clip5 + `.grid-canvas{isolation:isolate}` | 46.8 | 32.4 | 4 | 1 |

App CSS in stock includes Tailwind preflight, 68 `--tw-*` fallback properties on `*` (this WPE
lacks `margin-trim`; 297 custom properties per cell), borders, `display:flex` cells, hover rule,
`contain: layout` rows. None of it slows stock.

### 2.2 App, removing factors

Paired base: base run(s) in the same batch.

| Variant | fps | p95 | >50 | Runs | Paired base fps |
|---|---|---|---|---|---|
| base (scratch build, unchanged) | 33.2, 32.6, 32.9 | 59.8-61.8 | 380-425 | 3 | - |
| **`.grid-canvas{isolation:isolate}`** (batch A) | 44.5 / 36.3 | 37.8 / 43.8 | 45 / 39 | 2 | 30.9 / 28.5 |
| **same** (batch B) | 42.8 / 34.1 | 39.4 / 45.2 | 23 / 78 | 2 | 23.5 / 23.1 |
| `.grid-canvas{contain:layout paint}` (B) | 45.4 / 30.2 | 34.6 / 49.2 | 14 / 70 | 2 | 23.5 / 23.1 |
| **isolate + no hover rule + no cell borders** (B) | 48.0 / 38.7 | 34.4 / 42.6 | 14 / 36 | 2 | 23.5 / 23.1 |
| no cell borders + no hover rule | 36.1 / 36.2 | 53.6 / 51.4 | 161 / 119 | 2 | 32.6 / 32.9 |
| no cell borders (injected style) | 36.5 | 51.2 | 112 | 1 | 33.2 |
| no hover rule | 32.5 / 32.8 | 62.2 / 60.2 | 473 / 409 | 2 | 32.6 / 32.9 |
| `frozenColumn: -1` (gutter as normal column) | 35.1 | 51.8 | 158 | 1 | 32.6 / 32.9 |
| no Tailwind `@layer properties` (dist) | 26.3 / 33.7 | 84.2 / 57.8 | 634 / 321 | 2 | 32.6 / 32.9 |
| `.slick-viewport{isolation:isolate}` | 29.7 / 29.7 | 70.8 / 68.4 | 504 / 672 | 2 | 30.9 / 28.5 |
| cells `z-index:auto` | 25.4 / 31.8 | 84.0 / 63.8 | 638 / 484 | 2 | 23.5 / 23.1 |
| cells `z-index:auto` + rows `contain:none` | 30.1 / 21.1 | 75.4 / 109.4 | 582 / 789 | 2 | 23.5 / 23.1 |
| plain formatter + no column classes + no cell attrs | 32.3 | 62.6 | 441 | 1 | 33.2 |
| skip `tagRenderedRows` | 30.2 / 27.1 | 70.0 / 84.8 | 565 / 710 | 2 | 32.2 / 25.6 |
| skip `tagRenderedRows` + `onGridRendered` | 26.0 | 83.6 | 646 | 1 | 32.2 / 25.6 |
| upstream per-grid `<style>` instead of `--sg-l<i>` vars | 31.3 / 33.6 | 65.2 / 60.2 | 514 / 348 | 2 | 32.2 / 25.6 |
| upstream `getRenderedRange` (no runway; attribution only, out of scope) | 33.8 / 36.3 | 61.4 / 51.6 | 290 / 139 | 2 | 32.2 / 25.6 |
| ancestor `border-radius: 0` | 28.2 / 30.4 | 78.4 / 69.6 | 593 / 511 | 2 | - |
| other app panes `visibility:hidden` | 32.4 | 60.2 | 435 | 1 | 33.2 |
| CSSOM-deleted `@layer properties` (confounded) | 26.1 | 89.4 | 649 | 1 | 33.2 |
| CSSOM-deleted hover rule (confounded) | 32.5 | 62.6 | 419 | 1 | 33.2 |

DOM at rest: app 624 cells / 96 rows (48 per pane) / 875 grid elements; stock 810 cells. The fixture
has no table meta, so 0 FK/PK nav buttons were mounted; nav buttons are not a factor in this probe.
No running animations, no mutations outside the grid during scroll.

### 2.3 Per-frame attribution (MutationObserver on `.slick-cell`, one run each)

| | cells added per flick | per-frame batch p95 | frame after 0 adds | after 1-40 | after 41-100 |
|---|---|---|---|---|---|
| app | 3 497-7 878 | 78-143 | 17.7-21.2 ms | 48.7-53.7 ms | 53.3-65.1 ms |
| stock (all) | 4 110-9 120 | 30-60 | 15.9 ms | 17.2-18.5 ms | 19.0-22.8 ms |

## 3. Causes, ranked by measured gain

1. **Rows paint outside a stacking context of their own pane canvas.** Making `.grid-canvas` a
   stacking context: +8 to +19 fps against the paired base, p95 61-99 ms to 38-45 ms, frames over
   50 ms from 380-733 to 23-78 per ladder (4 runs, two batches). `contain: layout paint` on the canvas
   gives the same effect (2 runs). Mechanism, inferred not observed (no layer-tree access in this
   WebKit): rows are stacking contexts (`contain: layout`) and cells have `z-index: 1`; without a
   stacking context between them and the composited scroller, WebKit lists them in an ancestor's
   z-order and appears to rebuild compositing state whenever a row mounts or unmounts. That matches
   §2.3: a fixed ~30 ms penalty on every mutating frame. Isolating the viewport instead does nothing,
   which this inference does not explain.
2. **Per-cell borders.** No borders (plus no hover rule, which alone is 0): +3.5 fps, frames over
   50 ms from ~400 to 119-161 (2 runs). On top of the canvas fix, borders+hover off adds about +5 fps
   in the same batch (48.0 / 38.7 versus 42.8 / 34.1).
3. **Frozen gutter pane.** +2.5 fps, 1 run. Not a fix candidate: the gutter is a feature. Listed for
   attribution only.

Combined, measured in one batch: canvas isolation + no hover + no borders 48.0 / 38.7 fps, p95
34.4 / 42.6, 14 / 36 frames over 50 ms, against paired base 23.5 / 23.1 fps, p95 96 / 99, 707 / 733.

Measured, no gain: hover rule alone, Tailwind `--tw-*` fallback (inconclusive, 26.3 / 33.7), cell
formatter/classes/attributes, `tagRenderedRows`/`onGridRendered`, `--sg-l<i>` variable positioning,
ancestor radius, ancestor clipping (stock), cell `z-index:auto`, other app panes.

Not measured (stopped): overscan reduction. No overscan claim is made here.

## 4. Fix list

1. `apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css`: add
   `.slick-grid-host .grid-canvas { isolation: isolate; }`. Shared by data and console grids.
   Risk: low. Selection fill/edges, search and staged layers are cell classes, unaffected. The inline
   editor (`.slick-cell.editable`, z-index 11) is already confined to its row by `contain: layout`
   (the file's own D8 note); the canvas boundary is wider than that, so no new clipping. SlickGrid's
   range decorator lives inside the canvas, unaffected. Tooltips and `FkPreviewPopover` are portals.
   Header is outside the canvas. Tests: no DOM change; `tests/visual/data-view.spec.ts` should stay
   identical; rerun `slick-grid.spec.ts` and `scroll-trace.spec.ts`. Also worth applying to
   `packages/git-ui` `CommitGrid.vue` once measured there.
2. Same file, `.slick-grid-host .slick-cell` rule: replace `border-right`/`border-bottom` with a
   cheaper construct (row `border-bottom` plus column separators drawn once per row, e.g. a
   background gradient keyed off `--sg-l<i>`). Only "no borders" was measured (+3.5 fps); the
   replacement itself is unmeasured and must be A/B'd. Risk: visual (gutter separator, selection
   box-shadow edges sit inside the cell, unaffected); `tests/visual` snapshots change.
3. Hover rule: keep. Removing it measured 0.

## 5. Left to try

Each run takes 75-90 s plus a gate wait for a quiet machine (0-15 min, set by sibling load). Two
runs per variant minimum, paired with a base run in the same batch: about 5-35 min per variant.

- Mild overscan reduction (`OVERSCAN_PX` 560 to 400 per side, column and row base) with
  `__kiraScrollTrace` uncovered-px and `renderMs` beside fps. Requested; trades against late data.
  3 values x 2 runs plus paired base.
- `--tw-*` fallback removal, rerun quietly: inconclusive at 26.3 / 33.7. Dead CSS on macOS 14+.
- Border replacement construct (fix 2) measured for real.
- Remaining stock-to-app differences, to find the unexplained ~10 fps: header furniture (sort
  divs, badges, select zones, `will-change` header strip), the extra `.slick-grid-mount` wrapper,
  overlays positioned over the grid (empty states, tooltip anchors), KiraSlickGrid runway bursts
  (per-frame batch p95 78-143 cells versus 30-60; attribution only, runway is out of scope).
- Headed WebKitGTK (`PERF_HEADED=1` under `xvfb-run`) for the canvas-isolation result, second engine
  data point.
- WebKit layer-tree confirmation of the mechanism in §3.1: Safari Web Inspector Layers tab on a Mac.

## 6. Unexplained

- Stock with every app factor tested (app CSS, frozen gutter, classes, attributes, clip ancestors)
  stays at 45-61 fps; the app with canvas isolation and no borders reaches 39-48 fps. About 10 fps
  stays unattributed.
- Why stock pays no mutation penalty without canvas isolation, while the app does with the same CSS.
  The difference must be in DOM or layering outside the tested set (§5).
- Why viewport isolation does not help while canvas isolation does.

## 7. Verify on a Mac

- WKWebView composites on the GPU with async scrolling; a per-mutation compositing rebuild may be
  cheaper or dearer there. Record a Web Inspector timeline over one flick with and without fix 1;
  check the Layers tab for per-row layers before the fix.
- Border cost is software raster here; GPU raster may shrink it.
- `margin-trim` exists on macOS 14+, so the `--tw-*` fallback does not apply there.
- Memory: any layer-count drop from fix 1 may also lower the scroll-memory plateau
  (`docs/v1.1/WEBVIEW-SCROLL-MEMORY.md`); measure with its Appendix A harness.

## Round 2

Investigation only, no product code changed. Base: `3d1093ff` (v2.0). Grid code (`SlickGridHost.vue`,
`views/shared/slick/*`, `views/grid/slick/*`) is byte-identical to round 1's `87a65ea9`.

### R2.1 Method

- Same probe as round 1 (`bisect.spec.ts`, scratch copy, `NCOLS=20`-shaped wide page, 10 000 rows,
  5-flick `FLICK_LADDER`), rebuilt from current HEAD under the scratchpad. Headless WPE, 4 vCPU.
- CSS variants baked into a copy of the built `dist` CSS (no runtime CSSOM edits). JS variants via
  `window.__bisect` flags in the scratch build.
- Quiet machine: no sibling agents. Each run waits until load1 < 1.0, records load1, then runs.
  load1 stays at 0.9-1.0 between runs because the previous run is the only load (4 cores, so <25 %).
  No run hit the 1.5 discard limit.
- Runs interleaved (base, v1, v2, ..., base, v1, ...), 3 rounds, so drift hits every variant equally.
- Row value: fps avg / mean p95 ms / total frames over 50 ms over the 5 flicks.

### R2.2 Step 1: round-1 winners, re-verified

| Variant | fps (3 runs) | p95 ms | >50 ms | load1 |
|---|---|---|---|---|
| base | 30.0 / 30.4 / 29.8 | 71.2 / 67.8 / 68.8 | 752 / 695 / 712 | 0.96-0.98 |
| `.grid-canvas{isolation:isolate}` | 44.3 / 46.4 / 45.2 | 34.8 / 35.6 / 34.8 | 19 / 17 / 16 | 0.92-0.98 |
| `.grid-canvas{contain:layout paint}` | 50.8 / 48.0 / 47.2 | 29.8 / 32.4 / 32.0 | 4 / 9 / 6 | 0.92-0.95 |
| no cell borders | 35.1 / 34.4 / 34.2 | 54.8 / 58.0 / 57.4 | 252 / 317 / 317 | 0.93-0.96 |
| no hover rule | 30.5 / 29.9 / 29.1 | 68.0 / 68.6 / 77.0 | 705 / 737 / 777 | 0.92-0.98 |
| isolate + no hover + no borders | 49.3 / 50.3 / 51.0 | 32.2 / 30.8 / 30.6 | 11 / 10 / 5 | 0.94-0.97 |

Confirmed, with far less spread than round 1:

- Canvas isolation: +15 fps (+50 %), p95 halves, frames over 50 ms drop 97 %.
- `contain: layout paint` on the canvas: +18.6 fps, best single change, frames over 50 ms -99 %.
- No borders alone: +4.5 fps. On top of isolation (combo vs isolate): +5 fps.
- Hover rule: 0. Keep it.

### R2.3 Step 2a: the trigger is the header strip's `will-change`

DOM survey of the running app (computed styles, every element): the only compositing triggers near
the grid are `.slick-header-columns-left`/`-right` with `will-change: transform`
(`slickTheme.css`, P22 header-flicker fix). Their boxes are 28 px tall, directly above the
viewport, and very wide (left strip x -727..329, right strip x -671..3816; SlickGrid's -1000 px
header offset). Everything else (sidebar tree rows with `transform`, `position: fixed` 0x0 tooltip
anchors, `opacity` toolbar buttons) sits outside the grid's box.

| Variant | fps (3 runs) | p95 ms | >50 ms | load1 |
|---|---|---|---|---|
| base | 30.8 / 30.7 / 30.1 | 66.2 / 67.0 / 68.8 | 673 / 641 / 685 | 0.95-0.99 |
| **`.slick-header-columns{will-change:auto}`** | 50.8 / 46.6 / 50.0 | 29.8 / 34.0 / 30.4 | 4 / 9 / 4 | 0.95-0.99 |
| `.slick-viewport{isolation:isolate}` | 30.7 / 29.8 / 30.0 | 68.6 / 69.4 / 71.4 | 707 / 712 / 744 | 0.94-0.99 |
| `.slick-pane{isolation:isolate}` | 30.7 / 29.9 / 30.7 | 67.6 / 68.6 / 66.6 | 662 / 724 / 622 | 0.93-0.96 |
| `.slick-grid-host{isolation:isolate}` | 30.7 / 29.9 / 30.4 | 65.4 / 67.8 / 67.2 | 620 / 700 / 697 | 0.91-0.94 |
| rows `content-visibility:auto` | 36.2 / 35.6 / 35.5 | 52.8 / 54.2 / 55.0 | 144 / 174 / 186 | 0.93-0.97 |
| cells `display:block` (no flex) | 31.1 / 30.5 / 30.9 | 64.0 / 67.2 / 67.2 | 684 / 673 / 700 | 0.98-0.99 |

Dropping the header strip's `will-change` alone recovers the whole canvas-isolation gain (+19 fps,
frames over 50 ms -99 %). This names the mechanism round 1 inferred:

- The header strip is a composited layer. Rows are stacking contexts (`contain: layout`) painted in
  an ancestor's z-order, after the strip. The runway rows above the viewport (up to 560 px plus
  velocity lead) overlap the strip's box in WebKit's overlap test, since the viewport is not a
  stacking context and its clip does not scope them. Each overlapping row gets its own composited
  layer; every mount/unmount rebuilds layer state. That is the fixed ~30 ms per mutating frame.
- `isolation`/`contain: paint` on `.grid-canvas` puts every row in one stacking context (one layer
  at most), which is why it fixes the same thing from the other side.
- Isolating the viewport, pane or host does not: those boxes start at or above the strip, so they
  are themselves the overlapping layer and the rows inside still paint per-row. Inferred, not
  observed (no layer-tree API in this WebKit).
- It also explains why round 1's stock page never paid the penalty with the same CSS: stock's
  default range keeps ~3 rows above the viewport instead of 560 px of runway, so far fewer rows
  overlap the strip. Not separately measured.

`content-visibility:auto` on rows: +5.5 fps, not competitive with the two layer fixes and it
skips painting the runway (late-data risk), so not pursued. Cell `display:flex` costs nothing.
