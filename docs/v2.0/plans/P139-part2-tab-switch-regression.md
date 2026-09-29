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

## 3. Fix design

Two independent code fixes plus one measurement fix:

- Stop remounting warm data tabs: per-tab `KeepAlive` (§3.1-§3.3). Measured 5-6 / 8-9 ms (§1.8 K).
- Build SlickGrid columns once per mount (§3.4). Speeds every remaining cold mount, 321 to 201 ms
  p50 (§1.8 B2).
- Wait on the popup's on-screen state, not Monaco's 100 ms class timer (§3.5).

Declined, with the measured reason:

- **Rewrite SlickGrid's per-grid CSS strategy** (`insertRule` with final values, one shared sheet,
  adopted sheet, custom properties). Every stylesheet API costs one 53-65 ms full recalc on WebKit
  (§1.7). A remount needs at least a removal plus an insertion, ~110 ms. It cannot reach 50 ms.
- **Replace SlickGrid.** Out of scope, and the cost is WebKit's stylesheet invalidation, not the
  library's work (Chromium mounts the same grid in 7-12 ms).
- **`v-show` on every data tab.** Leaves N hidden grids in the document. Strict locators such as
  `[data-testid="data-grid"]` and `grid-header-cell` would match several nodes across specs. The
  budget's "header cell present" check would also pass before any switch, since hidden headers
  stay in the document.
- **One `<KeepAlive :include :max>` around the existing `<component>`.** `KeepAlive` prunes only
  by component name or LRU `max`, never by key. A closed tab's `DataView` would stay cached
  (listeners, grid, closures over dropped runtime) until LRU pressure evicted it.
- **Wider bound.** The budget is right; the code was wrong (§2).

### 3.1 `MainView.vue`: per-tab `KeepAlive`, host opt-in

`packages/workbench/src/host.ts`, new optional host field:

```ts
export interface WorkbenchKeepAlive<K extends string> {
  /** Kinds whose view is deactivated, not unmounted, on a switch away. */
  readonly kinds: readonly K[];
  /** Warm tabs kept; least recently activated evicted first. */
  readonly max: number;
}

export interface WorkbenchHost<WK extends string, R extends TabLike> extends TabStripHost<WK, R> {
  // ...existing fields...
  readonly keepAlive?: WorkbenchKeepAlive<R['kind']>;
}
```

`apps/kira-studio/frontend/src/workbench/host.ts` `createWorkbenchHost()` adds
`keepAlive: { kinds: ['data'], max: 5 }`. Kira Space's host is untouched.

New pure module `packages/workbench/src/tabs/warmTabs.ts`:

```ts
/** Next warm-tab list. Order stays stable (insertion order): reordering would move a kept-alive
 *  subtree in the DOM, which is itself a detach/attach. */
export function nextWarmIds(
  prev: readonly string[],
  activeId: string | null, // null when the active tab is not a warm kind
  liveIds: ReadonlySet<string>,
  lastUsed: Map<string, number>, // mutated: stamps activeId, drops dead ids
  stamp: number,
  max: number,
): string[];
```

Rules, in order:

1. Drop every id not in `liveIds` (closed tabs), and drop it from `lastUsed`.
2. If `activeId` is set, stamp it in `lastUsed`, and append it if absent.
3. While the list exceeds `max`, remove the id with the oldest stamp. Never remove `activeId`.
4. Return `prev` itself when nothing changed, so the ref write is a no-op.

`MainView.vue`:

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWorkbenchHost } from '../host';
import { nextWarmIds } from '../tabs/warmTabs';

const host = useWorkbenchHost();
const activeTab = computed(/* unchanged */);

const keepAlive = host.keepAlive;
const isWarm = (kind: string): boolean => keepAlive?.kinds.includes(kind) ?? false;
const warmIds = ref<string[]>([]);
const lastUsed = new Map<string, number>();
let stamp = 0;

// flush 'pre' (default) runs before this component's render in the same tick, so the active
// tab's KeepAlive exists on the render that shows it.
watch(
  [() => activeTab.value?.id ?? null, () => host.tabs.tabs.map((t) => t.id).join('\n')],
  ([activeId]) => {
    if (!keepAlive) return;
    const warmActive = activeId && activeTab.value && isWarm(activeTab.value.kind) ? activeId : null;
    warmIds.value = nextWarmIds(
      warmIds.value, warmActive, new Set(host.tabs.tabs.map((t) => t.id)), lastUsed, ++stamp, keepAlive.max,
    );
  },
  { immediate: true },
);
</script>

<template>
  <template v-if="activeTab">
    <KeepAlive v-for="id in warmIds" :key="id">
      <component :is="host.views[activeTab.kind]" v-if="id === activeTab.id" :tab="activeTab" />
    </KeepAlive>
    <component
      :is="host.views[activeTab.kind]"
      v-if="!isWarm(activeTab.kind)"
      :key="activeTab.id"
      :tab="activeTab"
    />
  </template>
  <slot v-else name="empty" />
</template>
```

Behaviour:

- Switch between warm tabs: old `KeepAlive` child flips to a comment vnode (deactivate, DOM moved
  to storage), new one activates or mounts. No SlickGrid work, no stylesheet change.
- Close a warm tab: its id leaves `warmIds`, its `KeepAlive` unmounts, and `KeepAlive` truly
  unmounts the cached instance: `onUnmounted` runs the existing teardown (`destroy(true)` etc.).
- Evict past `max`: same path as close.
- Non-warm kinds (and every Space tab): exactly today's keyed `<component>`.
- Mode switch (Studio `studio`/`api`): active tab becomes non-warm or null; warm data tabs stay
  deactivated and cached (still capped).
- A tab record for an inactive id is never read: the child is `v-if`-false. The active one gets
  `activeTab` as today.

`warmTabs.ts` gets one unit test, `packages/workbench/src/tabs/warmTabs.test.ts` (already under
`bun run test:unit`'s `packages/workbench/src` root). It qualifies under CLAUDE.md's "cache
eviction with interacting rules": LRU order, liveness pruning, never-evict-active, stable order and
the unchanged-returns-`prev` rule interact. Cases: eviction picks the oldest stamp, not list
position; a closed id is dropped before eviction counts; the active id survives `max: 1`; order
unchanged after re-activating an old id; no-op returns the same array.

### 3.2 `DataView.vue`: command registration follows activation

`registerCommand` (`packages/workbench/src/shortcuts/commands.ts`) is last-writer-wins per id, and
its disposer deletes only its own handler. Today `onMounted` registers `view.find`,
`view.refresh`, `data.generate` (`:161-177`); `onUnmounted` disposes (`:179-181`). Under
`KeepAlive` a deactivated data tab would keep `data.generate` registered for a console tab, and a
reactivated one would lose Find/Refresh to whichever view mounted last.

Change:

- Extract `activate()`: the runtime load check (`:162-164`) plus the three registrations.
- Extract `deactivate()`: run and clear `unregisterCommands`.
- `onMounted(activate)`, `onUnmounted(deactivate)` as today.
- `onDeactivated(() => { deactivate(); deactivated = true; })`.
- `onActivated(() => { if (!deactivated) return; deactivated = false; activate(); })`. The flag
  makes the first-mount `onActivated` call a no-op, so the component stays correct with or
  without a `KeepAlive` ancestor.

The load check on reactivation matters: `onConnectionState` drops page stores of a background tab
(`dropPageStoresForTab`), which today reloads on remount. Rewrite the D11 comment (`:165-167`):
"registered only while its tab is active" (mounted-and-active, not mounted). Same one-line fix to
`commands.ts`'s header comment ("Exactly one ... is ever mounted" becomes "active").

### 3.3 `SlickGridHost.vue`: deactivate and reactivate the grid

A descendant's `onActivated` does not fire when the descendant mounts after its `KeepAlive` root
already activated (the host mounts later behind the reconnect gate). Same `deactivated` flag
pattern as §3.2: `onMounted` keeps the full init; `onActivated` runs only after a real
deactivation.

`onDeactivated` (guard on `grid` non-null; when the active tab closes, `onDeactivated` and
`onUnmounted` both run, order not guaranteed):

1. `closeFkPreview()` (anchor point is gone, as in `onUnmounted`).
2. `grid.getEditorLock().cancelCurrentEdit()`: parity with today, where `destroy(true)` cancelled
   an open inline edit on switch away.
3. `persistScroll.cancel()`, then write the tracked position (item below) with
   `tabsStore.patchDataTabState`. The detached viewport reads 0 (§1.9).
4. `resizeObserver.disconnect()` (keep the instance): no 0x0 `resizeCanvas` that empties rows
   (§1.8).
5. `unregisterGridHost(props.tabId)`; `scrollTrace.unregisterGrid(viewportEl)`. `scrollTrace` holds
   one module-level target ("at most one grid is ever mounted": now "active"; fix its comment).
6. `deactivated = true`.

`onActivated` (after the flag check):

1. Reassign `editorCtx.readValue`/`commit` to this instance's closures (`:1973-1975`; extract to a
   `bindEditorCtx()` used by both hooks). Another grid may have mounted meanwhile.
2. Restore `viewportEl.scrollTop`/`scrollLeft` from the tracked position, then
   `scrollVelocityTracker.seed(...)` as `onMounted` does (`:2143`).
3. `grid.resizeCanvas()`: remeasures and re-renders the visible band (rows emptied while detached,
   or changed by a background `pageVersion` bump).
4. `resizeObserver.observe(el)`. Its initial notification repeats `resizeCanvas()` once: measured
   4-23 ms for both calls together (§1.8), outside the measured window. Accept it; do not add a
   skip flag.
5. `scrollTrace.registerGrid(viewportEl, '.slick-row')`; `registerGridHost(props.tabId, ...)`, then
   the same `consumeCellFocus` / `requestCellFocus` sequence as `onMounted` (`:2200-2204`): a
   request made while deactivated went pending, and no `pageVersion` bump will consume it.
6. `refreshSearchLayer()`: the search state may have changed while the grid was detached.

Scroll tracking: add `lastScroll = { top, left }`, written in `onViewportScroll` (`:772`, it
already reads `el.scrollTop`, add `scrollLeft`) and seeded where `onMounted` restores from tab
state (`:2132-2135`). `persistScroll` writes `lastScroll` instead of reading `el` (`:793`). This
also closes the §1.9 hazard of a timer firing after detach.

Watchers stay live while deactivated. They act on state, and a detached grid does no style or
layout work, so they are cheap. `pageVersion`, meta, appearance and width watches that run
meanwhile leave the grid model current; `resizeCanvas()` at activation paints it. A tab closed while
deactivated follows today's close-of-active-tab ordering: store drops runtime, then the Vue flush
unmounts. The watches already guard `!grid || !dataSource` and a missing page.

`kiraSlickGrid.ts`'s document capture-phase `scroll` listener stays bound per warm grid (at most 5).
Its handler is two containment checks and does nothing for a detached grid. Accepted as audited.

`CellEditorDock`/`MonacoHost` need no change: `automaticLayout: true` (`MonacoHost.vue:372`) relays
out on reattach. `SearchToolbar.vue` autofocuses only on mount: a reactivated tab with search open
no longer steals focus into the search box. That is the correct behaviour for a return to an
unchanged tab; §6 catches any spec that relied on it.

### 3.4 `SlickGridHost.vue`: one column build per mount

Measured as prototype B2 (§1.8): 321 to 201 ms p50 cold mount, `consoleErrors` empty, headers carry
`data-column`.

- Grid options: `explicitInitialization: false` becomes `true` (~`:2063`).
- Call `grid.init()` right after the last `eventHandler.subscribe` / `subscribeRangeSelecting`
  (~`:2090`), before the P104 §6.4 block that reads the header panes.
- Delete `rebuildAndSetColumns()` in `onMounted` (`:2129`) and its workaround comment
  (~`:2105-2128`). The header listeners it compensated for are now subscribed before the only
  build. Keep `rebuildAndSetColumns` itself: the meta/appearance/width watches still call it.
- `slick-grid.spec.ts`'s switch-away-and-back test (~`:1424-1500`) pins the header select zone
  and sort indicators this workaround existed for. With §3.1 in place, that switch no longer
  remounts. Make it still cover a real remount: close and reopen the tab (or open it fresh) before
  asserting the header controls, in addition to the switch.

### 3.5 Keystroke metric: on-screen popup, not the `.visible` timer

`measureKeyToPopup` (`budgets.spec.ts:328-354`) waits for `.suggest-widget.visible`. Replace the
predicate with one in-page function used both to resolve the probe and to confirm the popup is
hidden between keystrokes:

```ts
// Monaco adds `.visible` 100 ms after the widget is on screen (SuggestWidget._show's
// setTimeout, onDidShow); suggest.css styles nothing on it.
function suggestPopupShown(): boolean {
  const w = document.querySelector<HTMLElement>('.suggest-widget');
  if (!w || getComputedStyle(w).visibility !== 'visible' || w.offsetHeight === 0) return false;
  return w.querySelector('.monaco-list-row') !== null;
}
```

- `MutationObserver` options add `'style'` to `attributeFilter` (Monaco toggles visibility through
  inline style).
- Page-side, inline the predicate in each `evaluate` (no cross-context function passing).
- The `:833-841` warm-up and Escape waits switch from the `.suggest-widget.visible` locator to
  `expect.poll(() => page.evaluate(suggestPopupShown-inline)).toBe(true|false)`. Otherwise a still
  visible widget would resolve the probe at 0 ms.
- Update the `:333-336` comment accordingly. PERF.md §1 row `:31` metric text follows (§3.6).

This is a measurement fix, not a bound fix: PERF.md's budget is "completion popup visible", and
the popup is visible at 27-32 ms (§1.5).

### 3.6 Bounds and docs

Per assertion, against PERF.md §1 and §2.1:

| Assertion | Today | New | Evidence |
|---|---|---|---|
| `:765` cell to editor p95 | `<= 1000` | `<= 50` restored | 37-41 ms p95 unmodified (§1.1); SPEC row: 23-33 ms |
| `:802` cached tab switch p95 | `<= 1000` | `<= 50` restored | 8-9 ms p95 with per-tab `KeepAlive` (§1.8 K) |
| `:820` cached tree expand p95 | `<= 1000` | `<= 50` restored | 24-39 ms p95 (§1.1); SPEC row: 21-43 ms |
| `:846` keystroke p50 | `<= 1000` | `<= 50` restored | popup on screen 27-32 ms after keydown (§1.5) |
| `:847` keystroke max | `<= 1000` | `<= 200` restored | pre-port bound (`9ee240f0`^); on screen at 27-32 ms in every probe keystroke (§1.5) |

No bound stays wider. Each `logStats` label and section header already says the restored value.

`docs/PERF.md`:

- §1 row `:31`: metric text becomes "last keypress to `.suggest-widget` on screen (computed
  `visibility: visible`, a list row rendered)", with one clause on why not `.visible`.
- §2.1 rows `:47-50`: this sandbox's numbers from §6's runs, labelled with the environment (as
  the `:60` note does). Keystroke budget cell becomes `<= 50 ms (p50)`.
- Replace the `:60-65` note: the `<= 1000` gate came from the P57 M5 port (`9ee240f0`); before it
  the spec asserted p50 <= 50 / max <= 200; the 113 ms was Monaco's `.visible` timer.
- M5 table `:145`: note that ~48/85 ms measured `DataGrid.vue`, before `SlickGridHost.vue`
  (`d01b082e`).
- New short paragraph: cold switch (first open, evicted tab) on WebKit ~200 ms p50 after §3.4,
  not gated, cause §1.7.

`docs/ARCHITECTURE.md`: in the `MainView.vue` paragraph (`:1360-1368`) add one sentence: Kira
Studio keeps up to 5 `data` tabs alive per `host.keepAlive`, per-tab `KeepAlive`, closed or evicted
tabs truly unmount. In the RepoGraph paragraph (`:3577-3580`), "in either app" is still true for
`RepoGraphView` (Space sets no `keepAlive`); make that explicit so the sentence stays true.

### 3.7 Specs that relied on "every switch remounts"

Two specs pin fixes for a remount with the tab's runtime (meta, mask state) still cached. After
§3.1 a plain switch reactivates instead, so they would silently stop covering the cold path. Keep
each spec's existing switch step (it now covers reactivation, §3.3). Add a real remount after it:
evict the tab past the warm cap, then click back.

- New helper `apps/kira-studio/tests/ui/support/evictWarmTab.ts`:
  `evictWarmDataTab(page, openPath)` opens `WARM_DATA_TABS` (5, comment names
  `workbench/host.ts`'s `keepAlive.max`) new data tabs on `openPath` via
  `menu-item-open-data-new-tab`, waiting for each grid header. The original tab is then the least
  recently used, so it is evicted and unmounts.
- `slick-grid.spec.ts` "P22 postscript" test (~`:1427-1506`): after the existing switch-back
  asserts, call the helper, click the first tab, repeat the badge / select-zone / nav-button
  asserts. Rewrite the header comment (`:1418-1426`): the workaround is gone (§3.4); the test
  covers reactivation and a cached-meta remount.
- `mask-preview.spec.ts` M7 #5 block (~`:280-305`): same shape, preview still on across the
  eviction remount. Rewrite `:283-285`'s "remounts on every tab switch" comment.
- Scroll restore, new coverage (§1.9 makes it a real regression risk): in the same
  `slick-grid.spec.ts` test, before switching away, scroll the first tab's viewport to a nonzero
  `scrollTop`/`scrollLeft`. After switching back, assert both equal (`expect.poll` on the
  `.slick-viewport` values) and that `grid-row` count is > 0. Repeat after the eviction remount
  (persisted-state path). No other spec checks grid scroll across a switch.

## 4. File ownership (one sequential implementer)

No split. §3.1-§3.4 are one order-dependent chain: the spec edits in §3.7 assume the `KeepAlive`
behaviour, and one full `test:ui:studio` run verifies them together.

| File | Change | Step |
|---|---|---|
| `packages/workbench/src/tabs/warmTabs.ts` (new) | `nextWarmIds` | 1 |
| `packages/workbench/src/tabs/warmTabs.test.ts` (new) | 5 cases (§3.1) | 1 |
| `packages/workbench/src/host.ts` | `WorkbenchKeepAlive`, `keepAlive?` | 2 |
| `packages/workbench/src/components/MainView.vue` | per-tab `KeepAlive` | 2 |
| `apps/kira-studio/frontend/src/workbench/host.ts` | `keepAlive: { kinds: ['data'], max: 5 }` | 2 |
| `apps/kira-studio/frontend/src/views/grid/DataView.vue` | activate/deactivate (§3.2) | 3 |
| `packages/workbench/src/shortcuts/commands.ts` | header comment | 3 |
| `apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue` | §3.3 hooks, scroll tracking (step 4); B2 (step 5) | 4, 5 |
| `apps/kira-studio/frontend/src/views/shared/slick/scrollTrace.ts` | `registerGrid` comment | 4 |
| `apps/kira-studio/tests/ui/support/evictWarmTab.ts` (new) | helper | 6 |
| `apps/kira-studio/tests/ui/slick-grid.spec.ts` | eviction remount, scroll restore, comment | 6 |
| `apps/kira-studio/tests/ui/mask-preview.spec.ts` | eviction remount, comment | 6 |
| `apps/kira-studio/tests/ui/budgets.spec.ts` | `measureKeyToPopup`, `:833-841` waits (step 7); 5 bounds (step 8) | 7, 8 |
| `docs/PERF.md` | §3.6 edits, measured numbers | 9 |
| `docs/ARCHITECTURE.md` | two sentences (§3.6) | 9 |
| `docs/v2.0/SPEC.md` | `## P139 Part 2 result` | 10 |

## 5. Ordered commit steps

Each commit passes the pre-commit hook normally; never `--no-verify`. Fast checks per commit
(`bun run lint`, `bun run typecheck`, `bun run test:unit` for step 1). Run the expensive suite once,
at §6. Push the implementation branch after each commit (resumability); never the chapter branch.

1. `feat(workbench): warm-tab LRU for kept-alive views` — `warmTabs.ts` plus its test.
2. `perf(workbench): keep warm data tabs alive per tab` — host field, `MainView.vue`, Studio host.
   Before committing, run `budgets.spec.ts` alone once
   (`bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui-timing --no-deps -g "interaction budgets"`,
   after `bun run build:test:studio`) and confirm tab switch p95 < 50 in its log line. The `<= 1000`
   bound still stands at this step.
3. `fix(studio): data view commands follow tab activation` — §3.2.
4. `fix(studio): grid deactivates and restores on tab reactivation` — §3.3, scroll tracking
   included.
5. `perf(studio): build SlickGrid columns once per mount` — §3.4.
6. `test(studio): cover grid remount by warm-tab eviction and scroll restore` — §3.7. Run
   `slick-grid.spec.ts` and `mask-preview.spec.ts` alone (`--project=ui`) before committing.
7. `test(studio): time keystroke to on-screen suggest popup` — §3.5.
8. `test(studio): restore PERF.md interaction budgets in budgets.spec.ts` — §3.6 table, five
   assertions.
9. `docs: P139 Part 2 budgets and warm data tabs` — PERF.md and ARCHITECTURE.md, numbers from §6.
   Land after §6's three runs; fix commits for anything §6 finds land before it.
10. `docs(v2.0): P139 Part 2 result` — SPEC.md result section: every run's numbers (§6 list),
    commit list, any open point still open.

## 6. Verification

Run with no other session, build or test in the container. Record `uptime` before each run.

1. **Pre-check**, quiet: `ui-timing` alone, `--repeat-each=3`. Record the four budgets' p50/p95.
2. **3 consecutive full `bun run test:ui:studio` runs.** A full run is ~9 min, over the Bash
   tool's 10 min cap with no margin, and a container restart kills background runs. So run each
   full run in the foreground as chunks, same build, back to back:
   ```sh
   bun run build:test:studio
   bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui --shard=1/2 2>&1 | tee /tmp/p139p2-run1-a.log
   bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui --shard=2/2 2>&1 | tee /tmp/p139p2-run1-b.log
   bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui-timing --no-deps 2>&1 | tee /tmp/p139p2-run1-t.log
   ```
   Give each Bash call `timeout: 600000`. If a shard nears the cap, use `--shard=k/3`. A run
   counts only if all its chunks pass. Any failure resets the count to 0: root-cause and fix it
   (CLAUDE.md, pre-existing or not), commit, rebuild, restart the count.
3. Per run record: cell to editor, tab switch, tree expand p50/p95, keystroke p50/max, and the
   `uptime` load average.
4. **A breached 50 ms bound is a root-cause task, not a widening.** Re-run once under recorded
   load average < 2. If it still fails, find what the window covers (§1.2 method: marks, not
   guesses), fix it, and record it. A bound may only go wider with measured evidence that the
   budget, not the code, is wrong, written in this plan's result section and raised to the
   orchestrator before landing.
5. `bun run test:unit` (includes `warmTabs.test.ts`), `bun run lint`, `bun run typecheck`.
6. `bun run test:ui:space` once: `MainView.vue` is shared, Space must be unchanged. Chunk the same
   way if it exceeds the cap.
7. Manual check in the Studio test build (one pass, record in result): open 7 data tabs, switch
   among them, close the active one and a background one, confirm no console error and Find /
   Refresh act on the visible tab.

## 7. Closing audit

```sh
rg -n 'toBeLessThanOrEqual\(1000\)' apps/kira-studio/tests/ui/budgets.spec.ts     # empty
rg -n 'toBeLessThanOrEqual\((50|200)\)' apps/kira-studio/tests/ui/budgets.spec.ts # 5 hits: :765 :802 :820 :846 :847 area
rg -n "suggest-widget\.visible" apps/kira-studio/tests/ui/budgets.spec.ts         # only the explanatory comment
rg -n 'KeepAlive' packages/workbench/src/components/MainView.vue                  # the v-for KeepAlive
rg -n 'keepAlive' apps/kira-studio/frontend/src/workbench/host.ts apps/kira-space/frontend/src/workbench/host.ts  # Studio only
rg -n 'nextWarmIds' packages/workbench/src                                          # warmTabs.ts, its test, MainView.vue
rg -n 'explicitInitialization: true' apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue  # 1 hit
rg -n 'grid\.init\(\)' apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue                # 1 hit
rg -n 'onActivated|onDeactivated' apps/kira-studio/frontend/src/views/grid/DataView.vue apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue  # both files
rg -n 'lastScroll' apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue       # onViewportScroll, persistScroll, onActivated, onDeactivated, mount seed
rg -n 'mounted only while|ever mounted at a time|remounts on every tab switch|at most one grid is ever mounted' apps packages  # empty
rg -n 'evictWarmDataTab' apps/kira-studio/tests/ui                                  # helper + 2 specs
git diff 035bbbeb --stat -- apps/kira-space                                         # empty
```

## 8. Risks

- **Retained memory.** Up to 5 warm grids plus their Monaco cell editors stay in memory. Bounded
  by the cap; `leaks.spec.ts` opens 20 data tabs and checks store retention on close, which now
  also exercises eviction. Store retention is unchanged: close still drops page stores first.
- **Deactivated watchers.** A background tab's `pageVersion`/meta/appearance watches still run
  against a detached grid. A detached grid does no style or layout work, so this is cheap. A future
  watch that reads layout (scroll into view, focus) would silently no-op while deactivated;
  §3.3's activation `resizeCanvas()` / `refreshSearchLayer()` repaint covers today's set.
- **Hook order on close of the active tab.** Both `onDeactivated` and `onUnmounted` run. Every
  disposer is idempotent (`registerCommand` disposer, `Map.delete`, guarded `unregisterGrid`) and
  §3.3's `onDeactivated` guards `grid` non-null.
- **Focus.** Reactivation does not restore focus to the grid; a remount did not either. The search
  box no longer autofocuses on return (§3.3). Specs that relied on either surface in §6.
- **Inline edit on switch away is cancelled** (parity). Committing instead would be a behaviour
  change; not made here.
- **B2 header controls.** Header listeners now subscribe before the first build. The eviction case
  in §3.7 is the regression guard for the workaround's original bug.
- **Thin margins** on cell to editor and tree expand (§0 item 6). §6 item 4 governs a breach.
- **Cold switch still ~200 ms on WebKit** (first open, evicted tab). Not gated (§0 item 4).

## 9. Acceptance

- Cached tab switch p95 <= 50 ms measured in every §6 run (prototype: 8-9 ms).
- `budgets.spec.ts` assertions match their section headers: `:765`, `:802`, `:820` p95 <= 50;
  keystroke p50 <= 50 and max <= 200. No `<= 1000` left.
- `ui-timing` and `ui` pass on 3 consecutive full `bun run test:ui:studio` runs (chunked, §6),
  numbers recorded in the result. `bun run test:ui:space` passes once.
- Closed and evicted data tabs truly unmount (eviction specs green, `leaks.spec.ts` green).
- Scroll position survives switch away and back, and eviction remount (§3.7 asserts).
- PERF.md §1/§2.1 and the keystroke note corrected; ARCHITECTURE.md records the warm-tab rule.
- §7 audit clean. §0 items raised to the orchestrator/user.
