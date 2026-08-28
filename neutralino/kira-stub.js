// P51 walking-skeleton stub. This is a fake — it answers `window.kira`, the app's
// preload/contextBridge surface, with fixed data so the Vue app mounts. Nothing it
// returns reaches a real connection, a real settings store, or a real engine
// process; every request the app makes through it is silently absorbed here and
// never leaves this page. It exists only to prove the app's *frontend* renders
// under NeutralinoJS — see docs/v1/plans/P51-neutralino-migration-spike.md.
//
// Loaded as a classic (non-module) <script> before the app's own module tag,
// because src/renderer/bridge/control.ts captures `window.kira` once at module
// scope on import.
(() => {
  var defaultSettings = {
    theme: 'catppuccin-mocha',
    fontFamily: 'system-ui',
    fontSize: 13,
    editorFontFamily: 'monospace',
    editorFontSize: 13,
  };

  var defaultLayout = {
    sidebarWidth: 260,
    sidebarCollapsed: false,
    panels: {},
  };

  function noopUnsubscribe() {
    return function unsubscribe() {};
  }

  function resolved(value) {
    return () => Promise.resolve(value);
  }

  var handlers = {
    settingsGetAll: resolved(defaultSettings),
    layoutGetAll: resolved(defaultLayout),
    engineStatus: resolved({ alive: false, pid: null }),
  };

  window.kira = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop !== 'string') return undefined;
        if (prop.indexOf('on') === 0) return noopUnsubscribe;
        if (handlers[prop]) return handlers[prop];
        return resolved([]);
      },
    },
  );
})();
