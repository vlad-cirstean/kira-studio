import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { z } from 'zod';
import { IPC } from '../../shared/protocol/ipc';
import { handle } from './errors';

// P33 D15: engine-neutral — "ask the user for a path to save to" is an application capability,
// not an S3 one (a future export-to-CSV feature would use the identical handler). `dialog` is
// Electron-only, so this lives in main; the chosen path travels back to the renderer and from
// there to the engine as a plain string (D16) — the bytes themselves never come through here or
// through main at all (§4, engine/adapters/s3/transfer.ts does the actual streaming).

const chooseSaveSchema = z.object({ defaultName: z.string() });

export function registerFilesHandlers(): void {
  handle(IPC.filesChooseSave, async (event, payload) => {
    const { defaultName } = chooseSaveSchema.parse(payload);
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    // basename(), not the raw suggested name verbatim — an S3 key routinely contains '/', which
    // showSaveDialog would otherwise read as a subdirectory path.
    const options = { defaultPath: join(app.getPath('downloads'), basename(defaultName)) };
    const res = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    return { canceled: res.canceled, filePath: res.filePath ?? null };
  });

  handle(IPC.filesChooseOpen, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const openOptions = { properties: ['openFile' as const] };
    const res = win
      ? await dialog.showOpenDialog(win, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (res.canceled || !res.filePaths[0]) return { canceled: true, file: null };
    const path = res.filePaths[0];
    const info = await stat(path);
    return { canceled: false, file: { path, name: basename(path), size: info.size } };
  });
}
