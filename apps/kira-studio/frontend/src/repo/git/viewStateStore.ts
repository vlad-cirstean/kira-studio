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
 *
 * C12-3: `parsePersistedViewState` is taken as a constructor argument rather than imported here,
 * so this file carries no runtime (value) import of `@kira/git-ui` — only the type-only import
 * below, erased at build time. `RepoGraphView.vue` (this store's only caller) already awaits
 * `loadGitUi()` before constructing this class, so it has the real function in hand to pass in; a
 * static value import here would otherwise force the whole `@kira/git-ui` chunk back into
 * `RepoGraphView.vue`'s own eager module graph regardless of `loadGitUi`'s dynamic import
 * (confirmed by Vite's own `INEFFECTIVE_DYNAMIC_IMPORT` build warning before this change).
 */
import type { PersistedViewState, ViewStateStore } from '@kira/git-ui';
import { asRepoGraphTab } from '@shared/domain/tabs';
import { useTabsStore } from '../../state/tabs';

export class TabViewStateStore implements ViewStateStore {
  readonly #tabId: string;
  readonly #parse: (raw: unknown) => PersistedViewState | null;

  constructor(tabId: string, parse: (raw: unknown) => PersistedViewState | null) {
    this.#tabId = tabId;
    this.#parse = parse;
  }

  read(): PersistedViewState | null {
    const tab = asRepoGraphTab(useTabsStore().tabs.find((t) => t.id === this.#tabId));
    if (!tab) return null;
    return this.#parse(tab.state.viewState);
  }

  write(state: PersistedViewState): void {
    useTabsStore().patchRepoGraphTabState(this.#tabId, { viewState: state });
  }
}
