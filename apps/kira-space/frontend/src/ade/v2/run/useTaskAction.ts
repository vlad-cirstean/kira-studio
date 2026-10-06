import { computed, type MaybeRefOrGetter, ref, toValue } from 'vue';
import type { TaskAction } from '../board/actions';
import type { CardModel } from '../plan/usePlanModel';
import { useApprove, useRetryRun, useStageDone, useStartRun } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useAdeDialogsStore } from '../state/adeDialogs';
import { useAdeTakeOverStore } from '../state/adeTakeOver';

/** The task's rendered stage action and the call behind it. */
export function useTaskAction(card: MaybeRefOrGetter<CardModel>) {
  const ui = useAdeBoardUiStore();
  const dialogs = useAdeDialogsStore();
  const takeOver = useAdeTakeOverStore();
  const start = useStartRun();
  const approve = useApprove();
  const retry = useRetryRun();
  const done = useStageDone();

  const action = computed<TaskAction | null>(() => toValue(card).action);

  async function run(): Promise<void> {
    const c = toValue(card);
    const a = action.value;
    const stage = c.progress.stage;
    if (!a) return;
    const taskId = c.task.id;
    delete ui.actionError[taskId];
    if (a.kind === 'archive') return dialogs.archive(taskId);
    if (a.kind === 'stage') return dialogs.stage(taskId);
    if (a.kind === 'takeOver') return takeOver.request(a.sessionId ?? '');
    if (!stage) return;
    try {
      if (a.kind === 'run') {
        if (stage.kind === 'agent') ui.runTaskId = taskId;
        else await start.mutateAsync({ taskId, branchNames: {}, message: '' });
      } else if (a.kind === 'approve') {
        await approve.mutateAsync({ taskId, stageId: stage.id, stepId: a.stepId ?? '' });
      } else if (a.kind === 'retry') {
        const runs = c.progress.steps
          .find((s) => s.id === a.stepId)
          ?.runs.filter((r) => r.state === 'failed' || r.state === 'stuck');
        await Promise.all((runs ?? []).map((r) => retry.mutateAsync({ runId: r.runId })));
      } else {
        await done.mutateAsync({ taskId });
      }
    } catch (err) {
      ui.actionError[taskId] = err instanceof Error ? err.message : String(err);
      ui.select(taskId);
    }
  }

  /** True while a call is in flight: a repeat click must not launch the stage twice. */
  const busy = ref(false);
  async function perform(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    try {
      await run();
    } finally {
      busy.value = false;
    }
  }

  return { action, perform, busy };
}
