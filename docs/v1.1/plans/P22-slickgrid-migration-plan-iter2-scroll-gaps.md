# P22 iter2 — the SlickGrid spike's fast-fling gaps and dropped frames

> **The user's report**, on real macOS hardware, after `e2a7f73`/`cf266dd` (SlickGrid's own
> `enableMouseWheelScrollHandler` disabled, native trackpad momentum confirmed restored — *"massive
> improvement"*): with momentum now genuinely native, *very* fast flicks still show (a) brief
> rendering gaps — content not yet painted at the leading edge — and (b) occasional dropped frames.
> Doubling `leadFramesOverride`/`maxLeadPxOverride` live from the console, the first and most obvious
> lever, **made no difference**.
>
> **Confirmed, from SlickGrid 5.20.0's own source, not assumed:** `render()` — reached synchronously
> from the viewport's native `scroll` listener via `_handleScroll` (`dist/esm/index.js:10575-10589`),
> in the same task, on the main thread — calls `renderRows(rendered)`
> (`:10364-10384`/`:10407-10430`), which builds **every** row in the returned range that lacks a
> `rowsCache` entry, synchronously, in one pass: `appendRowHtml` → `appendCellHtml` per visible
> column (`:9905-9940`, `:9955-9980`), and `appendCellHtml` calls this app's own
> `dataItemColumnValueExtractor` (`views/grid/slick/dataSource.ts`'s `extractValue`, which is
> `page.ts`'s `cell()` → `store.ts`'s `cached`/`cachedView` → `cellText`'s `TextDecoder.decode`,
> `packages/shared/protocol/page.ts:235-237`) **and** unconditionally constructs a new DOM node per
> cell (`Utils32.createDomElement`, class-list joins, attribute writes, and — for NULL/truncated
> cells — a `DocumentFragment` with two child nodes). A row already in `rowsCache` is skipped
> entirely (`:10366-10367`) — SlickGrid really is category (A) for a *retained* row, exactly as
> `P22-slickgrid-migration-plan.md` F2 found. The cost this document is about is what happens to a
> row on the frame it **enters**.
>
> **The refinement the task's own hypothesis needed:** the decode step (`page.ts`/`store.ts`) is real
> and is exactly what the task named, but it is not the whole story, and — this is the part that
> explains the null result — **it is not even the larger term for a warm decode cache.**
> `store.ts`'s decode cache and SlickGrid's own `rowsCache` are pruned to essentially the *same*
> mounted window (P5 C1's `setVisibleWindow`, driven from this window's own `onRendered` bounds —
> `SlickGridHost.vue:222-233`), so a row a fling revisits after scrolling away has almost always lost
> **both** caches together — but even when the decode cache alone is warm, `renderRows` still pays
> the *unconditional* per-cell DOM-construction cost for every row entering `rowsCache`, because that
> decision is keyed on `rowsCache` membership, never on decode freshness. **The synchronous cost on a
> cold entry is "decode-on-miss plus DOM-construction-always," and DOM construction is the term a
> warm decode cache cannot remove.**
>
> **Why the runway experiment was a true null, not a false one.** `MAX_LEAD_PX`/`LEAD_FRAMES` govern
> how *wide* the target window is (`columns.ts:228-296`); they do not touch how much of that window's
> *newly-entering* portion must be built inside one synchronous `render()` call. Doubling them, on a
> fling that lands in unvisited territory, only doubles the size of the very batch that is already too
> large — it cannot help, and by the arithmetic below it can make a marginal case worse. This is the
> same class of failure `P22-webview-scroll-performance-iter2-rendering.md` F1-F4 diagnosed for pass
> 1's rAF deferral: a lever that changes a quantity the symptom does not depend on.
>
> **A real, independent, secondary contributor, found by reading `_handleScroll`:** when a single
> frame's scroll delta exceeds one full viewport height (`dy >= this.viewportH`,
> `dist/esm/index.js:10581`) — plausible at the high end of a hard fling — SlickGrid does **not** call
> `render()` in the same task. It calls `this.scrollThrottle.enqueue()`, a 10 ms-windowed throttle
> (`scrollRenderThrottling: 10`, `:7272`) that can defer the actual `render()` call to a `setTimeout`
> callback outside the scroll-driven task entirely (`actionThrottle`, `:9424-9438`). That is a second,
> independent latency source this investigation had not previously named. §3 F5.
>
> **A real, load-bearing instrumentation gap:** `window.__kiraScrollTrace`'s `renderMs` field is
> **always 0 for the SlickGrid engine today**, and `notified` is always `false` — `scrollTrace.
> noteNotify()` is never called anywhere in `SlickGridHost.vue` or `kiraSlickGrid.ts`, despite a
> comment in `SlickGridHost.vue:192-193` asserting that it is. §3 F6 fixes this before anything else,
> because the real-Mac verification protocol this document specifies is unusable without it.
>
> **The fix**, entirely inside `views/grid/slick/` and respecting `docs/ARCHITECTURE.md`'s "no Vue
> reactivity on row data" invariant and the existing `RowHandle`/frozen-page architecture: give
> `KiraSlickGrid.getRenderedRange` a **per-call** new-cell budget, separate from the existing
> **total-window** `CELL_BUDGET`. The strictly-visible range (`super.getVisibleRange()`) is always
> returned in full — nothing on screen this instant is ever deferred. The *extra* runway/lead beyond
> it is capped per call and, when the target window is larger than the cap allows, the shortfall is
> made up by self-scheduled `requestAnimationFrame`-chained `grid.render()` calls that converge on the
> full target over a handful of frames. This turns "synchronous cost proportional to how far the fling
> jumped" into "synchronous cost bounded by viewport size, converging over N frames" — which is the
> actual lever the runway experiment was missing. Paired with `forceSyncScrolling: true` (safe, and
> only safe, once per-call cost is capped) to remove §3 F5's up-to-10 ms throttle deferral.

---

## 0. What this pass is, and what it is not

### 0.1 Baseline

- Branch `claude/feature-v1-1-p5-onwards-2isfzt` at `cf266dd`, read 2026-09-02 — `P22-slickgrid-migration-plan.md`'s Pass A (`eb7c669`…`233cafd`) plus the wheel-handler fix
  (`e2a7f73`, `cf266dd`) already landed. `docs/PERF.md` §2.1c records the wheel-handler finding and
  that the A/B's real-Mac verdict is **still not run** — this document's own §7 protocol is what that
  verdict now needs, extended to also report the two new symptoms and the new instrumentation.
- Target files: `apps/kira-studio/frontend/src/views/grid/slick/kiraSlickGrid.ts` (158 lines),
  `views/grid/SlickGridHost.vue` (432), `views/grid/slick/dataSource.ts` (191),
  `views/shared/page/columns.ts`'s row-axis section (`:211-296`), `views/grid/page.ts` (42),
  `views/shared/page/store.ts` (199), `views/grid/scrollTrace.ts` (237).
- `slickgrid@5.20.0`, read from `node_modules/.bun/slickgrid@5.20.0/node_modules/slickgrid/dist/esm/
  index.js` (12 265 lines) in this session — every claim below about the library cites a line in that
  file, not a doc comment or a wiki page (`P22-slickgrid-migration-plan.md` §0.4's own rule, carried
  forward).
- **This is still Pass A.** `P22-slickgrid-migration-plan.md` §7.4(b)'s gate — PASS/INCONCLUSIVE/FAIL,
  authorising or declining Pass B — has not been run on real hardware yet (`docs/PERF.md` §2.1c: *"The
  result of this A/B is not yet known — it has never been run"*). The two symptoms this document
  addresses are found *inside* that still-open gate's own dry run, not after it. Nothing here starts
  Pass B, and nothing here is authorised by a Pass A that has not itself been certified.

### 0.2 Scope

1. Confirm or refute the task's decode-cost hypothesis against real SlickGrid/app source, and correct
   it where the source says something more precise (§1-§3).
2. Give each alternative explanation the task named — DOM churn, frozen-pane CSS sync, the
   `scrollThrottle.enqueue()` fallback, GC pauses — a real look, not a dismissal (§3, §4).
3. Design a fix that bounds a single `render()` call's synchronous cost independent of fling distance,
   inside the existing `RowHandle`/`GridDataSourceState` architecture, with no Vue reactivity on row
   data (§5).
4. Fix `__kiraScrollTrace`'s instrumentation gap for the SlickGrid engine, because the real-hardware
   protocol below is unusable without it (§5 D1, landed **before** the fix per this repo's own
   "instrument before fix" discipline — `P22-webview-scroll-performance-iter2-rendering.md` §0.5).
5. Write the real-Mac verification protocol, reusing `__kiraScrollTrace` and staying consistent with
   `docs/PERF.md` §2.1a/§2.1c (§7).

### 0.3 Not in this phase

- **Pass B.** Untouched, still gated on §7.4(b)'s own verdict, which still needs a real Mac.
- **The column axis.** `clampColumnOverscan`'s fixed `OVERSCAN_PX` margin (`kiraSlickGrid.ts:50-60`)
  is not velocity-scaled and was never widened by the null experiment; §3 F1's arithmetic is a row-axis
  story. Left alone, as the original plan's D3/D4 were row-axis-only too (F6 there).
- **The memory plateau.** `WEBVIEW-SCROLL-MEMORY.md`/its iter2 doc closed it; nothing here changes
  compositor tile behaviour.
- **Re-opening the wheel-handler fix.** `e2a7f73`/`cf266dd` stand; the user confirmed it.
- **Any Go-side work.** Frontend, `tests/ui/`, `tests/unit/`, `docs/` only.

### 0.4 Ground rules carried forward

- **The sandbox does not get to certify a fix.** Every claim below is labelled *provable here* (a
  property of this app's/SlickGrid's own JS, read from source) or *real-Mac only*. §7 keeps the two
  columns separate and §8's checklist does not accept a real-Mac item as satisfied by a sandbox number.
- **Runtime toggles, not rebuilds** — `window.__kiraGridTuning` grows the new per-call budget as an
  override, so the real-Mac A/B in §7 needs one build.
- **No existing budget is loosened.** `budgets.spec.ts`'s and `slick-grid.spec.ts`'s existing gates
  (mounted-cell count, decode-cache pinning, at-rest coverage, teardown) stay at their current
  thresholds; this phase only adds gates, it does not relax any.

---

## 1. What a single `render()` call does today, read from source

### 1.1 The call chain, start to finish

```
native `scroll` (viewport, .slick-viewport)
  -> SlickGrid's own listener -> handleScroll(e) (:10558-10560)
    -> _handleScroll('scroll') (:10575-10589)
      -> dy < viewportH && dx < viewportW ? render() : scrollThrottle.enqueue()   [F5, below]
        render() (:10407-10430):
          rendered = this.getRenderedRange()          <- KiraSlickGrid's own override
          this.cleanupRows(rendered)                   <- evicts rowsCache entries outside `rendered`
          this.renderRows(rendered) (:10364-10384):
            for each row in [rendered.top, rendered.bottom] NOT already in this.rowsCache:
              appendRowHtml(...) (:9905-9940):
                for each visible column:
                  appendCellHtml(...) (:9955-9980):
                    value = getDataItemValueForColumn(item, m)
                          = dataItemColumnValueExtractor(item, m)   <- dataSource.ts's extractValue
                    formatterResult = getFormatter(row, m)(row, cell, value, m, item, this)
                    Utils32.createDomElement('div', {...})          <- one DOM node per cell, always
                    applyHtmlCode(cellDiv, cellResult)               <- textContent, or 2+ child nodes
                    divRow.appendChild(cellDiv)
          this.trigger(this.onRendered, {...})          <- SlickGridHost.vue's onGridRendered
```

Everything from `_handleScroll` to `onRendered` firing is **one synchronous JS call**, on the main
thread, inside the native `scroll` event's own task. There is no `await`, no `setTimeout`, no
`requestIdleCallback` anywhere on this path (grepped `dist/esm/index.js`'s `renderRows`/
`appendRowHtml`/`appendCellHtml` bodies: none). Whatever this costs, it is paid before the browser can
composite the next frame.

### 1.2 What `extractValue` actually does on a decode-cache miss

`dataSource.ts:157-179`'s `createDisplayValueExtractor` returns a closure that, for an ordinary
(non-insert, non-staged) cell, calls `cell(tabId, item.row, pageCol)` — `page.ts:30-42`:

```ts
return store.cachedView(tabId, row, String(col), () => ({
  text: store.cached(tabId, row, String(col), (decoder) => cellText(chunk, row, decoder)),
  isNull: false,
  truncated: isTruncated(chunk, row),
}));
```

`store.ts:136-150`'s `cached` is a genuine memoizing cache — a `Map<row, Map<subKey, string>>` — with
no batching or deferral of any kind: on a miss it calls `decode(decoder)` synchronously, inline, and
stores the result before returning. `cellText` (`packages/shared/protocol/page.ts:235-237`) is
`decoder.decode(chunk.data.subarray(chunk.offsets[row], chunk.offsets[row + 1]))` — a real UTF-8
decode of the cell's raw bytes, plus (`store.ts:152-164`'s `cachedView`) one object allocation for the
built `CellView`, plus `isTruncated`'s binary search over `chunk.truncated` (`page.ts:248-250`, O(log
n), cheap). **Confirmed: decode is genuinely synchronous, genuinely memoized only after the first
access, with no existing batching, deferral, worker, or idle-time mechanism anywhere in this chain.**
Per-cell cost scales with the cell's own byte length (up to `MAX_CELL_BYTES = 64 KB` for a single
untruncated cell, `packages/shared/protocol/page.ts:175`, though a typical DB cell is far smaller);
`TextDecoder.decode` is not free even for a short string — it is a real decode call, not a no-op.

### 1.3 What happens regardless of decode-cache state — the term the hypothesis under-weighted

`renderRows` (`:10366-10367`) skips a row **only** if `this.rowsCache[i]` already holds it. There is
no finer-grained check — a row's *cells* are never individually reconciled against decode-cache
freshness; the row is either fully rebuilt (every visible cell, `appendCellHtml` for each) or not
touched at all. So for a row entering `rowsCache` for the first time:

- `Utils32.createDomElement('div', { className, role, dataset })` — one `document.createElement` plus
  three property/attribute writes, **per cell**, unconditionally (`:9964-9969`).
- `cellCss`/`addlCssClasses` string concatenation and `Utils32.classNameToList(...).join(' ')`
  (`:9956-9965`) — string splitting and rejoining, per cell.
- `cellDiv.setAttribute('aria-describedby', ...)`, and a `title` attribute write when a formatter
  result carries a tooltip (`:9969`).
- For the NULL/truncated formatter branches (`SlickGridHost.vue:88-109`) — **two DOM element
  creations plus a `DocumentFragment` plus two `appendChild` calls**, not one `textContent` write.
  These are strictly more expensive than the common (plain-string) case, and neither the task's
  decode-cost framing nor `P22-slickgrid-migration-plan.md` priced them separately.
- `divRow.appendChild(cellDiv)` for every cell, then the row div itself is appended to the canvas
  fragment (`:10378-10379`).

**This cost is paid identically whether or not `page.ts`'s decode cache is warm for that row**, because
the gate that decides "build this row or skip it" is `rowsCache` membership, not decode-cache
freshness. Since `rowsCache` (SlickGrid's own DOM cache) and `store.ts`'s decode cache are pruned to
essentially the same mounted window (both driven from `SlickGridHost.vue:222-233`'s `onGridRendered`,
which calls `setVisibleWindow` off the *same* `lastRenderedRowBounds` `KiraSlickGrid` computes for
itself), the two caches go cold together in the common case a fling produces — but even in the less
common case where a row is revisited with a warm decode cache and a cold `rowsCache` (e.g. the user
flung far away and back within the decode cache's window before it got pruned), the DOM-construction
cost above is still paid in full. **The decode step is real, but it is not the only unconditional cost,
and for a warm-decode-cache row it is not the dominant one.**

### 1.4 The scale that actually lands in one call

`CELL_BUDGET = 2200` (`columns.ts:238`) caps the **total mounted window**, not the size of a single
`render()` call's *new-row* batch. When a fling's scroll delta is large enough that the previous
`rowsCache` window (`lastRenderedRowBounds`, `kiraSlickGrid.ts:105`) has **no overlap at all** with the
newly-computed target range — which a hard fling landing in never-before-mounted territory produces
routinely, since nothing bounds how far a single native `scroll` delta can move `scrollTop` — the
*entire* target window, up to `CELL_BUDGET` cells, has no cache entry and must be built fresh in this
one call. On a table with, say, 10-15 mounted data columns, that is on the order of **150-220 rows,
each with several cell-level DOM operations plus a possible decode**, all synchronous, all in the task
the browser needs to finish before it can paint the next display refresh (8.3 ms at 120 Hz, 16.6 ms at
60 Hz). This is the batch the runway experiment could only ever make larger, never smaller — see §3 F3.

---

## 2. What this confirms and refines about the task's hypothesis

**Confirmed:**
- Decode is genuinely synchronous, genuinely main-thread, genuinely un-batched (§1.2).
- SlickGrid's own `render()`/`renderRows` skips a row already in `rowsCache` and never revisits it for
  a pure vertical scroll (`P22-slickgrid-migration-plan.md` F2, re-confirmed against 5.20.0's actual
  source at `:10358-10384`, not merely cited from the prior document).
- The cost is concentrated on newly-entering rows — genuinely O(rows entering × visible columns), not
  O(mounted window) — for the row-*build* decision. (`cleanUpAndRenderCells`, the one path that *does*
  revisit retained rows, fires only on a **horizontal** scroll-left change, `:10412-10418`, and is
  irrelevant to a vertical fling.)
- No existing async/deferred-decode mechanism exists anywhere in this pipeline (§1.2), and none of
  SlickGrid's own async options substitute for one (§3 F4).

**Refined:** the unconditional per-cell DOM-construction cost (§1.3) — not decode alone — is the term
that best explains why doubling the runway made no difference (§3 F3) and is, for a warm-decode-cache
row, the *only* remaining term. The fix in §5 addresses both terms together (it bounds the whole
newly-entering batch, decode and DOM construction alike), which is the correct scope: neither term
alone, capped in isolation, would explain the other's contribution to a still-oversized batch.

---

## 3. Alternative explanations — given a real look, not a dismissal

### F1 — DOM node creation/recycling cost for a large new-row batch. **Real, and folded into the fix — not a separate mechanism from §1.3.**

This is not actually an *alternative* to the decode-cost hypothesis; it is the same synchronous batch,
priced more completely (§1.3, §2). Recorded as its own line because the task asked for it by name: yes,
`Utils32.createDomElement` plus attribute/class-list writes are a real, non-trivial per-cell cost, paid
unconditionally for every entering cell, and §5's fix caps the batch that pays it — it does not need a
separate node-pooling or recycling mechanism, because SlickGrid already reuses a retained row's nodes
in place (never destroys and rebuilds a row still in `rowsCache`) and this document's own §1.3 finding
is that the *construction* cost, not a *churn* cost, is what needs bounding.

### F2 — CSS/layout thrashing from `frozenColumn: 0` pane sync. **Checked, and ruled out — cheap, no forced layout read in a loop.**

`_handleScroll` (`:10579`): `this.hasFrozenColumns() && (... this._viewportTopL.scrollTop =
this.scrollTop)` — a single property **write** (`scrollTop =`) on the frozen left viewport, once per
call, to keep the gutter pane in sync with the data pane's vertical position. This is a plain style
write, not a read-then-write pattern that would force a synchronous layout (no `.offsetTop`/
`.getBoundingClientRect()` read anywhere in this branch), and it happens once per `_handleScroll`
regardless of how many rows are being built. Not a source of the symptom; §5 item 5 of the migration
plan already flagged the frozen gutter as a *structural improvement* over the per-row `position:
sticky` box `P22-webview-scroll-performance-iter2-rendering.md` F12 worried about, and nothing here
reverses that.

### F3 — `scrollThrottle.enqueue()`'s single-viewport-height gate. **Real, independent, and worth fixing alongside the batch cap — not the primary mechanism, but not a false lead either.**

`_handleScroll:10581`: `dy < this.viewportH && dx < this.viewportW ? this.render() : this.
scrollThrottle.enqueue()`. `scrollRenderThrottling: 10` (`:7272`) is passed to `actionThrottle`
(`:9424-9438`), whose `enqueue()` either executes `render()` **immediately** (if not currently
"blocked" by a previous call within the last 10 ms) or marks the call **queued** and defers it to a
`window.setTimeout(unblock, 10)` callback — i.e. outside the scroll event's own task, on a macrotask
boundary, up to 10 ms later. At the high end of a hard fling — `MAX_PLAUSIBLE_ROW_VELOCITY_PX_PER_FRAME
= 800` px/frame (`SlickGridHost.vue:177`) against a typical grid viewport height in the 500-900 px
range — a single frame's delta exceeding `viewportH` is plausible, not a corner case. When it happens,
**the render is deferred rather than sped up**, which independently produces both symptoms: the
compositor keeps moving while the main thread waits out the throttle window (a gap), and the eventual
`render()` still runs the *same* unbounded batch from §1.4, now on a macrotask boundary that has no
relationship to the display's own frame cadence (a dropped-frame-shaped stall). This is not the
mechanism the task's hypothesis named, and it does not require decode or DOM cost to be large to bite —
but it compounds with them, because the deferred call is exactly as expensive as an immediate one
would have been. §5 D3 fixes it directly (`forceSyncScrolling: true`), contingent on D2's batch cap
making an immediate call safe.

### F4 — GC pauses from per-render allocation. **A real amplifier, not independently falsifiable in this sandbox, addressed indirectly by the fix.**

Each cold cell allocates: one `CellView` object (`page.ts:37-41`, unless the NULL sentinel), one DOM
element (plus, for NULL/truncated, two more and a `DocumentFragment`), and several short-lived strings
(`classNameToList`'s split array, the joined class string). A large batch — §1.4's 150-220 rows × 10-15
columns — produces on the order of a thousand-plus short-lived objects in one synchronous burst. This
is real garbage and a plausible amplifier of an already-over-budget frame (a minor GC pause landing
inside or immediately after the burst), but it cannot be measured or ruled in/out from this sandbox —
V8's GC pause timing is not something `tests/ui/`'s headless tier can observe reliably, and it was never
this document's job to isolate it as its own line item. It is not treated as a fix target on its own:
§5's batch cap reduces the allocation volume per synchronous burst by the same factor it reduces
DOM/decode cost by, so if GC pressure is contributing, the fix should show it (via `renderMs`) without
needing a dedicated GC-specific change.

### F5 — Summary: what actually explains the null result

Doubling `maxLeadPxOverride`/`leadFramesOverride` widens the **target** window (`rowRangeBounds`,
`columns.ts:258-296`) without touching how much of a newly-cold target must be built inside **one**
`render()` call. On a fling landing in unvisited territory, the entire enlarged target has no
`rowsCache` overlap either way — doubling the runway does not change "zero rows already cached" to
"some rows already cached," it only changes "how many need to be built from zero" from a large number
to a larger one. The lever the user pulled changes the *wrong* quantity for this symptom. §5's fix
changes the quantity the runway lever could not: how much of that batch is allowed inside a single
synchronous call.

---

## 4. Checked, and not adopted

- **`enableAsyncPostRenderCleanup`/`enableAsyncPostRender`.** Read from source
  (`:10900-10935`, `:10925-10935`, `:10958-10973`). `enableAsyncPostRender`'s `asyncPostRender`
  per-column callback (`m.asyncPostRender(node, row, ...)`, `:10963-10964`) runs **after** a cell's
  initial synchronous content is already built and appended — it exists to *enhance* an already-
  painted cell (e.g. load an image), not to defer the initial paint. `enableAsyncPostRenderCleanup`
  only defers *removal* of stale nodes (`:10988-10999`), which is cheap already (`removeChild`) and
  not where this symptom's cost lives. **Neither option can defer the initial formatter/DOM-build cost
  that `appendCellHtml` pays synchronously inside `renderRows`** — there is no built-in SlickGrid
  option that does what this document needs; §5's fix has to be built, not toggled on.
- **Materialising a "loading" placeholder row via `getItemMetadata`'s `formatter` override**, then
  swapping in real content on a later tick. Rejected: `getItemMetadata` is read once, when the row is
  *built* (`P22-slickgrid-migration-plan.md` F5's own finding) — showing a placeholder still means
  building a full row's worth of placeholder DOM synchronously now and a full row's worth of real DOM
  synchronously later, which is *more* total work, not less, and does not bound the synchronous batch
  at all; it only changes what's briefly wrong on screen from "blank" to "a placeholder," which is not
  a smaller symptom than the one being fixed.
- **Web Worker off-main-thread decode.** `TextDecoder` is available in a worker, but the DOM
  construction that §1.3/§2 identify as the term a warm decode cache cannot remove is not — cells still
  have to become real `HTMLElement`s on the main thread. A worker would only ever address the smaller
  of the two terms and adds a message-passing round trip per cold row; not worth it against §5's
  simpler fix, which addresses both terms by capping the batch itself.
- **A hand-rolled virtual DOM diff / node pool for cells.** `P22-webview-scroll-performance-iter2-
  rendering.md` §4 already declined this shape for the tanstack-virtual grid (`WEBVIEW-SCROLL-
  MEMORY.md` §5.6's real-hardware A/B found no difference from a hand-rolled virtualizer). SlickGrid
  already reuses a retained row's nodes; the problem here is the size of the *new*-row batch, not node
  churn on retained rows.

---

## 5. Decisions

### D1 — Fix `__kiraScrollTrace`'s instrumentation gap for the SlickGrid engine first. **Implement, and land before D2.**

`scrollTrace.ts:123-130`'s `noteNotify()` is Vue-specific — it measures `nextTick`'s flush duration,
which is meaningless for SlickGrid (there is no Vue patch on this render path at all; `render()`'s own
work is what needs timing, and it is fully synchronous). `SlickGridHost.vue:192-193`'s comment claims
`scrollTrace.noteNotify()` "is called separately, from inside `KiraSlickGrid.getRenderedRange`" — **it
is not called anywhere in either file** (grepped both; the only two call sites of `noteNotify` in the
whole tree are its own declaration and `DataGrid.vue:414`). Today, for the SlickGrid engine,
`ScrollTraceFrame.renderMs` is **always 0** and `.notified` is **always `false`** — the exact numbers
§7's protocol needs to prove the fix are silently unavailable, and the comment claiming otherwise would
mislead the next reader into trusting a zero.

Fix, in `scrollTrace.ts`:

```ts
/** For an engine whose render pass is fully synchronous (SlickGrid — no Vue flush involved), the
 *  caller already has the duration in hand; report it directly instead of nextTick's Vue-specific
 *  approximation, which noteNotify() stays as, unchanged, for DataGrid.vue's own callers. */
export function noteRenderMs(ms: number): void {
  if (!recording) return;
  pendingNotified = true;
  lastRenderMs = ms;
}
```

Wired from `KiraSlickGrid`'s own `render()` override (D2 introduces this override anyway, to do the
batch-capping and chase-scheduling — timing it there is one extra `performance.now()` pair, not a new
seam):

```ts
override render(): void {
  const start = performance.now();
  super.render();
  scrollTrace.noteRenderMs(performance.now() - start);
}
```

Also correct `SlickGridHost.vue:192-193`'s comment to say where the call actually lives (`kiraSlickGrid.
ts`, not `getRenderedRange` — it belongs on `render()` itself, since that is what does the work being
timed, and `getRenderedRange` is called *by* `render()` before the work it should be timing has
happened). **Land this alone, first** — `P22-webview-scroll-performance-iter2-rendering.md` §0.5's
"instrument before fix" discipline, restated: D2's own effectiveness is judged by `renderMs`, so the
instrument that reports it has to be trustworthy before D2 lands, not fixed alongside it where a bug in
one could be mistaken for a result from the other.

### D2 — A per-call new-cell budget in `KiraSlickGrid.getRenderedRange`, with self-scheduled catch-up. **Implement, behind a runtime toggle.**

New constant, `columns.ts`, beside `CELL_BUDGET`:

```ts
/** Provisional (same epistemic status as LEAD_FRAMES/MAX_LEAD_PX, columns.ts's own comment): the
 *  most new (not-yet-cached) cells a single synchronous render pass may build, independent of
 *  CELL_BUDGET (the TOTAL mounted-window cap). Sized to keep one render() call's synchronous work
 *  well under a single frame's budget even on a 120 Hz display; re-set once the real-Mac protocol
 *  (docs/PERF.md §2.1a/§2.1c) reports actual renderMs figures for a cold batch of this size. */
export const MAX_NEW_CELLS_PER_RENDER = 600;
```

`KiraSlickGrid.getRenderedRange` (`kiraSlickGrid.ts`), restructured:

1. `must = super.getVisibleRange(viewportTop, viewportLeft)` — the strictly-visible `{top, bottom}`,
   **always returned in full, never deferred.** This is the one non-negotiable floor: nothing currently
   on screen may go a frame without its DOM.
2. `target = rowRangeBounds(...)` — today's full computation (visible + velocity-scaled runway),
   unchanged.
3. `prev = this.lastRenderedRowBounds` — the previous call's returned range, already tracked
   (`kiraSlickGrid.ts:105`), and a reliable proxy for "what's currently in `rowsCache`" because
   `cleanupRows` keeps exactly the previously-returned range (`enableCellRowSpan` is off, so no
   mandatory-span rows complicate this, `P22-slickgrid-migration-plan.md` F2's own citation).
4. `mustNewRows` = rows in `[must.top, must.bottom]` outside `[prev.start, prev.end]` — the batch size
   the floor alone requires this call.
5. `budgetRows = floor((tuning.maxNewCellsPerRenderOverride ?? MAX_NEW_CELLS_PER_RENDER) /
   max(1, mountedColumnCount))`.
6. If `mustNewRows >= budgetRows`: return `must` only — even the non-negotiable floor is expensive on
   this table/window combination, and the correct response is to accept a viewport-bounded (not
   fling-distance-bounded) cost this call and defer *all* extra runway to the chase, not to blow the
   budget further trying to also add lead.
7. Otherwise: expand outward from `must` toward `target`, lead side first (today's existing direction
   bias, `rowRangeBounds`'s own asymmetry), until either `target` is reached or the remaining budget
   (`budgetRows - mustNewRows`) is exhausted.
8. If the returned range is narrower than `target` on either side, and no catch-up is already pending,
   schedule one: `if (!this.chasePending) { this.chasePending = true; requestAnimationFrame(() => {
   this.chasePending = false; this.render(); }); }`.
9. `this.lastRenderedRowBounds = { start, end }` (the range actually returned this call, unchanged
   from today's assignment point) — this is what step 3 reads on the *next* call, whether that call
   comes from the next real `scroll` event or from this call's own scheduled catch-up.

**Why this is correct, not merely fast.** The floor (`must`) is bounded by viewport size × mounted
column count — a fixed quantity, independent of how far a single scroll delta moved. The only thing
that ever scales with fling distance is how much *extra* runway is deferred, and deferred runway is, by
definition, not yet on screen — deferring it costs nothing the user can see **provided the chase
converges before the compositor's own tile margin (a few hundred px, `P22-webview-scroll-performance-
iter2-memory.md` F2/D3) is exhausted**, which a handful of animation frames comfortably does at any
plausible fling velocity. This is the same principle `WEBVIEW-SCROLL-MEMORY.md`/its iter2 doc already
established for WebKit's own compositor-side tile coverage — the visible area is guaranteed, the safety
margin catches up — applied one layer up, to this app's own DOM band instead of WebKit's tiles.

**Why the chase self-corrects rather than accumulating stale targets.** Every call — real-scroll-driven
or catch-up-driven — recomputes `must` and `target` fresh from the grid's *current* scroll position and
velocity. If the user's actual position moves again before a catch-up fires, the next call (whichever
triggers it) simply targets the new reality; there is no queue of stale ranges to reconcile, only "how
far is `prev` from `target`, right now."

**Toggle:** `window.__kiraGridTuning.maxNewCellsPerRenderOverride`, read fresh on every call (matching
`leadFramesOverride`/`maxLeadPxOverride`'s own contract, `runwayConfig()`), so §7's real-Mac A/B needs
one build.

**Re-entrancy note, carried from the existing file's own documented gotcha** (`kiraSlickGrid.ts:111-
117`): the base `SlickGrid` constructor calls `getRenderedRange` once before a subclass's own field
initialisers run. `chasePending`/`lastRenderedRowBounds` must tolerate being read as `undefined` on
that first call exactly as `velocity`/`mountedColumnCount` already do — default to "no catch-up
pending, empty previous range" rather than assuming the field exists.

### D3 — `forceSyncScrolling: true`, contingent on D2. **Implement, after D2, not before.**

`SlickGridHost.vue`'s grid options gain `forceSyncScrolling: true`. Per §3 F3, this removes the
`scrollThrottle.enqueue()` branch entirely — `_handleScroll` always calls `render()` immediately, in
the scroll event's own task, regardless of how large `dy`/`dx` are. **This is only a good idea once D2
has capped what that immediate `render()` call costs** — before D2, forcing synchronous scrolling on
every large-delta scroll would make things strictly worse (today's throttle at least caps *how often*
the expensive unbounded batch runs; removing it without D2 would run that same unbounded batch on every
single large-delta frame instead of at most once per 10 ms). Ordered as its own commit specifically so
it is bisectable independent of D2, and because D3 alone, without D2, is a plausible regression the
real-Mac protocol should be able to isolate if the ordering assumption above turns out wrong.

### D4 — Sandbox-provable evidence that the batch is actually capped. **Implement.**

`tests/ui/slick-grid.spec.ts` grows one more assertion, in the same style as its existing "sub-row
scroll -> zero mutations; cross-row scroll -> some" pair (`:381-410`): after a single very large
`scrollTop` jump (well past the whole runway, landing in never-before-mounted territory), the mounted
`.slick-cell` count measured on the *very next* animation frame is smaller than the count measured
after several more frames have elapsed — i.e. the window visibly **converges** over multiple frames
rather than **jumping** to its full size in one. This is the direct, sandbox-provable signature of D2's
chase mechanism actually engaging, and it is a property of this app's own JS/DOM (a cell count read at
two different rAF checkpoints), not a compositor-timing claim — it belongs in the "provable here" column
of §7, unlike the perceptual gap/drop symptom itself.

### D5 — Not adopted: relying on `enableAsyncPostRenderCleanup` or any other built-in async option. **Declined, with citation.**

§4's own finding. Recorded as a decision rather than folded silently into §4 because it is the specific
alternative the task asked to be checked, not assumed away: neither option defers the *initial* cell
paint, only cleanup (`enableAsyncPostRenderCleanup`) or post-paint enhancement
(`enableAsyncPostRender`), and D2 has to be hand-built as a result.

---

## 6. Implementation order

Frontend, `tests/ui/`, `tests/unit/`, `docs/`. Each commit ends on a green tree (`bun run typecheck &&
bun run lint && bun run build && bun test apps/kira-studio/tests/unit`, plus the full `tests/ui/` suite,
which must pass unmodified except where a commit is explicitly the one adding to `slick-grid.spec.ts`).

**C1 — `fix(grid): wire renderMs into __kiraScrollTrace for the SlickGrid engine`**
D1 alone. `scrollTrace.ts` gains `noteRenderMs`; `KiraSlickGrid` gains a `render()` override that times
`super.render()` and reports it; `SlickGridHost.vue`'s stale comment is corrected. No behaviour change
to rendering itself — this commit only makes the existing instrument tell the truth. Land first and
alone, so D2's own before/after `renderMs` comparison in §7 is trustworthy from the start.

**C2 — `perf(grid): cap a single render pass's new-cell batch, with self-scheduled catch-up`**
D2. `columns.ts` gains `MAX_NEW_CELLS_PER_RENDER`; `kiraSlickGrid.ts`'s `getRenderedRange` gets the
floor/budget/chase logic; `main.ts`'s `__kiraGridTuning` type gains `maxNewCellsPerRenderOverride`. The
largest commit in this pass.

**C3 — `perf(grid): force synchronous scrolling now that a render pass is bounded`**
D3. One grid option. Separate commit, per D3's own reasoning about bisectability.

**C4 — `test(ui): the render-batch converges over frames, not in one jump`**
D4. `slick-grid.spec.ts` grows the new assertion.

**C5 — `docs(perf): the fast-fling gap/drop fix, and how to A/B it on real hardware`**
§7's protocol, folded into `docs/PERF.md` §2.1c beside the existing SlickGrid A/B protocol (not a new
section — this is the same A/B, extended with the two new symptoms and the two new fields), plus a
one-line pointer from this plan document. `docs/v1.1/plans/P22-slickgrid-migration-plan.md` §7.4(b)'s
still-open gate is otherwise unaffected — this pass makes the *spike itself* fit to be judged by that
gate, it does not run the gate.

---

## 7. Verification

### 7.1 Provable in this sandbox

- **D1.** `renderMs` is non-zero after a scroll-driven `render()` call when `__kiraScrollTrace` is
  recording, for the SlickGrid engine specifically (a regression test the tanstack-engine path cannot
  accidentally satisfy, since it goes through `noteNotify()`, not `noteRenderMs()`).
- **D2's convergence property.** D4's own gate: a batch measured across multiple rAF checkpoints grows
  monotonically toward its target rather than appearing all at once.
- **D2's at-rest behaviour is unchanged.** At zero velocity, `mustNewRows` for an ordinary small window
  move is always far under any defensible `MAX_NEW_CELLS_PER_RENDER`, so `getRenderedRange` returns
  `target` directly with no chase scheduled — `slick-grid.spec.ts`'s existing at-rest coverage
  assertion (`:433-459`ish, "covers at least what the incumbent's does") must keep passing unmodified,
  which is the proof this pass changes nothing about the steady-state case.
- **D2's cell-budget interaction.** The existing velocity-ladder assertion (`:412-428`, mounted cells
  stay under 2 500) must keep passing — `CELL_BUDGET` is untouched; D2 only changes *how many frames*
  it takes to reach that ceiling, not the ceiling itself.
- `bun run typecheck`, `bun run lint`, `bun run build`, `bun test apps/kira-studio/tests/unit`.

### 7.2 What is not provable here

Whether the chase actually eliminates the *visible* gap and the *dropped frame* on a real WKWebView
under real momentum — like every other perf question in this phase's history, that needs a compositor
this Linux sandbox does not have. `renderMs` p95/max dropping in the trace is strong supporting
evidence but is, per this repo's own established discipline, not itself the claim being verified.

### 7.3 The real-Mac protocol

This extends `docs/PERF.md` §2.1c's existing SlickGrid A/B protocol — same setup, same gesture, same
`__kiraScrollTrace` — rather than replacing it, because the two symptoms in this document were found
*during* an attempt to run that exact protocol. Do not invent a new probe; the existing one only needed
D1's fix to be trustworthy for this engine.

**Setup.** `bun run dev`, a 50 000+-row table at page size 10 000, comfortable density, `window.
__kiraGridEngine = 'slick'` (reload the tab after setting it — `DataView.vue`'s switch is read once
per mount).

**Step 1 — baseline, before D2/D3.** On a build with only D1 landed: `__kiraScrollTrace.start()`, one
hard two-finger flick, let momentum die, `copy(JSON.stringify(__kiraScrollTrace.stop()))`. Report
`summary.renderMs` (p50/p95/max) and `summary.uncoveredPx` (p50/p95/max) — this is the first *real*
`renderMs` number this engine has ever produced (D1's whole point), and it is the number that either
confirms or refutes §1.4's "the batch is large enough to threaten a frame" arithmetic. Also note,
qualitatively: does the gap/drop happen on this build, matching the original report?

**Step 2 — with D2 (and D3) landed, same build, same gesture.** Repeat step 1's trace. Report the same
numbers, plus one sentence on whether the gap/drop was *perceptibly* different — the perceptual read is
what actually answers the report; the numbers keep it honest (`docs/PERF.md` §2.1a/§2.1c's own stated
discipline).

**Step 3 — the A/B on `MAX_NEW_CELLS_PER_RENDER` itself.** With D2 live: `window.__kiraGridTuning.
maxNewCellsPerRenderOverride = 150` (small — more chase frames, cheaper each), then `= 2200` (equal to
`CELL_BUDGET` — no capping at all, today's pre-fix behaviour in effect), same flick each time. If the
gap/drop tracks this dial — worse at 2200, better at 150 — that is the direct, decisive confirmation of
§1's mechanism on real hardware. If it does not move at all, §9's open question below is what to chase
next.

**Step 4 — isolate D3 from D2.** With D2 live and its budget at a reasonable default:
`window.__kiraGridTuning` has no toggle for `forceSyncScrolling` today (it is a grid-construction
option, not read live) — note whether the two symptoms differ between a build with D3 landed and one
without, as a build-level A/B rather than a console toggle, since §3 F3 is a real but secondary
contributor and this is the only way to isolate its share without adding a construction-time toggle for
a single-commit experiment.

**What to report back.** The three `summary` blocks (baseline, D2+D3, and the `maxNewCellsPerRenderOverride`
sweep), `docs/PERF.md` §2.1c's already-established `pxPerFrame`/`scrollEvents` context so the fling
being compared is the same shape each time, and one sentence per step on whether the gap/drop was
perceptible. Fold the result into `docs/PERF.md` §2.1c directly (C5) rather than a new section — it is
the same still-open A/B, not a new one.

---

## 8. Acceptance checklist

1. `__kiraScrollTrace.renderMs`/`.notified` are real (non-zero, non-`false` on a scroll-driven render)
   for the SlickGrid engine, and `SlickGridHost.vue`'s comment no longer misdescribes where the timing
   call lives.
2. `KiraSlickGrid.getRenderedRange` always returns the strictly-visible range in full; the *extra*
   runway is capped per call by `MAX_NEW_CELLS_PER_RENDER` (or its override) and made up by
   self-scheduled `render()` calls when the target exceeds the cap.
3. At rest (small window moves), the new logic is a no-op — `getRenderedRange` returns exactly what it
   returns today, and no catch-up is ever scheduled. `slick-grid.spec.ts`'s existing at-rest and
   velocity-ladder assertions pass **unmodified**.
4. `forceSyncScrolling: true` lands as its own commit, after the batch cap, with the ordering reasoning
   in its own commit message.
5. A new sandbox test proves the batch converges over multiple frames rather than jumping to full size
   in one, for a scroll well past the whole runway.
6. `window.__kiraGridTuning.maxNewCellsPerRenderOverride` works from the console and is read fresh on
   every call.
7. `docs/PERF.md` §2.1c carries this pass's protocol and, once run, its real numbers and verdict — the
   same still-open A/B, extended, not a new section.
8. **Nothing in this document claims the gap/drop symptom is fixed without a real-Mac trace saying so.**
   The claim this phase is allowed to make from the sandbox alone is: the mechanism is confirmed and
   refined from source, the batch a single render pass can be forced to build is now bounded
   independent of fling distance, and §7 is the experiment that says whether that was the right lever.

---

## 9. Open questions, handed forward

- **If step 3's dial moves nothing**, the batch-size hypothesis (however well-supported by source) is
  not the dominant term on real hardware, and the next candidates are exactly
  `P22-webview-scroll-performance-iter2-rendering.md` §9's own list for the tanstack grid, now asked of
  SlickGrid instead: main-thread rendering-update starvation during momentum (not an app-level problem
  at all), or the compositor's own tile margin (§1's "why deferred runway costs nothing visible"
  assumption) being smaller in practice than assumed for this scroller/density combination — testable
  directly in the Web Inspector's Timelines the same way that document's §7.3 step 7 already specifies.
- **`MAX_NEW_CELLS_PER_RENDER = 600` is provisional**, exactly like `LEAD_FRAMES`/`MAX_LEAD_PX` were
  and for the same reason: nobody has a real `renderMs`-per-cell figure from this engine yet (D1 is
  what produces the first one). Re-set it once §7.3 step 1's baseline trace reports real numbers.
- **The column axis was not touched.** If a very wide table (60+ columns) shows the same symptom on a
  fast *horizontal* fling, `clampColumnOverscan`'s fixed margin has no per-call cap either — this
  document did not investigate that axis and it would need its own pass if reported.
- **D3's interaction with `hasFrozenColumns()`'s scroll-sync write (§3 F2)** is priced as cheap and
  unconditional either way; if a real-Mac session ever shows otherwise, that would be a new finding,
  not a re-litigation of F2's own verdict here.
