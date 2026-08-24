# P29 — The grid's scroll rendering gap

> SPEC.md §10's own row, verbatim: *"Scrolling either the data grid or the cell editor's own
> content quickly leaves a visible blank gap before the newly-scrolled-to content renders — worse
> horizontally than vertically. Root-cause the virtualization/paint timing (prefetch window,
> row-height math, horizontal column virtualization if any) and close the gap rather than papering
> over it with a spinner"* (`SPEC.md:677`).
>
> The user's own words: *"Scrolling the cell view fast leaves like an empty space until it gets to
> render the actual content. it s even worse horizontaly"*.
>
> **This is a measurement phase before it is a fix phase.** `docs/v1/PERF.md` is the living record
> P12 established and P13 extended; every number this phase produces goes into it, using the
> instrumentation `tests/ui/support/measure.ts` already owns rather than a second measurement
> idiom. The two sentences that matter most in that file are its own: the scroll budget is gated on
> **p50** because a script-driven `scrollTop` write's `scroll` event is deferred to Chromium's next
> "update the rendering" step (`PERF.md:55-68`), and a lever fires only against a real measured
> trigger, never against a hunch (`PERF.md:147-162`). Both hold here.

## 0. Ground rules for this phase

- **No spinner, no skeleton, no placeholder row.** SPEC's own P29 row forbids papering over the gap.
  A blank region during a fling is a *virtualization* defect and gets a virtualization fix.
- **The unfiltered path's arithmetic stays the unfiltered path's arithmetic.** P24 D3's whole design
  is that `displayRows === null` short-circuits to today's row math (`DataGrid.vue:186-215`).
  Everything below either preserves that short-circuit or does not touch it. §3's D11 states the
  interaction explicitly rather than assuming a direct page-row → render mapping.
- **No new reactivity on row data.** §2.1's third rule (`SPEC.md:54-55`) — *"No Vue reactivity on
  row data. Rows live in plain frozen typed structures"* — is not just about `page.ts`'s frozen
  chunks; it is about what the render path touches per cell. F6 below is a measured violation of it
  in spirit, and the fix moves in that direction, never away.
- **No new dependency, no canvas grid, no library.** The fix is arithmetic, one CSS property and the
  removal of work that is done up to 126× per cell today.
- **Measure before and after, on a fixture that can actually show the defect.** F8 is that the
  existing scroll budget is measured against `app.big_rows` — a **two-column** table
  (`tests/db/fixtures/0001_seed.sql:275-278`) — which is precisely the shape that cannot exhibit the
  column-count-dependent cost F5/F6 describe, and cannot scroll horizontally at all. A phase about
  horizontal scrolling that keeps measuring a two-column table has measured nothing.
- **Every commit leaves `bun run lint`, `bun run typecheck` (all three projects) and `bun run build`
  green**, and `xvfb-run -a bun run test:ui` green from step 7 on. `tests/db/` is untouched: no
  adapter, engine, protocol or SQL change exists in this phase, and no file under `tests/db/`
  (fixtures included — see D14) is edited.
- Comments per AGENTS.md: only where the code cannot say it for itself. Each constant introduced
  below carries exactly one line explaining the number, replacing the five-line prose comment
  `DataGrid.vue:46-51` currently carries.
- Conventional Commits, one per step of §4: `perf(grid):`, `test(ui):`, `docs:`.

## 1. Findings (verified against the tree, not assumed)

### Which surface the user means

**F1 — the cell editor's CodeMirror cannot scroll horizontally at all, so it cannot be the surface
that is "even worse horizontally".** `CodeMirrorHost.vue:137` puts `EditorView.lineWrapping` in the
base extension list of *every* host in the app — the cell editor, the definition viewer, the query
console, the op-log detail rows. With line wrapping on, `.cm-content` never exceeds the scroller's
width, so `.cm-scroller`'s `overflow: auto` (`editor/theme.ts:14-19`) produces a vertical scrollbar
only. The cell editor also never holds more than 64 KB (`shared/protocol/page.ts:145`,
`MAX_CELL_BYTES`), which is inside the document size CodeMirror renders without visible viewport
churn. **The data grid is the only surface in `src/renderer` with genuine two-axis virtualization**
(`DataGrid.vue:294-305`), and therefore the only one where a horizontal fling can outrun the DOM.
This phase is scoped to it; §9 asks the user to confirm, and §6 records what a cell-editor-specific
follow-up would look like if the answer is "no".

**F2 — the grid is the app's only horizontally virtualized surface.** `ConsoleResultGrid.vue:146-196`
renders every column of a result and virtualizes rows only (through `VirtualList.vue`);
`DocumentView`, `KeyValueView`, `StreamView` and `ProjectTree` are all single-column lists on the
same `VirtualList`. So "worse horizontally" localises the report to `DataGrid.vue` before a single
measurement is taken.

### Root cause

**F3 — the column axis has *no* overscan; the row axis has 560 px of it.** `DataGrid.vue:52` is
`const OVERSCAN_ROWS = 20`, applied on both sides in `rowRange` (`:294-302`) — 20 × 28 px = **560 px**
of rendered-but-not-visible rows above and below the viewport at the default row density. The column
axis calls `visibleColumnRange(scrollLeft, viewportWidth, offsets)` (`:303-305`), whose entire body
(`columns.ts:64-81`) is *"the first column whose right edge is past `scrollLeft`"* through *"the last
column whose left edge is before `scrollLeft + viewportWidth`"* — **exactly the visible columns, zero
buffer, both sides**. The comment at `DataGrid.vue:46-51` records that `OVERSCAN_ROWS` was already
widened once from 8 to 20 for this exact symptom (*"cells disappear, then reappear once you stop"*)
— and the horizontal axis never got the same treatment. This is the asymmetry the user reports, in
one line of code: vertically the compositor has to outrun the main thread by more than 560 px before
anything blanks; horizontally it has to outrun it by **one pixel**.

**F4 — every scroll event re-renders every visible cell, even when the window has not moved.**
`rowRange` (`:294-302`) and `colRange` (`:303-305`) are `computed`s returning **fresh object
literals**. Vue compares a computed's new value to its old with `Object.is`, so a new object always
counts as changed, so `visibleRows` (`:307-313`) and `visibleColumnIndices` (`:331-335`) invalidate
on **every** `scrollTop`/`scrollLeft` write — including a 1 px scroll that changes neither
`start` nor `end`. The render function then re-runs in full, re-evaluating every per-cell binding
below. At the default 28 px row height, 27 of every 28 vertical pixels scrolled produce a complete
re-render that emits the identical DOM.

**F5 — the render path rebuilds a whole-row snapshot *per cell*, twice per cell minimum.**
`cellNavEntry(row, displayCol)` (`DataGrid.vue:704-731`) builds `fkCtx` with
`rowValues: rowSnapshot(row).values` **before** it knows whether the column participates in any
foreign key — and `rowSnapshot` (`:694-702`) loops over the **entire** `columnOrder` calling
`displayCell` for each. The template calls `cellNavEntry` for every rendered cell at `:1164`
(`cellClass`'s `hasNav`) and `:1199` (the button's `v-if`), plus three more times at `:1203`,
`:1204` and `:1207` whenever the button renders. The null guard that could make this cheap
(`:716`) only checks that `meta` exists — and `meta` is populated by `loadMeta` on the first
successful page load (`views/grid/state.ts:70-79, 134`), so on any real table the expensive path is
the live path, foreign keys or not.

The arithmetic, for `wide_table`'s 60 columns (`tests/db/fixtures/0001_seed.sql:20-22`) with a
560 px vertical buffer and a ~600 px viewport — 61 rendered rows × ~10 visible columns = 610 cells:

| per rendered cell | calls |
|---|---|
| `displayCell` directly from the template (`:1155`, `:1162`, `:1163`, `:1186`, `:1190`, `:1192`) | 5–6 |
| `cellNavEntry` (`:1164`, `:1199`, and `:1203`/`:1204`/`:1207` when the button shows) | 2–5 |
| `displayCell` *inside* those, via `rowSnapshot` — 60 per call | **120–300** |

≈ **126 `displayCell` calls per cell**, ≈ **77 000 per render**, ≈ **1 200 sixty-key objects
allocated per render**, at up to one render per frame. That is the "until it gets to render" half of
the report, and it scales with the **column count** — which is why a wide table feels worse, and why
the horizontal axis (where a step reveals a new column across *all* 61 rendered rows, rather than a
new row across ~10 visible columns) is worse again.

**F6 — `displayCell` is not memoised, and its first stop is a *reactive* Map.**
`displayCell` (`:545-561`) calls `stagedValue` (`pendingChanges.ts:70-72`), which reads
`pendingState` — `reactive(...)` at `pendingChanges.ts:27` — so every one of F5's ~77 000 calls per
render goes through Vue's collection instrumentation and registers a dependency, then through
`cellAt` (`:345-351`) → `pageColumnIndexFor` (a `WeakMap` + `Map` lookup) → `cell()`
(`page.ts:79-93`), which allocates a `` `${row}:${col}` `` string key per call. §2.1's *"No Vue
reactivity on row data"* (`SPEC.md:54`) is about exactly this path.

**F7 — the decode cache is emptied every time the row window moves by one row.**
`setVisibleWindow` (`page.ts:63-71`) keys on `` `${startRow}:${endRow}` `` and calls
`decodeCache.clear()` whenever that string changes. `visiblePageRowBounds`
(`DataGrid.vue:318-328`) changes on every row boundary crossed, so during a fling the cache is
thrown away on every step and the next render re-decodes every visible cell through `TextDecoder`
from scratch. The window it is handed already *includes* the 20-row overscan on both sides, so the
entries being discarded are overwhelmingly ones about to be needed again.

**F8 — nothing in the suite measures horizontal scrolling, and the vertical measurement uses the
narrowest table in the fixture set.** `budgets.spec.ts:199-228` measures `measureScrollResponses`
against `app.big_rows`, which has exactly **two** columns (`0001_seed.sql:275-278`) and therefore
(a) has no horizontal scroll to measure and (b) makes F5's per-cell cost 2 × 2 + 6 ≈ 10 rather than
126 — under budget by construction. `perf.spec.ts:157-191` scrolls the same table and bounds DOM
cells at 1 500 (`:191`), again on two columns. `measure.ts:155-195`'s `measureScrollResponses` only
writes `scrollTop`. The one place the suite *does* touch a wide table's horizontal virtualization is
a workaround: `cell-editor.spec.ts:104-129`'s `scrollColumnIntoView` needs a 100 ms settle per step
because *"a wide (60-column) table's virtualized header recompute is heavier than the tree's row
virtualization — 30ms wasn't consistently enough"*. That comment is F5, observed and worked around
rather than diagnosed.

**F9 — the grid uses no CSS containment anywhere, and no `will-change`.** `grep -rn "contain:"
src/renderer` returns nothing; the only `transform` in the tree are three `translateY(-50%)`
centring rules (`DataGrid.vue:1495`, `IconButton.vue:50`, `SearchBox.vue:60`). Rows are
`position: absolute` with a `top` style (`:1358-1362`, `:1132`) and cells `position: absolute` with
a `left` style (`:1421-1438`, `:1167-1171`), so adding or removing a row invalidates layout across
the whole `.grid-sizer` subtree with nothing scoping it. This is not the cause, but it is free
headroom on the same path — and its absence is at least *symmetric* between the two axes, so it
does not explain the asymmetry on its own.

**F10 — the rAF coalescing in `onScroll` is correct and is not the cause.**
`DataGrid.vue:243-257` coalesces many native `scroll` events into one `syncScrollState` per frame.
Per the HTML processing model, "run the scroll steps" happens *earlier in the same* "update the
rendering" pass than "run the animation frame callbacks", so a rAF scheduled from inside a scroll
handler runs in that same pass, and Vue's own scheduler flushes on the microtask right after it —
i.e. still before that frame's style/layout/paint. The coalescing costs zero frames of latency and
must stay; `PERF.md:55-68` documents the same frame-cadence behaviour from the measurement side.
**The blank is not main-thread lag *within* a frame — it is that a composited scroll moves the
viewport without the main thread at all,** so any region with no DOM in it paints as the container's
background until the main thread catches up. Overscan is what buys the time; cheaper renders are
what shorten it.

**F11 — P24's display-position indirection sits between the page and the render, and the fix has to
respect it in three specific places.** `displayRows` / `displayRowCount` / `displayPositionOf` /
`rowAtDisplayPosition` (`DataGrid.vue:186-215`) mean that (a) `rowRange` is already in
display-position space (`:291-302`), (b) `visibleRows` emits `{ row, pos }` pairs where `row` is the
**page row index** that selection, the gutter number, pending changes and search matches all address
(`:1121-1132`, `:1146`), and (c) `visiblePageRowBounds` (`:315-328`) hands `setVisibleWindow` the
min/max page row of a possibly **non-contiguous** slice, which P24's F3 established is sound because
that call is a cache hint, not a correctness contract. Columns are never filtered, so the column
axis is untouched by all of it.

## 2. Shapes introduced in this plan

```ts
// src/renderer/views/grid/columns.ts — visibleColumnRange gains the buffer the row axis has had
// since P12. Pixels, not a column count: a column is 40–480 px wide (MIN_WIDTH at columns.ts:4,
// MAX_WIDTH at :5, and onResizeMove's own Math.max(40, …) at DataGrid.vue:422), so "N columns of
// overscan" is anywhere between 80 px and 5 760 px of actual buffer — the wrong unit for a
// distance the compositor measures in pixels.
export function visibleColumnRange(
  scrollLeft: number,
  viewportWidth: number,
  offsets: number[],
  /** Extra rendered width on each side. */
  overscanPx: number,
  /** Hard cap per side, so a table of 40 px columns can't multiply the DOM without bound. */
  maxOverscanColumns: number,
): ColumnRange;
```

```ts
// src/renderer/views/grid/DataGrid.vue — one buffer distance, both axes, replacing OVERSCAN_ROWS.
/** How far the compositor may outrun the main thread before a gap can show. 560 px = the row
 *  axis's existing 20 rows × 28 px, now applied to the column axis too (F3). */
const OVERSCAN_PX = 560;
/** Per side. Bounds the DOM when columns are narrow enough that 560 px is a dozen of them. */
const MAX_OVERSCAN_COLUMNS = 12;
```

```ts
// src/renderer/views/grid/DataGrid.vue — the visible window as four *numbers*, so a scroll that
// doesn't cross a row/column boundary invalidates nothing downstream (F4). The object-returning
// computeds stay as the (cheap) source; only the numbers are consumed.
const rowStart = computed(() => rowRange.value.start);
const rowEnd = computed(() => rowRange.value.end);
const colStart = computed(() => colRange.value.startIndex);
const colEnd = computed(() => colRange.value.endIndex);
```

```ts
// src/renderer/views/grid/DataGrid.vue — every rendered cell's state, computed exactly once per
// render instead of the 7–11 function calls per cell the template makes today (F5/F6).
interface CellVM {
  col: number;                        // display column index — what selection/copy address
  name: string;                       // column name — the v-for :key, unchanged
  left: number;
  width: number;
  text: string;
  isNull: boolean;
  truncated: boolean;
  staged: boolean;
  editing: boolean;
  navKind: 'fk' | 'pk' | null;
  classes: Record<string, boolean>;   // cellClass(...) — same call, once
}

interface RowVM {
  /** The page row index (P24 D3/D4): gutter number, selection, pending changes, search matches. */
  row: number;
  /** The display position: pixel placement only. Identical to `row` when nothing is filtered. */
  pos: number;
  gutterNumber: number;
  dirty: boolean;
  deleted: boolean;
  cells: CellVM[];
}

const renderRows = computed<RowVM[]>(/* … */);
```

```ts
// src/renderer/views/grid/DataGrid.vue — the cheap precheck that makes cellNavEntry affordable.
// Exactly the two predicates gridMenu.ts already applies (foreignKeyNavItems filters on
// `fk.columns.includes(columnName)`, gridMenu.ts:104-106; referencedByItems requires
// `meta.primaryKey.includes(columnName)` and a non-empty referencedBy, gridMenu.ts:118) — so a
// column outside both sets provably yields no items, with no snapshot built.
const navColumns = computed<{
  fk: Set<string>;       // every name in meta.foreignKeys[].columns
  pk: Set<string>;       // meta.primaryKey, when meta.referencedBy is non-empty
  valueNames: string[];  // the union of `columns` over BOTH edge lists — the only names
                         // foreignKeyValueFilter ever reads out of `rowValues` (gridMenu.ts:50-59)
}>;

/** `rowSnapshot(row)` narrowed to `navColumns.valueNames`, memoised per row for one render. */
function navValuesFor(row: number): Record<string, string | null>;
```

```ts
// src/renderer/views/grid/page.ts — same signature, same contract, two changes inside:
// the cache is keyed row -> col -> text (no per-read string allocation), and a window move
// *evicts the rows that left it* instead of clearing everything (F7).
export function setVisibleWindow(tabId: string, startRow: number, endRow: number): void;
```

```css
/* src/renderer/views/grid/DataGrid.vue — scopes a row's layout invalidation to the row (F9). */
.grid-row { contain: layout; }
```

```ts
// tests/ui/support/measure.ts — one axis parameter, not a second function: budgets.spec.ts's two
// scroll measurements must be produced by identical instrumentation to be comparable (the file's
// own header rule).
export function measureScrollResponses(
  page: Page,
  gridSelector: string,
  steps: number,
  axis?: 'vertical' | 'horizontal',   // default 'vertical' — the existing call site is unchanged
): Promise<number[]>;
```

```ts
// tests/ui/support/pg.ts — a wide AND tall fixture, created by the UI suite against its own
// container. tests/db/fixtures/0001_seed.sql is NOT touched (D14).
/** `app.scroll_grid`: 60 text columns × 5 000 rows, one integer primary key, no foreign keys. */
export function seedScrollFixture(uri: string): Promise<void>;
```

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **"Cell view" is the data grid.** The plan fixes `DataGrid.vue`; the cell editor panel is investigated, cleared, and recorded as cleared. | F1: `EditorView.lineWrapping` is in every CodeMirror host's base extensions (`CodeMirrorHost.vue:137`), so the cell editor has no horizontal scroll to be "worse" at, and its document is capped at 64 KB. The grid is the only two-axis virtualized surface in the app (F2). Building this phase around the editor would be building it around a surface that cannot produce the reported symptom. §9's first question puts the conclusion in front of the user rather than burying it. |
| D2 | **The column axis gets the same overscan the row axis has, expressed in pixels for both: one `OVERSCAN_PX = 560`, from which the row count and the column range are derived.** `OVERSCAN_ROWS` is deleted. | F3 is the asymmetry, stated in code. Pixels rather than a column count because a column is 40–480 px wide (`columns.ts:4-5`, `DataGrid.vue:422`) — "4 columns of overscan" is between 160 px and 1 920 px of buffer depending on the table, which is not a decision anyone can reason about. The same substitution fixes a silent bug on the row axis: at compact density (22 px, `DataGrid.vue:54`) today's 20 rows is 440 px, at comfortable it is 560 px, so **changing row density silently changes how fast you have to fling before the grid blanks**. 560 px is chosen as *exactly* today's comfortable-density buffer, so the default configuration's vertical behaviour is unchanged by construction and the phase's measured deltas are attributable to the other changes. |
| D3 | **`MAX_OVERSCAN_COLUMNS = 12` per side.** | 560 px of buffer is ≤ 9 columns at `MIN_WIDTH` (64 px) but up to 14 at the 40 px floor a user can drag a column to. The cap bounds the worst case at 61 rendered rows × (visible + 24) cells; without it a table of hand-narrowed columns could triple the DOM against §2.2. It is a ceiling, not a target — on every realistic table the pixel budget binds first and the cap never engages. |
| D4 | **The visible window is consumed as four numbers (`rowStart`/`rowEnd`/`colStart`/`colEnd`), not as two objects.** `rowRange`/`colRange` keep their shape and stay the source. | F4: a computed returning an object literal invalidates its dependents on every recompute, so today a 1 px scroll re-renders every visible cell to produce byte-identical DOM. Deriving primitives means Vue's own `hasChanged` check does the work — no memo helper, no manual comparison, four lines. This is the cheapest item in the phase and the one with the largest effect on *slow* scrolling, which is most of scrolling. |
| D5 | **Each rendered cell's state is computed once, into a `RowVM`/`CellVM` structure, and the template only reads fields.** | F5/F6: the template calls `displayCell` 5–6× and `cellNavEntry` 2–5× per cell today, and Vue's render function re-runs all of it on every invalidation. A view model is the ordinary fix and it is *also* what makes the per-cell cost auditable: after this, "what does one cell cost per frame" has a single answer in a single function instead of eleven call sites in a template. It changes no rendered attribute, no class name and no `data-testid` — every existing assertion in `data-view.spec.ts`, `mutations.spec.ts` and `interaction.spec.ts` is a regression guard for it, unchanged (D15). |
| D6 | **`cellNavEntry` is gated on a per-column precheck (`navColumns`) and reads a *narrow*, per-row-memoised value map instead of a whole-row snapshot.** The click path (`onCellNavClick`) calls the same function; `rowSnapshot` stays exactly as it is for the right-click menus. | F5. The precheck is not a heuristic: `foreignKeyNavItems` filters on `fk.columns.includes(columnName)` (`gridMenu.ts:104-106`) and `referencedByItems` requires `meta.primaryKey.includes(columnName)` with a non-empty `referencedBy` (`gridMenu.ts:118`), so a column in neither set provably produces zero items. The narrow value map is exact for the same reason: `foreignKeyValueFilter` only ever reads `rowValues[columns[i]]` (`gridMenu.ts:50-59`), and `navigateForeignKey` reads the same names — so collecting `columns` over both edge lists is a superset of what is read and a subset of what `rowSnapshot` builds. Existence and click can therefore not disagree, which is the property P7 D3 was written to protect (*"the button and the menu share one function"*). On a table with no FK and no inbound reference — the common case, and the fixture D14 seeds — this reduces the per-cell nav cost from `2 × columnCount` decodes to two `Set.has` calls. |
| D7 | **The decode cache is keyed `row -> col -> text` and a window move evicts only the rows that left the window.** `setVisibleWindow`'s signature and its "hint, not a contract" status are unchanged. | F7: clearing on every row boundary means a fling re-decodes the entire visible window every step, and the window it is handed already includes the overscan on both sides — the entries thrown away are the ones about to be asked for. The nested-map keying removes the `` `${row}:${col}` `` allocation from `cell()` (`page.ts:86`) at the same time, which is the only string allocated on the per-cell read path. It also keeps P24 F3's reasoning intact verbatim: while filtering, `[start, end)` is a *superset* of the rendered rows, so pruning by it can only retain more than needed, never evict something on screen. |
| D8 | **`.grid-row { contain: layout }` — and nothing else.** No `contain: paint`, no `content-visibility`, no `will-change`. | F9. `layout` scopes a row's layout invalidation without changing any of the semantics the row's contents depend on. `paint` is deliberately excluded: `.grid-cell` already clips its own overflow (`:1429`) so there is nothing to gain, while paint containment changes clipping and containing-block behaviour that the sticky gutter cell (`:1371-1387`) and the absolutely positioned `.cell-nav-btn` (`:1490-1507`) both sit inside. `will-change: transform` on `.grid-sizer` is rejected outright: the sizer is up to ~280 000 px tall on a 10 000-row page (`budgets.spec.ts:208-210`), and promoting it to its own layer trades §2.1 for §2.2 in exactly the way P12's memory findings warn about. This item is measured like any other — if it moves no number in §5's runs it is reverted, and §5 says so. |
| D9 | **The rAF coalescing in `onScroll` stays exactly as it is.** | F10. It costs zero frames (the scroll steps precede the animation-frame callbacks in the same "update the rendering" pass, and Vue flushes on the following microtask), and removing it would let a fling's many `scroll` events each trigger a full render within one frame — strictly more of the work this phase exists to remove. Recorded as a decision because "recompute the window synchronously in the scroll handler instead of a rAF" is the obvious-looking fix and it is the wrong one. |
| D10 | **The gap is bounded, not abolished, and the plan says which mechanism covers which case.** A *continuous* fling is covered by overscan (D2/D3): the compositor must outrun the main thread by more than 560 px before anything can blank. A *discontinuous* jump (dragging the scrollbar thumb, `Page Down`, a search hit far away) can exceed any finite buffer and is covered by making a single render cheap enough to land in the next frame (D4/D5/D6/D7). | Honesty about what a DOM-based virtualized grid can promise. A composited scroll will always be able to move the viewport without the main thread; the only way to make the guarantee absolute is to paint the grid from the compositor's own data (canvas/WebGL), which §6 rules out. Stating the two mechanisms separately is also what makes §5's two measurements meaningful — one measures buffer, the other measures work. |
| D11 | **P24's display-position layer is preserved exactly, in three named places, and the plan names them rather than assuming a page-row → render identity.** (a) The row overscan stays applied in **display-position** space (`rowRange`, `:291-302`), so filtered-out rows are still never virtualized and `displayRows === null` still short-circuits to today's arithmetic. (b) `RowVM` carries `row` (page row index) and `pos` (display position) as two separate fields, with `row` feeding the gutter number, `:data-row`, selection, pending changes and search matches, and `pos` feeding **only** the `top` style — P24 D3/D4 unchanged. (c) `visiblePageRowBounds` keeps handing `setVisibleWindow` the min/max page row of a possibly non-contiguous slice, which D7's pruning treats as a superset. Column overscan is orthogonal: columns are never filtered. | The task's third required decision. The indirection is the layer most likely to be quietly broken by a render refactor — collapse `row` and `pos` into one field and a filtered grid silently renumbers its gutter (P24 D4's explicit failure mode) or stages an edit against the wrong row. Naming the three sites means the implementing session checks them rather than discovering them. `displayPositionOf`'s binary search (`:198-211`) stays on the pending-insert path only (`:1223`), where it runs once per staged insert row, not per cell. |
| D12 | **`VirtualList.vue`'s `overscan: 8` default is not touched.** | It is a different surface (`VirtualList.vue:5-6`), a different component, and single-axis — the tree, the operations panel and the console result grid cannot produce the reported symptom, and no one has reported it there. §9's fifth question offers it as a follow-up rather than smuggling it into a grid phase. Changing it here would also perturb `tree.spec.ts`'s and `perf.spec.ts`'s DOM-count expectations for no reported reason. |
| D13 | **The horizontal scroll response is measured with the *same* helper as the vertical one, via an `axis` parameter — not a second function.** `measure.ts`'s own header states why: *"budgets.spec.ts, memory.spec.ts, and startup.spec.ts all import from here so their numbers are produced by identical instrumentation and are therefore comparable"*. The default keeps the existing call site untouched. | Two measurement functions would be two methodologies within a month. The horizontal number is gated the same way the vertical one is — p50 ≤ 8 ms with a `max ≤ 50 ms` sanity bound, p95 logged, per `PERF.md:55-68` — because the frame-cadence artifact that forced p50 gating applies identically to a `scrollLeft` write. |
| D14 | **The wide-and-tall fixture (`app.scroll_grid`, 60 columns × 5 000 rows) is created by `tests/ui/support/pg.ts`, from the spec's `beforeAll`, against the UI suite's own container. `tests/db/fixtures/0001_seed.sql` is not edited.** | F8: neither existing fixture can show the defect — `big_rows` is 2 columns, `wide_table` is 60 columns × **2 rows** (`0001_seed.sql:93-97`), so neither produces the "many rendered rows × many columns" shape F5's cost depends on. Editing the shared seed would change row counts and unordered-`SELECT` ordering that `tests/db/*.spec.ts`, `data-view.spec.ts`, `cell-editor.spec.ts` and `definition.spec.ts` all assert against — the exact blast radius this phase's "tests/db untouched" constraint exists to avoid. Creating it from the UI suite is safe by construction: `playwright.config.ts:6-7` runs `workers: 1, fullyParallel: false`, and `tests/db/support/postgres.ts:91-97`'s `stop()` resets the module memo, so each UI spec file gets its **own** container — a table created in `budgets.spec.ts` cannot be seen by `tree.spec.ts`. |
| D15 | **No `data-testid`, class name, DOM attribute or rendered text changes anywhere in this phase.** | It is what makes the existing suite the regression guard for D5's refactor: `data-view.spec.ts`, `mutations.spec.ts`, `interaction.spec.ts` (the whole PK/FK nav block at `:759-800`), `tabs.spec.ts` and `leaks.spec.ts` all locate grid rows and cells by `data-testid` and `data-row`/`data-column`, so "the view model renders what the template rendered" is asserted a few hundred times without writing a line. A perf phase that also renames things cannot prove it changed nothing. |
| D16 | **`docs/v1/PERF.md` gains a horizontal-scroll row in §1's budget table and before/after numbers in §2.1; SPEC.md's §2.1 budget table is *not* edited.** | PERF.md is explicitly *"expected to be re-measured, not rewritten"* (`PERF.md:5-9`) and is where a new measured metric belongs. SPEC's §2.1 table names one *"Grid scroll frame"* budget for the interaction as a whole; the horizontal number is a second measurement of that same budget, not a new promise to the user. §9's third question offers the alternative if the user wants the budget table itself amended. |
| D17 | **SPEC.md is edited by the implementing session, not by this plan**: §8.5's grid sentence (`SPEC.md:381`) gains that both axes are overscanned, and §10's P29 row gains its implementation record **only once the phase is implemented**. | Standing practice (P24 D41, P23 D12, P22 D11): the phasing table is a record of what shipped, and a row that describes work as done before it is done would be the first one in that table that lies. |

## 4. Implementation order

Each step is one commit and must leave `bun run lint`, `bun run typecheck` (all three) and
`bun run build` green. Steps 1–6 are the fix, 7 the coverage, 8 the docs.

**Before step 1**, run the new horizontal measurement (step 7's instrumentation) against the
**unmodified** build and keep the numbers — PERF.md's §2 records before/after pairs for a fired
lever (`PERF.md:136-143` is the precedent, from P12's L-A), and this phase's whole claim is that
these numbers move. Do not commit the spec at this point; just record the run.

1. **`perf(grid): invalidate the visible window only when it actually moves`** — D4.
   `rowStart`/`rowEnd`/`colStart`/`colEnd` derived from the existing `rowRange`/`colRange`;
   `visibleRows` and `visibleColumnIndices` consume the numbers. No behaviour change, no template
   change, four lines plus two edits. Independently verifiable: a 1 px scroll must now produce no
   DOM mutation at all (assertable by hand with a `MutationObserver` in devtools before the
   spec exists).
2. **`perf(grid): give the column axis the same overscan as the row axis`** — D2/D3.
   `OVERSCAN_PX`/`MAX_OVERSCAN_COLUMNS` replace `OVERSCAN_ROWS`; `visibleColumnRange` grows its two
   parameters (`columns.ts`); `rowRange` derives its row count from the pixel budget. This is the
   commit that closes the reported gap on a continuous fling and is worth verifying by hand
   (§8's manual item) before continuing.
3. **`perf(grid): build each visible cell's state once per render`** — D5. `renderRows`, `RowVM`,
   `CellVM`; the template's `v-for` bodies become field reads. `displayCell`, `cellClass`,
   `isSelected`, `isSearchMatch`, `isCurrentSearchMatch`, `alignFor`, `isForeignKeyDisplayCol` and
   `isEditing` keep their signatures and are called from the computed instead of the template. D11's
   `row`/`pos` split is preserved literally. Run `xvfb-run -a bun run test:ui` here even though the
   new specs don't exist yet — this is the commit the existing suite is guarding (D15).
4. **`perf(grid): stop rebuilding a row snapshot for every cell's nav affordance`** — D6.
   `navColumns`, `navValuesFor`, `cellNavEntry` reading the narrow map; `rowSnapshot` unchanged and
   still used by `rowMenu`/`cellMenu`/row copy. `interaction.spec.ts:759-800` is the guard.
5. **`perf(grid): prune the decoded-cell cache instead of clearing it`** — D7. `page.ts` only:
   nested `Map<number, Map<number, string>>`, eviction by row range, no signature change.
   `leaks.spec.ts`'s retained-bytes symmetry and `perf.spec.ts`'s L2 assertions are the guards.
6. **`perf(grid): scope row layout invalidation`** — D8. One CSS line. If step 7's numbers show no
   change attributable to it, revert it in the same review rather than keeping an unjustified
   property (and say so in PERF.md).
7. **`test(ui): measure horizontal scroll response and assert the rendered window covers the
   viewport`** — §5. `measure.ts`'s `axis` parameter, `support/pg.ts`'s `seedScrollFixture`,
   `budgets.spec.ts`'s new block. `xvfb-run -a bun run test:ui` green.
8. **`docs: record P29's scroll measurements`** — D16/D17. `PERF.md` §1's new row and §2.1's
   before/after table; `SPEC.md` §8.5's sentence and §10's P29 implementation record; this plan's
   own commit if it is not already landed.

## 5. Tests

`tests/db/` is untouched — no adapter, engine, protocol, SQL or fixture change exists in this phase
(D14).

### Existing specs that must change

| Spec | Why | Change |
|---|---|---|
| `tests/ui/support/measure.ts:155-195` | D13 adds the horizontal axis to the shared helper. | One optional `axis` parameter; `scrollTop`/`scrollHeight`/`clientHeight` become `scrollLeft`/`scrollWidth`/`clientWidth` when it is `'horizontal'`. The existing call at `budgets.spec.ts:211` passes nothing and is unchanged. The doc comment's explanation of why the clock starts at the trigger rather than the `scroll` event applies verbatim to both axes and is extended by one sentence, not rewritten. |
| `tests/ui/support/pg.ts` | D14 needs a wide-and-tall fixture the shared seed does not provide. | Gains `seedScrollFixture(uri)`; the file stops being a pure re-export and grows one function plus its `pg` import. Nothing under `tests/db/` is imported into it beyond the two re-exports already there. |
| `tests/ui/budgets.spec.ts:33-34, 199-228` | The new measurements and fixture. | `beforeAll` calls `seedScrollFixture(pg.uri)`; a `SCROLL_GRID_PATH` constant joins the two existing ones; the scroll block gains the horizontal measurement and the coverage assertions below. The existing vertical measurement against `big_rows` is **unchanged** — it is the comparability baseline for every prior run in `PERF.md`. |
| `tests/ui/perf.spec.ts:191` | D2/D3 raise the rendered cell count on wide tables. | **No change.** The `< 1500` bound is measured on `big_rows` (2 columns), where 61 rendered rows × 2 columns is ~122 either way. Re-run and shown green rather than assumed — the tripwire's purpose (*"catches 'someone made the grid re-render every row per frame'"*) is exactly what this phase must not break. |
| `tests/ui/cell-editor.spec.ts:104-129` | `scrollColumnIntoView`'s 100 ms per-step settle exists because a 60-column horizontal step was slow (F8). | **No change to the assertions.** The waits stay — a faster grid does not make a fixed wait wrong. The comment gains one sentence pointing at this phase, so the next reader knows the wait is now conservative rather than load-bearing. Lowering it is deliberately left out (§6). |
| `tests/ui/data-view.spec.ts`, `mutations.spec.ts`, `interaction.spec.ts`, `tabs.spec.ts`, `leaks.spec.ts` | D5/D6 refactor how the grid renders. | **No change** — they are the regression guard (D15). All must be run and shown green, not assumed. |

### New coverage — `tests/ui/budgets.spec.ts`, in the existing scroll block

Against a `app.scroll_grid` tab (60 columns × 5 000 rows, seeded by D14), on the same container and
the same connection the file already opens — no new fixture process, no new spec file.

- **Horizontal scroll response** (D13): `measureScrollResponses(page, '[data-testid="data-grid"]',
  20, 'horizontal')`; `logStats('scroll response (horizontal)', …)`; assert
  `percentile(deltas, 50) <= 8` and `Math.max(...deltas) <= 50`, mirroring the vertical block's two
  assertions and its comment about why p95 is logged and not gated.
- **Vertical scroll response on a wide table** (F8's real gap): the same measurement on
  `scroll_grid`'s vertical axis, gated identically. This is the number that F5's cost actually
  moves, and the one no existing measurement could produce.
- **The rendered column window covers the viewport plus the overscan** — the deterministic guard,
  no timing involved. After each of ~10 `scrollLeft` positions across the table's width, read the
  rendered `[data-testid="grid-header-cell"]` set's leftmost and rightmost `offsetLeft`/`offsetLeft +
  offsetWidth` and assert they extend at least `OVERSCAN_PX` beyond `scrollLeft` and `scrollLeft +
  clientWidth` respectively, clamped at the table's own edges. **This is the assertion that fails
  against today's code and passes after step 2**, and it cannot flake on frame scheduling because it
  is read after the scroll has settled.
- **The same invariant on the row axis**, so the two axes are provably symmetric rather than
  incidentally similar: rendered `[data-testid="grid-row"]` `top` values must span at least
  `OVERSCAN_PX` beyond both viewport edges.
- **The DOM stays bounded** (D3): across every position above, `[data-testid="grid-cell"]` count
  stays under 2 500 — the wide-table sibling of `perf.spec.ts:191`'s bound, sized for 61 rows ×
  (visible + 2 × `MAX_OVERSCAN_COLUMNS`) with headroom, and the assertion that stops a future
  "just raise the overscan" from being free.
- **A sub-row scroll mutates nothing** (D4): attach a `MutationObserver` to the grid, write
  `scrollTop += 4` (well under a 28 px row), wait two frames, assert zero mutation records; then
  write `scrollTop += rowHeight` and assert mutations do arrive. This is the direct assertion of
  step 1 and is independent of every other change in the phase.

### What is deliberately not asserted

- **No frame-rate or "no blank pixel" assertion.** Chromium's compositor can always outrun the main
  thread (F10/D10); an assertion phrased as "nothing was ever blank" would be asserting the
  scheduler, not the app. The coverage invariant above is the testable form of the same claim.
- **No unit test for `visibleColumnRange`.** The repo has exactly two harnesses — `bun test
  tests/db` (testcontainers) and Playwright (`package.json:20-26`) — and neither runs renderer
  modules in isolation. Introducing a third harness for one pure function is a bigger change than
  the function; the DOM invariant asserts the same property end to end.

## 6. Explicitly out of scope

- **The cell editor's own scrolling.** D1/F1 establish it cannot produce the reported horizontal
  symptom. If §9's first question comes back "I meant the editor", the follow-up is small and
  separate: CodeMirror's viewport margin (`EditorView`'s own `scrollMargins`/viewport handling) on a
  64 KB single-line document, plus whether `EditorView.lineWrapping` should stay on for the raw pane
  at all. It is not folded in here on the strength of a guess.
- **`VirtualList.vue`'s overscan** (D12), and with it the tree, the operations panel, the document,
  key/value and stream views, and the console result grid.
- **Making `pendingChanges.pendingState` non-reactive on the read path.** F6 is real and §2.1's
  no-reactivity rule points at it, but after D5 the render path consults it ~600 times per render
  rather than ~77 000, which is not the problem this phase exists to solve. De-reactifying it would
  ripple into the toolbar's commit/discard buttons, the preview panel and `hasPending`'s watchers —
  a pending-changes phase, not a scrolling one.
- **Rendering the grid to a canvas, or `content-visibility: auto` on rows.** Both are real answers to
  D10's residual case and both replace the app's entire cell interaction model (selection, the inline
  editor, the nav button, tooltips, Playwright's `data-testid` addressing). Named so the next reader
  knows they were considered.
- **Lowering `cell-editor.spec.ts`'s 100 ms per-step settle** now that the step it waits on is
  faster. Tuning a wait that is not failing is how a suite becomes flaky; it can be revisited with
  measurements in hand.
- **Prefetching the *next page* on scroll.** SPEC's P29 row says "prefetch window", but the window
  in question is the render window: the grid never fetches on scroll — a page is fetched by the
  pager, and §2.2's per-tab page retention is P12/P13 settled work. No `data.read` call is added,
  moved or removed in this phase, and the operations log must be identical before and after.
- **Any change to `onScroll`'s rAF coalescing** (D9), to `scrollCellIntoView`'s immediate
  `syncScrollState` (`DataGrid.vue:944-946`), or to the 300 ms scroll-position persistence
  (`:337-343`).
- **SPEC §2.1's budget table** (D16) and any token, theme or layout change beyond D8's one CSS line.

## 7. Target tree at the end of P29

```
src/renderer/
  views/grid/
    DataGrid.vue                  MOD  OVERSCAN_PX/MAX_OVERSCAN_COLUMNS replace OVERSCAN_ROWS (D2/D3);
                                       rowStart/rowEnd/colStart/colEnd (D4); renderRows/RowVM/CellVM
                                       (D5); navColumns/navValuesFor (D6); .grid-row contain (D8);
                                       row/pos split preserved verbatim (D11)
    columns.ts                    MOD  visibleColumnRange gains overscanPx + maxOverscanColumns (D2/D3)
    page.ts                       MOD  row->col decode cache; window move evicts, never clears (D7)
    gridMenu.ts                    --  UNCHANGED (D6 reuses its predicates, changes none of them)
    pendingChanges.ts              --  UNCHANGED (§6)
    state.ts / search.ts / DataView.vue / DataToolbar.vue / SearchToolbar.vue
                                   --  UNCHANGED
  workbench/VirtualList.vue        --  UNCHANGED (D12)
  editor/CodeMirrorHost.vue        --  UNCHANGED (D1)
  views/celleditor/                --  UNCHANGED (D1)
tests/ui/
  support/measure.ts              MOD  measureScrollResponses gains `axis` (D13)
  support/pg.ts                   MOD  seedScrollFixture — 60 columns x 5 000 rows (D14)
  budgets.spec.ts                 MOD  horizontal + wide-table measurements, window-coverage
                                       invariants, DOM bound, sub-row no-mutation (§5)
  perf.spec.ts                     --  UNCHANGED (re-run and shown green, §5)
  cell-editor.spec.ts             MOD  one comment sentence on the 100 ms settle (§5)
  data-view.spec.ts / mutations.spec.ts / interaction.spec.ts / tabs.spec.ts / leaks.spec.ts
                                   --  UNCHANGED (the regression guard, D15)
docs/
  v1/PERF.md                      MOD  §1 budget row + §2.1 before/after numbers (D16)
  v1/SPEC.md                      MOD  §8.5's grid sentence; §10's P29 row once implemented (D17)
  v1/plans/P29-scroll-render-gap.md   NEW  this document
```

## 8. Acceptance checklist

**The reported symptom**

- [ ] On `app.scroll_grid` (or any wide table), a fast horizontal trackpad fling shows **no blank
      band** at the leading edge — verified by hand, in the running app, not only in a spec.
- [ ] The same fling vertically is no worse than before.
- [ ] Dragging the horizontal scrollbar thumb from one end to the other lands on rendered content
      within a frame or two, with no sustained empty region.
- [ ] No spinner, skeleton or placeholder was added anywhere (SPEC §10's P29 row).

**Measured**

- [ ] `budgets.spec.ts`'s horizontal scroll response: p50 ≤ 8 ms, max ≤ 50 ms, p95 logged.
- [ ] `budgets.spec.ts`'s wide-table vertical scroll response: same gates.
- [ ] The original `big_rows` vertical measurement is unchanged in shape and still passes, so the
      numbers stay comparable with every run already recorded in `PERF.md`.
- [ ] `PERF.md` §2.1 carries a before/after pair for both new metrics, with the machine and date,
      in the format the existing rows use.
- [ ] `perf.spec.ts`'s rAF tripwire and its `< 1500` DOM-cell bound both pass, re-run rather than
      assumed.
- [ ] If D8's `contain: layout` moved no number, it was reverted and `PERF.md` says so.

**Correctness**

- [ ] The rendered column window extends ≥ `OVERSCAN_PX` past both viewport edges at every scroll
      position, clamped at the table's edges — and so does the row window.
- [ ] Scrolling by less than one row height produces **zero** DOM mutations.
- [ ] With the search filter on (P24), the gutter still shows real row numbers (`3, 17, 84, …`), the
      selection still addresses page rows, a staged insert still renders after the last visible row,
      and `displayRows === null` still short-circuits on the unfiltered path.
- [ ] The PK/FK nav button appears on exactly the cells it appeared on before — including the
      NULL-`manager_id` case that must show none (`interaction.spec.ts:789-800`) — and clicking it
      opens the same pre-filtered tab.
- [ ] A staged edit still tints its cell, a pending delete still strikes its row, search matches
      still highlight, and the current match still scrolls into view.
- [ ] The whole scroll sequence adds **zero** rows to the operations panel (no page is fetched by
      scrolling, before or after).
- [ ] `bun run lint`, `bun run typecheck` (all three) and `bun run build` clean;
      `xvfb-run -a bun run test:ui` green.

## 9. Open questions for the user

1. **"Cell view" — the data grid, or the cell editor panel?** The plan reads it as the grid, and
   the evidence is strong rather than a coin flip: every CodeMirror host in the app runs with
   `EditorView.lineWrapping` (`CodeMirrorHost.vue:137`), so the cell editor has no horizontal scroll
   at all and cannot be "worse horizontally", while the grid is the only surface in the app
   virtualized on two axes. If you were in fact describing the editor panel scrolling a large value
   vertically, say so — it is a different, smaller fix (§6 names it) and this plan should not be
   implemented as-is.
2. **Is 560 px per side the right buffer, and should it stay fixed?** D2 picks it to match today's
   comfortable-density row buffer exactly, so the vertical behaviour is provably unchanged. A larger
   buffer hides faster flings at the cost of DOM (D3's cap exists for that reason); a
   velocity-adaptive buffer — grow it while the scroll offset is moving fast, shrink it when it
   settles — is the next step up and is genuinely better on paper, but it is state on the scroll path
   and a new class of bug (a buffer that never shrinks). Not proposed; happy to if you want it.
3. **Should SPEC §2.1's budget table gain a horizontal row?** D16 keeps the new number in
   `PERF.md` on the grounds that §2.1 states one *"Grid scroll frame"* budget and this is a second
   measurement of it, not a second promise. If you would rather the spec name both axes explicitly,
   it is a one-row edit in the implementing session's SPEC commit.
4. **Compact row density will get a slightly larger buffer than it has today** (560 px instead of
   440 px, i.e. 26 rows instead of 20), because D2 makes the buffer a distance rather than a row
   count. That is the point — density should not change how fast you can fling before the grid
   blanks — but it does mean ~30% more rendered rows in compact mode. Fine, or should compact keep
   its current 20 rows?
5. **The tree, operations panel, document, key/value and stream views all virtualize through
   `VirtualList.vue` with an overscan of 8 rows** (`VirtualList.vue:5-6`) — the same class of buffer,
   about a third the size, on surfaces nobody has complained about. D12 leaves them alone. Worth a
   one-line follow-up in P31's batch, or leave them until someone notices?
