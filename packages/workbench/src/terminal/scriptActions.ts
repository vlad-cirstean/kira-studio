import type { CustomScript } from '@shared/domain/scripts';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import type { TerminalScriptsSeam } from './module';

// P133 §2.5: one copy of the confirm-then-remove flow, shared by TerminalPanel.vue's context menu
// and QuickCommandsDialog.vue's remove button (both quoted the same string before this phase).
export function useRemoveScript(): (
  scripts: TerminalScriptsSeam,
  script: CustomScript,
) => Promise<boolean> {
  const confirmDialogStore = useConfirmDialogStore();

  return async (scripts, script) => {
    const ok = await confirmDialogStore.confirmDialog(
      `Remove "${script.name}"? It will no longer appear in Quick commands.`,
      { danger: true, confirmLabel: 'Remove' },
    );
    if (!ok) return false;
    await scripts.remove(script.id);
    return true;
  };
}
