import type { TerminalModuleContext } from '@workbench/terminal/module';
import { control } from '../bridge/control';
import { useCustomScriptsStore } from '../state/customScripts';
import { useSettingsStore } from '../state/settings';
import { useTerminalsStore } from '../state/terminals';
import { openTerminalTab } from '../state/terminalTabs';

// P128 §2.4/§2.7: this app's own terminal-module context, provided once in App.vue (alongside
// workbenchHostKey) for the shared TerminalPanel.vue/TerminalStart.vue/TerminalNewTab.vue/
// TerminalTabView.vue to inject. `'terminal'` is this app's own module workspace (state/workspace.ts's `visibleWorkspace`
// reads the mode store for it directly; it never reaches `repoIdOfWorkspace`/`GitPanel`).
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
    chooseFolder: async (title) => {
      const chosen = await control.filesChooseFolder(title);
      return chosen.canceled ? null : chosen.path;
    },
    scripts: {
      records: () => customScriptsStore.records,
      create: (fields) => customScriptsStore.createCustomScript(fields),
      update: (id, fields) => customScriptsStore.updateCustomScript(id, fields),
      remove: (id) => customScriptsStore.removeCustomScript(id),
      collections: () => customScriptsStore.collections,
      createCollection: (name) => customScriptsStore.createCollection(name),
      renameCollection: (id, name) => customScriptsStore.renameCollection(id, name),
      removeCollection: (id) => customScriptsStore.removeCollection(id),
      move: (id, collectionId) => customScriptsStore.moveScript(id, collectionId),
    },
  };
}
