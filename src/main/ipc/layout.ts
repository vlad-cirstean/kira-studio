import { ipcMain } from 'electron';
import type { LayoutPatch } from '../../shared/domain/layout';
import { IPC } from '../../shared/protocol/ipc';
import { getAllLayout, setLayout } from '../storage/repos/layout';
import type { IpcDeps } from './deps';

export function registerLayoutHandlers(deps: IpcDeps): void {
  ipcMain.handle(IPC.layoutGetAll, () => getAllLayout(deps.db));
  ipcMain.handle(IPC.layoutSet, (_event, patch: LayoutPatch) => setLayout(deps.db, patch));
}
