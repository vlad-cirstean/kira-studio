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
// apps/kira-space/main.go's 12 services). See @workbench/testing/ui/mockRuntime's own header for
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
// app's own boot sequence (this app has no windowsEnsure/WindowsService at all, so unlike Studio's
// copy there is no inferredBootMode special case here).
const WILDCARD_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  [IPC.tabsSave]: 'null',
  [IPC.layoutSet]: JSON.stringify(defaultLayout),
  [IPC.settingsSet]: JSON.stringify(defaultSettings),
  [IPC.gitClientsList]: '[]',
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
  return sharedInstallControlMocks(page, snapshots, {
    fqnToChannel: FQN_TO_CHANNEL,
    wildcardDefaults: WILDCARD_DEFAULTS,
    runtimeJsPath: WAILS_RUNTIME_JS,
    canonicalOptions: CANONICAL_OPTIONS,
  });
}

export const emitWailsEvent = sharedEmitWailsEvent;
