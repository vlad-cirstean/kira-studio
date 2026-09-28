import * as AdeService from '@bindings/adeservice.js';
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
import * as UpdateService from '@bindings/updateservice.js';
import * as WindowsService from '@bindings/windowsservice.js';
import type { HeadState } from '@kira/git-ipc';
import type { AgentEvent, AgentSessionsEvent } from '@shared/domain/agent';
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
import type {
  AdeAddBranchArgs,
  AdeAddDependencyArgs,
  AdeAddNewWorkArgs,
  AdeArchiveArgs,
  AdeArchiveRisk,
  AdeBindNewWorkArgs,
  AdeCandidateBranch,
  AdeCredentialRequest,
  AdeDependencyArgs,
  AdeForcePushArgs,
  AdeForcePushResult,
  AdeItemArgs,
  AdeLaunch,
  AdePr,
  AdePrepareLaunchArgs,
  AdeRefreshResult,
  AdeRepoChangedEvent,
  AdeRepoPrs,
  AdeRepoSnapshot,
  AdeSendArgs,
  AdeSessionsResult,
  AdeSetBlockerArgs,
  AdeSetBranchMetaArgs,
  AdeSetPlanArgs,
  AdeSetQueuedAfterArgs,
  AdeUpdateDependencyArgs,
  AdeUpdateNewWorkArgs,
} from '../ade/wire';
import type { SpaceMode } from '../state/modeDomain';
import type { Settings, SettingsPatch } from '../state/settingsDomain';
import type { TabRecord } from '../state/tabDomain';

// P129 Part 3 §2.3's own doc comment (ade/wire.ts): every `toWire*` helper in `bridge/ade.go`
// builds its array/map fields with an explicit `make(...)`, so only these four "straight
// passthrough" spots (never `make()`'d at the wire layer) can really arrive as JSON `null` — an
// empty queue's own plan, an unreferenced repo's colors, a pair with no overlap at all, or
// `Refresh`'s own zero-value error path. Normalized once, here, rather than a null check at every
// `useQueue()` call site (the existing `codeWorkspaceListFiles` binding above sets this precedent
// for a nested field, not just a top-level array).
function normalizeAdeRepoSnapshot(raw: AdeRepoSnapshot): AdeRepoSnapshot {
  return {
    ...raw,
    remote: raw.remote ?? '',
    plan: {
      day: raw.plan.day ?? {},
      order: raw.plan.order ?? [],
      queuedAfter: raw.plan.queuedAfter ?? {},
      unpushed: raw.plan.unpushed ?? {},
    },
    colors: raw.colors ?? {},
    pairs: (raw.pairs ?? []).map((p) => ({
      ...p,
      shared: p.shared ?? [],
      conflicts: p.conflicts ?? [],
    })),
    dependencies: (raw.dependencies ?? []).map((d) => ({ ...d, blocks: d.blocks ?? [] })),
  };
}

/** P129 Part 4 §2.3: `ArchiveRisk`'s own `dirty` follows the same straight-passthrough shape as the
 *  snapshot's own plan/colors/pairs fields above — normalized here, once. */
function normalizeAdeArchiveRisk(raw: AdeArchiveRisk): AdeArchiveRisk {
  return { ...raw, dirty: raw.dirty ?? [] };
}

function normalizeAdeRepoPrs(raw: AdeRepoPrs): AdeRepoPrs {
  const branches: Record<string, AdePr> = {};
  for (const [branch, pr] of Object.entries(raw.branches ?? {})) {
    if (pr) branches[branch] = pr;
  }
  return { ...raw, branches, webUrl: raw.webUrl ?? '' };
}

// bridge/index.ts is this app's own composition root — Kira Studio's own bridge/index.ts, trimmed
// to the 13 services apps/kira-space/main.go actually binds (Part 1's own service list, plus
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

  // P129 Part 3 §2.2: the ade module's own bound-call surface — 6 of `AdeService`'s 19 methods,
  // the rest landing with their first consumer part (§0.10). `terminalAgentSessions`/
  // `onAgentSessions`/`onAgentEvent` satisfy `AgentSessionsControl` structurally (P127's shared
  // store factory, `ade/state/agentSessions.ts`'s own call), the same "no adapter" shape
  // `createAgentSessionsStore`'s own doc comment states.
  terminalAgentSessions: (): Promise<AgentSessionsEvent> =>
    unwrap(AdeService.AgentSessions()).then((r) => trust<AgentSessionsEvent>(r)),
  onAgentSessions: (cb: (event: AgentSessionsEvent) => void): (() => void) =>
    on(CHANNEL.agentSessions, cb),
  onAgentEvent: (cb: (event: AgentEvent) => void): (() => void) => on(CHANNEL.agentEvent, cb),

  adeSessions: (): Promise<AdeSessionsResult> =>
    unwrap(AdeService.Sessions()).then((r) => trust<AdeSessionsResult>(r)),
  adeRepoSnapshot: (codeRepoId: string): Promise<AdeRepoSnapshot> =>
    unwrap(AdeService.RepoSnapshot({ codeRepoId })).then((r) =>
      normalizeAdeRepoSnapshot(trust<AdeRepoSnapshot>(r)),
    ),
  adeRepoPrs: (codeRepoId: string): Promise<AdeRepoPrs> =>
    unwrap(AdeService.RepoPrs({ codeRepoId })).then((r) =>
      normalizeAdeRepoPrs(trust<AdeRepoPrs>(r)),
    ),
  adeRefresh: (codeRepoId: string): Promise<AdeRefreshResult> =>
    unwrap(AdeService.Refresh({ codeRepoId })).then((r) => {
      const result = trust<AdeRefreshResult>(r);
      return { ...result, newlyMerged: result.newlyMerged ?? [] };
    }),
  adeProvideCredential: (requestId: string, secret: string | null): Promise<boolean> =>
    unwrap(AdeService.ProvideCredential({ requestId, secret: secret ?? undefined })),
  // P129 Part 3 §0.10 note: `adeSessions()`'s own push counterpart is payload-free (Go's
  // `AdeSessionsChanged` calls `Broadcast`, never `Emit`) — `onFlushBeforeClose`'s own precedent
  // just above in createCoreControl.ts, restated here since this file has no `() => void` push yet.
  onAdeSessions: (cb: () => void): (() => void) => on(CHANNEL.adeSessions, cb),
  onAdeRepo: (cb: (event: AdeRepoChangedEvent) => void): (() => void) => on(CHANNEL.adeRepo, cb),
  onAdeCredential: (cb: (request: AdeCredentialRequest) => void): (() => void) =>
    on(CHANNEL.adeCredential, cb),

  // P129 Part 4 §2.3: the six remaining `AdeService` members this part consumes (launch, delivery,
  // archive-at-risk, archive, queue placement, new-work branch name) — `ForcePush` stays unbound
  // (§0.6, Part 5's own first caller).
  adePrepareLaunch: (args: AdePrepareLaunchArgs): Promise<AdeLaunch> =>
    unwrap(AdeService.PrepareLaunch(args)).then((r) => trust<AdeLaunch>(r)),
  adeSend: (args: AdeSendArgs): Promise<void> => unwrap(AdeService.Send(args)),
  adeArchiveRisk: (args: AdeItemArgs): Promise<AdeArchiveRisk> =>
    unwrap(AdeService.ArchiveRisk(args)).then((r) =>
      normalizeAdeArchiveRisk(trust<AdeArchiveRisk>(r)),
    ),
  adeArchive: (args: AdeArchiveArgs): Promise<void> => unwrap(AdeService.Archive(args)),
  adeSetQueuedAfter: (args: AdeSetQueuedAfterArgs): Promise<void> =>
    unwrap(AdeService.SetQueuedAfter(args)),
  adeUpdateNewWork: (args: AdeUpdateNewWorkArgs): Promise<void> =>
    unwrap(AdeService.UpdateNewWork(args)),
  // P129 Part 6 §0.23: the two members left of `AdeService`'s 19 (bound count 17 -> 19) — the
  // detail panel's own field writes (`SetBranchMeta`) and the candidate picker's resolution
  // (`BindNewWork`).
  adeSetBranchMeta: (args: AdeSetBranchMetaArgs): Promise<void> =>
    unwrap(AdeService.SetBranchMeta(args)),
  adeBindNewWork: (args: AdeBindNewWorkArgs): Promise<void> => unwrap(AdeService.BindNewWork(args)),

  // P129 Part 5 §2.2/§0.2: `SetPlan` — drops, Move to today, overflow move, day-off confirm.
  adeSetPlan: (args: AdeSetPlanArgs): Promise<void> => unwrap(AdeService.SetPlan(args)),
  // §0.16: generated binding's own return type is `AdeForcePushResult[] | null` — `?? []` matches
  // this file's other list-result normalizations (e.g. `adeCandidateBranches` below).
  adeForcePush: (args: AdeForcePushArgs): Promise<AdeForcePushResult[]> =>
    unwrap(AdeService.ForcePush(args)).then((r) => trust<AdeForcePushResult[]>(r ?? [])),
  // §0.19: the Add popover's own three RPCs — candidates for the Existing-branch tab, the two
  // queue-writes for either tab. `AddNewWork` alone takes no `AdeCodeRepoArgs` wrapper on the Go
  // side (the args struct already carries `codeRepoId`), unlike `CandidateBranches`.
  adeCandidateBranches: (codeRepoId: string): Promise<AdeCandidateBranch[]> =>
    unwrap(AdeService.CandidateBranches({ codeRepoId })).then((r) =>
      trust<AdeCandidateBranch[]>(r ?? []),
    ),
  adeAddBranch: (args: AdeAddBranchArgs): Promise<string> =>
    unwrap(AdeService.AddBranch(args)).then((r) => trust<string>(r)),
  adeAddNewWork: (args: AdeAddNewWorkArgs): Promise<string> =>
    unwrap(AdeService.AddNewWork(args)).then((r) => trust<string>(r)),
  // P135 §4.5: the four dependency-node calls (creation tab, detail panel, blocker linking).
  adeAddDependency: (args: AdeAddDependencyArgs): Promise<string> =>
    unwrap(AdeService.AddDependency(args)).then((r) => trust<string>(r)),
  adeUpdateDependency: (args: AdeUpdateDependencyArgs): Promise<void> =>
    unwrap(AdeService.UpdateDependency(args)),
  adeResolveDependency: (args: AdeDependencyArgs): Promise<void> =>
    unwrap(AdeService.ResolveDependency(args)),
  adeSetBlocker: (args: AdeSetBlockerArgs): Promise<void> => unwrap(AdeService.SetBlocker(args)),
};

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
  ...spaceControl,
};
