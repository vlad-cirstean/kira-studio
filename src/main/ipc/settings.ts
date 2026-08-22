import { ipcMain } from 'electron';
import { IPC } from '../../shared/protocol/ipc';
import type { SettingsPatch } from '../../shared/settings';
import { pushEngineConfig } from '../engine-config';
import { getAllSettings, setSettings } from '../storage/repos/settings';
import type { IpcDeps } from './deps';

export function registerSettingsHandlers(deps: IpcDeps): void {
  ipcMain.handle(IPC.settingsGetAll, () => getAllSettings(deps.db));
  ipcMain.handle(IPC.settingsSet, async (_event, patch: SettingsPatch) => {
    const merged = await setSettings(deps.db, patch);
    if (patch.cache?.l2BudgetMb !== undefined) {
      await pushEngineConfig(deps.engineHost, deps.db);
    }
    return merged;
  });
}
