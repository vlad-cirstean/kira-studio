import type { TabLike, TabStripHost } from '@workbench/host';
import { computed } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import { useAdeUiStore } from './state/adeUi';

// P137: adapts ade's repo tabs (one per `codeReposStore` record, plus the pinned "All agents"
// tab) onto the shared `TabStrip`'s narrow seam. No close/duplicate/move capability: closing a
// repo tab has no meaning, and repo order is `code_repos.sort_order` with no reorder path.
export const ALL_AGENTS_TAB = '__all__';

type AdeTab = TabLike & { kind: 'ade-all-agents' | 'ade-repo'; state: null };

export function useAdeTabStripHost(): TabStripHost<'ade', AdeTab> {
  const codeReposStore = useCodeReposStore();
  const adeUi = useAdeUiStore();

  return {
    activeWorkspace: computed(() => 'ade' as const),
    tabs: {
      activeIdByWorkspace: {
        get ade() {
          return adeUi.allAgents ? ALL_AGENTS_TAB : adeUi.activeRepoId || null;
        },
      },
      tabsForWorkspace: () => [
        { id: ALL_AGENTS_TAB, kind: 'ade-all-agents', state: null, active: adeUi.allAgents },
        ...codeReposStore.records.map(
          (repo): AdeTab => ({
            id: repo.id,
            kind: 'ade-repo',
            state: null,
            active: !adeUi.allAgents && repo.id === adeUi.activeRepoId,
          }),
        ),
      ],
      activateTab: (id) => {
        if (id === ALL_AGENTS_TAB) adeUi.showAllAgents();
        else adeUi.showRepo(id);
      },
    },
    kinds: {
      'ade-all-agents': {
        pinned: true,
        pinnedTitle: true,
        title: () => 'All agents',
        menuExtras: () => [],
      },
      'ade-repo': {
        title: (tab) => codeReposStore.codeRepoRecord(tab.id)?.name ?? '',
        menuExtras: () => [],
      },
    },
    iconFor: (tab) => ({ codicon: tab.kind === 'ade-all-agents' ? 'terminal' : 'repo' }),
    railColorFor: () => undefined,
  };
}
