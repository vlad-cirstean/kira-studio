# P168 Part 13: review plan, Studio shell, project tree, state stores and UI-test harness

Chunk C4, Stream C position 4 of 4 (pre-plan `P168-prep-plan.md` §5.12; moved from Stream A by user
instruction, SPEC row). One Opus reviewer runs this plan and reports findings. It fixes nothing. One
Sonnet fixer follows (§8). Tree surveyed: `844e132` (`p168-stream-c`, on `v2.0` with Part 12's fixes
and the drop of its findings file).

Paths repo-relative. `SF` = `apps/kira-studio/frontend/src`, `ST` = `apps/kira-studio/tests`,
`SD` = `packages/shared/domain`, `SP` = `packages/shared/protocol`, `SI` = `apps/kira-studio/internal`,
`PW` = `packages/workbench/src` (`@workbench`), `PT` = `packages/theme/src` (`@theme`). Line numbers
are as of `844e132`; re-read before citing.

SPEC row names this file `plans/P168-part13-studio-shell.md`; the orchestrator gave the same name.

## 0. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Load it with `ToolSearch "codegraph"` if it is not
  listed, then call it with `projectPath=/home/user/kira-studio-streamC` before any Read/Grep on a
  symbol, call-path or blast-radius question. The orchestrator greps the run's tool log for real
  calls. Index present at planning (`.codegraph/codegraph.db`); if missing, run
  `sh scripts/codegraph-setup.sh` in the worktree, never fall back silently. Seeds:
  - boot and shell: `mountShell`, `bootstrapShell`, `App` (`onMounted` channel subscriptions,
    `closeActiveTab`), `createWorkbenchHost`, `TAB_VIEWS`, `MODES`, `createTerminalModule`,
    `WorkbenchShell`, `TitleBar`, `StatusBar`, `StudioStart`, `ProjectPanel`, `OperationsPanel`,
    `window.__kira*` hooks under `__KIRA_DEBUG_HOOKS__`.
  - tabs: `useTabsStore` (Studio `extend`: `onConnectionsChanged`, `onConnectionState`,
    `openTrackedTab`, `openDataTab`, `openConsoleTab`, `activateNextTab`), `TAB_KINDS`
    (`dropResources`, `parseState`, `duplicateState`, `defaultState`, `noDrop`), `tabDomain.ts`
    schemas (`parseStateWith`, `STUDIO_TAB_KIND_MODE`), `useTabIncognitoStore`
    (`registerIncognitoSetListener`), `useRecentTablesStore`, `markHydrated`/`unmarkHydrated`.
    Contract (Part 9): `createTabsStore` (`enqueueSave`, `saveIfChanged`, `saveDebounced`,
    `saveNow`, `flushPendingTabState`, `hydrateTabs`, `closeTabInternal`, `patchTabState`).
  - stores: `useConnectionsStore` (`hydrateConnections`, `connectConnection`,
    `disconnectConnection`, `states`, `secretStorage`), `useConnectionDialogStore`,
    `useSettingsStore` (`appearanceVersion`), `useModeStore`, `useLayoutStore`,
    `useRunStateStore`, `useCellSelectionStore` (`publishSelectedCell`, `clearSelectedCellFor`),
    `viewCommands.ts`, `useSchemaDialogStore`/`initSchemaSync`/`ensureDdl` (`schemas.ts`),
    `useSchemaColumnsStore` (`ensureSchemaColumns`, `generationFor`, `dropSchemaColumns`,
    `initSchemaColumnsSync`), `maskRules.ts` (`initMaskRulesSync`, `correlationKeyFor`,
    `regenerateMaskKey`, `loadMaskRuleCounts`), `useObjectStoreStore`, `useFakeDataStore`,
    `useDatagripImportStore`, `useDbMcpStore`, `useCustomScriptsStore`,
    `useConsoleDefaultsStore`, `useOpsStore`, `useCacheStatsStore`, `useKeepAwakeStore`,
    `useTerminalsStore`, `terminalTabs.ts`, `usePaletteStore`.
  - project tree: `useTreeStore` (`loadChildren`, `loadVisibility`, `saveVisibility`, `expand`,
    `collapse`, `toggleGroup`, `refresh`, `refreshConnection`, `refreshExpanded`, `revealPath`,
    `dropConnectionState`, `knownConnectionIds`, `initTreeSync`, `loadSavedQueries`),
    `useFiltersDialogStore`, `ProjectTree` (`onToggle`, `onOpen`, `onContextMenu`,
    `onTreeKeydown`, `revealKey`), `TreeRow`, `filterTree.ts`, `grouping.ts`, `menus.ts`
    (`menuForRow`, `emptyBackgroundMenu`), `menuItems.ts`, `ConnectionDialog` (`requestReveal`,
    `onEyeClick`, `onPasswordInput`, `onSave`, `setMode`, `refreshUriNote`), `SchemaDialog`,
    `FiltersDialog`, `ErrorPopover`, `DataGripImportDialog`.
  - shared domain: `capsSchema`/`Caps` (`shared/caps.ts`), `parseConnectionUri`,
    `formatConnectionUri`, `canRoundTripToFields` (`uri.ts`), `treeVisibilitySchema`,
    `datagrip.ts` preview/report schemas, `secretStorageStatusSchema`, `AppMode`.
  - theme and fonts: `EngineIcon`, `icons.ts`, `cellClass.ts`, `theme/completion.ts`,
    `fontStackAvailable`, `resolveFontFallback`, `FONT_CHOICES`.
  - harness: `installControlMocks` (Studio and PW), `WILDCARD_DEFAULTS`, `inferredBootMode`,
    `installMockStream`, `buildPage`, `mockStreamBrowser.js` (`onSend`, `matchKey`, `delayMs`),
    `createUiFixtures`/`test` (`fixtures.ts`), `mergeBootSnapshots`, `measureClickToDom`,
    `measureScrollResponses`, `percentile`, `IPC` (`ipcChannels.ts`), `connect.ts`, `tree.ts`,
    `grid.ts`, `editor.ts`, `editorText.ts`, `clock.ts`, `clipboard.ts`, `*Fixture.ts`.
- **CodeGraph over-links TS names.** `TAB_KINDS`, `useTabsStore`, `useSettingsStore`,
  `createWorkbenchHost`, `WorkbenchShell`, `OperationsPanel`, `StatusBar`, `mockRuntime.ts`,
  `useOpsStore`, `runCommand`, `applyAppearance` exist in both Studio and Kira Space (and the P165
  prototype for `applyAppearance`); `Cancel`/`Caps` collide with every Go adapter. Confirm every
  cross-package claim with `git grep` of real `import` lines; §3 and §4 were verified that way.
  Ignore `apps/kira-studio/frontend/proto/**` hits (pre-plan §6).
- **Unreviewed callees.** Part 9 (`PW`, `PT`, `packages/kira-ui`, `SD/tabs`, `SD/settings`,
  `SD/layout`, `SD/shortcuts`) is **not reviewed yet**, and it holds most of this chunk's
  machinery: `createTabsStore` (debounced `tabsSave`, hydrate, close), `createSettingsStore`,
  `createModeStore`, `createLayoutStore`, `createKeepAwakeStore`, `createAppUpdateStore`,
  `createTerminalsStore`, `createAppMetricsStore`, `createOpLogStore`, `bootstrapShell`,
  `queryClient`, `tabRuntime`, `TabStrip`/`MainView`/`WorkbenchShell` base, theme tokens
  (`PT/base.css`, `workbench.css`), `PW/testing/ui/{fixtures,mockRuntime,server,perfProbe}.ts`.
  Part 5 (`SF/bridge/**`, `ST/ipc/support/types.ts`, `ST/support/encodeFrame.ts`) is closed: a
  contract. Verify the contract this chunk relies on, do not assume it holds. A fix that needs a
  Stream A-owned file is routed (§8), never made.
- **Scratch probes** in the session scratchpad, never in the tree, where a claim turns on runtime
  behavior: a `bun test` harness over Studio `useTabsStore` with a fake `control` (the existing seam
  is `ST/unit/tabs-save-{serialized,retries-after-failure}.spec.ts`), over `useTreeStore` with a
  fake `control` (`ST/unit/tree-state.spec.ts`), or a Playwright run against `ST/ui`'s static server
  and mock runtime. Mark each claim "verified" or "code-read".
- **Checks.** Taken at planning (`844e132`; load average 4.9 falling, no other test process seen):
  - `bun test` over the 9 own unit specs together: **29 pass, 0 fail.** Each spec alone: **9
    green.**
  - `bun run typecheck:web:studio`, `bun run typecheck:tests:studio`,
    `bun run typecheck:unit:studio`: clean. `bunx biome check` over the 153 own lintable files:
    clean.
  - Reviewer records its own baseline first (same commands). Optional, when a claim needs it:
    `bun run build:test:studio`, then `node_modules/.bin/playwright test
    --config=apps/kira-studio/playwright.config.ts --project=ui <spec>` for own UI specs (bare
    `playwright` hits a global binary). WebKit is at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`
    (`webkit-2359`). If deps or bindings are missing: `bun install --frozen-lockfile` and
    `bun run setup`. Never run `test:visual:update:*` here (sandbox font drift,
    `docs/DEV_ENVIRONMENT.md`). **Do not run the full UI suite.** A red check is a finding.
  - **Required: the `ui-timing` investigation (§5.11).** The only multi-run Playwright work in this
    review. Its own rules apply.
- **Known open items read first** (`docs/ARCHITECTURE.md`): tab switch remounts above the 50 ms
  budget in the WebKit sandbox (P139 Part 2); first-launch window-size clamp (P22 D6(a)); documents
  fastest-flick frames (P161). Do not re-report.

## 1. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `844e132`. **Part 13: 155 files (151 at `f40cd35`, 154 at Part
12's plan), 26,939 code lines (26,687; 26,924), tests 14,873 (14,621).**

Own files touched since `f40cd35` (6, +253/-1; none touched by Part 10, 11 or 12's review work
except as listed):
- `56881e6` `SF/state/settingsDomain.ts` (+1/-1): stale max-response default in a comment.
- `61e367f` `ST/ui/mode-switch.spec.ts` (+10): wait for the page-size `tabsSave` before the
  baseline (a debounced-save race in a spec: see §5.2).
- **Four new specs land in Part 13 by script default, not by subject** (the §8 Part 12/10/5 test
  regexes do not match their names):
  - `ST/unit/beautify-depth.spec.ts` (15, `0044c74`, Part 12 F-fix, subject `SF/beautify.ts`).
  - `ST/unit/history-view-supersession.spec.ts` (82, `27bec1c`, Part 10 fix, subject
    `SF/api/state/history.ts`).
  - `ST/unit/frame-golden.spec.ts` (123, `c013e93`, Part 5, subject `SP/frame.ts` vs Go
    `SI/adapterhost`).
  - `ST/unit/ipc-fixture-sync.spec.ts` (22, `e901ab0`, Part 5, subject `SI/ipcfixture`).
  Pre-plan §5.12: a misplaced default costs nothing in a sequential stream. Review them only
  against the test bar (passes alone, still drives current code, not a restated body); their
  subjects were reviewed by Parts 5, 10 and 12. Not a finding.

Drift elsewhere since `f40cd35`:
- Part 2: 145 to 149 files, 19,684 to 20,179. Part 3: 138 to 143, 26,401 to 27,825. Part 4: 72 to
  76, 15,798 to 16,751. Part 5: 110 to 119, 21,623 to 21,695. Part 6: 95 to 96, 14,755 to 15,148.
  Part 7: 90 to 91, 17,074 to 17,173. Part 8: 16,274 to 16,364. Part 9: unchanged (256, 14,723).
- Part 10: 91 to 92 files, 23,319 to 23,917. Part 11: 133 to 135, 30,574 to 30,845. Part 12: 314
  (unchanged), 27,172 to 27,445 (tests 10,375 to 10,424).
- Stream B: Part 14 134 to 135, 16,275; Part 15 98 to 100, 15,661; Part 16 51 to 53, 19,286;
  Part 17 23,653; Part 18 20,429; Part 19 19,889; Part 20 20,312; Part 21 17,327; Parts 22-23
  unchanged.
- Totals: A+C 259,004, B 183,156; 2,904 owned, 0 orphans, 3,547 tracked (docs 490).
- **Script label drift** (carried from Parts 10-12): the script prints `[A]` for every Part `<= 13`.
  Parts 10-13 are Stream C. Label only; not a finding.

**Earlier Stream C fixes changed shared code Part 13 consumes or tests** (read as the current
contract): Part 11 `11ef40e` (double-commit guard; `state/tabs.ts` `onClosed` calls
`usePendingChangesStore().clearPending`), `c68b1b0` (cell editor dock stale-page guard, on the
`budgets.spec.ts` cell -> editor path), `600e87f`/`c7b13a9` (search restart on own page identity);
Part 12 `0044c74` (`MonacoHost.vue` fill flag reset, also on the cell -> editor path), `5d3dcf9`
(page identity watches), `81c8099` (failed reconnect stops the run). User grid CSS commits
`0eeedb6`, `4d65b17`, `b6843c1` (canvas containment and cell borders, net +5 in `slickTheme.css`)
sit on the `perf.spec.ts` scroll path. §5.11 uses this list.

Before landing, re-check `git diff --name-only 844e132 v2.0 -- apps/kira-studio packages/shared/caps.ts packages/shared/domain/{mode,uri,tree-filter,datagrip,secrets}.ts`.

## 2. Own file set (155 files)

11,854 production lines in `SF` and `packages/shared` (79 files), 376 config lines (10 files),
14,907 test lines (66 files). The script's code-only count is 26,939 (tests 14,873).

- **`SF/state` (29, 3,109).** `tabs.ts` (430), `tabKinds.ts` (340), `tabDomain.ts` (312),
  `connections.ts` (265), `schemaColumns.ts` (245), `settingsDomain.ts` (211), `schemas.ts` (204),
  `maskRules.ts` (143), `viewCommands.ts` (132), `objectStore.ts` (132), `datagripImport.ts` (113),
  `dbmcp.ts` (99), `cellSelection.ts` (85), `runState.ts` (71), `tabIncognito.ts` (48),
  `customScripts.ts` (47), `settings.ts` (39), `mode.ts` (29), `fakeData.ts` (27), `cacheStats.ts`
  (23), `consoleDefaults.ts` (21), `ops.ts` (17), `keepAwake.ts` (16), `pinia.ts` (13),
  `terminals.ts` (13), `layout.ts` (12), `terminalTabs.ts` (10), `appMetrics.ts` (6),
  `appUpdate.ts` (6).
- **`SF/project` (13, 4,333).** `ConnectionDialog.vue` (1,305), `state/tree.ts` (705),
  `menus.ts` (446), `DataGripImportDialog.vue` (311), `FiltersDialog.vue` (293),
  `ProjectTree.vue` (248), `TreeRow.vue` (225), `filterTree.ts` (208), `SchemaDialog.vue` (191),
  `menuItems.ts` (149), `grouping.ts` (120), `ErrorPopover.vue` (110), `filter.ts` (22).
- **`SF/workbench` (22, 2,759).** `GenerateDataDialog.vue` (400), `settings/{ApiPane (290),
  DatabaseMcpPane (223), AppearancePane (212), AdvancedPane (126), CachePane (111),
  ClaudeCodePane (59), DataPane (54)}.vue`, `settings/types.ts` (19), `panels/{OperationsPanel
  (213), StudioStart (126), ProjectPanel (85)}.vue`, `DbMcpApprovalDialog.vue` (164),
  `UploadObjectDialog.vue` (160), `SettingsDialog.vue` (134), `TitleBar.vue` (102),
  `WorkbenchShell.vue` (63), `StatusBar.vue` (60), `host.ts` (42), `tabViews.ts` (40),
  `terminalModule.ts` (40), `modes.ts` (36).
- **`SF/theme` (4, 577).** `icons.ts` (232), `EngineIcon.vue` (184), `completion.ts` (94),
  `cellClass.ts` (67). Theme tokens live in Part 9 (`PT/base.css`, `PW/workbench.css`).
- **`SF/shortcuts` (2, 176).** `state.ts` (114), `CommandPalette.vue` (62).
- **Root (3, 571).** `main.ts` (367), `App.vue` (121), `fonts.ts` (83).
- **`packages/shared` (6, 329).** `caps.ts` (136), `domain/{uri (78), datagrip (67), mode (18),
  tree-filter (16), secrets (14)}.ts`.
- **Configs (10, 376).** `frontend/{index.html (15), package.json (17), components.json (26),
  tsconfig.json (40), vite.config.ts (8), wails/runtime.js (48)}`, `playwright.config.ts` (137),
  `playwright.perf.config.ts` (19), `tsconfig.json` (20), `tsconfig.tests.json` (46).
- **`ST/ui/support` (23, 4,705).** `postgresFixture.ts` (895), `cellEditorCaptures.ts` (809),
  `mockRuntime.ts` (405), `mariadbFixture.ts` (356), `measure.ts` (264), `mongoFixture.ts` (238),
  `mockStream.ts` (219), `ipcChannels.ts` (191), `mockStreamBrowser.js` (179), `engineFixture.ts`
  (168), `grid.ts` (168), `tree.ts` (168), `connect.ts` (162), `redisFixture.ts` (94),
  `apiMode.ts` (76), `editorText.ts` (67), `tooltip.ts` (57), `bootSnapshots.ts` (43),
  `editor.ts` (43), `clipboard.ts` (36), `clock.ts` (35), `dialogs.ts` (22), `settings.ts` (10).
  Plus `ST/ui/fixtures.ts` (60), `ST/ui/global.d.ts` (87).
- **`ST/ui` specs (23, 9,018).** `interaction` (1,674), `budgets` (909), `tree` (770),
  `control-sizing` (739), `connections` (454), `tooltips` (440), `mask-preview` (429), `leaks`
  (412), `tabs` (369), `terminal-module` (360), `connection-dialog-tabs` (359), `mode-switch`
  (338), `datagrip-import` (281), `perf` (230), `preconnect` (229), `settings-apply-on-save` (212),
  `operations` (206), `font-roles` (192), `workbench` (135), `update-dialog` (104), `focus-ring`
  (96), `settings-claude-code` (43), `smoke` (37).
- **`ST/unit` (10, 593):** 9 specs (`beautify-depth`, `frame-golden`,
  `history-view-supersession`, `ipc-fixture-sync`, `mongo-srv-uri`, `run-state`,
  `tabs-save-retries-after-failure`, `tabs-save-serialized`, `tree-state`) plus `tsconfig.json`.
- **`ST/visual` (5, 104):** `connection-dialog`, `settings`, `terminal-module`, `workbench`, plus
  `support/pin-fonts.css`. **`ST/perf` (3, 340):** `perfProbe.ts` (172), `blockMeter.ts` (94),
  `tree-scroll.spec.ts` (74).

## 3. One hop: callers (git grep of import lines, production files)

Part 13 is the app root (pre-plan §5.12: no caller above it). Its `state/**`, `theme/**` and
`project/state/tree.ts` are callees of every earlier Stream C view, so a changed export breaks them.
Every count is a real `import` line.

- **Part 10 (`api`, `httprequest`, `grpcrequest`; 26 files):** `state/tabDomain` (20),
  `theme/completion` (5), `state/tabIncognito` (5), `state/settings` (4), `state/runState` (2),
  `state/connections` (2), `state/tabs`, `state/settingsDomain`.
- **Part 11 (`views/{shared,grid}`; 27 files):** `state/connections` (11), `state/tabs` (9),
  `state/cellSelection` (6), `theme/completion` (5), `state/viewCommands` (5),
  `state/tabDomain` (5), `theme/icons` (4), `state/{runState,pinia,maskRules}` (3 each),
  `theme/{cellClass,EngineIcon.vue}`, `state/{settings,fakeData}` (2 each),
  `state/{tabIncognito,objectStore,layout}`, `project/state/tree`.
- **Part 12 (`views/{console,documents,stream,browse,definition,keyvalue}`, `editor`; 25 files):**
  `state/tabs` (16), `state/tabDomain` (9), `state/connections` (9), `state/settings` (6),
  `theme/EngineIcon.vue` (5), `state/{runState,pinia}` (5 each), `theme/icons` (4),
  `state/{viewCommands,cellSelection}` (4 each), `state/objectStore` (2), `theme/cellClass`,
  `state/{schemas,schemaColumns,mode}`, `project/state/tree`. `cellSelection.publishSelectedCell`
  has 5 callers (`SlickGridHost`, `KeyValuePane`, `ConsoleResultGrid`, `ConsoleSlickGrid`,
  `StreamView`); `schemaColumns.ensureSchemaColumns`/`generationFor` 1 (`ConsoleView.vue:161`).
- **Part 9 (Stream A):** `SD/tabs.ts` imports `AppMode` from own `SD/mode.ts`.
- **Part 5 (Stream A, closed):** `SF/bridge/index.ts` imports `SD/{mode,tree-filter,datagrip,
  secrets}` types; `SD/connection.ts` (`capsSchema`) and `SP/page.ts` import `shared/caps.ts`.
- **`shared/caps.ts` UI consumers:** `views/documents/ProjectionMenu.vue`, `views/grid/
  ColumnsMenu.vue`, `views/grid/fakeData/generate.ts` (type only). The live caps value reaches the
  renderer as `connectionsStore.states[id].caps` (`capsSchema` parse in `SD/connection.ts:222`).
  Read sites by field: `caps.{fileTransfer (4), sql (4), canDelete, canInsert, definition (2
  each), describe, keyBrowser, keyTypes, maxPageSize, pagination, transactions}`. **No renderer
  reads `caps.exactCount` or `caps.cancel`** (git grep): count exactness is the per-response
  `CountResponse.exact` (`SP/data-ops.ts:75`, read at `DataToolbar.vue:305`,
  `StreamView.vue:290`).
- **Cross-language mirrors:** `shared/caps.ts` vs Go `SI/adapters/caps.go` (Part 3) and
  `SI/adapters/*/caps.go` (Parts 3-4); `SD/datagrip.ts` vs `SI/datagrip` (Part 2); `SD/secrets.ts`
  vs `SI/secrets` (Part 2); `SD/tree-filter.ts` vs Go filters model (Part 2 storage); tab kinds in
  `tabDomain.ts` vs `SI/storage/model/tabs.go` `RenderableTabKinds` (Part 2; parity guarded by
  `ST/unit/go-ts-vocabulary-parity.spec.ts`, Part 7). A mirror change needs both sides: route the Go
  side.
- **Harness callers (tests in other Parts):** `ST/ui/fixtures.ts` is imported 70 times,
  `support/ipcChannels` 65, `tree` 37, `postgresFixture` 28, `apiMode` 22, `editorText` 18,
  `connect` 16, `grid` 14, `mockRuntime` 9, `editor` 9, `dialogs` 8, `mongoFixture` 7, `tooltip` 5,
  `mariadbFixture`/`clipboard` 4, `settings`/`clock` 3, `redisFixture`/`mockStream`/
  `cellEditorCaptures` 2, `measure`/`bootSnapshots` 1. Outside `ST/ui`: 6 `ST/ipc/*/*.frontend.spec.ts`
  and `ST/ipc/support/types.ts` (Part 5), 10 `ST/perf` files (Parts 10-12), 8 `ST/visual` specs.
  A changed helper signature breaks those; run their typecheck (`typecheck:tests:studio`).
- No dynamic `import()` of own files.

## 4. One hop: callees

Grouped by owner, with the routing that applies to a fix there (§8).

- **Parts 10-12, Stream C, closed:** every view component via `workbench/tabViews.ts`; test hooks in
  `main.ts` (`views/grid/{page,search}`, `views/console/{explainResults,search,resultPages}`,
  `views/documents/{search,page}`, `views/stream/{search,page}`, `views/shared/{document/rows,
  keyvalue/{page,search},slick/scrollTrace}`); `state/tabKinds.ts` page `drop` per kind
  (`grid/page`, `keyvalue/page`, `documents/page`, `stream/page`, `console/resultPages.dropForTab`);
  `state/tabs.ts` `usePendingChangesStore`; `state/schemas.ts` (`console/{ddl,
  sqlKeywordCompletion}`, `editor/completion`, `views/shared/sqlIdent`); `state/schemaColumns.ts`
  (`console/ddl`); `workbench/GenerateDataDialog.vue` (`grid/fakeData/*`, `grid/page`,
  `grid/state`, `MonacoHost`); `panels/OperationsPanel.vue` (`console/state`, `MonacoHost`,
  `SD/sql-split`, `sqlIdent`, `useConnectionGate`); `project/SchemaDialog.vue` (`MonacoHost`);
  `project/state/tree.ts` (`SD/queries`). An edit there needed by a Part 13 finding may be made in
  Stream C (state why in the commit).
- **Part 5, Stream A, closed:** `SF/bridge/control` (25 imports), `SF/bridge/data` (5),
  `SP/page` (3), `SP/data-ops`, `SD/{connection (13), tree (12)}`; harness `ST/ipc/support/types.ts`
  (`LogicalPage`, `PortSnapshot`, `ControlSnapshot`), `ST/support/encodeFrame.ts`.
- **Part 9, Stream A, unreviewed:** `PW/state/{createTabsStore, createSettingsStore,
  createModeStore, createLayoutStore, createKeepAwakeStore, createAppUpdateStore,
  createTerminalsStore, createAppMetricsStore, createOpLogStore, queryClient, tabRuntime,
  contextMenu (6), confirmDialog}`, `PW/bootstrapShell`, `PW/host`, `PW/components/{WorkbenchShell,
  TabStrip, MainView, ConfirmDialog, ContextMenu, UpdateDialog}.vue`, `PW/terminal/module`,
  `PW/shortcuts/{commands,keys}`, `PW/util/{format (4), clipboard (3), useBusyAction}`,
  `PW/settings/fields`, `PW/tabs/types`, `PW/testing/ui/{fixtures,mockRuntime,server,perfProbe}`;
  `PT/components/ui/*` (button 12, label 11, field 8, tooltip 7, dialog 7, checkbox 7, alert 7,
  native-select 5, input 5, badge 3, command), `PT/{CodiconIcon (16), NumberStepperInput (5),
  connColor (3), wrapSelection}`; `SD/{tabs,settings,layout,shortcuts}`.
- Third-party: Vue, Pinia, VueUse, TanStack Query (`VueQueryPlugin`, 4 imports), zod, reka-ui via
  `PT`, `@playwright/test` (harness).

## 5. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Items marked "suspect" were seen during
planning but not verified; confirm or drop each, never report unverified.

### 5.1 Boot, `App.vue` and workbench lifecycle

- `mountShell` (`main.ts:294-358`): `init*Sync` subscriptions run before `windowsEnsure` and the
  `Promise.all`; `bootstrapShell` (Part 9) retries `mountShell` on rejection. Check every step is
  idempotent on retry (`initApiDataSync`, `initCacheStats`, `initAppMetrics`, `initKeepAwake`,
  `hydrate*` that subscribe), that a partial `Promise.all` failure leaves no duplicate listener,
  and that no hydrate depends on another's result inside the same `Promise.all` (e.g.
  `hydrateTabs` vs `hydrateConnections` for `onOpened`'s connected check, `hydrateSettings` vs
  `TAB_KINDS.defaultState`'s `defaultPageSize`).
- `App.vue:62-98`: 17 channel subscriptions in `onMounted`, released in `onUnmounted`. Mode-switch
  side effects (`setMode('api')` then open) when a dialog is already open; `closeActiveTab` on a
  pinned or terminal tab.
- `window.__kira*` hooks (`main.ts:247-292`) gated by `__KIRA_DEBUG_HOOKS__` (`vite.config.ts`
  define; `scripts/verify-packaging.sh` S6/S7). Confirm the define is false in the shipped build and
  that nothing outside the gate references a hook.
- `workbench/host.ts`, `tabViews.ts`, `modes.ts`, `terminalModule.ts`: every `StudioTabKind` has a
  view and a kind entry; a restored tab whose mode panel is absent. `StatusBar.vue` after P164's
  status-bar removals: no dead store reads.
- Dialog mounting (`App.vue:110-119`): `v-if` dialogs remount fresh per open
  (`GenerateDataDialog` D8); `DbMcpApprovalDialog` keyed by `requestId`; two dialogs requested at
  once.

### 5.2 Tabs, tab-kind registry, persistence and debounced `tabsSave`

- Save path (Part 9 contract, Studio policy here): `patchTabState` debounces 1000 ms;
  `closeTab`/`activateTab`/`moveTab`/`duplicateTab` call `saveNow`; `flushPendingTabState` on
  window/app close. `persistable` drops incognito and terminal tabs (`tabs.ts:128`). Check a state
  change made inside the 1000 ms window before close or reload is flushed (Wails before-close and
  the `-tags server` browser tab), and that the serialised queue (`enqueueSave`) never writes an
  older snapshot after a newer one. Existing guards: `tabs-save-serialized`,
  `tabs-save-retries-after-failure`; confirm they drive current code.
- `61e367f` fixed `mode-switch.spec.ts` by waiting for the page-size `tabsSave`: confirm the
  product is right (a mode switch never needs the debounced save) and grep other own UI specs that
  read `tabsSave` args right after a `patchTabState` without waiting (same flake class).
- `hydrateTabs` reset-on-unparseable (`parseStateWith`, P108 Part 12 F14): every per-kind schema
  field added since has a `.default(...)`; a kind dropped from `TAB_KINDS` but still persisted.
- `extend` listeners (`tabs.ts:167-190`): `onConnectionsChanged` closes tabs of a deleted
  connection one `closeTab` (and one `saveNow`) each; `onConnectionState` drops page stores on
  `disconnected`/`error`. **Suspect:** disconnect frees each kind's `dropResources` only; the
  browse split's `${tabId}::preview` key-value page is dropped by a close-time
  `registerTabRuntimeCleanup` hook (`views/shared/keyvalue/page.ts:19`), not on disconnect, so its
  bytes outlive the disconnect. Confirm against D13's "only the page bytes are freed".
- `TAB_KINDS` (`tabKinds.ts:128-…`): `definition`/`browse` use `noDrop`; their runtime records die
  through `cleanupTabRuntime`. Check each view store registers a cleanup (Parts 11-12 stores), and
  `duplicateState` never carries ids or op handles.
- Incognito (`tabIncognito.ts`, `registerIncognitoSetListener`): toggle on/off saves at once;
  duplicate of an incognito tab stays incognito; incognito state survives nothing (by design).
- `useRecentTablesStore` (`tabs.ts:67`): a second concern inside `tabs.ts`? Judge against the
  one-store-one-concern rule (it is its own store in the same file).

### 5.3 Project tree, filters, grouping, DataGrip import

- `useTreeStore` sequencing: `loadChildren` epoch + per-key token (P108 Part 12 F11), `expand`
  connect-then-load with collapse intent, `loadVisibility` single-flight + generation,
  `refreshExpanded` serial by depth, `dropConnectionState` on delete and on `disconnected` only
  (not `error`, documented). Check `refresh` (`:282-287`) has no epoch guard on
  `treeInvalidate`/`dropSchemaColumns` across a disconnect, and `revealPath` on a collapsed or
  unloaded ancestor.
- `filterTree.ts` + `grouping.ts`: hidden kinds vs hidden paths, a group row over filtered
  children, type-ahead and `pendingScrollKey` over virtualised rows (`tree-scroll` perf probe).
- **Suspect (carried from Part 10 F13):** `ProjectTree.vue`/`TreeRow.vue` use a roving `tabindex`
  but handle no ArrowUp/ArrowDown/Home/End (git grep: no `Arrow` in `project/*.vue` or
  `ProjectPanel.vue`). Confirm whether `ProjectPanel`'s type-ahead covers row-to-row movement.
- No drag-and-drop exists in the project tree (git grep). Tab-strip drag reorder is
  `PW/components/TabStrip.vue` `useSortableReorder` (Part 9): read the `moveTab` contract only.
- Context menus (`menus.ts`, `menuItems.ts`): `loadSavedQueries` failure tolerance, Σ "count" item
  opening a tab, delete/duplicate/rename on a connected connection, copy name/URI (clipboard error
  reporting, same class Part 12 F10 fixed in views).
- DataGrip import (`datagripImport.ts`, `DataGripImportDialog.vue`, `SD/datagrip.ts`): selection
  across re-scan, report rows vs preview rows, `secret-storage-unavailable` outcome, double Import.
  Go side (`SI/datagrip`, Part 2) is a contract.

### 5.4 Connection dialog and secrets in the renderer

- Reveal flow (`ConnectionDialog.vue:307-378`): identity re-check after every await, `revealed`
  reset on draft swap (P108 Part 12 F4), confirmation path, typed password never clobbered.
- Secret exposure: the plaintext lives in `draft.password` after reveal. Check it never reaches
  `console.*`, an error string, a `tabsSave` payload, a URI note, the DOM while masked, or a
  Playwright-visible store after the dialog closes (`closeDialog` clears the draft?).
  `uriNote` shows host/port/db only.
- **Suspect:** `uri.ts` `parseConnectionUri` returns `url.pathname.slice(1)` undecoded while
  `formatConnectionUri` sets `url.pathname` (percent-encodes space, `#`, `?`). A database name with
  a space or `#` round-trips as `a%20b`. Also `formatConnectionUri` drops non-string options.
  Verify with a scratch probe and against Go `buildURIFromFields` (read only).
- `canRoundTripToFields` (mongodb+srv, multi-host, unix socket, sqlite four-slash path):
  `mongo-srv-uri.spec.ts` guards part; confirm it still drives current code.
- Field errors to tab mapping (`TAB_FOR_FIELD`), Privacy tab mask rules (`maskRules.ts`), MCP tab,
  Pre-connect script `''`/`null` bridging.

### 5.5 State stores (Pinia one-concern rule) and cross-store sync

- One store, one concern: 29 `state/*` modules; 27 stores across `state`, `project/state` and
  `shortcuts` (24 `defineStore`, plus the Part 9 factories). Candidates to judge, not size alone:
  `connections.ts` holds `useConnectionsStore` and `useConnectionDialogStore` (two stores, one
  file: fine); `schemas.ts` mixes `useSchemaDialogStore` with module-level DDL sync
  (`initSchemaSync`, `ensureDdl`); `maskRules.ts` module-level `correlationKeys` map beside
  TanStack Query data; `viewCommands.ts`, `runState.ts`, `cellSelection.ts`.
- Server state vs TanStack Query: `maskRules.ts` already uses `queryClient`; `customScripts`,
  `dbmcp`, `datagripImport`, `objectStore`, `schemas` (DDL) hand-roll fetch status. Weigh each
  against the TanStack Query rule; a migration too large for this fixer becomes its own `SPEC.md`
  phase.
- **Suspect:** `maskRules.ts` `correlationKeys` (`:68`) is never cleared on connection delete;
  `hexToBytes` (`:84`) silently truncates odd-length hex. Confirm reachability (Go always sends
  even-length hex?).
- `schemaColumns.ts`: generation guard (P108 Part 12 F8), no `[]` memo on failure (F6),
  `dropSchemaColumns` per container vs whole connection, `initSchemaColumnsSync` idempotence.
- `runState.ts` (`useRunStateStore`, `run-state.spec.ts`): overlapping ops per tab (P108 note at
  `:42`), clear on tab close.
- `cellSelection.ts`: `clearSelectedCellFor` on close (`tabs.ts:148`), publish replaces wholesale.
- `objectStore.ts`/`UploadObjectDialog.vue`: upload cancel, dialog closed mid-upload, file dialog
  rejection.
- `dbmcp.ts`: approval snapshot ordering (P108 Part 12 F2 decided: broadcast only).
- `settings.ts`/`settingsDomain.ts`: `appearanceVersion` bump on every apply; `patchSettings`
  applies only the confirmed value (Part 9 contract); defaults vs Go defaults (`56881e6` fixed one
  comment: check the values, not just comments).

### 5.6 Settings dialog, shortcuts, command palette

- `SettingsDialog.vue` and 7 panes: apply-on-save vs live apply (`settings-apply-on-save`),
  numeric inputs (`NumberStepperInput`) with empty/NaN/negative/fraction (Part 10 F-class: a value
  failing the zod schema), deep link `openSettingsAt`, Cancel discards.
- `ApiPane.vue` (290): global HTTP defaults; ranges against `SD/http.ts` (Part 7) schemas.
- `DatabaseMcpPane.vue`/`ClaudeCodePane.vue`: install/uninstall result states, busy guard.
- `shortcuts/state.ts` palette commands: each `run` reachable; view-scoped commands no-op without
  a mounted view; `CommandPalette.vue` on reka `CommandDialog` (P108 Part 12 F15 decided).
- Global shortcuts reach the renderer as menu channels (`App.vue`); local ones via
  `shortcutFor` (`ProjectTree.vue` `TREE_SHORTCUTS`): gated to focus, never firing inside an input.

### 5.7 Theme, icons, fonts

- `theme/icons.ts` (`:52` approximates four engines' rules from the string), `EngineIcon.vue` per
  `ConnectionKind` (all 10), `cellClass.ts` (row colouring), `theme/completion.ts` (completion
  kinds). Exhaustiveness over `ConnectionKind` and node kinds.
- `fonts.ts`: canvas probe (`fontStackAvailable`) with a generic primary (`ui-monospace`), a
  quoted family, an empty stack; memoised canvas context. **Suspect (stale comment):** `:64` says
  "CodeMirror editor"; the editor is Monaco. Low; confirm.
- Hex colours or raw CSS outside Tailwind tokens in own `.vue` files (`DataGripImportDialog.vue:197`
  inline `var(--kira-conn-…)` style); judge against the Tailwind rule.

### 5.8 `shared/caps.ts` capability matrix vs Go adapters (routed Part 4 F20)

- **Routed to Part 13 (must fix).** The doc table (`caps.ts:119-135`) contradicts Go. Planning
  read of `SI/adapters/*/caps.go`: redis `ExactCount: true`, `Definition: false`, `Cancel: true`;
  kafka `ExactCount: false` (Part 4 F13 fix), `Definition: true`; sqs `ExactCount: false`,
  `Definition: true`; s3 `ExactCount: true`, `Definition: false`; mongo `ExactCount: false`,
  tree leaf collection (P19 D5). Also "Only the postgres row is implemented in P1" is stale. The
  routed note says redis `Cancel` is a permanent no-op (C9) while Go caps declare `Cancel: true`:
  read `SI/adapters/redis` `Cancel` and report a caps lie as a Part 3/4 routed item if true.
- **UI consumers:** no renderer reads `caps.exactCount` or `caps.cancel` (§3). Kafka's inexact
  count reaches the UI through `CountResponse.exact`: confirm `StreamView.vue:290` shows `~` for
  kafka now, and that `StreamView.vue:282`'s comment ("kafka.spec.ts's exact-count assertion") is
  not now wrong (Part 12 file: Stream C may edit, state why). Check Part 5's
  `ST/ipc/kafka/kafka.frontend.spec.ts` count assertion against `exact: false` (route if wrong).
- Fix shape: update the table to the Go values, or replace it with a pointer to `caps.go` (Go
  `Caps` is the source of truth, `caps.go:17` says the field order mirrors this file). Also verify
  `capsSchema` and Go `Caps` field sets still match (Part 3 checked JSON names).

### 5.9 Configs and build

- `vite.config.ts` (8 lines) delegates to `PW/viteAppConfig.ts` `defineAppViteConfig` (Part 9;
  `__KIRA_DEBUG_HOOKS__` define lives there), `tsconfig*.json` include/exclude (does
  `typecheck:web:studio` cover `fonts.ts`, `wails/runtime.js`?), `components.json` aliases,
  `index.html` CSP or none, `wails/runtime.js` shim.
- `playwright.config.ts`: `ui-timing` has `dependencies: ['ui']` and `grep` on titles; running it
  alone needs `--no-deps` (Playwright 1.63; P139 used it). `retries: CI ? 1 : 0`. `visual` pins
  fonts. `playwright.perf.config.ts` (19). Judge comments that state a measured fact now wrong.

### 5.10 UI-test harness stability (`ST/ui/support/**`)

- `mockRuntime.ts` `WILDCARD_DEFAULTS` (`:238-…`): `opsCancel` answers `null` and nothing else
  happens; `inferredBootMode` reads only a single-form `tabsList` snapshot; `CANONICAL_OPTIONS`
  drops `refresh:false`. A missing snapshot that silently answers a wildcard can mask a real request
  shape change.
- `mockStream.ts` `buildPage` (`:55-99`): stream bodies `?? ''`, so a ui-tier tombstone (null body)
  cannot be expressed (the `LogicalPage` type is Part 5's). Part 12 F17's hook
  (`[data-testid="stream-body-null"]`) is Part 5's spec, **not this chunk's**: no finding unless a
  Part 13 spec needs it.
- **Routed to Part 13 (Part 11 F17, optional, must decide).** `data-view.spec.ts`'s Stop step
  proves nothing about cancellation: the canned `E_CANCELLED` arrives after a fixed `delayMs`
  (now 5000 ms, `891d314`) whether or not Stop was pressed. Optional stronger fix: a cancel-gated
  reply. The control mock (`page.route`, Node side) answers `opsCancel`; the stream reply is
  scheduled inside the browser script (`mockStreamBrowser.js:156-160`). Report as a finding with a
  concrete design, e.g. a `PortSnapshot.until: 'cancel'` flag in `mockStream.ts`, held replies
  keyed by op id in the browser script, and `mockRuntime.ts`'s `opsCancel` route calling
  `page.evaluate` to release it; plus a `control.log()` assertion that `opsCancel` was called. The
  `PortSnapshot` type is `ST/ipc/support/types.ts` (Part 5: route a field addition, or keep the
  flag in a Studio-local wrapper type). `data-view.spec.ts` is a Part 11 file (Stream C may edit).
  Decide "worth it" or "not worth it" with a reason; do not leave it implicit.
- `measure.ts` (`measureClickToDom`, `measureScrollResponses`, `percentile`): MutationObserver
  resolution, timeout default 5000 ms, `percentile` index `floor(p/100 * n)` (see §5.11).
- `clock.ts`, `clipboard.ts` (permissions in WebKit), `connect.ts` and `tree.ts` waits (fixed
  sleeps vs condition waits), `cellEditorCaptures.ts` (809 lines of captured fixtures: still match
  the current wire shape?), `ipcChannels.ts` vs `SF/bridge` channel names (a stale channel is a
  silent wildcard).
- Perf/visual harness: `ST/perf/{perfProbe,blockMeter}.ts` vs `PW/testing/ui/perfProbe.ts`
  (duplication?), `tree-scroll.spec.ts` asserts nothing (report-only probe, by design).
  `ST/visual/support/pin-fonts.css` (P6).

### 5.11 Required: `ui-timing` flakiness root cause

Intermittent failures were seen in the `ui-timing` project during Part 11/12 fix runs:
`budgets.spec.ts` "cell -> editor" p95 (`:743-784`, bound 50 ms) and `perf.spec.ts` grid scroll
frame p95 (`:119-206`, bound 80 ms). This is a **required check**: a finding with a concrete fix, or
an explicit "noise" conclusion backed by numbers. Not a skip, a wider bound or a retry.

Prior work (read first, do not re-derive): `docs/v2.0/plans/P139-flaky-timing-and-gofmt.md` (§1.1
quiet baseline: cell -> editor p95 23-33 ms; perf p95 41-69 ms quiet, 60-73 ms under load; rule:
a run at load average > 4 is re-run, not counted), `P139-part2-tab-switch-regression-iter2.md`
(cell -> editor p95 29-41 ms, "thin margins stay"), SPEC "P139 Part 1 result".

Planning observations (code-read, unverified):
- **Sample-count statistics.** Both specs' `percentile` take `sorted[floor(p/100 * n)]`. With
  `n = 20` (cell -> editor loop) the p95 index is 19, the **maximum**: one GC pause or one late
  Monaco render frame fails the test. `perf.spec.ts` collects about 22-25 rAF deltas (21 scroll
  steps), so its p95 is the max or the second largest, and the first delta spans the setup before
  the first scroll.
- **Path changes since `f40cd35`** on the measured paths (§1): `c68b1b0` (cell editor dock guard),
  `0044c74` (`MonacoHost` fill flag), `SlickGridHost.vue` (+51/-7 across Part 11 fixes), and the
  user's grid CSS commits (`0eeedb6`, `4d65b17`, `b6843c1`: canvas `contain` and cell borders,
  which change scroll paint cost).
- `measureClickToDom` resolves on the first mutation where `.view-lines` contains the cell text;
  Monaco renders view lines in an animation frame, so each sample carries up to one frame.

Method:
1. Quiet machine first. Before each run record `uptime` and `pgrep -af "playwright|bun test|go
   test"`; no other agent may run tests in this worktree. A run at load average > 4 or with
   another test process alive is re-run, not counted (P139 rule). Note the main checkout and other
   stream worktrees share the CPU.
2. `bun run build:test:studio`, then run the project alone, at least 5 times:
   `node_modules/.bin/playwright test --config=apps/kira-studio/playwright.config.ts
   --project=ui-timing --no-deps` (or `--repeat-each=5`). Record every logged `budgets.spec.ts
   cell -> editor` and `perf.spec.ts scroll frame time` p50/p95, and the raw sorted samples (add a
   scratch-copy log, never edit the spec for this).
3. Compare against base `f40cd35` if feasible: `git worktree add <scratchpad>/base f40cd35`,
   `bun install --frozen-lockfile`, `bun run build:test:studio` there, same runs under the same
   load. If not feasible (deps, disk, time), say why and compare against P139's recorded numbers
   instead. If HEAD is materially worse, bisect over the §1 commits on the measured path.
4. Conclude per spec: a code regression (name the commit and the cost), a measurement defect (for
   example p95 of 20 samples is the max; fix by more samples, a different percentile definition, or
   excluding a warm-up sample, with the PERF.md §2.1 budget unchanged), or noise (numbers: spread,
   margin to bound, load at failure). A fix to `budgets.spec.ts`, `perf.spec.ts` or `measure.ts`
   is own-file. A product fix in a Part 11/12 file may be made in Stream C. A `PW` fix is routed.
5. Never loosen a budget without the P139 standard: measured evidence the budget, not the code, is
   wrong.

### 5.12 Conventions (`CLAUDE.md`)

- 27 own `.vue` files: each has exactly one `<script setup lang="ts">` (grep). One `<style scoped>`
  block: `panels/OperationsPanel.vue` (`:deep()` rules over Monaco's DOM, same named exception as
  Part 12's `MonacoHost.vue`); report only a rule that could be a utility class. Raw
  timers/listeners in own files: judge against VueUse (`useEventListener` is already used in
  `ProjectTree.vue`).
- P105: disabled triggers inside `TooltipTrigger` wrap in `TooltipDisabledTrigger` (TitleBar,
  StudioStart, settings panes, dialogs).
- Native `<button>`/`<select>`/`<input>` where shadcn-vue has a primitive (Part 10 F12 class).
- Comments: report only a comment now wrong (e.g. `fonts.ts:64`, `caps.ts` table header).

### 5.13 Tests against the `CLAUDE.md` bar

- Own unit specs (9): 4 misplaced defaults (§1) reviewed only against the bar. `run-state`,
  `tree-state`, `tabs-save-*` guard ordering and races: they qualify. `mongo-srv-uri` (28 lines):
  judge "still drives current code"; `CLAUDE.md` applies going forward, no retroactive prune.
- UI specs (23) against §5: `tabs`, `mode-switch`, `workbench` (§5.1-§5.2); `tree`,
  `datagrip-import` (§5.3); `connections`, `connection-dialog-tabs`, `preconnect` (§5.4);
  `settings-*`, `font-roles`, `control-sizing`, `focus-ring`, `tooltips` (§5.6-§5.7, §5.12);
  `mask-preview`, `operations`, `terminal-module`, `update-dialog`, `leaks`, `interaction`,
  `smoke`; `budgets`, `perf` (§5.11). Look for fixed sleeps, races on debounced saves (§5.2), and
  duplicate coverage (prune only when truly duplicate). `waitForTimeout` sites at planning: 27 own
  (`tree.spec.ts` 12, `tooltips` 5, `support/tree.ts` 4, `interaction` 2, `budgets`, `leaks`,
  `perf`, `tabs` 1 each); each either proves an absence (a debounce that must not fire) or is a
  flake source.
- Gaps worth a guard only where a fix needs one: `uri.ts` round trip if §5.4's suspect holds
  (format round trip with an edge case qualifies), the cancel-gated mock (§5.10).

## 6. What earlier reviews and P143-P167 changed (do not re-report)

- **P166/P167** (base `743af03`): `git diff 743af03 HEAD` on own paths touches the four misplaced
  specs, `settingsDomain.ts` comment, `mode-switch.spec.ts` and `tooltips.spec.ts` (rewritten in
  `71d7c6a`, reverted net by `b088feb`). P166's "not reached" list did not name the Studio shell.
- **Part 10-12 fixes** (Stream C) are the current contract (§1); verify Part 13 callers and
  harness against them, do not re-report them. Part 12 F17's tombstone test hook is Part 5's spec.
- **Decided trade-offs:** tab switch remount budget (P139 Part 2 known open item, sandbox bound
  p95 <= 250 ms); `ui-timing` serial project after `ui` (P27); tree drops state on `disconnected`
  only, not `error` (P5 D6/F9); a connection's tabs drop page bytes but keep runtime on disconnect
  (P43 D13); edit dialog opens with `password: null`, reveal gated by local auth (P14 D1);
  `CommandDialog` palette (P108 Part 12 F15); DB MCP approvals applied from broadcast only (P108
  Part 12 F2); hydrate resets an unparseable tab to defaults (P108 Part 12 F14).
- **Parked design decisions (do not re-report):** Part 4 F8 (console results fully materialised in
  Go), Part 4 F15 (SQS browse consumes messages on a read-only connection), Part 5 F4 binary-body
  half (encoding flag vs marker), Part 6 F8 and the exact-cookie delete (Part 10 F18's Go half,
  Part 6), Part 11 F7 (grid staged changes dropped on reload).
- **P108** (v1.9 numbering; this chunk's files were its Part 12) fixes are in code, cited as
  `P108 Part 12 F<n>` (F2 dbmcp ordering, F3 sync before panel mount, F4 reveal reset, F6/F8
  schema columns, F7 op log hydrate, F11 tree tokens, F13 boot retry, F14 hydrate reset, F15
  palette, F18 mask sync). Also P5/P14/P19/P22/P25/P28/P43/P71/P103/P104/P105/P112/P113/P128 round
  fixes cited in comments. Verify they hold; never report them as new.

## 7. Watch items

- Pre-plan §5.12: `state/**` re-reviewed with every caller settled (Parts 10-12 fixers could edit
  it; only `settingsDomain.ts` comment changed); status-bar removals (P164); misplaced spec defaults.
- Task list: App.vue/workbench lifecycle (§5.1), tabs and registry persistence plus debounced
  `tabsSave` (§5.2), project tree, drag-drop (none in tree) and DataGrip import (§5.3), secrets in
  the renderer (§5.4), state stores and one-concern rule (§5.5), settings and shortcuts (§5.6),
  theme tokens and fonts (§5.7), `caps.ts` vs Go (§5.8, routed), configs (§5.9), harness mocks and
  perf/visual harness (§5.10, routed Part 11 F17), `ui-timing` root cause (§5.11, required), tests
  (§5.13).

## 8. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, in this block order** (stores first, so the shell and tree read against known
  layers):
  1. State stores and shared domain: `SF/state/**` (29), `shared/caps.ts` (routed F20 first),
     `SD/{mode,uri,tree-filter,datagrip,secrets}.ts`. Contract read: `PW/state/create*Store.ts`,
     `PW/state/tabRuntime.ts`, Go `SI/adapters/*/caps.go`.
  2. Shell, workbench, settings, shortcuts, theme: `main.ts`, `App.vue`, `fonts.ts`,
     `SF/workbench/**` (22), `SF/shortcuts/**`, `SF/theme/**`. Contract read: `PW/bootstrapShell`,
     `PW/host`, `PW/components/{WorkbenchShell,TabStrip,MainView}.vue`.
  3. Project tree and connection management: `SF/project/**` (13).
  4. Configs and UI-test harness: the 10 config files, `ST/ui/{fixtures.ts,global.d.ts}`,
     `ST/ui/support/**` (23), `ST/perf/{perfProbe,blockMeter}.ts`, `ST/visual/support/pin-fonts.css`;
     routed Part 11 F17 decision. Contract read: `PW/testing/ui/*`, `ST/ipc/support/types.ts`.
  5. `ui-timing` investigation (§5.11): runs, base comparison, conclusion per spec.
  6. Tests: 9 unit, 23 UI, 4 visual, 1 perf spec (coverage claims, test bar).
- **Resumable:** write `docs/v2.0/plans/P168-part13-findings.md` as blocks finish and commit it
  after **each** block (`docs(v2.0): P168 Part 13 findings, block <n>`), normal commit, explicit
  `git add <path>`, hooks green. Block 5 commits its raw numbers (every run: load, p50/p95, pass or
  fail) in the findings file before concluding, so an interrupted run never repeats a measurement.
  An interrupted run resumes from the last committed block, never re-derives one.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a concrete
  failure scenario, a proposed fix, "verified" or "code-read". Mark one that needs a real design
  decision (`DESIGN-DECISION`); the fixer turns it into its own `SPEC.md` phase.
- **Routed items are findings** (carry each as `F<n>`, with source): Part 4 F20 (`caps.ts`, must
  fix), Part 11 F17 (cancel-gated mock: a fix, or an explicit decline with reason), and the
  `ui-timing` conclusion (a fix, or "noise" with numbers).
- **Routing tag.** A finding whose fix must edit a file owned by another Part carries
  `needs-other-part-file: <path> (Part N)`. Owners: Stream A Parts 2-9 (here mostly Part 9 `PW`,
  `PT`, `kira-ui`, `SD/{tabs,settings,layout,shortcuts}`; Part 5 `SF/bridge/**`, `SP/**`,
  `ST/ipc/**`, `ST/support/**`; Parts 3-4 `SI/adapters/**`; Part 2 `SI/{datagrip,secrets,storage}`);
  Stream B Parts 14-23; Stream C Parts 10-12 (closed). The fixer does not make Stream A or B
  edits: it appends each to `docs/v2.0/plans/P168-routed-from-streamC.md` (exists; one
  `## From Part 13 F<n>` section per finding: id, file, issue, fix). A Part 10-12 file edit needed
  by a Part 13 finding may be made in Stream C, stated in the commit. A finding fixable in own files
  with only a read of another Part's contract carries no tag.
- The findings file states base commit (`844e132`), HEAD reviewed, checks run and results, findings,
  then coverage per block: reviewed, skimmed (with reason), not reached. No unexplained gap. A chunk
  with nothing real says so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 13 findings` before any fixer starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 13`, only in
  own files (plus Part 10-12 files where stated); tagged findings routed as above. Re-runs the own
  unit specs (together and each alone), `typecheck:web:studio`, `typecheck:tests:studio`,
  `typecheck:unit:studio`, lint, the own UI specs touched (targeted, never the full suite), and the
  `ui-timing` project alone (`--no-deps`, quiet machine, 3 runs) if block 5 changed anything on its
  path. Deletes the findings file when done. Chunk lands per pre-plan §3.4; Stream C ends here.

## 9. Out of scope

- Part 9 internals (`PW`, `PT`, `kira-ui`) beyond the contract this chunk uses: report a defect
  there with the routing tag. Part 9 is reviewed later by Stream A.
- Parts 10-12 views (closed; contract only, except an edit a Part 13 finding needs); Part 5 bridge
  and wire; Go adapters and storage (`SI/**`): read only to judge mirrors.
- P165 prototype (`apps/kira-studio/frontend/proto/**`, `tests/proto/**`,
  `playwright.proto.config.ts`, `vite.proto.config.ts`, `tsconfig.proto.json`): excluded.
- Decided trade-offs, parked decisions and known open items (§0, §6).
- Generated bindings and wire code, docs, excluded files (pre-plan §6).
