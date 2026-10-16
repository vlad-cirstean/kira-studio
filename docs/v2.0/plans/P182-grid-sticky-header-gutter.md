# P182 plan: grid header and row gutter in the scroll viewport (sticky)

Source: `docs/v2.0/SPEC.md` row P182. Prior grid findings: `P162-grid-layer-fix.md`,
`P162-grid-gap-bisect.md`. Base: the commit that lands this plan (parent `6cfc0e385`).

Scope: Studio data grid (`views/grid/SlickGridHost.vue`) and console grid
(`views/console/ConsoleSlickGrid.vue`), both on `KiraSlickGrid` + `slickTheme.css`. Git graph
(`packages/git-ui` `CommitGrid`, plain `SlickGrid`, own CSS) is out of scope and untouched: every
new rule below keys off classes only `KiraSlickGrid` adds.

Single sequential implementer. Two stages, two commits, each independently revertable (section 5).
A sibling session also commits on `v2.0`: stage only the files named here, never `git add -A`,
never push.

Library paths below are `node_modules/.bun/slickgrid@5.20.0/node_modules/slickgrid/` (`src/`
for TS, `dist/styles/css/slick.grid.css` for structural CSS), shortened to `slick.grid.ts`,
`slick.core.ts`, `slick.cellrangeselector.ts`, `slick.grid.css`.

## 1. Findings from source

### 1.1 How SlickGrid 5.20 positions rows and cells

- Rows: `.slick-row{position:absolute;width:100%}` (`slick.grid.css`), vertical offset inline
  `top: Npx` (`appendRowHtml`, `slick.grid.ts:5702-5707`; Studio never sets
  `rowTopOffsetRenderType`, so `top`, not `transform`).
- Cells: `.slick-cell{position:absolute;z-index:1}` (`slick.grid.css`), horizontal box from the
  `l<i>`/`r<i>` classes (`appendCellHtml`, `:5800-5812`), which `kiraSlickGrid.ts`
  `ensureColumnRules`/`applyColumnWidths` map to `left: var(--sg-l<i>)` / `right: var(--sg-r<i>)`.
  Not float, not flex flow.
- `frozenColumn: 0` builds two of everything: panes `slick-pane-{header,top}-{left,right}`
  (`:736-741`), two header scrollers (`:760-761`), two viewports (`:818-819`), two canvases
  (`:835-836`). Each row div is deep-cloned per pane (`:5718-5722`); the gutter cell goes in the
  left clone, data cells in the right one. Frozen columns always render regardless of horizontal
  range (`:5775`).
- Cells being absolute means per-cell `position: sticky` only works by taking the gutter cell
  out of absolute positioning into in-flow sticky (it is then the only in-flow child of its row).
  Feasible, but see 1.3 for why stage 2 does not do it.

### 1.2 Where the lag comes from (verified, with one correction)

`finishInitialization` binds `handleScroll` to every viewport's native `scroll` event (`:934-936`).
`_handleScroll` (`:7267`) then, one event after the compositor already moved the right viewport:

- horizontal: `scrollToX(scrollLeft)` (`:7292`) writes `_headerScrollContainer.scrollLeft = x`
  (`:8353`), where `_headerScrollContainer` is the right header scroller (`setScroller`, `:7069`);
- vertical: `this._viewportTopL.scrollTop = this.scrollTop` (`:7310`, again in `scrollTo` `:7178`).

Correction to the brief: the header strip never moves vertically (it sits in
`.slick-pane-header`, outside every viewport). Its lag is horizontal-only. The gutter lag is
vertical-only (its pane never scrolls horizontally).

Whether this JS sync is the cause the user sees, rather than paint/compositing cost, source cannot
prove (section 8). SPEC asks for the P162 `ab-canvas-off` A/B first; the user is doing that
separately.

### 1.3 What dropping `frozenColumn` (the brief's literal stage 2) would break

Read from source, all real call sites:

- `SlickGridHost.vue:2133`, `ConsoleSlickGrid.vue:774`: `grid.getViewports()[1] ?? [0]`.
  `_viewportTopR` is created unconditionally (`:819`) and only hidden, so `[1]` is still non-null:
  scroll listeners, velocity sampler, scroll persistence and `scrollTrace` would bind to a dead
  element.
- `tagRenderedRows` (`SlickGridHost.vue:842`, `ConsoleSlickGrid.vue:290`) writes
  `data-testid="grid-row"`/`"console-result-row"` only under `.grid-canvas-right`; nav buttons
  (`SlickGridHost.vue:1067`) query `.grid-canvas-right`. Without frozen panes there is no right
  canvas: every row testid and nav button disappears. Test selectors hard-code the right pane:
  `tests/ui/support/grid.ts` (`RIGHT_PANE`, `GRID_SCROLLER_SELECTOR`), `slick-grid.spec.ts:291,
  354,364,485`, `e2e-real/{postgres,sqlite,mariadb}-real.spec.ts`, `perf/console-grid-scroll.spec.ts`,
  `perf/proto-grid-scroll.spec.ts`.
- Gutter stops rendering once scrolled right past `GUTTER_WIDTH + OVERSCAN_PX`: only frozen or
  `alwaysRenderColumn` columns escape the range test (`:5764-5778`, cleanup `:6668`).
- `scrollCellIntoView(row, 0)` early-returns only for `cell <= frozenColumn` (`:7359`). With
  `frozenColumn: -1` every gutter activation scrolls horizontally to `scrollLeft = 0`: gutter
  right-click (`onGutterContextMenu`, `setActiveCell` on column 0), gutter row-drag
  (`SlickHybridSelectionModel.handleBeforeCellRangeSelected` calls `setActiveCell(row, cell)`),
  Left-arrow onto the gutter, `setActiveRow`.
- `internalScrollColumnIntoView` (`:7375`) does not know a column can hide under a sticky gutter.
- Header gutter cell scrolls away; making it sticky needs `.slick-header-columns` off
  `overflow: hidden` (a scroll container that never scrolls), the `.kira-sg
  .slick-header-column{left:1000px}` rule overridden (it becomes the sticky inset), and sticky on a
  `float: left` box, which WebKit support is unverified.
- One sticky node per mounted row. `P22-webview-scroll-performance-iter2-rendering.md` F12 flagged
  exactly that (each sticky box is a scrolling-tree node, set changes every frame as rows mount);
  `SlickGridHost.vue:2047-2048` cites it as the reason the frozen pane exists. P162 R2.3 found
  per-row compositing layers are the expensive path in WebKit.

Selection model itself is unaffected by either design: `rowSelectColumnIds: [GUTTER_FIELD]`
matches by column id (`slick.hybridselectionmodel.ts:292`); row-mode ranges span all columns
regardless of drag end cell (`:657`). F1 (multiSelect, `canCellBeActive(row, 0)`), D4 (gutter
= row select, header select zone) and D8 (gutter edit veto) depend on the gutter being column 0,
which both designs keep.

### 1.4 Can the header live in the viewport

Yes, by reparenting the existing `.slick-header` node (no rebuild; listeners and SlickGrid's
references move with it). Consequences, from source:

- Viewport height maths. SlickGrid's model: the viewport element is the rows band.
  `getViewportHeight` (`:6169`) subtracts `Utils.height(_headerScroller[0])` from the container
  (correct wherever the header lives). But three sites measure the viewport element itself via
  `Utils.height` = `getBoundingClientRect().height` (`slick.core.ts:1035`):
  `updateRowCount` (`:6435`, canvas min height, `viewportHasVScroll`, scroll-to-bottom),
  `scrollTo` clamp (`:7158`, runs on every scroll event via `_handleScroll`), `scrollRowIntoView`
  (`:7586`). With the header inside, the element is taller than the rows band by the header height
  `hh`. Effects if unhandled: native scroll into the last `hh` px is clamped and written back
  (bottom unreachable), keyboard nav leaves the active row under the bottom edge, short tables get
  a spurious `hh` px scroll. Section 2 D3 fixes all three at one seam.
- Pane geometry: `resizeCanvas` (`:6274-6296`) writes inline `top`/`height` on panes and
  viewports on every resize. Override with CSS `!important` so the DOM is right in every call
  order (a post-write in an override would be wrong during `resizeCanvas`'s own internal
  `updateRowCount`).
- Header width/overflow: `.slick-header.ui-state-default{overflow:inherit}` (`slick.grid.css`)
  would inherit `auto` from the viewport (a nested scroller). `_headerR` is
  `left:-1000px` + `width: max(R + scrollbar, viewportW) + 1000` (`:768-769`, `:5015-5052`,
  `HEADER_WIDTH_SLACK = 1000` at `:121`), so unclipped it extends the viewport's scroll width by at
  least the gutter width. Fix: `overflow: clip` (not `hidden`: `hidden` is a scroll container and
  `scrollToX` would then scroll it a second time on top of the native scroll) and an explicit width
  equal to the scrolling canvas.
- Scrollbar width: header no longer needs to cover the scrollbar column; the vertical scrollbar
  now spans the header band too (visual diff on classic scrollbars, none on macOS overlay ones).
- Column resize: handles stay inside header columns; drag maths is `pageX` deltas plus
  `Utils.offset(_viewportScrollContainerX).left` (`:2072`, `:2213`, `:2233`). Unaffected.
- Reorder: `enableColumnReorder: false` in both hosts (Sortable not bundled). N/A.
- `scrollCellIntoView`: vertical part via `scrollRowIntoView`, fixed by D3; horizontal unaffected.
- Events: canvas handlers (`click`, `dblclick`, `contextmenu`, `keydown`, mouseover/out) bind on
  canvases (`:981-988`), header handlers on the header scroller (`:947-950`); the viewport only
  carries `scroll`, `selectstart`. Header clicks never reach cell handlers.
- Filter row: SlickGrid's header row/top panel/footer/pre-header are off in both hosts (no
  `showHeaderRow`/`createFooterRow`/`createPreHeaderPanel`/`showTopPanel` anywhere in
  `frontend/src`). The app's filter lives in Vue toolbars outside the grid. N/A.
- Selection overlays: cell classes and the range decorator are canvas content; the header is
  sticky above the canvas, so it needs `z-index` above the canvas stacking context
  (`contain: paint` makes the canvas one) and an opaque background (already
  `--kira-bg-elevated`).
- Tooltips: `AttributeTooltip` binds `headerRowEls` (`.slick-header-columns`), same elements after
  the move. `tests/ui/tooltips.spec.ts` injects a fixed child under the header columns; its clip
  ancestor changes from `.slick-pane` to the viewport. Expected to pass as is (it dispatches events
  directly); fix the test, not the app, if it does not.
- `.grid-canvas { contain: layout paint }`: untouched. Header is painted after the canvas, so the
  P162 R2.3 mechanism (runway rows promoted when painted above the header's layer) does not apply.
- Header `will-change: transform` on `.slick-header-columns`: kept. Its P22 rationale (repaint of
  a `scrollLeft`-scrolled strip) no longer applies; removal is a separate user call, not this phase.
- Native focus scroll: SlickGrid focuses `_focusSink` (outside the viewport) and scrolls itself;
  no native `scrollIntoView` of cells. No `scroll-padding` needed.
- `scrollTrace.ts` `uncoveredPx` uses `clientHeight` and canvas-relative row `offsetTop`; it would
  over-report by `hh`.

## 2. Decisions

### D1 Stage 1: header strip sticky inside the scrolling viewport

Move `_headerScrollContainer` (the scrolling side's `.slick-header`) to be the first child of
`_viewportScrollContainerY`, `position: sticky; top: 0`. Horizontal motion becomes native scroll of
the same scroller as the rows: lockstep by construction. `scrollToX`'s
`_headerScrollContainer.scrollLeft = x` becomes a no-op (header is `overflow: clip`, not a scroll
container). Under `frozenColumn: 0` this is the right header and right viewport; the gutter header
(`_headerScrollerL`) stays in `.slick-pane-header-left` as a static corner (it never moves).

Written against `setScroller`'s own choice of containers, not hard-coded to the right pane, so it
holds with or without frozen columns.

### D2 Stage 2: one sticky gutter column, not one sticky cell per row (deviation, reasoned)

Keep `frozenColumn: 0` as SlickGrid's bookkeeping, drop the frozen *pane*: move `_canvasTopL` (the
gutter canvas) into the right viewport beside `_canvasTopR`, inside a flex wrapper, with
`position: sticky; left: 0`. Hide the now-empty left top pane; widen the right pane/viewport to
the full grid width. Vertical motion of the gutter becomes native scroll of the same scroller:
lockstep by construction. `_handleScroll`'s `_viewportTopL.scrollTop = …` copy still executes but
targets an empty, `display: none` viewport (no-op; no layout of content, no second scroll event).

This deviates from the brief's wording ("gutter cells `position: sticky`, frozen pane dropped").
Reasons, all from section 1.3: one sticky node instead of 50-100 (the F12 cost the SPEC itself
lists as downside 1, and the reason the frozen pane exists); SlickGrid's frozen-column model
stays intact, so `scrollCellIntoView` early return, gutter always-render, row clones,
`grid-canvas-right` testids, `getViewports()[1]`, nav-button selectors, every test selector and the
range selector's `_columnOffset` maths (`slick.cellrangeselector.ts:149-153`, `:191-196`,
`:362-366`) keep working unchanged. Geometry check: right canvas now starts at content x =
`canvasWidthL` inside a viewport `canvasWidthL` wider, so for scroll offset `s` the visible
right-canvas range stays `[s, s + oldViewportWidth]` and max `scrollLeft` stays
`canvasWidthR - oldViewportWidth`: SlickGrid's horizontal model is preserved exactly.

The literal per-cell variant (section 7, fallback B) is not implemented unless the user asks after
seeing D2's result.

### D3 Rows-band seam: report the viewport's rows band to SlickGrid's own measurements

Install, on the scroll viewport element only, an own-property `getBoundingClientRect` that returns
the native rect inset at the top by the sticky header's `offsetHeight`. SlickGrid's three
viewport measurements (1.4) and the range selector's `Utils.offset(activeViewport)`
(`slick.cellrangeselector.ts:245`) then see exactly the box SlickGrid's model assumes (the rows
band below the header). One seam instead of re-implementing `updateRowCount` (~130 lines, no
override point for its DOM read), `scrollTo` (hot path) and `scrollRowIntoView`.

Readers of the patched method, checked: SlickGrid via `Utils.height`/`Utils.offset`
(`slick.core.ts:1007-1041`); range selector top edge; app code: none
(`grep getBoundingClientRect views/grid views/console views/shared/slick` is empty); Playwright
`boundingBox()` is protocol-level, unaffected; `budgets.spec.ts` page-evaluated
`scroller.getBoundingClientRect()` (only `.left` used on the column axis; consistent on the row
axis). Remove the own property in `destroy` before `super.destroy`.

Known residue, accepted: the range selector's bottom edge uses `offsetHeight`
(`slick.cellrangeselector.ts:127`), so drag autoscroll downward starts `hh` px below the grid's
bottom edge instead of at it.

Stage 2 adds no inset to the shim (independence, section 5). Its one horizontal DOM read,
`internalScrollColumnIntoView` (`Utils.width(viewport)` and `clientWidth`, `:7375-7390`), gets a
small override instead. Residue, accepted: column-resize autoscroll-left (`:2072`, `:2233`) and
drag-select autoscroll-left now trigger at the grid's left edge rather than the gutter's right
edge.

### D4 No fork, no library patch

Everything is a `KiraSlickGrid` override of a `protected`/public method that exists in the
published `.d.ts` (`setScroller`, `setPaneFrozenClasses`, `internalScrollColumnIntoView`,
`applyColumnWidths`, `destroy`), DOM moves of nodes SlickGrid already created, and scoped CSS.
Both overrides that run during construction (`setScroller`, `setPaneFrozenClasses`) can run inside
`super()` (console grid: `explicitInitialization: false`): they read no subclass field and store
state only in `declare`d fields, per the file's existing convention.

Upgrade re-check list (add to the class doc comment next to the existing `render()`/
`getRenderedRange` note): `setScroller` still picks `_headerScrollContainer` and
`_viewportScrollContainerY`; `setPaneFrozenClasses` still runs in `finishInitialization` and
`updateColumnsInternal`; viewport measurements still go through `Utils.height`/`Utils.offset`
(`grep -n "_viewportScrollContainer[XY]" slick.grid.ts`); `internalScrollColumnIntoView`'s body
unchanged.

## 3. Stage 1 changes (commit 1)

### 3.1 `views/shared/slick/kiraSlickGrid.ts`

1. `protected override setScroller(): void` — `super.setScroller()`, then (skip when
   `this._options.rtl`, matching the file's existing rtl escape):
   - `const header = this._headerScrollContainer; const viewport = this._viewportScrollContainerY;`
   - if `header.parentElement !== viewport`: `viewport.prepend(header)`.
   - classes: `header.classList.add('kira-sticky-header')`,
     `viewport.classList.add('kira-scroll-viewport')`,
     `viewport.parentElement?.classList.add('kira-scroll-pane')`.
   - install the D3 shim on `viewport` (`Object.defineProperty(viewport, 'getBoundingClientRect',
     { configurable: true, value })`, native via `Element.prototype.getBoundingClientRect.call`,
     inset `header.offsetHeight`, height clamped at 0); keep the element in a `declare`d field.
   Idempotent (re-entry via `setOptions` must not double-move or double-install).
2. `applyColumnWidths` (existing override): also
   `style.setProperty('--sg-scroll-canvas-w', `${hasFrozen ? this.canvasWidthR : this.canvasWidth}px`)`
   where `hasFrozen` is the existing `frozen !== undefined && frozen !== -1` test. Runs exactly
   when canvas widths change (`updateCanvasWidth`, `:5274`).
3. `destroy`: delete the shim own-property from the saved element before `super.destroy`.
4. Class doc comment: one short paragraph for D1/D3 plus the upgrade re-check items for stage 1.

### 3.2 `views/shared/slick/slickTheme.css`

New block after the `.slick-header-columns` rule, comment per CLAUDE.md (why, not what):

```css
.slick-grid-host .slick-header.ui-state-default.kira-sticky-header {
  position: sticky;
  top: 0;
  z-index: 2; /* above the canvas stacking context (contain: paint) */
  overflow: clip; /* not hidden: a scroll container here would be scrolled again by scrollToX */
  width: var(--sg-scroll-canvas-w);
  min-width: 100%;
}
.slick-grid-host .kira-scroll-pane {
  top: 0 !important; /* SlickGrid writes inline top/height on every resizeCanvas */
  height: 100% !important;
}
.slick-grid-host .kira-scroll-viewport {
  height: 100% !important;
}
```

Specificity: `.slick-header.ui-state-default` already needs the `.ui-state-default` suffix to beat
`slick.grid.css` (existing comment at the `border-top` rule); keep it. Update the stale part of the
P22 `will-change` comment (header is no longer positioned by `scrollLeft`; rule kept per P162 D2
and the tooltips containing-block dependency).

### 3.3 `views/shared/slick/scrollTrace.ts`

`uncoveredPx`: subtract the canvas's offset inside the viewport from the bottom term
(`clientHeight - canvasTop`, `canvasTop = el.querySelector<HTMLElement>('.grid-canvas')?.offsetTop
?? 0`). Pane-agnostic, 0 before this phase, `hh` after. Recording-only path.

### 3.4 Tests (stage 1)

`tests/ui/slick-grid.spec.ts`, new tests:

- Header lockstep, deterministic in headless: in one `evaluate`, set `viewport.scrollLeft = 300`
  and read, in the same task, the `left` of a data column's header cell and of its first body cell.
  Equal (within 1 px). Before stage 1 they differ by 300 because the scroll event has not fired
  yet. This is the "no JS sync" proof the sandbox can give.
- Bottom edge: select a cell in row 0, press `Control+End` (or ArrowDown to the last row on a
  short page); the last row's rect bottom is within the viewport's visible rows band
  (`<=` viewport rect bottom minus horizontal scrollbar height).
- Native scroll to the end is not written back: `viewport.scrollTop = viewport.scrollHeight`, wait
  two frames, `scrollTop === scrollHeight - clientHeight`.
- Short table (rows fit): `scrollHeight === clientHeight`.

`tests/ui/budgets.spec.ts` row-axis overscan invariant (`:598-646`): it compares canvas-relative
row bounds against `clientHeight`/`scrollHeight`, which now include `hh`. If it fails, measure
against the rows band (subtract the canvas `offsetTop`, as in 3.3). Intended adjustment, not a
loosened budget.

## 4. Stage 2 changes (commit 2)

### 4.1 `views/shared/slick/kiraSlickGrid.ts`

Place everything in new methods / a separate block from stage 1's lines so either commit reverts
cleanly.

1. `protected override setPaneFrozenClasses(): void` — `super.setPaneFrozenClasses()`, then, when
   `this.hasFrozenColumns() && !this.hasFrozenRows && !this._options.rtl`, and not yet done:
   - create `div.kira-scroll-body`, insert it before `this._canvasTopR`, append `this._canvasTopL`
     then `this._canvasTopR` into it;
   - `this._container.classList.add('kira-sticky-gutter')`.
   Idempotent: `updateColumnsInternal` (`:3619`) calls this on every `setColumns`.
2. `protected override internalScrollColumnIntoView(left: number, right: number): void` — when
   `kira-sticky-gutter` is active, same structure as stock (`:7375-7390`) with the visible data
   band `this._viewportScrollContainerX.clientWidth - this.canvasWidthL` in place of both the
   `Utils.width(...) - scrollbar` term and the bare `clientWidth`; otherwise `super`.
3. `applyColumnWidths`: `style.setProperty('--sg-pin-w', `${this.canvasWidthL}px`)` when frozen.
4. Doc comment: D2 paragraph plus its upgrade re-check items.

`getRenderedRange`'s `getCanvasNode(1)` comment stays true (frozen bookkeeping unchanged).

### 4.2 `views/shared/slick/slickTheme.css`

New block at the end of the structural section:

```css
.kira-sticky-gutter .kira-scroll-body {
  display: flex;
  align-items: flex-start;
  width: max-content;
  min-width: 100%;
}
.kira-sticky-gutter .kira-scroll-body > .grid-canvas {
  flex: none;
}
.slick-grid-host .kira-sticky-gutter .grid-canvas-left {
  position: sticky;
  left: 0;
  z-index: 1; /* above the right canvas it overlaps when scrolled right */
}
.slick-grid-host .kira-sticky-gutter .slick-pane-top.slick-pane-left {
  display: none !important; /* SlickGrid re-shows it via inline style */
}
.slick-grid-host .kira-sticky-gutter .slick-pane-top.slick-pane-right,
.slick-grid-host .kira-sticky-gutter .slick-viewport-top.slick-viewport-right {
  left: 0 !important; /* inline left/width from updateCanvasWidth */
  width: 100% !important;
}
/* With stage 1's in-viewport header: offset it over the right canvas, keep the corner on top. */
.slick-grid-host .kira-sticky-gutter .kira-sticky-header {
  margin-left: var(--sg-pin-w);
}
.slick-grid-host .kira-sticky-gutter .slick-pane-header.slick-pane-left {
  z-index: 3;
}
```

Implementer confirms the final selectors against the rendered DOM (class order on panes/viewports
per `:736-741`, `:818-819`). Contain rule untouched. Gutter cells already have opaque backgrounds
(`.kira-gutter` `--kira-bg-elevated`, hover `--kira-hover` `#2a2d2e`, row `--kira-bg`); verify
the pending-insert row (`kira-row-inserted`, translucent row tint) still paints the gutter opaque.
Refresh stale comments: `.slick-viewport` overscroll comment (two panes), gutter rail comment
("frozen gutter cell" stays true; pane wording does not).

### 4.3 Hosts

- `SlickGridHost.vue`: `scrollTrace.registerGrid(viewportEl, '.slick-row')` (`:2161`) → 
  `'.grid-canvas-right .slick-row'` (both canvases now sit under the viewport; the trace's `rows`
  count would double). Update the `frozenColumn: 0` comment (`:2047-2048`) to describe the
  re-homed sticky gutter canvas.
- `ConsoleSlickGrid.vue`: update the `frozenColumn: 0` comment (`:726-728`) only.
- `proto/grid/SlickProto.vue`: no change; its `kira` variant inherits both stages via
  `KiraSlickGrid`, `stock` variant is unaffected.

### 4.4 Tests (stage 2)

`tests/ui/slick-grid.spec.ts`, new tests:

- Gutter lockstep: in one `evaluate`, set `viewport.scrollTop = 500`, read in the same task the
  `top` of `gutterCell(row N)` and of a data cell in row N. Equal within 1 px.
- Gutter pinned: `scrollLeft = 300`; gutter cell `left` equals viewport `left`; `elementFromPoint`
  at the gutter cell centre resolves to the gutter cell (not a data cell under it).
- Right-edge navigation: select the last-but-one visible column's cell, ArrowRight until a column
  past the right edge is active; its rect right `<=` viewport rect right minus vertical scrollbar.
- Gutter click while scrolled right: `scrollLeft = 300`, click a gutter cell; row selected
  (existing row-selection assertion helper) and `scrollLeft` still 300. Same for gutter
  right-click (context menu opens, `scrollLeft` unchanged).
- Wheel over the gutter scrolls the grid (`page.mouse.wheel` at gutter centre, `scrollTop`
  grows). New behaviour: the old left pane was `overflow-y: hidden` and swallowed it.

Existing selectors (`grid-canvas-right`, `slick-viewport-right`, `grid-canvas-left` gutter) stay
valid by design; none should need edits. If `budgets.spec.ts`'s column-axis invariant fails,
measure from the data band left (viewport left + `--sg-pin-w`); expected to pass since
`maxWidth >= 64 > 56`.

## 5. File ownership and stage dependency

| Stage | Files |
|---|---|
| 1 | `views/shared/slick/kiraSlickGrid.ts` (setScroller, shim, `--sg-scroll-canvas-w`, destroy), `views/shared/slick/slickTheme.css` (sticky header block, comment refresh), `views/shared/slick/scrollTrace.ts`, `tests/ui/slick-grid.spec.ts` (stage 1 tests), `tests/ui/budgets.spec.ts` and `tests/ui/tooltips.spec.ts` only if they fail |
| 2 | `views/shared/slick/kiraSlickGrid.ts` (setPaneFrozenClasses, internalScrollColumnIntoView, `--sg-pin-w`), `views/shared/slick/slickTheme.css` (sticky gutter block, comment refresh), `views/grid/SlickGridHost.vue`, `views/console/ConsoleSlickGrid.vue`, `tests/ui/slick-grid.spec.ts` (stage 2 tests), `tests/ui/budgets.spec.ts` only if it fails |

Paths under `apps/kira-studio/frontend/src/` and `apps/kira-studio/tests/`. Same files in both
stages, so stages run sequentially in one checkout (no streams).

Dependency: none in either direction.

- Stage 2 without stage 1: headers stay in their panes (right header JS-synced at `left:
  canvasWidthL`, gutter header static at 0); right viewport spans full width below the header
  band; sticky gutter canvas works the same. The two stage-2 rules mentioning
  `.kira-sticky-header`/`.slick-pane-header` are inert or harmless.
- Stage 1 without stage 2: frozen panes intact; header sits in the right viewport, which starts at
  `canvasWidthL`.

Keep stage 2's hunks textually separate from stage 1's (new methods, a separate CSS block, new
tests appended) so `git revert` of either applies without conflict. Proven in 6.3.

## 6. Verification

Run order per stage: implement, fast checks (`bun run lint`, `bun run typecheck`), commit
through the normal pre-commit hook (never `--no-verify`), then the expensive runs once.
`bun run test:ui:studio` and `bun run test:visual:studio` rebuild the test bundle themselves. For
the Mac build, also rebuild the shipped dist: `cd apps/kira-studio/frontend && bun run build`.

### 6.1 Baseline (before stage 1, at the plan commit)

- `bun run test:ui:studio`: record pass/fail. Any failure here is pre-existing: fix it per
  CLAUDE.md in its own `fix(...)` commit before stage 1, unless it needs another subsystem
  (then a SPEC follow-up row).
- Visual: per P162 plan 2.2 (sandbox against sandbox; copy `*-actual.png` of data-view and console
  specs to the scratchpad). Never `--update-snapshots` here (DEV_ENVIRONMENT "pixel diffs").
- Perf, gated on `load1 <= 1.0` (`/proc/loadavg`), 3 runs:
  `bun run build:test:studio && NCOLS=20 bunx playwright test
  --config=apps/kira-studio/playwright.perf.config.ts grid-scroll` (fallback
  `node node_modules/.bin/playwright` if "No tests found"). Record per grid: fps avg, mean p95,
  frames over 50 ms, RSS lines. Expected ~51 fps data grid.

### 6.2 Per stage

- `bun run test:ui:studio`: green, including the new tests (3.4 / 4.4) and
  `scroll-trace.spec.ts`, `cell-editor.spec.ts`, `data-view.spec.ts`, `console.spec.ts`,
  `tooltips.spec.ts`, `budgets.spec.ts`.
- `bun run test:proto:studio` once (the `kira` proto variant inherits both stages).
- `bun run test:unit` once (sanity; no new unit test: nothing here meets CLAUDE.md's bar, the
  geometry is covered by the real-DOM ui tests above).
- Visual: rerun, compare actuals to the baseline copies. Intended diffs only: stage 1, the
  vertical scrollbar track now spans the header band (classic scrollbars only); stage 2, one
  continuous horizontal scrollbar track under the gutter instead of two. Anything else is a
  regression to fix. Record intended diffs in the Result; baselines regenerate on the CI image,
  not here.
- Perf: 3 runs, same gate and fields as 6.1. Stage 1: report only. Stage 2: gate, below.
- `bun run lint:dead` once at the end.

### 6.3 Independence proof (after stage 2 commits)

In a scratch worktree (`git worktree add <scratchpad>/p182-indep HEAD`):
`git revert --no-commit <stage-1-sha>` must apply cleanly; build and run
`bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui slick-grid
data-view console` there; stage 2 tests must pass (stage 1 tests are reverted with it). Then
remove the worktree. A conflict or failure means the hunks overlap: restructure, same phase.
Reverting stage 2 alone is the normal rollback and is covered by stage 1's own green run.

### 6.4 Stage 2 gate

Revert stage 2 only (`git revert <stage-2-sha>`, normal hook) if any holds:

- data grid fps (mean of 3) drops more than 2 below the 6.1 baseline;
- gutter row selection, gutter drag, gutter right-click or Left-arrow-to-gutter misbehaves, or any
  existing selection test fails for a reason not fixable within D2;
- the sticky gutter canvas does not pin (4.4 "gutter pinned" fails) in WebKit.

Report the measured numbers either way.

### 6.5 Mac check (user-run, per stage)

Headless WPE cannot show compositor lag. Per stage, on the user's normal Mac build of that commit:

1. Data grid on a wide table (`NCOLS=20`-like), hard trackpad flings: horizontal (header vs body
   columns) after stage 1; vertical (gutter numbers vs rows) after stage 2. Report: visible lag
   yes/no.
2. Web Inspector Layers: stage 2 should add one layer for the gutter canvas, not one per row.
   Report layer count and Activity Monitor footprint plateau over 10 s of sustained scroll
   (P162 R2.8 protocol), against the previous commit's build.
3. Smoke: column resize drag, header select zone, sort arrow, header tooltip, gutter click/drag/
   right-click, inline edit at the right edge, console grid the same.

Acceptance per SPEC: no visible lag on the Mac, fps within 2, `ui` and visual green (visual: no
unintended diff).

## 7. Rollback and fallback

- Stage 2 rollback: `git revert <stage-2-sha>`. Stage 1 keeps working (frozen panes back,
  gutter lag returns).
- Stage 1 rollback: `git revert <stage-1-sha>`. Stage 2 keeps working (6.3).
- Fallback A (D2 fails its gate): ship stage 1 alone. Header lag fixed, gutter lag remains as
  today. Record the measured reason in the Result; add a `docs/ARCHITECTURE.md` "Known open items"
  entry for the gutter lag only if the user accepts stage 1 alone as final.
- Fallback B (only on user request after D2's result): literal per-cell sticky. Needs every item
  in 1.3: `frozenColumn` removed in both hosts and the proto; `alwaysRenderColumn: true` on
  `gutterColumn` (`gridHostShared.ts`); `scrollCellIntoView` override skipping horizontal scroll
  for column 0; `internalScrollColumnIntoView` offset by the gutter width; `getViewports()[1]`
  replaced by a `KiraSlickGrid` accessor returning `_viewportScrollContainerY`;
  `tagRenderedRows`/nav-button selectors pane-agnostic; every right-pane test selector rewritten;
  gutter cell `position: sticky; left: 0; right: auto; width: GUTTER_WIDTH; box-sizing:
  border-box; z-index: 12` (above `.slick-cell.editable`'s 11); header gutter cell sticky with
  `left: 0` replacing the `left:1000px` rule and `.slick-header-columns{overflow:clip}`. Expected
  worse than D2 on frame time (F12). Would need its own plan pass.
- Not pursued: CSS scroll-driven animations (`animation-timeline: scroll()`) to translate the
  separate panes. Support and compositor threading in the user's WKWebView version are unknown
  from this repo.

## 8. What source cannot answer

- Whether the JS scroll sync is the lag the user sees, versus paint cost. Mechanism confirmed in
  source (1.2); causation is Mac-only (SPEC's `ab-canvas-off` A/B first, then 6.5).
- Whether macOS WKWebView moves a sticky element inside a `contain: layout paint` subtree on the
  scrolling thread without a main-thread commit. Expected (sticky is a scrolling-tree node),
  unverifiable here.
- Memory of a `th`-tall sticky gutter canvas layer (up to ~280 000 px for 10 000 rows). WebKit
  tiles large layers; the old left viewport was a scrolled layer of the same height. Mac
  footprint only (6.5 step 2).
- Whether WPE in the sandbox draws classic scrollbars in visual tests (decides whether the
  intended diffs in 6.2 appear at all).
- Whether the user's macOS shows overlay or always-on scrollbars (vertical scrollbar over the
  header band, stage 1).

## 9. Steps and commits

0. Baseline (6.1). Fix any pre-existing failure in its own commit.
1. Stage 1 (section 3). Commit `fix(grid): header strip sticky inside the scroll viewport`. Run
   6.2. Hand the user the stage 1 Mac check (6.5).
2. Stage 2 (section 4). Commit `fix(grid): row gutter as one sticky column in the scroll
   viewport`. Run 6.2, 6.3, 6.4. Revert stage 2 if the gate fails.
3. Append `## Result` to this file: perf table (baseline, stage 1, stage 2), test outcomes,
   intended visual diffs, independence proof outcome, gate decision, and the Mac items still owed
   by the user. Commit `docs: P182 result`. SPEC row status per the orchestrator.

Never push.

## Result

Commits on `v2.0` (local, not pushed): `29b5d5912` stage 1 header sticky; `ca2c33c3d` fix(test)
`measure.ts` coverage; `7f48bb4fc` stage 2 sticky gutter column. Stage 2 gate: pass. Both stages stay.

### Perf (headless WPE, `NCOLS=20 grid-scroll`, 3 runs, mean of 5 flicks per run)

load1 at run 1 start: 0.96 (base), 0.96 (s1), 0.84 (s2). Runs 2-3 started at 2.4-2.7 (own browser).

| | data grid fps | p95 ms | frames over 50 ms (3 runs) | RSS rise per flick | console fps |
|---|---|---|---|---|---|
| baseline `32da15b17` | 51.9 (51.8/51.8/52.2) | 28.8 | 5 | 23.6 MB | 61.5 |
| stage 1 | 49.1 (50.2/48.6/48.4) | 31.6 | 13 | 23.3 MB | 60.2 |
| stage 2 | 50.7 (51.8/50.4/50.0) | 30.1 | 6 | 22.7 MB | 60.5 |

Stage 2 vs baseline: -1.2 fps, inside the 2 fps gate. Stage 1 report-only: -2.8 fps. Probe viewport
is 29 px taller (1104x758 vs 1104x729): scroller now spans the header band. Run-to-run spread is
about 1.5 fps, so the stage 1 dip is near noise. Peak RSS 719/709/715 MB.

### Tests

- Baseline: `test:ui:studio` 311 passed, 1 fail (`cell-editor.spec.ts:332` 60 s timeout under load
  12; passes alone), 4 not run. Treated as load flake, not pre-existing code failure.
- Stage 1: ui 318 passed (3 new). Stage 2 final tree: ui 322 passed (7 new total), no flake.
- New tests (`slick-grid.spec.ts`): header lockstep in one task; last row reachable (keyboard,
  native scroll end not written back); short table `scrollHeight === clientHeight` (appended to the
  P16 D3 test); gutter lockstep + pinned + `elementFromPoint`; right-edge ArrowRight nav; gutter
  click and right-click keep `scrollLeft`; wheel over gutter scrolls. Stage 2 lockstep/pinned and
  wheel tests fail with stage 2 reverted; edge-nav and click tests are regression guards (pass both).
- `test:proto:studio` 6 passed (both stages). `test:unit` 1794 pass, 1 fail:
  `mock-runtime-bindings` wants `TerminalService.Shutdown` unmapped. Cause: gitignored generated
  `frontend/bindings/` is stale (Go source has no such method). Not a tracked-code defect, not fixed.
- `lint:dead`: pre-existing unused exports only (`columns.ts`, `git-core`, `rowMenuModel`, `page.ts`).
- Budget coverage: stage 1 left `uncoveredPx` 29 (header height) on `scroll_grid` bottom rows because
  `support/measure.ts` compared canvas-relative offsets to `clientHeight`. Fixed in `ca2c33c3d`
  (subtract canvas `offsetTop`, as `scrollTrace.ts`). Now 0 at 40/100/200 px per frame. Not a loosened
  budget.

### Visual

Baseline: 13 passed, 1 failed (`console.png`, 36 px, sandbox font drift). Stage 1: 14 passed
(console borderline, passed). Stage 2: same as baseline, `console-actual.png` byte-identical to
baseline copy. Intended scrollbar-track diffs not visible: WPE draws overlay scrollbars. No
snapshot updated.

### Independence (6.3)

First attempt conflicted (stage 2 hunks adjacent to stage 1: class comment, `applyColumnWidths`
lines, method insertion point, `headerCell` import, appended tests). Restructured stage 2 only: its
class-comment text moved onto its methods, `--sg-pin-w` set after the loop, methods placed after
`applyColumnWidths`, own local `gutterCell` helper, tests inserted mid-file, no stage 1 symbols.
Then `git revert --no-commit 29b5d5912` applied clean in a scratch worktree; `ui` project
`slick-grid data-view console`: 48 passed. Worktree removed.

### Deviations from plan

- Extra commit `ca2c33c3d` (`support/measure.ts`, not in file table) for the coverage metric above.
- Stage 2 rebuilt once after the independence failure (same design, hunks re-placed).
- Gate item "pinned in WebKit": proven in WPE only (test passes); macOS WKWebView unverified.

### Not verified (owed by user, per 6.5)

Compositor lag on macOS (horizontal after stage 1, vertical after stage 2); Web Inspector layer
count and footprint plateau; classic-scrollbar visual diffs; smoke of column resize, header select
zone, sort arrow, header tooltip, gutter drag, inline edit at right edge, console grid. Known
accepted residues: range-selector drag autoscroll downward triggers `hh` px below the grid bottom;
resize/drag autoscroll-left triggers at the grid's left edge, not the gutter's right edge. `contain`
and header `will-change` untouched. Shipped `dist` rebuilt (gitignored).
