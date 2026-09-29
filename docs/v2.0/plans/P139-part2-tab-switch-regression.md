# P139 Part 2 — cached tab switch regression; PERF.md §2.1 bounds: plan

Plan for `docs/v2.0/SPEC.md`'s **P139 Part 2** row. Planned against chapter branch
`claude/unfinished-phases-ru3wo4` at `035bbbeb`. Line numbers are at that commit.

**Status: plan complete, ready to implement.**

**Discovery method, disclosed.** Worktree-local `.codegraph/` index built via
`scripts/codegraph-setup.sh` (shared index pointed at another worktree). `codegraph_explore` ran
before `Read`/`grep` for: tab activation (`TabStrip.vue` `onClick`, `createTabsStore`
`activateTab`/`setActiveTabId`), `MainView.vue` mount (`<component :key>`, no `KeepAlive`),
`DataView.vue` children, `SlickGridHost.vue` `onMounted`/`onUnmounted`, `KiraSlickGrid`,
`MonacoHost.vue` completion providers. Measurements come from temporary probes (instrumented
build, probe spec copied from `budgets.spec.ts`, probe Playwright config); all reverted, none
committed. Environment: 4 vCPU, Playwright WebKit (`ui-timing`'s engine), Chromium
`headless_shell-1194` used only as a comparison engine, `performance.now()` resolution 1 ms in
WebKit.

## 0. Open points (for the orchestrator/user)

1. **Warm-tab cap is a judgement call: 5.** Kept-alive data tabs hold their grid DOM, SlickGrid
   instance and (if a cell was selected) one Monaco editor each. The budget needs >= 2. Five
   bounds retained DOM to ~5 grids' rendered band. Raise or lower on request; one constant
   (`keepAlive.max`, §3.1).
2. **Only `data` tabs are kept alive.** Console, stream, document, keyvalue and the rest still
   remount on every switch. Only `data` has a measured budget. Extending the opt-in to another
   kind needs its own activation audit (§3.2-§3.3 shape) and is out of scope here.
3. **Kira Space unchanged.** It sets no `keepAlive` on its host. `RepoGraphView.vue`'s dormant
   `onActivated`/`onDeactivated` hooks (ARCHITECTURE.md "A tab switch fully unmounts and remounts
   the graph") stay dormant. Opting Space in is a separate decision.
4. **Cold switch stays slow on WebKit.** First open, a tab evicted past the cap, and the first
   switch after relaunch still remount: ~200 ms p50 after §3.4 (from ~320 ms). No stylesheet API
   gets one SlickGrid mount under ~110 ms on WebKit (§1.7). Not gated; PERF.md records it.
5. **`ConsoleSlickGrid.vue` likely carries the same double column build.** Not measured, not
   touched (no budget covers it). Candidate follow-up only if the user wants it.
6. **Thin margins.** Cell to editor p95 37-41 ms and tree expand p95 24-43 ms against 50 on this
   4 vCPU sandbox. §6 treats any breach as a root-cause task, never a silent widening.

---

## 1. Measured current state

### 1.1 Baseline, unmodified `035bbbeb`

`bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui-timing --no-deps
-g "interaction budgets" --repeat-each=3`, quiet machine:

| Metric | p50 | p95 | Header budget | Assertion today |
|---|---|---|---|---|
| cell -> editor | 17-19 ms | 37-41 ms | p95 <= 50 | `:765` <= 1000 |
| cached tab switch | 311-318 ms | 436-447 ms | p95 <= 50 | `:802` <= 1000 |
| cached tree expand | 18-19 ms | 24-39 ms | p95 <= 50 | `:820` <= 1000 |
| console keystroke -> popup | 112-113 ms | 116-118 ms | p50 <= 50 | `:846` p50 <= 1000, `:847` max <= 1000 |

### 1.2 Where the tab switch time goes (WebKit, instrumented build)

Marks: `TabStrip` `onClick`, `activateTab`, `DataView` setup/mounted/unmounted, `SlickGridHost`
setup, `onMounted` stages, `onUnmounted`, `MonacoHost` mount/dispose, and the measure's
`MutationObserver` resolve. 20 switches, both directions, times from click:

| Stage | ms (typical, range) |
|---|---|
| click handler (`activateTab` + `saveNow`) | 0-3 |
| Vue patch: new `DataView` + `SlickGridHost` setup | 20-30 |
| old tab unmount (grid destroy, Monaco dispose) | 15-40 |
| `buildColumns` (1st call in mount) | 30-55 |
| `new KiraSlickGrid(...)` | 75-165 |
| `rebuildAndSetColumns()` -> `grid.setColumns` (2nd call; `buildColumns` itself 5 ms) | 100-220 |
| `grid.render()` | 0-1 |
| rest of `onMounted`, observer resolve | 8-17 |
| **total** | **265-508** |

Both directions cost the same: `big_rows` has 2 data columns, `wide_table` 60. Cost is not per
column. The whole switch is one synchronous task: Vue's flush runs mount and `onMounted`, then the
measure's `MutationObserver` microtask resolves. `MonacoHost`'s editor create runs after
(`await loadMonaco()`), outside the measured window.

Same probe on Chromium: total 48-65 ms; `new KiraSlickGrid` 7-12 ms, `setColumns` 6-12 ms, Vue
setup/unmount ~30 ms. SlickGrid mount is ~10x slower on WebKit; Vue work ~1.5x.

### 1.3 Inside SlickGrid (WebKit, per-method self time)

Temporary wrapper over every `SlickGrid.prototype` method (inclusive/self ms per switch):

- `handleScroll` self 95-182 ms (4 calls), `getViewportWidth` self 54-124 ms (4 calls).
- Everything else < 20 ms combined (`createColumnHeaders` 2-15, `applyColumnWidths` 2-5,
  `getMaxSupportedCssHeight` 9-20, `render` ~10 incl).

Both hot methods only read layout (`scrollTop`, `clientWidth`/computed width). Self time there is
forced style recalc + layout, paid for work queued earlier in the same task.

### 1.4 What makes a forced layout expensive on WebKit

In-page microbenchmark on the live app (688 elements, 5 stylesheets, 3 057 CSS rules), median of
10, each followed by `offsetWidth`:

| Mutation before the layout read | WebKit | Chromium |
|---|---|---|
| none | 0 ms | 0 ms |
| append `<style>` + `insertRule` | 2 ms | 0.3 ms |
| **set `CSSStyleRule.style.left` on an existing rule** | **63 ms** | 0.3 ms |
| toggle a class | 0 ms | 0.1 ms |
| set a `data-*` attribute | 0 ms | 0 ms |

SlickGrid 5.20 positions every column through per-grid CSSOM rules: `createCssRules`
(`dist/esm/index.js:9676`) inserts `.l<i>`/`.r<i>` rules; `applyColumnWidths` (`:8639`) then sets
`rule.left.style.left`/`rule.right.style.right` per column. On WebKit each such mutation batch
costs ~60 ms at the next layout read. A mount does it twice (constructor, then
`rebuildAndSetColumns`), plus the forced reads between.

### 1.5 Console keystroke: `.visible` is a 100 ms Monaco timer

Probe split per keystroke (WebKit): `keydown` reaches the page 1-8 ms after arming; popup
`.suggest-widget.visible` 108-114 ms after `keydown`. Chromium: identical (106-118 ms). Same on
two engines means a timer, not work.

Monaco 0.56 `SuggestWidget._show()` (`suggestWidget.js:429-437`): `contentWidget.show()` and
layout run at once; `classList.add('visible')` runs in `setTimeout(…, 100)` (it fires
`onDidShow`). `suggest.css` has no `.visible` rule. Timeline of the widget node: `display: block`,
3 rows at 16-20 ms; `visibility: visible` at 27-32 ms; `.visible` class at ~110 ms. The popup is on
screen at ~30 ms. The spec's selector measures Monaco's constant, not app work.

### 1.6 History

- `docs/PERF.md` P57 M5 table (tab switch p50 ~48 ms, p95 ~85 ms) was recorded 2026-08-30
  (`d44f5c38`, full-history branch `origin/claude/unimplemented-items-xjrz4c`), before
  `SlickGridHost.vue` existed (`d01b082e`, 2026-09-02). It measured `DataGrid.vue` (Vue +
  TanStack Virtual, no CSSOM rule mutation). p95 85 ms was already over 50 and marked "pass".
- The `<= 1000` bounds were introduced by the P57 M5 port itself (`9ee240f0`). The pre-port
  `tests/e2e/budgets.spec.ts` asserted: cell -> editor p95 <= 50, tab switch p95 <= 50, tree expand
  p95 <= 50, keystroke p50 <= 50 and max <= 200. No comment records why the port widened them.
- `docs/PERF.md` §2.1's keystroke note ("the code's own gate was always <= 1000 ms") is wrong:
  the gate was p50 <= 50 / max <= 200 until `9ee240f0`.
- `MainView.vue` never kept data tabs alive. `KeepAlive` existed only for `RepoGraphView`
  (`d9938756`) and was removed with the git module (`dd3ec622`). Every tab switch has always
  remounted `DataView` (`:key="activeTab.id"`).

### 1.7 More on WebKit stylesheet cost

Further microbenchmarks, same page, median of 8, each op followed by one layout read:

| Op | WebKit | Chromium |
|---|---|---|
| append empty `<style>` then `insertRule` | 65 ms | 0.3 ms |
| append `<style>` with text | 58 ms | 0.3 ms |
| `insertRule` / `deleteRule` on an existing sheet | 54-56 ms | 0.3 ms |
| remove a `<style>` | 55 ms | 0.3 ms |
| `sheet.disabled = true` | 57 ms | 0.3 ms |
| `adoptedStyleSheets` `replaceSync` | 53-63 ms | 0.3 ms |
| custom property on `main-view` container | 32 ms | 4 ms |

Every stylesheet change costs one full-document style recalc on WebKit. Disabling the largest
sheet (1 235 rules) leaves it at 55 ms; hiding `main-view` (`display: none`) halves it to 26 ms. The
cost scales with rendered elements, not rule count. No stylesheet API is cheap on WebKit, so
rewriting SlickGrid's rule strategy (`insertRule` with final values, text replace, adopted sheet,
custom properties) cannot get a remount under 50 ms: one remount needs at least the old sheet's
removal plus the new sheet's insertion, ~110 ms. Declined for that measured reason.

### 1.8 Prototypes (probe build, reverted)

| Prototype | cached tab switch p50 / p95 | switch to 2nd rAF p50 / p95 |
|---|---|---|
| none (baseline) | 321 / 389 ms | 383 / 438 ms |
| K: `KeepAlive :max="10"` around `MainView.vue`'s `<component>` | **5-6 / 8-9 ms** | 68-81 / 92-114 ms |
| B2: `explicitInitialization: true`, subscribe, `grid.init()`, no `rebuildAndSetColumns()` in `onMounted` | 201 / 304 ms | 251 / 317 ms |

Idle double-rAF (frame cadence alone): p50 25 ms. Under K, post-switch SlickGrid work is
`resizeCanvas` x2 (4-23 ms incl.): the `ResizeObserver` fires for the detached grid (0x0) and the
re-inserted one. The re-inserted grid rebuilds its rows (34-78 `appendCellHtml`) because the 0x0
pass emptied them. Rest of the ~45 ms over idle is style/layout/paint of the re-inserted subtree.
B2 passes the probe with `consoleErrors` empty and headers carrying `data-column`, so the header
listener runs on the first (now only) build.

### 1.9 Scroll position across a DOM detach

Standalone page, WebKit and Chromium identical: a 200x200 scroller at `scrollTop` 1234 /
`scrollLeft` 321 reads `0 / 0` the moment it is moved into a detached container. It still reads
`0 / 0` after re-insertion, synchronously and 2 rAF later. **No `scroll` event fires** on detach or
re-insert. `KeepAlive` deactivation is exactly this move (into its storage container). So a
kept-alive grid comes back at the top unless the host restores it. `SlickGridHost.vue`'s debounced
`persistScroll` (`:790-794`) reads `el.scrollTop` when its 300 ms timer fires: a timer landing
after detach would write `0 / 0` into tab state.

## 2. Root cause

**Every cached tab switch remounts `DataView` and SlickGrid, and a SlickGrid mount costs 4-6
full-document style recalcs on WebKit.**

1. `MainView.vue:22` renders `<component :is :key="activeTab.id">` with no `KeepAlive`. Switching
   tabs unmounts the old `DataView` subtree and mounts a new one, synchronously, inside the
   measured window (§1.2). "Cached" in the budget's name has never been true for the view layer
   (§1.6); only the page data is cached.
2. SlickGrid 5.20 positions columns through a per-grid `<style>` and CSSOM rule mutation
   (`createCssRules`, `applyColumnWidths`). The old grid's `destroy(true)` removes its sheet; the
   new grid inserts one and mutates its rules. On WebKit each stylesheet change costs one
   full-document style recalc, 53-65 ms on this page, paid at the next layout read (§1.4, §1.7).
   Chromium pays 0.3 ms.
3. `SlickGridHost.vue`'s `onMounted` builds columns twice: once in the constructor
   (`explicitInitialization: false`, ~`:2063`), again in `rebuildAndSetColumns()` (`:2129`), a
   workaround for header listeners the constructor build ran before they were subscribed. Each
   build is another rule-mutation batch plus forced reads (`handleScroll`, `getViewportWidth`,
   §1.3).

Sum on WebKit: 265-508 ms per switch, p50 311-318 ms, p95 436-447 ms. Same probe on Chromium:
48-65 ms. The regression dates from `SlickGridHost.vue` replacing `DataGrid.vue` (`d01b082e`, after
PERF.md's M5 measurement). The `<= 1000` bound from the P57 M5 port (`9ee240f0`) and the broken
tab selector P139 Part 1 fixed kept it invisible.

**Console keystroke, separate cause:** the spec waits for `.suggest-widget.visible`, a class Monaco
adds on a fixed 100 ms `setTimeout` with no CSS effect (§1.5). The popup is on screen at 27-32 ms.
The 112 ms p50 measures Monaco's constant, not app work.

**Cell to editor, tree expand:** no regression. Both pass 50 ms today (§1.1); only the bound is
wrong.
