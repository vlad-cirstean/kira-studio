import { t } from '@theme/i18n';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { useAdeWorkflowDraftStore } from '../state/adeWorkflowDraft';

/** Removes a step after the user confirms; shared by the Delete shortcut and the step menu. */
export function useStepRemoval(): {
  confirmRemoveStep: (stepId: string) => Promise<void>;
} {
  const draft = useAdeWorkflowDraftStore();
  const confirm = useConfirmDialogStore();
  async function confirmRemoveStep(stepId: string): Promise<void> {
    const name = draft.draft?.steps.find((s) => s.id === stepId)?.name ?? '';
    const ok = await confirm.confirm({
      title: t('space.ade.workflows.graph.removeStepConfirm.title'),
      message: t('space.ade.workflows.graph.removeStepConfirm.body', { name }),
      confirmLabel: t('common.action.remove.label'),
      tone: 'danger',
    });
    if (ok) draft.deleteStep(stepId);
  }
  return { confirmRemoveStep };
}
