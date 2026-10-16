# P108 Part 13 — review plan: shared frontend base

Chunk B1, stream B position 1 (pre-plan §5.12). One Opus reviewer runs this plan, reports findings,
fixes nothing; one Sonnet fixer then lands one commit per finding. Tree surveyed: `40141d4`.

Paths repo-relative. `Studio` = `apps/kira-studio`, `Space` = `apps/kira-space`, `vscode` =
`apps/kira-space-vscode`, `SF`/`PF` = each app's `frontend/src`, `WB` = `packages/workbench/src`,
`TH` = `packages/theme/src`, `KU` = `packages/kira-ui/src`, `SH` = `packages/shared`.

## 0. Method

- **`codegraph_explore`** for discovery: `WorkbenchHost`/`createTabsStore`/`TabsHost` against both
  apps' `workbench/host.ts` and `state/tabs.ts`; `createTerminalsStore`/`createCoreControl`/`CHANNEL`/
  `useTerminalMount`; blast radius of `useVirtualRows`, `useModalFocus`, `KuiDialog`,
  `KuiPopoverPanel`, `defineKiraTheme`/`cssVar`.
- **`git grep` of import lines** for the exact importer set. CodeGraph's TS name resolution
  over-links (pre-plan §0), so every cross-package claim is re-checked against a real import.
- **Library source read** where a finding depends on it: `@tanstack/virtual-core` 3.17.11 memo
  deps, `@tanstack/vue-virtual`'s option watch, Monaco 0.56.0 `Color.fromHex`.
- **Executed in a real engine** where behavior is engine-defined: Playwright Chromium 141 and
  WebKit 26.6 (fetched per `docs/DEV_ENVIRONMENT.md`) for label activation, canvas color
  serialization and the accessibility tree. Full `bun run typecheck` for the host-subset contract.
- **Mechanical token sweep**: every `var(--…)` in the own set against every custom property
  defined or set at runtime anywhere in the repo.

## 1. Own file set

Pre-plan §5.12 list, resolved against the tree. Corrections are marked.

**`packages/workbench`** (≈6.1k lines, 66 files):

- `WB/host.ts`, `WB/tabs/types.ts`
- `WB/state/{createTabsStore,createSettingsStore,createLayoutStore,createTerminalsStore,createTerminalTabs,contextMenu,confirmDialog,queryClient,tabRuntime,tooltip}.ts`
- `WB/bridge/{createCoreControl,rpc}.ts`
- `WB/components/{WorkbenchShell,MainView,TabStrip,TitleBar,StatusBar,SettingsShell,ContextMenu,ConfirmDialog,AttributeTooltip,TooltipAnchorBridge}.vue`
- `WB/settings/fields/{DateFormat,FontSize,GitLogLevel,RowDensity,WordWrap}Field.vue`,
  `WB/settings/useSettingsDeepLinkReset.ts`
- `WB/prompt/{TextPromptDialog.vue,useTextPrompt.ts}`
- `WB/terminal/{TerminalHostView.vue,useTerminalMount.ts,terminalRenderer.ts,terminalRendererLoader.ts}`
- `WB/editor/{monaco,monacoEntry,monacoTheme}.ts`, `WB/editor/monarch/{decorators,mongo,redis}.ts`
- `WB/shortcuts/{commands,keys}.ts`
- `WB/util/{clipboard,floatingPosition,format,panelSearch,treeVirtualRows,useBusyAction,useDragReorder,virtualRows,wheelScroll,window}.ts`
- `WB/workbench.css`, `packages/workbench/{env.d.ts,tsconfig.json,package.json}`
- `WB/testing/{ui/{fixtures,mockRuntime,server},unit/{async,fakeSocket,restoreAfterEach,wailsRuntime,window}}.ts`
  (test infra; lower weight).

**`packages/theme`** (≈4.1k lines, 94 files):

- TS/Vue: `TH/{stickyBand,wrapSelection,connColor}.ts`, `TH/composables/useNumberStepper.ts`,
  `TH/lib/utils.ts`, `TH/CodiconIcon.vue`.
- CSS: `TH/{base,tokens,primitives,shadcn-bridge,kui-bridge,vscode-bridge,review-decorations,blame-annotation}.css`.
- shadcn-vue: `TH/components/ui/{alert,button,checkbox,command,dialog,dropdown-menu,input,input-group,label,popover,separator,textarea,toggle,toggle-group,tooltip}/**`.
  Generated upstream code; review only local edits (`button` variants/sizes,
  `tooltip/TooltipDisabledTrigger.vue`) and how the own set composes them.

**`packages/kira-ui`** (≈2.1k lines, 23 files): `KU/{index,floatingPosition,modalFocus,contextMenuModel,optionTypes,tooltip}.ts`,
`KU/Kui{Button,ColumnResizeHandle,ContextMenu,Dialog,IconBox,MenuList,PopoverPanel,SearchInput,Segmented,Select,TextInput,Tooltip}.vue`,
`KU/theme/controls.css`, `KU/{contextMenuModel,tooltip}.test.ts`.

**`packages/shared`** (≈1.0k lines): `SH/caps.ts`, `SH/protocol/events.ts`,
`SH/domain/{base64,color,connection,git,layout,path,repo,settings,shortcuts,tabs}.ts`.

- **Correction:** real import lines put only nine `domain/` files plus `protocol/events.ts`
  outside Studio (`tabs` 8, `settings` 8, `repo` 6, `layout` 5, `path` 3, `events` 3, `git` 2,
  `color` 2, `shortcuts` 2, `base64` 1). `caps.ts` and `domain/connection.ts` have no importer
  outside Studio and Studio-owned `packages/db-fixtures`. They stay here because the SPEC row
  names them. Findings in them affect Studio only.
- `domain/tabs.ts` imports Studio-owned `domain/{mode,tree,queries}.ts` (callees, read-only).

## 2. One hop: callers

Import-line counts: `@workbench/*` Studio 161 files, Space 39, `git-ui` 7, `git-ipc` 2. `@theme/*`
Studio 112, Space 30. `@kira/kira-ui` `git-ui` 44, Studio 2. `vscode` reaches all three only
through `git-ui`.

- **Factory seams, one caller per app each.** `createTabsStore`, `createSettingsStore`,
  `createLayoutStore` and `createTerminalsStore` are each called from `{SF,PF}/state/*.ts`.
  `createCoreControl` from `{SF,PF}/bridge/index.ts`, `createOpenTerminalTab` from
  `{SF,PF}/state/terminalTabs.ts`. `WorkbenchHost` is built in `{SF,PF}/workbench/host.ts`.
  Space's `state/repoTabs.ts` `ensureWorkspaceShell` runs after `hydrateTabs`, and Studio's
  `TabsHost` hooks (`onOpened`, `onClosed`, `onDuplicated`, `persistable`) compose onto the factory.
- **Shell components.** `WorkbenchShell`: both `App.vue`/`workbench/WorkbenchShell.vue`.
  `SettingsShell`: both `workbench/SettingsDialog.vue`. `TerminalHostView`: `SF/views/terminal/TerminalView.vue`,
  `PF/views/repo/RepoTerminalView.vue`.
- **Composables.** `useVirtualRows`: `SF/views/{documents/DocumentView,console/ConsoleResultGrid,stream/StreamView,browse/BrowseView}.vue`,
  `SF/workbench/panels/OperationsPanel.vue`, `PF/repo/RepoSearchView.vue`. `useTreeVirtualRows`:
  `SF/project/ProjectTree.vue`, `SF/api/CollectionsTree.vue`, `PF/repo/RepoFileTree.vue`.
  `useTextPrompt`: `PF/repo/GitPanel.vue`, `SF/views/{console/ConsoleSavedMenu,shared/FilterHistoryMenu}.vue`.
  `useConfirmDialogStore`: 16 files, 15 of them in Studio. `useContextMenuStore`: 17 files.
  `usePanelHeaderSearch`: 4 panels.
- **Monaco.** `loadMonaco`: `SF/editor/MonacoHost.vue`, `SF/views/{httprequest/ResponseDiffDialog,shared/AutocompleteField}.vue`,
  `PF/views/repo/{RepoFileView,RepoDiffView,useDiffEditor,monaco}`.
- **kira-ui.** `KuiDialog`: 15 `git-ui` dialog files (30 references). `useModalFocus`: `KuiDialog`,
  `git-ui` `BranchPicker.vue`, `review/BaseSelector.vue`. `KuiPopoverPanel`: `git-ui`
  `AppToolbar.vue`, `BranchPicker.vue`. `KuiColumnResizeHandle`: `git-ui` `CommitGrid.vue`,
  `SF/views/stream/StreamView.vue`.
- **Settings fields.** Both apps' `workbench/settings/{Appearance,Advanced}Pane.vue`.
- **Go mirrors (read).** `internal/appsettings` for `domain/settings.ts` (Part 2 open concurrently,
  pre-plan §3.3). `internal/terminal` + both `bridge/terminal.go` for `TerminalEvent`. Both
  `bridge/layout.go` `Set` emits `layoutChanged` to every window, the sender included.

## 3. One hop: callees

Vue 3, Pinia, VueUse, reka-ui (shadcn-vue), `@tanstack/vue-virtual`/`virtual-core`,
`@tanstack/vue-query`, `@floating-ui/dom`, `@xterm/xterm` (+fit, web-links), `monaco-editor`
0.56.0, zod, Tailwind v4, `/wails/runtime.js` `Events`, the generated Wails bindings (structural
only, through `CoreBindings`).

## 4. Edge cases to weight

This chunk sits under every view in both apps and `git-ui` (desktop and VS Code webviews). Weight
each item against both apps' callers, not just the package's own use.

- **Tab-state invariants.** `active` flags against `activeIdByWorkspace` must agree after every
  mutation. `MainView` renders from the id and `TabStrip`/`closeTabInternal` read the flag. Check
  `hydrateTabs` when no persisted tab is active (the active one was a terminal or an incognito tab,
  neither persisted), `closeOthers` with a surviving pinned tab, preview-cohort eviction, and the
  `moveTab` splice against `TabStrip`'s live drag loop in both directions.
- **Persistence races.** `saveIfChanged` snapshot bookkeeping against out-of-order resolution.
  Flush-before-close handshakes. Layout's debounced write against the `layoutChanged` echo to the
  sender.
- **Pending-promise stores.** A second `confirmDialog`/`useTextPrompt.open` while one is pending.
- **Virtualization.** `estimateSize` inputs changing while `count` does not: document expand/
  collapse, row-density toggle. Sticky band arithmetic at list ends.
- **Engine-defined behavior** (ships on WKWebView and WebKitGTK, tests run Chromium, `git-ui` also
  runs in Electron webviews):
  - canvas color serialization of every `--kira-*` token feeding Monaco's `Color.fromHex`;
  - `KeyboardEvent.key` under macOS Option;
  - `<label>` activation of its first labelable descendant.
- **Accessibility.** `aria-hidden` ancestry over interactive content, dialog focus
  entry/trap/return when a dialog mounts already open, label/control association in settings
  fields, keyboard parity of drag-only affordances.
- **Theme contract.** Undefined `var(--…)` references, Tailwind `@theme` name collisions between
  `base.css` and `shadcn-bridge.css` (the `--color-muted` one is P110's, excluded), tokens with
  alpha or `color-mix()`.
- **Terminal lifecycle.** Output arriving after `closeTerminalSession`. The drain cap. Remount
  against an in-flight lazy import. Root-path canonicalization.
- **Composition-API misuse.** Watchers that only fire on transitions but are expected to run at
  mount. Composables creating observers after an `await`. Module-level singletons (`byTabId`,
  `handlers`) against both apps loading the same module.
- **Watch items (pre-plan §5.12).** Both apps still satisfy `WorkbenchHost` structurally (P103
  Parts 1-2). The P104 primitive swap and the P105 additions (`TooltipDisabledTrigger`,
  `KuiColumnResizeHandle`, the §5.2(b) backdrop change).

## 5. Out of scope

- The `--color-muted` collision (P110).
- Generated code: `SH/protocol/wire`, the Wails bindings. shadcn-vue files as shipped upstream.
- Studio-only and Space-only files reached through §2. Report a defect found there as a pointer for
  its owning Part, not a finding here. Studio files are stream A. Hand them off per pre-plan §3.3.
- Docs prose (P109).

## 6. Review procedure

1. Read each own-file in full. Shadcn-vue files: read only for local edits.
2. For each candidate, trace its callers with `codegraph_explore` to confirm reachability and blast
   radius across both apps and `git-ui`.
3. Confirm library-dependent claims against the installed package source. Confirm engine-dependent
   claims in Playwright Chromium and WebKit.
4. Report each finding with file:line, defect, why it is real, and fix direction. Record items
   considered and dismissed, so the fixer does not re-derive them.
