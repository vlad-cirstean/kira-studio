import type { AppMode } from '@shared/domain/mode';
import { useDebounceFn } from '@vueuse/core';
import { defineStore } from 'pinia';
import { computed, reactive, toRefs } from 'vue';
import { control } from '../bridge/control';
import { STUDIO_TAB_KIND_MODE, type TabRecord } from './tabDomain';
import { useTabsStore } from './tabs';

// AppMode is this app's one-dimensional "which workspace" state — there is no second dimension
// layered on top of it.

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

  function writeMode(): void {
    void control.windowsSetMode(state.active);
  }

  // P99 §9.3: useDebounceFn replaces the hand-rolled clearTimeout/setTimeout pair this used to be.
  const scheduleModeWrite = useDebounceFn(writeMode, MODE_WRITE_DEBOUNCE_MS);

  // P108 Part 12 F13: a mode change within MODE_WRITE_DEBOUNCE_MS of the window closing used to be
  // lost outright — nothing here ever flushed the pending debounced write before close. Same fix,
  // same seam, as createTabsStore.ts's own flushPendingTabState: control.onFlushBeforeClose/
  // onWindowFlushBeforeClose are the native "about to close/quit" signals Go already blocks the
  // close on (internal/shell/closeflush.go), reliable across both the quit-handshake and
  // per-window-close paths — unlike a browser `beforeunload`, which this app's own Hide()-instead-
  // of-Close() path for the last window (closeflush.go's own doc comment) never even fires,
  // since Hide() never navigates or unloads the page at all.
  function flushModeWrite(): void {
    scheduleModeWrite.cancel();
    writeMode();
  }
  control.onFlushBeforeClose(flushModeWrite);
  control.onWindowFlushBeforeClose(flushModeWrite);

  /** Called once at boot (main.ts's bootstrap, alongside hydrateLayout/hydrateSettings/…), before
   *  the app ever renders — sets the window's own persisted mode without going through `setMode`
   *  (hydration is not a user action, and must not re-schedule a write of the value it just read). */
  function hydrateMode(mode: AppMode): void {
    state.active = mode;
  }

  // P67b §4.2: persistence only — modeState/windows.mode. setMode/setModule stay one function: no
  // second "which workspace inside the mode" dimension exists to clobber.
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
