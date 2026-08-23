import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { log } from './log';
import type { KiraDb } from './storage/db';
import { getAllLayout, setLayout } from './storage/repos/layout';

const BOUNDS_DEBOUNCE_MS = 300;

export async function createWindow(db: KiraDb): Promise<BrowserWindow> {
  const layout = await getAllLayout(db);
  const bounds = layout.window.bounds;

  const win = new BrowserWindow({
    ...(bounds ?? {}),
    titleBarStyle: 'default',
    backgroundColor: '#1F1F1F',
    show: false,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  // D9: the cold-start budget's in-app measurement point — process.uptime() at the moment the
  // renderer has finished loading, read back by tests/ui/support/measure.ts and, packaged, by a
  // human grepping ~/.kira-studio/logs (docs/PERF.md).
  win.webContents.once('did-finish-load', () => {
    log('info', 'startup', `did-finish-load at uptime ${Math.round(process.uptime() * 1000)}ms`);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const persistBounds = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void setLayout(db, { window: { bounds: win.getBounds() } });
    }, BOUNDS_DEBOUNCE_MS);
  };
  win.on('resize', persistBounds);
  win.on('move', persistBounds);

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
