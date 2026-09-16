import * as AppService from '@bindings/appservice.js';
import * as CodeWorkspaceService from '@bindings/codeworkspaceservice.js';
import * as ConnectionsService from '@bindings/connectionsservice.js';
import * as DataGripService from '@bindings/datagripservice.js';
import * as DbMcpService from '@bindings/dbmcpservice.js';
import * as EngineService from '@bindings/engineservice.js';
import * as FilesService from '@bindings/filesservice.js';
import * as FiltersService from '@bindings/filtersservice.js';
import * as GitClientsService from '@bindings/gitclientsservice.js';
import * as GitHubService from '@bindings/githubservice.js';
import * as LayoutService from '@bindings/layoutservice.js';
import * as LifecycleService from '@bindings/lifecycleservice.js';
import * as LinkService from '@bindings/linkservice.js';
import * as MaskRulesService from '@bindings/maskrulesservice.js';
import type * as WailsModels from '@bindings/models.js';
import * as OpsService from '@bindings/opsservice.js';
import * as QueriesService from '@bindings/queriesservice.js';
import * as RepoMapService from '@bindings/repomapservice.js';
import * as SchemaService from '@bindings/schemaservice.js';
import * as SettingsService from '@bindings/settingsservice.js';
import * as TabsService from '@bindings/tabsservice.js';
import * as TerminalService from '@bindings/terminalservice.js';
import * as TreeService from '@bindings/treeservice.js';
import * as UpdateService from '@bindings/updateservice.js';
import * as WindowsService from '@bindings/windowsservice.js';
import type * as DataGripModels from '@bindings-internal/datagrip/models.js';
import type { HeadState } from '@kira/git-ipc';
import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '@shared/domain/connection';
import type { DataGripPreview, DataGripReport } from '@shared/domain/datagrip';
import type { DbMcpApprovalSnapshot, DbMcpInstallResult, DbMcpStatus } from '@shared/domain/dbmcp';
import type { ObjectDefinition } from '@shared/domain/definition';
import type {
  GitClient,
  GitPairingActionResult,
  GitPairingSnapshot,
  GitVsixInstallResult,
  GitVsixStatus,
} from '@shared/domain/git';
import type { Layout, LayoutPatch } from '@shared/domain/layout';
import type { MaskRule, MaskRuleFields } from '@shared/domain/mask';
import type { AppMode } from '@shared/domain/mode';
import type { OpRecord } from '@shared/domain/ops';
import type {
  ConsoleBody,
  FilterBody,
  FilterHistoryEntry,
  SavedConsoleQuery,
  SavedFilterQuery,
  SavedQuery,
  SortSpec,
} from '@shared/domain/queries';
import type {
  CodeSearchEvent,
  DiffContent,
  FileContent,
  FileListing,
  NavResult,
  RefResult,
  RepoSummary,
  SearchRequest,
} from '@shared/domain/repo';
import type { RepoMapInstallResult, RepoMapStatus } from '@shared/domain/repomap';
import type { ConnectionDdl } from '@shared/domain/schema';
import type { SecretStorageStatus } from '@shared/domain/secrets';
import type { Settings, SettingsPatch } from '@shared/domain/settings';
import type { TabRecord } from '@shared/domain/tabs';
import type { ObjectMeta, RelationColumns, TreeNode } from '@shared/domain/tree';
import type { TreeVisibility } from '@shared/domain/tree-filter';
import { type AppMetricsSample, CHANNEL, type TerminalEvent } from '@shared/protocol/events';
import { apiControl } from './apiControl';
import { on, trust, unwrap, windowKey } from './rpc';

// bridge/index.ts is the composition root (round-1 review finding 19): the only file that imports
// both halves — Studio's own 67-method surface, defined right here, and the Api module's 39
// (apiControl.ts) — and combines them into the one `control` object every other file in the app
// imports. Neither half imports the other; both depend only on rpc.ts's shared on/trust/unwrap/
// windowKey. control.ts itself is now a thin re-export of this module, so every existing
// `import { control } from '.../bridge/control'` call site (~200 of them) is unchanged.
const studioControl = {
  appInfo: (): Promise<WailsModels.AppInfo> => unwrap(AppService.Info()),
  updateStatus: (): Promise<WailsModels.UpdateStatus> => unwrap(UpdateService.Status()),
  updateOpenReleasePage: (): Promise<void> => unwrap(UpdateService.OpenReleasePage()),
  // P74 §3.3: pr.openExternal's own OS-browser leg — the renderer names a PR by number over the
  // git socket (pr.browserUrl composes the URL server-side); this is only the final "open it" hop.
  githubOpenPullRequestUrl: (url: string): Promise<void> =>
    unwrap(GitHubService.OpenPullRequestURL({ url })),
  // P79 finding 4: link.openExternal's own OS-browser leg — linkify.ts's message-body URLs are
  // untrusted renderer-visible text (unlike a PR URL), so LinkService.OpenExternal validates the
  // URL's own shape (a well-formed http(s) URL) rather than composing or re-checking a host.
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
  engineStatus: (): Promise<WailsModels.EngineStatus> => unwrap(EngineService.Status()),
  onOpenSettings: (cb: () => void): (() => void) => on(CHANNEL.openSettings, cb),
  onNewConnection: (cb: () => void): (() => void) => on(CHANNEL.newConnection, cb),
  onNewRequest: (cb: () => void): (() => void) => on(CHANNEL.newRequest, cb),
  onImportPostman: (cb: () => void): (() => void) => on(CHANNEL.importPostman, cb),
  onImportDataGrip: (cb: () => void): (() => void) => on(CHANNEL.importDataGrip, cb),
  onToggleProjectPanel: (cb: () => void): (() => void) => on(CHANNEL.toggleProjectPanel, cb),
  onToggleOperationsPanel: (cb: () => void): (() => void) => on(CHANNEL.toggleOperationsPanel, cb),
  onCommandPalette: (cb: () => void): (() => void) => on(CHANNEL.commandPalette, cb),
  onQuickOpen: (cb: () => void): (() => void) => on(CHANNEL.quickOpen, cb),
  onTabNext: (cb: () => void): (() => void) => on(CHANNEL.tabNext, cb),
  onTabPrev: (cb: () => void): (() => void) => on(CHANNEL.tabPrev, cb),
  onTabClose: (cb: () => void): (() => void) => on(CHANNEL.tabClose, cb),
  onViewFind: (cb: () => void): (() => void) => on(CHANNEL.viewFind, cb),
  onViewRefresh: (cb: () => void): (() => void) => on(CHANNEL.viewRefresh, cb),
  onViewRun: (cb: () => void): (() => void) => on(CHANNEL.viewRun, cb),
  onViewRunAll: (cb: () => void): (() => void) => on(CHANNEL.viewRunAll, cb),
  onViewFormat: (cb: () => void): (() => void) => on(CHANNEL.viewFormat, cb),
  // Quit handshake: main holds `before-quit` until every window acks this (P8 C8: every window,
  // not just the first to ack), so a debounced save still pending when the user quits is never
  // silently lost.
  onFlushBeforeClose: (cb: () => void): (() => void) => on(CHANNEL.appFlushBeforeClose, cb),
  appFlushed: (): void => {
    void LifecycleService.Flushed({ windowKey });
  },
  // Close-window handshake (P8 C6/F8): the single-window analogue of the quit handshake above —
  // this window's own close is held until it acks, or a 2s timeout on the Go side gives up.
  onWindowFlushBeforeClose: (cb: () => void): (() => void) =>
    on(CHANNEL.windowFlushBeforeClose, cb),
  windowFlushed: (): void => {
    void LifecycleService.WindowFlushed({ windowKey });
  },

  filesChooseSave: (defaultName: string): Promise<WailsModels.FilesChooseSaveResult> =>
    unwrap(FilesService.ChooseSave({ defaultName })),
  filesChooseOpen: (
    args?: WailsModels.FilesChooseOpenArgs,
  ): Promise<WailsModels.FilesChooseOpenResult> => unwrap(FilesService.ChooseOpen(args ?? {})),
  // P25 D13: the same "" means cancelled" convention as filesChooseOpen/filesChooseSave.
  filesChooseFolder: (title?: string): Promise<WailsModels.FilesChooseFolderResult> =>
    unwrap(FilesService.ChooseFolder({ title: title ?? '' })),

  connectionsList: (): Promise<ConnectionSummary[]> =>
    unwrap(ConnectionsService.List()).then((r) => trust<ConnectionSummary[]>(r ?? [])),
  connectionsCreate: (input: ConnectionInput): Promise<ConnectionSummary> =>
    unwrap(ConnectionsService.Create(input)).then((r) => trust<ConnectionSummary>(r)),
  connectionsUpdate: (id: string, input: ConnectionInput): Promise<ConnectionSummary> =>
    unwrap(ConnectionsService.Update({ id, input })).then((r) => trust<ConnectionSummary>(r)),
  connectionsDuplicate: (id: string): Promise<ConnectionSummary> =>
    unwrap(ConnectionsService.Duplicate({ id })).then((r) => trust<ConnectionSummary>(r)),
  // Go-side name is Remove, not Delete (P57 §1.9) — read the .go file, do not assume lowerCamel.
  connectionsDelete: (id: string): Promise<void> => unwrap(ConnectionsService.Remove({ id })),
  connectionsReorder: (ids: string[]): Promise<ConnectionSummary[]> =>
    unwrap(ConnectionsService.Reorder({ ids })).then((r) => trust<ConnectionSummary[]>(r ?? [])),
  // P14 D6: outcome is one of revealed | cancelled | confirmation-required | error — confirmed is
  // honoured by the backend only on the confirmation-required path (a Mac where LocalAuthentication
  // works ignores it entirely).
  connectionsReveal: (
    id: string,
    confirmed: boolean,
  ): Promise<{ password: string | null; error: string | null; outcome: string }> =>
    unwrap(ConnectionsService.Reveal({ id, confirmed })),
  // The generated TestResult's serverVersion/error are `string | null | undefined`; the pre-P57
  // shape was `string | undefined` only (no null) — normalized here rather than pushed onto
  // ConnectionDialog.vue, which assigns straight into its own `?: string` reactive state.
  // P14 D3: id is the dialog's editingId (empty for a brand-new connection) — the backend fills in
  // the stored secret server-side when the draft carries none, so Test on an existing connection
  // whose password field was never revealed still probes with the real credential.
  connectionsTest: (
    input: ConnectionInput,
    id: string,
  ): Promise<{
    ok: boolean;
    serverVersion?: string;
    error?: string;
  }> =>
    unwrap<Awaited<ReturnType<typeof ConnectionsService.Test>>>(
      ConnectionsService.Test({ input, id }),
    ).then((r) => ({
      ok: r.ok,
      serverVersion: r.serverVersion ?? undefined,
      error: r.error ?? undefined,
    })),
  connectionsConnect: (id: string): Promise<ConnectionState> =>
    unwrap(ConnectionsService.Connect({ id })).then((r) => trust<ConnectionState>(r)),
  connectionsDisconnect: (id: string): Promise<ConnectionState> =>
    unwrap(ConnectionsService.Disconnect({ id })).then((r) => trust<ConnectionState>(r)),
  connectionsStates: (): Promise<ConnectionState[]> =>
    unwrap(ConnectionsService.States()).then((r) => trust<ConnectionState[]>(r ?? [])),
  connectionsSecretsStatus: (): Promise<SecretStorageStatus> =>
    unwrap(ConnectionsService.SecretsStatus()).then((r) => trust<SecretStorageStatus>(r)),

  // M5 §7.2/§9: the Privacy tab, the grid header menu, and the grid preview's own local tag
  // computation all share these — see state/maskRules.ts for the one store that wraps them.
  maskRulesList: (connectionId: string): Promise<MaskRule[]> =>
    unwrap(MaskRulesService.List({ connectionId })).then((r) => trust<MaskRule[]>(r ?? [])),
  // The generated MaskRuleFields.kind is a TS `enum` (wails3's binding generator turns Go's named
  // MaskKind consts into one, unlike this app's other string-const-typed fields, which stay plain
  // `string`) — a plain string-literal object is not structurally assignable to it, so this widens
  // at the call boundary the same documented way `trust` narrows on the way out (rpc.ts's own
  // comment): the Go value is always one of the valid members regardless of which TS shape names it.
  maskRulesUpsert: (connectionId: string, fields: MaskRuleFields): Promise<MaskRule> =>
    unwrap(
      MaskRulesService.Upsert({
        connectionId,
        fields,
      } as unknown as Parameters<typeof MaskRulesService.Upsert>[0]),
    ).then((r) => trust<MaskRule>(r)),
  maskRulesRemove: (id: string): Promise<void> => unwrap(MaskRulesService.Remove({ id })),
  maskRulesRegenerateKey: (connectionId: string): Promise<void> =>
    unwrap(MaskRulesService.RegenerateKey({ connectionId })),
  maskRulesCounts: (): Promise<Record<string, number>> =>
    unwrap(MaskRulesService.Counts()).then((r) => trust<Record<string, number>>(r ?? {})),
  // §6.3: the raw correlation key, hex-encoded — the one seam that sends it to the renderer, for
  // the grid preview's own local tag computation. "" means the connection needs no key.
  maskRulesCorrelationKey: (connectionId: string): Promise<string> =>
    unwrap(MaskRulesService.CorrelationKey({ connectionId })),
  onConnectionState: (cb: (state: ConnectionState) => void): (() => void) =>
    on(CHANNEL.connectionState, cb),
  onConnectionMetadataInvalidated: (cb: (connectionId: string) => void): (() => void) =>
    on(CHANNEL.connectionMetadataInvalidated, cb),
  onConnectionsChanged: (cb: (records: ConnectionSummary[]) => void): (() => void) =>
    on(CHANNEL.connectionsChanged, cb),

  // P25 D9: only the project path crosses the bridge either way — Scan never touches a
  // credential store (file reads only), Import fetches and decrypts a password only inside Go,
  // and neither ever returns one to the renderer.
  datagripScan: (path: string): Promise<DataGripPreview> =>
    unwrap<DataGripModels.Preview>(DataGripService.Scan({ path })).then((r) =>
      trust<DataGripPreview>({
        ...r,
        rows: (r.rows ?? []).map((row) => ({ ...row, warnings: row.warnings ?? [] })),
      }),
    ),
  datagripImport: (path: string, selectedUuids: string[]): Promise<DataGripReport> =>
    unwrap<DataGripModels.Report>(DataGripService.Import({ path, selectedUuids })).then((r) =>
      trust<DataGripReport>({ ...r, rows: r.rows ?? [] }),
    ),

  treeChildren: (
    connectionId: string,
    path: string,
    refresh?: boolean,
  ): Promise<{ nodes: TreeNode[]; source: 'cache' | 'server'; truncated: boolean }> =>
    unwrap<Awaited<ReturnType<typeof TreeService.Children>>>(
      TreeService.Children({ connectionId, path, refresh: refresh ?? false }),
    ).then((r) =>
      trust<{ nodes: TreeNode[]; source: 'cache' | 'server'; truncated: boolean }>({
        ...r,
        nodes: r.nodes ?? [],
      }),
    ),
  // P63 §4.3: a batch of paths, answered with each one's engine-level type, in order — Redis
  // only (Caps().keyTypes gates every call site; every other adapter would just throw).
  treeKeyTypes: (connectionId: string, paths: string[]): Promise<string[]> =>
    unwrap<Awaited<ReturnType<typeof TreeService.KeyTypes>>>(
      TreeService.KeyTypes({ connectionId, paths }),
    ).then((r) => trust<string[]>(r ?? [])),
  treeDescribe: (
    connectionId: string,
    path: string,
    refresh?: boolean,
    tabId?: string,
  ): Promise<{ meta: ObjectMeta; source: 'cache' | 'server' }> =>
    unwrap(
      TreeService.Describe({
        connectionId,
        path,
        refresh: refresh ?? false,
        tabId: tabId ?? null,
      }),
    ).then((r) => trust<{ meta: ObjectMeta; source: 'cache' | 'server' }>(r)),
  treeDefinition: (
    connectionId: string,
    path: string,
    refresh?: boolean,
    tabId?: string,
  ): Promise<{ definition: ObjectDefinition; source: 'cache' | 'server' }> =>
    unwrap(
      TreeService.Definition({
        connectionId,
        path,
        refresh: refresh ?? false,
        tabId: tabId ?? null,
      }),
    ).then((r) => trust<{ definition: ObjectDefinition; source: 'cache' | 'server' }>(r)),
  // P22c D3: SchemaColumns' own bridge call — args reuse Describe/Definition's own four-field
  // shape (tabId unused: a schema-wide fetch is not tagged to one tab's op-log row).
  treeSchemaColumns: (
    connectionId: string,
    path: string,
    refresh?: boolean,
  ): Promise<{ relations: RelationColumns[]; source: 'cache' | 'server' }> =>
    unwrap<Awaited<ReturnType<typeof TreeService.SchemaColumns>>>(
      TreeService.SchemaColumns({
        connectionId,
        path,
        refresh: refresh ?? false,
        tabId: null,
      }),
    ).then((r) =>
      trust<{ relations: RelationColumns[]; source: 'cache' | 'server' }>({
        ...r,
        relations: r.relations ?? [],
      }),
    ),
  treeInvalidate: (connectionId: string, path?: string): Promise<void> =>
    unwrap(TreeService.Invalidate({ connectionId, path: path ?? null })),

  filtersList: (connectionId: string): Promise<TreeVisibility> =>
    unwrap(FiltersService.List({ connectionId })).then((r) => trust<TreeVisibility>(r)),
  filtersReplace: (connectionId: string, visibility: TreeVisibility): Promise<TreeVisibility> =>
    unwrap(FiltersService.Replace({ connectionId, visibility })).then((r) =>
      trust<TreeVisibility>(r),
    ),

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

  repoMapStatus: (): Promise<RepoMapStatus> =>
    unwrap(RepoMapService.Status()).then((r) => trust<RepoMapStatus>(r)),
  repoMapSetEnabled: (enabled: boolean): Promise<RepoMapStatus> =>
    unwrap(RepoMapService.SetEnabled({ enabled })).then((r) => trust<RepoMapStatus>(r)),
  repoMapSetRepoEnabled: (id: string, enabled: boolean): Promise<RepoMapStatus> =>
    unwrap(RepoMapService.SetRepoEnabled({ id, enabled })).then((r) => trust<RepoMapStatus>(r)),
  repoMapRegenerate: (): Promise<RepoMapStatus> =>
    unwrap(RepoMapService.Regenerate()).then((r) => trust<RepoMapStatus>(r)),
  repoMapInstallClaudeCode: (): Promise<RepoMapInstallResult> =>
    unwrap(RepoMapService.InstallClaudeCode()).then((r) => trust<RepoMapInstallResult>(r)),

  dbMcpStatus: (): Promise<DbMcpStatus> =>
    unwrap(DbMcpService.Status()).then((r) => trust<DbMcpStatus>(r)),
  dbMcpSetEnabled: (enabled: boolean): Promise<DbMcpStatus> =>
    unwrap(DbMcpService.SetEnabled({ enabled })).then((r) => trust<DbMcpStatus>(r)),
  dbMcpRegenerate: (): Promise<DbMcpStatus> =>
    unwrap(DbMcpService.Regenerate()).then((r) => trust<DbMcpStatus>(r)),
  dbMcpInstallClaudeCode: (): Promise<DbMcpInstallResult> =>
    unwrap(DbMcpService.InstallClaudeCode()).then((r) => trust<DbMcpInstallResult>(r)),
  dbMcpPendingApprovals: (): Promise<DbMcpApprovalSnapshot> =>
    unwrap(DbMcpService.PendingApprovals()).then((r) => trust<DbMcpApprovalSnapshot>(r)),
  dbMcpApproveQuery: (requestId: string): Promise<DbMcpApprovalSnapshot> =>
    unwrap(DbMcpService.ApproveQuery({ requestId })).then((r) => trust<DbMcpApprovalSnapshot>(r)),
  dbMcpDenyQuery: (requestId: string): Promise<DbMcpApprovalSnapshot> =>
    unwrap(DbMcpService.DenyQuery({ requestId })).then((r) => trust<DbMcpApprovalSnapshot>(r)),
  onDbMcpApprovalChanged: (cb: (snap: DbMcpApprovalSnapshot) => void): (() => void) =>
    on(CHANNEL.dbMcpApproval, cb),

  opsRecent: (limit: number): Promise<OpRecord[]> =>
    unwrap(OpsService.Recent({ limit })).then((r) => trust<OpRecord[]>(r ?? [])),
  opsCancel: (opId: string): Promise<void> => unwrap(OpsService.Cancel({ opId })),
  onOpUpdate: (cb: (record: OpRecord) => void): (() => void) => on(CHANNEL.opUpdate, cb),

  onAppMetrics: (cb: (sample: AppMetricsSample) => void): (() => void) =>
    on(CHANNEL.appMetrics, cb),

  // windowsEnsure registers this page's own windowKey with a `windows` row if it doesn't already
  // have one — always a no-op on the native shell (main.go's own window-creation paths already
  // created it before this page's URL ever loaded, D2), and the only thing that ever does on a
  // `-tags server` build, which has no shell managing window creation at all. bootstrap() in
  // main.ts awaits this before hydrateTabs() (or anything else window-scoped) runs.
  // P22 D12: also returns this window's own persisted mode — the boot-time seam
  // state/mode.ts's hydrateMode reads, rather than a second round trip.
  windowsEnsure: (): Promise<AppMode> =>
    unwrap(WindowsService.Ensure({ windowKey })).then((r) =>
      trust<AppMode>(trust<WailsModels.WindowsEnsureResult>(r).mode),
    ),
  windowsSetMode: (mode: AppMode): Promise<void> =>
    unwrap(WindowsService.SetMode({ windowKey, mode })),

  // Both scoped to this page's own workbench (P8 D2/F6) — windowKey is read once, synchronously,
  // at module load (state/window.ts), before hydrateTabs() ever calls tabsList().
  tabsList: (): Promise<TabRecord[]> =>
    unwrap(TabsService.List({ windowKey })).then((r) => trust<TabRecord[]>(r ?? [])),
  tabsSave: (tabs: TabRecord[]): Promise<void> => unwrap(TabsService.Save({ windowKey, tabs })),

  // Go's SavedQuery is one flat struct with `kind: string` and `body: json.RawMessage` (typed
  // `any` in the bindings) rather than the domain's real discriminated union — Go has no sum
  // types, so the polymorphic body is opaque JSON on the wire and the discriminant is a plain
  // string. `trust` narrows both at once, on the same "the server always writes a valid shape"
  // assumption the Electron build made implicitly.
  queriesList: (connectionId: string, path: string): Promise<SavedFilterQuery[]> =>
    unwrap(QueriesService.List({ connectionId, path })).then((r) =>
      trust<SavedFilterQuery[]>(r ?? []),
    ),
  queriesSave: (args: {
    connectionId: string;
    path: string;
    name: string;
    body: FilterBody;
    pinned: boolean;
  }): Promise<SavedFilterQuery> =>
    unwrap(QueriesService.Save(args)).then((r) => trust<SavedFilterQuery>(r)),
  queriesListConsole: (connectionId: string, path: string): Promise<SavedConsoleQuery[]> =>
    unwrap(QueriesService.ListConsole({ connectionId, path })).then((r) =>
      trust<SavedConsoleQuery[]>(r ?? []),
    ),
  queriesSaveConsole: (args: {
    connectionId: string;
    path: string;
    name: string;
    body: ConsoleBody;
    pinned: boolean;
  }): Promise<SavedConsoleQuery> =>
    unwrap(QueriesService.SaveConsole(args)).then((r) => trust<SavedConsoleQuery>(r)),
  queriesUpdate: (id: string, patch: { name?: string; pinned?: boolean }): Promise<SavedQuery> =>
    unwrap(
      QueriesService.Update({ id, name: patch.name ?? null, pinned: patch.pinned ?? null }),
    ).then((r) => trust<SavedQuery>(r)),
  queriesDelete: (id: string): Promise<void> => unwrap(QueriesService.Delete({ id })),
  queriesTouch: (id: string): Promise<void> => unwrap(QueriesService.Touch({ id })),
  queriesHistoryList: (
    connectionId: string,
    path: string,
    limit: number,
  ): Promise<FilterHistoryEntry[]> =>
    unwrap(QueriesService.HistoryList({ connectionId, path, limit })).then((r) =>
      trust<FilterHistoryEntry[]>(r ?? []),
    ),
  queriesHistoryRecord: (
    connectionId: string,
    path: string,
    where: string | null,
    orderBy: SortSpec | null,
  ): Promise<void> => unwrap(QueriesService.HistoryRecord({ connectionId, path, where, orderBy })),

  schemaGet: (connectionId: string): Promise<ConnectionDdl> =>
    unwrap(SchemaService.Get({ connectionId })).then((r) => trust<ConnectionDdl>(r)),
  schemaSet: (connectionId: string, ddl: string): Promise<ConnectionDdl> =>
    unwrap(SchemaService.Set({ connectionId, ddl })).then((r) => trust<ConnectionDdl>(r)),
  onSchemaChanged: (cb: (ddl: ConnectionDdl) => void): (() => void) =>
    on(CHANNEL.schemaChanged, cb),

  // C5 §3.3: the native code-viewing workspace's bound surface — repo import/rename/remove plus
  // the two read primitives (ListFiles/ReadFile). A rejected ImportRepo/RenameRepo call carries a
  // structured ipcerr (E_INVALID/E_ALREADY_IMPORTED/E_NOT_FOUND/E_GIT_UNAVAILABLE) that unwrap()
  // already turns into a rejected promise — every call site here just lets it propagate.
  codeWorkspaceListRepos: (): Promise<RepoSummary[]> =>
    unwrap(CodeWorkspaceService.ListRepos()).then((r) => trust<RepoSummary[]>(r ?? [])),
  // P83 plan §12.2: every imported repository's checked-out branch in one batched call — GitPanel
  // .vue's own repo-row label. `ids` omitted answers every row; repo/state/repoHeads.ts's
  // refsChanged trigger passes one id to refresh a single row instead.
  codeWorkspaceRepoHeads: (
    ids?: string[],
  ): Promise<Array<{ id: string; head: HeadState | null; error?: string }>> =>
    unwrap(CodeWorkspaceService.RepoHeads({ ids: ids ?? null })).then((r) =>
      trust<Array<{ id: string; head: HeadState | null; error?: string }>>(r ?? []),
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

  // C6 §7/§8.5: the index lifecycle (fire-and-forget from the renderer's own point of view — a
  // failed start/stop must never block opening or leaving a workspace) plus the diff/navigation
  // reads.
  codeWorkspaceOpenWorkspace: (id: string): Promise<void> =>
    unwrap(CodeWorkspaceService.OpenWorkspace({ id })),
  codeWorkspaceCloseWorkspace: (id: string): Promise<void> =>
    unwrap(CodeWorkspaceService.CloseWorkspace({ id })),
  codeWorkspaceReadDiff: (id: string, path: string): Promise<DiffContent> =>
    unwrap(CodeWorkspaceService.ReadDiff({ id, path })).then((r) => trust<DiffContent>(r)),
  codeWorkspaceDefinitions: (
    id: string,
    path: string,
    line: number,
    column: number,
  ): Promise<NavResult> =>
    unwrap<Awaited<ReturnType<typeof CodeWorkspaceService.Definitions>>>(
      CodeWorkspaceService.Definitions({ id, path, line, column }),
    ).then((r) => trust<NavResult>({ ...r, targets: r.targets ?? [] })),
  // P78 §7.2/§8.2: Definitions's own structural sibling — Implementations answers the same wire
  // shape (NavResult), Go included now that Part B's method-set matching lands.
  codeWorkspaceImplementations: (
    id: string,
    path: string,
    line: number,
    column: number,
  ): Promise<NavResult> =>
    unwrap<Awaited<ReturnType<typeof CodeWorkspaceService.Implementations>>>(
      CodeWorkspaceService.Implementations({ id, path, line, column }),
    ).then((r) => trust<NavResult>({ ...r, targets: r.targets ?? [] })),
  // P78 §7.2/§8.1: includeDeclaration maps straight to Monaco's own
  // ReferenceContext.includeDeclaration.
  codeWorkspaceReferences: (
    id: string,
    path: string,
    line: number,
    column: number,
    includeDeclaration: boolean,
  ): Promise<RefResult> =>
    unwrap<Awaited<ReturnType<typeof CodeWorkspaceService.References>>>(
      CodeWorkspaceService.References({ id, path, line, column, includeDeclaration }),
    ).then((r) => trust<RefResult>({ ...r, sites: r.sites ?? [] })),

  // C7 §5/D7: StartSearch returns as soon as the background scan starts — its own searchId is how
  // the renderer matches a later onCodeSearch event to the run that's waiting on it. windowKey
  // addresses the coalesced push channel at this window only, exactly like grpcCall.
  codeWorkspaceStartSearch: (id: string, req: SearchRequest): Promise<{ searchId: string }> =>
    unwrap(CodeWorkspaceService.StartSearch({ id, windowKey, ...req })).then((r) =>
      trust<{ searchId: string }>(r),
    ),
  codeWorkspaceCancelSearch: (id: string): Promise<void> =>
    unwrap(CodeWorkspaceService.CancelSearch({ id })),
  onCodeSearch: (cb: (event: CodeSearchEvent) => void): (() => void) => on(CHANNEL.codeSearch, cb),

  // P83 §3.2: the embedded terminal's own bound surface — terminalId is client-supplied (the tab
  // id) so state/terminals.ts subscribes to onTerminal before this call returns, and no output can
  // race the subscription. windowKey addresses ChannelTerminal at this window only, exactly like
  // codeWorkspaceStartSearch.
  terminalOpen: (
    terminalId: string,
    cwd: string,
    cols: number,
    rows: number,
  ): Promise<{ shell: string }> =>
    unwrap(TerminalService.Open({ terminalId, cwd, cols, rows, windowKey })).then((r) =>
      trust<{ shell: string }>(r),
    ),
  // data is base64 — keystrokes are not always valid UTF-8 (paste, Alt-meta, mouse reports).
  terminalWrite: (terminalId: string, data: string): Promise<void> =>
    unwrap(TerminalService.Write({ terminalId, data })),
  terminalResize: (terminalId: string, cols: number, rows: number): Promise<void> =>
    unwrap(TerminalService.Resize({ terminalId, cols, rows })),
  terminalClose: (terminalId: string): Promise<void> =>
    unwrap(TerminalService.Close({ terminalId })),
  onTerminal: (cb: (event: TerminalEvent) => void): (() => void) => on(CHANNEL.terminal, cb),
};

// P12 D11: one exported object, composed from Studio's 67 methods and the module's own 39
// (apiControl.ts) — every one of the ~200 `control.xxx()` call sites in the app is unchanged, and
// mockRuntime.ts's channel map is unchanged, since neither the method names nor their bound-call
// FQNs moved.
export const control = { ...studioControl, ...apiControl };
