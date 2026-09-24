# P108 Part 12 — review plan: Studio shell, project tree, state stores and UI-test harness

Chunk A11, stream A position 11, the last P108 chunk (pre-plan §5.11). One Opus reviewer runs this
plan and reports findings. It fixes nothing. One Sonnet fixer then lands one commit per finding.
Tree surveyed: `a8d1998` (Parts 2-11 and 13-20 closed; P112 still in flight in the same checkout).

Paths repo-relative. `SF` = `apps/kira-studio/frontend/src`, `SI` = `apps/kira-studio/internal`,
`SD` = `packages/shared/domain`, `ST` = `apps/kira-studio/tests`, `PW` = `packages/workbench/src`
(alias `@workbench`), `PT` = `packages/theme/src` (alias `@theme`). `VS` = `SF/views/shared`
(Part 10), `VC` = `SF/views/console` (Part 11).

## 0. Method

- **`codegraph_explore`** for discovery, before any Read. Targets:
  - tabs: `createTabsStore` (`openTab`, `duplicateTab`, `closeTabInternal`, `closeOthers`,
    `closeToTheRight`, `closeAll`, `persistableTabs`, `saveIfChanged`, `flushPendingTabState`,
    `hydrateTabs`, `patchTabState`), Studio `useTabsStore` host (`persistable`, `onOpened`,
    `onClosed`, `onDuplicated`, `extend`), `useTabIncognitoStore`, `TAB_KINDS`
    (`duplicateState`, `incognitoMenuExtras`), `markHydrated`/`isHydrated`, `useConnectionGate`;
  - boot: `bootstrap` (`main.ts`), `App.vue` channel subscriptions, `useModeStore`
    (`hydrateMode`, `setMode`, `activeTab`), `MODES`, `useLayoutStore`;
  - tree: `useTreeStore` (`expand`, `collapse`, `loadChildren`, `loadVisibility`,
    `saveVisibility`, `refresh`, `refreshConnection`, `refreshExpanded`, `initTreeSync`,
    `revealPath`, `loadSavedQueries`), `filterTree.ts`, `grouping.ts`, `menus.ts` (`menuForRow`);
  - state neighbors: `useSchemaColumnsStore` (`ensureSchemaColumns`, `dropSchemaColumns`,
    `initSchemaColumnsSync`), `schemas.ts` (`schemaQueryOptions`, `ensureDdl`, `saveDdl`,
    `initSchemaSync`), `useOpsStore` (`hydrateOps`), `useRunStateStore`, `maskRules.ts`,
    `viewCommands.ts` (`reloadTabsForTarget`, `registerPendingGuard`, `registerStaleMarker`),
    `useConnectionsStore` (`hydrateConnections`, `connectConnection`), `useDbMcpStore`;
  - UI: `OperationsPanel.vue` (`onRerun`), `DbMcpApprovalDialog.vue`, `ConnectionDialog.vue`,
    `SettingsDialog.vue` plus panes, `CommandPalette.vue`, `TerminalPanel.vue`.
  Check any proposed fix's blast radius the same way. `SF/state/**` has callers in every closed
  view chunk (Parts 9-11).
- **Read closed chunks first.** Part 9 (`SF/api`) closed F1-F18 (F12 moved to P112). Part 10
  (`VS`, `SF/views/grid`) closed F1-F21. Part 11 (`VC`, editor, per-kind views) closed F1-F17.
  Part 13 (`PW`, `PT`, `packages/kira-ui`) closed; stream B done at `f455c75`. Treat every fix
  as correct. Do not re-flag them. Per pre-plan §3.3 a fixer may now edit B1 files directly.
- **P112 is live in this checkout.** It migrates `SF/api/**` server state onto TanStack Query and
  already touched two own files: `main.ts` (`initApiDataSync()` at `:294`) and
  `ST/ui/support/ipcChannels.ts` (`apiDataChanged`). It may touch `ST/ui/support/mockRuntime.ts`
  next. Review P112's own lines here only for boot-order integration. Do not report findings
  against `SF/api/**` or `ST/ui/api-*`/`ST/unit/api-*`: P112 owns them now. The fixer commits
  with an explicit `-- <pathspec>`, never `git add -A` (Part 11 result's race note).
- **Premise corrections, stated up front.**
  - Pre-plan §5.11 expected "earlier view fixers may edit `state/**`" heavily. Measured
    (`git log d45eb28..HEAD`): only two `state/` files moved. `cellSelection.ts` +9
    (Part 10 F3, `generated`/`pendingDelete` fields) and `viewCommands.ts` +22 (Part 10 F1,
    `pendingGuards`/`staleMarkers`). Other own files touched: `OperationsPanel.vue` +47/-5
    (Part 11 F5), `settings/DatabaseMcpPane.vue` (Part 7 F9), `main.ts` +4 and
    `ipcChannels.ts` +3 (P112). The re-review is still owed (§5), but it is small.
  - Pre-plan churn "`SF/theme` 1,171" is not current size. `SF/theme` is 577 lines in 4 files
    today (P103 hoisted the rest to `PT`). The figure was add+delete churn. Not re-derived.
  - Pre-plan's "every remaining spec" list names `tabs-*` and `tree-*`. Real owned unit specs are
    exactly five: `ops-markraw`, `run-state`, `mongo-srv-uri`, `tabs-save-retries-after-failure`,
    `tree-state`. Every other unlisted unit spec was added by an earlier fixer and follows its
    source: `timestamp-epoch-fraction`, `page-navigation-in-flight-guard`,
    `grid-{clipboard-formats-safety,commit-pkless-guard,paste-row-cell-kind-target,
    row-menu-lazy-snapshot,rows-for-selection,staged-value-snapshot}` (Part 10);
    `console-*`, `document-projection-menu-close`, `hover-markdown-escape` (Part 11);
    `http-cookies-store-race`, `http-send-tab-close-leak` (Part 9); `e2e-real-build-lock`,
    `bridge-*` (Part 6); `api-*` (P112 now).
  - `tests/ui/api-cross-window-sync.spec.ts` is P112's, not this chunk's.
- **Scratch replicas** in the session scratchpad, never in the tree, where a claim depends on
  runtime behavior:
  - a `bun test` harness over `useTabsStore` with a fake `control` whose `tabsSave` resolves on
    demand (incognito toggle while an older save is in flight; close paths; duplicate);
  - a `bun test` harness over `useOpsStore.hydrateOps` with `opsRecent` held open while an
    `onOpUpdate` end event fires (§4.6);
  - a `bun test` harness over `useSchemaColumnsStore` with `treeSchemaColumns` resolving after
    `dropSchemaColumns` (§4.5);
  - a Playwright run against `ST/ui`'s static server for UI paths (project panel hidden at boot,
    DB MCP approval queueing, palette a11y, connection dialog Test-then-close).
  Mark each claim "verified" or "code-read".
- **Known open items read first** (`docs/ARCHITECTURE.md` "Known open items"). The first-launch
  window-size clamp (P22 D6(a)) and the splitter's compound-statement limit (Part 11 F4) are
  documented. Do not re-report either.

## 1. Own file set

About 15.2k production lines, 13.9k test lines (≈29k, matching pre-plan). 5 unit, 23 UI and 5
visual specs, plus the UI harness.

- **Root (549)**: `SF/main.ts` (351), `SF/App.vue` (115), `SF/fonts.ts` (83).
- **`SF/workbench` (4,529)**:
  - dialogs: `GenerateDataDialog.vue` (597), `SettingsDialog.vue` (332), `DbMcpApprovalDialog.vue`
    (203), `UploadObjectDialog.vue` (161);
  - settings panes: `ApiPane` (452), `ScriptsPane` (320), `AppearancePane` (234),
    `DatabaseMcpPane` (217), `AdvancedPane` (212), `CachePane` (155), `ClaudeCodePane` (94),
    `DataPane` (60), `types.ts` (32);
  - shell: `TitleBar.vue` (200), `StatusBar.vue` (202), `WorkbenchShell.vue` (114), `host.ts`
    (54), `tabViews.ts` (41), `modes.ts` (36), `state/engine.ts` (30);
  - panels: `OperationsPanel.vue` (498), `StudioStart.vue` (183), `ProjectPanel.vue` (102).
- **`SF/project` (5,011)**: `ConnectionDialog.vue` (1672, largest own file), `state/tree.ts`
  (639), `menus.ts` (486), `FiltersDialog.vue` (400), `DataGripImportDialog.vue` (385),
  `TreeRow.vue` (288), `ProjectTree.vue` (269), `SchemaDialog.vue` (227), `filterTree.ts` (208),
  `menuItems.ts` (148), `ErrorPopover.vue` (147), `grouping.ts` (120), `filter.ts` (22).
- **`SF/state` (3,414, 31 files)**: `tabs.ts` (430), `tabKinds.ts` (373), `tabDomain.ts` (309),
  `connections.ts` (265), `settingsDomain.ts` (236), `schemaColumns.ts` (219), `schemas.ts`
  (184), `viewCommands.ts` (132), `objectStore.ts` (132), `datagripImport.ts` (113),
  `maskRules.ts` (110), `agentSessions.ts` (110), `dbmcp.ts` (93), `cellSelection.ts` (85),
  `ops.ts` (72), `runState.ts` (71), `mode.ts` (67), `keepAwake.ts` (50), `tabIncognito.ts` (48),
  `customScripts.ts` (47), `settings.ts` (44), `appUpdate.ts`, `agentHooks.ts`, `fakeData.ts`,
  `cacheStats.ts`, `appMetrics.ts`, `consoleDefaults.ts`, `layout.ts`, `terminals.ts`,
  `pinia.ts`, `terminalTabs.ts`.
- **`SF/theme` (577)**: `icons.ts` (232), `EngineIcon.vue` (184), `completion.ts` (94),
  `cellClass.ts` (67).
- **`SF/shortcuts` (196)**: `state.ts` (118), `CommandPalette.vue` (78).
- **`SF/terminal` (403)** + **`SF/views/terminal` (92)**: `TerminalPanel.vue` (338),
  `TerminalStart.vue` (65), `TerminalView.vue` (92).
- **Config (197)**: `Studio/frontend/vite.config.ts` (70), `Studio/playwright.config.ts` (127).
- **`SD` (219)**: `uri` (78), `datagrip` (67), `scripts` (26), `mode` (18), `tree-filter` (16),
  `secrets` (14).
- **`ST/ui` harness (4,919)**: `support/{postgresFixture 895, cellEditorCaptures 809,
  mockRuntime 457, mariadbFixture 356, measure 263, mongoFixture 238, ipcChannels 223,
  mockStream 219, mockStreamBrowser.js 179, grid 168, engineFixture 168, tree 164, connect 162,
  redisFixture 94, apiMode 76, editorText 67, tooltip 57, bootSnapshots 47, editor 43, clock 35,
  dialogs 22, clipboard 20, settings 10}`, `fixtures.ts` (60), `global.d.ts` (87).
- **`ST/ui` specs (23, 8,672 lines incl. unit)**: `interaction` (1672), `budgets` (857),
  `tree` (754), `connections` (450), `tooltips` (434), `mask-preview` (429), `leaks` (412),
  `connection-dialog-tabs` (347), `mode-switch` (328), `tabs` (295), `datagrip-import` (281),
  `perf` (230), `preconnect` (229), `settings-apply-on-save` (205), `font-roles` (198),
  `control-sizing` (194), `terminal-module` (157), `workbench` (136), `operations` (126),
  `settings-scripts` (110), `settings-claude-code` (108), `smoke` (42), `update-banner` (39).
- **`ST/unit` (5)**: `ops-markraw` (91), `tree-state` (88), `run-state` (82),
  `tabs-save-retries-after-failure` (53), `mongo-srv-uri` (28).
- **`ST/visual` (297 + 5 PNG baselines)**: `connection-dialog`, `console`, `data-view`,
  `schema-dialog`, `workbench`, `support/pin-fonts.css`, `README.md`.

## 2. One hop: callers

This is the app root, so no Studio code calls the shell. The callers that matter are the callers
of `SF/state/**`, `SF/theme/**` and `SF/project/state/tree.ts`:

- **Every Studio view (Parts 9-11, closed)** reads `useTabsStore`, `useConnectionsStore`,
  `useSettingsStore`, `useRunState`, `useCellSelectionStore`, `viewCommands`. `ensureRuntime` and
  `registerTabRuntimeCleanup` (`PW/state/tabRuntime`) fan out to 30+ view sites.
- **`VS/useConnectionGate.ts`** (Part 10): reads `isHydrated`, calls `markHydrated`,
  `connectConnection`. Also now called from `OperationsPanel.onRerun` (Part 11 F5).
- **`VC/ConsoleView.vue`** (Part 11): `schemaQueryOptions`, `useSchemaColumnsStore`
  (`ensureSchemaColumns`, `effectiveSchema`, `cachedRelationsFor`), `SF/theme/completion.ts`.
- **`VS/grid/SlickGridHost.vue`, `DataToolbar.vue`** (Part 10): `maskRulesQueryKey` queries.
- **`SF/api/**`** (Part 9, now P112): `tabKinds.ts` API kinds, `tabIncognito`, `openTab`/
  `patchTabState` through `SF/api/tabs.ts`.
- **`PW/components/{TabStrip,MainView,WorkbenchShell}.vue`** (B1, closed) through `host.ts`'s
  `WorkbenchHost`: `duplicateTab`, `closeTab`, `closeOthers`, `closeToTheRight`, `closeAll`.
- **Go push channels** (`SI/bridge`, Part 7 closed): `onConnectionsChanged`,
  `onConnectionState`, `onConnectionMetadataInvalidated`, `onSchemaChanged`, `onOpUpdate`,
  DB MCP approval events, menu-bar `CHANNEL` commands (`App.vue:58-88`).

## 3. One hop: callees

- **Settled (closed parts):**
  - `SF/bridge/{control,data,port}.ts` (Part 6).
  - `PW` (B1): `createTabsStore`, `createTerminalsStore`, `tabRuntime`, `contextMenu`,
    `confirmDialog`, `queryClient`, `shortcuts/{commands,keys}`, `util/treeVirtualRows`,
    `components/{WorkbenchShell,TabStrip,MainView,ConfirmDialog,ContextMenu}.vue`,
    `testing/ui/fixtures`, `testing/unit/restoreAfterEach.ts`.
  - `PT` (B1): shadcn-vue components incl. `TooltipDisabledTrigger`, `Command`, `CodiconIcon`,
    `connColor`, `wrapSelection`.
  - `VS`, `VC`, `SF/views/*`, `SF/api` (Parts 9-11) through `tabViews.ts` and `modes.ts`.
  - Go services behind each control call (Parts 3, 7): `connections.Service`, `preconnect`,
    `dbmcp` approval flow (verdict, explain, one approval, execute), `agenthooks`, `mcpinstall`,
    `appsettings`, `customscripts`, DataGrip scan.
- Third-party: Pinia, `@tanstack/vue-query`, VueUse (`useDebounceFn`, `useEventListener`,
  `onClickOutside`, `useElementSize`), reka-ui (Splitter, Listbox via `Command`), xterm.js.

## 4. Edge cases to weight

This chunk owns what outlives a single view: what gets persisted, what boots, what subscribes to
Go pushes, and the one dialog that authorizes an AI agent's SQL. Weight persistence leaks and
silent missed invalidation above cosmetics.

1. **Tab persistence and `TabsHost` hooks (P103 Part 2).**
   - Incognito must never persist. Wiring verified (code-read): `persistable` at `tabs.ts:128`
     keeps the factory's terminal exclusion; `duplicateTab` calls `onDuplicated` before
     `saveNow` (`createTabsStore.ts:378-382`), and `setIncognito`'s listener saves at once.
     Now check the in-flight race: an earlier debounced `saveIfChanged` whose snapshot still held
     the tab resolves after the incognito save. Does Go serialize `TabsService.Save` in arrival
     order, and can the older write land last and re-persist the row? Same question for
     `flushPendingTabState` racing an in-flight save on window close.
   - `saveIfChanged` swallows rejection (`() => {}`). `pendingSnapshot` blocks a second identical
     save while one is in flight. `tabs-save-retries-after-failure` pins the retry path. Confirm
     a failed save followed by no further change is retried at flush, not lost.
   - Every close path fires `onClosed` and `dropAllPagesForTab` (hence `tabRuntime` cleanup:
     incognito ids, hydrated ids, cell selection, pending changes): `closeTab`, `closeOthers`,
     `closeToTheRight`, `closeAll`, the connection-deleted close (`tabs.ts:167-173`) and
     `App.vue`'s `onTabClose`. A path that skips it leaks per-tab state and a stale incognito id.
   - `hydrateTabs` keeps the raw record when `parseState` fails (`parsed ? … : t`,
     `createTabsStore.ts:233-236`). Check what a view does with an unparsed state, and whether a
     schema-invalid stored row can crash `MainView`.
   - `onOpened(record, false)` marks a duplicate hydrated unconditionally. Duplicate a restored,
     never-loaded tab on a disconnected connection: check the copy auto-loads, or the gate holds.
   - `onConnectionState` (disconnect or error) drops page stores for every tab of the connection.
     Check a console tab mid-run is not left `running`.
   - Standing rule in `tabIncognito.ts:16-17`: every bridge write reachable from a request tab
     consults `isIncognito`. Sweep writers with `codegraph_explore` (history, cookies, variables
     history, response history, gRPC call history). Report a writer that skips it. `SF/api` is
     P112's; report there only if P112 did not add the write.
2. **Boot sequence (`main.ts`, `App.vue`, `mode.ts`).**
   - `bootstrap` awaits one `Promise.all` of 14 hydrates before `createApp`. One rejection (DB
     MCP, agent hooks, ops, mask counts) leaves a blank window with an unhandled rejection
     (`void bootstrap()`). Decide which hydrates are optional and must degrade.
   - `hydrateMode(await control.windowsEnsure())` trusts the stored mode. A pre-P100 window row
     holding `'git'` (or pre-P12 `'http'`) makes `MODES[modeStore.active].panel` throw in
     `WorkbenchShell.vue:29`. Check whether Go normalizes the value.
   - `setMode` debounces the window-mode write 150 ms. `flushBeforeClose` does not flush it.
     Check a mode switch just before quit.
   - `__KIRA_DEBUG_HOOKS__` (`vite.config.ts`): confirm `build:test` sets `KIRA_DEBUG_HOOKS=1` and
     the packaged build does not (`scripts/verify-packaging.sh` S6/S7).
3. **Push subscriptions tied to a panel's mount (strong candidate).**
   `initTreeSync`, `initSchemaSync` and `initSchemaColumnsSync` run only in `ProjectTree.vue`'s
   `onMounted` (`:57-61`). The project panel is `v-if="projectVisible"`
   (`PW/components/WorkbenchShell.vue:137,152`) and per-mode (`MODES[mode].panel`). Boot in
   Studio mode with the project panel hidden, or in API/Terminal mode, then work in a restored
   console tab: `onSchemaChanged`, `onConnectionMetadataInvalidated` and deleted-connection
   cleanup never arrive. Console completion, lint and hover serve stale schema; deleted
   connections' tree and DDL caches leak. Same shape as Part 9 F5; P112's `initApiDataSync()` in
   `bootstrap` is the fix precedent. Verify in a replica.
4. **Project tree (`project/state/tree.ts`, `filterTree.ts`, `grouping.ts`, `menus.ts`).**
   - `loadChildren` has no sequencing. `expand`, `refresh` and `refreshExpanded` can overlap on
     one key; the last response wins, not the newest request. Check a Refresh racing a
     reconnect's `refreshExpanded`.
   - `expand` releases `loading` after connect and before `loadVisibility`/`loadChildren`. A
     collapse during the connect await is undone by `expanded.add(k)` after it.
   - `loadChildren` resolving after the connection was removed writes `children[k]` back. Check
     `initTreeSync`'s delete cleanup runs first or the entry leaks.
   - `loadVisibility` has no in-flight dedupe and can overwrite a newer `saveVisibility` result.
   - `onContextMenu` awaits `loadSavedQueries` before opening. A rejected `queriesList` means no
     menu at all and an unhandled rejection.
   - Search and filter: `filterTree.ts` + `SD/tree-filter.ts` + `FiltersDialog.vue`. Check empty
     filter, a filter hiding the selected row, keyboard focus after filtering, and group rows
     (`grouping.ts`) whose synthetic path could collide with a real node name.
   - Destructive tree actions (`menus.ts`: delete connection, drop, truncate): confirm dialog
     text renders as text, read-only connections gate every write item, and `tree.delete`
     keyboard shortcut goes through the same confirm.
5. **Schema caches (`state/schemaColumns.ts`, `state/schemas.ts`, `state/maskRules.ts`).**
   - `ensureSchemaColumns`: an in-flight fetch that resolves after `dropSchemaColumns` (tree
     Refresh or metadata invalidation) writes the old columns back. No generation guard. Verify.
   - A failed fetch memoizes `[]` until the next explicit drop. A transient error (fetch during
     reconnect) disables completion for that container for the session. Decide finding or
     intended ("nicety" comment at `:138-146`).
   - `rootContainerPathFor` picks the database by `detail === 'connected'`, then name, then the
     only one. Check Postgres with several schemas and MySQL with no default database.
   - `schemas.ts` `queryFn` returns the cached value over the fetched one (P12 #14, by design).
     Confirm `applyRemote` invalidation still refetches when no local write happened.
   - `maskRules.ts` writes with `setQueryData`, `staleTime: Infinity`. Part 10 verified the
     view side. Check the cross-window case: does Go broadcast a mask-rule change, or does a
     second window keep masking with the old rule set? A stale mask rule is a data-exposure
     issue, not cosmetic.
6. **Ops and run state (`state/ops.ts`, `state/runState.ts`, `OperationsPanel.vue`).**
   - `hydrateOps` awaits `opsRecent` and only then subscribes to `onOpUpdate`. An op that ends in
     that window stays `running` forever in the ring. `runState`'s 200 ms ticker then never stops
     and the toolbar ring spins. Strong candidate; verify in a replica.
   - `MAX_RECORDS = 500` truncation can drop a running record; its end event then unshifts a
     duplicate-looking row. Check `runStateFor` still answers right.
   - `onRerun` (Part 11 F5 edit): `useConnectionGate` is called outside setup. It only builds
     `computed`s (no lifecycle hooks), so it works, but each re-run leaks two effects outside any
     scope. `onReconnectAndLoad` marks hydrated even when `connectConnection` failed, and the run
     fires anyway. `void onRerun(record)` leaves a rejected `run` unhandled. Check each.
   - Ops filter text and status filter over 500 raw (`markRaw`) records: confirm reactivity still
     updates `visibleOps` when a record is replaced in place (`state.records[idx] = raw`).
7. **Connection dialog, URI and secrets (`ConnectionDialog.vue`, `SD/uri.ts`, `SD/secrets.ts`).**
   - URI parse and build: passwords with `@ : / ? # %`, IPv6 `[::1]:5432`, `mongodb+srv` (no
     port, one host), multi-host Mongo, query options, percent-encoding round trip.
     `mongo-srv-uri` covers only SRV. A parse that drops or mis-decodes a password connects with
     the wrong credential silently.
   - Test connection in flight, then Save, Cancel or close: a late result must not write into a
     closed or reopened dialog, or into a different connection's form. Test after a field edit
     must not show the previous result as current.
   - Reveal (Part 9 handoff): the dialog's own reveal path and the connection half of
     `ST/ui/credential-reveal.spec.ts`/`secrets.spec.ts`. A revealed password must not survive
     closing the dialog, must not reach the clipboard or logs without an explicit action.
   - Editing a connection deleted from another window (`onConnectionsChanged`): Save must fail
     clearly, not recreate it.
   - Preconnect script fields (Go side closed, Part 3): confirm the dialog never interpolates
     connection fields into the script text.
8. **DB MCP approval (`DbMcpApprovalDialog.vue`, `state/dbmcp.ts`).** Security-critical: this
   dialog authorizes an AI agent's statement against a real database.
   - Several pending approvals: which one shows, and each answer carries its own request id.
     Answering one must never answer another.
   - Escape, backdrop and close button all deny. Default focus is not on Approve. Enter pressed
     for another dialog must not approve.
   - An approval arriving while another modal (`ConfirmDialog`, `ConnectionDialog`, palette) is
     open: z-order and focus stealing.
   - Go-side timeout or cancel while the dialog still shows: a late Approve must not execute a
     request Go already refused, nor apply to the next request.
   - SQL shown as text (`{{ }}`, no `v-html`), long SQL scrolls, the connection and read/write
     mode are visible. Part 7's order (verdict, explain, one approval, execute) is Go's; check
     the UI never offers a second approval for one request.
9. **Settings (`SettingsDialog.vue`, `workbench/settings/*`, `settingsDomain.ts`,
   `settings.ts`).**
   - Apply-on-save (`settings-apply-on-save`): Cancel, Escape and X revert every live preview
     (theme, font, density). Numeric fields reject NaN and clamp.
   - A settings change from another window while this dialog holds a draft: overwrite or merge?
   - `ScriptsPane` + `SD/scripts.ts` + `customScripts.ts`: custom script commands. Check no
     connection field or secret is interpolated into a shell string without quoting.
   - `DatabaseMcpPane` (Part 7 F9 edit) token display and regenerate: token copied only on
     explicit action, never rendered in a tooltip or logged. `ClaudeCodePane` hook install
     confirms before writing user files.
   - `ApiPane` (452): P112 may change its data source. Review only the settings half.
10. **Other dialogs.**
    - `GenerateDataDialog.vue` (597): row-count bounds, Cancel mid-generation, target table
      dropped or tab closed meanwhile, read-only connection gate, grid reload after.
    - `UploadObjectDialog.vue`: existing key overwrite confirm, file size (whole `File` read into
      memory, base64 over IPC?), read-only gate, tab closed mid-upload.
    - `DataGripImportDialog.vue` + `SD/datagrip.ts` + `datagripImport.ts`: untrusted project
      files. Duplicate names, partial-import atomicity, secrets never shown or logged in the
      scan report, re-scan while a scan is running.
    - `SchemaDialog.vue` (DDL editor over `saveDdl`), `FiltersDialog.vue`, `ErrorPopover.vue`:
      unsaved-edit loss on close, error text rendered as text.
11. **Terminal module (`TerminalPanel.vue`, `TerminalStart.vue`, `TerminalView.vue`,
    `state/terminals.ts`, `state/terminalTabs.ts`).** B1's `createTerminalsStore` is closed.
    - Tab close kills the session; session exit updates the tab; closing during spawn.
    - xterm dispose, resize observer and listeners removed on unmount; tab switch keeps the
      buffer.
    - Terminal tabs never persist (verified: `persistable`). `cwd === ''` disables "+"
      (`WorkbenchShell.vue:47`); check `TerminalStart` agrees.
12. **Command palette and shortcuts (`CommandPalette.vue`, `shortcuts/state.ts`).**
    - **Carry-over from Part 13 (SPEC "P108 Part 13 result", "Not fixed here" item 2):**
      `CommandPalette.vue:41` puts `aria-hidden="true"` on the backdrop, an ancestor of the live
      palette. Screen readers lose the whole palette. Still open at `a8d1998`. Part 10 F10
      (`756425b`) fixed the `FkPreviewPopover` half; fix this one the same way.
    - The palette is a modal with no `role="dialog"`/`aria-modal`, no focus trap and no focus
      restore on close. Check against `PW`'s dialog pattern.
    - `CommandItem :value="command.id"`: check reka's filter matches the visible label, not the
      id (`view.run-all` vs "Run all").
    - Menu-bar channels (`App.vue:79-87`) and in-webview keydown bindings for the same
      accelerator: check no command fires twice.
13. **Shell chrome (`TitleBar.vue`, `StatusBar.vue`, `StudioStart.vue`, `workbench/state/engine.ts`,
    `modes.ts`, `tabViews.ts`, `host.ts`, `fonts.ts`).**
    - `initEngineState` in `App.vue` `onMounted`: subscription teardown, engine-down display.
    - `StudioStart` recent tables for deleted connections.
    - `tabViews.ts`: every renderable kind in `STUDIO_RENDERABLE_TAB_KINDS` has a view; an
      unknown kind from storage renders a fallback, not a crash.
    - `fonts.ts` (83): font-role resolution, `font-roles` spec.
14. **Theme helpers (`SF/theme/*`).** `completion.ts` (`tokenAt`, `templateToken`,
    `rankCandidates`, `MAX_VISIBLE = 12`) feeds console and variables completion; check `{{`
    templates, cursor at a boundary, non-ASCII. `cellClass.ts`: class names are static, never
    built from cell data. `EngineIcon.vue`: unknown kind fallback.
15. **Shared domain (`SD/{mode,uri,tree-filter,datagrip,secrets,scripts}.ts`).** Each has a Go
    twin (Parts 3 and 7, closed). Check field names and enum values still match; a mismatch
    fails silently through Zod defaults. `SD/mode.ts` `AppMode` against Go's window-mode values
    (§4.2).
16. **UI-test and unit-test harness.**
    - `mockRuntime.ts` defaults: an unmocked `control` call should reject loudly, not hang. A
      hang masks a real bug as a timeout. Check `ipcChannels.ts` FQN entries still match the
      generated bindings (P112 added one).
    - DB fixtures (`postgresFixture` 895, `mariadbFixture`, `mongoFixture`, `redisFixture`):
      wire shapes against `SI/page` encode (Part 6). A fixture the engine could never emit
      proves nothing.
    - `measure.ts` and `clock.ts` (budgets/perf): check medians over enough samples and no
      wall-clock assertion outside `ui-timing`. `playwright.config.ts` selects wall-clock tests
      by title regex (`wallClockBudgetTitles`): a new timing test not matching it runs under
      full contention. Report only if one exists today.
    - Unit harness: P112's `a8d1998` fixed cross-file pollution of the process-wide `control`
      singleton in three specs (`restoreAfterEach` snapshots at call time). Sweep every unit spec
      that assigns `control.X =` (4) or uses `mock.module` (11) for the same leak class. The
      full suite is 751 pass / 0 fail at `a8d1998` (verified), so any leak is latent and
      order-dependent. Fix in the spec; `restoreAfterEach.ts` is B1's and editable per §0.
    - `tests/visual/**`: Linux-only baselines with pinned fonts. Check each spec waits for a
      settled state before capture.
17. **Repo conventions.**
    - `<style>` blocks with `@apply` in 19 own files (1,357 lines; largest `ConnectionDialog`
      279, `SettingsDialog` 189): P99's recorded decision, same as Parts 10-11. Do not report.
    - Disabled controls inside plain `TooltipTrigger` (P105): sweep the chunk; they must use
      `TooltipDisabledTrigger`.
    - One store, one concern across 31 `state/` files. Candidates to decide: `tabs.ts` (tabs,
      hydrated set, recent tables, six openers), `connections.ts` (records, live states, connect
      flow, edit dialog).
    - `ConnectionDialog.vue` (1672): report a split only with a concrete seam.
    - No `v-html` in the chunk (verified by grep). Every SFC is `<script setup lang="ts">`
      (verified by grep).
18. **Doc drift.** `docs/ARCHITECTURE.md` sections on tab persistence and incognito, boot order,
    project tree sync, ops panel, terminal module and the DB MCP approval UI against the code.
19. **Tests against `CLAUDE.md`'s unit-test bar.** The five owned unit specs predate the rule
    ("applies going forward"); do not report them. Name a missing guard only where a finding's
    fix needs one: ops hydrate gap (§4.6), schema-columns generation (§4.5), tab-save ordering
    (§4.1).

## 5. Watch items (pre-plan §5.11, verified)

- **`state/**` re-review with every caller settled:** confirmed owed, smaller than expected
  (§0). Re-read Part 10's two edits with their callers: `viewCommands.ts` `pendingGuards` and
  `staleMarkers` are module-level maps, one entry per kind, last registration wins. Check each
  kind registers once, from store setup, and that the stale marker is cleared on the sibling's
  next real load. `cellSelection.ts`'s new optional `generated`/`pendingDelete`: check every
  publisher either sets or omits them consistently (grid sets; others must mean `false`).
- **P103 Part 2 `TabsHost` hooks:** all four wired in `tabs.ts:117-157`; duplicate order correct
  (code-read). Open: in-flight save ordering, close-path coverage, parse fallback (§4.1).
- **P99 Part 2 shell migration:** `ContextMenu.vue` and the tooltip layer have since moved to
  `PW`/`PT` (P103, B1 closed). What stays here: `@apply` blocks (recorded decision), shadcn-vue
  primitives in own files, VueUse listeners (`ProjectTree.vue:181-182`, palette
  `onClickOutside`). Check for a remaining hand-rolled listener or primitive only.
- **Churn (`workbench` 1,465, `SF/theme` 1,171, `project` 990):** figures not re-derived; `theme`
  is corrected in §0.

## 6. Carry-over audit (last P108 chunk)

Every earlier result and findings doc was grepped for "Part 12", "A11", "deferred", "not fixed",
"carried" and "handoff".

- **Open, in scope here:**
  - `CommandPalette.vue:41` backdrop `aria-hidden` (Part 13 result, item 2). §4.12.
  - Part 9 plan's handoff: connection-dialog reveal and the connection half of
    `credential-reveal`/`secrets` specs. §4.7.
  - Part 7 plan: "`SF/state/**` logic beyond the wire seam (Part 12 re-reviews it)". §5.
  - Part 10 plan: `maskRules.ts` `setQueryData` path is Part 12's. View side verified by
    Part 10; cross-window side open. §4.5.
- **Closed since, nothing to carry:**
  - Part 11 result "Deferred" (2 unit failures). `grpc-schema-supersession` fixed by P112
    `5677487`; `bridge-unwrap` was cross-file pollution, fixed by P112 `a8d1998`. Full suite
    751/0 at `a8d1998` (verified). Part 11's result text still says "left for their own
    follow-up phase"; no SPEC row was ever added. The orchestrator should note in Part 12's
    result that both are closed, rather than open a phase.
  - Part 11 plan §4.3 (`OperationsPanel.onRerun`): fixed as Part 11 F5. Re-review only the
    F5 code itself (§4.6).
- **Elsewhere, not Part 12:** Part 13 item 1 `--color-input` collision goes to P110. Part 9 F12
  is P112. Part 16's F6 follow-up is P111 (stream B).

## 7. Out of scope

- Generated code (`frontend/bindings`) and P110's `--color-muted`/`--color-input` collisions.
- Documented known open items (§0).
- Closed parts' fixes: Parts 2-11 and 13-20. Do not re-flag.
- `SF/api/**`, `ST/ui/api-*`, `ST/unit/api-*`: P112 in flight.
- `PW`, `PT`, `packages/kira-ui` beyond the call sites above: B1 closed, editable only when a
  finding here needs it.
- Go services behind the dialogs (Parts 3, 7): review only for parity with `SD` twins.
- `@apply` `<style>` blocks (P99 decision) and the five pre-rule unit specs.
