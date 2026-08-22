import type { ConnectionInput, ConnectionState, ConnectionSummary } from '../domain/connection';
import type { ConnectionFilter, ConnectionFilterInput } from '../domain/connection-filter';
import type { SourceText } from '../domain/ddl';
import type { OpRecord } from '../domain/ops';
import type { FilterBody, FilterHistoryEntry, SavedQuery, SortSpec } from '../domain/queries';
import type { TabRecord } from '../domain/tabs';
import type { ObjectMeta, TreeNode } from '../domain/tree';
import type { Layout, LayoutPatch } from '../layout';
import type { Settings, SettingsPatch } from '../settings';

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
  toggleProjectPanel: 'kira:menu:toggle-project-panel',
  toggleOperationsPanel: 'kira:menu:toggle-operations-panel',
  appFlushBeforeClose: 'kira:app:flush-before-close',
  appFlushed: 'kira:app:flushed',

  connectionsList: 'kira:connections:list',
  connectionsCreate: 'kira:connections:create',
  connectionsUpdate: 'kira:connections:update',
  connectionsDuplicate: 'kira:connections:duplicate',
  connectionsDelete: 'kira:connections:delete',
  connectionsReorder: 'kira:connections:reorder',
  connectionsReveal: 'kira:connections:reveal',
  connectionsTest: 'kira:connections:test',
  connectionsConnect: 'kira:connections:connect',
  connectionsDisconnect: 'kira:connections:disconnect',
  connectionsStates: 'kira:connections:states',
  treeChildren: 'kira:tree:children',
  treeDescribe: 'kira:tree:describe',
  treeDdl: 'kira:tree:ddl',
  treeInvalidate: 'kira:tree:invalidate',
  filtersList: 'kira:filters:list',
  filtersReplace: 'kira:filters:replace',
  opsRecent: 'kira:ops:recent',
  opsCancel: 'kira:ops:cancel',

  tabsList: 'kira:tabs:list',
  tabsSave: 'kira:tabs:save',

  queriesList: 'kira:queries:list',
  queriesSave: 'kira:queries:save',
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

export interface TreeDdlResult {
  ddl: SourceText;
  source: 'cache' | 'server';
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
  onToggleProjectPanel(cb: () => void): () => void;
  onToggleOperationsPanel(cb: () => void): () => void;
  // Quit handshake: main holds `before-quit` until every window acks this, so a debounced save
  // still pending when the user quits is never silently lost.
  onFlushBeforeClose(cb: () => void): () => void;
  appFlushed(): void;

  connectionsList(): Promise<ConnectionSummary[]>;
  connectionsCreate(input: ConnectionInput): Promise<ConnectionSummary>;
  connectionsUpdate(args: { id: string; input: ConnectionInput }): Promise<ConnectionSummary>;
  connectionsDuplicate(args: { id: string }): Promise<ConnectionSummary>;
  connectionsDelete(args: { id: string }): Promise<void>;
  connectionsReorder(args: { ids: string[] }): Promise<ConnectionSummary[]>;
  connectionsReveal(args: { id: string }): Promise<{ password: string | null }>;
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
  }): Promise<TreeDescribeResult>;
  treeDdl(args: { connectionId: string; path: string; refresh?: boolean }): Promise<TreeDdlResult>;
  treeInvalidate(args: { connectionId: string; path?: string }): Promise<void>;

  filtersList(args: { connectionId: string }): Promise<ConnectionFilter[]>;
  filtersReplace(args: {
    connectionId: string;
    filters: ConnectionFilterInput[];
  }): Promise<ConnectionFilter[]>;

  opsRecent(args: { limit: number }): Promise<OpRecord[]>;
  opsCancel(args: { opId: string }): Promise<void>;
  onOpUpdate(cb: (record: OpRecord) => void): () => void;

  tabsList(): Promise<TabRecord[]>;
  tabsSave(args: { tabs: TabRecord[] }): Promise<void>;

  queriesList(args: { connectionId: string; path: string }): Promise<SavedQuery[]>;
  queriesSave(args: {
    connectionId: string;
    path: string;
    name: string;
    body: FilterBody;
    pinned: boolean;
  }): Promise<SavedQuery>;
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
