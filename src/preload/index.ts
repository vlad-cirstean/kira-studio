import { contextBridge, ipcRenderer } from 'electron';
import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '../shared/domain/connection';
import type { OpRecord } from '../shared/domain/ops';
import type {
  ConsoleBody,
  FilterBody,
  FilterHistoryEntry,
  SavedConsoleQuery,
  SavedFilterQuery,
  SavedQuery,
  SortSpec,
} from '../shared/domain/queries';
import type { TabRecord } from '../shared/domain/tabs';
import type { TreeVisibility } from '../shared/domain/tree-filter';
import type { LayoutPatch } from '../shared/layout';
import type {
  EngineStatus,
  FilesChooseOpenArgs,
  KiraApi,
  TreeChildrenResult,
  TreeDefinitionResult,
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
  onNewConnection: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.newConnection, listener);
    return () => ipcRenderer.off(IPC.newConnection, listener);
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
  onCommandPalette: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.commandPalette, listener);
    return () => ipcRenderer.off(IPC.commandPalette, listener);
  },
  onTabNext: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.tabNext, listener);
    return () => ipcRenderer.off(IPC.tabNext, listener);
  },
  onTabPrev: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.tabPrev, listener);
    return () => ipcRenderer.off(IPC.tabPrev, listener);
  },
  onTabClose: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.tabClose, listener);
    return () => ipcRenderer.off(IPC.tabClose, listener);
  },
  onViewFind: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.viewFind, listener);
    return () => ipcRenderer.off(IPC.viewFind, listener);
  },
  onViewRefresh: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.viewRefresh, listener);
    return () => ipcRenderer.off(IPC.viewRefresh, listener);
  },
  onViewRun: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.viewRun, listener);
    return () => ipcRenderer.off(IPC.viewRun, listener);
  },
  onViewRunAll: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.viewRunAll, listener);
    return () => ipcRenderer.off(IPC.viewRunAll, listener);
  },
  onFlushBeforeClose: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.appFlushBeforeClose, listener);
    return () => ipcRenderer.off(IPC.appFlushBeforeClose, listener);
  },
  appFlushed: () => {
    ipcRenderer.send(IPC.appFlushed);
  },

  filesChooseSave: (args: { defaultName: string }) => ipcRenderer.invoke(IPC.filesChooseSave, args),
  filesChooseOpen: (args?: FilesChooseOpenArgs) => ipcRenderer.invoke(IPC.filesChooseOpen, args),

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
  connectionsSecretsStatus: () => ipcRenderer.invoke(IPC.connectionsSecretsStatus),
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
  treeDefinition: (args: { connectionId: string; path: string; refresh?: boolean }) =>
    ipcRenderer.invoke(IPC.treeDefinition, args) as Promise<TreeDefinitionResult>,
  treeInvalidate: (args: { connectionId: string; path?: string }) =>
    ipcRenderer.invoke(IPC.treeInvalidate, args),

  filtersList: (args: { connectionId: string }) =>
    ipcRenderer.invoke(IPC.filtersList, args) as Promise<TreeVisibility>,
  filtersReplace: (args: { connectionId: string; visibility: TreeVisibility }) =>
    ipcRenderer.invoke(IPC.filtersReplace, args) as Promise<TreeVisibility>,

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
    ipcRenderer.invoke(IPC.queriesList, args) as Promise<SavedFilterQuery[]>,
  queriesSave: (args: {
    connectionId: string;
    path: string;
    name: string;
    body: FilterBody;
    pinned: boolean;
  }) => ipcRenderer.invoke(IPC.queriesSave, args) as Promise<SavedFilterQuery>,
  queriesListConsole: (args: { connectionId: string; path: string }) =>
    ipcRenderer.invoke(IPC.queriesListConsole, args) as Promise<SavedConsoleQuery[]>,
  queriesSaveConsole: (args: {
    connectionId: string;
    path: string;
    name: string;
    body: ConsoleBody;
    pinned: boolean;
  }) => ipcRenderer.invoke(IPC.queriesSaveConsole, args) as Promise<SavedConsoleQuery>,
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
