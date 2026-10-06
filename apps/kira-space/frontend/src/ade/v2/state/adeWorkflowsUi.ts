import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAdeBoardUiStore } from './adeBoardUi';

// Workflows page state, in memory only.
export const useAdeWorkflowsUiStore = defineStore('adeWorkflowsUi', () => {
  /** Selected file name (`null` = first listed). */
  const workflowFile = ref<string | null>(null);
  const workflowMode = ref<'form' | 'yaml'>('form');

  /** Opens the Workflows page on `fileName`. */
  function openWorkflow(fileName: string | null): void {
    workflowFile.value = fileName;
    useAdeBoardUiStore().view = 'workflows';
  }

  return { workflowFile, workflowMode, openWorkflow };
});
