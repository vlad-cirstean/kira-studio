import type { BrowserWindow, CommandLine, Session, WebPreferences } from 'electron';

export function rendererWebPreferences(opts: { preload: string; isDev: boolean }): WebPreferences {
  return {
    preload: opts.preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    devTools: opts.isDev,
    spellcheck: false,
    webgl: false,
  };
}

// Chromium routes both halves of navigator.clipboard through the permission *request* handler
// (P46 F68) — collapsing this to a deny-all breaks the grid's paste and clipboard.ts's 38
// copyText call sites, with no failure visible in this repo's Docker-free test subset.
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write']);

export function hardenSession(session: Session): void {
  session.setSpellCheckerEnabled(false);
  session.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  session.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  session.setDevicePermissionHandler(() => false);
}

// Reverses P46 D79 ("no app.commandLine switch is added, not one") on explicit request. D79's
// reasoning still holds — these are fail-open (Chromium silently ignores a switch name it no
// longer recognises, so a future Electron bump can re-enable the target with nothing to catch
// it) and unlike hardenSession/hardenWindow there is no first-class API to assert the *effect*
// through. What tests/ui/hardening.spec.ts can and does pin is that the switch is still being
// passed (`app.commandLine.hasSwitch(...)`) — not that Chromium still honours it. Every name here
// targets a capability this app has zero call sites for (grepped: no speechSynthesis/
// SpeechRecognition, no net.request/fetch from main — F76 already found no crash reporter/updater
// traffic either), so there is nothing behind any of these switches to break.
const DISABLED_CHROMIUM_FEATURES = [
  'disable-speech-api',
  'disable-speech-synthesis-api',
  'disable-translate',
  'disable-background-networking',
  'disable-domain-reliability',
  'disable-component-update',
  'disable-client-side-phishing-detection',
];

export function hardenCommandLine(commandLine: Pick<CommandLine, 'appendSwitch'>): void {
  for (const feature of DISABLED_CHROMIUM_FEATURES) commandLine.appendSwitch(feature);
}

export function hardenWindow(win: BrowserWindow, appBaseUrl: string): void {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // will-frame-navigate, not will-navigate: it fires first and covers sub-frames too (P46 F66).
  wc.on('will-frame-navigate', (event) => {
    if (!event.url.startsWith(appBaseUrl)) event.preventDefault();
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
}
