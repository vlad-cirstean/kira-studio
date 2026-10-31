import { t } from '@theme/i18n';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAdeBoardUiStore } from './adeBoardUi';

// Workflows page state, in memory only.
export const useAdeWorkflowsUiStore = defineStore('adeWorkflowsUi', () => {
  /** Selected file name (`null` = first listed). */
  const workflowFile = ref<string | null>(null);
  const workflowMode = ref<'graph' | 'yaml'>('graph');
  /** What the right pane shows: the selected workflow or the task statuses editor. */
  const pane = ref<'workflow' | 'statuses'>('workflow');
  /** The open editor holds edits that are not saved. */
  const dirty = ref(false);

  /** Resolves true when the caller may leave the editor: nothing unsaved, or the user discards it. */
  async function leave(): Promise<boolean> {
    if (!dirty.value) return true;
    const discard = await useConfirmDialogStore().confirm({
      title: t('space.ade.workflowDiscardConfirm.title'),
      message: t('space.ade.workflowDiscardConfirm.body'),
      confirmLabel: t('common.action.discard.label'),
      tone: 'danger',
    });
    if (discard) dirty.value = false;
    return discard;
  }

  /** Opens the Workflows page on `fileName`. */
  function openWorkflow(fileName: string | null): void {
    pane.value = 'workflow';
    workflowFile.value = fileName;
    useAdeBoardUiStore().view = 'workflows';
  }

  /** Opens the Workflows page on the task statuses editor; false when the user kept unsaved edits. */
  async function openStatuses(): Promise<boolean> {
    if (!(await leave())) return false;
    pane.value = 'statuses';
    useAdeBoardUiStore().view = 'workflows';
    return true;
  }

  return { workflowFile, workflowMode, pane, dirty, leave, openWorkflow, openStatuses };
});
