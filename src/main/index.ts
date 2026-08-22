import { join } from 'node:path';
import { app, BrowserWindow, Menu, MessageChannelMain } from 'electron';
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

async function main(): Promise<void> {
  await app.whenReady();

  ensureLayout();
  const { db, raw, close } = await openDb();
  migrate(raw);

  const engineHost = startEngine();
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

  wireOplog(engineHost, db, (record) => broadcast(IPC.opUpdate, record));

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

  app.on('before-quit', () => {
    engineHost.stop();
    close();
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
