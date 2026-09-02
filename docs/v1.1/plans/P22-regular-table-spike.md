# P22 — the regular-table spike: a pooled-cell renderer for the SQL data view

**Status: built, behind a dark switch. The sandbox half of the verdict is in; the half that
decides anything needs a Mac and twenty minutes (§7).**

Branch: `claude/experiment-regular-table`, cut from `eb7c669` — the commit immediately before any
SlickGrid code landed. Nothing here depends on the SlickGrid branch and nothing here is a cutover:
`DataGrid.vue` is untouched, the default engine is unchanged, and the new renderer loads only when
a session explicitly asks for it.

---

## 0. Why this exists

The chain, briefly, because this document is the third turn of it:

1. Real hardware reports that a hard two-finger fling in the SQL grid leaves **visible gaps** at the
   leading edge, filled in a moment later. Two hand-rolled fixes shipped and neither moved it
   (`P22-webview-scroll-performance-iter2-rendering.md` §0).
2. `P22-grid-library-survey.md` classified every candidate by *what a retained row costs per scroll
   update*, and `P22-slickgrid-migration-plan.md` adopted SlickGrid — category (A), "a retained row
   is not visited at all".
3. SlickGrid's spike shipped and real hardware found it **stutters**, plausibly because
   `removeRowFromCache` does `node.parentElement?.removeChild(node)` with no pooling: every row
   entering the render window costs a fresh DOM subtree, built and thrown away again on the way out.
4. The survey's category **(D)** — *"a fixed slot pool: nodes are never created or destroyed, but
   every visible cell is visited and re-pointed at new data"* — had exactly one member,
   `regular-table`, and it was passed over for having no features rather than for how it renders.

That last reason turned out to be overstated for this app specifically. This repo's context menus
(`views/grid/menu.ts`), clipboard formats (`views/grid/clipboardFormats.ts`) and cell-range
selection (`runtime[tabId].selection` + `views/grid/DataGrid.vue`'s DOM delegation) are already
decoupled from the renderer: they operate on `MenuItem[]`, on TSV/CSV strings and on
`{ anchorRow, anchorCol, row, col }`, not on tanstack-virtual internals. So "regular-table has no
features" costs this app one adapter function, not a feature reimplementation — which §4 bears out.

**This is a spike, matching the scope discipline of SlickGrid's own Pass A** (`P22-slickgrid-
migration-plan.md` §7.1): real data through the real bridge, real theme, real menus, real
selection; no editing, no cutover, no spec rewrite.

---

## 1. What regular-table actually does — read from source, not from the survey

`regular-table@0.9.0` (latest on npm as of this branch; the survey's version number still current).
The package ships its TypeScript sources under `src/ts/`, so every claim below is cited against real
code in `node_modules/regular-table/`, not against a doc comment.

### F1 — The `<td>` pool is genuine, and the memoisation goes one level deeper than the survey said

`src/ts/view_model.ts` holds

```ts
public cells: (HTMLTableCellElement | undefined)[][];
public rows: HTMLTableRowElement[];
```

indexed by **viewport position**, not by data row. `_get_row(ridx)` (`:138`) returns
`this.rows[ridx]` and only calls `document.createElement("tr")` when that slot is empty;
`_get_cell(tag, ridx, cidx)` (`:156`) does the same for the `<td>`. Nodes are removed only by
`_clean_rows` / `_clean_columns` (`:184`, `:201`), which run when the viewport *shrinks* — never on
a steady-state scroll.

What the survey did not say, and which matters more: `src/ts/tbody.ts`'s `_draw_td` (`:58`) is

```ts
if (metadata.value !== val) {
    ...
    td.textContent = String(val ?? "");
}
```

so an unchanged cell costs a `WeakMap` lookup and a comparison — **not even a text write**. The
same discipline is documented for classes on `_tagColumn` (`view_model.ts:62-71`): *"Only rewrites
the class when the cell actually changes columns (horizontal scroll), so vertical scroll adds no
churn."*

This is the whole hypothesis, and §6 measures it directly rather than trusting the reading.

### F2 — The data API is `setDataListener`, and it is columnar

The survey's characterisation is right in shape and one detail off in substance. The real signature
(`dist/esm/types.d.ts:16`) is

```ts
type DataListener = (x0, y0, x1, y1) => Promise<DataResponse>;
```

and `DataResponse.data` is documented (`:206-209`) as *"arranged in columnar fashion such that
`data[x][y]` returns the `y`th row of the `x`th column of the slice."* So the listener is handed
the visible window and must return a **rectangular columnar slab** for it. There is no row array
and no materialisation of the page — but there *is* one array per visible column per draw, which is
imposed by the API rather than chosen (§2 says what that costs).

`DataResponse` also carries `row_headers` (the gutter), `column_headers`, `num_row_headers`,
`num_column_headers` and — usefully — `row_height`, which lets the app state the row height instead
of letting the library measure it with a hidden probe element (`_probe_row_height`,
`src/ts/scroll_panel.ts`).

### F3 — The scroll path is predraw → rAF → *synchronous* commit, and a sub-row scroll renders nothing

`src/ts/events.ts:60-96`:

```ts
this.addEventListener("scroll", this._on_scroll.bind(this), { passive: true });
...
const commit = await this.predraw(width, height, { invalid_viewport: false, cache: true, ... });
if (!commit.inline) { await new Promise(requestAnimationFrame); commit(); }
```

`predraw` does the asynchronous half (viewport arithmetic + the `DataListener` call) and returns a
closure that applies the whole render to the DOM synchronously. Two consequences the spike depends
on:

- **That closure is the exact analogue of the incumbent's `renderMs`** — the main-thread work a
  momentum scroll has to fit inside one frame. It is the only comparable number available, and
  `views/grid/regular/element.ts` wraps it to take it.
- **A scroll that does not cross a row boundary does not render at all.** `predraw` computes
  `should_render` from `_validate_viewport`, which floors/ceils the row range
  (`scroll_panel.ts`), and when it is false the commit only rewrites four CSS custom properties
  (`_update_sub_cell_offset`) that translate the whole `<tbody>` by the sub-row remainder. Smooth
  sub-row scrolling with zero DOM work is a property this app's incumbent does not have.

### F4 — There is no runway at all. **This is the biggest risk in the whole experiment.**

`_calculate_row_range` (`scroll_panel.ts`) computes `clip_panel_row_height = height / row_height −
header_levels` and renders exactly that many rows. Measured in the smoke test: **28 rows in a 960px
window at 28px rows — the viewport and nothing else.**

For context: SlickGrid's default runway is one viewport in the scroll direction plus
`minRowBuffer: 3`, and the SlickGrid plan's F4 called *that* decisive enough to need an override.
This app's own `rowRangeExtractor` runs a velocity-adaptive 560–2400px budget in the direction of
travel. regular-table's is zero.

So the spike ships a runway knob (§3, `__kiraGridTuning.regularRunwayPx`) rather than leaving the
A/B unable to separate "this renderer is too slow" from "this renderer has no runway" — the same
mistake `P22-…-iter2-rendering.md` §7.3 step 6 exists to prevent.

### F5 — A macOS-specific wheel path that is gated off, and would be a bug if it were on

`events.ts:122-157`'s `_on_mousewheel` **hijacks the wheel and drives `scrollTop` from JS**:

```ts
private _on_mousewheel(event2: Event) {
    if (!window.hasOwnProperty("safari")) return;   // **** Apple
    ...
    event.preventDefault();
    this.scrollTop = Math.max(0, Math.min(total_scroll_height, scrollTop + event.deltaY));
```

Two things follow. First, if `window.safari` is defined this **disables native momentum** — the
exact class of change the SlickGrid pass had to undo to get trackpad feel back. Second, the
listener is registered `{ passive: true }` (`:106`), under which `preventDefault()` is a no-op — so
on a browser where the gate opens, the native scroll *and* the manual `scrollTop += deltaY` would
both apply and the grid would scroll at roughly double speed.

`window.safari` is a Safari-application API and is not expected in a WKWebView, so the gate should
stay shut in the packaged app — but this has not been verified on real hardware, and it is cheap to
check. **§7 step 0 makes it the first thing the human confirms.**

### F6 — Size

`dist/esm/regular-table.js` is 28 854 B raw, **9 967 B gzipped**. For comparison, the SlickGrid
plan's F9 measured `{ SlickGrid }` at 41 947 B gzip. In this build the whole spike — library, host
and stylesheet — lands in its own async chunk (§6, item 6) and the launch chunk is untouched.

---

## 2. The data bridge

`views/grid/regular/snapshot.ts` and `views/grid/regular/dataSource.ts`, on the pattern
`P22-slickgrid-migration-plan.md` §6 D1 established.

**The snapshot.** Everything reactive is resolved, once per change, into one frozen plain object:
the page, the display column order, the page-column index per display column, the alignment and
type colour per column, the filtered row list, the row-number base, the row height. The
`DataListener` and the style pass read only that. This is `docs/ARCHITECTURE.md`'s "no Vue
reactivity on row data" invariant held by construction rather than by care — both run *inside*
regular-table's render, where touching a Vue proxy could re-enter it.

**The cell read.** `textAt(snapshot, row, displayCol)` layers `stagedValue` over
`page.ts`'s `cell(tabId, row, pageCol)` — the app's existing decode-and-view cache, unchanged, and
the one P5 C1's retained-bytes gate measures. Nothing decodes twice and nothing is materialised.

Three properties this buys, each of which is a requirement rather than a nicety:

1. **Decode-on-entry is preserved exactly.** `cell()` memoises the decoded string per `(row, col)`,
   so a repeat read returns the **identical string reference**. That is what makes F1's
   `metadata.value !== val` check fire correctly: a cell whose value did not change costs no
   `textContent` write. The bridge and the library's own memoisation compose.
2. **Filtering is free.** `rowAtDisplayPosition` is the only place display-position ↔ page-row
   translation lives, exactly as `getLength`/`getItem` were for the SlickGrid seam.
3. **The window report is the app's own.** The style pass calls `setVisibleWindow` (decode-cache
   pruning, P5 C1) and `setVisibleRows` (search priority, P42 D39) with the band actually committed
   to the DOM — not the band last *asked* for, which can differ.

**What the API costs, stated honestly.** `DataResponse.data` is columnar, so each draw allocates one
array per visible column (~15 arrays of ~30 memoised string references for a full window), plus one
two-element array per visible row for the gutter. That is O(window), not O(page), and every element
in it is a string the decode cache already owns — but it is not zero, and it is more per-draw
allocation than SlickGrid's `getItem` handle. The arrays are deliberately **not** pooled:
regular-table's `_fetchMissingColumns` can call the listener a second time within one draw and
concatenate both responses, so a buffer pooled by relative column index would alias across the two
halves of a single render. Trading ~15 allocations for that hazard is a bad deal in a spike whose
whole job is to measure something else.

---

## 3. The host

`views/grid/RegularTableHost.vue`, on the shape `editor/CodeMirrorHost.vue` established: Vue owns
the mount point, the props and the teardown; the library owns everything inside; nothing the library
can reach is a `ref`/`reactive`.

**The custom element.** `views/grid/regular/element.ts` registers `<kira-regular-table>`, a subclass
of the library's own element, for exactly two things:

- **Timing.** `predraw` is overridden to wrap the returned commit closure, reporting its synchronous
  duration to `scrollTrace.noteRender` (F3). `commit.inline` renders are passed through untimed
  rather than reported as a suspiciously fast frame.
- **The runway (F4).** `window.__kiraGridTuning.regularRunwayPx`, read fresh on every render, adds
  a *trailing* runway by inflating **both** the clip height and the container height by the same
  amount. Working from `_calculate_row_range` with one header level, adding `R` to both leaves
  `scrollable_rows = total_scroll_height / h`, so `start_row` stays `scrollTop / h` and
  `clamped_scroll_top`'s ceiling drops by the same `R` — which is what keeps the final row
  reachable. The extra rows render past the bottom of the `contain: strict` clip and are simply not
  painted. It is trailing-only; nothing in this seam can extend the window upwards.

**The style pass.** `addStyleListener` runs inside the commit and applies everything the library does
not know about: `data-testid` / `data-row` / `data-col-index` / `data-column` / `data-null`, the
selection perimeter classes (P42 D21's four-layer shadow, verbatim), null / pending-edit / FK /
search-match / align-right, the per-column type colour, and the gutter's dirty/deleted rails.

It carries **the same skip-when-unchanged discipline the library uses for cell text, one level up**:
a `WeakMap` per pooled cell holds the last-applied `{row, col, flagsBitmask, color}`, and an
unchanged cell takes zero attribute writes and zero `classList` calls; a changed one toggles only
the bits that actually flipped. Without this the annotation pass would dominate the exact frame
budget the spike exists to measure, and the A/B would be measuring the adapter instead of the
library. `docs/v1.1/plans/P22-slickgrid-migration-plan.md` D10's warning — *"do not skip the
measurement"* — applies here and this is the answer to it.

**The trace's mounted band.** regular-table pins its `<table>` inside a `position: sticky` clip
(`container.css`'s `div.rt-scroll-table-clip`), so a rendered row's `offsetTop` is a *viewport*
offset, and `scrollTrace`'s own `measureMountedBand` would read a fabricated `uncoveredPx` of zero.
The host supplies the band instead, derived from the display positions actually committed:
`[h·(1 + first), h·(2 + last)]`, including the same one-row header offset the incumbent gets from
its virtualizer's `paddingStart`. **The metric stays the same and the symptom it predicts does
not**: with a pinned clip a main thread behind the compositor shows *stale rows*, not empty
background. §7 says so explicitly, because misreading that is the easiest way to draw the wrong
conclusion from an A/B.

---

## 4. Wired vs. deferred

**Wired, and reusing the existing code rather than reimplementing it:**

| | how |
|---|---|
| Cell / range / row / column selection, drag-select | the app's own `runtime[tabId].selection` shapes; `extendSelectionTo` / `extendRowSelectionTo` mirrored against the new markup, including P42 D15's fixed anchor and trailing-click guard |
| All three context menus | `menu.ts`'s `cellMenu` / `rowMenu` / `headerMenu`, called with the same contexts DataGrid.vue builds |
| Copy (Cmd/Ctrl+C, all four selection kinds) | `clipboardFormats.ts`'s `rangeToTsv` / `rowsToTsv` / `columnsToTsv`, unchanged |
| The cell editor dock | `publishSelectedCell` — the same seam, read-only (no `onEdit`/`onRevert`) |
| Search highlight + "go to match" | `createMatchIndex`, and `scrollToCell` for the jump |
| Filtered rows ("hide non-matching") | `matchedRows` through the snapshot's display-position mapping |
| Delete row(s) staging, dirty/deleted gutter rails | `pendingChanges.ts`, unchanged |
| Column widths, order, type colours, density, alignment | the app's own `initialWidths` / `resolveColumnOrder` / `typeClassColor`, pushed in via `restoreColumnSizes` so an A/B cannot be won by rendering narrower columns |
| Column resize | free — the library's own `.rt-column-resize` grip, one CSS rule |
| Scroll-position restore, decode-cache + search-priority window reports | unchanged |

**The adapter this actually cost** is one function. `targetOf(event)` resolves a DOM event to
`{ row, col }` via `table.getMeta(td)` — regular-table's own per-cell `WeakMap` record, whose `type`
discriminates body / row_header / column_header and whose `x`/`y` are the display column and
position. That is a *stronger* seam than DataGrid.vue's `closest('.grid-cell[data-row]')` +
`dataset` read, because it is the library's own record rather than this host's annotation of it.

**Deliberately not built** (left out entirely, not half-built — `AGENTS.md`'s rule):

- The inline (double-click) cell editor. The cell menu therefore reports `canEdit: false`, so Edit /
  Set NULL / Paste present as **disabled** rather than as broken affordances. Editing is still
  reachable in this build through the cell-editor dock, read-only.
- Clipboard **paste**, and pending-**insert** rows (the two are entangled — a paste past the last
  row creates inserts).
- Keyboard navigation beyond copy: arrow keys, Enter-to-edit, the delete shortcut.
- FK / referenced-by hover nav buttons, the truncated-value marker, header tooltips, the two empty
  states, the header sort indicator.
- `ConsoleResultGrid.vue`. Same deferral SlickGrid's plan made, for the same reason.

Nothing on that list changes what §7 measures.

---

## 5. How to reach it

`window.__kiraGridEngine` selects which renderer `DataView.vue` mounts, read **once per tab mount**
(not reactively — switching engines should remount the tab):

```js
window.__kiraGridEngine = 'regular'   // then open, or close and reopen, a table tab
window.__kiraGridEngine = 'tanstack'  // or just delete it — anything but 'regular' is the incumbent
```

Set it from the Web Inspector console in a dev build (**View → Open DevTools**,
`internal/shell/menutemplate.go` — the item is `isDev`-gated). The switch is read when a data tab's
`DataView.vue` is created, so **set it first, then open the tab**; an already-open tab keeps
whichever engine it mounted with. Closing and reopening the tab is enough to switch — no reload, no
rebuild.

Everything else about the app is unchanged, and the incumbent grid is the default, so the same build
runs both engines and an A/B needs no second build.

Sanity check that it took: the grid's root element is `<kira-regular-table>` and
`document.querySelector('[data-testid="regular-table-host"]')` is non-null; the incumbent's
`[data-testid="data-grid"]` is absent.

---

## 6. What is already settled, here, without a Mac

`tests/ui/regular-table.spec.ts`, run under Playwright WebKit (the closest engine this sandbox has
to the real WKWebView):

1. **Real decoded data.** A 10 000-row page renders correct text in every visible cell, addressed by
   page row index and display column, through the real `cell()` pipeline. Gutter numbers are the
   result-set positions, one-based.
2. **The pool is real, and total.** Every rendered `<td>`/`<th>` is stamped with a JS expando, the
   grid is scrolled **1 428 rows** so that not one row survives in the window, and the marks are
   counted again:

   > **84 cells before, 84 after, 84 survivors, 0 created.**

   Not a single DOM node is constructed for a row entering the render window. This is the direct
   negative of what makes SlickGrid stutter — `removeRowFromCache`'s
   `node.parentElement?.removeChild(node)` per departing row and a fresh subtree per entering one.
3. **The window is the viewport, and only the viewport.** 84 cells = 28 rows × 3 cells in a 960px
   window at 28px rows. F4, measured.
4. **The runway knob works and is mapping-neutral.** `regularRunwayPx: 600` widens the rendered
   window; returning to the same `scrollTop` lands on the same first row to within one row. (The
   residual is sub-row: regular-table's two height inputs differ by a scrollbar gutter, so §3's
   cancellation is exact only where they agree, and the leftover shows up as a ±1 shift across a
   `floor()`.)
5. **Selection and menus run on the shared code.** Click selects, shift-click extends, P42 D21's
   perimeter classes land only on the selection's outer boundary, and all three context menus open
   with their real items.
6. **The trace is wired.** `__kiraScrollTrace` records a real band, a real `rows` count and a real
   `renderMs` for this engine.
7. **The launch chunk is unchanged.** The host is a dynamic import, so the whole spike lands in its
   own async chunk — `RegularTableHost-*.js` 42 249 B / **14.6 kB gzip**, plus a 4.0 kB / 0.94 kB
   gzip stylesheet — and `grep` finds zero regular-table bytes in `index-*.js`. The spike costs the
   default engine nothing.
8. **Every existing `tests/ui/` spec passes unmodified** against the default engine (74 passed; the
   one `budgets.spec.ts` scroll-p50 miss is the cross-file worker contention that spec's own comment
   at `:549` predicts — it passes on its own, and the run above is the full 75-spec suite).

**What none of this settles**, and the reason §7 exists: every scroll above is a main-thread
`scrollTop` write, so the compositor and the main thread are in lockstep by construction and the
condition that produces the user's actual symptom cannot occur. `views/grid/scrollTrace.ts`'s own
header comment has said so since P22 iter2 D2.

---

## 7. The real-Mac protocol — the A/B this whole branch exists to enable

Mirrors `P22-webview-scroll-performance-iter2-rendering.md` §7.3 and `docs/PERF.md` §2.1a exactly,
so the numbers are comparable with every earlier run — **and with the SlickGrid spike's own**, which
used the same trace, the same gesture and the same table.

### Setup

1. `bun run dev` (`wails3 task dev`) — a real WKWebView in a real window, with **View → Open
   DevTools** available.
2. Open a table with **at least 50 000 rows**, page size **10 000**, comfortable density (28px
   rows). Note the window size and the visible column count: every number below is conditional on
   both. Use the same table, the same window size and the same page size for every run.
3. Web Inspector → Console.

### Step 0 — check F5 first, because it invalidates everything else if it fires

```js
Object.hasOwn(window, 'safari')
```

If this is `true`, regular-table's `_on_mousewheel` is live: it drives `scrollTop` from JS *and*
(being a passive listener) fails to suppress the native scroll, so the grid will scroll at roughly
double speed and with no native momentum. **Report that and stop** — the A/B would be measuring a
broken input path, and the fix is a one-line override in `KiraRegularTable`, not a verdict about
pooling. Expected result is `false`.

### The gesture

Not a drag. A **hard two-finger flick and release**, then hands off the trackpad while momentum runs
out. A sustained drag keeps the main thread and the scrolling thread in lockstep and will not
reproduce the symptom.

### Step 1 — baseline: today's grid

```js
delete window.__kiraGridEngine    // or leave it unset
```
Close and reopen the table tab, then:
```js
__kiraScrollTrace.start()
// … one hard flick, let momentum die …
copy(JSON.stringify(__kiraScrollTrace.stop()))
```

### Step 2 — the same thing on regular-table

```js
window.__kiraGridEngine = 'regular'
```
**Close and reopen the table tab** (the switch is read at mount), confirm
`document.querySelector('kira-regular-table')` is non-null, then repeat the same flick and trace.

### Step 3 — regular-table with a runway (F4's own test)

Still on the `'regular'` engine, no reopen needed — the knob is read on every render:

```js
window.__kiraGridTuning.regularRunwayPx = 1200   // flick, stop(), record
window.__kiraGridTuning.regularRunwayPx = 3000   // flick again
window.__kiraGridTuning.regularRunwayPx = 0      // back to the library's own behaviour
```

### What to report, per run

- `summary.renderMs` (p50 / p95 / max) — for the incumbent this is a Vue flush; for regular-table it
  is the synchronous commit closure (F3). Same units, same meaning: main-thread work per rendered
  frame.
- `summary.uncoveredPx` (p50 / p95 / max) — how much of the live viewport is not covered by
  correctly-positioned rows.
- `summary.pxPerFrame` (p50 / p95 / max) — the flick's own velocity; a comparison is meaningless
  unless this is roughly matched across runs.
- The `scrollEvents` histogram.
- **One sentence on whether the lag was perceptibly different**, and — specifically for
  regular-table — *what kind* of artefact you see.

### Reading it: the symptom changes shape, and that is the trap

The incumbent and SlickGrid both scroll a tall sizer, so a main thread behind the compositor shows
**empty background** at the leading edge. regular-table pins its table inside a sticky clip and
translates content by the sub-row remainder, so **a gap is structurally impossible** — the same lag
shows up as **stale rows** (visibly wrong values / gutter numbers, or a brief judder as they snap)
rather than as blank space.

So: *"no gaps"* on its own is not a result. The question is whether the leading edge shows
**correct** rows during the fling. `uncoveredPx` is the metric that answers that for both engines,
which is why §3 goes to the trouble of computing a real one for this host instead of letting
`measureMountedBand` return a comfortable zero.

### The verdict

- **regular-table wins** if the lag is perceptibly reduced at a comparable `pxPerFrame` p95, or if
  `uncoveredPx` p95 drops materially. Then the hypothesis holds: per-entering-row DOM construction
  was the cost, and a pool removes it.
- **The runway is the constraint** if step 2 is no better than step 1 but step 3 is — F4 predicted
  this, and the answer is a runway (on *either* engine), not a renderer.
- **Neither** if `renderMs` p95 was already a small fraction of the frame period on the incumbent in
  step 1. Then JS was never the bottleneck, no DOM renderer can help, and the remaining candidates
  are `P22-…-iter2-rendering.md` §9's list: main-thread starvation during momentum, the per-row
  sticky gutter, and the ~280 000px sizer's tile invalidation. In that case step 7 of that document
  (a Web Inspector Timelines capture, Script / Style / Layout / Paint / Composite per frame) is the
  next thing to run, and this branch's value is that it removed one hypothesis cheaply.

**This branch is an experiment, not a proposal.** Whatever the result, nothing here is merged as-is:
a PASS makes the case for a real migration plan with its own parity pass; anything else and the
branch is a recorded negative result.

---

## 8. Open questions handed forward

1. **The upward fling has no runway and cannot be given one through this seam** (§3). If step 3
   shows a trailing runway helps, a symmetric one needs either an upstream change or a different
   override point than `predraw`.
2. **`_fetchMissingColumns` can call the listener twice per draw.** Harmless as built (§2), but it
   is the reason a pooled slab buffer is unsafe, and anyone optimising the bridge later will
   rediscover it the hard way.
3. **NULL renders as literal text**, not as the incumbent's `<span class="cell-null">`, because the
   element branch of `_draw_td` would append a fresh node per NULL cell per draw. A cell whose real
   value is the string `NULL` is therefore indistinguishable to the eye (`data-null` still tells
   them apart). Fine for a spike; a real migration needs a CSS-only treatment.
4. **The two height inputs differ by a scrollbar gutter** (§6 item 4). It costs a ±1 row shift when
   the runway is toggled. Harmless for an A/B; worth pinning down before anything depends on the
   mapping being exact.
5. **No `data-pagination` attribute, no empty states, no header sort indicator** — several existing
   `tests/ui/` selectors would need either these or a rewrite before this engine could ever be the
   default. Costed, not paid.

---

## 9. Sources

Every claim in §1 is from `node_modules/regular-table@0.9.0`'s own shipped TypeScript:
`src/ts/view_model.ts` (the pool), `src/ts/tbody.ts` (the per-cell memoisation),
`src/ts/scroll_panel.ts` (the viewport arithmetic, `predraw`, the sticky clip),
`src/ts/events.ts` (the scroll and wheel paths), `dist/esm/types.d.ts` and
`dist/esm/regular-table.d.ts` (the public API), `dist/css/container.css` and
`dist/css/sub-cell-scrolling.css` (the layout this host has to reproduce under its own tag name).
