import type { AppMode } from '@shared/domain/mode';
import { TAB_KIND_MODE, type TabRecord } from '@shared/domain/tabs';
import { computed, reactive } from 'vue';
import { control } from '../bridge/control';
import { tabsState } from './tabs';

// P1 D5: mode is a derived view over the one tab list, not a second state tree — the smallest
// thing that works. Switching mode touches no TabRecord, schedules no save, issues no IPC
// *synchronously*: it is a selection, so the two modes cannot drift, cannot double-persist, and
// cannot leak each other's tabs across a window. P22 D12 adds a debounced, eventually-persisted
// side effect (below) without disturbing that — `tests/ui/mode-switch.spec.ts`'s own "mode
// switching writes nothing" case still passes unchanged, since it counts tabsSave calls, not this.
export const modeState = reactive({ active: 'studio' as AppMode });

// P22 D12: which module a window was in, so it reopens into the same one. `windows.bounds_json`'s
// own persistence (internal/shell/window.go's Attach) is entirely native-event-driven
// (WindowDidResize/WindowDidMove) with no frontend IPC counterpart at all — there is no
// "on close" hook this module could piggyback on the way the row's other shutdown state suggests.
// So mode is pushed on every change instead, through the same debounced-writer shape
// state/layout.ts's own patchLayout uses: never a synchronous IPC per mode click (F20's own
// invariant — the one thing that must not happen), only an eventual one after the window has sat
// on a mode for a beat.
const MODE_WRITE_DEBOUNCE_MS = 150;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/** Called once at boot (main.ts's bootstrap, alongside hydrateLayout/hydrateSettings/…), before
 *  the app ever renders — sets the window's own persisted mode without going through `setMode`
 *  (hydration is not a user action, and must not re-schedule a write of the value it just read). */
export function hydrateMode(mode: AppMode): void {
  modeState.active = mode;
}

export function setMode(mode: AppMode): void {
  modeState.active = mode;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void control.windowsSetMode(modeState.active);
  }, MODE_WRITE_DEBOUNCE_MS);
}

/** Every tab whose kind belongs to `mode` — what a mode's own tab strip renders. */
export function tabsForMode(mode: AppMode): TabRecord[] {
  return tabsState.tabs.filter((t) => TAB_KIND_MODE[t.kind] === mode);
}

export const activeTab = computed<TabRecord | null>(() => {
  const id = tabsState.activeIdByMode[modeState.active];
  return tabsState.tabs.find((t) => t.id === id) ?? null;
});
