import { app, ipcMain } from 'electron';
import { IPC } from '../shared/ipc';
import type { LayoutPatch } from '../shared/layout';
import type { SettingsPatch } from '../shared/settings';
import type { EngineHost } from './engine-host';
import type { Db } from './storage/db';
import { getAllLayout, setLayout } from './storage/layout';
import { kiraHome } from './storage/paths';
import { getAllSettings, setSettings } from './storage/settings';

export function registerIpc(db: Db, engineHost: EngineHost): void {
  ipcMain.handle(IPC.appInfo, () => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    kiraHome: kiraHome(),
  }));

  ipcMain.handle(IPC.settingsGetAll, () => getAllSettings(db));
  ipcMain.handle(IPC.settingsSet, (_event, patch: SettingsPatch) => setSettings(db, patch));

  ipcMain.handle(IPC.layoutGetAll, () => getAllLayout(db));
  ipcMain.handle(IPC.layoutSet, (_event, patch: LayoutPatch) => setLayout(db, patch));

  ipcMain.handle(IPC.engineStatus, () => engineHost.status());
}
