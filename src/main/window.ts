import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import type { Db } from './storage/db';
import { getAllLayout, setLayout } from './storage/repos/layout';

const BOUNDS_DEBOUNCE_MS = 300;

export function createWindow(db: Db): BrowserWindow {
  const layout = getAllLayout(db);
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

  let timer: ReturnType<typeof setTimeout> | undefined;
  const persistBounds = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      setLayout(db, { window: { bounds: win.getBounds() } });
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
