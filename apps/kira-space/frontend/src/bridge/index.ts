import * as CodeWorkspaceService from '@bindings/codeworkspaceservice.js';
import * as FilesService from '@bindings/filesservice.js';
import * as GitClientsService from '@bindings/gitclientsservice.js';
import * as GitHubService from '@bindings/githubservice.js';
import * as LayoutService from '@bindings/layoutservice.js';
import * as LifecycleService from '@bindings/lifecycleservice.js';
import * as LinkService from '@bindings/linkservice.js';
import type * as WailsModels from '@bindings/models.js';
import * as SettingsService from '@bindings/settingsservice.js';
import * as TabsService from '@bindings/tabsservice.js';
import * as TerminalService from '@bindings/terminalservice.js';
import type { HeadState } from '@kira/git-ipc';
import type {
  GitClient,
  GitPairingActionResult,
  GitPairingSnapshot,
  GitVsixInstallResult,
  GitVsixStatus,
} from '@shared/domain/git';
import type { Layout, LayoutPatch } from '@shared/domain/layout';
import type {
  CodeSearchEvent,
  DiffContent,
  FileContent,
  FileListing,
  RepoSummary,
  SearchRequest,
} from '@shared/domain/repo';
import type { Settings, SettingsPatch } from '@shared/domain/settings';
import type { TerminalLaunchKind } from '@shared/domain/tabs';
import { CHANNEL, type TerminalEvent } from '@shared/protocol/events';
import { on, trust, unwrap, windowKey } from '@workbench/bridge/rpc';
import type { TabRecord } from '../state/tabDomain';

// bridge/index.ts is this app's own composition root — Kira Studio's own bridge/index.ts, trimmed
// to the 10 services apps/kira-space/main.go actually binds (Part 1's own service list, plus
// LinkService added alongside this file — P100 Part 2 found repo/git/hostHandlers.ts's
// link.openExternal handler had no Go counterpart here; see internal/bridge/link.go). No
// apiControl.ts equivalent: this app has exactly one bound-call surface, not two composed halves.
export const control = {
  // P100 Part 2: onAppMetrics (CHANNEL.appMetrics) is Kira Studio's own status-bar readout —
  // this app has no adapterhost/metrics ticker (no database connections to sample), so it is not
  // wired here. CHANNEL.appMetrics itself stays in the shared protocol constants for Studio's use.
  githubOpenPullRequestUrl: (url: string): Promise<void> =>
    unwrap(GitHubService.OpenPullRequestURL({ url })),
  linkOpenExternal: (url: string): Promise<void> => unwrap(LinkService.OpenExternal({ url })),

  settingsGetAll: (): Promise<Settings> =>
    unwrap(SettingsService.GetAll()).then((r) => trust<Settings>(r)),
  settingsSet: (patch: SettingsPatch): Promise<Settings> =>
    unwrap(SettingsService.Set({ patch })).then((r) => trust<Settings>(r)),
  onSettingsChanged: (cb: (settings: Settings) => void): (() => void) =>
    on(CHANNEL.settingsChanged, cb),

  layoutGetAll: (): Promise<Layout> => unwrap(LayoutService.GetAll()).then((r) => trust<Layout>(r)),
  layoutSet: (patch: LayoutPatch): Promise<Layout> =>
    unwrap(LayoutService.Set({ patch })).then((r) => trust<Layout>(r)),
  onLayoutChanged: (cb: (layout: Layout) => void): (() => void) => on(CHANNEL.layoutChanged, cb),

  // Quit handshake (Kira Studio's own P8 C8 mechanism, unchanged shape) — every window acks this
  // before before-quit is allowed through, so a debounced tab save still pending at quit time is
  // never silently lost.
  onFlushBeforeClose: (cb: () => void): (() => void) => on(CHANNEL.appFlushBeforeClose, cb),
  appFlushed: (): void => {
    void LifecycleService.Flushed({ windowKey });
  },
  onWindowFlushBeforeClose: (cb: () => void): (() => void) =>
    on(CHANNEL.windowFlushBeforeClose, cb),
  windowFlushed: (): void => {
    void LifecycleService.WindowFlushed({ windowKey });
  },

  // P25 D13: "" means cancelled — GitStart.vue's "Import a repository" affordance.
  filesChooseFolder: (title?: string): Promise<WailsModels.FilesChooseFolderResult> =>
    unwrap(FilesService.ChooseFolder({ title: title ?? '' })),

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

  // Both scoped to this page's own workbench (state/window.ts) — windowKey is read once,
  // synchronously, at module load, before hydrateTabs() ever calls tabsList().
  tabsList: (): Promise<TabRecord[]> =>
    unwrap(TabsService.List({ windowKey })).then((r) => trust<TabRecord[]>(r ?? [])),
  tabsSave: (tabs: TabRecord[]): Promise<void> => unwrap(TabsService.Save({ windowKey, tabs })),

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

  // P91 §7/P83 §3.2: the Terminal module's own unscoped-launch default plus the embedded
  // terminal's own bound surface — terminalId is client-supplied (the tab id) so
  // state/terminals.ts subscribes to onTerminal before this call returns.
  terminalDefaultCwd: (): Promise<{ path: string }> =>
    unwrap(TerminalService.DefaultCwd()).then((r) => trust<{ path: string }>(r)),
  terminalOpen: (
    terminalId: string,
    cwd: string,
    cols: number,
    rows: number,
    command?: string,
    launchKind?: TerminalLaunchKind,
  ): Promise<{ shell: string }> =>
    unwrap(
      TerminalService.Open({
        terminalId,
        cwd,
        cols,
        rows,
        windowKey,
        command: command ?? '',
        launchKind: launchKind ?? 'shell',
      }),
    ).then((r) => trust<{ shell: string }>(r)),
  terminalWrite: (terminalId: string, data: string): Promise<void> =>
    unwrap(TerminalService.Write({ terminalId, data })),
  terminalResize: (terminalId: string, cols: number, rows: number): Promise<void> =>
    unwrap(TerminalService.Resize({ terminalId, cols, rows })),
  terminalClose: (terminalId: string): Promise<void> =>
    unwrap(TerminalService.Close({ terminalId })),
  onTerminal: (cb: (event: TerminalEvent) => void): (() => void) => on(CHANNEL.terminal, cb),
};
