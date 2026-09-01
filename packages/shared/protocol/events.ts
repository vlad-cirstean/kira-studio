/** The Go→renderer push channels (`apps/kira-studio/internal/bridge/events.go`'s constants, verbatim).
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
  windowFlushBeforeClose: 'kira:window:flush-before-close',
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
 *  `apps/kira-studio/internal/metrics.Sample`'s JSON tags.
 *
 *  cpuPercent is normalized to the machine's whole capacity (0-100), not the per-core-sum macOS's
 *  own Activity Monitor shows in its per-process "% CPU" column (which reads up to `logicalCPUs`
 *  times higher for the same load) — StatusBar.vue's tooltip states this explicitly since it's the
 *  exact cross-check a user is likely to make. memoryBytes is RSS everywhere except darwin, where
 *  it is phys_footprint — Activity Monitor's own "Memory" column, not its "Real Memory" one (P7
 *  F1/D2). logicalCPUs and processCount exist so the tooltip can say what cpuPercent is a
 *  percentage *of* and how many processes memoryBytes covers (P7 F6/D6). */
export interface AppMetricsSample {
  cpuPercent: number;
  memoryBytes: number;
  logicalCPUs: number;
  processCount: number;
}
