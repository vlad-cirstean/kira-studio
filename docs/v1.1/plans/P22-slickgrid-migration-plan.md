# P22 — migrating the SQL data view onto SlickGrid's core, with a hand-rolled Vue host

> **The user's decision, already made**: adopt `6pac/SlickGrid`'s **core** (MIT, `slickgrid@5.20.0`)
> for `views/grid/DataGrid.vue`, with a **from-scratch Vue integration layer** — explicitly *not*
> `slickgrid-vue`, whose bus factor is 1 (`P22-grid-library-survey.md` §4, §9). This document does
> not re-open that choice, does not re-run the survey, and does not re-price the alternatives. It is
> the implementation plan.
>
> **What it adds that the two surveys could not.** Both prior documents read SlickGrid's source to
> answer *one* question — "what does a retained row cost per frame?" — and answered it correctly
> (category (A): nothing). Building on it needs a different read, and that read turns up **four
> things neither document knew**, two of them load-bearing:
>
> 1. **`getCellValue(index, field)` is not on the render path.** The survey's headline finding —
>    that SlickGrid's `CustomDataView` seam matches this app's decode-on-entry contract via
>    `getCellValue` — is *half* right. `getCellValue` exists and its doc comment says exactly what
>    the survey quotes, but reading every call site in `dist/esm/index.js` shows it is called from
>    **one place only: `autosizeColumns` (`:8456`)**. The actual render path is
>    `appendRowHtml` → `getDataItem(row)` → `appendCellHtml` → `getDataItemValueForColumn(item, m)`
>    (`:9905`, `:9961`, `:8862`). **The seam that actually matters is the
>    `dataItemColumnValueExtractor` grid option** — and it is a *better* fit than `getCellValue`,
>    because it receives the column definition and is called once per *rendered* cell. §3 F1.
> 2. **`SlickDataView` is not needed at all, and dropping it is 6 KB gzip.** Measured here:
>    `{ SlickGrid }` alone bundles to **41 947 B gzip**; adding `SlickDataView` costs 5 945 B for a
>    grouping/paging/filtering engine this app's `page.ts`/`search.ts`/`state.ts` already own. §3 F9.
> 3. **`enableColumnReorder` defaults to `true` and throws without a `Sortable` global.**
>    `dist/esm/index.js:7537-7538` — `throw new Error("SlickGrid requires Sortable.js module to be
>    loaded")`, and `Sortable` is a *free identifier* in the ESM bundle (no import; `sortablejs` is a
>    runtime dependency expected on `window`). This app reorders columns in `ColumnsMenu.vue`, not by
>    dragging headers, so the fix is `enableColumnReorder: false` — but a spike that omits it fails at
>    construction with a message that points nowhere useful. §3 F7.
> 4. **Formatters can return real DOM nodes, and `enableHtmlRendering` can be turned off.**
>    `applyHtmlCode` (`:9472-9486`) takes `HTMLElement | DocumentFragment` and `appendChild`s it;
>    only a *string* result goes near `innerHTML`, and only when `enableHtmlRendering` is true.
>    Cell text here is untrusted database content, so this is a security decision, not a style one.
>    §3 F6, §6 D6.
>
> **And the one that decides the shape of the phase.** SlickGrid's own runway is **smaller than this
> app's**. `getRenderedRange` (`:10257-10259`) grants one *viewport height* in the direction of
> travel and `minRowBuffer: 3` rows (84 px at 28 px density) on the other side — and at rest, 3 rows
> on **both** sides against this app's current symmetric 560 px. It is direction-biased, which the
> app had to build by hand; it is not velocity-adaptive, which the app already is. **Adopting
> SlickGrid at its defaults would make the reported symptom worse**, exactly as
> `P22-grid-library-evaluation.md` F4 predicted for AG Grid. §3 F4, §6 D4.
>
> **Therefore this plan is spike-first**, and §7 says what the spike must prove, measurably, before
> §8's parity migration is allowed to start. §7.0 argues that against the full-migration-first
> alternative rather than defaulting to it.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

- Branch `claude/feature-v1-1-p5-onwards-2isfzt` at **`78389be`**, read **2026-09-02**.
- The target: `apps/kira-studio/frontend/src/views/grid/DataGrid.vue` (**2 146 lines**), plus
  `views/grid/GridRow.vue` (335), `views/grid/rowVm.ts` (108), and the row-axis half of
  `views/shared/page/columns.ts` (350). Its parent is `views/grid/DataView.vue` (324); its
  neighbourhood is `menu.ts` (425), `state.ts` (340), `pendingChanges.ts` (232),
  `clipboardFormats.ts` (158), `page.ts` (42), `search.ts`, `sortTerms.ts`, `fakeData/`.
- The second consumer of `columns.ts`: `views/console/ConsoleResultGrid.vue` (703). §2.3 rules on it.
- **`slickgrid@5.20.0`**, MIT, published 2026-09-02. Every claim below about the library is read
  from `dist/esm/index.js` (12 265 lines) or `dist/types/*.d.ts` in the published tarball, extracted
  and read in this session, and cited by line. Nothing here comes from a wiki page or a landing page.
- Every bundle number below was measured **in this session**, in a scratch dir, with
  `esbuild@0.28.2 --bundle --minify --format=esm` + `gzip -9` — the same method
  `P13-query-console-format-button.md` F3 and `P22-grid-library-survey.md` §0.1 used, so it is
  comparable to this repo's own precedents.
- The yardstick: the app's launch chunk at **348 411 B gzip** (`P22-grid-library-survey.md` §0.2,
  measured 2026-09-02 — the same day, the same tree). §9.1 re-measures it for real.

### 0.2 Scope

1. Read the current `DataGrid.vue` in full and enumerate its *actual* feature surface (§2), not a
   generic grid checklist, and not the summary prose in the two survey documents.
2. Read SlickGrid 5.20.0's own source for every extension point the migration depends on, and
   correct the two surveys where they are wrong (§3).
3. Design the data bridge — the single most load-bearing decision (§6 D1/D2).
4. Design the Vue host, on `CodeMirrorHost.vue`'s established shape, with a named, testable
   `destroy()`-on-unmount requirement (§6 D3).
5. Design the theming bridge against the app's real token file (§6 D7).
6. Map every §2 feature to a SlickGrid extension point, honestly labelled (§5).
7. Split the work into two sequential passes with their own exit criteria (§7, §8).

### 0.3 Not in this phase

- **The memory half.** `docs/WEBVIEW-SCROLL-MEMORY.md` and
  `P22-webview-scroll-performance-iter2-memory.md` closed it: the ~1 GB CoreAnimation/IOSurface
  plateau is WebKit compositor tile behaviour for the scrolled layer, near-independent of what paints
  inside it. **SlickGrid is credited with zero here**, exactly as every candidate in the survey was
  (`P22-grid-library-survey.md` §7). If anything it pushes the wrong way — §6 D4 raises the mounted
  band during a fling by design, which is the same trade `P22-…-iter2-rendering.md` D3(d) already
  priced.
- **`ConsoleResultGrid.vue`.** Deliberately deferred, with reasons, in §2.3. This is a decision, not
  an omission.
- **Re-litigating the library choice.** Settled. If the spike (§7) fails its exit criteria, the
  outcome is *not* "try Tabulator next" — it is §11's first open question, which is a question about
  where the cost actually is, not about which grid.
- **Deleting `@tanstack/vue-virtual`.** It stays a dependency for the console, key-value, document
  and stream views and for `theme/primitives/VirtualList.vue`. Only `DataGrid.vue`'s two virtualizers
  go away.
- **Any Go-side work.** This phase touches `frontend/`, `tests/ui/`, `tests/unit/` and `docs/` only.

### 0.4 Ground rules

- **Read the library's source, cite the line.** Both prior P22 halves have the same postmortem: a
  confident conclusion drawn from an instrument (or a doc comment) that could not see the thing being
  claimed. The `getCellValue` correction in this document's header is that failure caught once more,
  in the survey this plan is implementing — *the doc comment was accurate and the inference from it
  was wrong.* Every design decision below cites the call site, not the comment.
- **The sandbox does not get to certify a fix.** Carried verbatim from
  `P22-…-iter2-rendering.md` §0.4. §9 keeps "provable here" and "real-Mac only" in separate columns
  and §10's checklist never accepts a sandbox number for a real-Mac item.
- **The old grid stays mounted and green until the new one has earned its place.** §7's spike is
  *additive*: a second component behind a runtime switch, with `tests/ui/` still running against
  `DataGrid.vue` unchanged. This is the direct answer to `P22-grid-library-evaluation.md` §7's third
  named risk — *"the phase would run with **no** performance gate for its whole duration"* — which is
  the precise condition `P22-…-iter2-rendering.md` §0.5 was ordered to prevent.
- **No feature is dropped silently.** §5's table has a row for every one of §2's 31 items, and a
  feature that is genuinely lost or degraded is marked as such in this document before any code is
  written, not discovered during implementation.

### 0.5 Two passes, and why the split is real

`AGENTS.md`: *"Default to one sequential subagent for the whole phase… Use multiple subagents in
parallel only when the plan's own work is genuinely independent and parallelizable."* The split here
is **not** parallelism. It is a sequential gate with a human measurement in the middle:

- **Pass A — the spike (§7).** Data bridge + core rendering + theming + runway + host lifecycle,
  behind a runtime switch, with the existing grid untouched. Ends with a build the user can run on
  real macOS and A/B against today's grid with `window.__kiraScrollTrace`.
- **[gate] The user's real-hardware verdict.** §7.4's exit criteria, measured, not guessed.
- **Pass B — feature parity (§8).** Only if the gate passes. Editing, selection, menus, clipboard,
  keyboard, inserts, search, then the cutover and the `tests/ui/` selector rewrite.

Per `AGENTS.md`'s multiple-passes rule, **Pass B gets its own plan file**
(`P22-slickgrid-migration-plan-iter2.md`), written by an Opus subagent against the tree *after* Pass
A lands and *with* the real-hardware numbers in hand — not against this document's guesses. §8 is
therefore a complete design (so the size of the bet is visible now, and so Pass A's seams are built
to receive it) but **not** the commit list a Sonnet subagent executes; §8.6 says exactly what that
later plan must re-derive.

---

## 1. What the target does today — read from the current source

`DataGrid.vue` at `78389be` is not the file either survey describes. Since `P22-…-iter2-rendering.md`
landed (`bc654f9`, `a94f1d4`, `6587148`), it is already **category (B)** — a per-row child component
with a reference-stable `RowVM` prop and a signature memo — with delegated events and a
velocity-adaptive, direction-biased row window. Three consequences for this plan:

1. **The baseline to beat is not the pre-P22 grid.** The ~800 allocations and ~4 250 property
   comparisons per frame that `P22-grid-library-evaluation.md` §2 tabulates are already gone. What
   SlickGrid buys on throughput is (A) over (B): *no visit at all* for a retained row versus *one
   reference comparison plus one skipped component vnode*. A constant factor on a fixed complexity
   class — which is precisely why `P22-grid-library-evaluation.md` D1 declined the migration and why
   §7's spike exists to test whether the constant is perceptible.
2. **The runway logic is the part that must survive.** `rowRangeExtractor` (`columns.ts:256-296`)
   and its constants (`BASE_LEAD_PX`/`BASE_TRAIL_PX` = `OVERSCAN_PX` = 560, `LEAD_FRAMES` = 6,
   `MAX_LEAD_PX` = 2 400, `CELL_BUDGET` = 2 200) plus `MAX_PLAUSIBLE_ROW_VELOCITY_PX_PER_FRAME`
   = 800 (`DataGrid.vue:376`) are the app's only defence against the reported symptom, and
   SlickGrid has nothing equivalent (§3 F4). They must be carried across, not re-derived.
3. **The instrumentation must keep working across the switch**, or the spike cannot be measured
   against the incumbent at all. §6 D9.

### 1.1 The per-frame render path today

`onScroll` (`:393-408`) → `scrollTrace.noteScrollEvent` + velocity sampling → rAF-coalesced
`syncScrollState`. Separately, `observeScrollElementOffset` (`columns.ts:175-209`) notifies each
virtualizer synchronously on the same native `scroll` event → `markScrollWork` → the four primitive
index computeds (`rowStart`/`rowEnd`/`colStart`/`colEnd`, `:509-520`) → `visibleRows` →
`renderRows` (`:1423-1472`, the `rowVmCache` signature memo) → `<GridRow v-for>` (`:1915`) → Vue's
`shouldUpdateComponent` bail-out for every row whose `RowVM` reference did not change.

### 1.2 The data path today, and the invariant it exists to satisfy

`docs/ARCHITECTURE.md` Invariants: *"No Vue reactivity on row data. Rows live in plain frozen typed
structures; the grid reads them imperatively and re-renders on an explicit version counter."*

Concretely: `page.ts`'s `cell(tabId, row, col)` decodes a cell from the frozen `TabularPage`'s typed
chunk **on first sight** and memoises both the decoded string (`store.cached`) and the built
`CellView` object (`store.cachedView`, `store.ts:152-164`); `setVisibleWindow` (`store.ts:166-178`)
prunes both caches to the mounted row window on every window change. `perf.spec.ts`'s retained-bytes
check and `__kiraRetention.decodeCacheRows` gate this (P5 C1). `displayCell` (`:781-797`) layers a
staged edit over the result without touching either cache.

**This is the contract the whole migration lives or dies on.** §6 D1.

---

## 2. The feature inventory — every item, from the actual file

Thirty-one items. `L` = a SlickGrid extension point does it with configuration; `M` = the seam exists
and this app's semantics need real glue on top; `H` = hand-rolled against SlickGrid's event surface,
no help from the library; `—` = not grid-internal, costs nothing. §5 turns this into the mapping
table; here it is only the inventory, so nothing can be quietly forgotten later.

| # | Feature | Where it lives today |
|---|---|---|
| 1 | Row virtualization in *display-position* space (filtered rows are never virtualized) | `:475-503`, `displayPositionOf`/`rowAtDisplayPosition` `:290-307` |
| 2 | Column virtualization, pixel-budgeted, 12-column per-side cap | `:448-462`, `columns.ts:102-134` |
| 3 | Velocity-adaptive, direction-biased row runway with a cell budget | `columns.ts:256-296`, `rowVelocity()` `:381-390` |
| 4 | Sticky header row | `:1843-1905`, `.header-row { position: sticky }` `:1995` |
| 5 | Sticky row-number gutter, numbering across pages (`pageIndex * pageSize + row + 1`) | `GridRow.vue:49-57`, `rowNumberBase` `:318-321` |
| 6 | Select-all corner cell | `:1844-1851`, `onSelectAll` `:1240-1253` |
| 7 | Header: label, PK/FK badge, sort chevron + multi-sort order badge | `:1868-1887`, `keyLabelFor` `:216-222` |
| 8 | Header structured tooltip (name / dataType / glossary / DB comment) | `headerTooltips` `:150-160`, `columns.ts:338-350` |
| 9 | Header click cycles asc → desc → none, mirrored into ORDER BY | `onHeaderClick` `:611-619` |
| 10 | Column resize by drag, persisted to tab state | `:621-640` (pointer capture) |
| 11 | Column select zone (10 px strip at the header's left edge) | `:1888-1896`, `onHeaderSelectClick` `:1209-1232` |
| 12 | Column order / projection (external menu) + `resolveColumnOrder` | `ColumnsMenu.vue`, `columns.ts:304-311` |
| 13 | Cell body: text, `NULL` italic, truncated `…` marker with its own tooltip | `GridRow.vue:79-91` |
| 14 | FK/PK nav button, hover- or selection-revealed, codicon | `GridRow.vue:95-104`, `cellNavEntry` `:1319-1345` |
| 15 | Type-based cell colour (P9 `rowColoring` setting) with an explicit priority rule | `colorForColumn` `:123-127`, `CellVM.color` `rowVm.ts:24-29` |
| 16 | Numeric right-alignment + tabular numerals | `alignmentFor`, `.grid-cell.align-right` |
| 17 | Cell state classes: `selected` + 4 perimeter edges, `search-match`, `search-match-current`, `pending-edit`, `fk`, `has-nav` | `cellClass` (`theme/cellClass.ts`), `buildRowVm` `:1385-1401` |
| 18 | Row state: `pending-delete` (strike + 50 % opacity), gutter rails for dirty (warn) / deleted (error) / inserted (ok) | `GridRow.vue:119-195, 327-334` |
| 19 | Four selection kinds — cell, range (anchor+focus), row (disjoint list), column (disjoint list) | `state.ts:19-23`, `isSelected` `:646-658` |
| 20 | Range drag on cells and on the gutter, with rAF edge auto-scroll and `elementFromPoint` re-hit-test | `:910-1180`, `AUTO_SCROLL_EDGE`/`_STEP` |
| 21 | Keyboard: Ctrl/Cmd+C, Ctrl/Cmd+V, Enter→edit, arrows (display-position aware), shift+arrows extend, Delete/Duplicate via `rowMenu()` | `onKeydown` `:1683-1797` |
| 22 | Inline cell editor: one overlay `<input>`, gated on writable ∧ PK ∧ `canUpdate` ∧ not deleted ∧ not truncated; commit → `stageEdit` | `:803-863`, `editingCellRect` `:836-845` |
| 23 | Cell-editor dock publish, with `onEdit`/`onRevert` into the same staged set, suppressed during a drag | `:703-756` |
| 24 | Three context menus — cell, row/gutter, header — built by `menu.ts`, rendered by the app's own `ContextMenu` | `:1510-1577` |
| 25 | Clipboard: range/rows/columns → TSV; paste → `stageEdit` / `stageInsertValue` / `addInsertRow`, skipping generated columns | `clipboardFormats.ts`, `onCopy`/`onPaste` `:1581-1659` |
| 26 | Pending insert rows below the last display row, own inputs, `+` gutter, positional identity | `:1947-1975` |
| 27 | Search: match index, current-match, hide-non-matching filter, go-to-match scroll, search-priority window | `:760-773`, `matchedRows`, `setVisibleRows` |
| 28 | Decode-on-entry + window-pruned retention (P5 C1) | `visiblePageRowBounds` watch `:539-550` |
| 29 | Scroll-position persistence (300 ms debounce) and restore on mount | `:327-334`, `:423-444`, `:569-575` |
| 30 | Empty states: "No rows" / "No matching rows" + *Show all rows* | `:1817-1837` |
| 31 | Density (22/28 px) and font/appearance re-measure | `rowHeight` `:76`, `appearanceVersion` watch `:166-169` |

### 2.1 Instrumentation, which is not a feature but must not break

`window.__kiraGridScrollWorkStart` (budgets), `__kiraGridRowUpdates` (`GridRow.vue:31-33`, the D4
render-count gate), `__kiraGridTuning` (`leadFramesOverride` / `maxLeadPxOverride` /
`incrementalRows`), and `__kiraScrollTrace` (`scrollTrace.ts`, which queries
`[data-testid="grid-row"]` and reads `offsetTop`/`offsetHeight`). §6 D9.

### 2.2 Confirmed *not* grid-internal — costs zero, and the surveys were right

- **The EXPLAIN auto-warning strip (P18) is a console feature, not a grid one.** Grepped: every
  `autoExplain` reference is in `views/console/**` (`ConsoleView.vue:547-556`, `explain.ts`,
  `planIssues.ts`, `planModel.ts`). `views/grid/` contains the string "explain" exactly once, in an
  unrelated comment (`state.ts:95`). `DataView.vue`'s `#badges` slot carries kind / column-count /
  writable / Σ-rows chips and no plan strip at all. `P22-grid-library-evaluation.md` §1 item 12 is
  correct; the brief that commissioned this plan mis-remembered it as a grid integration.
- **The fake-data generator (P15) never touches `DataGrid.vue`.** `GenerateDataDialog.vue` imports
  `views/grid/fakeData/*`, `views/grid/page.ts`'s `getPage` and `views/grid/state.ts`'s
  `reloadAfterMutation`/`runtime` — the *page store* and the *runtime store*, both of which this
  migration keeps verbatim. Its cost is zero **provided §6 D1 keeps `page.ts` as-is**, which it does.

### 2.3 `ConsoleResultGrid.vue` — deliberately deferred, and this is the reasoning

**Deferred. Not in Pass A, not in Pass B.** Five reasons, in order of weight:

1. **It is not the same kind of component.** It renders *three* page kinds through one template —
   `tabular`, `document` (a `DocumentRow` + expandable `DocumentTree`) and `key-value`
   (`ConsoleResultGrid.vue:377-526`). Only the first is a grid. SlickGrid cannot host the other two,
   so a migration there is a partial replacement of one branch, never a file swap.
2. **It shares almost nothing with the row axis being replaced.** Its rows are virtualized by
   `theme/primitives/VirtualList.vue`, not `@tanstack/vue-virtual` — it has no row virtualizer, no
   `rowRangeExtractor`, no `GridRow`, no `rowVmCache`, no velocity tracking. What it genuinely shares
   with `DataGrid.vue` is `columns.ts`'s **column** helpers: `initialWidths`, `columnOffsets`,
   `alignmentFor`, `columnHeaderTooltip`, `GUTTER_WIDTH`, `DEFAULT_COLUMN_WIDTH`, `resetMeasureCtx`,
   plus `columnRangeExtractor`, `OVERSCAN_PX`, `MAX_OVERSCAN_COLUMNS`, `observeScrollElementRect`
   and `observeScrollElementOffset` for its own column virtualizer. **All of those stay** (§6 D8),
   so deferring costs nothing and forces no duplication.
3. **It is read-only.** No editing, no pending changes, no row/column selection kinds, no context
   menus, no clipboard, no FK nav, no sort. Roughly 70 % of §5's mapping work does not apply to it,
   so migrating it would not amortise Pass B's cost — it would be a separate, smaller project.
4. **The reported symptom is not about it.** Every user report and every trace in this
   investigation is a fling on a 10 000-row SQL data tab. A console result is bounded by the
   console's own result cap (`console-result-cap.spec.ts`) and has never been reported as laggy.
5. **Carrying two rendering models is the stated cost, and it is bounded.**
   `P22-grid-library-evaluation.md` §1 item 11 warns that whatever is adopted "has to be worth
   adopting twice, or the app carries two rendering models." That is accepted here on purpose: the
   console *already* carries a different rendering model from the grid (`VirtualList` vs
   `@tanstack/vue-virtual` on the row axis), so this migration does not create the divergence — it
   leaves an existing one alone rather than widening the blast radius of a change that has not yet
   proved itself on hardware.

**What would reopen it**, precisely: Pass B lands, the grid host has been stable for a release, and
someone reports console-result scrolling as slow. Then it is a third pass with its own plan, and its
honest scope is *the tabular branch only* — the document and key-value branches keep `VirtualList`
regardless.

---

## 3. Findings — SlickGrid 5.20.0, read from source

### F1 — The render path pulls values through `dataItemColumnValueExtractor`, not `getCellValue`. **Load-bearing correction.**

`P22-grid-library-survey.md` F1 and §9 rest on `getCellValue(index, field)` being the seam for a
"non row-materializing data source". The method exists and its doc comment
(`dist/esm/index.js:8798-8812`) says exactly that. But its only call site is
`autosizeColumns`'s row-value probe (`:8456`, `rowInfo.getRowVal = (j) => this.getCellValue(j,
columnDef.field)`), and this app never calls `autosizeColumns` (`autosizeColsMode` defaults to
`LegacyOff`, `:7268`).

The real chain, per rendered row:

```
renderRows → appendRowHtml(…, row, …)                                    (:9905)
  d = this.getDataItem(row)                → this.data.getItem(row)      (:8795)
  metadata = this.getItemMetadaWhenExists(row) → this.data.getItemMetadata(row)  (:8827)
  per rendered cell → appendCellHtml(…, item)                            (:9955)
    value = this.getDataItemValueForColumn(item, m)
          → options.dataItemColumnValueExtractor(item, m)                (:8862)
    formatterResult = this.getFormatter(row, m)(row, cell, value, m, item, this)  (:9961)
    applyHtmlCode(cellDiv, …)                                            (:9472)
```

**This is better than `getCellValue`, not worse.** The extractor receives the *column definition*
(so it can carry the app's display-column index, alignment and type class), is called exactly once
per cell SlickGrid actually renders (never for an off-screen cell, never for a retained one), and its
return value is passed straight into the formatter. §6 D1 builds the bridge on it.

The one thing `getItem` *must* do is return something **truthy** — `appendCellHtml` guards
`item && (value = …)` (`:9961`) and `appendRowHtml` marks a falsy item's row `.loading`
(`:9906-9907`).

### F2 — Retained rows are skipped; departing rows are removed. Category (A), confirmed at 5.20.0

`renderRows` (`:10358-10380`): a row already in `rowsCache` is not rebuilt; a row in range without a
cache entry gets `appendRowHtml`. `cleanupRows` removes rows outside the range to keep. `removeRowFromCache`
drops the nodes. There is no pool and no diff pass — the property named correctly in
`P22-grid-library-evaluation.md` F1 holds unchanged.

### F3 — Render is throttled to 10 ms and scroll handling is the library's own

`scrollRenderThrottling: 10` (`:7272`), applied as
`this.scrollThrottle = this.actionThrottle(this.render.bind(this), …)` (`:7537`). The grid owns its
own `scroll` listener on its viewport(s) and fires `onScroll` (`:91` in the `.d.ts`) with the new
offsets. So `columns.ts`'s `observeScrollElementOffset`/`observeScrollElementRect` and
`DataGrid.vue`'s own rAF coalescing become **grid-internal** — but the app still needs its own
listener for velocity and for `scrollTrace` (§6 D9).

### F4 — SlickGrid's runway is *smaller* than this app's, at rest and possibly in motion. **Decisive.**

`getRenderedRange` (`:10257-10259`), verbatim:

```js
let range = this.getVisibleRange(viewportTop, viewportLeft),
    buffer = Math.round(this.viewportH / this.getRowHeight()),
    minBuffer = this._options.minRowBuffer;
this.vScrollDir === -1 ? (range.top -= buffer, range.bottom += minBuffer)
: this.vScrollDir === 1 ? (range.top -= minBuffer, range.bottom += buffer)
: (range.top -= minBuffer, range.bottom += minBuffer);
…
range.leftPx -= this.viewportW; range.rightPx += this.viewportW;
```

with `minRowBuffer: 3` (`:7263`). Three readings:

- **At rest** (`vScrollDir === 0`) the window is **3 rows** each side — 84 px at 28 px density,
  against this app's symmetric **560 px** (≈ 20 rows). That is a 6.7× *reduction* in idle runway, and
  `budgets.spec.ts`'s two overscan-coverage invariants (`:625-698`) are written against the larger
  number.
- **In motion** the lead is one viewport height. On a ~700 px grid that is ~700 px — better than the
  app's 560 px base, worse than its velocity-scaled ceiling of `MAX_LEAD_PX = 2 400`, and it does not
  grow with velocity at all. The trailing side collapses to 3 rows, which is fine and is what the
  app's `BASE_TRAIL_PX` deliberately does *not* do (it keeps 560 px behind, for a direction reversal).
- **The column axis** gets one viewport width each side with **no column cap** — against
  `columnRangeExtractor`'s `MAX_OVERSCAN_COLUMNS = 12` per side. On a 61-column table of 64 px
  columns that is ~19 columns per side, i.e. more DOM than `budgets.spec.ts`'s `< 2500` cell bound
  is priced for.

**So adopting SlickGrid at its defaults would make the reported symptom worse and break two existing
budgets.** `getRenderedRange` is a public method on an exported class (`slick.grid.d.ts:27`,
`:1546`), and so is `getVisibleRange` (`:1530`), `getDataLength` (`:789`), `getViewports` (`:1170`)
and `getCanvasNode` (`:1162`). §6 D4 overrides it in a thin subclass and re-uses this app's own
`rowRangeExtractor` arithmetic verbatim.

### F5 — Per-cell and per-row state has three separate, correct seams — none of them is the formatter

- **Per-column, static**: `column.cssClass` is concatenated onto every cell of that column at
  `appendCellHtml` (`:9957`). Zero per-cell cost. This is where the type colour belongs (§6 D6).
- **Per-cell, dynamic**: `setCellCssStyles(key, hash)` / `addCellCssStyles` / `removeCellCssStyles`
  (`:11038-11060`). A hash is `{ [row]: { [columnId]: 'class names' } }`; multiple keyed layers
  merge into `cellCssClassesByCell` (`:11017`), which `appendCellHtml` reads when building a cell
  (`:9958`) — **so a row scrolling into view picks the classes up automatically, with no re-set.**
  `updateCellCssStylesOnRenderedRows` (`:11006`) walks the *rendered* rows only and touches
  `classList` for cells whose entry actually changed. One caveat worth stating: `setCellCssStyles`
  rebuilds the whole merged map over every layer (`updateCellCssClassesByCell`), so a layer holding
  10 000 rows of search matches costs O(matches) on **each change to any layer** — acceptable
  because search results change rarely, but it means selection and search must be *separate keys*
  and a selection change must not force a search-hash rebuild… which it does. §6 D5 prices this and
  §11 keeps it as a watch item.
- **Per-row**: `getItemMetadata(row)` on the data source, returning `{ cssClasses, columns?,
  formatter?, editor? }` (`:8827`, `:9909`, `:8838`, `:8850`). Read when the row is *built*, so a
  newly staged edit needs `invalidateRow(row)` + `render()`.

### F6 — Formatters may return DOM nodes; HTML rendering can be turned off entirely. **Security-relevant.**

`applyHtmlCode(target, val, options)` (`:9472-9486`):

```js
if (val instanceof HTMLElement || val instanceof DocumentFragment) { emptyElement(target); target.appendChild(val); }
else if (typeof val === 'number' || typeof val === 'boolean') target.textContent = String(val);
else { const s = this.sanitizeHtmlString(val);
       this._options.enableHtmlRendering && s ? target.innerHTML = s : target.textContent = s; }
```

Cell text here is **untrusted database content**. With `enableHtmlRendering: false` a string result
goes to `textContent` — the correct default for the overwhelmingly common case (one text node) — and
the composite cases (NULL span, truncated marker, FK nav button) return a real `HTMLElement`, which
never goes near `innerHTML`. `formatterResult.addClasses` / `.toolTip` still work for object results
(`:10917`). §6 D6.

### F7 — `enableColumnReorder` defaults to `true` and hard-throws without a `Sortable` global

`:7537-7538`: `this._options.enableColumnReorder && (!Sortable || !Sortable.create)` →
`throw new Error("SlickGrid requires Sortable.js module to be loaded")`. `Sortable` appears in the
ESM bundle as a **free identifier** — there is no `import` statement anywhere in
`dist/esm/index.js`, and `sortablejs` is declared as a runtime `dependency` in `package.json`
expected to be present as a global. This app reorders columns via `ColumnsMenu.vue`'s own HTML5
drag list (`ColumnsMenu.vue:66-102`, `setColumnOrder`), never by dragging a header, so:
**`enableColumnReorder: false`, and `sortablejs` is never loaded or bundled.** Recorded because a
spike that omits this option fails at construction with an error naming a package nobody installed.

### F8 — `destroy()` is thorough, per-instance, and the app's side is the only real risk

`destroy(shouldDestroyAllElements)` (`:7674-7699`) unbinds every listener the grid registered
(`_bindingEventService.unbindAll()` plus explicit `unbindByEventName` sweeps over canvases,
viewports, header scrollers, footer scrollers, pre-header/top-header scrollers, both focus sinks,
every `.slick-resizable-handle` and every `.slick-header-column`), unregisters **every** plugin,
cancels any in-flight edit via `getEditorLock()?.cancelCurrentEdit()`, destroys its draggable /
mousewheel / resizable / sortable instances, calls `removeCssRules()` (the per-instance `<style>`
element it injected — not a shared sheet), empties the container, removes its `uid` class and clears
all timers. `destroyAllElements()` additionally nulls ~60 element references.

There is no shared or global grid state to leak between instances. **The risk is entirely on the
app's side**: if the Vue host does not call `destroy()` from `onUnmounted`, every closed data tab
leaves a full grid — its listeners, its `<style>` element, its `rowsCache` and its reference to the
frozen page — alive. That is the exact class of defect this investigation already found and fixed
once (P12 round 2's console tab-close leak). §6 D3 makes it a named acceptance item; §9.1 makes it a
gated test.

### F9 — Bundle cost, measured here, and `SlickDataView` is not needed

`esbuild@0.28.2 --bundle --minify --format=esm` + `gzip -9`, in this session, against
`slickgrid@5.20.0`'s published `dist/esm/index.js`:

| named imports | raw | gzip | vs. 348 411 B launch chunk |
|---|---:|---:|---:|
| `{ SlickGrid }` | 172 984 | **41 947** | **+12.0 %** |
| `{ SlickGrid, SlickCellSelectionModel, SlickCellRangeSelector }` | 189 324 | 45 956 | +13.2 % |
| `{ SlickGrid, SlickContextMenu, SlickCellRangeSelector, SlickCellSelectionModel, SlickCellExternalCopyManager }` | 209 504 | 51 228 | +14.7 % |
| `{ SlickGrid, SlickDataView }` | 197 393 | 47 892 | +13.7 % |
| the four plugins **plus** `SlickDataView` | 233 919 | 57 176 | +16.4 % |
| `import * as SG` (everything) | — | ~91 631 | +26.3 % — **never do this** |

Two conclusions:

- **Tree-shaking works at the named-import level** despite the package shipping one pre-concatenated
  ESM file with no `sideEffects` field. Independently reproduced here; matches the figures the
  session brief carried to within gzip-version noise.
- **`SlickDataView` costs 5 945 B gzip for an engine this app does not use.** It is a
  grouping/paging/filtering/sorting layer over a materialised item array — the precise shape
  `docs/ARCHITECTURE.md`'s reactivity invariant and P5 C1 forbid. The app's `page.ts`,
  `search.ts`/`searchFilter.ts`, `sortTerms.ts` and `state.ts` already own every one of those jobs.
  **The plan imports `SlickGrid` and nothing else in Pass A**, and adds plugins only where §5 shows a
  named win.

CSS: `dist/styles/css/slick.grid.css` is **4 355 B raw / 1 252 B gzip** — a small *structural*
sheet (positioning, overflow, the resize handle, the frozen panes) with about a dozen hardcoded
colours. `slick-default-theme.css` (3 787 B) and `slick-alpine-theme.css` (22 056 B) are visual
themes this app does not want and will not ship. There is **no SASS build step** in the path. §6 D7.

### F10 — Every DOM grid has this symptom, SlickGrid included

Carried forward from `P22-grid-library-survey.md` F10 and `P22-grid-library-evaluation.md` F4 and
restated here because it is the honest frame for §7: *runway is a number you set, not a property you
buy.* Nothing in SlickGrid's architecture makes "blank strip while flinging" impossible; it makes the
per-frame *work* smaller. Whether smaller per-frame work is enough is exactly what §7.4 measures.

---

## 4. Checked, and not adopted

- **`SlickDataView`.** F9. It materialises items and owns filter/sort/group/paging — all four of
  which this app owns already, three of them server-side.
- **`SlickContextMenu`.** The app's `menu.ts` (425 lines) builds `MenuItem[]` for three distinct
  menus from live PK/FK metadata, and `state/contextMenu.ts`'s `openContextMenu(ev, items)` renders
  them in the app's own themed popup, with `runMenuShortcut` dispatching keyboard shortcuts through
  the *same* builders (P21 D5). Adopting the plugin would mean a second menu renderer with its own
  DOM, its own CSS file and its own theming, for menus the app already builds. Instead: subscribe to
  `grid.onContextMenu` (`slick.grid.d.ts:68`) and `onHeaderContextMenu` (`:79`), resolve the cell
  with `getCellFromEvent` (`:1142`), call the existing `openContextMenu`. **Saves ~7 KB gzip and one
  rendering system.**
- **`SlickCellExternalCopyManager`.** The app's clipboard is richer than the plugin's and is wired
  into the staged-mutation pipeline: `rangeToTsv`/`rowsToTsv`/`columnsToTsv` (`clipboardFormats.ts`)
  plus a paste path that creates `PendingInsert`s past the page end and skips generated columns
  (`onPaste` `:1607-1659`). The plugin would have to be taught all of that through its own hooks.
  Keep the app's own; wire it to `grid.onKeyDown`.
- **`SlickCellSelectionModel` + `SlickCellRangeSelector` — deferred to Pass B, not adopted up
  front.** They would buy the drag-to-select-range gesture *and* its edge auto-scroll (§2 item 20,
  the single most intricate piece of interaction code in the file) for 4 009 B gzip. They would also
  replace `Selection`'s four kinds with `SlickRange[]`, which every consumer of `rt().selection`
  reads — copy, the three menus, the cell-editor publish, the Delete shortcut, `isSelectedNeighbor`'s
  perimeter-edge computation. §5 item 19/20 states the choice; §8.6 makes it a Pass-B decision made
  with the code in front of it, not a guess made here.
- **`autosizeColumns` / `forceFitColumns`.** The app measures widths itself with a canvas context
  memoised per frozen page (`columns.ts:57-79`) and persists user overrides. Leaving
  `autosizeColsMode: LegacyOff` also keeps `getCellValue` off the hot path entirely (F1).
- **`enableColumnReorder`.** F7.
- **`enableCellRowSpan`, `enableVariableRowHeight`, frozen *rows*, the footer/top/pre-header
  panels, `enableAsyncPostRender`.** None has a counterpart in §2. All stay at their defaults (off).
- **Canvas.** Closed by `P22-grid-library-survey.md` §6. Not reopened.
- **Migrating `ConsoleResultGrid.vue`.** §2.3.

---

## 5. Feature parity — the mapping, honestly labelled

`L` = configuration; `M` = the seam exists, real glue on top; `H` = hand-rolled against SlickGrid's
event surface (no library help, but no library fight either); `!` = a genuine gap or a behaviour
change the user would notice.

| # | Feature | Fit | How |
|---|---|---|---|
| 1 | Row virtualization in display space | **L/M** | The data source's `getLength()`/`getItem(pos)` work in *display-position* space exactly as the row virtualizer does today; `getItem` maps position → page row via the existing `rowAtDisplayPosition`. §6 D1 |
| 2 | Column virtualization | **L** | Built in: `appendRowHtml` skips cells outside `range.leftPx/rightPx` (`:9929-9934`). The 12-column cap moves into the `getRenderedRange` override. §6 D4 |
| 3 | Velocity-adaptive, direction-biased runway | **M** | `class KiraSlickGrid extends SlickGrid { getRenderedRange() }`, re-using `rowRangeExtractor`'s arithmetic verbatim via a new `rowRangeBounds()`. **The one place this app couples to library internals.** §6 D4 |
| 4 | Sticky header row | **L** | SlickGrid's own `.slick-header` pane. Free. |
| 5 | Sticky row-number gutter | **L** | `frozenColumn: 0` plus a gutter column whose formatter emits the row number. **A structural improvement**: replaces one `position: sticky` box per mounted row with a single frozen pane — precisely the per-frame scrolling-tree cost `P22-…-iter2-rendering.md` F12 flagged as worth a real-Mac A/B and could not otherwise remove. |
| 6 | Select-all corner | **M** | `onHeaderClick` with `args.column.id === GUTTER_COLUMN_ID` → the existing `onSelectAll()` |
| 7 | Header label / PK-FK badge / sort chevron | **M** | `onHeaderCellRendered` (`:77` in the `.d.ts`) hands the header node; build the same spans imperatively. `CodiconIcon` is a Vue SFC — the chevron becomes a plain `<span class="codicon codicon-arrow-up">`, matching what that component renders. |
| 8 | Header structured tooltip | **L/M** | `theme`'s tooltip is **attribute-driven**: a document-level controller resolves the hovered host with `elementFromPoint(...).closest('[data-kira-tip]')` and reads `data-kira-tip` / `data-kira-tip-parts` (`workbench/state/tooltip.ts:110-165`). Setting those two attributes on the header node in `onHeaderCellRendered` reproduces `v-tooltip` exactly, with zero new machinery. Same trick for the truncated-marker tooltip. |
| 9 | Sort cycling + ORDER BY mirror | **M** | `onHeaderClick` → the existing `onHeaderClick(name)`; `setSortColumns()` (`:746`) for the library's own indicator state |
| 10 | Column resize | **L/M** | Built in (`Resizable` + `.slick-resizable-handle`); `onColumnsResized` (`:65`) → `patchDataTabState({ columnWidths })` |
| 11 | Column select zone | **H** | A 10 px absolutely-positioned `<span>` appended in `onHeaderCellRendered`, with its own `click` listener — the same shape as today, on a different host node. Must be removed in `onBeforeHeaderCellDestroy` (`:50`). |
| 12 | Column order / projection | **L** | External (`ColumnsMenu.vue`) and unchanged; the host calls `setColumns()` when `columnOrder` changes |
| 13 | Cell body: text / NULL / truncated marker | **L/M** | One formatter. Plain string for the common case (→ `textContent`, F6); an `HTMLElement` for NULL and truncated. §6 D6 |
| 14 | FK/PK nav button | **M** | Same formatter emits the button; visibility stays pure CSS (`.slick-cell:hover .cell-nav-btn`), exactly as today; the click is resolved in the host's delegated `onClick` via `e.target.closest('.cell-nav-btn')` — the *same* `closest()` pattern `DataGrid.vue:1026-1044` already uses |
| 15 | Type-based cell colour + priority rule | **L** | `column.cssClass = 'tc-<category>'` — **per column, not per cell** (F5). `typeClassColor` already returns `var(--kira-syntax-…)` strings (`theme/icons.ts:177-198`), so this is a stylesheet, and the P9 `rowColoring` toggle becomes one class on the container. The `''` sentinel's priority rule (NULL / FK / staged / current-match must outrank the type colour) becomes source order in that stylesheet. **Removes ~387 inline `patchStyle` colour writes per full-window render.** §6 D6 |
| 16 | Numeric right-alignment | **L** | `column.cssClass` again |
| 17 | Cell state classes incl. 4 perimeter edges | **M** | `setCellCssStyles` with three keys — `kira-selection`, `kira-search`, `kira-staged` (F5). The perimeter-edge computation (`isSelectedNeighbor`, `:669-675`) is pure arithmetic on the selection and moves across unchanged. §6 D5 |
| 18 | Row state + gutter rails | **L/M** | `getItemMetadata(pos).cssClasses` → `pending-delete` / `dirty` / `deleted` / `inserted`; the rails' `::before` CSS moves to the new stylesheet unchanged. A staged change calls `invalidateRow(pos)` + `render()` |
| 19 | Four selection kinds | **H** | The app keeps `Selection` and `rt().selection` verbatim, and keeps `isSelected`. SlickGrid contributes hit-testing (`getCellFromEvent`, `getCellFromPoint`) and the CSS layer (item 17). See §4's note on deferring `SlickCellSelectionModel`. |
| 20 | Range drag + edge auto-scroll | **H** (or **L**, if `SlickCellRangeSelector` is adopted in Pass B) | Today: `mousedown`/`mouseover`/`mouseup` + a rAF auto-scroll loop + `document.elementFromPoint` (`:910-1180`). Against SlickGrid the hit-test becomes `grid.getCellFromPoint(x, y)`, which is cheaper and more accurate than `elementFromPoint().closest()`. The rest is unchanged. |
| 21 | Keyboard | **M** | `grid.onKeyDown` (`:87`) with `enableCellNavigation: true` for focus plumbing; the app's own `onKeydown` body runs first and `e.preventDefault()` + `stopImmediatePropagation` on the events it owns, so SlickGrid's built-in arrow handling never double-moves. **Watch item**: display-position-aware arrows (`:1765-1770`) must win over SlickGrid's own row stepping. |
| 22 | Inline cell editor | **M** | A custom `Editor` class (`models/editor.interface.d.ts`): `loadValue(item)` reads `displayCell`, `serializeValue()` returns the buffer, `applyValue(item, state)` calls `stageEdit(tabId, item.row, name, state)` — **never writing to the frozen page**. `editable` is bound to `canEditTable`, `autoEdit: false` (so a single click does not open an editor), and `onBeforeEditCell` (`:48`) is vetoed for a deleted row or a truncated value (P24 D27). `wrapSelectionOnType` binds on the editor's own input. |
| 23 | Cell-editor dock publish | **L** | Pure app state, driven from the existing `watch` on `rt().selection` — untouched |
| 24 | Three context menus | **M** | `onContextMenu` / `onHeaderContextMenu` → `getCellFromEvent` → the existing `cellMenu`/`rowMenu`/`headerMenu` + `openContextMenu`. §4. The gutter column's id distinguishes the row menu from the cell menu, replacing today's `.gutter-cell[data-row]` vs `.grid-cell[data-row]` test |
| 25 | Clipboard | **L** | `clipboardFormats.ts` unchanged; only the keydown host changes |
| 26 | Pending insert rows | **M** | `getLength()` returns `displayRowCount + inserts.length`; `getItem(pos)` returns an insert handle past the end; `getItemMetadata` gives the row `pending-insert` and each of its cells an `insert-cell` editor. **This is the fiddliest item in the migration** — today they are a separate `v-for` outside the virtualizer (`:1947-1975`) with their own always-mounted `<input>`s. Inside SlickGrid they become ordinary rows with a per-cell editor, which is arguably *better* but is a real behaviour change: an insert row's inputs are no longer all simultaneously focusable. **Flagged `!`.** §8.4 |
| 27 | Search (match index / filter / go-to-match) | **L/M** | The match layer is item 17's `kira-search` CSS key; the filter is `getLength()`/`getItem()` (item 1); go-to-match is `scrollCellIntoView(row, cell)` (`:1698`) |
| 28 | Decode-on-entry + window pruning (P5 C1) | **M** | `onRendered` (`:90`) reports the range; the host calls `setVisibleWindow(tabId, start, end)` and `setVisibleRows(...)` exactly as `visiblePageRowBounds` does today. §6 D2 |
| 29 | Scroll persistence + restore | **M** | `grid.onScroll` for the 300 ms debounce; restore via `scrollTo`/viewport `scrollTop` after the first render |
| 30 | Empty states | **L** | Vue `v-if` siblings of the host div, unchanged |
| 31 | Density + font re-measure | **M** | `setOptions({ rowHeight })` (`:7748`) on a density change; `resetMeasureCtx()` + `setColumns(...)` on `appearanceVersion` |

### 5.1 The genuine gaps and behaviour changes

Everything above that is not an `L`/`M`/`H` mechanical re-home. Named here so nothing is discovered
in implementation:

1. **`!` Pending insert rows (item 26).** Behaviour change, described above. Alternative considered
   and rejected: keeping them as an absolutely-positioned Vue overlay below the grid canvas — that
   reintroduces exactly the dual-rendering-model problem the migration exists to remove, and the
   overlay would have to track SlickGrid's scroll offset by hand.
2. **`!` Cell text selection.** `.grid-cell` today is `user-select: none` (`GridRow.vue:213`) to
   keep the native copy accelerator from racing the grid's own Ctrl+C (D1). SlickGrid defaults
   `enableTextSelectionOnCells: false` (`:7245`), which is the same posture — **no change**, but
   recorded so it is not mistaken for a regression.
3. **`!` Vue components inside cells.** `CodiconIcon` cannot be mounted per cell; it becomes a
   `<span class="codicon codicon-…">`. Verified this is what the component renders, so the visual
   result is identical — but it means `theme/CodiconIcon.vue` is no longer the single source of
   truth for the grid's two glyphs. A one-line comment in both places is the mitigation.
4. **`!` The whole `tests/ui/` selector surface.** `[data-testid="grid-row"]`, `grid-cell`,
   `grid-gutter-cell`, `grid-header-cell`, `grid-select-all`, `grid-header-select`,
   `cell-nav-button`, `grid-cell-input`, `grid-row-insert`, `grid-cell-insert`, plus `data-row`,
   `data-col-index`, `data-column`, `data-null`, `data-sort` — read by **15 spec files**. SlickGrid
   emits `.slick-row[data-row]` and `.slick-cell.l<n>.r<n>`. §6 D10 keeps the testids by writing them
   from the formatter and `onRendered`, so the specs change as little as possible; §8.5 owns
   whatever is left.
5. **No gap at all** for the two things the brief worried about: the EXPLAIN strip and the fake-data
   generator (§2.2).

---

## 6. Decisions

### D1 — The data bridge: a `KiraGridDataSource` over frozen pages, with a lightweight row handle. **The load-bearing decision.**

New file: `views/grid/slick/dataSource.ts`.

```ts
/** What SlickGrid hands to a formatter/editor as the "item". Never a materialised row. */
export interface RowHandle {
  /** Page row index — what selection, pending changes, search and the gutter number address. */
  readonly row: number;
  /** Display position — pixel placement and SlickGrid's own row index. Equal to `row` unfiltered. */
  readonly pos: number;
  /** A pending insert's id, when this position is past the loaded page. */
  readonly insertId?: string;
}

export interface KiraGridDataSource {
  getLength(): number;                                   // displayRowCount + inserts.length
  getItem(pos: number): RowHandle;                       // MUST be truthy (F1)
  getItemMetadata(pos: number): ItemMetadata | null;     // row cssClasses, per-cell editor
}
```

and the grid option:

```ts
dataItemColumnValueExtractor: (item: RowHandle, column: KiraColumn) =>
  item.insertId ? insertValue(tabId, item.insertId, column.field)
                : displayCell(item.row, column.displayCol)   // -> the memoised CellView
```

**Five properties this buys, each of which is a requirement, not a nicety:**

1. **Nothing is materialised.** `getItem` allocates one frozen two-field object, and only for a row
   SlickGrid is actually *building* — O(rows entered), not O(window), because a retained row is
   never revisited (F2). `docs/ARCHITECTURE.md`'s reactivity invariant holds by construction: the
   handle is a plain frozen object, the page behind it is frozen, and nothing is `reactive()`.
2. **Decode-on-entry is preserved exactly.** The extractor calls the app's existing `displayCell`,
   which calls `page.ts`'s `cell()`, which memoises both the decoded string and the `CellView`
   object per `(row, col)` in `store.ts`. A repeat call returns **the identical object reference** —
   so the extractor is allocation-free on the second and later reads of a cell, which is what makes
   it safe to call it per rendered cell.
3. **The staged-edit overlay stays where it is.** `displayCell` layers `stagedValue` over the page
   value without touching either cache — unchanged.
4. **Filtering is free.** `getLength`/`getItem` are the *only* place display-position ↔ page-row
   translation lives, replacing `displayPositionOf`/`rowAtDisplayPosition`'s use inside the
   virtualizer. Those two functions stay for scroll-into-view and arrow-key nav.
5. **`getCellValue` is implemented anyway**, as a two-line delegation to the extractor, so that if a
   future call site (or `autosizeColumns`) ever uses it, it cannot fall through to
   `getDataItem(i)[field]` — which would return `undefined` for every column, silently. Cheap
   insurance against F1's trap.

**The one rule this file must never break, stated as a rule because it is invisible at the call
site:** the extractor and the formatter run **during layout, inside SlickGrid's render**. Neither may
touch Vue reactive state whose mutation could re-enter the render, and neither may call
`getPage()`'s reactive `pageVersion` accessor. The host resolves the page **once per render pass**
and hands the source a plain reference (§6 D3's `syncFromProps`).

### D2 — The visible-window report drives P5 C1's pruning, from `onRendered`

`grid.onRendered` fires with `{ startRow, endRow, grid }` after each render. The host converts the
*display* range to a page-row range — `min`/`max` over `rowAtDisplayPosition`, exactly what
`visiblePageRowBounds` (`:539-549`) computes today — and calls `setVisibleWindow(tabId, start, end)`
and `setVisibleRows(tabId, start, end)`. Both are idempotent and already short-circuit an unchanged
window (`store.ts:169`).

Two details carried over verbatim from the current code and its comments, because both are easy to
lose: the window is a **hint, not a correctness contract** (a non-contiguous filtered slice can only
make the cache live slightly longer, never decode a cell nobody rendered), and the *search-priority*
report must fire **immediately on mount**, not only after the first scroll (`:555-557`'s
`{ immediate: true }`), or a search started before the first scroll has no window to prioritise.

### D3 — The Vue host, on `CodeMirrorHost.vue`'s shape

New file: `views/grid/SlickGridHost.vue`. Its contract is deliberately the same one
`editor/CodeMirrorHost.vue` established for wrapping an imperative library:

- **One `ref` root div, nothing else in the template.** (`CodeMirrorHost.vue:306`.)
- **The instance is a plain `let`, never a `ref`/`shallowRef`/`reactive`.** `CodeMirrorHost.vue:73`
  states the rule and the reason: *"Vue must not see the view, its state or its DOM… Wrapping it
  would proxy every internal object CodeMirror touches on every transaction."* A `reactive()` grid
  would proxy `rowsCache`, every cell node and the frozen page. **Non-negotiable.**
- **Construct in `onMounted`, `destroy()` in `onUnmounted`** (`CodeMirrorHost.vue:184-222`).
- **Props in, events out; one `watch` per prop, each doing the minimum imperative update** — the
  compartment-reconfigure pattern, translated to `setColumns` / `setOptions` / `invalidate…` /
  `updateRowCount` / `render`.
- **`defineExpose` only for genuinely imperative caller needs** (`focus` there; `scrollCellIntoView`
  here — `DataView.vue:154-158` already calls it through a template ref).

**Lifecycle, precisely:**

```
onMounted:
  1. read the page once; build columns (KiraColumn[]) and the data source
  2. grid = new KiraSlickGrid(rootRef.value, dataSource, columns, options)
  3. subscribe every grid event through ONE SlickEventHandler, kept in a plain `let`
  4. restore tab.state.scrollTop/scrollLeft on the viewport, then grid.render()
  5. scrollTrace.registerGrid(viewportEl, '.slick-row')            // D9
  6. install the app's own passive `scroll` listener on the viewport (velocity + trace)

on prop/state change (each its own narrow watch):
  columnOrder / widths / projection → rebuildColumns() → grid.setColumns(cols)
  rowHeight (density)               → grid.setOptions({ rowHeight }); grid.invalidateRowHeights()
  appearanceVersion                 → resetMeasureCtx(); rebuildColumns()
  pageVersion / displayRowCount     → grid.updateRowCount(); grid.invalidateAllRows(); grid.render()
  pending changes (edits/deletes)   → grid.invalidateRows(changedPositions); grid.render()
  selection                         → grid.setCellCssStyles('kira-selection', hash)   // D5
  search match index                → grid.setCellCssStyles('kira-search', hash)
  rowColoring setting               → one class toggle on the root div                 // D6
  editable (canEditTable)           → grid.setOptions({ editable })

onUnmounted:  (order matters)
  1. cancel the auto-scroll rAF and any debounce timer
  2. remove the app's own viewport scroll listener; scrollTrace.unregisterGrid(...)
  3. eventHandler.unsubscribeAll()
  4. grid.destroy(true)          // F8 — `true` also nulls the ~60 element refs
  5. grid = null; dataSource = null
```

**The `destroy()` requirement is a named acceptance item (§10 item 6) and a gated test (§9.1),
not an assumption.** F8: SlickGrid's own teardown is thorough and per-instance, so the *only* way
this leaks is the app forgetting to call it. Its shape:

> Open a data tab, close it, repeat 5×; assert (a) `document.querySelectorAll('.slick-viewport')`
> is 0, (b) the number of `<style>` elements in `<head>` is back to its pre-open count (SlickGrid
> injects one per instance and `removeCssRules()` removes it), and (c) `__kiraRetention()` /
> `__kiraRetainedBytes()` return to their pre-open values — the same symmetry assertion
> `leaks.spec.ts` scenario 1 already makes for the five page stores.

Note for the record: **only one `DataGrid` is mounted at a time today** — `MainView.vue` keys
`DataView` by tab id, and `scrollTrace.ts:98-106` depends on that. The multi-instance concern is
therefore about *sequential* mount/unmount across tab switches, not concurrent instances. F8 says
there is no cross-instance state either way, so both are safe once (4) is guaranteed.

### D4 — The runway: a thin `KiraSlickGrid` subclass overriding `getRenderedRange`

New file: `views/grid/slick/kiraSlickGrid.ts`.

```ts
export class KiraSlickGrid<T> extends SlickGrid<T> {
  getRenderedRange(viewportTop?: number, viewportLeft?: number) {
    const range = super.getVisibleRange(viewportTop, viewportLeft);
    const { pxPerFrame, direction } = this.velocity();            // supplied by the host
    const { start, end } = rowRangeBounds(
      { startIndex: range.top, endIndex: range.bottom, count: this.getDataLength() },
      this.getOptions().rowHeight, pxPerFrame, direction, this.mountedColumnCount(), CFG,
    );
    range.top = start; range.bottom = end;
    range.leftPx = Math.max(0, range.leftPx - OVERSCAN_PX);
    range.rightPx = Math.min(this.getCanvasNode().clientWidth, range.rightPx + OVERSCAN_PX);
    return range;
  }
}
```

**Five things make this safe and small:**

- **It reuses the existing arithmetic, it does not restate it.** `columns.ts`'s `rowRangeExtractor`
  is refactored into `rowRangeBounds(range, rowHeight, velocity, direction, columns, cfg):
  { start, end }` plus a one-line `rowRangeExtractor` wrapper that expands the bounds into the
  `number[]` `@tanstack/vue-virtual` wants. `tests/unit/row-range.spec.ts` stays green **unchanged**,
  which is the proof that the refactor is behaviour-preserving.
- **Every method it calls is public** and in the published `.d.ts`: `getVisibleRange` (`:1530`),
  `getDataLength` (`:789`), `getOptions`, `getCanvasNode` (`:1162`). No `protected` field is touched
  and `vScrollDir` is deliberately *not* read — direction comes from the app's own velocity sampler,
  which already handles the discrete-jump case (`MAX_PLAUSIBLE_ROW_VELOCITY_PX_PER_FRAME`, `:376`)
  that a raw sign test would not.
- **It replaces the column budget too.** `OVERSCAN_PX` on each horizontal side instead of a full
  viewport width (F4's third reading), keeping the DOM-cell bound reachable on a 61-column table.
  `rowRangeBounds`'s own `CELL_BUDGET` cap needs the mounted column count, which the host supplies
  the same way `DataGrid.vue:365`'s `mountedColumnCount` does today — as a plain variable updated
  from `onRendered`, never by calling back into the grid mid-range-computation (the comment at
  `:359-364` records that calling into the column virtualizer from inside the row range computation
  measurably regressed the scroll budget; the same hazard exists here).
- **`minRowBuffer` stays at its default and is irrelevant**, because the override never reads it.
  Do not "fix" the runway by raising `minRowBuffer` instead — it applies to the *trailing* side in
  motion and to *both* sides at rest, which is the wrong shape (F4).
- **This is the single point of coupling to SlickGrid internals**, and it is one public method. The
  file carries a comment saying so and naming what to re-check on a version bump: that
  `getRenderedRange` is still the method `render()` calls, and that its return shape is still
  `{ top, bottom, leftPx, rightPx }`.

The runtime toggles (`__kiraGridTuning.leadFramesOverride` / `.maxLeadPxOverride`) are read inside
the override on every call, exactly as `DataGrid.vue:482-495` does now — so §7.4's real-Mac A/B stays
a one-build experiment.

### D5 — Cell state via three keyed CSS layers, never via the formatter

`setCellCssStyles` layers (F5), each owned by one `watch`:

| key | source | recomputed when |
|---|---|---|
| `kira-selection` | `rt().selection` → `isSelected` + the four `isSelectedNeighbor` perimeter probes | the selection changes |
| `kira-search` | `matchIndex` → `search-match` / `search-match-current` | the search result or current match changes |
| `kira-staged` | `pendingFor(tabId).edits` → `pending-edit` | a cell is staged or un-staged |

Two constraints, both from F5:

- **Each hash is built over the currently *rendered* range only**, not the whole page — except
  `kira-search`, which must cover every match so that a match scrolling into view is already
  highlighted when its row is built (`appendCellHtml` reads the merged map, `:9958`). Since
  `updateCellCssClassesByCell` rebuilds across *all* layers on *any* `setCellCssStyles` call, a
  10 000-match search makes every selection change cost O(matches). Measure it (§9.1); if it bites,
  the fallback is to scope `kira-search` to the rendered range and re-set it from `onRendered`,
  which is a strictly local change.
- **`selectedCellCssClass` is set to `''`** in the grid options so SlickGrid's own selection layer
  never competes with `kira-selection`.

### D6 — Cell content: a column-scoped class for colour, a formatter for structure, `enableHtmlRendering: false`

Three separate mechanisms, one per kind of thing:

1. **Colour and alignment are per-column and static** → `column.cssClass = 'tc-numeric align-right'`
   (F5). `typeClassColor` already yields `var(--kira-syntax-…)` (`theme/icons.ts:177-198`), so the
   nine categories become nine one-line CSS rules. P9's `rowColoring` toggle becomes
   `.kira-grid--row-coloring` on the host root. The priority rule that `CellVM.color`'s `''`
   sentinel encodes today (a data-type colour must never override NULL / FK / staged / current-match)
   becomes **source order in the stylesheet**, with a comment saying so — because it is now enforced
   by CSS cascade rather than by a JS conditional, and a future reordering of the file would silently
   break it.
2. **Structure is per-cell** → one formatter returning either a plain `string` (the common case:
   `view.text`, written with `textContent`) or an `HTMLElement` for NULL, truncated and FK/PK-nav
   cells. The `data-null` attribute and the `data-testid`s go on the *cell node* via
   `formatterResult.addClasses` plus an `onBeforeAppendCell` hook — see D10.
3. **`enableHtmlRendering: false`, globally.** F6. Cell text is untrusted database content; this
   removes the `innerHTML` branch entirely rather than relying on `sanitizeHtmlString`. Any future
   need for real HTML in a cell must go through a DOM node, not a string.

### D7 — Theming: `slick.grid.css` for structure, one app stylesheet in `--kira-*` tokens

The token system is `theme/tokens.css` (111 lines, `:root { --kira-bg … }`, VS Code Dark Modern
derived) consumed by `theme/primitives.css` and every scoped SFC block. There is **no Tailwind
config** to bridge and **no SASS** in SlickGrid's path (F9). So:

- **Import `slickgrid/dist/styles/css/slick.grid.css`** (4 355 B raw / 1 252 B gzip) once, from the
  host. It is structural — positioning, overflow, panes, the resize handle. Its ~dozen hardcoded
  colours (`silver`, `#d3d3d3`, `#fff`, `#3490dc`) are all overridden below.
- **Ship neither `slick-default-theme.css` nor `slick-alpine-theme.css`.** The alpine theme alone is
  22 056 B of opinions this app does not share, and a pre-built grid theme is exactly what
  `P22-grid-library-evaluation.md` §1 item 8 says must not happen: *"the grid must look like the rest
  of the workbench, not like a themed grid dropped into it."*
- **Write `views/grid/slick/slickTheme.css`**, a single unscoped stylesheet that is a near-verbatim
  port of `GridRow.vue`'s existing `<style>` block (lines 118-335) with `.grid-row` → `.slick-row`,
  `.grid-cell` → `.slick-cell`, `.gutter-cell` → `.slick-cell.kira-gutter`, plus overrides for
  `slick.grid.css`'s hardcoded colours and for `.slick-header-column`. Every declaration keeps its
  `--kira-*` token — **there is no second source of truth for colour, which is the risk
  `P22-grid-library-evaluation.md` §7 lists second.**
- **Row height and column widths are SlickGrid's own injected `<style>` element**, created per
  instance from `rowHeight` and the column definitions and removed by `destroy()` (F8). The app does
  not write them.
- The four perimeter-edge custom properties (`--sel-t`/`--sel-r`/`--sel-b`/`--sel-l`) and their
  composed `box-shadow` move across **unchanged** — that mechanism (P42 D21/F15) is pure CSS and does
  not care what renders the cell.

### D8 — `columns.ts` keeps everything the console needs; only row-axis constants move

Stays (used by `ConsoleResultGrid.vue`): `GUTTER_WIDTH`, `DEFAULT_COLUMN_WIDTH`, `OVERSCAN_PX`,
`MAX_OVERSCAN_COLUMNS`, `initialWidths`, `columnOffsets`, `columnRangeExtractor`, `alignmentFor`,
`resolveColumnOrder`, `pageColumnIndexFor`, `columnHeaderTooltip`, `resetMeasureCtx`,
`observeScrollElementRect`, `observeScrollElementOffset`.

Refactored in place (D4): `rowRangeExtractor` → `rowRangeBounds` + a wrapper.

Moves to `views/grid/slick/` **only at Pass B's cutover, not before**: nothing. Deleting
`DataGrid.vue`, `GridRow.vue` and `rowVm.ts` is the last commit of Pass B (§8.5), so both grids can
coexist for the whole of Pass A.

### D9 — Instrumentation survives the switch, or the spike cannot be measured

- **`scrollTrace.registerGrid(el)` grows a second parameter**: the row selector, defaulting to
  `'[data-testid="grid-row"]'`. The Slick host passes `'.slick-row'`. `measureMountedBand`
  (`scrollTrace.ts:125-136`) uses it. One-line change, and it is what makes an A/B between the two
  grids on the *same* build meaningful.
- **`__kiraGridScrollWorkStart`** is called from the host's own viewport `scroll` listener at the
  same logical point `markScrollWork` marks today — before the render work, after the browser's
  scheduling hops.
- **`__kiraGridTuning.leadFramesOverride` / `.maxLeadPxOverride`** are read by D4's override.
  `.incrementalRows` is meaningless for SlickGrid and is left alone (it still drives the old grid).
- **`__kiraGridRowUpdates`** has no SlickGrid counterpart — there is no per-row component to count
  updates on. Its replacement, and a strictly better one, is a **`MutationObserver` on the canvas**:
  §9.1 gates that a sub-row scroll mutates nothing and a cross-row scroll mutates only the rows that
  entered or left. `budgets.spec.ts` already has both of those probes (`:755-795`).
- **A new switch, `window.__kiraGridEngine`**, selects which grid `DataView.vue` mounts. §7.2.

### D10 — Keep the `data-testid`s and `data-*` attributes, so the spec rewrite stays small

Three hooks, all cheap:

- **Cells**: `onBeforeAppendCell` (`:9962`) can only add classes, so the attributes go on in the
  formatter's element branch and, for the plain-string branch, in a single `onRendered` pass over the
  newly rendered rows — `row.querySelectorAll('.slick-cell')` and set `data-testid="grid-cell"`,
  `data-row`, `data-col-index`, `data-column`, `data-null`. Measure this (§9.1): if it costs, the
  fallback is to make the formatter always return an element for cells in a data-testid build, or to
  rewrite the affected selectors instead. **Do not skip the measurement** — this is the one place
  where a testability convenience could eat the performance win the whole phase exists for.
- **Rows**: SlickGrid already sets `dataset.row` on the row div (`:9913`) — but to the **display
  position**, whereas today's `data-row` is the **page row index**. The two differ only while
  filtering; the specs that assert on `data-row` do so unfiltered. `getItemMetadata(pos).cssClasses`
  cannot set an attribute, so the same `onRendered` pass sets `data-testid="grid-row"` and corrects
  `data-row` to the page row. **This asymmetry is a real trap and must be commented at both ends.**
- **Header cells**: `onHeaderCellRendered` sets `data-testid="grid-header-cell"`, `data-column`,
  `data-col-index`, `data-sort` (item 7 already builds that node).

---

## 7. Pass A — the spike

### 7.0 Why spike-first, argued against the alternative

The full-migration-first alternative is: do §8's parity work now, cut over, rewrite the specs, ship,
and find out on real hardware. Four facts make that the worse bet:

1. **Two hand-rolled fixes have already been shipped and produced no visible improvement**
   (`P22-…-iter2-rendering.md`'s opening quote; the second round's D3/D4/D5 landed at `6587148`,
   `a94f1d4`, `bc654f9` and the user has not reported them as fixing anything either). The base rate
   for "a frontend rendering change moves this symptom" in this repo is currently **0 for 2**.
2. **`P22-…-iter2-rendering.md` §7.3 has still never been run.** Both surveys say so, and both say
   it is the only thing that can distinguish *"the renderer is too slow"* (SlickGrid helps) from
   *"the runway is too short"* (only a bigger number helps, in either grid) from *"the cost is below
   JS"* (nothing in this document helps). Migrating first means spending the whole of Pass B before
   learning which of the three it is.
3. **A full migration invalidates every performance gate at once.** `budgets.spec.ts`'s scroll
   response, both overscan-coverage invariants, both DOM-cell bounds and `perf.spec.ts`'s rAF p95
   and retained-bytes checks are all written against `DataGrid.vue`'s DOM and overscan policy. A
   cutover-first phase runs blind for its whole duration —
   `P22-grid-library-evaluation.md` §7's third named risk, and the exact condition
   `P22-…-iter2-rendering.md` §0.5 was ordered to prevent.
4. **F4 means SlickGrid at its defaults is a regression on this specific symptom.** The spike is
   where that gets discovered for the cost of a few hundred lines rather than a few thousand.

The counter-argument is real and is answered by design: *a thin spike could be fast for reasons that
do not survive parity* — fewer classes per cell, no gutter, no type colours, no selection layer. So
**the spike is deliberately thick**: real decoded data through the real bridge, the real frozen
gutter, the real per-column type colours, the real formatter, the real theme, the real runway, and a
representative static selection/search CSS layer. Only *interaction* is stubbed. §7.3's scope is
written to that standard, and §7.4's exit criteria include a DOM-parity check so a "fast because it
renders less" result cannot pass.

### 7.1 What Pass A is not

- Not a cutover. `DataGrid.vue` is untouched except for the two lines that read the engine switch.
- Not feature-complete. No editing, no menus, no clipboard, no drag-select, no insert rows, no
  keyboard beyond what SlickGrid gives for free.
- Not a `tests/ui/` rewrite. Every existing spec keeps running against the default engine.

### 7.2 The engine switch

`views/grid/DataView.vue`'s `.grid-area` mounts `<DataGrid>` or `<SlickGridHost>` on

```ts
const engine = computed(() => (window.__kiraGridEngine === 'slick' ? 'slick' : 'tanstack'));
```

read once per mount (not reactively — switching engines mid-session should remount the tab, and the
protocol in §7.4 sets it and reloads). Declared in `main.ts`'s `__kira*` block beside
`__kiraGridTuning`, typed in `tests/ui/global.d.ts`, and documented in `docs/PERF.md` alongside
§7.4's protocol. Default `'tanstack'` — **the new grid ships dark until the gate passes.**

### 7.3 Commits

Frontend, `tests/unit/`, `tests/ui/` and `docs/`. Each ends on a green tree
(`bun run typecheck && bun run lint && bun run build && bun test apps/kira-studio/tests/unit` plus
the full `tests/ui/` suite, which must pass **unmodified** for every commit except C1 and C7).

**C1 — `refactor(grid): split rowRangeExtractor into reusable bounds`**
D4's refactor only: `columns.ts` gains `rowRangeBounds(...): { start, end }` and
`rowRangeExtractor` becomes a two-line wrapper over it. No behaviour change; `tests/unit/row-range.spec.ts`
passes **unchanged**, which is the whole point of doing it as its own commit. Also lands D9's
`scrollTrace.registerGrid(el, rowSelector = '[data-testid="grid-row"]')` signature change.

**C2 — `build(frontend): add slickgrid@5.20.0`**
`package.json` + lockfile, plus a one-paragraph note in `docs/ARCHITECTURE.md`'s Stack section
recording *what* is imported (`SlickGrid` only), *why not the Vue wrapper*, and the measured gzip
delta from §9.1. Nothing imports it yet. Separate commit so the bundle delta is bisectable to one
change.

**C3 — `feat(grid): a SlickGrid data source over frozen pages`**
D1 + D2. `views/grid/slick/dataSource.ts` and its types. Pure logic, no DOM. Its unit test
(`tests/unit/slick-data-source.spec.ts`) is one of the few this repo's `AGENTS.md` bar actually
admits — display-position ↔ page-row translation across a filter, the insert-row region past the
page end, and the "handle must be truthy" invariant are exactly *"cursor/pagination arithmetic with
real boundary cases"*.

**C4 — `feat(grid): the KiraSlickGrid runway override`**
D4. `views/grid/slick/kiraSlickGrid.ts`. Its unit test covers only what `rowRangeBounds` does not
already: that the override clamps `leftPx`/`rightPx` to `OVERSCAN_PX` and to the canvas width.

**C5 — `feat(grid): a Vue host for SlickGrid, behind __kiraGridEngine`**
D3 + D6 + D7 + D9 + D10, and the `DataView.vue` switch. The largest commit in Pass A. Includes
`slickTheme.css`, the formatter, the column builder, the `onRendered` attribute pass, and the
`onUnmounted` teardown.

**C6 — `test(ui): the SlickGrid spike's own budget and teardown gates`**
A new `tests/ui/slick-grid.spec.ts` that sets `__kiraGridEngine = 'slick'` before boot and asserts
§9.1's list: rows render with real decoded text, the gutter is frozen and shows page-global numbers,
the type-colour classes are on the right columns, a sub-row scroll mutates nothing, a cross-row
scroll mutates only entering/leaving rows, mounted cells stay under the DOM bound on `scroll_grid`,
the at-rest mounted band covers the viewport plus the same runway the old grid mounts, and **the
teardown assertion** (D3). It does **not** re-gate the existing budgets — those still run against the
default engine.

**C7 — `docs(perf): the SlickGrid spike, and how to A/B it on real hardware`**
§7.4's protocol written into `docs/PERF.md` beside §2.1a (where the real-fling protocol already
lives), plus a one-line pointer from `docs/v1.1/plans/P22-slickgrid-migration-plan.md`. The protocol
is the deliverable of this pass as much as the code is.

### 7.4 Exit criteria — what "the spike proved the hypothesis" means, measurably

Two halves. Both must pass. **The sandbox half gates the commit; the hardware half gates Pass B.**

**(a) Provable here — mechanism correctness (C6 gates all of these):**

1. A 10 000-row page renders correct decoded text in every visible cell, matching what the old
   engine renders for the same fixture, cell for cell across the first mounted window.
2. `__kiraRetention().decodeCacheRows` stays pinned to the mounted window while scrolling — P5 C1
   holds through the new bridge (this is the single highest-risk item in D1).
3. A sub-row scroll (4 px) produces **zero** DOM mutations; a scroll larger than the whole runway
   produces mutations only for rows that entered or left.
4. Mounted `.slick-cell` count stays under **2 500** on `scroll_grid` (61 columns) at every rung of
   the existing velocity ladder — the same bound `budgets.spec.ts` holds the old grid to.
5. At rest, the mounted row band's coverage of the viewport is **at least** what the old grid's is
   for the same fixture and window size. (F4: SlickGrid's default would fail this by 6.7×; D4's
   override is what makes it pass, so this assertion is the direct test of D4.)
6. Tab-close teardown: D3's three-part assertion.
7. `bun run build`'s launch chunk grows by **≤ 45 000 B gzip** over §9.1's re-measured baseline
   (F9's `{ SlickGrid }` figure of 41 947 B plus the 1 252 B stylesheet plus the host's own code,
   with headroom). A larger number means something pulled `SlickDataView` or a plugin in by accident.
8. Every existing `tests/ui/` spec passes **unmodified** against the default engine.

**(b) Real-Mac only — the perceptual and latency verdict.** The user runs
`P22-…-iter2-rendering.md` §7.3's protocol **twice on one build**: once with
`__kiraGridEngine` unset (today's grid) and once with it set to `'slick'`, same window size, same
table, same page size, same hard two-finger flick. Report per run:
`summary.pxPerFrame` (p50/p95/max), `summary.uncoveredPx` (p50/p95/max), `summary.renderMs`
(p50/p95/max), the `scrollEvents` histogram, and **one sentence on whether the lag was perceptibly
different.**

The gate:

- **PASS → Pass B is authorised** if the lag is *perceptibly reduced*, **or** `uncoveredPx` p95 drops
  materially at a comparable `pxPerFrame` p95. (A perceptual verdict alone is sufficient here: it is
  the only measurement that answers the original report, and §9's whole discipline is that it must
  arrive *with* the numbers, not instead of them.)
- **INCONCLUSIVE → do not start Pass B.** `renderMs` p95 falls but the lag is unchanged and
  `uncoveredPx` is unchanged ⇒ the constraint is runway, not throughput. The cheap next experiment is
  `__kiraGridTuning.maxLeadPxOverride = 4000` on **both** engines (§7.3's C4/C5 keep the toggle
  live in the new one), which is a five-minute test that costs nothing and decides whether a bigger
  number was the answer all along.
- **FAIL → do not start Pass B**, and go to §11's first open question. If `renderMs` was already a
  small fraction of the frame period on the *old* grid, then JS was never the bottleneck, no DOM grid
  can help, and the remaining candidates are `P22-…-iter2-rendering.md` §9's list — the per-row
  sticky gutter (which D4/item 5 removes for free, and which is therefore *also* tested by this same
  A/B), main-thread starvation during momentum, and the 280 000 px sizer's tile invalidation for
  height. In that case Pass A stays in the tree behind its switch (it costs nothing while dark) or is
  reverted as one commit; **the decision is the user's and this plan does not pre-empt it.**

**C7's implementation** (Pass A landed) keeps this protocol's canonical, runnable copy in
`docs/PERF.md` §2.1c, beside §2.1a's own real-fling protocol — that section also carries the real
measured bundle-size delta (§7.4(a) item 7) and notes that this gate's own result is not yet known.
Update both places together if the protocol ever changes.

---

## 8. Pass B — feature parity and cutover (design, not yet the commit list)

Authorised only by §7.4(b) PASS. **Per `AGENTS.md`'s multiple-passes rule this gets its own plan
file, written against the post-Pass-A tree and with the hardware numbers in hand.** What follows is
the design that plan must implement and the seams Pass A must therefore leave in place — not the
commit list a Sonnet subagent executes.

### 8.1 Interaction (§2 items 19-21, 24)

The app's `Selection` type, `rt().selection` and every consumer stay. What changes is only where the
events come from:

| today | after |
|---|---|
| `onDataGridMouseDown` + `matchedGridElement(e.target)` | `grid.onDragInit`/`onDragStart` or a delegated `mousedown` on the canvas + `grid.getCellFromEvent(e)` |
| `onDataGridMouseOver` (`mouseenter` reconstruction) | `grid.getCellFromPoint(x, y)` on `mousemove` — **strictly better**: no `elementFromPoint` + `closest()`, no `relatedTarget` guard, and it works during auto-scroll when no pointer event fires at all |
| `onDataGridClick` / `onDataGridDblClick` | `grid.onClick` / `grid.onDblClick` (both carry `{ row, cell }`) |
| `onDataGridContextMenu` | `grid.onContextMenu` / `grid.onHeaderContextMenu` |
| `onKeydown` on the container | `grid.onKeyDown`, with the app's handler running first |
| the rAF auto-scroll loop | unchanged — it drives `viewport.scrollTop/scrollLeft` and re-hit-tests with `getCellFromPoint` |

The gutter/row menu vs. cell menu split is `args.cell === GUTTER_COLUMN_INDEX`, replacing today's
class test. **The `SlickCellSelectionModel` + `SlickCellRangeSelector` question (§4) is decided
here, with the code in front of the implementer** — the deciding criterion is whether
`SlickRange[]` can be mirrored into `Selection`'s four kinds without either side becoming the
authority, and the default if it cannot is to keep the app's own.

### 8.2 Editing (§2 items 22, 23)

A `KiraCellEditor implements Editor`:

- `init(args)` builds the input in `args.container`, applies `wrapSelectionOnType`.
- `loadValue(item)` reads `displayCell(item.row, col)` — the staged value if there is one.
- `serializeValue()` returns the buffer verbatim (P24 D14's documented scope limit: no NULL).
- `applyValue(item, state)` calls `stageEdit(tabId, item.row, name, state)` — **it must never write
  to the item or the page**; the frozen-page tripwire (`store.ts:98`) would throw, which is the
  correct behaviour and worth a test.
- `isValueChanged()`, `validate()` per the interface.

Options: `editable` bound to `canEditTable`, `autoEdit: false`, `autoCommitEdit: true`,
`asyncEditorLoading: false`. `onBeforeEditCell` is vetoed (`getReturnValue() !== false`) for a
deleted row, a truncated value (P24 D27) and the gutter column. The single-overlay `<input>` that
`P22-…-iter2-rendering.md` D4 introduced disappears — SlickGrid puts the editor in the cell itself,
which is where it lived before that change, so this is a return to the earlier shape, not a new one.

### 8.3 Clipboard and search (§2 items 25, 27)

Both are almost pure re-homing. `clipboardFormats.ts` is untouched; `onCopy`/`onPaste` move from a
container `keydown` to `grid.onKeyDown`. Search's match hash is D5's `kira-search` layer, its filter
is D1's `getLength`/`getItem`, and `goToMatch` becomes `grid.scrollCellIntoView(pos, cell)`.

### 8.4 Pending insert rows (§2 item 26) — the hard one

§5.1 item 1. The design: `getLength()` = `displayRowCount + inserts.length`; `getItem(pos)` returns
a handle carrying `insertId`; `getItemMetadata(pos)` gives the row `pending-insert` and, per column,
`{ editor: KiraInsertEditor }` so a click opens an editor bound to `stageInsertValue`. The
positional identity rule (`pending.inserts[row - p.rowCount]`, `:1643`) is unchanged. The behaviour
change — insert cells are edited one at a time rather than being N simultaneously-focusable inputs —
must be shown to the user before it ships, and `mutations.spec.ts`'s insert scenarios are the
regression guard.

### 8.5 Cutover

The final commits, in order: (1) `__kiraGridEngine` defaults to `'slick'`; (2) `tests/ui/` selectors
migrated where D10's attribute pass did not already cover them, and the budget gates re-pointed at
the new DOM at their **existing thresholds — no threshold is loosened**; (3) `DataGrid.vue`,
`GridRow.vue`, `rowVm.ts`, `tests/unit/row-sig.spec.ts` and the now-dead half of `columns.ts`
deleted, `@tanstack/vue-virtual` kept for its four other consumers; (4) `docs/ARCHITECTURE.md` and
`docs/PERF.md` updated.

### 8.6 What Pass B's own plan must re-derive rather than inherit from here

1. Whether `SlickCellSelectionModel` + `SlickCellRangeSelector` are adopted (§4, §8.1).
2. The real cost of D5's `setCellCssStyles` layering on a 10 000-match search (F5's caveat), measured
   on the Pass-A build rather than reasoned about.
3. The real cost of D10's `onRendered` attribute pass, and whether the spec surface is cheaper to
   rewrite than to preserve.
4. Whether item 5's frozen-gutter change alone moved the real-hardware numbers — if §7.4(b)'s A/B
   says it did, that is `P22-…-iter2-rendering.md` F12's open question answered, and it belongs in
   `docs/PERF.md` regardless of what happens to the rest of the migration.
5. The exact `tests/ui/` diff, which cannot be written until the Pass-A DOM exists.

---

## 9. Verification

### 9.1 Provable in this sandbox

Properties of the app's own JS/DOM that do not depend on a compositor:

- **§7.4(a) items 1-8**, gated by `tests/ui/slick-grid.spec.ts` (C6).
- **The data bridge's arithmetic**: `tests/unit/slick-data-source.spec.ts` (C3) — display-position ↔
  page-row across a filter, the insert region, boundary rows.
- **The runway refactor is behaviour-preserving**: `tests/unit/row-range.spec.ts` passes unchanged
  after C1.
- **The teardown actually happens**: D3's three-part assertion. **This is the one item the brief
  singled out and it is a gated test, not a code-review note.**
- **The bundle projection is real**: `bun run build` before and after C2/C5, reporting the launch
  chunk's gzip delta against a freshly re-measured baseline — not against this document's quoted
  348 411 B. F9 says to expect ~+42 KB gzip for the JS and ~+1.3 KB for the CSS; a materially larger
  number is a finding (something pulled in `SlickDataView` or a plugin) and must be chased, not
  accepted.
- **Nothing regresses on the default engine**: the whole `tests/ui/` and `tests/unit/` suite,
  unmodified, for every Pass-A commit.
- `bun run typecheck`, `bun run lint`, `bun run build`, `bun test apps/kira-studio/tests/unit`.

### 9.2 Genuinely real-Mac only

- **Whether the scroll lag is perceptibly better.** §7.4(b). No sandbox measurement can answer this:
  Playwright drives `scrollTop` on the main thread, so the compositor can never be ahead of the main
  thread's knowledge of the offset — the only condition that produces the symptom
  (`P22-…-iter2-rendering.md` §1.2, F4).
- **Real per-frame `renderMs` under a momentum scroll**, and the `scrollEvents` histogram.
- **The Web Inspector's Script / Style / Layout / Paint / Composite split**, if §7.4(b) comes back
  inconclusive (`P22-…-iter2-rendering.md` §7.3 step 7).
- **Whether the frozen-gutter change (item 5) affects the scrolling-tree commit cost**
  (`P22-…-iter2-rendering.md` F12) — measurable only there, and now measurable for free as a side
  effect of the same A/B.

### 9.3 What this migration is *not* expected to change, and must not be credited with

**Memory.** `docs/WEBVIEW-SCROLL-MEMORY.md` and `P22-webview-scroll-performance-iter2-memory.md`
closed that half: the plateau is WebKit compositor tile pooling driven by the scrolled layer's
geometry and velocity, essentially independent of what paints inside it. SlickGrid produces the same
input to that machinery — a tall scroller with a mounted band inside it — and D4's runway raises the
mounted band during a fling by design. If the memory number moves at all, it moves *up*, slightly,
while flinging. That is the trade `P22-…-iter2-rendering.md` D3(d) and F7 already priced and
accepted; it is not a regression to chase and not a benefit to claim.

### 9.4 Budgets that must not move

`budgets.spec.ts`'s scroll response (p50 ≤ 12 ms / max ≤ 50 ms), both overscan-coverage invariants,
the DOM-cell bounds (`< 2 500` / `< 1 500`), `perf.spec.ts`'s rAF p95 and its retained-bytes check,
and `leaks.spec.ts`'s tab/store symmetry. During Pass A these all run against the default engine and
are simply untouched. At Pass B's cutover they are re-pointed at the new DOM **at their existing
thresholds**. No threshold is loosened in either pass.

---

## 10. Acceptance checklist — Pass A

1. `slickgrid@5.20.0` is a dependency, and the **only** named imports anywhere in the tree are
   `SlickGrid` (Pass A) — no `SlickDataView`, no `import * as`, no plugin.
2. `views/grid/slick/dataSource.ts` never materialises a row, never allocates a row object for a
   row SlickGrid is not building, and routes every cell value through the existing `displayCell` →
   `page.ts` `cell()` → `store.cachedView` chain.
3. `__kiraRetention().decodeCacheRows` stays pinned to the mounted window on the Slick engine, under
   a sustained scroll — P5 C1 holds through the new bridge.
4. `KiraSlickGrid.getRenderedRange` reuses `rowRangeBounds` and produces, at zero velocity, a band
   **at least** as deep as the incumbent's 560 px per side; `tests/unit/row-range.spec.ts` passes
   unchanged.
5. `enableColumnReorder: false`, `enableHtmlRendering: false`, `autosizeColsMode: LegacyOff`,
   `selectedCellCssClass: ''` — each with a one-line comment saying which finding it answers
   (F7, F6, F1, D5). `sortablejs` is not installed.
6. **`SlickGridHost.vue`'s `onUnmounted` calls `grid.destroy(true)` after unsubscribing its event
   handler and removing its own listeners, and a `tests/ui/` assertion proves that five open/close
   cycles leave zero `.slick-viewport` elements, no extra `<style>` element in `<head>`, and
   `__kiraRetention()`/`__kiraRetainedBytes()` back at their pre-open values.**
7. The grid instance is never held in a `ref`/`shallowRef`/`reactive` — `CodeMirrorHost.vue:73`'s
   rule, stated in a comment at the declaration.
8. No colour, spacing or radius in `slickTheme.css` is a literal — every one is a `--kira-*` token,
   and neither SlickGrid theme stylesheet is imported.
9. `__kiraGridEngine` defaults to the existing grid; every pre-existing `tests/ui/` and
   `tests/unit/` spec passes **unmodified**; no budget threshold is loosened.
10. `__kiraScrollTrace` works against both engines on one build (`registerGrid`'s row-selector
    parameter), so §7.4(b)'s A/B needs one build and one flick per variant.
11. The measured `bun run build` launch-chunk delta is recorded in `docs/ARCHITECTURE.md` and in the
    C2/C5 commit messages — a real number, not this document's projection.
12. `docs/PERF.md` carries §7.4(b)'s protocol, beside §2.1a's, and says plainly that Pass B is gated
    on it.
13. **Nothing in this pass claims the user's symptom is fixed.** The claim Pass A is allowed to make
    is: the bridge is correct, the teardown is proven, the runway is preserved, the bytes are
    measured, and §7.4(b) is the experiment that says whether it helped.

---

## 11. Open questions and risks, handed forward

- **The first and largest: nobody has yet run `P22-…-iter2-rendering.md` §7.3.** Every document in
  this investigation now says so, including this one. If §7.4(b) comes back FAIL *and* `renderMs`
  was already small on the old grid, then JS throughput was never the bottleneck, and the honest
  conclusion is that no DOM grid — SlickGrid, Tabulator, regular-table — could have helped. That is
  a real possible outcome of this plan and it is not a failure of the plan.
- **F5's `setCellCssStyles` rebuild cost.** `updateCellCssClassesByCell` rebuilds the merged map
  across *every* layer on *any* layer change. A selection change on a page with 10 000 search
  matches therefore costs O(matches). Measured in Pass A (§9.1), fixed in Pass B if it bites, by
  scoping the search layer to the rendered range and re-setting it from `onRendered`.
- **D10's `onRendered` attribute pass is a testability tax on the hot path.** It exists to keep the
  spec rewrite small. If it costs measurable frame time, the right trade is to rewrite the selectors
  instead — the migration's purpose is the frame time, not the selectors.
- **`data-row` means two different things** on the two engines while a filter is active (display
  position vs. page row). D10 corrects it in the `onRendered` pass; if that pass is ever dropped, the
  specs silently start asserting on the wrong index.
- **SlickGrid's own `getRenderedRange` is the single coupling point to library internals** (D4). It
  is a public, documented method on an exported class, so this is a small surface — but a version
  bump must re-check that `render()` still calls it and that its return shape is unchanged. Named in
  the file's own comment.
- **`SlickDataView` will look tempting later** — for grouping, for a tree view, for client-side
  sorting. Taking it re-opens the materialised-row-array question and P5 C1 with it. If it is ever
  proposed, the answer starts from F9 and D1, not from convenience.
- **The console keeps a second rendering model** (§2.3), on purpose, bounded, and reversible.
- **The general lesson, third time in this phase.** The survey's central architectural finding
  rested on a doc comment that was *accurate* and an inference from it that was *wrong* — the seam it
  named is real and is not on the render path (F1). `WEBVIEW-SCROLL-MEMORY.md` §2.1, pass 1's event
  coalescing, and the "does it pool DOM nodes?" framing are the same failure in three earlier
  disguises. The discipline that catches it is the same every time: **find the call site, not the
  description.**

---

## 12. Sources

**Library source, read in this session** from the published `slickgrid@5.20.0` tarball
(`registry.npmjs.org/slickgrid/-/slickgrid-5.20.0.tgz`, integrity
`sha512-exoa+3NqDyIvSjHEd142/LQV9psmGJxGOBM2iPaZbvKU4gjxtLVIdnNgXdrHLRMTAPgGakuwy940Y8ecdVcl8w==`),
extracted and cited by line: `dist/esm/index.js` (12 265 lines), `dist/types/slick.grid.d.ts`,
`dist/types/models/editor.interface.d.ts`, `dist/styles/css/slick.grid.css`, `package.json`.

**Measured in this session**: `esbuild@0.28.2 --bundle --minify --format=esm` + `gzip -9` over
per-import-set entry files, for every figure in F9.

**In-repo, read in full for §2 and §5**: `views/grid/DataGrid.vue`, `views/grid/GridRow.vue`,
`views/grid/rowVm.ts`, `views/grid/DataView.vue`, `views/grid/ColumnsMenu.vue`,
`views/grid/state.ts`, `views/grid/page.ts`, `views/grid/scrollTrace.ts`,
`views/shared/page/columns.ts`, `views/shared/page/store.ts`, `views/console/ConsoleResultGrid.vue`,
`editor/CodeMirrorHost.vue`, `theme/cellClass.ts`, `theme/icons.ts`, `theme/tokens.css`,
`workbench/state/tooltip.ts`, `state/contextMenu.ts`, `main.ts`, `tests/ui/budgets.spec.ts`,
`tests/ui/global.d.ts`.

**Prior plans, cited throughout**: `docs/v1.1/plans/P22-grid-library-survey.md`,
`docs/v1.1/plans/P22-grid-library-evaluation.md`,
`docs/v1.1/plans/P22-webview-scroll-performance-iter2-rendering.md`,
`docs/v1.1/plans/P22-webview-scroll-performance-iter2-memory.md`,
`docs/v1.1/plans/P22-webview-scroll-performance.md`, `docs/v1.1/plans/P5-ram-usage.md`,
`docs/v1.1/plans/P18-sql-language-server-explain.md`,
`docs/v1.1/plans/P13-query-console-format-button.md`, `docs/ARCHITECTURE.md`, `docs/PERF.md`,
`docs/WEBVIEW-SCROLL-MEMORY.md`, `AGENTS.md`.
