import { contextBridge, ipcRenderer } from 'electron';
import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '../shared/domain/connection';
import type { ConnectionFilter, ConnectionFilterInput } from '../shared/domain/connection-filter';
import type { OpRecord } from '../shared/domain/ops';
import type {
  FilterBody,
  FilterHistoryEntry,
  SavedQuery,
  SortSpec,
} from '../shared/domain/queries';
import type { TabRecord } from '../shared/domain/tabs';
import type { LayoutPatch } from '../shared/layout';
import type {
  EngineStatus,
  KiraApi,
  TreeChildrenResult,
  TreeDdlResult,
  TreeDescribeResult,
} from '../shared/protocol/ipc';
import { IPC } from '../shared/protocol/ipc';
import type { Settings, SettingsPatch } from '../shared/settings';

const kiraApi: KiraApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  settingsGetAll: () => ipcRenderer.invoke(IPC.settingsGetAll),
  settingsSet: (patch: SettingsPatch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  onSettingsChanged: (cb: (settings: Settings) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: Settings): void => cb(settings);
    ipcRenderer.on(IPC.settingsChanged, listener);
    return () => ipcRenderer.off(IPC.settingsChanged, listener);
  },
  layoutGetAll: () => ipcRenderer.invoke(IPC.layoutGetAll),
  layoutSet: (patch: LayoutPatch) => ipcRenderer.invoke(IPC.layoutSet, patch),
  engineStatus: () => ipcRenderer.invoke(IPC.engineStatus),
  onEngineState: (cb: (status: EngineStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: EngineStatus): void => cb(status);
    ipcRenderer.on(IPC.engineState, listener);
    return () => ipcRenderer.off(IPC.engineState, listener);
  },
  onOpenSettings: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.openSettings, listener);
    return () => ipcRenderer.off(IPC.openSettings, listener);
  },
  onToggleProjectPanel: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.toggleProjectPanel, listener);
    return () => ipcRenderer.off(IPC.toggleProjectPanel, listener);
  },
  onToggleOperationsPanel: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.toggleOperationsPanel, listener);
    return () => ipcRenderer.off(IPC.toggleOperationsPanel, listener);
  },

  connectionsList: () => ipcRenderer.invoke(IPC.connectionsList),
  connectionsCreate: (input: ConnectionInput) => ipcRenderer.invoke(IPC.connectionsCreate, input),
  connectionsUpdate: (args: { id: string; input: ConnectionInput }) =>
    ipcRenderer.invoke(IPC.connectionsUpdate, args),
  connectionsDuplicate: (args: { id: string }) =>
    ipcRenderer.invoke(IPC.connectionsDuplicate, args),
  connectionsDelete: (args: { id: string }) => ipcRenderer.invoke(IPC.connectionsDelete, args),
  connectionsReorder: (args: { ids: string[] }) => ipcRenderer.invoke(IPC.connectionsReorder, args),
  connectionsReveal: (args: { id: string }) => ipcRenderer.invoke(IPC.connectionsReveal, args),
  connectionsTest: (args: { input: ConnectionInput }) =>
    ipcRenderer.invoke(IPC.connectionsTest, args),
  connectionsConnect: (args: { id: string }) => ipcRenderer.invoke(IPC.connectionsConnect, args),
  connectionsDisconnect: (args: { id: string }) =>
    ipcRenderer.invoke(IPC.connectionsDisconnect, args),
  connectionsStates: () => ipcRenderer.invoke(IPC.connectionsStates),
  onConnectionState: (cb: (state: ConnectionState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ConnectionState): void => cb(state);
    ipcRenderer.on(IPC.connectionState, listener);
    return () => ipcRenderer.off(IPC.connectionState, listener);
  },
  onConnectionMetadataInvalidated: (cb: (connectionId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, connectionId: string): void =>
      cb(connectionId);
    ipcRenderer.on(IPC.connectionMetadataInvalidated, listener);
    return () => ipcRenderer.off(IPC.connectionMetadataInvalidated, listener);
  },
  onConnectionsChanged: (cb: (records: ConnectionSummary[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, records: ConnectionSummary[]): void =>
      cb(records);
    ipcRenderer.on(IPC.connectionsChanged, listener);
    return () => ipcRenderer.off(IPC.connectionsChanged, listener);
  },

  treeChildren: (args: { connectionId: string; path: string; refresh?: boolean }) =>
    ipcRenderer.invoke(IPC.treeChildren, args) as Promise<TreeChildrenResult>,
  treeDescribe: (args: { connectionId: string; path: string; refresh?: boolean }) =>
    ipcRenderer.invoke(IPC.treeDescribe, args) as Promise<TreeDescribeResult>,
  treeDdl: (args: { connectionId: string; path: string; refresh?: boolean }) =>
    ipcRenderer.invoke(IPC.treeDdl, args) as Promise<TreeDdlResult>,
  treeInvalidate: (args: { connectionId: string; path?: string }) =>
    ipcRenderer.invoke(IPC.treeInvalidate, args),

  filtersList: (args: { connectionId: string }) =>
    ipcRenderer.invoke(IPC.filtersList, args) as Promise<ConnectionFilter[]>,
  filtersReplace: (args: { connectionId: string; filters: ConnectionFilterInput[] }) =>
    ipcRenderer.invoke(IPC.filtersReplace, args) as Promise<ConnectionFilter[]>,

  opsRecent: (args: { limit: number }) =>
    ipcRenderer.invoke(IPC.opsRecent, args) as Promise<OpRecord[]>,
  opsCancel: (args: { opId: string }) => ipcRenderer.invoke(IPC.opsCancel, args),
  onOpUpdate: (cb: (record: OpRecord) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, record: OpRecord): void => cb(record);
    ipcRenderer.on(IPC.opUpdate, listener);
    return () => ipcRenderer.off(IPC.opUpdate, listener);
  },

  tabsList: () => ipcRenderer.invoke(IPC.tabsList) as Promise<TabRecord[]>,
  tabsSave: (args: { tabs: TabRecord[] }) => ipcRenderer.invoke(IPC.tabsSave, args),

  queriesList: (args: { connectionId: string; path: string }) =>
    ipcRenderer.invoke(IPC.queriesList, args) as Promise<SavedQuery[]>,
  queriesSave: (args: {
    connectionId: string;
    path: string;
    name: string;
    body: FilterBody;
    pinned: boolean;
  }) => ipcRenderer.invoke(IPC.queriesSave, args) as Promise<SavedQuery>,
  queriesUpdate: (args: { id: string; name?: string; pinned?: boolean }) =>
    ipcRenderer.invoke(IPC.queriesUpdate, args) as Promise<SavedQuery>,
  queriesDelete: (args: { id: string }) => ipcRenderer.invoke(IPC.queriesDelete, args),
  queriesTouch: (args: { id: string }) => ipcRenderer.invoke(IPC.queriesTouch, args),
  queriesHistoryList: (args: { connectionId: string; path: string; limit: number }) =>
    ipcRenderer.invoke(IPC.queriesHistoryList, args) as Promise<FilterHistoryEntry[]>,
  queriesHistoryRecord: (args: {
    connectionId: string;
    path: string;
    where: string | null;
    orderBy: SortSpec | null;
  }) => ipcRenderer.invoke(IPC.queriesHistoryRecord, args),
};

contextBridge.exposeInMainWorld('kira', kiraApi);

// A MessagePort cannot cross contextBridge directly, so relay it via window.postMessage —
// bridge/port.ts on the renderer side picks it up from there.
ipcRenderer.on(IPC.port, (event, meta) => {
  window.postMessage({ __kira: 'port', meta }, '*', event.ports);
});
