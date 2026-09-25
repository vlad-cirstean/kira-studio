import { VueQueryPlugin } from '@tanstack/vue-query';
import { bootstrapShell } from '@workbench/bootstrapShell';
import { queryClient } from '@workbench/state/queryClient';
import { createApp } from 'vue';
import App from './App.vue';
import { useCodeReposStore } from './state/coderepos';
import { useGitClientsStore } from './state/gitClients';
import { useLayoutStore } from './state/layout';
import { pinia } from './state/pinia';
import { ensureWorkspaceShell } from './state/repoTabs';
import { useSettingsStore } from './state/settings';
import { useTabsStore } from './state/tabs';
import { useTerminalsStore } from './state/terminals';
import { GENERAL_WORKSPACE, useWorkspaceStore } from './state/workspace';
// workbench.css imports @theme/base.css itself now (P104) — importing both here would compile
// base.css as two separate Tailwind roots and double its output.
import '@workbench/workbench.css';

// P100 Part 2: Kira Studio's own main.ts bootstrap, trimmed to this app's own state layer — no
// __KIRA_DEBUG_HOOKS__ block (that whole retention-probe apparatus is data-grid/query-result
// specific: grid/documents/keyvalue/stream/console page stores, none of which exist here) and no
// appMetrics/appUpdate/cacheStats/agentHooks/agentSessions/keepAwake/ops/dbMcp/customScripts stores
// (none of those subsystems exist in this app — apps/kira-space/main.go's own Services list has no
// counterpart for any of them).
async function mountShell(): Promise<void> {
  // Every store used here runs before app.use(pinia) below, so each needs the module-level `pinia`
  // instance passed explicitly (Pinia has no active instance yet at this point).
  const layoutStore = useLayoutStore(pinia);
  const settingsStore = useSettingsStore(pinia);
  const codeReposStore = useCodeReposStore(pinia);
  const gitClientsStore = useGitClientsStore(pinia);
  const tabsStore = useTabsStore(pinia);
  const terminalsStore = useTerminalsStore(pinia);
  const workspaceStore = useWorkspaceStore(pinia);

  // P100 Part 2: Studio's own boot sequence awaited control.windowsEnsure() here, before
  // hydrateTabs, so modeStore's persisted-per-window mode was set before the first render. This app
  // has no WindowsService (apps/kira-space/main.go's own Services list) and so no per-window
  // persisted "last active workspace" to await — every window boots to GENERAL_WORKSPACE and, below,
  // falls forward onto its first restored repo instead, once hydrateTabs has resolved one.
  await Promise.all([
    layoutStore.hydrateLayout(),
    settingsStore.hydrateSettings(),
    codeReposStore.hydrateCodeRepos(),
    tabsStore.hydrateTabs(),
  ]);

  // F2: gitClients (Connected editors/pairing) and terminals (new-terminal defaults) are not on
  // the critical path to a rendered shell — Promise.allSettled so one of these hitting a DB error
  // never takes down the whole window the way it did bundled into the Promise.all above.
  const optional = await Promise.allSettled([
    gitClientsStore.hydrateGitClients(),
    terminalsStore.hydrateTerminalDefaults(),
  ]);
  for (const result of optional) {
    if (result.status === 'rejected') {
      console.error('bootstrap: optional store hydrate failed', result.reason);
    }
  }

  // C5 §6.1: hydrateTabs (state/tabs.ts) already derived workspaceStore.openRepos from the
  // restored tabs themselves — ensureWorkspaceShell's own doc comment calls for running it once per
  // restored repo right here, after hydrateTabs, since hydrateTabs itself never calls back into it
  // (avoiding a third link in that module pair's existing two-way call graph).
  for (const repoId of workspaceStore.openRepos) ensureWorkspaceShell(repoId);
  // No persisted "last active workspace" survives a restart in this app (see above) — falling
  // forward onto the first restored repo, when there is one, means a relaunch with open repositories
  // lands on one of their own tabs rather than the empty GitStart screen every time.
  if (workspaceStore.active === GENERAL_WORKSPACE && workspaceStore.openRepos.length > 0) {
    workspaceStore.activateWorkspace(workspaceStore.openRepos[0] as string);
  }

  const app = createApp(App);
  app.use(pinia);
  app.use(VueQueryPlugin, { queryClient });
  app.mount('#app');
}

// F2: mountShell's own essential hydrates (layout/settings/codeRepos/tabs) can still reject — a DB
// error, or a busy DB past the 5s _busy_timeout (F7's second-instance case makes this plausible).
// P113 F6: the catch-and-retry wrapper itself moved to workbench/bootstrapShell.ts, shared with
// kira-studio's own identical copy.
void bootstrapShell(mountShell, 'Kira Space');
