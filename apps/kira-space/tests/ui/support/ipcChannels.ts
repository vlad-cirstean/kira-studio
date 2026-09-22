// The test-owned fixture-key namespace this tier mocks against (Kira Studio's own
// tests/ui/support/ipcChannels.ts, ported and trimmed to this app's own bound surface —
// bridge/index.ts's own `control` object, apps/kira-space/main.go's 10 services). Nothing under
// apps/kira-space/frontend/src imports this: the real wire protocol is the generated Wails
// bindings under apps/kira-space/frontend/bindings/. See mockRuntime.ts's CHANNEL_TO_FQN for the
// other half of this mapping.
export const IPC = {
  githubOpenPullRequestUrl: 'kira:github:openPullRequestUrl',
  linkOpenExternal: 'kira:link:openExternal',

  settingsGetAll: 'kira:settings:getAll',
  settingsSet: 'kira:settings:set',
  settingsChanged: 'kira:settings:changed',

  layoutGetAll: 'kira:layout:getAll',
  layoutSet: 'kira:layout:set',
  layoutChanged: 'kira:layout:changed',

  appFlushBeforeClose: 'kira:app:flush-before-close',
  appFlushed: 'kira:app:flushed',
  windowFlushBeforeClose: 'kira:window:flush-before-close',
  windowFlushed: 'kira:window:flushed',

  filesChooseFolder: 'kira:files:chooseFolder',

  gitClientsList: 'kira:git:clients:list',
  gitClientsRevoke: 'kira:git:clients:revoke',
  gitClientsChanged: 'kira:git:clients',
  gitPairingPending: 'kira:git:pairing:pending',
  gitPairingApprove: 'kira:git:pairing:approve',
  gitPairingDeny: 'kira:git:pairing:deny',
  gitPairing: 'kira:git:pairing',
  gitVsixStatus: 'kira:git:vsix:status',
  gitVsixInstall: 'kira:git:vsix:install',

  tabsList: 'kira:tabs:list',
  tabsSave: 'kira:tabs:save',

  codeWorkspaceListRepos: 'kira:codeWorkspace:listRepos',
  codeWorkspaceRepoHeads: 'kira:codeWorkspace:repoHeads',
  codeWorkspaceRepoWorktreeLinks: 'kira:codeWorkspace:repoWorktreeLinks',
  codeWorkspaceImportRepo: 'kira:codeWorkspace:importRepo',
  codeWorkspaceRenameRepo: 'kira:codeWorkspace:renameRepo',
  codeWorkspaceRemoveRepo: 'kira:codeWorkspace:removeRepo',
  codeWorkspaceListFiles: 'kira:codeWorkspace:listFiles',
  codeWorkspaceReadFile: 'kira:codeWorkspace:readFile',
  codeWorkspaceOpenWorkspace: 'kira:codeWorkspace:openWorkspace',
  codeWorkspaceCloseWorkspace: 'kira:codeWorkspace:closeWorkspace',
  codeWorkspaceReadDiff: 'kira:codeWorkspace:readDiff',
  codeWorkspaceStartSearch: 'kira:codeWorkspace:startSearch',
  codeWorkspaceCancelSearch: 'kira:codeWorkspace:cancelSearch',
  codeSearch: 'kira:code:search',

  terminalDefaultCwd: 'kira:terminal:defaultCwd',
  terminalOpen: 'kira:terminal:open',
  terminalWrite: 'kira:terminal:write',
  terminalResize: 'kira:terminal:resize',
  terminalClose: 'kira:terminal:close',
  terminal: 'kira:terminal:data',
} as const;
