import { t } from '@theme/i18n';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { useAdeWorkflowDraftStore } from '../state/adeWorkflowDraft';

/** Removes a step after the user confirms; shared by the Delete shortcut and the step menu. */
export function useStepRemoval(): {
  confirmRemoveStep: (stageId: string, stepId: string) => Promise<void>;
} {
  const draft = useAdeWorkflowDraftStore();
  const confirm = useConfirmDialogStore();
  async function confirmRemoveStep(stageId: string, stepId: string): Promise<void> {
    const name =
      draft.draft?.stages.find((s) => s.id === stageId)?.steps.find((s) => s.id === stepId)?.name ??
      '';
    const ok = await confirm.confirm({
      title: t('space.ade.workflows.graph.removeStepConfirm.title'),
      message: t('space.ade.workflows.graph.removeStepConfirm.body', { name }),
      confirmLabel: t('common.action.remove.label'),
      tone: 'danger',
    });
    if (ok) draft.deleteStep(stageId, stepId);
  }
  return { confirmRemoveStep };
}
