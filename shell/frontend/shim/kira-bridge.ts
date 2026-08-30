// P52 M1's `window.kira` shim (§7.1/§12.3's "hand-written stand-in" idea, applied here against
// real Go services instead of test fixtures). It exists so the real, unmodified src/renderer can
// boot inside a real Wails webview without src/ ever being touched (P52 §3.4): every method below
// either calls one of the generated Wails bindings under ../bindings (real Go, per §7's boot-path
// read methods) or subscribes to a real Wails event under today's exact `kira:*` channel name
// (§7.1) — quiet for now because no emitter is wired until P56's menu/lifecycle/shell code lands,
// not because it's fake.
//
// This file is injected by vite.wails.config.ts's build-time HTML transform. It intentionally
// implements only the boot-path surface src/renderer/main.ts and App.vue's onMounted actually
// call — the other ~50 KiraApi channels are P55/P56 work.
import { Events } from '/wails/runtime.js';

import * as AppService from '../bindings/github.com/kirathecat/kira-studio/shell/internal/bridge/appservice.js';
import * as ConnectionsService from '../bindings/github.com/kirathecat/kira-studio/shell/internal/bridge/connectionsservice.js';
import * as EngineService from '../bindings/github.com/kirathecat/kira-studio/shell/internal/bridge/engineservice.js';
import * as FiltersService from '../bindings/github.com/kirathecat/kira-studio/shell/internal/bridge/filtersservice.js';
import * as LayoutService from '../bindings/github.com/kirathecat/kira-studio/shell/internal/bridge/layoutservice.js';
import * as LifecycleService from '../bindings/github.com/kirathecat/kira-studio/shell/internal/bridge/lifecycleservice.js';
import * as OpsService from '../bindings/github.com/kirathecat/kira-studio/shell/internal/bridge/opsservice.js';
import * as SettingsService from '../bindings/github.com/kirathecat/kira-studio/shell/internal/bridge/settingsservice.js';
import * as TabsService from '../bindings/github.com/kirathecat/kira-studio/shell/internal/bridge/tabsservice.js';

// Today's exact IPC channel strings (src/shared/protocol/ipc.ts's IPC const) — kept identical so
// a future Go emitter (P56) needs no renderer-side rename, per §7.1.
const CHANNEL = {
  settingsChanged: 'kira:settings:changed',
  engineState: 'kira:engine:state',
  openSettings: 'kira:open-settings',
  newConnection: 'kira:menu:new-connection',
  toggleProjectPanel: 'kira:menu:toggle-project-panel',
  toggleOperationsPanel: 'kira:menu:toggle-operations-panel',
  commandPalette: 'kira:menu:command-palette',
  tabNext: 'kira:menu:tab-next',
  tabPrev: 'kira:menu:tab-prev',
  tabClose: 'kira:menu:tab-close',
  viewFind: 'kira:menu:view-find',
  viewRefresh: 'kira:menu:view-refresh',
  viewRun: 'kira:menu:view-run',
  viewRunAll: 'kira:menu:view-run-all',
  appFlushBeforeClose: 'kira:app:flush-before-close',
  connectionState: 'kira:connection:state',
  connectionsChanged: 'kira:connections:changed',
  opUpdate: 'kira:op:update',
  appMetrics: 'kira:app:metrics',
} as const;

// A real Wails event subscription, not a stub: it registers with the real runtime and will fire
// the moment a Go emitter for `name` exists (P56). It is quiet today only because no such emitter
// is wired up yet in this M1 walking skeleton.
function on<T>(name: string, cb: (payload: T) => void): () => void {
  return Events.On(name, (ev: { data: T }) => cb(ev.data));
}

window.kira = {
  appInfo: () => AppService.Info(),
  settingsGetAll: () => SettingsService.GetAll(),
  onSettingsChanged: (cb) => on(CHANNEL.settingsChanged, cb),
  layoutGetAll: () => LayoutService.GetAll(),
  engineStatus: () => EngineService.Status(),
  onEngineState: (cb) => on(CHANNEL.engineState, cb),
  onOpenSettings: (cb) => on(CHANNEL.openSettings, cb),
  onNewConnection: (cb) => on(CHANNEL.newConnection, cb),
  onToggleProjectPanel: (cb) => on(CHANNEL.toggleProjectPanel, cb),
  onToggleOperationsPanel: (cb) => on(CHANNEL.toggleOperationsPanel, cb),
  onCommandPalette: (cb) => on(CHANNEL.commandPalette, cb),
  onTabNext: (cb) => on(CHANNEL.tabNext, cb),
  onTabPrev: (cb) => on(CHANNEL.tabPrev, cb),
  onTabClose: (cb) => on(CHANNEL.tabClose, cb),
  onViewFind: (cb) => on(CHANNEL.viewFind, cb),
  onViewRefresh: (cb) => on(CHANNEL.viewRefresh, cb),
  onViewRun: (cb) => on(CHANNEL.viewRun, cb),
  onViewRunAll: (cb) => on(CHANNEL.viewRunAll, cb),
  onFlushBeforeClose: (cb) => on(CHANNEL.appFlushBeforeClose, cb),
  // P56 D11: the quit-flush handshake's ack (§1.3) — tabs.ts awaits its own tabsSave before
  // calling this, and Quitter.Flushed() is the goroutine waiting on it.
  appFlushed: () => LifecycleService.Flushed(),

  connectionsList: () => ConnectionsService.List(),
  connectionsStates: () => ConnectionsService.States(),
  connectionsSecretsStatus: () => ConnectionsService.SecretsStatus(),
  onConnectionState: (cb) => on(CHANNEL.connectionState, cb),
  onConnectionsChanged: (cb) => on(CHANNEL.connectionsChanged, cb),

  filtersList: (args: { connectionId: string }) => FiltersService.List(args),

  opsRecent: (args: { limit: number }) => OpsService.Recent(args),
  onOpUpdate: (cb) => on(CHANNEL.opUpdate, cb),

  onAppMetrics: (cb) => on(CHANNEL.appMetrics, cb),

  tabsList: () => TabsService.List(),
  tabsSave: (args) => TabsService.Save(args),
  // biome-ignore lint/suspicious/noExplicitAny: deliberately partial KiraApi (P52 M1 §7) — the other ~50 channels are P55/P56 work.
} as any;
