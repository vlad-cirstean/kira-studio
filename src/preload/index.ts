import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '@shared/domain/connection';
import type { LayoutPatch } from '@shared/domain/layout';
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
import type { Settings, SettingsPatch } from '@shared/domain/settings';
import type { TabRecord } from '@shared/domain/tabs';
import type { TreeVisibility } from '@shared/domain/tree-filter';
import type {
  AppMetricsSample,
  EngineStatus,
  FilesChooseOpenArgs,
  KiraApi,
  TreeChildrenResult,
  TreeDefinitionResult,
  TreeDescribeResult,
} from '@shared/protocol/ipc';
import { IPC } from '@shared/protocol/ipc';
import { contextBridge, ipcRenderer } from 'electron';

// P39 iter3 F13/D14: the subscribe/unsubscribe pattern every on*() property below needs, in the
// two shapes this API uses — a bare signal and a typed payload. Nineteen call sites used to write
// this out by hand; the risk that made it worth a helper is a mismatched channel or closure
// between the .on() and the .off() line, which nothing but reading caught.
function onSignal(channel: string, cb: () => void): () => void {
  const listener = (): void => cb();
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

function onEvent<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

const kiraApi: KiraApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  settingsGetAll: () => ipcRenderer.invoke(IPC.settingsGetAll),
  settingsSet: (patch: SettingsPatch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  onSettingsChanged: (cb: (settings: Settings) => void) => onEvent(IPC.settingsChanged, cb),
  layoutGetAll: () => ipcRenderer.invoke(IPC.layoutGetAll),
  layoutSet: (patch: LayoutPatch) => ipcRenderer.invoke(IPC.layoutSet, patch),
  engineStatus: () => ipcRenderer.invoke(IPC.engineStatus),
  onEngineState: (cb: (status: EngineStatus) => void) => onEvent(IPC.engineState, cb),
  onOpenSettings: (cb: () => void) => onSignal(IPC.openSettings, cb),
  onNewConnection: (cb: () => void) => onSignal(IPC.newConnection, cb),
  onToggleProjectPanel: (cb: () => void) => onSignal(IPC.toggleProjectPanel, cb),
  onToggleOperationsPanel: (cb: () => void) => onSignal(IPC.toggleOperationsPanel, cb),
  onCommandPalette: (cb: () => void) => onSignal(IPC.commandPalette, cb),
  onTabNext: (cb: () => void) => onSignal(IPC.tabNext, cb),
  onTabPrev: (cb: () => void) => onSignal(IPC.tabPrev, cb),
  onTabClose: (cb: () => void) => onSignal(IPC.tabClose, cb),
  onViewFind: (cb: () => void) => onSignal(IPC.viewFind, cb),
  onViewRefresh: (cb: () => void) => onSignal(IPC.viewRefresh, cb),
  onViewRun: (cb: () => void) => onSignal(IPC.viewRun, cb),
  onViewRunAll: (cb: () => void) => onSignal(IPC.viewRunAll, cb),
  onFlushBeforeClose: (cb: () => void) => onSignal(IPC.appFlushBeforeClose, cb),
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
  onConnectionState: (cb: (state: ConnectionState) => void) => onEvent(IPC.connectionState, cb),
  onConnectionMetadataInvalidated: (cb: (connectionId: string) => void) =>
    onEvent(IPC.connectionMetadataInvalidated, cb),
  onConnectionsChanged: (cb: (records: ConnectionSummary[]) => void) =>
    onEvent(IPC.connectionsChanged, cb),

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
  onOpUpdate: (cb: (record: OpRecord) => void) => onEvent(IPC.opUpdate, cb),

  onAppMetrics: (cb: (sample: AppMetricsSample) => void) => onEvent(IPC.appMetrics, cb),

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
