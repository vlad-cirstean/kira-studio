// The test-owned fixture-key namespace this tier mocks against (Kira Studio's own
// tests/ui/support/ipcChannels.ts, ported and trimmed to this app's own bound surface —
// bridge/index.ts's own `control` object, apps/kira-space/main.go's 13 services). Nothing under
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

  // P116 G1-G7: the menu-pushed commands, keep-awake and new-window bound calls, and the app-metrics
  // push — same values as Kira Studio's own ipcChannels.ts.
  openSettings: 'kira:open-settings',
  toggleProjectPanel: 'kira:menu:toggle-project-panel',
  tabNext: 'kira:menu:tab-next',
  tabPrev: 'kira:menu:tab-prev',
  tabClose: 'kira:menu:tab-close',
  windowsOpenNew: 'kira:windows:openNew',
  // P128 §2.2/§2.6: this app now persists a per-window module mode too, same channels as Kira
  // Studio's own ipcChannels.ts.
  windowsEnsure: 'kira:windows:ensure',
  windowsSetMode: 'kira:windows:set-mode',
  keepAwakeStatus: 'kira:keepAwake:status',
  keepAwakeSetManual: 'kira:keepAwake:setManual',
  keepAwake: 'kira:keepAwake:changed',
  appMetrics: 'kira:app:metrics',

  // P119: Kira Studio's own three update channels — same values as its own ipcChannels.ts.
  updateStatus: 'kira:update:status',
  updateInstall: 'kira:update:install',
  updateCancelInstall: 'kira:update:cancelInstall',

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

  // P129 Part 3 §2.2/§3.3: the ade module's own bound-call surface (6 of AdeService's 19 methods)
  // plus its push channels. `adeSessions` names the bound call (AdeService.Sessions, matching
  // control.ts's own method name) — its push counterpart is `adeSessionsChanged`, not `adeSessions`
  // again, the same `gitClientsList`/`gitClientsChanged` split this file already uses elsewhere, to
  // avoid two entries needing the same object key.
  terminalAgentSessions: 'kira:ade:agentSessions',
  adeSessions: 'kira:ade:sessions:call',
  adeRepoSnapshot: 'kira:ade:repoSnapshot',
  adeRepoPrs: 'kira:ade:repoPrs',
  adeRefresh: 'kira:ade:refresh',
  adeProvideCredential: 'kira:ade:provideCredential',
  adeSessionsChanged: 'kira:ade:sessions',
  adeRepo: 'kira:ade:repo',
  adeCredential: 'kira:ade:credential',
  // P129 Part 4 §3.4: the dialog's own six delivery/archive bound calls (PrepareLaunch, Send,
  // ArchiveRisk, Archive, SetQueuedAfter, UpdateNewWork) — the launch/archive half of
  // AdeService's 19 methods this part first calls.
  adePrepareLaunch: 'kira:ade:prepareLaunch',
  adeSend: 'kira:ade:send',
  adeArchiveRisk: 'kira:ade:archiveRisk',
  adeArchive: 'kira:ade:archive',
  adeSetQueuedAfter: 'kira:ade:setQueuedAfter',
  adeUpdateNewWork: 'kira:ade:updateNewWork',
  agentSessions: 'kira:agent:sessions',
  agentEvent: 'kira:agent:event',
  // P129 Part 5 §3.4/§2.2: the timeline's own five remaining bound calls (SetPlan, ForcePush, the
  // Add popover's three) — first mocked-UI consumer, so this is their first entry here.
  adeSetPlan: 'kira:ade:setPlan',
  adeForcePush: 'kira:ade:forcePush',
  adeCandidateBranches: 'kira:ade:candidateBranches',
  adeAddBranch: 'kira:ade:addBranch',
  adeAddNewWork: 'kira:ade:addNewWork',
  // P129 Part 6 §3.4: the detail panel's own two remaining bound calls.
  adeSetBranchMeta: 'kira:ade:setBranchMeta',
  adeBindNewWork: 'kira:ade:bindNewWork',
} as const;
