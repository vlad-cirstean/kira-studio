import { IPC } from '@shared/protocol/ipc';
import { app, ipcMain } from 'electron';
import { kiraHome } from '../storage/paths';

export function registerAppHandlers(): void {
  ipcMain.handle(IPC.appInfo, () => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    kiraHome: kiraHome(),
  }));
}
