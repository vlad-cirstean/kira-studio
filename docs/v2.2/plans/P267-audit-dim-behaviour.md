Input to P267 plan. Audit at tip 36eb6b80d; re-verify counts against the current tree.

# Behaviour-dimension audit (18 dimensions)

Base: branch v2.0, HEAD `1bf09cec7` (asked tip `36eb6b80d`; HEAD moved on, other agent's uncommitted test edits ignored). Read-only.
Scope: `apps/kira-studio/frontend/src` (S), `apps/kira-space/frontend/src` (K), `apps/kira-space/frontend/mobile` (M), `packages/{workbench (W), git-ui (G), docker-ui (D), theme (T)}/src`, UI specs under `apps/*/tests/{ui,mobile}`.
Discovery: `codegraph_explore` per dimension (16 calls), then grep for counts. Counts are real.
Not repeated here: items in `audit-ui-leftovers.md` and `audit-exemptions.md` (cross-referenced as UL#n / EX).
Baseline: P264 §2 and P266 §2 decisions; ARCHITECTURE "Behaviour (P264)" and "Consistency conventions (P266)".

Verdicts: ALREADY UNIFIED, JUSTIFIED DIFFERENCE, GAP.

---

## Gaps ranked

1. Busy/in-flight state (dim 6): P264 §2.22 decision not migrated. ~45 files.
2. Unsaved-changes guard (dim 5): staged work lost on tab close; 25 form dialogs close on stray click. ~8 files.
3. Keyboard chords (dim 17): save chord split, dead menu hints, Delete chord split, refresh alias. ~10 files.
4. Timers (dim 9): 26 timing values outside `TIMING`; U46 blind to named consts. ~15 files.
5. Selection (dim 1): right-click-selects rule broken in 10 handlers; docker Enter ≠ double-click. ~10 files.
6. Validation timing (dim 7): 4 models. ~6 files + 1 composable.
7. Test conventions (dim 14): ~1600 lines of cross-app duplicate specs; 6 helper copies. ~14 files.
8. View-state persistence (dim 8): U43 generic-argument hole (4 raw `useLocalStorage`); tree expansion persistence ad hoc. ~6 files.
9. Component API naming (dim 10): emit case, v-model style, busy/pending/loading, testid prop casing. ~20 files.
10. Virtualization (dim 18): 4 fixed row heights ignore density; 3 cap mechanisms. ~7 files.
11. Logging (dim 15): scope names in 5 styles. ~25 call sites.
12. Drag and drop (dim 2): keyboard reorder on 2 of 7 surfaces; handle rule unwritten. ~6 files.
13. State ownership (dim 11): 2 server-backed menus hold data in refs. 2 files.
14. Layout/size (dim 16): 38 `.vue` over 400 lines; helper `.ts` mixed into `components/`. Policy plus splits.
15. Small: env var registry (dim 13), reveal event names (dim 12).

---

## 1. Selection model in lists, trees, grids: GAP (narrow)

Unified already:
- `useListNavigation` in 21 files. Every `role="listbox|tree"` binds it except the combobox pair `SearchBox`/`SearchResults` (EX: permanent U47).
- Single select plus roving `activeKey`. Multi-select only in grid engines and the history compare pair (P264 §2.15, recorded decision).
- Double-click: 11 sites, all "open" (TreeRow, CollectionRow, BrowseView, RepoTreeRow, RepoSearchRow, FileTree ×2, TabStrip promote, Docker ×2). Enter = `onOpen` = double-click in Studio/Space trees.

Gaps:
- P264 §2.2 rule "right-click on a row selects and focuses it, then opens the menu" is broken in 10 handlers. Of the 39 `@contextmenu` sites, these select first: `ProjectTree.vue:151`, `CollectionsTree.vue:135`, `BrowseView.vue:243`, `FileTree.vue:420`, `RepoFileTree.vue:85`, `GitPanel.vue:364` (focus only), `ReviewCommitRow.vue:89`.
  - These open the menu without selecting:
    - `KeyValuePane.vue:573`, `DocumentView.vue:720`, `StreamView.vue:214`
    - `OpLogPanel.vue:151`, `AutomationsPanel.vue:234` (×3 handlers)
    - `ContainerList.vue:193`, `ColumnsSection.vue:38`
    - git `useSectionMenu.openAt` callers: `TagList.vue:116`, `StashRows.vue:126`, `BranchPicker.vue:702,758`
- Docker breaks "Enter = double-click":
  - `ContainerTable.vue:54`: Enter runs `open(c)` (overview), but `:92` double-click runs `open(c,'logs')`, and a single click already opens.
  - `ContainerList.vue:295-296` follows the same split.
- Final decision: the row's own context-menu handler selects (or focuses, for focus-only lists) before it opens, every time. Put it in one place: `useListNavigation` gains `onContextMenu(item, event)`. It sets `activeKey`, calls `onSelect`, then opens the store menu with `onRestoreFocus` wired. Docker: click selects, double-click and Enter open the same tab.
- Size: about 10 files.
- Guard: U-new (v) `@contextmenu` handler in a file with `useListNavigation` must call `nav.contextMenu(`.

## 2. Drag and drop beyond ghost class: GAP (small)

Unified already: `useSortableReorder` (6 callers), one ghost class (U76). `AdeDayBand` is the named exception for cross-band drops.

Drift:
- Handles: grip on 3 surfaces (`VariableSetView.vue:290`, `EnvironmentsView.vue:126`, mobile `BacklogScreen.vue:74`). Whole item on 3 (`TabStrip.vue:192`, `ColumnsMenu.vue:89`, `AdeWorkflowGraph.vue:264`). No written rule.
- Drop-target highlight:
  - Sortable surfaces show only the moving placeholder.
  - `AdeDayBand.vue:57` adds a literal `chosenClass: 'ring-2'`. `AdePlanView.vue:381` adds `dragOverDay`.
- Cancel: no Esc cancel anywhere. Sortable fallback mode has no built-in cancel.
- Keyboard alternative: Alt+Up/Down only in `EnvironmentsView.vue:214` and `VariableRow.vue:115` (EX lists the raw handler). None in TabStrip, ColumnsMenu, workflow stages or backlog.
- Final decision:
  - Grip handle when the row holds inputs or buttons; whole-item drag for chips and tabs.
  - `useSortableReorder` gains `keyboard: true`. It binds new SHORTCUTS ids `list.moveUp/moveDown` (Alt+Up/Down, Alt+Left/Right when horizontal) and Esc-cancel (restore the order from before the drag).
  - `chosenClass` becomes a `SORTABLE_CHOSEN_CLASS` constant beside the ghost class.
- Size: 7 files.
- Guard: extend U76 to `chosenClass:` literals.

## 3. Undo/redo: JUSTIFIED DIFFERENCE

- Domain undo only, as P264 §2.16 recorded:
  - git single-level undo slot (`ops.ts:1471`, `UndoButton.vue`), announced through the live region (`composeUndoAnnouncement`)
  - Monaco Cmd+Z
  - grid staged edits (Revert, `useEditBuffer.reset`)
  - docker edit `reset`
- Everything destructive elsewhere goes through a confirm: 25 `tone: 'danger'` calls in 22 files.
- Reason to keep: most writes are immediate server-side writes with no inverse. Examples: `KeyValuePane.vue:413` S3 PutObject; `ImportReportStrip.vue:18`, where deleting the collection is the undo.
- One note, not a gap: grid Revert and Monaco undo announce nothing; git undo does. Announcing every undo through `announceApp` would be cheap if wanted.

## 4. Autosave vs explicit Save per editor type: JUSTIFIED (model), GAP (chord)

Model by editor type (consistent with P17 D5 and the P266 §2.4 apply rule):
- Tab state (console text, request builders, grid view state): autosaved to `state_json` (`TIMING.tabsSave`).
- Persisted documents: explicit Save.
  - HTTP/gRPC request to collection: `useRequestTabSave`, dirty marker on the tab.
  - Document editor, cell editor, KeyValue string/object edit: `useEditBuffer` plus Save/Revert.
  - Settings dialog: draft plus Save.
  - Script dialog, connection dialog, git RepoSettingsDialog: Save.
  - Docker edit: Apply.
  - ADE workflows: save bar.
- Notes: autosave (`AdeNotesEditor.vue:38`, `TIMING.autosave`).
- Inline fields (repo config, env rows, variables): commit on blur or Enter (`useInlineEdit`).

Gap, the chord:
- `form.save` (Cmd/Ctrl+S) is bound only in `AdeWorkflowGraph.vue:223` and `AdeWorkflowYaml.vue:122`.
- `api.save` (`HttpRequestView.vue:473`, `GrpcRequestView.vue:304`) is a palette command with no chord. It is absent from `SHORTCUTS` and the menus, so Cmd+S does nothing in a request tab.
- Document, cell and KeyValue editors have no save chord.
- Final decision: every explicit-Save surface inside a tab binds `form.save` through `useShortcut`. Dialogs keep `form.submit` (Cmd+Enter). `api.save` gets the `form.save` chord in the palette.
- Size: 6 files.

## 5. Unsaved-changes guard: GAP

- Tab close never asks.
  - `createTabsStore.closeTab` → `closeTabInternal` (W `createTabsStore.ts:419-450`) → Studio `onClosed` → `usePendingChangesStore().clearPending(tabId)` (S `state/tabs.ts:156`).
  - Staged grid edits are memory-only, so closing a data tab (or Close others/All) silently discards them. The same holds for a dirty document or cell edit buffer.
  - This breaks the stated rule (P264 §2.17, P17 D5): prompt when leaving loses work no draft or push restores.
- Dialogs: theme `DialogContent.vue` lets reka close on outside pointer-down and Esc.
  - 44 dialog files; 25 hold form inputs (ConnectionDialog is 1478 lines).
  - 0 guard a dirty draft. Only `UpdateDialog.vue:48-49` intercepts Esc or outside click.
  - A stray click outside a half-filled connection or script form discards it.
- Window: ADE leave guard via `beforeModeChange` (`WorkbenchTitleBar.vue:23`). Quit: no confirm (P266 §2.7). Staged grid edits are also lost on quit; record that as accepted, or cover it.
- Final decision:
  - (a) Tab kinds gain `isDirty(tabId)` in `KindLookup`. `closeTab`/`closeOthers`/`closeAll` call `confirm({tone:'danger', confirmLabel: Discard})` when any closing tab is dirty (grid pending, edit buffer dirty).
  - (b) `DialogContent` gains `dirty?: boolean`. While dirty, outside click is ignored, and Esc or X asks the same Discard confirm.
- Size: 3 shared files plus about 10 dialogs passing `:dirty`.
- Guard: none practical; `confirm-focus`-style spec per mechanism.

## 6. Optimistic update and busy/in-flight states: GAP (largest)

- Optimistic: unified. `optimisticUpdate` has 5 callers (`ade/v2/queries.ts:146,159,189,268`, `mobile/state/useAdeWrites.ts:44`); U55 holds. Elsewhere writes reload on push, which is fine.
- Busy: P264 §2.22 decided "theme `Button` gains `pending` … hand spinners in buttons go". The prop exists (`T/components/ui/button/Button.vue:15`), but it has 1 caller: `ConfirmDialogView.vue:84`.
  - 73 `:disabled` bindings to busy flags (`saving|busy|loading|running|isPending|pending`) with no visual pending state.
  - Hand spinners inside buttons: `RefreshButton.vue`, `ContainerEditView.vue`, `UnavailableState.vue`.
  - Busy refs that escape U51's exact-name regex:
    - `KeyValuePane.vue:364,417,506` (`editSaving`, `objectSaving`, `addSaving`)
    - `ResponseDiffDialog.vue:41` (`mergeLoading`), `StreamView.vue:543` (`partitionOptionsLoading`)
    - `AdePlanView.vue:43` (`allBusy`), `PullStrategyPicker.vue:41` (`previewLoading`)
  - `useAsyncAction` has 16 callers and `useMutation` 18 files, so the pending source exists; only the button binding is missing.
- Final decision: a button that starts an async action binds `:pending` to `useAsyncAction().pending` or `mutation.isPending`, never `:disabled` alone. Busy flags come only from those two sources.
- Size: about 45 files.
- Guards:
  - U51 regex becomes `const \w*(Busy|Pending|Saving|Loading|Submitting|Running|Deleting)\s*=\s*ref\((true|false)\)` (case-insensitive tail).
  - New (v): `<Button[^>]*:disabled="[^"]*(saving|busy|isPending|pending|running)` without `:pending`.

## 7. Validation timing and message placement: GAP

Four timing models:
- On first change per field, Save disabled until clean: `ScriptDialog.vue:157-176` (`shown`).
- On submit, then jump to the first error's tab: `ConnectionDialog.vue:224,451-494` (`fieldErrors`, `TAB_FOR_FIELD`). Plus one live field (`throttlePerSecError`).
- Live from the first render: docker `editDiff.ts:412` `fieldErrors(draft)`, `SettingsShell.vue:149` (Save disabled).
- On submit only, single message: `KeyValuePane.vue:526-530` (`nameRequired`). `SaveRequestDialog.vue:138` only disables Save, with no message.

Placement:
- `FieldError` in 69 files; `aria-invalid` on only 26 controls.
- Operation-failure placement is UL#18; not repeated.

Final decision: one composable `useFormErrors(rules)` in `behaviour/`.
- A field's error shows after its first change or after a submit attempt.
- Save stays enabled. Submit with errors reveals all, switches tab, and focuses the first invalid field (ConnectionDialog behaviour).
- The message is `FieldError` under the field, plus `aria-invalid` and `aria-describedby` on the control.
- Settings keeps live errors: draft UI, already field-anchored.
- Size: 1 new composable, 6 dialogs and forms.
- Guard: (v) `<FieldError` in a file whose control lacks `aria-invalid`.

## 8. View-state persistence across restarts: GAP (small)

Tier table holds (P266 §2.4): layout store, tab `state_json` (grid columns, scroll row via `TIMING.scrollPersist`, document expansion), git `ViewStateStore` v8 (scroll row, selection, column widths, search toggles), `usePersistedState` (9 keys).

Gaps:
- U43 hole: the regex `useLocalStorage\(` misses a generic argument `useLocalStorage<T>(`. 4 raw sites pass the guard:
  - `K/repo/state/search.ts:309` (`kira.git.panelTab`)
  - `K/state/workspace.ts:60`
  - `D/queries.ts:168` (`kira.docker.diskUsage`)
  - `D/state/dockerUi.ts:20` (`kira.docker.collapsedGroups`)
  - None has schema validation.
- Tree expansion:
  - Persisted: docker groups, automations collections.
  - Memory-only: Studio collections tree (`api/state/collections.ts:122`), Space repo file tree (`repo/state/fileTree.ts`).
  - Studio project tree is memory-only by design (lazy IPC; session restore never auto-connects).
- Final decision:
  - In-memory trees persist expanded keys through `usePersistedState('kira.<module>.expanded', [])`.
  - Lazy IPC trees do not restore (named in ARCHITECTURE).
  - Filters and search text stay session-only, except the git search toggles already in `ViewStateStore`.
- Size: 6 files.
- Guard: U43 regex `use(Local)?Storage(<[^>]*>)?\(`. Check the U44, U42 and similar regexes for the same `<…>` hole; none found today.

## 9. Debounce/throttle/timeout values: GAP

`TIMING` (W `behaviour/timing.ts`) has 23 importers. Outside it are 22 named constants and 4 inline literals; U46 checks only literal arguments, so named constants pass.

Same kind of wait, different number (unify into TIMING):
- `COOKIES_FETCH_DEBOUNCE_MS = 300` (`HttpRequestView.vue:435`): P264 §2.13 said 250 = `preview`.
- `SCHEMA_DEBOUNCE_MS = 150` (`grpcrequest/schemaQuery.ts:22`); blame `DEBOUNCE_MS = 150` (`K/views/repo/blameLine.ts:18`).
- Persistence writes at 150, which is `persist`: `WRITE_DEBOUNCE_MS` in `K/state/adeLayout.ts:15` and `W/state/createLayoutStore.ts:18`; `MODE_WRITE_DEBOUNCE_MS` in `createModeStore.ts:16`.
- Hover at 400, which is `hoverInfo`: `HOVER_DELAY_MS` (`AutocompleteField.vue:410`; P264 §2.20 said use `TIMING.hoverInfo`) and Monaco `hover: { delay: 400 }` (`MonacoHost.vue:426`).
- `agentNotify.ts:46` `{ debounce: 150 }`; `G/state/pr.ts:10` 300; `D/state/useStatsSubscription.ts:7` 300.
- Polls and ticks: `createAppUpdateStore.ts:26` hourly; `S/state/runState.ts:13` 200 ms tick; mobile `api/events.ts:61` reconnect 3000.
- `CAPTION_DELAY_MS = 200` (`useResponseBody.ts:9`) is the same idea as `spinnerDelay` 300.

Justified (keep, with reason in a comment):
- `DAY_MS` ×2 (calendar arithmetic, not a wait)
- `bridge/port.ts` 30 s transport timeout (named in U46)
- `REVEAL_GRACE_WINDOW_MS` (mirrors Go `localauth.GraceWindow`)
- `CHASE_QUIET_MS` 24 (frame-level)
- git graph `AUTO_REFRESH_*`, `LOADED_SCAN_*` (perf tuning tied to the server debounce)
- `RELEASE_RETRY_MS`, `gcTime: 30_000`

Final decision: every debounce, poll, tick and UI delay is a `TIMING` key. Perf budgets and domain durations stay local, named `*_MS` with a one-line reason.
- Size: 15 files.
- Guard: U46 adds `const \w*(DEBOUNCE|DELAY|POLL|TICK|INTERVAL)\w*_MS\s*=\s*\d` and `(debounce|delay):\s*\d{2,}`.

## 10. Component API naming: GAP

Counts come from a parser over 525 `.vue` files outside `ui/`. Prop extraction is partial for multi-line types, so prop counts are lower bounds.

- Emit case:
  - kebab: 10 names in 3 files (`WorkbenchTitleBar.vue:28-32` ×5, `WorkbenchShell.vue:28-29`, `CollectionRow.vue:45` `cancel-rename`, plus `toggle-path`).
  - camelCase: 14 names (`copyError`, `dayMenu`, `dragStart`, `forcePush`, `goToDate`, `goToMatch`, `refreshAll`, `togglePin`, …).
- v-model:
  - `defineModel` in 11 files.
  - Hand-written `modelValue` prop plus `update:modelValue` emit in 8: `MonacoHost`, `FieldRowsTable`, `DateTimePicker`, `TimestampPane`, `VariableRow`, `MethodSelect`, `AdeBasePicker`, `KeyBar`, also `AutocompleteField`, `SearchOptionToggles`.
  - Plus about 12 other `update:x` emits.
- In-flight prop: `busy` (`ConfirmDialogView`, `AdeRepoChip`, `RepoEnvRow`), `loading` (`SchemaBrowser`), `pending` (theme `Button`).
- Secondary text: `description` (`EmptyState`, `ModuleStart`) vs `hint` (`ListState`, `EditField`). `ListState` passes `hint` into `EmptyState description`.
- Testid props: `*Testid` 9 names vs `*TestId` 7 names (`SavedListMenu`, `gridHostShared.ts`, `SearchOptionToggles`, `LogLevelField`). Also `testid`, `testidPrefix` (55), `testids` (object, `ConfirmDialogView`).
- Dismiss emit: `close` 20, `cancel` 4 (`RecreateConfirmDialog`, `CredentialPastePanel`, `OpLogPanel` (op cancel, different meaning), `ReviewThread`), `dismiss` 1 (`FailureBanner`). Choice emit: `select` 10 vs `pick` 3 (`AdeCandidateRow`, `AdeBacklogRow`, `AdeSessionStrip`).
- Slots: `actions` ×5 vs `action` ×1 (`AdeStageBlock.vue:207`).
- `readOnly` (`MonacoHost`) vs DOM `readonly`.
- Final decision:
  - Emits are camelCase in `defineEmits`.
  - v-model is `defineModel` only.
  - In-flight prop is `pending`. Secondary text prop is `description`.
  - Testid props use the `…Testid` spelling; `testid` for the root id, `testidPrefix` for families.
  - A dialog's dismiss emit is `close`; a choice emit is `select`; an action slot is `actions`.
- Size: about 20 files.
- Guard (v): `defineEmits<\{[^}]*'[a-z]+-[a-z]`, `'update:modelValue'` outside `components/ui/`, `\w+TestId\b`.

## 11. State ownership: ALREADY UNIFIED (2 exceptions)

- Pinia `defineStore` in 85 files, one concern each (N4 ids). TanStack `useQuery` in 30 files. Push-subscribed lists stay in stores (`hydrateThenSubscribe`), as P264 §2.24 decided.
- No raw fetch in `onMounted` found (grep for `onMounted(async … control.`: 0).
- Exceptions, server state in component refs with hand reload after each mutation:
  - `S/views/shared/FilterHistoryMenu.vue:31-58` (`saved`, `history`)
  - `S/views/console/ConsoleSavedMenu.vue:30,49-52`
  - Both have pin, rename and delete mutations.
- Decision: move both to `useQuery(['queries', connectionId, path])` plus `useMutation` with invalidate.
- `StreamView.vue:542-550` partition options: the same pattern, but only one call on open; acceptable as a QueryState-less one-off, or fold it into the same query style.
- Explicit `queryClient` argument guard gap is UL#27.
- Size: 2 files.

## 12. Tab/route identity, dedup, deep links: ALREADY UNIFIED

- Identity is `tab.id` (ARCHITECTURE). Dedup is `reuseExistingTab` on `(kind, connectionId, path, workspaceId)` (W `createTabsStore.ts:312`), with 15 `reuse: true` callers.
- `reuse: false` in 7 places, all by design:
  - new HTTP/gRPC request
  - saved request (deduped on `itemId` by `collectionsStore.openRequestRow`)
  - new console
  - terminals
  - 2 Space repo-tab paths
- Deep links: none on desktop (no URL scheme). Justified: OS notifications route through Go events (`kira:agent:revealTask|revealTerminal|revealScriptRun`, `kira:adetask:openSession`, `kira:prompts:reveal`). Mobile uses `vue-router` (`M/router.ts`: `/needs`, `/plan`, `/backlog`, `/terminal/:sessionId`, `/pair`).
- Minor: reveal channels use 3 verb shapes (`revealX`, `openSession`, `reveal`). Rename to `kira:<domain>:reveal<Thing>` at the next N5 touch; low value.

## 13. Feature flags/debug hooks: ALREADY UNIFIED

- One compile-time define, `__KIRA_DEBUG_HOOKS__` (W `viteAppConfig.ts:35,89`; serve or `KIRA_DEBUG_HOOKS=1`; mobile config `false`). It gates every `window.__kira*` writer: S `main.ts`, K `main.ts:174`, theme `installCopyTestHook`. Readers such as `__kiraGridTuning` are harmless when undefined.
- No runtime feature flags in UI.
- Go dev switch: one `kirapaths.IsDev()` (`KIRA_DEV`, inert in production builds).
- Minor: 23 `KIRA_*` env names in Go. `KIRA_DEV`, `KIRA_NO_STARTUP_ALERT` and `KIRA_DOC` are not in any `docs/*.md`. Add one table to `DEV_ENVIRONMENT.md`.

## 14. Test conventions: GAP

Unified:
- Specs are `.spec.ts`, kebab names (N1/N2).
- testids: 2145 kebab, 67 camel, all derived from settings leaf names (justified, `settings-reset-<leaf>`).
- Locator style is consistent: `locator('[data-testid=…]')` 3387 vs `getByTestId` 2, `getByRole` 59.
- Shared helpers: `W/testing/ui/` (contract, fixtures, mockRuntime, prompts, server, copyCoverage, perfProbe) plus `apps/*/tests/ui/support/`.

Gaps:
- Cross-app duplicate specs for the shared Automations module:
  - `automations-{editor,recurring,smart,runs}.spec.ts` exist in both apps: 333/337, 432/493, 472/463, 322/320 lines.
  - They differ by only 16/67/13/10 lines, so about 1600 duplicated lines.
- Helper copies in spec files:
  - `tid` ×6 (3 per app)
  - `openPanel` ×6
  - `openDocker` ×4
  - `openHttpMode` ×3
  - `connectAndOpenGrid` ×2
  - `connectAndExpand` ×2, although `support/connect.ts` exports it (`leaks.spec.ts`, `cell-editor.spec.ts`)
  - `installClipboardSpy` ×2, although `support/clipboard.ts` exports it (both `automations-runs.spec.ts`)
- Final decision:
  - Shared-module scenarios live in `W/testing/ui/scenarios/<module>.ts`. Each app's spec is a thin file passing its boot and fixtures.
  - A helper used by 2+ specs lives in support, or in `W/testing/ui` if both apps use it.
  - `tid(page, id)` lives in `W/testing/ui`.
- Size: 8 specs to 4 scenario modules, plus about 14 files de-duplicated.
- Guard: a check-conventions rule. A `function <name>` defined in 2+ spec files, or one shadowing a support export, fails.

## 15. Logging/telemetry: GAP (small)

- Unified: one logger (`W/bridge/log.ts` `logWarn`/`logError`), `fireAndForget` with 52 calls, Biome `noConsole`. No telemetry library or upload anywhere.
- The 22 remaining `console.*` in 10 files are the EX noConsole list; not repeated.
- Gaps:
  - Scope strings use 5 styles:
    - camel (`agentNotify`, `keepAwake`, `appUpdate`)
    - kebab (`app-update`, `notify-prompts`, `op-log`)
    - dotted (`docker.stats`, `ade.notes`)
    - phrases (`'cancel explain'`, `'new window'`, `'api data changed'`)
    - plain words
  - `app-update` and `appUpdate` both exist.
  - git `RepoScopedReload.fireAndForget` (`G/state/repoScopedReload.ts:60-66`) is a second fire-and-forget that logs at `console.error`; workbench logs at warn.
  - Go: 217 `slog.Warn` vs 17 Error, 14 Info, 12 Debug. There is no written rule for which level.
- Final decision:
  - Scope is the camelCase module id, with an optional `.sub` (Go G3 uses the same `"scope"` idea). The message says what failed.
  - Background failures log at warn; a failure that breaks a user-visible feature logs at error. Info is for state transitions only.
  - git `RepoScopedReload` calls the workbench `fireAndForget`.
- Size: about 25 call sites, 1 git file.
- Guard: regex on the first argument of `fireAndForget|logWarn|logError`, `'[a-z]+([A-Z][a-z]+)*(\.[a-z][A-Za-z]*)?'`.

## 16. File/folder layout and component size: GAP (policy)

- 38 `.vue` files over 400 lines out of 525: S 20, K 7, W 3, G 8, D/T/M 0. Largest:
  - `SlickGridHost.vue` 2754, git `App.vue` 1996
  - `StreamView.vue` 1486, `ConnectionDialog.vue` 1478
  - `CommitGrid.vue` 1369, `DocumentView.vue` 1333, `KeyValuePane.vue` 1297
  - `ReviewView.vue` 1137, `ConsoleView.vue` 1057
- Feature layout drift:
  - `G/components/` holds 29 `.vue` and 24 non-component `.ts` (`rowMenuModel`, `gridKeyboard`, `fileTreeModel`, `columns`, `dateFormat`, …). Other packages keep `components/` for components only (W 31/2, D 34/0).
  - Menu builders: `menu.ts` ×5, `menus.ts` ×3, `menuItems.ts`, `columnsMenu.ts`, `resultMenu.ts`, `taskMenu.ts`/`dayMenu.ts`/`fixMenu.ts`.
  - State: `state.ts` ×10 vs `state/` dirs ×10. Studio `views/<kind>/` uses `state.ts`; `project/`, `api/` and `repo/` use `state/`.
- Final decision:
  - `components/` holds `.vue` only; models and keyboard helpers go to a sibling `lib/` (N3 already names `lib/`).
  - A feature with 1 store file uses `state.ts`, with 2+ uses `state/`. Menu builders are `menu.ts` (one per feature).
  - Size rule: a `.vue` over 600 lines needs a split plan, or a named exemption naming the engine host. Today: SlickGridHost, CommitGrid and MonacoHost are engine hosts; git App is the shell.
- Size: the 24 git `.ts` moves are mechanical. Splits are per-file phases for the 13 non-engine files over 600 lines.
- Guard: check-conventions, `components/**/*.ts` (non-spec) outside `ui/`; a line count over 600 without an allowlist entry.

## 17. Keyboard shortcut consistency: GAP

Unified:
- One table (`shared/domain/shortcuts.ts`, 30 ids with scopes), a conflict unit test, `useShortcut` (8 callers), menu accelerators from the same table (`shell.Shortcuts`).

Gaps:
- Save: see dim 4 (`form.save` only in ADE workflows; `api.save` has no chord).
- Dead hints: `S/views/browse/menu.ts:35,102` print `tree.copyName`/`tree.delete`. `BrowseView` binds neither (no `shortcutFor` or `useShortcut` there), so the menu shows chords that do nothing.
- Same action, different chord:
  - Delete: `tree.delete` is Delete, or Cmd+Backspace on mac. `AdeWorkflowGraph.vue:239` uses a plain `'Delete'` via `onKeyStroke` (EX permanent U40). On mac that is fn+Delete, not Cmd+Backspace.
  - Refresh: `view.refresh` F5 (Studio menu). git `gridKeyboard.ts:96-105` takes F5 and also Ctrl/Cmd+R. The Space menu has no Refresh item.
- Tree chords only in Studio: `tree.*` used in `ProjectTree`, `CollectionsTree`, Studio menus (21 refs). Space `GitPanel` (rename at `:179`), `RepoFileTree` and `AutomationsPanel` (rename at `:302`) offer the same actions with no chord and no printed hint.
- Global dispatch: `ade.reviewCode` (scope `global`, Cmd+Shift+R) runs from a window keydown in `AdeShell.vue:55`, not a menu accelerator. P266 §2.6 says global chords dispatch through the menu.
- Final decision:
  - Every printed shortcut is bound in that surface.
  - Every tree or list with rename, delete or copy-name binds the `tree.*` ids through one `useTreeShortcuts(nav, actions)` composable.
  - Delete uses `tree.delete` everywhere, including the workflow graph.
  - Refresh is F5 only: drop Cmd+R in git (WebKit reload habit), or add it as an alias in `SHORTCUTS`; pick F5 only.
  - Global chords go through Go menu items in both apps.
- Size: about 10 files.
- Guard: a unit test asserting every `shortcut:` id in a menu builder file is matched by a `shortcutFor`/`useShortcut` in the consuming component (map file to consumer), or simpler, a grep pairing per feature dir.

## 18. Virtualization and cap thresholds: GAP (small)

Unified:
- `useVirtualRows`/`useTreeVirtualRows` in 18 callers (U44), `VirtualList` (docker, 8 callers), `LogLines` (both run logs), SlickGrid.
- P266 migrations for `ReposDialog` and `AdeChangesTab` files landed. `AdeChangesTab.vue:89,102` (`dirty`, `commits`) are still plain `v-for`; commits ahead of base is unbounded.

Gaps:
- Row heights ignore the density setting (P264 §2.7: `useRowHeight()` unless measured or fixed by design):
  - `BrowseView.vue:262` (28)
  - `grpcrequest/ResponsePane.vue:171` (22)
  - `AdeChangesTab.vue:34` (24)
  - `ImportJobDetail.vue:28` (32)
  - Fixed by design and fine: OpLog 18, docker logs 18, document rows (measured).
- Caps: 3 mechanisms.
  - `useCappedList` plus `ShowMoreButton`: only `BranchPicker.vue`.
  - git `capRows` (`fileTreeModel.ts:225`, 500, own "Show all" row).
  - Studio `FILTER_ROW_CAP` 500 (`filterTree.ts:69`, truncated notice, no show-more).
  - P264 §2.21 named both of the last two for `useCappedList`; not done.
- Thresholds: 500 render cap (3 places), 50 ref section, 200 hydrate and list limits, 20 000 log ring plus 2 000 wrap render (docker).
- Final decision:
  - Render cap 500 through `useCappedList` (step 500) for picker and tree sections; ref sections 50.
  - Virtualize instead of capping when the list is the main content (`AdeChangesTab` commits).
  - Row height from `useRowHeight()` unless named fixed.
- Size: 7 files.
- Guard: U80 also flags `capRows(`/`_ROW_CAP` outside `cappedList.ts`. New (vt): `rowHeight:\s*\(\)\s*=>\s*\d|const \w*ROW_HEIGHT\w*\s*=\s*\d` outside named files.

---

## Side findings

- `connectionsReorder` (`S/bridge/index.ts:112`, `ConnectionsService.Reorder`) has no UI caller; connections cannot be reordered. It is dead wrapper and bound method, or a missing feature. `knip` misses it because the mock channel lists reference it.
- The Browse dead hints (dim 17) are a user-visible lie today. They are the cheapest fix in this report: bind them, or drop `shortcut:`.
