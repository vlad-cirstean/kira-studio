# P325 Part 1: Stale-data foundation plus the SQL data view

Base commit `79a7ace72` (branch `v0.2.10`). One sequential Sonnet implementer. Frontend only.
No stream split: the SQL data view consumes the shared pieces this part builds.

## Why P325 is split

The SPEC row covers every view that shows fetched connection data. The lockout audit
(CodeGraph, below) finds seven views across three write models:
- the staged commit model (grid);
- immediate writes through `createImmediateMutator` and `objectStore` (Documents, KeyValue,
  Browse);
- views with no edit surface on the data, or writes that never read it (Stream send, Definition,
  Console).

Doing all seven in one pass would touch ~30 files. The split keeps the table order:
- **Part 1** (this plan): the shared foundation and the SQL data view.
- **Part 2** (`P325-part2.md`): Documents, KeyValue (tab and browse preview), and Browse.
- **Part 3** (`P325-part3.md`): Stream, Definition, and Console result grids.

Parts run in order. Part 2 builds on Part 1's shared pieces. Part 3 also makes Part 2's mutator option required.

## Shared audit facts (all parts)

- **What clears data on drop.** In `state/tabs.ts:192-199`, a `disconnected`/`error` state
  unhydrates every tab of the connection and calls `actions.dropPageStoresForTab`. That function
  blind-calls every kind's `dropResources` (`createTabsStore.ts:173`). The kinds with a page store
  are:
  - data: `dropGridPagesForTab`
  - console: `dropConsoleResultPagesForTab`
  - document, keyvalue and stream: their own droppers
  Definition and browse have `noDrop` (`tabKinds.ts:137`): their data lives in the runtime record
  and survives today. Only the gate hides it.
- **Second drop signal.** A read failing `E_ENGINE_DOWN`/`E_CONNECT` (`viewOp.ts:23`) unhydrates
  the tab. This happens through `applyLoadFailure` (grid, documents, keyvalue, stream, console),
  `browse/state.ts:120`, and no unhydrate at all in `definition/state.ts:66-74`. The page is kept,
  and the backend state can still say `connected`, so caps stay set.
- **What hides data.** Every view swaps its content for an `EmptyState` reconnect panel on
  `v-if="needsReconnect"`:
  - `DataView.vue:326`
  - `DocumentView.vue:420`
  - `KeyValuePane.vue:188`
  - `StreamView.vue:128`
  - `BrowseView.vue:421` (gates the whole list and preview split)
  - `DefinitionView.vue:364`
  The console has no gate: its results vanish only because the page store is dropped.
- **Edit gates read `caps` and `readOnly`.** A disconnected state carries `caps: null`
  (`service.go:976`, `:1000`), so most write controls already disable after the event, with the
  wrong reason ("not supported" or "read-only", from `views/shared/writeGate.ts`
  `writeDisabledReason`). After a failed read with the state still `connected`, nothing blocks
  writes.
- **Session change.** `ConnectionState.since` is set once per successful connect
  (`service.go:954-956`). Nothing records which session a shown page came from. A reconnect from
  outside the tab (tree, MCP `connectForQuery`, re-open via `onOpened`, `tabs.ts:145-150`) can
  re-hydrate a tab that still shows the old session's data.
- **Backend.** `adapterhost/data.go:154` `Mutate` starts with `requireLiveAdapter`, which refuses
  `E_ENGINE_DOWN` when the connection is down. That is the only server guard, and no part adds
  another (reason under Design).

## Design (shared, built here)

- **Stale, defined once.** A view's shown data is stale when either holds:
  1. the gate needs a reconnect (`!isHydrated(gateTabId) || status !== 'connected'`);
  2. the data was read under another connection session. The stamped `since` exists and differs
     from `states[connectionId].since`.
  A successful read re-stamps, so Refresh, paging and filtering all clear staleness.
- **New Pinia store, one concern:** `state/staleData.ts`, `useStaleDataStore`. It holds which
  connection session each view's shown data came from. API:
  - `stamp(dataKey, connectionId)` records `states[connectionId]?.since ?? null`.
  - `isStale(dataKey, gateTabId, connectionId)` evaluates rules 1 and 2.
  - Cleanup goes through `registerTabRuntimeCleanup`. It deletes `dataKey === id` and every
    `dataKey` starting with `${id}::`, which covers the browse preview key.
  `dataKey` is the tab id. For Part 2's browse preview it is the viewKey `${tabId}::preview`,
  with `gateTabId` the browse tab.
  A store is used rather than a per-runtime field, because six runtimes would each need the
  field plus the same predicate.
- **`tabNeedsReconnect(tabId, connectionId)`**: a plain function exported from
  `views/shared/useConnectionGate.ts`, holding today's `needsReconnect` body. `needsReconnect` and
  `isStale` both call it. It reads reactive stores, so it is reactive inside `computed`.
- **Keep pages per kind.** `tabs.ts` gets `const KEEPS_DATA_ON_DROP = new Set<StudioTabKind>(['data'])`.
  The listener still unhydrates every tab, and calls `dropPageStoresForTab` only for kinds
  outside the set. Parts 2 and 3 add their kinds to the set.
- **Banner: one composition, no new variant.** `views/shared/StaleDataStrip.vue`, `<script setup lang="ts">`.
  - Props: `reconnecting: boolean`, `testid: string`. Emits `reconnect`.
  - Renders `Alert strip variant="warn" icon="plug"`, then
    `AlertDescription` with `t('studio.common.connectionLost.description')`, then
    `AlertAction` with `Button variant="toolbar-primary" size="kira" :pending="reconnecting"` and
    `t('studio.common.reconnectAndLoad.label')`.
  - Button testid: `${testid}-reconnect`.
  This is the same composition as `KeyValuePane.vue:236-260`, reused by every part.
- **Reason text, one place.** `writeDisabledReason(capFlag, stale = false)` in
  `views/shared/writeGate.ts` returns `t('studio.common.connectionLost.tooltip')` first when
  `stale`. Every view's disabled-control reason goes through it or uses that key directly.
- **Immediate-write backstop** (`createImmediateMutator`) is built in Part 2, where its first real
  callers land. Part 1 does not touch it, so no placeholder wiring exists.
- **Dock reason.** `SelectedCell` (`state/cellSelection.ts`) gets `stale?: boolean`.
  `ReadOnlyReason` gets `'connection-lost'`, which `readOnlyReasonFor` returns first.
  `readOnlyChip.ts` maps the chip label to `studio.cellEditor.readOnly.connectionLost.label` and
  the title to `studio.common.connectionLost.tooltip`.
- **Reads while stale stay as is.** Pager, filter, sort and count issue reads that fail as
  disconnected, keep the page, and revert the pager. Refresh already reconnects. A read never
  updates data.
- **No backend guard.** `Mutate` already refuses when the connection is down. The leftover case
  is old-session data over a live adapter. The frontend closes it synchronously: every write
  checks `isStale` in the tick that sends the request. A server-side check would need the
  router's adapter epoch on the wire (`MutateRequestWire`) for a race the click path already
  rules out.
- **Library rules.** No new dependency. Pinia for the new state, shadcn-vue
  `Alert`/`AlertAction`/`Button`, Tailwind only, no `<style>`. VueUse and TanStack Query do not
  apply (no DOM wiring, no new bridge fetch).

## SQL data view (this part's view)

Grid write paths (CodeGraph audit):
- `SlickGridHost.vue`:
  - `isWritable()` (`:255`) feeds `canEditTable()` (`:284`) and `canDeleteRows()` (`:293`).
  - Those gate the `editable` option (watch, `:2387`), paste (`:1820`), the cell and row menus
    (Paste, Set NULL, Duplicate row, Delete row), and the dock's `onEdit`/`onRevert`
    (`:2455-2540`).
  - Insert-row inputs are plain DOM (`:211`, `:2391`).
- `DataToolbar.vue:63`: `isWritable` gates Add row, Delete rows and Generate (`:166`).
- `DataView.vue`: Preview command, Discard, Commit (`:279-300`); `onCommit` (`:115`);
  `onGenerateData` (`:153`).
- `GenerateDataDialog.vue:177`: `onGenerate` calls `data.mutate` directly.

Decisions:
- An open inline edit at the drop gets staged, which is local only. The editor then closes.
  `setOptions({editable:false})` runs SlickGrid's `prepareForOptionsChange` and
  `commitCurrentEdit()` (`slick.grid.ts:1380`, slickgrid 5.20.0), which reaches `stageEdit`.
- Staged changes survive the drop and are primary-key keyed. Commit re-enables after the
  reconnect reload.
- Discard and Revert row stay available: they drop only local staging.

## Changes

1. **`views/shared/useConnectionGate.ts`**: export `tabNeedsReconnect(tabId, connectionId)`.
   `needsReconnect` calls it, and the §8.4 comment moves onto it.
2. **`state/staleData.ts`** (new): `useStaleDataStore` per Design. It reads
   `useConnectionsStore().states` and calls `tabNeedsReconnect`. Its state is a `reactive` record.
3. **`state/tabs.ts`**: add `KEEPS_DATA_ON_DROP` and the conditional drop. Update the comment at
   `:184-191`.
4. **`views/shared/StaleDataStrip.vue`** (new), per Design.
5. **`views/shared/writeGate.ts`**: add the `stale` parameter.
6. **`state/cellSelection.ts`**, **`views/shared/celleditor/state.ts`**,
   **`views/shared/celleditor/readOnlyChip.ts`**: the dock reason, per Design.
7. **`views/grid/state.ts`**: in `load()` `apply`, after `setPage`, call
   `useStaleDataStore().stamp(tabId, tab.connectionId)`. Add store method
   `isStale(tabId)` as `useStaleDataStore().isStale(tabId, tabId, tab.connectionId)`, returning
   false when there is no tab or `connectionId`.
8. **`views/grid/DataView.vue`**:
   - Add `stale = computed(() => gridViewStore.isStale(tab.id))`.
   - Add `hasPage = computed(() => { void pageVersion.n; return !!getPage(tab.id); })`.
   - The `EmptyState` condition becomes `needsReconnect && !hasPage`.
   - First in the `v-else`, add
     `<StaleDataStrip v-if="stale" testid="grid-stale" :reconnecting="reconnecting" @reconnect="onReconnectAndLoad" />`.
   - Add `effectivelyWritable &&= !stale`.
   - Preview and Commit get `:disabled` plus `|| stale`, with the label
     `studio.common.connectionLost.tooltip` when stale. Commit's `aria-label` stays
     `studio.grid.commitPending.label`.
   - Discard: `:disabled="committing || (!isWritable && !stale)"`.
   - `onCommit` returns early when stale, before `flushOpenEdit`. `onGenerateData` returns early
     when stale.
9. **`views/grid/DataToolbar.vue`**:
    - `isWritable` and `canGenerateData` get `&& !stale`.
    - `addRowTooltip`, `deleteRowTooltip` and `generateDataTooltip` return the connection-lost
      tooltip first after their "can" branch.
10. **`views/grid/SlickGridHost.vue`**:
    - `isWritable()`: `&& !gridViewStore.isStale(props.tabId)`. Update the lockout comment
      (`:277-283`).
    - Insert inputs: the formatter (`:211`) and the watch (`:2391`) use
      `committing || stale`.
    - The publication watch (`:2462`) gets the stale source. Publish `stale` on `SelectedCell`.
11. **`workbench/GenerateDataDialog.vue`**: submit `:disabled` and the `onGenerate` early return
    get `|| gridViewStore.isStale(tab.id)`.
12. **`packages/theme/src/i18n/en.json`**: new keys.
    - `studio.common.connectionLost.description`: "Connection lost — the data shown was fetched
      earlier and is read-only until you reconnect."
    - `studio.common.connectionLost.tooltip`: "Connection lost. Reconnect to edit"
    - `studio.cellEditor.readOnly.connectionLost.label`: "Connection lost"
13. **`docs/ARCHITECTURE.md`**: one line next to `:1036-1037`. A view with shown data keeps it on
    a connection drop or session change, read-only behind `StaleDataStrip`. Name the
    `useStaleDataStore` and `KEEPS_DATA_ON_DROP` mechanism, and list the kinds covered so far
    (Parts 2 and 3 extend the line).

## Tests

- **Backend flow test: none.** There is no backend change, and `Mutate`'s `E_ENGINE_DOWN`
  refusal already exists. The IPC-split rule applies to behaviour on both sides.
- **Unit test: none.** `isStale` is a two-rule boolean, under the CLAUDE.md bar.
- **UI spec** `apps/kira-studio/tests/ui/grid-connection-drop.spec.ts`. Use the shape of
  `grid-commit-in-flight.spec.ts` (`compositePkConnectAndOpen`, `postgresConnectionSummary`)
  plus `connectionsDisconnectSnapshot` (`support/postgresFixture.ts:228`) and the tree menu item
  `menu-item-disconnect` (`tree.spec.ts:622`). Steps:
  1. Stage one edit, then open a second inline editor and type.
  2. Disconnect. Expect `grid-stale` visible and no `reconnect-panel`. Cells still show values.
     Pending count is 2.
  3. Click a cell: it selects, and the dock chip reads "Connection lost". Double-click opens no
     editor. Commit, Preview, Add row and Delete rows are disabled. Discard is enabled. The
     writable badge reads Read-only.
  4. Click `grid-stale-reconnect`: strip gone, Commit enabled, pending count still 2.
  5. The port log has no `DATA_OP.mutate` before step 4.

## Verification

1. `bun run typecheck` and `bun run lint` pass, with no `--no-verify`.
2. `bun run test:ui:studio -- grid-connection-drop data-view grid-commit-in-flight mask-preview cell-editor tree connection-paste-credentials fake-data copy-coverage`
   passes. Fix any spec that assumed the grid page drops on disconnect.
3. Grep checks for the orchestrator:
   - `useStaleDataStore` has callers in `grid/state.ts` and `staleData.ts`.
   - `StaleDataStrip` is used in `DataView.vue`.
   - `gridViewStore.isStale` appears in `DataView.vue`, `DataToolbar.vue`, `SlickGridHost.vue`
     and `GenerateDataDialog.vue`.
   - `KEEPS_DATA_ON_DROP` holds `'data'`.
   - No new `<style>` block, and no new variant in `packages/theme/src/components/ui/`.

## Result

(Implementer fills in.)
