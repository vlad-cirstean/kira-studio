import { reactive } from 'vue';
import { registerTabRuntimeCleanup } from './tabRuntime';

// P71 §2.1: a per-tab in-memory flag suppressing every persistence write path a request tab can
// reach (§1.1 of the plan) — one flag, checked at each write site, rather than a parallel
// non-persisted store mirroring reads too (§2's own "suppress, don't mirror" decision). In-memory
// only, exactly like tabsState.hydrated/previewIdsByWorkspace (state/tabs.ts) — no schema change,
// and a restored session has nothing to restore (an incognito tab was never saved).
//
// Its own module rather than a field on tabsState: state/tabKinds.ts needs to read it for the tab
// context menu's own incognito entry, and state/tabs.ts already imports tabKinds.ts — putting the
// flag in tabs.ts would make a cycle. This module imports only tabRuntime.ts (which imports
// nothing), so there is none.
//
// Standing rule for later phases: any new bridge write reachable from a request tab must consult
// isIncognito first.
export const incognitoState = reactive({ ids: new Set<string>() });

export function isIncognito(tabId: string): boolean {
  return incognitoState.ids.has(tabId);
}

// P71 §3.1: turning incognito on must flush the tab's existing row immediately rather than at
// whatever unrelated state change saves next — state/tabs.ts registers a listener below (rather
// than this module calling into tabs.ts directly, which would recreate the cycle the module
// comment above avoids) that does exactly that.
const onSetListeners = new Set<(tabId: string, on: boolean) => void>();

export function registerIncognitoSetListener(fn: (tabId: string, on: boolean) => void): void {
  onSetListeners.add(fn);
}

export function setIncognito(tabId: string, on: boolean): void {
  if (on) incognitoState.ids.add(tabId);
  else incognitoState.ids.delete(tabId);
  for (const fn of onSetListeners) fn(tabId, on);
}

// Closing a tab drops its flag through the same cleanup path every other per-tab runtime uses
// (dropAllPagesForTab, state/tabs.ts).
registerTabRuntimeCleanup((tabId) => {
  incognitoState.ids.delete(tabId);
});
