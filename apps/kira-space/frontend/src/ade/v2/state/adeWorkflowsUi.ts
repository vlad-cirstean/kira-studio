import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAdeBoardUiStore } from './adeBoardUi';

// Workflows page state, in memory only.
export const useAdeWorkflowsUiStore = defineStore('adeWorkflowsUi', () => {
  /** Selected file name (`null` = first listed). */
  const workflowFile = ref<string | null>(null);
  const workflowMode = ref<'graph' | 'yaml'>('graph');
  /** The open editor holds edits that are not saved. */
  const dirty = ref(false);

  /** Resolves true when the caller may leave the editor: nothing unsaved, or the user discards it. */
  async function leave(): Promise<boolean> {
    if (!dirty.value) return true;
    const discard = await useConfirmDialogStore().confirmDialog(
      'Discard unsaved workflow changes?',
      {
        danger: true,
        confirmLabel: 'Discard',
      },
    );
    if (discard) dirty.value = false;
    return discard;
  }

  /** Opens the Workflows page on `fileName`. */
  function openWorkflow(fileName: string | null): void {
    workflowFile.value = fileName;
    useAdeBoardUiStore().view = 'workflows';
  }

  return { workflowFile, workflowMode, dirty, leave, openWorkflow };
});
