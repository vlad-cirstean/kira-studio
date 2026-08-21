import { contextBridge, ipcRenderer } from 'electron';
import type { ConnectionFilter, ConnectionInput, ConnectionState } from '../shared/connection';
import type {
  EngineStatus,
  FiltersReplacePayload,
  IdPayload,
  KiraApi,
  OpsCancelPayload,
  OpsRecentPayload,
  ReorderPayload,
  TreeChildrenPayload,
  TreeChildrenResult,
  TreeDescribePayload,
  TreeDescribeResult,
  TreeInvalidatePayload,
  UpdateConnectionPayload,
} from '../shared/ipc';
import { IPC } from '../shared/ipc';
import type { LayoutPatch } from '../shared/layout';
import type { OpRecord } from '../shared/ops';
import type { SettingsPatch } from '../shared/settings';

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

const kiraApi: KiraApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  settingsGetAll: () => ipcRenderer.invoke(IPC.settingsGetAll),
  settingsSet: (patch: SettingsPatch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  layoutGetAll: () => ipcRenderer.invoke(IPC.layoutGetAll),
  layoutSet: (patch: LayoutPatch) => ipcRenderer.invoke(IPC.layoutSet, patch),
  engineStatus: () => ipcRenderer.invoke(IPC.engineStatus),
  onEngineState: (cb: (status: EngineStatus) => void) => on(IPC.engineState, cb),
  onOpenSettings: (cb: () => void) => on(IPC.openSettings, cb),
  onToggleProjectPanel: (cb: () => void) => on(IPC.toggleProjectPanel, cb),
  onToggleOperationsPanel: (cb: () => void) => on(IPC.toggleOperationsPanel, cb),

  connectionsList: () => ipcRenderer.invoke(IPC.connectionsList),
  connectionsCreate: (input: ConnectionInput) => ipcRenderer.invoke(IPC.connectionsCreate, input),
  connectionsUpdate: (payload: UpdateConnectionPayload) =>
    ipcRenderer.invoke(IPC.connectionsUpdate, payload),
  connectionsDuplicate: (payload: IdPayload) =>
    ipcRenderer.invoke(IPC.connectionsDuplicate, payload),
  connectionsDelete: (payload: IdPayload) => ipcRenderer.invoke(IPC.connectionsDelete, payload),
  connectionsReorder: (payload: ReorderPayload) =>
    ipcRenderer.invoke(IPC.connectionsReorder, payload),
  connectionsReveal: (payload: IdPayload) => ipcRenderer.invoke(IPC.connectionsReveal, payload),
  connectionsTest: (input: ConnectionInput) => ipcRenderer.invoke(IPC.connectionsTest, input),
  connectionsConnect: (payload: IdPayload) => ipcRenderer.invoke(IPC.connectionsConnect, payload),
  connectionsDisconnect: (payload: IdPayload) =>
    ipcRenderer.invoke(IPC.connectionsDisconnect, payload),
  connectionsStates: () => ipcRenderer.invoke(IPC.connectionsStates),

  treeChildren: (payload: TreeChildrenPayload): Promise<TreeChildrenResult> =>
    ipcRenderer.invoke(IPC.treeChildren, payload),
  treeDescribe: (payload: TreeDescribePayload): Promise<TreeDescribeResult> =>
    ipcRenderer.invoke(IPC.treeDescribe, payload),
  treeInvalidate: (payload: TreeInvalidatePayload) =>
    ipcRenderer.invoke(IPC.treeInvalidate, payload),

  filtersList: (payload: IdPayload): Promise<ConnectionFilter[]> =>
    ipcRenderer.invoke(IPC.filtersList, payload),
  filtersReplace: (payload: FiltersReplacePayload): Promise<ConnectionFilter[]> =>
    ipcRenderer.invoke(IPC.filtersReplace, payload),

  opsRecent: (payload: OpsRecentPayload): Promise<OpRecord[]> =>
    ipcRenderer.invoke(IPC.opsRecent, payload),
  opsCancel: (payload: OpsCancelPayload) => ipcRenderer.invoke(IPC.opsCancel, payload),

  onConnectionState: (cb: (state: ConnectionState) => void) => on(IPC.connectionState, cb),
  onConnectionMetadataInvalidated: (cb: (payload: TreeInvalidatePayload) => void) =>
    on(IPC.connectionMetadataInvalidated, cb),
  onOpUpdate: (cb: (record: OpRecord) => void) => on(IPC.opUpdate, cb),
};

contextBridge.exposeInMainWorld('kira', kiraApi);

// A MessagePort cannot cross contextBridge directly, so relay it via window.postMessage —
// bridge/port.ts on the renderer side picks it up from there.
ipcRenderer.on(IPC.port, (event, meta) => {
  window.postMessage({ __kira: 'port', meta }, '*', event.ports);
});
