# P22 iter2 — frame pacing: the catch-up render is sharing a frame with the scroll render

> **The user's goal, verbatim:** *"the goal is to feel smooth, ideally 60fps, but it can be lower with
> proper pacing."* This document optimises **frame-to-frame consistency**, not average frame rate. A
> steady ~30 fps that never lurches is the target; a higher average that swings between 17 ms and
> 58 ms frames is not.
>
> **The state this pass starts from.** `fce3e54` (`contain: layout` restored to `.slick-row`) is
> landed and was measured on real macOS hardware with a second Safari Web Inspector Timeline
> recording. It genuinely helped: frame duration p50 41.2 → 32.1 ms, p95 99.7 → 50.5 ms, composite
> cost per frame 10.19 → 4.34 ms, cell-sized paints 89% → ~5.5% of all paints. But pacing is still
> uneven — durations swing between ~17 ms and ~58 ms *within the same fling* — and the share of
> frame wall-clock unattributable to anything a WebContent-process-only trace can see rose from 73%
> to **88%**. Most of what is left is GPU-process rasterization/tiling/compositing, which this
> investigation can neither see nor fix.
>
> **The one actionable, in-our-control finding in that recording:** frames in which the
> self-scheduled catch-up ("chase") render fires — the D2 mechanism `kiraSlickGrid.ts` added in
> `728cca7` — average **49.8 ms against 33.3 ms** for frames without one (17 of 101 frames). A ~50%
> cost tied to a mechanism this app owns outright.
>
> **The root cause, and it is not "the chase is too big".** The chase never spreads work across
> frames while a fling is in flight. **It lands in the same animation frame as the scroll-driven
> render**, because the rAF it self-schedules from inside `getRenderedRange` fires in a rendering
> update that also carries a native `scroll` event. Reproduced in this sandbox with the exact
> current policy: real WebKit ran **two renders in 131 of 140 frames** of a wheel-driven scroll
> (Chromium: 59 of 140). The per-call budget (`MAX_NEW_CELLS_PER_RENDER = 600`) is therefore not a
> per-frame budget — such a frame builds up to **1200** new cells and pays every fixed per-render
> cost twice (`cleanupRows` over the whole `rowsCache`, a second `getVisibleRange` +
> `getRenderedRange`, a second DOM append batch, a second `onRendered` → `setVisibleWindow` full
> cache-prune scan + `setVisibleRows`, a second `scrollTrace` write).
>
> **This also explains the null result the user already reported.** `maxNewCellsPerRenderOverride =
> 100` did not help because the constant caps the *floor* as well as the runway: at 100 cells over
> ~12 mounted columns, `budgetRows` is 8 rows ≈ 224 px of scroll at 28 px rows — below the per-frame
> delta of any real fling — so `getRenderedRange` takes its step-6 short-circuit on essentially
> every frame, returns `must` only, is short of target, and schedules a chase. The doubling goes
> from occasional to **universal**, and the runway stops converging at all. The missing invariant is
> "one render pass per animation frame", not a smaller number inside the one it already has.
>
> **The fix**, entirely inside `views/grid/slick/` plus `views/grid/scrollTrace.ts`: a catch-up
> render is **gated on scroll quiescence** — it never runs in a frame that a scroll event is also
> driving. Ordering-agnostic by construction (§3 F2 shows the intra-frame ordering is engine- and
> input-path-dependent and must not be relied on), live-toggleable so the real-Mac A/B needs one
> build, and paired with a `scrollTrace` fix that makes per-frame render count and per-frame
> duration variance visible at all — today `renderMs` is a sticky last-render-only value and there
> is no frame-duration metric in the summary whatsoever.
>
> **What this document does not claim.** That any of it fixes the perceived stutter. This
> investigation's own history has produced sandbox-plausible fixes that real hardware then corrected
> — `forceSyncScrolling` is the clearest (`0865ef6` → `18a2cc4`). §7 is the experiment; §7.2 lists,
> up front, the three real-Mac readings that would each **refute** this plan.

---

## 0. What this pass is, and what it is not

### 0.1 Baseline

- Branch `claude/feature-v1-1-p5-onwards-2isfzt` at `fce3e54`, source re-read in this session (not
  trusted from the prior pass's prose — AGENTS.md's own rule for a pass-N plan).
- Predecessors: `P22-slickgrid-migration-plan.md` (Pass A), then
  `P22-slickgrid-migration-plan-iter2-scroll-gaps.md` (the per-call batch cap + chase, D1-D5, plus
  its §10 postscript on the dropped `contain: layout`). This is the **third** planning pass on the
  SlickGrid spike; the filename keeps the `iter2-<topic>` sibling convention its two immediate
  predecessors used (`-iter2-rendering`/`-iter2-memory`, then `-iter2-scroll-gaps`) rather than
  starting an `iter3-` series mid-thread.
- Files read in full this session:
  `frontend/src/views/grid/slick/kiraSlickGrid.ts` (304),
  `frontend/src/views/grid/slick/dataSource.ts` (191),
  `frontend/src/views/grid/slick/slickTheme.css` (122),
  `frontend/src/views/grid/SlickGridHost.vue` (452),
  `frontend/src/views/grid/scrollTrace.ts` (248),
  `frontend/src/views/grid/page.ts`,
  `frontend/src/views/shared/page/store.ts` (199),
  `frontend/src/views/shared/page/columns.ts` (393),
  `frontend/src/views/grid/GridRow.vue`'s `<style>` block (the port's source of truth),
  `slickgrid@5.20.0`'s `dist/esm/index.js` (12 265 lines) and `dist/styles/css/slick.grid.css`,
  `tests/ui/slick-grid.spec.ts`, `tests/unit/kira-slick-grid.spec.ts`, `docs/PERF.md` §2.1c.
- Every claim about SlickGrid below cites a line in `dist/esm/index.js`, not a wiki page — the rule
  `P22-slickgrid-migration-plan.md` §0.4 set and each successor has carried.

### 0.2 Scope

1. Root-cause the chase-frame cost and design a fix aimed at **variance**, not at total bounded work
   (which the existing D2 already handles). §1-§3, §5 D1/D2.
2. Fix `__kiraScrollTrace` so the fix can be judged at all — per-frame render *count*, per-frame
   render-ms *sum*, and frame-duration dispersion do not exist in it today. §5 D3.
3. Fix the teardown hazard the chase introduced (a pending rAF outliving `grid.destroy(true)`).
   §5 D4.
4. Read SlickGrid's cell/row construction and both stylesheets in full for droppable per-cell work
   and expensive-to-paint properties; report honestly, including where the answer is "nothing".
   §4, §5 D5-D7.
5. Sandbox-provable acceptance criteria, and a real-Mac protocol extending `docs/PERF.md` §2.1c with
   the pacing signal it currently lacks. §6, §7.

### 0.3 Not in this phase

- **Pass B.** Untouched. `P22-slickgrid-migration-plan.md` §7.4(b)'s gate is still unrun and still
  unauthorised by anything here.
- **Chasing the 88% invisible bucket.** GPU-process rasterization/compositing is not observable from
  a WebContent-process trace, from `__kiraScrollTrace`, or from this sandbox. §8 hands it forward as
  an Instruments question, and §7.2(b) makes it the explicit "this plan was the wrong lever" branch.
- **The column axis.** Unchanged since `-iter2-scroll-gaps` §0.3 declined it; nothing found here
  changes that.
- **Re-opening `contain: layout`, the wheel-handler fix, or `forceSyncScrolling`'s default.** All
  three stand.
- **Any Go-side work.** Frontend, `tests/ui/`, `tests/unit/`, `docs/` only.

### 0.4 Ground rules carried forward

- **The sandbox does not get to certify a fix.** Every claim is labelled *provable here* or
  *real-Mac only*, and §7 keeps the two columns apart. `forceSyncScrolling`'s history
  (`0865ef6` landed on sandbox reasoning; `18a2cc4` reverted it on real-hardware feedback) is why.
- **Runtime toggles, not rebuilds.** Every new constant gets a `window.__kiraGridTuning` override,
  and each override's *neutral* value reproduces today's behaviour exactly — so §7's A/B is a
  console line, not a build.
- **No existing budget is loosened.** `budgets.spec.ts`'s and `slick-grid.spec.ts`'s current gates
  stay at their thresholds; this pass only adds.

---

## 1. What actually happens in one frame today, read from source

### 1.1 The two paths that call `render()` during a fling

```
(a) native `scroll` on .slick-viewport
      -> SlickGrid's own listener -> handleScroll(e)            (:10558-10560)
        -> _handleScroll('scroll')                              (:10575-10589)
          -> (dx > 20 || dy > 20) && (forceSyncScrolling || dy < viewportH && dx < viewportW
                ? this.render() : this.scrollThrottle.enqueue())
      -> SlickGridHost.vue's own onViewportScroll listener      (SlickGridHost.vue:196-206)
           (velocity sampling + scrollTrace.noteScrollEvent)

(b) KiraSlickGrid.getRenderedRange step 8                       (kiraSlickGrid.ts:253-259)
      if (short of target && !chasePending) {
        chasePending = true;
        requestAnimationFrame(() => { chasePending = false; this.render(); });
      }
```

Path (b) is scheduled from *inside* path (a) — `getRenderedRange` is called by `render()`
(`:10412`), which path (a) calls synchronously inside the native `scroll` event's own task. So every
scroll-driven render that falls short of target arms a rAF, and that rAF fires in the next rendering
update the browser runs.

### 1.2 The mechanism: the chase does not land in a *quiet* frame, it lands in the *next scrolling*
frame

While a fling is in flight, every rendering update carries a scroll event (WebKit coalesces to one
per update — `columns.ts:155-174`'s own citation, and `scrollTrace.ts`'s `scrollEventsHistogram`
exists to check exactly that on real hardware). So the frame the chase's rAF fires in is, with
overwhelming probability, a frame that *also* runs a scroll-driven render. The chase does not fill a
gap; it doubles up.

**Measured in this sandbox, with the current policy reproduced exactly** (a 400 000 px scroller, a
`getRenderedRange`-shaped "short of target → arm a rAF chase" handler, a continuous rAF ticker
delimiting frames, driven by `page.mouse.wheel` — a compositor-path scroll, not a `scrollTop`
write):

| engine | frames | 0 renders | 1 render | **2 renders** | intra-frame order |
|---|---|---|---|---|---|
| **WebKit** | 140 | 1 | 8 | **131 (94%)** | `tick, chase, scrollEvent, scrollRender` in 131/131 |
| Chromium | 140 | 2 | 79 | 59 (42%) | `tick, chase, scrollEvent, scrollRender` in 59/59 |

This is *provable here* — it is a property of rAF/scroll scheduling plus the app's own policy, not a
compositor-timing claim. It is **not** a claim that real macOS WKWebView produces the same 94%;
§7.3 step 1 is what measures that, and §7.2(a) is the branch where it does not.

### 1.3 What a doubled frame actually costs twice

Everything in `render()` that is O(mounted window) or fixed-per-call, not just the new-cell batch:

- `this.getVisibleRange()` **and** `this.getRenderedRange()` (`:10412`) — the second of which is this
  app's own override, which itself calls `super.getVisibleRange` again (`kiraSlickGrid.ts:155`),
  recomputes `rowRangeBounds`, re-reads `getCanvasNode(1)?.clientWidth` (a layout read), and
  recomputes `mountedColumnCount` over every column (`:284-287`).
- `cleanupRows(rendered)` (`:10413`) — `Object.keys(this.rowsCache).forEach(...)` over the whole
  mounted window (`:10437+`).
- `renderRows(rendered)` (`:10420`) — a fresh `Set`, `divArrayL`/`divArrayR`, two throwaway container
  `<div>`s, and the per-row/per-cell build for whatever is new (`:10364-10384`).
- `this.trigger(this.onRendered, {...})` (`:10430`) → `SlickGridHost.vue:222-233`'s `onGridRendered`
  → two `dataSource.getItem` calls (each allocating a frozen `RowHandle`) → **`setVisibleWindow`**,
  which on any window change iterates *every key* of both the decode cache and the view cache
  (`store.ts:166-178`) → `setVisibleRows`.
- `scrollTrace.noteRenderMs` (`kiraSlickGrid.ts:301`) plus two `performance.now()` calls.

Against a measured 33.3 ms baseline frame, paying that set twice plus up to a second full 600-cell
batch is entirely consistent with the observed 49.8 ms.

### 1.4 Why the existing `MAX_NEW_CELLS_PER_RENDER` dial cannot fix it, in either direction

`getRenderedRange`'s step 6 (`kiraSlickGrid.ts:202-207`) short-circuits to `must` only whenever
`mustNewRows >= budgetRows`, where `budgetRows = floor(maxNewCells / mountedColumnCount)`.

| `maxNewCells` | `budgetRows` @ 12 cols | scroll px/frame that trips step 6 @ 28 px rows |
|---|---|---|
| 100 | 8 | ~224 px — **below any real fling** |
| 600 (today) | 50 | ~1400 px — above `MAX_PLAUSIBLE_ROW_VELOCITY_PX_PER_FRAME` (800) |
| 2200 (`CELL_BUDGET`) | 183 | never |

So at 100, every fling frame short-circuits, is short of target, arms a chase, and doubles — while
never converging the runway. That is the user's already-reported null result explained, and it is
why "lower the cap further" is not on this document's list. Raising it toward `CELL_BUDGET` removes
the cap (and the chase with it) but restores the unbounded synchronous batch the previous pass
existed to bound. **Neither end of this dial is the pacing lever; the number of render passes per
frame is.**

---

## 2. What this confirms, and what it corrects, about the previous pass

**Confirmed and unchanged:**
- The per-call batch cap itself is sound and stays. Bounding a single synchronous pass by viewport
  size rather than fling distance was, and remains, correct.
- The strictly-visible floor is never deferred (`kiraSlickGrid.ts:167-168`, step 1). Nothing here
  weakens that.
- SlickGrid skips a row already in `rowsCache` (`:10366-10367`); the cost is on rows *entering*.

**Corrected:**
- `-iter2-scroll-gaps` §5 D2's own justification — *"self-scheduled `requestAnimationFrame`-chained
  `render()` calls that converge on the full target over a handful of frames"* — describes what
  happens **after** a fling stops, not during one. During a fling the chase converges the target
  within a *single* frame, in two passes, which is strictly worse than one pass: identical new-cell
  work, doubled fixed overhead, and a frame that is ~50% more expensive than its neighbours. The
  intent was right; the scheduling policy did not implement it.
- The `-iter2-scroll-gaps` D4 sandbox test (`slick-grid.spec.ts` `--- 3a.`) passes today and would
  keep passing with the bug present: it drives a single `scrollTop` write and then samples ten rAFs
  of quiescence, which is precisely the case where the chase *does* get quiet frames. It is a real
  convergence gate; it is not a pacing gate. §6 T1 adds the missing one.

---

## 3. Alternatives and adjacent hypotheses — given a real look

### F1 — "Defer the chase by one more frame (double-rAF)." **Rejected — moves the collision, does not remove it.**

`requestAnimationFrame(() => requestAnimationFrame(run))` guarantees the chase runs in a strictly
later rendering update than the one that scheduled it. But while the fling continues, *that* update
also carries a scroll event and a scroll-driven render. The collision recurs one frame later. The
sandbox trace in §1.2 shows exactly this shape already: in WebKit the chase fires in the frame
*after* the one that armed it (`sameFrame` false for 51 of 52 arms in the first harness run) and
still collides, because it collides with the *next* frame's scroll render, not with its own.

### F2 — "Skip the chase if a render already ran in this frame." **Rejected — depends on an ordering that is not stable.**

The obvious frame-token test is: in the rAF callback, compare the rAF timestamp against
`performance.now()` recorded at the last render's start; if the last render started at or after this
frame began, a render already happened this frame, so skip. Two sandbox harnesses gave **opposite**
orderings:

- Driving the scroll with `scrollTop +=` from inside a rAF callback: the scroll event was dispatched
  *after* that frame's animation-frame-callback phase, so a render→chase pair reads as "the scroll
  render came first".
- Driving it with `page.mouse.wheel` (the compositor-shaped path, and the closer analogue of a
  trackpad fling): the log is `tick, chase-raf, render:chase, scrollEvent, render:scroll` in **131 of
  131** doubled WebKit frames — the chase comes *first*, and the timestamp test would let it through.

Real macOS WKWebView with a live scrolling thread is a third environment neither harness models. A
fix whose correctness depends on which of the two runs first is a fix that will need a real-hardware
correction, which is exactly the failure mode this investigation keeps repeating. **The chosen
design (§5 D1) never asks which came first.**

Worth recording as a genuine correction to a documented premise: `scrollTrace.ts:26-34`'s
`afterRaf` comment, and `columns.ts:155-174`'s reasoning, both assume `scroll` dispatches *before*
the animation-frame callbacks in the same update, so `afterRaf` "should read false for essentially
every event". Under a wheel-driven scroll in this sandbox's WebKit it reads **true** for essentially
every event. That does not invalidate `columns.ts`'s D1 revert (which turned on "at most one scroll
event per update", still true — the histogram in §1.2 shows one scroll event per frame), but it does
mean `afterRaf: true` in a real-Mac trace is **expected, not a bug signal**, and the comment must be
corrected to say so.

### F3 — "Rate-limit consecutive chase frames." **Not needed once D1 lands; recorded because the task asked.**

With D1, a chase can only run in a frame with no scroll event, so consecutive chases occur only
while the grid is otherwise idle — the cheapest frames there are. They also terminate on their own:
`velocity()` returns `{pxPerFrame: 0}` once 150 ms have passed since the last scroll sample
(`SlickGridHost.vue:181-183`), which collapses `target` back to the base runway
(`rowRangeBounds`'s `leadPxWanted` clamp, `columns.ts:289-292`), so the deficit the chase is closing
shrinks as it closes it. A separate rate limiter would add a knob with nothing to tune.

### F4 — "Spread a large deficit over more, smaller, evenly-paced steps." **Real, adopted as a dial, defaulted neutral — see D2.**

Today a render's cost during a fling is `must` + `min(deficit, budget − must)` cells, capped at 600.
That is *uniform while the deficit is large* and then steps down abruptly to `must` when the target
is finally reached — a cliff, not a ramp. Capping the *runway* increment separately from the
absolute ceiling turns the profile into `must + min(leadCap, deficit)`, which tracks velocity
smoothly instead of stepping. It reduces variance; it also converges the runway more slowly, which
trades directly against `uncoveredPx`. That trade cannot be adjudicated in this sandbox, so it ships
as a dial whose default is neutral and whose §7.3 step 4 A/B is what sets it — the same shape
`forceSyncScrollingOverride` already has (`main.ts:184-192`).

### F5 — "The 14-scroll-dispatch frames are a second, independent cause." **Not independent; a symptom, with one real app-level consequence.**

The real-Mac recording's frames that bundle many (14) native scroll-dispatch ticks average 42 ms
against 31.5 ms for sparser frames. Per HTML's *run the scroll steps*, a scrolled element's `scroll`
event fires at most once per rendering update, so 14 dispatches attributed to one composited frame
means 14 rendering updates produced one composite — i.e. the main thread was already behind. That is
a consequence of frames being over budget, not a separate cause of it.

The one real app-level consequence: each of those dispatches runs `_handleScroll`, and each one whose
`dy > 20` runs a full `render()` — so the per-call budget is multiplied by the dispatch count as
well as by the chase. This is self-limiting in a way the chase is not: consecutive scroll renders
each only extend the target by that dispatch's own delta, so renders 2..N build far less than render
1. The chase, by contrast, unconditionally tries to close the *entire* remaining deficit. That
asymmetry is why the fix targets the chase and not `_handleScroll`. **D3's `renderCount` per frame is
what will confirm or refute this on real hardware** — it is currently unmeasurable.

### F6 — GC pressure. **Unchanged from the previous pass: a real amplifier, not independently falsifiable here.**

D1 halves the render passes per frame and therefore halves the fixed-cost allocations per frame
(`SlickEventData` per cell via `trigger(onBeforeAppendCell)` at `:9962`/`:9104-9107`, two frozen
`RowHandle`s per row, the throwaway container divs, the per-render `Set`s). D5/D6 remove more. If GC
is contributing, the fix should show it in `renderMs` without a GC-specific change; no attempt is
made to isolate it, per `-iter2-scroll-gaps` F4's own verdict.

---

## 4. Task 2 — what SlickGrid builds per cell and per row, and what of it is ours to change

Read from `dist/esm/index.js` `appendRowHtml` (`:9905-9940`), `appendCellHtml` (`:9955-9980`),
`Utils32.createDomElement` (`:520-527`), `applyHtmlCode` (`:9472-9486`), `sanitizeHtmlString`
(`:11430-11434`), `trigger` (`:9104-9107`), `getCellFromNode` (`:11238-11243`), `createCssRules`
(`:9676-9694`).

### 4.1 Per-cell inventory, with a verdict for each

| what | where | read by SlickGrid itself? | verdict |
|---|---|---|---|
| `className: "slick-cell l{i} r{j} …"` | `:9956-9965` | **Yes, hard.** `getCellFromNode` (`:11238-11243`) runs `/l\d+/.exec(cellNode.className)` and **throws** if absent; reached from `getCellFromEvent` (`:9444`) on every mouse interaction. `closest(".slick-cell")` appears in 5 places (`:2327, :3402, :3622, :9306, :9444`). | Load-bearing. Not droppable. Not app-controllable. |
| `role: "gridcell"` | `:9966` | **No** — one occurrence in the whole bundle, write-only. | Pure accessibility (pairs with the row's `role: "row"`, `:9912`). Keep. Not app-controllable without forking. |
| `tabIndex: -1` | `:9967` | Not for cells — the library's own `tabIndex` reads (`:7544`, `:7550`, `:7552`) are the two focus sinks. | What makes a cell programmatically focusable for `enableCellNavigation` (off in Pass A, **Pass B scope**). Keep. Not app-controllable. |
| `setAttribute("aria-describedby", uid + m.id)` | `:9969` | **No** — write-only. | Pure accessibility: ties each cell to its column header for a screen reader. Keep. Not app-controllable. |
| `setAttribute("title", toolTipText)` | `:9969` | No. | **Only written when a formatter returns a `toolTip`.** This app's formatters return none today — so this is currently free, and §5 D5 deliberately starts using it. |
| `trigger(this.onBeforeAppendCell, {...})` | `:9962` | Yes (its own event bus). | Allocates a `SlickEventData` **and** an args object **per cell**, and assigns `eventArgs.grid = this`, even with zero subscribers (`:9104-9107`). Real per-cell garbage. **Not app-controllable** — no option gates it. |
| `getCellHeight(row, rowspan)` | `:9970`, `:11310-11320` | Yes. | Arithmetic only in the `rowspan === 1` path. Negligible. |
| `hasOwnProperty(m, "cellAttrs")` probe | `:9971-9973` | Yes. | One `hasOwnProperty` call per cell. Negligible. |
| `getSelectionModel()?.getOptions()?.selectionType` + `getDragHandleVisibility()` | `:9975-9977`, `:9135-9137` | Yes. | Two optional-chained calls per cell; no selection model is registered, so both short-circuit. Negligible. |
| `sanitizeHtmlString(val)` inside `applyHtmlCode` | `:9482`, `:11430-11434` | Yes. | **Checked, and free**: returns the input unchanged and immediately when `_options.sanitizer` is unset, which is this app's case. Recorded so nobody re-investigates it. |
| `applyHtmlCode(cellDiv, cellResult)` | `:9979`, `:9472-9486` | Yes. | **The one branch the app controls.** A plain string with `enableHtmlRendering: false` is a single `textContent` write; an `HTMLElement`/`DocumentFragment` is `emptyElement(target)` + `appendChild`. See §5 D5. |

**Per-row**, `appendRowHtml` additionally does `rowDiv.cloneNode(true)` for the right pane
(`:9920`) because `frozenColumn: 0` is set — a clone of an empty div, before any cell is appended.
Cheap, and the frozen pane is the deliberate choice `P22-slickgrid-migration-plan.md` §5 item 5 made
over a per-row `position: sticky` gutter. Not revisited.

**Conclusion for 4.1: nothing in the library's per-cell attribute set is both droppable and
reachable from this app.** Every item is either load-bearing for SlickGrid's own internals, or
accessibility-load-bearing, or costs essentially nothing, or lives inside `appendCellHtml` where the
app has no seam short of forking. The app's entire surface here is (a) what the formatter returns,
(b) the column's `cssClass`, (c) CSS.

### 4.2 The formatter — the one genuine, app-controlled DOM simplification

`SlickGridHost.vue:88-109`'s `cellFormatter` builds DOM for two of its three branches:

- **NULL** (`:90-97`): `createElement("span")` + `createDocumentFragment()` + `appendChild` → then
  `applyHtmlCode` runs `emptyElement(cellDiv)` + `appendChild(frag)`. Five DOM operations and two
  live node allocations, and it leaves **one extra element per NULL cell** in the mounted tree
  forever.
- **truncated** (`:98-107`): fragment + text node + a `<span class="truncated-marker" title="…">`.
  Six DOM operations, three node allocations, two extra elements retained.
- **plain string** (`:108`): `textContent`. Already optimal.

SlickGrid's published `FormatterResultWithText`
(`dist/types/models/formatterResultObject.interface.d.ts`) removes the need for both:

```ts
function cellFormatter(_row, _cell, value): string | FormatterResultWithText {
  const view = value as CellView;
  if (view.isNull) return { text: 'NULL', addClasses: 'cell-null' };
  if (view.truncated) {
    return { text: view.text, addClasses: 'cell-truncated', toolTip: 'value truncated at 64 KB' };
  }
  return view.text;
}
```

Verified against `appendCellHtml`, not assumed:
- `addClasses` is folded into the cell's own `className` (`:9962`), so `.cell-null`/`.cell-truncated`
  land on the `.slick-cell` itself.
- `cellResult = Object.prototype.toString.call(formatterResult) !== "[object Object]" ?
  formatterResult : formatterResult.html || formatterResult.text` (`:9978`) picks `.text`, and
  `applyHtmlCode` then takes the `textContent` branch (`:9483`, `enableHtmlRendering: false`).
- `toolTip` becomes a `title` **on the cell** (`:9969`) — so the truncation tooltip is *kept*, not
  lost, and arguably improved (the whole cell is the hover target, not a 6 px ellipsis).
- The muted ellipsis marker is restored with `.slick-cell.cell-truncated::after { content: '…' }` —
  a pseudo-element, **zero DOM nodes**, and unaffected by `textContent` writes.

**Honest magnitude.** This removes JS allocation and DOM nodes on the *build* path, which is where
this phase's cost lives. It does **not** move paint meaningfully: paint execution measured under 1%
of total wall-clock in both real-Mac recordings (43.78 ms and 175.05 ms out of ~4-5 s). On a
NULL-free table its effect is exactly zero. **Worth doing because it is strictly less work, strictly
less DOM, and loses nothing — not because it is a lever.**

### 4.3 Expensive-to-paint properties — what is actually there

Verified by computed style in **real WebKit** (Playwright, `slick.grid.css` + `slickTheme.css` as
shipped, a real `.slick-row`/`.slick-cell` subtree), not by reading alone:

```
.slick-cell  → box-shadow: none · filter: none · opacity: 1 · border-radius: 0px
               z-index: 1 · overflow: hidden · display: block
               border-top/left: 1px solid rgba(0,0,0,0) · border-right: 1px solid rgb(51,51,51)
.slick-row   → contain: layout · z-index: auto
```

Item by item:

- **No blending, no filters, no gradients, no rounded-corner-plus-overflow clip anywhere on the
  mounted row/cell subtree.** `slickTheme.css` (122 lines, read in full) declares no `box-shadow`,
  `filter`, `backdrop-filter`, gradient, `opacity`, `border-radius`, `transform` or `will-change` at
  all.
- **The one genuinely expensive border style SlickGrid ships is already overridden.**
  `slick.grid.css` gives `.slick-cell` `border-right: 1px dotted silver`; a dotted border is drawn as
  a run of dots rather than one rect. `slickTheme.css:59` overrides it to `solid`, confirmed
  computed as `1px solid rgb(51,51,51)`. **Nothing to do — recorded so it is not re-investigated.**
- `border-top`/`border-left` remain `1px solid transparent` from `slick.grid.css`'s shorthand. A
  fully transparent border is skipped by the painter; it costs box-model space only, and that space
  is what `cellHeightDiff` (`:11317`) already accounts for. Removing it would change cell geometry
  for no measurable gain. **Declined.**
- `.slick-cell.highlighted { background: rgba(0,0,255,.2); transition: all .5s }`,
  `.slick-reorder-proxy/.slick-reorder-guide { opacity: .15/.7 }`,
  `.slick-reorder-shadow-row { box-shadow: … }`, `.slick-large-editor-text { border-radius: 10px }`
  all exist in `slick.grid.css` but apply only to classes/elements this app never produces
  (`highlighted` is never set; column reorder is off via `enableColumnReorder: false`; the large-text
  editor is Pass B). **Not a concern.** (The computed `transition: all` on a plain cell is the CSS
  initial value with a 0 s duration, not that rule leaking.)
- **Semi-transparent tokens**: `--kira-search-match` is `color-mix(in srgb, var(--kira-warn) 25%,
  transparent)` (`theme/tokens.css:26`) — genuinely a blended background, but applied to exactly one
  demonstration cell (`applyStaticCssLayers`, `SlickGridHost.vue:240-251`). `--kira-select`
  (`#04395e`) and `--kira-hover` (`#2a2d2e`) are opaque. **Negligible.**
- **`.slick-grid-host .slick-row:hover .slick-cell:not(.kira-cell-selected)`**
  (`slickTheme.css:54-56`) is the only per-frame style invalidation in the app's own CSS: during a
  fling with the pointer over the grid, hover migrates row to row every frame, so two rows'
  backgrounds repaint per frame. This is **parity with the incumbent** (`GridRow.vue`'s
  `.grid-row:hover .grid-cell:not(.selected)`), so it is not a SlickGrid-specific cost and it is a
  real affordance. **Not recommended for removal**; recorded because it is the one thing in these
  stylesheets that does work on every frame.
- **`rowTopOffsetRenderType` defaults to `"top"`** (`:7271`), matching the incumbent's own
  `:style="{ top: … }"` row positioning (`GridRow.vue:42-43`). Switching to `"transform"` would put a
  2D transform on every mounted row — the shape `GridRow.vue`'s own `contain` comment and P12's
  memory findings argue against. **Checked, declined.**

**Conclusion for 4.3: there is nothing expensive to paint left in these stylesheets.** The one real
offender was found and fixed last pass (`contain: layout`, `fce3e54`), and the measured result —
cell-sized paints down to ~5.5%, composite cost per frame down 2.3× — is consistent with that being
the whole of it. **This part of Task 2 turns up nothing further, and saying so plainly is the honest
outcome rather than manufacturing a finding.**

### 4.4 Adjacent findings — real, but correctness/parity, not performance

Found while reading these files in full, as Task 2 required. Flagged as *not* perf claims.

1. **The gutter's right-alignment is inert.** `slickTheme.css:69` sets
   `.slick-grid-host .kira-gutter { justify-content: flex-end }`, but `slick.grid.css` declares no
   `display` on `.slick-cell`, so it computes to `display: block` (verified in WebKit:
   `gutterDisplay: "block"`, `gutterTextAlign: "start"`). Row numbers are **left-aligned** in the
   SlickGrid engine and right-aligned in the incumbent (`GridRow.vue`'s `.gutter-cell` is
   `display: flex; justify-content: flex-end`). One-line fix: `text-align: right`.
2. **Cell text is not vertically centred.** `.slick-cell` computes `display: block`,
   `line-height: normal`, height = rowHeight − `cellHeightDiff` (26 px at the 28 px comfortable
   density) — so text sits at the top of the box. The incumbent's `.grid-cell` is
   `display: flex; align-items: center`. Two fixes with different costs, §5 D7.
3. **`dataSource.ts:181-184`'s comment is false.** It says the `kira-row-deleted`/`kira-row-dirty`
   rails are *"ported verbatim in `slickTheme.css`"*. Grepped: **neither class has any CSS anywhere
   in the tree.** Harmless in Pass A (no editing, so `pendingRowClasses` never returns either), but
   the comment misleads and Pass B depends on it.
4. **`getItemMetadata` allocates a second `RowHandle` per rendered row.** `appendRowHtml` calls
   `getDataItem(row)` (→ `getItem` → `rowHandleAt` → `Object.freeze({...})`, `:9906`) **and**
   `getItemMetadaWhenExists(row)` (→ `:8826-8828` → this app's `getItemMetadata` →
   `rowHandleAt` again → a second `Object.freeze`, `dataSource.ts:132-137`, `:9908`). Two frozen
   allocations per newly-built row where one suffices, in the hot loop.

---

## 5. Decisions

### D1 — A catch-up render never shares an animation frame with a scroll-driven one. **Implement. The priority item.**

The invariant this pass is adding: **at most one render pass per animation frame while a scroll is
live.** The chase exists to converge the runway *after* the scroll stops delivering events, which is
what `-iter2-scroll-gaps` D2 meant and did not implement.

The gate is **scroll quiescence**, not a frame token — §3 F2's reasoning: the intra-frame ordering of
the scroll render and the chase differs between engines and between input paths, so a fix that asks
"has a render already happened this frame?" is correct in one environment and wrong in another. "Is
a scroll still live?" is true in *every* frame that will carry a scroll-driven render, regardless of
where in the frame that render sits.

New constant, `columns.ts`, beside `MAX_NEW_CELLS_PER_RENDER`:

```ts
/** P22 iter2-pacing D1. Provisional, same epistemic status as LEAD_FRAMES/MAX_LEAD_PX/
 *  MAX_NEW_CELLS_PER_RENDER: how long the viewport must go without a native scroll event before a
 *  self-scheduled catch-up render is allowed to run. A catch-up that fires while a fling is still
 *  delivering scroll events lands in the same animation frame as that frame's scroll-driven
 *  render, doubling the frame's work (that plan's §1.2: 131 of 140 frames in a WebKit repro).
 *  ~1.5 frames at 60 Hz, ~3 at 120 Hz. 0 restores the pre-fix "fire on the very next rAF,
 *  unconditionally" behaviour exactly — which is what makes the real-Mac A/B a console line
 *  (docs/PERF.md §2.1c). Re-set from that A/B, not from here. */
export const CHASE_QUIET_MS = 24;
```

`KiraSlickGrid` (`kiraSlickGrid.ts`):

```ts
/** Supplied by the host: performance.now() at the last native `scroll` event on the viewport.
 *  Defaults to "never scrolled" so a grid that hasn't wired a sampler still chases immediately —
 *  and, like `velocity`/`mountedColumnCount`/`chasePending` above, every read below tolerates this
 *  field being `undefined` on the base constructor's own pre-field-init call. */
lastScrollEventAt: () => number = () => Number.NEGATIVE_INFINITY;

private chaseHandle = 0;
private chaseWanted = false;

private scheduleChase(): void {
  if (this.chaseHandle) return;
  this.chaseHandle = requestAnimationFrame(() => {
    this.chaseHandle = 0;
    if (!this.chaseWanted) return;
    const quietMs = window.__kiraGridTuning?.chaseQuietMsOverride ?? CHASE_QUIET_MS;
    const lastScroll = this.lastScrollEventAt ? this.lastScrollEventAt() : Number.NEGATIVE_INFINITY;
    // Still scrolling: this frame already has (or is about to get) a scroll-driven render of its
    // own. Re-arm — a rAF scheduled from inside a rAF callback always lands in a later frame.
    if (performance.now() - lastScroll < quietMs) return void this.scheduleChase();
    this.render();
  });
}
```

`getRenderedRange`'s step 8 (`kiraSlickGrid.ts:249-259`) becomes:

```ts
this.chaseWanted = end >= start && (start > target.start || end < target.end);
if (this.chaseWanted) this.scheduleChase();
```

`SlickGridHost.vue` wires it beside `grid.velocity = velocity` (`:346`):
`grid.lastScrollEventAt = () => lastOffsetT;` — `lastOffsetT` is already
`performance.now()` at the last native scroll event (`:199-205`), so this adds no new sampling.

**Termination.** `chaseWanted` is recomputed by every render; when a render reaches `target`, it
clears and the re-arm loop stops after at most one more (cheap, no-new-row) pass. `target` itself
shrinks as the grid goes quiet, because `velocity()` reports zero after 150 ms
(`SlickGridHost.vue:181-183`) and `rowRangeBounds` clamps `leadPxWanted` back to `baseLeadPx`
(`columns.ts:289-292`) — so the deficit the chase is closing shrinks while it closes it.

**What this trades away, named honestly.** During a sustained fast fling the runway now grows by one
render's worth per frame instead of two. It is *supposed* to: the second render's worth was being
bought at the price of a ~50%-more-expensive frame. If the leading-edge gap gets worse as a result,
`summary.uncoveredPx` in the real-Mac trace is what says so (§7.3 step 2), and
`chaseQuietMsOverride = 0` reverts it live, with no rebuild.

**Toggle:** `window.__kiraGridTuning.chaseQuietMsOverride`, read fresh on every chase callback (not
cached), matching `leadFramesOverride`/`maxLeadPxOverride`/`maxNewCellsPerRenderOverride`'s contract.

### D2 — A separate per-render cap on *runway* growth, defaulted neutral. **Implement as a dial, do not change behaviour by default.**

`MAX_NEW_CELLS_PER_RENDER` today governs both the floor short-circuit (step 6) and the runway
expansion (step 7), which is why turning it down broke the floor (§1.4). Split the two:

```ts
/** P22 iter2-pacing D2. How many *runway* (beyond strictly-visible) new cells one render pass may
 *  add — separate from MAX_NEW_CELLS_PER_RENDER, which stays the absolute per-pass ceiling and the
 *  step-6 floor short-circuit. Lowering this makes the runway grow in small even steps instead of
 *  one large step followed by a cliff, which is a variance reduction, not a total-work reduction —
 *  and it trades directly against how fast the runway converges (uncoveredPx). Defaulted EQUAL to
 *  MAX_NEW_CELLS_PER_RENDER, i.e. behaviourally neutral, because nobody has a real-hardware number
 *  for it yet; docs/PERF.md §2.1c step 4 is the A/B that sets it. Same precedent as
 *  forceSyncScrollingOverride (main.ts): a dial with a documented default, not a silent change. */
export const MAX_NEW_LEAD_CELLS_PER_RENDER = MAX_NEW_CELLS_PER_RENDER;
```

In step 7 (`kiraSlickGrid.ts:214`):

```ts
const maxLeadCells = tuning?.maxNewLeadCellsPerRenderOverride ?? MAX_NEW_LEAD_CELLS_PER_RENDER;
const leadBudgetRows = Math.floor(maxLeadCells / Math.max(1, this.mountedColumnCount || 1));
let remaining = Math.min(budgetRows - mustNewRows, leadBudgetRows);
```

Nothing else changes. Steps 1-6 and 8-9 are untouched, and with the neutral default the emitted
range is byte-identical to today's — which is the property `slick-grid.spec.ts`'s existing at-rest
and velocity-ladder assertions will keep proving.

**Toggle:** `window.__kiraGridTuning.maxNewLeadCellsPerRenderOverride`, read fresh per call.

### D3 — Per-frame render accounting in `__kiraScrollTrace`. **Implement, and land first, alone.**

The instrument cannot currently see the thing this pass is about, and one of its fields is actively
misleading. All four defects read from `scrollTrace.ts` this session:

1. **`renderMs` is sticky.** `lastRenderMs` (`:98`) is written by `noteRenderMs` (`:136-140`) and
   read into every frame (`:185`) but **never reset**. A frame with no render reports the *previous*
   render's duration; a frame with two renders reports only the *second*. It is neither a per-frame
   value nor a sum, and the real-Mac numbers already collected under this field are not comparable
   to anything measured after it is fixed. **Say that in `docs/PERF.md`; do not compare across the
   change.**
2. **No per-frame render count.** The doubling this document is about is literally invisible in the
   trace.
3. **No frame-duration metric in the summary.** `frames[i].t` is the rAF timestamp so deltas are
   derivable post hoc, but the user's goal is stated in exactly this quantity and `summarize`
   (`:207-216`) does not produce it.
4. **No dispersion measure.** `ScrollTraceStats` is `{p50, p95, max}` (`:69-73`). "Proper pacing" is
   a statement about spread; p50/p95/max of `pxPerFrame` cannot answer it.

Changes:

```ts
export interface ScrollTraceStats {
  p50: number; p95: number; max: number;
  /** P22 iter2-pacing D3: pacing is a statement about spread, not about a percentile. */
  mean: number;
  stddev: number;
}

export interface ScrollTraceFrame {
  // …unchanged fields…
  /** Wall time since the previous rAF tick, in px-free ms — the frame-duration series the
   *  "smooth, ideally 60fps, but it can be lower with proper pacing" goal is stated in. 0 on the
   *  first frame of a recording. */
  frameMs: number;
  /** How many KiraSlickGrid.render() passes ran since the previous tick. P22 iter2-pacing's own
   *  gate: > 1 during a fling is the doubling this pass exists to remove. */
  renderCount: number;
  /** SUM of those passes' durations — not, as before this pass, the most recent pass's duration
   *  carried forward into every later frame. 0 for a frame that rendered nothing. */
  renderMs: number;
}

export interface ScrollTraceSummary {
  // …unchanged fields…
  frameMs: ScrollTraceStats;
  /** renderCount-per-frame → how many frames saw that count, mirroring scrollEventsHistogram. */
  renderCountHistogram: Record<number, number>;
}
```

`noteRenderMs` accumulates (`pendingRenderMs += ms; pendingRenderCount++`) instead of overwriting;
`tick` drains and resets both, and computes `frameMs` from the previous `rafT`. `noteNotify` (the
Vue/`DataGrid.vue` path) is left alone except that it must also increment the count, so the
incumbent engine's traces stay comparable in shape.

Also correct `ScrollTraceEvent.afterRaf`'s doc comment (`:26-34`) per §3 F2: it currently tells the
reader that `true` is anomalous, which the sandbox says is wrong for a wheel/compositor-driven scroll
in WebKit. State that the ordering is engine- and input-path-dependent, that this pass's fix
deliberately does not depend on it, and that a real-Mac trace's values are the first real reading.

**Land alone, first** — `P22-webview-scroll-performance-iter2-rendering.md` §0.5's "instrument before
fix", and the same reason `-iter2-scroll-gaps` D1 landed alone: D1's effectiveness is judged by
`renderCountHistogram` and `frameMs.stddev`, so a bug in the instrument must not be mistakable for a
result from the fix.

### D4 — Cancel the pending catch-up on teardown. **Implement. A real bug, pre-dating this pass.**

`SlickGrid.destroy()` (`:7674-7700`) **never clears `this.initialized`** — the only assignment is
`init()`'s own `this.initialized || (this.initialized = !0, …)` (`:7567`) — and
`destroyAllElements()` (`:7723-7725`) nulls `_viewportScrollContainerY`, `_canvasTopL`,
`_canvasTopR`, `_viewport` and ~55 more references. `SlickGridHost.vue:381` calls
`grid?.destroy(true)`.

Today `getRenderedRange`'s `requestAnimationFrame(() => { this.chasePending = false; this.render(); })`
(`:255-258`) is **never cancelled**. A tab closed, or the engine switched, during a fling leaves a
chase armed; it fires one frame later, re-enters `render()`, passes the `if (!this.initialized)
return` guard (`:10408`) because the flag is still `true`, and dereferences nulled elements. Fix:

```ts
/** SlickGrid's own destroy() leaves `initialized` true and nulls ~60 element refs
 *  (dist/esm/index.js:7674-7700, :7723-7725), so a catch-up render armed by getRenderedRange and
 *  still pending when the host unmounts would re-enter render() against a torn-down grid. */
override destroy(shouldDestroyAllElements?: boolean): void {
  if (this.chaseHandle) cancelAnimationFrame(this.chaseHandle);
  this.chaseHandle = 0;
  this.chaseWanted = false;
  super.destroy(shouldDestroyAllElements);
}
```

Sandbox-provable (§6 T4). Ordered as its own commit because it fixes a bug that exists at `fce3e54`,
independent of D1.

### D5 — The cell formatter returns text, never DOM. **Implement.** (§4.2)

`SlickGridHost.vue`'s `cellFormatter` returns `{ text, addClasses, toolTip? }` for the NULL and
truncated branches instead of building a `DocumentFragment`. `slickTheme.css` follows:

```css
/* P22 iter2-pacing D5: the NULL/truncated markers are now classes on the cell itself
   (SlickGrid's own FormatterResultWithText.addClasses), not child nodes the formatter builds —
   two fewer DOM operations and one fewer retained element per NULL cell, and the truncation
   tooltip moves from a 6px span to the whole cell (appendCellHtml's own `toolTip` -> `title`). */
.slick-grid-host .slick-cell.cell-null { color: var(--kira-fg-disabled); font-style: italic; }
.slick-grid-host .slick-cell.cell-truncated::after {
  content: '…';
  color: var(--kira-fg-muted);
  margin-left: var(--kira-s-1);
}
```

The old `.slick-grid-host .cell-null` / `.truncated-marker` rules are removed with the nodes they
styled. **Pass-B note to carry in the file:** `addClasses` is applied at *build* time only, so a cell
whose NULL-ness changes without a row rebuild would keep the stale class — fine today (frozen pages,
full rebuild on `pageVersion`), and something a staged-edit path must go through
`invalidateRows`/`updateCell` for.

**Expected impact, stated plainly:** proportional to how many NULLs a table has, zero on a NULL-free
one, and on the *build* path rather than the paint path. Minor. Worth doing because it is strictly
less work with no functional loss, not because it is a lever.

### D6 — One `RowHandle` per rendered row, not two. **Implement.** (§4.4 item 4)

`dataSource.ts` grows a private `pageRowAt(pos): number` — the `rowHandleAt` row arithmetic without
the object — and `getItemMetadata` calls `state.rowClasses(pageRowAt(pos))` directly instead of
building and freezing a second handle. `getItem`/`getCellValue` are unchanged. It must reproduce
`rowHandleAt`'s insert-region rule exactly (`idx.pageRowCount + (pos - count)` past the last display
row, `dataSource.ts:56-61`), which `tests/unit/slick-data-source.spec.ts` already has coverage for.

Alongside it, resolve §4.4 item 3: either add the two missing rail rules to `slickTheme.css` or
correct `dataSource.ts:181-184`'s comment. **Recommendation: add the rules** — they are two
declarations, they are what the comment already promises, and Pass B needs them; leaving a class
emitted with no CSS behind it is the half-implemented shape AGENTS.md rules out.

### D7 — The two visual-parity defects in the port. **Implement item 1; implement item 2 as its own commit, re-measured.** (§4.4 items 1-2)

1. `.slick-grid-host .kira-gutter`: replace the inert `justify-content: flex-end` with
   `text-align: right`. One line, no layout-model change.
2. Vertical centring. Two candidates:
   - `line-height` on `.slick-grid-host .slick-cell` — cheapest (no layout model change), but has to
     track the 22/28 px density setting, so it needs a CSS variable the host sets, or a rule per
     density class. More moving parts than it looks.
   - `display: flex; align-items: center` — **exact parity with the incumbent**, whose flex-per-cell
     profile is the measured-good baseline this whole spike is being compared against, and which
     also makes the D7-item-1 `justify-content` work as originally written. But it is a layout-model
     change on every mounted cell.
   **Recommendation: flex, for parity, as its own commit**, with `slick-grid.spec.ts`'s at-rest
   coverage and velocity-ladder gates re-run — a layout-model change across ~2000 cells is exactly
   the kind of thing that can move them, and it must be bisectable away from D1 if a real-Mac run
   regresses.

### D8 — Not adopted, with reasons

- **Double-rAF / deferring the chase one more frame.** §3 F1: moves the collision, does not remove
  it.
- **A frame-token ("did a render already run this frame?") gate.** §3 F2: depends on an intra-frame
  ordering that two sandbox harnesses disagree about and that real WKWebView models neither of.
- **Lowering `MAX_NEW_CELLS_PER_RENDER` further.** §1.4: it caps the floor, not just the runway, so
  below ~600 it makes every fling frame short-circuit *and* chase. Already falsified on real
  hardware at 100.
- **Rate-limiting consecutive chase frames.** §3 F3: nothing left to limit once D1 lands.
- **Coalescing `_handleScroll`'s own renders to one per frame.** §3 F5: consecutive scroll-driven
  renders are self-limiting (each only extends the target by its own delta), unlike the chase, which
  tries to close the whole deficit. If D3's `renderCountHistogram` shows multi-render frames on real
  hardware *after* D1 lands, this becomes the next candidate — not before.
- **Dropping `role`/`tabIndex`/`aria-describedby` from cells.** §4.1: all three are write-only inside
  the library but accessibility-load-bearing, `tabIndex` is Pass-B-load-bearing for cell navigation,
  and none of the three is reachable from app code without forking SlickGrid.
- **Neutralising `.slick-cell`'s `z-index: 1` from the app's stylesheet** (which would remove the
  per-cell stacking contexts at their source rather than re-containing them with `contain: layout`
  on the row). Tempting, and it would be app-controllable — but `fce3e54` already collapsed
  cell-sized paints from 89% to ~5.5% and composite cost per frame by 2.3×, so the remaining
  headroom is small; it changes paint order semantics for `.slick-cell.editable`'s `z-index: 11`
  (Pass B); and it would need its own CDP paint-count A/B to justify. **Declined for this pass,
  recorded in §8 as a cheap experiment if a future recording still shows paint fragmentation.**
- **`rowTopOffsetRenderType: 'transform'`.** §4.3: 200 transformed rows, against `GridRow.vue`'s own
  comment and P12's memory findings, for no measured gain.
- **A web worker, a node pool, or a hand-rolled cell diff.** Unchanged from
  `-iter2-scroll-gaps` §4; nothing found here reopens any of them.

---

## 6. Verification in this sandbox

Extending `tests/ui/slick-grid.spec.ts` (which already carries the fixture, the engine switch via
`page.addInitScript`, and the `rightViewport` helper) and `tests/unit/kira-slick-grid.spec.ts`.

**T1 — at most one render pass per animation frame while a scroll is live. *The core gate.***
`__kiraScrollTrace.start()`, drive the scroll with **`page.mouse.wheel`** over the viewport, stop,
assert `summary.renderCountHistogram` has **no key ≥ 2** across the scrolling window. Two things the
implementer must get right, both load-bearing:
- It must be `mouse.wheel`, not the `scrollTop +=` writes the rest of the spec uses. §1.2/§3 F2: the
  two input paths produce *different* intra-frame orderings, and only the wheel path reproduces the
  doubling this gate is for.
- It must fail against `fce3e54`. Verify that by running it once with `chaseQuietMsOverride = 0`
  (T3) — if the zero-override run does not show 2-render frames, the harness is not reproducing the
  condition and the gate is a tautology.
A comment in the test must say what it does and does not claim: it gates the *policy* (never render
twice in a frame while scroll events are arriving), which is engine-independent; it is not a timing
claim about WKWebView, which this sandbox has none of.

**T2 — the existing convergence assertion still holds, unmodified.** `slick-grid.spec.ts`'s
`--- 3a.` block (a single `scrollTop = scrollHeight` jump, then ten rAF checkpoints) must keep
passing: it samples quiescent frames, which is exactly when D1 lets the chase run. If it fails
because `CHASE_QUIET_MS` outlasts its ten-frame window, **widen the window, do not lower the
constant** — the constant is the subject of a real-hardware A/B, not of a test's convenience.

**T3 — `chaseQuietMsOverride = 0` restores the pre-fix behaviour.** Same trace as T1 with the
override set; `renderCountHistogram` must then contain keys ≥ 2. This proves the dial is wired and
is what makes §7.3 step 3's real-Mac A/B a console line rather than a rebuild.

**T4 — teardown during an in-flight catch-up (D4).** Scroll far enough to leave a chase armed, then
unmount within the same frame (close the tab / flip `__kiraGridEngine`); assert no `pageerror`, and
that the existing teardown gate (no leaked `.slick-viewport`, no leaked `<style>`,
`__kiraRetention()` back to its pre-open reading) still passes. Against `fce3e54` this is expected
to throw.

**T5 — the trace's per-frame accounting resets (D3).** From `frames[]` directly: a frame with
`renderCount === 0` must report `renderMs === 0` (today it reports the previous frame's value), a
frame's `renderMs` must be ≥ the max single render it contains when `renderCount > 1`, and
`frameMs` must be present and non-zero after the first frame.

**T6 — unit coverage.** Only if D2's lead cap is extracted as a pure helper does it earn a case in
`tests/unit/kira-slick-grid.spec.ts` beside `clampColumnOverscan`/`countNewRows`. Per AGENTS.md's
bar, the `getRenderedRange` restructure and the chase gate are **not** on their own test-worthy —
T1/T3 cover the behaviour that matters and a unit test of `min(a, b)` restates the code. **Do not
invent one.**

**Unchanged and must keep passing:** decode-cache pinning under sustained scroll, sub-row scroll →
zero mutations, cross-row scroll → some, the velocity ladder's `< 2500` mounted cells, at-rest
coverage vs the incumbent, `budgets.spec.ts` in full, plus `bun run typecheck && bun run lint &&
bun run build && bun test apps/kira-studio/tests/unit`.

---

## 7. Verification on real hardware

### 7.1 What this sandbox can and cannot settle

*Provable here:* that the chase collides with the scroll render under the current policy (§1.2,
measured); that after D1 it never does (T1); that the trace reports per-frame counts and sums (T5);
that teardown is safe (T4); that at-rest and velocity-ladder behaviour is unchanged (existing
gates); that the stylesheets contain no expensive-to-paint property (§4.3, computed-style verified in
real WebKit).

*Real-Mac only:* whether the doubling happens at all on WKWebView with a real scrolling thread and
real momentum; whether removing it reduces **frame-duration variance**; whether the leading-edge gap
gets worse as the price; and anything at all about the 88% of frame time in the GPU process.

### 7.2 The three readings that would refute this plan

State these before running, not after.

- **(a) `renderCountHistogram` on the baseline shows essentially no 2-render frames.** Then §1.2's
  mechanism does not occur on real hardware, D1 is aimed at nothing, and the 49.8-vs-33.3 ms
  difference has some other cause. Revert D1's default (`chaseQuietMsOverride = 0` is already the
  identity) and re-open §8.
- **(b) The histogram goes to all-1 and `frameMs.stddev` does not move.** Then the chase was never
  the pacing term. The remaining variance is in the invisible bucket, and the honest next step is
  Xcode Instruments on the GPU process — **not** more app-level work. This is the branch this
  document considers most likely if (a) passes but the numbers stay flat.
- **(c) `uncoveredPx` p95 regresses materially.** Then the runway is now too thin during a fling.
  Lower `chaseQuietMsOverride`, or raise the runway per frame; both are console lines.

### 7.3 The protocol

Extends `docs/PERF.md` §2.1c — same build, same 50 000+-row table at page size 10 000, comfortable
density, `window.__kiraGridEngine = 'slick'` with a tab reload, one hard two-finger flick per run,
momentum allowed to die, `copy(JSON.stringify(__kiraScrollTrace.stop()))`.

**Report for every run:** `summary.frameMs` `{mean, stddev, p50, p95, max}` — the pacing number and
the point of the whole exercise; `summary.renderCountHistogram`; `summary.renderMs` (now a per-frame
sum); `summary.uncoveredPx`; `summary.pxPerFrame`; `summary.scrollEventsHistogram`; the share of
`scrollTopAtEvent[].afterRaf` that is `true`; and one sentence on whether the motion *felt*
different. The perceptual sentence is what answers the report; the numbers keep it honest.

1. **Baseline, on a build with only D3 landed.** This is the first trace in this engine's history
   whose `renderMs` is a real per-frame sum rather than a sticky last-render value — **do not
   compare its `renderMs` to any figure recorded before D3**; say so in the write-up. The decisive
   reading is `renderCountHistogram`: a substantial share of frames at 2 confirms §1.2 on real
   hardware. §7.2(a) if it does not.
2. **With D1 landed**, same gesture. `renderCountHistogram` should be ~all-1 during the fling;
   `frameMs.stddev` and `renderMs` p95 should both fall; `uncoveredPx` p95 must not rise materially.
3. **The D1 A/B, live, no rebuild:** `__kiraGridTuning.chaseQuietMsOverride = 0` (pre-fix
   behaviour), then unset (24), then `= 48`. Same flick each time. If `frameMs.stddev` tracks this
   dial, that is the direct, decisive confirmation of the mechanism.
4. **The D2 dial:** `__kiraGridTuning.maxNewLeadCellsPerRenderOverride = 600` (neutral/today), then
   `= 200`, then `= 100`. Read `frameMs.stddev` **and** `uncoveredPx` p95 *together* — this dial
   trades one against the other by design, and a setting that lowers stddev while pushing
   `uncoveredPx` past the baseline is not an improvement. Set the constant from whatever this step
   says, or leave it neutral if it says nothing.
5. **Re-run §2.1c's existing step 4** (`forceSyncScrollingOverride` true/false) *after* D1 lands —
   D1 changes what synchronous scrolling costs per frame, so the previous verdict on it does not
   carry over.
6. **A Safari Web Inspector Timeline recording alongside step 2**, same capture as the one that
   found the `contain: layout` bug. Look specifically for whether the rAF-attributed script records
   that used to sit adjacent to the scroll-attributed ones are gone. That is a confirmation of
   de-stacking that is independent of the app's own instrumentation — worth having, because §7.2(a)
   is a real possibility and the app's own trace is not a neutral witness to it.
7. Fold the result into `docs/PERF.md` §2.1c (same still-open A/B, extended — not a new section),
   with the verdict, and update this document's §8.

### 7.4 The ceiling, restated so nobody re-derives it

Even the calmest frames in the post-`fce3e54` recording — before the heavy scroll-dispatch bursts
start, with no chase firing — ran **23.5-24.5 ms**, well past the 16.7 ms a 60 Hz budget allows, and
in those frames composite + script together accounted for only a few ms. **~18-20 ms of even the best
frame is in the GPU-process bucket**, which neither `__kiraScrollTrace`, nor a WebContent-process
Timeline, nor this sandbox can see. Nothing in this plan can reach it. This is a *measured floor from
the tools available*, not a proven hard ceiling — Xcode Instruments, which this project does not
have access to, is what would settle whether it is addressable at all. **Which is exactly why this
pass optimises variance rather than average frame rate**, per the user's own stated goal.

---

## 8. Implementation order

Frontend, `tests/ui/`, `tests/unit/`, `docs/`. Each commit ends on a green tree (`bun run typecheck
&& bun run lint && bun run build && bun test apps/kira-studio/tests/unit`, plus the full `tests/ui/`
suite, unmodified except where the commit is the one adding to a spec).

**C1 — `fix(grid): per-frame render accounting in __kiraScrollTrace`**
D3 alone. `frameMs`, `renderCount`, `renderMs`-as-a-sum with a per-frame reset, `mean`/`stddev` on
`ScrollTraceStats`, `frameMs` + `renderCountHistogram` on the summary, and the corrected `afterRaf`
comment. No rendering behaviour changes. **Land first and alone** — everything after it is judged by
this.

**C2 — `perf(grid): a catch-up render never shares a frame with a scroll-driven one`**
D1. `columns.ts` gains `CHASE_QUIET_MS`; `kiraSlickGrid.ts` replaces `chasePending` with
`chaseWanted`/`chaseHandle`/`scheduleChase()` and gains `lastScrollEventAt`; `SlickGridHost.vue`
wires it; `main.ts` + `kiraSlickGrid.ts`'s mirrored `declare global` gain
`chaseQuietMsOverride`. The commit message carries §1.2's measured 131-of-140 repro and §3 F2's
reason for choosing quiescence over a frame token.

**C3 — `fix(grid): cancel a pending catch-up render on teardown`**
D4. The `destroy()` override. Its own commit because the bug pre-dates C2 (it exists at `fce3e54`)
and should be bisectable as such.

**C4 — `perf(grid): a separate per-render cap on runway growth`**
D2. Neutral default; `maxNewLeadCellsPerRenderOverride` wired. Behaviour-identical by construction —
the existing at-rest and velocity-ladder gates are the proof.

**C5 — `perf(grid): the cell formatter returns text, never DOM`**
D5. `SlickGridHost.vue`'s `cellFormatter` plus the two `slickTheme.css` rules.

**C6 — `refactor(grid): one RowHandle per rendered row, and the row rails' missing CSS`**
D6. `dataSource.ts`'s `pageRowAt`, and either the two rail rules or the corrected comment
(recommendation: the rules).

**C7 — `fix(grid): the gutter's right-alignment`**
D7 item 1. One line.

**C8 — `fix(grid): centre cell text vertically, matching the incumbent`**
D7 item 2. Its own commit, per D7's own reasoning — a layout-model change on every mounted cell must
be bisectable, and the at-rest coverage + velocity-ladder gates must be re-run against it
specifically.

**C9 — `test(ui): one render pass per frame while scrolling, and a trace that resets`**
T1, T3, T4, T5.

**C10 — `docs(perf): the frame-pacing fix and how to A/B it on real hardware`**
§7's protocol folded into `docs/PERF.md` §2.1c (same A/B, extended), including the explicit warning
that pre-C1 `renderMs` figures are not comparable to post-C1 ones, plus a pointer from this
document.

---

## 9. Acceptance checklist

1. `__kiraScrollTrace` reports, per frame, `frameMs`, `renderCount`, and a `renderMs` that is the
   **sum** of that frame's renders and **resets to 0** for a frame that rendered nothing; `summary`
   carries `frameMs` with `mean`/`stddev` and a `renderCountHistogram`.
2. A catch-up render never runs in a frame in which a native scroll event has arrived within
   `CHASE_QUIET_MS`; it re-arms instead, and converges the runway once the scroll goes quiet.
3. `window.__kiraGridTuning.chaseQuietMsOverride = 0` reproduces the pre-fix behaviour **exactly**,
   and a sandbox test proves both halves of that (no ≥2-render frames with the default, ≥2-render
   frames with the override at 0).
4. The strictly-visible floor is still returned in full on every call, and `slick-grid.spec.ts`'s
   at-rest, velocity-ladder, decode-cache-pinning and sub-row-mutation assertions pass
   **unmodified**.
5. Tearing down the grid with a catch-up render still armed does not re-enter `render()`; the
   existing teardown gate still passes and no page error is raised.
6. `MAX_NEW_LEAD_CELLS_PER_RENDER` and its override exist, default neutral, and are read fresh per
   call.
7. No formatter branch builds DOM; NULL and truncated cells carry a class on the cell itself, the
   truncation tooltip survives as a `title`, and the ellipsis marker is a pseudo-element.
8. The gutter's row numbers are right-aligned and cell text is vertically centred, matching the
   incumbent; both changes are their own commits and the at-rest/velocity gates are re-run against
   the second.
9. `docs/PERF.md` §2.1c carries §7's protocol, the warning that pre-C1 `renderMs` figures are not
   comparable, and — once run — the real numbers and verdict.
10. **Nothing in this document claims the stutter is fixed without a real-Mac trace saying so.** What
    this pass is allowed to claim from the sandbox alone: the doubling is real and measured under the
    current policy in two engines; the new policy provably never doubles; the instrument can now see
    the difference; and §7.2 lists, in advance, the readings that would say the whole plan was aimed
    at the wrong thing.

---

## 10. Open questions, handed forward

- **If §7.2(b) happens** — the doubling is removed and `frameMs.stddev` does not move — this
  investigation has exhausted what a WebContent-process view can reach. The 88% unattributed share
  is GPU-process rasterization/tiling/compositing, and the next honest step is **Xcode Instruments**
  (or a WebKit build with GPU-process tracing), not another app-level pass. Say that plainly rather
  than starting a fourth round of DOM micro-optimisation.
- **`CHASE_QUIET_MS = 24` is provisional**, exactly like `LEAD_FRAMES`/`MAX_LEAD_PX`/
  `MAX_NEW_CELLS_PER_RENDER` before it, and for the same reason. §7.3 step 3 is what sets it. Note
  that it is ~1.5 frames at 60 Hz but ~3 at 120 Hz; if the real-Mac A/B shows the refresh rate
  matters, deriving the threshold from the observed rAF interval (the chase callback already has the
  timestamps) is the obvious refinement — deliberately not built up front.
- **`MAX_NEW_LEAD_CELLS_PER_RENDER` ships neutral.** If §7.3 step 4 says nothing, leave it neutral
  and delete neither the constant nor the override — a dial with a documented default is this repo's
  established shape for a question real hardware has not answered yet
  (`forceSyncScrollingOverride`).
- **`.slick-cell`'s `z-index: 1`** could be neutralised from the app's stylesheet, removing the
  per-cell stacking contexts at their source rather than re-containing them on the row (D8). Declined
  here because `fce3e54` already took cell-sized paints from 89% to ~5.5%. If a future real-Mac
  Timeline still shows paint fragmentation, this is the cheap next experiment — with the same CDP
  paint-count A/B methodology `-iter2-scroll-gaps` §10 used, and with `.slick-cell.editable`'s
  `z-index: 11` (Pass B) as the thing to check it against.
- **If `renderCountHistogram` still shows multi-render frames after D1**, the remaining source is
  `_handleScroll` running more than one render per frame (§3 F5). Coalescing *those* is the next
  candidate — it was declined here only because consecutive scroll renders are self-limiting in a
  way the chase is not, and that reasoning is falsifiable by exactly this measurement.
- **`afterRaf`'s real value on macOS is still unknown.** The sandbox says the scroll handler runs
  *after* the animation-frame callbacks under a wheel-driven scroll in WebKit — the opposite of the
  premise `scrollTrace.ts` and `columns.ts` were written against. Neither this pass's fix nor
  `columns.ts`'s D1 revert depends on it (that revert turned on "at most one scroll event per
  update", which the histogram still supports), but the first real-Mac trace with D3 landed is the
  first honest reading of it, and `docs/PERF.md`'s Chromium-derived ordering claim at `:98-102`
  should be re-checked against it.

---

## 11. Postscript — the gesture-onset pass (P22 iter2-onset), and a correction to §5 D1

Added after this plan's C1-C10 landed and were reported on from real macOS hardware. The verdict on
this plan was positive — "feels really good", a consistent ~30 ms/frame — with one residual: **at
the very start of a fast fling, before deceleration begins, a few frames in which content isn't
fully rendered.** Recorded here rather than in a new document, per this repo's own preference for
extending an existing plan over starting a fourth one mid-thread.

### 11.1 The finding: the runway's velocity input is one scroll event stale, always

`SlickGrid` binds its own viewport `scroll` listener in `finishInitialization()`
(`dist/esm/index.js:7572`, reached from the constructor because `explicitInitialization: false`).
`SlickGridHost.vue` binds `onViewportScroll` on the *same element* only after
`new KiraSlickGrid(...)` returns (`:359` at `a9dc570`). Two non-capturing listeners on one target
fire in registration order, so SlickGrid's `handleScroll` → `_handleScroll` (`:10589`) → `render()`
→ `getRenderedRange()` → `velocity()` (`kiraSlickGrid.ts:219-221`) runs **before** the host samples
the very event that triggered it.

Measured, not inferred, with the `runwayVelocity` field this pass added to `__kiraScrollTrace`:
under the pre-fix policy a frame's runway velocity is *exactly* the previous frame's measured
`pxPerFrame` — `20/19, 25/20, 28/25, 31/28, 35/31, 36/35, 45/36, ...` — for the whole length of
every burst.

Mid-fling the lag is harmless. At **the first render of a fresh gesture** it is not: the only sample
on hand predates the gesture, so `velocity()`'s own 150 ms at-rest test (`SlickGridHost.vue:176`)
fires and it returns `{0, 0}`. `rowRangeBounds` then collapses `target` to `baseLeadPx`
(`columns.ts`'s `leadPxWanted` clamp), the per-call budget of step 7 is left entirely unspent, and
step 8 does not even set `chaseWanted` — the returned range *does* reach that collapsed target. One
frame of runway-building is lost per gesture, at peak velocity.

This corrects the framing this pass inherited: the defect is not that `prevOffsetT` is `0` on the
first sample (true only for the first gesture in a tab's life), it is listener ordering, which
applies to **every** gesture — matching the symptom.

### 11.2 The fix, and the alternative rejected

Sample at the point of consumption: `velocity()` reads `viewportEl.scrollTop` itself, deduped by
offset, seeded once at mount. No render can then run on a sample older than the event that triggered
it. `freshVelocitySampleOverride = false` restores the old behaviour exactly.

**Rejected: a one-time onset bypass of `scheduleChase`'s quiescence gate.** It reintroduces exactly
one doubled frame per gesture — the thing §5 D1 exists to prevent — at the moment the user is most
sensitive, on a "was it idle?" heuristic a main-thread stall can false-positive mid-fling. Decisively,
it also cannot help on the frame that matters: on the onset frame the pre-fix code does not *want* a
chase at all (§11.1), so a bypass has nothing to release.

### 11.3 The correction to §5 D1 — the quiescence gate cannot be wall-clock only

**`CHASE_QUIET_MS = 24` is shorter than one frame on the hardware this plan measured.** §7.4's own
figure is a p50 frame duration of 32.1 ms; this sandbox's wheel-fling harness measures p50 29 / p95
58 / max 65 ms. When a frame outlasts the threshold, "24 ms since the last scroll event" no longer
means "no scroll event is driving this frame" — the event was in the *previous, long* frame, which
is precisely a frame the main thread is already behind on — and the gate opens on a frame that does
carry a scroll-driven render. Measured, once a chase is genuinely wanted on every frame: **7-9
doubled frames out of ~80.**

§3 F3's own termination argument depended on the same blind spot, and §6 T1 passed at `a9dc570` for
a reason worth stating plainly: the stale sampler of §11.1 reported *zero* velocity over much of a
fast fling, which collapsed `target`, which meant no chase was ever wanted, which meant **the gate
was passing its own test by never being asked**. Restoring real velocity is what exposed it.

The gate therefore gains a second, per-frame half: a catch-up render additionally requires that no
native `scroll` event arrived between the previous animation frame and this one, read as a
**sequence number** rather than a duration. This is precisely the refinement §10 anticipated
("deriving the threshold from the observed rAF interval ... the obvious refinement, deliberately not
built up front"), and it preserves §3 F2's ordering-agnosticism: it never asks which of the two
renders ran first inside a frame, only whether a scroll event happened across the last one — true in
every frame that will carry a scroll-driven render, under either engine's ordering. It is strictly
conservative (it can only *delay* a chase, never release one) and costs one extra quiet frame before
the chase converges after a fling stops. `chaseQuietMsOverride = 0` still disables the gate whole,
so §6 T3 and §7.3 step 3 keep their meaning; `chaseFrameGateOverride = false` A/Bs the new half.

### 11.4 Status

Sandbox-provable and proved (`tests/ui/slick-grid.spec.ts`, `P22 iter2-onset`): the one-sample lag;
its absence after the fix across three rest-to-motion transitions; the pacing invariant still holding
on that same recording; and doubled frames returning when the per-frame gate is switched off.
**Nothing here claims the onset artifact is gone** — `docs/PERF.md` §2.1c carries the real-Mac
protocol, its own refuting readings, and the named next candidate if the artifact survives (the
per-call new-cell cap still costs roughly two budget-capped frames to converge from a standing
start; this pass removes the *wasted* first frame, not the cap).

