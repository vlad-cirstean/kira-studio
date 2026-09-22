import * as AgentHooksService from '@bindings/agenthooksservice.js';
import * as AppService from '@bindings/appservice.js';
import * as ConnectionsService from '@bindings/connectionsservice.js';
import * as CustomScriptsService from '@bindings/customscriptsservice.js';
import * as DataGripService from '@bindings/datagripservice.js';
import * as DbMcpService from '@bindings/dbmcpservice.js';
import * as EngineService from '@bindings/engineservice.js';
import * as FilesService from '@bindings/filesservice.js';
import * as FiltersService from '@bindings/filtersservice.js';
import * as KeepAwakeService from '@bindings/keepawakeservice.js';
import * as LayoutService from '@bindings/layoutservice.js';
import * as LifecycleService from '@bindings/lifecycleservice.js';
import * as LinkService from '@bindings/linkservice.js';
import * as MaskRulesService from '@bindings/maskrulesservice.js';
import type * as WailsModels from '@bindings/models.js';
import * as OpsService from '@bindings/opsservice.js';
import * as QueriesService from '@bindings/queriesservice.js';
import * as SchemaService from '@bindings/schemaservice.js';
import * as SettingsService from '@bindings/settingsservice.js';
import * as TabsService from '@bindings/tabsservice.js';
import * as TerminalService from '@bindings/terminalservice.js';
import * as TreeService from '@bindings/treeservice.js';
import * as UpdateService from '@bindings/updateservice.js';
import * as WindowsService from '@bindings/windowsservice.js';
import type * as DataGripModels from '@bindings-internal/datagrip/models.js';
import type { AgentEvent, AgentSessionsEvent } from '@shared/domain/agent';
import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '@shared/domain/connection';
import type { DataGripPreview, DataGripReport } from '@shared/domain/datagrip';
import type { DbMcpApprovalSnapshot, DbMcpInstallResult, DbMcpStatus } from '@shared/domain/dbmcp';
import type { ObjectDefinition } from '@shared/domain/definition';
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
import type { ConnectionDdl } from '@shared/domain/schema';
import type { CustomScript, CustomScriptFields } from '@shared/domain/scripts';
import type { SecretStorageStatus } from '@shared/domain/secrets';
import type { Settings, SettingsPatch } from '@shared/domain/settings';
import type { TabRecord, TerminalLaunchKind } from '@shared/domain/tabs';
import type { ObjectMeta, RelationColumns, TreeNode } from '@shared/domain/tree';
import type { TreeVisibility } from '@shared/domain/tree-filter';
import { type AppMetricsSample, CHANNEL, type TerminalEvent } from '@shared/protocol/events';
import { on, trust, unwrap, windowKey } from '@workbench/bridge/rpc';
import { apiControl } from './apiControl';

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
  // P100 Part 2: onQuickOpen (CHANNEL.quickOpen) dropped — the repo workspace's Quick Open feature
  // (repo/QuickOpen.vue, repo/state/quickOpen.ts) moved to apps/kira-space wholesale, and this app's
  // own Go menu no longer emits the channel (internal/shell/menutemplate.go's own "Quick Open…"
  // item removed alongside it). CHANNEL.quickOpen itself stays in the shared protocol constants —
  // apps/kira-space's own copy of this bridge still binds it.
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

  // P86 §9.3: the Claude Code settings section's own status — AppInfo/UpdateStatus's own "just
  // unwrap, no trust()" shape (a Go-shaped one-way read with no zod schema of its own), not
  // DbMcpStatus's: this status carries no secret worth a documented widen-then-narrow, just a
  // bool and a path.
  agentHooksStatus: (): Promise<WailsModels.AgentHooksStatus> => unwrap(AgentHooksService.Status()),
  agentHooksSetEnabled: (enabled: boolean): Promise<WailsModels.AgentHooksStatus> =>
    unwrap(AgentHooksService.SetEnabled({ enabled })),

  // P87 §7.2: the titlebar keep-awake toggle and the agent-aware Settings leaf — agentHooksStatus's
  // own "just unwrap, no trust()" shape (a bool, a bool and a string, nothing secret).
  keepAwakeStatus: (): Promise<WailsModels.KeepAwakeStatus> => unwrap(KeepAwakeService.Status()),
  keepAwakeSetManual: (enabled: boolean): Promise<WailsModels.KeepAwakeStatus> =>
    unwrap(KeepAwakeService.SetManual({ enabled })),
  keepAwakeSetAgentAware: (enabled: boolean): Promise<WailsModels.KeepAwakeStatus> =>
    unwrap(KeepAwakeService.SetAgentAware({ enabled })),
  onKeepAwakeChanged: (cb: (s: WailsModels.KeepAwakeStatus) => void): (() => void) =>
    on(CHANNEL.keepAwake, cb),

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
  // P92 item 3: the title bar's "New window" button.
  windowsOpenNew: (): Promise<void> => unwrap(WindowsService.OpenNew()),

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

  // P91 §7: the Terminal module's own unscoped-launch default — the user's home directory,
  // hydrated once at boot (state/terminals.ts's hydrateTerminalDefaults).
  terminalDefaultCwd: (): Promise<{ path: string }> =>
    unwrap(TerminalService.DefaultCwd()).then((r) => trust<{ path: string }>(r)),
  // P83 §3.2: the embedded terminal's own bound surface — terminalId is client-supplied (the tab
  // id) so state/terminals.ts subscribes to onTerminal before this call returns, and no output can
  // race the subscription. windowKey addresses ChannelTerminal at this window only, exactly like
  // codeWorkspaceStartSearch. P86 §4: launchKind forwards to TerminalOpenArgs.LaunchKind as-is.
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
  // data is base64 — keystrokes are not always valid UTF-8 (paste, Alt-meta, mouse reports).
  terminalWrite: (terminalId: string, data: string): Promise<void> =>
    unwrap(TerminalService.Write({ terminalId, data })),
  terminalResize: (terminalId: string, cols: number, rows: number): Promise<void> =>
    unwrap(TerminalService.Resize({ terminalId, cols, rows })),
  terminalClose: (terminalId: string): Promise<void> =>
    unwrap(TerminalService.Close({ terminalId })),
  onTerminal: (cb: (event: TerminalEvent) => void): (() => void) => on(CHANNEL.terminal, cb),

  // P86 §11/§12: every live Claude Code session across every window — the boot-time hydrate for a
  // window opened after sessions already started (ChannelAgentSessions only fires on change), plus
  // the broadcast subscription. Emit, not EmitTo (customScriptsChanged's own shape): the count is
  // app-wide by definition, so this is not windowKey-addressed.
  terminalAgentSessions: (): Promise<AgentSessionsEvent> =>
    unwrap(TerminalService.AgentSessions()).then((r) => trust<AgentSessionsEvent>(r)),
  onAgentSessions: (cb: (event: AgentSessionsEvent) => void): (() => void) =>
    on(CHANNEL.agentSessions, cb),
  // P86 §8.4: one hook firing for one tab — state/agentSessions.ts's reducer is the one
  // subscriber, filtering by terminalId against tabs this window owns.
  onAgentEvent: (cb: (event: AgentEvent) => void): (() => void) => on(CHANNEL.agentEvent, cb),

  // P85 §9.3: the Scripts settings section and the tab strip's own dropdown both go through
  // state/customScripts.ts, the one store that wraps these.
  customScriptsList: (): Promise<CustomScript[]> =>
    unwrap(CustomScriptsService.List()).then((r) => trust<CustomScript[]>(r ?? [])),
  customScriptsCreate: (fields: CustomScriptFields): Promise<CustomScript> =>
    unwrap(CustomScriptsService.Create({ fields })).then((r) => trust<CustomScript>(r)),
  customScriptsUpdate: (id: string, fields: CustomScriptFields): Promise<CustomScript> =>
    unwrap(CustomScriptsService.Update({ id, fields })).then((r) => trust<CustomScript>(r)),
  customScriptsRemove: (id: string): Promise<void> => unwrap(CustomScriptsService.Remove({ id })),
  onCustomScriptsChanged: (cb: (scripts: CustomScript[]) => void): (() => void) =>
    on(CHANNEL.customScriptsChanged, cb),
};

// P12 D11: one exported object, composed from Studio's 67 methods and the module's own 39
// (apiControl.ts) — every one of the ~200 `control.xxx()` call sites in the app is unchanged, and
// mockRuntime.ts's channel map is unchanged, since neither the method names nor their bound-call
// FQNs moved.
export const control = { ...studioControl, ...apiControl };
