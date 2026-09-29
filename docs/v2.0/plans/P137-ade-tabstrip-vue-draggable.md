# P137 — `ade` repo tabs on the shared `TabStrip`; `TabStrip` drag-reorder on `vue-draggable-plus`: plan

Plan for `docs/v2.0/SPEC.md`'s **P137** row. Planned against chapter branch
`claude/unfinished-phases-ru3wo4` at `ff77106d`. Every line number below is at that commit.

**Discovery method, disclosed.** The shared CodeGraph index pointed at the main checkout
(`/home/user/kira-studio`, branch `landing-p131-p135`, a different commit). One
`codegraph_explore` ran against it before the mismatch warning; then `codegraph init .` built a
worktree-local index and 7 more `codegraph_explore` calls ran against it, each before any
`Read`/`rg` of the files it covered: `TabStrip.vue` drag handlers and template; `useWorkbenchHost`/
`TabLike`/`WorkbenchHost`/Space `createWorkbenchHost`/`tabsForWorkspace`; `AdeRepoTabs`/`AdeView`/
`useAdeUiStore`/`AdeActivityIcon`; `vue-draggable-plus` usage (`useTimelineDrag`, `AdeTimeline`,
`useDragReorder` consumers); `TabKindDef`/`tabChipVariants`/`useCodeReposStore`; `CodeReposRepo`
ordering and reorder support; who renders `TabStrip` (`WorkbenchShell` in both apps). `Read`/`rg`
then pinned template line ranges, test locators and the library's own dist source.

---

## 0. Open points and resolutions

| Open point | Resolution | Where |
|---|---|---|
| Split into Part 1/Part 2? | **No.** Both deliverables edit `TabStrip.vue`; the `ade` adapter needs the seam the first commit adds. Order-dependent, one file shared. One sequential implementer. | §2 |
| (1) `ade` adapter vs `TabStrip` seam | **`TabStrip` grows a narrow injectable seam; `ade` supplies a small adapter that implements only that seam.** New `TabStripHost` interface in `host.ts` (what `TabStrip` actually reads), `WorkbenchHost extends TabStripHost`, `TabStrip` takes an optional `host` prop falling back to `useWorkbenchHost()`. Reasons in §3.1. | §3.1 |
| Why not a full `useWorkbenchHost`-shaped `ade` host | It forces ~10 members `ade` has no meaning for (`views`, `defaultState`, `parseState`, `duplicateState`, `dropResources`, `closeOthers`, `duplicateTab`, `promoteTab`, `isPreview`, `tabs`) as no-op stubs, and a `provide(workbenchHostKey)` inside `ade` shadows the app's real host for the whole `ade` subtree. That is a special case wearing a seam's shape. | §3.1 |
| Close, middle-click, context menu on `ade` tabs | `ade` repo tabs have no close today; closing a repo tab has no defined meaning (repo removal is a separate destructive act). **Capabilities become optional on the seam**: no `closeTab` means no close button, no middle-click close, no Close items. `ade`'s context menu is left with `Copy name` only (the pinned tab's own menu today, `TabStrip.vue:71-81`). | §3.1, §3.2 |
| (2) Drag-reorder mechanism | `useDraggable` (`vue-draggable-plus` 0.6.1, root `package.json:123`) on the scrolling row, `forceFallback`, bound to a local id-mirror list so the library reverts its own DOM move, commit through `host.tabs.moveTab` in `onUpdate`. No new dependency. | §3.3 |
| Pinned leading slot under the new drag | Pinned chips live in `tab-strip-pinned` (`TabStrip.vue:225-257`), a sibling container never registered with Sortable: never a drag source, never a drop target. `moveTab`'s own pinned guard (`createTabsStore.ts:540`) stays as the store-level backstop. | §3.3 |
| Cross-workspace / cross-kind constraints | Row renders only the active workspace's non-pinned tabs (`scrollingTabs`, `TabStrip.vue:141-143`); `group: { name: 'tab-strip', pull: false, put: false }` so nothing enters or leaves a row. `moveTab(fromId, toId)` with ids read off the pre-move row is exact even with other workspaces' tabs interleaved in the global array (§3.3 proof). | §3.3 |
| (3) P129 Part 7 state | **Landed** (`9c0f9ee2` `feat(space): ade pinned All agents tab and view`; SPEC `## P129 Part 7 result` at `SPEC.md:2677`). P137 lands second. Per Part 7 plan §0.1 (`P129-part7-all-agents-view.md:33-43`), P137 moves only the trigger into `TabStrip`'s pinned slot and binds `activitySummary`'s count plus `adeUi.showAllAgents`/`showRepo`. `adeUi.allAgents`, `AdeAllAgentsView.vue`, `activity.ts` untouched. | §3.4 |
| Pinned "All agents" shows a label; `TabStrip`'s pinned chip is icon-only | New optional `pinnedTitle?: true` on the kind: a pinned chip of such a kind renders icon, leading slot and title, no tooltip. Absent (Kira Space's `repo-graph`) keeps today's icon-only chip byte-for-byte. | §3.2 |
| Needs-input count inside a chip | New scoped slot `#tab-leading="{ tab }"`, rendered after the icon in scrolling chips and labelled pinned chips. `#new-tab` (`TabStrip.vue:343`) is the slot precedent. No host hook: the count is an app component (`AdeActivityIcon`), not a codicon, so `tabIndicator`/`tabBadge` (`host.ts:63,77`) cannot carry it. | §3.2 |
| Does `ade` need drag-reorder? | **No, not in P137.** Repo order is `code_repos.sort_order` (`codeworkspace.go:85-90`), shared with the Git panel's repo list (`GitPanel.vue:111-115` reads the same `codeReposStore.records`). No reorder path exists: `CodeReposRepo` has only `List/Get/Create/Rename/Remove` (`coderepos.go:27-95`), `useCodeReposStore` no reorder action (`coderepos.ts:12-102`). Adding one is a Go + bridge + store change affecting another module's list: a real design decision, outside this row. `ade`'s adapter omits `moveTab`, so `TabStrip` creates no Sortable for it. Today's behaviour ("no drag-reorder", per the row) is kept. **Flagged to the user as an open point.** | §3.4, §11 |
| (4) Existing drag specs to convert | **None exist.** `rg` over `apps/kira-studio/tests`, `apps/kira-space/tests`, `packages/workbench/src` finds no spec dispatching `dragstart`/`dragover`/`DataTransfer`/`dragTo` on a tab. The only tab-reorder coverage is store-level: `apps/kira-space/tests/unit/repo-tab-slots.spec.ts:251-275` (`moveTab` pinned guards), unaffected since `moveTab` does not change. The row's "drag-reorder suites" premise is corrected here, not in SPEC. New mouse-sequence specs are added in both apps (§6). | §6 |
| Existing specs that change | Only `ade` locators: `ade-all-agents.spec.ts`, `ade-module.spec.ts`, `ade-timeline.spec.ts` (29 matching lines; `ade-repo-tab`/`ade-all-agents-tab` test ids, `data-state` and one border-colour assertion). Behaviour asserted stays the same. Every other file among the 31 `rg` hits for tab-strip test ids stays unchanged. | §6.2 |
| Visual changes on `ade` tabs | Intended by the user's ask ("same tab bar used everywhere else"): tab chip look (`tabChipVariants`), `repo`/`terminal` codicons, rail bar, pinned separator, `h-tabbar` row on `bg-chrome`. Dropped: mockup amber top border `#e8a33d`, `#2a2d35` right border, `#d97757` icon tint (all three hex literals leave `ade/`, shrinking P138's audit list). Lost: reka `Tabs` arrow-key roving and `role="tab"` semantics; `TabStrip` chips are Tab-focusable buttons, Enter/Space activates. Disclosed in the result. | §3.4, §10 |
| `useDragReorder.ts` rationale | Its comment (`useDragReorder.ts:16-26`) says `useSortable` "needs sortablejs (not installed)" and that `TabStrip` keeps its own native mechanism. Both are stale after P129 Part 5 and this phase. P137 rewrites only the `TabStrip` paragraph (now false). Migrating its three consumers (`EnvironmentsView.vue`, `VariableSetView.vue`, `ColumnsMenu.vue`) onto `vue-draggable-plus` is outside this row. **Flagged to the user** as a candidate follow-up row; P137 does not add it. | §3.3, §11 |
| (5) Linux-verifiable vs not | Playwright/Chromium on Linux verifies every behaviour here. Not verifiable: drag feel in WebKitGTK/WKWebView, macOS trackpad drag. | §9 |
| Library rule | No new dependency. `vue-draggable-plus` (MIT, bundles SortableJS MIT) already installed. VueUse `useEventListener` import drops from `TabStrip.vue` if nothing else uses it. No new SFC with `<style>`; all `<script setup lang="ts">`; Tailwind utilities only. No new Pinia store: the adapter reads `useCodeReposStore`/`useAdeUiStore`; counts stay on the existing `useAdeSessions` TanStack query. | §3 |

## 1. Confirmed current state

**`packages/workbench/src/components/TabStrip.vue`** (353 lines)
- `:23` `const host = useWorkbenchHost()`; only other caller of `useWorkbenchHost` is `MainView.vue`.
- `:32-50` `isPinned`/`titleFor`/`badgeFor`/`indicatorFor`/`isAttention` read `host.kinds[kind]` and optional host hooks.
- `:52-65` click activates; middle-click closes unless pinned; close button closes.
- `:70-131` context menu: pinned gets `Copy name` only; others get Close, Close others, Close to the right, Close all, separator, Duplicate tab, Copy name, kind `menuExtras`, host `extraTabMenu`.
- `:133-143` `tabs` = `tabsForWorkspace(activeWorkspace)`; split into `pinnedTabs`/`scrollingTabs`.
- `:147-161` scroll-into-view on active change, by `[data-tab-id]`.
- `:165-167` wheel to horizontal scroll.
- `:169-210` **native drag-reorder**: `dragId` ref; `onDragStart`/`onDragOver` (calls `host.tabs.moveTab(from, id)` live, every crossing)/`onDragEnd`; delegated `useEventListener(stripRef, 'dragstart'|'dragover'|'dragend')`, `closest('[data-testid="tab"]')`.
- `:225-257` pinned slot `tab-strip-pinned`: icon-only `<button data-testid="tab" data-pinned="true" :draggable="false">` in a `Tooltip`, then a separator span.
- `:258-263` scrolling row `tab-strip-row` (`ref="stripRef"`, `overflow-x-auto`, `@wheel`).
- `:268-286` chip `<div data-testid="tab" ... draggable="true">`, `{ 'opacity-50': dragId === tab.id }` at `:275`.
- `:288-323` inner button: click, `@dblclick` promote (`:292`), `@auxclick.middle` (`:293`), context menu; icon, indicator, title (italic when preview), badge.
- `:324-333` close button `tab-close`.
- `:343` `#new-tab` slot.

**`packages/workbench/src/host.ts`**: `TabLike` `:17-22`; `WorkbenchTabsHost` `:28-41` (all methods required); `TabIconRender` `:47`; `WorkbenchHost` `:49-78`; `workbenchHostKey` `:87`; `useWorkbenchHost` `:89-98` (throws when nothing provided).

**`packages/workbench/src/state/createTabsStore.ts`**: `moveTab` `:528-549` (pre-splice target index, F6; refuses pinned source or target; `saveNow()`); `tabsForWorkspace` `:598-606` (pinned first).

**`packages/workbench/src/tabs/types.ts`**: `TabKindDef` `:11-44`, `pinned?: true` `:43`; `TabKindRegistry` `:46-54` (mapped type).

**`TabStrip` renderers**: `packages/workbench/src/components/WorkbenchShell.vue:143-145` (container `h-tabbar min-h-0 overflow-hidden shrink-0 border-b border-border bg-chrome`, `data-testid="tab-strip"`); `apps/kira-space/frontend/src/workbench/WorkbenchShell.vue:62-68`; Kira Studio's own `workbench/WorkbenchShell.vue`. Kira Space hides that row for `layout: 'full'` (`:56`, `tabStripVisible`), so `ade` mode shows no shell strip.

**`apps/kira-space/frontend/src/ade/AdeRepoTabs.vue`** (82 lines): shadcn `Tabs`/`TabsList`/`TabsTrigger`; `ALL_AGENTS_TAB = '__all__'` `:21` (model-value sentinel only); `needsInput` `:30`, `allAgentsCount` `:32-34`; `select` `:40-43` routes to `showAllAgents`/`showRepo`; pinned trigger `:53-63` (`data-testid="ade-all-agents-tab"`, `terminal` icon tinted `#d97757`, count, label); repo triggers `:64-79` (`data-testid="ade-repo-tab"`, `data-repo-id`, count, name); hex `#2a2d35`, `#e8a33d` at `:56`, `:70`. No close, no reorder.

**`AdeView.vue`**: records watch `:28-35` (`setActiveRepo` fallback to first record); `<AdeRepoTabs />` `:66`.
**`ade/state/adeUi.ts`**: `setActiveRepo` `:67-69`, `showRepo` `:72-75`, `showAllAgents` `:79-81`.

**Existing `vue-draggable-plus` use**: `ade/useTimelineDrag.ts:41-58` (`useDraggable(el, opts)`, no list, `sort: false`, `forceFallback`, `fallbackOnBody`, `fallbackTolerance: 4`, single-class `ghostClass`/`chosenClass`). Its UI specs drive it with `mouse.move`/`down`/`move +10`/`move to target, steps`/`up` (`ade-timeline.spec.ts:146-152`, `ade-panel.spec.ts:185-190`).

**Library internals, read in `node_modules/vue-draggable-plus/dist/vue-draggable-plus.js`**:
- `:1481` internal `onStart`/`onUpdate`/`onAdd`/`onRemove`/`onEnd` install **only when a list is bound** (`r === null ? {} : G`).
- `:1420-1436` internal `onUpdate`: removes the moved node, re-inserts it at `oldIndex` (DOM revert, `Tt` at `:50-53`), then reorders the bound list. `customUpdate` (`:1387`) skips the revert.
- `:67-72` user handlers are chained after internal ones (`_n`/`Dn`).
- `:1437-1466` internal `onEnd` restores DOM order on a no-op drop.
- `:705` Sortable starts only on the left button; middle/right clicks never start a drag.

## 2. Split

None. One implementer, one worktree, commits in §8 order.

## 3. Design

### 3.1 Seam: `TabStripHost` (`packages/workbench/src/host.ts`)

Precedent: P103 Part 2 built `WorkbenchHost` as a seam rather than per-app branches; P100/P127/P128
kept extending seams instead of special-casing callers. P137 follows it: the seam is what
`TabStrip` consumes, nothing more.

Add, beside `WorkbenchTabsHost`:

```ts
export interface TabStripKind<R extends TabLike> {
  pinned?: true;
  /** A pinned chip of this kind shows its title, not icon-only. */
  pinnedTitle?: true;
  title(tab: R): string;
  menuExtras(tab: R): MenuItem[];
}

export interface TabStripTabs<WK extends string, R extends TabLike> {
  readonly activeIdByWorkspace: Record<WK, string | null>;
  tabsForWorkspace(key: WK): R[];
  activateTab(id: string): void;
  // Optional capabilities: absent hides the matching affordance.
  isPreview?(id: string): boolean;
  promoteTab?(id: string): void;
  closeTab?(id: string): void;
  closeOthers?(id: string): void;
  closeToTheRight?(id: string): void;
  closeAll?(key: WK): void;
  duplicateTab?(id: string): unknown;
  moveTab?(fromId: string, toId: string): void;
}

export interface TabStripHost<WK extends string, R extends TabLike> {
  readonly activeWorkspace: ComputedRef<WK>;
  readonly tabs: TabStripTabs<WK, R>;
  readonly kinds: { readonly [kind: string]: TabStripKind<R> | undefined };
  iconFor(tab: R): TabIconRender;
  railColorFor(tab: R): string | undefined;
  extraTabMenu?(tab: R): MenuItem[];
  tabBadge?(tab: R): { icon: string; tooltip: string } | null;
  tabAttention?(tab: R): boolean;
  tabIndicator?(tab: R): { icon: string; tooltip: string } | null;
}
```

- `WorkbenchHost<WK, R> extends TabStripHost<WK, R>`, keeping its own `tabs: WorkbenchTabsHost`
  and `kinds: TabKindRegistry<…>` (both narrower subtypes) and `views`. Move the four optional hook
  declarations and their doc comments from `WorkbenchHost` into `TabStripHost`; do not duplicate
  them. Both apps' `createWorkbenchHost()` keep compiling unchanged: the compiler now enforces
  that every `WorkbenchHost` is a `TabStripHost`.
- `TabKindDef` (`types.ts:11-44`) gains nothing. `pinnedTitle` lives only on `TabStripKind`.
- `TabStrip.vue`: `const props = defineProps<{ host?: TabStripHost<string, TabLike> }>()`;
  `const host = props.host ?? useWorkbenchHost()`. Read once in setup: a host object is stable
  for the component's life (both apps build it once; `ade` builds it once per `AdeRepoTabs`
  mount). One comment line says so.

Why a prop, not a second injection key: `ade` renders `TabStrip` directly, one level down, so
provide/inject buys nothing and a second key leaks into descendants. `WorkbenchShell`'s own
`TabStrip`s pass no prop and keep the injected host, exactly as today.

### 3.2 `TabStrip` capability gating, leading slot, labelled pinned chip

- `onMiddleClick`: return when pinned **or** `!host.tabs.closeTab`.
- Close button (`:324-333`): `v-if="host.tabs.closeTab"`.
- `@dblclick`: `host.tabs.promoteTab?.(tab.id)`. Preview italic: `host.tabs.isPreview?.(tab.id) ?? false`
  (also `data-preview`).
- Context menu (non-pinned): build the close group from whichever of `closeTab`/`closeOthers`/
  `closeToTheRight`/`closeAll` exist; the duplicate/copy group always has `Copy name`, plus
  `Duplicate tab` when `duplicateTab` exists; the separator only when the close group is
  non-empty. With every capability present the item list is identical to today's (same ids,
  order, labels, icons, shortcut). Keep `onContextMenu` under biome's complexity ceiling with one
  small helper (`closeItems(tab)`).
- Scoped slot `<slot name="tab-leading" :tab="tab" />` right after the icon in the scrolling
  chip's inner button (before the indicator) and in a labelled pinned chip. Studio and Space pass
  none, so nothing renders.
- Pinned chip: when `host.kinds[tab.kind]?.pinnedTitle`, render
  `tabChipVariants({ active: tab.active })` (default size) with icon, `tab-leading` slot and
  `<span class="tab-title truncate min-w-0">` title, no `Tooltip` wrapper (the label is visible;
  `aria-label` stays `titleFor(tab)`). Otherwise today's icon-only `Tooltip` chip, unchanged.
  Same `data-testid="tab"`, `data-pinned="true"`, `data-tab-id`/`-kind`/`-active` on both.
- Delete `:draggable="false"` (`:240`); a `<button>` is not draggable by default.

### 3.3 Drag-reorder on `vue-draggable-plus`

Replace `:169-210` and the chip's `draggable="true"` (`:285`) and `opacity-50` binding (`:275`).

```ts
// Id mirror of the row: the library reverts its own DOM move only when a list is bound
// (dist :1481), then onUpdate commits through the store.
const rowIds = shallowRef<string[]>([]);
watch(() => scrollingTabs.value.map(({ tab }) => tab.id), (ids) => { rowIds.value = ids; },
  { immediate: true });

const moveTab = host.tabs.moveTab;
if (moveTab) {
  useDraggable(stripRef, rowIds, {
    draggable: '[data-testid="tab"]',
    filter: '[data-testid="tab-close"]',
    preventOnFilter: false,
    direction: 'horizontal',
    group: { name: 'tab-strip', pull: false, put: false },
    forceFallback: true,
    fallbackOnBody: true,
    fallbackTolerance: 4,
    ghostClass: 'opacity-50',
    onUpdate: (evt) => {
      const ids = scrollingTabs.value.map(({ tab }) => tab.id);
      const from = ids[evt.oldDraggableIndex ?? -1];
      const to = ids[evt.newDraggableIndex ?? -1];
      if (from && to) moveTab(from, to);
    },
  });
}
```

Exact option names and event field names get confirmed against `useDraggable.d.ts` and
`@types/sortablejs` during implementation; the shape above is the contract.

- **Why a bound list.** Sortable moves the real chip in the DOM during a sort. Without a bound
  list vue-draggable-plus installs no internal handlers (`dist :1481`) and leaves the DOM moved
  under Vue's keyed `v-for`, which then patches against the wrong order. With `rowIds` bound, the
  internal `onUpdate` reverts the move (`:1420-1436`) and reorders `rowIds`; our chained `onUpdate`
  (`:67-72`) then calls `moveTab`, the store re-renders the row in the new order, and the watch
  re-syncs `rowIds`. `useTimelineDrag` gets away with no list only because it uses `sort: false`.
- **Why not `customUpdate`.** It skips the DOM revert (`:1420-1423`).
- **Index mapping is exact.** `scrollingTabs` read inside `onUpdate` is still the pre-move order
  (the store has not changed yet). `moveTab(from, to)` splices `from` out of the global array and
  inserts at `to`'s pre-splice index (`createTabsStore.ts:536-546`). Rightward: `from` lands
  directly after `to`, which is filtered position `newIndex`. Leftward: directly before `to`,
  again `newIndex`. Other workspaces' tabs interleaved in the global array never sit between
  `from` and its new neighbour, so the filtered order is right in both directions.
- **One save per drop.** Today `moveTab` (and `saveNow`) runs on every dragover crossing. Now it
  runs once, on drop. Visual feedback is the same: Sortable moves the `opacity-50` ghost chip
  live along the row while a fallback clone follows the pointer.
- **Pinned slot**: outside `stripRef`, so never sortable (§0).
- **Scroll row**: `fallbackOnBody` keeps the clone out of the row's `overflow-x-auto` clip.
  Sortable's autoscroll scrolls the row near its edges while dragging. `onWheel` and the
  active-tab `scrollIntoView` watch are untouched.
- **Click, dblclick, middle-click, context menu, close**: `fallbackTolerance: 4` means a click
  without movement never starts a drag; Sortable ignores non-left buttons (`dist :705`); `filter`
  on `tab-close` keeps a press on the close button from starting one, `preventOnFilter: false`
  keeps its click. Keyboard: there is no keyboard reorder today (`:192-194` comment), none added;
  Tab focus, Enter/Space activation and the close button's own focusability stay as they are.
- **Single class**: `ghostClass: 'opacity-50'`, one utility (P129 Part 5 §0.12: Sortable toggles
  one class name).
- `useEventListener` import removed if unused; `dragId`, `onDragStart/Over/End`,
  `tabIdFromEvent`, `on*FromEvent` deleted. Update `TabStrip.vue`'s header comment (`:13-22`)
  where it says "drag-reorder" is part of the shared skeleton to name the library.
- `useDragReorder.ts:22-26`: replace the paragraph about `TabStrip`'s native mechanism with one
  sentence: `TabStrip.vue` reorders through `vue-draggable-plus` since P137. Leave the
  `sortablejs` clause for the follow-up (§0), since rewriting it means deciding that migration.

### 3.4 `ade` adapter

**New `apps/kira-space/frontend/src/ade/useAdeTabStripHost.ts`** (no Vue component; Pinia reads
only):

```ts
export const ALL_AGENTS_TAB = '__all__';
type AdeTab = TabLike & { kind: 'ade-all-agents' | 'ade-repo'; state: null };

export function useAdeTabStripHost(): TabStripHost<'ade', AdeTab> { … }
```

- `activeWorkspace`: `computed(() => 'ade' as const)`.
- `tabs.tabsForWorkspace()`: `[allAgentsTab, ...codeReposStore.records.map(repoTab)]`, each with
  `active` from `adeUi.allAgents`/`activeRepoId` (pinned first, matching `tabsForWorkspace`'s rule).
- `tabs.activeIdByWorkspace`: a getter returning `{ ade: allAgents ? ALL_AGENTS_TAB : activeRepoId || null }`,
  so the strip's `activeTabId` computed tracks the store.
- `tabs.activateTab(id)`: `ALL_AGENTS_TAB` calls `showAllAgents()`, else `showRepo(id)` (today's
  `select`, `AdeRepoTabs.vue:40-43`).
- No `closeTab`/`closeOthers`/`closeToTheRight`/`closeAll`/`duplicateTab`/`moveTab`/`promoteTab`/
  `isPreview` (§0).
- `kinds`: `ade-all-agents` `{ pinned: true, pinnedTitle: true, title: () => 'All agents', menuExtras: () => [] }`;
  `ade-repo` `{ title: (t) => codeRepoRecord(t.id)?.name ?? '', menuExtras: () => [] }`.
- `iconFor`: `ade-all-agents` `{ codicon: 'terminal' }`, `ade-repo` `{ codicon: 'repo' }`.
  `railColorFor`: `undefined` (repos carry no colour).

**`AdeRepoTabs.vue`, rewritten** (keeps its name so `AdeView.vue` does not change):

```vue
<div class="h-tabbar min-h-0 overflow-hidden shrink-0 border-b border-border bg-chrome"
     data-testid="ade-repo-tabs">
  <TabStrip :host="host">
    <template #tab-leading="{ tab }">
      <span v-if="countFor(tab.id) > 0" class="flex items-center gap-1 font-data text-kira-sm">
        <AdeActivityIcon kind="input" />{{ countFor(tab.id) }}
      </span>
    </template>
  </TabStrip>
</div>
```

- Container classes copy `WorkbenchShell.vue:143` exactly, so `ade`'s bar matches every other
  tab bar. Keep `sessionsQuery`/`needsInput`/`allAgentsCount` (`:26-34`) as they are;
  `countFor(id)` = `allAgentsCount` for `ALL_AGENTS_TAB`, else `needsInput.get(id) ?? 0`.
- No `Tabs`/`TabsList`/`TabsTrigger` import, no hex literal, no `<style>`. Header comment: two
  lines, P137, adapter plus count slot; drop the Part 7 "P137 later moves…" note (done).
- `AdeView.vue`, `adeUi.ts`, `activity.ts`, `AdeAllAgentsView.vue`: unchanged.

## 4. File ownership (one implementer)

| File | Change |
|---|---|
| `packages/workbench/src/host.ts` | `TabStripKind`/`TabStripTabs`/`TabStripHost`; `WorkbenchHost extends TabStripHost` |
| `packages/workbench/src/components/TabStrip.vue` | `host` prop, capability gating, `#tab-leading`, labelled pinned chip, `vue-draggable-plus` reorder |
| `packages/workbench/src/util/useDragReorder.ts` | comment paragraph only (§3.3) |
| `apps/kira-space/frontend/src/ade/useAdeTabStripHost.ts` | new |
| `apps/kira-space/frontend/src/ade/AdeRepoTabs.vue` | rewritten onto `TabStrip` |
| `apps/kira-studio/tests/ui/tabs.spec.ts` | new drag-reorder test |
| `apps/kira-space/tests/ui/repo-workspace.spec.ts` | new drag-reorder test |
| `apps/kira-space/tests/ui/ade-all-agents.spec.ts`, `ade-module.spec.ts`, `ade-timeline.spec.ts` | locator/attribute updates; new `ade` strip scenarios in `ade-module.spec.ts` |
| `docs/ARCHITECTURE.md` | §5 |
| `docs/v2.0/SPEC.md` | P137 result section only |

Not touched: `createTabsStore.ts` (`moveTab` unchanged), both apps' `workbench/host.ts`,
`WorkbenchShell.vue` (all three), `types.ts`, `package.json`, `bun.lock`, any Go file.

## 5. `docs/ARCHITECTURE.md`

- `:1358-1366` (shared `TabStrip` paragraph): add that `TabStrip` reads the narrow `TabStripHost`
  seam (optional `host` prop, falls back to the injected `WorkbenchHost`, which extends it);
  optional capabilities hide close/duplicate/reorder; `#tab-leading` slot; `pinnedTitle`; drag
  is `vue-draggable-plus` `forceFallback` with a bound id mirror (why: DOM revert), commit via
  `moveTab` once per drop.
- `:2702-2709`: `AdeRepoTabs.vue` renders the shared `TabStrip` through `useAdeTabStripHost`; no
  close, no reorder (repo order is `code_repos.sort_order`, no reorder path).
- `:2858-2864`: replace "P137's later move of this trigger into the shared `TabStrip`'s pinned
  slot" with the fact: the pinned `All agents` tab is `TabStrip`'s pinned slot, kind
  `ade-all-agents`, labelled (`pinnedTitle`).
- `:2786-2789` (`vue-draggable-plus` rationale): one clause that `TabStrip` uses it too, with a
  bound list, unlike `useTimelineDrag`'s `sort: false` pass-through.

## 6. Tests

`CLAUDE.md`'s unit-test bar: nothing here earns a unit test. `moveTab`'s index arithmetic already
has store-level coverage (`repo-tab-slots.spec.ts`) and does not change; the adapter is a thin
pass-through. All new coverage is UI (Playwright), driven by a mouse sequence:

```ts
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move(from.x + 10, from.y, { steps: 5 });   // past fallbackTolerance
await page.mouse.move(to.x, to.y, { steps: 15 });
await page.mouse.move(to.x, to.y, { steps: 2 });
await page.mouse.up();
```

(`ade-timeline.spec.ts:146-152`'s own sequence, horizontal.) Each file gets its own small
`dragTab(page, source, target)` helper; the two apps' test trees share no support module.

### 6.1 New

- **Studio `tabs.spec.ts`**: `tab strip: drag reorders tabs; click, middle-click and close still
  work (P137)`. Open 3 table tabs via `menu-item-open-data-new-tab` (the `:269-277` route). Drag
  tabs A, B, C: drag C onto A (leftward): row order (`data-tab-id` sequence in `tab-strip-row`)
  is C, A, B. Drag C onto B (rightward): A, B, C. No chip keeps `opacity-50` after drop. When the harness exposes the tabs-save IPC log, the last save's order
  matches the DOM. Then: click activates (`data-active`), middle-click on a non-active tab closes
  it, `tab-close` on the active one closes it.
- **Space `repo-workspace.spec.ts`**: `tab strip: drag reorders file tabs; the pinned graph tab
  never moves (P137)`. In a repo workspace, open and promote two file tabs (the existing
  preview/promotion steps). Drag the second onto the first: order swaps. Drag a file tab onto the
  pinned graph chip: order unchanged, graph chip still first in `tab-strip-pinned`. Mouse-drag
  starting on the pinned chip: nothing moves.
- **Space `ade-module.spec.ts`**: `ade tabs render through the shared tab strip (P137)`. With two
  repos: `[data-testid="ade-repo-tabs"] [data-testid="tab"]` count 3, first has
  `data-tab-kind="ade-all-agents"`, `data-pinned="true"`, text `All agents`; no `tab-close` in the
  bar; right-click a repo tab shows exactly one menu item, `Copy name`; a mouse drag of repo B onto
  repo A leaves the order A,B (no Sortable on this strip).

### 6.2 Changed (locators only; asserted behaviour unchanged)

- `ade-all-agents.spec.ts:152-153` `repoTab`:
  `[data-testid="ade-repo-tabs"] [data-testid="tab"][data-tab-kind="ade-repo"][data-tab-id="${repoId}"]`.
  `:160-161` `allAgentsTab`: `… [data-tab-kind="ade-all-agents"]`.
- `:400-401`: first tab in `ade-repo-tabs` has `data-tab-kind="ade-all-agents"`.
- `:436` amber `border-top-color` becomes `toHaveAttribute('data-active', 'true')` (the active
  state is the behaviour; the colour was the mockup look this phase replaces, §0).
- `:748`, `:793` `data-state="active"` becomes `data-active="true"`.
- `ade-module.spec.ts:14-15` `repoTab`: same selector as above. `:158-185` unchanged otherwise
  (`[data-activity]` and the count text come from the `#tab-leading` slot).
- `ade-timeline.spec.ts:1301`, `:1303`: same two selectors.
- Every other spec touching `TabStrip` DOM (the rest of 31 `rg` hits for `testid="tab"`/`tab-close`/`tab-strip`/`data-tab-id`: `tabs.spec.ts`, `smoke`, `mode-switch`,
  `control-sizing`, `terminal-module`, `budgets`, `font-roles`, `definition`, `slick-grid`,
  `repo-workspace`, `repo-graph-lifecycle`, `modules`, `window-chrome`, visual `workbench.spec.ts`,
  …): no edit. `data-testid`s, `.is-active`/`.tab-title`/`.tab-close`/`.tab-file-icon` classes and
  pixel output are unchanged for Studio and Space (§3.2).
- If a changed selector is used in more places than listed, update it the same way; never weaken
  an assertion.

## 7. Verification

Fast checks per commit (the pre-commit hook runs the first two): `bun run lint`,
`bun run typecheck`, and `bun run build:studio && bun run build:space` after commits 1, 2 and 4.

End of phase, once, in full:

- `bun run test:ui:studio`
- `bun run test:ui:space`
- `bun run test:visual:studio` (Studio's tab strip is in `workbench.spec.ts`; expect no diff)
- `bun run test:unit`
- `bun run typecheck`
- `bun run lint:all` (`lint`, `lint:go`, `lint:dead`)

Failures get fixed as follow-up commits, one per finding, same phase.

## 8. Steps and commits

Each commit passes the pre-commit hook without `--no-verify` and ends with the session's
attribution lines.

1. `refactor(workbench): TabStrip reads a narrow TabStripHost seam` — `host.ts`; `TabStrip.vue`
   `host` prop, capability gating, `#tab-leading`, `pinnedTitle` chip. No behaviour change for
   either app (every capability present, no slot passed, no `pinnedTitle` kind).
2. `feat(workbench): TabStrip drag-reorder on vue-draggable-plus` — §3.3, plus the
   `useDragReorder.ts` comment.
3. `test(workbench): tab drag-reorder coverage in Kira Studio and Kira Space` — §6.1 first two.
4. `feat(space): ade repo tabs render through the shared TabStrip` — `useAdeTabStripHost.ts`,
   `AdeRepoTabs.vue`, and the §6.2 locator updates in the same commit (the suite would otherwise
   be red between commits).
5. `test(space): ade tab strip coverage` — §6.1 third scenario.
6. Follow-up `fix(…)` commits for whatever §7's full run finds.
7. `docs: ARCHITECTURE records the TabStrip seam and vue-draggable-plus reorder (P137)` — §5.
8. `docs(v2.0): P137 result` — result section under the SPEC row, with §10's audit, the §0
   visual/keyboard disclosures, and the two user-facing open points (§11).

## 9. What a Linux sandbox cannot verify

- **Drag feel in the shipped webviews.** Playwright drives Chromium. The app renders in
  WebKitGTK (Linux) and WKWebView (macOS). `forceFallback` avoids the HTML5 drag API in both, so
  behaviour should match, but ghost rendering and autoscroll speed are unverified. State it in
  the result.
- **macOS trackpad drag** (force-touch, inertial scroll during drag): not reproducible here.
- **Live `ade` on real repos**: optional, via `docs/DEV_ENVIRONMENT.md`'s P129 Part 5 bypass.
  Report whether it ran.

Everything else (ordering, pinned immovability, click/middle-click/close/context menu, `ade`
counts and activation, scroll row) is Linux-verifiable by §7's suites.

## 10. Closing audit

Report each row with its command and result in the result section.

| Check | Command | Expect |
|---|---|---|
| No native DnD left in `TabStrip` | `rg -n 'draggable="\|:draggable\|\bdrag(start\|over\|end\|enter\|leave)\b\|DragEvent\|dataTransfer' packages/workbench/src/components/TabStrip.vue` | empty (Sortable's `draggable:` selector option is not matched) |
| Library really drives it | `rg -n "from 'vue-draggable-plus'\|useDraggable\(" packages/workbench/src/components/TabStrip.vue` | import plus one call |
| Reorder commits through the store | `rg -n 'moveTab' packages/workbench/src/components/TabStrip.vue` | only inside the `onUpdate` path |
| No bespoke tab markup in `ade/` | `rg -n "components/ui/tabs'\|TabsTrigger\|TabsList" apps/kira-space/frontend/src/ade/AdeRepoTabs.vue` | empty |
| `ade` uses the shared strip | `rg -n 'TabStrip' apps/kira-space/frontend/src/ade` | `AdeRepoTabs.vue` import plus use |
| Adapter has a caller | `rg -n 'useAdeTabStripHost' apps/kira-space/frontend/src` | definition plus `AdeRepoTabs.vue` |
| Seam is structural | `rg -n 'extends TabStripHost' packages/workbench/src/host.ts` | 1 hit (`WorkbenchHost`) |
| Old test ids gone | `rg -n 'ade-repo-tab"\|ade-all-agents-tab' apps/kira-space` | empty |
| Hex literals left `AdeRepoTabs` | `rg -n '#[0-9a-fA-F]{6}' apps/kira-space/frontend/src/ade/AdeRepoTabs.vue` | empty |
| No scoped styles | `rg -n '<style' apps/kira-space/frontend/src/ade/AdeRepoTabs.vue packages/workbench/src/components/TabStrip.vue` | empty |
| No new dependency | `git diff --stat ff77106d -- package.json bun.lock '**/package.json'` | empty |
| Store untouched | `git diff ff77106d -- packages/workbench/src/state/createTabsStore.ts` | empty |
| Suites | §7 | all green |

## 11. Risks

- **Structural assignability of `kinds`.** `WorkbenchHost extends TabStripHost` relies on the
  mapped `TabKindRegistry` fitting `{ readonly [kind: string]: TabStripKind<R> | undefined }`. A
  mapped type is an anonymous object type, so it should; if `tsgo`/`vue-tsc` disagree, declare
  `TabStripHost`'s `kinds` through a type parameter rather than casting.
- **Keyed `v-for` versus Sortable.** If a drop ever leaves a chip duplicated or misplaced, the
  bound-list revert is not running: check that `rowIds` is a ref bound as the second
  `useDraggable` argument and that no `customUpdate` is set.
- **Re-sync during drag.** A store change mid-drag (tab opened by another path) re-syncs `rowIds`
  under Sortable. Rare, and Sortable's own `onEnd` restores DOM from its start snapshot; a real
  failure here gets a follow-up fix, not a guard added speculatively.
- **`onContextMenu` complexity** after capability gating: split into a helper before biome flags it.
- **`knip`**: `ALL_AGENTS_TAB`, `TabStripKind`, `TabStripTabs` must have real importers or stay
  unexported. `packages/workbench/package.json` lists no `@vueuse/core` either, yet `TabStrip.vue`
  imports it and `lint:dead` passes (root-hoisted); `vue-draggable-plus` resolves the same way. If
  `knip` still flags it, follow whatever `@vueuse/core` does there; never add a second version.
- **P138 interplay.** P138's row counts `ade/` hex literals at the pre-P137 tree; three leave with
  `AdeRepoTabs.vue`. P138's planning pass re-counts on the post-P137 tree.
- **Open points for the user** (reported, not acted on): (a) `ade` repo drag-reorder, which needs
  a persisted repo order path shared with the Git panel; (b) migrating `useDragReorder`'s three
  consumers onto `vue-draggable-plus`, whose stated reason for hand-rolling is stale.

## 12. Acceptance

| Requirement | Where met |
|---|---|
| `AdeRepoTabs.vue` replaced by `TabStrip.vue`, adapting `codeReposStore` records and `activeRepoId`/`setActiveRepo` onto `TabLike`/`host.tabs`, no parallel tab abstraction | §3.4 (`showRepo` sets `activeRepoId`; `AdeView`'s `setActiveRepo` fallback unchanged) |
| Plan states adapter vs seam, per P100/P103/P127/P128 precedent | §0, §3.1 |
| `TabStrip` drag-reorder migrated to `vue-draggable-plus`, benefiting Studio editor tabs and Space terminal/file tabs | §3.3; §6.1 Studio and Space scenarios |
| No new dependency | §0, §10 |
| No bespoke tab markup left in `ade/` | §3.4, §10 |
| `TabStrip.vue` has no native `draggable`/`dragstart`/`dragover`/`dragend` | §3.2, §3.3, §10 |
| Existing `TabStrip` tests and `ade` repo-tab coverage pass unchanged in behaviour | §6.2, §7 |
| P129 Part 7 checked; pinned tab built on what it left | §0, §3.4 |
| Pinned slot, cross-workspace/kind constraints, scroll row, drop indicator, keyboard/close/middle-click preserved | §3.3 |
| Linux-verifiable vs not | §9 |
