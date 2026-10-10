import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { cloneWorkflow, newStage, runnableCount } from '../board/workflowForm';
import {
  addResult,
  addStep,
  clearRoute,
  moveStage,
  patchResult,
  removeResult,
  removeStep,
  setRoute,
  setStart,
} from '../board/workflowGraph';
import type { Stage, StepResult, Workflow } from '../wire';

export type Selection =
  | { kind: 'stage'; stageId: string }
  | { kind: 'step'; stageId: string; stepId: string };

// The graph editor's draft: a local copy of the last valid workflow that every canvas and inspector
// edit changes. Save writes it whole, Discard drops it; a pushed workflow never replaces unsaved edits.
export const useAdeWorkflowDraftStore = defineStore('adeWorkflowDraft', () => {
  const draft = ref<Workflow | null>(null);
  const dirty = ref(false);
  const error = ref('');
  const selection = ref<Selection | null>(null);

  const stage = computed(
    () => draft.value?.stages.find((s) => s.id === selection.value?.stageId) ?? null,
  );
  const step = computed(() => {
    const sel = selection.value;
    return sel?.kind === 'step'
      ? (stage.value?.steps.find((s) => s.id === sel.stepId) ?? null)
      : null;
  });
  const canSkip = computed(() => runnableCount(draft.value?.stages ?? []) > 1);

  function open(wf: Workflow | null): void {
    draft.value = wf ? cloneWorkflow(wf) : null;
    dirty.value = false;
    error.value = '';
    selection.value = null;
  }
  /** A pushed workflow: taken only while nothing is unsaved. */
  function push(wf: Workflow | null): void {
    if (!dirty.value && wf) draft.value = cloneWorkflow(wf);
  }
  function discard(wf: Workflow | null): void {
    open(wf);
  }
  function edit(next: Workflow): void {
    draft.value = next;
    dirty.value = true;
    const sel = selection.value;
    if (sel && !next.stages.find((s) => s.id === sel.stageId)) selection.value = null;
    else if (
      sel?.kind === 'step' &&
      !next.stages.find((s) => s.id === sel.stageId)?.steps.some((s) => s.id === sel.stepId)
    )
      selection.value = { kind: 'stage', stageId: sel.stageId };
  }
  /** After a save: clean only when nothing changed while it was in flight. */
  function saved(sent: string): void {
    error.value = '';
    if (JSON.stringify(draft.value) === sent) dirty.value = false;
  }
  function select(sel: Selection | null): void {
    selection.value = sel;
  }

  const wf = (): Workflow | null => draft.value;
  function patchWorkflow(p: Partial<Pick<Workflow, 'name' | 'kiraSpaceMcp'>>): void {
    if (draft.value) edit({ ...draft.value, ...p });
  }
  function patchStage(stageId: string, p: Partial<Stage>): void {
    const w = wf();
    if (w) edit({ ...w, stages: w.stages.map((s) => (s.id === stageId ? { ...s, ...p } : s)) });
  }
  function replaceStage(next: Stage): void {
    const w = wf();
    if (w) edit({ ...w, stages: w.stages.map((s) => (s.id === next.id ? next : s)) });
  }
  function patchStep(stageId: string, stepId: string, p: Partial<Stage['steps'][number]>): void {
    const w = wf();
    if (!w) return;
    edit({
      ...w,
      stages: w.stages.map((s) =>
        s.id === stageId
          ? { ...s, steps: s.steps.map((x) => (x.id === stepId ? { ...x, ...p } : x)) }
          : s,
      ),
    });
  }
  function createStage(): void {
    const w = wf();
    if (!w) return;
    const fresh = newStage(w.stages);
    edit({ ...w, stages: [...w.stages, fresh] });
    selection.value = { kind: 'stage', stageId: fresh.id };
  }
  function removeStage(stageId: string): void {
    const w = wf();
    if (w) edit({ ...w, stages: w.stages.filter((s) => s.id !== stageId) });
  }
  function reorderStages(from: number, to: number): void {
    const w = wf();
    if (w) edit(moveStage(w, from, to));
  }
  function createStep(stageId: string, after?: string): void {
    const w = wf();
    if (!w) return;
    const r = addStep(w, stageId, after);
    edit(r.wf);
    selection.value = { kind: 'step', stageId, stepId: r.stepId };
  }
  function deleteStep(stageId: string, stepId: string): void {
    const w = wf();
    if (w) edit(removeStep(w, stageId, stepId));
  }
  function makeStart(stageId: string, stepId: string): void {
    const w = wf();
    if (w) edit(setStart(w, stageId, stepId));
  }
  function route(stageId: string, stepId: string, resultId: string, target: string): void {
    const w = wf();
    if (w) edit(setRoute(w, stageId, stepId, resultId, target));
  }
  function clear(stageId: string, stepId: string, resultIds: string[]): void {
    const w = wf();
    if (w) edit(clearRoute(w, stageId, stepId, resultIds));
  }
  function createResult(stageId: string, stepId: string): void {
    const w = wf();
    if (w) edit(addResult(w, stageId, stepId));
  }
  function deleteResult(stageId: string, stepId: string, resultId: string): void {
    const w = wf();
    if (w) edit(removeResult(w, stageId, stepId, resultId));
  }
  function changeResult(
    stageId: string,
    stepId: string,
    resultId: string,
    p: Partial<Pick<StepResult, 'id' | 'ok' | 'description' | 'max'>>,
  ): void {
    const w = wf();
    if (w) edit(patchResult(w, stageId, stepId, resultId, p));
  }

  return {
    draft,
    dirty,
    error,
    selection,
    stage,
    step,
    canSkip,
    open,
    push,
    discard,
    saved,
    select,
    patchWorkflow,
    patchStage,
    replaceStage,
    patchStep,
    createStage,
    removeStage,
    reorderStages,
    createStep,
    deleteStep,
    makeStart,
    route,
    clear,
    createResult,
    deleteResult,
    changeResult,
  };
});
