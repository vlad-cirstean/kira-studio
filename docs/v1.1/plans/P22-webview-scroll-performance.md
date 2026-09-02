# P22 — WebView scroll performance

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md`, P22 row): two problems in the data
> grid's fast-scroll behaviour — *"(1) **Rendering lag**: rows visibly take a moment to render/catch
> up when scrolling fast — a fresh problem with no prior investigation in this repo […] (2)
> **WKWebView memory churn during sustained scroll**: `docs/WEBVIEW-SCROLL-MEMORY.md` already
> investigated this rigorously […] This phase picks up its two named untried avenues instead of
> repeating that ground."*
>
> **The verdict, in one line: Half A has a real, measurable root cause and a real fix; Half B's two
> untried avenues are one decline and one change that is honestly not a memory fix.**
>
> **Half A.** The rendered window is driven by *three* scroll listeners on the same element, and the
> two that actually matter are not coalesced. `DataGrid.vue`'s own `@scroll` handler carefully
> coalesces into a `requestAnimationFrame` — *"a fling can fire many native `scroll` events within a
> single frame"*, its own comment says (`DataGrid.vue:321-325`) — but that handler drives only the
> 300 ms scroll-position persistence watcher. The **rendered row/column window** is driven by each
> `useVirtualizer`'s own `observeElementOffset` listener, which this app does **not** override (it
> overrides only `observeElementRect`, `columns.ts:142-153`), and which recomputes the range and
> notifies Vue **synchronously on every native `scroll` event**. Every notify rebuilds every
> `RowVM`/`CellVM` in the whole window from scratch (`DataGrid.vue:1251-1319`) — not just the rows
> that entered it. So during a fling the app does N full re-renders per frame and throws N−1 of them
> away before paint. That is the fix (§5 D1), and it is cheap.
>
> **Half A's instruments cannot currently see any of this, for the same reason
> `WEBVIEW-SCROLL-MEMORY.md`'s first pass could not see its own subject.** Both existing scroll
> measurements are *distance* instruments run *from idle*: `measureScrollResponses`
> (`measure.ts:116-174`) does one step, waits for the DOM to settle, then does the next — it never
> has two scroll deltas in flight; `perf.spec.ts:155-178` steps a 10 000-row page in 20 hops of
> ~14 000 px each, which is a teleport, not a scroll. Neither measures the quantity the user actually
> sees: **whether the mounted row band still covers the viewport while scrolling continues**. §5 D3
> builds that instrument, velocity-parameterised in px-per-frame, exactly the separation
> `WEBVIEW-SCROLL-MEMORY.md` §5.4 had to make.
>
> **Half B, avenue 2 (embedder-level `WKWebViewConfiguration`/`WKPreferences`) — declined, with
> citations.** Wails v3 beta.16's entire macOS webview surface is `MacWebviewPreferences`
> (`webview_window_options.go:762-786`): ten fields, byte-identical to beta.15, none of them a tiling
> knob. The `WKWebViewConfiguration` is `alloc`'d, populated and `autorelease`d **inside one cgo
> block** (`webview_window_darwin.go:138-195`) and never escapes it; there is no process-pool
> configuration, no `WKPreferences` private-selector path, and **no hook of any kind** between "config
> allocated" and "webview created" — the whole options file contains exactly one func-typed field
> (`KeyBindings`, line 225). The asymmetry is the finding: `WindowsOptions` carries
> `EnabledFeatures`/`DisabledFeatures`/`AdditionalBrowserArgs` for WebView2
> (`application_options.go:288-294`); `MacOptions` has **two** fields, activation policy and
> terminate-on-last-window-closed (`application_options.go:255-261`). The one escape hatch that does
> exist — `NativeWindow() unsafe.Pointer` (`webview_window.go:1660`), from which Wails' private ObjC
> `WebviewWindow` subclass's `webView` ivar (`webview_window_darwin.go:227`) is reachable by cast — is
> declined on two grounds, the second decisive: it depends on the layout of a class Wails does not
> export, *and there is nothing to set once you have it*.
>
> **Half B, avenue 3 (default window size) — changed, but not sold as a memory fix.** Two findings
> shrink this avenue considerably. First, **it is first-launch-only**: `Options()` already overrides
> `Width`/`Height`/`X`/`Y` from the window's stored rectangle whenever it has one
> (`internal/shell/window.go:45-52`), and `Attach()` persists bounds on every resize/move
> (`window.go:87-93`). Any user who has ever resized never sees the default again. Second, the
> Electron comparison is real but smaller than `WEBVIEW-SCROLL-MEMORY.md` §7's caveat reads:
> recovered from `18fe7bb^`, `src/main/window.ts` passed **no explicit width/height** and
> `minWidth: 900, minHeight: 600`, so Electron's first launch was 900×600 = 540 000 px² against
> Wails' 1280×800 = 1 024 000 px² — a first-launch-only **1.90×**, and a *floor* ratio of only 1.21×
> (1024×640 vs 900×600). Third, and most important to state plainly: **the doc measured no area
> ladder at all** — every figure in it was taken in one 1440×960 harness window, so "cost scales with
> viewport area" is asserted, not measured (§3 F14). The change lands anyway, as a screen-aware clamp
> that can only ever *shrink* the default on small displays, justified as UX on its own terms.
>
> **Two sequential Sonnet passes, and here they do not even share a file** — pass 1 is
> frontend + `tests/ui/`, pass 2 is Go + docs. See §0.5.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

- Branch `claude/feature-v1-1-p5-onwards-2isfzt`, with P1–P21 landed.
- `apps/kira-studio/frontend/src/views/grid/DataGrid.vue` (2 243 lines), row and column axes both
  virtualised with `@tanstack/vue-virtual` (P47), the shared pieces hoisted into
  `views/shared/page/columns.ts` (P49).
- `@tanstack/virtual-core@3.17.8`, read from `/root/.bun/install/cache/` for every claim below about
  library behaviour.
- `github.com/wailsapp/wails/v3 v3.0.0-beta.16` (`go.mod:29`), read from the module cache for every
  claim below about the shell's configuration surface. `beta.15` is also present and was diffed.
- `docs/WEBVIEW-SCROLL-MEMORY.md` — a closed, real-hardware investigation of the memory half. **This
  plan builds on it and does not re-open it.**

### 0.2 Scope

**Half A — rendering lag under fast scroll.**

1. A sustained-velocity scroll instrument in `tests/ui/support/measure.ts` measuring *rendered-band
   coverage* and *re-renders per frame*, neither of which any existing instrument reports.
2. Coalescing the virtualizer-driven re-render to one per animation frame (§5 D1).
3. Conditionally, and only if (1) says the buffer is what runs out: a larger **row-axis** overscan
   (§5 D2).

**Half B — memory churn, the two untried avenues.**

4. A recorded, cited decline of embedder-level `WKWebViewConfiguration`/`WKPreferences` tuning
   (§5 D5), with one bounded real-Mac check before the entry is closed.
5. A screen-aware default window size in `internal/shell/window.go` (§5 D6), landed as UX with its
   memory effect stated honestly and small.
6. Closing `WEBVIEW-SCROLL-MEMORY.md` §7's "remaining avenues" list with verdicts instead of leaving
   it open indefinitely (§5 D7).

### 0.3 Not in this phase

- **Anything `WEBVIEW-SCROLL-MEMORY.md` §5 already ruled out on real hardware.** Named individually in
  §5 D4 so a later reader does not have to reconstruct the list: `contain: layout` removal, the
  gutter's or header's sticky→absolute conversion, `top`/`left` vs `transform` positioning,
  `@tanstack/vue-virtual` vs a hand-rolled virtualizer, painted content width, and inner-scroller vs
  main-frame-scroller. Each is a conclusion someone will otherwise propose again; each is wrong for a
  reason the doc records.
- **Reducing the memory plateau in frontend code.** The doc's §6 puts the grid within ~11 % of the
  floor for any scroller that paints content at all. There is nothing to win there.
- **Changing `MinWidth`/`MinHeight`.** See §5 D6(b).
- **Re-running the Swift harness.** No macOS hardware in this sandbox. §7.3 lists what a later
  real-Mac session must run and how.
- **`ConsoleResultGrid.vue`'s own behaviour as a separate subject.** It shares `columns.ts`, so it
  inherits D1 for free; it is not separately measured here.

### 0.4 Ground rules

- **Velocity, not distance.** Every scroll measurement this phase adds is parameterised in **pixels
  per animation frame**, and every reported number carries its velocity. This is
  `WEBVIEW-SCROLL-MEMORY.md` §5.4's own correction, applied pre-emptively to the render half — an
  experiment that varies distance at a fixed step count is varying velocity and mislabelling it.
- **Measured at speed, not at rest.** Every existing coverage assertion in `budgets.spec.ts` is
  preceded by a settle wait. The new instrument asserts *during* a sustained pass. This is the render
  analogue of the doc's own "measuring at scroll position 0 shows nothing".
- **No existing budget is loosened.** `budgets.spec.ts`'s p50 ≤ 12 ms / max ≤ 50 ms and
  `perf.spec.ts`'s p95 < 80 ms / cell count < 1 500 are the regression guards for exactly the risk
  D1 carries. If a change cannot keep them, the change is wrong.
- **Evidence or a decline.** Every avenue in §5 gets either an implementation or a stated reason, in
  the discipline P6 used for Vue Vapor. "Not tried" is not a disposition.

### 0.5 This phase should be implemented in two sequential Sonnet passes, not one

- **Pass 1 = §6.1 (Half A).** `apps/kira-studio/frontend/src/**` and `apps/kira-studio/tests/ui/**`.
- **Pass 2 = §6.2 (Half B).** `apps/kira-studio/internal/shell/**` and `docs/**`.

The split is stronger here than P18's, which split for shippability. These two halves share **no
file, no language, and no test tier**: pass 1 is TypeScript/Vue verified by Playwright-WebKit, pass 2
is Go verified by `go test`. They also *stall* differently — pass 2's SPI check (§6.2 C6) is the one
step in this phase that cannot complete in this sandbox at all, and folding it into a single pass
would park the Half A fix behind a machine nobody in the session has. Each pass ends on a green tree
with its own acceptance checklist (§8).

Pass 2 is planned against whatever pass 1 landed, not against this document's description of it —
though in practice pass 1 touches nothing pass 2 reads.

---

## 1. What the scroll path does today, end to end

Read from `DataGrid.vue`, `views/shared/page/columns.ts`, `views/shared/page/store.ts`,
`views/grid/page.ts`, and `@tanstack/virtual-core@3.17.8`'s own sources.

### 1.1 Three scroll listeners on one element

`.data-grid` (the `overflow` scroll container) carries three independent `scroll` subscriptions:

| listener | registered by | what it drives |
|---|---|---|
| `@scroll="onScroll"` | `DataGrid.vue:1658` | `scrollTop`/`scrollLeft` refs → the 300 ms `patchDataTabState` persistence watcher (`DataGrid.vue:458-464`). **rAF-coalesced.** |
| `observeElementOffset` | `rowVirtualizer`, via virtual-core's default | the rendered **row** index window. **Not coalesced.** |
| `observeElementOffset` | `colVirtualizer`, via virtual-core's default | the rendered **column** index window. **Not coalesced.** |

Both virtualizers pass `observeElementRect: observeScrollElementRect` (`DataGrid.vue:377`, `:393`) —
this app *does* override one of virtual-core's two observers, for a documented reason (`columns.ts:136-141`,
P49 F3/D4: the default reports border-box size and does not subtract a visible scrollbar). It does
**not** override the offset observer, so that one is virtual-core's stock implementation.

### 1.2 What the stock offset observer does

`virtual-core@3.17.8`'s `observeOffset`, in full:

```js
const createHandler = (isScrolling) => () => {
  offset = readOffset(element);
  fallback?.();
  cb(offset, isScrolling);
};
element.addEventListener("scroll", createHandler(true), addEventListenerOptions);
```

`cb` runs `maybeNotify()`, which calls `calculateRange()` and — memoised on
`[isScrolling, range.startIndex, range.endIndex]` — calls `notify()` when any of the three moved.
`useScrollendEvent` defaults to `false`, so the `fallback` debounce (`isScrollingResetDelay`, 150 ms)
supplies the trailing `isScrolling === false` transition.

So: **per native `scroll` event, both virtualizers recompute their range synchronously, and if either
index moved, Vue is notified.** There is no frame coalescing anywhere on this path.

### 1.3 What one notify costs

`rowStart`/`rowEnd`/`colStart`/`colEnd` are deliberately **primitive** computeds
(`DataGrid.vue:402-413`) — P47 D3's guard, so the library's `isScrolling` transitions and
options-object recomputes do not by themselves re-render. Good, and it holds. But when an index
*does* move, `renderRows` (`DataGrid.vue:1251-1319`) rebuilds **the entire window**:

- every `RowVM` and every `CellVM`, for all mounted rows — not only the rows that entered;
- per cell: `displayCell` → `stagedValue` + `cellAt` → `cell()`; `cellNavEntry`; `isSelected`;
  four `isSelectedNeighbor` calls for the selection-perimeter edges; `isSearchMatch` and
  `isCurrentSearchMatch`; `alignFor`; `cellClass`;
- two object allocations per cell (the `CellVM` and its `classes` record).

At `rowHeight = 28` and `OVERSCAN_PX = 560` the mounted window is *visible + 20 rows above + 20
below*; on the memory doc's own fixture that is 387 cells (§2 of that doc), i.e. ~387 `CellVM`s and
~800 object allocations rebuilt per notify, plus Vue's patch over the same 387 elements.

### 1.4 The decode cache, and what pruning it costs on the scroll path

`page.ts:30-42`'s `cell()` is memoised twice — a `cachedView` for the `CellView` object and a
`cached` for the decoded string. `store.ts:166-178`'s `setVisibleWindow` **deletes every cached row
outside `[start, end)`**, and `DataGrid.vue:443` calls it from a watcher on the mounted window's page-row
bounds. That is P5 C1's retention fix, and `WEBVIEW-SCROLL-MEMORY.md` §3 confirms it working
(`decodeCacheRows` pinned at 43 across four full scroll passes).

Its cost, stated: every row *entering* the window is a genuine `TextDecoder` decode of each visible
column, and reversing scroll direction re-decodes rows that were decoded one frame earlier. This is
the one component of the per-frame cost that grows with velocity rather than staying flat.

### 1.5 The row-data reactivity invariant

`docs/ARCHITECTURE.md:66-67` — *"No Vue reactivity on row data. Rows live in plain frozen typed
structures; the grid reads them imperatively and re-renders on an explicit version counter."*
Structurally intact: `store.ts:98` freezes each page, `store.ts:86`'s `pageVersion` is a
`reactive({ n: 0 })` counter, and both decode caches are plain `Map`s. `renderRows`' reactive
dependencies during a scroll are the four primitive index computeds and nothing else that moves.

---

## 2. Findings — Half A, the rendering lag

### F1 — Only the listener that does not drive rendering is coalesced

`DataGrid.vue:321-333`, verbatim:

```ts
// P47 D10: the app's own scroll-work perf mark moved into markScrollWork, called from each
// virtualizer's onChange — this rAF now only feeds the 300ms scroll-position persistence watcher
// below. A fling can fire many native `scroll` events within a single frame; coalescing
// syncScrollState to one call per animation frame keeps that watcher in step with what actually
// painted instead of firing on every event.
let scrollRaf = 0;
function onScroll(): void {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; syncScrollState(); });
}
```

The comment states the premise exactly right — *"a fling can fire many native `scroll` events within
a single frame"* — and applies the remedy to the cheap path (two ref writes feeding a 300 ms
debounce). The expensive path, §1.2's two uncoalesced virtualizer listeners driving §1.3's
full-window rebuild, is left uncoalesced.

**Consequence.** N `scroll` events inside one frame produce up to N `calculateRange()` pairs, N
`renderRows` rebuilds and N Vue patches, of which N−1 are overwritten before the frame paints. The
work is not merely redundant: it is redundant *precisely when the app is most behind*, because
scroll-event burstiness rises with velocity.

This is the single most likely cause of a symptom that appears only at speed, and it is the cheapest
thing in this plan to fix.

### F2 — A notify rebuilds the whole window, not the delta

§1.3. Nothing memoises at `RowVM` granularity across renders; the only cross-render memo is the
decoded cell text, which §1.4's pruning is deliberately aggressive about discarding. So the
per-notify cost is flat in the *window* size, not in the *scroll delta* — which means F1's redundant
notifies each cost full price, not marginal price.

Stated as a non-finding too, because it matters for what *not* to do: this is not evidence that
`renderRows` is too slow. F6's positive control suggests it is not. Fixing F1 makes the existing cost
be paid once per frame instead of N times; rewriting `renderRows` to be incremental is a much larger
change with a much worse risk profile and is **not** proposed here.

### F3 — Decode is on the scroll path, bounded, and velocity-scaled

§1.4. At 100 px/frame (the top of `WEBVIEW-SCROLL-MEMORY.md` §5.4's realistic band) and 28 px rows,
~3.6 rows enter the window per frame; at the doc's ~9 visible columns that is ~32 `TextDecoder`
calls per frame. Small in absolute terms. Recorded because it is real, it is the only velocity-scaled
term in the per-frame cost, and it must not be "fixed" by widening the retention window — that
directly undoes P5 C1, which `WEBVIEW-SCROLL-MEMORY.md` §8 records as still holding.

### F4 — The reactivity invariant is not what is falling through

§1.5. `ARCHITECTURE.md:66-67`'s invariant holds structurally, and P47 D3's primitive-computed guard
(`DataGrid.vue:398-401`) already stops the library's `isScrolling` transitions from re-rendering.
The symptom is not the invariant leaking under load. It is that the invariant's own re-render runs
**more often than once per frame** (F1) and does **full-window work each time** (F2).

Recorded explicitly because "the reactivity invariant must be leaking" is the natural first guess for
a Vue app that renders late under load, and it is wrong here.

### F5 — The overscan is 560 px, is provably rendered — **at rest** — and buys 3–14 frames

`columns.ts:20` sets `OVERSCAN_PX = 560`; `DataGrid.vue:375` converts it to virtual-core's item unit
as `Math.ceil(560 / rowHeight)` = **20 rows per side** at the comfortable 28 px density, 26 at
compact 22 px. virtual-core's `defaultRangeExtractor` applies it symmetrically.

`budgets.spec.ts:604-646` asserts the row-axis coverage invariant at 11 scroll positions, and it
passes. But every iteration reads:

```ts
await scrollGrid.evaluate((el, t) => { el.scrollTop = t; }, target);
await page.waitForTimeout(50);
```

— i.e. **measured at rest**. Nothing in the suite asserts coverage while scrolling continues, which
is the only state in which the reported symptom exists.

The budget that buffer represents: 560 px is 5.6–14 frames of main-thread latency at the doc's
realistic 40–100 px/frame band, and roughly 2–3 frames at fling peaks. That is how long the app has to
land a re-render before the user sees unpainted sizer. It is generous at cruising speed and thin at
the top end — which matches a symptom that only shows up when the user *scrolls fast enough*.

### F6 — Neither existing instrument can reproduce the symptom, and both fail the same way

**`measureScrollResponses`** (`tests/ui/support/measure.ts:116-174`) — its inner loop:

```ts
for (let i = 1; i <= steps; i++) {
  const { work, e2e } = await step(Math.round((total * i) / steps));
  ...
}
```

Each `step` assigns the property, waits for the first `MutationObserver` callback, and resolves. **It
never has two scroll deltas in flight.** It measures isolated step latency *from idle*: a distance
instrument, at effectively zero sustained velocity. This is structurally the same confound
`WEBVIEW-SCROLL-MEMORY.md` §5.4 had to unpick — "an experiment that varies distance at a fixed step
count is varying velocity" — arrived at from the other direction.

The instrument itself is good and its work-vs-e2e split (commit `61ba523`) is the right idea; it is
just answering a different question, and its answer is a passing one (`docs/PERF.md` §2.1: work
p50 = 2.2 ms on macOS, 12 ms gate on this tier). A passing scroll-response budget and a visible lag
under fling are **not in contradiction** — they are measurements of different things.

**`perf.spec.ts:155-178`** — 20 steps of `total/20` on a 10 000-row page is ~14 000 px per step. That
is not a fast scroll, it is a teleport: every step replaces the window with zero overlap, so no amount
of overscan is relevant and no coverage question is posed. Its own comment says what it is for —
*"it catches 'someone made the grid re-render every row per frame', it does not certify the real
budget"*.

**The gap, precisely.** No instrument reports the quantity the user perceives: *the mounted row band's
coverage of the viewport, during sustained scrolling, as a function of velocity.* §5 D3 builds it.

**A useful positive control falls out of `perf.spec.ts` anyway.** Its p95 is 37–39 ms in a sandbox
whose *idle* frame cadence is ~35 ms (`perf.spec.ts:189-196`, confirmed non-flaky across three runs).
Full-window replacement therefore fits roughly inside one of this environment's frames. That points
away from "`renderRows` is inherently too slow" (F2) and toward F1's redundant renders and F5's
coverage budget.

### F7 — What this sandbox can settle, and what it cannot

**Can settle**, because they are properties of the app's own JS and DOM:

- mounted-band coverage of the viewport under sustained, velocity-parameterised scroll;
- notifies (and therefore full re-renders) per animation frame, and the reduction D1 produces;
- per-notify work cost.

All three are parameterised in **px per frame**, which makes them independent of this sandbox's
~35 ms cadence: the app gets exactly one main-thread render opportunity per frame either way. A
px/second parameterisation would *not* transfer, which is precisely why it is not used.

**Cannot settle**: WebKit-on-macOS **threaded/async scrolling**. On a packaged build the compositor
scrolls the layer on the scrolling thread and delivers `scroll` to the main thread behind it; how far
ahead it gets under real trackpad momentum, and therefore how much of F5's 560 px budget momentum
actually consumes, is not observable here. Playwright drives `el.scrollTop` from script, which is a
main-thread scroll. `WEBVIEW-SCROLL-MEMORY.md` §9 records the same gap from the memory side — its
`CGEventPost` momentum injector never got the TCC grant, so *no* measurement in this repo has ever
touched WebKit's real momentum path.

**Therefore, and stated plainly:** Half A's fix can be implemented and verified *as a fix to the
mechanism identified* in this sandbox — fewer re-renders per frame, coverage held under sustained
scroll — but **whether it removes the lag the user sees requires confirmation on a real Mac against a
packaged build**. That is the same discipline this chapter applies to every Mac-only concern, and
§7.3 scopes it. It does **not** require a Swift harness: unlike the memory question, which needed
`proc_pid_rusage` on the WebContent pid, this one is a human scrolling a packaged build and saying
whether rows still appear late.

---

## 3. Findings — Half B, the two untried avenues

### F8 — Wails v3's entire macOS webview surface is ten fields, none of them a tiling knob

`webview_window_options.go:762-786`:

```go
type MacWebviewPreferences struct {
	TabFocusesLinks                       optional.Bool
	TextInteractionEnabled                optional.Bool
	FullscreenEnabled                     optional.Bool
	AllowsBackForwardNavigationGestures   optional.Bool
	AllowsMagnification                   optional.Bool
	AllowsAirPlayForMediaPlayback         optional.Bool
	JavaScriptCanOpenWindowsAutomatically optional.Bool
	MinimumFontSize                       optional.Var[float64]
	ApplicationNameForUserAgent           string
	EnableAutoplayWithoutUserAction       optional.Bool
}
```

Diffed against `v3.0.0-beta.15`: **byte-identical**. This app already uses one of them
(`internal/shell/security.go:24-26`, `JavaScriptCanOpenWindowsAutomatically: Disabled`), which is why
the struct is already threaded through `Options()` — so if there were a usable field, the wiring to
carry it is already in place. There is not one.

### F9 — The `WKWebViewConfiguration` never escapes its cgo block, and there is no hook

`webview_window_darwin.go:138-195`, the complete construction:

```objc
WKWebViewConfiguration* config = [[WKWebViewConfiguration alloc] init];
[config autorelease];
// ... the ten fields above mapped onto config.preferences.* / config.* ...
config.suppressesIncrementalRendering = true;
config.applicationNameForUserAgent = ...;
[config setURLSchemeHandler:delegate forURLScheme:@"wails"];
config.userContentController = userContentController;
WKWebView* webView = [[WKWebView alloc] initWithFrame:frame configuration:config];
```

What is *not* there: any `WKProcessPool` or `_WKProcessPoolConfiguration`; any `setValue:forKey:`
private-selector path on `WKPreferences` (the two `setValue:forKey:` uses in this file are
`drawsBackground` and `backgroundColor`, lines 530/537); any callback, delegate or option allowing an
embedder to see the configuration before the webview is created. The whole of
`webview_window_options.go` contains exactly **one** func-typed field, `KeyBindings` (line 225).

### F10 — macOS is the one platform Wails v3 gives no engine-level escape hatch

`application_options.go:266-294`, `WindowsOptions`:

```go
// EnabledFeatures, DisabledFeatures and AdditionalBrowserArgs configure the WebView2 browser.
// These apply globally to ALL windows because WebView2 shares a single browser environment.
EnabledFeatures       []string
DisabledFeatures      []string
AdditionalBrowserArgs []string
```

`application_options.go:255-261`, `MacOptions`, in full:

```go
type MacOptions struct {
	ActivationPolicy                                ActivationPolicy
	ApplicationShouldTerminateAfterLastWindowClosed bool
}
```

The asymmetry is the finding. On Windows there is a documented place to pass arbitrary engine flags.
On macOS there is no analogue, at either the application or the window level.

### F11 — The one escape hatch exists, and does not reach far enough to be worth taking

`webview_window.go:1660`:

```go
func (w *WebviewWindow) NativeWindow() unsafe.Pointer
```

On darwin this resolves to Wails' own ObjC `WebviewWindow` subclass of `NSWindow`, which stores the
webview in a `webView` ivar (`webview_window_darwin.go:227`, `window.webView = webView;`). So a cgo
file under `internal/shell/` could cast the pointer and read `.webView` out. Two reasons to decline:

**(a) It is a dependency on unexported ObjC class layout.** Wails neither exports the class nor treats
it as API. A beta-to-beta rename breaks the build; worse, a reordering reads the wrong ivar and fails
silently. P19's own posture is that this repo tracks latest stable, i.e. moves through these betas.

**(b) Decisive: there is nothing to set once you have it.** The behaviour
`WEBVIEW-SCROLL-MEMORY.md` §7 identified — `TileController`'s coverage rect expanding with scroll
velocity, retired tiles pooled and drained on an idle timer — lives in WebCore, below anything
`WKWebView`, `WKWebViewConfiguration` or `WKPreferences` expose publicly. The doc's own §7 avenue 2
already says *"the relevant WebKit knobs are largely private API"*. Paying a private-Wails-internals
dependency to reach a private-WebKit knob that may not exist is a bad trade twice over.

**Honest limit on (b), and what §6.2 C6 does about it.** This sandbox is Linux; there is no macOS SDK
here and no `WebKit.framework` headers to grep. (b) is therefore reasoned from the doc's own
statement and from what the public headers are known to contain — it is **not** a first-hand
verification. §6.2 C6 makes it one, in a strictly bounded step on a real Mac, and records the result
either way. The decline does not depend on the outcome (F8–F10 alone close the Wails half); C6 exists
so the entry can be *closed* rather than left permanently ajar.

### F12 — The default window size is first-launch-only

`internal/shell/window.go:29-53`:

```go
opts := application.WebviewWindowOptions{
	Title: "Kira Studio", Width: 1280, Height: 800,
	MinWidth: 1024, MinHeight: 640, ...
}
if w.Bounds != nil {
	b := w.Bounds
	opts.Width = int(b.Width); opts.Height = int(b.Height)
	opts.X = int(b.X); opts.Y = int(b.Y)
	opts.InitialPosition = application.WindowXY
}
```

and `window.go:87-93`, `Attach()` persists bounds on `WindowDidResize` / `WindowDidMove`, debounced
300 ms, into `WindowsRepo`. `CascadeFrom` (`window.go:120-131`) gives a *second* window the focused
window's size, offset by one title-bar step.

So `1280×800` is reached only by a window that has no stored rectangle: first launch, or a fresh
profile. **A user who has ever resized never sees it again.** Whatever this avenue is worth, it is
worth it once per profile.

### F13 — The Electron comparison, recovered and quantified

Recovered from `18fe7bb^:src/main/window.ts` (deleted by `18fe7bb`, *"chore: M6 — delete src/main,
src/preload, src/engine/index.ts"*):

```ts
const win = new BrowserWindow({
  ...(bounds ?? {}),
  titleBarStyle: 'default',
  backgroundColor: '#1F1F1F',
  show: false,
  minWidth: 900,
  minHeight: 600,
  ...
});
```

No explicit `width`/`height` — so Electron's own 800×600 default, clamped up by `minWidth` to
**900×600** at first launch. It restored bounds the same way Wails does (`win.on('resize'/'move')`,
same 300 ms debounce; `internal/shell/window.go`'s own comment already notes the parity).

| | Electron | Wails | ratio |
|---|---|---|---|
| first-launch size | 900 × 600 = 540 000 px² | 1280 × 800 = 1 024 000 px² | **1.90×** |
| minimum size | 900 × 600 = 540 000 px² | 1024 × 640 = 655 360 px² | 1.21× |

`WEBVIEW-SCROLL-MEMORY.md` §7's caveat — *"Some of the perceived regression is a bigger default
window"* — is therefore true, and bounded: a **first-launch-only** 1.9×, over a floor that differs by
only 1.21×.

### F14 — The doc measured no area ladder, so avenue 3's premise is asserted, not measured

Every figure in `WEBVIEW-SCROLL-MEMORY.md` was taken in a single 1440×960 `NSWindow` (appendix A,
`NSRect(x: 0, y: 0, width: 1440, height: 960)`). §5.5 varied painted content **width** (1148 px →
5070 px: +423M vs +427M, no effect) — but that varied content inside a fixed viewport, which is a
different variable. **There is no run in that document at two window sizes.** "Cost scales with
viewport area" is a mechanism-level inference, not one of its measurements.

The arithmetic this phase can honestly offer is therefore a projection, labelled as such. Taking §3's
delta (1038.4M plateau − 167.3M idle = **871.1M**) at 1 382 400 px² and scaling linearly in viewport
area:

| window | area | projected plateau delta, **if linear** |
|---|---|---|
| 1440 × 960 (the doc's harness) | 1 382 400 px² | 871 M *(measured)* |
| 1280 × 800 (today's default) | 1 024 000 px² | ~645 M *(projected)* |
| 900 × 600 (Electron's first launch) | 540 000 px² | ~340 M *(projected)* |

If the coverage-rect expansion is proportional to the visible rect — the mechanism the doc describes —
this is roughly right and a 900×600 first launch would nearly halve the first-launch plateau. If the
expansion is instead a fixed pixel margin, the win is much smaller. **Nothing in this repo
distinguishes the two**, and this phase does not acquire the hardware to. §7.3 records the run that
would settle it, for whoever next has a Mac and the harness.

---

## 4. Checked, and not fired

- **Re-testing `WEBVIEW-SCROLL-MEMORY.md` §5's rejected hypotheses.** Not done, by §0.3. The doc's own
  §5 preamble is explicit that each is *"a change someone will otherwise propose again"*.
- **Widening the decode-cache retention window** to stop F3's re-decodes. Rejected: it directly
  reverses P5 C1, which §8 of the doc records as verified still holding on real hardware, and F3's
  measured share of the per-frame cost is small.
- **Making `renderRows` incremental** (rebuild only rows that entered/left). Not proposed. F6's
  positive control says full-window replacement fits in a frame in this sandbox; F1 is a far smaller
  change with a far larger effect, and doing both at once would make neither attributable. Left in
  §9 as a follow-up if D3's numbers demand it.
- **De-virtualising or re-virtualising the grid.** `WEBVIEW-SCROLL-MEMORY.md` §5.6 A/B'd the
  hand-rolled virtualizer against `@tanstack/vue-virtual` on real hardware, and `docs/PERF.md`
  records the same. Closed.
- **`will-change`/`transform` compositing hints on `.grid-row`.** §6.1 of the doc checked ancestor
  compositing and found none; §5.3 could not resolve `top`/`left` vs `transform` and §6 makes it
  moot. Adding compositing hints would *increase* the surface count, i.e. push directly against
  Half B.
- **Passive scroll listeners.** virtual-core already registers with its own
  `addEventListenerOptions` (`{ passive: true, capture: false }` where supported); `@scroll` on a
  Vue element does not preventDefault. Nothing to win.
- **`useScrollendEvent: true`** on the virtualizers. It replaces the 150 ms debounce with the native
  `scrollend` event for the trailing `isScrolling: false` notify. Irrelevant to this symptom — P47 D3's
  primitive computeds already mean that transition causes no re-render — and it changes end-of-scroll
  semantics for no stated gain.
- **`MacOptions.ActivationPolicy` / `MacWindow.Backdrop` / `LiquidGlass`.** Read; none touches
  compositing memory, and §6.1 of the doc already confirmed the window is opaque with no
  `NSVisualEffectView`, so there is no non-opaque-tile penalty to recover.
- **Lowering `MinWidth`/`MinHeight` to Electron's 900×600.** See §5 D6(b).

---

## 5. Decisions

### Half A

#### D1 — Coalesce the virtualizer-driven re-render to one per animation frame. **Implement.**

Add an `observeScrollElementOffset` to `views/shared/page/columns.ts`, beside the existing
`observeScrollElementRect`, and pass it as `observeElementOffset` on both of `DataGrid.vue`'s
virtualizers (and, by living in `columns.ts`, on `ConsoleResultGrid.vue`'s too). The precedent is
exact: P49 F3/D4 already established that overriding one of virtual-core's observers in this shared
module is how this codebase fixes a virtual-core default.

Shape (illustrative, not final):

- subscribe to `scroll` on the element;
- on each event, schedule a single `requestAnimationFrame` if none is pending;
- in the callback, read the offset **then** (not at event time) and call back once;
- preserve the trailing `isScrolling: false` notification on the same `isScrollingResetDelay`
  debounce the stock observer supplies, so end-of-scroll semantics are unchanged;
- return a disposer that removes the listener, cancels the pending frame and cancels the debounce.

**Why this is better on both axes, not a latency-for-throughput trade.** Reading the offset inside the
frame callback yields the *freshest* `scrollTop`, so the computed range is less stale than the one the
stock observer derives from the first event of the burst. The app then does the work once per frame
instead of N times, and paints the same or a better result.

**The risk, and the guard.** In the degenerate case of exactly one scroll event per frame, the
rendered window is computed up to one frame later than today. That is the case
`measureScrollResponses` measures, and `budgets.spec.ts` already gates it at p50 ≤ 12 ms / max ≤ 50 ms
on this tier. Note the interaction with the instrumentation: `markScrollWork` is called from each
virtualizer's `onChange` (`DataGrid.vue:337-339`, `:378`, `:394`), so under D1 the work mark moves
into the rAF callback and the **work** delta stays a measurement of app work; the **e2e** delta may
grow by up to one frame. e2e is logged, not gated (`docs/PERF.md` §2.1) — which is correct here and
must not be "fixed" by gating it.

**Do not** also coalesce `onScroll`'s existing rAF away as now-redundant; it feeds a different
watcher and its own comment explains why it exists.

#### D2 — Row-axis overscan: **conditional on D3's numbers, not raised pre-emptively.**

If, *after D1 lands*, D3's coverage instrument still reports uncovered frames at the doc's realistic
40–100 px/frame band, introduce a separate `ROW_OVERSCAN_PX` in `columns.ts` and raise it; otherwise
leave `OVERSCAN_PX` alone and record the measurement that says so.

Three constraints on any raise:

1. **Row axis only.** The reported symptom is vertical; the column axis is already pixel-budgeted
   *and* capped at `MAX_OVERSCAN_COLUMNS = 12` per side by `columnRangeExtractor`
   (`columns.ts:102-134`), and widening it would multiply the DOM on wide tables.
2. **It trades against Half B.** More overscan is more painted area, and
   `WEBVIEW-SCROLL-MEMORY.md` §6 establishes that painting more costs more compositing memory. Any
   raise must be the smallest that closes the coverage gap, and must be stated as the trade it is.
3. **`budgets.spec.ts`'s DOM bounds** (cell count < 2 500 there, < 1 500 in `perf.spec.ts`) are not
   loosened to accommodate it. If a raise cannot fit them, it is too large.

#### D3 — Build a sustained-velocity coverage instrument. **Implement.**

New export in `apps/kira-studio/tests/ui/support/measure.ts`:

```ts
measureScrollCoverage(page, gridSelector, { pxPerFrame, frames })
  -> { uncoveredPx: number[], notifiesPerFrame: number[], velocity: number }
```

Per animation frame, for `frames` frames: advance `el.scrollTop` by `pxPerFrame`, then record

- `el.scrollTop` and `el.clientHeight` — the viewport band;
- `min(offsetTop)` and `max(offsetTop + offsetHeight)` over mounted `[data-testid="grid-row"]` — the
  mounted band (the same DOM measurement `budgets.spec.ts:622-635` already uses, reused at speed
  rather than at rest);
- **uncovered px** = how much of the viewport band the mounted band fails to cover, floored at 0;
- **notifies this frame**, counted through a test-only counter incremented by `markScrollWork` —
  which already exists, already fires from both virtualizers' `onChange`, and needs no new app hook.

Reported per velocity, exactly as `WEBVIEW-SCROLL-MEMORY.md` §5.4 reports its ladder. Run at least
`pxPerFrame ∈ {40, 100, 200, 456}` — the doc's realistic band, a fling peak, and the doc's own
top-of-ladder value so the two documents' axes line up.

`notifiesPerFrame` is D1's direct proof: it must fall to ≤ 1 at every velocity after D1, and is
expected to exceed 1 before it. `uncoveredPx` is the symptom's own metric and is what gates D2.

#### D4 — Do not re-test what the memory doc closed. **Recorded as a decision, not a preference.**

The following are settled on real macOS hardware with `proc_pid_rusage`, and a Sonnet implementer
must not spend a step on any of them: removing `contain: layout` (§5.1); converting the per-row
gutter or the header row from `sticky` to `absolute` (§5.2); `top`/`left` vs `transform` (§5.3,
moot per §6); painted content width (§5.5); `@tanstack/vue-virtual` vs the hand-rolled virtualizer
(§5.6); inner scroller vs main-frame scroller (§6.1, main-frame is 1.5× *worse*). Also settled: the
Go backend is not involved (§3, flat ~28 MB), it is not a leak (§3, releases within ~2 s), and
`internal/metrics` needs no change (§7.1).

### Half B

#### D5 — Embedder-level `WKWebViewConfiguration`/`WKPreferences` tuning: **decline.**

On F8, F9 and F10: Wails v3 beta.16 exposes ten macOS webview preferences, none of them related to
tiling or compositing memory; the `WKWebViewConfiguration` is built and destroyed inside one cgo
block with no hook; and macOS is the one platform with no engine-flags escape hatch. On F11: the
`NativeWindow()` cast is available and is declined — unexported ObjC layout, and nothing to set at
the end of it.

**One bounded verification before the entry is closed** (§6.2 C6): on a real Mac, grep the SDK's
`WebKit.framework` public and `_WK*` SPI headers for a tile-pool / backing-store / coverage-rect
knob. Time-boxed. The decline stands regardless of the result — F8–F10 close the Wails half on their
own — but the result is recorded, so `WEBVIEW-SCROLL-MEMORY.md` §7 avenue 2 stops being an open
question forever.

**Also declined, explicitly, so it is not re-proposed:** filing or waiting on an upstream Wails
feature request for a `WKWebViewConfiguration` hook. Even if granted, F11(b) says there is likely
nothing to pass through it.

#### D6 — Default window size: **change it, as a screen-aware clamp, and do not sell it as a memory fix.**

**(a) Implement: clamp the first-launch default to the primary screen's work area.** Today's
`Width: 1280, Height: 800` is unconditional, so on a 1280×800 laptop panel the first-launch window is
edge-to-edge, overlapping the menu bar and Dock. Replace the constants with

```
Width  = clamp(min(1280, workArea.Width  - margin), MinWidth,  ...)
Height = clamp(min(800,  workArea.Height - margin), MinHeight, ...)
```

— a clamp that can only ever **shrink** the default, never grow it, and that falls back to today's
exact 1280×800 when no screen can be resolved. The app already reads `Screen.WorkArea`
(`window.go:122-126`, via `Window.GetScreen()`); Wails exposes `getPrimaryScreen()` for the
first-window case where there is no window to ask. Split the arithmetic into a pure function and unit
test it, exactly as `cascadeRect` (`window.go:132-148`) already is — that is this file's own
established pattern.

**The honest framing, which must appear in the commit message and in the doc update:** this is a UX
fix. Its memory effect is real but (F12) **first-launch-only** and (F14) **unmeasured in magnitude**.
It is not the fix for the reported symptom, and nobody should later cite it as one.

**(b) Decline: do not lower `MinWidth`/`MinHeight` from 1024×640 to Electron's 900×600.** The minimum
is a considered floor for a tree sidebar + grid + two toolbars + a status bar. F13 puts the floor
ratio at only 1.21×, first-launch-only like everything else in this avenue, against a real usability
cost at the bottom end. Not worth it.

#### D7 — Close `WEBVIEW-SCROLL-MEMORY.md` §7's remaining-avenues list. **Implement.**

That list currently reads as three open questions. After this phase it should read as one accepted
conclusion (avenue 1) and two dispositions with citations (avenues 2 and 3, per D5 and D6), plus a
pointer to this plan. Add F14's own observation to the doc too — that the area premise behind
avenue 3 is asserted rather than measured, and what run would settle it — since that is a real gap in
a document that is otherwise scrupulous about the difference.

Also record F13's recovered Electron numbers there, replacing §7's *"min 900×600"* parenthetical with
the actual `BrowserWindow` options and the two ratios. The doc's caveat is right; it is currently
citable as a larger effect than it is.

#### D8 — Accept the memory plateau. **No implementation.**

`WEBVIEW-SCROLL-MEMORY.md` §7 avenue 1, unchanged: it is self-releasing (~170 M within ~2 s of
stopping), it is not a leak, and the grid is within ~11 % of the floor for any scroller that paints
content. This phase adds nothing to that verdict and does not reopen it.

---

## 6. Implementation order

### 6.1 Pass 1 — the rendering lag

Frontend and `tests/ui/` only. Ends on a green tree.

**C1 — `test(ui): measure rendered-band coverage under sustained scroll`**
`measure.ts`: add `measureScrollCoverage` per D3, plus a `markScrollWork`-backed notify counter.
No app change. Land it **before** the fix so the before/after numbers are produced by the same
instrument.

**C2 — `test(ui): record the pre-fix scroll-coverage ladder`**
Add the ladder to `budgets.spec.ts` (or a new `scroll-coverage.spec.ts` if it makes the existing test
unwieldy — that test is already long). Run at 40/100/200/456 px/frame, on both `big_rows` and
`scroll_grid`. **Log the numbers; do not gate anything yet.** Record them in the commit message —
they are the baseline every later claim is measured against.

**C3 — `perf(grid): coalesce the virtualizer's scroll observation to one frame`**
`columns.ts`: add `observeScrollElementOffset` per D1. `DataGrid.vue`: pass it on both virtualizers.
`ConsoleResultGrid.vue`: same, for its column virtualizer. Doc comment in `columns.ts` in the house
style — what virtual-core's default does, why it is wrong here, and that the offset is read inside
the frame so the range is *fresher*, not merely cheaper.

**C4 — `test(ui): gate notifies-per-frame and coverage`**
Turn C2's logging into assertions: `notifiesPerFrame ≤ 1` at every tested velocity, and
`uncoveredPx === 0` across the realistic 40–100 px/frame band. Confirm the existing budgets are
untouched and still passing at their existing thresholds.

**C5 — *conditional* — `perf(grid): a row-axis overscan budget`**
Only if C4's coverage is still non-zero at 40–100 px/frame after C3. Introduce `ROW_OVERSCAN_PX` per
D2, raise it by the smallest step that closes the gap, and state the compositing-memory trade in the
constant's doc comment with a pointer to `WEBVIEW-SCROLL-MEMORY.md` §6. **If C4 is clean, skip C5 and
say so in the phase's own record** — a skipped step with a measurement behind it is a result.

**C6 — `docs(perf): record P22's scroll-coverage measurements`**
`docs/PERF.md`: the ladder, before and after, with velocities; the new instrument described beside
the existing scroll-response methodology note in §2.1; and an explicit sentence that a passing
scroll-response budget and a visible fling lag are measurements of different things (F6), so the next
reader does not re-derive that the budget must have been broken.

### 6.2 Pass 2 — the window default, the SPI check, and the doc closure

Go and docs only. No file overlap with pass 1.

**C1 — `refactor(shell): split the default window rectangle into a pure function`**
`internal/shell/window.go`: extract today's `1280×800` / `1024×640` decision into a
`defaultBounds(work *application.Rect) (w, h int)` beside `cascadeRect`, called from `Options()`.
Behaviour-identical; `window_test.go` grows the cases. This is a separate commit so C2's behaviour
change lands against a tested seam.

**C2 — `fix(shell): clamp the first-launch window to the screen's work area`**
Implement D6(a): resolve the primary screen, clamp, fall back to exactly today's numbers when no
screen resolves. `MinWidth`/`MinHeight` unchanged (D6(b)). Unit-test the arithmetic: a large screen
returns 1280×800 unchanged; a 1280×800 screen returns something that fits inside the work area; a
small screen floors at the minimum; a nil work area returns 1280×800.

**C3 — `docs(perf): the first-launch window default, and what it is and is not worth`**
Record F12 (first-launch-only), F13 (the recovered Electron options and the two ratios) and F14 (the
area premise is unmeasured, with the projection table clearly labelled as a projection).

**C4 — `docs: close WEBVIEW-SCROLL-MEMORY's remaining-avenues list`**
D7. Rewrite §7's three-item list as one acceptance and two dispositions, cite this plan, correct the
§7 Electron parenthetical with F13's actual numbers, and add F14's gap to §9 "Still unverified"
beside the momentum-scrolling one.

**C5 — `docs(shell): record the Wails macOS webview configuration surface`**
A short note wherever `internal/shell/security.go`'s `MacWebviewPreferences` use is documented,
listing F8–F11 so the next person to ask "can we configure the WKWebView?" gets the answer with
citations instead of re-reading the Wails source. Include the version it was checked against
(`v3.0.0-beta.16`, identical in `beta.15`) so it can be re-checked after a future bump — P19's own
discipline makes that bump a matter of when, not if.

**C6 — the real-Mac SPI check** (D5). Not a code commit. On a Mac: grep the SDK's `WebKit.framework`
public and SPI headers for a tile / backing-store / coverage-rect knob; record the result in C4's doc
edit. If — against expectation — something turns up, it does **not** get implemented in this phase;
it gets recorded as a newly-opened avenue with what it would take, and P22 still closes on D5's
decline for beta.16's surface.

---

## 7. Verification

### 7.1 Pass 1

**New, gating** (`tests/ui/`, WebKit tier):

- `notifiesPerFrame ≤ 1` at 40, 100, 200 and 456 px/frame, on both fixtures. This is the direct proof
  of D1 and the assertion that stops the coalescing from being silently reverted.
- `uncoveredPx === 0` across 40–100 px/frame. This is the symptom's own metric.
- At 456 px/frame, `uncoveredPx` is **logged, not gated** — the memory doc's own §5.4 note applies
  unchanged: *"456 px/frame is a ~13 700 px/s teleport no human produces"*. It is in the ladder so
  the two documents' axes line up, not because it is a budget.

**Existing, must stay green at their existing thresholds — not loosened:**

- `budgets.spec.ts` scroll response, all three variants: p50 ≤ 12 ms, max ≤ 50 ms.
- `budgets.spec.ts` overscan coverage on both axes, the sub-row-scroll-mutates-nothing check, and the
  cross-row positive control.
- `budgets.spec.ts` cell count < 2 500; `perf.spec.ts` cell count < 1 500 and rAF p95 < 80 ms.
- The full `tests/ui/` suite, `bun run typecheck`, `bun run lint`, `bun run build`.

If C5 (the overscan raise) lands, the DOM-count bounds are the constraint it must fit inside, not a
number to raise alongside it.

### 7.2 Pass 2

- `go build ./...` and `go test ./apps/kira-studio/...` clean.
- `window_test.go` covers `defaultBounds` for: large screen (unchanged 1280×800), exactly-1280×800
  screen (fits inside the work area), small screen (floors at `MinWidth`/`MinHeight`), and nil work
  area (returns 1280×800).
- A window with stored bounds still restores them exactly — the clamp must apply **only** to the
  no-stored-rectangle path, which is `Options()`' existing `if w.Bounds != nil` override. Assert it.
- `CascadeFrom` is unaffected: a second window still inherits the focused window's size, not the
  clamped default.

### 7.3 What must be checked on real macOS, and how

Three items, in descending order of how much they matter:

1. **Does D1 actually remove the visible lag?** A human, a packaged build, a large table, a hard
   trackpad fling. This is the only thing that answers the user's report, and F7 explains why this
   sandbox cannot: Playwright drives `el.scrollTop` from script, a main-thread scroll, while WKWebView
   on macOS scrolls on the scrolling thread. **No Swift harness needed** — unlike the memory
   question, this one is answered by looking.
2. **The SPI header check** (§6.2 C6). Bounded, mechanical.
3. **F14's area ladder**, if anyone wants avenue 3's premise settled. The appendix-A harness, run at
   two `NSWindow` sizes with everything else held constant, `proc_pid_rusage(RUSAGE_INFO_V2)` polled
   at 4 Hz — **not `vmmap`** (§2.1 of that doc) — and **velocity held fixed** while area varies
   (§5.4). Poll `/` not `/health` (appendix A, step 3). This is optional: nothing in this phase
   depends on the answer, and D6 lands on UX grounds either way.

If item 1 comes back negative — the lag survives D1 on real hardware — that is a genuine result, not
a failure of this plan, and §9 records what it would point at.

### 7.4 What must not regress

- P5 C1's retention fix: `window.__kiraRetention`'s `decodeCacheRows` stays pinned to the mounted
  window. `perf.spec.ts`'s retained-bytes check is the guard. If C5 raises the row overscan, this
  number rises proportionally **by design** — the window got bigger — and the check's bound may need
  restating in those terms, which is not the same as loosening it.
- P47 D3's primitive-computed guard: the four index computeds stay primitives. D1 changes *when* the
  virtualizer notifies, never *what* the component reads from it.
- P49 F3/D4's `observeScrollElementRect`: unchanged, and the new offset observer sits beside it in the
  same module for the same reason.
- The 300 ms scroll-position persistence and its `onUnmounted` teardown (`DataGrid.vue:354-362`).

---

## 8. Acceptance checklist

**Pass 1**

1. `measureScrollCoverage` exists in `tests/ui/support/measure.ts`, is velocity-parameterised in
   px/frame, and reports both `uncoveredPx` and `notifiesPerFrame`.
2. Pre-fix and post-fix ladders at 40/100/200/456 px/frame are recorded in `docs/PERF.md`.
3. `observeScrollElementOffset` lives in `columns.ts`, is used by both `DataGrid.vue` virtualizers and
   by `ConsoleResultGrid.vue`'s, and reads the offset **inside** the frame callback.
4. `notifiesPerFrame ≤ 1` is asserted at every tested velocity, and demonstrably failed before C3.
5. `uncoveredPx === 0` is asserted across 40–100 px/frame.
6. Every pre-existing budget passes at its pre-existing threshold. **No threshold was loosened.**
7. C5 either landed with a stated compositing-memory trade, or was skipped with the measurement that
   made it unnecessary recorded.
8. `docs/PERF.md` states that a passing scroll-response budget and a visible fling lag measure
   different things.

**Pass 2**

9. `defaultBounds` is a pure, unit-tested function; the stored-bounds path is unchanged and asserted.
10. The first-launch default can only shrink, never grow, and falls back to exactly 1280×800 when no
    screen resolves.
11. `MinWidth`/`MinHeight` are unchanged at 1024×640.
12. `docs/PERF.md` records F12, F13 and F14 — including that the area premise is a projection.
13. `WEBVIEW-SCROLL-MEMORY.md` §7's avenue list reads as one acceptance and two dispositions, §7's
    Electron parenthetical carries F13's real numbers, and §9 carries F14's gap.
14. The Wails macOS webview surface is documented with its version, so a future dependency bump can
    re-check it cheaply.
15. `go build ./...`, `go test ./apps/kira-studio/...`, `bun run typecheck`, `bun run lint`,
    `bun run build` all clean, at the end of **each** pass.

---

## 9. Open questions, handed forward

- **If D1 does not remove the lag on real hardware**, the next suspects, in order: (i) WebKit's
  scrolling thread outrunning the main thread by more than 560 px of overscan under momentum, which
  is D2's territory and would then be justified by a real measurement rather than a sandbox one;
  (ii) `renderRows` being incremental rather than full-window (§4, deliberately not attempted here so
  D1 stays attributable). Neither should be attempted before item 1 of §7.3 is run.
- **Real trackpad/momentum scrolling remains untested in this repo, from either side.**
  `WEBVIEW-SCROLL-MEMORY.md` §9 records the TCC/Accessibility blocker that stopped its `CGEventPost`
  injector. Both halves of P22 would be better answered with it. Whoever obtains that grant should
  know it unblocks two documents, not one.
- **F14's area ladder** is the one measurement that would let anyone state what a window-size change
  is worth. Until it exists, no number for avenue 3 should be quoted as measured.
- **The Wails macOS surface is checked against `v3.0.0-beta.16`.** P19's posture means this repo will
  keep moving through betas; C5's version note is what makes the re-check cheap. If a future beta adds
  a `WKWebViewConfiguration` hook, D5 is worth reopening — though F11(b) suggests the WebKit side, not
  the Wails side, is the real wall.
- **A minor discrepancy worth a glance, not a phase.** `WEBVIEW-SCROLL-MEMORY.md` §2 reports "43 rows
  / 387 cells rendered at any moment" in a 1440×960 harness, while `OVERSCAN_PX = 560` at 28 px rows
  predicts *visible + 40*. The two reconcile if the grid's own `clientHeight` in that harness was much
  smaller than the window (toolbars, tab strip, pager, status bar all subtract) — the likely
  explanation. `budgets.spec.ts:604-646` independently proves the 560 px buffer *is* rendered, so
  nothing here is load-bearing; it is noted only so the next reader of both documents does not stop on
  it.
