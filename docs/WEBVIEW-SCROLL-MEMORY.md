# WKWebView scroll memory — investigation

> **Headline:** sustained scrolling in WKWebView holds a **~1.0–1.2 GB** plateau of CoreAnimation
> backing store for as long as scrolling continues, and collapses to ~170 MB within ~2 s of
> stopping. The driver is **scroll velocity**, not distance and not page size. Painting *any*
> content roughly doubles the cost of an empty scroller; the data grid sits ~11 % above the
> cheapest possible content-painting scroller, and that 11 % is the entire app-attributable
> headroom. **There is no fix in this app's code**, but the reason is narrower than "nothing we do
> matters" — it is that the app is already within noise of the floor.

Investigated 2026-09-01/02 against `1e1592c` (`fix(protocol): stop one execute frame from pinning
every page it carried (P5 C7)`), branch `claude/feature-v1-1-p5-onwards-2isfzt`, on macOS
(arm64, system WebKit).

Deliberately **not** filed in `docs/PERF.md` — that file is the standing performance record, and
this is a single closed investigation whose conclusion is "not ours to fix".

> **Revision note (2026-09-02).** The first pass of this document was measured with `vmmap` and
> reached the right conclusion through wrong numbers. `vmmap` suspends the target task and takes
> ~0.5–1 s on a large process; it was being used to sample a phenomenon that changes on a
> sub-second timescale, and the resulting run-to-run spread (~±50 %) was larger than most of the
> effects being claimed. Every figure below has been re-measured with `proc_pid_rusage`; §2.1
> records the difference. Four specific claims from the first pass were **refuted** and are marked
> as such where they appear, rather than deleted — each is a conclusion someone could plausibly
> re-derive.

---

## 1. The symptom

Reported from the running app: idle ≈ 100 MB, and loading a 1 000-row page pushes it to ≈ 600 MB.
In Electron the same action cost very little. The initial hypothesis offered with the report — that
it had something to do with how elements are rendered by the GPU — turned out to be correct, and
is what §4 confirms.

Two details from the report shaped the whole investigation and are worth recording, because
without either one the measurements below show nothing at all:

- **The trigger is scrolling, not loading.** Every measurement taken at scroll position 0 shows
  no growth whatsoever.
- **It climbs while scrolling continues**, rather than jumping once. §5.4 explains why: the
  plateau is a function of velocity and takes ~1–2 s of continuous scrolling to reach.

§5.4's velocity ladder reproduces the reported number exactly: at realistic trackpad velocities
(40–100 px/frame ≈ 1 200–3 600 px/s) the peak lands at **459–644 MB**. The user's "600 MB" is that
band, not an artifact.

## 2. Instrument

`docs/PERF.md` §2.3 and P5 §1/F1 both record that no real RSS number for the shipped app had ever
been obtainable — no macOS hardware in the sandbox, and `tests/ui`'s WebKit tier exposes no heap
API. This investigation ran on real macOS hardware, so both constraints are lifted.

- A ~40-line Swift host (appendix A) that puts a real `WKWebView` in a real 1440×960 `NSWindow`,
  loads a URL, and reports its own web process id via `_webProcessIdentifier`. Reporting the pid
  is what makes the measurement exact — `pgrep`-based discovery misattributes badly, because
  WKWebView's helpers are reparented to `launchd` and other apps' `com.apple.WebKit.*` processes
  (and this app's own leftovers from a previous run) are indistinguishable by name. This is the
  same over-match hazard `internal/metrics`'s own `AppProcessSet` doc comment describes.
- `proc_pid_rusage(RUSAGE_INFO_V2)` polled at 4 Hz for `ri_phys_footprint` — see §2.1.
- Full `vmmap <pid>` for the per-region `REGION TYPE` breakdown only (§4), never for the
  time series.
- The **real backend**: `go build -tags server`, a real SQLite file, real FlatBuffers frames over
  the real bridge — the `tests/e2e-real` arrangement, driven by injected JS rather than Playwright
  so the renderer is a genuine WKWebView rather than Chromium.

Fixture: a 100 000-row SQLite table, 21 columns (`id` + 20 × `TEXT`), ~34 chars per cell, opened
at page size 1 000. Sizer 5 070 × 28 028 px; 43 rows / 387 cells rendered at any moment (both
axes are virtualised).

### 2.1 Why `vmmap` was the wrong instrument

`vmmap` suspends the target task and takes ~0.5–1 s on a process this size, and the transient it
was being used to measure resolves in seconds. Sampling that with a slow, intrusive probe and then
taking `max` over an unequal number of draws per run produces both undercounts and
irreproducibility.

`proc_pid_rusage(RUSAGE_INFO_V2)` — the same call `internal/metrics/probe_darwin.go` itself uses —
is non-intrusive and costs microseconds, so it can be polled at 4 Hz. Replicate runs of an
identical configuration land at **1038.4M and 1039.1M (0.07 % spread)**, against the first pass's
~50 % spread across its own same-config runs.

This matters for reading the first pass: its `+296.7M`, `+441.9M` and `+462.1M` figures appear in
three different sections as though they were three different experiments. They are the same
experiment measured three times.

### 2.2 The process set

`_webProcessIdentifier` captures WebContent only. Grouping by shared *responsible pid* — which is
what `internal/metrics`'s `AppProcessSet` actually does — also surfaces a `com.apple.WebKit.GPU`
and a `com.apple.WebKit.Networking`. GPU moves 13M → 56M during scroll. Small enough that the
focus on WebContent was directionally right, but the first pass never checked.

## 3. Baseline — the real app

Total across the process set, physical footprint:

| when | total | WebContent alone | Go |
|---|---|---|---|
| grid open, 1 000 rows, idle | 167.3M | — | 28.8M |
| **plateau during sustained scroll** | **1038.4M** | 953.2M | 28.8M |
| settled after scrolling stops | 233.5M | — | 28.8M |

> **Refuted.** The first pass reported a 360.8M peak while explaining a 600 MB symptom, and never
> reconciled the ~200 MB gap. The gap was the instrument (§2.1); the real peak is 2.6× higher than
> it recorded.

Two things are ruled out here:

- **The Go backend is not involved.** It sits flat at ~28 MB throughout. The L2 page cache's
  64 MB budget (`enginecache/pages.go`) is never the constraint at this size.
- **It is not a leak.** It releases within ~2 s of scrolling stopping.

The renderer's own JS retention is also innocent, and the app's own P5 C1 probe says so directly.
Across four full scroll passes `window.__kiraRetention` reported `decodeCacheRows: 43` — pinned
to the visible window, exactly as `views/shared/page/store.ts`'s `setVisibleWindow` pruning
intends — with `decodeCacheChars` moving only 10 661 → 26 967. Whatever grows, it is not the
decode cache.

## 4. Where the memory actually goes

Full `vmmap` region breakdown of the WebContent process at a sustained plateau:

| REGION TYPE | delta idle → plateau |
|---|---|
| **owned unmapped (graphics)** | **+1230.8M** |
| WebKit Malloc | +144.5M |

`owned unmapped (graphics)` is CoreAnimation / IOSurface backing store — GPU-side surfaces owned
by the web process — and it dominates. `WebKit Malloc`, the region holding the DOM, the render
tree and the JS heap, moves comparatively little.

**Caveat this table needs.** The region deltas (+1370M) *exceed* the footprint delta (+839.8M),
because purgeable graphics pages are accounted differently by the two facilities. This is a
statement about which region grows, not a clean decomposition of the footprint number. The first
pass treated it as the latter.

So the growth is compositing memory, not data, not DOM, not JS.

## 5. Hypotheses tested and rejected

Every one of these was a plausible app-level cause. All were measured on the real app with the
§2.1 instrument, by injecting CSS overrides at runtime so no rebuild sits between baseline and
variant. Baseline peak for this series: **1195.8M**.

They are recorded because each represents a change someone will otherwise propose again.

### 5.1 `contain: layout` on `.grid-row` — rejected

`DataGrid.vue`'s `.grid-row` carries `contain: layout` (P29 D8). Removing it:

| | peak |
|---|---|
| baseline | 1195.8M |
| `contain: layout` removed | 1155.6M |

No effect. It is not a lever in either direction.

> **Refuted.** The first pass measured 926.0M here against a 360.8M baseline and concluded
> `contain: layout` was "load-bearing — a substantial memory optimisation that must not be
> removed". That was instrument noise (§2.1). The declaration is harmless and worth keeping on
> layout grounds, but **no memory argument supports it** and nobody should cite one.

### 5.2 `position: sticky` on the per-row `.gutter-cell` — rejected

43 sticky elements, one per rendered row, is a genuine compositing smell. Making them
`position: absolute`: **1263.9M** vs 1195.8M — 6 % worse. Not the driver. Restored.

Also tested, new: `.header-row` sticky → absolute, **1381.6M**. Worse. No lever.

### 5.3 `top`/`left` vs `transform` — unproven

The grid positions with `top`/`left`; `transform` is the alternative. The first pass measured
three runs each (`top`: 212.4M, 202.2M, 189.2M; `translate3d`: 184.4M, 212.6M, 306.8M) and called
it "no consistent difference". Given §2.1, that spread cannot resolve anything either way. Not
re-tested with the good instrument, because §6 makes it moot — there is no headroom for it to
recover.

### 5.4 Sizer size — rejected; **the real variable is velocity**

The first pass held step count constant at N=60 and varied sweep distance — which moved distance
and *velocity together*, and then attributed the entire result to distance. Separating them:

| velocity (px per frame-pair) | distance swept | peak |
|---|---|---|
| 40 | 5 000 px | 469.0M |
| 40 | 27 360 px | 458.9M |
| 456 | 5 000 px | 565.7M |
| 456 | 27 360 px | 1039.1M |

At constant velocity, **5.5× the distance changes nothing** (469.0M vs 458.9M). At constant
distance, **velocity alone moves the peak 2.3×**.

The mechanism: WebKit's tile coverage rect expands with scroll velocity, so velocity sets the
steady-state tile working set. Reaching it takes ~1–2 s of continuous scrolling.

> **Refuted.** The first pass's "the sizer's size is irrelevant; distance travelled is everything"
> gets the right verdict on sizer size for the wrong reason, and names the wrong variable. Its
> "run D is the control" is not a control — it confounds distance with velocity.

This also invalidates the first pass's driver as a proxy for user behaviour: 456 px/frame is a
~13 700 px/s teleport no human produces. The realistic band is §1's 40–100 px/frame.

### 5.5 Painted content width — rejected

Empty div at 1148 px wide: **+423M**. At 5070 px: **+427M**. Content width does not matter.
(Confirms the first pass's verdict, now without the noise.)

### 5.6 `@tanstack/vue-virtual` vs the pre-P47 hand-rolled virtualizer — rejected

Not one of this document's own measured hypotheses — added after the fact, prompted by a report
that `DataGrid.vue`'s P47 migration to `@tanstack/vue-virtual` (§7's git-history note already
covers the Electron→Wails rename, not this) might be the WKWebView-specific driver, since Electron
never carried it.

`DataGrid.vue` and `columns.ts` were reverted to the pre-P47 hand-rolled `rowRange`/`colRange`
index math (binary search + linear overscan walk, a plain `ResizeObserver`-backed
viewportHeight/viewportWidth, no `useVirtualizer`), rebuilt, and put through the same scroll
session as every other run in this doc. `@tanstack/vue-virtual` itself was left installed
(`ConsoleResultGrid.vue`'s own column virtualizer, added later in P49, still uses it and was not
touched) — only `DataGrid.vue`'s consumption of it was removed, so this isolates the library's
row/column windowing from everything else P47 touched.

**No improvement.** Reverted to the untouched build after confirming this.

This is consistent with §4 and §7's own conclusion, not a surprise in hindsight: the growth is
`owned unmapped (graphics)` — CoreAnimation/IOSurface tile backing store WebKit's compositor
allocates for the scrolled area — and neither virtualizer implementation changes what gets
painted, how many DOM nodes exist at steady state, or the scroller's own compositing setup. Both
compute the same visible index window from the same `scrollTop`/`scrollLeft`; swapping the index
math changes nothing upstream of paint. Recorded so nobody re-proposes de-virtualizing or
re-virtualizing the grid on a memory theory — the lever isn't in this layer at all (§7's own list
of remaining avenues stands unchanged).

## 6. What the app actually costs

Sustained scroll, matched velocity and width, good instrument:

| what was scrolled | peak WebContent | delta |
|---|---|---|
| empty `<div>`, w=5070 | 505.4M | +427M |
| plain non-virtualised rows, w=5070 | 989.3M | +910M |
| **Kira grid** | 1101–1136M | **+980–1015M** |
| plain rows, **main-frame scroller** | 1531.8M | +1453M |

Two things fall out:

1. **Painting any content roughly doubles the cost of an empty scroller.** That step — +427M to
   +910M — is the price of having pixels at all, not of having *these* pixels.
2. **The grid sits ~11 % above the cheapest content-painting scroller**, while painting 387 cells
   with borders against 60 plain text divs. That 11 % is the entire app-attributable headroom.

> **Refuted.** The first pass claimed an empty div "costs about as much as the real grid"
> (+375.8M vs +441.9M) and that the grid is *cheaper* than naive non-virtualised rows
> (+441.9M vs +695.6M, "the virtualisation working"). Correctly measured, the empty div costs
> **less than half** the grid, and the grid is slightly *more* expensive than plain rows. The
> conclusion survives — but on the ladder above, not on that comparison, which was the first
> pass's load-bearing inference and is false as stated.

### 6.1 Things checked because they were the obvious gaps

- **Ancestor compositing:** no `will-change`, `transform`, `opacity`, `filter` or
  `backdrop-filter` anywhere above `DataGrid.vue`. The `position: fixed` hits are all popovers,
  dialogs and tooltips — none is an ancestor of the scroller.
- **Window opacity / vibrancy:** `internal/shell/window.go` sets an opaque `BackgroundColour`
  RGB(24,24,27), no transparency, no `NSVisualEffectView`. There is no non-opaque-tile 2× penalty
  to recover.
- **Inner vs main-frame scroller:** tested, and it goes the *other* way. Main-frame scrolling is
  **1.5× worse** (1605M vs 1061M). The current inner `overflow` scroller is already the cheaper
  architecture; converting to a main-frame scroller would be a regression.

## 7. Conclusion

The cost is WKWebView's tile behaviour for a scrolled area: the coverage rect expands with
velocity, retired tiles return to a pool drained on an idle timer, and during sustained scrolling
allocation outruns reclamation. This holds a ~1.0–1.2 GB plateau **for as long as scrolling
continues** — held for 30 s in testing, so "transient spike" is the wrong description — and
collapses to ~170M within ~2 s of stopping.

**There is no fix available in `DataGrid.vue` or anywhere else in the frontend**, and §6 is why:
the app is within ~11 % of the floor for any scroller that paints content at all.

This also explains the Electron comparison without a regression in this codebase. Git records the
migration as **R100** — a 100 % similarity rename, `src/renderer/views/grid/DataGrid.vue` →
`apps/kira-studio/frontend/src/views/grid/DataGrid.vue` (`e9f2c78`). The full pre-vs-post diff is
**one line**, unrelated to scrolling. The tall-sizer + `overflow:auto` + absolutely-positioned-rows
architecture, `contain: layout` and the sticky gutter all predate the migration (`a6cff9e`
2026-08-22, `86bc96f` 2026-08-24); page-size default was 100 before and after; the Electron
`BrowserWindow` was opaque and framed, with no `transparent` or `vibrancy` anywhere in history.
The comparison is genuinely apples-to-apples on app code, so "Chromium's tile manager enforces a
hard budget and evicts aggressively; WebKit's pools retired tiles and frees them on an idle timer"
is the remaining explanation.

> **Update (P22, 2026-09-02).** This section's caveat and its three-item avenue list were written
> before either avenue had actually been tried. `docs/v1.1/plans/P22-webview-scroll-performance.md`
> picked both up; its own §3 (F8–F14) and §5 (D5, D6) are now the fuller record, cited below rather
> than reproduced whole.

**The caveat, corrected with real numbers (P22 F13).** Recovered from `18fe7bb^:src/main/window.ts`
(deleted by the Electron-to-Wails cutover, `18fe7bb`): Electron's `BrowserWindow` passed no explicit
`width`/`height` — so its own 800×600 default, clamped up by `minWidth: 900, minHeight: 600` — against
Wails' unconditional `Width: 1280, Height: 800`. That is a **first-launch-only 1.90×** (900×600 =
540 000 px² vs 1280×800 = 1 024 000 px²), and a *floor* ratio of only **1.21×** (900×600 vs Wails'
1024×640 minimum). Both restore bounds the same way, on the same 300 ms debounce. Smaller than this
section originally implied, and worth stating plainly rather than left as "min 900×600."

**The premise itself, checked (P22 F14).** "Cost scales with viewport area" was asserted here, not
measured — every figure in this document was taken in one 1440×960 `NSWindow` (Appendix A); §5.5
varied painted content *width* inside that fixed viewport, which is a different variable, and there
is no run anywhere in this document at two window sizes. It is a mechanism-level inference from §7's
own tile-coverage-rect explanation, not one of this investigation's measurements. A run that would
settle it: the Appendix A harness at two `NSWindow` sizes with everything else held constant,
`proc_pid_rusage(RUSAGE_INFO_V2)` polled at 4 Hz (never `vmmap` — §2.1), and velocity held fixed
while area varies (§5.4's own confound, applied to the other axis this time). Not run — no macOS
hardware in the P22 implementing sandbox either. §9 carries this forward as still unverified.

**Remaining avenues, now closed** — one acceptance and two dispositions, not three open questions:

1. **Accept it.** Unchanged (D8). It is self-releasing, and the app is within 11 % of the floor
   for any scroller that paints content at all.
2. **Embedder-level configuration — declined.** P22 D5, on F8–F11: Wails v3.0.0-beta.16's entire
   macOS webview surface is ten fields, none a tiling knob; the `WKWebViewConfiguration` is built
   inside one cgo block with no hook; macOS is the one platform with no engine-flags escape hatch;
   and the one reachable escape hatch (`NativeWindow()` → Wails' private ObjC class) is declined —
   an unexported-layout dependency to reach a knob that, per this document's own §7, is largely
   private WebKit API to begin with. A bounded real-Mac SPI-header grep is recorded as still
   pending in `docs/ARCHITECTURE.md`'s renderer-security-surface section; the decline does not wait
   on it.
3. **Default window size — implemented, but as UX, not as this avenue's memory fix.** P22 D6:
   `internal/shell/window.go`'s first-launch default is now a screen-aware clamp that can only ever
   *shrink* 1280×800 to fit a smaller primary screen, justified because an unconditional 1280×800
   window is edge-to-edge on a same-size laptop panel — a real bug independent of anything measured
   here. Its effect on this document's plateau is real but **first-launch-only** (F12: any window
   that has ever been resized never sees the default again) and **unmeasured in magnitude** (F14,
   above) — nobody should cite it as the fix for the reported symptom. `MinWidth`/`MinHeight` were
   left unchanged (D6(b)): the 1.21× floor ratio isn't worth the usability cost of a smaller floor.

Full findings and citations: `docs/v1.1/plans/P22-webview-scroll-performance.md` §3 (F8–F14) and §5
(D5–D8).

### 7.1 `internal/metrics` — no change needed

> **Refuted.** The first pass claimed "the one thing worth acting on" was that `Sampler` sums RSS
> across the process set every 5 s and so presents a high-water peak as a current reading. Both
> premises are false.

- **It does not sum RSS on darwin.** `probe_darwin.go` uses `ri_phys_footprint`; the package doc
  comment says so and says why (it excludes the shared pages RSS double-counts across the process
  set).
- **It retains no peak.** `Sampler.Sample()` returns an instantaneous sum; `Interval` is 5 s.
  There is no max, no high-water mark, no smoothing.

And the reading is *correct*: during sustained scrolling the true footprint really is ~1 GB for
the whole duration, so a 5 s tick reporting 600 MB is reporting a current value accurately. The
only genuine artifact is ordinary polling staleness — after a single short fling the display can
lag by up to 5 s — which is inherent to any polled display.

## 8. What this closes

- P5's §0.1 note that total RSS "is dominated by the webview framework, not by app allocations"
  is confirmed on real hardware, with a region-level breakdown rather than an inference.
- P5 F1's "could not: a real RSS number for the shipped app" is answered for this scenario.
- The renderer-side retention P5 fixed (C1–C7) is confirmed still holding: `decodeCacheRows`
  stays pinned at the visible window across repeated full-page scrolls (§3).

## 9. Still unverified

**Real trackpad / momentum scrolling.** Every measurement here drives scrolling programmatically.
A `CGEventCreateScrollWheelEvent` injector was built, but the posted events never reached the
webview (memory stayed flat at 120M through 1800 events) — `CGEventPost` needs an
Accessibility/TCC grant the harness process does not have. §5.4's velocity ladder is a proxy, and
its realistic-velocity band matches the reported symptom, but WebKit's momentum-scroll code path
is genuinely untested.

**The area ladder behind §7 avenue 3's premise (P22 F14).** "Cost scales with viewport area" is
asserted here, not measured — every figure in this document came from one 1440×960 `NSWindow`. §7
records what a run to settle it looks like (Appendix A's harness at two window sizes, velocity held
fixed, `proc_pid_rusage` not `vmmap`); not run, in either this document's original investigation or
P22's implementing pass. Until it exists, no number for avenue 3 should be quoted as measured.

---

## Appendix A — the harness

Built in a scratch directory, not committed; reproduced here so the measurement can be rerun.

```swift
// wkhost.swift — swiftc -O -o wkhost wkhost.swift
// usage: ./wkhost <url> <hold-seconds> [js-file]
import Cocoa
import WebKit

let args = CommandLine.arguments
let urlString = args.count > 1 ? args[1] : "about:blank"
let holdSeconds = args.count > 2 ? Double(args[2]) ?? 25.0 : 25.0
let jsPath = args.count > 3 ? args[3] : ""

func log(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!

    func applicationDidFinishLaunching(_ n: Notification) {
        let rect = NSRect(x: 0, y: 0, width: 1440, height: 960)
        window = NSWindow(contentRect: rect,
                          styleMask: [.titled, .closable, .resizable],
                          backing: .buffered, defer: false)
        web = WKWebView(frame: rect, configuration: WKWebViewConfiguration())
        web.navigationDelegate = self
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.load(URLRequest(url: URL(string: urlString)!))
    }

    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        // Exact attribution: pgrep-based discovery misattributes other apps' WebKit helpers.
        if let v = w.value(forKey: "_webProcessIdentifier") as? Int32 { log("WEBPID \(v)") }
        log("LOADED")
        guard !jsPath.isEmpty, let js = try? String(contentsOfFile: jsPath, encoding: .utf8) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) {
            w.evaluateJavaScript(js) { _, err in if let e = err { log("JSERR \(e)") } }
        }
        // The driver publishes phase markers through document.title.
        var last = ""
        Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
            w.evaluateJavaScript("document.title") { r, _ in
                if let t = r as? String, t != last { last = t; log("TITLE \(t)") }
            }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
DispatchQueue.main.asyncAfter(deadline: .now() + holdSeconds) { NSApp.terminate(nil) }
app.run()
```

**Procedure**

1. Seed a SQLite file with the fixture table (100 000 rows × 21 columns).
2. `bun run build && (cd apps/kira-studio && go build -tags server -o bin/kira-server-test .)`
3. Run it with `KIRA_HOME` pointed at a temp dir, `WAILS_SERVER_HOST=127.0.0.1`,
   `WAILS_SERVER_PORT=<port>` — then **poll `/` until it returns 200**. It can take 2–25 s
   depending on cache state; a fixed `sleep` produces a silent no-op run where the page never
   loads and every later reading is empty. (`tests/e2e-real/fixtures.ts` polls `/health`, but
   there is no `/health` handler in the Go sources — `application.AssetFileServerFS` answers 200
   for unknown paths, so that poll works by SPA fallback rather than by design. Poll `/`.)
4. `./wkhost http://127.0.0.1:<port> 240 driver.js`, where `driver.js` walks the tree
   (click the connection row's `.twisty` — `onToggle` → `expand()` connects, so no context menu
   is needed), opens the table, clicks `[data-testid="page-size-1000"]`, publishes
   `MARK-idle` via `document.title`, runs the 60-step scroll pass, then publishes `MARK-scrolled`.
5. Poll `proc_pid_rusage(<WEBPID>, RUSAGE_INFO_V2)` for `ri_phys_footprint` at 4 Hz across
   the whole run — **not** `vmmap` (§2.1). Use `vmmap` only once, at a sustained plateau, if you
   want the `REGION TYPE` breakdown.
6. Scroll *sustained*, and parameterise **velocity** separately from distance (§5.4). Holding
   step count constant while varying distance measures velocity and mislabels it as distance.

**Pitfalls worth not rediscovering**

- Measuring at scroll position 0 shows nothing. The scroll pass is the experiment.
- **Do not use `vmmap` for the time series.** It suspends the target task and takes ~0.5–1 s on a
  large process, which is the same order as the phenomenon. It undercounted the real peak by 2.6×
  and produced a ~50 % run-to-run spread that swamped most of §5's effects (§2.1). Use
  `proc_pid_rusage(RUSAGE_INFO_V2)`; replicates then agree to 0.07 %.
- Velocity, not distance, sets the plateau. An experiment that varies distance at a fixed step
  count is varying velocity.
- The isolated structural replica built early in this investigation (a hand-written imitation of
  `DataGrid.vue`'s DOM and CSS) pointed at a `sticky` × `contain` interaction as the cause. That
  was **wrong** — neither survived §5.1/§5.2 on the real app. Its toggles were also changing
  painted area. Do not trust a replica here; measure the real grid.
- Injecting CSS overrides at runtime beats rebuilding between baseline and variant: it removes a
  rebuild, a relaunch and a cold-cache difference from between the two numbers being compared.
