import { useDocumentVisibility, useWindowFocus, watchDebounced } from '@vueuse/core';
import { computed } from 'vue';
import { useAdeBoardUiStore } from '../ade/v2/state/adeBoardUi';
import { control } from '../bridge/control';
import { useModeStore } from './mode';
import { useTabsStore } from './tabs';
import { GENERAL_WORKSPACE, useWorkspaceStore, visibleWorkspace } from './workspace';

// P238: tells Go what this window shows (so a note for the tab you look at is suppressed) and
// answers a notification click by showing the terminal tab or ADE task it names. Installed once
// per window; the window is the lifetime, so nothing is torn down. No store: nothing is shared.
export function installAgentNotifyFocus(): void {
  const mode = useModeStore();
  const tabs = useTabsStore();
  const board = useAdeBoardUiStore();
  const focused = useWindowFocus();
  const visibility = useDocumentVisibility();

  const activeTerminalId = computed(() => {
    if (mode.active === 'ade' || mode.active === 'memory') return '';
    const id = tabs.activeIdByWorkspace[visibleWorkspace()];
    return id && tabs.tabs.some((t) => t.id === id && t.kind === 'terminal') ? id : '';
  });

  watchDebounced(
    () => ({
      focused: focused.value && visibility.value === 'visible',
      module: mode.active as string,
      activeTerminalId: activeTerminalId.value,
      adeTaskId: mode.active === 'ade' ? (board.selectedTaskId ?? '') : '',
    }),
    (state) => {
      void control.agentNotifyReportFocus(state).catch((err: unknown) => {
        console.error('agent notify: report focus failed', err);
      });
    },
    { debounce: 150, immediate: true, deep: true },
  );

  control.onAgentRevealTerminal(({ terminalId }) => {
    const tab = tabs.tabs.find((t) => t.id === terminalId);
    if (!tab) return;
    const key = tab.workspaceId ?? GENERAL_WORKSPACE;
    if (key === 'automations') {
      mode.setMode('automations');
    } else {
      useWorkspaceStore().activateWorkspace(key);
      mode.setMode('git');
    }
    tabs.activateTab(terminalId);
  });

  control.onAgentRevealTask(({ taskId }) => {
    mode.setMode('ade');
    board.openTask(taskId);
  });
}
