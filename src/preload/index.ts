import { contextBridge, ipcRenderer } from 'electron';
import type { EngineStatus, KiraApi } from '../shared/ipc';
import { IPC } from '../shared/ipc';
import type { LayoutPatch } from '../shared/layout';
import type { SettingsPatch } from '../shared/settings';

const kiraApi: KiraApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  settingsGetAll: () => ipcRenderer.invoke(IPC.settingsGetAll),
  settingsSet: (patch: SettingsPatch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  layoutGetAll: () => ipcRenderer.invoke(IPC.layoutGetAll),
  layoutSet: (patch: LayoutPatch) => ipcRenderer.invoke(IPC.layoutSet, patch),
  engineStatus: () => ipcRenderer.invoke(IPC.engineStatus),
  onEngineState: (cb: (status: EngineStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: EngineStatus): void => cb(status);
    ipcRenderer.on(IPC.engineState, listener);
    return () => ipcRenderer.off(IPC.engineState, listener);
  },
};

contextBridge.exposeInMainWorld('kira', kiraApi);

// A MessagePort cannot cross contextBridge directly, so relay it via window.postMessage —
// bridge/port.ts on the renderer side picks it up from there.
ipcRenderer.on(IPC.port, (event, meta) => {
  window.postMessage({ __kira: 'port', meta }, '*', event.ports);
});
