# P47 — Trying `@tanstack/vue-virtual` in the data grid

> Not a SPEC §10 deliverable. A user-directed phase, and — unlike every phase before it — a
> **spike**: the deliverable is an answer plus either a migration or a documented reversal, not a
> migration assumed in advance.
>
> **Origin, verbatim.** Mid-way through a Sonnet session tuning `DataGrid.vue`'s overscan constants
> against two complaints — *"if I scroll fast enough the rows aren't rendered and it can't keep
> up"* and *"the scroll overall doesn't feel that smooth, on a native mac app it's very silky and
> velocity is higher"* — the user asked *"why not use a library for this?"*, then *"the most popular
> for vue"*, then: *"for now revert your changes, and add a new phase for trying
> @tanstack/vue-virtual, and then go on with it."* The tuning attempt was reverted cleanly; the tree
> this plan is written against is P29's committed implementation with nothing uncommitted.
>
> **P29 is the direct predecessor** (`docs/v1/plans/P29-scroll-render-gap.md`) and this phase either
> preserves each of its decisions literally or names the one it contradicts and why. Its own §0 rule
> *"No new dependency, no canvas grid, no library"* (P29:32) was a **phase-scoped** rule, not a
> standing one (F15) — this phase is allowed to revisit it, and is the reason it exists.
>
> **`docs/PERF.md`** — note the path, `docs/PERF.md`, **not** `docs/v1/PERF.md` (F17) — is the
> living measurement record. Every number this phase produces goes there through the instrumentation
> `tests/ui/support/measure.ts` already owns, and the **work p50 vs end-to-end p50** distinction that
> file established (`measure.ts:148-174`) is load-bearing for the before/after comparison. A second
> measurement idiom would make the whole spike unfalsifiable.

## 0. Ground rules for this phase

- **Spike first, migration second.** §4's step 3 is an explicit **go/no-go checkpoint** with numeric
  criteria (D14). D15 says what a "no-go" commit looks like. "We tried it, here is the measurement,
  here is why we did not keep it" is a legitimate, planned outcome of this phase — not a failure of
  it. What is *not* acceptable is landing the library because it was landed, or relaxing an existing
  assertion to make it green (D17).
- **One variable at a time.** The only thing this phase is allowed to change about how the grid
  renders is *which indices are considered visible*. P29 D5's `RowVM`/`CellVM` build-once-per-render
  discipline (D2), P29 D11's display-position/page-row split (D8), the template, every `data-testid`,
  class name and rendered attribute (D2), and the CSS `top`/`left` placement scheme (D4) are all
  preserved literally. A before/after number is only attributable if one thing moved.
- **Do not relax a P29 assertion to make the library fit.** In particular
  `budgets.spec.ts:320-336`'s "a sub-row scroll produces zero DOM mutations" is a **go/no-go gate**,
  not a test to loosen (D17). Same for the two overscan-coverage invariants (`:214-260`, `:262-313`)
  and the `< 2500` cell bound (`:316-317`).
- **The library cannot fix the second complaint and the plan says so up front.** F1: scroll
  *velocity, momentum and easing* belong to Chromium's compositor. No virtualizer — this one or any
  other — changes them. This phase can only move complaint (a). §6 names what a complaint-(b) phase
  would actually have to look at.
- **Every commit leaves `bun run lint`, `bun run typecheck` (all four projects — `node`, `web`,
  `db`, `unit`; `package.json:22-26`) and `bun run build` green.** `tests/db/` and
  `tests/electron-db/` are untouched: no adapter, engine, protocol, SQL or fixture change exists in
  this phase.
- Comments per AGENTS.md: only where the code cannot say it for itself. Two constants and two
  non-obvious library behaviours (F8's `measure()` requirement, F10's relocated mark) earn one line
  each; nothing else does.
- Conventional Commits, one per step of §4: `chore(deps):`, `perf(grid):`, `test(unit):`, `docs:`,
  and — if D15 fires — `revert:`.

## 1. Findings (verified against the tree and against the published package, not assumed)

### What the user actually reported

**F1 — the two complaints are two different problems, and only one of them is a virtualization
problem.**

*"if I scroll fast enough the rows aren't rendered and it can't keep up"* is P29 D10's residual
case, restated by the user: a composited scroll moves the viewport without the main thread, so any
region with no DOM in it paints as background until the main thread catches up. It is governed by
exactly two things — how much buffer is rendered beyond the viewport (`OVERSCAN_PX = 560`,
`DataGrid.vue:61`) and how long one render takes. A virtualizer library can move the first (it owns
the index range) and is neutral-to-slightly-negative on the second (F6/F7).

*"the scroll overall doesn't feel that smooth, on a native mac app it's very silky and velocity is
higher"* is **scroll physics** — fling velocity, momentum curve, rubber-banding. That is Chromium's
compositor, not the app's, and **not something any virtualization library touches**: TanStack
Virtual never calls `scrollTo` during a user gesture; it only reads `scrollTop`/`scrollLeft` in a
`scroll` listener (F6). The app is not interfering with it either — `grep -rn "scroll-behavior"
src/renderer` returns nothing, there is no `appendSwitch` / `disableHardwareAcceleration` call
anywhere in `src/main`, and the only Chromium capability P46 turned off for the renderer is
`webgl: false` (`src/main/security.ts:11`), which affects neither GPU compositing nor threaded
scrolling. So complaint (b) is out of this phase's reach **by construction**, and §6 records what
would have to be investigated instead.

Stated plainly because the alternative is a phase that lands a dependency, measures no improvement
on the thing the user cared most about, and cannot explain why.

### What the grid does today

**F2 — the whole virtualization surface is five expressions in one file, plus one exported
function.**

| Piece | Where | What it is |
|---|---|---|
| `GUTTER_WIDTH = 56` | `DataGrid.vue:57` | reserved band before column 0 in `.grid-sizer`'s content space |
| `OVERSCAN_PX = 560` / `MAX_OVERSCAN_COLUMNS = 12` | `:61`, `:63` | P29 D2/D3 — one pixel budget, both axes; a per-side column cap |
| `rowHeight` | `:65` | `22` compact / `28` comfortable, settings-driven |
| `rowRange` | `:338-347` | `overscanRows = Math.ceil(OVERSCAN_PX / rowHeight)` at `:340`, then floor/ceil against `scrollTop`/`viewportHeight`, in **display-position** space |
| `colRange` | `:348-356` | delegates to `visibleColumnRange(scrollLeft, viewportWidth, offsets, OVERSCAN_PX, MAX_OVERSCAN_COLUMNS)` |
| `visibleColumnRange` | `src/renderer/views/shared/page/columns.ts:74-116` | binary search for the first visible column, forward walk to the last, then a width-accumulating expansion loop on each side (`:97-113`) — **not** a `grid/columns.ts` neighbour; the import is `from '../shared/page/columns'` (`DataGrid.vue:27-28`) |
| `rowStart`/`rowEnd`/`colStart`/`colEnd` | `:362-365` | P29 D4 — four **primitive** computeds derived from the two object-returning ones, so a sub-boundary scroll invalidates nothing downstream |
| `visibleRows` / `visibleColumnIndices` | `:367-373`, `:399-402` | consume the four numbers only |
| `renderRows` / `RowVM` / `CellVM` | `:1016`, `:1003`, `:989` | P29 D5 — every visible cell's state computed once per render; the template reads fields |

`scrollTop`/`scrollLeft` (`:275-276`) and `viewportWidth`/`viewportHeight` (`:277-278`, fed by the
component's own `ResizeObserver` at `:310-314`) have exactly three consumers between them:
`rowRange` (`:341, :344`), `colRange` (`:350-351`), and the 300 ms scroll-position persistence
watcher (`:404-410`). Nothing else in the file reads them.

**F3 — row and column positioning is plain CSS `top`/`left`, and no application code anywhere reads
a rendered row's or cell's DOM position.** Rows: `` top: `${rowHeight + rowVm.pos * rowHeight}px` ``
(`:1506`) and the analogous pending-insert expression (`:1591`). Columns: `` left:
`${cellVm.left}px` `` on data cells (`:1533`), `` left: `${GUTTER_WIDTH + offsets[c]}px` `` on
header cells (`:1450`) and insert-row cells (`:1602`), with `CellVM.left` itself built as
`GUTTER_WIDTH + (offs[c] ?? 0)` inside `renderRows` (`:1035`). `.grid-row` is
`position: absolute; contain: layout` (`:1737-1744`, P29 D8). A fresh
`grep -rn "offsetTop\|offsetLeft\|offsetWidth\|offsetHeight" src tests` returns **three** call
sites: `PopoverPanel.vue:63` (unrelated), and `budgets.spec.ts`'s two blocks (`:242-244`, `:296-297`).
The only `getBoundingClientRect` in the grid is `DataGrid.vue:763`, on `containerRef` for
drag-autoscroll — the scroll container, not a row or cell, so it is positioning-scheme-agnostic
already. Selection addresses cells by `(rowVm.row, cellVm.col)` (`:1541-1545`), never by DOM
position, and the inline editor is a plain `<input data-testid="grid-cell-input">` inside the
`.grid-cell` div (`:1546+`) with no overlay geometry to preserve.

**F4 — `scrollCellIntoView` is pure arithmetic against the same model that drives rendering.**
`DataGrid.vue:1255-1275`: `rowTop = rowHeight + displayPositionOf(row) * rowHeight`, and
`offsets[displayCol]` / `offsets[displayCol + 1]` for the column, written straight to
`el.scrollTop` / `el.scrollLeft`, then `syncScrollState()` immediately (`:1274`) rather than waiting
a frame. It reads no DOM geometry, so it neither needs nor benefits from the library's
`scrollToIndex`.

### What `@tanstack/vue-virtual` actually is

> These findings were verified against the **published package**, not from training knowledge: the
> npm registry metadata for `@tanstack/vue-virtual@latest` and the ESM builds of
> `@tanstack/vue-virtual@3.13.36/dist/esm/index.js` (65 lines) and
> `@tanstack/virtual-core@3.17.8/dist/esm/index.js` (1 299 lines), fetched at plan time. Line
> numbers below refer to those dist files and are quoted alongside the symbol name, since dist line
> numbers shift between releases; the symbol names are the stable citation.

**F5 — the package, exactly.** `@tanstack/vue-virtual@3.13.36`, MIT, one dependency
(`@tanstack/virtual-core@3.17.8`), peer `vue: "^2.7.0 || ^3.0.0"` (this repo is on `vue@3.5.41`,
`package.json:75`). The Vue adapter is **65 lines total** and exports two functions; everything else
is `export * from '@tanstack/virtual-core'`. `useVirtualizer(options)` returns
`ShallowRef<Virtualizer>` — a `shallowRef(virtualizer)` (`vue-virtual` index.js:6) whose only
reactivity mechanism is `triggerRef(state)` from a wrapped `onChange` (`:24-28`).

**F6 — there is no 2D grid primitive.** The documented and only pattern for a grid is two
independent virtualizers against the same scroll element — one default, one `horizontal: true` —
crossed by hand in the consumer's own render loop. That is structurally the same row×column
composition `DataGrid.vue` already performs (`renderRows`, `:1016-1050`). **Adopting the library is
not a "collapse two axes into one API" win**; it is at most a better-tested implementation of the
same shape.

**F7 — `overscan` is an item count, default `1`, and that is a direct conflict with P29 D2.**
`defaultRangeExtractor` (virtual-core index.js:19-28) is
`start = max(range.startIndex - range.overscan, 0)`, `end = min(range.endIndex + range.overscan,
range.count - 1)`. P29 D2's own words on why that is the wrong unit for the column axis, verbatim:

> *"Pixels rather than a column count because a column is 40–480 px wide (`columns.ts:4-5`,
> `DataGrid.vue:422`) — '4 columns of overscan' is between 160 px and 1 920 px of buffer depending
> on the table, which is not a decision anyone can reason about."*

Accepting raw item-count overscan on the column axis reintroduces exactly the asymmetry P29 fixed.
**But** `rangeExtractor` is itself an option (`Virtualizer` option list, virtual-core d.ts:70) and
receives the full `Range { startIndex, endIndex, overscan, count }` (d.ts:16-21), so the pixel walk
`visibleColumnRange` already performs (`columns.ts:97-113`) can be supplied *as* the range
extractor. That is the bridge, and it is exact rather than an approximation — see D5.

**F8 — the sub-row zero-mutation question, answered: `getVirtualItems()` is referentially stable,
and the library does not even notify Vue when the index range is unchanged — with one named
exception.** This was the plan's central unknown and it is now resolved from the source:

- `getVirtualItems` is a `memo` over `[getVirtualIndexes(), getMeasurements()]` (virtual-core
  index.js:906-919). `getVirtualIndexes` is a `memo` over
  `[rangeExtractor, overscan, count, startIndex, endIndex]` (`:751-770`). So when the computed index
  range has not moved, `getVirtualItems()` returns **the identical array reference**.
- More importantly, the framework is not even told. `maybeNotify` is a `memo` whose dependencies are
  `[isScrolling, range.startIndex, range.endIndex]` (`:350-370`), and only its `onChange` calls
  `this.notify` → the adapter's `triggerRef(state)`. A scroll that crosses no item boundary
  therefore produces **no `triggerRef`, no Vue re-render, no DOM mutation at all**.
- **The exception: `isScrolling` is one of those three dependencies.** `observeOffset` (`:85-118`)
  attaches a `scroll` listener that calls back with `isScrolling: true`, plus — since
  `useScrollendEvent` defaults to `false` (`:277`) — a `debounce(..., isScrollingResetDelay)` with
  `isScrollingResetDelay: 150` (`:274`) that calls back with `false`. So **each scroll gesture
  produces two extra notifies**: one on the `false → true` transition at its start, one ~150 ms
  after its last event. Both re-render the component even though the index range never moved.
- Cross-axis noise is absorbed: the offset callback early-returns when
  `isScrolling && this._intendedScrollOffset === null && offset === this.scrollOffset` (`:419-422`),
  so a purely vertical scroll never flips the horizontal virtualizer's `isScrolling`, and its
  150 ms debounce fires with `isScrolling: false` against an already-`false` flag, changing no
  dependency and notifying nothing.

Consequence for `budgets.spec.ts:320-336`: the `scrollTop += 4` write *does* trigger one Vue
re-render (the `isScrolling` transition), inside the observer's two-rAF window. Whether that
produces a **DOM mutation** then depends on Vue's patch writing nothing for byte-identical props —
which it should (`patchProp` guards on `prev !== next`), but which is a strictly weaker guarantee
than P29 D4's "the render never runs." D3 removes the dependence on that guarantee entirely; the
assertion stays as the gate that proves it.

**F9 — the Vue adapter re-notifies unconditionally on every options change, which is P29 F4's
anti-pattern one layer up.** `useVirtualizer` wraps its argument in `computed(() => ({ ...defaults,
...unref(options) }))` (vue-virtual index.js:41-48) — a **fresh object literal every evaluation** —
and `useVirtualizerBase` watches it with `watch(() => unref(options), (options2) => {
virtualizer.setOptions({...}); virtualizer._willUpdate(); triggerRef(state); }, { immediate: true })`
(`:19-36`). Vue compares a computed's value with `Object.is`, so a new object always counts as
changed, so **every invalidation of any reactive state the options factory reads triggers an
unconditional full re-render**, whether or not any option's value actually differs. P29 F4 is the
same sentence about `rowRange`/`colRange`. The practical rule this dictates: the options factory may
read only slow-moving state (`displayRowCount`, `rowHeight`, `offsets`, `columnOrder.length`) and
must **never** read the scroll offset — see D5's warning about a velocity-adaptive overscan.

**F10 — `estimateSize` is *not* a dependency of the measurements cache, so a column resize or a row
density change silently renders against stale sizes unless `measure()` is called.**
`getMeasurements` is a `memo` over `[getMeasurementOptions(), itemSizeCacheVersion]` (virtual-core
index.js:576-577), and `getMeasurementOptions` returns
`{ count, paddingStart, scrollMargin, getItemKey, enabled, lanes, laneAssignmentMode, gap }`
(`:555-574`) — `estimateSize` is read *inside* the recompute (`:640`, `:697`) but is not among the
things that trigger one. The escape hatch is `virtualizer.measure()` (`:1117-1123`), which clears
the item-size cache, bumps `itemSizeCacheVersion` and notifies. This grid resizes columns by drag
(`DataGrid.vue:422`) and changes `rowHeight` from settings (`:65`), so both need it. The current
hand-rolled code has no equivalent footgun: `offsets` is a plain `computed` and `rowRange` reads
`rowHeight.value` directly, so both invalidate by construction.

**F11 — `paddingStart` is required for correctness, not decoration, and it maps exactly onto the two
constants the grid already applies by hand.** The virtualizers read `el.scrollLeft` / `el.scrollTop`
raw (`observeElementOffset`, virtual-core index.js:119-122), which is `.grid-sizer`'s content-space
coordinate — the space in which column 0 begins at `GUTTER_WIDTH` and row 0 begins one `rowHeight`
down, under the sticky header. With `paddingStart: 0` the range math would be off by that band on
both axes. With `paddingStart: GUTTER_WIDTH` (columns) and `paddingStart: rowHeight` (rows),
`item.start` equals `GUTTER_WIDTH + offsets[c]` (`DataGrid.vue:1035`) and
`rowHeight + pos * rowHeight` (`:1506`) respectively, and `getTotalSize()` equals `.grid-sizer`'s
existing width/height expressions (`:1429-1430`) — modulo the pending-insert rows, which are outside
the virtualized `count` (D7).

**F12 — the `transform` convention is TanStack's *examples'* convention, not the library's
requirement.** `getVirtualItems()` returns `VirtualItem { key, index, start, end, size, lane }`
(virtual-core d.ts:23-30) — six plain numbers. Nothing in the library writes to the DOM or requires
a particular positioning property. Since `offsetTop`/`offsetLeft` never reflect a CSS `transform`,
switching to `translate` would break `budgets.spec.ts`'s two blocks (F3) and nothing else — but
there is no reason to switch at all in this phase (D4).

**F13 — adopting the library breaks `budgets.spec.ts`'s work-p50 gate in a way that has nothing to
do with the app's speed.** `measure.ts` starts its work clock at `DataGrid.vue`'s own
`window.__kiraGridScrollWorkStart?.(performance.now())` mark, which is called from **inside
`onScroll`'s rAF callback** (`DataGrid.vue:296-303`, mark at `:300`), and falls back to the
end-to-end start when no mark arrives (`measure.ts:215`, documented at `:166-173`). The library
notifies **synchronously inside the `scroll` event handler** (virtual-core index.js:100-103 →
`:418-437`), so Vue's render job flushes on the following microtask — inside the same "update the
rendering" pass's *scroll steps*, which per the HTML processing model run **before** the animation
frame callbacks. The `MutationObserver` callback (also a microtask) therefore fires **before** the
rAF mark: `workStart` stays `0`, `measure.ts` falls back, and the work-gated
`expect(percentile(scrollDeltas, 50)).toBeLessThanOrEqual(8)` (`budgets.spec.ts:175`) silently
becomes an end-to-end-gated assertion. `PERF.md:86-101` already records what that number is on this
macOS box: **p50 = 16.5 ms**, a documented frame-scheduling artifact. The migration would fail
`budgets.spec.ts` for a reason that is not a regression. D10 moves the mark.

### Environment and constraints

**F14 — the repo now has three test harnesses, not two.** P29's §5 stated *"The repo has exactly two
harnesses — `bun test tests/db` (testcontainers) and Playwright"*. That is stale: `tests/unit/`
exists (P44) with eleven specs, runs renderer modules directly under Bun
(`tests/unit/scan.spec.ts:15-19` imports `src/renderer/views/shared/page/scan`), has a shared
`globalThis.window` stub (`tests/unit/support/window.ts`), demonstrates a fake
`requestAnimationFrame` (`scan.spec.ts:24-30`), is wired as `bun run test:unit`
(`package.json:30`) and is typechecked as its own project (`:26`). The overscan bridge is therefore
unit-testable here without a browser (D16).

**F15 — there is no repo-wide ban on new runtime dependencies, and renderer libraries belong in
`devDependencies`.** `grep -n "dependenc" docs/v1/SPEC.md` outside §10's phasing table returns only
the module-graph section (`SPEC.md:1349`) — no rule. P29's *"No new dependency, no canvas grid, no
library"* is its own §0 line (`P29-scroll-render-gap.md:32`), phase-scoped. On placement: the
renderer build has **no** `externalizeDepsPlugin` (`electron.vite.config.ts:42-56`), unlike main and
preload (`:13`, `:35`), so renderer code is bundled — which is why `vue` (`package.json:75`), every
`@codemirror/*` (`:40-48`), `@vscode/codicons` (`:65`) and `simple-icons` (`:70`) all sit in
`devDependencies` while only true runtime/native modules sit in `dependencies` (`:78-92`). Versions
are pinned exact throughout, no carets. `NOTICES.md` covers **icon assets** only, so an MIT
JavaScript library adds no entry there.

**F16 — SPEC's own text would need editing if the overscan semantics change.** `SPEC.md:494`:
*"Both axes render a 560px overscan buffer beyond the viewport (P29)"*. `SPEC.md:62-63`'s rules —
*"No DOM node per cell for off-screen rows — the grid is virtualized in both axes"* and *"No Vue
reactivity on row data. Rows live in plain frozen typed structures; the grid reads them imperatively
and re-renders on an explicit version counter"* — both survive a virtualizer library on their face
(its reactive state is an index range, not row data, and `page.ts` reads stay imperative), but F8/F9
mean the library is measurably *more* reactive per scroll gesture than today's four primitives, which
is the spirit of the second rule. D3 is the answer to that, not a waiver.

**F17 — there is no committed macOS baseline to measure "after" against.** `PERF.md`'s §1 rows for
the two P29 metrics (`:20-21`) and §2.1's rows for them (`:44-45`) both read **"not yet run"**, and
the note at `:58-69` records why (no Docker in the session that implemented P29). The one scroll row
with numbers (`:39`, p50 5.6 ms) is from the Linux/Xvfb container (`:11-14`), and the macOS re-run
(`:86-101`) **fails** at p50 = 16.5 ms. Two consequences: (1) "compare against PERF.md's committed
numbers" is not directly possible and step 0 of §4 must capture a real before-baseline on the same
machine in the same session; (2) the existing macOS failure is a pre-existing condition this phase
must not be blamed for or allowed to hide behind — D13 requires before *and* after from the same
box. While there, `PERF.md:20`'s methodology cell still describes the pre-work-mark idiom
(*"scroll-event `timeStamp` → DOM committed"*) and is stale against `measure.ts:148-174`.

**F18 — what the trade actually is, stated honestly.** Removed: `visibleColumnRange`'s 43 lines
(`columns.ts:74-116`) and `rowRange`'s ten (`DataGrid.vue:338-347`). Added: one dependency; a second
`scroll` listener and a second `ResizeObserver` on the same element (each virtualizer installs its
own — `observeElementOffset` at virtual-core index.js:119, `observeElementRect` at `:29-47` — though
the component's own `ResizeObserver` (`DataGrid.vue:310-314`) and its `viewportWidth`/`viewportHeight`
refs become dead and are removed, so the net is **+1 listener, +1 observer**); an overscan bridge
(D5); an explicit `measure()` discipline (F10/D9); and a relocated perf mark (F13/D10). Not gained:
dynamic measurement, which this grid does not need — rows are a fixed 22/28 px (`DataGrid.vue:65`)
and column widths are an explicit prefix sum (`columns.ts:56-64`) recomputed on resize. This is a
real trade with a defensible answer in either direction, which is precisely why it is a spike.

## 2. Shapes introduced in this plan

```ts
// src/renderer/views/grid/DataGrid.vue — the row axis. Overscan converts exactly: OVERSCAN_PX is
// a distance and rows are uniform, so `ceil(OVERSCAN_PX / rowHeight)` is byte-identical to the
// arithmetic at :340 today. paddingStart is the sticky header's reserved band (F11) — required for
// the range math to agree with scrollTop, not decoration.
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: displayRowCount.value,           // display-position space (P29 D11), NOT page rows
    getScrollElement: () => containerRef.value,
    estimateSize: () => rowHeight.value,
    overscan: Math.ceil(OVERSCAN_PX / rowHeight.value),
    paddingStart: rowHeight.value,
    onChange: markScrollWork,               // D10 — where measure.ts's work clock now starts
  })),
);
```

```ts
// src/renderer/views/grid/DataGrid.vue — the column axis. `overscan: 0` because the pixel budget
// is applied by the range extractor instead (D5): TanStack's own item-count overscan is the wrong
// unit for a 40-480px column (P29 D2), and rangeExtractor is the documented seam for replacing it.
const colVirtualizer = useVirtualizer(
  computed(() => ({
    horizontal: true,
    count: columnOrder.value.length,
    getScrollElement: () => containerRef.value,
    estimateSize: (i: number) => (offsets.value[i + 1] ?? 0) - (offsets.value[i] ?? 0),
    overscan: 0,
    paddingStart: GUTTER_WIDTH,
    rangeExtractor: (range) =>
      columnRangeExtractor(range, offsets.value, OVERSCAN_PX, MAX_OVERSCAN_COLUMNS),
    onChange: markScrollWork,
  })),
);
```

```ts
// src/renderer/views/shared/page/columns.ts — visibleColumnRange's expansion loop (:97-113),
// preserved verbatim and relocated behind TanStack's own Range shape. Same pixel budget, same
// per-side cap, same "expand a column at a time until overscanPx is covered" semantics P29 D2/D3
// chose and budgets.spec.ts:249-259 already asserts against. The binary search and forward walk
// (:86-95) are what the library now does instead.
export function columnRangeExtractor(
  range: { startIndex: number; endIndex: number; count: number },
  offsets: number[],
  overscanPx: number,
  maxOverscanColumns: number,
): number[];
```

```ts
// src/renderer/views/grid/DataGrid.vue — P29 D4, preserved on top of the library. The virtualizer
// re-notifies on every isScrolling transition even when the index range hasn't moved (F8), and the
// Vue adapter re-notifies on every options change unconditionally (F9); deriving four *numbers*
// means renderRows is invalidated only when the window actually moves, exactly as today.
const rowStart = computed(() => rowVirtualizer.value.getVirtualItems()[0]?.index ?? 0);
const rowEnd = computed(() => {
  const items = rowVirtualizer.value.getVirtualItems();
  const last = items[items.length - 1];
  return last ? last.index + 1 : 0;             // exclusive, matching rowRange's contract today
});
// colStart/colEnd likewise off colVirtualizer. visibleRows (:367-373) and visibleColumnIndices
// (:399-402) are unchanged — they already consume only these four numbers.
```

```ts
// src/renderer/views/grid/DataGrid.vue — F13's relocated mark. Called synchronously from each
// virtualizer's onChange, i.e. after both of Chromium's scheduling hops and before Vue's render
// job — the same "the app's own post-scheduling work starts here" point onScroll's rAF marked
// before, so measure.ts is not touched and its numbers stay comparable across the migration.
function markScrollWork(): void {
  window.__kiraGridScrollWorkStart?.(performance.now());
}
```

```ts
// src/renderer/views/grid/DataGrid.vue — F10's footgun, closed explicitly. estimateSize is read
// during a measurements recompute but does not trigger one, so a column drag or a density change
// must invalidate the cache by hand or the overscan window is computed from stale widths.
watch(offsets, () => colVirtualizer.value.measure());
watch(rowHeight, () => rowVirtualizer.value.measure());
```

```ts
// tests/unit/column-range.spec.ts — the pixel/count bridge, asserted without a browser (F14).
// columns.ts imports nothing at module scope beyond @shared/protocol/page, so no window stub is
// needed; getMeasureCtx() is never reached by columnRangeExtractor.
```

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **This is a spike with a go/no-go gate, not an unconditional migration.** §4's steps 0–3 land the library behind a measurement; step 3 is a checkpoint with numeric criteria (D14); D15 defines the reversal commit. Steps 4–7 only run on "go". | The user said *"trying"*. Two of this plan's findings could only be settled by reading the library's source (F8, F9) and one can only be settled by running it (D14's numbers) — the phase exists because the answer was not knowable in advance, and a plan that assumed "go" would be pretending otherwise. It also keeps the reversal cheap: nothing after step 3 is written until the numbers justify it. |
| D2 | **Only the index-range math is replaced.** P29 D5's `RowVM`/`CellVM` build-once-per-render structure (`DataGrid.vue:989-1050`), P29 D6's `navColumns`/`navValuesFor` precheck, P29 D7's decode-cache pruning (`page.ts`), P29 D8's `.grid-row { contain: layout }`, the entire template, and every `data-testid`, class name, `data-*` attribute and rendered string stay **byte-identical**. | P29 D15's reasoning applies unchanged: `data-view.spec.ts`, `mutations.spec.ts`, `interaction.spec.ts`, `tabs.spec.ts` and `leaks.spec.ts` locate everything by `data-testid`/`data-row`/`data-column`, so leaving them untouched turns the whole existing suite into this phase's regression guard for free. It is also the only way a before/after number means anything (§0): if the render path changed too, a delta is unattributable. |
| D3 | **The four primitive computeds (`rowStart`/`rowEnd`/`colStart`/`colEnd`) stay, now derived from each virtualizer's item array.** `renderRows` never reads `getVirtualItems()` directly. | This is the load-bearing decision of the phase. F8 and F9 are two independent paths by which the library re-notifies Vue when the visible window has **not** moved — an `isScrolling` transition twice per gesture, and any options-object recompute. Consumed directly, each of those would re-run `renderRows` over ~600 cells for byte-identical output, which is precisely the cost P29 D4 removed. Derived into four numbers, `triggerRef` invalidates the shallow ref, the four computeds re-evaluate to the same integers, and `renderRows` is not invalidated at all — P29 D4's property is preserved *exactly*, on top of a library that does not provide it. It also means `budgets.spec.ts:320-336`'s zero-mutation assertion is guaranteed by the app's own structure rather than by hoping Vue's diff writes nothing (F8). |
| D4 | **Positioning stays CSS `top`/`left`, computed from `rowHeight` and `offsets` exactly as today. No `transform` migration, and `item.start` is not used for placement.** | Three reasons. (a) F12: the `translate` convention is the examples', not the library's — `VirtualItem` is six numbers and the library writes no DOM. (b) F3: keeping `top`/`left` keeps `budgets.spec.ts`'s two `offsetTop`/`offsetLeft` blocks (`:229-260`, `:286-313`) valid **unchanged**, so the phase does not have to simultaneously rewrite its own measuring stick. (c) F10: if placement read `item.start`, a stale measurements cache would render cells in the *wrong place*; reading `offsets` means the same staleness only mis-sizes the overscan window — a soft failure instead of a visible one. If a compositor argument for `transform` appears later it is a separate, independently measurable change (§6). |
| D5 | **`OVERSCAN_PX = 560` and `MAX_OVERSCAN_COLUMNS = 12` remain the single source of truth. The row axis converts it to an item count exactly (`ceil(OVERSCAN_PX / rowHeight)`); the column axis bypasses `overscan` entirely (`overscan: 0`) and supplies `visibleColumnRange`'s existing expansion loop as a custom `rangeExtractor`.** | F7 is a direct, named conflict with P29 D2, and D2's rationale — quoted verbatim in F7 — has not stopped being true. The row bridge is *exact*, not an approximation: rows are uniform, so `ceil(560 / 28) = 20` reproduces `DataGrid.vue:340` character for character. The column bridge is exact too, because `rangeExtractor` is the library's own documented seam and the loop at `columns.ts:97-113` moves into it unchanged — same pixel budget, same per-side cap, same "stop on a column boundary" behaviour that `budgets.spec.ts:249-259`'s `bounds.maxWidth` tolerance was written for. An average-column-width approximation was considered and rejected: it would silently change the buffer on any table with mixed column widths, which is the failure mode P29 D2 exists to prevent. **Corollary (F9): the overscan value must never be derived from the scroll offset.** A velocity-adaptive buffer read inside the options factory would make every scroll pixel a full unconditional re-render — worse than anything this phase is trying to fix. |
| D6 | **`paddingStart` carries the two reserved bands: `GUTTER_WIDTH` on the column virtualizer, one `rowHeight` on the row virtualizer.** | F11: the virtualizers read raw `scrollLeft`/`scrollTop`, which is `.grid-sizer` content space, where column 0 starts at 56 px and row 0 starts one row down under the sticky header. Without it the range is off by that band on both axes — a correctness bug, not a cosmetic one. As a bonus it makes `item.start` numerically identical to the `left`/`top` the template already computes, which step 2 asserts once as a cheap cross-check (§5) even though D4 does not *use* it. |
| D7 | **Pending-insert rows stay outside the virtualized `count` and keep `displayPositionOf`.** The row virtualizer's `count` is `displayRowCount` alone; `.grid-sizer`'s height stays `getTotalSize() + insertRows.length * rowHeight`. | P24 D5: an insert row is never hidden by a filter and always renders, so there is nothing to virtualize. `displayPositionOf((page?.rowCount ?? 0) + idx)` (`DataGrid.vue:1591`) already returns `displayRowCount + (row - rowCount)` by its own pending-insert branch (`:249`), which is outside `count` by construction. Folding them into the virtualizer would make `count` change on every staged insert, and F9 makes every `count` change an unconditional full re-render. |
| D8 | **The row virtualizer lives entirely in display-position space; P29 D11's three named sites are preserved literally.** (a) `count` is `displayRowCount` and `item.index` is a **display position**, mapped through `rowAtDisplayPosition` at exactly the one place `visibleRows` does today (`DataGrid.vue:367-373`, unchanged). (b) `RowVM.row` (page row) and `RowVM.pos` (display position) stay two separate fields with their existing consumers. (c) `visiblePageRowBounds` (`:378-389`) keeps handing `setVisibleWindow` the min/max page row of a possibly non-contiguous slice, still a cache hint and not a contract. Columns are never filtered, so the column axis is untouched by any of it. | P29 D11's own reasoning, unchanged: this is the layer most likely to be quietly broken by a refactor of the render window, and collapsing `row` and `pos` renumbers a filtered grid's gutter (P24 D4's explicit failure mode) or stages an edit against the wrong row. Naming the three sites means the implementing session checks them rather than discovering them. The migration makes the risk *higher*, not lower, because `count` and `index` are now library-facing names that read like page rows and are not. |
| D9 | **`colVirtualizer.measure()` on every `offsets` change and `rowVirtualizer.measure()` on every `rowHeight` change, as two explicit watchers.** | F10: `estimateSize` is read during a measurements recompute but is not among the dependencies that trigger one, so a column-width drag (`DataGrid.vue:422`) or a compact/comfortable density switch would otherwise compute the overscan window from stale sizes. A density change happens to also change `paddingStart` (D6), which *is* a dependency and would invalidate it incidentally — relying on that coincidence is exactly the kind of thing that breaks silently two phases later, so both watchers are explicit. This is one line of comment's worth of non-obvious library behaviour and earns it under AGENTS.md. |
| D10 | **`window.__kiraGridScrollWorkStart` moves from `onScroll`'s rAF callback into a shared `markScrollWork` passed as each virtualizer's `onChange`. `tests/ui/support/measure.ts` is not modified.** `onScroll`'s rAF stays, narrowed to what still needs it: `syncScrollState` feeding the 300 ms scroll-position persistence watcher (`DataGrid.vue:404-410`). | F13, which is otherwise a guaranteed, misleading `budgets.spec.ts` failure. `onChange` fires synchronously at notify time — after both of Chromium's scheduling hops and before Vue's render job — which is semantically the same point `measure.ts:166-173` describes for the old mark ("*after both scheduling hops have already resolved and neither app code path takes*"). Not touching `measure.ts` is P29 D13's rule restated: one instrumentation, or the before/after numbers are not comparable and the spike proves nothing. `viewportWidth`/`viewportHeight` and the component's own `ResizeObserver` (`:277-278`, `:310-314`) are deleted in the same commit — the virtualizers observe the element themselves (`observeElementRect`) and nothing else reads those refs (F2). |
| D11 | **Never bind `isScrolling`, `scrollDirection`, `scrollOffset` or any other per-scroll virtualizer state to a DOM attribute, class or style.** | F8: the 150 ms `isScrollingResetDelay` notify lands after every gesture. If it changed anything in the DOM it would (a) break `budgets.spec.ts:320-336`'s zero-mutation assertion outright and (b) let a stray mutation resolve `measureScrollResponses`'s `MutationObserver` (`measure.ts:210-217`) for the wrong reason, silently corrupting every scroll number in `PERF.md`. Recorded as a decision because "add an `is-scrolling` class to cheapen hover work" is a natural-looking follow-up and it would quietly destroy this file's measurements. |
| D12 | **`@tanstack/vue-virtual` goes in `devDependencies`, pinned exact, at the version resolved when step 1 runs (`3.13.36` at plan time). `NOTICES.md` is not touched.** | F15: the renderer bundle has no `externalizeDepsPlugin`, so every renderer library in this repo — `vue`, all of `@codemirror/*`, `@vscode/codicons`, `simple-icons` — is a devDependency, and `dependencies` is reserved for what electron-builder must actually ship. Exact pins match the file's existing style throughout. `NOTICES.md` is scoped to bundled **icon assets** (its own opening line); an MIT JavaScript library adds nothing to it. |
| D13 | **Before/after are measured on the same machine in the same session, with `measureScrollResponses` unchanged, over the three metrics `budgets.spec.ts` already produces**: `big_rows` vertical (`:162-178`), `scroll_grid` horizontal (`:197-202`), `scroll_grid` vertical (`:207-212`). Work p50 is the gated number; e2e p50/p95 are logged alongside, per `PERF.md`'s own methodology note (`:71-84`). | F17: `PERF.md` has **no** macOS numbers for two of the three metrics and a *failing* one for the third, so "compare to the committed baseline" is not available and a baseline captured in this same session is the only honest comparison. Same-session, same-machine also controls for the frame-scheduling artifact `PERF.md:86-101` documents — the artifact is present in both runs, so the *delta* is still meaningful even where the absolute number fails its gate. |
| D14 | **Go/no-go criteria, decided before the numbers exist.** **No-go on any of:** (1) `budgets.spec.ts:320-336`'s sub-row zero-mutation assertion fails; (2) either overscan-coverage invariant (`:214-260`, `:262-313`) fails; (3) `budgets.spec.ts:316-317`'s `< 2500` or `perf.spec.ts:165`'s `< 1500` cell bound is exceeded; (4) any of D13's three work-p50 numbers regresses by **more than 15 %** against the step-0 baseline; (5) the visible-window/gutter/selection correctness items in §8 do not hold under an active search filter. **Go requires** all five clear *and* at least one of: a measurable improvement on any of D13's three metrics, or a strictly simpler `DataGrid.vue` by the F18 accounting. | Criteria written before the run, so the decision is not retrofitted to whatever came out. 15 % rather than 0 % because `PERF.md:71-101` establishes that this measurement's run-to-run spread on this class of machine is roughly a frame; a tighter threshold would be measuring the compositor. The "go requires an actual win" clause matters: F18's accounting is close to a wash, so "it did not get worse" is not a reason to take on a dependency. |
| D15 | **A no-go is a planned, committed outcome, not a failure.** One `revert:` commit removing steps 1–3's application changes and the dependency, plus one `docs:` commit recording — in `PERF.md` §2.1 and in this plan's own §9 — the numbers measured, which criterion fired, and the finding that made it fire. This plan document stays in the tree either way. | The single most likely way this phase goes wrong is a session that has already installed the dependency deciding it would be embarrassing to remove it. Naming the reversal as a deliverable with its own commit removes that pressure. It is also the more valuable outcome to write down: "we tried the popular library, here is exactly why the hand-rolled 43 lines won" is a finding the next person asking *"why not use a library for this?"* can actually use — and F1/F18 make it a genuinely plausible answer. |
| D16 | **`columnRangeExtractor` gets a real unit spec in `tests/unit/`.** | F14: P29 explicitly declined a unit test for `visibleColumnRange` because *"the repo has exactly two harnesses… and neither runs renderer modules in isolation"* — no longer true since P44. The pixel→index bridge is the one piece of new logic in this phase with branch behaviour worth asserting directly (both caps engaging, both clamping at the table's edges, a single-column table, a table narrower than the viewport), and `columns.ts` imports only `@shared/protocol/page` at module scope so no window stub is needed. |
| D17 | **No existing assertion is relaxed, re-scoped or deleted to accommodate the library, and `budgets.spec.ts` needs no edit at all if D3/D4 hold.** Its mirrored `OVERSCAN_PX = 560` (`:42`) and `GUTTER_WIDTH = 56` (`:49`) literals stay meaningful because D5/D6 keep both constants meaning what they meant. | The suite is the only thing standing between "the library works" and "the library appears to work". P29 D13/D15's whole point. If the sub-row assertion fails, that is D14 criterion (1) firing — it is the *answer*, not an obstacle to the answer. Stated as a decision because "the library re-renders on scroll start, so the zero-mutation test is unrealistic now" is a persuasive-sounding sentence that would throw away the phase's most informative signal. |
| D18 | **`docs/PERF.md` and `docs/v1/SPEC.md` are edited by the implementing session at the end, once the outcome is known** — never before. On "go": `PERF.md` §2.1 gains a before/after block for D13's three metrics and §1's stale methodology cell (`:20`) is corrected to describe the work-mark idiom; `SPEC.md:494`'s "560px overscan buffer" sentence stays true under D5 and needs **no** change; SPEC §10 gains a P47 row. On "no-go": the same `PERF.md` block records the measured attempt, and SPEC §10's row records the reversal and its reason. | Standing practice (P29 D17, P24 D41, P23 D12): the phasing table is a record of what shipped, and a row that describes work as done before it is done would be the first one in it that lies. Splitting it by outcome also forces the no-go path to leave a real record instead of a silent `git revert`. |
| D19 | **This phase does not attempt complaint (b), and says so in its own acceptance checklist.** | F1. Scroll velocity and momentum are Chromium's; the honest deliverable for that half is §6's named follow-up, not a paragraph implying the library helped. §9's first question puts it in front of the user directly. |

## 4. Implementation order

Each step is one commit and must leave `bun run lint`, `bun run typecheck` (all four projects) and
`bun run build` green. **Steps 4–7 run only if step 3's checkpoint says "go".**

**Step 0 — the baseline, before any library code exists.** On the macOS/Colima box (Docker up),
run `bun run test:ui -- budgets` against the **unmodified** tree and record all three of D13's
metrics: work p50/p95 and e2e p50/p95 for `big_rows` vertical, `scroll_grid` horizontal and
`scroll_grid` vertical, plus whether each currently passes its gate. F17 means this is the *only*
comparable baseline that will exist. Do not commit a spec change here; record the run (the numbers
land in `PERF.md` at step 7, as the "before" column). Note explicitly whether
`budgets.spec.ts:175`'s p50 gate passes or reproduces `PERF.md:86-101`'s 16.5 ms failure — the
after-run must be read against whichever it is.

1. **`chore(deps): add @tanstack/vue-virtual`** — D12. `devDependencies`, exact pin, lockfile
   updated. No source change. Verifies the dependency actually builds into the renderer bundle
   (`bun run build`) before any code depends on it, and keeps the revert of D15 a clean boundary.

2. **`perf(grid): virtualize the grid's row and column ranges with @tanstack/vue-virtual`** — D3,
   D5, D6, D7, D8, D9, D10, D11. The one substantive commit:
   - `columns.ts`: `columnRangeExtractor` added (the loop from `visibleColumnRange:97-113`, moved
     verbatim behind TanStack's `Range` shape); `visibleColumnRange` deleted along with its now-only
     caller.
   - `DataGrid.vue`: `rowVirtualizer` / `colVirtualizer` per §2; `rowRange` (`:338-347`) and
     `colRange` (`:348-356`) deleted; `rowStart`/`rowEnd`/`colStart`/`colEnd` (`:362-365`) rewritten
     to derive from the item arrays; `visibleRows` (`:367-373`) and `visibleColumnIndices`
     (`:399-402`) **unchanged**; `viewportWidth`/`viewportHeight` and the component `ResizeObserver`
     (`:277-278`, `:310-314`, `:325`) deleted; `markScrollWork` added and `onScroll`'s rAF
     (`:296-303`) narrowed to `syncScrollState` for the persistence watcher only; the two `measure()`
     watchers added; `.grid-sizer`'s height/width bindings (`:1429-1430`) rewritten in terms of
     `getTotalSize()` plus D7's insert-row term.
   - **Not touched:** the template below `.grid-sizer`, `renderRows`/`RowVM`/`CellVM`,
     `scrollCellIntoView` (D4/F4 — it keeps writing `scrollTop`/`scrollLeft` directly), `page.ts`,
     `pendingChanges.ts`, `menu.ts`, `search.ts`, every CSS rule.
   - Verify by hand before continuing: a filtered grid still shows real gutter numbers, a staged
     insert still renders after the last visible row, a column drag still re-renders at the new
     width (D9's watcher), and a density switch still changes the buffer correctly.

3. **CHECKPOINT — measure, then decide (no commit of its own).** Re-run step 0's command on the
   step-2 tree and evaluate D14's five no-go criteria and its go clause against the recorded
   baseline. Also run the full `bun run test:ui` and `bun run test:unit`. **Write the numbers down
   before interpreting them.** Then take one of two branches:
   - **No-go → D15.** Commit `revert: back out @tanstack/vue-virtual from the data grid` (steps 1–2
     reverted, dependency removed), then jump to step 7's docs commit, which records the measured
     attempt and the criterion that fired. The phase ends there and is complete.
   - **Go →** continue to step 4.

4. **`test(unit): cover the grid's pixel-budget column range extractor`** — D16.
   `tests/unit/column-range.spec.ts`: both caps engaging, both edges clamping, a single-column
   table, a table narrower than the viewport, and the P29 D2 property that the returned window
   covers ≥ `OVERSCAN_PX` on each side or stops at the table's edge. `bun run test:unit` green.

5. **`test(ui): re-run the grid's scroll invariants against the virtualizer`** — D17. Expected to be
   an **empty diff** to `budgets.spec.ts` and `perf.spec.ts`; the commit exists to record the full
   `xvfb-run -a bun run test:ui` run being green and, if any spec did need a change, to isolate that
   change from step 2 so it is visible in review. A change here that weakens an assertion is a D14
   criterion firing, not a commit — go back to step 3.

6. **`perf(grid): drop the dead scroll-position plumbing`** — optional, only if step 2 left anything
   behind (e.g. `syncScrollState` reduced to one axis, an unused import). Skipped entirely if step 2
   was already clean; a no-op commit is worse than no commit.

7. **`docs: record P47's virtualizer measurements`** — D18. `PERF.md` §2.1's before/after block for
   D13's three metrics plus §1's stale methodology cell (`:20`); `SPEC.md` §10's new P47 row stating
   the outcome — adopted, or tried and reverted with the reason; this plan's own §9 answers. On the
   go path `SPEC.md:494`'s 560 px sentence is verified still-true under D5 and left alone.

## 5. Tests

`tests/db/` and `tests/electron-db/` are untouched — no adapter, engine, protocol, SQL or fixture
change exists in this phase.

### Existing specs and what changes in each

| Spec | Why it is in scope | Change |
|---|---|---|
| `tests/ui/budgets.spec.ts` | The most coupled spec by far: it mirrors `OVERSCAN_PX = 560` (`:42`) and `GUTTER_WIDTH = 56` (`:49`) as literals, gates work-p50 ≤ 8 ms on three measurements (`:175`, `:201`, `:211`), asserts both overscan-coverage invariants via `offsetLeft`/`offsetTop` (`:229-260`, `:286-313`), bounds `grid-cell` count at `< 2500` (`:316-317`), and asserts sub-row-scroll-mutates-nothing with a positive control (`:320-353`). | **No change expected, and none permitted that weakens an assertion (D17).** D5 keeps both mirrored literals meaning what they meant; D4 keeps `offsetTop`/`offsetLeft` valid (they never reflect a `transform`, which is why the migration deliberately does not introduce one); D10 keeps the work-clock mark firing so `:175` stays a work-gated assertion rather than silently becoming an e2e one (F13); D3 keeps the sub-row window from re-rendering at all. Every one of those is a D14 go/no-go criterion — this spec *is* the checkpoint. |
| `tests/ui/perf.spec.ts` | `< 1500` `grid-cell` bound on a 2-column fixture (`:165`), rAF frame-time tripwire, retained-bytes and L2 budgets. | **No change.** Two columns × ~61 rendered rows is ~122 cells either way. Re-run and shown green, not assumed — its stated purpose ("catches 'someone made the grid re-render every row per frame'") is exactly what F9 could reintroduce. |
| `tests/ui/data-view.spec.ts`, `mutations.spec.ts`, `interaction.spec.ts` | Locate rows and cells purely by `data-testid` / `data-row` / `data-column` (P29 D15's discipline) — pure black-box functional assertions with no DOM-position math. | **No change** — they are the regression guard for D2/D8. `interaction.spec.ts`'s PK/FK nav block and `data-view.spec.ts`'s search-filter assertions are the specific guards for D8's display-position/page-row split. All run and shown green. |
| `tests/ui/tabs.spec.ts`, `leaks.spec.ts` | No direct grid-DOM coupling, but `leaks.spec.ts`'s tab/store symmetry and retained-bytes bound are the guard for F18's net **+1 scroll listener and +1 `ResizeObserver`** per open grid tab, torn down by the adapter's `onScopeDispose(cleanup)` (vue-virtual index.js:37). | **No change.** Run and shown green; a tab-open/close cycle must not grow retained bytes. |
| `tests/ui/cell-editor.spec.ts` | `scrollColumnIntoView`'s documented fixed 100 ms per-step settle, written against pre-P29 virtualization cost. | **No change**, not even to the comment. It is a conservative wait, not a structural assertion, and tuning a wait that is not failing is how a suite becomes flaky (P29 §6's own reasoning). |
| `tests/ui/support/measure.ts` | Owns the work/e2e instrumentation the whole comparison rests on. | **No change** (D10). The mark moves in the app, not in the harness — P29 D13's "one instrumentation or the numbers are not comparable" rule. |
| `tests/ui/support/pg.ts` | `seedScrollFixture` (`app.scroll_grid`, 60 columns × 5 000 rows, P29 D14). | **No change.** The fixture this phase needs already exists. |

### New coverage — `tests/unit/column-range.spec.ts` (D16)

Direct assertions on `columnRangeExtractor(range, offsets, overscanPx, maxOverscanColumns)`, with
no browser and no window stub:

- **The pixel budget is honoured on both sides**: given uniform 100 px columns and
  `overscanPx = 560`, a mid-table range expands by 6 columns each side (the loop stops on the first
  column boundary at or past 560 px) and no further.
- **`maxOverscanColumns` binds before the pixel budget on narrow columns**: uniform 40 px columns
  and `overscanPx = 560` would want 14 per side; the result is capped at 12.
- **Both edges clamp**: a range at index 0 expands only rightward; a range at `count - 1` only
  leftward; neither produces an out-of-bounds index.
- **Degenerate shapes**: a single-column table, and a table whose total width is under the viewport
  (`startIndex === 0 && endIndex === count - 1`) return every index exactly once, ascending, with no
  duplicates.
- **The returned array is ascending and contiguous** — `defaultRangeExtractor`'s own contract, which
  `visibleColumnIndices` (`DataGrid.vue:399-402`) and `renderRows`' column loop both rely on.

### What is deliberately not asserted

- **No frame-rate, "no blank pixel", or scroll-velocity assertion.** P29 F10/D10's reasoning is
  unchanged: Chromium's compositor can always outrun the main thread, and an assertion phrased as
  "nothing was ever blank" asserts the scheduler, not the app. F1's complaint (b) is not testable
  here at all, because it is not a property of this codebase.
- **No test that the library itself works.** `getVirtualItems()`'s memoization and `maybeNotify`'s
  dependency list (F8) are the library's own behaviour, verified by reading its source and relied on
  through D3 in a way that does not *require* them to hold — if a future release re-notifies more
  eagerly, the four primitive computeds absorb it and the existing suite still passes.
- **No unit test of the virtualizers themselves.** They need a real scroll element with real
  geometry; `budgets.spec.ts`'s two coverage invariants already assert the property end to end,
  which is the same argument P29 §5 made against a unit test for `visibleColumnRange`.

## 6. Explicitly out of scope

- **Complaint (b) — "the scroll doesn't feel silky, native mac velocity is higher" (F1/D19).** Not
  addressable by any virtualizer. A phase that actually targets it would have to look at things this
  one deliberately does not touch: whether the grid's scroll container can be composited/threaded at
  all given `.grid-sizer`'s ~280 000 px height on a 10 000-row page (`budgets.spec.ts:158-160`),
  whether `.grid-row`'s `contain: layout` (P29 D8) helps or hinders that, what Electron 43 on macOS
  does with trackpad momentum in a non-native scroller, and whether an overlay/custom scrollbar is
  involved. Named here so the next reader knows it was considered and consciously separated, not
  forgotten.
- **Row positioning via `transform: translateY` (D4/F12).** Real, measurable, and a genuinely
  separate change with its own blast radius (`budgets.spec.ts`'s two `offsetTop`/`offsetLeft` blocks
  would have to move to `getBoundingClientRect`, since neither reflects a transform). Doing it in the
  same phase would make every before/after number unattributable.
- **`measureElement` / dynamic row heights.** Rows are a fixed 22/28 px (`DataGrid.vue:65`) and
  column widths are an explicit prefix sum (`columns.ts:56-64`); the `ResizeObserver`-per-item
  machinery is the library's main feature and this grid needs none of it. Turning it on would add an
  observer per rendered cell — directly against SPEC §2.1's "No DOM node per cell for off-screen
  rows" in spirit and against §2.2 in fact.
- **`scrollToIndex` / `scrollToOffset` replacing `scrollCellIntoView`** (`DataGrid.vue:1255-1275`,
  F4). It is pure arithmetic against the same offsets model, it already handles the sticky header
  band and the immediate `syncScrollState`, and routing it through the library would introduce
  `_intendedScrollOffset` reconciliation into a path that currently has none.
- **`VirtualList.vue`** and everything on it — the tree, the operations panel, the document,
  key/value and stream views, the console result grid. P29 D12's reasoning is unchanged: different
  component, single-axis, no reported symptom. If P47 goes "go", migrating `VirtualList.vue` is an
  obvious follow-up and §9 asks about it rather than smuggling it in.
- **Changing `OVERSCAN_PX`, `MAX_OVERSCAN_COLUMNS`, or making the buffer velocity-adaptive.** The
  reverted tuning attempt that prompted this phase was exactly that, and mixing it back in would make
  the spike measure two changes at once. D5's corollary also makes a scroll-offset-derived overscan
  actively harmful under this library (F9).
- **`page.ts`'s decode cache, `pendingChanges.ts`'s reactivity, `menu.ts`'s nav predicates.** P29 D6
  and D7's territory, untouched.
- **SPEC §2.1's budget table.** Unchanged either way; this phase produces no new metric, only new
  values for three existing ones (D13).

## 7. Target tree at the end of P47

On the **go** path:

```
package.json                      MOD  @tanstack/vue-virtual in devDependencies, exact pin (D12)
bun.lock                          MOD  +@tanstack/vue-virtual, +@tanstack/virtual-core
NOTICES.md                         --  UNCHANGED (icon assets only, D12)
src/renderer/
  views/grid/
    DataGrid.vue                  MOD  rowVirtualizer/colVirtualizer replace rowRange/colRange (D3/D5/D6);
                                       rowStart/rowEnd/colStart/colEnd derive from item arrays (D3);
                                       viewportWidth/Height + component ResizeObserver deleted (D10);
                                       markScrollWork replaces onScroll's mark (D10); two measure()
                                       watchers (D9); .grid-sizer sized off getTotalSize() + inserts (D7);
                                       template, renderRows, RowVM/CellVM, scrollCellIntoView, all CSS
                                       UNCHANGED (D2/D4)
    page.ts                        --  UNCHANGED (P29 D7's cache untouched)
    pendingChanges.ts / menu.ts / search.ts / state.ts / sortTerms.ts
                                   --  UNCHANGED
    DataView.vue / DataToolbar.vue / SearchToolbar.vue
                                   --  UNCHANGED
  views/shared/page/
    columns.ts                    MOD  columnRangeExtractor added (visibleColumnRange:97-113 verbatim,
                                       behind TanStack's Range shape); visibleColumnRange deleted (D5)
    scan.ts / visibleRows.ts       --  UNCHANGED
  workbench/VirtualList.vue        --  UNCHANGED (§6)
  main.ts                          --  UNCHANGED (__kiraGridScrollWorkStart's Window augmentation stays)
tests/ui/
  budgets.spec.ts                  --  UNCHANGED — the go/no-go gate, re-run and shown green (D17)
  perf.spec.ts / data-view.spec.ts / mutations.spec.ts / interaction.spec.ts /
  tabs.spec.ts / leaks.spec.ts / cell-editor.spec.ts
                                   --  UNCHANGED (the regression guard, D2)
  support/measure.ts               --  UNCHANGED (D10)
  support/pg.ts                    --  UNCHANGED (scroll_grid already exists)
tests/unit/
  column-range.spec.ts            NEW  the pixel-budget range extractor (D16)
docs/
  PERF.md                         MOD  §2.1 before/after for the three scroll metrics; §1's stale
                                       methodology cell corrected (D18)
  v1/SPEC.md                      MOD  §10's P47 row, once implemented; §8.5:494 verified, not edited
  v1/plans/P47-tanstack-virtual-spike.md   NEW  this document
```

On the **no-go** path (D15) the tree is identical to today except:

```
docs/PERF.md                      MOD  §2.1 records the measured attempt and the criterion that fired
docs/v1/SPEC.md                   MOD  §10's P47 row records "tried, reverted, here is why"
docs/v1/plans/P47-tanstack-virtual-spike.md   NEW  this document, with §9 answered
```

…reached through `chore(deps)` → `perf(grid)` → `revert:` → `docs:`, so the attempt and its reason
are legible in the history rather than absent from it.

## 8. Acceptance checklist

**The spike answered its question**

- [ ] Step 0's baseline was captured on the macOS/Colima box **before** any library code existed,
      and all three of D13's metrics were recorded with both work and e2e figures.
- [ ] Step 3's numbers were written down before they were interpreted, and each of D14's five no-go
      criteria was evaluated explicitly rather than by impression.
- [ ] The outcome — go or no-go — is recorded in `PERF.md` §2.1 and `SPEC.md` §10 with the numbers,
      not just a verdict.
- [ ] If no-go: the `revert:` commit removes steps 1–2 and the dependency completely
      (`grep -rn "tanstack" src tests package.json bun.lock` is clean), and the reason is written
      down (D15).

**Correctness (go path)**

- [ ] With the search filter on (P24/P29 D11), the gutter still shows real row numbers
      (`3, 17, 84, …`), the selection still addresses page rows, a staged insert still renders after
      the last visible row, and the unfiltered path still short-circuits to identity.
- [ ] Dragging a column's width re-renders at the new width and the overscan window follows it
      (D9's `measure()` watcher — verify by hand, this is F10's silent failure mode).
- [ ] Switching row density compact ↔ comfortable changes both the row height and the buffer, with
      no stale-size artifacts.
- [ ] The PK/FK nav button appears on exactly the cells it appeared on before, including the
      NULL-`manager_id` case that must show none, and clicking it opens the same pre-filtered tab.
- [ ] A staged edit still tints its cell, a pending delete still strikes its row, search matches
      still highlight, and the current match still scrolls into view (`scrollCellIntoView`
      unchanged, D4/F4).
- [ ] Opening and closing ten grid tabs leaves no retained scroll listeners or `ResizeObserver`s
      (`leaks.spec.ts` green — the adapter's `onScopeDispose` is doing its job, F18).
- [ ] The whole scroll sequence adds **zero** rows to the operations panel — no page is fetched by
      scrolling, before or after.

**Measured (go path)**

- [ ] `budgets.spec.ts` green in full, with **no assertion weakened, re-scoped or deleted** (D17).
- [ ] `budgets.spec.ts:175`'s p50 is still gated on the **work** number, not the end-to-end one —
      i.e. D10's relocated mark is actually firing (F13). Verify by confirming the logged work and
      e2e p50s still differ; if they are identical the mark is not landing.
- [ ] The sub-row zero-mutation assertion (`:320-336`) passes **and** its positive control
      (`:338-353`) still produces mutations.
- [ ] Both overscan-coverage invariants pass at every sampled scroll position on both axes.
- [ ] `perf.spec.ts`'s rAF tripwire and `< 1500` cell bound pass, re-run rather than assumed.
- [ ] `PERF.md` §2.1 carries a real before/after pair for all three metrics with the machine and
      date, in the format the existing rows use — and states plainly whether the pre-existing macOS
      p50 failure (`PERF.md:86-101`) was still present in both runs.

**Hygiene**

- [ ] `bun run lint`, `bun run typecheck` (node, web, db, unit) and `bun run build` clean after
      every commit; `bun run test:unit` and `xvfb-run -a bun run test:ui` green.
- [ ] `@tanstack/vue-virtual` is in `devDependencies` at an exact pin, not `dependencies` (D12).
- [ ] No `data-testid`, class name, DOM attribute or rendered string changed anywhere (D2) —
      `git diff` over `DataGrid.vue`'s `<template>` block is empty except `.grid-sizer`'s two size
      bindings.
- [ ] **No claim anywhere — commit message, PERF.md, SPEC row — that this phase improved scroll
      smoothness or velocity** (F1/D19). It cannot have.

## 9. Open questions for the user

1. **Complaint (b) is out of reach of any virtualizer, and this phase will not fix it (F1/D19).**
   Scroll velocity, momentum and the "silky" feel are Chromium's compositor, not the app's render
   loop — TanStack Virtual reads `scrollTop` in a listener and nothing more. Is it worth queuing a
   separate phase for that half (§6 sketches what it would actually investigate: whether a
   ~280 000 px-tall sizer can be threaded/composited on macOS at all, what Electron 43 does with
   trackpad momentum in a non-native scroller), or is the fast-fling blanking the part you actually
   care about?
2. **Is a documented "tried it, reverted it" an acceptable outcome (D14/D15)?** The honest reading of
   F18 is that the trade is close to a wash: the library removes ~53 lines of arithmetic and adds a
   dependency, a scroll listener, an observer, an overscan bridge, a `measure()` discipline and a
   relocated perf mark — while providing none of its headline features (no 2D primitive, F6;
   dynamic measurement this grid does not need). The plan is built so that reversal is one commit
   and produces a real finding. Confirm you want it decided on the numbers rather than adopted on
   principle.
3. **`@tanstack/vue-virtual`'s overscan is an item count and P29 D2 explicitly rejected that unit
   for the column axis (F7).** D5 bridges it by supplying `visibleColumnRange`'s existing pixel walk
   as a custom `rangeExtractor`, so the 560 px budget survives exactly. That does mean the library's
   own overscan mechanism is bypassed on one of the two axes. If you would rather see the library
   used "as designed" — raw item-count overscan, `SPEC.md:494` reworded — say so, but it reintroduces
   the 160 px-to-1 920 px swing P29 measured and fixed.
4. **The grid would keep CSS `top`/`left` rather than moving to `transform` (D4).** Every published
   TanStack example uses `translate`. It is a real and separately measurable change, and skipping it
   here keeps `budgets.spec.ts`'s own measuring stick valid while the virtualization changes
   underneath it. Happy to do it as its own phase afterwards if the compositor argument turns out to
   matter — but not in the same commit as the migration.
5. **If this goes "go", `workbench/VirtualList.vue` is the obvious next candidate** — the tree, the
   operations panel, the document, key/value and stream views and the console result grid all
   virtualize through it with an `overscan: 8` row count. §6 leaves it alone deliberately (P29 D12's
   reasoning: different component, single axis, no reported symptom). Worth a follow-up phase, or
   leave it until someone notices?
6. **`PERF.md` currently has no macOS baseline for two of the three scroll metrics and a failing one
   for the third (F17).** Step 0 captures a real baseline as part of this phase. Note that
   `budgets.spec.ts` may well fail at step 0 on the macOS box for the pre-existing reason
   `PERF.md:86-101` documents — that is not this phase's regression, and D13 reads the *delta*
   rather than the absolute. Flagging it so a red run at step 0 does not read as a blocker.
