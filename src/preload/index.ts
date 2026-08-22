import { contextBridge, ipcRenderer } from 'electron';
import type { LayoutPatch } from '../shared/layout';
import type { EngineStatus, KiraApi } from '../shared/protocol/ipc';
import { IPC } from '../shared/protocol/ipc';
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
};

contextBridge.exposeInMainWorld('kira', kiraApi);

// A MessagePort cannot cross contextBridge directly, so relay it via window.postMessage —
// bridge/port.ts on the renderer side picks it up from there.
ipcRenderer.on(IPC.port, (event, meta) => {
  window.postMessage({ __kira: 'port', meta }, '*', event.ports);
});
