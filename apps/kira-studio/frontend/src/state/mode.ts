import type { AppMode } from '@shared/domain/mode';
import { TAB_KIND_MODE, type TabRecord } from '@shared/domain/tabs';
import { computed, reactive } from 'vue';
import { tabsState } from './tabs';

// P1 D5: mode is a derived view over the one tab list, not a second state tree — the smallest
// thing that works. Switching mode touches no TabRecord, schedules no save, issues no IPC: it is
// a selection, so the two modes cannot drift, cannot double-persist, and cannot leak each other's
// tabs across a window.
export const modeState = reactive({ active: 'studio' as AppMode });

export function setMode(mode: AppMode): void {
  modeState.active = mode;
}

/** Every tab whose kind belongs to `mode` — what a mode's own tab strip renders. */
export function tabsForMode(mode: AppMode): TabRecord[] {
  return tabsState.tabs.filter((t) => TAB_KIND_MODE[t.kind] === mode);
}

export const activeTab = computed<TabRecord | null>(() => {
  const id = tabsState.activeIdByMode[modeState.active];
  return tabsState.tabs.find((t) => t.id === id) ?? null;
});
