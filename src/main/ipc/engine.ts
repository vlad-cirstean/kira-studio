import { ipcMain } from 'electron';
import { IPC } from '../../shared/protocol/ipc';
import type { IpcDeps } from './deps';

export function registerEngineHandlers(deps: IpcDeps): void {
  ipcMain.handle(IPC.engineStatus, () => deps.engineHost.status());
}
