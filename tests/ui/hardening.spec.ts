import { expect, test } from './fixtures';

test('the renderer web preferences this app does not restate stay at their Electron 43.4.1 defaults (P46 D69)', async ({
  kira,
}) => {
  const prefs = await kira.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    // getLastWebPreferences() exists at runtime but is not in Electron's own public .d.ts.
    const wc = win?.webContents as unknown as { getLastWebPreferences(): unknown } | undefined;
    return wc?.getLastWebPreferences();
  });

  expect(prefs).toEqual({
    allowRunningInsecureContent: false,
    contextIsolation: true,
    disableDialogs: false,
    disablePopups: false,
    enableBlinkFeatures: '',
    experimentalFeatures: false,
    javascript: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    safeDialogs: false,
    safeDialogsMessage: '',
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  });
});

test('DevTools still opens in an unpackaged (dev/test) build (P46 D70)', async ({ kira }) => {
  const opened = await kira.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return false;
    return new Promise<boolean>((resolve) => {
      win.webContents.once('devtools-opened', () => {
        const isOpen = win.webContents.isDevToolsOpened();
        win.webContents.closeDevTools();
        resolve(isOpen);
      });
      win.webContents.openDevTools({ mode: 'detach' });
    });
  });

  // The packaged inverse (devTools: false ⇒ openDevTools() is a no-op) is held by
  // tests/unit/security.spec.ts's pinned option plus F64's recorded run against a packaged-mode
  // harness — this sandbox only ever launches unpackaged, so it cannot assert that branch itself.
  expect(opened).toBe(true);
});
