import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, MessageChannelMain } from 'electron';
import { IPC } from '../shared/protocol/ipc';
import { createConnectionsService } from './connections';
import { pushEngineConfig } from './engine-config';
import { startEngine } from './engine-host';
import { registerIpc } from './ipc/registry';
import { log } from './log';
import { buildMenu } from './menu';
import { wireOplog } from './oplog';
import { openDb } from './storage/db';
import { migrate } from './storage/migrate';
import { ensureLayout, kiraHome } from './storage/paths';
import { getAllSettings } from './storage/repos/settings';
import { createTreeService } from './tree-service';
import { createWindow } from './window';

app.setName('Kira Studio');
if (process.env.KIRA_HOME) {
  app.setPath('userData', join(kiraHome(), 'electron'));
}
Menu.setApplicationMenu(buildMenu());

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

// Quit handshake: a renderer's saves are debounced (state/tabs.ts), so a pager/filter/sort
// change made right before quitting can still be sitting in that debounce timer with nothing on
// disk. `before-quit` holds the quit, asks every window to flush now, and only lets it proceed
// once each has acked (or FLUSH_TIMEOUT_MS has passed — a hung/unresponsive renderer must never
// block quitting outright).
const FLUSH_TIMEOUT_MS = 2000;
const pendingFlushAcks = new Map<number, () => void>();
ipcMain.on(IPC.appFlushed, (event) => {
  pendingFlushAcks.get(event.sender.id)?.();
  pendingFlushAcks.delete(event.sender.id);
});

function requestFlush(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const id = win.webContents.id;
    const timer = setTimeout(() => {
      pendingFlushAcks.delete(id);
      resolve();
    }, FLUSH_TIMEOUT_MS);
    pendingFlushAcks.set(id, () => {
      clearTimeout(timer);
      resolve();
    });
    win.webContents.send(IPC.appFlushBeforeClose);
  });
}

async function main(): Promise<void> {
  await app.whenReady();

  ensureLayout();
  const { db, raw, close } = await openDb();
  migrate(raw);
  const settings = await getAllSettings(db);

  const engineHost = startEngine({ maxOldSpaceMb: settings.advanced.engineMemoryCapMb });
  const connections = createConnectionsService(db, engineHost);
  const tree = createTreeService(db, engineHost, connections);
  void pushEngineConfig(engineHost, db);

  connections.onStateChange((state) => broadcast(IPC.connectionState, state));
  connections.onMetadataInvalidated((connectionId) =>
    broadcast(IPC.connectionMetadataInvalidated, connectionId),
  );
  connections.onListChanged((records) => broadcast(IPC.connectionsChanged, records));
  // On engine exit: engine-host.ts already rejects every pending call; this synthesises
  // per-connection error states so the tree/status bar reflect it too (no auto-respawn).
  engineHost.on('engine:down', () => connections.markAllErrored('engine process exited'));

  wireOplog(
    engineHost,
    db,
    (record) => broadcast(IPC.opUpdate, record),
    settings.advanced.opLogRetentionDays,
  );

  registerIpc({ db, engineHost, connections, tree });

  let generation = 0;
  const attachPort = (win: BrowserWindow): void => {
    win.webContents.on('did-finish-load', () => {
      const { port1, port2 } = new MessageChannelMain();
      generation += 1;
      engineHost.attachRendererPort(port1, generation);
      win.webContents.postMessage('kira:port', { generation }, [port2]);
    });
  };

  attachPort(await createWindow(db));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow(db).then(attachPort);
    }
  });

  app.on('window-all-closed', () => {
    // macOS convention: keep the app running with no windows until Cmd+Q.
  });

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void Promise.all(BrowserWindow.getAllWindows().map(requestFlush)).then(async () => {
      await connections.shutdown();
      engineHost.stop();
      close();
      app.quit();
    });
  });
}

main().catch((err) => {
  log(
    'error',
    'main',
    `startup failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  app.quit();
});
