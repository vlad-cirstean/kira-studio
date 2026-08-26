import type { BrowserWindow, Session, WebPreferences } from 'electron';

export function rendererWebPreferences(opts: { preload: string; isDev: boolean }): WebPreferences {
  return {
    preload: opts.preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    devTools: opts.isDev,
  };
}

// Chromium routes both halves of navigator.clipboard through the permission *request* handler
// (P46 F68) — collapsing this to a deny-all breaks the grid's paste and clipboard.ts's 38
// copyText call sites, with no failure visible in this repo's Docker-free test subset.
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write']);

export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  session.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  session.setDevicePermissionHandler(() => false);
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
