import { t } from '@theme/i18n';
import { useCopy } from '@workbench/behaviour/clipboard';
import { errorText } from '@workbench/bridge/codedError';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { reactive } from 'vue';
import { useLaunchOpener } from '../dialog/useLaunchOpener';
import { useCloseSession, useRestartSession } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import type { SessionView } from './sessionView';

/** Right-click menu of a session tab: Restart and Close (running session), Copy session ID. */
export function useSessionMenu(): {
  open: (ev: MouseEvent, view: SessionView) => void;
  busy: Set<string>;
} {
  const ui = useAdeBoardUiStore();
  const contextMenu = useContextMenuStore();
  const launchOpener = useLaunchOpener();
  const restartM = useRestartSession();
  const closeM = useCloseSession();
  const { copy } = useCopy();
  const busy = reactive(new Set<string>());

  async function restart(view: SessionView): Promise<void> {
    const { id, taskId } = view.session;
    delete ui.actionError[taskId];
    busy.add(id);
    try {
      const launch = await restartM.mutateAsync({ sessionId: id });
      if (launch.terminalId) await launchOpener.open(launch);
      if (launch.sessionId) ui.sessionId = launch.sessionId;
    } catch (err) {
      ui.actionError[taskId] = errorText(err);
    } finally {
      busy.delete(id);
    }
  }

  async function close(view: SessionView): Promise<void> {
    const { id, taskId } = view.session;
    delete ui.actionError[taskId];
    busy.add(id);
    try {
      await closeM.mutateAsync({ sessionId: id });
    } catch (err) {
      ui.actionError[taskId] = errorText(err);
    } finally {
      busy.delete(id);
    }
  }

  function items(view: SessionView): MenuItem[] {
    const { id, agentSessionId } = view.session;
    const list: MenuItem[] = [];
    if (view.session.state === 'running') {
      const noConversation = view.headless && !agentSessionId;
      list.push(
        {
          type: 'item',
          id: 'ade-session-restart',
          label: t('space.ade.sessionTab.restart.label'),
          icon: 'debug-restart',
          disabled: busy.has(id) || noConversation,
          hint: noConversation ? t('space.ade.sessionList.waitingId.status') : undefined,
          run: () => restart(view),
        },
        {
          type: 'item',
          id: 'ade-session-close',
          label: t('space.ade.sessionTab.close.label'),
          icon: 'close',
          disabled: busy.has(id),
          run: () => close(view),
        },
        { type: 'separator' },
      );
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

  return { open, busy };
}
