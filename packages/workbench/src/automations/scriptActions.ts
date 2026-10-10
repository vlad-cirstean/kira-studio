import { type CustomScript, customScriptFieldsSchema } from '@shared/domain/scripts';
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
    const ok = await confirmDialogStore.confirmDialog(
      `Remove "${script.name}"? It will no longer appear in Automations.`,
      { danger: true, confirmLabel: 'Remove' },
    );
    if (!ok) return false;
    await scripts.remove(script.id);
    return true;
  };
}

/** Flips a recurring script's `enabled`; a script that is not recurring is left alone. */
export async function toggleSchedule(scripts: ScriptsSeam, script: CustomScript): Promise<void> {
  if (!script.schedule) return;
  const fields = customScriptFieldsSchema.parse(script);
  await scripts.update(script.id, {
    ...fields,
    schedule: { ...script.schedule, enabled: !script.schedule.enabled },
  });
}
