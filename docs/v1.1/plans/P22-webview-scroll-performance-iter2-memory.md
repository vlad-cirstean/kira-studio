# P22 iter2 — WebView scroll memory, reconsidered

> **Why this document exists.** The user, on real macOS hardware with a real trackpad: *"When I
> scroll memory of the webview spikes a lot and then it goes back, but I'd like this considered by
> another opus agent."* `docs/WEBVIEW-SCROLL-MEMORY.md` investigated that phenomenon rigorously and
> closed it as "not ours to fix"; P22's first pass picked up its two named avenues and closed both
> (one decline, one UX change honestly not sold as a memory fix). This is the requested second,
> skeptical opinion on that closure — not a restatement of it.
>
> **The verdict, in one line: the original document's *conclusion* survives — there is still no fix
> in frontend code — but its *stated mechanism is wrong on macOS*, and that error is load-bearing
> for exactly the question the user is asking.**
>
> `WEBVIEW-SCROLL-MEMORY.md` §5.4/§7 say the plateau is set by a tile coverage rect that *"expands
> with scroll velocity"*. Read against WebKit's own source (§2 below), on macOS it does not. For a
> composited overflow scroller — which `.data-grid` is, because `AsyncOverflowScrollingEnabled`
> defaults true on Cocoa — the coverage rect is expanded by a **fixed 512-device-px margin** in the
> direction of motion, and the one velocity-proportional term in that function
> (`timeDelta × velocity`) is **identically zero on macOS**, because `timeDelta` is computed against
> a timestamp the same call just wrote. The velocity dependence §5.4 measured is real, but it comes
> from somewhere else: tiles that leave the coverage rect are **retained for
> `cohortLifeTimeSeconds = 2 s`** before being freed, so the retained pool is
> `retirement rate × 2 s`, and retirement rate is proportional to velocity.
>
> **Why that matters for the user's report, and not merely for the doc's accuracy.** Under a
> coverage-rect-expands-with-velocity model, a sustained plateau is a property of *speed*. Under the
> retention model it is a property of *speed integrated over a 2-second sliding window* — which is a
> completely different thing to predict for a **real inertial fling**, whose velocity decays from a
> high peak to zero in ~1–2 s, versus the doc's stepped driver, which held a constant 13 700 px/s
> for 30 s. §3's arithmetic reproduces both of §5.4's measured rungs to within ~1 % from this model,
> and the model then says the doc's 1.0–1.2 GB plateau is **not** what a real fling produces.
>
> **Everything actionable that follows is a measurement, not a code change**, and the largest one is
> now unblocked: §4 shows that `WEBVIEW-SCROLL-MEMORY.md` §9's `CGEventPost`/TCC dead end has a
> documented way around it that needs **no entitlement and no permission grant at all** — WebKit's
> own test runner delivers synthetic wheel-and-momentum-phase events by calling
> `[view scrollWheel:]` directly. Real momentum scrolling is measurable, today, on the user's own
> machine.
>
> **One frontend avenue is genuinely new and genuinely declined, with numbers rather than a shrug**
> (§6, D5): cheaper rows while scrolling. The original document's own §6 ladder already prices it,
> and the price is paid in the exact symptom P22 pass 1 just fixed.

Written 2026-09-02 against `69090fe`, branch `claude/feature-v1-1-p5-onwards-2isfzt`, i.e. **after**
P22 pass 1 (`1adcea7`, the rAF-coalesced offset observer) and pass 2 (`76ac8ab`…`69090fe`, the
window clamp and the doc closure) had both landed. `WEBVIEW-SCROLL-MEMORY.md`'s own measurements
were taken against `1e1592c`, which predates both — §7 F13 says what that does and does not change.

---

## 0. What this pass is, and what it is not

### 0.1 Scope

This is a **reconsideration**, not an implementation phase. It produces:

1. A source-level correction of the mechanism `WEBVIEW-SCROLL-MEMORY.md` §7 asserts (§2).
2. A quantitative, falsifiable model of the plateau that reproduces the doc's own ladder (§3).
3. A concrete, permission-free way to close §9's momentum-scrolling gap (§4), which is the single
   most valuable outstanding measurement in either document.
4. A named enumeration of the WebKit tile knobs the doc left as *"largely private API"* — what they
   are called, what they default to, and precisely why none is reachable (§5).
5. Verdicts on four frontend/mitigation avenues that were never separately considered for the
   *mitigation* question, only for the *ceiling* question (§6).

### 0.2 Not in this pass

- **Any code change.** Every §6 verdict is a decline, and every §7 decision is a measurement or a
  doc edit. Nothing here proposes touching `DataGrid.vue`, `columns.ts` or `internal/shell/`.
- **Re-litigating `WEBVIEW-SCROLL-MEMORY.md` §5.** Its rejected hypotheses stay rejected; P22 §5 D4
  already lists them individually and that list is unchanged. §2's correction is to the *explanation
  in §7*, not to any measurement.
- **Re-opening P22 D5's Wails decline.** §5 below strengthens it (the knob is now named and shown
  unreachable at the WebKit layer, not merely at the Wails layer), it does not reverse it.
- **Anything that requires macOS in this sandbox.** This box is Linux. Every claim below is either
  read from source (WebKit, `@tanstack/virtual-core`, this repo) or arithmetic over numbers already
  in `WEBVIEW-SCROLL-MEMORY.md`. §8 separates what is provable here from what needs the user's Mac.

### 0.3 Ground rules carried forward

- **`AGENTS.md`'s rule against manufacturing findings applies to this document specifically.** It was
  commissioned as a second opinion, and the honest default outcome of a second opinion is
  "the first one holds". §6 says exactly that for four of the five avenues examined, and says why
  each was examined rather than assumed.
- **Evidence or a decline** (P22 §0.4). Every avenue below carries either a source citation, an
  arithmetic derivation from the doc's own numbers, or a named experiment.
- **Sandbox-provable vs. real-Mac-needed is stated per claim**, never averaged.

---

## 1. What the user is actually reporting, restated precisely

Three distinguishable complaints hide inside *"spikes a lot and then it goes back"*, and
`WEBVIEW-SCROLL-MEMORY.md` only ever answered the first:

| | the question | what the existing doc says | status after this pass |
|---|---|---|---|
| **(a) peak height** | is the ~600 MB–1 GB peak avoidable? | No — the grid is within ~11 % of the floor for any scroller that paints content (§6). | Holds, but §3 reframes what sets the peak, and §6 D5 puts a real number on the one remaining frontend lever. |
| **(b) release speed** | does it come back fast enough? | "collapses to ~170 MB within ~2 s of stopping" (§7) — recorded as a fact, never investigated as its own axis. | §3.3: the ~2 s is `cohortLifeTimeSeconds`, a WebCore constant, plus a 1 s removal-timer granularity. Not app-addressable. Sharpened, not fixed. |
| **(c) does the release itself hurt?** | is there a stutter/hitch when it drops? | Not considered anywhere. | §3.3 and §8.1 Q3: unknown, and only the user can answer it. A specific question is written for them. |

The task prompt is right that (b) and (c) are separate axes from (a). This document can answer (b)
mechanistically and cannot answer (c) at all without the user — §8.1 asks them directly rather than
leaving it as a caveat.

---

## 2. Findings — the mechanism, corrected

Read from WebKit `main` (the same tree Safari/system WebKit is built from; every path below is
quoted from it), and cross-checked against every measurement in `WEBVIEW-SCROLL-MEMORY.md`.

### F1 — `.data-grid` is a composited overflow scroller, so it takes the *non*-main-frame tiling path

`AsyncOverflowScrollingEnabled` (`Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`)
defaults to **true on `PLATFORM(COCOA)`**. So the grid's `overflow: auto` container is
asynchronously scrolled, which means `RenderLayerBacking` gives it a composited
`m_scrolledContentsLayer` with its own `TiledBacking`
(`RenderLayerBacking::adjustTiledBackingCoverage`, `Source/WebCore/rendering/RenderLayerBacking.cpp`).

That routing matters, because `GraphicsLayerCA::adjustCoverageRect`
(`Source/WebCore/platform/graphics/ca/GraphicsLayerCA.cpp`) dispatches on layer type:

```cpp
switch (type()) {
case Type::PageTiledBacking:
    coverageRect = tiledBacking()->adjustTileCoverageRectForScrolling(...);
    break;
case Type::ScrolledContents:
    if (m_layer->usesTiledBackingLayer())
        coverageRect = tiledBacking()->adjustTileCoverageRectForScrolling(...);
```

and inside `TileController::adjustTileCoverageRectForScrolling`
(`Source/WebCore/platform/graphics/ca/TileController.cpp`):

```cpp
#if !PLATFORM(IOS_FAMILY)
    if (m_tileCacheLayer.get()->isPageTiledBackingLayer())
        return adjustTileCoverageForDesktopPageScrolling(coverageRect, newSize, previousVisibleRect, visibleRect);
#endif
    ...
    return adjustTileCoverageWithScrollingVelocity(coverageRect, newSize, visibleRect, contentsScale, currentTime);
```

**The main frame on macOS and an inner overflow scroller on macOS use different coverage algorithms.**
The main frame gets `adjustTileCoverageForDesktopPageScrolling` — a bounded *"2x of the visible width
and 3x of the visible height"* with no velocity term whatsoever. The grid gets
`adjustTileCoverageWithScrollingVelocity`, the path originally written for iOS.

This is itself a small correction to `WEBVIEW-SCROLL-MEMORY.md` §6.1, which measured main-frame
scrolling as 1.5× worse and concluded *"the current inner `overflow` scroller is already the cheaper
architecture"*. The verdict is right; the reason is not "same mechanism, bigger viewport" but "two
different mechanisms".

### F2 — On macOS the coverage rect does **not** grow with velocity magnitude. The doc's headline mechanism is wrong.

`TileController::adjustTileCoverageWithScrollingVelocity`, the whole velocity-dependent part:

```cpp
double horizontalMargin = kDefaultTileSize / contentsScale;   // kDefaultTileSize = 512
double verticalMargin   = kDefaultTileSize / contentsScale;

Seconds timeDelta = timestamp - m_velocity.lastUpdateTime;

FloatRect futureRect = visibleRect;
futureRect.setLocation(FloatPoint(
    futureRect.location().x() + timeDelta.value() * m_velocity.horizontalVelocity,
    futureRect.location().y() + timeDelta.value() * m_velocity.verticalVelocity));

if (m_velocity.verticalVelocity) {
    futureRect.setHeight(futureRect.height() + verticalMargin);
    if (m_velocity.verticalVelocity < 0)
        futureRect.setY(futureRect.y() - verticalMargin);
}
...
return unionRect(coverageRect, futureRect);
```

Two things follow, and the second is the finding.

**(a) The size expansion is a constant.** `verticalMargin` is `512 / contentsScale` — one tile, ~256
CSS px on a 2× display — regardless of how fast the scroll is going. Velocity's only influence on
*size* is its **sign**, which decides whether the margin is added below (scrolling down) or above.

**(b) The `timeDelta × velocity` forward projection is identically zero on macOS.** Its caller:

```cpp
MonotonicTime currentTime = MonotonicTime::now();
auto computeVelocityIfNecessary = [&](FloatPoint scrollOffset) {
    if (m_haveExternalVelocityData)
        return;
    ...
    m_velocity = m_historicalVelocityData->velocityForNewData(scrollOffset, contentsScale, currentTime);
};
computeVelocityIfNecessary(visibleRect.location());
return adjustTileCoverageWithScrollingVelocity(coverageRect, newSize, visibleRect, contentsScale, currentTime);
```

`HistoricalVelocityData::velocityForNewData` (`Source/WebCore/platform/graphics/VelocityData.cpp`)
returns a `VelocityData` whose `lastUpdateTime` **is the `timestamp` it was passed**. So
`timeDelta = currentTime - m_velocity.lastUpdateTime == 0`, and the projection term vanishes.

It only becomes non-zero when `m_haveExternalVelocityData` is set, which happens exclusively through
`TiledBacking::setVelocity`. Its one production caller is
`LocalFrameView::setScrollVelocity` (`Source/WebCore/page/LocalFrameView.cpp`), and that function is
inside a `#if PLATFORM(IOS_FAMILY)` block. **There is no macOS path that supplies external velocity
data**, and none at all for an overflow scroller on any platform.

> **Refutes `WEBVIEW-SCROLL-MEMORY.md` §5.4 and §7.** Both state the mechanism as *"WebKit's tile
> coverage rect expands with scroll velocity, so velocity sets the steady-state tile working set"* /
> *"the coverage rect expands with velocity"*. On macOS, for this scroller, it does not. The doc's
> **measurements** stand — velocity really does move the plateau 2.3× — but the explanation attached
> to them is not what the source does, and §3 shows the correct explanation makes materially
> different predictions about real momentum scrolling.

### F3 — The velocity dependence lives in tile *retention*, and its constant is 2 seconds

`TileGrid` (`Source/WebCore/platform/graphics/ca/TileGrid.cpp`):

```cpp
constexpr Seconds cohortLifeTimeSeconds { 2_s };
const Seconds cohortRemovalTimerSeconds { 1_s };
constexpr size_t kMaxTileCountPerGrid = 6 * 1024;
```

`TileGrid::revalidateTiles()` has three dispositions for a tile that has left the coverage rect:

1. `shouldAggressivelyRetainTiles()` → keep it parented, age it out. **Main-frame only**
   (`RenderLayerBacking::shouldAggressivelyRetainTiles` returns false unless
   `m_isMainFrameRenderViewLayer`), and gated on `aggressiveTileRetentionEnabled`, default **false**.
   Not us.
2. `shouldTemporarilyRetainTileCohorts()` → `scheduleCohortRemoval()`: the tile joins a cohort that
   is freed `cohortLifeTimeSeconds` later, by a timer that ticks every `cohortRemovalTimerSeconds`.
   **This is us** — `RenderLayerBacking::shouldTemporarilyRetainTileCohorts` returns
   `renderer().settings().temporaryTileCohortRetentionEnabled()`, whose WebKit default is **true on
   macOS** (§5 F8).
3. Otherwise → `removeTilesInCohort()` immediately.

So during sustained scrolling the working set is *coverage tiles* + *every tile retired in the last
2 seconds*, and the second term is proportional to how fast the coverage rect is sweeping. That is
the velocity dependence, and it is also — exactly — `WEBVIEW-SCROLL-MEMORY.md` §7's own observed
*"collapses to ~170 M within ~2 s of stopping"*. The doc measured the constant without identifying it.

### F4 — Tile geometry, and one latent hazard worth recording

`TileController::computeTileSize`:

```cpp
if (owningGraphicsLayer()->platformCALayerUseGiantTiles())
    return maxTileSize;                                   // 4096, or IOSurface::maximumSize()
IntSize tileSize(kDefaultTileSize, kDefaultTileSize);      // 512 x 512
if (m_scrollability == Scrollability::NotScrollable) { ... }
else if (m_scrollability == Scrollability::VerticallyScrollable)
    tileSize.setWidth(std::min(std::max<int>(ceilf(boundsWithoutMargin().width() * tileGrid().scale()), kDefaultTileSize), maxTileSize.width()));
```

The grid scrolls both axes, so `m_scrollability` matches neither branch and tiles stay **512 × 512
device px** — the cheap case. Worth recording as a hazard rather than a lever: the comparison is an
exact `OptionSet` equality, so a grid that scrolled **only** vertically over a 5 070 px-wide sizer
would get tiles as wide as the layer (clamped to 4 096), which is a much coarser and more wasteful
allocation unit. Anyone who ever "simplifies" the grid by clipping horizontal overflow instead of
scrolling it would take a memory regression from this line, for reasons nothing in the app would
explain.

---

## 3. A model of the plateau, and what it predicts

### 3.1 The model

From F2–F4, on macOS, for this scroller:

```
plateau ≈ [ coverage tiles ] + [ tiles retired in the last 2 s ]

coverage tiles      ≈ ceil((W_view + 512/s) · s / 512) · ceil((H_view + 512/s) · s / 512)
retired in 2 s      ≈ tile_columns · (v · s / 512) · cohortLifeTimeSeconds
bytes               ≈ tiles · 512 · 512 · 4        (one IOSurface buffer per tile)
```

with `W_view`/`H_view` the **scroller's** visible size in CSS px, `s = contentsScale` (2 on Retina)
and `v` the vertical scroll velocity in CSS px/s.

Note what is *absent*: the sizer's height, the page size, the content's width, the number of DOM
rows, the overscan. None of them appears. The model is a statement about the scroller's viewport and
its velocity, and nothing else.

### 3.2 It reproduces `WEBVIEW-SCROLL-MEMORY.md`'s own ladder

The doc's §5.4 constant-distance rungs, in its 1440 × 960 harness. Taking `s = 2`, a grid viewport
of roughly 1 150 × 600 CSS px inside that window, and reading the doc's *"px per frame-pair"* unit at
30 frame-pairs/s:

| rung | v (CSS px/s) | tile rows retired/s | retained over 2 s | × 6 tile columns | predicted retained | doc's measured peak |
|---|---|---|---|---|---|---|
| 40 px/frame-pair | 1 200 | 4.7 | 9.4 rows | 56 tiles | **56 M** | 458.9 M |
| 456 px/frame-pair | 13 680 | 53.4 | 107 rows | 641 tiles | **641 M** | 1 039.1 M |

Predicted difference between the rungs: **585 M**. Measured difference: **580.2 M**. That is a ~1 %
agreement on a quantity the model was not fitted to, from four constants read out of WebKit's source
and one estimate of the harness's grid viewport width.

**How much weight this deserves, stated honestly.** The absolute numbers are not predicted — only the
*difference between two rungs at constant distance* is, which is the one quantity where every
velocity-independent term (base coverage, the WebKit Malloc growth, the app's own JS) cancels. The
model has one free-ish parameter (tile columns, i.e. the harness's grid viewport width, which the doc
does not record) and a ~1 % fit on a single pair of points is more agreement than that deserves; it
is corroboration, not proof. Its value is that it is **falsifiable**, and §3.4 says how.

### 3.3 What it says about release speed — the user's second complaint

Release is `cohortLifeTimeSeconds = 2 s` plus up to `cohortRemovalTimerSeconds = 1 s` of timer
granularity, so **2–3 s after the last scroll event**, freed in up to three timer batches rather than
all at once. That matches the doc's *"within ~2 s"* observation and identifies it as a WebCore
constant with no embedder surface (§5).

Two consequences worth stating:

- **The release cannot be made faster from this app.** The only things in WebKit that collapse the
  pool sooner are memory pressure (`adjustTileCoverageWithScrollingVelocity` returns the bare
  `visibleRect` under `MemoryPressureHandler::isUnderMemoryPressure()`) and the page becoming
  non-visible or out-of-window (`computeOverflowTiledBackingCoverage` returns
  `CoverageForVisibleArea` when `!layer.page().isVisible()`; `adjustTileCoverageRectForScrolling`
  returns `visibleRect` when `!m_isInWindow`). Synthesising either is not something an app should do.
- **`internal/metrics`' 5 s sampler makes this look worse than it is.** `Sampler.Interval` is 5 s and
  the release completes in 2–3 s, so a single fling can be sampled at its peak and then not sampled
  again until 5 s later. The status readout can therefore show a number that was true for ~2 s as
  though it were the current state for ~5 s. `WEBVIEW-SCROLL-MEMORY.md` §7.1 already established the
  sampler is correct and retains no high-water mark, and that conclusion is unchanged — but "correct
  and 5 s stale" is a plausible contributor to a *subjective* report of "it stays up for a while",
  and it is worth asking the user whether the number they are watching is the app's own status bar or
  Activity Monitor (§8.1 Q2).

### 3.4 Four falsifiable predictions

Written so that a single real-Mac session with the Appendix A harness plus §4's momentum injector can
confirm or kill the model. If any of these fails, the model is wrong and this section should be
struck rather than defended.

- **P1 — linearity in velocity.** Plateau delta is linear in `v` with no saturation until
  `kMaxTileCountPerGrid` (6 144 tiles ≈ 6 GB, unreachable). §5.4 has two rungs; five would test it.
- **P2 — width dominates, height barely matters.** Retained tiles scale with `tile_columns`, i.e.
  with the scroller's **visible width**, and the height term appears only in the (velocity-independent)
  base coverage. This is a sharper and different claim than P22 F14's *"cost scales with viewport
  area"*, and the area ladder that F14 asks for should therefore be run as **two ladders — width and
  height separately** — or it will confound them exactly the way §5.4's original distance experiment
  confounded distance with velocity.
- **P3 — content is a fixed additive term, not a multiplier on velocity.** The velocity-scaled term
  is content-independent; §6's empty-div-vs-grid gap should therefore be roughly *constant* across
  velocities, not proportional to them. §6's ladder was run at one velocity, so this is untested.
- **P4 — a real inertial fling peaks well below the doc's plateau, and cannot sustain it.** Because
  the retained pool is a 2-second sliding window over instantaneous velocity, a fling that decays
  from its peak to zero in ~1–2 s holds a high retirement rate only for that long, whereas the doc's
  driver held 13 680 px/s for 30 s. **The 1.0–1.2 GB figure is a property of the instrument, not of
  human scrolling.** Corollary, and the one that matters for the user: *repeated* flings within the
  2 s window partially stack, so continuous flick-flick-flick browsing of a large table is the
  realistic worst case, not one hard fling.

P4 is the direct answer to "is the doc's programmatic proxy misleading about real momentum?" — and
the answer is **yes, in both directions at once**: it overstates the duration (no human sustains a
constant fling velocity for 30 s) and understates the peak (the doc dismissed 456 px/frame as *"a
~13 700 px/s teleport no human produces"*, which is true of *sustained* scrolling and false of the
first ~200 ms of a hard trackpad flick, where momentum routinely exceeds that). Neither error was
knowable without testing momentum. §4 makes testing it possible.

---

## 4. Closing `WEBVIEW-SCROLL-MEMORY.md` §9 — real momentum scrolling is measurable, with no permission grant

This is the most actionable finding in this document.

### F5 — WebKit's own test runner injects wheel + momentum phases without `CGEventPost`

`WEBVIEW-SCROLL-MEMORY.md` §9 records the blocker: a `CGEventCreateScrollWheelEvent` injector was
built, `CGEventPost` needed an Accessibility/TCC grant the harness did not have, and 1 800 posted
events reached nothing. That is a correct diagnosis of `CGEventPost` — and `CGEventPost` is the wrong
call. WebKit's own `Tools/WebKitTestRunner/mac/EventSenderProxy.mm`, in
`mouseScrollByWithWheelAndMomentumPhases`, builds the event the same way:

```objc
auto cgScrollEvent = adoptCF(CGEventCreateScrollWheelEvent2(0, kCGScrollEventUnitLine, 2, y, x, 0));
CGEventSetIntegerValueField(cgScrollEvent.get(), kCGScrollWheelEventIsContinuous, 1);
CGEventSetIntegerValueField(cgScrollEvent.get(), kCGScrollWheelEventScrollPhase, phase);
CGEventSetIntegerValueField(cgScrollEvent.get(), kCGScrollWheelEventMomentumPhase, momentum);
```

and then **delivers it straight to the view**, never through the window server:

```objc
dispatchSyntheticEvent(event, m_testController->mainWebView()->platformView(),
    @"mouseScrollByWithWheelAndMomentumPhases",
    ^(NSView *targetView, NSEvent *syntheticEvent) { [targetView scrollWheel:syntheticEvent]; });
```

`+[NSEvent eventWithCGEvent:]` wraps the `CGEventRef` so `-phase` / `-momentumPhase` /
`-hasPreciseScrollingDeltas` read back the fields set above, and `-scrollWheel:` is an ordinary
responder-chain method. **No `CGEventPost`, no event tap, no Accessibility grant, no entitlement, no
code signing.** `WKWebView` overrides `scrollWheel:` (`WebViewImpl::scrollWheel` →
`WebPageProxy::handleNativeWheelEvent`), so the event enters the same native wheel-event path a real
trackpad event does, momentum phases included.

This is the technique WebKit uses to test its own momentum-scrolling code. It is not a workaround.

### F6 — and the *real* profile can be captured first, with even less machinery

Synthesising a plausible momentum curve is still a guess about the shape. It does not have to be:

- `+[NSEvent addLocalMonitorForEvents:matching:handler:]` observes events **in the harness's own
  event stream**, and — unlike `addGlobalMonitorForEvents...`, which is the API that needs
  Accessibility — requires no permission at all.
- Simpler still and with no API subtlety: put the `WKWebView` inside a container `NSView` subclass
  that overrides `-scrollWheel:` to log `scrollingDeltaY`, `phase`, `momentumPhase`,
  `hasPreciseScrollingDeltas` and `timestamp`, then call `super`. That is ordinary AppKit.

So the procedure is **record, then replay**:

1. Run the harness, have a human flick the trackpad over the grid in the three ways §8.1 describes,
   and dump the real event stream to a file. This alone already produces the first real
   momentum-velocity profile anyone in this repo has ever had.
2. Replay that exact stream through F5's `[view scrollWheel:]` path, at the recorded timestamps, with
   `proc_pid_rusage(RUSAGE_INFO_V2)` polled at 4 Hz on `_webProcessIdentifier` — the doc's Appendix A
   instrument, unchanged.
3. Compare against the doc's stepped driver at matched **peak** velocity. P4 predicts the replayed
   fling peaks materially lower and decays within ~2–3 s of the fling ending.

Step 1's recording is what makes step 3 an experiment rather than another proxy.

### F7 — and there is a zero-machinery version the user can run in five minutes

The whole harness exists to make measurement reproducible. For the narrower question *"is what I see
consistent with the model?"*, the user already has the app, real hardware, and Activity Monitor.
§8.1 writes that out as three specific scrolls and three specific numbers. It will not settle P1–P3,
but it will settle P4's sign and, crucially, complaint (c) — whether the release *itself* hitches —
which no instrument in either document can observe and no amount of sandbox work will produce.

---

## 5. Findings — the WebKit knobs, named

`WEBVIEW-SCROLL-MEMORY.md` §7 avenue 2 says *"the relevant WebKit knobs are largely private API"* and
does not name them; P22 F11(b) reasons from that sentence. Both are correct, and both can now be
replaced with specifics. From `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`:

### F8 — the knobs exist, they are named, and one of them is exactly the mechanism in F3

| preference | `status` | macOS default | what it does |
|---|---|---|---|
| `TemporaryTileCohortRetentionEnabled` | `embedder` | **true** (`PLATFORM(IOS_FAMILY)`: **false**) | F3's 2-second retention. False ⇒ `removeTilesInCohort()` immediately. |
| `AggressiveTileRetentionEnabled` | `embedder` | false | Main-frame-only (F3); irrelevant to this scroller either way. |
| `UseGiantTiles` | `embedder` | false | 512 → up to 4 096 px tiles (F4). Coarser allocation unit. |
| `AsyncOverflowScrollingEnabled` | `internal` | **true** on Cocoa | F1's routing. False ⇒ the grid is no longer a composited scroller. |

The first row is the finding. **Apple ships `TemporaryTileCohortRetentionEnabled` disabled on iOS**
— i.e. WebKit itself already treats F3's retention as a memory-for-smoothness trade that
memory-constrained platforms should not take. That is direct upstream corroboration that the
mechanism `WEBVIEW-SCROLL-MEMORY.md` identified is real and is understood as a tunable, not a bug.

### F9 — and none of them is reachable from a `WKWebView` embedder

- `status: embedder` is not one of the statuses that generate a feature flag. In
  `Source/WTF/Scripts/GeneratePreferences.rb`, the predicates are
  `experimental? = {developer, testable, preview, stable}`, `internal? = {unstable, internal}`,
  `testable? = {testable, preview, stable, mature}` — `embedder` is in none of them. So
  `TemporaryTileCohortRetentionEnabled`, `AggressiveTileRetentionEnabled` and `UseGiantTiles` never
  appear in `+[WKPreferences _features]`, are not settable through `-[WKPreferences
  _setEnabled:forFeature:]`, and have no generated `WKPreferences` property, public or `_`-prefixed.
- The only key-addressable setter in WebKit is
  `WKPreferencesSetBoolValueForKeyForTesting(WKPreferencesRef, bool, WKStringRef)` in
  `Source/WebKit/UIProcess/API/C/WKPreferencesRefPrivate.h`, under the header's own comment *"The
  following generic setter functions are only intended for use by testing infrastructure."* It takes
  a `WKPreferencesRef` from the legacy C SPI; there is no supported way to obtain one from a
  `WKWebView`-based application.
- `AsyncOverflowScrollingEnabled` (`status: internal`, `exposed: [WebKit]`) **is** a feature flag and
  therefore *is* reachable, via `-[WKPreferences _setEnabled:forFeature:]` — underscore SPI, with no
  public equivalent. §6 D6 disposes of it.

**Net effect on P22 D5.** The decline stands and is now better founded: P22 closed it at the Wails
layer (F8–F11 there) and reasoned about the WebKit layer from the older document's own sentence. The
WebKit layer is now closed on its own terms, with the knobs named, their statuses read from the
generator that decides exposure, and their defaults read from the preference table. Nothing about
Wails needs revisiting — even a hypothetical `WKWebViewConfiguration` hook would not reach these.

**What this does change:** P22 §6.2 C6's pending *"real-Mac SPI-header grep"*, recorded as still open
in `docs/ARCHITECTURE.md`. That step can be closed by this section instead of by a Mac — grepping a
shipped SDK's headers would find exactly what F9 derives from the generator, one abstraction level
lower and less conclusively. §7 D2 folds it in.

---

## 6. Decisions

### D1 — Close §9's momentum gap with the record-and-replay harness. **The one thing worth doing.**

Per F5–F7. It needs a Mac and does not need a permission grant, an entitlement, or a signed binary.
It is the only outstanding measurement that can change any conclusion in either document, it settles
P4 (and therefore whether the 1.0–1.2 GB headline number describes anything a human does), and its
recording half is useful independently of everything else here.

**Do the cheap tier first, and it is already being built by the parallel plan.**
`P22-webview-scroll-performance-iter2-rendering.md` D2 (`49f3cbe`) proposes `window.__kiraScrollTrace`
— an in-page rAF recorder whose per-frame `pxPerFrame` is, exactly, the real-fling velocity profile
`v(t)` that §3's model takes as input. Paired with §8.1's Activity Monitor readings from the *same*
fling, that is a complete test of **P4** with no Swift, no harness, and no second build: the trace
supplies `v(t)`, the footprint supplies the plateau, and §3.1 predicts one from the other. **These
two documents should therefore be run as one real-Mac session, not two.**

The native record-and-replay of F5/F6 stays worth building afterwards, for what the in-page trace
cannot give: *reproducibility* (replaying a recorded fling byte-for-byte across builds) and
*controlled* velocity, which P1–P3's ladders require and a human's hand cannot hold steady.

### D2 — Correct `WEBVIEW-SCROLL-MEMORY.md`'s stated mechanism, and name the knobs. **Doc edit.**

§2 F2's refutation and §5's table both belong in the document that currently says otherwise. Written
in that document's own house style — as a marked correction beside the measurement it explains, not
as a deletion — because the wrong mechanism is exactly the kind of thing a later reader re-derives.

### D3 — Overscan as a memory lever: **decline. The model says it is not one, and the tension with pass 1 is real but one-sided.**

The task asks whether shrinking `OVERSCAN_PX` (560, i.e. 20 rows per side at the 28 px comfortable
density — `columns.ts:20`, `DataGrid.vue:376`, and virtual-core's `defaultRangeExtractor` applies it
symmetrically) would reduce tile area. §3.1's model says no, and F2/F4 say why: tiles are allocated
for the **coverage rect**, which is derived from the scroller's visible rect and a fixed
512-device-px margin. It contains no term for how many rows the app has mounted. Rendering fewer rows
leaves the same tiles allocated, painting more empty sizer.

There is a second-order effect the model does not capture — §6's own ladder proves painting *does*
cost something (empty div +427 M vs grid +980–1 015 M), so the fraction of the coverage rect that
*contains content* is not free. But the arithmetic closes even that door, and it closes it harder
than "sub-linear". Both bands, in CSS px, for a grid viewport of height `H_view`:

| | height |
|---|---|
| mounted DOM band | `H_view + 2 × 560` = `H_view + 1 120` |
| coverage rect (F2: one `kDefaultTileSize / contentsScale` margin, leading side) | `H_view + 256` on a 2× display, `H_view + 512` on a 1× one |

**The app already mounts roughly 900 CSS px more row than WebKit will ever paint during a scroll**,
and the surplus is independent of `H_view`. Shrinking `OVERSCAN_PX` therefore changes *nothing at
all* — not the tiles, not the painted area inside them — until it drops below the margin, i.e. below
~256 CSS px (≈ 9 rows) on Retina or ~512 px (≈ 18 rows, almost exactly today's value) on a 1×
display. Below that threshold it stops being a memory lever and becomes D5's lever: painting blank
inside tiles that are allocated regardless.

This is a stronger result than the one the model alone gives, and it is derived entirely from this
repo's own constants plus F2's — no hardware needed. It also means the 560 px buffer is, on a Retina
display, more than twice what WebKit's own paint window can consume.

**The tension, stated for the user rather than resolved here.** P22 D2 held a row-overscan *raise* in
reserve for the rendering-lag half, and skipped it because pass 1's measured `uncoveredPx` was
already 0 at every rung (`b0d9936`). So the two halves do pull in opposite directions on this
constant — but not symmetrically:

- the rendering-lag upside of a **larger** overscan is currently **zero and measured** (no coverage
  gap exists to close — `b0d9936`);
- the memory upside of a **smaller** overscan is **zero down to ~256 CSS px per side** by the
  arithmetic above, and below that it converts into D5's blank-rows trade rather than into a new one;
- the rendering-lag *downside* of a smaller overscan is **real and cheap to measure** —
  `measureScrollCoverage` (`tests/ui/support/measure.ts:210`) is exactly the instrument, and
  `budgets.spec.ts` already gates `uncoveredPx === 0` across 40–100 px/frame.

So the honest framing is not "split the difference", and it is not even a balanced trade: on the
current numbers a shrink spends a *measured* budget to buy **nothing**, until it crosses a threshold
where what it buys is a different decision entirely (D5). The tension between the two halves of P22
is real and is flagged here as the task asked — but it turns out to be one-sided, and the place where
the two halves genuinely collide is D5, not this constant. If the user wants it explored anyway, the
sequencing is fixed: measure the memory effect on a real Mac **first** (it is one `OVERSCAN_PX` value
and one harness run), and only then decide whether to spend coverage margin on it. Do not shrink it
on a model's word.

**Reconciliation with the parallel iter2 plan, which proposes the opposite change.**
`docs/v1.1/plans/P22-webview-scroll-performance-iter2-rendering.md` (written concurrently, landed as
`49f3cbe`) reaches its own D3: a velocity-adaptive, **direction-biased** row overscan with
`MAX_LEAD_PX = 2400`, on the grounds (its F6) that today's 560 px is symmetric, so only half of it is
runway ahead of a fling. Its D3(d) then states the memory trade defensively, citing
`WEBVIEW-SCROLL-MEMORY.md` §6 — *"more painted area is more compositing memory, while flinging only"*.

The two documents do not actually collide, and the arithmetic above cuts **in that plan's favour**:

- The two constraints are different quantities. This section's threshold (~256 CSS px on Retina) is
  the depth of WebKit's *paint* window ahead of the visible rect. Its F6's runway is bounded by
  *main-thread lag* — how far the compositor scrolls the layer before the main thread re-renders,
  ≈ lag × velocity, which at a hard fling is easily several hundred px. Neither number constrains
  the other, and 560 px can be simultaneously more than twice the paint window and less than the lag
  window.
- Consequently, mounting rows *beyond* the coverage rect costs **no compositing memory at all** —
  they are DOM and render tree (the `WebKit Malloc` term, +144.5 M in §4 of that document), not
  tiles. Since today's 560 px lead already exceeds the paint window, raising it further adds
  unpainted DOM. **D3(d)'s stated trade is, on this arithmetic, close to zero**, and the real cap on
  a bigger lead is the per-frame patch cost its own D3(c) already bounds in cells.
- **One uncertainty, named rather than smoothed over.** The `coverageRect` argument arriving at
  `adjustTileCoverageWithScrollingVelocity` comes from `GraphicsLayerCA::computeVisibleAndCoverageRect`
  and is unioned with `futureRect`, so the effective paint window is *at least* visible + one tile
  margin and could be larger for a `ScrolledContents` layer whose clip rect exceeds its visible rect.
  If it is much larger, the threshold rises and D3(d)'s caution becomes warranted again. §8.2 step 5
  is what would show it — a width/height ladder moves the coverage rect and nothing else.

So: no unilateral resolution is offered or needed. The honest statement for the user is that the two
halves of P22 pull in opposite directions on this constant *in principle*, and that on the numbers
available today the memory side of that tug has almost no rope — which is a better outcome for the
rendering half than either plan assumed in isolation.

### D4 — `content-visibility: auto` on off-screen rows: **not proposed, but recorded as the cheapest thing to put on a Mac session's list.**

The CSS-native form of D5. Supported in WebKit from Safari 18 (macOS Sequoia), so it is available on
the target platform. It would let WebKit skip painting the overscan rows while keeping them mounted —
which is precisely the "content fraction of the coverage rect" term D3 says is second-order, isolated
as a one-declaration experiment.

Recorded rather than proposed for three reasons: it defeats the purpose of overscan (rows are held
mounted *so that they are already painted*); its size depends on the same unmeasured term; and the
parallel `P22-webview-scroll-performance-iter2-rendering.md` D6 declines it outright for the
rendering half. It is listed here only because it is a single line to try in the same
runtime-CSS-override style `WEBVIEW-SCROLL-MEMORY.md` §5 used, if someone has the harness up anyway —
**not as a disagreement with that decline**, which is decided on frame-time grounds this document
does not contest.

### D5 — Cheaper rows while actively scrolling: **decline, and here is the price.**

The task is right that this is a real and common virtualised-list technique, and right that
`WEBVIEW-SCROLL-MEMORY.md` never considered it — its §6 ladder was framed as "how close is the grid to
the floor", which is a *ceiling* question, and the same ladder read as a *mitigation* question says
something quite different. Read that way:

| what is painted | doc §6 delta | vs. the grid |
|---|---|---|
| the Kira grid | +980–1 015 M | — |
| plain non-virtualised text rows | +910 M | **−7 to −10 %** |
| empty `<div>` | +427 M | **−56 to −58 %** |

So: the doc's *"the grid sits ~11 % above the cheapest content-painting scroller, and that 11 % is
the entire app-attributable headroom"* is true **only if the app must paint content**. During an
active fling it need not. The real ceiling on this technique is **~56 %**, not 11 % — and that is a
substantially different number than the doc's framing implies.

**It is still a decline, for three reasons, in increasing order of weight.**

1. **The 11 % is what "simplified but still legible" actually buys.** The ladder's middle rung —
   plain text divs, no borders, no gutter, no selection perimeter — is only 7–10 % cheaper than the
   full grid. Reaching the −56 % rung means painting *nothing*: blank boxes.
2. **Blank boxes during fast scroll are the symptom P22 pass 1 just fixed.** The phase's own
   SPEC.md wording for half A is *"rows visibly take a moment to render/catch up when scrolling
   fast"*. Deliberately rendering blank rows during exactly the high-velocity window where the
   plateau builds recreates that symptom on purpose, and trades a memory number the user cannot see
   for a rendering artifact they told us they can. **The two halves of P22 are the same axis in
   opposite directions, and this is where they meet.**
3. **The middle rung is not even a clean price.** "Plain non-virtualised rows" was 100 000 rows of
   real DOM; a *virtualised* plain-row grid is a different measurement and was never taken. The −7
   to −10 % figure is therefore an upper bound on a technique that is already not worth its
   complexity.

Recorded in full because it is the one frontend avenue with a genuinely new number attached, and
because "the doc says 11 %, so there is nothing here" is a conclusion someone will otherwise reach
from a document whose own data says the bound is 56 % under a condition it never considered.

### D6 — `AsyncOverflowScrollingEnabled: false`: **decline, but record it as the one reachable knob.**

It is the only tile-relevant WebKit preference an embedder can actually set (F9). Turning it off
would decompose the grid into the main frame's tiled backing, which on macOS uses the bounded
`adjustTileCoverageForDesktopPageScrolling` path (F1) with no velocity term and — because the page
itself would not be scrolling — a *stationary* coverage rect and therefore no cohort churn at all.
On F3's model that is a large memory win.

Declined on four grounds, any one of which is sufficient:

1. It moves scrolling back onto the main thread. That is directly against P22 half A, whose entire
   subject is the main thread not keeping up during a fling.
2. `WEBVIEW-SCROLL-MEMORY.md` §6.1 measured a main-frame scroller as **1.5× worse** (1 605 M vs
   1 061 M). Different arrangement, same direction of concern; the win is not even certain.
3. It is underscore SPI on `WKPreferences` with no public equivalent, and Wails hands the app no
   `WKPreferences` (P22 F8–F11) — so taking it means the private-ObjC-ivar dependency P22 F11(a)
   already declined, to reach a knob that fails on (1) and (2) anyway.
4. It changes a global rendering behaviour to fix a metric nobody has shown is a user-visible
   problem.

Recorded so the next reader does not have to rediscover that the reachable knob and the useful knob
are different knobs.

### D7 — Re-measuring against pass 1: **predicted null, not worth a trip to a Mac on its own.**

The task asks whether `WEBVIEW-SCROLL-MEMORY.md`'s measurements predate pass 1's coalescing fix. They
do — the doc measured `1e1592c`, and pass 1 landed as `1adcea7`. Pass 1 changed *how often within a
frame* Vue is notified and the DOM is patched. Intermediate DOM states inside a frame never reach
paint, so the painted result per frame is unchanged; nothing about the coverage rect, the tile size,
the retirement rate or the mounted band moved. On §3.1's model the plateau is unchanged, and on the
doc's own §4 breakdown the only plausible movement is a small reduction in the `WebKit Malloc` term
(+144.5 M), from fewer style and layout recalculations — not in the `owned unmapped (graphics)` term
(+1 230.8 M) that dominates.

**And the parallel plan makes this null result stronger still.**
`P22-webview-scroll-performance-iter2-rendering.md` F1–F3 (`49f3cbe`) find that the *"up to 8 notifies
per frame"* baseline `b0d9936` recorded was the measuring instrument's own constant —
`measureScrollCoverage` dispatches `SUB_STEPS_PER_FRAME = 8` synthetic `scroll` events per simulated
frame (`measure.ts:229`, `:258-261`) — and that real `scroll` events fire at most once per frame per
element, so the burst pass 1 coalesced does not occur. If pass 1 is a no-op for rendering, it is a
fortiori a no-op for compositing memory. Cited here so the two iter2 documents agree on the record
rather than each asserting the "8 → 1" number independently; **this document takes no position on
that plan's D1 (reverting pass 1)**, which is decided on frame-time grounds it owns, not memory
grounds.

Worth re-taking a baseline **if the harness is already up for D1**, and not worth a session of its
own. Stated so this does not get raised a third time as an unknown.

### D8 — The overall verdict is unchanged. **Accept the plateau.**

`WEBVIEW-SCROLL-MEMORY.md` §7 avenue 1 stands: it is self-releasing on a WebCore timer, it is not a
leak, the Go backend is not involved, and there is no frontend change that reduces it without paying
in the rendering-lag symptom the same phase just fixed. What changes is the *quality* of that
verdict — the mechanism is now correct, the constants are named, the knobs are enumerated with their
reachability, and the one measurement that could still overturn it is unblocked rather than
permanently parked.

---

## 7. Implementation order

Two commits' worth of doc work, plus one real-Mac session that is not a commit.

**C1 — `docs: correct WEBVIEW-SCROLL-MEMORY's tile mechanism, and name the knobs`**
`docs/WEBVIEW-SCROLL-MEMORY.md`: add §2 F2's refutation beside §5.4/§7's *"coverage rect expands with
velocity"* wording, in that document's own `> **Refuted.**` style; add F3's `cohortLifeTimeSeconds`
identification beside §7's *"~2 s"* observation; add §5's knob table to §7 avenue 2 in place of
*"largely private API"*. Note in §9 that its `CGEventPost` blocker has a way around it (F5) and cite
this document. Do **not** restate §3's model there — it belongs here until something measures it.

**C2 — `docs(architecture): close the pending WebKit SPI-header check`**
`docs/ARCHITECTURE.md`'s renderer-security-surface section currently carries P22 §6.2 C6's real-Mac
SPI grep as pending. §5 F9 answers it from the generator that decides exposure, which is strictly
better evidence than a header grep. Close it, cite this document, and keep the version note P22 C5
established so a Wails or WebKit bump can re-check cheaply.

**C3 — the real-Mac session** (D1). Not a commit in this repo unless it produces a result worth
recording, which it will. Scope in §8.2.

---

## 8. Verification

### 8.1 What the user can settle in five minutes, and should be asked first

This is the highest-value-per-minute item in the whole document, because it distinguishes complaints
(a), (b) and (c) from §1 — which no instrument in this repo can do — and because the user has the
hardware.

With Activity Monitor open on the Kira Studio helper processes (or the app's own status readout, but
see §3.3 on its 5 s staleness), on a large table:

1. **One hard fling, then hands off.** Record the peak, and how long until it comes back down.
   *Model prediction (P4): a peak well under 1 GB, back down 2–3 s after the fling visibly stops.*
2. **Flick, flick, flick — ten seconds of continuous flinging.** Record the peak.
   *Model prediction: higher than (1), because retirement stacks inside the 2 s window; this is the
   realistic worst case, not a single fling.*
3. **A slow, continuous two-finger drag for ten seconds.** Record the peak.
   *Model prediction: much lower than either — this is §5.4's 40 px/frame rung.*

And the three questions this document cannot answer without them:

- **Q1.** Which of the three above matches what prompted the report? (Distinguishes "the peak is too
  high" from "sustained browsing accumulates".)
- **Q2.** Is the number being watched Activity Monitor's, or the app's own status bar? (§3.3: the
  status bar polls at 5 s against a 2–3 s release, so it can show a stale peak for several seconds.)
- **Q3.** **Is there a visible hitch, stutter or dropped frame *at the moment it comes back down*, a
  couple of seconds after scrolling stops?** Nothing in either document has ever looked at this, and
  it would be a different problem with a different cause — freeing several hundred MB of IOSurfaces
  in up to three timer batches — from the one both documents have been investigating.

If Q3 is yes, that is a **new finding** and this document's conclusions do not cover it.

### 8.2 What the real-Mac harness session must run (D1)

Appendix A's harness from `WEBVIEW-SCROLL-MEMORY.md`, plus F5/F6's two additions. Its own pitfall
list still applies unchanged — `proc_pid_rusage(RUSAGE_INFO_V2)` at 4 Hz and never `vmmap` for the
time series; poll `/` not `/health`; measure the real grid, not a replica.

0. **First, and possibly instead.** Run the parallel plan's `__kiraScrollTrace` (its D2/§7.3) on a
   packaged build while watching the helper's footprint per §8.1. If P4's sign is already clear from
   that — a real fling's `pxPerFrame` profile plus its measured peak — steps 1–3 below become a
   confirmation rather than the experiment, and steps 4–6 (which need *held* velocities) are the only
   reason to build the harness at all.
1. **Record.** Container `NSView` subclass overriding `-scrollWheel:` (log `scrollingDeltaY`,
   `phase`, `momentumPhase`, `hasPreciseScrollingDeltas`, `timestamp`, then `super`). Human performs
   §8.1's three scrolls. Output: the first real momentum-velocity profile this repo has.
2. **Replay.** `CGEventCreateScrollWheelEvent2` + `kCGScrollWheelEventIsContinuous` /
   `…ScrollPhase` / `…MomentumPhase`, `+[NSEvent eventWithCGEvent:]`, `[view scrollWheel:]` at the
   recorded timestamps. Never `CGEventPost` (that is §9's dead end).
3. **Compare** against the doc's stepped driver at matched peak velocity → settles **P4**.
4. **Ladder velocity** at five rungs, constant distance → settles **P1**.
5. **Ladder the harness `NSWindow`'s width and height separately**, velocity held fixed → settles
   **P2**, and is the run P22 F14 asked for, corrected: as *two* ladders, not one area ladder, or it
   confounds the two terms the same way §5.4's original experiment confounded distance with velocity.
6. **Re-run §6's content ladder at two velocities** → settles **P3**.
7. **Optionally**, since the harness is up: re-baseline against current `HEAD` (D7, predicted null),
   and try `content-visibility: auto` on off-screen rows as a runtime CSS override (D4).

### 8.3 What is provable in this sandbox, and what is not

**Provable here, and proved above:** every WebKit source claim in §2, §4 and §5 (source read
directly); every arithmetic claim in §3.2 (derived from numbers already in
`WEBVIEW-SCROLL-MEMORY.md`); the pass-1 timeline in D7 (git history); the overscan and mounted-band
arithmetic in D3 (this repo's own source).

**Not provable here, and not claimed:** §3's model, which is corroborated by one pair of the doc's
rungs and is otherwise a prediction; every P1–P4; anything about real momentum scrolling; complaint
(c) entirely. This box is Linux, and `tests/ui`'s WebKit tier exposes no heap API — the same two
constraints `docs/PERF.md` §2.3 and P5 F1 record.

**A limit worth stating on §2 itself.** WebKit `main` is not byte-identical to the system WebKit the
user's Safari/WKWebView ships. The functions quoted are long-lived (`cohortLifeTimeSeconds`,
`kDefaultTileSize` and the iOS-only guard on `LocalFrameView::setScrollVelocity` all predate the
current release train by years), and F2's conclusion depends on *structure* — where a `#if
PLATFORM(IOS_FAMILY)` sits — rather than on a constant that might have been retuned. But it is read
from open source, not from the binary on the user's machine, and a divergence would show up as §3's
predictions failing.

---

## 9. Acceptance checklist

1. `WEBVIEW-SCROLL-MEMORY.md` no longer states that the tile coverage rect expands with velocity
   magnitude on macOS, and carries F2's refutation with its source citation.
2. That document's *"~2 s"* release observation is attributed to `cohortLifeTimeSeconds` (F3).
3. Its §7 avenue 2 names the four knobs, their `status`, their platform defaults, and why none is
   reachable (§5), replacing *"largely private API"*.
4. Its §9 records that the `CGEventPost` blocker has a permission-free way around it (F5/F6), with
   the WebKit test-runner citation, so the gap reads as *unrun* rather than *unrunnable*.
5. `docs/ARCHITECTURE.md`'s pending real-Mac SPI-header check is closed by F9, not left open.
6. The overscan tension (D3) is recorded as a **one-sided** trade with a fixed measurement order, not
   as an open judgement call or a silently split difference.
7. D5's ladder re-reading is recorded with its real bound (~56 %, not 11 %) **and** with why it is
   still declined, so neither half of that number travels alone.
8. §8.1's three scrolls and three questions are put to the user.
9. No code changed. No budget loosened. No existing conclusion in `WEBVIEW-SCROLL-MEMORY.md` §5
   re-tested.

---

## 10. Open questions, handed forward

- **P1–P4 are unmeasured**, and §3's model rests on them. If a real-Mac session runs §8.2 and P4
  fails — a real fling *does* hold the doc's plateau — then the retention model is wrong or
  incomplete, and §3 should be struck rather than patched.
- **Complaint (c) — a hitch at release time — has never been looked at by anyone.** §8.1 Q3 is the
  cheapest possible probe and it needs the user, not a harness.
- **The residual in §6's content ladder is unexplained.** The retention model predicts the
  velocity-scaled term is content-independent, yet an empty scroller costs less than half a painted
  one. The likely candidate is `RemoteLayerBackingStore`'s front/back/secondary-back buffering — a
  repainted tile holds more than one IOSurface, an untouched one holds fewer — but that was not
  chased to source here, and it is the one place a content-side lever could still hide. P3 is the
  test that would tell anyone whether it is worth chasing.
- **`WEBVIEW-SCROLL-MEMORY.md` §5.3's `top`/`left` vs `transform` question is still formally
  unresolved**, and §3's model now predicts it should not matter (neither changes the coverage rect).
  Still not worth a run on its own; noted because the model makes a prediction where the doc had only
  noise.
- **`WEBVIEW-SCROLL-MEMORY.md` §2's "43 rows rendered at any moment" is harder to reconcile than
  P22 §9 allowed.** `decodeCacheRows` tracks the *mounted* band (`DataGrid.vue`'s
  `visiblePageRowBounds` is built from `rowStart`/`rowEnd`, which include overscan), and
  virtual-core's `defaultRangeExtractor` applies `overscan` symmetrically, so 43 mounted rows implies
  **three visible rows** in a 1440 × 960 window. Something about that harness run's grid
  `clientHeight` is not what either document assumes. It does not affect §3.2's fit, which depends on
  viewport *width*, but a real-Mac session should log the grid's `clientHeight` and `clientWidth`
  alongside every reading — §3's whole model is parameterised on them, and neither document records
  either number.
- **If anyone ever restricts the grid to vertical-only scrolling**, F4's `computeTileSize` branch
  makes tiles as wide as the layer. That would be a memory regression with no app-level explanation.
  Recorded here because there is nowhere else it would be found.
