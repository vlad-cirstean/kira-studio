import { ipcMain } from 'electron';
import { IPC } from '../../shared/protocol/ipc';
import type { SettingsPatch } from '../../shared/settings';
import { getAllSettings, setSettings } from '../storage/repos/settings';
import type { IpcDeps } from './deps';

export function registerSettingsHandlers(deps: IpcDeps): void {
  ipcMain.handle(IPC.settingsGetAll, () => getAllSettings(deps.db));
  ipcMain.handle(IPC.settingsSet, (_event, patch: SettingsPatch) => setSettings(deps.db, patch));
}
