import { useScriptRunDialogStore } from '@workbench/automations/run/runDialog';
import type { MenuItem } from '@workbench/state/contextMenu';
import { useCustomScriptsStore } from '../../../state/customScripts';
import { automationItems } from './automationItems';

/** Starts a saved script for an ADE task, and optionally a branch, through the shared run dialog. */
export function useRunAutomation() {
  const scripts = useCustomScriptsStore();
  const dialog = useScriptRunDialogStore();

  function start(scriptId: string, taskId: string, branchId = ''): void {
    if (scriptId === '') return;
    dialog.open({ scriptId, taskId, branchId, from: 'ade' });
  }

  /** One item per script, for a menu that targets `taskId` (and `branchId` from a branch). */
  function menuItems(taskId: string, branchId = ''): MenuItem[] {
    return automationItems(scripts.records).map((it) => ({
      type: 'item',
      id: it.id,
      label: it.label,
      icon: it.icon,
      disabled: it.disabled,
      run: () => start(it.cmd.kind === 'automation' ? it.cmd.scriptId : '', taskId, branchId),
    }));
  }

  function submenu(taskId: string, branchId = ''): MenuItem {
    return {
      type: 'submenu',
      id: 'ade-automation-menu',
      label: 'Run automation',
      items: menuItems(taskId, branchId),
    };
  }

  return { start, menuItems, submenu, items: () => automationItems(scripts.records) };
}
