import { t } from '@theme/i18n';
import { useCopy } from '@workbench/behaviour/clipboard';
import { errorText } from '@workbench/bridge/codedError';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { reactive } from 'vue';
import { useLaunchOpener } from '../dialog/useLaunchOpener';
import { useRestartSession } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import type { SessionView } from './sessionView';

/** Right-click menu of a session tab: Restart (running TUI) and Copy session ID. */
export function useSessionMenu(): {
  open: (ev: MouseEvent, view: SessionView) => void;
  restarting: Set<string>;
} {
  const ui = useAdeBoardUiStore();
  const contextMenu = useContextMenuStore();
  const launchOpener = useLaunchOpener();
  const restartM = useRestartSession();
  const { copy } = useCopy();
  const restarting = reactive(new Set<string>());

  async function restart(view: SessionView): Promise<void> {
    const { id, taskId } = view.session;
    delete ui.actionError[taskId];
    restarting.add(id);
    try {
      const launch = await restartM.mutateAsync({ sessionId: id });
      await launchOpener.open(launch);
      ui.sessionId = launch.sessionId;
    } catch (err) {
      ui.actionError[taskId] = errorText(err);
    } finally {
      restarting.delete(id);
    }
  }

  function items(view: SessionView): MenuItem[] {
    const { id, agentSessionId } = view.session;
    const list: MenuItem[] = [];
    if (!view.headless && view.session.state === 'running') {
      list.push({
        type: 'item',
        id: 'ade-session-restart',
        label: t('common.action.restart.label'),
        icon: 'debug-restart',
        disabled: restarting.has(id),
        run: () => restart(view),
      });
    }
    list.push({
      type: 'item',
      id: 'ade-session-copy-id',
      label: t('space.ade.sessionTab.copyId.label'),
      icon: 'copy',
      disabled: !agentSessionId,
      hint: agentSessionId ? undefined : t('space.ade.sessionList.waitingId.status'),
      run: () => {
        void copy(agentSessionId);
      },
    });
    return list;
  }

  function open(ev: MouseEvent, view: SessionView): void {
    ev.preventDefault();
    contextMenu.openContextMenu(ev, items(view));
  }

  return { open, restarting };
}
