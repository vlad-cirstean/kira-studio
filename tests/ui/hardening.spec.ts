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
