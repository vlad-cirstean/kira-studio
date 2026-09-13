/**
 * C10 §8 (S13) — `git-ui`'s own `ViewStateStore` seam, backed by the pinned `repo-graph` tab's own
 * persisted state (S8's `repoGraphTabStateSchema`) instead of a VS Code webview's `getState`/
 * `setState`. C5's tab views unmount on switch (`RepoDiffView.vue:113`'s own precedent) — a cold
 * remount would re-walk the graph and lose scroll/selection, exactly the problem `ViewStateStore`
 * exists to solve for a VS Code webview hidden and recreated (§2.1's reason `retainContextWhenHidden`
 * is off). One instance per mount (`RepoGraphView.vue`, S14), scoped to that tab's own id.
 *
 * The schema stays a permissive passthrough (`z.unknown()`) — `git-ui`'s own `parsePersistedViewState`
 * is the sole validator of the version-6 shape, here on read as it is on every other host.
 */
import type { PersistedViewState, ViewStateStore } from '@kira/git-ui';
import { parsePersistedViewState } from '@kira/git-ui';
import { asRepoGraphTab } from '@shared/domain/tabs';
import { patchRepoGraphTabState, tabsState } from '../../state/tabs';

export class TabViewStateStore implements ViewStateStore {
  readonly #tabId: string;

  constructor(tabId: string) {
    this.#tabId = tabId;
  }

  read(): PersistedViewState | null {
    const tab = asRepoGraphTab(tabsState.tabs.find((t) => t.id === this.#tabId));
    if (!tab) return null;
    return parsePersistedViewState(tab.state.viewState);
  }

  write(state: PersistedViewState): void {
    patchRepoGraphTabState(this.#tabId, { viewState: state });
  }
}
