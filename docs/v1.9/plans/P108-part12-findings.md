# P108 Part 12 — Studio shell, project tree and state stores review findings

Scope: Studio shell (`main.ts`, `App.vue`, `workbench/**` Studio-owned parts), `project/**`,
`state/**`, `shortcuts/CommandPalette.vue`, the shared tabs factory
`packages/workbench/src/state/createTabsStore.ts`, and the UI-test harness. Plan:
`P108-part12-studio-shell-state.md`. Review only; fixer applies each finding as its own commit.
Paths are relative to `apps/kira-studio/frontend/src/` unless they start with `apps/`, `docs/` or
`packages/`. Out of scope per plan: `SF/api/**`, `ST/ui/api-*`, `ST/unit/api-*` (P112), closed parts'
fixes, `@apply` style blocks, the five pre-rule unit specs, and `docs/ARCHITECTURE.md` Known open
items.

"Verified" means reproduced in a scratch bun replica that imports the real modules and the real
`pinia`/`queryClient` instances, with `control.*` stubbed. "Code-read" means traced through the
source only. Playwright repro was not used: UI project needs webkit (sandbox has Chromium only), and
`tests/ui/support/mockRuntime.ts` answers each channel with one static response, so no ordering race
can be staged there.

Severity count: 2 High, 4 Medium, 12 Low.

Unit suite at `1e9a94e`: `bun test apps/kira-studio/tests/unit/` gives 751 pass, 0 fail, 11123
expects, 93 files. Part 11's two deferred failures (`grpc-schema-supersession`, `bridge-unwrap`)
are closed by P112's `5677487` and `a8d1998`.

## F1 (High) — Remote DDL change never reaches another window

Sites:
- `state/schemas.ts:41-44` (`queryFn` returns `queryClient.getQueryData(key) ?? ddl`)
- `state/schemas.ts:153-158` (`applyRemote` only calls `invalidateQueries`)
- `state/schemas.ts:166-184` (`initSchemaSync`)

Bug: the queryFn guards an in-flight local save by preferring the cached value over the fetched
one. Cache is always populated once any observer ran, so a refetch from `invalidateQueries` hands
back the pre-change value. Remote invalidation is dead.

Reachable (verified): cache holds `create table old`; `onSchemaChanged` push carries the new DDL.
After the push and refetch, the active observer, `getQueryData` and `ensureDdl` all still return
`create table old`. In app: window A saves the Schema dialog. Window B's console completion, lint
and hover stay on the old DDL for the session. B's Schema dialog opens with the old text; saving
it overwrites A's newer document.

Fix:
- `applyRemote`: `queryClient.setQueryData(schemaQueryKey(id), ddl.ddl)`; the push already carries
  the DDL, so no refetch is needed.
- Keep the in-flight-save protection with a per-connection local write generation, not by
  preferring cache: queryFn returns the fetched value unless a local `saveDdl` started during the
  fetch.

## F2 (High) — DB MCP approval queue swap leaves focus on Approve

Sites:
- `workbench/DbMcpApprovalDialog.vue:37-51` (`watch(() => pending !== null)` focuses Deny only on
  null to non-null)
- `workbench/DbMcpApprovalDialog.vue:87`, `:92` (`onApprove`/`onDeny` read `pending?.requestId` at
  click time)
- `workbench/DbMcpApprovalDialog.vue:98` (`<Dialog v-if="pending">`, one instance for the queue)

Bug: request A approved while B is queued. `pending` swaps A to B without passing through null, so
the dialog stays mounted, the watch does not fire, and focus stays on Approve. A second Enter (or
key repeat) approves B before the user reads it. Separately, the click handler reads the id at click
time: if A expires Go-side and B swaps in under the pointer, the click lands on B.

Reachable (verified at store level): with A then B pending, answering A leaves the Deny-focus
watcher run count at 1 across the A to B swap. Go side stays safe for late answers (id-keyed,
idempotent), and the statement renders as text, so the gap is only this client-side swap.

Fix:
- Key the dialog body by `pending.requestId` so each request remounts and refocuses Deny.
- Bind the rendered request id to the buttons; approve/deny that id, not whatever is pending at
  click time.
- Optional: disable Approve for a short arm delay after a swap.

Minor, same file family (code-read): `state/dbmcp.ts` approve/deny apply the returned snapshot
unconditionally. A broadcast that arrived first with a newer queue is overwritten by the older
snapshot; the hidden request reappears only on the next change. Apply only if not older (sequence
or compare), or ignore the returned snapshot and rely on the broadcast.

## F3 (Medium) — Schema and column sync subscribe only while ProjectTree is mounted

Sites:
- `project/ProjectTree.vue:57-61` (sole callers of `initTreeSync`, `initSchemaSync`,
  `initSchemaColumnsSync`, inside `onMounted`)
- `workbench/panels/ProjectPanel.vue` (`<ProjectTree/>` only when connections exist)
- `workbench/WorkbenchShell.vue:137` (`v-if="projectVisible"`), `workbench/modes.ts` (panel is
  Studio only)
- `main.ts:291-349` (`initApiDataSync()` runs in `bootstrap()`, the precedent)

Bug: the `onSchemaChanged` and `onConnectionMetadataInvalidated` subscriptions that keep the DDL
cache and `schemaColumns` fresh are wired from a component. Window booted in API/Terminal mode, with
the project panel hidden, or with zero connections at boot gets none.

Reachable (verified): no ProjectTree mount, 0 subscribers. Reconnect push plus console remount:
cache still shows `orders_v1`, fetch count stays 1. Completion, lint and hover serve stale columns
for the session. Deleted-connection DDL cache cleanup also never runs (leak). Tree-side subscriptions
matter less, since tree state exists only once mounted.

Fix: call all three `init*Sync` from `bootstrap()` beside `initApiDataSync()`. Make each idempotent
if not already, and drop the `onMounted` calls.

## F4 (Medium) — Credential reveal writes connection A's password into another draft

Sites:
- `project/ConnectionDialog.vue:108` (`draft = computed(() => connectionDialogStore.draft)`)
- `project/ConnectionDialog.vue:282-305` (`requestReveal`: `await control.connectionsReveal(...)`
  then `draft.value.password = result.password`, `revealed`/`showPassword` true)
- `state/connections.ts:190-265` (`openCreateDialog`/`openEditDialog` `Object.assign` a new draft in
  place; `saveDialog` sends a non-null password as an update)

Bug: nothing checks that the draft after the await is the one the reveal was requested for.

Reachable (verified: a stopped Vue 3.5 computed still returns the store's current draft;
reachability code-read). Edit A, press reveal. While the OS auth prompt or the confirm dialog is up,
the menu-bar New Connection (or close then Edit B) replaces the draft. Reveal resolves and sets A's
secret on the new draft. Save then stores A's password on B. When the draft is replaced in place,
the component's `revealed`/`showPassword` stay true, so A's secret shows in plain text in B's form.

Fix: capture `const target = draft.value` and the connection id before any await (including the
confirm). After each await, bail unless `connectionDialogStore.draft === target` and the editing id
still matches. Reset `revealed`/`showPassword` when the draft identity changes.

## F5 (Medium) — Mounted console loses cached columns on every reconnect or tree Refresh

Sites:
- `state/schemaColumns.ts:189-198` (`dropSchemaColumns` on invalidation)
- `state/schemaColumns.ts:46` (comment claims the store self-warms)
- `views/console/ConsoleView.vue:158-164` (`watch([connectionId, containerPath], ensureSchemaColumns,
  {immediate: true})`, the only trigger)

Bug: invalidation drops the entry, but the watch keys are unchanged, so nothing refetches.

Reachable (verified): after the drop, `cachedRelationsFor` returns `[]` with 0 refetches. Completion
stays empty until a tab switch remounts the view (`MainView.vue` keys by tab id, no KeepAlive).

Fix: include entry presence (`byContainer[key]` absent) in the watch source, or have the store bump
a per-key generation that the watch reads.

## F6 (Medium) — `ensureSchemaColumns` memoizes a transient failure as `[]`

Sites:
- `state/schemaColumns.ts:130-150` (catch at `:137` stores `[]` in `byContainer[key]`)
- `apps/kira-studio/internal/tree/service.go` (`SchemaColumns` returns `ipcerr.Disconnected` on a
  cache miss while disconnected)

Bug: a failed load is cached as an empty success, so the `:132` early return blocks every retry.

Reachable (verified: retry calls 0 after a rejected first load). A console restored for a not yet
connected connection loads first, gets `Disconnected`, and stores `[]`. With F5 and F3, completion
stays dead until a remount after connect, or for the session when unsubscribed.

Fix: on error, leave `byContainer[key]` unset (release `pendingLoads` only). Let the next watch
trigger or the connect push retry.

## F7 (Low) — `hydrateOps` gap leaves a phantom running op

Sites: `state/ops.ts:19-39` (awaits `opsRecent(200)`, then subscribes `onOpUpdate`),
`state/runState.ts` (200ms ticker while any record is running).

Bug: an op in the snapshot as `running` that finishes between the snapshot and the subscribe never
gets its final update.

Reachable (verified): record stays `status: running`, `runningCount` 1. Real trigger: second window
boots while another window's op is in flight. Operations panel shows a running row forever and the
ticker never stops. Crash-orphaned rows are not affected (Go `ReconcileInterrupted`).

Fix: subscribe first and buffer updates, then snapshot, then apply the buffer by id over the
snapshot.

## F8 (Low) — `ensureSchemaColumns` has no generation guard

Site: `state/schemaColumns.ts:130-150`.

Bug: a fetch in flight across `dropSchemaColumns` writes its old result back after the drop.

Reachable (verified): old columns (`old_table`) land after the drop; the next ensure is a no-op with
0 fetches. Needs a reconnect or Refresh during a slow column load.

Fix: per-connection generation captured before the await, bumped by `dropSchemaColumns`; skip the
write when it changed.

## F9 (Low) — Tree `loadChildren` resolving after disconnect writes a stale entry

Sites: `project/state/tree.ts:141-157` (writes `children[k]` after the await unconditionally),
`:176-195` (`expand` returns early when `children[k]` exists, D25), `:315-335`
(`dropConnectionState`).

Bug: a load in flight across disconnect/drop writes back after the drop.

Reachable (verified): stale `old_db` stays cached and `knownConnectionIds` keeps `c2`. After
reconnect, `expand` shows the stale children with 0 fetches, since the invalidation push fired
before `expanded.add`.

Fix: per-connection epoch bumped by `dropConnectionState`; skip the write when it changed.

## F10 (Low) — Collapse during connect is undone by `expand`

Site: `project/state/tree.ts:176-195` (`expanded.add` after the connect await).

Bug: user collapses the node while connect is pending; `expand` adds it back when connect resolves.

Reachable (verified): `expanded` true after collapse-then-connect.

Fix: record an expand intent token before the await; skip `expanded.add` if a collapse cleared it.

## F11 (Low) — Tree load races and context-menu rejection

Sites: `project/state/tree.ts:141-157` (`loadChildren`), `:159-162` (`loadVisibility`),
`project/ProjectTree.vue:133-138` (`onContextMenu`).

Bug:
- `loadChildren` has no per-key sequencing. Overlapping calls clear the spinner early, and the last
  response to arrive wins, not the last issued.
- `loadVisibility` has no dedupe and can overwrite a newer `saveVisibility` result.
- `onContextMenu` awaits `loadSavedQueries` with no catch. A `queriesList` rejection shows no menu
  and leaves an unhandled rejection.

Reachable (code-read). Go `queriesList` errors only on DB failure, so the last item is unlikely.

Fix: per-key request token for both loaders; catch in `onContextMenu` and open the menu without the
saved-query items.

## F12 (Low) — Concurrent tab saves can commit out of order

Sites:
- `packages/workbench/src/state/createTabsStore.ts:199-214` (`saveIfChanged`, fire-and-forget
  `tabsSave`), `:223-226` (`flushPendingTabState`, unconditional save)
- `state/tabs.ts` (incognito listener calls `actions.saveNow()`)
- `apps/kira-studio/internal/bridge/tabs.go:35`, `internal/appstorage/tabs.go:65` (`ReplaceKeyed`
  transaction, no ordering)
- Wails v3 `pkg/application/application.go:711` (`go a.handleWebViewRequest(request)`, one
  goroutine per call)

Bug: two saves in flight have no order guarantee Go-side. An older debounced save that commits
after the incognito-triggered save re-persists the incognito tab's row. The same holds for the
close-time flush racing an in-flight save: last edits lost, or the incognito row survives restart.
`lastSavedSnapshot` can then differ from the DB, which suppresses the corrective save.

Reachable (code-read; Wails per-request goroutine dispatch confirmed in source).

Fix: serialize in the factory: one save in flight, coalesce to the latest snapshot, run it when the
current one settles. Flush awaits the chain.

## F13 (Low) — Boot has no error path; mode write not flushed on close

Sites: `main.ts:318-351` (`Promise.all` of hydrates, no catch, `void bootstrap()`), `state/mode.ts`
(150ms `useDebounceFn` write).

Bug: any hydrate rejection leaves a blank window with an unhandled rejection. Mode changed within
150ms of close is lost.

Reachable (code-read). No concrete hydrate trigger found; Go errors there are DB-only.

Fix: catch in `bootstrap()` and mount an error state; flush the mode debounce on `beforeunload`
(VueUse `useEventListener`).

## F14 (Low) — `hydrateTabs` keeps raw state when zod parse fails

Sites: `packages/workbench/src/state/createTabsStore.ts:231-256` (falls back to the raw record when
`parseState` returns null), `state/tabKinds.ts`/`tabDomain.ts` (`dataTabStateSchema` has no
defaults), `views/**/DataToolbar.vue:198` (`columnOrder !== null`).

Bug: a stored row missing a later field passes through unparsed. Grid computes `pageIndex *
pageSize` as NaN, and the toolbar treats `undefined` `columnOrder` as a custom order.

Reachable (code-read): any data-tab row saved before a field was added.

Fix: add `.default(...)` to the schema's later fields, and drop (or reset to defaults) a row that
still fails parse rather than keeping it raw.

## F15 (Low) — CommandPalette hides itself from assistive tech (carry-over, still open)

Site: `shortcuts/CommandPalette.vue:37-42`.

Bug: backdrop with `aria-hidden="true"` wraps the live palette. No `role="dialog"`, `aria-modal`,
focus trap or focus restore.

Reachable (code-read).

Fix: same as Part 10 F10. Move the palette out of the hidden subtree, or build it on the shadcn-vue
`Dialog` primitive, which supplies role, trap and restore.

## F16 (Low) — Operations panel re-run mishandles connect failure

Site: `workbench/panels/OperationsPanel.vue:149-169`, `:206` (`void onRerun(record)`),
`views/shared/useConnectionGate.ts:13-44`.

Bug: a rejected connect is unhandled. A connect that returns state `'error'` still runs
`markHydrated` and the re-run. `useConnectionGate` is called outside setup, so its two computeds
have no owning scope (negligible).

Reachable (code-read).

Fix: check the returned state before `markHydrated`/run, and catch with a toast. Hoist the gate to
setup or take its logic as a plain function.

## F17 (Low) — ConnectionDialog Test result shows as current after an edit

Site: `project/ConnectionDialog.vue:266-277` (`onTest`).

Bug: a Test response arriving after the user edited a field is shown as the result for the current
fields.

Reachable (code-read). Go `Test` never rejects, so only the staleness applies.

Fix: capture a draft snapshot or edit counter before the await; discard the result if it changed.

## F18 (Low) — Mask rules go stale in other windows (candidate #8, carry-over)

Site: `state/maskRules.ts` (`setQueryData` on local write; no Go broadcast for mask-rule changes).

Bug: other windows' Privacy tab, grid mask preview and Settings counts stay stale until refetch.

Reachable (code-read). Not a data exposure: MCP render reads `MaskSetFor` from the DB on every call
(`internal/dbmcp/tools.go:191`, `:493`), and the grid preview is documented as not a control
(`docs/ARCHITECTURE.md` §Masking M5).

Fix: emit a mask-rules-changed event Go-side and invalidate the query on it, same shape as
`onSchemaChanged`.

## Plan candidates

1. Sync init only from `ProjectTree` mount: confirmed, verified (F3). Failure mode is stale
   columns and DDL for the session, not a crash.
2. `hydrateOps` snapshot/subscribe gap: confirmed, verified (F7).
3. `ensureSchemaColumns` no generation guard, failure cached as empty: both confirmed, verified (F8,
   F6). Related, not flagged: mounted console never refetches after a drop (F5).
4. Incognito persistence and `hydrateTabs`: partial. Hook ordering on the client is safe
   (`setIncognito` updates ids before listeners fire, and `persistable` excludes the tab). The race
   lives Go-side: concurrent saves commit in any order (F12, code-read). `hydrateTabs` does pass
   unparsed state (F14, code-read). Close paths are fine: `closeTab`, `closeOthers`,
   `closeToTheRight`, `closeAll` and connection-deleted closes all fire `onClosed` and drop pages.
5. Boot fragility: partial. No-catch blank window confirmed (F13, code-read, no concrete trigger).
   Stale stored mode refuted: Go `NormalizeMode` (`internal/storage/model/window.go:42`) maps unknown
   modes such as `'git'` to `studio` before `hydrateMode` sees them.
6. DB MCP approval: partial. Focus-steal confirmed, verified, via queue swap (F2). Id collisions
   refuted (Go id-keyed). Escape, backdrop and X all deny. Late Approve after Go-side timeout is safe
   Go-side (idempotent, id-keyed); the client-side id-at-click-time swap is part of F2.
7. Project tree: confirmed. Overlapping `loadChildren` (F11, code-read) plus post-drop write-back
   (F9, verified); collapse during connect undone (F10, verified); failed saved-queries fetch
   blocks the menu (F11, code-read, unlikely trigger).
8. `maskRules` cross-window: partial (F18). Staleness real; data-exposure risk refuted, since the
   MCP path reads rules from the DB per call and the grid preview is not a control.

Not flagged, checked clean: CommandPalette filter matches the item label text (theme
`CommandItem.vue:46`), not `:value`.

## Carry-over resolutions

- `CommandPalette.vue:41` backdrop `aria-hidden`: still open, F15.
- Connection-dialog reveal path: F4. Connection half of `credential-reveal`/`secrets` specs:
  `tests/ui/credential-reveal.spec.ts` has 5 tests, none for a draft swap during reveal; the fixer
  adds that case with F4.
- `state/**` beyond the wire seam: reviewed `schemas`, `schemaColumns`, `ops`, `runState`, `tabs`,
  `tabIncognito`, `dbmcp`, `maskRules`, `connections`, `mode`. Findings F1, F3, F5-F8, F12-F14, F18.
  Not reviewed this pass: `viewCommands.ts` `pendingGuards`/`staleMarkers` registration and
  `cellSelection.ts` publishers.
- `maskRules` cross-window staleness: F18.
