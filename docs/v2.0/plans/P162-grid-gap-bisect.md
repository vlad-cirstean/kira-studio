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
- It does not explain why round 1's stock page never pays the penalty with the same CSS. A stock
  runway of 20 rows (`minRowBuffer: 20`) stays at 57.5 / 58.2 fps (R2.9), so runway depth is not
  the difference. Open (R2.10).

`content-visibility:auto` on rows: +5.5 fps, not competitive with the two layer fixes and it
skips painting the runway (late-data risk), so not pursued. Cell `display:flex` costs nothing.

### R2.4 Step 2b: borders, combinations, overscan

Same batch (first base run at load1 1.43: a pre-commit typecheck overlapped it; under the 1.5
limit, kept).

| Variant | fps (3 runs) | p95 ms | >50 ms | load1 |
|---|---|---|---|---|
| base | 30.7 / 30.8 / 32.5 | 66.0 / 66.6 / 60.8 | 694 / 629 / 444 | 0.96-1.43 |
| cells `box-shadow` inset instead of borders | did not finish (240 s timeout, 3 of 3) | - | - | 0.93-0.98 |
| cells border-right only, row `border-bottom` | 31.0 / 32.9 / 31.8 | 64.8 / 60.2 / 61.8 | 641 / 432 / 520 | 0.93-0.98 |
| canvas isolate + no borders | 52.3 / 54.4 / 53.6 | 29.0 / 27.4 / 26.8 | 1 / 3 / 4 | 0.93-0.98 |
| canvas isolate + row `border-bottom` | 44.9 / 51.1 / 53.0 | 34.0 / 30.2 / 28.2 | 11 / 6 / 2 | 0.97-0.98 |
| canvas isolate + rows `content-visibility:auto` | 46.2 / 50.5 / 50.2 | 38.2 / 32.6 / 33.2 | 27 / 10 / 15 | 0.93-0.98 |
| header `will-change:auto` + canvas `contain:layout paint` | 48.5 / 53.4 / 50.5 | 33.2 / 28.2 / 30.2 | 12 / 3 / 3 | 0.94-0.99 |
| **header `will-change:auto` + no borders** | 56.3 / 59.3 / 57.0 | 26.2 / 23.0 / 25.4 | 3 / 0 / 2 | 0.98-0.99 |
| canvas `contain:layout paint` + no borders | 54.3 / 56.0 / 54.6 | 26.6 / 25.0 / 26.4 | 4 / 0 / 5 | 0.93-0.95 |

Overscan, `TRACE=1` (`__kiraScrollTrace` on, both axes changed together via scratch flags):

| Variant | fps (3 runs) | p95 ms | >50 ms | uncovered frames | renderMs p95 max |
|---|---|---|---|---|---|
| base, 560 px | 30.5 / 32.4 / 31.4 | 67.8 / 61.6 / 64.8 | 678 / 452 / 553 | 0 of ~1770 | 3.0 |
| base, 480 px | 31.8 / 33.3 / 33.3 | 64.0 / 60.2 / 59.2 | 534 / 353 / 408 | 0 | 3.0 |
| base, 400 px | 35.1 / 37.0 / 35.6 | 54.8 / 50.0 / 53.6 | 213 / 89 / 170 | 0 | 3.0 |
| canvas `contain`, 560 px | 50.4 / 54.1 / 51.5 | 30.2 / 26.8 / 29.2 | 5 / 1 / 1 | 0 of ~2060 | 4.0 |
| canvas `contain`, 400 px | 52.6 / 55.1 / 49.9 | 28.0 / 26.0 / 31.0 | 1 / 3 / 9 | 0 | 3.0 |

- Overscan only helps while the layer bug is live (fewer runway rows overlap the header strip:
  +4.6 fps at 400 px). With the layer fix it gains nothing measurable (+0.5 fps, inside spread).
  Uncovered px stayed 0 in every run: the synthetic wheel flick never outruns the runway here, so
  the late-data risk cannot be seen in headless WPE. Verdict: do not cut overscan.
- Borders: worth ~+5-7 fps on top of either layer fix. Neither replacement measured is cheaper:
  inset `box-shadow` per cell is far worse (runs never finished), row `border-bottom` gives back
  only part of the gain on top of isolation and nothing alone.
- JS per render is not a factor: `renderMs` p95 is 3 ms in every trace run, including everything
  `onGridRendered` does (`refreshSelEdges`/`refreshStagedLayer` `setCellCssStyles` layers,
  `placeNavButtonsForRenderedCells` scan, `tagRenderedRows`). Nav buttons: 0 mounted (fixture has no
  FK/PK meta), not measured. Cell `display:flex`, hover rule: 0.

### R2.5 Step 3: memory (WPE process RSS)

`RSS=1`: all WebKit processes' RSS sampled every 100 ms (`RssSampler`). Rise = flick peak minus
pre-ladder value. Linux software compositing keeps layer backing stores in process memory, so RSS
sees them here; on macOS `ps` does not (IOSurface), use footprint.

| Variant | pre -> peak MB (3 runs) | rise MB | fps |
|---|---|---|---|
| base | 626->806, 618->817, 625->824 | 180 / 199 / 199 | 31.9 / 32.5 / 31.8 |
| header `will-change:auto` | 621->704, 620->707, 619->703 | 83 / 87 / 84 | 53.3 / 52.1 / 50.4 |
| canvas `contain:layout paint` | 617->703, 622->712, 624->717 | 86 / 90 / 93 | 52.3 / 53.4 / 50.8 |
| both | 622->695, 623->707, 618->713 | 73 / 84 / 95 | 52.1 / 53.1 / 54.0 |
| canvas isolate + no hover + no borders | 614->700, 613->702, 616->697 | 86 / 89 / 81 | 53.7 / 56.2 / 54.8 |
| stock, all app factors (frozen, app CSS incl. header `will-change`) | 407->460, 407->449, 401->454 | 53 / 42 / 53 | 59.2 / 57.5 / 59.7 |
| stock, same, header `will-change:auto` | 405->452, 395->451, 396->450 | 47 / 56 / 54 | 61.5 / 60.6 / 58.7 |
| stock plain | 381->453, 382->450, 381->453 | 72 / 68 / 72 | 61.0 / 59.8 / 52.3 |

- Either layer fix cuts scroll-time RSS growth from ~193 MB to ~86 MB (-55 %), every run. That is
  per-row layer backing store, gone. On a Retina Mac each row layer is backed at 2x, so the share of
  the user's 1 GB+ plateau it explains could be larger; only a Mac footprint run can say (R2.7).
- Residual versus stock: ~+35 MB rise, ~+215 MB baseline (the whole app versus a bare page; not
  grid-attributable).
- No variant returns to baseline within 3 s in WPE ("end" stays near peak), stock included.
- Stock pays nothing for the same header `will-change`. Why stock rows do not get per-row layers
  is still open (R2.8).

### R2.6 Ranked causes (round 2)

1. **Header strip `will-change: transform` + rows painted outside a canvas stacking context.**
   Either side fixes it: header `will-change:auto` +19 fps, canvas `contain:layout paint` +18.6,
   canvas `isolation:isolate` +15. Frames over 50 ms -97..-99 %. Scroll RSS growth -55 %.
2. **Per-cell borders.** +4.5 fps alone, +5-7 fps on top of cause 1. Best measured app variant:
   header `will-change:auto` + no borders, 56.3-59.3 fps, p95 23-26 ms: at stock level (57-61).
3. Overscan 560 -> 400: +4.6 fps only while cause 1 is live; 0 after. Not a fix.

No gain: viewport/pane/host isolation, hover rule, cell flex, per-render JS.

### R2.7 Fix list

1. `apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css`, `.slick-grid-host
   .grid-canvas`: add `contain: layout paint`. Shared with the console grid. Fixes cause 1 from
   the row side, keeps the header's horizontal-scroll layer. Risk: low-medium. `contain: paint`
   clips to the canvas box; the canvas is the full scroll height and width, so nothing inside it
   is clipped in practice. Inline editor stays inside its row already. Check: drag-select
   autoscroll, `FkPreviewPopover` (portal), the range decorator, `tests/visual` data-view, and
   `slick-grid.spec.ts`/`scroll-trace.spec.ts`. `isolation: isolate` is the lower-risk fallback
   (no clip; measured 3-6 fps less).
2. Same file, `.slick-grid-host .slick-header-columns { will-change: transform }`: drop it, or keep
   it only with fix 1. Alone it gives the same gain, but it was added for horizontal-scroll header
   repaint (P22 §14.2, 91 % fewer header paints in Chromium). Not re-measured here. Risk: medium,
   regresses horizontal header flicker unless re-measured. Prefer fix 1, then A/B dropping this on
   the Mac.
3. Same file, `.slick-grid-host .slick-cell` borders: +5-7 fps on top of fix 1, but no cheaper
   equivalent found (inset `box-shadow` much worse, row `border-bottom` partial). Needs a design
   call (e.g. column separators only in the header, horizontal rules only). Risk: visual.
4. No overscan change. No JS change in `onGridRendered`/`placeNavButtonsForRenderedCells`/
   `setCellCssStyles` layers.

### R2.8 Mac A/B: Web Inspector snippets

Run in the real app's Web Inspector console (dev build: View -> Open DevTools; `bun run
dev:studio` also exposes `__kiraScrollTrace`). Each line toggles one hypothesis: first call
inserts the stylesheet, second call removes it. Paste the helper once:

```js
window.kiraAB = (id, css) => { const o = document.getElementById(id); if (o) { o.remove(); return `${id} OFF`; } const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.append(s); return `${id} ON`; };
```

```js
kiraAB('ab-hdr-wc', '.slick-grid-host .slick-header-columns{will-change:auto !important}');   // H1 header strip layer off
kiraAB('ab-canvas-contain', '.slick-grid-host .grid-canvas{contain:layout paint}');          // H2 canvas contain (fix 1)
kiraAB('ab-canvas-iso', '.slick-grid-host .grid-canvas{isolation:isolate}');                 // H3 canvas stacking context
kiraAB('ab-no-borders', '.slick-grid-host .slick-cell{border-right:none !important;border-bottom:none !important}'); // H4 borders off
```

Late-cell trace around each toggle (dev build only):

```js
__kiraScrollTrace.start();   // then one hard two-finger flick, wait for momentum to stop
(r => ({ uncoveredP95: r.summary.uncoveredPx.p95, uncoveredMax: r.summary.uncoveredPx.max, gapFrames: r.frames.filter(f => f.pxPerFrame > 0 && f.uncoveredPx > 0).length, frameP95: r.summary.frameMs.p95 }))(__kiraScrollTrace.stop())
```

Protocol, per hypothesis (H0 = nothing on, then H1, H2, H3, H4, then H2+H4):

1. Open a 10 000-row page, 20+ columns, scroll to the top. Toggle the snippet.
2. Web Inspector -> Layers tab (enable it under the tab bar's "+" if hidden). Scroll a little and
   note layer count and total layer memory. Expectation if R2.3 holds on macOS: H0 shows dozens of
   `slick-row` layers; H1/H2/H3 show one canvas layer.
3. Activity Monitor -> Memory, the app's web content process ("... Web Content"): note value at
   rest, then hold a sustained two-finger scroll for 10 s and note the plateau. Or the committed
   footprint harness (`apps/kira-studio/frontend/proto/grid/mac/`, P165 §8.3) on
   `slick.html?variant=kira`, which imports the same `slickTheme.css`: prepend one line to the
   driver, e.g. `(echo "document.head.append(Object.assign(document.createElement('style'),{textContent:'.slick-grid-host .grid-canvas{contain:layout paint}'}));"; cat driver.js) > /tmp/driver-h2.js`,
   and compare `FOOTPRINT` peaks against the unmodified driver.
4. Run the trace snippet over one hard flick; note `gapFrames`/`uncoveredMax` (late cells) and
   `frameP95`.
5. Remove the snippet (same call) before the next one. Reload between hypotheses if numbers drift.

Report per hypothesis: layer count, footprint plateau, gap frames, frame p95.

### R2.9 Headed WebKitGTK and stock controls

Headed WebKitGTK (`PERF_HEADED=1`, `xvfb-run -a -s "-screen 0 1600x1000x24"`), 2 runs each:

| Variant | fps | p95 ms | >50 ms | load1 |
|---|---|---|---|---|
| base | 59.5 / 59.8 | 20.2 / 19.0 | 1 / 0 | 0.94-0.99 |
| header `will-change:auto` | 59.7 / 59.9 | 20.0 / 18.8 | 0 / 0 | 0.95 |
| canvas `contain:layout paint` | 59.6 / 59.3 | 19.2 / 20.4 | 3 / 0 | 0.93-0.97 |

Headed GTK is pinned at the 60 Hz cap for every variant, base included: it does not reproduce
the penalty at all, so it can neither confirm nor refute cause 1. The finding rests on headless WPE
only. Whether macOS WKWebView builds per-row layers here is exactly what the Layers-tab step in
R2.8 answers.

Stock, all app factors, deeper runway (headless), 2 runs each:

| Variant | fps | p95 ms | >50 ms | load1 |
|---|---|---|---|---|
| `minRowBuffer: 20` | 57.5 / 58.2 | 22.6 / 21.6 | 0 / 0 | 0.92-0.97 |
| `minRowBuffer: 20` + canvas `contain:layout paint` | 59.4 / 60.5 | 20.6 / 19.8 | 0 / 0 | 0.82-0.97 |

### R2.10 Unexplained

- Why stock SlickGrid with the app's full CSS (header `will-change` included), frozen gutter and a
  20-row runway pays no per-row layer penalty, while the app does. Remaining structural
  differences not yet bisected: `KiraSlickGrid` overrides (`createCssRules` custom-property
  positioning, `bindAncestorScrollEvents`), the `.slick-grid-mount` wrapper, header furniture
  (sort divs, badges, select zones, `headerCellAttrs` tooltips), the app's 0x0 `position: fixed`
  tooltip anchor span after the mount, and the app's ancestor chain (reka splitter panels,
  `overflow: hidden`). Round 1 already ruled out `--sg-l<i>` positioning and clip ancestors.
- Why viewport/pane/host isolation does not help while canvas isolation does (R2.3 gives an
  inference only).
- Residual app-versus-stock memory: ~+35 MB scroll rise after the fix.
- Round 1's ~10 fps unexplained gap: closed. Header `will-change:auto` + no borders reaches
  56-59 fps, stock level.

### R2.11 Left to try / not done

- Mac verification of everything above (R2.8). Headless WPE is the only engine that shows the
  penalty; the Mac Layers tab plus footprint decide whether fix 1 matters for the user.
- Horizontal-scroll header repaint without header `will-change` (fix 2's risk): not measured.
- A cheaper per-cell border construct: none found among the two tried.
- Nav buttons (`placeNavButtonsForRenderedCells`) with real FK/PK meta: fixture has none, not
  measured. `renderMs` p95 3 ms bounds all per-render JS in the measured fixture.
- Frozen gutter scroll sync: not re-measured (round 1: +2.5 fps, 1 run, feature, not a candidate).
- Bisecting the stock-versus-app difference in R2.10.
- Late-data effect of overscan: not observable here (0 uncovered frames at every setting); only a
  real trackpad flick on the Mac shows it.
