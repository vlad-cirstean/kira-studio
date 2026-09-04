import type { PersistedViewState, ViewStateStore } from '@kira/git-ui';
import { findGitGraphTab, patchGitGraphTabState } from '../state/tabs';

/**
 * D7: git-ui's ViewStateStore backed by this tab's own persisted TabRecord.state, not a new
 * table — `gitGraphTabStateSchema` (packages/shared/domain/tabs.ts) is, field for field, git-ui's
 * own PersistedViewState, so read()/write() are near-direct passthroughs onto the same
 * find-then-patch-then-debounced-save path LayoutService/TabsService already give every other
 * tab kind (state/tabs.ts's patchGitGraphTabState).
 */
export function createTabViewStateStore(tabId: string): ViewStateStore {
  return {
    read(): PersistedViewState | null {
      return findGitGraphTab(tabId)?.state ?? null;
    },
    write(state: PersistedViewState): void {
      patchGitGraphTabState(tabId, state);
    },
  };
}
