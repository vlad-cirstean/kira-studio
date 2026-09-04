import { reactive } from 'vue';
import { openCreateDialog } from '../state/connections';
import { toggleOperationsPanel, toggleProjectPanel } from '../state/layout';
import { activeTab } from '../state/mode';
import { settingsOpen } from '../state/settings';
import { activateNextTab, activatePrevTab, closeTab, openHttpRequestTab } from '../state/tabs';
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
  // D13: a one-click action worth a name, the same bar this list's own comment states — no menu
  // or accelerator change (HttpStart.vue/CollectionsPanel.vue's own buttons are the other two).
  { id: 'http.newRequest', label: 'New request', run: () => void openHttpRequestTab() },
  // P4 D15: the discoverability answer for Save, at the same bar this list's own comment states.
  // No ⌘S and no accelerator — shared/domain/shortcuts.ts is a closed map and a menu accelerator
  // needs the seven-file path P1 OQ-3 / P2 OQ-7 deferred as one deliberate pass. View-scoped like
  // view.run below, so it is a no-op when no request tab is mounted.
  { id: 'http.save', label: 'Save request', run: () => runCommand('http.save') },
  // Registered by CollectionsPanel.vue, which is mounted for the whole of Http mode — an import
  // is not tab-scoped the way Save is.
  { id: 'http.import', label: 'Import collection…', run: () => runCommand('http.import') },
  // P5 D3/D11: both registered by CollectionsPanel.vue, mounted for the whole of Http mode — no
  // tab to be scoped to.
  { id: 'http.variables', label: 'Variables…', run: () => runCommand('http.variables') },
  { id: 'http.environments', label: 'Environments…', run: () => runCommand('http.environments') },
  // P6 D11: the reference dialog's palette entry, same "registered by CollectionsPanel.vue,
  // mounted for the whole of Http mode" shape as the two above.
  {
    id: 'http.dynamicValues',
    label: 'Dynamic values…',
    run: () => runCommand('http.dynamicValues'),
  },
  { id: 'open-settings', label: 'Open settings', run: () => (settingsOpen.value = true) },
  { id: 'toggle-project-panel', label: 'Toggle project panel', run: toggleProjectPanel },
  { id: 'toggle-operations-panel', label: 'Toggle operations panel', run: toggleOperationsPanel },
  { id: 'view.find', label: 'Find', run: () => runCommand('view.find') },
  { id: 'view.refresh', label: 'Refresh', run: () => runCommand('view.refresh') },
  { id: 'view.run', label: 'Run statement', run: () => runCommand('view.run') },
  { id: 'view.run-all', label: 'Run all', run: () => runCommand('view.run-all') },
  { id: 'view.format', label: 'Format query', run: () => runCommand('view.format') },
  // P18 (v1.1) C12/D12's own comment: chord-less by design — Format took the seven-file
  // accelerator path because that command has a chord users already have in their fingers;
  // Explain has no such convention, so the palette entry alone is where it is discoverable.
  { id: 'view.explain', label: 'Explain query', run: () => runCommand('view.explain') },
  // P15 D11: DataView.vue registers this only while a data tab is active and its connection
  // allows it — a no-op elsewhere, same as every other view-scoped command above.
  { id: 'data.generate', label: 'Generate data…', run: () => runCommand('data.generate') },
  { id: 'tab-next', label: 'Next tab', run: activateNextTab },
  { id: 'tab-prev', label: 'Previous tab', run: activatePrevTab },
  {
    id: 'tab-close',
    label: 'Close tab',
    run: () => {
      if (activeTab.value) closeTab(activeTab.value.id);
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
