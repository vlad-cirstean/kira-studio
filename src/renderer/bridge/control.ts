import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '@shared/domain/connection';
import type { Layout, LayoutPatch } from '@shared/domain/layout';
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
import type { SecretStorageStatus } from '@shared/domain/secrets';
import type { Settings, SettingsPatch } from '@shared/domain/settings';
import type { TabRecord } from '@shared/domain/tabs';
import type { TreeVisibility } from '@shared/domain/tree-filter';
import type {
  AppInfo,
  AppMetricsSample,
  ConnectionTestResult,
  EngineStatus,
  FilesChooseOpenArgs,
  FilesChooseOpenResult,
  FilesChooseSaveResult,
  TreeChildrenResult,
  TreeDefinitionResult,
  TreeDescribeResult,
} from '@shared/protocol/ipc';

const kira = window.kira;

// UI state is built from Vue `reactive()` objects, whose Proxy wrappers Electron's
// contextBridge cannot structured-clone across the isolated world ("An object could not be
// cloned"). Every payload built from renderer state is round-tripped through JSON here before
// crossing into `window.kira` — the one place this is needed, rather than every call site.
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const control = {
  appInfo: (): Promise<AppInfo> => kira.appInfo(),
  settingsGetAll: (): Promise<Settings> => kira.settingsGetAll(),
  settingsSet: (patch: SettingsPatch): Promise<Settings> => kira.settingsSet(plain(patch)),
  onSettingsChanged: (cb: (settings: Settings) => void): (() => void) => kira.onSettingsChanged(cb),
  layoutGetAll: (): Promise<Layout> => kira.layoutGetAll(),
  layoutSet: (patch: LayoutPatch): Promise<Layout> => kira.layoutSet(plain(patch)),
  engineStatus: (): Promise<EngineStatus> => kira.engineStatus(),
  onEngineState: (cb: (status: EngineStatus) => void): (() => void) => kira.onEngineState(cb),
  onOpenSettings: (cb: () => void): (() => void) => kira.onOpenSettings(cb),
  onNewConnection: (cb: () => void): (() => void) => kira.onNewConnection(cb),
  onToggleProjectPanel: (cb: () => void): (() => void) => kira.onToggleProjectPanel(cb),
  onToggleOperationsPanel: (cb: () => void): (() => void) => kira.onToggleOperationsPanel(cb),
  onCommandPalette: (cb: () => void): (() => void) => kira.onCommandPalette(cb),
  onTabNext: (cb: () => void): (() => void) => kira.onTabNext(cb),
  onTabPrev: (cb: () => void): (() => void) => kira.onTabPrev(cb),
  onTabClose: (cb: () => void): (() => void) => kira.onTabClose(cb),
  onViewFind: (cb: () => void): (() => void) => kira.onViewFind(cb),
  onViewRefresh: (cb: () => void): (() => void) => kira.onViewRefresh(cb),
  onViewRun: (cb: () => void): (() => void) => kira.onViewRun(cb),
  onViewRunAll: (cb: () => void): (() => void) => kira.onViewRunAll(cb),
  onFlushBeforeClose: (cb: () => void): (() => void) => kira.onFlushBeforeClose(cb),
  appFlushed: (): void => kira.appFlushed(),

  filesChooseSave: (defaultName: string): Promise<FilesChooseSaveResult> =>
    kira.filesChooseSave({ defaultName }),
  filesChooseOpen: (args?: FilesChooseOpenArgs): Promise<FilesChooseOpenResult> =>
    kira.filesChooseOpen(args),

  connectionsList: (): Promise<ConnectionSummary[]> => kira.connectionsList(),
  connectionsCreate: (input: ConnectionInput): Promise<ConnectionSummary> =>
    kira.connectionsCreate(plain(input)),
  connectionsUpdate: (id: string, input: ConnectionInput): Promise<ConnectionSummary> =>
    kira.connectionsUpdate(plain({ id, input })),
  connectionsDuplicate: (id: string): Promise<ConnectionSummary> =>
    kira.connectionsDuplicate({ id }),
  connectionsDelete: (id: string): Promise<void> => kira.connectionsDelete({ id }),
  connectionsReorder: (ids: string[]): Promise<ConnectionSummary[]> =>
    kira.connectionsReorder(plain({ ids })),
  connectionsReveal: (id: string): Promise<{ password: string | null; error: string | null }> =>
    kira.connectionsReveal({ id }),
  connectionsTest: (input: ConnectionInput): Promise<ConnectionTestResult> =>
    kira.connectionsTest(plain({ input })),
  connectionsConnect: (id: string): Promise<ConnectionState> => kira.connectionsConnect({ id }),
  connectionsDisconnect: (id: string): Promise<ConnectionState> =>
    kira.connectionsDisconnect({ id }),
  connectionsStates: (): Promise<ConnectionState[]> => kira.connectionsStates(),
  connectionsSecretsStatus: (): Promise<SecretStorageStatus> => kira.connectionsSecretsStatus(),
  onConnectionState: (cb: (state: ConnectionState) => void): (() => void) =>
    kira.onConnectionState(cb),
  onConnectionMetadataInvalidated: (cb: (connectionId: string) => void): (() => void) =>
    kira.onConnectionMetadataInvalidated(cb),
  onConnectionsChanged: (cb: (records: ConnectionSummary[]) => void): (() => void) =>
    kira.onConnectionsChanged(cb),

  treeChildren: (
    connectionId: string,
    path: string,
    refresh?: boolean,
  ): Promise<TreeChildrenResult> => kira.treeChildren({ connectionId, path, refresh }),
  treeDescribe: (
    connectionId: string,
    path: string,
    refresh?: boolean,
    tabId?: string,
  ): Promise<TreeDescribeResult> => kira.treeDescribe({ connectionId, path, refresh, tabId }),
  treeDefinition: (
    connectionId: string,
    path: string,
    refresh?: boolean,
    tabId?: string,
  ): Promise<TreeDefinitionResult> => kira.treeDefinition({ connectionId, path, refresh, tabId }),
  treeInvalidate: (connectionId: string, path?: string): Promise<void> =>
    kira.treeInvalidate({ connectionId, path }),

  filtersList: (connectionId: string): Promise<TreeVisibility> =>
    kira.filtersList({ connectionId }),
  filtersReplace: (connectionId: string, visibility: TreeVisibility): Promise<TreeVisibility> =>
    kira.filtersReplace(plain({ connectionId, visibility })),

  opsRecent: (limit: number): Promise<OpRecord[]> => kira.opsRecent({ limit }),
  opsCancel: (opId: string): Promise<void> => kira.opsCancel({ opId }),
  onOpUpdate: (cb: (record: OpRecord) => void): (() => void) => kira.onOpUpdate(cb),

  onAppMetrics: (cb: (sample: AppMetricsSample) => void): (() => void) => kira.onAppMetrics(cb),

  tabsList: (): Promise<TabRecord[]> => kira.tabsList(),
  tabsSave: (tabs: TabRecord[]): Promise<void> => kira.tabsSave(plain({ tabs })),

  queriesList: (connectionId: string, path: string): Promise<SavedFilterQuery[]> =>
    kira.queriesList({ connectionId, path }),
  queriesSave: (args: {
    connectionId: string;
    path: string;
    name: string;
    body: FilterBody;
    pinned: boolean;
  }): Promise<SavedFilterQuery> => kira.queriesSave(plain(args)),
  queriesListConsole: (connectionId: string, path: string): Promise<SavedConsoleQuery[]> =>
    kira.queriesListConsole({ connectionId, path }),
  queriesSaveConsole: (args: {
    connectionId: string;
    path: string;
    name: string;
    body: ConsoleBody;
    pinned: boolean;
  }): Promise<SavedConsoleQuery> => kira.queriesSaveConsole(plain(args)),
  queriesUpdate: (id: string, patch: { name?: string; pinned?: boolean }): Promise<SavedQuery> =>
    kira.queriesUpdate(plain({ id, ...patch })),
  queriesDelete: (id: string): Promise<void> => kira.queriesDelete({ id }),
  queriesTouch: (id: string): Promise<void> => kira.queriesTouch({ id }),
  queriesHistoryList: (
    connectionId: string,
    path: string,
    limit: number,
  ): Promise<FilterHistoryEntry[]> => kira.queriesHistoryList({ connectionId, path, limit }),
  queriesHistoryRecord: (
    connectionId: string,
    path: string,
    where: string | null,
    orderBy: SortSpec | null,
  ): Promise<void> => kira.queriesHistoryRecord(plain({ connectionId, path, where, orderBy })),
};
