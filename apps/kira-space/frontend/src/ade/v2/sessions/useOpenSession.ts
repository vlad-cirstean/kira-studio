import { useTerminalsStore } from '../../../state/terminals';
import { useFocusSession } from '../queries';
import { useSessions } from '../readQueries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';

/** The one open path for a session (Needs page, status bar): shows it in its Sessions tab; a
 *  terminal another window holds is raised there first. */
export function useOpenSession() {
  const ui = useAdeBoardUiStore();
  const terminals = useTerminalsStore();
  const sessions = useSessions();
  const focus = useFocusSession();

  return async function openSession(
    sessionId: string,
    taskId: string,
    branchId: string,
  ): Promise<void> {
    const local = { taskId, branchId, sessionId };
    const terminalId =
      sessions.data.value?.sessions.find((x) => x.id === sessionId)?.terminalId ?? '';
    if (terminalId && terminals.terminalSession(terminalId)) {
      ui.openSession(local);
      return;
    }
    const shown = await focus.mutateAsync({ sessionId, taskId }).catch(() => false);
    if (!shown) ui.openSession(local);
  };
}
