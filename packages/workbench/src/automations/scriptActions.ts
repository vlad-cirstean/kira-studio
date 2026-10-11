import type { CustomScript } from '@shared/domain/scripts';
import { t } from '@theme/i18n';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import type { ScriptsSeam } from './module';

// P133 §2.5: one copy of the confirm-then-remove flow, shared by AutomationsPanel.vue's context menu
// and ScriptDialog.vue's remove button (both quoted the same string before this phase).
export function useRemoveScript(): (
  scripts: ScriptsSeam,
  script: CustomScript,
) => Promise<boolean> {
  const confirmDialogStore = useConfirmDialogStore();

  return async (scripts, script) => {
    const ok = await confirmDialogStore.confirm({
      title: t('automations.script.removeConfirm.title'),
      message: t('automations.script.removeConfirm.body', {
        name: script.name,
        module: t('common.module.automations.label'),
      }),
      confirmLabel: t('common.action.remove.label'),
      tone: 'danger',
    });
    if (!ok) return false;
    await scripts.remove(script.id);
    return true;
  };
}
