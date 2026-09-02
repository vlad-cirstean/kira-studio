# P22 iter2 — the fast-scroll rendering lag, after pass 1 failed to move it

> **The user's report, unchanged after pass 1 shipped**: *"The current fix didn't improve anything
> visible. As I said if I scroll fast it takes quite a bit for the rows to appear on screen."*
> Real macOS, real trackpad, real inertial fling.
>
> **The verdict, in one line: pass 1 coalesced a burst that a browser never produces, proved it
> against an instrument that manufactured the burst itself, and therefore could not have changed
> anything the user sees.**
>
> **What actually happened.** `docs/v1.1/plans/P22-webview-scroll-performance.md` F1 asserts that
> *"a fling can fire many native `scroll` events within a single frame"* and that virtual-core's
> stock `observeElementOffset` therefore drives N full re-renders per frame. That premise is false
> in every modern engine, and **this repo's own `docs/PERF.md` already said so** —
> `PERF.md:98-102` records that a `scroll` event's dispatch is *"deferred by Chromium to the next
> 'update the rendering' frame step — the same per-frame cadence `requestAnimationFrame` uses"*.
> Scroll events are fired from the HTML spec's *run the scroll steps*, inside update-the-rendering,
> at most once per frame per scrolled element. The offset observer was already ≤ 1 notify per
> frame before pass 1 touched it.
>
> **And the instrument agreed, in writing, before it was overruled.** `f28b25a`'s own commit
> message: *"Confirmed empirically that a single scripted `el.scrollTop = x`, or even a tight loop
> of several such writes in one task, cannot reproduce that burst on this tier: WebKit coalesces
> any number of synchronous writes into exactly one native `scroll` event."* Rather than reading
> that as a refutation of F1, `measureScrollCoverage` manufactured the burst with eight synthetic
> `dispatchEvent(new Event('scroll'))` calls per simulated frame (`measure.ts:229`, `:258-261`).
> The "before" column of `PERF.md` §2.1a's table is therefore bounded above by
> `SUB_STEPS_PER_FRAME = 8` **by construction**, and the "after" column is what one `rAF` does to
> eight synchronous dispatches **by definition**. Neither number describes the application. This is
> exactly the failure `WEBVIEW-SCROLL-MEMORY.md` §2.1 rebuilt its instrument to escape — *a wrong
> instrument produces a confident, wrong conclusion* — reproduced one document later.
>
> **The other half of the same instrument failure.** `uncoveredPx === 0` (pre-fix *and* post-fix,
> every velocity) is not evidence that the overscan is sufficient. It is structurally
> unfalsifiable in that harness: Playwright drives `el.scrollTop` **on the main thread**, so the
> compositor can never be ahead of the main thread's knowledge of the scroll offset — which is the
> only condition that produces the symptom on a real, async-scrolled WKWebView — and coverage is
> read *after* `await nextFrame()`, i.e. after Vue's scheduler has already flushed. The original
> plan diagnosed this exact flaw in `budgets.spec.ts:604-646` (*"measured at rest"*) and then
> rebuilt it.
>
> **What this plan proposes instead.** Two fixes that attack the two quantities that actually
> govern the symptom on real hardware — **runway** (§5 D3: velocity-adaptive, direction-biased row
> overscan) and **throughput** (§5 D4/D5: a per-row component with reference-stable props, so a
> frame patches the rows that changed instead of all 43) — plus, first and above both of them, **an
> in-page instrument that a human can drive with a real trackpad fling** (§5 D2). That last one is
> the point. `WEBVIEW-SCROLL-MEMORY.md` §9 closes with real momentum scrolling untested because its
> `CGEventPost` injector never got a TCC grant — but that instrument lived *outside* the process.
> A rendering-latency instrument lives *inside the page*, the human supplies the momentum, and
> `internal/shell/menutemplate.go:85-89` already puts **Open DevTools** in the View menu of a dev
> build. Nobody in this repo's history has measured a real fling. This plan's first commit makes it
> possible, and §7.3 is the protocol.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

- Branch `claude/feature-v1-1-p5-onwards-2isfzt`, at `69090fe`, with P22 pass 1 (`f28b25a`,
  `f0662e7`, `1adcea7`, `b0d9936`, `57d2f1a`) and pass 2 landed.
- `apps/kira-studio/frontend/src/views/grid/DataGrid.vue` (2 246 lines),
  `views/shared/page/columns.ts`, `views/grid/page.ts`, `views/shared/page/store.ts`.
- `@tanstack/virtual-core@3.17.8`, `vue@3.5.42` — every claim below about library behaviour is read
  from `node_modules/` in this checkout and cited by file and line.
- `docs/WEBVIEW-SCROLL-MEMORY.md` — the *memory* investigation. Closed, real-hardware, not reopened
  here. Its **methodology** is the standard this plan is trying to meet; several of its *verdicts*
  are about `ri_phys_footprint` and are re-examined in §3 F12 because per-frame cost is a different
  question that was never asked.

### 0.2 Scope

1. Establish, with citations, why pass 1 could not have helped (§2).
2. Retire the instrument that certified it, and the assertion built on that instrument (§5 D7).
3. Build an instrument a human can drive with a **real inertial fling** on real hardware, and write
   the protocol for using it (§5 D2, §7.3).
4. Land the two best-evidenced fixes, separately attributable, each toggleable at runtime so the
   real-Mac A/B needs one build and not four (§5 D3, D4, D5).
5. Correct `docs/PERF.md` §2.1a, which currently records a refuted root cause as a resolved finding
   (§5 D8).

### 0.3 Not in this phase

- **Anything `WEBVIEW-SCROLL-MEMORY.md` §5 ruled out *for memory*, re-litigated as a memory
  question.** Still closed. §3 F12 re-opens exactly one of them (`position: sticky` on the per-row
  gutter) as a *frame-time* question, which is a different measurement the doc never took, and
  proposes no change until real hardware says something.
- **The memory plateau.** Unchanged; see that doc's §7 avenue 1, now closed by pass 2's `69090fe`.
- **De-virtualising or re-virtualising.** `WEBVIEW-SCROLL-MEMORY.md` §5.6 A/B'd it on real
  hardware. Closed.
- **`v-memo`.** Investigated and declined with a compiler citation — §3 F10. It is the obvious
  proposal and it is wrong for a *virtualised* list specifically, so it is recorded as a decline
  rather than omitted.
- **Any further use of `measureScrollCoverage` as it stands.** §5 D7 deletes it.

### 0.4 Ground rules

- **The sandbox does not get to certify a fix again.** Every claim below is labelled either
  *provable here* (a property of the app's own JS/DOM that does not depend on the compositor) or
  *real-Mac only*. §7 keeps the two columns separate and §8's checklist does not accept a real-Mac
  item as satisfied by a sandbox number.
- **Runtime toggles, not rebuilds.** `WEBVIEW-SCROLL-MEMORY.md` §5's preamble injected CSS
  overrides at runtime *"so no rebuild sits between baseline and variant"*. Same discipline: D3 and
  D4 are switchable from the console (`window.__kiraGridTuning`), so the user A/Bs one build.
- **Velocity, not distance** — carried over from the original plan §0.4, but with the correction
  that follows from §2: velocity must be *measured from a real fling*, not chosen. Nobody knows
  what px/frame a real macOS momentum scroll reaches in this app. §7.3 step 4 finds out, and it is
  the first number this phase should learn.
- **No existing budget is loosened.** `budgets.spec.ts` scroll response, both overscan-coverage
  invariants, the DOM-cell bounds (< 2 500 / < 1 500) and `perf.spec.ts`'s rAF p95 stay at their
  current thresholds. D3 in particular must fit inside the DOM-cell bounds — see D3(c).

### 0.5 One Sonnet pass, and it is ordered instrument-first

Unlike the original P22, there is no natural file split here — everything is
`frontend/src/views/**` plus `tests/ui/**` plus `docs/**`. The ordering constraint that matters is
different: **C1 (the trace hook) lands before C3/C4 (the fixes)**, so the user can capture a
*baseline* real-hardware trace against unchanged rendering behaviour and then re-capture against
each fix. Landing the fixes first would repeat pass 1's mistake in a new form — shipping a change
and then looking for an instrument that agrees with it.

---

## 1. What the scroll path does today, corrected

`§1` of the original plan is accurate as a description of the *code* and is not repeated. Three of
its statements need correcting or extending before anything else can be reasoned about.

### 1.1 Corrected: how often the stock offset observer actually fires

The original §1.2 quotes virtual-core's `observeOffset` correctly
(`virtual-core/dist/esm/index.js:84-116`) and then draws the wrong conclusion from it. The
observer *is* a plain synchronous `scroll` listener. But `scroll` is not an unthrottled event:

- HTML's *update the rendering* runs **run the scroll steps** — which dispatches the pending
  `scroll` events — once per rendering update, before **run the animation frame callbacks** in the
  same update. A scrolled element gets at most one `scroll` event per frame, whether the offset
  changed once or a hundred times in between.
- `docs/PERF.md:98-102` already records the observable consequence of this, for Chromium, as the
  reason its own scroll-response p95 is a frame-scheduling artifact.
- `f28b25a`'s commit message records it independently for WebKit: *"WebKit coalesces any number of
  synchronous writes into exactly one native `scroll` event."*

So the sequence in one frame is: scroll steps dispatch **one** `scroll` → the offset observer
notifies **once** → `maybeNotify` recomputes the range and, if an index moved, notifies Vue once →
Vue's scheduler flushes on the microtask checkpoint → the rAF phase of the *same* update runs →
style, layout, paint, commit. There is no burst, and there never was.

### 1.2 Corrected: what happens on the way *in*, on macOS

The original §1.1's table lists three listeners on `.data-grid` and is right about all three. What
it does not model — and what §7 of the original plan flags as unobservable here, correctly — is the
step *before* any of them, which is where the symptom lives:

1. The user flicks. AppKit hands the scroll gesture and its momentum phase to WebKit's **scrolling
   thread**, which moves the scroller's composited layer immediately, at display cadence,
   independent of the main thread.
2. The scrolling thread notifies the main thread of the new scroll position. The main thread's next
   rendering update dispatches `scroll`, runs §1.1's chain, lays out, paints and **commits** a new
   layer tree.
3. Between (1) and (2)'s commit, the compositor is showing content the main thread produced for an
   *older* scroll position. Whatever the newly exposed strip contains in that older content is what
   the user sees.

The mounted row band is that content. It extends exactly `OVERSCAN_PX = 560` px beyond the viewport
(`columns.ts:20`, `DataGrid.vue:375`). **The symptom "rows take a moment to appear" is, mechanically,
the compositor exposing area past the end of the mounted band before the main thread's commit
catches up.** Two things and only two things bound it: how much runway the band has in the
direction of travel, and how long the main thread's loop takes per iteration.

### 1.3 Extended: what a full-window rebuild actually costs, itemised

`renderRows` (`DataGrid.vue:1254-1323`) rebuilds every `RowVM` and every `CellVM` whenever any of
the four primitive index computeds moves. The original §1.3 counts the JS allocations. The larger
half is what Vue then does with them. For the memory doc's own fixture (43 rows × ~9 visible
columns = 387 cells):

| per notify | count |
|---|---|
| `CellVM` objects + their `classes` records | 387 + 387 |
| `RowVM` objects | 43 |
| vnodes created (row, gutter, cell, text, marker) | ~ 900 |
| inline-`style` object literals built by the template | ~ 430 |
| `normalizeClass` calls (object → string), one per cell | 387 |
| `patchStyle` property writes (`left`/`width`/`scrollMarginTop`/`color`) | ~ 1 550 |
| `data-*` / `class` prop comparisons | ~ 2 700 |

and, on the *mount* path only, `addEventListener` calls: five handlers per `.grid-cell`
(`@mousedown`, `@mouseenter`, `@click`, `@dblclick`, `@contextmenu` — `DataGrid.vue:1801-1805`)
plus four per `.gutter-cell` (`:1778-1781`) = **2 107 listener attachments for a full window
mount, ~49 for every row that enters it.**

All of that is paid on every frame in which any row index changes — which, during a scroll, is
every frame — even though at a realistic velocity only three or four rows are actually new.

### 1.4 Not corrected, and worth stating: Vue is *already* reusing the row elements

`v-for="rowVm in renderRows" :key="rowVm.row"` (`DataGrid.vue:1760-1761`). Row keys are page-row
indices, so a window sliding from `[100..142]` to `[104..146]` shares 39 keys, and Vue's
`patchKeyedChildren` longest-increasing-subsequence pass keeps all 39 elements in place and moves
none. Four unmount, four mount.

This matters because "the DOM node identity changes on every rebuild, forcing WebKit to redo layer
setup" is a plausible-sounding hypothesis and it is **false here**, by reading. What is *not*
skipped for those 39 retained rows is the prop patch in §1.3's table.

---

## 2. Why pass 1 did not help — the evidence

### F1 — The pre-fix `notifiesPerFrame` numbers are the instrument's own constant

`measure.ts:229` sets `SUB_STEPS_PER_FRAME = 8`. `:257-262`:

```ts
for (let s = 0; s < SUB_STEPS_PER_FRAME; s++) {
  const next = Math.min(maxScrollTop, el.scrollTop + pxPerFrame / SUB_STEPS_PER_FRAME);
  el.scrollTop = next;
  el.dispatchEvent(new Event('scroll'));
}
```

Eight untrusted `Event('scroll')` dispatches per simulated frame, straight into the observer's own
listener. `PERF.md` §2.1a's recorded pre-fix maxima are 3, 7, 8, 8 (`big_rows`) and 4, 5, 8, 8
(`scroll_grid`) — bounded above by 8, and below 8 only at the low velocities where a sub-step moves
`scrollTop` too little for `maybeNotify`'s `[isScrolling, startIndex, endIndex]` memo
(`virtual-core/index.js:350-368`) to see an index move. The ladder is a measurement of
`SUB_STEPS_PER_FRAME` and the row height. The post-fix column, 1 at every rung, is a measurement of
what `requestAnimationFrame` does to eight synchronous calls.

Neither column contains information about the application under a scroll.

### F2 — The burst being coalesced does not occur

§1.1, with three independent citations: the HTML rendering-update ordering; `docs/PERF.md:98-102`
for Chromium; `f28b25a`'s own commit message for WebKit. The original plan's F1 —
*"per native `scroll` event, both virtualizers recompute their range synchronously"* — is true, and
its unstated multiplier, "and there are many such events per frame", is not.

**This is the whole explanation of the null result.** A change that reduces N to 1 changes nothing
when N was already 1.

### F3 — Pass 1 is at best a no-op, and carries an unquantified latency risk in the wrong direction

`observeScrollElementOffset` (`columns.ts:170-208`) defers the notify into a `requestAnimationFrame`.
On the ordering in §1.1 — scroll steps precede the rAF phase of the *same* rendering update — that
callback runs in the same frame, so the range is computed at the same time it was before, from a
marginally fresher offset. Neutral.

It stops being neutral in any case where the `scroll` event is delivered to the main thread *after*
that update's rAF phase has already run, because the notify then slips to the following frame. On
macOS, the scroll position originates on the scrolling thread and reaches the main thread
asynchronously (§1.2), so this is not a hypothetical ordering. **Nobody has measured it**, here or
anywhere in this repo's history; §7.3 step 5 measures it directly, on real hardware, by counting
`scroll` events per rAF and recording their order.

Its certain costs are small but strictly additive on the hot path: per `scroll` event, per grid,
**two** `requestAnimationFrame` schedules and **two** `clearTimeout`/`setTimeout` pairs — one of
each per virtualizer, because both were wired (`DataGrid.vue:379`, `:397`), and the column
virtualizer's notify is a no-op during a vertical scroll anyway (`virtual-core/index.js:420-422`
early-returns when the offset is unchanged, but only *after* pass 1's rAF has already been
scheduled and run).

### F4 — `uncoveredPx === 0` was unfalsifiable, not reassuring

Two independent structural reasons, either of which is sufficient:

1. **The harness scrolls on the main thread.** `el.scrollTop = next` is a main-thread mutation, so
   the DOM's scroll offset and the main thread's knowledge of it are the same value by
   construction. The condition that produces the symptom on real hardware — the compositor showing
   a position the main thread has not rendered yet (§1.2) — cannot occur.
2. **Coverage is read after the render.** `measure.ts:263-266` records `uncoveredPx()` *after*
   `await nextFrame()`. The observer's rAF (scheduled first, during the sub-step loop) runs before
   `nextFrame`'s, Vue's scheduler flushes at the microtask checkpoint between them, and the
   measurement therefore lands on a settled DOM. This is the same "settle wait before the
   assertion" the original plan correctly identified as the flaw in `budgets.spec.ts:604-646` and
   §0.4 promised to avoid.

`uncoveredPx` in this harness can only ever be non-zero if a render misses by a whole frame. It is
not a measurement of the rendered band's runway, and the conclusion drawn from it in `PERF.md`
§2.1a — *"`OVERSCAN_PX`'s existing 560 px buffer absorbed the burst at every velocity tested here,
so P22 D2's conditional row-overscan raise was **not needed**"* — is not supported by it.

### F5 — Nothing in this repo has ever observed a real inertial scroll, from either side

`WEBVIEW-SCROLL-MEMORY.md` §9 for the memory half: the `CGEventCreateScrollWheelEvent` injector was
built and never worked (`CGEventPost` wants an Accessibility/TCC grant the harness did not have),
so its velocity ladder is a stepped proxy. Every scroll measurement in `tests/ui/` is a scripted
`el.scrollTop` assignment. A real macOS momentum scroll is a continuous acceleration/deceleration
curve delivered by the scrolling thread at display cadence, with a phase structure (`began` →
`changed` → `ended` → `momentumBegan` → `momentumChanged` → `momentumEnded`) that no stepped driver
reproduces — including the initial spike, which is where the user says the symptom is.

**Every velocity number quoted anywhere in this repo, including `WEBVIEW-SCROLL-MEMORY.md` §5.4's
"realistic band" of 40–100 px/frame, is an assumption, not an observation.** §7.3 makes it an
observation, and that number is a prerequisite for sizing D3.

---

## 3. Findings — where the lag can actually be

### F6 — Runway: 560 px, direction-blind, and it is the smallest number in the system

`columns.ts:20` — `OVERSCAN_PX = 560`. `DataGrid.vue:375` — `overscan: Math.ceil(560 / rowHeight)`,
i.e. 20 rows per side at 28 px, 26 at 22 px. The row axis uses virtual-core's
`defaultRangeExtractor` (`virtual-core/index.js:19-31`):

```js
const start = Math.max(range.startIndex - range.overscan, 0);
const end   = Math.min(range.endIndex + range.overscan, range.count - 1);
```

— **symmetric**. So at any instant, half the overscan DOM sits *behind* the direction of travel,
where it cannot help, and the runway ahead of a fling is 560 px and no more. That is 5.6 frames at
100 px/frame, and under 2 frames at 300 px/frame.

The pieces needed to fix this are all already in the codebase:

- virtual-core tracks direction itself — `this.scrollDirection = … prevOffset < offset ? "forward" :
  "backward"` (`index.js:429`);
- this app already owns a `rangeExtractor` seam and uses it on the column axis
  (`columnRangeExtractor`, `columns.ts:102-134`, a pixel budget with a per-side cap);
- since pass 1, this app also owns the offset observer (`columns.ts:170`), which is where a
  velocity estimate would be computed.

Nothing new has to be invented; the row axis simply never got the treatment the column axis got in
P29/P49.

### F7 — The precedent for a velocity-scaled window is WebKit's own

`WEBVIEW-SCROLL-MEMORY.md` §5.4/§7's central mechanism: *"WebKit's tile coverage rect expands with
scroll velocity, so velocity sets the steady-state tile working set."* The compositor already
widens its own prefetch window as a function of velocity. The app's rendered window does not, so at
speed the compositor is asking for painted content in an area where the DOM has nothing to paint.
D3 makes the app's window follow the same rule as the layer's.

This also frames the cost honestly: a velocity-scaled window costs compositing memory *exactly
while flinging*, and nothing at rest. Given `WEBVIEW-SCROLL-MEMORY.md` §7's finding that the
plateau is velocity-driven and self-releasing within ~2 s, this is the cheapest possible shape for
that trade — but it *is* a trade, and D3 must say so.

### F8 — Throughput: the per-frame cost is O(window), when it should be O(rows entered)

§1.3's table. Nothing memoises at row granularity across renders. The only cross-render memo is the
decoded cell text (`views/grid/page.ts:31-40`, `store.ts:136-165`), which `setVisibleWindow`
(`store.ts:166-178`) deliberately prunes to the mounted window.

The original plan declined to fix this (§4, *"F6's positive control says full-window replacement
fits in a frame in this sandbox"*), and that control is worth restating precisely because it is the
strongest remaining argument *against* D4: `perf.spec.ts:155-196` reports a rAF p95 of 37–39 ms in a
sandbox whose idle cadence is ~35 ms. But that measurement is a **teleport** — 20 steps of ~14 000 px
on a 10 000-row page, zero window overlap per step — so it measures the *mount* path (900 vnodes,
2 107 listeners) once per step from an idle DOM, not the sustained-scroll patch path, and it is
measured on a software-rendered headless WebKit whose absolute numbers `PERF.md` §2.1 itself
declines to trust. It is evidence that a full rebuild is not catastrophic. It is not evidence that
it fits inside a 8.3 ms frame on a 120 Hz ProMotion display while the compositor is running.

That constraint the original plan set for itself — *"doing both at once would make neither
attributable"* — is discharged: pass 1 landed alone and is proven insufficient, and D3/D4 are
individually toggleable at runtime (§0.4) so they stay attributable anyway.

### F9 — Vue reuses the row DOM nodes already; the cost is the patch, not the churn

§1.4. Recorded as a **negative** finding because "rows are being destroyed and recreated" is the
natural guess and it is refutable by reading one line (`DataGrid.vue:1761`). Any fix aimed at DOM
node identity — slot recycling, manual node pooling, an imperative patcher — is solving a problem
that Vue's keyed diff already solved. The remaining cost is that all 43 retained rows are still
*patched*, cell by cell, prop by prop.

### F10 — `v-memo` cannot skip those patches, and the reason is in the compiler. **Declined.**

`v-memo` is the Vue-native mechanism for exactly this ("skip updates for large sub-trees in a big
`v-for`"), it is present in this Vue (`runtime-core.esm-bundler.js:8770-8794`, `withMemo` /
`isMemoSame`), and it does not work for a *virtualised* list. `@vue/compiler-core@3.5.42`,
`compiler-core.cjs.js:5037-5047`, generates:

```js
if (_cached && _cached.el && _cached.key === <key> && _isMemoSame(_cached, _memo)) return _cached
```

where `_cached` is `_cache[<the v-for array index>]`. **The memo cache is indexed by array
position, and guarded by a key equality check.** In a sliding window every row's array position
shifts by the scroll delta every frame, so `_cached.key === key` fails for every row, every frame,
and the memo never hits. It would work only if the rendered array's slot order were made stable —
i.e. slot-modular recycling, `row ≡ slot (mod N)` — which reorders `.grid-row` in the DOM. That is
declined separately in §4.

Recorded in full because it is the first thing a reader will propose, and because "we tried
`v-memo` and it did nothing" is a result that would otherwise look like a mystery.

### F11 — The mechanism that *does* work is a child component with reference-stable props

`@vue/runtime-core@3.5.42`, `runtime-core.esm-bundler.js:4858-4903`, `shouldUpdateComponent`:

```js
if (optimized && patchFlag >= 0) {
  if (patchFlag & 1024) return true;          // DYNAMIC_SLOTS
  if (patchFlag & 16) { … }                    // FULL_PROPS
  else if (patchFlag & 8) {                    // PROPS
    const dynamicProps = nextVNode.dynamicProps;
    for (let i = 0; i < dynamicProps.length; i++) {
      const key = dynamicProps[i];
      if (hasPropValueChanged(nextProps, prevProps, key) && !isEmitListener(emits, key)) return true;
    }
  }
}
return false;
```

A component vnode carrying a single dynamic prop is skipped entirely — no render, no vnode
creation, no child patch — when that prop's **reference** is unchanged. Unlike `v-memo`'s cache,
this check is attached to the vnode pair, not to an array index, so it is **position-independent**
and survives a sliding window intact.

Three conditions, all of which are design constraints on D4 and each of which silently defeats the
bail-out if violated:

- **(a) exactly one dynamic prop**, the `RowVM`. Every extra prop is another reference to keep
  stable.
- **(b) `renderRows` must return the *same object* for an unchanged row.** Today it allocates a
  fresh `RowVM` and fresh `CellVM`s every time (`DataGrid.vue:1254-1323`). D4's real work is the
  per-row memo that makes the identity stable.
- **(c) no inline-arrow handlers and no slot content on the child.** An inline arrow is a new
  function every render, so it changes the prop set every frame; slot children take the
  `else` branch at `:4886-4901`, which returns `true` unless `$stable`. This is what makes D5
  (event delegation) a prerequisite rather than a nicety.

### F12 — CSS and compositing, re-examined for *frame time* rather than for footprint

`WEBVIEW-SCROLL-MEMORY.md` §5 measured these against `ri_phys_footprint`. Frame time is a different
question and none of them was ever asked it. Read fresh, from source:

- **`.grid-row { contain: layout }`** (`DataGrid.vue:2009`). Scopes a row's layout invalidation. It
  is a help, not a cost, for this question. Leave it. (Its *memory* rationale is already retracted —
  §5.1 of that doc.)
- **`.gutter-cell { position: sticky; left: 0 }`** (`DataGrid.vue:2020`), one per mounted row, plus
  `.header-row` and `.header-gutter` (`:1897`, `:1905`). On WebKit, each sticky box inside an
  async-scrolled overflow area needs a node in the **scrolling tree** so the scrolling thread can
  reposition it without the main thread; the set of those nodes changes on *every* scroll frame as
  rows mount and unmount, and each such change is a main-thread scrolling-tree commit. That is a
  per-frame cost in the exact place this plan cares about, and it is **not** what §5.2 measured
  (which was steady-state footprint, and found `absolute` 6 % *worse*). Flagged as the one CSS item
  worth a real-Mac A/B (§7.3 step 7), with the note that the replacement is not `position:
  absolute` — that breaks the gutter's horizontal pinning, which is the whole point of it — but
  hoisting the gutter out of the rows into a single sticky column layer. **No change proposed until
  hardware says something.**
- **`content-visibility: auto`** on `.grid-row`. **Declined.** It defers rendering of off-screen
  subtrees, i.e. it makes content appear *later*, which is the symptom.
- **`will-change` / `transform` compositing hints.** Declined, unchanged from the original plan §4:
  they would composite a ~280 000 px-tall sizer and push directly against the memory half.
- **Per-cell image/icon decode.** Not a factor: `CodiconIcon` renders only when `cellVm.navKind` is
  non-null (`DataGrid.vue:1830-1840`), i.e. on FK/PK columns only, and it is an inline glyph.
- **Font metrics / text measurement.** Not on the scroll path: `initialWidths` measures via a
  canvas context once per page and caches on a `WeakMap` keyed by the frozen page
  (`columns.ts:53-77`).

### F13 — Decode-on-entry is the one term that already scales correctly

`page.ts:31-40` decodes a cell on first sight and caches it; `store.ts:166-178` prunes to the
mounted window. Cost is O(rows entering) × visible columns, which is the right shape. It grows with
any overscan raise (D3) proportionally and by design. **Do not widen the retention window to soften
it** — that reverses P5 C1, which `WEBVIEW-SCROLL-MEMORY.md` §8 records as still holding on real
hardware.

### F14 — A real fling *is* measurable, from inside the page, today

The gap `WEBVIEW-SCROLL-MEMORY.md` §9 left open is not "real momentum scrolling is unmeasurable".
It is "an *external* harness cannot inject one without a TCC grant". For the rendering half the
instrument does not need to be external and the momentum does not need to be injected:

- `internal/shell/menutemplate.go:85-89` adds `application.Reload` and
  `application.OpenDevTools` to the View menu when `isDev` — so `bun run dev` (`wails3 task dev`)
  gives a **real WKWebView on real macOS with Safari Web Inspector attached**.
- This app already has a house convention for exactly this kind of hook: `window.__kira*`,
  declared in `main.ts:129-155` and documented as *"Playwright-only"* — `__kiraRetention`,
  `__kiraGridScrollWorkStart`, `__kiraRetainedBytes`. A scroll-trace hook is the same pattern.
- The human supplies the momentum with their own trackpad. That is the part no harness could do.

This is the single most valuable thing this phase can produce, and it is why §5 D2 lands first.

---

## 4. Checked, and not fired

- **Slot-modular row recycling** (`:key="pos % N"`, so array positions are stable and F10's `v-memo`
  would hit). Declined: it decouples DOM order from visual order, which is a latent hazard for
  hit-testing order, tab order and any future `:nth-child`/`:has` rule, and F9 shows the node churn
  it would eliminate is already eliminated by Vue's LIS diff. F11's route gets the same skip with no
  reordering.
- **A hand-written imperative DOM patcher for the row band.** Declined for the same reason plus
  P47's own history: `WEBVIEW-SCROLL-MEMORY.md` §5.6 already A/B'd a hand-rolled virtualizer
  against `@tanstack/vue-virtual` on real hardware and found no difference. The library is not the
  cost.
- **Vue Vapor mode.** Declined at P6 and unchanged.
- **Widening the decode-cache retention window** — F13.
- **`useScrollendEvent: true`.** Unchanged from the original plan §4: P47 D3's primitive computeds
  already mean the trailing `isScrolling: false` transition causes no re-render.
- **Making `observeScrollElementRect` velocity-aware too.** The column axis's symptom is not
  reported and its extractor is already pixel-budgeted and capped (`columns.ts:102-134`). Row axis
  only, as the original D2 also insisted.
- **Raising `OVERSCAN_PX` symmetrically and unconditionally.** Priced and rejected in D3(c): on
  `scroll_grid` (61 columns) the mounted window is already ~1 950 cells against
  `budgets.spec.ts`'s < 2 500 bound, so a flat doubling breaks a budget §0.4 forbids loosening.
  Direction-biased and velocity-gated is what fits.
- **Anything in `internal/shell/`.** Pass 2 closed that surface at `829ce59`/`69090fe`. This phase
  touches no Go.

---

## 5. Decisions

### D1 — Undo pass 1's rAF deferral; keep the seam it created. **Implement.**

`observeScrollElementOffset` (`columns.ts:170-208`) stays as a function and stays wired at all three
call sites — D3 and D2 both need to own this listener. What comes out is the deferral: call `cb`
**synchronously** on the `scroll` event, exactly as virtual-core's stock observer does
(`index.js:100-104`), and keep the `isScrollingResetDelay` debounce for the trailing
`isScrolling: false`.

What the seam is then used for:

- computing a per-frame velocity estimate (offset delta ÷ elapsed, in px/frame) that D3's range
  extractor reads;
- feeding D2's trace hook the raw `(timestamp, offset)` stream.

Rewrite the doc comment. The current one (`columns.ts:155-169`) asserts F1's refuted premise as
fact, and a future reader will cite it.

**Why undo rather than leave it.** It buys nothing (F2), it costs two rAF schedules and two timer
resets per scroll event per grid (F3), and it carries a real if unmeasured risk of costing a whole
frame in exactly the direction the user is complaining about (F3). Leaving a change in place
because it is probably harmless is how the next investigation inherits a false premise.

### D2 — A real-fling scroll trace, driven by a human on real hardware. **Implement, first.**

`window.__kiraScrollTrace`, declared in `main.ts` beside the existing `__kira*` hooks and wired from
`DataGrid.vue`. Shape:

```ts
__kiraScrollTrace.start()   // begins recording; arms a rAF loop
__kiraScrollTrace.stop()    // returns a JSON-serialisable record, stops the loop
```

Per rendering frame (one rAF), it records:

| field | why it is there |
|---|---|
| `t` | rAF timestamp — gives the real frame cadence (60 vs 120 Hz) |
| `scrollEvents` | **native `scroll` events observed since the previous rAF.** The direct, real-hardware test of F2. If this is ever > 1, F2 is wrong and this plan needs revisiting. |
| `scrollTopAtEvent[]` | the offset at each of those events, in order, with timestamps — and whether each arrived before or after this frame's rAF phase, which is F3's open question |
| `pxPerFrame` | measured velocity. **The number nobody in this repo has ever had.** |
| `notified` | whether the row virtualizer's `onChange` fired (reuse `__kiraGridScrollWorkStart`, `DataGrid.vue:338-340`) |
| `mountedTop` / `mountedBottom` | `min(offsetTop)` / `max(offsetTop + offsetHeight)` over `[data-testid="grid-row"]` |
| `liveScrollTop` / `clientHeight` | read at rAF time |
| `uncoveredPx` | `max(0, mountedTop − liveScrollTop) + max(0, liveScrollTop + clientHeight − mountedBottom)` — the same arithmetic `measure.ts:239-253` uses, against a **live** offset from a **real** scroll instead of a scripted one |
| `renderMs` | duration of Vue's flush for this frame (`performance.mark` from `markScrollWork`, `measure` in a `queuePostFlushCb`) |
| `rows` | mounted row count, for cross-checking the window against D3's tuning |

Plus a `summary`: p50/p95/max of `pxPerFrame`, `uncoveredPx`, `renderMs`; the `scrollEvents`
histogram; and the largest single-frame `pxPerFrame`.

**Two constraints on it.** It must be inert when `start()` has not been called — the rAF loop only
runs while recording, and the per-event capture is a single array push behind a boolean. And it
must be readable without DevTools too: `stop()` also writes the JSON to the clipboard via
`navigator.clipboard.writeText`, so it can be captured from a build where the inspector is not
attachable.

**This is not a `tests/ui/` instrument** and must not be gated in CI. It is a field probe. §7.3 is
its operating manual.

### D3 — Velocity-adaptive, direction-biased row overscan. **Implement, behind a runtime toggle.**

A `rowRangeExtractor` in `columns.ts`, beside `columnRangeExtractor`, passed as the row
virtualizer's `rangeExtractor` (replacing the `overscan:` option, which
`defaultRangeExtractor` applies symmetrically — F6):

```
leadPx  = clamp(BASE_LEAD_PX + velocityPxPerFrame * LEAD_FRAMES, BASE_LEAD_PX, MAX_LEAD_PX)
trailPx = BASE_TRAIL_PX
```

expanded into row counts against `rowHeight`, applied asymmetrically according to the sign of the
velocity, and clamped by a hard row cap.

**(a) At rest, velocity is 0, and the window must be *exactly* what it is today** — `BASE_LEAD_PX =
BASE_TRAIL_PX = OVERSCAN_PX = 560`. This keeps every existing at-rest assertion true by
construction: `budgets.spec.ts`'s two overscan-coverage invariants (`:625-698`), the DOM-cell
bounds, and the idle DOM size the memory half is priced against. A change that only ever fires
during a fling cannot regress an at-rest budget.

**(b) The constants are placeholders until §7.3 step 4 reports a real fling's peak velocity.** Land
them at a defensible first guess — `LEAD_FRAMES = 6`, `MAX_LEAD_PX = 2400` — and say in the
constant's doc comment that they are provisional and what measurement sets them. Sizing a buffer
against `WEBVIEW-SCROLL-MEMORY.md` §5.4's *assumed* 40–100 px/frame band would repeat pass 1's
error in a new place (F5).

**(c) The DOM budget is the hard cap, and it binds on wide tables.** `scroll_grid` (61 columns,
`MAX_OVERSCAN_COLUMNS = 12` per side) mounts ~30 columns; at 28 px rows and a ~700 px viewport
that is ~65 rows × 30 = ~1 950 cells against `budgets.spec.ts`'s < 2 500. So the row cap must be
expressed in **cells**, not rows: `maxRows = floor(CELL_BUDGET / mountedColumnCount)`, with
`CELL_BUDGET` set below the existing bound. On a two-column grid the lead can reach `MAX_LEAD_PX`;
on a 30-column one it cannot, and that is correct — the wide grid's per-frame render is already
proportionally more expensive.

**(d) State the trade in the constant's doc comment**, pointing at `WEBVIEW-SCROLL-MEMORY.md` §6:
more painted area is more compositing memory, *while flinging only*, and F7 is the argument that
this is the right shape for it.

**(e) Toggle:** `window.__kiraGridTuning.leadFramesOverride` / `.maxLeadPxOverride`, read
reactively so a console assignment takes effect on the next scroll. This is what makes §7.3 step 6
a one-build experiment. Default `undefined` = the compiled constants.

### D4 — A `GridRow` child component with a reference-stable `RowVM`. **Implement, behind a runtime toggle.**

Two halves, and both are required — either alone does nothing.

**(i) Extract `.grid-row`'s subtree** (`DataGrid.vue:1758-1848`) into
`views/grid/GridRow.vue`, with **one** prop, `rowVm: RowVM`, per F11(a). No slots, no inline-arrow
handlers, no additional reactive prop — the constants it needs (`GUTTER_WIDTH`, `rowHeight`) either
move into the `RowVM` or come from `provide`/`inject`, neither of which is a dynamic prop.

**(ii) Make `renderRows` incremental.** Keep a `Map<row, { vm, sig }>` across renders. For each row
in the window, compute a cheap signature of everything the row's `RowVM` depends on — `pos`,
`dirty`, `deleted`, `gutterNumber`, the visible-column identity list, `pageVersion.n`, the
selection generation, the search-match generation, the staged-edit generation, the editing cell,
`rowColoring` — and return the **cached `RowVM` object** when the signature is unchanged, rebuilding
only the rows whose signature moved. Rows that left the window are evicted from the map, so it
stays bounded by the window exactly as the decode cache is (`store.ts:166-178` is the pattern).

The correctness risk is entirely in the signature: **anything that can change a rendered cell and
is not in the signature will stop repainting.** So the signature must be derived from *generation
counters*, never from deep comparison — a `selectionVersion`/`searchVersion`/`stagedVersion` bumped
wherever those states are mutated — and the acceptance criterion is that the whole existing
`tests/ui/` suite passes untouched, because it is dense with exactly these interactions
(`data-view.spec.ts`, `mutations.spec.ts`, `interaction.spec.ts`, `row-coloring.spec.ts`).

**Expected effect.** At a realistic velocity, three or four of 43 rows change per frame. The other
39 hit `shouldUpdateComponent`'s `return false` (F11) and cost one reference comparison each instead
of nine cells' worth of vnode creation, `normalizeClass`, `patchStyle` and attribute diffing — §1.3's
table, reduced by ~90 %.

**Toggle:** `window.__kiraGridTuning.incrementalRows = false` restores the current behaviour by
skipping the memo (always returning a fresh `RowVM`), so the real-Mac A/B isolates D4 from D3.

**Proof it works, in this sandbox:** a render-count hook — `GridRow`'s `onUpdated` incremented into
a counter — asserted in `tests/ui/` to be ≤ (rows entered + rows left + a small constant) per
scroll step. That is a property of Vue's own reconciliation and is fully settleable here; it says
nothing about whether it is *enough*, which is §7.3's job.

### D5 — Event delegation on the scroll container. **Implement.**

Prerequisite for D4 (F11(c)) and a win on its own (§1.3: 2 107 `addEventListener` calls per full
window mount, ~49 per entering row). Move the five per-cell and four per-gutter handlers to one
listener per event type on `.data-grid`, resolving the target with
`(e.target as Element).closest('.grid-cell[data-row]')` — the pattern
`onCellNavClickFromEvent` (`DataGrid.vue:903-911`) and `extendFromPoint` (`:838-846`) already use.

Three details that will bite:

- **`mouseenter` does not bubble.** The delegated form is `mouseover` with a
  `relatedTarget`/`closest` guard so re-entering the same cell from a child does not re-fire.
- **`@contextmenu.prevent`** currently prevents unconditionally on the cell; delegated, it must
  prevent only when a cell actually matched, or a right-click on the sizer background loses its
  native menu.
- **`.stop` modifiers** on the nav button (`:1837`) and the header select zone (`:1742`) become
  explicit "is the event inside this sub-element?" checks in the delegated handler.

### D6 — `v-memo`, slot recycling, `content-visibility`, imperative patching. **Decline, with citations.**

F10 and §4. Recorded as decisions rather than omissions so the next reader does not spend a day on
`v-memo` and conclude the mystery is unsolvable.

### D7 — Retire `measureScrollCoverage` and the assertion built on it. **Implement.**

Delete the synthetic-dispatch instrument (`measure.ts:176-273`) and the `notifiesPerFrame ≤ 1` /
`uncoveredPx === 0` gates in `budgets.spec.ts:568-582` and its `scroll_grid` twin at `:716-724`. F1 and F4 are the
reasons; a gate that asserts a property of the harness rather than of the app is worse than no gate,
because it will block a future correct change (D1 reverts precisely the behaviour it asserts).

Replace it with an instrument that drives **real** `scroll` events — `page.mouse.wheel()` over
several frames, or `el.scrollTop` advanced once per rAF with no synthetic dispatch — and reports
`uncoveredPx` measured *at the moment of the write*, before the settle. That is a weaker instrument
than the one being deleted claimed to be and a stronger one than it was. It gates D4's render-count
property (D4's last paragraph) and logs coverage without gating it, with a comment saying plainly
why coverage cannot be gated on a main-thread-scrolled tier (F4).

### D8 — Rewrite `docs/PERF.md` §2.1a. **Implement.**

§2.1a currently reads as a solved problem with a measured root cause. It has to say what actually
happened: the premise (F2), the instrument (F1, F4), that the fix was a no-op and was reverted (D1),
what replaced it, and — the part that earns the section its place — that a passing sandbox scroll
number and a visible fling lag remain measurements of different things, now with the *reason* stated
in terms of main-thread vs. scrolling-thread scroll (§1.2) rather than only "different things".

Add a `docs/WEBVIEW-SCROLL-MEMORY.md` §9 cross-reference too: that document's "real momentum
scrolling is untested" gap is half-closed by D2 for the rendering side, and the reason its own
approach failed (external injection, TCC) does not apply to an in-page probe (F14).

---

## 6. Implementation order

Frontend, `tests/ui/` and docs. One pass. Each commit ends on a green tree.

**C1 — `test(ui): a real-fling scroll trace for the packaged app`**
D2. `main.ts`'s `__kira*` declaration block plus the `DataGrid.vue` wiring. No behaviour change to
the grid. Land it **first and alone**, so the user can capture a baseline trace against today's
rendering before any fix exists. The commit message carries §7.3's protocol in short form.

**C2 — `revert(grid): undo P22 pass 1's rAF-deferred scroll observation`**
D1 + D7's deletion of the gate that asserts the reverted behaviour. `columns.ts`'s
`observeScrollElementOffset` becomes a synchronous pass-through that also tracks velocity;
`measure.ts` loses `measureScrollCoverage`; `budgets.spec.ts` loses both gates. Commit message
states F1/F2/F3 with the citations. **This commit must not be squashed into C3 or C4** — the whole
point is that the record shows the revert and its reason.

**C3 — `perf(grid): delegate the grid's cell and gutter events to the scroller`**
D5. Behaviour-identical; the existing `tests/ui/` interaction specs are the regression guard, and
they are dense enough to be one (`interaction.spec.ts`, `data-view.spec.ts`, `mutations.spec.ts`).
Separate commit because it is the riskiest *behavioural* change here and must be bisectable on its
own.

**C4 — `perf(grid): render only the rows that changed`**
D4, both halves, plus the render-count assertion. The largest commit. If the signature work turns
out to want its own commit, split as `refactor(grid): extract GridRow` then
`perf(grid): memoise RowVM by row signature` — the extraction alone is behaviour-neutral and
verifiable.

**C5 — `perf(grid): a velocity-adaptive, direction-biased row window`**
D3. `columns.ts` grows `rowRangeExtractor` and its constants; `DataGrid.vue`'s row virtualizer
swaps `overscan:` for `rangeExtractor:`. Constants documented as provisional pending §7.3 step 4.

**C6 — `docs(perf): correct §2.1a, and record what a real fling measurement needs`**
D8, plus §7.3's protocol written out in full somewhere the user will find it — `docs/PERF.md` §2.1a
is the right home, since that is where the wrong version currently lives.

---

## 7. Verification

### 7.1 Provable in this sandbox

These are properties of the app's own JS and DOM and do not depend on a compositor:

- **D4's render count.** `GridRow` `onUpdated` fires for ≤ (rows entered + rows left + 1) per scroll
  step, and for **0** rows on a sub-row scroll that moves no index. Gated.
- **D3's at-rest window is byte-identical to today's.** `budgets.spec.ts`'s two overscan-coverage
  invariants (`:625-698`) and both DOM-cell bounds pass **unchanged and unloosened**. This is the
  assertion that makes D3 safe to land without hardware.
- **D3's cell cap holds.** At a synthetic high velocity, mounted cell count stays under
  `CELL_BUDGET` on `scroll_grid`.
- **D5 changes no behaviour.** The full `tests/ui/` suite, unmodified.
- **D1 restores stock notify timing.** The row virtualizer's `onChange` fires in the same task as
  the `scroll` event, not a frame later.
- `bun run typecheck`, `bun run lint`, `bun run build`, `bun test apps/kira-studio/tests/unit`.

### 7.2 Existing budgets that must not move

`budgets.spec.ts` scroll response (all three variants, p50 ≤ 12 ms / max ≤ 50 ms on this tier);
both overscan-coverage invariants; cell count < 2 500; `perf.spec.ts` cell count < 1 500 and rAF
p95 < 80 ms; `perf.spec.ts`'s retained-bytes check (P5 C1 — note that D3 raises retained rows
*during a fling only*, and the check is taken at rest, so it should be unaffected; if it is not,
that is a finding, not a threshold to raise).

### 7.3 The real-Mac protocol — what the user should actually do

**This is the part of the plan that matters most, because §2 is entirely about a fix that was
certified without it.** Everything here needs a Mac, a trackpad, and about twenty minutes.

**Setup.**

1. `bun run dev` (`wails3 task dev`) — a real WKWebView in a real window, with **View → Open
   DevTools** available (`internal/shell/menutemplate.go:85-89`; the item is `isDev`-gated, so a
   packaged build will not have it — use the dev build for anything needing the inspector, and note
   that Vue's dev build makes JS timings *pessimistic*, which is the safe direction).
2. Open a table with at least 50 000 rows and set the page size to 10 000, so the sizer is tall
   enough for a fling to matter. Comfortable density (28 px rows). Note the window size and the
   visible column count — every number below is conditional on both.
3. Web Inspector → Console.

**The gesture.** Not a drag. A **hard two-finger flick and release**, then hands off the trackpad
while momentum runs out. That is the gesture the report describes, and it is the only one that
exercises WebKit's momentum phase — a sustained drag keeps the main thread and the scrolling thread
in lockstep and will not reproduce the symptom.

**What to look for, precisely.** During the fling, does the leading edge of the viewport show
**empty background** that then fills in with rows a moment later? That is the symptom. Distinguish
it from two lookalikes, because they point somewhere else entirely:
- rows appear with correct borders and geometry but **no text** → decode, not rendering (F13);
- everything freezes and then **jumps** to the final position → a main-thread stall, not a runway
  problem.

**Step 4 — the number nobody has.** In the console:

```js
__kiraScrollTrace.start()
// … one hard flick, let momentum die …
copy(JSON.stringify(__kiraScrollTrace.stop()))
```

Report back `summary.pxPerFrame` (p50, p95, max) and the frame cadence implied by `t`. **This is the
first real measurement of a macOS momentum scroll's velocity in this app**, and it is what sizes
D3's constants (D3(b)). Everything in this repo that currently quotes 40–100 px/frame is quoting an
assumption (F5).

**Step 5 — test F2 on real hardware.** From the same trace, report the `scrollEvents` histogram. If
it is 1 for essentially every frame, F2 is confirmed and pass 1's revert is right. **If it is ever
> 1**, F2 is wrong on real WebKit, pass 1's premise was right after all, and this plan needs
revisiting before C5 lands. Also report whether any `scrollTopAtEvent` timestamp falls *after* its
frame's rAF — that is F3's open question, and it is the only way to know whether pass 1 was neutral
or actively costing a frame.

**Step 6 — the decisive A/B, one build, no rebuild.** With the trace running and the *same* flick:

```js
window.__kiraGridTuning.maxLeadPxOverride = 4000   // then flick, stop(), record
window.__kiraGridTuning.maxLeadPxOverride = 560    // back to today's runway; flick again
window.__kiraGridTuning.incrementalRows = false    // D4 off; flick again
```

Three traces, one build, one gesture. Then:

- if `uncoveredPx` collapses and **the lag visibly goes away** at 4000 and returns at 560, the
  runway is the constraint and D3 is the fix — and step 4's velocity says where to set the default;
- if 4000 changes nothing, the runway is **not** the constraint. Look at `renderMs`: if it is a
  large fraction of the frame period, D4 is the fix; if it is small, neither is, and the bottleneck
  is below JS — go to step 7.

**Step 7 — the Web Inspector timeline, when steps 4–6 do not settle it.** Record a Timelines capture
(Rendering Frames + JavaScript & Events + Layout & Rendering + Screenshots) of the same flick and
report the per-frame split: **Script / Style / Layout / Paint / Composite**. This is the one thing
no amount of in-page instrumentation can give and no Linux sandbox can approximate, and it
separates the three remaining stories cleanly — JS too slow (Script dominates → D4), layout/paint
too slow (→ F12's sticky-gutter A/B, which can be run right there by toggling
`position: sticky` → `static` on `.gutter-cell` in the inspector's Styles pane, matching
`WEBVIEW-SCROLL-MEMORY.md` §5's own runtime-override method), or neither (→ the compositor is
simply ahead, and only runway helps).

**Step 8 — conditions worth varying**, one at a time, same gesture: window small vs. full-screen
(the memory doc's own unmeasured area question, F14 of the original plan); compact vs. comfortable
density; row coloring off; a two-column table vs. a sixty-column one. Each isolates a different
term in §1.3's table.

**What to report back.** The three `summary` blocks from step 6, the `scrollEvents` histogram from
step 5, and one sentence per variant on whether the lag was *perceptibly* different. A perceptual
verdict is a real datum here — it is the only one that answers the original report — but it must
arrive *with* the numbers, not instead of them.

### 7.4 What must not regress

- P5 C1's retention fix (`__kiraRetention.decodeCacheRows` pinned to the mounted window). D3 raises
  the mounted window during a fling by design; the invariant is "pinned to the window", not "pinned
  to 43".
- P47 D3's primitive index computeds stay primitives.
- P49 F3/D4's `observeScrollElementRect`, unchanged.
- The 300 ms scroll-position persistence and its `onUnmounted` teardown
  (`DataGrid.vue:326-334`, `:354-362`).
- `ConsoleResultGrid.vue`'s column virtualizer, which shares `columns.ts` and inherits D1 for free
  and D3 not at all (D3 is row-axis only, and that grid has no row virtualizer).

---

## 8. Acceptance checklist

1. `window.__kiraScrollTrace` exists, is inert until `start()`, records `scrollEvents`,
   `pxPerFrame`, `uncoveredPx`, `renderMs` and `mountedTop`/`mountedBottom` per frame, and copies
   its result to the clipboard on `stop()`.
2. Pass 1's rAF deferral is reverted in a commit that says why, with the F1/F2/F3 citations.
3. `measureScrollCoverage` and both of its gates are gone, and the commit message explains that they
   asserted a property of the harness.
4. Cell and gutter events are delegated to `.data-grid`; the full `tests/ui/` suite passes
   unmodified, including `mouseenter`-dependent hover and range-drag scenarios.
5. `GridRow.vue` takes exactly one dynamic prop; `renderRows` returns a reference-stable `RowVM` for
   an unchanged row; a gated assertion proves `onUpdated` fires only for rows that entered or left.
6. `rowRangeExtractor` is direction-biased and velocity-scaled, is **exactly** today's symmetric
   560 px at zero velocity, and caps in *cells* so wide tables stay inside the DOM bound.
7. Every pre-existing budget passes at its pre-existing threshold. **No threshold was loosened**,
   and no at-rest coverage invariant was modified.
8. D3's and D4's runtime toggles work from the console and are documented in §7.3's protocol.
9. `docs/PERF.md` §2.1a is rewritten, not appended to, and no longer records a refuted root cause as
   resolved.
10. `docs/WEBVIEW-SCROLL-MEMORY.md` §9 notes that the rendering half's momentum gap is addressed by
    an in-page probe, and why that route was not available to an external harness.
11. **Nothing in this document claims the user's symptom is fixed.** The claim this phase is allowed
    to make is: the mechanism pass 1 named does not exist, two mechanisms that plausibly do have
    been addressed, and §7.3 is the experiment that says which — if either — was right.

---

## 9. Open questions, handed forward

- **If step 6 says neither D3 nor D4 moves the needle**, the remaining candidates in order are:
  (i) F12's per-row sticky gutter and the scrolling-tree commit it forces every frame — testable in
  the inspector without a rebuild; (ii) WebKit's main-thread rendering update being throttled or
  starved during a momentum scroll, which is not an app-level problem at all and would put this
  symptom in the same category as the memory plateau; (iii) the 280 000 px sizer's tile
  invalidation cost, which §5.5 of the memory doc ruled out for *width* but never for height.
- **If step 5 reports `scrollEvents > 1`**, F2 is wrong for real WKWebView, C2's revert should be
  reverted in turn, and the interesting question becomes why WebKit dispatches scroll outside the
  rendering update — which would be worth an upstream report as much as a local fix.
- **D3's constants are provisional by construction.** They must be re-set once step 4 reports a
  real fling's peak velocity, and the constant's doc comment must say so until they are.
- **The area question is still open** — `WEBVIEW-SCROLL-MEMORY.md` §7 avenue 3's premise that cost
  scales with viewport area remains unmeasured (recorded at `ed10f2e`), and §7.3 step 8 collects a
  cheap perceptual data point for it on the *rendering* side while the user is already flinging.
- **The general lesson, for whoever writes P23.** Both halves of P22 now have the same postmortem:
  an instrument that could not observe the phenomenon produced a confident conclusion.
  `WEBVIEW-SCROLL-MEMORY.md` §2.1 fixed that by rebuilding the instrument on real hardware before
  drawing any conclusion. Pass 1 skipped that step, and §0.5 of this plan orders the work so that it
  cannot be skipped again: **the instrument ships before the fix, and the fix is not certified in a
  sandbox that cannot see the symptom.**
