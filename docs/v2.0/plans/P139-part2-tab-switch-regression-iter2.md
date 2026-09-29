# P139 Part 2 — cached tab switch regression, iteration 2 (no tab caching): plan

Iteration 2 of `docs/v2.0/SPEC.md`'s **P139 Part 2** row. Iteration 1:
`P139-part2-tab-switch-regression.md` (§1 measurements, §2 root cause). Its fix (per-tab
`KeepAlive`) is **rejected by the user: no tab caching, no keep-alive.** This pass investigates the
WebKit side (option E): can a real remount get under 50 ms p95?

Probed against chapter commit `035bbbeb` in a scratch worktree. Line numbers are at that commit.

**Status: plan complete, ready to implement. No tab caching anywhere.**

**Discovery method, disclosed.** `codegraph_explore` (plan worktree index) ran before `Read`/`grep`
for `SlickGridHost` mount, `KiraSlickGrid`, `rebuildAndSetColumns` and the `budgets.spec.ts` measure
helpers. SlickGrid 5.20 and Tailwind 4.3.3 internals read from `node_modules` (not indexed).
Measurements come from an uncommitted probe spec, probe patches and a probe Playwright config in a
scratch worktree at `035bbbeb`, removed at the end. 4 vCPU; WebKit = Playwright `webkit-2359`
(libWPEWebKit, `ui`/`ui-timing` engine); Chromium `headless_shell-1194` for comparison only.

## 0. Open points (for the orchestrator/user)

1. **50 ms p95 is not reachable by a real remount in this sandbox, on either engine.** Best measured
   (§1.7, real spec): WebKit p50 84-91 / **p95 126-151 ms**, from p50 311-318 / p95 436-447. Chromium,
   no stylesheet penalty at all: p95 58-75 ms (§1.5). Vue component work alone is ~47 ms WebKit, ~29
   ms Chromium (§1.6). Options:
   - **A (recommended, this plan):** land §3's fixes; gate tab switch at a documented WebKit
     sandbox bound, **p95 <= 250 ms**, plus a deterministic guard: zero `<style>`/`<link>` churn
     and zero per-grid SlickGrid sheets during the 20 switches (§3.6). PERF.md records the numbers
     and the reason.
   - **B:** A, then a follow-up phase to cut `DataView`/`SlickGridHost` Vue setup and mount cost
     (§1.6: ~47 ms WebKit). Unmeasured gain; unlikely to reach 50 ms p95 on WebKit here.
   - **C:** measure on a Mac (§1.9) before deciding. If real WKWebView holds 50 ms, keep the 50 ms
     product budget in PERF.md §1 and gate only the sandbox at 250 ms.
   - Tab caching: rejected by the user. Listed only because it is the one measured route under 50
     ms (iteration 1 §1.8: 8-9 ms p95). Not in this plan.
2. **Tailwind `@property` fallback dropped from both apps' CSS (§3.3).** Build-wide change in the
   shared `viteAppConfig.ts`. Dead CSS on the shipping engine (macOS 14+ has `margin-trim`); live
   only in this sandbox's WebKit. Worth p95 ~35-50 ms here (§1.5, vars rows). If the user prefers no
   product CSS change for a sandbox effect, drop §3.3 and raise the tab switch bound to 300 ms (vars
   alone: p95 170-212).
3. **First open.** A data tab's first open now pays the same remount (~85-110 ms p50 here) plus its
   data fetch. With no caching, "cached" and "first" switch differ only in the fetch.
4. **Pre-existing, out of scope:** `SlickGridHost.vue` `onUnmounted` calls `persistScroll.cancel()`,
   so a scroll made < 300 ms before a tab switch is never persisted. Follow-up candidate only if the
   user wants it.
5. **Out of this row:** `budgets.spec.ts:472-473`, `:482-483` (horizontal and wide-vertical scroll)
   also assert `<= 1000`. PERF.md's P57 M5 table already labels them "sanity bound only, not a
   budget". The SPEC row names only `:765`, `:802`, `:820`, `:846-847`. Iteration 1's closing grep
   ("no `<= 1000` left") would have failed on them; §7 greps line-scoped.
6. **Kira Space `CommitGrid.vue`** uses plain `SlickGrid` (not `KiraSlickGrid`), so it keeps the
   per-grid sheet. No budget covers it. Follow-up candidate only.
7. **Thin margins stay:** cell to editor p95 29-41 ms, tree expand p95 24-39 ms, against 50 (§6
   item 4 governs a breach).

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

## 2. Root cause (iteration 2)

Iteration 1 §2 stands for the remount itself: `MainView.vue` keys `DataView` by tab id, so every
switch unmounts one `DataView` + SlickGrid and mounts another. Iteration 2 adds why that remount costs
~300 ms on WebKit and ~50 ms on Chromium:

1. **SlickGrid's per-grid stylesheet.** Each mount appends an empty `<style>`, `insertRule`s into
   it and sets `rule.style.left/right` per column (`createCssRules` `dist/esm/index.js:9676`,
   `applyColumnWidths` `:8636`). Each unmount removes that `<style>` (`removeCssRules`, via
   `destroy`). On WebKit, rule mutation and sheet removal each force a full-document style rebuild at
   the next layout read (§1.2): 49-64 ms each on this page. Appending a sheet with its text in place
   costs 2-3 ms. Chromium pays 0.3 ms for all of them.
2. **Per-element style cost on this sandbox engine.** Tailwind's `@property` fallback matches this
   WebKit (no `margin-trim`), putting ~68 `--tw-*` custom properties on every element (§1.4). That
   roughly doubles every rebuild. The shipping engine does not match the fallback (§1.9).
3. **Columns built twice per mount** (iteration 1 §2 item 3), fixed by `ba41ec3f`.
4. **Vue component work**, ~47 ms WebKit / ~29 ms Chromium per switch (§1.6). Not a regression;
   it is why no remount reaches 50 ms p95 in this sandbox.

Console keystroke: iteration 1 §1.5 unchanged. The spec times Monaco's fixed 100 ms `.visible`
class timer; the popup is on screen at 27-32 ms.

## 3. Fix design

- §3.1 revert iteration 1's caching commits; keep `ba41ec3f`.
- §3.2 `KiraSlickGrid` positions columns with custom properties; no per-grid stylesheet.
- §3.3 drop Tailwind's `@property` fallback at build time (shared Vite config).
- §3.4 comment fixes left stale by `ba41ec3f` and §3.2.
- §3.5 keystroke metric waits for the on-screen popup (iteration 1 §3.5, unchanged).
- §3.6 budgets: restored 50/200 bounds, a documented 250 ms tab switch bound, a deterministic
  no-stylesheet-churn guard; `slick-grid.spec.ts` leak checks follow §3.2.
- §3.7 docs.

Declined, with the measured reason:

- **Tab caching / `KeepAlive` / `v-show`.** Rejected by the user.
- **CSS containment** (`contain`, `content-visibility`, `will-change`): no effect on the rebuild
  (§1.5 row 3). WebKit's full rebuild ignores containment.
- **Grid in a shadow root.** Works in principle (0-1 ms scoped sheet ops, §1.2), but needs every app
  sheet adopted into the shadow tree and every `document.querySelector` on grid DOM (app, specs,
  measure helpers) rewritten. §3.2 gets the same scoping with none of that.
- **Per-cell inline `left/right`.** Needs a copy of SlickGrid's `appendCellHtml` (no hook sets cell
  style). §3.2's container custom properties reach the same result through three protected
  overrides.
- **`patch-package` on SlickGrid.** Not needed: `createCssRules`, `removeCssRules`,
  `applyColumnWidths` are `protected` in `slick.grid.d.ts` (`:1265`, `:719`), so a subclass override
  is the supported seam. No dependency-management change.
- **Cache `getMaxSupportedCssHeight`.** Measured gain inside noise (§1.7).
- **Rewrite rule strategy onto another stylesheet API** (iteration 1 §3): every sheet mutation still
  costs a full rebuild; only "no mutation" helps, which is §3.2.
- **Replace SlickGrid.** Out of scope; the library's own JS is ~16 ms per mount on Chromium (§1.6).

### 3.1 Reverts (first, before any new code)

Judged from each commit's diff (§1.8 dry run):

| Commit | Content | Decision |
|---|---|---|
| `6213106c` feat(workbench): warm-tab LRU | `warmTabs.ts`, `warmTabs.spec.ts` | revert: caching only |
| `22ed279f` perf(workbench): keep warm data tabs alive per tab | `MainView.vue` per-tab `KeepAlive`, `WorkbenchKeepAlive` host field, Studio `keepAlive` | revert: caching only |
| `23d8d080` fix(studio): data view commands follow tab activation | `DataView.vue` activate/deactivate, `commands.ts` comment | revert: without `KeepAlive`, `onActivated`/`onDeactivated` never fire after mount; the split is dead code and the comment would be wrong |
| `b700f108` fix(studio): grid deactivates and restores on tab reactivation | `SlickGridHost.vue` activation hooks, `lastScroll`, `scrollTrace.ts` comment | revert: every hunk serves reactivation. `lastScroll` exists for a detached viewport, which no longer happens |
| `ba41ec3f` perf(studio): build SlickGrid columns once per mount | `explicitInitialization: true`, `grid.init()` after subscriptions, second build deleted | **keep**: 321 to ~200 ms p50 on its own (iteration 1 §1.8 B2; §1.5 here). Its "warm set" comment is fixed in §3.4 |

Run, in the plan worktree's implementation branch, in this order, one commit each, hooks on:

```sh
git revert --no-edit b700f108
git revert --no-edit 23d8d080
git revert --no-edit 22ed279f
git revert --no-edit 6213106c
rm apps/kira-studio/tests/ui/support/evictWarmTab.ts   # untracked iteration 1 scratch, never committed
```

No history rewrite, no `--no-verify`. Each revert keeps git's default message
(`Revert "…"`), which is Conventional-Commits-compatible via the reverted subject; add the session
trailer lines.

### 3.2 `kiraSlickGrid.ts`: column positions through custom properties

File: `apps/kira-studio/frontend/src/views/shared/slick/kiraSlickGrid.ts`. Serves both
`SlickGridHost.vue` and `ConsoleSlickGrid.vue`. Module-level, above the class:

```ts
// WebKit rebuilds every element's style when a <style> is removed or a CSSOM rule is mutated
// (~55 ms on the test page); a sheet appended with its text already set, or a custom property on
// the grid root, restyles only what it touches. So column rules live in one append-only sheet and
// per-grid values live on the grid root. P139 Part 2.
const COLUMN_RULE_CHUNK = 256;
let columnRuleCapacity = 0;

function ensureColumnRules(columnCount: number): void {
  if (columnCount <= columnRuleCapacity) return;
  const next = Math.ceil(columnCount / COLUMN_RULE_CHUNK) * COLUMN_RULE_CHUNK;
  const rules: string[] = [];
  if (columnRuleCapacity === 0) {
    rules.push(
      '.kira-sg .slick-group-header-column,.kira-sg .slick-header-column{left:1000px}',
      '.kira-sg .slick-top-panel{height:var(--sg-top-panel-h)}',
      '.kira-sg .slick-preheader-panel{height:var(--sg-preheader-h)}',
      '.kira-sg .slick-topheader-panel{height:var(--sg-topheader-h)}',
      '.kira-sg .slick-headerrow-columns{height:var(--sg-headerrow-h)}',
      '.kira-sg .slick-footerrow-columns{height:var(--sg-footerrow-h)}',
      '.kira-sg .slick-cell{height:var(--sg-cell-h)}',
      '.kira-sg .slick-row{height:var(--sg-row-h)}',
    );
  }
  for (let i = columnRuleCapacity; i < next; i++) {
    rules.push(`.kira-sg .l${i}{left:var(--sg-l${i})}`, `.kira-sg .r${i}{right:var(--sg-r${i})}`);
  }
  const style = document.createElement('style');
  style.textContent = rules.join('\n'); // text before insertion: WebKit's additive path
  document.head.append(style);
  columnRuleCapacity = next;
}
```

Overrides in `KiraSlickGrid` (all three are `protected` upstream):

- `createCssRules()`: if `this._options.rtl`, `super.createCssRules()` and return (no call site
  sets `rtl`; upstream behaviour kept, not stubbed). Else `ensureColumnRules(this.columns.length)`,
  add class `kira-sg` to `this._container`, and set on it: `--sg-top-panel-h`, `--sg-preheader-h`,
  `--sg-topheader-h`, `--sg-headerrow-h`, `--sg-footerrow-h` from the matching `*Height` options;
  `--sg-row-h` = `rowHeight`px; `--sg-cell-h` = `calc(100% - ${cellHeightDiff}px)` when
  `enableVariableRowHeight`, else `rowHeight - cellHeightDiff`px. Mirrors upstream `:9676-9689`.
- `removeCssRules()`: `rtl` delegates to super. Else nothing to remove: the shared sheet stays,
  the root's properties go with the root.
- `applyColumnWidths()`: `rtl` delegates to super. Else upstream's loop (`:8636-8640`) with
  `this._container.style.setProperty('--sg-l<i>', …)` / `'--sg-r<i>'` in place of
  `rule.left.style.left` / `rule.right.style.right`. Same frozen-column arithmetic
  (`canvasWidthR` for `i > frozenColumn`, `x` reset after the frozen column; both hosts use
  `frozenColumn: 0`).

`setColumns` and `setOptions({ rowHeight })` already route through `removeCssRules` +
`createCssRules` + `applyColumnWidths`, so a column change or density change updates the
properties. A later width change (resize drag) restyles the grid subtree only: 4-18 ms measured
(§1.2 `data-grid` var), against a 49-64 ms full rebuild today.

Prefix `--sg-*`, not `--kira-*`: `scripts/check-tokens.sh` requires every `--kira-*` reference to
resolve to a theme definition; these are runtime-only.

Header/cell alignment verified in the probe (§1.5). No unit test: the loop mirrors upstream line
for line, and `slick-grid.spec.ts` plus `budgets.spec.ts` exercise it on a frozen-gutter grid with
2 and 60 columns.

### 3.3 Drop Tailwind's `@property` fallback at build time

File: `packages/workbench/src/viteAppConfig.ts` (both apps' shared config). `@tailwindcss/vite`
4.3.3 exposes no `polyfills` option (its `PluginOptions` is `optimize` only; the core's
`Polyfills.AtProperty` bit is not reachable). Vite's own PostCSS stage runs after Tailwind's
transform, so add to the returned config:

```ts
css: {
  postcss: {
    plugins: [
      {
        // Tailwind v4 re-declares every `--tw-*` initial value on `*`/`::before`/`::after`/
        // `::backdrop` for engines without `@property`, detected as "WebKit without margin-trim".
        // The shipping WKWebView (macOS 14+) has both, so the block is dead there, but Playwright's
        // WebKit matches it and doubles every element's style cost (P139 Part 2 iter2 §1.4).
        postcssPlugin: 'kira-drop-tw-property-fallback',
        AtRule: {
          supports(rule) {
            if (
              rule.params.includes('margin-trim') &&
              rule.parent?.type === 'atrule' &&
              rule.parent.name === 'layer' &&
              rule.parent.params === 'properties'
            ) {
              rule.remove();
            }
          },
        },
      },
    ],
  },
},
```

Type the plugin through Vite's `css.postcss` contextual type. If `vue-tsc` cannot resolve PostCSS's
types from there, give `rule` a structural type (`params`, `parent`, `remove()`); add no dependency.
Prototype result: built CSS has 0 `margin-trim` hits, both copies gone (global and the one Vue
scoped block, `[data-v-f7649ec7]`); `--tw-*` initial values still resolve (§1.7); visual suite
unchanged.

### 3.4 Stale comments

- `SlickGridHost.vue:1960` (from `ba41ec3f`): "a remount (a tab evicted from MainView.vue's warm
  set, or reopened)" becomes "this component remounts on every tab switch (`:key="activeTab.id"` in
  MainView.vue)" — the pre-iteration-1 wording, which is true again.
- `SlickGridHost.vue:2255-2258` F8 comment: `destroy()` no longer "removes its per-instance injected
  `<style>`": there is none (§3.2). Say the column sheet is shared and append-only.
- `slick-grid.spec.ts:294-304` helper comment: follows §3.6.

### 3.5 Keystroke metric

Iteration 1 §3.5 verbatim (on-screen predicate `suggestPopupShown`, `'style'` in the observer's
`attributeFilter`, the `:833-841` warm-up and Escape waits via `expect.poll`, comment rewrite). This
is a measurement fix: PERF.md's budget is "popup visible", visible at 27-32 ms.

### 3.6 Bounds and guards

`budgets.spec.ts`, lines at plan HEAD:

| Assertion | Today | New | Evidence |
|---|---|---|---|
| `:765` cell to editor p95 | `<= 1000` | **`<= 50`**, header value | p95 29-36 ms (§1.7), 37-41 (iteration 1 §1.1) |
| `:802` cached tab switch p95 | `<= 1000` | **`<= 250`**, documented sandbox bound | p95 126-151 ms (§1.7), 122-200 across probe runs (§1.5, §1.7); Chromium remount 58-75 (§1.5) |
| `:820` cached tree expand p95 | `<= 1000` | **`<= 50`**, header value | p95 25-27 ms (§1.7), 24-39 (iteration 1) |
| `:846` keystroke p50 | `<= 1000` | **`<= 50`**, header value, after §3.5 | popup on screen 27-32 ms (iteration 1 §1.5) |
| `:847` keystroke max | `<= 1000` | **`<= 200`**, pre-port value | same |

Tab switch, why 250: ~1.7x the typical measured p95 (~150), below every pre-fix run (324-494) and
below single-build-only (233-262, i.e. the §3.2 regression alone). Section header `:767` becomes
`// --- 3. cached tab switch, p95 <= 250ms (WebKit sandbox bound; PERF.md §2.1) ---`, and a two-line
comment above `:802` states why not 50 (remount floor, §1.6) and points at PERF.md.

**New deterministic guard in the same section** (catches a return of per-grid sheets regardless of
machine speed). Before the 20-switch loop, arm a page-side `MutationObserver` on `document.head`
(`childList`) counting added or removed `STYLE`/`LINK` nodes. After the loop:

- that count is `0`;
- no `document.styleSheets` entry holds a rule whose `selectorText` contains `.slickgrid_`
  (SlickGrid's per-instance uid prefix, `dist/esm/index.js` `uid` field).

Read the count through one `page.evaluate`; disconnect the observer there.

`slick-grid.spec.ts`:

- `slickStyleTagCount` (`:305`): count `<style>` elements with any rule whose `selectorText`
  contains `.slickgrid_`, not `slick-header-column` (the shared sheet has that too). Rewrite the
  `:294-304` comment: SlickGrid's per-grid sheet no longer exists (§3.2); the check now proves none
  appears.
- Spike exit-criteria test (`:517-534`) and P22 iter2-pacing teardown test (`:637-663`): keep
  `toBe(baselineStyles)`, add `expect(baselineStyles).toBe(0)`, and assert `0` once while the first
  grid is open (right after `connectAndOpenSpikeGrid`).

### 3.7 Docs

`docs/PERF.md`:

- §1 row "Tab switch (cached) ≤ 50 ms": Automated column says the sandbox gate is p95 <= 250 ms
  (WebKit, `budgets.spec.ts`), product budget 50 ms unverified on WKWebView after P139 Part 2.
- §1 row "Console keystroke": metric text becomes on-screen popup (computed `visibility: visible`
  and a list row), one clause on why not `.visible`.
- §2.1 table rows (cell to editor, tab switch, tree expand, keystroke): this sandbox's numbers from
  §6's runs, labelled with the environment; keystroke budget cell `<= 50 ms (p50)`.
- Replace the keystroke note (`:60-65`): the `<= 1000` gate came from the P57 M5 port (`9ee240f0`);
  before it the spec asserted p50 <= 50 / max <= 200; 113 ms was Monaco's `.visible` timer.
- New short paragraph under §2.1: the tab switch remount floor. Numbers from §1.5-§1.7 (WebKit and
  Chromium), the WebKit full-rebuild mechanism, the Tailwind fallback, why 250, and the Mac check of
  §1.9. P57 M5 table (`:145`): note that ~48/85 ms measured `DataGrid.vue`, before `SlickGridHost.vue`
  (`d01b082e`).
- §3 manual procedures: add §1.9's Mac tab-switch check.

`docs/ARCHITECTURE.md`:

- Data/console grid row (`:49`): one sentence: `kiraSlickGrid.ts` positions columns through
  `--sg-l<i>`/`--sg-r<i>` on the grid root plus one shared append-only sheet, never SlickGrid's
  per-grid `<style>` (WebKit rebuilds every element's style on a sheet removal or rule mutation).
- Frontend baseline row (`:35`) or the Tailwind note nearest it: one sentence on
  `viteAppConfig.ts` dropping the `@property` fallback and why.
- Known open items (`:4415`): **tab switch remount above the 50 ms product budget in the WebKit
  sandbox** (p95 ~126-151 ms, gated at 250), WKWebView unmeasured. Delete once a Mac run (§1.9)
  settles it.

## 4. File ownership (one sequential implementer)

No split: the reverts touch `SlickGridHost.vue`, which §3.4 edits again; the spec edits depend on
§3.2's behaviour; one full-suite run verifies all.

| File | Change | Step |
|---|---|---|
| `packages/workbench/src/tabs/warmTabs.ts`, `warmTabs.spec.ts` | deleted by revert | 1 |
| `packages/workbench/src/components/MainView.vue`, `packages/workbench/src/host.ts`, `apps/kira-studio/frontend/src/workbench/host.ts` | restored by revert | 1 |
| `apps/kira-studio/frontend/src/views/grid/DataView.vue`, `packages/workbench/src/shortcuts/commands.ts` | restored by revert | 1 |
| `apps/kira-studio/frontend/src/views/shared/slick/scrollTrace.ts` | restored by revert | 1 |
| `apps/kira-studio/tests/ui/support/evictWarmTab.ts` (untracked) | `rm` | 1 |
| `apps/kira-studio/frontend/src/views/shared/slick/kiraSlickGrid.ts` | §3.2 | 2 |
| `packages/workbench/src/viteAppConfig.ts` | §3.3 | 3 |
| `apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue` | reverted (step 1), §3.4 comments | 1, 4 |
| `apps/kira-studio/tests/ui/slick-grid.spec.ts` | §3.6 leak checks | 5 |
| `apps/kira-studio/tests/ui/budgets.spec.ts` | §3.5 (step 6), guard + bounds (step 7) | 6, 7 |
| `docs/PERF.md`, `docs/ARCHITECTURE.md` | §3.7 | 8 |
| `docs/v2.0/SPEC.md` | `## P139 Part 2 result` | 9 |

## 5. Ordered commit steps

Every commit passes the pre-commit hook normally; never `--no-verify`. Per commit: `bun run lint`,
`bun run typecheck` (the hook runs both). Push the branch after each commit (`git push -u origin
<branch>`); never the chapter branch.

1. Four reverts (§3.1), four commits, in the listed order; then `rm` the scratch file.
2. `perf(studio): position SlickGrid columns with custom properties` — §3.2. Before committing:
   `bun run build:test:studio`, then `budgets.spec.ts` alone
   (`bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui-timing --no-deps -g "interaction budgets"`);
   log line shows tab switch p95 well under the old 436-447.
3. `perf(theme): drop Tailwind's @property fallback from app CSS` — §3.3. Before committing:
   rebuild, `rg -c 'margin-trim' apps/kira-studio/frontend/dist/assets/*.css` is 0 in every file
   (Monaco's `all: initial` expansion is a runtime `cssText` artifact, not source), then
   `bun run test:visual:studio` and `bun run test:visual:space` pass unchanged.
4. `refactor(studio): fix stale grid remount comments` — §3.4 (code comments only).
5. `test(studio): assert no per-grid SlickGrid stylesheet` — §3.6 `slick-grid.spec.ts`. Run
   `slick-grid.spec.ts` alone (`--project=ui`).
6. `test(studio): time keystroke to on-screen suggest popup` — §3.5.
7. `test(studio): restore interaction budgets, document tab switch bound` — §3.6 `budgets.spec.ts`
   bounds plus the stylesheet-churn guard.
8. `docs: P139 Part 2 budgets and SlickGrid column strategy` — §3.7, numbers from §6. Lands after
   §6's runs; fix commits for anything §6 finds land before it.
9. `docs(v2.0): P139 Part 2 result` — SPEC.md result section: every run's numbers, commit list,
   open points still open (§0).

## 6. Verification

Run with no other session, build or test in the container. Record `uptime` before each run. A
container restart kills background runs and a rate limit can kill the agent, so run everything in
the **foreground**, in chunks under the Bash tool's 10 min cap, and commit + push between chunks.

1. **Pre-check**, quiet: `ui-timing` budgets alone, `--repeat-each=3`. Record the four budgets'
   p50/p95 and keystroke max.
2. **3 consecutive full `bun run test:ui:studio` runs**, each as chunks on one build:
   ```sh
   bun run build:test:studio
   bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui --shard=1/2 2>&1 | tee /tmp/p139p2i2-runN-a.log
   bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui --shard=2/2 2>&1 | tee /tmp/p139p2i2-runN-b.log
   bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui-timing --no-deps 2>&1 | tee /tmp/p139p2i2-runN-t.log
   ```
   `timeout: 600000` per Bash call; use `--shard=k/3` if a shard nears the cap. A run counts only
   if all its chunks pass. Any failure resets the count to 0: root-cause, fix (CLAUDE.md,
   pre-existing or not), commit, rebuild, restart the count. Append each run's numbers to the SPEC
   result section as it completes (resumable).
3. Per run record: cell to editor, tab switch, tree expand p50/p95; keystroke p50/max; load average.
4. **A breached bound is a root-cause task, not a widening.** Re-run once at load average < 2. If
   it still fails, find what the window covers (§1.6 method: marks), fix it, record it. No bound goes
   wider than §3.6 without new measured evidence raised to the orchestrator first.
5. `bun run test:unit`, `bun run lint`, `bun run typecheck`.
6. `bun run test:ui:space` once (shared `MainView.vue` restored by revert; shared Vite config
   changed). Chunk the same way if it exceeds the cap.
7. `bun run test:visual:studio`, `bun run test:visual:space` once each.
8. Manual check in the Studio test build: open 3 data tabs incl. a >256-column result if one is at
   hand (else a console `SELECT` with 300 aliased columns), switch, resize a column, switch density
   (compact/comfortable); headers and cells stay aligned; no console error.

## 7. Closing audit

```sh
rg -n 'KeepAlive|keepAlive|warmIds|nextWarmIds|WorkbenchKeepAlive' packages/workbench/src apps/kira-studio/frontend/src apps/kira-space/frontend/src  # empty
rg -n 'onActivated|onDeactivated' apps/kira-studio/frontend/src/views/grid packages/workbench/src/components/MainView.vue  # empty
ls packages/workbench/src/tabs/warmTabs.ts apps/kira-studio/tests/ui/support/evictWarmTab.ts 2>&1  # both "No such file"
git diff 035bbbeb --stat -- packages/workbench/src/components/MainView.vue packages/workbench/src/host.ts apps/kira-studio/frontend/src/workbench/host.ts apps/kira-studio/frontend/src/views/grid/DataView.vue packages/workbench/src/shortcuts/commands.ts  # empty
rg -n 'explicitInitialization: true|grid\.init\(\)' apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue   # 1 hit each (ba41ec3f kept)
rg -n 'override (createCssRules|removeCssRules|applyColumnWidths)' apps/kira-studio/frontend/src/views/shared/slick/kiraSlickGrid.ts  # 3 hits
rg -n 'warm set|per-instance injected <style>' apps/kira-studio/frontend/src  # empty
rg -n 'kira-drop-tw-property-fallback' packages/workbench/src/viteAppConfig.ts  # 1 hit
rg -c 'margin-trim' apps/kira-studio/frontend/dist/assets/*.css apps/kira-space/frontend/dist/assets/*.css  # 0 each, after a build
sed -n '765p;802p;820p;846,847p' apps/kira-studio/tests/ui/budgets.spec.ts   # line numbers shift with §3.5/§3.6 edits; read the five assertions
rg -n 'toBeLessThanOrEqual\((50|200|250)\)' apps/kira-studio/tests/ui/budgets.spec.ts  # 5 hits: cell 50, tab 250, tree 50, key p50 50, key max 200
rg -n 'slickgrid_' apps/kira-studio/tests/ui/budgets.spec.ts apps/kira-studio/tests/ui/slick-grid.spec.ts  # guard + helper
rg -n 'suggest-widget\.visible' apps/kira-studio/tests/ui/budgets.spec.ts  # explanatory comment only
```

Plus: each of the four reverts is its own commit whose subject starts `Revert "`, and `ba41ec3f` is
still an ancestor of HEAD with no revert of it (`git log --oneline | rg 'Revert .*columns once'`
empty).

## 8. Risks

- **Custom-property specificity.** `.kira-sg .l3` has the same specificity as upstream's
  `.slickgrid_N .l3`; no app CSS sets `left`/`right` on cells (`rg` found none). Alignment is
  checked by §6 item 8 and the existing specs.
- **Shared sheet growth.** One chunk per 256 columns ever seen in the page, never removed. A 2 000
  column result adds 8 chunks (16 000 short rules), once per page lifetime.
- **Column resize now restyles the grid subtree** on every width write (4-18 ms here) instead of the
  whole document (49-64 ms). Strictly cheaper, but a drag writes many times: unchanged count of
  writes, lower cost each.
- **`rtl` keeps upstream's sheet.** No call site sets it. If one ever does, it gets today's cost, not
  a break.
- **Tailwind fallback removal** affects any engine without `@property` (Safari < 16.4). Outside the
  macOS 14+ target. A Tailwind upgrade that changes the fallback's shape leaves the plugin a no-op
  (the build still works); §7's `margin-trim` grep catches it.
- **Bound 250 on a slower or busier machine.** §6 item 4 governs: re-run quiet, then root-cause.
- **Sandbox numbers are not WKWebView numbers** (§1.9). The deterministic guard (§3.6) holds on any
  engine; the timing bound is labelled sandbox-only in PERF.md.

## 9. Acceptance

- The four caching commits reverted (own commits, no rewrite); `ba41ec3f` kept; no `KeepAlive` or
  warm-tab code in `packages/workbench` or the Studio host (§7).
- No per-grid SlickGrid `<style>`: stylesheet-churn guard in `budgets.spec.ts` green; `slick-grid.spec.ts`
  asserts 0 per-grid sheets open and closed.
- Built CSS has no Tailwind `@property` fallback; visual suites of both apps unchanged.
- `budgets.spec.ts`: cell to editor p95 <= 50, tree expand p95 <= 50, keystroke p50 <= 50 (on-screen
  popup) and max <= 200, tab switch p95 <= 250 with the reason in a comment and in PERF.md. No `<= 1000`
  left on those five lines.
- `ui` and `ui-timing` pass on 3 consecutive full `bun run test:ui:studio` runs (chunked, §6), numbers in
  the result. `test:ui:space`, `test:unit`, both visual suites pass once.
- PERF.md and ARCHITECTURE.md updated per §3.7, including the Known open item and the Mac procedure.
- §0 items raised to the orchestrator/user.
