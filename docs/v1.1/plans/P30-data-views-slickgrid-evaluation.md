# P30 — the app's other data views, evaluated against the SlickGrid grid

> **What this phase is.** An evaluation, not a mandate. P22 Pass B finished the main data grid's
> migration to SlickGrid and deleted the incumbent (`52b8a80`, `refactor(grid)!: SlickGrid is the
> only grid engine`). Two questions came out of that, both from the user, both answered here against
> the actual source rather than from the shape of the previous answer:
>
> 1. *"why is [the query console's result grid] different from the main grid, they should reuse the
>    same components"*
> 2. *why do the tree/list views use `VirtualList.vue` and not SlickGrid — and could SlickGrid do a
>    one-dimensional list at all?*
>
> **The verdicts, up front.** One view migrates. Five do not, and the reasons are specific to each
> rather than one blanket argument repeated six times:
>
> | View | Verdict |
> |---|---|
> | `views/console/ConsoleResultGrid.vue` — **tabular branch only** | **Migrate** (§3). It is the only remaining two-dimensional, column-virtualized surface in the app; it duplicates the grid's column-axis machinery; it has a real, reproducible layout defect the grid already solved; its rows are genuinely unbounded; and migrating it retires `@tanstack/vue-virtual` from the tree entirely |
> | `views/console/ConsoleResultGrid.vue` — document and key-value branches | **Leave as-is** (§3.4). They render Vue component trees (`DocumentRow`/`DocumentTree`/CodeMirror), not formatted cells |
> | `views/stream/StreamView.vue` | **Not now** (§4). Six columns × 10 000 rows is an order of magnitude under the shape P22 was fixing, and its one real defect has a five-line CSS fix that needs no grid engine. Named as the cheapest second adopter if §3's host ever earns a second consumer |
> | `views/keyvalue/KeyValueView.vue` | **Leave as-is** (§5). Three columns, two of them fixed-width, no horizontal axis at all. SlickGrid's entire column apparatus would be dead weight |
> | `views/documents/DocumentView.vue` | **Leave as-is** (§6) — but **not** for the reason everyone reaches for first. `slickgrid@5.20.0` *does* support variable row heights natively (F2). The real blocker is that a document row is an interactive Vue subtree with a code editor in it |
> | `views/browse/BrowseView.vue` | **Leave as-is** (§7). A one-dimensional file-browser list with no columns and no header |
> | `views/shared/document/DocumentTree.vue` and the rest of the `VirtualList` family | **Leave as-is** (§8), with the "could SlickGrid do a 1D list" question re-derived rather than repeated — and one honest correction: `DocumentTree` is not virtualized *at all*, which turns out to be a bounded, deliberate design rather than the defect it looks like |
>
> **The single most load-bearing finding.** `SlickGridHost.vue` (2 283 lines) is **not a component
> anything can reuse** — it is bound to `findDataTab(props.tabId)`, `views/grid/state.ts`'s runtime,
> `pendingChanges.ts`, `menu.ts`, the cell editor, the hybrid selection model and the FK/PK nav
> apparatus, none of which a console result has. "Reuse the same components" is therefore satisfied
> **one layer down**, and that layer already exists and is already engine-agnostic: `KiraSlickGrid`,
> `slick/dataSource.ts`, `slickTheme.css`, `views/shared/page/columns.ts` and `theme/cellClass.ts`
> (F1). §3 reuses all five and writes ~300 new lines, rather than extracting a core out of the
> hard-won host.
>
> **Nothing in this phase may touch** `KiraSlickGrid.getRenderedRange`'s runway/budget/chase logic,
> `scheduleChase`, the velocity sampler, or `slickTheme.css`'s `contain: layout` on `.slick-row` —
> P22 Pass B §0.1's standing prohibition, restated because §3 constructs a *second* `KiraSlickGrid`
> and the temptation to "just tune it for the console" is exactly the thing that must not happen.
> §3.5 says how a second instance gets the mechanism unchanged: it inherits it, it does not
> re-derive it.

---

## 0. Scope, baseline, ground rules

### 0.1 Baseline

- Branch `claude/feature-v1-1-p5-onwards-2isfzt` at **`dd1b51c`** (`docs(grid): P22 postscript §14.2
  — the four fixed items, the fifth applied`), read **2026-09-03**. Every file:line citation below
  points at that commit's content.
- The SlickGrid migration is **done and cut over**: `DataView.vue` mounts `SlickGridHost.vue`
  unconditionally, `DataGrid.vue`/`GridRow.vue`/`rowVm.ts` are deleted, `__kiraGridEngine` is gone
  (P22 Pass B §14.4).
- `slickgrid@5.20.0`, MIT, a plain npm dependency — **not vendored, not patched** (`package.json:75`;
  `bun.lock:599` resolves the published tarball with no `patchedDependencies` entry anywhere).
  Library claims below are cited from `node_modules/.bun/slickgrid@5.20.0/node_modules/slickgrid/src/`,
  read this session, the same convention P22 Pass B §0.1 established.
- `@tanstack/vue-virtual@3.13.36` (`package.json:50`) has, at this commit, **one** runtime consumer
  (`ConsoleResultGrid.vue:3,132-145`) and **one** type-only import (`columns.ts:3`, `Range`).

### 0.2 The three tiers of "reuse the same components"

The user's word is *components*, but three different things could be meant, and only the middle one
is actually available:

1. **Mount `SlickGridHost.vue` itself.** Not possible. F1.
2. **Reuse the layer underneath it** — the `KiraSlickGrid` subclass (the whole tuned scroll
   mechanism), the `CustomDataView` bridge, the theme, the column/width helpers, the cell-class
   vocabulary. Every one of these is already a standalone module with no data-tab dependency. **This
   is what §3 does.**
3. **Reuse the *look*** — same fonts, same row height, same gutter, same NULL/truncated/type-colour
   treatment, same hover, same selection ring. Falls out of (2) for free, because `slickTheme.css`
   is scoped to `.slick-grid-host` (a class on the host root, `SlickGridHost.vue:2259`) and is a
   plain global CSS import, not a scoped `<style>` block.

### 0.3 Not in this phase

- **Any change to `SlickGridHost.vue`'s render, scroll, selection, editor or nav paths.** §3.6 C4 is
  the *only* edit to that file in the whole plan, it is confined to one pure function, and it is
  optional (§3.6 names the duplicate-instead variant and when to prefer it).
- **`views/definition/DefinitionView.vue`** — a CodeMirror document view, not a data view.
- **Any Go-side work.** `frontend/`, `tests/`, `docs/` only. (The one Go file read here,
  `internal/adapters/postgres/console.go`, was read to settle F3, not to change it.)
- **Re-running the real-Mac scroll A/B.** §10.3 names this phase's own, much narrower real-hardware
  obligation.
- **`project/ProjectTree.vue` and `workbench/panels/OperationsPanel.vue`.** Covered by §8's family
  verdict; neither is a data view in the sense this phase's brief names.

---

## 1. Findings — read from source this session

### F1 — `SlickGridHost.vue` is not reusable; the layer under it is. **This is what decides §3's shape.**

`SlickGridHost.vue` takes exactly one prop, `{ tabId: string }` (`:104`), and resolves everything
else from data-tab state: `findDataTab` (`:113`), `views/grid/state.ts`'s `runtime` (`:196`),
`pendingChanges.ts`'s `stageEdit`/`addInsertRow`/`stageInsertValue`, `menu.ts`'s three menu
builders, `clipboardFormats.ts`, `rowValues.ts`'s FK/PK nav apparatus, `editor.ts`'s
`KiraCellEditor`, `SlickHybridSelectionModel`, and `patchDataTabState` for width/order/scroll
persistence. A console result has **none** of these: no tab record, no pending changes, no primary
key, no writable target, no persisted column state, no sort.

What *is* reusable, verbatim, with no console-specific edit:

| Module | What it gives | Console dependency on data-tab state |
|---|---|---|
| `views/grid/slick/kiraSlickGrid.ts` (479) | the entire tuned scroll mechanism — velocity-adaptive directional runway, the per-render cell budget, the quiescence-gated chase, the column-overscan clamp, and the `bindAncestorScrollEvents` capture-flag fix (Pass B §14.2) | **none.** The host supplies `velocity`/`lastScrollEventAt`/`scrollEventSeq`/`mountedColumnCount` as plain assignments (`:135-163`); every one defaults to a safe "at rest" value |
| `views/grid/slick/dataSource.ts` (265) | `DisplayRowIndex` (the filtered/unfiltered display-position space), `RowHandle`, `createGridDataSource`, `rowAtDisplayPosition`/`displayPositionOf` | **none.** `GridDataSourceState` is `{ index, inserts, rowClasses?, rowColumns?, extractValue }` (`:123-141`); a console result passes `inserts: []` and omits both optional callbacks. `createDisplayValueExtractor` (`:220`) *is* grid-specific (it reads `pendingChanges`) — the console writes its own eight-line extractor over `resultPages.ts`'s `cell()` instead |
| `views/grid/slick/slickTheme.css` (35 787 B) | every visual rule, scoped to `.slick-grid-host` | **none** |
| `views/shared/page/columns.ts` | `initialWidths` (`:57`), `GUTTER_WIDTH` (`:14`), `DEFAULT_COLUMN_WIDTH` (`:17`), `alignmentFor` (`:338`), `columnHeaderTooltip` (`:377`), `resetMeasureCtx` (`:43`) | **none** — the console already imports all six (`ConsoleResultGrid.vue:23-36`) |
| `theme/cellClass.ts` | the `selected`/`searchMatch`/`searchMatchCurrent`/`isNull`/`alignRight` class vocabulary | **none** — the console already imports it (`:11`) |

That table is the answer to *"they should reuse the same components"*: after §3, the console result
grid and the data grid share the scroll engine, the data-view bridge, the theme, the column
measurement, and the cell-class vocabulary. What stays separate is only what genuinely differs — a
console result has no editing, no selection ranges, no sort, no FK navigation, no persisted state.

### F2 — `slickgrid@5.20.0` supports variable row heights natively. **This retires the obvious objection to `DocumentView`, and the objection was going to be wrong.**

The naive reason to rule out `DocumentView` is "SlickGrid assumes a uniform `rowHeight`". At
5.20.0 that is **false**:

- `enableVariableRowHeight?: boolean` (`src/models/gridOption.interface.ts:182-196`): *"When enabled,
  rows may have differing heights: each row's height comes from the `rowHeightProvider` grid option
  … falling back to the default `rowHeight` whenever the provider returns `undefined`."*
- `rowHeightProvider?: (grid, row, item) => number | undefined` (`:344`), defaulting to
  `grid.getItemMetadaWhenExists(row)?.height` (`src/slick.grid.ts:251`), i.e. `ItemMetadata.height`
  (`src/models/itemMetadata.interface.ts:23-26`) — which this app's data source already produces
  metadata for (`dataSource.ts:186-200`).
- `RowPositionIndexer` (`src/slick.core.ts:1337-1420+`) is a **prefix-sum index with a hinted binary
  search**: `rowPos[i]` is row `i`'s top, `rowPos[rowCount]` is the total height, `top()` is an O(1)
  array read and `rowAt(y)` an O(log n) search, with linear extrapolation past the indexed range.
- `grid.invalidateRowHeights()` (`src/slick.grid.ts:6388`) rebuilds it when heights change without a
  row-count change.

That is, line for line, the same algorithm `VirtualList.vue` grew by hand at P27 D18 (`offsets`
prefix sum `:59-66`, `rowIndexAtOffset` binary search `:68-79`, `rowHeights` prop `:14`). So the
height objection is not available, and §6 does not use it. What rules `DocumentView` out is
different and stronger (§6.2).

*(This finding is also why §6 is worth writing down at all: "we checked, the library can do it, and
we still say no, here is the actual reason" is a materially different document from "we assumed it
couldn't".)*

### F3 — Console tabular results are **not** row-capped. P22 Pass B §6 reason 4 is wrong about rows.

Pass B §6 declined the console partly because *"console results are capped
(`tests/unit/console-result-cap.spec.ts`)"*. That spec caps **result sets**, not rows:
`views/console/state.ts:182` is `const MAX_RESULTS_PER_TAB = 50` and `:186` evicts whole result
records once a tab holds more than 50 of them. Nothing anywhere caps a single result's `rowCount`:

- Backend: `internal/adapters/postgres/console.go`'s `runRaw` scans `for rows.Next()` into an
  unbounded `out [][]*string` (`:56-67`) with no `LIMIT` injection and no row ceiling; the
  ClickHouse console path has no limit either.
- Frontend: `resultPages.ts`/`store.ts` retain and window the page; nothing truncates it.

So `SELECT * FROM events` in the console against a large table produces a result whose row count is
the table's row count, rendered through `VirtualList` — the *only* unbounded row source in the app.
The data grid, by contrast, is capped at a 10 000-row page (`views/shared/page/sizes.ts:12-17`).

This does not by itself prove a user-visible problem (nobody has reported one, and the column axis
*is* windowed). It does mean the "it's capped, so it can't be the problem" argument is not available,
and it moves the console from "smaller than the grid" to "potentially larger than the grid".

### F4 — The console's row-number gutter scrolls horizontally out of view. **A real defect the grid already fixed.**

`ConsoleResultGrid.vue`'s tabular row is `width: var(--total-width)` (`:542-546`) inside
`.virtual-list`'s `overflow: auto` (`VirtualList.vue:180-183`), and the gutter is
`position: absolute; left: 0` **relative to the row** (`:555-557` establishes `.row.col-virtual` as
the positioned ancestor; `:573-579` positions `.gutter-cell` against it). A row translates left with
horizontal scroll, so the gutter translates with it — on any result wide enough to scroll, the row
numbers leave the viewport. The header gutter (`.header-gutter`, `:388`) goes with them.

The data grid solved exactly this with a real frozen pane — `frozenColumn: 0`
(`SlickGridHost.vue:1762`), whose own comment cites the per-mounted-row cost of the
`position: sticky` alternative. §3 gets the fix for free rather than as work.

### F5 — `VirtualList` vs SlickGrid, capability by capability

Read side by side (`VirtualList.vue` in full; `slick.grid.ts` as cited):

| | `VirtualList.vue` (197 lines) | SlickGrid |
|---|---|---|
| Row virtualization | yes, fixed `overscan: 8` rows (`:16`), uniform or prefix-sum heights (`:59-98`) | yes, pixel-budgeted; `KiraSlickGrid` adds velocity-adaptive directional runway + chase |
| Column virtualization | **none** — a caller that wants it brings its own (`ConsoleResultGrid.vue`'s tanstack instance) | built in, per-column, plus `clampColumnOverscan` |
| Header | one `position: sticky` slot in normal flow; its height is deliberately **not** accounted for in `topSpacer`/`bottomSpacer` (`:165-170`: *"off by its own height, well inside the default overscan"*) | a separate pane; exact |
| Frozen column | none | `frozenColumn: n`, a real pane (F4) |
| Row rendering | Vue `v-for` + a scoped slot — full Vue vnode diff + patch per visible row per scroll frame | imperative DOM build into a `rowsCache`; a retained row is never revisited |
| Column resize / sort / cell nav / editors / selection ranges | none | all built in |
| Cost when there is nothing to virtualize but rows | ~197 lines, two computeds, one `ResizeObserver` | a header pane, a canvas pair, a column model, a cell-position index, `setupColumnResize`, `setupColumnSort`, the whole `getRenderedRange` machinery |

The last row is the whole 1D argument, and §8 develops it.

### F6 — `@tanstack/vue-virtual` has one runtime consumer, and it is the branch §3 migrates

`ConsoleResultGrid.vue:3` (`useVirtualizer`, `:132-145`, the horizontal column axis) is the only
runtime import in the tree. `columns.ts:3` imports the `Range` **type** only, used solely as the
parameter shape of `columnRangeExtractor` (`:102`) and `rowRangeBounds` (`:297`, as
`Pick<Range, 'startIndex'|'endIndex'|'count'>` — three numeric fields).

After §3 there is no runtime consumer, `columnOffsets`/`columnRangeExtractor`/
`observeScrollElementRect`/`observeScrollElementOffset`/`MAX_OVERSCAN_COLUMNS` have zero consumers
(grepped: `frontend/src` + `tests/unit`, `columns.ts`'s own definitions excluded), and inlining the
three-field structural type in `rowRangeBounds` lets the dependency leave `package.json` entirely.

Pass B §6 measured that dependency at **6 911 B gzip** (`vue` external), this repo, this codebase.
That number is reused rather than re-measured, per `AGENTS.md`'s measure-with-purpose rule — the
decision in §3 does not rest on it, and re-measuring would not change it.

### F7 — `.p-td` has no `flex-shrink: 0`, which is why stream/key-value columns cannot exceed the viewport

`theme/primitives.css:687-698` declares no `flex-shrink`, so the default `1` applies. In
`StreamView.vue`'s row (`:886-943`, four explicit-width `.p-td`s plus a `flex: 1` body) and
`KeyValueView.vue`'s (`:900-933`, a 40 px gutter, a 220 px field, a `flex: 1` value), widening a
column past the container squeezes its neighbours instead of producing a horizontal scroll. Neither
view has a horizontal scroller at all. §4.2 is where this matters.

---

## 2. The verdict table

`M` = migrate. `R` = reuse specific infrastructure. `A` = leave as-is.

| # | View | Rows today | Columns today | Verdict | The one sentence that decides it |
|---|---|---|---|---|---|
| V1 | `ConsoleResultGrid.vue`, tabular branch (`:377-448`) | `VirtualList`, fixed overscan | `@tanstack/vue-virtual` + `columnRangeExtractor`, absolute `left`/`width` per cell | **M** (§3) | It is the only surface left that duplicates the grid's column-axis machinery, it has an unbounded row source (F3) and a real gutter defect (F4), and migrating it retires a whole dependency (F6) |
| V2 | `ConsoleResultGrid.vue`, document branch (`:449-488`) | `VirtualList` + `rowHeights` | n/a | **A** (§3.4) | Its rows are `DocumentRow` + `DocumentTree` Vue components, not formatted cells |
| V3 | `ConsoleResultGrid.vue`, key-value branch (`:489-526`) | `VirtualList` | two flex cells | **A** (§3.4) | Two columns, one of them `flex: 1`; there is no column axis to virtualize |
| V4 | `StreamView.vue` (`:878-945`) | `VirtualList` | 6 fixed, hand-rolled resize (`:489-510`) | **A now, R later** (§4) | 6 columns × 10 000 rows is ~10× under the shape P22 was fixing, and its real defect (F7) is a CSS fix |
| V5 | `KeyValueView.vue` (`:892-935`) | `VirtualList` | 3, two fixed-width | **A** (§5) | There is nothing two-dimensional here to give a 2D widget |
| V6 | `DocumentView.vue` (`:755-861`) | `VirtualList` + `rowHeights` prefix sum | n/a | **A** (§6) | Not because of heights (F2) — because a row is an interactive Vue subtree containing a CodeMirror editor |
| V7 | `BrowseView.vue` (`:219-237`) | `VirtualList` | n/a — icon + name + detail in one flex row | **A** (§7) | A 1D list with no header and no columns |
| V8 | `DocumentTree.vue` | **not virtualized** (`:41-72`, a plain `v-for`) | n/a | **A** (§8) | Its line count is bounded by top-level field count plus what the user explicitly expanded, and its exact height is a contract the *outer* `VirtualList` depends on |

---

## 3. V1 — `ConsoleResultGrid.vue`'s tabular branch → migrate

### 3.1 Why this is the clear win

Five reasons, in descending weight:

1. **It is a near-duplicate of the grid's *column* axis, not of the deleted `DataGrid.vue`.** The
   user's suspicion ("it's the old grid approach") is half right and worth stating precisely: the
   file was **never** a copy of `DataGrid.vue` (its own header comment, `:50-55`, says so: *"A
   lightweight, read-only sibling of DataGrid.vue — not a retrofit of it"*), and its **row** axis has
   always been `VirtualList`, never a row virtualizer. But its **column** axis is the same design
   the grid had before Pass A, built from the same shared helpers: `useVirtualizer({ horizontal:
   true, rangeExtractor: columnRangeExtractor, observeElementRect: observeScrollElementRect,
   observeElementOffset: observeScrollElementOffset })` (`:132-145`), `columnOffsets` (`:124`),
   absolutely-positioned cells at `left: GUTTER_WIDTH + offsets[c]` (`:394-397`, `:427-430`), a
   sticky header row rebuilt per render (`:386-403`). Every one of those is a hand-rolled answer to a
   question SlickGrid answers natively. **That** is the duplication, and it is real.
2. **A real defect, already solved next door.** F4.
3. **The largest row source in the app is here.** F3.
4. **It retires a dependency.** F6. `AGENTS.md`'s library-first rule is about not hand-rolling
   infrastructure a library provides; removing a second virtualizer whose whole job is subsumed by a
   library already in the tree is that rule applied, not an exception to it.
5. **It is what the user asked for, and it is achievable without touching the hard-won host.** F1,
   §3.5.

### 3.2 P22 Pass B §6's six reasons, re-checked

Pass B §6 declined the console *for Pass B*, and was right to — its own point 6 (*"Pass B's entire
value is that it removes a rendering surface; migrating the console in the same pass would mean
writing a second SlickGrid host at the exact moment the phase is deleting one"*) is a sequencing
argument that expires the moment Pass B lands, which it has. Re-checking all six against `dd1b51c`:

| Pass B §6 reason | Status now |
|---|---|
| 1. Three page kinds through one template | **Still true, and accommodated.** §3.4 migrates one branch and leaves two; the file survives as a three-way switch |
| 2. Shares only the column helpers | **Still true, and now the argument *for*.** Those helpers are the hand-rolled column axis SlickGrid replaces |
| 3. Read-only — ~70 % of Pass B's parity map doesn't apply | **Still true, and now the argument *for*.** ~70 % not applying is why the new host is ~300 lines and not 2 283 |
| 4. Capped, never reported laggy | **Wrong about rows** (F3). The "never reported" half stands and is honestly the weakest support for a migration — this phase does not claim a performance bug, it claims duplication plus a defect plus a dependency |
| 5. Owns its own scoped styles, so deleting `GridRow.vue` can't restyle it | **Confirmed still true** — its `<style scoped>` block (`:530-702`) is self-contained, which is why §3.6 can delete the tabular half of it cleanly |
| 6. Pass B was deleting a rendering surface | **Expired.** Pass B landed (`52b8a80`, `dd1b51c`) |

Pass B also named what reopens it: *"the team decides the ~6 911 B gzip of `@tanstack/vue-virtual`
is worth recovering, since after Pass B that dependency has exactly one runtime consumer"*, and
*"its honest scope is the tabular branch only"*. This phase is that reopening, at that scope.

### 3.3 What is reused, verbatim

F1's table, applied. Concretely, the new file imports and does not modify:

- `KiraSlickGrid` from `views/grid/slick/kiraSlickGrid.ts` — **the entire scroll mechanism**,
  inherited by construction. §3.5 rule 1.
- `createGridDataSource`, `rowAtDisplayPosition`, `displayPositionOf`, `type RowHandle`,
  `type DisplayRowIndex` from `views/grid/slick/dataSource.ts`.
- `views/grid/slick/slickTheme.css` and `slickgrid/dist/styles/css/slick.grid.css` (imported by the
  new file itself, not relied on from `SlickGridHost.vue` — Vite dedupes, and the console must not
  depend on a data tab having been opened first).
- `initialWidths`, `GUTTER_WIDTH`, `DEFAULT_COLUMN_WIDTH`, `alignmentFor`, `columnHeaderTooltip`,
  `resetMeasureCtx` from `views/shared/page/columns.ts` — all six already imported by the file being
  edited.
- `cellClass` from `theme/cellClass.ts`; `categoryForTypeClass` from `theme/icons.ts`.
- `createMatchIndex`, `setVisibleRows`, `matchedRows` — unchanged.

### 3.4 What is deliberately **not** adopted, and what stays on `VirtualList`

- **The document and key-value branches stay.** The document branch (`:449-488`) renders
  `DocumentRow` + an expandable `DocumentTree`, with `rowHeights` from `documentRowHeights`
  (`:213-224`) — §6.2's argument applies to it identically. The key-value branch (`:489-526`) has two
  flex cells and nothing to virtualize horizontally. `ConsoleResultGrid.vue` therefore keeps
  `VirtualList` as an import and keeps its `#default` slots for those two.
- **No selection model.** The console's "selection" is a single `{row, col}` ref (`:254-258`) and its
  own comment (P42 D22) records that two cells can never be selected at once here. Registering
  `SlickHybridSelectionModel` would buy nothing and would pull in Pass B F2's unconditional
  O(rows × cells) `handleSelectedRangesChanged` hash. Use `enableCellNavigation: true` +
  `grid.onClick` + a **one-cell** `setCellCssStyles('kira-cell-selected', …)` layer instead — the
  same visual result at O(1).
- **No sort.** A console result has no re-query path and no client sort today; every column gets
  `sortable: false`, so `setupColumnSort` builds no indicator divs and a header click does nothing
  (`src/slick.grid.ts:1928-1934`).
- **No editor, no context menu, no clipboard, no FK nav, no insert region, no pending changes.**
  None exist here today; none are added.
- **No persisted column widths.** §3.7 item 3.

### 3.5 The design

**New file: `frontend/src/views/console/ConsoleSlickGrid.vue`** (estimated ~300 lines).

```
props: { pageKey: string; tabId: string; connectionId: string | null; path: string }
exposes: { goToMatch(match: Match): void }
```

`ConsoleResultGrid.vue` mounts it as the `page.kind === 'tabular'` branch with
`:key="pageKey"` — a chip switch remounts rather than re-plumbs, which is honest here because the
existing `watch([() => props.pageKey, () => pageVersion.n])` (`:266-269`) already clears the
selection on that transition (P43 iter2 F20/D27: *"a row index into a page that has been replaced
identifies nothing"*). `ConsoleView.vue` is **not touched**: `ConsoleResultGrid.vue` keeps its
`defineExpose({ goToMatch, expandAll, collapseAll })` contract exactly (`:288`), delegating
`goToMatch` to whichever child branch is mounted.

**Three rules, stated at their declaration sites, carried from Pass B §5 D0:**

1. **The scroll mechanism is inherited, never re-derived.** `new KiraSlickGrid(...)`, then
   `grid.velocity = velocity; grid.lastScrollEventAt = () => lastOffsetT; grid.scrollEventSeq = () =>
   scrollEventSeq;` — the same four-field wiring `SlickGridHost.vue:1815-1821` does, from a velocity
   sampler copied structurally from `SlickGridHost.vue:532-623`. No `getRenderedRange` override, no
   tuning constant, no `__kiraGridTuning` read of its own. If the console ever needs different
   pacing, that is a new plan with a real-hardware measurement behind it, not a local constant.
2. **No Vue reactivity on row data.** The grid, the data source, the viewport element and the event
   handler are plain `let`s, never `ref`/`shallowRef`/`reactive` (Pass B §5 D0 rule 2). Every
   imperative call into the grid happens from a `watch` callback or a DOM event handler, never from
   inside a `computed`.
3. **The formatter returns text, never DOM** (`-iter2-pacing` D5). NULL and truncation are classes
   (`cell-null`, `cell-truncated`), already themed at `slickTheme.css:439-447`.

**The data bridge**, three lines of console-specific glue over reused parts:

```ts
const index: DisplayRowIndex = { displayRows: matchedRows(tabId), pageRowCount: page.rowCount };
const fieldToCol = new Map(page.columns.map((c, i) => [c.name, i]));
extractValue = (item, field) => cell(pageKey, item.row, fieldToCol.get(field) ?? -1);
```

`inserts: []`, `rowClasses` and `rowColumns` omitted. `resultPages.ts`'s `cell()` (`:43`) already
memoises the decode and the built `CellView`, exactly as `grid/page.ts`'s does for the data grid —
so the decode/retention story (`setVisibleWindow`, P5 C1) is unchanged, just driven from
`grid.onRendered` + `lastRenderedRowBounds` instead of `VirtualList`'s `visible-range` emit.

**Grid options** (deltas from `SlickGridHost.vue:1747-1813` only):

```
rowHeight, frozenColumn: 0, enableColumnReorder: false, enableHtmlRendering: false,
autosizeColsMode: 'LegacyOff', enableMouseWheelScrollHandler: false, enableCellNavigation: true,
editable: false, enableAddRow: false, explicitInitialization: false,
dataItemColumnValueExtractor: (item, col) => dataSource.extractValue(item, String(col.field)),
// deliberately absent: tristateMultiColumnSort, multiColumnSort, numbered sort, autoEdit,
// autoCommitEdit, selectedCellCssClass (set imperatively per click instead), multiSelect
```

**Columns**: gutter (`id: '__kira_gutter'`, `width: GUTTER_WIDTH`, `sortable/resizable: false`,
`focusable/selectable: false` — nothing selects a row here) plus one per `page.columns` entry, with
`width` from `initialWidths(page)`, `resizable: true`, `sortable: false`,
`cssClass: 'tc-<category>' (+ ' kira-align-right')`, `formatter`, and the free-per-column attribute
bags Pass B F3 established:

```ts
cellAttrs: { 'data-testid': 'console-result-cell', 'data-column': name, 'data-col-index': String(i) },
headerCellAttrs: { 'data-testid': 'console-result-header-cell', 'data-column': name,
                   'data-kira-tip-parts': JSON.stringify(columnHeaderTooltip(col, col.dataType)) },
```

`data-kira-tip-parts` is how the header tooltip survives without a `v-tooltip` directive — the app's
tooltip controller is attribute-driven (`workbench/state/tooltip.ts`), the same seam Pass B §4
item 8 used. `headerTitleFor` (`:86-88`) is deleted and its one call becomes `columnHeaderTooltip`
directly.

**Search**: the filter is the data source (`index.displayRows`), the highlight is two keyed
`setCellCssStyles` layers, the jump is `grid.scrollRowIntoView(displayPositionOf(index, match.row))`
followed by `grid.setActiveCell(...)`. This replaces `isSearchMatch`/`isCurrentSearchMatch`'s
per-cell evaluation in the template (`:274-279`, `:422-424`) — the same trade Pass B §4.1 item 2
recorded for the grid.

### 3.6 Step-by-step

Each step is one commit. Fast checks (`bunx tsc --noEmit`, `bunx biome check`, `bun run build`) per
commit; the expensive suite runs once at C8, per `AGENTS.md`'s implement-then-test convention.

- **C1 — `ConsoleSlickGrid.vue`, mounted but not yet the default.** Create the file per §3.5, wired
  into `ConsoleResultGrid.vue` behind a plain `v-if` on a module-local constant so both branches
  exist side by side for one commit. Nothing else changes. This is the "nothing is deleted before
  its replacement is proven" staging Pass B §0.4 established, at this phase's much smaller scale.
- **C2 — search, filter and go-to-match.** The `displayRows` wiring, the two CSS layers, the
  `scrollRowIntoView` jump, and `ConsoleResultGrid.vue`'s `goToMatch` delegating to the child ref
  for the tabular branch. `SearchToolbar.vue` and `console/search.ts` are untouched.
- **C3 — decode-window and retention.** `grid.onRendered` → `lastRenderedRowBounds` → the same
  `setVisibleRows(tabId, …)` + `setVisibleWindow(pageKey, …)` pair `onVisibleRangeIndices`
  (`:182-189`) does today, translated through `dataSource.getItem()` the way
  `SlickGridHost.vue`'s `onGridRendered` (`:947-968`) does. `leaks.spec.ts`'s console assertion is
  the gate that this did not regress retention.
- **C4 — the search-layer helper, extracted (optional; see the alternative).** Move
  `SlickGridHost.vue`'s `computeSearchHashes` body (`:906-930`) into a new pure function in
  `views/grid/slick/cssLayers.ts`:
  ```ts
  export function searchCellLayers(
    matches: readonly { row: number; col: number }[],
    currentIndex: number,
    columnNameAt: (col: number) => string | undefined,
    isVisibleColumn: (name: string) => boolean,
    toDisplayPosition: (row: number) => number,
    matchClass: string, currentClass: string,
  ): [EdgeHash, EdgeHash]
  ```
  `SlickGridHost.vue`'s function becomes a six-line caller; the console calls it with its own
  `searchState`. **This is the only edit to `SlickGridHost.vue` in the whole plan**, it is a pure
  function with no reference to `grid`, `getRenderedRange`, the render band or the theme, and it
  must be a mechanical move with no behaviour change (the diff should be reviewable as such).
  **Alternative, and prefer it if the move is not mechanical**: duplicate the ~25 lines in the
  console host and skip C4 entirely. Twenty-five duplicated lines is a smaller price than a
  non-mechanical edit to that file.
- **C5 — cut over.** Delete the `v-if` scaffold from C1; `ConsoleSlickGrid.vue` is the tabular
  branch unconditionally.
- **C6 — delete the old tabular branch.** From `ConsoleResultGrid.vue`: the `<VirtualList>` tabular
  block (`:377-448`), `useVirtualizer`/`colVirtualizer`/`colStart`/`colEnd`/`visibleColumnIndices`
  (`:132-161`), `offsets`/`columnOrder` (`:121-124`), `widths`/`totalWidth` (`:98-109`), `cellAt`
  (`:172-174`), `headerTitleFor` (`:86-88`), `isSelected`'s tabular use, `selectTabularCell` +
  `selectTabularCellFromEvent` (`:299-316`, `:358-362`), the `appearanceVersion` watch (`:93-96`,
  moves to the child), and the tabular half of `<style scoped>` (`.row.col-virtual`, `.header-row`,
  `.gutter-cell`, `.cell.header-cell`, `.cell.p-td`, `.cell.align-right`, `.cell.selected`,
  `.cell-null`, `.truncated-marker`, and the `.row:not(.header-row):hover` rules —
  `:548-642` minus what the kv branch still uses). Estimated 703 → ~450 lines. Its
  `defineExpose` contract and `ConsoleView.vue` are unchanged.
- **C7 — retire `@tanstack/vue-virtual`.** Delete `columnOffsets` (`columns.ts:85-101`),
  `columnRangeExtractor` (`:102-141`), `observeScrollElementRect` (`:142-174`),
  `observeScrollElementOffset` (`:175-…`) and `MAX_OVERSCAN_COLUMNS` (`:22`); replace `columns.ts:3`'s
  `import type { Range }` with the three-field structural type `rowRangeBounds` (`:297`) actually
  uses; delete `tests/unit/column-range.spec.ts` (its only subject is gone —
  `AGENTS.md`'s "no findings document survives" discipline applied to a test whose subject was
  deleted, not a coverage cut); remove `@tanstack/vue-virtual` from `package.json:50` and refresh
  `bun.lock`. `OVERSCAN_PX` (`:20`) **stays** — `kiraSlickGrid.ts:12,449` uses it.
- **C8 — tests and docs.** §3.7, §11.

### 3.7 Three behaviour changes, named before implementation

Pass B §4.1's discipline: say what genuinely changes before writing it.

1. **Type-based cell colour appears in the console for the first time.** The console renders no
   `tc-*` classes today; §3.5 gives every column one, and the root carries
   `:class="{ 'kira-grid--row-coloring': settingsState.appearance.rowColoring }"` exactly as
   `SlickGridHost.vue:2259-2261` does. P9's setting is worded as *"the data grid's row coloring"*, so
   extending it to console results is a deliberate widening — and it is the single most visible
   answer to *"why is this different from the main grid"*. **Flagged for the user to confirm**; if
   the answer is no, omit the root class and the `tc-` prefix, and the rest of the plan is unaffected.
2. **The truncation marker becomes a CSS `::after` instead of a `<span>` with a tooltip.** Today:
   `<span class="truncated-marker" v-tooltip="'value truncated at 64 KB'">…</span>` (`:438-443`).
   After: `.cell-truncated::after` (`slickTheme.css:443-447`), matching the grid — which is the
   point, but the marker's own tooltip is lost. Accepted as convergence, named so it is not
   discovered.
3. **Column resize appears, and does not persist across a result-chip switch.** `resizable: true` is
   free and the console has no resize today. Widths reset on remount (`:key="pageKey"`), because a
   console result has no persisted tab state to hold them. Accepted; the follow-up if anyone asks is
   a `Record<pageKey, Record<string, number>>` in `console/state.ts`'s runtime, ~10 lines, out of
   scope here.

Also, as pure additions with no counterpart today: keyboard cell navigation
(`enableCellNavigation: true`), a frozen gutter (F4's fix), and a header tooltip that survives
column virtualization.

### 3.8 Tests

The `data-testid` surface is preserved by name, so most assertions are unchanged. What must change,
and why:

| Spec | Change |
|---|---|
| `tests/ui/console.spec.ts:418,429,434` | `results.locator('[data-testid="console-result-row"]')).toHaveCount(n)` — SlickGrid clones the row div per frozen pane (Pass B F4), so `data-testid="console-result-row"` must be written on the **right pane only**, by the same `onRendered` tagging pass `SlickGridHost.vue`'s `tagRenderedRows` (`:649`) uses, keeping these three counts valid unchanged |
| `tests/ui/cell-editor.spec.ts:1184` | `page.locator('[data-testid="console-result-cell"]').first().click()` — still valid (`cellAttrs` puts the testid on every data cell, and `.slick-cell` is not cloned), but the *first* cell is now the frozen gutter's neighbour rather than a flow-ordered one; re-read the assertion that follows it |
| `tests/ui/console.spec.ts:257,377,470`, `console-explain.spec.ts`, `leaks.spec.ts:349` | `[data-testid="console-result-grid"]` stays on `ConsoleResultGrid.vue`'s root — **unchanged**, all of them |
| `tests/unit/column-range.spec.ts` | **Deleted** with its subject (C7) |
| `tests/unit/console-result-cap.spec.ts`, `match-index.spec.ts`, `page-store-cell-cache.spec.ts` | Unchanged — none touch the renderer |
| **New** | None. `AGENTS.md`'s unit-test bar: the new file is a host wiring an existing engine to an existing store; there is no parser, no boundary arithmetic, no cache-eviction rule and no concurrency in it. The arithmetic that *would* qualify (`rowRangeBounds`, `clampColumnOverscan`, `dataSource`'s display-position mapping) is already covered by `kira-slick-grid.spec.ts` and `slick-data-source.spec.ts` and is reused, not rewritten |

**A locator note that matters**: `tests/ui/support/grid.ts` scopes every helper under
`[data-testid="data-grid"]` (`:24`, `:43`, `:80`), so a second SlickGrid instance in the console
cannot collide with the data grid's helpers. `headerCell` (`:49`) is the one exception — it is
unscoped — which is why §3.5 gives the console's header cells a **different** testid
(`console-result-header-cell`, not `grid-header-cell`).

---

## 4. V2 — `StreamView.vue` → not now

### 4.1 Current implementation

`VirtualList` for rows (`:878-884`), fixed `rowHeight` from density (`:127`), and a **six-column
fixed schema** — gutter (40 px), key, timestamp, headers, attrs, and a `flex: 1` body
(`:886-943`) — with a header row rendered as a `.p-thead` **sibling** of the list (`:826-877`), not
inside it. Column resize is hand-rolled: `onResizeStart`/`onResizeMove`/`onResizeEnd` (`:495-510`)
over pointer events, persisting into `tab.state.columnWidths` via `widthFor` (`:489-491`). Per-cell
`@click.stop` handlers publish into `cellSelection.ts`; row click selects; right-click opens
`rowMenu`. Search highlight is per row (`matchSet`/`currentMatchRow`), not per cell.

### 4.2 Recommendation: leave as-is, and fix the one real defect separately

**Not a migration.** Three reasons:

1. **Six columns, not sixty-one.** P22's problem shape was ~43 mounted rows × 61 columns ≈ 2 600
   cells patched by Vue per scroll frame (`docs/PERF.md` §2.1a). Here it is ~43 × 6 ≈ 258 — an order
   of magnitude under it, with a fixed schema that can never grow. Column virtualization has nothing
   to virtualize.
2. **The header is outside the scroller and there is no horizontal axis at all.** With the body
   column at `flex: 1` and `.p-td` at the default `flex-shrink: 1` (F7), the row always fits the
   container. Nothing scrolls sideways, so nothing desynchronizes, so the frozen-pane and
   header-sync wins SlickGrid brings do not apply.
3. **Its hand-rolled resize is ~20 lines and works.** `AGENTS.md`'s library-first rule asks for a
   library before hand-rolling *non-trivial infrastructure*; a fixed-schema pointer-drag over five
   known column keys is not that, and replacing it would mean adopting the whole 2D widget for it.

**The defect it actually has, and its actual fix (out of this phase's scope but named because this
is where it was found):** resizing a stream column past the container squeezes its neighbours
instead of scrolling, because `.p-td` has no `flex-shrink: 0` (F7) and `.tbody-scroll` (`:977-981`)
has no horizontally-scrollable content to scroll. `flex-shrink: 0` on `.stream-row > .p-td` plus a
`width: max-content; min-width: 100%` on the row and the header, with the header moved inside the
scroller (or its `scrollLeft` synced), is ~5 lines. That is the proportionate fix. It is not this
phase's, and it does not need SlickGrid.

**What would reopen this**: §3 lands, is stable for a release, **and** either a stream page grows a
variable column set (it cannot today — the schema is fixed in the template) or someone reports
stream scrolling as slow. Then `StreamView` is the cheapest second adopter of §3's host: its rows
are already `{ key, timestamp, headers, attrs, body, isTruncated }` from `streamRow(tabId, i)`, which
is a five-column value extractor and nothing else. That is also the moment
`views/console/ConsoleSlickGrid.vue` would move to `views/shared/slick/`, and not before — one
consumer does not justify a shared-component folder.

---

## 5. V3 — `KeyValueView.vue` → leave as-is

**Current**: `VirtualList` (`:892-898`), density-driven `rowHeight` (`:138`), a three-cell row —
gutter `width: 40px; flex-shrink: 0`, field `width: 220px; flex-shrink: 0`, value `flex: 1;
min-width: 0` (`:970-983`) — with a `.p-thead` sibling header (`:863-873`) whose three labels change
by redis type (`field`/`index`, `value`/`score`). Per-cell search highlight (`:558-563`), row click
publishes into `cellSelection.ts` (`:490-503`), row right-click opens `rowMenu`, two distinct empty
states (`:875-891`).

**Recommendation: leave as-is, reuse nothing.** This is the clearest "no" in the set:

- **There is no second dimension.** Three columns, two at fixed pixel widths, one filling the rest.
  There is no horizontal scroll, no column order, no resize, no sort, no projection — nothing the
  column half of a 2D grid widget exists to manage. SlickGrid's header pane, column model,
  cell-position index, `setupColumnResize` and `setupColumnSort` would all be constructed and then
  never do anything.
- **Its "columns" are not columns.** The header labels change meaning by redis type (`field` vs
  `index` vs nothing; `value` vs `score`, `:866-871`), and the value cell renders a `truncated` chip
  inline (`:929-931`). A SlickGrid column definition is a stable, named, typed thing; these are two
  fixed slots with type-dependent labels.
- **Its rows are already cheap.** Three cells per row; a page caps at 10 000
  (`sizes.ts:12-17`); `VirtualList`'s overscan already bounds the DOM.

There is also nothing narrow worth borrowing: it does not need runway (its per-row Vue patch is
three text nodes), it does not need a frozen pane (nothing scrolls sideways), it does not need
column virtualization. The honest answer is that this view is already the right size for its job.

---

## 6. V4 — `DocumentView.vue` → leave as-is, for the right reason

### 6.1 Current implementation

`VirtualList` with the **variable-height** path: `:row-height="26"` as the default plus
`:row-heights="rowHeights"` (`:755-762`), where `rowHeights` (`:391-405`) is one entry per row from
`rows.ts`'s `rowHeight(tabId, row, editingRow, expanded, hasSearchPreview)` (`rows.ts:267-279`,
`HEAD_H + lines * LINE_H + BODY_PADDING_V`), recomputed on `pageVersion` **and** `rowsVersion` so a
nested-path toggle inside `DocumentTree` re-measures. Each row is a `DocumentRow` component with an
`#actions` slot (an `editing` chip and two `IconButton`s) and a `#body` slot holding one of: a
`<mark>`-segmented search preview, a `DocumentTree`, a read-only `CodeMirrorHost`, or — while
editing — a **read-write `CodeMirrorHost` plus `EditBufferActions` plus Save/Cancel buttons**
(`:812-858`). `onVisibleRange` (`:329-337`) drives `setVisibleRows` + `setVisibleWindow` +
`pruneRows`.

### 6.2 Recommendation: leave as-is — and the height objection is **not** the reason

F2 establishes that `slickgrid@5.20.0` implements exactly `VirtualList`'s prefix-sum + binary-search
height model natively, driven off the same `getItemMetadata` seam this app's data source already
implements. So "SlickGrid needs uniform rows" is false and must not be the argument.

The real reasons, in order:

1. **A row is an interactive Vue component tree, not a formatted cell.** SlickGrid's cell model is
   *"the formatter returns a string (or DOM you built yourself), the grid appends it into a cell div
   it owns and may destroy at any invalidation"*. This app went further and made that a rule with a
   measured basis: `-iter2-pacing` D5's *"the formatter returns text, never DOM"*, which Pass B §5 D9
   breaks in exactly **one** place (the pending-insert `<input>`) and gates when it does. A document
   row needs `IconButton`s with tooltips, a twisty, chips, `<mark>` runs, a `DocumentTree` with
   per-line expand buttons, and — while editing — a full CodeMirror instance with an edit buffer.
   Hosting a live CodeMirror inside a cell div that `invalidateRow` may replace, inside a
   `contain: layout` row, is a category of problem this codebase has deliberately never taken on.
2. **The alternative is a rewrite of shared components the console also uses.** Rendering that
   content imperatively means reimplementing `DocumentRow.vue` and `DocumentTree.vue` in DOM-building
   form — and `ConsoleResultGrid.vue`'s document branch imports both (`:13-14`), so the rewrite
   lands in two views at once.
3. **There is nothing two-dimensional to gain.** No columns, no header, no horizontal axis, no
   resize, no sort. Every capability SlickGrid would add is one this view does not have a place for.
4. **The height machinery it does need, it already has, and it is coupled to `rows.ts`.**
   `rowHeight()` is exact and measurement-free by design (`DocumentTree.vue:18-22`: a wrapped line
   would break the prefix sum), and `rowsVersion` is what invalidates it. Moving to
   `rowHeightProvider` + `invalidateRowHeights()` would re-plumb that contract for no gain.

**What would reopen it**: nothing currently foreseeable. If document rows ever became flat,
non-interactive, uniform-height summary rows — i.e. stopped being documents — the question would be
different, but that would be a product change, not a rendering one.

---

## 7. V5 — `BrowseView.vue` → leave as-is

**Current**: `VirtualList` with a constant `rowHeight = 28` (`:123`, `:219`), one flex row per node
— an icon box, a `flex: 1` name, an optional right-aligned detail (`:221-235`) — over
`filteredNodes` (a plain substring filter over the loaded level, `:74-79`). Click selects,
double-click descends or opens a keyvalue tab, right-click opens `menuForNode`. Three empty states.
Level listings are bounded by the adapter's own round budget, surfaced as
`rt.truncated` (`:192-194`).

**Recommendation: leave as-is, reuse nothing.** This is a file-browser list, not a table: no columns,
no header, no horizontal axis, no selection ranges, uniform row height, one flex row per item.
Everything in §5's argument applies more strongly, and the row content (an icon component plus two
spans) is exactly the "cheap Vue row" `VirtualList` is for. It is the clearest example in the set of
what §8's answer is about.

---

## 8. V6 — `DocumentTree.vue` and the 1D `VirtualList` family

### 8.1 The honest correction first: `DocumentTree` is not virtualized at all

Its template is a plain `v-for="line in lines"` over `visibleLines(tabId, row)`
(`DocumentTree.vue:41-72`), with no windowing of any kind. `visibleLines` (`rows.ts:165-171`) walks
the parsed root and, per `walk` (`:152-159`), emits **the first layer always, plus the descendants of
every explicitly expanded path**.

That is bounded in practice: a document's top-level field count, plus whatever the user drilled into.
It is also **deliberate**, and coupled: `rows.ts`'s `rowHeight()` (`:267-279`) computes the outer
`VirtualList` row's exact height as `HEAD_H + lines * LINE_H + BODY_PADDING_V`, and
`DocumentTree.vue:18-22` records why lines must never wrap (a wrapped line breaks that prefix sum,
which is why long values are revealed by horizontal scroll instead). **Virtualizing the inner list
would break the outer list's height contract** — a nested scroller's content height is not the outer
row's height, and the outer prefix sum would stop being exact.

So: not a defect, a bounded design with a stated invariant. If a pathological document (thousands of
top-level fields) ever makes it a real cost, the proportionate fix is a **line cap plus a "show N
more" affordance** — which keeps `rowHeight()` exact — not a nested virtualizer, and certainly not a
grid.

### 8.2 Could SlickGrid do a one-dimensional list? Re-derived, not repeated

**Yes, mechanically. No, sensibly.** The nuance previously given was directionally right but under-
argued; here it is with the source read:

**What you would actually be constructing** for a one-column list: a header pane you then hide, a
`Column` model and a per-column cell-position index for one column, `setupColumnResize` and
`setupColumnSort` installed unconditionally after `createColumnHeaders` (`src/slick.grid.ts:1963`,
`:1738`), a left/right canvas pair, `getRenderedRange`'s column-axis half, a `rowsCache`, and
`clampColumnOverscan` clamping an overscan across one column. Every one of those runs; none of them
does anything useful for a list. Against `VirtualList`'s 197 lines, two computeds and one
`ResizeObserver`.

**What you would gain, honestly**: the imperative row build (no Vue vnode diff per visible row per
frame) and the velocity runway/chase. Both are real. Both are aimed at a cost that scales with
**cells per frame**, and a 1D list has one cell per row — the exact axis that makes the grid's
mechanism worth its complexity is the axis a list does not have. `BrowseView`'s row is an icon
component plus two spans; `OperationsPanel`'s is an 18 px line; `ProjectTree`'s is a tree row that
additionally needs `VirtualList`'s `#sticky` slot for its ancestor band (`ProjectTree.vue:209-242`,
`project/stickyBand.ts`) — a feature SlickGrid has no equivalent for.

**And the narrow reuse question — "could we take just the virtualization/scroll-chase logic?"** The
answer is sharper than "maybe":

- **The reusable *arithmetic* is already extracted and already engine-agnostic.**
  `rowRangeBounds(range, rowHeight, velocityPxPerFrame, direction, mountedColumnCount, cfg)` lives in
  `views/shared/page/columns.ts:297`, is pure, has no SlickGrid dependency at all, and its own doc
  comment records that it was split out from a `@tanstack/vue-virtual`-shaped wrapper precisely so a
  different engine could reuse it. **`VirtualList` could adopt it today** — replace `overscan: 8`
  (`:16`) with a velocity-sampled directional runway — as a self-contained change touching one file
  and no library.
- **The *mechanism* is not extractable.** The chase (`kiraSlickGrid.ts:213-268`) re-enters
  `SlickGrid.render()` on a gated animation frame, and its termination argument depends on
  `getRenderedRange` being recomputed by every render and on the grid's own `rowsCache` making a
  re-render of already-mounted rows nearly free (`:179-212`). In a Vue `v-for` list, "render again"
  is a full reactive re-render — the thing the chase assumes is cheap is the thing that is
  expensive. Lifting it would not be reuse; it would be a reimplementation with the opposite cost
  model.

**Therefore**: the entire `VirtualList` family — `BrowseView`, `ProjectTree`, `OperationsPanel`,
`DocumentView`, `KeyValueView`, `StreamView`, and both non-tabular console branches — **stays on
`VirtualList`**, and nothing from SlickGrid is borrowed for them. The one genuinely available
borrow, `rowRangeBounds` into `VirtualList`'s overscan, is **not proposed here**: nobody has reported
a fling artifact in any of these views, `AGENTS.md`'s measure-with-purpose rule says not to instrument
a question nobody is asking, and the cheap constant overscan is the right default until someone does.
It is recorded in §12 as available, with the file and function named, so a future report has a
one-file answer waiting.

---

## 9. Implementation order

Only §3 has implementation. In order, one commit each:

```
C1  ConsoleSlickGrid.vue, mounted behind a scaffold flag
C2  search: filter, two CSS layers, go-to-match
C3  decode-window + retention (onRendered -> setVisibleWindow/setVisibleRows)
C4  cssLayers.ts extraction  [optional — duplicate 25 lines instead if not mechanical]
C5  cutover: the scaffold flag goes, SlickGrid is the tabular branch
C6  delete the old tabular branch from ConsoleResultGrid.vue (~250 lines)
C7  retire @tanstack/vue-virtual: columns.ts prune, column-range.spec.ts, package.json, bun.lock
C8  tests (§3.8) and docs (§11)
```

Why this order: C1-C3 build the replacement while the incumbent still renders, so a regression at any
point is one `v-if` away from the working path. C5 is the smallest possible cutover commit — revert
it alone and the old branch is back, with its code still present. C6 is the deletion, separate and
revertible. C7 cannot precede C6 (the old branch imports the dependency). C4 sits before the cutover
so the console's search layer is not written twice.

---

## 10. Verification

### 10.1 Fast gates (per commit)
`bunx tsc --noEmit`, `bunx biome check`, `bun run build`. C7 additionally: `bun run build` must
succeed with `@tanstack/vue-virtual` absent from `node_modules` (`bun install` after the
`package.json` edit), which is the real proof the dependency is gone rather than merely unimported.

### 10.2 Suite gate (once, at C8, per `AGENTS.md`)
`bun run test:ui` and `bun run test:unit`. Expected deltas: `column-range.spec.ts` gone;
`console.spec.ts`/`cell-editor.spec.ts` adjusted per §3.8. **Known pre-existing failures that must
not be attributed to this phase**: any flake bisected as pre-existing in P22 Pass B's postscript
fix-up round should be re-confirmed pre-existing here too, not assumed.

Specific behavioural checks worth naming, because they are what §3 claims:
- The row-number gutter stays pinned while scrolling a wide console result horizontally (F4's fix).
- Switching result chips on one mounted panel shows the new result's columns and clears the previous
  selection (`ConsoleResultGrid.vue:266-269`'s existing contract, now via remount).
- A find's "hide non-matching rows" toggle plus go-to-match reaches a match outside the rendered
  window (the `displayRows` + `scrollRowIntoView` path).
- `leaks.spec.ts`'s console assertion: a second `KiraSlickGrid` instance must be destroyed on
  unmount. Note the inherited fix here — `KiraSlickGrid` overrides `bindAncestorScrollEvents`/
  `destroy` to work around the library's own capture-flag `removeEventListener` bug, and a second
  instance would have hit that same uncaught `_viewport.includes` exception without it.

### 10.3 Real-hardware obligation — narrow, and named
This phase does **not** re-run the P22 scroll A/B. Its one real-hardware question is much smaller:
**with a console result panel open beside a data tab, does either grid's scroll pacing change?**
Two `KiraSlickGrid` instances now exist in one page, each with its own `requestAnimationFrame` chase
loop. They are independent by construction (per-instance `chaseHandle`, per-instance velocity
sampler, per-instance viewport listener), and each is gated on *its own* viewport's scroll
quiescence — but only one main thread runs both. The check is the existing `__kiraScrollTrace`
protocol (`docs/PERF.md` §2.1a step 2-4) run on the data grid with a console result tab also open,
compared against the same trace with only the data tab open. If `renderMs` or the frame histogram
moves, the fallback is to destroy the console's grid when its tab is not visible (the console panel
already unmounts per result chip, so the hook exists).

---

## 11. Docs

1. **`docs/ARCHITECTURE.md:40` is already stale and this phase must not compound it.** Its "Data grid
   rendering (P22 spike, Pass A only)" row still says the SlickGrid host is *"reachable behind
   `window.__kiraGridEngine === 'slick'`"* and that *"the production grid stays
   `views/grid/DataGrid.vue`/`@tanstack/vue-virtual`"* — both untrue since Pass B's cutover
   (`52b8a80`). Rewrite the row to the post-cutover reality **and** to the post-§3 one: SlickGrid is
   the only grid engine, `SlickGridHost.vue` hosts the data tab, `ConsoleSlickGrid.vue` hosts the
   console's tabular results over the same `KiraSlickGrid`/`dataSource.ts`/`slickTheme.css` layer,
   and `@tanstack/vue-virtual` is no longer a dependency.
2. **`docs/ARCHITECTURE.md`'s dependency listing** — remove `@tanstack/vue-virtual` wherever it is
   named as a current dependency.
3. **`docs/v1.1/plans/P22-slickgrid-pass-b.md` §6** — do **not** rewrite it. It was a correct
   decision for that pass, and `AGENTS.md`'s discipline is that each plan records what its own pass
   knew. Add one line at the end of §6 pointing at this document as the reopening, and let §3.2 here
   carry the correction to its reason 4.
4. **`docs/PERF.md`** — no change unless §10.3's two-instance trace finds something. If it does, it
   gets its own sub-section under §2.1c, not an edit to the existing A/B record.
5. **`AGENTS.md`** — no change. Nothing here is a standing rule.

---

## 12. Open questions, handed forward

1. **Should console results honour P9's row-colouring setting?** §3.7 item 1. Recommended yes
   (it is the most visible answer to the user's own question); needs one word from the user, and the
   plan works either way.
2. **Non-persisted console column widths.** §3.7 item 3. The ~10-line fix is named; deliberately not
   taken.
3. **`rowRangeBounds` into `VirtualList`'s overscan.** §8.2. Available, one file, no library; not
   proposed because no view has reported the artifact it would address. Recorded so a future report
   has an answer rather than an investigation.
4. **`DocumentTree`'s line cap.** §8.1. Not needed today (its line count is bounded by top-level
   field count plus explicit expansions); the proportionate fix if it ever is needed is a cap plus
   "show N more", **not** a nested virtualizer, because that would break `rows.ts`'s exact-height
   contract.
5. **Whether `ConsoleSlickGrid.vue` should move to `views/shared/slick/`.** Only when it gains a
   second consumer, which today would be `StreamView` under §4's named conditions.

---

## 13. Sources

All read this session at `dd1b51c`.

**App**: `views/console/ConsoleResultGrid.vue` (703), `views/console/ConsoleView.vue:314-338,653-658`,
`views/console/resultPages.ts`, `views/console/state.ts:182-186`, `views/console/search.ts`,
`views/grid/SlickGridHost.vue` (2 283; §§ cited: `:104-130`, `:487-541`, `:532-623`, `:898-975`,
`:1687-1900`, `:2249-2281`), `views/grid/slick/kiraSlickGrid.ts` (479),
`views/grid/slick/dataSource.ts` (265), `views/grid/slick/slickTheme.css`,
`views/shared/page/columns.ts` (389), `views/shared/page/sizes.ts`,
`theme/primitives/VirtualList.vue` (197), `theme/primitives.css:658-714`,
`views/stream/StreamView.vue` (1 123), `views/keyvalue/KeyValueView.vue` (1 036),
`views/documents/DocumentView.vue` (998), `views/browse/BrowseView.vue` (346),
`views/shared/document/DocumentTree.vue` (155), `views/shared/document/rows.ts:150-208,245-280`,
`workbench/panels/MainView.vue:16-22`, `project/ProjectTree.vue:209-242`,
`workbench/panels/OperationsPanel.vue:194-255`, `package.json:37-76`, `bun.lock:599`.

**Backend** (read only, to settle F3): `internal/adapters/postgres/console.go:31-79`,
`internal/adapters/clickhouse/console.go`.

**Library** (`node_modules/.bun/slickgrid@5.20.0/node_modules/slickgrid/src/`):
`slick.grid.ts:251,1738-1832,1928-1934,1963,4592-4646,5716-5723,5820-5866,6366,6388`,
`slick.core.ts:1337-1420` (`RowPositionIndexer`), `models/gridOption.interface.ts:182-196,344`,
`models/itemMetadata.interface.ts:23-26`, `models/column.interface.ts:48,54`.

**Tests**: `tests/ui/support/grid.ts` (99), `tests/ui/console.spec.ts:257,377-434,469-511`,
`tests/ui/cell-editor.spec.ts:1183-1184`, `tests/ui/console-explain.spec.ts:232,411-416,508,558`,
`tests/ui/leaks.spec.ts:349`, `tests/unit/column-range.spec.ts`, `tests/unit/kira-slick-grid.spec.ts`,
`tests/unit/console-result-cap.spec.ts`.

**Prior plans**: `docs/v1.1/plans/P22-slickgrid-pass-b.md` (§0, §1, §2 F1-F14, §3, §4, §5 D0/D5/D9,
§6, §7, §14), `docs/PERF.md` §2.1a, §2.1c, `docs/ARCHITECTURE.md:40`, `AGENTS.md`.
