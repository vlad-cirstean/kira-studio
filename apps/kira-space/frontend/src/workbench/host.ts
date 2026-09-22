import type { TabIconRender, WorkbenchHost } from '@workbench/host';
import { computed } from 'vue';
import { fileIconStyle } from '../repo/fileIcon';
import type { TabRecord } from '../state/tabDomain';
import { TAB_KINDS } from '../state/tabKinds';
import { useTabsStore } from '../state/tabs';
import { useWorkspaceStore, type WorkspaceKey } from '../state/workspace';
import { TAB_VIEWS } from './tabViews';

// P103 Part 2 (§5.4): the WorkbenchHost instance this app provides once, in App.vue — no
// `tabBadge`/`tabAttention`/`tabIndicator`: this app has no AgentSessions store (no Claude Code
// hook integration) and no TabIncognito store (a Kira Studio-only feature), and no kind of its own
// declares a `badge()` member, so all three stay unwired, matching today's TabStrip.vue exactly
// (it renders neither element at all).
export function createWorkbenchHost(): WorkbenchHost<WorkspaceKey, TabRecord> {
  const workspaceStore = useWorkspaceStore();
  const tabsStore = useTabsStore();

  return {
    activeWorkspace: computed(() => workspaceStore.active),
    tabs: tabsStore,
    kinds: TAB_KINDS,
    views: TAB_VIEWS,
    // A tab kind's icon() returns either a codicon name or a `{ filePath }` marker (only
    // 'repo-file', state/tabKinds.ts's own doc comment) — resolved here into the two disjoint
    // render shapes the shared TabStrip.vue actually needs, the same split RepoTreeRow.vue's own
    // fileIconStyle call site uses for the identical marker.
    iconFor(tab): TabIconRender {
      const icon = TAB_KINDS[tab.kind].icon(tab);
      return typeof icon === 'string'
        ? { codicon: icon }
        : { fileStyle: fileIconStyle(icon.filePath) };
    },
    railColorFor(tab) {
      return TAB_KINDS[tab.kind].railColor(tab);
    },
  };
}
