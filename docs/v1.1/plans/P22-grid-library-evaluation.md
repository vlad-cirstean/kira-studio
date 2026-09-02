# P22 — grid library evaluation: is there a better foundation than the hand-rolled DataGrid?

> **The user's direction, verbatim**: *"What more modern libraries than SlickGrid are available with
> good support for Vue? Instead of hand-rolling fixes we should start from there. First let's decide
> what options would fit better and consider popularity and being supported as well."*
>
> **The verdict, in one line: no candidate clears the bar, and the reason is not that they are
> immature — it is that the one property worth switching for is a property this app's in-flight
> `GridRow`/`RowVM` work already has, while the two candidates that genuinely have it charge for it
> in exactly the features a database client cannot do without.**
>
> **The load-bearing correction first.** The premise this evaluation started from — *"the libraries
> worth taking seriously are ones that do genuine DOM node recycling/reuse, the same principle
> SlickGrid uses"* — is **wrong about SlickGrid**, and the correction reshapes the whole comparison.
> SlickGrid does not pool DOM nodes. `slick.grid.ts:6071-6079` removes a departing row with
> `node.parentElement?.removeChild(node)` and `:6840` skips an arriving index that is already in
> `rowsCache`; there is no pool, no slot table, no `row ≡ slot (mod N)`. What SlickGrid actually has
> is something narrower and more useful: **a retained row costs nothing at all** — no diff, no patch,
> no property write. Its per-frame cost is O(rows entered), not O(window). AG Grid's `rowRenderer.ts`
> has the identical shape (§3 F2). *That* is the property worth wanting, and naming it correctly
> matters, because §3 F7 shows this repo landed it three days ago in Vue.
>
> **What this document is.** Six real candidates, measured on 2026-09-02 against live npm/registry/
> CDN/GitHub data and against each library's own published source, priced against `docs/PERF.md`'s
> bundle discipline and against the actual feature surface of `views/grid/`. It is a comparison and a
> recommendation, not a migration plan; §7 sketches shape and risk only.
>
> **What it is not.** It is not a re-litigation of the memory half. `docs/WEBVIEW-SCROLL-MEMORY.md`
> and `P22-webview-scroll-performance-iter2-memory.md` concluded the ~1 GB CoreAnimation/IOSurface
> plateau is governed by WebKit's own compositor tile geometry and retention rules, essentially
> independent of what technique paints the content inside the scroller. **Every candidate below is
> expected to help that half by zero**, and none is credited for it. §6 D6 records this once and
> moves on.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

- Branch `claude/feature-v1-1-p5-onwards-2isfzt`, at `df381b9`, with `P22-webview-scroll-performance-
  iter2-rendering.md`'s C1–C5 present in the working tree (`GridRow.vue`, `rowVm.ts`,
  `scrollTrace.ts` new; `DataGrid.vue`, `columns.ts`, `main.ts` modified). This matters: §3 F7's
  central finding is a reading of that in-flight code.
- The grid under evaluation is `views/grid/DataGrid.vue` (2 229 lines) plus its module neighbourhood
  — `GridRow.vue` (335), `menu.ts` (425), `state.ts` (340), `pendingChanges.ts` (232),
  `DataToolbar.vue` (264), `FilterToolbar.vue` (200), `ColumnsMenu.vue` (198),
  `clipboardFormats.ts` (158), `PreviewCommandPanel.vue` (105), `rowVm.ts` (49), `page.ts` (42),
  `search.ts` (53), `sortTerms.ts` (23), `filterCompletion.ts` (74) — **and a second consumer**,
  `views/console/ConsoleResultGrid.vue` (703), which shares `views/shared/page/columns.ts`.
- The app bundle it would be priced against: **1 053 028 B raw / 333 298 B gzip**
  (`P13-query-console-format-button.md` §F2, re-confirmed in `P18-sql-language-server-explain.md`
  §443-445).
- Every external number below was read on **2026-09-02** from `registry.npmjs.org`,
  `api.npmjs.org/downloads`, GitHub's repository API, `bundlephobia.com/api/size`, and `gzip -9` over
  files fetched from `cdn.jsdelivr.net`. Every architectural claim is read from the library's own
  published source and cited by file and line.

### 0.2 Scope

1. Establish what property actually distinguishes a "fast" grid, by reading SlickGrid's and AG
   Grid's own source rather than their marketing (§2, §3 F1–F2).
2. Measure each candidate's real license, size, activity and adoption (§4, §5).
3. Read each candidate's *rendering* architecture from source and classify it against that property
   (§3).
4. Price feature parity against `views/grid/`'s actual surface, not against a generic grid checklist
   (§5.7).
5. Decide (§6).

### 0.3 Not in this phase

- **The memory plateau.** §6 D6, once, and closed.
- **A migration plan.** §7 is a shape-and-risk sketch. A real phased plan is a follow-up, and only
  if §6's recommendation is overruled.
- **Re-opening `@tanstack/vue-virtual` itself.** It is windowing math and it is not the cost —
  `WEBVIEW-SCROLL-MEMORY.md` §5.6 A/B'd a hand-rolled virtualizer against it on real hardware and
  found no difference. Nothing here proposes replacing it.
- **Canvas-rendered grids as a category.** Evaluated and declined in §5.6 — the only mature one is
  React-only and effectively frozen.

### 0.4 Ground rules

- **Read the source, not the landing page.** Every candidate in this space claims "renders 1M+ rows"
  and "incredible performance". Those claims are all true and all irrelevant: this app already only
  renders the visible window plus overscan, so *how many rows the library can hold* is not the
  question. The question is *what a retained row costs per frame*, and only source answers it.
- **Price against the app's own precedents, not against a feeling.** `sql-formatter` was accepted at
  38 036 B gzip because it is lazy-loaded behind a button (P13 D2). `node-sql-parser` was declined at
  237 008 B gzip — **even lazily loadable** — because it was 71 % of the whole bundle (P18 §448).
  The grid is not lazy-loadable behind anything: a `data` tab is what session restore reopens.
- **A decline is a legitimate outcome and must be argued as hard as an adoption.** This document
  reaches one. §6 D1's reasoning has to survive the reader asking "you just didn't want to do the
  work" — which is why §3 F7 is stated as a measured property of the current tree and not as a
  preference.

---

## 1. What the app actually needs a grid to do

Not a generic feature list — the specific surface `views/grid/` has, and what each item costs to
re-home. This is the parity yardstick §5.7 scores against.

| # | Capability | Where it lives today | Why it is not generic |
|---|---|---|---|
| 1 | **Virtualization on both axes** | `DataGrid.vue:375` (rows), `columns.ts:102-134` `columnRangeExtractor` (columns, pixel-budgeted, `MAX_OVERSCAN_COLUMNS = 12`/side) | Tables can be very wide — `scroll_grid` is 61 columns. Column virtualization is not optional here. |
| 2 | **Inline cell editing into a staged mutation set** | `pendingChanges.ts` (232 lines) + the cell editor panel each view mounts itself | `docs/ARCHITECTURE.md` "UI architecture": SQL table writes accumulate per-tab and reach the DB only on *Commit*, with *Preview command* rendering exact statements first. Not a generic editor with a value setter. |
| 3 | **Cell context menu, header context menu, row context menu** | `menu.ts` (425 lines) — plus FK navigation and *referenced by* items derived from live PK/FK metadata | Three distinct menus, data-driven from adapter metadata. This is the primary interaction surface of a DB client. |
| 4 | **Multi-cell range selection + typed clipboard export** | `clipboardFormats.ts` (158) + the range-drag interaction in `DataGrid.vue` (`extendFromPoint`, `:838-846`) | Copying a rectangle of cells as TSV/CSV/SQL is table-stakes for this product. |
| 5 | **Type-based cell coloring** | `theme/icons.ts` `typeClassColor` → `CellVM.color` (`rowVm.ts:26-30`) | A user-configurable setting (P9), and the `''` sentinel encodes a real priority rule: a data-type colour must never override NULL / FK / staged-edit / current-search-match colouring. |
| 6 | **Search match + current-match highlighting** | `views/shared/page/search.ts` `createPageSearch` / `runChunkedScan`, shared with three other views | Shared machinery, not grid-local (`ARCHITECTURE.md` "Find/search and chunked scanning are shared machinery"). |
| 7 | **Column header tooltips, FK/PK nav glyphs** | `columns.ts` `columnHeaderTooltip`, `CodiconIcon` gated on `cellVm.navKind` | |
| 8 | **Exact dark-theme match** | Tailwind v4 CSS-first tokens mirroring VS Code Dark Modern (`ARCHITECTURE.md` Stack) | Not a pre-built grid theme. The grid must look like the rest of the workbench, not like a themed grid dropped into it. |
| 9 | **Decode-on-entry with window-pruned retention** | `page.ts:31-40` + `store.ts:166-178` `setVisibleWindow` | P5 C1. Row data is never decoded eagerly and the decode cache is pinned to the mounted window; `PERF.md`'s retained-bytes check gates it. A library that wants an array of plain row objects up front breaks this. |
| 10 | **No Vue reactivity on row data** | `ARCHITECTURE.md` Invariants; `getPage()`/`cell()` read frozen typed structures imperatively behind an explicit `pageVersion` counter | A hard invariant. Any library whose data source is a reactive array is a direct violation. |
| 11 | **Second consumer** | `ConsoleResultGrid.vue` (703 lines), sharing `columns.ts` | Whatever replaces the grid has to be worth adopting twice, or the app carries two rendering models. |
| 12 | EXPLAIN auto-warning strip (P18), fake-data generator (P15) | `ViewChrome` `#badges`, `fakeData/` calling `data.mutate` | **Neither is grid-internal.** Both cost zero in a migration. Recorded so they are not double-counted as parity risk. |

---

## 2. The property that actually matters, named correctly

The rendering investigation (`P22-webview-scroll-performance-iter2-rendering.md` §1.3) itemised what
one scroll-triggered window update cost before this week's fixes, for a 43-row × ~9-column window:

| per notify | count |
|---|---|
| `CellVM` objects + their `classes` records | 387 + 387 |
| `RowVM` objects | 43 |
| vnodes created | ~900 |
| `normalizeClass` calls | 387 |
| `patchStyle` property writes | ~1 550 |
| `data-*` / `class` prop comparisons | ~2 700 |

Every one of those is paid for **all 43 rows**, while at a realistic velocity only three or four rows
are actually new. The complaint is not "too many rows are rendered" — it is **O(window) where
O(rows entered) would do**.

So the question to put to every candidate is exactly one question:

> *When the window slides by four rows, what does the library do to the thirty-nine rows that did not
> change?*

There are exactly three possible answers, and they are the classification used throughout §3:

- **(A) Nothing at all.** The retained row's DOM is not visited. Cost O(entered). — SlickGrid,
  AG Grid.
- **(B) Reconciler bail-out.** The retained row's subtree is *reached* by a reconciler but skipped on
  a cheap identity check before any child work. Cost O(entered) + O(window) reference comparisons. —
  Vue with a per-row child component and reference-stable props; i.e. **this app, as of the in-flight
  `GridRow.vue`**.
- **(C) Full rebuild + diff.** A fresh view-model and a fresh node description are allocated for
  every visible cell every frame, and a reconciler diffs the lot. Cost O(window). — RevoGrid,
  vxe-table, TanStack Table + Vue, and this app *before* the in-flight work.

(A) and (B) are the same complexity class. The constant differs — (B) still pays one reference
comparison and one vnode per retained row — but the ~800 allocations and ~4 250 property
comparisons per frame that §2's table counts are gone in both. **Only the (C)→(A/B) move is worth a
foundation change; an (A) vs (B) move is not.**

---

## 3. Findings — what each library's source actually does

### F1 — SlickGrid does not pool DOM nodes. It skips retained rows entirely. **Category (A).**

Read from `6pac/SlickGrid@master`, `src/slick.grid.ts` (9 456 lines):

- `renderRows` (`:6840`) — `if (this.rowsCache[i] || …) { continue; }`. An index already in the cache
  is **not re-rendered**, not re-described, not touched.
- `removeRowFromCache` (`:6071-6079`) —
  `cacheEntry.rowNode?.forEach((node) => node.parentElement?.removeChild(node)); delete this.rowsCache[row];`
  A departing row's elements are **removed from the document and dropped**. There is no free list and
  nothing is retained for reuse.
- `cleanUpAndRenderCells` (`:6708-6760`) — per row in range, `cleanUpCells` removes out-of-range
  cells, then the column loop hits `// Already rendered.` → `continue` for any cell whose colspan is
  already recorded in `cacheEntry.cellColSpans[i]`. Only *missing* cells are built.
- New rows are built by `appendRowHtml` (`:5678`) into an HTML string appended in one shot.

**So the "SlickGrid principle" is not recycling.** It is *absence of reconciliation*: SlickGrid has
no diff pass because it has no declarative description to diff against. That is a real and valuable
property — and it is a property about retained rows, not about node identity.

This also corrects the framing in the request that opened this evaluation, and it matters, because
"does it pool DOM nodes?" turns out to be a question **no candidate in this space answers yes to**.
Asked that way the survey returns nothing; asked as §2's question it returns a clean answer for all
six.

### F2 — AG Grid's scroll path has the identical shape. **Category (A).**

Read from `ag-grid/ag-grid@latest`,
`packages/ag-grid-community/src/rendering/rowRenderer.ts` (1 771 lines):

- The scroll entry point (`:1084-1106`) calls `workOutFirstAndLastRowsToRender()`, early-returns when
  the range did not change (`:1100-1102`, `afterScroll && !rangeChanged && !force`), and otherwise
  calls `this.recycleRows(null, false, afterScroll)`.
- `recycleRows` (`:1198-1230`): `removeRowCompsNotToDraw(indexesToDraw, …)` computes
  `existingIndexes.filter(index => !indexesToDrawMap[index])` and destroys exactly those; then
  `for (const rowIndex of indexesToDraw) this.createOrUpdateRowCtrl(...)`.
- `createOrUpdateRowCtrl` (`:1292-…`) opens with
  `let rowCtrl: RowCtrl | null = this.rowCtrlsByRowIndex[rowIndex];` — **an index that already has a
  `RowCtrl` keeps it, untouched.**

Note the naming trap: AG Grid's own `recycleRows` / `rowsToRecycle` vocabulary is about **preserving
`RowCtrl`s across a *model* change** (`:556`, `:669-677`, `keepRenderedRows`), not about pooling DOM
across a scroll. On the scroll path `rowsToRecycle` is passed `null` (`:1106`). Same conclusion as
F1, reached from the opposite direction.

### F3 — AG Grid's renderer is outside Vue's reconciler, and that is its real architectural argument

AG Grid's own Vue documentation states it plainly
(<https://www.ag-grid.com/vue-data-grid/scrolling-performance/>):

> *"Consider using JavaScript Cell Renderers instead of Vue Cell Renderers to see if it makes your
> rendering faster"* — because *"each time a Vue Cell Renderer is used, the grid switches context
> into a Vue application. This context switching can be time consuming when done multiple times."*

The grid body is rendered by `ag-grid-community`'s own vanilla TypeScript. Vue is a mounting shell.
**This is the only candidate for which Vue's render/reconciliation cost — the root cause
`P22-…-iter2-rendering.md` §2 identified — is structurally absent rather than merely reduced.**

It comes with the obvious corollary, and the corollary is the expensive part: every one of §1's items
5, 6, 7 and half of 2 is *per-cell custom rendering*. Done as Vue cell renderers, this app would pay
AG Grid's own documented context-switch cost per cell and land back in category (C) with extra steps.
Done properly, most of it maps to AG Grid's **vanilla** extension points — `cellClassRules`,
`cellStyle`, `valueFormatter`, `tooltipValueGetter` — which are evaluated by AG Grid itself with no
framework boundary crossed. That is a genuine fit for items 5 and 7 and a workable one for 6. It is
also, precisely, "hand-rolling imperative cell rendering", now inside somebody else's extension
point.

### F4 — AG Grid ships this app's exact symptom, and prescribes this app's exact fix. **Decisive context.**

From the same page and from
<https://www.ag-grid.com/vue-data-grid/dom-virtualisation/>:

> *"By default the grid will render 10 rows before the first visible row and 10 rows after the last
> visible row"* … the buffer exists *"to prevent blank spaces from appearing as the user scrolls"* on
> slower machines and browsers … *"Setting a high row buffer will reduce the redraw visible during
> vertical scrolling."* To debounce, *"set grid property `debounceVerticalScrollbar=true`."*

Three things follow, and together they are the single most important finding in this document.

1. **"Blank spaces as the user scrolls" is the user's reported symptom, verbatim, in a category-(A)
   imperative grid.** The symptom is therefore not a consequence of Vue reconciliation *per se*. It
   is what `P22-…-iter2-rendering.md` §1.2 calls it: the compositor exposing area past the end of the
   mounted band before the main thread commits. Every windowed grid has it; the question is only how
   much runway it leaves.
2. **AG Grid's default runway is smaller than this app's.** 10 rows/side against this app's
   `OVERSCAN_PX = 560` ≈ 20 rows/side at 28 px (`columns.ts:20`, `DataGrid.vue:375`) — and against
   the in-flight `rowRangeExtractor`'s velocity-scaled lead of up to `MAX_LEAD_PX = 2400`
   (`columns.ts:224-233`). Adopting AG Grid at its defaults would make the runway **worse**, and the
   remedy would be to raise `rowBuffer` — which is `P22-…-iter2-rendering.md` D3, spelled differently.
3. So the honest expected outcome of an AG Grid migration on this specific complaint is: **throughput
   improves from category (B) to category (A) — a constant factor, not a complexity change — and
   runway is unchanged, because runway is a number you set, not a property you buy.**

### F5 — RevoGrid rebuilds the entire window's node description every render. **Category (C).**

Read from `revolist/revogrid@main`, `src/components/data/revogr-data.tsx` (380 lines), `render()`:

```tsx
const rows = this.viewportRow.get('items');
const cols = this.viewportCol.get('items');
const rowsEls: VNode[] = [];
for (let rgRow of rows) {
  …
  const cells: (VNode | string | void)[] = [];
  for (let rgCol of cols) {
    const smodel: CellTemplateProp = {
      ...this.columnService.rowDataModel(rgRow.itemIndex, rgCol.itemIndex),
      providers: this.providers,
    };
    …
```

A nested loop over **every** visible row × **every** visible column, allocating a fresh
`CellTemplateProp` model object per cell (a spread, so a fresh object even when nothing changed) and
a fresh `VNode` per cell, then handed to Stencil's own virtual-DOM diff. `this.renderedRows` is
reassigned to a new `Map` at the top of every render.

**This is structurally the same shape as `DataGrid.vue`'s `renderRows` before the in-flight D4 work** —
full-window view-model rebuild plus reconciler patch — with Stencil's reconciler substituted for
Vue's. There is no per-row memo, no reference-stability contract, no bail-out check on the retained
rows. Whatever Stencil's diff costs relative to Vue's, the ~800 allocations per frame that §2's table
counts are paid identically.

RevoGrid is a competent, actively-developed, MIT-cored grid. It is not a fix for this bottleneck, and
adopting it would be **trading a category-(B) renderer for a category-(C) one** — a regression on the
one axis this evaluation exists to improve. The Web Component boundary adds a second cost: props
cross as DOM properties, and §1 item 10's frozen non-reactive page structures would have to be
marshalled across it.

### F6 — vxe-table and TanStack Table are category (C) by construction

- **vxe-table** is a native Vue 2/Vue 3 component library — its rows and cells are produced by Vue
  render functions and diffed by Vue's reconciler. Its virtual scroll (`scroll-y`) is windowing math,
  the same thing `@tanstack/vue-virtual` already provides here. It has no per-row memo contract
  exposed to a consumer. Category (C), identically to this app pre-D4.
- **TanStack Table** is *headless*: it owns no DOM at all. Combined with `@tanstack/vue-virtual`
  (already a dependency), the rendering is 100 % this app's own Vue templates — i.e. **exactly the
  code path `P22-…-iter2-rendering.md` §1.3 itemised as the problem**. This is the important
  non-obvious conclusion of the whole survey: *headless is orthogonal to fast.* TanStack Table would
  bring column-model, sorting and filtering primitives the app already has in `state.ts`/
  `sortTerms.ts`/`columns.ts`, and would bring **nothing whatsoever** to the identified bottleneck.
  Adopting it as a performance measure would be a category error.

### F7 — The property worth switching for is already in the tree, uncommitted

`P22-…-iter2-rendering.md` D4 landed both halves, and both are present in the working tree at the
time of writing:

- `views/grid/GridRow.vue` (335 lines, untracked) — one dynamic prop, `rowVm: RowVM`, with
  `rowHeight` threaded via `provide`/`inject` specifically so it is *not* a second prop
  (`rowVm.ts:44-48`'s `ROW_HEIGHT_KEY` doc comment says exactly this).
- `DataGrid.vue:1459-1507` — `rowVmCache: Map<number, { vm: RowVM; sig: RowSig }>`, a per-row
  signature (`:1485`), and `cached && sameRowSig(cached.sig, sig) ? cached.vm : buildRowVm(...)`
  (`:1499-1503`). Rows leaving the window are dropped with the cache swap at `:1507`.

Together these satisfy `@vue/runtime-core@3.5.42`'s `shouldUpdateComponent` bail-out
(`runtime-core.esm-bundler.js:4858-4903`): a component vnode with one dynamic prop whose **reference**
is unchanged returns `false` before any render, vnode creation or child patch. That is **category (B)**
— the same complexity class as SlickGrid and AG Grid, reached without a dependency, without a
license gate, and without a byte of bundle.

And `columns.ts:212-256` carries the runway half: `rowRangeExtractor`, direction-biased and
velocity-scaled, `BASE_LEAD_PX = BASE_TRAIL_PX = OVERSCAN_PX` so the at-rest window is byte-identical
to today's, capped in *cells* via `CELL_BUDGET = 2200` so wide tables stay inside the DOM budget.

**This is the finding that decides the document.** The case for a library rests on it buying a
property the app lacks. As of this week the app does not lack it. What remains unknown is whether
category (B) plus that runway is *enough* — and that is a question `P22-…-iter2-rendering.md` §7.3
answers with a real trackpad on a real Mac, for free, this week. Deciding to replace the foundation
before that measurement exists would repeat pass 1's own postmortem — a confident conclusion drawn
without the instrument that can observe the phenomenon — one document later.

---

## 4. Popularity and maintenance, measured

All figures read **2026-09-02**. Stars/forks/issues/`pushed_at` from GitHub's repository API; weekly
downloads from `api.npmjs.org/downloads/point/last-week`; release dates from `registry.npmjs.org`.

| Library | Repo | ★ | Forks | Open issues | Last push | npm/week | Latest | Cadence (last 10 stable) |
|---|---|---:|---:|---:|---|---:|---|---|
| **AG Grid** | `ag-grid/ag-grid` | 15 578 | 2 082 | 133 | 2026-09-02 | `ag-grid-community` **3 312 120**<br>`ag-grid-vue3` 238 068 | 36.1.0 (2026-08-05) | ~monthly; 35.0.1 Jan → 36.1.0 Aug 2026 |
| **TanStack Table** | `TanStack/table` | 28 398 | 3 572 | 60 | 2026-08-31 | `@tanstack/vue-table` 996 232 | 9.2.4 (2026-08-28) | **v9.0.0 shipped 2026-08-04** — a major, ~1 month old |
| **Handsontable** | `handsontable/handsontable` | 22 034 | 3 186 | 39 | 2026-09-02 | 305 859<br>`@handsontable/vue3` 25 546 | 18.1.0 (2026-09-01) | ~quarterly majors; 16.0.0 Jul 2025 → 18.1.0 Sep 2026 |
| **vxe-table** | `x-extends/vxe-table` | 8 623 | 1 145 | **1 345** | 2026-09-01 | 62 169 | 4.21.3 (2026-08-31) | near-daily; **1 562 published versions** |
| **RevoGrid** | `revolist/revogrid` | 3 440 | 209 | 22 | 2026-09-02 | `@revolist/revogrid` 31 789<br>`@revolist/vue3-datagrid` 11 277 | 4.27.1 (2026-09-02) | weekly; 472 versions since 2020 |
| **SlickGrid (modern)** | `ghiscoding/slickgrid-universal` | **174** | 48 | 3 | 2026-09-02 | `slickgrid-vue` **3 209** | 10.10.0 (2026-08-28) | ~monthly minors, v10 major Mar 2026 |
| *(SlickGrid core)* | `6pac/SlickGrid` | 2 066 | 429 | 10 | 2026-09-02 | `slickgrid` 13 500 | 5.20.0 | active |
| **Glide Data Grid** | `glideapps/glide-data-grid` | 5 324 | 426 | 130 | **2026-01-21** | 316 786 | **6.0.3 (2024-02-03)** + `6.0.4-alpha24` | last *stable* release 2.5 years old |
| **SVAR Vue DataGrid** | `svar-widgets/vue-grid` | — | — | — | 2026-09-02 | `@svar-ui/vue-grid` **1 364** | 2.7.4 (2026-09-02) | active but negligible adoption |

Three readings that are not obvious from the table:

- **vxe-table's 1 345 open issues** against 8 623 stars is a ratio no other candidate approaches
  (AG Grid: 133/15 578; RevoGrid: 22/3 440; Handsontable: 39/22 034). Combined with **1 562 published
  versions** and near-daily releases across two parallel major lines (3.x for Vue 2, 4.x for Vue 3,
  released in lockstep — `3.23.3` and `4.21.3` both on 2026-08-31), the signal is high velocity with
  a large unresolved backlog, not neglect. It is a real project; it is also a project whose issue
  tracker, pinned announcements and primary documentation (`vxetable.cn`) are Chinese-first, with an
  English `README.en.md` and little else. For a fully-typed TS codebase maintained in English where
  the grid is the single most complex component, that is a standing maintenance tax on every future
  debugging session, not a one-time onboarding cost.
- **TanStack Table v9 is one month old.** `@tanstack/vue-table` went 8.21.3 (2025-04-14) → 9.0.0
  (2026-08-04) → 9.2.4 (2026-08-28), i.e. four minor/patch releases in three weeks. That is normal
  post-major churn and it is exactly the wrong moment to build a foundation on it. (Moot — see F6.)
- **slickgrid-universal is a one-maintainer project.** 174 stars, 48 forks, 3 209 weekly downloads
  for `slickgrid-vue`. The engineering is excellent and the release discipline is real (monthly
  minors, a clean v10 major with a migration guide), but the bus factor is 1 and the adoption base is
  ~1/1000th of AG Grid's. That is the single largest risk in the candidate that otherwise fits best
  on architecture and license.

---

## 5. License, size, and parity

### 5.1 License — measured, not assumed

| Library | SPDX / terms | Verified from | Gating |
|---|---|---|---|
| **AG Grid Community** | **MIT** — *"The MIT License … Copyright (c) 2015-2026 AG GRID LTD"* | `ag-grid-community@36.1.0/LICENSE.txt` | **See §5.2 — the gating is the problem, not the license** |
| AG Grid Enterprise | Commercial perpetual, *"Including 1 year of updates"*, priced per developer | <https://www.ag-grid.com/license-pricing> | |
| **RevoGrid** | **MIT** core (open-core) | `registry.npmjs.org/@revolist/revogrid/latest` → `"license": "MIT"` | RevoGrid **Pro** is a separate paid tier (~$499/dev/yr; Pro Lite / Pro Advanced) — <https://rv-grid.com/pricing> |
| **vxe-table** | **MIT** | GitHub API `license.spdx_id: "MIT"`; npm `"license": "MIT"` | none |
| **TanStack Table** | **MIT** | GitHub API `license.spdx_id: "MIT"` | none |
| **slickgrid-vue / slickgrid-universal / SlickGrid** | **MIT** — *"Copyright (c) 2024-present, Ghislain B. … free of charge … without restriction"* | `slickgrid-vue@10.10.0/LICENSE`; `6pac/SlickGrid` GitHub API `spdx_id: "MIT"` | none |
| **Handsontable** | **Not MIT.** npm `"license": "SEE LICENSE IN LICENSE.txt"`; GitHub `spdx_id: "NOASSERTION"`. The free **Hobby** tier is *"free for personal, exploratory projects and can't be used in commercial settings or for commercially driven work."* Commercial from **$999/developer** | <https://handsontable.com/pricing> | **Disqualifying** |
| Glide Data Grid | MIT | GitHub API | React-only (§5.6) |

**Handsontable is out on license alone**, and the precedent is this repo's own:
`P18-sql-language-server-explain.md` declined a library specifically over its license. A
non-commercial-only free tier on a product intended to ship is a harder blocker than GPL, not a
softer one.

### 5.2 The AG Grid Community/Enterprise split, against §1's list

This is the decisive parity finding, and it is not a judgement call — it is a direct read of AG
Grid's own comparison table (<https://www.ag-grid.com/license-pricing>). **Enterprise-only:**

| Enterprise-gated feature | §1 item it blocks |
|---|---|
| **Context Menu** | **#3** — `menu.ts`, 425 lines, three menus, the primary interaction surface |
| **Cell Range Selection** | **#4** — range-drag selection |
| **Clipboard** (incl. copy of multiple cells) | **#4** — `clipboardFormats.ts` |
| **Column Menu** | #1/#7 — `ColumnsMenu.vue` |
| Columns / Filters Tool Panel, Status Bar, Excel Export, Row Grouping | not used today |

Community *does* include: row **and** column virtualization, cell editing, custom cell renderers,
`cellStyle`/`cellClassRules`, `tooltipValueGetter`, column pinning, sorting, filtering — so §1 items
1, 2 (partially), 5, 6, 7 are reachable on MIT.

**But items 3 and 4 — right-click and copy-a-rectangle — are the two things a database client's grid
is for.** Adopting AG Grid Community means either paying per developer per year for Enterprise, or
re-implementing the context menus and range selection *by hand, on top of AG Grid's event surface*,
which is strictly harder than the status quo: the same hand-rolled code, now fighting a library's own
event model, focus model and cell-lifecycle instead of owning them. That is the opposite of the
user's stated goal ("instead of hand-rolling fixes").

### 5.3 Bundle size — real numbers

Measured 2026-09-02. `gzip -9` figures are this document's own measurements over files fetched from
`cdn.jsdelivr.net`; `bundlephobia` figures are that service's minify+gzip of the package entry point.
The yardstick throughout is **the whole current app bundle: 333 298 B gzip**.

| Package | Raw | gzip | vs. whole app bundle | Method |
|---|---:|---:|---:|---|
| **`ag-grid-community@36.1.0`** | 1 267 847 | **344 065** | **+103 %** | `gzip -9` of `dist/package/main.esm.min.mjs` |
| *(same, bundlephobia)* | 1 339 096 | 362 246 | +109 % | `bundlephobia.com/api/size` |
| `ag-grid-vue3@36.1.0` (wrapper only) | — | — | — | npm `unpackedSize` 254 695; depends on `ag-grid-community` |
| **`handsontable@18.1.0`** | 1 474 636 | **342 896** | +103 % | bundlephobia |
| **`vxe-table@4.21.3`** | 506 168 | **148 437** | +45 % | `gzip -9` of `lib/index.umd.min.js` |
| **`@revolist/revogrid@4.27.1`** | 542 223 | **118 784** | +36 % | `gzip -9`, sum of 5 core ESM chunks, **unminified as published** (real figure is lower) |
| **SlickGrid core** (`@slickgrid-universal/common@10.10.0`) | 322 963 + 73 628 | **62 780 + 15 861 = 78 641** | +24 % | `gzip -9` of `dist/core/slickGrid.js` + `dist/core/slickDataView.js`, **unminified as published**, tree-shakeable per-module |
| *(`slickgrid@5.20.0` whole ESM bundle)* | 734 287 | 155 199 | +47 % | includes every plugin |
| `@tanstack/table-core@9.2.4` | modular; largest single feature file 32 031 raw | small | negligible | per-feature ESM files |
| `@tanstack/vue-virtual@3.13.36` | — | — | **0** | already a dependency |

Set against this repo's own precedents:

- `sql-formatter` — **38 036 B gzip, accepted**, because P13 D2 lazy-loads it behind a button.
- `node-sql-parser` — **237 008 B gzip, declined** (P18 §443-448), at 71 % of the bundle, *and it was
  lazy-loadable*. P18's own words: *"Even lazily loaded (P13's D2 pattern), it is a 237 KB chunk."*

**AG Grid at 344 065 B gzip is 1.45× the thing this repo already declined, and unlike it, cannot be
lazy-loaded.** The grid is not behind a button: `docs/ARCHITECTURE.md` "UI architecture" records that
session restore reopens `data` tabs, so the grid chunk is on the launch path of essentially every
session. Doubling the bundle for a category-(A)-over-category-(B) constant factor is not a trade this
repo's own history supports.

RevoGrid and SlickGrid are the only two candidates whose size would even be arguable, and Stencil's
lazy per-component chunking means RevoGrid's real launch cost is a subset of the 118 KB figure.

### 5.4 Vue 3 support maturity

| Library | Vue 3 integration | First-party? | Composition API | TS |
|---|---|---|---|---|
| AG Grid | `ag-grid-vue3` | **Yes** — same monorepo (`ag-grid/ag-grid`), published at the identical version and minute as `ag-grid-community` (both `36.1.0`, 2026-08-05 08:55/09:00) | Yes, `<script setup>` documented | Yes, first-class |
| RevoGrid | `@revolist/vue3-datagrid` | **Yes** — `revolist/vue3-datagrid`, auto-generated from the Stencil core by the project's own CD pipeline | Wrapper over a Web Component | Types generated from Stencil |
| vxe-table | native Vue 3 (4.x line) | **Yes** — not a wrapper at all; the 4.x line *is* the Vue 3 implementation | Yes | Yes (repo is TypeScript) |
| TanStack Table | `@tanstack/vue-table` | **Yes** — same monorepo | Yes | Yes, best-in-class |
| slickgrid-vue | `frameworks/slickgrid-vue` inside `ghiscoding/slickgrid-universal` | **Yes** — first-party, versioned with the monorepo (10.10.0) | Yes | Yes |
| Handsontable | `@handsontable/vue3` | Yes | Yes | Yes |

No candidate fails on this axis. "Community afterthought wrapper" is not a live concern for any of
the six — this part of the ecosystem matured. The differentiators are elsewhere.

### 5.5 Feature-parity cost, scored

Cost to reach today's behaviour, per §1's twelve items. **L** = library config/extension point does
it; **M** = library seam exists but this app's semantics need real code on top; **H** = must be
hand-rolled against the library's event model; **✗** = license-gated or architecturally blocked.

| §1 item | AG Grid Community | RevoGrid | vxe-table | slickgrid-vue | TanStack+vue-virtual |
|---|---|---|---|---|---|
| 1 both-axis virtualization | L | L | L | L | L (status quo) |
| 2 staged edit → Go mutation pipeline | M (`valueSetter`/`readOnlyEdit` diverted into `pendingChanges`) | M | M | M | M (status quo) |
| 3 three context menus (`menu.ts`) | **✗ Enterprise** → H | M (plugin) | M | L (`slickContextMenu`) | H (status quo) |
| 4 range selection + typed clipboard | **✗ Enterprise** → H | M (`range` prop) | M | L (`slickCellExternalCopyManager`) | H (status quo) |
| 5 type-based cell coloring + priority rule | L (`cellStyle`/`cellClassRules`, vanilla) | M | M | L (formatter) | L (status quo) |
| 6 shared `createPageSearch` highlighting | M (`cellClassRules` + `refreshCells` on a generation bump) | M | M | M | L (status quo) |
| 7 header tooltips, FK/PK glyphs | L | M | M | L | L (status quo) |
| 8 exact dark theme | M — v33+ Theming API (`themeQuartz.withParams()`) is capable, but becomes a **second source of truth** beside the Tailwind v4 tokens | M | M | M (CSS/SASS themes) | L (status quo) |
| 9 decode-on-entry + window-pruned retention (P5 C1) | **M/H** — needs a custom row model or careful `valueGetter` discipline so the library never materialises the page | H | H | M (`DataView` accepts a custom item source) | L (status quo) |
| 10 no Vue reactivity on row data | M — data lives outside Vue anyway, which is a genuine *fit* | H (props cross a Web Component boundary) | **H** — vxe-table's data source is a Vue-reactive array | M | L (status quo) |
| 11 `ConsoleResultGrid.vue` second consumer | M (adopt twice) | M | M | M | L (status quo) |
| 12 EXPLAIN strip / fake-data generator | **0** (not grid-internal) | 0 | 0 | 0 | 0 |

Two rows deserve emphasis. **Item 9** is a real, under-appreciated blocker: `docs/PERF.md` and P5 C1
gate the retained-bytes invariant on the decode cache being pinned to the mounted window. Most grid
libraries want an array of plain row objects; wiring one to a page whose cells are decoded lazily on
first sight and evicted on window exit means using the library's least-travelled data-source seam.
**Item 10** eliminates vxe-table independently of everything else in this document — a Vue-reactive
row array is a direct violation of `docs/ARCHITECTURE.md`'s stated invariant, on a page that can hold
10 000 rows.

### 5.6 Also checked, and not shortlisted

- **Glide Data Grid** (`glideapps/glide-data-grid`, MIT, 5 324★). Canvas-rendered — the only
  genuinely different rendering architecture in the survey, and the only one that would sidestep DOM
  cost entirely. Declined on two hard facts: it is **React-only** (`peerDependencies`: `react`,
  `react-dom`, plus `lodash`, `marked`, `react-responsive-carousel`), and its **last stable release
  is 6.0.3, published 2024-02-03**, with the line since living entirely on `6.0.4-alpha*` prereleases
  and the repo last pushed 2026-01-21. Not a foundation. Also worth stating plainly: canvas would
  forfeit §1 items 6, 7 and 8's reliance on CSS, plus accessibility and native text selection.
- **SVAR Vue DataGrid** (`@svar-ui/vue-grid`, MIT, Vue-3-native, released 2.7.4 on 2026-09-02).
  Genuinely current and genuinely MIT, and it virtualizes both axes. Declined on adoption —
  **1 364 weekly downloads** — and on architecture: Vue-native means category (C).
- **PrimeVue DataTable.** Not MIT (`"license": "SEE LICENSE IN LICENSE.md"`), and a component-library
  table rather than a virtualized data grid; its `scrollable`+`virtualScroller` path is Vue-rendered,
  category (C).
- **FINOS Perspective.** A WASM analytics engine with its own renderer, not a general-purpose editable
  DB-browsing grid; the WASM payload alone is an order of magnitude past §5.3's yardstick.
- **`gabrielpetersson/fast-grid`.** Surfaced repeatedly in research as the reference point for what
  120 fps DOM grid scrolling looks like. It is a demo and a technique, not a maintained library. Its
  technique — a genuine node pool with a fixed slot table — is the one thing §3 F1 shows *no* real
  library does, and `P22-…-iter2-rendering.md` §4 already declined the Vue equivalent
  (slot-modular recycling, `:key="pos % N"`) with reasons that stand.

---

## 6. Decisions

### D1 — **Adopt none. Keep the hand-rolled grid.** *Recommended.*

The case rests on four findings, in order of weight:

1. **The property a library would buy is already in the tree** (F7). `GridRow.vue` + the
   `rowVmCache` signature memo put the app in category (B) — the same complexity class as SlickGrid
   (F1) and AG Grid (F2). What a migration buys on throughput is the difference between "one
   reference comparison per retained row" and "no visit per retained row". That is a constant factor
   on an already-fixed complexity class.
2. **The only candidate that also removes Vue from the render path charges for the app's core
   interactions** (F3, §5.2). AG Grid Community is MIT and genuinely capable, but **context menus,
   cell range selection and multi-cell clipboard are all Enterprise**. Those are §1 items 3 and 4 —
   right-click and copy-a-rectangle — which is most of what a DB client's grid *is*. The MIT path
   means hand-rolling them anyway, on top of somebody else's event model.
3. **The bundle cost exceeds what this repo has already declined** (§5.3). 344 065 B gzip against a
   333 298 B whole-app bundle is **+103 %**, un-lazy-loadable because a `data` tab is on the
   session-restore path. P18 declined `node-sql-parser` at 237 008 B gzip *while it was lazy-loadable*.
   Adopting AG Grid would overturn that precedent by 1.45×, for a constant factor.
4. **The symptom is not architectural** (F4). AG Grid's own documentation describes "blank spaces
   appearing as the user scrolls" and prescribes raising `rowBuffer` — with a default runway of 10
   rows/side, *smaller* than this app's existing 20 and far smaller than the in-flight
   `rowRangeExtractor`'s velocity-scaled lead. Runway is a number you set. No library sells it.

And one finding that removes the rest of the field independently: RevoGrid (F5), vxe-table and
TanStack Table (F6) are all **category (C)** — full-window rebuild plus reconciler diff. Adopting any
of them would be a *regression* against the tree as it stands this week.

### D2 — Handsontable: **decline on license.** Closed.

Free tier is *"free for personal, exploratory projects and can't be used in commercial settings or
for commercially driven work"*; commercial from $999/developer. This is an MIT product
(`ARCHITECTURE.md`), and P18 set the precedent of declining a library on license terms alone.
Recorded so it is not re-surveyed: nothing about Handsontable's engineering is the reason.

### D3 — vxe-table: **decline on the reactivity invariant, before anything else.** Closed.

Its data source is a Vue-reactive array, which is a direct violation of `docs/ARCHITECTURE.md`'s
*"No Vue reactivity on row data. Rows live in plain frozen typed structures"* — on pages that hold up
to 10 000 rows. The English-documentation friction (§4) and the 1 345-open-issue backlog are
secondary; the invariant alone is dispositive.

### D4 — RevoGrid and TanStack Table: **decline on architecture.** Closed.

Both are category (C) (F5, F6). RevoGrid's `revogr-data.tsx` `render()` allocates a fresh model and a
fresh VNode for every visible cell every render — the exact shape `P22-…-iter2-rendering.md` §1.3
itemised as the bottleneck. TanStack Table owns no DOM at all, so 100 % of the render cost stays in
this app's Vue templates. **"Headless" is orthogonal to "fast", and "uses `@tanstack/vue-virtual`
internally" is windowing math, not throughput.** Recorded explicitly because both are the intuitive
picks and both are wrong for this specific bottleneck.

### D5 — AG Grid: **decline, but keep it as the named fallback, and say what would reopen it.**

Unlike D2–D4 this is a decline on *cost*, not on merit. AG Grid is the strongest engineering in the
survey: 3.3 M weekly downloads, monthly releases, a first-party Vue 3 wrapper published at the same
version and minute as the core, first-class TypeScript, and the only rendering engine here that is
structurally outside Vue's reconciler (F3). It loses on §5.2 and §5.3, not on §3.

**What would reopen it**, precisely — all three, not any one:
(a) `P22-…-iter2-rendering.md` §7.3's real-Mac protocol shows category (B) + the velocity-adaptive
runway is measurably insufficient, *and* the Web Inspector timeline attributes the remaining cost to
**Script** rather than Layout/Paint/Composite (§7.3 step 7); (b) the +103 % gzip launch cost is
accepted explicitly, with a measured `bun run build` delta rather than this document's estimate; and
(c) either Enterprise is purchased, or a written decision accepts hand-rolling context menus and
range selection against AG Grid's event surface. Absent (a), (b) and (c) are moot.

### D6 — The memory half: **no candidate is credited, and this is not re-litigated.**

`docs/WEBVIEW-SCROLL-MEMORY.md` and `P22-webview-scroll-performance-iter2-memory.md` established that
the ~1 GB plateau is WebKit compositor tile pooling governed by layer geometry and velocity, largely
independent of the JS/DOM technique painting inside the scroller. Every candidate here produces a
tall scroller with a mounted band inside it; **none changes the input to that machinery.** F4 adds a
wrinkle worth recording: a library whose remedy for blank rows is a *larger* row buffer pushes on the
memory half in the wrong direction, exactly as `P22-…-iter2-rendering.md` D3(d) says of its own fix —
so this is a trade every candidate makes, not an advantage any of them holds.

### D7 — If a library is ever adopted, it is **SlickGrid via `slickgrid-vue`** — and the blocker is bus factor, not fit.

Recorded as a decision because it is the non-obvious runner-up and the user's own question named
SlickGrid. On the axes this document measures it is the best fit after AG Grid: **MIT throughout**
(core, universal, Vue wrapper), **the smallest real footprint** (~78 641 B gzip for
`slickGrid.js` + `slickDataView.js`, *unminified as published* and tree-shakeable — under a quarter of
AG Grid's), **category (A)** by F1, **no feature gating whatsoever** — its context menu, cell external
copy manager and editors are all in the MIT packages, i.e. §1 items 3 and 4 are `L`, the two cells
where AG Grid is `✗` — and a genuine first-party Vue 3 integration inside the monorepo, released
2026-08-28 at 10.10.0 with a documented v10 migration guide. `6pac/SlickGrid` itself is alive (pushed
2026-09-02, 10 open issues).

It is not recommended because of §4's last row: **174 stars, 48 forks, 3 209 weekly downloads for
`slickgrid-vue`, one maintainer.** Taking a bus-factor-1 dependency for the single most complex,
most user-visible component in the product, in exchange for a constant factor over a property the app
already has (F7), is a worse risk than the one it removes. If D5's condition (a) is ever met and
Enterprise is unacceptable, this is where to look — and the honest form of that question is *"is one
maintainer with excellent discipline a better bet than our own 2 900 lines?"*, which is a question
about people, not about grids.

---

## 7. If D1 is overruled — migration shape and risk, sketched

Not a plan. The shape and the three things that would actually hurt, so the size of the bet is
visible.

**Shape.** `DataGrid.vue` + `GridRow.vue` (~2 560 lines) collapse into a grid config plus a set of
renderers/formatters; `columns.ts`'s virtualization seams (`columnRangeExtractor`,
`rowRangeExtractor`, `observeScrollElementOffset`) are deleted outright — the library owns that.
`state.ts`, `pendingChanges.ts`, `page.ts`, `search.ts`, `sortTerms.ts` and `menu.ts`'s *content*
survive and are re-wired to the library's event surface. `ConsoleResultGrid.vue` is migrated in the
same phase or the app carries two rendering models indefinitely. `tests/ui/` — `data-view.spec.ts`,
`mutations.spec.ts`, `interaction.spec.ts`, `row-coloring.spec.ts`, `budgets.spec.ts`,
`perf.spec.ts` — is the regression guard and every one of its selectors (`[data-testid="grid-row"]`,
`.grid-cell[data-row]`) is rewritten against the library's DOM.

**The three real risks, in order:**

1. **Item 9, the decode-cache invariant.** P5 C1 pins the decode cache to the mounted window and
   `perf.spec.ts` gates retained bytes on it. Every candidate's happy path wants a materialised row
   array. Getting a library to ask for cell text lazily *and* to tell the app which window is mounted
   *and* to never hold a strong reference to what left is the least-travelled seam in every one of
   them, and it is the risk most likely to be discovered late.
2. **Item 8, theming.** The workbench's look comes from Tailwind v4 CSS-first tokens mirroring VS
   Code Dark Modern. Re-expressing them through a grid's theming API creates a second source of truth
   for colour that will drift, and `docs/design/kira-design-system/` has no story for it.
3. **The `budgets.spec.ts` cliff.** Every DOM-cell bound, both overscan-coverage invariants and the
   scroll-response p50/max thresholds are written against *this* grid's DOM and *this* grid's
   overscan policy. A migration invalidates all of them simultaneously, which means the phase would
   run with **no** performance gate for its whole duration — the precise condition
   `P22-…-iter2-rendering.md` §0.5 was ordered to prevent.

**And the thing to do first, in any case:** run `P22-…-iter2-rendering.md` §7.3 to completion on real
hardware. It costs twenty minutes and a trackpad, it produces the first real measurement of a macOS
momentum scroll's velocity in this app, and its step 6/step 7 output is the *only* evidence that can
tell the difference between "the renderer is too slow" (a library might help) and "the runway is too
short" or "the cost is below JS" (no library helps). **Choosing a foundation before that measurement
exists is the same mistake this phase's own predecessor is a postmortem of.**

---

## 8. Comparison table

Scored against §1's surface, §2's category question, §5's measured numbers and §4's measured
activity. All data 2026-09-02.

| | **AG Grid Community** | **RevoGrid** | **vxe-table** | **slickgrid-vue** | **TanStack Table + vue-virtual** | **Handsontable** | **Status quo (hand-rolled)** |
|---|---|---|---|---|---|---|---|
| **Retained-row cost (§2)** | **(A)** none | **(C)** full rebuild + Stencil diff | **(C)** full rebuild + Vue diff | **(A)** none | **(C)** full rebuild + Vue diff | (A) | **(B)** reference bail-out — *already landed* |
| **Renders outside Vue?** | **Yes** | Yes (Stencil/WC) | No | Yes | **No** | Yes | No |
| **License** | **MIT** (core) | **MIT** (open-core) | **MIT** | **MIT** | **MIT** | **✗ non-commercial free tier only** | — |
| **Feature gating** | **✗ context menu, range selection, clipboard = Enterprise** | Pro tier (~$499/dev/yr) for advanced | none | **none** | none | paid | none |
| **gzip cost** | **344 065 B (+103 %)** | ~118 784 B (+36 %, unminified) | 148 437 B (+45 %) | **~78 641 B (+24 %, unminified)** | ~0 (already a dep) | 342 896 B (+103 %) | **0** |
| **Lazy-loadable?** | No — `data` tabs are on the session-restore path | No | No | No | n/a | No | n/a |
| **★ / npm week** | 15 578 / **3.31 M** | 3 440 / 31 789 | 8 623 / 62 169 | **174 / 3 209** | 28 398 / 996 232 | 22 034 / 305 859 | — |
| **Open issues** | 133 | 22 | **1 345** | 3 | 60 | 39 | — |
| **Last release** | 36.1.0, 2026-08-05 | 4.27.1, 2026-09-02 | 4.21.3, 2026-08-31 | 10.10.0, 2026-08-28 | 9.2.4, 2026-08-28 | 18.1.0, 2026-09-01 | — |
| **Vue 3 integration** | first-party, same monorepo/version | first-party generated wrapper | native Vue 3 | first-party, same monorepo | first-party | first-party | native |
| **TypeScript** | first-class | generated | yes | yes | best-in-class | yes | native |
| **Docs language** | English | English | **Chinese-first** | English | English | English | — |
| **Breaks `ARCHITECTURE.md` invariants?** | no | boundary marshalling (item 10) | **yes — reactive row array** | no | no | no | no |
| **Verdict** | **Decline (cost) — named fallback, D5** | **Decline (architecture)** | **Decline (invariant)** | **Decline (bus factor) — runner-up, D7** | **Decline (architecture)** | **Decline (license)** | **✅ Keep** |

---

## 9. Open questions, handed forward

- **The one measurement that could overturn D1 does not exist yet.**
  `P22-…-iter2-rendering.md` §7.3 steps 4–7, on a real Mac with a real trackpad. Specifically: if
  step 7's Web Inspector timeline shows **Script** dominating the frame *after* D3/D4 are both on,
  D5's condition (a) is met and AG Grid should be re-priced against a real `bun run build` delta
  rather than this document's `gzip -9` estimate. If Layout/Paint/Composite dominates, **no candidate
  in this document is relevant at all** and F12's per-row sticky gutter is the next thing to look at.
- **If D1 holds and the lag persists**, the remaining moves are all inside the current architecture
  and are already enumerated: `P22-…-iter2-rendering.md` §9's list (sticky-gutter scrolling-tree
  commits; main-thread starvation during momentum; the 280 000 px sizer's tile invalidation for
  *height*). None of them is a library question.
- **`slickgrid-vue` is worth re-checking in ~12 months** — specifically its download trend and
  whether contributor count has moved off 1. It is the only candidate whose *only* disqualifier is a
  number that can change (§4, D7). Nothing else here will look different: AG Grid's Enterprise gates
  and RevoGrid's render loop are product decisions, not backlog items.
- **The general lesson, and it is the same one both P22 halves already recorded.** The survey opened
  from a plausible premise — *"find a grid that recycles DOM nodes like SlickGrid does"* — and the
  premise was wrong about SlickGrid (F1), which meant the correct question (§2) returned a completely
  different shortlist than the stated one. Reading the source was what caught it. **The pattern
  repeats: a wrong instrument, or a wrong question, produces a confident, wrong conclusion** —
  `WEBVIEW-SCROLL-MEMORY.md` §2.1 for the memory half, `P22-…-iter2-rendering.md` §2 for pass 1's
  event coalescing, and here for the library survey.

---

## 10. Sources

Repository APIs and package registries, all read 2026-09-02: `api.github.com/repos/*` (via GitHub
search API), `registry.npmjs.org/*`, `api.npmjs.org/downloads/point/last-week/*`,
`data.jsdelivr.com/v1/packages/npm/*`, `bundlephobia.com/api/size`. Size figures marked `gzip -9` are
this document's own measurements over files fetched from `cdn.jsdelivr.net`.

Library source read directly:
- [`6pac/SlickGrid` — `src/slick.grid.ts`](https://github.com/6pac/SlickGrid/blob/master/src/slick.grid.ts)
- [`ag-grid/ag-grid` — `packages/ag-grid-community/src/rendering/rowRenderer.ts`](https://github.com/ag-grid/ag-grid/blob/latest/packages/ag-grid-community/src/rendering/rowRenderer.ts)
- [`revolist/revogrid` — `src/components/data/revogr-data.tsx`](https://github.com/revolist/revogrid/blob/main/src/components/data/revogr-data.tsx)

Documentation and licensing:
- [AG Grid — Vue Grid: DOM Virtualisation](https://www.ag-grid.com/vue-data-grid/dom-virtualisation/)
- [AG Grid — Vue Grid: Scrolling Performance](https://www.ag-grid.com/vue-data-grid/scrolling-performance/)
- [AG Grid — License & Pricing](https://www.ag-grid.com/license-pricing)
- [Handsontable — Pricing](https://handsontable.com/pricing)
- [RevoGrid — Pricing](https://rv-grid.com/pricing) · [RevoGrid — Licensing](https://rv-grid.com/guide/licensing)
- [Slickgrid-Universal — `frameworks/slickgrid-vue`](https://github.com/ghiscoding/slickgrid-universal/tree/master/frameworks/slickgrid-vue) · [Slickgrid-Vue docs](https://ghiscoding.gitbook.io/slickgrid-vue/)
- [TanStack Table](https://github.com/TanStack/table) · [vxe-table](https://github.com/x-extends/vxe-table) · [vxe-table `README.en.md`](https://github.com/x-extends/vxe-table/blob/main/README.en.md)
- [Glide Data Grid](https://github.com/glideapps/glide-data-grid) · [SVAR Vue DataGrid](https://svar.dev/blog/svar-vue-data-grid-released/)

In-repo, cited throughout: `docs/ARCHITECTURE.md`, `docs/PERF.md`, `docs/WEBVIEW-SCROLL-MEMORY.md`,
`docs/v1.1/plans/P22-webview-scroll-performance-iter2-rendering.md`,
`docs/v1.1/plans/P22-webview-scroll-performance-iter2-memory.md`,
`docs/v1.1/plans/P13-query-console-format-button.md`,
`docs/v1.1/plans/P18-sql-language-server-explain.md`, `docs/v1.1/plans/P15-fake-data-generator.md`.
