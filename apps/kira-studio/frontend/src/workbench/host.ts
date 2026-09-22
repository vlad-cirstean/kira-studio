import type { AppMode } from '@shared/domain/mode';
import type { TabIconRender, WorkbenchHost } from '@workbench/host';
import { computed } from 'vue';
import { useAgentSessionsStore } from '../state/agentSessions';
import { useModeStore } from '../state/mode';
import type { TabRecord } from '../state/tabDomain';
import { useTabIncognitoStore } from '../state/tabIncognito';
import { TAB_KINDS } from '../state/tabKinds';
import { useTabsStore } from '../state/tabs';
import { TAB_VIEWS } from './tabViews';

// P103 Part 2 (§5.4): the WorkbenchHost instance this app provides once, in App.vue — every field
// ported verbatim from the old workbench/panels/TabStrip.vue's own `colorFor`/`titleFor`/
// `isAttention`/badgeFor(bodies now behind TAB_KINDS itself, reached by the shared component)
// bodies, minus what already lives on TAB_KINDS (title/pinned/menuExtras — the shared TabStrip.vue
// reaches those directly through `host.kinds`).
export function createWorkbenchHost(): WorkbenchHost<AppMode, TabRecord> {
  const modeStore = useModeStore();
  const tabsStore = useTabsStore();
  const agentSessionsStore = useAgentSessionsStore();
  const tabIncognitoStore = useTabIncognitoStore();

  return {
    activeWorkspace: computed(() => modeStore.active),
    tabs: tabsStore,
    kinds: TAB_KINDS,
    views: TAB_VIEWS,
    iconFor(tab): TabIconRender {
      return { codicon: TAB_KINDS[tab.kind].icon(tab) };
    },
    railColorFor(tab) {
      return TAB_KINDS[tab.kind].railColor(tab);
    },
    tabBadge(tab) {
      return TAB_KINDS[tab.kind].badge?.(tab) ?? null;
    },
    // P86 §14.2: a Claude Code tab whose activity is 'attention' and which is not the active tab
    // renders a dot — cleared by activating it.
    tabAttention(tab) {
      return (
        !tab.active &&
        tab.kind === 'terminal' &&
        tab.state.launchKind === 'claude-code' &&
        agentSessionsStore.agentActivityFor(tab.id)?.phase === 'attention'
      );
    },
    // P71 §5.1: the incognito eye glyph — uniform across every kind, not one kind's own badge.
    tabIndicator(tab) {
      return tabIncognitoStore.isIncognito(tab.id)
        ? { icon: 'eye-closed', tooltip: 'Incognito — nothing from this tab is saved' }
        : null;
    },
  };
}
