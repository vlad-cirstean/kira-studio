import { reactive } from 'vue';
import { openCreateDialog } from '../state/connections';
import { toggleOperationsPanel, toggleProjectPanel } from '../state/layout';
import { settingsOpen } from '../state/settings';
import { activateNextTab, activatePrevTab, closeTab, tabsState } from '../state/tabs';
import { runCommand } from './commands';

export interface PaletteCommand {
  id: string;
  label: string;
  run: () => void;
}

// D12: deliberately small and 1:1 with already-reachable actions — every global shortcut this
// phase adds (the palette's own toggle excluded), plus the handful of other one-click actions
// worth a name in the palette. No fuzzy scoring, no "go to anything" navigation (§8.15 calls
// for "minimal").
export const paletteCommands: PaletteCommand[] = [
  { id: 'new-connection', label: 'New connection', run: () => openCreateDialog() },
  { id: 'open-settings', label: 'Open settings', run: () => (settingsOpen.value = true) },
  { id: 'toggle-project-panel', label: 'Toggle project panel', run: toggleProjectPanel },
  { id: 'toggle-operations-panel', label: 'Toggle operations panel', run: toggleOperationsPanel },
  { id: 'view.find', label: 'Find', run: () => runCommand('view.find') },
  { id: 'view.refresh', label: 'Refresh', run: () => runCommand('view.refresh') },
  { id: 'view.run', label: 'Run statement', run: () => runCommand('view.run') },
  { id: 'view.run-all', label: 'Run all', run: () => runCommand('view.run-all') },
  { id: 'tab-next', label: 'Next tab', run: activateNextTab },
  { id: 'tab-prev', label: 'Previous tab', run: activatePrevTab },
  {
    id: 'tab-close',
    label: 'Close tab',
    run: () => {
      if (tabsState.activeId) closeTab(tabsState.activeId);
    },
  },
];

export const paletteState = reactive({ open: false, query: '' });

function openPalette(): void {
  paletteState.open = true;
  paletteState.query = '';
}

export function closePalette(): void {
  paletteState.open = false;
}

export function togglePalette(): void {
  if (paletteState.open) closePalette();
  else openPalette();
}
