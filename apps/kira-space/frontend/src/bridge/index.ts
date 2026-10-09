import * as AdeTaskService from '@bindings/adetaskservice.js';
import * as AgentNotifyService from '@bindings/agentnotifyservice.js';
import * as ClaudeUsageService from '@bindings/claudeusageservice.js';
import * as CodeWorkspaceService from '@bindings/codeworkspaceservice.js';
import * as CustomScriptsService from '@bindings/customscriptsservice.js';
import * as FilesService from '@bindings/filesservice.js';
import * as GitClientsService from '@bindings/gitclientsservice.js';
import * as GitCredentialService from '@bindings/gitcredentialservice.js';
import * as GitHubService from '@bindings/githubservice.js';
import * as KeepAwakeService from '@bindings/keepawakeservice.js';
import * as LayoutService from '@bindings/layoutservice.js';
import * as LifecycleService from '@bindings/lifecycleservice.js';
import * as LinkService from '@bindings/linkservice.js';
import * as MobileAccessService from '@bindings/mobileaccessservice.js';
import * as OpsService from '@bindings/opsservice.js';
import * as ScriptRunsService from '@bindings/scriptrunsservice.js';
import * as SettingsService from '@bindings/settingsservice.js';
import * as TabsService from '@bindings/tabsservice.js';
import * as TerminalService from '@bindings/terminalservice.js';
import * as UpdateService from '@bindings/updateservice.js';
import * as WindowsService from '@bindings/windowsservice.js';
import type { HeadState } from '@kira/git-ipc';
import type { AgentEvent, AgentSessionsEvent } from '@shared/domain/agent';
import type { PaletteColor } from '@shared/domain/color';
import type {
  GitClient,
  GitCredentialPrompt,
  GitPairingActionResult,
  GitPairingSnapshot,
  GitVsixInstallResult,
  GitVsixStatus,
} from '@shared/domain/git';
import type { Layout } from '@shared/domain/layout';
import type {
  MobileDevice,
  MobilePairingActionResult,
  MobilePairingSnapshot,
  MobileStatus,
  MobileTerminalHold,
} from '@shared/domain/mobile';
import type {
  CodeSearchEvent,
  DiffContent,
  FileContent,
  FileListing,
  RepoSummary,
  SearchRequest,
} from '@shared/domain/repo';
import type {
  ScriptRun,
  ScriptRunArgs,
  ScriptRunLogChunk,
  ScriptRunLogPage,
  ScriptRunPreview,
  ScriptRunStarted,
} from '@shared/domain/scriptRuns';
import type {
  CustomScript,
  CustomScriptFields,
  ScriptCollection,
  ScriptDir,
  ScriptMcpServer,
  ScriptMcpTool,
  ScriptsSnapshot,
} from '@shared/domain/scripts';
import { CHANNEL } from '@shared/protocol/events';
import { scriptsSnapshotOf } from '@workbench/automations/createCustomScriptsStore';
import { createCoreControl } from '@workbench/bridge/createCoreControl';
import { on, trust, unwrap, windowKey } from '@workbench/bridge/rpc';
import type * as V2 from '../ade/v2/wire';
import type { SpaceMode } from '../state/modeDomain';
import type { SpaceOpRecord } from '../state/opsDomain';
import type { Settings, SettingsPatch } from '../state/settingsDomain';
import type { TabRecord } from '../state/tabDomain';
import { memoryControl } from './memoryControl';

// bridge/index.ts is this app's own composition root — Kira Studio's own bridge/index.ts, trimmed
// to the 15 services apps/kira-space/main.go actually binds (Part 1's own service list, plus
// LinkService added alongside this file — P100 Part 2 found repo/git/hostHandlers.ts's
// link.openExternal handler had no Go counterpart here; see internal/bridge/link.go). No
// apiControl.ts equivalent: this app has exactly one bound-call surface, not two composed halves.
// P103 Part 2 (§5.6): a growing subset of that surface's own methods — the ones byte-for-byte
// identical with Kira Studio's own studioControl — now come from createCoreControl.ts, shared with
// Kira Studio's own copy of this file; this app's own remaining methods are defined right here.
// P116 H5 moved ten more (open-settings/toggle-project-panel/tab-next/prev/close, keep-awake, app-metrics,
// windowsOpenNew) into that same shared factory once this app grew its own window-chrome parity
// (G1-G5/G7) — this app now has its own metrics ticker (main.go's own metrics.NewAppTicker) and
// keep-awake controller, so both are wired the same way Kira Studio's own copy of this file is.
const spaceControl = {
  customScriptsList: (): Promise<ScriptsSnapshot> =>
    unwrap(CustomScriptsService.List()).then((r) => scriptsSnapshotOf(r)),
  customScriptsCreate: (fields: CustomScriptFields): Promise<CustomScript> =>
    unwrap(CustomScriptsService.Create({ fields })).then((r) => trust<CustomScript>(r)),
  customScriptsUpdate: (id: string, fields: CustomScriptFields): Promise<CustomScript> =>
    unwrap(CustomScriptsService.Update({ id, fields })).then((r) => trust<CustomScript>(r)),
  customScriptsRemove: (id: string): Promise<void> => unwrap(CustomScriptsService.Remove({ id })),
  customScriptsCreateCollection: (name: string): Promise<ScriptCollection> =>
    unwrap(CustomScriptsService.CreateCollection({ name })).then((r) => trust<ScriptCollection>(r)),
  customScriptsRenameCollection: (id: string, name: string): Promise<void> =>
    unwrap(CustomScriptsService.RenameCollection({ id, name })),
  customScriptsDeleteCollection: (id: string): Promise<void> =>
    unwrap(CustomScriptsService.DeleteCollection({ id })),
  customScriptsMove: (id: string, collectionId: string | null): Promise<void> =>
    unwrap(CustomScriptsService.Move({ id, collectionId })),
  onCustomScriptsChanged: (cb: (snapshot: ScriptsSnapshot) => void): (() => void) =>
    on(CHANNEL.customScriptsChanged, (r) => cb(scriptsSnapshotOf(r))),

  scriptRunsList: (limit?: number): Promise<ScriptRun[]> =>
    unwrap(ScriptRunsService.List({ limit: limit ?? 0 })).then((r) => trust<ScriptRun[]>(r ?? [])),
  scriptRunsStop: (id: string): Promise<void> => unwrap(ScriptRunsService.Stop({ id })),
  scriptRunsResolveDir: (scriptId: string): Promise<ScriptDir> =>
    unwrap(ScriptRunsService.ResolveDir({ scriptId })).then((r) => trust<ScriptDir>(r)),
  onScriptRunsChanged: (cb: (run: ScriptRun) => void): (() => void) =>
    on(CHANNEL.scriptRunsChanged, (r) => cb(trust<ScriptRun>(r))),
  scriptRunsPreview: (args: ScriptRunArgs): Promise<ScriptRunPreview> =>
    unwrap(ScriptRunsService.Preview(args)).then((r) => trust<ScriptRunPreview>(r)),
  scriptRunsStart: (args: ScriptRunArgs, hash: string): Promise<ScriptRunStarted> =>
    unwrap(ScriptRunsService.Start({ ...args, hash })).then((r) => trust<ScriptRunStarted>(r)),
  scriptRunsReadLog: (id: string, afterSeq: number): Promise<ScriptRunLogPage> =>
    unwrap(ScriptRunsService.ReadLog({ id, afterSeq })).then((r) => {
      const page = trust<Partial<ScriptRunLogPage>>(r);
      return { chunks: page.chunks ?? [], truncated: page.truncated ?? false };
    }),
  onScriptRunLog: (
    cb: (push: { runId: string; chunks: ScriptRunLogChunk[] }) => void,
  ): (() => void) =>
    on(CHANNEL.scriptRunLog, (r) => cb(trust<{ runId: string; chunks: ScriptRunLogChunk[] }>(r))),
  scriptRunsMcpServers: (): Promise<ScriptMcpServer[]> =>
    unwrap(ScriptRunsService.McpServers()).then((r) => trust<ScriptMcpServer[]>(r ?? [])),
  scriptRunsMcpTools: (server: string): Promise<ScriptMcpTool[]> =>
    unwrap(ScriptRunsService.McpTools({ server })).then((r) => trust<ScriptMcpTool[]>(r ?? [])),

  // P120: linkOpenExternal moved off createCoreControl.ts's now-deleted shared `link` binding —
  // Kira Studio never had a real use for it, so this app's own LinkService.OpenExternal call
  // stays here instead.
  linkOpenExternal: (url: string): Promise<void> => unwrap(LinkService.OpenExternal({ url })),

  githubOpenPullRequestUrl: (url: string): Promise<void> =>
    unwrap(GitHubService.OpenPullRequestURL({ url })),

  gitClientsList: (): Promise<GitClient[]> =>
    unwrap(GitClientsService.List()).then((r) => trust<GitClient[]>(r ?? [])),
  gitClientsRevoke: (id: string): Promise<void> => unwrap(GitClientsService.Revoke({ id })),
  onGitClientsChanged: (cb: (clients: GitClient[]) => void): (() => void) =>
    on(CHANNEL.gitClientsChanged, cb),
  gitPairingPending: (): Promise<GitPairingSnapshot> =>
    unwrap(GitClientsService.PendingPairing()).then((r) => trust<GitPairingSnapshot>(r)),
  gitPairingApprove: (id: string): Promise<GitPairingActionResult> =>
    unwrap(GitClientsService.Approve({ id })).then((r) => trust<GitPairingActionResult>(r)),
  gitPairingDeny: (id: string): Promise<GitPairingActionResult> =>
    unwrap(GitClientsService.Deny({ id })).then((r) => trust<GitPairingActionResult>(r)),
  onGitPairingChanged: (cb: (snap: GitPairingSnapshot) => void): (() => void) =>
    on(CHANNEL.gitPairing, cb),
  gitCredentialPending: (): Promise<GitCredentialPrompt[]> =>
    unwrap(GitCredentialService.Pending()).then((r) => trust<GitCredentialPrompt[]>(r ?? [])),
  gitCredentialProvide: (requestId: string, secret: string | null): Promise<boolean> =>
    unwrap(GitCredentialService.Provide({ requestId, secret })),
  onGitCredentialChanged: (cb: (prompts: GitCredentialPrompt[]) => void): (() => void) =>
    on(CHANNEL.gitCredential, cb),
  gitVsixStatus: (): Promise<GitVsixStatus> =>
    unwrap(GitClientsService.VsixStatus()).then((r) => trust<GitVsixStatus>(r)),
  gitVsixInstall: (): Promise<GitVsixInstallResult> =>
    unwrap(GitClientsService.InstallVsCodeIntegration()).then((r) =>
      trust<GitVsixInstallResult>(r),
    ),

  // P212: the Mobile access pane and the phone pairing prompt.
  mobileStatus: (): Promise<MobileStatus> =>
    unwrap(MobileAccessService.Status()).then((r) => trust<MobileStatus>(r)),
  mobileSetEnabled: (enabled: boolean): Promise<MobileStatus> =>
    unwrap(MobileAccessService.SetEnabled({ enabled })).then((r) => trust<MobileStatus>(r)),
  mobileSetPort: (port: number): Promise<MobileStatus> =>
    unwrap(MobileAccessService.SetPort({ port })).then((r) => trust<MobileStatus>(r)),
  mobileTrustNetwork: (): Promise<MobileStatus> =>
    unwrap(MobileAccessService.TrustCurrentNetwork()).then((r) => trust<MobileStatus>(r)),
  mobileForgetNetwork: (): Promise<MobileStatus> =>
    unwrap(MobileAccessService.ForgetNetwork()).then((r) => trust<MobileStatus>(r)),
  mobileSetAgentInput: (enabled: boolean): Promise<MobileStatus> =>
    unwrap(MobileAccessService.SetAgentInputEnabled({ enabled })).then((r) =>
      trust<MobileStatus>(r),
    ),
  mobileSetDevicePermissions: (id: string, write: boolean, agentInput: boolean): Promise<void> =>
    unwrap(MobileAccessService.SetDevicePermissions({ id, write, agentInput })),
  mobileDevices: (): Promise<MobileDevice[]> =>
    unwrap(MobileAccessService.Devices()).then((r) => trust<MobileDevice[]>(r ?? [])),
  mobileRevoke: (id: string): Promise<void> => unwrap(MobileAccessService.Revoke({ id })),
  mobilePairingPending: (): Promise<MobilePairingSnapshot> =>
    unwrap(MobileAccessService.PendingPairing()).then((r) => trust<MobilePairingSnapshot>(r)),
  mobilePairingApprove: (id: string): Promise<MobilePairingActionResult> =>
    unwrap(MobileAccessService.Approve({ id })).then((r) => trust<MobilePairingActionResult>(r)),
  mobilePairingDeny: (id: string): Promise<MobilePairingActionResult> =>
    unwrap(MobileAccessService.Deny({ id })).then((r) => trust<MobilePairingActionResult>(r)),
  mobileLaunchOpened: (terminalId: string, error: string): Promise<void> =>
    unwrap(MobileAccessService.LaunchOpened({ terminalId, error })),
  mobileTerminalHolds: (): Promise<MobileTerminalHold[]> =>
    unwrap(MobileAccessService.TerminalHolds()).then((r) => trust<MobileTerminalHold[]>(r ?? [])),
  mobileReclaimTerminal: (terminalId: string, cols: number, rows: number): Promise<void> =>
    unwrap(MobileAccessService.ReclaimTerminal({ terminalId, cols, rows })),
  onMobileTerminals: (cb: (holds: MobileTerminalHold[]) => void): (() => void) =>
    on(CHANNEL.mobileTerminals, (holds: MobileTerminalHold[] | null) => cb(holds ?? [])),
  onMobileOpenLaunch: (cb: (event: V2.MobileOpenLaunchEvent) => void): (() => void) =>
    on(CHANNEL.mobileOpenLaunch, cb),
  onMobileStatusChanged: (cb: (status: MobileStatus) => void): (() => void) =>
    on(CHANNEL.mobileStatus, cb),
  onMobileDevicesChanged: (cb: (devices: MobileDevice[]) => void): (() => void) =>
    on(CHANNEL.mobileDevices, cb),
  onMobilePairingChanged: (cb: (snap: MobilePairingSnapshot) => void): (() => void) =>
    on(CHANNEL.mobilePairing, cb),

  // C5 §3.3: the native code-viewing workspace's bound surface — repo import/rename/reorder/remove plus
  // the two read primitives (ListFiles/ReadFile). A rejected ImportRepo/RenameRepo/ReorderRepos call carries a
  // structured ipcerr that unwrap() already turns into a rejected promise.
  codeWorkspaceListRepos: (): Promise<RepoSummary[]> =>
    unwrap(CodeWorkspaceService.ListRepos()).then((r) => trust<RepoSummary[]>(r ?? [])),
  codeWorkspaceRepoHeads: (
    ids?: string[],
  ): Promise<Array<{ id: string; head: HeadState | null; error?: string }>> =>
    unwrap(CodeWorkspaceService.RepoHeads({ ids: ids ?? null })).then((r) =>
      trust<Array<{ id: string; head: HeadState | null; error?: string }>>(r ?? []),
    ),
  codeWorkspaceRepoWorktreeLinks: (): Promise<
    Array<{ id: string; parentId: string; error?: string }>
  > =>
    unwrap(CodeWorkspaceService.RepoWorktreeLinks()).then((r) =>
      trust<Array<{ id: string; parentId: string; error?: string }>>(r ?? []),
    ),
  codeWorkspaceImportRepo: (path: string): Promise<RepoSummary> =>
    unwrap(CodeWorkspaceService.ImportRepo({ path })).then((r) => trust<RepoSummary>(r)),
  codeWorkspaceRenameRepo: (id: string, name: string): Promise<RepoSummary> =>
    unwrap(CodeWorkspaceService.RenameRepo({ id, name })).then((r) => trust<RepoSummary>(r)),
  codeWorkspaceSetRepoColor: (id: string, color: PaletteColor): Promise<RepoSummary> =>
    unwrap(CodeWorkspaceService.SetRepoColor({ id, color })).then((r) => trust<RepoSummary>(r)),
  codeWorkspaceReorderRepos: (ids: string[]): Promise<RepoSummary[]> =>
    unwrap(CodeWorkspaceService.ReorderRepos({ ids })).then((r) => trust<RepoSummary[]>(r ?? [])),
  codeWorkspaceRemoveRepo: (id: string): Promise<void> =>
    unwrap(CodeWorkspaceService.RemoveRepo({ id })),
  codeWorkspaceListFiles: (id: string): Promise<FileListing> =>
    unwrap<Awaited<ReturnType<typeof CodeWorkspaceService.ListFiles>>>(
      CodeWorkspaceService.ListFiles({ id }),
    ).then((r) => trust<FileListing>({ ...r, paths: r.paths ?? [], status: r.status ?? {} })),
  codeWorkspaceReadFile: (id: string, path: string): Promise<FileContent> =>
    unwrap(CodeWorkspaceService.ReadFile({ id, path })).then((r) => trust<FileContent>(r)),

  // C6 §7/§8.5: the index lifecycle (fire-and-forget — a failed start/stop must never block
  // opening or leaving a workspace) plus the diff read.
  codeWorkspaceOpenWorkspace: (id: string): Promise<void> =>
    unwrap(CodeWorkspaceService.OpenWorkspace({ id })),
  codeWorkspaceCloseWorkspace: (id: string): Promise<void> =>
    unwrap(CodeWorkspaceService.CloseWorkspace({ id })),
  codeWorkspaceReadDiff: (id: string, path: string): Promise<DiffContent> =>
    unwrap(CodeWorkspaceService.ReadDiff({ id, path })).then((r) => trust<DiffContent>(r)),

  // C7 §5/D7: StartSearch returns as soon as the background scan starts — its own searchId is how
  // the renderer matches a later onCodeSearch event to the run that's waiting on it.
  codeWorkspaceStartSearch: (id: string, req: SearchRequest): Promise<{ searchId: string }> =>
    unwrap(CodeWorkspaceService.StartSearch({ id, windowKey, ...req })).then((r) =>
      trust<{ searchId: string }>(r),
    ),
  codeWorkspaceCancelSearch: (id: string): Promise<void> =>
    unwrap(CodeWorkspaceService.CancelSearch({ id })),
  onCodeSearch: (cb: (event: CodeSearchEvent) => void): (() => void) => on(CHANNEL.codeSearch, cb),

  // Agent-monitor surface: `terminalAgentSessions`/
  // `onAgentSessions`/`onAgentEvent` satisfy `AgentSessionsControl` structurally (P127's shared
  // store factory, `ade/state/agentSessions.ts`'s own call), the same "no adapter" shape
  // `createAgentSessionsStore`'s own doc comment states.
  terminalAgentSessions: (): Promise<AgentSessionsEvent> =>
    unwrap(TerminalService.AgentSessions()).then((r) => trust<AgentSessionsEvent>(r)),
  onAgentSessions: (cb: (event: AgentSessionsEvent) => void): (() => void) =>
    on(CHANNEL.agentSessions, cb),
  onAgentEvent: (cb: (event: AgentEvent) => void): (() => void) => on(CHANNEL.agentEvent, cb),

  // P132 Part 2: the in-memory git op log's snapshot, cancel and live-update push.
  opsRecent: (limit: number): Promise<SpaceOpRecord[]> =>
    unwrap(OpsService.Recent({ limit })).then((r) => trust<SpaceOpRecord[]>(r ?? [])),
  opsCancel: (opId: string): Promise<void> => unwrap(OpsService.Cancel({ opId })),
  onOpUpdate: (cb: (record: SpaceOpRecord) => void): (() => void) => on(CHANNEL.opUpdate, cb),

  // P144: AdeTaskService (v2 task board). Types from ../ade/v2/wire; payload-free pushes invalidate queries.
  adeTaskBoard: (): Promise<V2.Board> =>
    unwrap(AdeTaskService.Board()).then((r) => trust<V2.Board>(r)),
  adeTaskPrs: (): Promise<V2.PrsResult> =>
    unwrap(AdeTaskService.Prs()).then((r) => trust<V2.PrsResult>(r)),
  adeTaskRefresh: (args: V2.RefreshArgs): Promise<V2.RefreshResult> =>
    unwrap(AdeTaskService.Refresh(args)).then((r) => trust<V2.RefreshResult>(r)),
  adeTaskForcePush: (args: V2.BranchArgs): Promise<V2.ForcePushResult> =>
    unwrap(AdeTaskService.ForcePush(args)).then((r) => trust<V2.ForcePushResult>(r)),
  adeTaskCreateTask: (args: V2.CreateTaskArgs): Promise<V2.Task> =>
    unwrap(AdeTaskService.CreateTask(args)).then((r) => trust<V2.Task>(r)),
  adeTaskUpdateTask: (args: V2.UpdateTaskArgs): Promise<V2.Task> =>
    unwrap(AdeTaskService.UpdateTask(args)).then((r) => trust<V2.Task>(r)),
  adeTaskAddTaskRepo: (args: V2.AddTaskRepoArgs): Promise<V2.Branch> =>
    unwrap(AdeTaskService.AddTaskRepo(args)).then((r) => trust<V2.Branch>(r)),
  adeTaskCandidateBranches: (): Promise<V2.CandidateBranchesResult> =>
    unwrap(AdeTaskService.CandidateBranches()).then((r) => trust<V2.CandidateBranchesResult>(r)),
  adeTaskAddExistingBranch: (args: V2.AddExistingBranchArgs): Promise<V2.AddExistingBranchResult> =>
    unwrap(AdeTaskService.AddExistingBranch(args)).then((r) =>
      trust<V2.AddExistingBranchResult>(r),
    ),
  adeTaskSetPlan: (args: V2.SetPlanArgs): Promise<void> => unwrap(AdeTaskService.SetPlan(args)),
  adeTaskSetQueuedAfter: (args: V2.SetQueuedAfterArgs): Promise<void> =>
    unwrap(AdeTaskService.SetQueuedAfter(args)),
  adeTaskBacklog: (): Promise<V2.BacklogResult> =>
    unwrap(AdeTaskService.Backlog()).then((r) => trust<V2.BacklogResult>(r)),
  adeTaskAddBacklogItem: (args: V2.AddBacklogItemArgs): Promise<V2.BacklogItem> =>
    unwrap(AdeTaskService.AddBacklogItem(args)).then((r) => trust<V2.BacklogItem>(r)),
  adeTaskUpdateBacklogItem: (args: V2.UpdateBacklogItemArgs): Promise<V2.BacklogItem> =>
    unwrap(AdeTaskService.UpdateBacklogItem(args)).then((r) => trust<V2.BacklogItem>(r)),
  adeTaskMoveBacklogItem: (args: V2.MoveBacklogItemArgs): Promise<void> =>
    unwrap(AdeTaskService.MoveBacklogItem(args)),
  adeTaskDeleteBacklogItem: (args: V2.BacklogItemArgs): Promise<void> =>
    unwrap(AdeTaskService.DeleteBacklogItem(args)),
  adeTaskPromoteBacklogItem: (args: V2.BacklogItemArgs): Promise<V2.Task> =>
    unwrap(AdeTaskService.PromoteBacklogItem(args)).then((r) => trust<V2.Task>(r)),
  adeTaskWorkflows: (): Promise<V2.WorkflowsResult> =>
    unwrap(AdeTaskService.Workflows()).then((r) => trust<V2.WorkflowsResult>(r)),
  adeTaskRepos: (): Promise<V2.ReposResult> =>
    unwrap(AdeTaskService.Repos()).then((r) => trust<V2.ReposResult>(r)),
  adeTaskWorkflowYaml: (args: V2.FileNameArgs): Promise<V2.WorkflowYaml> =>
    unwrap(AdeTaskService.WorkflowYaml(args)).then((r) => trust<V2.WorkflowYaml>(r)),
  adeTaskValidateWorkflowYaml: (
    args: V2.ValidateWorkflowYamlArgs,
  ): Promise<V2.WorkflowValidation> =>
    unwrap(AdeTaskService.ValidateWorkflowYaml(args)).then((r) => trust<V2.WorkflowValidation>(r)),
  adeTaskSaveWorkflow: (args: V2.SaveWorkflowArgs): Promise<V2.WorkflowEntry> =>
    unwrap(AdeTaskService.SaveWorkflow(args)).then((r) => trust<V2.WorkflowEntry>(r)),
  adeTaskSaveWorkflowYaml: (args: V2.SaveWorkflowYamlArgs): Promise<V2.WorkflowEntry> =>
    unwrap(AdeTaskService.SaveWorkflowYaml(args)).then((r) => trust<V2.WorkflowEntry>(r)),
  adeTaskImportWorkflow: (args: V2.ImportWorkflowArgs): Promise<V2.WorkflowEntry> =>
    unwrap(AdeTaskService.ImportWorkflow(args)).then((r) => trust<V2.WorkflowEntry>(r)),
  adeTaskNewWorkflow: (args: V2.NewWorkflowArgs): Promise<V2.WorkflowEntry> =>
    unwrap(AdeTaskService.NewWorkflow(args)).then((r) => trust<V2.WorkflowEntry>(r)),
  adeTaskUpdateRepo: (args: V2.UpdateRepoArgs): Promise<V2.Repo> =>
    unwrap(AdeTaskService.UpdateRepo(args)).then((r) => trust<V2.Repo>(r)),
  adeTaskAddFolder: (args: V2.FolderArgs): Promise<V2.FolderImportResult> =>
    unwrap(AdeTaskService.AddFolder(args)).then((r) => trust<V2.FolderImportResult>(r)),
  adeTaskSetFolderWatch: (args: V2.FolderArgs): Promise<V2.Folder> =>
    unwrap(AdeTaskService.SetFolderWatch(args)).then((r) => trust<V2.Folder>(r)),
  adeTaskRemoveFolder: (args: V2.PathArgs): Promise<void> =>
    unwrap(AdeTaskService.RemoveFolder(args)),
  adeTaskRecordMerge: (args: V2.RecordMergeArgs): Promise<void> =>
    unwrap(AdeTaskService.RecordMerge(args)),
  adeTaskStartRun: (args: V2.StartRunArgs): Promise<V2.StartRunResult> =>
    unwrap(AdeTaskService.StartRun(args)).then((r) => trust<V2.StartRunResult>(r)),
  adeTaskSetTaskWorkflow: (args: V2.SetTaskWorkflowArgs): Promise<V2.Task> =>
    unwrap(AdeTaskService.SetTaskWorkflow(args)).then((r) => trust<V2.Task>(r)),
  adeTaskApprove: (args: V2.StepArgs): Promise<void> => unwrap(AdeTaskService.Approve(args)),
  adeTaskRetryRun: (args: V2.RunArgs): Promise<void> => unwrap(AdeTaskService.RetryRun(args)),
  adeTaskStageDone: (args: V2.TaskArgs): Promise<V2.Task> =>
    unwrap(AdeTaskService.StageDone(args)).then((r) => trust<V2.Task>(r)),
  adeTaskSetTaskStage: (args: V2.SetTaskStageArgs): Promise<V2.Task> =>
    unwrap(AdeTaskService.SetTaskStage(args)).then((r) => trust<V2.Task>(r)),
  adeTaskRetrySetup: (args: V2.BranchArgs): Promise<void> =>
    unwrap(AdeTaskService.RetrySetup(args)),
  adeTaskReadLog: (args: V2.ReadLogArgs): Promise<V2.LogPage> =>
    unwrap(AdeTaskService.ReadLog(args)).then((r) => trust<V2.LogPage>(r)),
  adeTaskSessions: (): Promise<V2.SessionsResult> =>
    unwrap(AdeTaskService.Sessions()).then((r) => trust<V2.SessionsResult>(r)),
  adeTaskStopRun: (args: V2.RunArgs): Promise<void> => unwrap(AdeTaskService.StopRun(args)),
  adeTaskTakeOver: (args: V2.TakeOverArgs): Promise<V2.Launch> =>
    unwrap(AdeTaskService.TakeOver(args)).then((r) => trust<V2.Launch>(r)),
  adeTaskLaunchStage: (args: V2.LaunchStageArgs): Promise<V2.Launch> =>
    unwrap(AdeTaskService.LaunchStage(args)).then((r) => trust<V2.Launch>(r)),
  adeTaskStartBranch: (args: V2.StartBranchArgs): Promise<V2.Launch> =>
    unwrap(AdeTaskService.StartBranch(args)).then((r) => trust<V2.Launch>(r)),
  adeTaskRebasePreview: (args: V2.OntoArgs): Promise<V2.RebasePreview> =>
    unwrap(AdeTaskService.RebasePreview(args)).then((r) => trust<V2.RebasePreview>(r)),
  adeTaskRebase: (args: V2.RebaseArgs): Promise<V2.RebaseStart> =>
    unwrap(AdeTaskService.Rebase(args)).then((r) => trust<V2.RebaseStart>(r)),
  adeTaskAbortRebase: (args: V2.BranchArgs): Promise<void> =>
    unwrap(AdeTaskService.AbortRebase(args)),
  adeTaskSetBranchBase: (args: V2.SetBranchBaseArgs): Promise<void> =>
    unwrap(AdeTaskService.SetBranchBase(args)),
  adeTaskRepoBranches: (args: V2.RepoBranchesArgs): Promise<V2.RepoBranches> =>
    unwrap(AdeTaskService.RepoBranches(args)).then((r) => trust<V2.RepoBranches>(r)),
  adeTaskSend: (args: V2.SendArgs): Promise<void> => unwrap(AdeTaskService.Send(args)),
  adeTaskFocusSession: (args: V2.FocusSessionArgs): Promise<boolean> =>
    unwrap(AdeTaskService.FocusSession(args)),
  adeTaskOpenReviewWindow: (args: V2.BranchArgs): Promise<boolean> =>
    unwrap(AdeTaskService.OpenReviewWindow(args)),
  adeTaskReviewWindowTarget: (args: V2.WindowKeyArgs): Promise<V2.ReviewWindowTarget | null> =>
    unwrap(AdeTaskService.ReviewWindowTarget(args)).then((r) =>
      trust<V2.ReviewWindowTarget | null>(r),
    ),
  adeTaskReviewAgent: (args: V2.TaskArgs): Promise<V2.ReviewAgentState> =>
    unwrap(AdeTaskService.ReviewAgent(args)).then((r) => trust<V2.ReviewAgentState>(r)),
  adeTaskLaunchReviewAgent: (args: V2.TaskArgs): Promise<V2.ReviewAgentLaunch> =>
    unwrap(AdeTaskService.LaunchReviewAgent(args)).then((r) => trust<V2.ReviewAgentLaunch>(r)),
  adeTaskGitHubSyncPlan: (args: V2.BranchArgs): Promise<V2.GhSyncPlan> =>
    unwrap(AdeTaskService.GitHubSyncPlan(args)).then((r) => trust<V2.GhSyncPlan>(r)),
  adeTaskGitHubSyncApply: (args: V2.BranchArgs): Promise<V2.GhSyncResult> =>
    unwrap(AdeTaskService.GitHubSyncApply(args)).then((r) => trust<V2.GhSyncResult>(r)),
  adeTaskArchiveRisk: (args: V2.TaskArgs): Promise<V2.ArchiveRisk> =>
    unwrap(AdeTaskService.ArchiveRisk(args)).then((r) => trust<V2.ArchiveRisk>(r)),
  adeTaskArchiveTask: (args: V2.TaskArgs): Promise<void> =>
    unwrap(AdeTaskService.ArchiveTask(args)),
  onAdeTaskBoard: (cb: () => void): (() => void) => on(CHANNEL.adeTaskBoard, cb),
  onAdeTaskBacklog: (cb: () => void): (() => void) => on(CHANNEL.adeTaskBacklog, cb),
  onAdeTaskWorkflows: (cb: () => void): (() => void) => on(CHANNEL.adeTaskWorkflows, cb),
  onAdeTaskRepos: (cb: () => void): (() => void) => on(CHANNEL.adeTaskRepos, cb),
  onAdeTaskRuns: (cb: (event: V2.RunsChangedEvent) => void): (() => void) =>
    on(CHANNEL.adeTaskRuns, cb),
  onAdeTaskLog: (cb: (event: V2.LogEvent) => void): (() => void) => on(CHANNEL.adeTaskLog, cb),
  onAdeTaskSessions: (cb: () => void): (() => void) => on(CHANNEL.adeTaskSessions, cb),
  onAdeTaskOpenSession: (cb: (event: V2.OpenSessionEvent) => void): (() => void) =>
    on(CHANNEL.adeTaskOpenSession, cb),

  // P238: desktop agent notifications. The window reports what it shows; a notification click
  // pushes the reveal events back to the owning window.
  agentNotifyReportFocus: (args: Omit<AgentNotifyFocus, 'windowKey'>): Promise<void> =>
    unwrap(AgentNotifyService.ReportFocus({ windowKey, ...args })),
  agentNotifySendTest: (): Promise<void> => unwrap(AgentNotifyService.SendTest()),
  onAgentRevealTerminal: (cb: (event: { terminalId: string }) => void): (() => void) =>
    on('kira:agent:reveal-terminal', cb),
  onAgentRevealTask: (cb: (event: { taskId: string }) => void): (() => void) =>
    on('kira:agent:reveal-task', cb),
  // P239: Claude Code usage limits for the ADE status bar.
  claudeUsageGet: (): Promise<ClaudeUsageSnapshot> => unwrap(ClaudeUsageService.Get()),
  onClaudeUsage: (cb: (snapshot: ClaudeUsageSnapshot) => void): (() => void) =>
    on('kira:claude:usage', cb),
};

export interface ClaudeUsageWindow {
  usedPercent: number;
  /** Unix milliseconds. */
  resetsAt: number;
}

export interface ClaudeUsageSnapshot {
  /** ok, waiting or off. */
  state: string;
  /** session or run; empty until a reading arrives. */
  source: string;
  fiveHour: ClaudeUsageWindow | null;
  sevenDay: ClaudeUsageWindow | null;
  /** Unix milliseconds. */
  updatedAt: number;
  detail: string;
}

interface AgentNotifyFocus {
  windowKey: string;
  focused: boolean;
  module: string;
  activeTerminalId: string;
  adeTaskId: string;
}

// P103 Part 2 (§5.6): the shared methods (createCoreControl.ts, P116 H5/P119 grew that set) plus
// this app's own remaining ones (spaceControl, above) — every `control.xxx()` call site in the app
// is unchanged, since neither the method names nor their bound-call FQNs moved.
export const control = {
  ...createCoreControl<Settings, Layout, TabRecord, SettingsPatch, SpaceMode>({
    settings: SettingsService,
    layout: LayoutService,
    tabs: TabsService,
    lifecycle: LifecycleService,
    terminal: TerminalService,
    files: FilesService,
    windows: WindowsService,
    keepAwake: KeepAwakeService,
    update: UpdateService,
  }),
  ...memoryControl,
  ...spaceControl,
};
