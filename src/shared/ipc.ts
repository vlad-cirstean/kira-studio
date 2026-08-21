import type {
  ConnectionFilter,
  ConnectionFilterInput,
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from './connection';
import type { TestResult } from './engine-ops';
import type { Layout, LayoutPatch } from './layout';
import type { OpRecord } from './ops';
import type { Settings, SettingsPatch } from './settings';
import type { ObjectMeta, TreeNode } from './tree';

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
  treeInvalidate: 'kira:tree:invalidate',

  filtersList: 'kira:filters:list',
  filtersReplace: 'kira:filters:replace',

  opsRecent: 'kira:ops:recent',
  opsCancel: 'kira:ops:cancel',

  connectionState: 'kira:connection:state',
  connectionMetadataInvalidated: 'kira:connection:metadataInvalidated',
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

export interface IdPayload {
  id: string;
}

export interface UpdateConnectionPayload {
  id: string;
  input: ConnectionInput;
}

export interface ReorderPayload {
  ids: string[];
}

export interface TreeChildrenResult {
  nodes: TreeNode[];
  source: 'cache' | 'server';
}

export interface TreeDescribeResult {
  meta: ObjectMeta;
  source: 'cache' | 'server';
}

export interface TreeChildrenPayload {
  connectionId: string;
  path: string;
  refresh?: boolean;
}

export interface TreeDescribePayload {
  connectionId: string;
  path: string;
  refresh?: boolean;
}

export interface TreeInvalidatePayload {
  connectionId: string;
  path?: string;
}

export interface FiltersReplacePayload {
  connectionId: string;
  filters: ConnectionFilterInput[];
}

export interface OpsRecentPayload {
  limit: number;
}

export interface OpsCancelPayload {
  opId: string;
}

export interface KiraApi {
  appInfo(): Promise<AppInfo>;
  settingsGetAll(): Promise<Settings>;
  settingsSet(patch: SettingsPatch): Promise<Settings>;
  layoutGetAll(): Promise<Layout>;
  layoutSet(patch: LayoutPatch): Promise<Layout>;
  engineStatus(): Promise<EngineStatus>;
  onEngineState(cb: (status: EngineStatus) => void): () => void;
  onOpenSettings(cb: () => void): () => void;
  onToggleProjectPanel(cb: () => void): () => void;
  onToggleOperationsPanel(cb: () => void): () => void;

  connectionsList(): Promise<ConnectionSummary[]>;
  connectionsCreate(input: ConnectionInput): Promise<ConnectionSummary>;
  connectionsUpdate(payload: UpdateConnectionPayload): Promise<ConnectionSummary>;
  connectionsDuplicate(payload: IdPayload): Promise<ConnectionSummary>;
  connectionsDelete(payload: IdPayload): Promise<void>;
  connectionsReorder(payload: ReorderPayload): Promise<ConnectionSummary[]>;
  connectionsReveal(payload: IdPayload): Promise<{ password: string | null }>;
  connectionsTest(input: ConnectionInput): Promise<TestResult>;
  connectionsConnect(payload: IdPayload): Promise<ConnectionState>;
  connectionsDisconnect(payload: IdPayload): Promise<ConnectionState>;
  connectionsStates(): Promise<ConnectionState[]>;

  treeChildren(payload: TreeChildrenPayload): Promise<TreeChildrenResult>;
  treeDescribe(payload: TreeDescribePayload): Promise<TreeDescribeResult>;
  treeInvalidate(payload: TreeInvalidatePayload): Promise<void>;

  filtersList(payload: IdPayload): Promise<ConnectionFilter[]>;
  filtersReplace(payload: FiltersReplacePayload): Promise<ConnectionFilter[]>;

  opsRecent(payload: OpsRecentPayload): Promise<OpRecord[]>;
  opsCancel(payload: OpsCancelPayload): Promise<void>;

  onConnectionState(cb: (state: ConnectionState) => void): () => void;
  onConnectionMetadataInvalidated(cb: (payload: TreeInvalidatePayload) => void): () => void;
  onOpUpdate(cb: (record: OpRecord) => void): () => void;
}
