import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import type { TaskAction, TaskActionKind } from '../board/actions';
import type { CardModel } from '../plan/usePlanModel';
import { useApprove, useRetryRun, useStageDone, useStartRun } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';

// Stage actions rendered this wave (R22); Take over, `▶ <Stage>`, `▶ Start` and Archive wait for P148.
const RENDERED: ReadonlySet<TaskActionKind> = new Set([
  'run',
  'approve',
  'retry',
  'done',
  'finish',
]);

/** The task's rendered stage action and the call behind it. */
export function useTaskAction(card: MaybeRefOrGetter<CardModel>) {
  const ui = useAdeBoardUiStore();
  const start = useStartRun();
  const approve = useApprove();
  const retry = useRetryRun();
  const done = useStageDone();

  const action = computed<TaskAction | null>(() => {
    const a = toValue(card).action;
    return a && RENDERED.has(a.kind) ? a : null;
  });

  async function perform(): Promise<void> {
    const c = toValue(card);
    const a = action.value;
    const stage = c.progress.stage;
    if (!a || !stage) return;
    const taskId = c.task.id;
    delete ui.actionError[taskId];
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

  return { action, perform };
}
