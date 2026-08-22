import { join } from 'node:path';
import { app, BrowserWindow, Menu, MessageChannelMain } from 'electron';
import { ENGINE_EVENT, opEndEventSchema, opStartEventSchema } from '../shared/engine-ops';
import { IPC } from '../shared/ipc';
import type { OpKind, OpRecord } from '../shared/ops';
import { startEngine } from './engine-host';
import { registerIpc, pushCacheConfigToEngine } from './ipc';
import { log } from './log';
import { buildMenu } from './menu';
import { openDb } from './storage/db';
import { migrate } from './storage/migrate';
import { appendOp, finishOp, pruneOps } from './storage/oplog';
import { ensureLayout, kiraHome } from './storage/paths';
import { getAllSettings } from './storage/settings';
import { broadcast, createWindow } from './window';

app.setName('Kira Studio');
if (process.env.KIRA_HOME) {
  app.setPath('userData', join(kiraHome(), 'electron'));
}

async function main(): Promise<void> {
  await app.whenReady();

  // Install the menu only once the app is fully launched: on macOS the first menu's title is the
  // app name, which Electron resolves from productName/name at that point.
  Menu.setApplicationMenu(buildMenu());

  ensureLayout();
  const handle = await openDb();
  await migrate(handle.db, handle.raw);
  const db = handle.db;

  const engineHost = startEngine();
  const services = registerIpc(db, engineHost);
  // The engine owns L2/L3 — teach it the configured budget/TTL before any data op can land.
  const initial = await getAllSettings(db);
  pushCacheConfigToEngine(engineHost, initial);
  void pruneOps(db);

  // Op log wiring (D19): the engine emits op:start/op:end; main persists them and forwards each as
  // a `kira:op:update` push. op:start carries connectionId/kind/startedAt; op:end carries only the
  // finish patch, so main joins them via a small in-flight map.
  const opStart = new Map<
    string,
    { connectionId: string | null; kind: OpKind; startedAt: string; tabId: string | null }
  >();
  engineHost.on(ENGINE_EVENT.opStart, (payload) => {
    const start = opStartEventSchema.parse(payload);
    opStart.set(start.opId, {
      connectionId: start.connectionId,
      kind: start.kind,
      startedAt: start.startedAt,
      tabId: start.tabId,
    });
    const record: OpRecord = {
      id: start.opId,
      connectionId: start.connectionId,
      tabId: start.tabId,
      startedAt: start.startedAt,
      durationMs: null,
      kind: start.kind,
      status: 'running',
      rows: null,
      command: null,
      error: null,
    };
    appendOp(db, record).catch((err: unknown) =>
      log('error', 'oplog', `appendOp failed: ${err instanceof Error ? err.message : String(err)}`),
    );
    broadcast(IPC.opUpdate, record);
  });
  engineHost.on(ENGINE_EVENT.opEnd, (payload) => {
    const end = opEndEventSchema.parse(payload);
    const start = opStart.get(end.opId);
    opStart.delete(end.opId);
    if (!start) return; // an op we never saw start (engine restarted mid-flight)
    finishOp(db, end.opId, {
      status: end.status,
      durationMs: end.durationMs,
      rows: end.rows,
      command: end.command,
      error: end.error,
    }).catch((err: unknown) =>
      log('error', 'oplog', `finishOp failed: ${err instanceof Error ? err.message : String(err)}`),
    );
    const record: OpRecord = {
      id: end.opId,
      connectionId: start.connectionId,
      tabId: start.tabId,
      startedAt: start.startedAt,
      durationMs: end.durationMs,
      kind: start.kind,
      status: end.status,
      rows: end.rows,
      command: end.command,
      error: end.error,
    };
    broadcast(IPC.opUpdate, record);
  });

  // On engine exit: fail every pending call (handled in engine-host) and mark every live connection
  // errored. No auto-respawn (P1 — record: the policy is a post-P5 decision).
  engineHost.onExit(() => services.connections.handleEngineExit());

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
    handle.close();
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
