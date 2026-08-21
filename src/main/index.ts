import { join } from 'node:path';
import { app, BrowserWindow, MessageChannelMain } from 'electron';
import { startEngine } from './engine-host';
import { registerIpc } from './ipc';
import { log } from './log';
import { openDb } from './storage/db';
import { migrate } from './storage/migrate';
import { ensureLayout, kiraHome } from './storage/paths';
import { createWindow } from './window';

app.setName('Kira Studio');
if (process.env.KIRA_HOME) {
  app.setPath('userData', join(kiraHome(), 'electron'));
}

async function main(): Promise<void> {
  await app.whenReady();

  ensureLayout();
  const db = await openDb();
  migrate(db);

  const engineHost = startEngine();
  registerIpc(db, engineHost);

  let generation = 0;
  const attachPort = (win: BrowserWindow): void => {
    win.webContents.on('did-finish-load', () => {
      const { port1, port2 } = new MessageChannelMain();
      generation += 1;
      engineHost.attachRendererPort(port1, generation);
      win.webContents.postMessage('kira:port', { generation }, [port2]);
    });
  };

  attachPort(createWindow(db));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      attachPort(createWindow(db));
    }
  });

  app.on('window-all-closed', () => {
    // macOS convention: keep the app running with no windows until Cmd+Q.
  });

  app.on('before-quit', () => {
    engineHost.stop();
    db.close();
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
