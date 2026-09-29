# P139 Part 2 — cached tab switch regression, iteration 2 (no tab caching): plan

Iteration 2 of `docs/v2.0/SPEC.md`'s **P139 Part 2** row. Iteration 1:
`P139-part2-tab-switch-regression.md` (§1 measurements, §2 root cause). Its fix (per-tab
`KeepAlive`) is **rejected by the user: no tab caching, no keep-alive.** This pass investigates the
WebKit side (option E): can a real remount get under 50 ms p95?

Probed against chapter commit `035bbbeb` in a scratch worktree. Line numbers are at that commit.

**Status: in progress. Findings below are measured; design sections not yet written.**

## 1. Measured findings (WebKit, `ui` project engine)

Method: probe spec seeded from `budgets.spec.ts` setup (big_rows open, cell editor open, wide_table
in 2nd tab). In-page microbenchmarks, median of 8-10, each op followed by `document.body.offsetWidth`.
Tab switch: iteration 1 method (`click()` to header cell in DOM, `MutationObserver`), 20 switches,
plus click to 2nd rAF. Probe code never committed.

### 1.1 Environment

- UA `Version/26.6 Safari/605.1.15` (Playwright WebKit, libWPEWebKit). JS JIT on (5e7-iteration
  loop 251 ms).
- 683 elements: `main-view` 432, `data-grid` 252, `cell-editor-panel` 78, tree 155.
- 5 sheets: app CSS `index-*.css` (1 710 style rules, 68 `@property`, 48 `@supports`, 48 `:has()`),
  `monacoEntry-*.css` (1 222), `style.monaco-colors` (937), 2 small `<style>`.

### 1.2 Stylesheet op cost (baseline)

| Op | WebKit ms |
|---|---|
| layout read only | 0 |
| append `<style>` with text (one class rule) | 2-3 |
| remove a `<style>` | 53-61 |
| set `CSSStyleRule.style.left` | 49-64 |
| custom property on `:root` | 69-97 |
| custom property on `data-grid` (252 els) | 10-18 |
| append `<style>` inside a shadow root (100 els) | 1 |
| set rule `style.left` inside a shadow root | 0 |

Correction to iteration 1 §1.7: appending a `<style>` that already holds its text is **cheap** (2-3
ms). WebKit takes the additive path: it invalidates only elements the new selectors match. Removing a
sheet or mutating a rule forces a full-document rebuild. SlickGrid does both on every mount: its old
grid's `<style>` removal, then `createCssRules` appends an empty `<style>` and `insertRule`s into it
(mutation), then `applyColumnWidths` sets `rule.style.left/right` (mutation).

Shadow-root sheets are scoped on WebKit: mutation cost 0-1 ms.

### 1.3 What makes a full recalc cost ~55 ms: per-sheet bisect

Rule mutation cost with one sheet disabled at a time:

| Disabled | ruleMutate ms |
|---|---|
| none | 55-63 |
| app `index-*.css` | 16 |
| `monacoEntry-*.css` | 54 |
| `monaco-colors` | 53 |
| either small `<style>` | 55-56 |
| all 5 | 5 |

Hiding regions (`display: none`, rule mutation ms): `main-view` 29, `data-grid` 44, cell editor 45,
tree 60. Cost scales with styled elements times per-element cost; the app sheet sets the
per-element cost.

### 1.4 Inside the app sheet: which rules (fresh page per row)

Rules deleted from every sheet, then ruleMutate / gridVar / tab switch:

| Deleted | ruleMutate ms | `data-grid` var ms | switch p50 / p95 ms |
|---|---|---|---|
| nothing (per-run baseline) | 49-64 | 10-13 | 279-323 / 324-414 |
| 1 `@supports` block: Tailwind's `@property` fallback | **31** | 4 | **190 / 264** |
| all 47 `@supports` blocks | 29 | 5 | 202 / 262 |
| 45 `color-mix` `@supports` blocks | 57 | 10 | 294 / 448 |
| 68 `@property` rules | 46 | 10 | 265 / 318 |
| 48 `:has()` rules | 53 | 12 | 291 / 408 |
| 154 rules with a universal rightmost compound | **19** | 2 | **148 / 177** |

**Root finding.** Tailwind v4 emits `@layer properties { @supports (((-webkit-hyphens:none)) and (not
(margin-trim:inline))) or (…) { *, ::before, ::after, ::backdrop { --tw-*: … } } }`: a fallback for
engines without `@property`, detected as "WebKit without `margin-trim`". This Playwright WebKit build
reports `CSS.supports('margin-trim: inline') === false`, so the fallback is live. Every element and
pseudo-element then carries ~68 `--tw-*` custom properties. That doubles per-element style cost here
(ruleMutate 55 to 31 ms without it). A second copy sits in one Vue scoped style
(`[data-v-f7649ec7], …::backdrop`, inner rules 2).

Safari has shipped `margin-trim` since 16.4, so real macOS WKWebView should not match this fallback.
Not verifiable here (§6).

### 1.5 Option E experiments: tab switch with a real remount

Every row below remounts `DataView` and SlickGrid on each switch (no caching). "Single build" is
`ba41ec3f` (columns built once per mount), applied in every row after the first. "Vars" is a probe
of §3.1's design: `KiraSlickGrid` overrides `createCssRules`/`removeCssRules`/`applyColumnWidths`;
column `left`/`right` read `var(--ks-l<i>)`/`var(--ks-r<i>)` from one static sheet appended once
(additive path), values set as custom properties on the grid container. No per-grid sheet, no rule
mutation. Header/cell lefts checked equal. "No TW fallback" deletes the one `@supports` block of
§1.4 at runtime.

| Engine | Variant | to DOM p50 / p95 ms | to 2nd rAF p50 / p95 ms |
|---|---|---|---|
| WebKit | `035bbbeb` baseline | 279-341 / 324-494 | 338-399 / 401-549 |
| WebKit | single build | 192-218 / 233-262 | 246-268 / 278-330 |
| WebKit | single build + CSS containment (`contain: strict`, `layout style paint`, `content-visibility: auto`, `will-change`; on `main-view`, `data-grid`, all regions) | 170-220 / 214-317 | 229-270 / 266-407 |
| WebKit | single build + vars | 133-139 / 170-212 | 170-183 / 227-247 |
| WebKit | single build + vars + no TW fallback | **99-106 / 136-162** | 140-157 / 204-235 |
| Chromium | single build | 49-52 / 67-71 | 65-70 / 88-99 |
| Chromium | single build + vars | **46-50 / 58-62** | 54-64 / 75-83 |

Containment changes nothing measurable: the stylesheet-change microbenchmarks stay at 51-71 ms under
every variant. WebKit's full rebuild restyles every element whatever the containment; `contain`
scopes layout and paint only.

Shadow root (candidate 2): a sheet appended or mutated inside a shadow root costs 0-1 ms (§1.2).
It would work, but needs the grid's whole subtree in a shadow tree with every app sheet adopted
into it, and every `document.querySelector` on grid DOM (app code, specs, measure helpers) changed.
"Vars" gets the same scoping with no shadow tree, so the shadow root is declined.

### 1.6 Where a remount spends time after the fixes

Marks in `DataView`/`SlickGridHost` setup, mount and unmount, median of 16 switches, ms from click:

| Stage | WebKit, vars + no TW fallback | Chromium, vars |
|---|---|---|
| click to `DataView` setup | 7 | 3 |
| `DataView` setup to `SlickGridHost` setup | 18 | 13 |
| `SlickGridHost` setup to old-tab unmount start | 19 | 12 |
| old `SlickGridHost` + `DataView` unmount | 3 | 1 |
| `new KiraSlickGrid(...)` | 30 (10-53) | 3 |
| `grid.init()` | 29 (10-51) | 11 |
| `grid.render()` | 5 | 2 |
| rest of `onMounted`, observer resolve | 9 | 6 |
| **total** | **113** | **47** |

Vue component work (setup, render, DOM create, unmount): ~47 ms WebKit, ~29 ms Chromium. SlickGrid
self time per switch, WebKit, vars + no TW fallback: `getViewportWidth` 8.7 (3 calls, forced
layout), `getMaxSupportedCssHeight` 6.9 (1 call, forced layout, constant per engine),
`handleScroll` 4.4, rest < 2 each. `new KiraSlickGrid` includes the first style and layout of the
new `DataView` subtree (`initialize` reads `getComputedStyle` on the container).

**A remount cannot reach 50 ms p95 on this 4 vCPU sandbox, on either engine.** Chromium, with no
stylesheet penalty at all, measures p95 58-62 ms for the same remount; Vue work alone is ~29 ms of
it.

### 1.7 Final design in the real spec

Probe build = `035bbbeb` + `ba41ec3f` + "vars" (§3.2) + Tailwind fallback dropped at build time by
§3.3's PostCSS plugin (built CSS: 0 `margin-trim` hits). Unmodified `budgets.spec.ts`,
`--project=ui-timing --no-deps -g "interaction budgets" --repeat-each=3`, load average 0.96:

| Metric | p50 ms | p95 ms |
|---|---|---|
| cell to editor | 17-18 | 29-36 |
| cached tab switch | **84-91** | **126-151** |
| cached tree expand | 18-19 | 25-27 |
| console keystroke (`.visible` selector, unfixed) | 112-113 | 117-149 |

All 3 passed, `consoleErrors` empty. Same probe build: `--project=visual` 14/14 pass (no pixel change
from the dropped fallback); `slick-grid.spec.ts` + `console*` specs 41/43 pass. The 2 failures are the
per-grid `<style>` leak checks (`slick-grid.spec.ts:534`, `:663`): the static sheet survives
teardown by design (§3.6 rewrites them). With the fallback gone, WebKit still resolves
`--tw-border-style` to `solid` on a `.border` element: `CSS.registerProperty` exists and
`@property` initial values apply.

`getMaxSupportedCssHeight` cached per page (constant per engine): p50 99-105 / p95 122-200 versus
102-112 / 135-148 without. Inside noise; declined.

### 1.8 Revert dry run

Throwaway worktree off `p139-part2-plan` HEAD (`ba41ec3f` on top): `git revert --no-commit` of
`b700f108`, `23d8d080`, `22ed279f`, `6213106c`, in that order, applies without conflict. The result
diffs against `035bbbeb` exactly as `ba41ec3f` alone does (apps and packages trees).

### 1.9 Sandbox WebKit versus shipping WKWebView

The product ships macOS 14+, arm64 only (ARCHITECTURE.md Shell row): WKWebView, Safari 17+ engine.

Knowable here:

- The mechanism is WebCore, not port code. A sheet removal or CSSOM rule mutation schedules a
  full-document style rebuild; an appended sheet with its text in place takes the additive path. WPE
  and WKWebView share that code, so SlickGrid's per-grid sheet costs a full rebuild per mount on a Mac
  too. Only the per-rebuild cost differs.
- The Tailwind fallback (§1.4) needs "WebKit without `margin-trim`". Safari 17 has `margin-trim`, so
  the fallback is dead CSS on the shipping target. Only this sandbox engine matches it.
- Chromium, same sandbox, same remount: p95 58-75 ms (§1.5, §1.6). The 4 vCPU sandbox cannot hold a
  full `DataView` remount under 50 ms p95 even with no stylesheet penalty.

Not knowable here: the absolute rebuild cost and remount time on Apple Silicon WKWebView. PERF.md
§2.1's Mac figures (tab switch p95 6.5 ms) predate `SlickGridHost.vue` and the Wails port.

Verify on a Mac (PERF.md §3 manual procedures, packaged build, Web Inspector timeline):
`CSS.supports('margin-trim: inline')` is `true`; tab switch between `big_rows` and `wide_table`,
median and p95 of 20; count of full style recalcs per switch in the timeline (expect none from
SlickGrid after §3.2).
