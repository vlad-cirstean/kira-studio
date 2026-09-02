# P22 — grid library survey: a ranked, evidence-cited shortlist for the SQL data view

> **The user's direction, verbatim**: *"I want to use a library for the data views, for start the sql
> one. The library needs to be fully open source and performant and fit well in the app. You didn't
> mention vue virtual scroller or revogrid etc. so spawn an opus agent to make a top of most popular
> well maintained performant libs that would fit this app. And it should consider both non canvas and
> canvas and explain the pluses and minuses. When it comes back I'll decide with what to proceed."*
>
> **What this document is.** A fresh, wider survey than
> `P22-grid-library-evaluation.md`, ranked, with every factual claim measured on **2026-09-02** from
> the npm registry, GitHub's API, and each library's **own published source** — plus real
> `esbuild --bundle --minify` + `gzip -9` numbers taken in this checkout, against a **freshly measured**
> app bundle rather than a quoted one. It is decision support: §9 gives my honest top two and the
> criterion that would flip them, but the ranking exists so the choice can be made on the evidence,
> not on my preference.
>
> **The three findings that reshape the previous shortlist.**
> 1. **Tabulator was not in the previous survey at all, and it should have been.** MIT throughout with
>    **no paid tier**, category (A) rendering (§2), context menus / range selection / clipboard /
>    editing all free, and — measured, not assumed — **its maintenance moved to Beekeeper Studio (an
>    open-source SQL client) in May 2026**, which is visible in the commit log: the top five committers
>    since March 2026 are Beekeeper Studio people, not the original author (§4). The closest analogue
>    product to this one ships Tabulator as its result grid.
> 2. **SlickGrid's core has a data-source seam that fits this app's hardest invariant exactly.**
>    `slickgrid@5.20.0` accepts a `CustomDataView` and calls an optional
>    **`getCellValue(index, field)`** — its own doc comment says it exists so *"non row-materializing
>    data sources … return a single cell value without first having to build a full row object"*
>    (§3.1). That is P5 C1's decode-on-entry contract, in the library's API. No other candidate has it
>    except the two that have no row concept at all.
> 3. **The strongest canvas candidate is not Glide.** It is **`@lumino/datagrid`** (JupyterLab, BSD-3,
>    48 714 npm/week): on scroll it **blits the already-painted canvas by the scroll delta and paints
>    only the newly exposed strip** (§6.2), and because it drives its own scrollbars, the exact symptom
>    being chased — *content exposed before the main thread has painted it* — is **structurally
>    impossible** in it (§6.1). That is the strongest architectural argument in this entire document,
>    and it is bought with the loss of native text selection, find-in-page, accessibility and CSS
>    theming.
>
> **What this document does not do.** It does not re-open the memory half.
> `docs/WEBVIEW-SCROLL-MEMORY.md` and `P22-webview-scroll-performance-iter2-memory.md` closed it:
> the ~1 GB CoreAnimation/IOSurface plateau is WebKit compositor tile behaviour for the scrolled
> layer, near-independent of what paints inside it. **No candidate here is credited with fixing it**
> (§7 records the single honest wrinkle and moves on). And it does not overturn
> `P22-grid-library-evaluation.md` §6 D1 by itself — that document's decisive open measurement
> (`P22-webview-scroll-performance-iter2-rendering.md` §7.3, a real trackpad on a real Mac) still has
> not been reported. §9 says plainly what that measurement would change about the ranking.

---

## 0. Method, baseline, and the bar every candidate had to clear

### 0.1 What was measured, and how

- **Popularity / maintenance**: GitHub repository API (stars, forks, open issues, `pushed_at`,
  license SPDX) and GitHub commit search for *authorship* over the last 6–9 months — the bus-factor
  question is "who actually commits", not "how many stars". npm weekly downloads from
  `api.npmjs.org/downloads/point/last-week`; release dates and licenses from `registry.npmjs.org`.
- **Bundle cost**: each candidate installed and bundled here with
  `esbuild --bundle --minify --format=esm`, then `gzip -9`. This is the same method
  `P13-query-console-format-button.md` F3 and `P18-sql-language-server-explain.md` §443 used, so the
  numbers are comparable to this repo's own precedents rather than to bundlephobia's entry-point
  heuristic.
- **Rendering architecture**: read from the library's own published source (installed package or
  `cdn.jsdelivr.net`), cited by file and line. **No claim below comes from a landing page.** Every
  candidate in this space says "renders 1M+ rows"; that sentence carries no information for an app
  that already renders only the visible window.

### 0.2 The baseline it is priced against — re-measured, not quoted

`bun run build` in this checkout, 2026-09-02:

| chunk | raw | gzip |
|---|---:|---:|
| `dist/assets/index-DM6uYGxz.js` (the launch-path bundle) | **1 120 934 B** | **348 411 B** (`gzip -9`; Vite's own reporter says 353.27 kB) |
| `dist/assets/index-WSRmQGsN.css` | 119.67 kB | 21.75 kB |
| `dist/assets/sqlFormatterEntry-*.js` (lazy, P13 D2) | 130.74 kB | 37.41 kB |
| `dist/assets/fakerEntry-*.js` (lazy, P15) | 415.80 kB | 155.46 kB |

Two things follow, and both are load-bearing:

- **The yardstick is 348 411 B gzip**, not P13's 333 298 B — the bundle has grown ~4.5 % since.
- **The lazy chunks are the precedent, and they are not available to a grid.** `sql-formatter` at
  38 KB was accepted *because it is behind a button*; `node-sql-parser` at 237 KB was **declined even
  though it was lazy-loadable** (P18 §443-448). A `data` tab is on the session-restore path
  (`docs/ARCHITECTURE.md`, "UI architecture"), so a grid's bytes are launch-path bytes.

### 0.3 The current state of the thing being replaced

Landed on this branch (`e783f81`, `6587148`, `a94f1d4`, `bc654f9`, `02b08d7`, `a232ed1`):
`views/grid/DataGrid.vue` (2 146 lines) + `GridRow.vue` (335) + `rowVm.ts` (108) +
`views/shared/page/columns.ts` (350), and the second consumer `views/console/ConsoleResultGrid.vue`
(703). The grid is **already category (B)** (§2) via `GridRow`'s single reference-stable `RowVM` prop
plus the `rowVmCache` signature memo, and already has a velocity-adaptive, direction-biased row
window (`rowRangeExtractor`). That is the incumbent every candidate is measured against — not the
pre-fix code.

### 0.4 Hard requirements (a failure on any of these is disqualifying, §5)

1. **Fully open source, no paywalled tier gating core features.** MIT/Apache/BSD preferred; any
   revenue-gated, seat-gated, or license-key-gated tier is a fail, regardless of engineering quality.
2. **A real Vue 3 path** — first-party wrapper, a healthy community one, or a framework-agnostic core
   that mounts on a `ref` with no framework assumptions. React-only is a fail.
3. **Genuinely current maintenance** — and the wrapper is judged separately from the core, which is
   the lesson `slickgrid-vue` (1 maintainer, 3 209 npm/week) vs `6pac/SlickGrid` (2 active
   maintainers, 13 500/week) taught.
4. **A retained row must not cost O(window) work on a scroll-driven update** (§2) — or, for canvas,
   the per-frame paint must be bounded by what actually changed.
5. **Bundle cost defensible against §0.2's precedents.**

---

## 1. What "fits this app" means, concretely

Carried from `P22-grid-library-evaluation.md` §1 (still accurate) and scored in §8. The four items
that actually decide things, because every candidate handles the other eight:

- **#3/#4 — three context menus (`menu.ts`, 425 lines) and range-select + typed clipboard
  (`clipboardFormats.ts`).** These are what a DB client's grid *is*. A library that charges for them
  (AG Grid) fails requirement 1; a library that has none of them (regular-table, Lumino) is not
  disqualified — the app already owns 2 900 lines that do them — but it changes what a migration buys.
- **#9 — decode-on-entry with a window-pruned cache** (`page.ts:31-40`, `store.ts:166-178`, P5 C1,
  gated by `perf.spec.ts`'s retained-bytes check). Most grids want an array of materialised row
  objects. **This is the single most discriminating requirement in the survey.**
- **#10 — no Vue reactivity on row data** (`docs/ARCHITECTURE.md` Invariants). Frozen typed structures
  behind an explicit `pageVersion` counter.
- **#11 — a second consumer**, `ConsoleResultGrid.vue`. Whatever is adopted has to be worth adopting
  twice, or the app carries two rendering models.

---

## 2. The classification, extended for this survey

`P22-grid-library-evaluation.md` §2 asked the only question that matters — *when the window slides by
four rows, what does the library do to the thirty-nine rows that did not change?* — and gave three
answers. This survey needs two more, because two candidates are architecturally outside that
trichotomy:

| | what a retained row costs per scroll update | examples |
|---|---|---|
| **(A)** | **Nothing.** Its DOM is not visited at all. The window moves by re-positioning a padded/absolute container. | SlickGrid, Tabulator, AG Grid |
| **(B)** | **A reconciler bail-out** — reached, then skipped on one reference comparison. | **this app today** (`GridRow` + `rowVmCache`); `vue-virtual-scroller`'s pooled views |
| **(C)** | **Full rebuild + diff** — fresh view-model and fresh node description per visible cell, every frame. | RevoGrid, vxe-table, TanStack Table, virtua-for-Vue, every Vue-native component-library table |
| **(D)** | **A fixed slot pool**: nodes are never created or destroyed, but every visible cell is *visited* and re-pointed at new data. Zero allocation, zero vnodes, O(window) writes — and a write is skipped when the value is unchanged. | regular-table |
| **(E)** | **Canvas**: the previous frame is blitted by the scroll delta and only the newly exposed strip is painted. No DOM at all. | `@lumino/datagrid` |

(A), (B), (D) and (E) are all *far* cheaper than (C). **(A) vs (B) is a constant factor on an
already-fixed complexity class** — which is why the previous evaluation declined to migrate. What
this survey adds is that (D) and (E) are different *kinds* of cheap, and (E) in particular changes
the failure mode rather than the constant (§6.1).

---

## 3. Findings — read from source

### F1 — SlickGrid, re-verified at `5.20.0`, and it has more than category (A)

- **Retained rows are skipped**: `dist/browser/slick.grid.js:3344` —
  `if (!(this.rowsCache[i] || …)) { … }`. An index already cached is not re-rendered.
- **The runway is direction-biased and one viewport deep, by default** (`:3230-3231`):
  ```js
  let buffer = Math.round(this.viewportH / this.getRowHeight()), minBuffer = this._options.minRowBuffer;
  this.vScrollDir === -1 ? (range.top -= buffer, range.bottom += minBuffer)
  : this.vScrollDir === 1 ? (range.top -= minBuffer, range.bottom += buffer)
  : (range.top -= minBuffer, range.bottom += minBuffer)
  ```
  with `minRowBuffer: 3` (`:180`) and `range.leftPx -= viewportW; range.rightPx += viewportW` for the
  column axis. **This is `P22-…-iter2-rendering.md` D3, already in the library** — direction-biased,
  asymmetric, both axes. It is *not* velocity-scaled, which the app's own `rowRangeExtractor` is.
- **Renders are throttled to 10 ms**: `scrollRenderThrottling: 10` (`:189`), applied via
  `this.scrollThrottle = this.actionThrottle(this.render.bind(this), …)` (`:455`).
- **The data-source seam is the best fit in the survey** (`:1709-1712`, `:1739-1757`):
  `setData` accepts *"a custom object exposing `getItem(index)` and `getLength()`"*, and `getCellValue`
  documents an optional `getCellValue(index, field)` that lets *"column-oriented (or otherwise non
  row-materializing) data sources … return a single cell value without first having to build a full
  row object via `getItem()`"*. §1 item #9 and #10 are satisfied by writing ~30 lines of adapter over
  the existing frozen page structures.

### F2 — Tabulator is category (A), MIT end-to-end, and its rendering seam is edge-only

Read from `tabulator-tables/tabulator@master`,
`src/js/core/rendering/renderers/VirtualDomVertical.js` (649 lines):

- `scrollRows(top, dir)` (`:120-165`) computes `topDiff`/`bottomDiff` and calls only
  `_addTopRow` / `_addBottomRow` / `_removeTopRow` / `_removeBottomRow`. **Retained rows are never
  touched** — no loop over them exists in the scroll path.
- `_removeTopRow` (`:480-522`) removes departing elements; `_addTopRow` (`:402-…`) inserts arriving
  ones with `table.insertBefore(row.getElement(), table.firstChild)` and `row.initialize()`.
- **The one fast-scroll caveat is explicit in the source** (`:127-133`): when the scroll delta exceeds
  `margin = vDomWindowBuffer * 2`, it abandons the incremental path and calls `_virtualRenderFill(…)`
  — a **full window rebuild**. `resize()` (`:167`) sets
  `vDomWindowBuffer = options.renderVerticalBuffer || elementVertical.clientHeight`, so with the
  default `renderVerticalBuffer: 0` (`core/defaults/options.js:41`) the threshold is **two viewport
  heights per scroll event**. A hard macOS fling can cross that.
- Defaults (`core/defaults/options.js:39-41`): `renderVertical: "virtual"`,
  **`renderHorizontal: "basic"`** — column virtualization exists (`VirtualDomHorizontal.js`, 587
  lines) but is **opt-in**, and this app needs it (61-column tables).
- **Every module the app needs is in the MIT package** (`core/modules/optional.js`): `MenuModule`,
  `SelectRangeModule`, `ClipboardModule`, `EditModule`, `FormatModule`, `SpreadsheetModule`,
  `TooltipModule`… There is no Enterprise tier, no license key, no gate.

### F3 — Tabulator's data model is its one real misfit with this app

`core/RowManager.js:230-241`, `_setDataActual`:
```js
var row = new Row(def, this);
this.rows.push(row);
```
A `Row` wrapper object is constructed for **every row in the dataset**, not just the visible window
(cells are lazy — `Row.js:62-78` `generateCells()` runs on `initialize()`). For a 10 000-row page that
is 10 000 wrapper objects plus a materialised array of plain row objects handed in by the app. That is
a direct collision with §1 item #9/#10 and with `perf.spec.ts`'s retained-bytes gate. It is not fatal
— Tabulator supports remote/progressive loading, and a page is bounded — but it is the opposite shape
from SlickGrid's `getCellValue`, and it is the reason Tabulator is ranked second rather than first.

### F4 — regular-table is a genuine cell pool with a per-window async data model

Read from `regular-table@0.9.0` (`src/ts/view_model.ts`, `src/ts/tbody.ts`):

- `ViewModel` holds `cells: HTMLTableCellElement[][]` and `rows: HTMLTableRowElement[]` — a **fixed
  grid of `<td>` elements indexed by *viewport* position**, created once and reused. `_get_cell`
  returns the pooled node; nothing is created on a steady-state scroll.
- `_draw_td` writes text **only when the value actually changed**:
  ```ts
  if (metadata.value !== val) { … td.textContent = String(val ?? ""); }
  ```
  and `_tagColumn`'s doc comment states the same discipline for classes: *"Only rewrites the class
  when the cell actually changes columns (horizontal scroll), so vertical scroll adds no churn."*
- **The data model is exactly this app's**: `setDataListener((x0, y0, x1, y1) => {…})` — a callback
  handed the visible *window*, allowed to be `async` (README: *"queried from a natively `async`
  virtual data model"*, *"`virtual_mode`: `both` (default) virtualizes scrolling on both axes"*).
  There is no row array and no materialisation. §1 items #9 and #10 are satisfied *by the API's
  shape*.
- Styling is a post-draw hook (`addStyleListener` + `getMeta`) over the pooled `<td>`s — so items #5,
  #6, #7 become class writes on real DOM, which means Tailwind tokens, native text selection,
  find-in-page and the existing dark theme all keep working (item #8 free).
- It is **not a grid**: no editing, no selection, no menus, no clipboard. The app keeps all 2 900
  lines of its own — which is the status quo, not a new cost, but it means a migration buys rendering
  only.
- **No overscan**: it draws the visible window (plus a partial row) and throttles draws
  (`scroll_panel.ts:115-132`, `throttle_tag`). Runway would have to be added by the app.

### F5 — RevoGrid, re-verified at `4.27.1`: still category (C), and worse than the previous read showed

`node_modules/@revolist/revogrid/dist/collection/components/data/revogr-data.js`, `render()`
(`:87-150`):
```js
for (let rgRow of rows) { … for (let rgCol of cols) {
    const smodel = Object.assign(Object.assign({}, this.columnService.rowDataModel(...)), { providers: this.providers });
    const cellEvent = this.triggerBeforeCellRender(smodel, rgRow, rgCol);
```
A nested loop over every visible row × column, a fresh spread-allocated model per cell, a fresh
Stencil VNode per cell — **and** `triggerBeforeCellRender` is `this.beforeCellRender.emit(detail)`
(`:184-193`), i.e. a Stencil `EventEmitter`, i.e. **a real DOM `CustomEvent` dispatched per visible
cell per render**. `this.renderedRows = new Map()` is reallocated at the top of every render (`:88`).
This is the pre-fix `DataGrid.vue` shape *plus* ~390 synchronous event dispatches per frame. Adopting
it would be a measurable regression against the current tree.

### F6 — `vue-virtual-scroller` v3 is a real view pool, and the fork question is settled

- **The fork churn is over.** npm `time`: `2.0.0-beta.8` on **2023-02-06**, then nothing until
  **`3.0.0` on 2026-04-23**, followed by 3.0.1–3.0.5 through 2026-08-12. The emergency forks
  (`vue3-virtual-scroller`) are now redundant. Peer dep `vue: ^3.3.0`; **one npm maintainer**
  (`akryum`); 10 790★ / 973 forks / **201 open issues**; 565 993 npm/week.
- **It genuinely pools.** `dist/useRecycleScroller-*.js` keeps a `pool` of view objects with
  `nr.used` flags; on update it reassigns `y.item = ie` **only when the item changed** (`:765`), and
  unused views are parked at `hiddenPosition` (`:396`). Reference-stable props for retained items →
  category (B), with stable DOM element identity as a bonus.
- **Two real minuses.** It virtualizes **one axis only** (`gridItems` is a uniform grid, not
  variable-width columns), so a 61-column table still needs the app's own `columnRangeExtractor`. And
  its default positioning mode is `transform`, which sets **`will-change: transform` per view**
  (`:65`) — a compositing hint `P22-…-iter2-rendering.md` §F12 explicitly declined and one that pushes
  on the memory half in the wrong direction. `disableTransform: true` opts out.

### F7 — `virtua`'s Vue entry has no grid, and its Vue path is category (C)

`virtua@0.51.0` is the most-downloaded virtualizer in the survey (1 052 834/week, 3 731★, pushed
2026-09-02) and multi-framework by design — but:

- `lib/vue/index.js` exports **only** `VList`, `Virtualizer`, `WindowVirtualizer`.
  `experimental_VGrid` — the 2-D component — exists only in `lib/react/VGrid.d.ts`. **Vue gets no
  column virtualization.**
- The Vue `Virtualizer`'s render function calls `slots.default({ item, index })` for **every index in
  the range on every render**, wrapping each in a child component with 8 dynamic props. Unchanged
  indices produce fresh vnodes → category (C) unless the consumer supplies its own memoised child —
  i.e. exactly what `GridRow` already is. Nothing gained over `@tanstack/vue-virtual`.

### F8 — `@lumino/datagrid` blits, and this is the strongest per-frame architecture in the survey

`@lumino/datagrid@2.5.8`, `src/datagrid.ts` (7 158 lines):

- `_scrollTo` (`:3878-4060`): if the delta is smaller than the viewport it calls
  `this._blitContent(this._canvas, x, y, w, h, x, y - dy)` and then
  `this.paintContent(0, dy < 0 ? contentY : height - dy, width, Math.abs(dy))` — **the previous frame
  is shifted with one `drawImage`, and only the newly exposed strip is painted.** Per-frame cost is
  O(rows entered), like category (A), but with no DOM, no style, no layout.
  (If `dxArea + dyArea >= width * height`, i.e. a jump longer than the viewport, it repaints
  everything — `:3955-3961`.)
- **Data is pulled per painted cell**: `dm.data(region, row, col)` (`:5200`), only for cells inside
  the painted region. §1 item #9 fits perfectly; item #10 is free (there is no framework data layer).
- **It drives its own scrollbars** (`:2523` — `this._scrollTo(this._hScrollBar.value, this._vScrollBar.value)`)
  and paints synchronously inside the `wheel` handler (`:3226-3239` → `BasicMouseHandler.onWheel` →
  `scrollBy`). See §6.1 — that is the whole argument, and the whole cost.

### F9 — Tabulator's maintenance changed hands, and the commit log proves it independently

GitHub commit search, `repo:tabulator-tables/tabulator committer-date:>2026-03-01`: **161 commits**,
top authors **Matthew Rathbone (12), Mohammad Azmi (11), Day Matchullis (11), azmy60 (6)** — the
Beekeeper Studio team — plus `dependabot`. Independently, search results record *"As of May 2026
Tabulator is now maintained by Beekeeper Studio"* (the original author's Patreon), and Beekeeper
Studio's own repo ships `apps/studio/src/common/tabulator.ts` and documents Tabulator as the grid
behind its Table Viewer/Editor and query results.

**Why this matters more than the star count**: the previous survey's only disqualifier for its
runner-up was bus factor. Tabulator's bus factor just moved from "one volunteer" to "a funded team
that ships the same category of product this app is" — and that team's own product is the largest
real-world stress test of Tabulator on SQL result sets that exists.

### F10 — every DOM candidate has the "blank rows while scrolling" symptom on record

Not just AG Grid (whose docs prescribe raising `rowBuffer` —
`P22-grid-library-evaluation.md` F4). Tabulator's tracker carries the same complaint and the same
remedy: *"big white space is appeard before first row while fast scrolling up and down"* (#1679),
*"White space appears above first row when scrolling up"* (#4631), and a maintainer answer in #4525
that *"one possible solution is to set the `renderVerticalBuffer`, but setting … to a high pixel value
will greatly affect the display speed for large tables."*

**Runway is a number you set, not a property you buy.** This is the single most important honest
caveat in the survey: for every DOM candidate, the symptom the user reports is bounded by overscan and
main-thread throughput, exactly as it is today. Only §6.1's architecture removes it by construction.

---

## 4. Popularity and maintenance, measured 2026-09-02

| Library | Repo | ★ | Forks | Open issues | Last push | npm/week | Latest release | Who commits (measured) |
|---|---|---:|---:|---:|---|---:|---|---|
| **Tabulator** | `tabulator-tables/tabulator` | 7 753 | 894 | 386 | 2026-09-01 | **183 812** | 6.5.2 (2026-06-23) | 161 commits since Mar 2026; 4 Beekeeper Studio devs (F9) |
| **SlickGrid (core)** | `6pac/SlickGrid` | 2 066 | 429 | **10** | 2026-09-02 | 13 500 | 5.20.0 (2026-09-02) | 113 commits since Jan 2026; ghiscoding + 6pac + 3 others |
| *(Vue wrapper)* | `ghiscoding/slickgrid-universal` | 174 | 48 | 3 | 2026-09-02 | `slickgrid-vue` **3 209** | 10.10.0 (2026-08-28) | **1 maintainer** |
| **regular-table** | `finos/regular-table` | 403 | 44 | 19 | 2026-08-19 | 19 771 | 0.9.0 (2026-08-11) | 45 commits since Jan 2026, ~all by `texodus`; FINOS-graduated, `MAINTAINERS.md` added May 2026 |
| **@lumino/datagrid** | `jupyterlab/lumino` | 762 | 148 | 116 | 2026-09-01 | **48 714** | 2.5.8 (2026-07-03) | JupyterLab org, multi-maintainer |
| **vue-virtual-scroller** | `Akryum/vue-virtual-scroller` | **10 790** | 973 | 201 | 2026-08-12 | **565 993** | 3.0.5 (2026-08-12) | 1 npm maintainer (`akryum`) |
| **virtua** | `inokawa/virtua` | 3 731 | 114 | 62 | 2026-09-02 | **1 052 834** | 0.51.0 (2026-08-31) | 1 primary author, very high cadence (202 versions) |
| **RevoGrid** | `revolist/revogrid` | 3 440 | 209 | 22 | 2026-09-02 | 31 789 | 4.27.1 (2026-09-02) | small team + paid Pro tier |
| **VTable** (canvas) | `VisActor/VTable` | 3 653 | 486 | **540** | 2026-09-02 | 17 988 (`vue-vtable` 1 800) | 1.26.7 (2026-08-20) | ByteDance/VisActor team |
| **Glide** (canvas) | `glideapps/glide-data-grid` | 5 324 | 426 | 130 | **2026-01-21** | 316 786 | **6.0.3 (2024-02-03)** | stable line frozen 2.5 y |
| **canvas-datagrid** | `TonyGermaneri/canvas-datagrid` | 1 574 | 205 | **148** | 2025-09-18 | 5 744 | **0.4.7 (2023-12-29)** | effectively 1, dormant |
| **TanStack Table** | `TanStack/table` | 28 398 | 3 572 | 60 | 2026-08-31 | `@tanstack/vue-table` 996 232 | 9.2.4 (2026-08-28) | healthy; v9 major is 1 month old |
| **AG Grid** | `ag-grid/ag-grid` | 15 578 | 2 082 | 134 | 2026-09-02 | 3 312 120 | 36.1.0 (2026-08-05) | company-backed |

*(Two licence-metadata footnotes, since this document is strict about them elsewhere:
`jupyterlab/lumino` and `ghiscoding/slickgrid-universal` both report `NOASSERTION` to GitHub's
licence detector; their published packages declare **BSD-3-Clause** and **MIT** respectively, which is
what §5's requirement 1 is judged against.)*

Three readings the table does not make obvious:

- **`vue-virtual-scroller`'s 565 993 downloads/week is the largest real adoption of any Vue-specific
  candidate here** — and it sat unreleased for 3 years before April 2026. High adoption, thin
  maintenance surface. Judge it as "widely used, one maintainer, freshly revived", not as "safe".
- **`virtua` has the highest raw downloads (1.05 M/week) and is irrelevant anyway** (F7). Download
  count is not evidence about the bottleneck.
- **`@lumino/datagrid` is the only candidate whose 48 714 weekly downloads come from a single flagship
  consumer** (JupyterLab). That is *good* for longevity (it will be maintained as long as JupyterLab
  is) and *bad* for API stability guarantees outside that consumer's needs.

---

## 5. Failed a hard requirement — filtered out before ranking

| Candidate | Why it is out | Evidence |
|---|---|---|
| **AG Grid Community** | Requirement 1. **Context Menu, Cell Range Selection and Clipboard are Enterprise** — §1 items #3/#4, the two things a DB client's grid is for. Also +99 % gzip on the launch path (344 065 B vs 348 411 B). | `ag-grid.com/license-pricing`; `P22-grid-library-evaluation.md` §5.2/§5.3 |
| **Handsontable** | Requirement 1. Free tier is *"free for personal, exploratory projects and can't be used in commercial settings"*; commercial from $999/dev. npm `"license": "SEE LICENSE IN LICENSE.txt"`. | `handsontable.com/pricing` |
| **PrimeVue** | Requirement 1, and **this is new since the last survey**. `primevue@5.0.1`'s own `LICENSE.md`: *"This package is part of **PrimeUI**, a family of **commercial** UI libraries"*; the free Community License requires *"Less than $1,000,000 USD in annual gross revenue, Fewer than 5 developers…"* and *"A valid license key is required to use this software."* It also now depends on `@primeui/license-manager`. **PrimeVue is no longer a free-software option.** | `cdn.jsdelivr.net/npm/primevue@5.0.1/LICENSE.md` |
| **Glide Data Grid** (canvas) | Requirement 2 and 3. `peerDependencies` are `react`, `react-dom`, `lodash`, `marked`, `react-responsive-carousel` — no Vue path exists. Last **stable** release `6.0.3`, **2024-02-03**; repo last pushed 2026-01-21. | `registry.npmjs.org/@glideapps/glide-data-grid` |
| **VTable** (canvas, `@visactor/vtable`) | Requirement 5, decisively. `esbuild --bundle --minify` of `ListTable`: **2 070 272 B raw / 511 614 B gzip = +147 % of the whole app bundle**, 2.2× the thing P18 already declined. Real Vue binding exists (`@visactor/vue-vtable`, 1 800/week) and it is MIT and active — size is the only reason it is out, and it is enough. | measured here |
| **canvas-datagrid** | Requirement 3. Last release **2023-12-29**, 148 open issues, repo last pushed 2025-09-18. Architecture is a **full repaint of every visible cell per frame** (`lib/draw.js`, no blit path) with its own scrollbars. | `registry.npmjs.org`, `lib/draw.js` |
| **vxe-table** | Requirement 4 *and* `ARCHITECTURE.md`'s invariant: its data source is a **Vue-reactive array**. Plus 1 345 open issues and Chinese-first docs. | `P22-grid-library-evaluation.md` D3 |
| **Element Plus `TableV2` / Naive UI / Quasar `QTable`** | Requirement 4 (category C, Vue-rendered cells) plus dragging in a whole component framework (`element-plus` unpacked 43.5 MB, `naive-ui` 51.9 MB) for one component. | registry metadata |
| **SVAR Vue DataGrid** | Requirement 3. **1 364 npm/week, 15★** on a repo created 2026-04-17. Genuinely MIT, genuinely Vue 3, genuinely current — and with no adoption base at all. Category (C) besides. | `registry.npmjs.org/@svar-ui/vue-grid` |
| **Grid.js** (41 317/week) | No virtualization at all; last release 2024-03-03. | registry |
| **Toast UI Grid** (`tui-grid`) | Last release **2024-01-10**, 3 943/week. | registry |
| **frappe/datatable** | Thin feature surface, effectively coupled to the Frappe stack; virtualization via `hyperlist`. 70 546/week is almost entirely Frappe itself. | registry, `package.json` deps |
| **jspreadsheet-ce / Luckysheet / x-data-spreadsheet / FortuneSheet / Univer** | Spreadsheet *applications*, not data grids: `jspreadsheet-ce` publishes no SPDX license, `luckysheet` publishes **none** and last shipped 2021-01, `x-data-spreadsheet` last shipped 2021-05, FortuneSheet is React-first, Univer is an Apache-2.0 office suite an order of magnitude past §0.2's yardstick. | registry |
| **DataTables** | jQuery-based; no Vue story worth the name. | — |

---

## 6. The canvas question, answered honestly

### 6.1 The one genuine architectural argument for canvas — and it is about *this* symptom

`P22-…-iter2-rendering.md` §1.2 established the mechanism of the reported lag precisely: on macOS the
**scrolling thread** moves the composited layer at display cadence, and the main thread's newly
painted content arrives one or more frames later; whatever the compositor exposes in between is
whatever the *older* main-thread paint contained. Blank, if the mounted band ended there.

**A canvas grid that drives its own scrollbars cannot exhibit this.** In `@lumino/datagrid` the scroll
offset is a JS variable updated in the `wheel` handler, and the paint happens synchronously in the
same task (F8). There is no composited scroller that can be ahead of the paint, because the paint
*defines* the scroll position. The symptom is not mitigated; it is structurally absent.

**And the trade is exact.** What replaces it is main-thread jank: if a frame's paint overruns, the
whole view stops moving rather than showing a blank strip. Whether that is better is a judgement
about which failure a user prefers — and Lumino's paint is a blit plus one strip (F8), which is the
cheapest per-frame work in this document. Also lost: native macOS scroll physics and rubber-banding,
which Lumino approximates from `wheel` deltas.

### 6.2 What canvas costs, itemised against §1

| What is lost | Cost here |
|---|---|
| **Native text selection** | Real. Selecting a cell's text with the mouse stops working; you implement selection + copy yourself (the app already has `clipboardFormats.ts`, so this is re-wiring, not new code). |
| **Find-in-page (⌘F)** | Real, and note the app's own search is `views/shared/page/search.ts` chunked scanning (§1 item #6) — *not* browser find — so this is a smaller loss than it looks. |
| **Accessibility** | Real and unmitigated. A canvas grid is opaque to screen readers unless you build an ARIA shadow tree. Lumino does not. |
| **CSS theming (§1 item #8)** | Real. `DataGrid.Style` is a JS object of colour strings; the Tailwind v4 tokens would have to be read via `getComputedStyle` on theme change and pushed in. A second source of truth, but a *bridged* one. |
| **Cell content = paint code** | §1 items #5, #6, #7 (type colours, search highlight, FK/PK glyphs) become `CellRenderer` paint calls. `CodiconIcon` becomes a glyph drawn from the icon font into the canvas. |
| **The whole `tests/ui/` selector surface** | `[data-testid="grid-row"]`, `.grid-cell[data-row]` and every DOM assertion in `data-view.spec.ts`, `mutations.spec.ts`, `interaction.spec.ts`, `row-coloring.spec.ts`, `budgets.spec.ts` cease to exist. This is the largest single line-item of a canvas migration and it also means the phase runs with **no** performance gate — the exact condition `P22-…-iter2-rendering.md` §0.5 was ordered to prevent. |
| **Editing / menus** | Lumino has `CellEditor` (`src/celleditor.ts`, 45 KB) and `BasicSelectionModel`; context menus are `grid.hitTest(x, y)` plus the app's own Vue menu — which `menu.ts` already is. |

### 6.3 Is there any canvas grid with real Vue support?

Checked, not assumed: **`@visactor/vue-vtable` is the only one** — a first-party Vue 3 binding in the
same monorepo as `@visactor/vtable`, MIT, released in lockstep (1.26.7, 2026-08-20). It is out on size
alone (§5, 511 614 B gzip). Glide is React-only by `peerDependencies`; `canvas-datagrid` is a web
component (usable from Vue, but dormant since 2023); `@lumino/datagrid` is framework-agnostic and has
**no** first-party Vue wrapper — integration is `Widget.attach(grid, el)` in `onMounted`, with a stale
community helper (`@tupilabs/vue-lumino`, 2020) and Vue examples in the Lumino repo. For this app,
"mount an imperative widget on a `ref`" is the same integration shape SlickGrid, Tabulator and
regular-table all need, so it is not a differentiator.

---

## 7. The memory half, once

`docs/WEBVIEW-SCROLL-MEMORY.md` §5–§7 and `P22-webview-scroll-performance-iter2-memory.md` established
the ~1 GB plateau is WebKit compositor tile pooling driven by the scrolled layer's geometry and the
scroll velocity, and that varying painted content changed it by ~0 %. **Every DOM candidate in §8
produces the same input to that machinery: a tall scroller with a mounted band inside it. None is
credited with helping.** Worse, F10's remedy for blank rows — a larger buffer — pushes on it in the
wrong direction, exactly as `P22-…-iter2-rendering.md` D3(d) says of the app's own fix.

The one honest wrinkle, recorded without re-litigating anything: a **canvas grid with synthetic
scrollbars has no tall composited scroller at all** — it is one viewport-sized canvas. Whether that
changes the plateau is **unmeasured and unclaimed here**; the memory investigation's finding that an
*empty scroller* already costs about half the plateau suggests it would not vanish. If the user ever
wants that question answered, it is a 20-minute experiment with the same Swift host in
`WEBVIEW-SCROLL-MEMORY.md` appendix A, and it is not this document's claim.

---

## 8. The ranking

Marked **[DOM]** / **[CANVAS]**. Ordered by fit for *this* app, not by general merit.

### #1 — SlickGrid core (`slickgrid@5.20.0`, `6pac/SlickGrid`) — [DOM], category (A)

| | |
|---|---|
| License | **MIT**, core and every plugin (context menu, cell external copy manager, editors) |
| Size | **197 393 B raw / 47 890 B gzip** (`SlickGrid` + `SlickDataView`, esbuild+gzip -9) = **+13.7 %** |
| Vue | No first-party wrapper worth taking (`slickgrid-vue`: 1 maintainer, 3 209/week). Mount the core on a `ref` — ~150 lines. |
| Health | Core: 113 commits since Jan 2026, 2 primary maintainers, **10 open issues**, released the day of this survey |

**Plus.** The best data-model fit in the survey by a distance (F1: `CustomDataView` +
`getCellValue(index, field)` — P5 C1's contract, in the API). Category (A). Direction-biased
one-viewport runway *and* 10 ms render throttling already built in. Every feature the app needs is in
an MIT package — items #3 and #4, the two cells where AG Grid is a hard ✗, are `L` here. Smallest
full-featured bundle. Renders entirely outside Vue's reconciler.
**Minus.** You write and own the Vue wrapper (the healthy thing is the *core*; the wrapper's bus
factor is 1 — which is precisely why you should not take the wrapper). 2 066★/13 500 downloads is a
small community for a grid this central. An old-school imperative API with string-ish formatters; the
theming is CSS/SASS and would need a Tailwind-token bridge. Nothing about it is velocity-aware, so the
app's `rowRangeExtractor` work would be re-expressed as a `minRowBuffer` / custom range override.

### #2 — Tabulator (`tabulator-tables@6.5.2`) — [DOM], category (A)

| | |
|---|---|
| License | **MIT**, everything, **no tiers at all** |
| Size | **63 352 B gzip** for a 10-module feature-scoped build (Edit, Format, Menu, SelectRange, Clipboard, ResizeColumns, Sort, Filter, Keybindings, Interaction) = **+18.2 %**; 103 187 B gzip for `TabulatorFull` |
| Vue | No official component package; the official docs (`tabulator.info/docs/6.x/vue/`) document mounting on a `ref` with options/composition API. Community wrappers exist and are not needed. |
| Health | **183 812/week**, 7 753★, 386 open issues, maintained by **Beekeeper Studio** since May 2026 (F9) |

**Plus.** By far the largest adoption of any fully-open candidate here, and the maintainer is a team
shipping the same product category (an SQL client whose result grid *is* Tabulator) — the single best
real-world track record on this exact workload. Category (A). Menus, range selection, clipboard,
editing, tooltips, spreadsheet-range semantics all free. Both-axis virtualization
(`renderHorizontal: "virtual"`). Excellent docs.
**Minus.** F3: it materialises a `Row` object per page row and wants an array of plain row objects —
the one candidate that actively fights §1 item #9/#10 and `perf.spec.ts`'s retained-bytes gate. F2's
`_virtualRenderFill` fallback means a hard fling can trigger a **full window rebuild** rather than an
edge update. 2× SlickGrid's bytes. Positioning is `padding-top/bottom` against an *estimated*
`vDomRowHeight`, so scrollbar geometry on a 10 000-row page is approximate (a known source of
scroll-jump reports). Documented white-space-on-fast-scroll issues (F10) — as every DOM grid has.

### #3 — regular-table (`regular-table@0.9.0`, FINOS) — [DOM], category (D)

| | |
|---|---|
| License | **Apache-2.0** |
| Size | **28 739 B raw / 9 858 B gzip = +2.8 %** — the whole package |
| Vue | Framework-agnostic custom element; no wrapper needed or offered |
| Health | FINOS-**graduated**, 0.9.0 on 2026-08-11, 19 771/week — but ~all commits by one author (`texodus`) |

**Plus.** The exact data model this app already has: `setDataListener((x0, y0, x1, y1) => …)`, async,
window-scoped — items #9 and #10 satisfied by construction (F4). A genuine `<td>` pool with
value-guarded writes, so per-frame cost is O(window) *comparisons* and O(changed) *writes*, with zero
allocation. Real DOM: text selection, find-in-page, accessibility, and **Tailwind tokens** all keep
working, so item #8 is free. One fifth of SlickGrid's bytes. Actively performance-tuned on exactly this
axis in 2026 — PR #251 *"Fix render frame lag issue"*, #248 *"Add benchmark suite and profile-guided
optimizations"*, #284 *"Profile-guided performance optimization for scrolling"*. It is the rendering
engine under FINOS Perspective, i.e. proven on very large financial datasets.
**Minus.** Bus factor **1** (mitigated, not solved, by FINOS governance and a `MAINTAINERS.md` added
May 2026). It is a *renderer*, not a grid: no editing, selection, menus or clipboard — you keep all
2 900 of the app's own lines and re-point them at pooled `<td>`s, which also means cell content stops
being Vue templates and becomes imperative DOM/`addStyleListener` writes (`CodiconIcon` included). No
overscan concept — runway would have to be added by the app, on top of its throttled draw. 403★ is a
small community even if the download count is respectable.

### #4 — `@lumino/datagrid@2.5.8` (JupyterLab) — [CANVAS], category (E)

| | |
|---|---|
| License | **BSD-3-Clause** |
| Size | **317 382 B raw / 76 490 B gzip = +22.0 %** (`DataGrid` + `BasicSelectionModel` + mouse/key handlers + `TextRenderer`, including its `@lumino/widgets` dependency) |
| Vue | None first-party. `Widget.attach(grid, el)` in `onMounted`; Lumino's repo carries Vue examples, `@tupilabs/vue-lumino` is stale (2020) |
| Health | Multi-maintainer org, 48 714/week, 2.5.8 on 2026-07-03, repo pushed 2026-09-01 |

**Plus.** The cheapest per-frame work in the survey: blit + paint-the-delta (F8). Per-cell data pull
(`dm.data(region, row, col)`) fits item #9 exactly. **§6.1: the reported symptom is structurally
impossible**, because paint and scroll offset are computed in the same task. Backed by an
institution, not a person. Has editors, a selection model with cell ranges, and hit-testing to hang
the app's own context menus off.
**Minus.** Everything in §6.2: no native text selection, no find-in-page, no accessibility, theming
via a JS style object instead of CSS tokens, all per-cell rendering rewritten as canvas paint, and
**the entire `tests/ui/` DOM-selector surface invalidated at once** — including the performance gates,
which is the specific condition the rendering plan was ordered to avoid. Synthetic scrollbars will not
look or feel like macOS native ones. No Vue wrapper exists, and its API is stable in service of
JupyterLab's needs, not yours.

### #5 — `vue-virtual-scroller@3.0.5` — [DOM], category (B) with a real pool

**Plus.** MIT; **565 993/week and 10 790★** — the most-adopted Vue-specific option; a genuine view
pool with reference-stable items (F6), so retained rows hit Vue's bail-out *and* keep their DOM
identity; 10 078 B gzip; revived and actively released through August 2026.
**Minus.** It is a **list virtualizer, not a grid** — one axis, no columns, no features — so it
replaces `@tanstack/vue-virtual` and nothing else, and this app's 61-column tables still need its own
column extractor. The property it provides (category B) is the property the app **already landed**
(`GridRow` + `rowVmCache`). One npm maintainer, 201 open issues, and a 3-year release gap immediately
behind it. Its default `transform` mode adds `will-change: transform` per row, which the rendering
plan explicitly declined.
**Verdict**: a good library; not a fix for this bottleneck.

### #6 — RevoGrid `4.27.1` — [DOM], category (C)

**Plus.** MIT core, both-axis virtualization, first-party generated Vue 3 wrapper
(`@revolist/vue3-datagrid`, 11 277/week), active daily, 3 440★, ~118 KB gzip.
**Minus.** F5, re-verified at the current version: full nested rebuild of every visible cell, a
spread-allocated model per cell, a fresh Stencil VNode per cell, **and a DOM `CustomEvent` dispatched
per cell per render**. Adopting it is a *regression* against the current tree. Web-component boundary
also means marshalling frozen page structures across property assignment. A paid **Pro** tier exists
(≈$499/dev/yr) for advanced features — not disqualifying today, but it is an open-core product.

### #7 — `virtua@0.51.0` — [DOM], category (C) in Vue

**Plus.** 1 052 834/week, MIT, extremely active, tiny (6 239 B gzip for the Vue entry), best-in-class
API design.
**Minus.** F7: **no `VGrid` for Vue** (React-only), and the Vue `Virtualizer` re-invokes the slot per
index per render. Zero delta over the incumbent `@tanstack/vue-virtual`.

### #8 — TanStack Table v9 + `@tanstack/vue-virtual` — [DOM], category (C) = status quo

Unchanged from `P22-grid-library-evaluation.md` F6: headless means 100 % of the render cost stays in
this app's Vue templates. It would bring column-model/sort/filter primitives the app already owns in
`state.ts`/`sortTerms.ts`/`columns.ts`. Also: **v9.0.0 is one month old** (2026-08-04) with four
releases in three weeks after it.

---

### 8.1 Comparison table

All figures 2026-09-02. gzip figures are `esbuild --bundle --minify --format=esm` + `gzip -9`,
measured here, against the app's launch chunk of **348 411 B gzip**.

| | **SlickGrid core** | **Tabulator** | **regular-table** | **@lumino/datagrid** | **vue-virtual-scroller** | **RevoGrid** | **virtua** | **Status quo** |
|---|---|---|---|---|---|---|---|---|
| **Canvas?** | no | no | no | **yes** | no | no | no | no |
| **Retained-row cost (§2)** | **(A)** none | **(A)** none | **(D)** pooled slot, value-guarded write | **(E)** blit + paint delta | **(B)** pooled, ref-stable | **(C)** rebuild + Stencil diff + per-cell `CustomEvent` | **(C)** in Vue | **(B)** ref bail-out |
| **Outside Vue's reconciler?** | yes | yes | yes | yes | no | yes (WC) | no | no |
| **License** | MIT | **MIT** | Apache-2.0 | BSD-3 | MIT | MIT (open-core) | MIT | — |
| **Any paid gate?** | **none** | **none** | none | none | none | Pro tier | none | none |
| **gzip (esbuild)** | **47 890 (+13.7 %)** | 63 352 scoped / 103 187 full (+18 %/+30 %) | **9 858 (+2.8 %)** | 76 490 (+22 %) | 10 078 (+2.9 %) | ~118 784 (+34 %) | 6 239 (+1.8 %) | **0** |
| **Both-axis virtualization** | yes | yes (opt-in) | yes | yes | **rows only** | yes | **rows only (Vue)** | yes |
| **Fits item #9 (decode-on-entry)** | **`getCellValue(i, field)`** | **no** — materialises `Row`/row objects | **`setDataListener(x0,y0,x1,y1)`** | **`data(region,row,col)`** | n/a (no data layer) | needs a source array | n/a | native |
| **Ships items #3/#4 (menus, range+clipboard)** | **yes, MIT plugins** | **yes, MIT modules** | no (keep ours) | partial (selection model + hitTest) | no | yes | no | ours |
| **★ / npm week** | 2 066 / 13 500 | 7 753 / **183 812** | 403 / 19 771 | 762 / 48 714 | **10 790 / 565 993** | 3 440 / 31 789 | 3 731 / 1 052 834 | — |
| **Open issues** | **10** | 386 | 19 | 116 | 201 | 22 | 62 | — |
| **Bus factor** | 2 (core) / 1 (Vue wrapper) | **team (Beekeeper Studio)** | **1** (FINOS-governed) | **org (JupyterLab)** | 1 | small team | 1 | — |
| **Keeps CSS theme, text selection, ⌘F, a11y** | yes | yes | yes | **no** | yes | yes | yes | yes |
| **`tests/ui/` selector rewrite** | large | large | large | **total** | small | large | none | none |
| **Verdict** | **Top pick** | **Top pick (feature-first)** | **Top pick (minimal-footprint)** | **The canvas experiment** | not a grid | decline (architecture) | decline (no delta) | the incumbent |

---

## 9. My honest read — input to the decision, not the decision

**If I had to pick one: SlickGrid's core, wrapped by hand.** Not because it is fashionable — it is the
least fashionable option here — but because it is the only candidate that clears *all four* of the
things this app specifically needs and cannot easily work around: category (A) rendering, a
non-row-materializing data source (`getCellValue`, F1), context menus + range selection + clipboard in
MIT packages, and a bundle the repo's own precedents can accept (+13.7 %). The previous evaluation's
only objection to it was bus factor — and that objection was aimed at the wrong artefact. The Vue
*wrapper* is one maintainer and 3 209 downloads/week; the **core** is two active maintainers, 113
commits since January, 10 open issues, and a release published the day this survey was written. The
correct move is to take the core and own ~150 lines of `onMounted` glue, which is also the move that
keeps the grid out of Vue's reconciler entirely.

**The close second, and the better pick if the goal is "stop hand-rolling features": Tabulator.** It
is the strongest *product* in the survey and it has the one credential nobody else has — since May
2026 it is maintained by the team behind an open-source SQL client that ships it as its own result
grid (F9). If the migration's purpose is to delete `menu.ts`, the range-drag code and half of
`clipboardFormats.ts`, Tabulator deletes more of them than anything else that is free. The price is
F3: it wants the page materialised, which is a direct argument with P5 C1 and the retained-bytes gate,
and that is the thing to prototype first if you go this way.

**The one I would actually spend a day prototyping before deciding: regular-table.** 9 858 bytes, an
Apache-2.0 FINOS project, a data model that is *already* this app's data model, a real cell pool, and
2026 commits whose titles are literally "Fix render frame lag issue" and "Profile-guided performance
optimization for scrolling". It buys the least product surface and the most architectural fit, at
a fifth of SlickGrid's bytes. Its bus factor is the real risk — but the entire library is **4 360
lines of TypeScript** (`src/ts/*.ts`), which is a fork you could actually carry if you had to. That is
not true of Tabulator (743 193 B of unminified ESM against regular-table's 28 854 B) or AG Grid.

**On canvas.** `@lumino/datagrid` is the only serious candidate, and §6.1 is the only argument in this
document that would make the reported symptom *impossible* rather than *smaller*. If the real-Mac
trace (`P22-…-iter2-rendering.md` §7.3) comes back saying the runway is the constraint and no amount
of overscan fixes it, Lumino stops being exotic and becomes the answer. Until then, §6.2's bill —
accessibility, text selection, theming, and the simultaneous invalidation of every `tests/ui/`
selector *and* every performance gate — is too much to pay on a hypothesis.

**And the caveat that applies to all four.** F10: every DOM candidate here has "blank rows while
scrolling fast" in its issue tracker, with the same remedy the app already implemented by hand.
`P22-…-iter2-rendering.md` §7.3's twenty-minute real-trackpad protocol still has not been run, and it
is the only thing that can distinguish "the renderer is too slow" (SlickGrid/Tabulator help) from "the
runway is too short" (nothing helps but a bigger number) from "the cost is below JS" (only §6.1
helps). Whatever is chosen, run that first — it costs twenty minutes and it is the difference between
choosing a library and choosing one for a reason.

---

## 10. Sources

**Measured here, 2026-09-02**: `bun run build` in this checkout for §0.2; `esbuild --bundle --minify
--format=esm` + `gzip -9` for every size figure in §8; `registry.npmjs.org/*` and
`api.npmjs.org/downloads/point/last-week/*` for versions, licenses and downloads; GitHub repository
and commit-search APIs for stars/forks/issues/`pushed_at` and commit authorship;
`data.jsdelivr.com` / `cdn.jsdelivr.net` for published source.

**Library source read directly**
- [`6pac/SlickGrid` — `src/slick.grid.ts`](https://github.com/6pac/SlickGrid/blob/master/src/slick.grid.ts) (verified against `slickgrid@5.20.0`'s `dist/browser/slick.grid.js`)
- [`tabulator-tables/tabulator` — `src/js/core/rendering/renderers/VirtualDomVertical.js`](https://github.com/tabulator-tables/tabulator/blob/master/src/js/core/rendering/renderers/VirtualDomVertical.js), `core/RowManager.js`, `core/row/Row.js`, `core/defaults/options.js`, `core/modules/optional.js`
- [`finos/regular-table` — `src/ts/view_model.ts`, `src/ts/tbody.ts`, `src/ts/scroll_panel.ts`](https://github.com/finos/regular-table) (v0.9.0)
- [`jupyterlab/lumino` — `packages/datagrid/src/datagrid.ts`](https://github.com/jupyterlab/lumino/tree/main/packages/datagrid) (v2.5.8)
- [`revolist/revogrid` — `components/data/revogr-data`](https://github.com/revolist/revogrid/blob/main/src/components/data/revogr-data.tsx) (verified against `@revolist/revogrid@4.27.1`'s `dist/collection`)
- [`Akryum/vue-virtual-scroller` — `dist/useRecycleScroller-*.js`](https://github.com/Akryum/vue-virtual-scroller) (v3.0.5)
- [`inokawa/virtua` — `lib/vue/index.js`, `lib/react/VGrid.d.ts`](https://github.com/inokawa/virtua) (v0.51.0)

**Licensing and docs**
- [PrimeVue `LICENSE.md`](https://cdn.jsdelivr.net/npm/primevue@5.0.1/LICENSE.md) · [Handsontable pricing](https://handsontable.com/pricing) · [AG Grid license & pricing](https://www.ag-grid.com/license-pricing) · [RevoGrid pricing](https://rv-grid.com/pricing)
- [Tabulator — Vue docs](https://www.tabulator.info/docs/6.x/vue/) · [Tabulator — frameworks](https://www.tabulator.info/docs/6.x/frameworks/) · [Beekeeper Studio](https://github.com/beekeeper-studio/beekeeper-studio) (`apps/studio/src/common/tabulator.ts`) · [Oli Folkerd — *"As of May 2026 Tabulator is now maintained by Beekeeper Studio"*](https://www.patreon.com/olifolkerd)
- Tabulator fast-scroll issues: [#1679](https://github.com/tabulator-tables/tabulator/issues/1679), [#4631](https://github.com/tabulator-tables/tabulator/issues/4631), [#4525](https://github.com/tabulator-tables/tabulator/issues/4525)
- [regular-table README](https://cdn.jsdelivr.net/npm/regular-table@0.9.0/README.md) · [Lumino API docs](https://lumino.readthedocs.io/) · [`@tupilabs/vue-lumino`](https://github.com/tupilabs/vue-lumino)
- [Glide Data Grid](https://github.com/glideapps/glide-data-grid) · [VisActor/VTable](https://github.com/VisActor/VTable) · [canvas-datagrid](https://github.com/TonyGermaneri/canvas-datagrid) · [SVAR Vue DataGrid](https://github.com/svar-widgets/vue-grid)

**In-repo**: `docs/ARCHITECTURE.md`, `docs/PERF.md`, `docs/WEBVIEW-SCROLL-MEMORY.md`,
`docs/v1.1/plans/P22-grid-library-evaluation.md`,
`docs/v1.1/plans/P22-webview-scroll-performance-iter2-rendering.md`,
`docs/v1.1/plans/P22-webview-scroll-performance-iter2-memory.md`,
`docs/v1.1/plans/P13-query-console-format-button.md`,
`docs/v1.1/plans/P15-fake-data-generator.md`,
`docs/v1.1/plans/P18-sql-language-server-explain.md`, `docs/v1.1/plans/P5-ram-usage.md`.
