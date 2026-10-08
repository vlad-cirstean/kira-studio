import { computed, ref } from 'vue';
import { newIntentKey, useAdeWrites } from './useAdeWrites';
import type { PlanCard } from './useAgentsModel';

export type TaskIntent = 'back' | 'next' | 'start';

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The Back, Next and Start buttons of one plan card: the confirm text for each, and the write. */
export function useTaskActions(card: () => PlanCard) {
  const writes = useAdeWrites();
  const intent = ref<TaskIntent | null>(null);
  const error = ref('');
  let key = newIntentKey();

  const stageName = computed(() => card().progress.stage?.name ?? 'this stage');
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
          title: 'Move back?',
          text: `Move "${c.title}" back to ${c.moves.prev?.name ?? ''}. Its earlier runs stay as history.`,
          confirmLabel: 'Move back',
        };
      case 'next':
        return {
          title: c.moves.next?.name === 'Done' ? 'Mark done?' : 'Move forward?',
          text: `Move "${c.title}" on to ${c.moves.next?.name ?? ''}.`,
          confirmLabel: 'Move on',
        };
      case 'start':
        return {
          title: `Start ${stageName.value}?`,
          text:
            startKind.value === 'run'
              ? `Agents start now in the worktrees of "${c.title}".`
              : `A Claude Code session for ${stageName.value} opens on your computer.`,
          confirmLabel: 'Start',
        };
      default:
        return { title: '', text: '', confirmLabel: '' };
    }
  });

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
