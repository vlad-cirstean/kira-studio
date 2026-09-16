/**
 * P78 §7.3 — the status bar's find-references/find-implementations readout. Cross-view state:
 * written by `views/repo/navigation.ts`, read by `workbench/StatusBar.vue`, neither importing the
 * other (the same direction `state/blameStatus.ts` already documents for cross-view state).
 *
 * No owner token, unlike `blameStatus.ts`: `navigation.ts` registers its Monaco providers exactly
 * once per process (`ensureNavigationRegistered`'s own guard) and is the only writer, so a token
 * would be ceremony with nothing to arbitrate between. The store instead clears on every new
 * request and on an active-tab change (below), so a stale readout never outlives the file it
 * describes.
 */
import { reactive, watch } from 'vue';
import { activeTab } from './mode';

export type NavStatusState =
  | { kind: 'none' }
  | { kind: 'references'; summary: string; tooltip: string }
  | { kind: 'implementations'; summary: string };

export const navStatusState = reactive({
  status: { kind: 'none' } as NavStatusState,
});

/** Called by navigation.ts's own reference/implementation providers on every request — `null`
 *  clears the readout (no result, or a non-'ready' status). */
export function publishNavStatus(status: NavStatusState | null): void {
  navStatusState.status = status ?? { kind: 'none' };
}

// A stale readout must not outlive the tab it describes: clear on every active-tab change.
watch(
  () => activeTab.value?.id,
  () => publishNavStatus(null),
);
