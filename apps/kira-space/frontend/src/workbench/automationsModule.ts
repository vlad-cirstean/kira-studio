import type { AutomationsModuleContext } from '@workbench/automations/module';
import { control } from '../bridge/control';
import { useCustomScriptsStore } from '../state/customScripts';
import { useModeStore } from '../state/mode';
import { useSettingsStore } from '../state/settings';
import { useTabsStore } from '../state/tabs';
import { useTerminalsStore } from '../state/terminals';
import { openTerminalTab } from '../state/terminalTabs';

// P128 §2.4/§2.7: this app's own Automations-module context, provided once in App.vue (alongside
// workbenchHostKey) for the shared AutomationsPanel.vue/AutomationsStart.vue/AutomationsNewTab.vue/
// TerminalTabView.vue to inject. `'automations' is this app's own module workspace (state/workspace.ts's `visibleWorkspace`
// reads the mode store for it directly; it never reaches `repoIdOfWorkspace`/`GitPanel`).
export function createAutomationsModule(): AutomationsModuleContext {
  const customScriptsStore = useCustomScriptsStore();
  const settingsStore = useSettingsStore();
  const terminalsStore = useTerminalsStore();
  const modeStore = useModeStore();
  const tabsStore = useTabsStore();

  return {
    defaultCwd: () => terminalsStore.terminalDefaults.cwd,
    openTerminalTab: (opts) => {
      openTerminalTab({ workspaceId: 'automations', cwd: opts.cwd, launch: opts.launch });
    },
    openRunTab: (runId, label) => {
      tabsStore.openTab('script-run', null, runId, () => ({ runId, label }), {
        reuse: true,
        workspaceId: 'automations',
      });
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
    runs: {
      list: (limit, taskId) => control.scriptRunsList(limit, taskId),
      stop: (id) => control.scriptRunsStop(id),
      resolveDir: (scriptId) => control.scriptRunsResolveDir(scriptId),
      onChanged: (cb) => control.onScriptRunsChanged(cb),
      preview: (args) => control.scriptRunsPreview(args),
      start: (args, hash) => control.scriptRunsStart(args, hash),
      readLog: (id, afterSeq) => control.scriptRunsReadLog(id, afterSeq),
      onLog: (cb) => control.onScriptRunLog(cb),
      nextFires: (cron, timezone, count) => control.scriptRunsNextFires(cron, timezone, count),
      schedulePreview: (scriptId, secrets) => control.scriptRunsSchedulePreview(scriptId, secrets),
      runScheduleNow: (scriptId, hash, secrets) =>
        control.scriptRunsRunScheduleNow(scriptId, hash, secrets),
      confirmAccept: (runId, hash, secrets) =>
        control.scriptRunsConfirmAccept(runId, hash, secrets),
      confirmDecline: (runId) => control.scriptRunsConfirmDecline(runId),
      mcpServers: () => control.scriptRunsMcpServers(),
      mcpTools: (server) => control.scriptRunsMcpTools(server),
    },
    ade: true,
    showAutomations: () => modeStore.setMode('automations'),
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
