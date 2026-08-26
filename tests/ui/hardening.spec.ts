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

test('window.open is denied and no second window is created (P46 D72/F65)', async ({ kira }) => {
  const countBefore = await kira.app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
  );

  const openedHandle = await kira.window.evaluate(() => {
    const handle = window.open('https://example.com/', '_blank');
    return handle === null;
  });

  const countAfter = await kira.app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
  );

  expect(openedHandle).toBe(true);
  expect(countBefore).toBe(1);
  expect(countAfter).toBe(1);
});

test('the renderer cannot navigate itself to a remote origin (P46 D72/F66)', async ({ kira }) => {
  // A plain locator .toBeVisible() wait here fights Playwright's own navigation-lifecycle
  // tracking — location.href triggers a real (if immediately prevented) navigation attempt, and
  // the locator wait hangs on "waiting for navigation to finish...". Reading the URL and the DOM
  // straight from the main process's webContents sidesteps that entirely, the same way F66's own
  // reproduction did.
  await kira.window.evaluate(() => {
    location.href = 'https://kira-studio.invalid/';
  });
  await kira.window.waitForTimeout(300);

  const stillThere = await kira.app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return { url: '', statusBar: false };
    const statusBar = await win.webContents.executeJavaScript(
      `document.querySelector('[data-testid="status-bar"]') !== null`,
    );
    return { url: win.webContents.getURL(), statusBar };
  });

  expect(stillThere.url).toContain('out/renderer/index.html');
  expect(stillThere.statusBar).toBe(true);
});

test('the built-in spellchecker is off (P46 D74)', async ({ kira }) => {
  const enabled = await kira.app.evaluate(({ session }) =>
    session.defaultSession.isSpellCheckerEnabled(),
  );
  expect(enabled).toBe(false);

  // Deliberately NOT asserting an input's DOM `spellcheck` IDL property here — measured, not
  // assumed: it stays `true` by web-platform default on a bare `<input>` regardless of either
  // webPreferences.spellcheck or setSpellCheckerEnabled(false) (verified against a freshly
  // created element in this app's own renderer). Both levers turn off Chromium's actual
  // dictionary-lookup/suggestion engine — session.defaultSession.isSpellCheckerEnabled() above is
  // the real, verifiable signal that they did; the DOM attribute reflects page-authored intent,
  // not the platform feature's on/off state, and was never going to move.
});

test('the shared text field opts out of autofill (P46 D76)', async ({ kira }) => {
  await kira.window.click('[data-testid="add-connection"]');
  await expect(kira.window.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await kira.window.click('[data-testid="connection-kind-postgres"]');
  await expect(kira.window.locator('[data-testid="connection-password"]')).toBeVisible();

  await expect(kira.window.locator('[data-testid="connection-password"]')).toHaveAttribute(
    'autocomplete',
    'off',
  );
});
