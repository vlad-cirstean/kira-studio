import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';

// A thrown AdapterError (or DisconnectedError) carries a `.code`, but Electron's IPC error
// serialization only preserves `.message` to the renderer — so the code is folded into the
// message as `[CODE] text` here, the one place every handler's errors pass through, letting
// the renderer branch on the prefix without a separate error envelope.
function toIpcError(err: unknown): Error {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return new Error(`[${code}] ${err.message}`);
    return err;
  }
  return new Error(String(err));
}

type Handler<T> = (event: IpcMainInvokeEvent, payload: unknown) => Promise<T> | T;

export function handle<T>(channel: string, fn: Handler<T>): void {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return await fn(event, payload);
    } catch (err) {
      throw toIpcError(err);
    }
  });
}
