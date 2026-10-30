import { useAsyncAction } from '@workbench/behaviour/asyncAction';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { stepMoves } from '../board/stepMoves';
import { usePlanModel } from '../plan/usePlanModel';
import { useDismissHandover, useSetTaskStep, useStepDone } from '../queries';

// The stage-change dialog: which task it is open for, the target stage and the handover notes typed
// for it. One concern: the stage move with notes. Every opener (step mover, task menu, Done action,
// the routed `handover` prompt) goes through here.
export const useAdeStageDialogStore = defineStore('adeStageDialog', () => {
  const { model } = usePlanModel();
  const stepDone = useStepDone();
  const setStep = useSetTaskStep();
  const dismissM = useDismissHandover();

  const taskId = ref<string | null>(null);
  /** Opened by the routed `handover` prompt rather than by a board action. */
  const routed = ref(false);
  /** The stage the dialog was asked to move to; '' = the natural next one. */
  const asked = ref('');
  const toStepId = ref('');
  const notes = ref('');

  const card = computed(() => (taskId.value ? (model.value?.cardFor(taskId.value) ?? null) : null));
  const fromStepId = computed(() => {
    const c = card.value;
    if (!c) return '';
    return c.progress.finished ? 'done' : (c.progress.step?.id ?? c.task.entryStepId);
  });
  const moves = computed(() =>
    card.value ? stepMoves(card.value.blocks, fromStepId.value, card.value.task.runs) : null,
  );
  /** The open draft of the stage being left, the notes' starting text. */
  const draft = computed(
    () => card.value?.task.handoverDrafts.find((d) => d.fromStepId === fromStepId.value) ?? null,
  );
  const prefill = computed(() => draft.value?.body ?? '');
  const isOpen = computed(() => taskId.value !== null && card.value !== null);

  function open(args: { taskId: string; toStepId?: string; routed?: boolean }): void {
    taskId.value = args.taskId;
    routed.value = args.routed ?? false;
    asked.value = args.toStepId ?? '';
    seed();
  }

  /** Fills the target and notes once the card is known (it may arrive after the open). */
  function seed(): void {
    toStepId.value = asked.value || (moves.value?.next?.id ?? '');
    notes.value = prefill.value;
  }
  watch(card, (c, was) => {
    if (c && !was && taskId.value) seed();
  });

  function close(): void {
    taskId.value = null;
  }

  /** Sends the move; notes go along only when they differ from the draft. */
  const move = useAsyncAction(async () => {
    const c = card.value;
    const m = moves.value;
    if (!c || !m || !toStepId.value) return;
    const sendNotes = notes.value !== prefill.value ? { notes: notes.value } : {};
    const manual = c.progress.step?.kind === 'manual' && !c.progress.finished;
    if (manual && toStepId.value === m.next?.id) {
      await stepDone.mutateAsync({ taskId: c.task.id, ...sendNotes });
    } else {
      await setStep.mutateAsync({
        taskId: c.task.id,
        stepId: toStepId.value,
        fromStepId: fromStepId.value,
        ...sendNotes,
      });
    }
    close();
  });

  /** Not now on the routed prompt: keeps the draft and withdraws the popup. */
  const dismissal = useAsyncAction(async () => {
    if (taskId.value) await dismissM.mutateAsync({ taskId: taskId.value });
  });

  const error = computed(() => move.error.value ?? dismissal.error.value ?? '');
  /** Edits the draft would lose on close. */
  const dirty = computed(() => notes.value !== prefill.value);

  return {
    taskId,
    toStepId,
    notes,
    error,
    pending: move.pending,
    dirty,
    card,
    moves,
    fromStepId,
    draft,
    routed,
    isOpen,
    open,
    close,
    submit: move.run,
    dismiss: dismissal.run,
  };
});
