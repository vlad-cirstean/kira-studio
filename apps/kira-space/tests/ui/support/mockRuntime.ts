import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { defaultLayout } from '@shared/domain/layout';
import {
  buildChannelMaps,
  type ControlMockHandle,
  resolveWailsRuntimeJsPath,
  emitWailsEvent as sharedEmitWailsEvent,
  installControlMocks as sharedInstallControlMocks,
} from '@workbench/testing/ui/mockRuntime';
import { defaultSettings } from '../../../frontend/src/state/settingsDomain';
import { IPC } from './ipcChannels';
import type { ControlSnapshot } from './types';

export type { ControlLogEntry, ControlMockHandle } from '@workbench/testing/ui/mockRuntime';

// The real Wails runtime, served under /wails/ — Kira Studio's own tests/ui/support/mockRuntime.ts,
// ported and trimmed to this app's own bound surface (bridge/index.ts's `control` object,
// apps/kira-space/main.go's 13 services). See @workbench/testing/ui/mockRuntime's own header for
// why this is the real runtime.js bundle, not a hand-rolled stand-in, and why `go list` resolves
// its path rather than a hand-written GOPATH-shaped one.
const WAILS_RUNTIME_JS = resolveWailsRuntimeJsPath(resolve(__dirname, '../../../'));

const BRIDGE_PKG = 'github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge';

// One line per request/response channel — the FQN half of each pair, read off the generated
// bindings themselves (`grep -rhoE '\$Call\.ByName\("[^"]+"' apps/kira-space/frontend/bindings/…/bridge/*.js`),
// not retyped from memory — the same discipline Kira Studio's own copy of this table follows.
const FQN_SUFFIX_BY_IPC_KEY: Record<string, string> = {
  githubOpenPullRequestUrl: 'GitHubService.OpenPullRequestURL',
  linkOpenExternal: 'LinkService.OpenExternal',
  settingsGetAll: 'SettingsService.GetAll',
  settingsSet: 'SettingsService.Set',
  layoutGetAll: 'LayoutService.GetAll',
  layoutSet: 'LayoutService.Set',
  appFlushed: 'LifecycleService.Flushed',
  windowFlushed: 'LifecycleService.WindowFlushed',
  filesChooseFolder: 'FilesService.ChooseFolder',
  gitClientsList: 'GitClientsService.List',
  gitClientsRevoke: 'GitClientsService.Revoke',
  gitPairingPending: 'GitClientsService.PendingPairing',
  gitPairingApprove: 'GitClientsService.Approve',
  gitPairingDeny: 'GitClientsService.Deny',
  gitVsixStatus: 'GitClientsService.VsixStatus',
  gitVsixInstall: 'GitClientsService.InstallVsCodeIntegration',
  tabsList: 'TabsService.List',
  tabsSave: 'TabsService.Save',
  codeWorkspaceListRepos: 'CodeWorkspaceService.ListRepos',
  codeWorkspaceRepoHeads: 'CodeWorkspaceService.RepoHeads',
  codeWorkspaceRepoWorktreeLinks: 'CodeWorkspaceService.RepoWorktreeLinks',
  codeWorkspaceImportRepo: 'CodeWorkspaceService.ImportRepo',
  codeWorkspaceRenameRepo: 'CodeWorkspaceService.RenameRepo',
  codeWorkspaceRemoveRepo: 'CodeWorkspaceService.RemoveRepo',
  codeWorkspaceReorderRepos: 'CodeWorkspaceService.ReorderRepos',
  codeWorkspaceListFiles: 'CodeWorkspaceService.ListFiles',
  codeWorkspaceReadFile: 'CodeWorkspaceService.ReadFile',
  codeWorkspaceOpenWorkspace: 'CodeWorkspaceService.OpenWorkspace',
  codeWorkspaceCloseWorkspace: 'CodeWorkspaceService.CloseWorkspace',
  codeWorkspaceReadDiff: 'CodeWorkspaceService.ReadDiff',
  codeWorkspaceStartSearch: 'CodeWorkspaceService.StartSearch',
  codeWorkspaceCancelSearch: 'CodeWorkspaceService.CancelSearch',
  terminalDefaultCwd: 'TerminalService.DefaultCwd',
  terminalOpen: 'TerminalService.Open',
  terminalWrite: 'TerminalService.Write',
  terminalResize: 'TerminalService.Resize',
  terminalClose: 'TerminalService.Close',

  // P116 G5/G6: the two new bound methods window-chrome parity adds.
  windowsOpenNew: 'WindowsService.OpenNew',
  keepAwakeStatus: 'KeepAwakeService.Status',
  keepAwakeSetManual: 'KeepAwakeService.SetManual',

  // P128 §2.2/§2.6: this app now persists a per-window module mode too, via the same shared
  // internal/windowsvc.Service Kira Studio's own WindowsService embeds.
  windowsEnsure: 'WindowsService.Ensure',
  windowsSetMode: 'WindowsService.SetMode',

  // P132 Part 2: the operations dock's own two bound calls.
  opsRecent: 'OpsService.Recent',
  opsCancel: 'OpsService.Cancel',

  // P119: the in-app update dialog's three bound calls.
  updateStatus: 'UpdateService.Status',
  updateInstall: 'UpdateService.InstallUpdate',
  updateCancelInstall: 'UpdateService.CancelInstall',

  // P129 Part 3 §2.2/§3.3: the ade module's own 6 bound calls (of AdeService's 19 methods).
  terminalAgentSessions: 'AdeService.AgentSessions',
  adeSessions: 'AdeService.Sessions',
  adeRepoSnapshot: 'AdeService.RepoSnapshot',
  adeRepoPrs: 'AdeService.RepoPrs',
  adeRefresh: 'AdeService.Refresh',
  adeProvideCredential: 'AdeService.ProvideCredential',

  // P129 Part 4 §3.4: the dialog's own six delivery/archive bound calls.
  adePrepareLaunch: 'AdeService.PrepareLaunch',
  adeSend: 'AdeService.Send',
  adeArchiveRisk: 'AdeService.ArchiveRisk',
  adeArchive: 'AdeService.Archive',
  adeSetQueuedAfter: 'AdeService.SetQueuedAfter',
  adeUpdateNewWork: 'AdeService.UpdateNewWork',

  // P129 Part 5 §3.4: SetPlan/ForcePush plus the Add popover's three bound calls.
  adeSetPlan: 'AdeService.SetPlan',
  adeForcePush: 'AdeService.ForcePush',
  adeCandidateBranches: 'AdeService.CandidateBranches',
  adeAddBranch: 'AdeService.AddBranch',
  adeAddNewWork: 'AdeService.AddNewWork',

  // P129 Part 6 §3.4: the detail panel's own two remaining bound calls.
  adeSetBranchMeta: 'AdeService.SetBranchMeta',
  adeBindNewWork: 'AdeService.BindNewWork',
  adeSetWorkType: 'AdeService.SetWorkType',

  // P135 §4.5: the four dependency-node bound calls (creation tab, detail panel, blocker linking).
  adeAddDependency: 'AdeService.AddDependency',
  adeUpdateDependency: 'AdeService.UpdateDependency',
  adeResolveDependency: 'AdeService.ResolveDependency',
  adeSetBlocker: 'AdeService.SetBlocker',

  // P129 Part 7 §0.9: cross-window Open's own bound call — `kira:ade:open-session` (the emit half)
  // is a push channel, not a bound call, so it needs no FQN entry here (only `emitWailsEvent`).
  adeFocusSession: 'AdeService.FocusSession',
};

export const { channelToFqn: CHANNEL_TO_FQN, fqnToChannel: FQN_TO_CHANNEL } = buildChannelMaps(
  IPC,
  FQN_SUFFIX_BY_IPC_KEY,
  BRIDGE_PKG,
);

// A call this mock never expects a fixture to cover, answered the same way regardless of a
// spec's own args — pre-serialised JSON, keyed by channel; used only when a channel has *no*
// fixture-supplied snapshot at all (a spec that provides its own still wins). Every member here is
// one of main.ts's own unconditional-every-boot Promise.all calls (bootstrap()'s own doc comment)
// no committed fixture will ever snapshot, or a fire-and-forget call no spec asserts on the echo
// of — the same reasoning Kira Studio's own WILDCARD_DEFAULTS carries per entry, trimmed to this
// app's own boot sequence. P128 §2.2/§2.6: `windowsEnsure` joins this table with a static `'git'`
// answer, unlike Kira Studio's own copy — this app has no existing spec whose boot mode needs
// inferring from an already-provided fixture (Studio's own inferredBootMode helper exists only
// because some of its specs restore an Api-mode tab as active); every Space spec boots into `git`
// today, and a spec that wants `terminal`/`ade` instead (modules.spec.ts) provides its own
// `windowsEnsure` snapshot, which always wins over this default.
const WILDCARD_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  [IPC.tabsSave]: 'null',
  [IPC.windowsEnsure]: JSON.stringify({ mode: 'git' }),
  [IPC.windowsSetMode]: 'null',
  [IPC.layoutSet]: JSON.stringify(defaultLayout),
  [IPC.settingsSet]: JSON.stringify(defaultSettings),
  [IPC.gitClientsList]: '[]',
  // P132 Part 2: main.ts's bootstrap() hydrates the op log on every boot.
  [IPC.opsRecent]: '[]',
  [IPC.opsCancel]: 'null',
  [IPC.gitPairingPending]: JSON.stringify({ pending: null, queued: 0 }),
  [IPC.gitVsixStatus]: JSON.stringify({
    bundled: false,
    vsixPath: '',
    codeAvailable: false,
    probed: [],
    command: '',
  }),
  [IPC.codeWorkspaceListRepos]: '[]',
  [IPC.codeWorkspaceRepoHeads]: '[]',
  [IPC.codeWorkspaceRepoWorktreeLinks]: '[]',
  [IPC.terminalDefaultCwd]: JSON.stringify({ path: '/home/test' }),
  [IPC.codeWorkspaceOpenWorkspace]: 'null',
  [IPC.codeWorkspaceCloseWorkspace]: 'null',
  [IPC.codeWorkspaceCancelSearch]: 'null',
  // P116 G5: main.ts's bootstrap() joins keepAwakeStore.initKeepAwake() into the optional
  // Promise.allSettled group, same reasoning as the rest of this table's every-boot calls. The
  // plan (docs/v1.9/plans/P116-window-chrome-parity.md §2) names `supported: false` here, but this
  // deliberately follows Kira Studio's own WILDCARD_DEFAULTS value instead (`supported: true`) —
  // Studio's own comment explains why: the UI suite runs against a static server, not a real Go
  // build, and a spec that never cares about keep-awake should still see the titlebar button it
  // will ship with. A spec that DOES care (window-chrome.spec.ts's own keep-awake cases) still wins
  // with its own snapshot.
  [IPC.keepAwakeStatus]: JSON.stringify({ manual: false, supported: true, error: '' }),
  // P119: no update available by default — same shape as Kira Studio's own WILDCARD_DEFAULTS
  // entry, so every other existing Space spec keeps booting unchanged.
  [IPC.updateStatus]: JSON.stringify({
    updateAvailable: false,
    currentVersion: '0.0.0-dev',
    latestVersion: '',
    installLogPath: '',
  }),
  // P129 Part 3 §3.3: every boot now calls AdeService.AgentSessions (createAgentSessionsStore's own
  // initAgentSessions) and, once `ade` is the active mode, AdeService.Sessions too — same
  // "no committed fixture will ever snapshot this" reasoning as the rest of this table. A spec that
  // cares (ade-module.spec.ts) still wins with its own snapshot.
  [IPC.terminalAgentSessions]: JSON.stringify({ sessions: [] }),
  [IPC.adeSessions]: JSON.stringify({ sessions: [] }),
});

// `windowKey`/`tabId` are excluded outright — a per-window or per-tab id this app generates at
// runtime, never reproducible from a fixture.
const CANONICAL_OPTIONS = { excludeKeys: ['windowKey', 'tabId', 'terminalId'] };

/**
 * Replaces the control channel's answers at the network layer — `page.route` intercepts every
 * request under `/wails/`: the real runtime bundle itself and the one RPC endpoint bound calls
 * POST to. The mocked HTTP response is exactly what `unwrap`/`trust` in `bridge/rpc.ts` are written
 * to consume, so a frontend spec still exercises that code for real.
 */
export async function installControlMocks(
  page: Page,
  snapshots: readonly ControlSnapshot[],
): Promise<ControlMockHandle> {
  const handle = await sharedInstallControlMocks(page, snapshots, {
    fqnToChannel: FQN_TO_CHANNEL,
    wildcardDefaults: WILDCARD_DEFAULTS,
    runtimeJsPath: WAILS_RUNTIME_JS,
    canonicalOptions: CANONICAL_OPTIONS,
  });
  emulateAdeRepoPush(page);
  return handle;
}

// Go's queue writes each emit `kira:ade:repo` (Queue.notifyChanged) and the renderer refetches off
// that push alone, so the mock repeats it after every successful write.
const ADE_PUSHING_WRITES = new Set<string>([
  IPC.adeAddBranch,
  IPC.adeAddNewWork,
  IPC.adeUpdateNewWork,
  IPC.adeSetBranchMeta,
  IPC.adeSetWorkType,
  IPC.adeSetPlan,
  IPC.adeSetQueuedAfter,
  IPC.adeAddDependency,
  IPC.adeUpdateDependency,
  IPC.adeResolveDependency,
  IPC.adeSetBlocker,
  IPC.adeArchive,
  IPC.adeForcePush,
  IPC.adeRefresh,
]);

function emulateAdeRepoPush(page: Page): void {
  page.on('requestfinished', async (request) => {
    if (request.method() !== 'POST' || !request.url().includes('/wails/')) return;
    try {
      const body = JSON.parse(request.postData() ?? '{}') as {
        args?: { methodName?: string; args?: { codeRepoId?: string }[] };
      };
      const channel = FQN_TO_CHANNEL[body.args?.methodName ?? ''];
      const codeRepoId = body.args?.args?.[0]?.codeRepoId;
      if (!channel || !ADE_PUSHING_WRITES.has(channel) || !codeRepoId) return;
      const response = await request.response();
      if (!response?.ok()) return;
      // A Refresh git failure resolves with `.error` and pushes nothing.
      if (channel === IPC.adeRefresh && (await response.text()).includes('"error":{')) return;
      await emitWailsEvent(page, IPC.adeRepo, { codeRepoId });
    } catch {
      // page closed mid-request
    }
  });
}

export const emitWailsEvent = sharedEmitWailsEvent;
