import { VueQueryPlugin } from '@tanstack/vue-query';
import { bootstrapShell } from '@workbench/bootstrapShell';
import { queryClient } from '@workbench/state/queryClient';
import { windowKey } from '@workbench/util/window';
import { createApp } from 'vue';
import App from './App.vue';
import { installAdeSignals } from './ade/queries';
import { useAgentSessionsStore } from './ade/state/agentSessions';
import { reviewTargetKey } from './ade/v2/queries';
import { useAdeReviewWindowStore } from './ade/v2/state/adeReviewWindow';
import { control } from './bridge/control';
import { useAppMetricsStore } from './state/appMetrics';
import { useAppUpdateStore } from './state/appUpdate';
import { useCodeReposStore } from './state/coderepos';
import { useGitClientsStore } from './state/gitClients';
import { useGitCredentialStore } from './state/gitCredential';
import { useKeepAwakeStore } from './state/keepAwake';
import { useLayoutStore } from './state/layout';
import { useModeStore } from './state/mode';
import { useOpsStore } from './state/ops';
import { pinia } from './state/pinia';
import { ensureWorkspaceShell } from './state/repoTabs';
import { useSettingsStore } from './state/settings';
import { useTabsStore } from './state/tabs';
import { useTerminalsStore } from './state/terminals';
import { GENERAL_WORKSPACE, useWorkspaceStore } from './state/workspace';
// P131 Part 1 §3.2: styles.css re-exports @workbench/workbench.css (itself @theme/base.css, P104)
// and adds one more @source over packages/git-ui/src, so this app's own unprefixed root scans
// git-ui's migrated shadcn call sites too. Importing both here would compile base.css as two
// separate Tailwind roots and double its output — this is the one entry point now.
import './styles.css';

// P100 Part 2: Kira Studio's own main.ts bootstrap, trimmed to this app's own state layer — no
// __KIRA_DEBUG_HOOKS__ block (that whole retention-probe apparatus is data-grid/query-result
// specific: grid/documents/keyvalue/stream/console page stores, none of which exist here) and no
// ops/dbMcp/customScripts stores (none of those subsystems exist in this app — apps/kira-space/
// main.go's own Services list has no counterpart for any of them). P127: Studio's own
// agentHooks/agentSessions stores left too (agent-activity monitoring moved to a shared home, used
// by no app as of this phase), so that gap has since closed on its own.
// P116 G5/G7 add appMetrics/keepAwake back — this app now has its own metrics ticker and
// keep-awake toggle (main.go's own metrics.NewAppTicker/keepawake.New). P119 adds appUpdate back
// too — this app now has its own update checker/installer.
async function mountShell(): Promise<void> {
  // Every store used here runs before app.use(pinia) below, so each needs the module-level
  // `pinia` instance passed explicitly (Pinia has no active instance yet at this point).
  const agentSessionsStore = useAgentSessionsStore(pinia);
  const opsStore = useOpsStore(pinia);
  const appMetricsStore = useAppMetricsStore(pinia);
  const keepAwakeStore = useKeepAwakeStore(pinia);
  const layoutStore = useLayoutStore(pinia);
  const modeStore = useModeStore(pinia);
  const settingsStore = useSettingsStore(pinia);
  const codeReposStore = useCodeReposStore(pinia);
  const gitClientsStore = useGitClientsStore(pinia);
  const gitCredentialStore = useGitCredentialStore(pinia);
  const tabsStore = useTabsStore(pinia);
  const terminalsStore = useTerminalsStore(pinia);
  const workspaceStore = useWorkspaceStore(pinia);
  const reviewWindowStore = useAdeReviewWindowStore(pinia);

  // P129 Part 3 §2.8 item 2: right after the stores are built, before mount() below, so no push
  // (`kira:adetask:*` channels/agent `Stop`) is missed between mount
  // and this window's first `useAdeSnapshot`/`useAdeSessions` call. No teardown — the window is the
  // lifetime (queries.ts's own doc comment).
  installAdeSignals(queryClient, agentSessionsStore);

  // Kira Studio's own initAppMetrics precedent: just subscribes, no data dependency — runs
  // synchronously before the Promise.all below rather than joining it.
  appMetricsStore.initAppMetrics();

  // P128 §2.2/§2.6: this app now persists a per-window module mode too (internal/windowsvc,
  // shared with Kira Studio since this phase) — hydrated before any other window-scoped state,
  // mirroring Kira Studio's own main.ts:338. The fall-forward onto the first restored repo below
  // still runs regardless of which mode this resolves to (state/workspace.ts's own
  // `openRepoWorkspace`/`activateWorkspace` doc comment: that fall-forward must honour a persisted
  // `terminal`/`ade` mode, not silently override it back to `git`).
  modeStore.hydrateMode(await control.windowsEnsure());

  await Promise.all([
    layoutStore.hydrateLayout(),
    settingsStore.hydrateSettings(),
    codeReposStore.hydrateCodeRepos(),
    tabsStore.hydrateTabs(),
  ]);

  // P116 G5: keep-awake hydrate joins the optional group below, not this critical Promise.all — a
  // stuck/erroring OS power-assertion call must never block this app's own boot the way it's
  // allowed to gate Kira Studio's (that app's own main.ts keeps it in the critical group).

  // F2: gitClients (Connected editors/pairing) and terminals (new-terminal defaults) are not on
  // the critical path to a rendered shell — Promise.allSettled so one of these hitting a DB error
  // never takes down the whole window the way it did bundled into the Promise.all above.
  const optional = await Promise.allSettled([
    gitClientsStore.hydrateGitClients(),
    gitCredentialStore.hydrateRelayPrompts(),
    terminalsStore.hydrateTerminalDefaults(),
    keepAwakeStore.initKeepAwake(),
    // P129 Part 3 §2.8 item 1: the boot-time hydrate for the ade module's own agent-activity store
    // (repo tabs' needs-input badge, §0.15) — a stuck/erroring subscribe must never block the rest
    // of this app's own boot, same reasoning as every other member of this group.
    agentSessionsStore.initAgentSessions(),
    // P132 Part 2: the op log dock's snapshot. A failed hydrate still goes live (createOpLogStore).
    opsStore.hydrateOps(),
  ]);
  for (const result of optional) {
    if (result.status === 'rejected') {
      console.error('bootstrap: optional store hydrate failed', result.reason);
    }
  }

  // A review window (ephemeral, one branch) answers with its target; any other window gets null.
  const reviewTarget = await queryClient.fetchQuery({
    queryKey: reviewTargetKey(windowKey),
    queryFn: () => control.adeTaskReviewWindowTarget({ windowKey }),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (reviewTarget) {
    reviewWindowStore.target = reviewTarget;
    workspaceStore.openReviewWorkspace(reviewTarget.codeRepoId);
  }

  // C5 §6.1: hydrateTabs (state/tabs.ts) already derived workspaceStore.openRepos from the
  // restored tabs themselves — ensureWorkspaceShell's own doc comment calls for running it once per
  // restored repo right here, after hydrateTabs, since hydrateTabs itself never calls back into it
  // (avoiding a third link in that module pair's existing two-way call graph).
  if (!reviewTarget) for (const repoId of workspaceStore.openRepos) ensureWorkspaceShell(repoId);
  // No persisted "last active repo" survives a restart in this app (unlike the per-window mode
  // hydrated above) — falling forward onto the first restored repo, when there is one, means a
  // relaunch with open repositories lands on one of their own tabs rather than the empty GitStart
  // screen every time. `activateWorkspace` never forces the mode back to `git` (its own doc
  // comment, state/workspace.ts), so this still honours whatever mode `windowsEnsure` restored
  // above — a relaunch into `terminal`/`ade` stays there even with repositories open behind it.
  if (
    !reviewTarget &&
    workspaceStore.active === GENERAL_WORKSPACE &&
    workspaceStore.openRepos.length > 0
  ) {
    workspaceStore.activateWorkspace(workspaceStore.openRepos[0] as string);
  }

  const app = createApp(App);
  app.use(pinia);
  app.use(VueQueryPlugin, { queryClient });
  app.mount('#app');
  // Off the boot critical path — Kira Studio's own main.ts precedent (an update check gains
  // nothing from blocking first paint, and Go's own cache floor decides what actually fetches).
  useAppUpdateStore().initAppUpdate();
}

// F2: mountShell's own essential hydrates (layout/settings/codeRepos/tabs) can still reject — a DB
// error, or a busy DB past the 5s _busy_timeout (F7's second-instance case makes this plausible).
// P113 F6: the catch-and-retry wrapper itself moved to workbench/bootstrapShell.ts, shared with
// kira-studio's own identical copy.
void bootstrapShell(mountShell, 'Kira Space');
