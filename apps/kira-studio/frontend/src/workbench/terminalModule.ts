import type { TerminalModuleContext } from '@workbench/terminal/module';
import { useCustomScriptsStore } from '../state/customScripts';
import { useSettingsStore } from '../state/settings';
import { useTerminalsStore } from '../state/terminals';
import { openTerminalTab } from '../state/terminalTabs';

// P128 §2.4: this app's own terminal-module context, provided once in App.vue (alongside
// workbenchHostKey) for the shared TerminalPanel.vue/TerminalStart.vue/TerminalNewTab.vue/
// TerminalTabView.vue to inject. `scripts` wires the shared quick-command store's own CRUD.
export function createTerminalModule(): TerminalModuleContext {
  const customScriptsStore = useCustomScriptsStore();
  const settingsStore = useSettingsStore();
  const terminalsStore = useTerminalsStore();

  return {
    defaultCwd: () => terminalsStore.terminalDefaults.cwd,
    openTerminalTab: (opts) => {
      openTerminalTab({ workspaceId: 'terminal', cwd: opts.cwd, launch: opts.launch });
    },
    host: {
      rendererDeps: {
        appearance: () => settingsStore.appearance,
        onTerminalOutput: terminalsStore.onTerminalOutput,
        writeTerminal: terminalsStore.writeTerminal,
      },
      terminalSession: terminalsStore.terminalSession,
      openTerminalSession: terminalsStore.openTerminalSession,
      resizeTerminal: terminalsStore.resizeTerminal,
    },
    scripts: {
      records: () => customScriptsStore.records,
      create: (fields) => customScriptsStore.createCustomScript(fields),
      update: (id, fields) => customScriptsStore.updateCustomScript(id, fields),
      remove: (id) => customScriptsStore.removeCustomScript(id),
    },
  };
}
