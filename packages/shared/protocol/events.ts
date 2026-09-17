/** The Go→renderer push channels (`apps/kira-studio/internal/bridge/events.go`'s constants, verbatim).
 *  Formerly the push half of ipc.ts's IPC const; the request/response half retired with
 *  window.kira, and the wire types for bound calls now come from the generated bindings (P57 D7).
 *  `kira:engine:state` and `kira:port` are absent — both are dead channels retired by D6/D3. */
export const CHANNEL = {
  openSettings: 'kira:open-settings',
  newConnection: 'kira:menu:new-connection',
  newRequest: 'kira:menu:new-request',
  importPostman: 'kira:menu:import-postman',
  importDataGrip: 'kira:menu:import-datagrip',
  toggleProjectPanel: 'kira:menu:toggle-project-panel',
  toggleOperationsPanel: 'kira:menu:toggle-operations-panel',
  commandPalette: 'kira:menu:command-palette',
  // C9 D5: ⌘P's fuzzy file finder — the View menu item above Command Palette.
  quickOpen: 'kira:menu:quick-open',
  tabNext: 'kira:menu:tab-next',
  tabPrev: 'kira:menu:tab-prev',
  tabClose: 'kira:menu:tab-close',
  viewFind: 'kira:menu:view-find',
  viewRefresh: 'kira:menu:view-refresh',
  viewRun: 'kira:menu:view-run',
  viewRunAll: 'kira:menu:view-run-all',
  viewFormat: 'kira:menu:view-format',
  appFlushBeforeClose: 'kira:app:flush-before-close',
  windowFlushBeforeClose: 'kira:window:flush-before-close',
  connectionState: 'kira:connection:state',
  connectionMetadataInvalidated: 'kira:connection:metadataInvalidated',
  connectionsChanged: 'kira:connections:changed',
  settingsChanged: 'kira:settings:changed',
  layoutChanged: 'kira:layout:changed',
  opUpdate: 'kira:op:update',
  appMetrics: 'kira:app:metrics',
  schemaChanged: 'kira:schema:changed',
  // P11 D8: a server-streaming call's coalesced message batches, delivered via EmitTo (one window
  // only) — the one genuinely new push channel this phase adds.
  grpcCall: 'kira:grpc:call',
  // G1 §3.6/D19: the pairing prompt's live queue snapshot and the Connected editors pane's list.
  gitPairing: 'kira:git:pairing',
  gitClientsChanged: 'kira:git:clients',
  // C7 D7: a repository-wide search's coalesced file groups, delivered via EmitTo (one window
  // only) — grpcCall's own shape, restated for a payload that shares no field with it.
  codeSearch: 'kira:code:search',
  // M2 §7.1: the prompt-mode approval queue's live snapshot — gitPairing's own shape.
  dbMcpApproval: 'kira:dbmcp:approval',
  // P83 §3.2: one terminal's coalesced output and its exit, delivered via EmitTo (one window
  // only) — codeSearch's own shape, restated for a byte payload.
  terminal: 'kira:terminal:data',
  // P85 §9.3: the custom-scripts list changed — connectionsChanged's own shape (Emit, not EmitTo,
  // so every window's tab-strip dropdown stays in sync).
  customScriptsChanged: 'kira:customScripts:changed',
  // P86 §11: every live Claude Code session across every window, Emit'd (not EmitTo) whenever
  // terminal.Registry.OnChange fires — customScriptsChanged's own shape, app-wide by definition.
  agentSessions: 'kira:agent:sessions',
  // P86 §8.4: one Claude Code hook firing for one tab, Emit'd (not EmitTo) — a hook event has no
  // window to address, so every window's own store filters by terminalId against tabs it owns.
  agentEvent: 'kira:agent:event',
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

/** `kira:terminal:data`'s own payload (internal/bridge/terminal.go's TerminalEvent, field for
 *  field) — one coalesced chunk of a session's output, or its exit. Never a bound-call arg or
 *  return type, so it has no generated binding — a plain interface here, mirroring
 *  AppMetricsSample just above: this event crosses no storage boundary and is never restored, so
 *  there is nothing for a zod schema to guard that this interface doesn't already state. */
export interface TerminalEvent {
  terminalId: string;
  data?: string; // base64, absent on the exit event
  exited: boolean;
  exitCode?: number;
  error?: string;
}
