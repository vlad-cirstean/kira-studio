import { t } from '@theme/i18n';
import { runCommand } from '@workbench/shortcuts/commands';
import type { PaletteCommand } from '@workbench/shortcuts/palette';
import { useLayoutStore } from '../state/layout';
import { useSettingsStore } from '../state/settings';
import { useTabsStore } from '../state/tabs';

/** Space's palette commands; call once from App setup (the stores resolve there). */
export function spacePaletteCommands(): PaletteCommand[] {
  const layoutStore = useLayoutStore();
  const tabsStore = useTabsStore();
  const settingsStore = useSettingsStore();

  return [
    {
      id: 'open-settings',
      label: t('common.action.openSettings.label'),
      run: () => {
        settingsStore.settingsOpen = true;
      },
    },
    {
      id: 'toggle-project-panel',
      label: t('space.shortcuts.palette.toggleProjectPanel.label'),
      run: () => layoutStore.toggleProjectPanel(),
    },
    {
      id: 'toggle-operations-panel',
      label: t('space.shortcuts.palette.toggleOperationsPanel.label'),
      run: () => layoutStore.toggleOperationsPanel(),
    },
    { id: 'view.find', label: t('common.action.find.label'), run: () => runCommand('view.find') },
    {
      id: 'tab-next',
      label: t('space.shortcuts.palette.nextTab.label'),
      run: tabsStore.activateNextTab,
    },
    {
      id: 'tab-prev',
      label: t('space.shortcuts.palette.previousTab.label'),
      run: tabsStore.activatePrevTab,
    },
    {
      id: 'tab-close',
      label: t('space.shortcuts.palette.closeTab.label'),
      run: tabsStore.closeActiveTab,
    },
  ];
}
