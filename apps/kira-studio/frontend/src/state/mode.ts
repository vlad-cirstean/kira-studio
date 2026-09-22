import type { AppMode } from '@shared/domain/mode';
import { useDebounceFn } from '@vueuse/core';
import { defineStore } from 'pinia';
import { computed, reactive, toRefs } from 'vue';
import { control } from '../bridge/control';
import { STUDIO_TAB_KIND_MODE, type TabRecord } from './tabDomain';
import { TAB_KINDS } from './tabKinds';
import { useTabsStore } from './tabs';

// P100 Part 2: WorkspaceKey (packages/shared/domain/workspace.ts) collapsed into AppMode — 'git'
// (the only mode that ever hosted a repo-prefixed workspace) moved to apps/kira-space wholesale,
// so this app's own "which workspace" is always exactly "which mode" now, the one-dimensional
// state useWorkspaceStore (deleted this phase) used to layer a second dimension on top of.

// P22 D12: which module a window was in, so it reopens into the same one. `windows.bounds_json`'s
// own persistence (internal/shell/window.go's Attach) is entirely native-event-driven
// (WindowDidResize/WindowDidMove) with no frontend IPC counterpart at all — there is no
// "on close" hook this module could piggyback on the way the row's other shutdown state suggests.
// So mode is pushed on every change instead, through the same debounced-writer shape
// state/layout.ts's own patchLayout uses: never a synchronous IPC per mode click (F20's own
// invariant — the one thing that must not happen), only an eventual one after the window has sat
// on a mode for a beat.
const MODE_WRITE_DEBOUNCE_MS = 150;

// P1 D5: mode is a derived view over the one tab list, not a second state tree — the smallest
// thing that works. Switching mode touches no TabRecord, schedules no save, issues no IPC
// *synchronously*: it is a selection, so the two modes cannot drift, cannot double-persist, and
// cannot leak each other's tabs across a window. P22 D12 adds a debounced, eventually-persisted
// side effect (below) without disturbing that — `tests/ui/mode-switch.spec.ts`'s own "mode
// switching writes nothing" case still passes unchanged, since it counts tabsSave calls, not this.
export const useModeStore = defineStore('mode', () => {
  const state = reactive({ active: 'studio' as AppMode });

  // P99 §9.3: useDebounceFn replaces the hand-rolled clearTimeout/setTimeout pair this used to be.
  const scheduleModeWrite = useDebounceFn(() => {
    void control.windowsSetMode(state.active);
  }, MODE_WRITE_DEBOUNCE_MS);

  /** Called once at boot (main.ts's bootstrap, alongside hydrateLayout/hydrateSettings/…), before
   *  the app ever renders — sets the window's own persisted mode without going through `setMode`
   *  (hydration is not a user action, and must not re-schedule a write of the value it just read). */
  function hydrateMode(mode: AppMode): void {
    state.active = mode;
  }

  // P67b §4.2: persistence only — modeState/windows.mode. P100 Part 2: setMode/setModule collapsed
  // into one function — the split existed only so a repo-workspace activation (state/workspace.ts's
  // old activateWorkspace, deleted this phase) could persist 'git' as the window's module without
  // also clobbering a second, now-nonexistent "which workspace inside git" dimension.
  function setMode(mode: AppMode): void {
    state.active = mode;
    void scheduleModeWrite();
  }

  const activeTab = computed<TabRecord | null>(() => {
    const tabsStore = useTabsStore();
    const id = tabsStore.activeIdByWorkspace[state.active];
    return tabsStore.tabs.find((t) => t.id === id) ?? null;
  });

  return { ...toRefs(state), hydrateMode, setMode, activeTab };
});

// This one function is what replaces the mode filter at every read site tabsState used to scope
// by mode alone.
export function workspaceKeyOf(tab: TabRecord): AppMode {
  return (tab.workspaceId as AppMode | null) ?? (STUDIO_TAB_KIND_MODE[tab.kind] as AppMode);
}

/** Every tab in workspace `key` — a genuine stable partition (§6.1): every pinned-kind tab of
 *  `key` first (in their existing relative order), then
 *  the rest (ditto), regardless of where each sits in `tabsState.tabs`. Computed here rather than
 *  relied on as an insertion-order invariant, so the guarantee survives any past or future
 *  tab-insertion path (splice, restore, moveTab) without each one having to remember to preserve
 *  it. Two-pass filter/concat, not a comparator sort — a sort's stability is not a property to lean
 *  on here. */
export function tabsForWorkspace(key: AppMode): TabRecord[] {
  const pinned: TabRecord[] = [];
  const rest: TabRecord[] = [];
  for (const t of useTabsStore().tabs) {
    if (workspaceKeyOf(t) !== key) continue;
    (TAB_KINDS[t.kind].pinned ? pinned : rest).push(t);
  }
  return [...pinned, ...rest];
}
