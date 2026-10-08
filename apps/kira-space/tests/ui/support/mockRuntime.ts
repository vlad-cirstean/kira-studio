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
  mobileStatusGet: 'MobileAccessService.Status',
  mobileSetEnabled: 'MobileAccessService.SetEnabled',
  mobileSetPorts: 'MobileAccessService.SetPorts',
  mobileSetAgentInput: 'MobileAccessService.SetAgentInputEnabled',
  mobileSetDevicePermissions: 'MobileAccessService.SetDevicePermissions',
  mobileResetCertificate: 'MobileAccessService.ResetCertificate',
  mobileDevicesList: 'MobileAccessService.Devices',
  mobileRevoke: 'MobileAccessService.Revoke',
  mobileTerminalHolds: 'MobileAccessService.TerminalHolds',
  mobileReclaimTerminal: 'MobileAccessService.ReclaimTerminal',
  mobileLaunchOpened: 'MobileAccessService.LaunchOpened',
  mobilePairingPending: 'MobileAccessService.PendingPairing',
  mobilePairingApprove: 'MobileAccessService.Approve',
  mobilePairingDeny: 'MobileAccessService.Deny',
  gitCredentialPending: 'GitCredentialService.Pending',
  gitCredentialProvide: 'GitCredentialService.Provide',
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
  customScriptsList: 'CustomScriptsService.List',
  customScriptsCreate: 'CustomScriptsService.Create',
  customScriptsUpdate: 'CustomScriptsService.Update',
  customScriptsRemove: 'CustomScriptsService.Remove',
  customScriptsCreateCollection: 'CustomScriptsService.CreateCollection',
  customScriptsRenameCollection: 'CustomScriptsService.RenameCollection',
  customScriptsDeleteCollection: 'CustomScriptsService.DeleteCollection',
  customScriptsMove: 'CustomScriptsService.Move',
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

  // Boot: the ade module's agent-session hydration.
  terminalAgentSessions: 'TerminalService.AgentSessions',

  // P145: the ade v2 board surface (AdeTaskService, bridge/index.ts `adeTask*`).
  adeTaskBoard: 'AdeTaskService.Board',
  adeTaskPrs: 'AdeTaskService.Prs',
  adeTaskRefresh: 'AdeTaskService.Refresh',
  adeTaskForcePush: 'AdeTaskService.ForcePush',
  adeTaskCreateTask: 'AdeTaskService.CreateTask',
  adeTaskCandidateBranches: 'AdeTaskService.CandidateBranches',
  adeTaskAddExistingBranch: 'AdeTaskService.AddExistingBranch',
  adeTaskUpdateTask: 'AdeTaskService.UpdateTask',
  adeTaskAddTaskRepo: 'AdeTaskService.AddTaskRepo',
  adeTaskSetPlan: 'AdeTaskService.SetPlan',
  adeTaskBacklog: 'AdeTaskService.Backlog',
  adeTaskUpdateBacklogItem: 'AdeTaskService.UpdateBacklogItem',
  adeTaskMoveBacklogItem: 'AdeTaskService.MoveBacklogItem',
  adeTaskDeleteBacklogItem: 'AdeTaskService.DeleteBacklogItem',
  adeTaskPromoteBacklogItem: 'AdeTaskService.PromoteBacklogItem',
  adeTaskAddBacklogItem: 'AdeTaskService.AddBacklogItem',
  adeTaskWorkflows: 'AdeTaskService.Workflows',
  adeTaskRepos: 'AdeTaskService.Repos',
  adeTaskWorkflowYaml: 'AdeTaskService.WorkflowYaml',
  adeTaskValidateWorkflowYaml: 'AdeTaskService.ValidateWorkflowYaml',
  adeTaskSaveWorkflow: 'AdeTaskService.SaveWorkflow',
  adeTaskSaveWorkflowYaml: 'AdeTaskService.SaveWorkflowYaml',
  adeTaskImportWorkflow: 'AdeTaskService.ImportWorkflow',
  adeTaskNewWorkflow: 'AdeTaskService.NewWorkflow',
  adeTaskUpdateRepo: 'AdeTaskService.UpdateRepo',
  adeTaskAddFolder: 'AdeTaskService.AddFolder',
  adeTaskSetFolderWatch: 'AdeTaskService.SetFolderWatch',
  adeTaskRemoveFolder: 'AdeTaskService.RemoveFolder',
  adeTaskStartRun: 'AdeTaskService.StartRun',
  adeTaskSetTaskWorkflow: 'AdeTaskService.SetTaskWorkflow',
  adeTaskApprove: 'AdeTaskService.Approve',
  adeTaskRetryRun: 'AdeTaskService.RetryRun',
  adeTaskStageDone: 'AdeTaskService.StageDone',
  adeTaskSetTaskStage: 'AdeTaskService.SetTaskStage',
  adeTaskRetrySetup: 'AdeTaskService.RetrySetup',
  adeTaskReadLog: 'AdeTaskService.ReadLog',
  adeTaskSessions: 'AdeTaskService.Sessions',
  adeTaskStopRun: 'AdeTaskService.StopRun',
  adeTaskTakeOver: 'AdeTaskService.TakeOver',
  adeTaskLaunchStage: 'AdeTaskService.LaunchStage',
  adeTaskStartBranch: 'AdeTaskService.StartBranch',
  adeTaskSend: 'AdeTaskService.Send',
  adeTaskFocusSession: 'AdeTaskService.FocusSession',
  adeTaskOpenReviewWindow: 'AdeTaskService.OpenReviewWindow',
  adeTaskReviewWindowTarget: 'AdeTaskService.ReviewWindowTarget',
  adeTaskReviewAgent: 'AdeTaskService.ReviewAgent',
  adeTaskLaunchReviewAgent: 'AdeTaskService.LaunchReviewAgent',
  adeTaskGitHubSyncPlan: 'AdeTaskService.GitHubSyncPlan',
  adeTaskGitHubSyncApply: 'AdeTaskService.GitHubSyncApply',
  adeTaskArchiveRisk: 'AdeTaskService.ArchiveRisk',
  adeTaskArchiveTask: 'AdeTaskService.ArchiveTask',
  adeTaskRecordMerge: 'AdeTaskService.RecordMerge',
  adeTaskSetQueuedAfter: 'AdeTaskService.SetQueuedAfter',

  memorySearch: 'MemoryService.Search',
  memoryRecent: 'MemoryService.Recent',
  memoryHistory: 'MemoryService.History',
  memoryStore: 'MemoryService.Store',
  memoryMcpStatus: 'MemoryService.McpStatus',
  memoryMcpInstall: 'MemoryService.InstallClaudeCode',
  memorySemanticStatus: 'MemoryService.SemanticStatus',
  memorySemanticInstall: 'MemoryService.InstallSemanticModel',
  memorySemanticRetry: 'MemoryService.RetrySemantic',
  dictationStatus: 'DictationService.Status',
  dictationInstall: 'DictationService.InstallModel',
  dictationRetry: 'DictationService.Retry',
  memoryImportChoose: 'MemoryImportService.Choose',
  memoryImportCreate: 'MemoryImportService.Create',
  memoryImportJobs: 'MemoryImportService.Jobs',
  memoryImportJob: 'MemoryImportService.Job',
  memoryImportStart: 'MemoryImportService.Start',
  memoryImportPause: 'MemoryImportService.Pause',
  memoryImportResume: 'MemoryImportService.Resume',
  memoryImportCancel: 'MemoryImportService.Cancel',
  memoryImportDiscard: 'MemoryImportService.Discard',
  memoryImportDismiss: 'MemoryImportService.Dismiss',
  memoryImportRetryFailed: 'MemoryImportService.RetryFailed',
  memoryImportRetryFile: 'MemoryImportService.RetryFile',
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
  [IPC.mobileStatusGet]: JSON.stringify({
    enabled: false,
    running: false,
    httpsPort: 7790,
    setupPort: 7791,
    appUrls: [],
    setupUrls: [],
    fingerprint: '',
    leafExpiresAt: 0,
    agentInput: false,
    error: '',
  }),
  [IPC.mobileDevicesList]: '[]',
  [IPC.mobileTerminalHolds]: '[]',
  [IPC.mobilePairingPending]: JSON.stringify({ pending: null, queued: 0 }),
  [IPC.gitCredentialPending]: '[]',
  [IPC.gitCredentialProvide]: 'false',
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
  // Every boot calls TerminalService.AgentSessions (createAgentSessionsStore's own initAgentSessions);
  // no committed fixture will ever snapshot it.
  [IPC.terminalAgentSessions]: JSON.stringify({ sessions: [] }),
  // main.ts asks every window whether it is a review window; none of the specs' windows is one.
  [IPC.adeTaskReviewWindowTarget]: 'null',
  // P201 Part 2: the Memory module lists recent memories as soon as its mode opens.
  [IPC.memoryRecent]: '[]',
  // P211: no imports by default.
  [IPC.memoryImportJobs]: '[]',
  // P216: no speech engine by default, so the mic button stays hidden.
  [IPC.dictationStatus]: JSON.stringify({ state: 'off', message: '', done: 0, total: 0 }),
  // P210: no embedder by default, so the semantic row stays hidden.
  [IPC.memorySemanticStatus]: JSON.stringify({
    state: 'off',
    message: '',
    model: '',
    done: 0,
    total: 0,
  }),
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
  emulateAdeTaskPush(page);
  return handle;
}

// Every ade write emits its `kira:adetask:*` push and the renderer refetches off that push alone,
// so the mock repeats the push after every successful write (the refetch answers the same static
// snapshot the spec supplied). Move is left out: its optimistic order is the final state.
const ADE_TASK_PUSHES: Readonly<Record<string, readonly string[]>> = {
  [IPC.adeTaskSetPlan]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskCreateTask]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskAddExistingBranch]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskForcePush]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskRefresh]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskUpdateTask]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskAddTaskRepo]: [IPC.adeTaskBoardChanged, IPC.adeTaskReposChanged],
  [IPC.adeTaskAddBacklogItem]: [IPC.adeTaskBacklogChanged],
  [IPC.adeTaskUpdateBacklogItem]: [IPC.adeTaskBacklogChanged],
  [IPC.adeTaskDeleteBacklogItem]: [IPC.adeTaskBacklogChanged],
  [IPC.adeTaskPromoteBacklogItem]: [IPC.adeTaskBacklogChanged, IPC.adeTaskBoardChanged],
  [IPC.adeTaskSetTaskWorkflow]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskStartRun]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskApprove]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskRetryRun]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskStageDone]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskSetTaskStage]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskRetrySetup]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskStopRun]: [IPC.adeTaskSessionsChanged],
  [IPC.adeTaskTakeOver]: [IPC.adeTaskSessionsChanged],
  [IPC.adeTaskLaunchStage]: [IPC.adeTaskSessionsChanged],
  [IPC.adeTaskStartBranch]: [IPC.adeTaskSessionsChanged],
  [IPC.adeTaskArchiveTask]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskRecordMerge]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskSetQueuedAfter]: [IPC.adeTaskBoardChanged],
  [IPC.adeTaskSaveWorkflow]: [IPC.adeTaskWorkflowsChanged],
  [IPC.adeTaskSaveWorkflowYaml]: [IPC.adeTaskWorkflowsChanged],
  [IPC.adeTaskImportWorkflow]: [IPC.adeTaskWorkflowsChanged],
  [IPC.adeTaskNewWorkflow]: [IPC.adeTaskWorkflowsChanged],
  [IPC.adeTaskUpdateRepo]: [IPC.adeTaskReposChanged],
  [IPC.adeTaskAddFolder]: [IPC.adeTaskReposChanged],
  [IPC.adeTaskSetFolderWatch]: [IPC.adeTaskReposChanged],
  [IPC.adeTaskRemoveFolder]: [IPC.adeTaskReposChanged],
};

function emulateAdeTaskPush(page: Page): void {
  page.on('requestfinished', async (request) => {
    if (request.method() !== 'POST' || !request.url().includes('/wails/')) return;
    try {
      const body = JSON.parse(request.postData() ?? '{}') as { args?: { methodName?: string } };
      const channel = FQN_TO_CHANNEL[body.args?.methodName ?? ''];
      const pushes = channel ? ADE_TASK_PUSHES[channel] : undefined;
      if (!pushes) return;
      const response = await request.response();
      if (!response?.ok()) return;
      for (const push of pushes) await emitWailsEvent(page, push, null);
    } catch {
      // page closed mid-request
    }
  });
}

export const emitWailsEvent = sharedEmitWailsEvent;
