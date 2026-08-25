import type { SettingsPatch } from '@shared/domain/settings';
import { IPC } from '@shared/protocol/ipc';
import { BrowserWindow, ipcMain } from 'electron';
import { pushEngineConfig } from '../engine-config';
import { getAllSettings, setSettings } from '../storage/repos/settings';
import type { IpcDeps } from './deps';

export function registerSettingsHandlers(deps: IpcDeps): void {
  ipcMain.handle(IPC.settingsGetAll, () => getAllSettings(deps.db));
  ipcMain.handle(IPC.settingsSet, async (_event, patch: SettingsPatch) => {
    const merged = await setSettings(deps.db, patch);
    if (patch.cache?.l2BudgetMb !== undefined) {
      await pushEngineConfig(deps.engineHost, deps.db, merged);
    }
    // Otherwise a settings change made through any path other than the renderer's own
    // patchSettings() wrapper (e.g. a direct IPC call) silently never reaches the renderer's
    // local settingsState — it stays on whatever it was hydrated to at boot, the same gap
    // connections.ts's onListChanged closes for the connections list.
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.settingsChanged, merged);
    }
    return merged;
  });
}
