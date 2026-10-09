import { ref } from 'vue';
import { useTerminalsStore } from '../../../state/terminals';
import type { NeedsItem } from '../board/needsYou';
import { useApprove, useFocusSession, useRetryRun } from '../queries';
import { useSessionViews } from '../sessions/useSessionViews';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useAdeDialogsStore } from '../state/adeDialogs';
import { useAdeTakeOverStore } from '../state/adeTakeOver';

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The one action behind a needs-you item: the Needs you row button and the `!` circle share it. */
export function useNeedsAction() {
  const ui = useAdeBoardUiStore();
  const dialogs = useAdeDialogsStore();
  const takeOver = useAdeTakeOverStore();
  const terminals = useTerminalsStore();
  const { sessions } = useSessionViews();
  const retry = useRetryRun();
  const approve = useApprove();
  const focus = useFocusSession();

  /** Opens a session in its Sessions tab; a terminal another window holds is raised there first. */
  async function openSession(sessionId: string, taskId: string, branchId: string): Promise<void> {
    const local = { taskId, branchId, sessionId };
    const terminalId = sessions.value.find((x) => x.id === sessionId)?.terminalId ?? '';
    if (terminalId && terminals.terminalSession(terminalId)) {
      ui.openSession(local);
      return;
    }
    const shown = await focus.mutateAsync({ sessionId, taskId }).catch(() => false);
    if (!shown) ui.openSession(local);
  }

  async function run(n: NeedsItem): Promise<void> {
    delete ui.actionError[n.taskId];
    try {
      if (n.kind === 'rebase') {
        ui.view = 'plan';
        ui.selectBranch(n.taskId, n.branchId);
        ui.branchTab = 'details';
      } else if (n.action === 'Take over') await takeOver.request(n.sessionId);
      else if (n.action === 'Retry') {
        await Promise.all(n.runIds.map((runId) => retry.mutateAsync({ runId })));
      } else if (n.action === 'Open') await openSession(n.sessionId, n.taskId, n.branchId);
      else if (n.action === 'Approve') {
        await approve.mutateAsync({ taskId: n.taskId, stageId: n.stageId, stepId: n.stepId });
      } else if (n.action === 'See error') {
        ui.view = 'plan';
        ui.selectBranch(n.taskId, n.branchId);
        ui.branchTab = 'details';
        ui.focusSetup = true;
      } else dialogs.merge(n.branchId, n.target);
    } catch (err) {
      ui.actionError[n.taskId] = errMessage(err);
      ui.select(n.taskId);
    }
  }

  /** True while an action is in flight: a repeat click must not run it twice. */
  const busy = ref(false);
  async function perform(n: NeedsItem): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    try {
      await run(n);
    } finally {
      busy.value = false;
    }
  }

  return { perform, openSession, busy };
}
