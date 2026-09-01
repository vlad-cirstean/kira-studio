// The legacy Electron/Node-engine-sidecar channel-name namespace this test tier still mocks
// against (P50 D5/D15's own fixture-key convention, kept for continuity with tests/ipc/'s
// committed fixtures — see mockRuntime.ts's CHANNEL_TO_FQN). Nothing under apps/kira-studio/frontend/src imports
// this anymore: the real wire protocol today is the generated Wails bindings under
// apps/kira-studio/frontend/bindings/. This is test-owned infrastructure now, not a live app protocol, which
// is why it lives here rather than in packages/shared/protocol (P2 R1: it used to live there as
// packages/shared/protocol/ipc.ts's `IPC` export, importable — misleadingly — as if it still described
// something real).
export const IPC = {
  appInfo: 'kira:app:info',
  settingsGetAll: 'kira:settings:getAll',
  settingsSet: 'kira:settings:set',
  layoutGetAll: 'kira:layout:getAll',
  layoutSet: 'kira:layout:set',
  engineStatus: 'kira:engine:status',
  port: 'kira:port',
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
  appFlushed: 'kira:app:flushed',

  filesChooseSave: 'kira:files:chooseSave',
  filesChooseOpen: 'kira:files:chooseOpen',

  connectionsList: 'kira:connections:list',
  connectionsCreate: 'kira:connections:create',
  connectionsUpdate: 'kira:connections:update',
  connectionsDuplicate: 'kira:connections:duplicate',
  connectionsDelete: 'kira:connections:delete',
  connectionsReorder: 'kira:connections:reorder',
  connectionsReveal: 'kira:connections:reveal',
  connectionsSecretsStatus: 'kira:connections:secretsStatus',
  connectionsTest: 'kira:connections:test',
  connectionsConnect: 'kira:connections:connect',
  connectionsDisconnect: 'kira:connections:disconnect',
  connectionsStates: 'kira:connections:states',
  treeChildren: 'kira:tree:children',
  treeDescribe: 'kira:tree:describe',
  treeDefinition: 'kira:tree:definition',
  treeInvalidate: 'kira:tree:invalidate',
  filtersList: 'kira:filters:list',
  filtersReplace: 'kira:filters:replace',
  opsRecent: 'kira:ops:recent',
  opsCancel: 'kira:ops:cancel',

  windowsEnsure: 'kira:windows:ensure',

  tabsList: 'kira:tabs:list',
  tabsSave: 'kira:tabs:save',

  queriesList: 'kira:queries:list',
  queriesSave: 'kira:queries:save',
  queriesListConsole: 'kira:queries:listConsole',
  queriesSaveConsole: 'kira:queries:saveConsole',
  queriesUpdate: 'kira:queries:update',
  queriesDelete: 'kira:queries:delete',
  queriesTouch: 'kira:queries:touch',
  queriesHistoryList: 'kira:queries:historyList',
  queriesHistoryRecord: 'kira:queries:historyRecord',

  connectionState: 'kira:connection:state',
  connectionMetadataInvalidated: 'kira:connection:metadataInvalidated',
  connectionsChanged: 'kira:connections:changed',
  settingsChanged: 'kira:settings:changed',
  opUpdate: 'kira:op:update',
  appMetrics: 'kira:app:metrics',
} as const;
