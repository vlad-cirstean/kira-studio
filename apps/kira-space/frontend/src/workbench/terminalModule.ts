import type { TerminalModuleContext } from '@workbench/terminal/module';
import { useSettingsStore } from '../state/settings';
import { useTerminalsStore } from '../state/terminals';
import { openTerminalTab } from '../state/terminalTabs';

// P128 §2.4/§2.7: this app's own terminal-module context, provided once in App.vue (alongside
// workbenchHostKey) for the shared TerminalPanel.vue/TerminalStart.vue/TerminalNewTab.vue/
// TerminalTabView.vue to inject — Kira Studio's own terminalModule.ts, minus `scripts` (this app
// has no custom-scripts store, §0's seam resolution), so its panel shows no Quick commands
// section. `'terminal'` is this app's own module workspace (state/workspace.ts's `visibleWorkspace`
// reads the mode store for it directly; it never reaches `repoIdOfWorkspace`/`GitPanel`).
export function createTerminalModule(): TerminalModuleContext {
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
  };
}
