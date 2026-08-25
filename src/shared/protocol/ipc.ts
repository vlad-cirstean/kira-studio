import type { ConnectionInput, ConnectionState, ConnectionSummary } from '../domain/connection';
import type { ObjectDefinition } from '../domain/definition';
import type { Layout, LayoutPatch } from '../domain/layout';
import type { OpRecord } from '../domain/ops';
import type {
  ConsoleBody,
  FilterBody,
  FilterHistoryEntry,
  SavedConsoleQuery,
  SavedFilterQuery,
  SavedQuery,
  SortSpec,
} from '../domain/queries';
import type { SecretStorageStatus } from '../domain/secrets';
import type { Settings, SettingsPatch } from '../domain/settings';
import type { TabRecord } from '../domain/tabs';
import type { ObjectMeta, TreeNode } from '../domain/tree';
import type { TreeVisibility } from '../domain/tree-filter';

export const IPC = {
  appInfo: 'kira:app:info',
  settingsGetAll: 'kira:settings:getAll',
  settingsSet: 'kira:settings:set',
  layoutGetAll: 'kira:layout:getAll',
  layoutSet: 'kira:layout:set',
  engineStatus: 'kira:engine:status',
  port: 'kira:port',
  engineState: 'kira:engine:state',
  openSettings: 'kira:open-settings',
  newConnection: 'kira:menu:new-connection',
  toggleProjectPanel: 'kira:menu:toggle-project-panel',
  toggleOperationsPanel: 'kira:menu:toggle-operations-panel',
  commandPalette: 'kira:menu:command-palette',
  tabNext: 'kira:menu:tab-next',
  tabPrev: 'kira:menu:tab-prev',
  tabClose: 'kira:menu:tab-close',
  viewFind: 'kira:menu:view-find',
  viewRefresh: 'kira:menu:view-refresh',
  viewRun: 'kira:menu:view-run',
  viewRunAll: 'kira:menu:view-run-all',
  appFlushBeforeClose: 'kira:app:flush-before-close',
  appFlushed: 'kira:app:flushed',

  filesChooseSave: 'kira:files:chooseSave',
  filesChooseOpen: 'kira:files:chooseOpen',

  connectionsList: 'kira:connections:list',
  connectionsCreate: 'kira:connections:create',
  connectionsUpdate: 'kira:connections:update',
  connectionsDuplicate: 'kira:connections:duplicate',
  connectionsDelete: 'kira:connections:delete',
  connectionsReorder: 'kira:connections:reorder',
  connectionsReveal: 'kira:connections:reveal',
  connectionsSecretsStatus: 'kira:connections:secretsStatus',
  connectionsTest: 'kira:connections:test',
  connectionsConnect: 'kira:connections:connect',
  connectionsDisconnect: 'kira:connections:disconnect',
  connectionsStates: 'kira:connections:states',
  treeChildren: 'kira:tree:children',
  treeDescribe: 'kira:tree:describe',
  treeDefinition: 'kira:tree:definition',
  treeInvalidate: 'kira:tree:invalidate',
  filtersList: 'kira:filters:list',
  filtersReplace: 'kira:filters:replace',
  opsRecent: 'kira:ops:recent',
  opsCancel: 'kira:ops:cancel',

  tabsList: 'kira:tabs:list',
  tabsSave: 'kira:tabs:save',

  queriesList: 'kira:queries:list',
  queriesSave: 'kira:queries:save',
  queriesListConsole: 'kira:queries:listConsole',
  queriesSaveConsole: 'kira:queries:saveConsole',
  queriesUpdate: 'kira:queries:update',
  queriesDelete: 'kira:queries:delete',
  queriesTouch: 'kira:queries:touch',
  queriesHistoryList: 'kira:queries:historyList',
  queriesHistoryRecord: 'kira:queries:historyRecord',

  connectionState: 'kira:connection:state',
  connectionMetadataInvalidated: 'kira:connection:metadataInvalidated',
  connectionsChanged: 'kira:connections:changed',
  settingsChanged: 'kira:settings:changed',
  opUpdate: 'kira:op:update',
} as const;

export interface AppInfo {
  appVersion: string;
  electron: string;
  chrome: string;
  node: string;
  kiraHome: string;
}

export interface EngineStatus {
  alive: boolean;
  pid: number | null;
}

export interface ConnectionTestResult {
  ok: boolean;
  serverVersion?: string;
  error?: string;
}

export interface TreeChildrenResult {
  nodes: TreeNode[];
  source: 'cache' | 'server';
}

export interface TreeDescribeResult {
  meta: ObjectMeta;
  source: 'cache' | 'server';
}

export interface TreeDefinitionResult {
  definition: ObjectDefinition;
  source: 'cache' | 'server';
}

export interface FilesChooseSaveResult {
  canceled: boolean;
  filePath: string | null;
}

export interface FilesChooseOpenResult {
  canceled: boolean;
  file: { path: string; name: string; size: number } | null;
}

// P35 D15: additive — omitted entirely, chooseOpen behaves exactly as before (no filters, no
// title). `filters` mirrors Electron's own `dialog.showOpenDialog` shape rather than inventing a
// new one, since main just passes it straight through.
export interface FilesChooseOpenArgs {
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

export interface KiraApi {
  appInfo(): Promise<AppInfo>;
  settingsGetAll(): Promise<Settings>;
  settingsSet(patch: SettingsPatch): Promise<Settings>;
  onSettingsChanged(cb: (settings: Settings) => void): () => void;
  layoutGetAll(): Promise<Layout>;
  layoutSet(patch: LayoutPatch): Promise<Layout>;
  engineStatus(): Promise<EngineStatus>;
  onEngineState(cb: (status: EngineStatus) => void): () => void;
  onOpenSettings(cb: () => void): () => void;
  onNewConnection(cb: () => void): () => void;
  onToggleProjectPanel(cb: () => void): () => void;
  onToggleOperationsPanel(cb: () => void): () => void;
  onCommandPalette(cb: () => void): () => void;
  onTabNext(cb: () => void): () => void;
  onTabPrev(cb: () => void): () => void;
  onTabClose(cb: () => void): () => void;
  onViewFind(cb: () => void): () => void;
  onViewRefresh(cb: () => void): () => void;
  onViewRun(cb: () => void): () => void;
  onViewRunAll(cb: () => void): () => void;
  // Quit handshake: main holds `before-quit` until every window acks this, so a debounced save
  // still pending when the user quits is never silently lost.
  onFlushBeforeClose(cb: () => void): () => void;
  appFlushed(): void;

  filesChooseSave(args: { defaultName: string }): Promise<FilesChooseSaveResult>;
  filesChooseOpen(args?: FilesChooseOpenArgs): Promise<FilesChooseOpenResult>;

  connectionsList(): Promise<ConnectionSummary[]>;
  connectionsCreate(input: ConnectionInput): Promise<ConnectionSummary>;
  connectionsUpdate(args: { id: string; input: ConnectionInput }): Promise<ConnectionSummary>;
  connectionsDuplicate(args: { id: string }): Promise<ConnectionSummary>;
  connectionsDelete(args: { id: string }): Promise<void>;
  connectionsReorder(args: { ids: string[] }): Promise<ConnectionSummary[]>;
  connectionsReveal(args: {
    id: string;
  }): Promise<{ password: string | null; error: string | null }>;
  connectionsSecretsStatus(): Promise<SecretStorageStatus>;
  connectionsTest(args: { input: ConnectionInput }): Promise<ConnectionTestResult>;
  connectionsConnect(args: { id: string }): Promise<ConnectionState>;
  connectionsDisconnect(args: { id: string }): Promise<ConnectionState>;
  connectionsStates(): Promise<ConnectionState[]>;
  onConnectionState(cb: (state: ConnectionState) => void): () => void;
  onConnectionMetadataInvalidated(cb: (connectionId: string) => void): () => void;
  onConnectionsChanged(cb: (records: ConnectionSummary[]) => void): () => void;

  treeChildren(args: {
    connectionId: string;
    path: string;
    refresh?: boolean;
  }): Promise<TreeChildrenResult>;
  treeDescribe(args: {
    connectionId: string;
    path: string;
    refresh?: boolean;
    tabId?: string;
  }): Promise<TreeDescribeResult>;
  treeDefinition(args: {
    connectionId: string;
    path: string;
    refresh?: boolean;
    tabId?: string;
  }): Promise<TreeDefinitionResult>;
  treeInvalidate(args: { connectionId: string; path?: string }): Promise<void>;

  filtersList(args: { connectionId: string }): Promise<TreeVisibility>;
  filtersReplace(args: {
    connectionId: string;
    visibility: TreeVisibility;
  }): Promise<TreeVisibility>;

  opsRecent(args: { limit: number }): Promise<OpRecord[]>;
  opsCancel(args: { opId: string }): Promise<void>;
  onOpUpdate(cb: (record: OpRecord) => void): () => void;

  tabsList(): Promise<TabRecord[]>;
  tabsSave(args: { tabs: TabRecord[] }): Promise<void>;

  queriesList(args: { connectionId: string; path: string }): Promise<SavedFilterQuery[]>;
  queriesSave(args: {
    connectionId: string;
    path: string;
    name: string;
    body: FilterBody;
    pinned: boolean;
  }): Promise<SavedFilterQuery>;
  queriesListConsole(args: { connectionId: string; path: string }): Promise<SavedConsoleQuery[]>;
  queriesSaveConsole(args: {
    connectionId: string;
    path: string;
    name: string;
    body: ConsoleBody;
    pinned: boolean;
  }): Promise<SavedConsoleQuery>;
  queriesUpdate(args: { id: string; name?: string; pinned?: boolean }): Promise<SavedQuery>;
  queriesDelete(args: { id: string }): Promise<void>;
  queriesTouch(args: { id: string }): Promise<void>;
  queriesHistoryList(args: {
    connectionId: string;
    path: string;
    limit: number;
  }): Promise<FilterHistoryEntry[]>;
  queriesHistoryRecord(args: {
    connectionId: string;
    path: string;
    where: string | null;
    orderBy: SortSpec | null;
  }): Promise<void>;
}
