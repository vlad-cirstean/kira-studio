import { t } from '@theme/i18n';
import { errorText } from '@workbench/bridge/codedError';
import { computed, ref } from 'vue';
import { newIntentKey, useAdeWrites } from './useAdeWrites';
import type { PlanCard } from './useAgentsModel';

export type TaskIntent = 'back' | 'next' | 'start';

const message = (err: unknown): string => errorText(err);

/** The Back, Next and Start buttons of one plan card: the confirm text for each, and the write. */
export function useTaskActions(card: () => PlanCard) {
  const writes = useAdeWrites();
  const intent = ref<TaskIntent | null>(null);
  const error = ref('');
  let key = newIntentKey();

  const stageName = computed(() => card().progress.stage?.name ?? '');
  /** Start maps to the same two calls the desktop's action makes; other actions stay desktop only. */
  const startKind = computed<'run' | 'launch' | null>(() => {
    const kind = card().action?.kind;
    if (kind === 'run') return 'run';
    return kind === 'stage' ? 'launch' : null;
  });
  const busy = computed(
    () =>
      writes.setTaskStage.isPending.value ||
      writes.startRun.isPending.value ||
      writes.launchStage.isPending.value,
  );

  const dialog = computed(() => {
    const c = card();
    switch (intent.value) {
      case 'back':
        return {
          title: t('mobile.plan.moveBackConfirm.title'),
          text: t('mobile.plan.moveBackConfirm.body', {
            title: c.title,
            stage: c.moves.prev?.name ?? '',
          }),
          confirmLabel: t('mobile.plan.moveBackConfirm.confirm'),
        };
      case 'next': {
        const done = c.moves.next?.name === 'Done';
        return {
          title: t(
            done ? 'mobile.plan.markDoneConfirm.title' : 'mobile.plan.moveForwardConfirm.title',
          ),
          text: t('mobile.plan.moveForwardConfirm.body', {
            title: c.title,
            stage: c.moves.next?.name ?? '',
          }),
          confirmLabel: t(
            done ? 'mobile.plan.markDoneConfirm.confirm' : 'mobile.plan.moveForwardConfirm.confirm',
          ),
        };
      }
      case 'start':
        return {
          title: stageName.value
            ? t('mobile.plan.startConfirm.title', { stage: stageName.value })
            : t('mobile.plan.startThisStageConfirm.title'),
          text: startText(c.title),
          confirmLabel: t('common.action.start.label'),
        };
      default:
        return { title: '', text: '', confirmLabel: '' };
    }
  });

  function startText(title: string): string {
    if (startKind.value === 'run') return t('mobile.plan.startRunConfirm.body', { title });
    return stageName.value
      ? t('mobile.plan.startSessionConfirm.body', { stage: stageName.value })
      : t('mobile.plan.startThisStageSessionConfirm.body');
  }

  function ask(next: TaskIntent): void {
    error.value = '';
    key = newIntentKey();
    intent.value = next;
  }

  function cancel(): void {
    intent.value = null;
  }

  async function confirm(): Promise<void> {
    const c = card();
    const from = c.task.stageId;
    error.value = '';
    try {
      if (intent.value === 'back' || intent.value === 'next') {
        const target = intent.value === 'back' ? c.moves.prev : c.moves.next;
        if (!target) return;
        await writes.setTaskStage.mutateAsync({
          taskId: c.task.id,
          fromStageId: from,
          stageId: target.id,
          key,
        });
      } else if (intent.value === 'start' && startKind.value === 'run') {
        await writes.startRun.mutateAsync({ taskId: c.task.id, fromStageId: from, key });
      } else if (intent.value === 'start' && startKind.value === 'launch') {
        await writes.launchStage.mutateAsync({ taskId: c.task.id, fromStageId: from, key });
      }
      intent.value = null;
    } catch (err) {
      error.value = message(err);
    }
  }

  return { intent, error, busy, dialog, startKind, ask, cancel, confirm };
}
