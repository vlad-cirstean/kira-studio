/** The Go→renderer push channels (`shell/internal/bridge/events.go`'s constants, verbatim).
 *  Formerly the push half of ipc.ts's IPC const; the request/response half retired with
 *  window.kira, and the wire types for bound calls now come from the generated bindings (P57 D7).
 *  `kira:engine:state` and `kira:port` are absent — both are dead channels retired by D6/D3. */
export const CHANNEL = {
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
  connectionMetadataInvalidated: 'kira:connection:metadataInvalidated',
  connectionsChanged: 'kira:connections:changed',
  settingsChanged: 'kira:settings:changed',
  opUpdate: 'kira:op:update',
  appMetrics: 'kira:app:metrics',
} as const;

/** Summed across every process metrics.Sample covers (P56's ticker) — a single app-wide readout
 *  for the status bar, not a per-process breakdown. No generated binding carries this shape: it
 *  is emitted (`kira:app:metrics`), never returned from a bound call, so it has no home in any
 *  service's models.ts and stays hand-written here instead (formerly ipc.ts's own type). Mirrors
 *  `shell/internal/metrics.Sample`'s JSON tags. */
export interface AppMetricsSample {
  cpuPercent: number;
  memoryBytes: number;
}
