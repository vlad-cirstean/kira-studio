import type { TerminalModuleContext } from '@workbench/terminal/module';
import { useCustomScriptsStore } from '../state/customScripts';
import { useSettingsStore } from '../state/settings';
import { useTerminalsStore } from '../state/terminals';
import { openTerminalTab } from '../state/terminalTabs';

// P128 §2.4: this app's own terminal-module context, provided once in App.vue (alongside
// workbenchHostKey) for the shared TerminalPanel.vue/TerminalStart.vue/TerminalNewTab.vue/
// TerminalTabView.vue to inject. `scripts` wires this app's own custom-scripts store (P85) — Kira
// Space's own copy of this file omits it (§0's seam resolution), so its panel shows no Quick
// commands section.
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
      remove: (id) => customScriptsStore.removeCustomScript(id),
      openEditor: () => settingsStore.openSettingsAt('Scripts'),
    },
  };
}
