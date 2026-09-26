import * as CodeWorkspaceService from '@bindings/codeworkspaceservice.js';
import * as FilesService from '@bindings/filesservice.js';
import * as GitClientsService from '@bindings/gitclientsservice.js';
import * as GitHubService from '@bindings/githubservice.js';
import * as KeepAwakeService from '@bindings/keepawakeservice.js';
import * as LayoutService from '@bindings/layoutservice.js';
import * as LifecycleService from '@bindings/lifecycleservice.js';
import * as LinkService from '@bindings/linkservice.js';
import * as SettingsService from '@bindings/settingsservice.js';
import * as TabsService from '@bindings/tabsservice.js';
import * as TerminalService from '@bindings/terminalservice.js';
import * as WindowsService from '@bindings/windowsservice.js';
import type { HeadState } from '@kira/git-ipc';
import type {
  GitClient,
  GitPairingActionResult,
  GitPairingSnapshot,
  GitVsixInstallResult,
  GitVsixStatus,
} from '@shared/domain/git';
import type { Layout } from '@shared/domain/layout';
import type {
  CodeSearchEvent,
  DiffContent,
  FileContent,
  FileListing,
  RepoSummary,
  SearchRequest,
} from '@shared/domain/repo';
import { CHANNEL } from '@shared/protocol/events';
import { createCoreControl } from '@workbench/bridge/createCoreControl';
import { on, trust, unwrap, windowKey } from '@workbench/bridge/rpc';
import type { Settings, SettingsPatch } from '../state/settingsDomain';
import type { TabRecord } from '../state/tabDomain';

// bridge/index.ts is this app's own composition root — Kira Studio's own bridge/index.ts, trimmed
// to the 10 services apps/kira-space/main.go actually binds (Part 1's own service list, plus
// LinkService added alongside this file — P100 Part 2 found repo/git/hostHandlers.ts's
// link.openExternal handler had no Go counterpart here; see internal/bridge/link.go). No
// apiControl.ts equivalent: this app has exactly one bound-call surface, not two composed halves.
// P103 Part 2 (§5.6): 20 of that surface's own methods — the ones byte-for-byte identical with
// Kira Studio's own studioControl — now come from createCoreControl.ts, shared with Kira Studio's
// own copy of this file; this app's own 24 remaining methods are defined right here. P116 H5 moved
// ten more (open-settings/toggle-project-panel/tab-next/prev/close, keep-awake, app-metrics,
// windowsOpenNew) into that same shared factory once this app grew its own window-chrome parity
// (G1-G5/G7) — this app now has its own metrics ticker (main.go's own metrics.NewAppTicker) and
// keep-awake controller, so both are wired the same way Kira Studio's own copy of this file is.
const spaceControl = {
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
  gitVsixStatus: (): Promise<GitVsixStatus> =>
    unwrap(GitClientsService.VsixStatus()).then((r) => trust<GitVsixStatus>(r)),
  gitVsixInstall: (): Promise<GitVsixInstallResult> =>
    unwrap(GitClientsService.InstallVsCodeIntegration()).then((r) =>
      trust<GitVsixInstallResult>(r),
    ),

  // C5 §3.3: the native code-viewing workspace's bound surface — repo import/rename/remove plus
  // the two read primitives (ListFiles/ReadFile). A rejected ImportRepo/RenameRepo call carries a
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
};

// P103 Part 2 (§5.6): the 20 shared methods (createCoreControl.ts) plus this app's own 24
// remaining ones (spaceControl, above) — every `control.xxx()` call site in the app is unchanged,
// since neither the method names nor their bound-call FQNs moved.
export const control = {
  ...createCoreControl<Settings, Layout, TabRecord, SettingsPatch>({
    settings: SettingsService,
    layout: LayoutService,
    tabs: TabsService,
    lifecycle: LifecycleService,
    terminal: TerminalService,
    files: FilesService,
    link: LinkService,
    windows: WindowsService,
    keepAwake: KeepAwakeService,
  }),
  ...spaceControl,
};
