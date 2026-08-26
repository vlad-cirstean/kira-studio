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

test('every Chromium permission is denied except notifications/geolocation/media/device access this app never uses (P46 D71)', async ({
  kira,
}) => {
  const result = await kira.window.evaluate(async () => {
    const notif = await Notification.requestPermission();
    const permQuery = await navigator.permissions.query({
      name: 'notifications' as PermissionName,
    });
    const geo = await new Promise<string>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve('ok'),
        (err) => resolve(`error:${err.code}`),
      );
    });
    return { notif, permQueryState: permQuery.state, geo };
  });

  expect(result.notif).toBe('denied');
  expect(result.permQueryState).toBe('denied');
  expect(result.geo).toBe('error:1'); // GeolocationPositionError.PERMISSION_DENIED
});

test('the clipboard still works — the one permission this app actually needs (P46 D71/F68)', async ({
  kira,
}) => {
  await kira.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.focus();
  });

  const result = await kira.window.evaluate(async () => {
    const focused = document.hasFocus();
    await navigator.clipboard.writeText('kira-hardening-clipboard-probe');
    const read = await navigator.clipboard.readText();
    return { focused, read };
  });

  expect(result.focused).toBe(true);
  expect(result.read).toBe('kira-hardening-clipboard-probe');
});
