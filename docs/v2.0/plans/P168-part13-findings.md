# P168 Part 13 findings: Studio shell, project tree, state stores, UI-test harness

Plan: `P168-part13-studio-shell.md`. Base `844e132`; HEAD reviewed `62c0fdb` (`p168-stream-c`).
Reviewer reports only; fixes nothing. Each finding: severity, `file:line` (at `62c0fdb`), scenario,
fix, "verified" (scratch probe or run) or "code-read".

## Checks (reviewer baseline, `62c0fdb`)

- `bun test` over the 9 own unit specs together: 29 pass, 0 fail. `tabs-save-serialized`,
  `tree-state`, `run-state` alone: green.
- `typecheck:web:studio`, `typecheck:tests:studio`, `typecheck:unit:studio`: clean.
- `bunx biome check` over own dirs (287 files): clean.
- Machine shared with other agents (Go lint/builds seen; load average 13-16 at start).

## Block 1: state stores and shared domain

### F1 (low, routed Part 4 F20, must fix): `caps.ts` capability table contradicts Go

- `packages/shared/caps.ts:119-135`. Table rows disagree with `SI/adapters/*/caps.go`, the source
  of truth (`SI/adapters/caps.go:17`):
  - exactCount: redis "no (DBSIZE)" vs Go `true`; kafka "yes (end-begin)" vs Go `false`
    (`kafka/caps.go:30`); s3 "no" vs Go `true`.
  - definition: kafka and sqs "no" vs Go `true`; redis "no" matches.
  - cancel mechanism: sqlite "none" vs Go `Cancel: true` (`sqlite/caps.go:7`); redis/s3/sqs
    mechanisms describe the deleted TypeScript engine (AbortSignal, CLIENT KILL).
  - tree levels: redis and s3 list key namespaces/prefixes; P41 `keyBrowser` stops the tree at the
    container (`caps.ts:28-31` says so itself). Mongo "(+ indexes)" vs P19 D5 collection leaf.
  - "Only the postgres row is implemented in P1" is stale: all ten kinds ship.
- Redis `Cancel: true` vs `Cancel()` returning `false` (`redis/adapter.go:323`): not a caps lie.
  Go defines the flag as "a cancel stops the op" (ctx + `CheckCancelled` between SCAN rounds,
  `redis/caps.go:9-10`; kafka the same, `kafka/adapter.go:255`). No consumer reads `caps.cancel`
  in Go or the renderer (git grep), nor `caps.exactCount` in the renderer. No routed Part 3/4 item.
  But `caps.ts:74`'s comment ("can forward a cancel to the server") is the old meaning.
- `capsSchema` field set and order match Go `Caps` (23 fields, verified by read).
- Kafka's inexact count reaches the UI through `CountResponse.exact` (`read.go:603` returns
  `Exact: false`); `StreamView.vue:290` prints `~`. Two stale comments remain:
  `views/stream/StreamView.vue:282` cites "kafka.spec.ts's exact-count assertion" (no kafka spec
  reads `stream-status`; only `sqs.frontend.spec.ts:129` does), and Go `kafka/read.go:572` says
  "exact via high/low watermark subtraction" above code returning `Exact: false`.
  `kafka.frontend.spec.ts` asserts no count (git grep): nothing to route there.
- Fix: replace the table with a short pointer ("per-engine values: `SI/adapters/<kind>/caps.go`";
  keep only facts Go cannot state, or nothing). Reword `caps.ts:74` to "a cancel stops the
  in-flight op (server-side or by ctx)". Drop the kafka clause from `StreamView.vue:282` (Part 12
  file, Stream C may edit; state why). Route the Go comment.
  `needs-other-part-file: apps/kira-studio/internal/adapters/kafka/read.go (Part 4)`.
- Code-read (Go values by grep of every `caps.go`).

### F2 (low): browse preview viewKey escapes the tab lifecycle (disconnect and close)

- `state/tabs.ts:146-150` (`onClosed`), `:183-190` (disconnect), `state/tabKinds.ts:216`
  (`browse.dropResources: noDrop`).
- The browse split's preview pane keys its page and its selected cell under
  `${tabId}::preview` (`BrowseView.vue:155`, `KeyValuePane.vue:564`).
  - Disconnect: `dropPageStoresForTab(tabId)` calls each kind's dropper with the real tab id; the
    keyvalue store's `drop(tabId)` misses `${tabId}::preview`. The close-only hook
    (`views/shared/keyvalue/page.ts:19`) does not run on disconnect. The preview page's bytes
    outlive the disconnect, against D13 ("page bytes are freed"). Scenario: preview a 4 MB s3
    object, Disconnect; the page stays retained until the tab closes or reloads.
  - Close: `onClosed` clears `selectedCellFor(tabId)`, not `${tabId}::preview`. `KeyValuePane`'s
    own clear (`:405`) runs only on a page change, and the pane unmounts with the tab. The
    published `SelectedCell` (value up to `MAX_CELL_BYTES`, plus `onEdit`/`onRevert` closures over
    the unmounted component's refs for an s3 Body row) stays in `cellSelection.byTab` forever.
    One entry per closed browse tab that had a row selected.
- Fix: browse `dropResources: (id) => dropKeyValuePagesForTab(`${id}::preview`)` (runs on close and
  disconnect, since `dropPageStoresForTab` calls every kind's dropper), and in `onClosed` also
  `clearSelectedCellFor(`${tabId}::preview`)`. Keep the `page.ts:19` hook or drop it as redundant.
- Code-read.

### F3 (medium): `parseConnectionUri` returns the database percent-encoded

- `packages/shared/domain/uri.ts:18`. `url.pathname.slice(1)` is never decoded; username and
  password are (`:26-27`). `formatConnectionUri` (`:42`) sets `url.pathname`, which encodes space,
  `#`, `?` and non-ASCII.
- Verified (scratch probe, `bun`): database `my db` -> `postgresql://u@h:5432/my%20db` -> parsed
  `my%20db`; `a#b` -> `a%23b`; `café` -> `caf%C3%A9`. `sqlite:////Users/me/Application
  Support/x.db` -> `/Users/me/Application%20Support/x.db` and `canRoundTripToFields` says `true`.
- Scenario: an sqlite connection in URI mode with a macOS path under `Application Support`. User
  clicks Fields (`ConnectionDialog.vue:189-201`); `d.database` becomes the `%20` path; Save stores
  a path that does not exist, so Connect fails. Same for a postgres database name with a space.
  Fields -> URI -> Fields also turns `my db` into `my%20db`. The URI note (`:167-170`) shows the
  encoded name.
- Also: `formatConnectionUri` (`:43-45`) drops non-string `options` values (verified: `{tls: true,
  connectTimeout: 5}` vanish). `options` is `z.record(z.string(), z.unknown())`
  (`SD/connection.ts:94`); "Copy URI" (`project/menus.ts:130`) and the Fields -> URI switch lose
  them. Code-read on whether any writer stores a non-string option today.
- Fix: `decodeURIComponent` the database (catch a malformed escape: return null so the dialog stays
  in URI mode); `String(value)` for number/boolean options. Add one unit spec beside
  `mongo-srv-uri.spec.ts`: format/parse round trip for space, `#`, non-ASCII and the sqlite path
  (a format round trip with edge cases qualifies under the test bar).

### F4 (low): `maskRules.ts` correlation-key cache races a regenerate and never drops a deleted connection

- `state/maskRules.ts:96-103`, `:70-73`, `:140-143`.
- `correlationKeyFor` has no in-flight guard: a fetch started before `regenerateMaskKey`'s Go call
  finishes can resolve after its `delete correlationKeys[id]` and write the old key back. The grid
  preview then tags values with a key Go no longer uses until the next regenerate or reload.
  Narrow window (a Privacy-tab regenerate while a preview on the same connection fetches its key).
- No cleanup on connection delete: `correlationKeys[id]`, `['maskRules', id]` and the counts entry
  stay. `schemas.ts:329-346` already does this cleanup for its own cache on `onConnectionsChanged`.
- `hexToBytes` odd-length suspect: dropped. Go always sends `hex.EncodeToString`
  (`SI/maskrules/service.go:205`).
- Fix: a per-connection generation counter bumped by `regenerateMaskKey` and `applyRemote`'s
  `keyRegenerated`; `correlationKeyFor` writes only when the generation it captured still holds.
  In `initMaskRulesSync`, subscribe `onConnectionsChanged` and remove the three entries for ids no
  longer live.
- Code-read.

### Block 1: checked, nothing to report

- `tabs.ts` save path: every structural action calls `saveNow`; `patchTabState` debounces;
  `enqueueSave` coalesces and serialises (Part 9 contract, read). `persistable` drops incognito
  and terminal. Close-time flush: `onFlushBeforeClose`/`onWindowFlushBeforeClose`.
  `useRecentTablesStore` is its own store in the same file: fine under one-store-one-concern.
- `tabDomain.ts`: every later field carries `.default(...)`; base fields (`console.text`,
  `document.expanded/search`, `keyvalue.pageIndex`) were in the first schema. A kind dropped from
  `TAB_KINDS` keeps its raw row (`createTabsStore.ts:265`); `TAB_KINDS` is total over
  `StudioTabKind`.
- `duplicateState` carries no ids or op handles (request kinds clear `itemId`).
- Terminal `dropResources` blind-called on every tab id: guarded (`createTerminalsStore.ts:204`).
- Incognito: flag cleared on close (`tabIncognito.ts:43`), duplicate inherits, toggle saves.
- `schemaColumns.ts`: generation guard, no `[]` memo, sync idempotent. `schemas.ts`: write
  generation, deleted-connection cleanup. `runState.ts`, `cellSelection.ts` (apart from F2),
  `viewCommands.ts`, `objectStore.ts`, `datagripImport.ts`, `dbmcp.ts` (broadcast-only, P108 F2),
  `customScripts.ts`, `settings.ts`, `mode.ts`, the thin factory wrappers: no defect.
- `settingsDomain.ts` defaults equal Go `model.DefaultSettings()` and ranges equal Go validators
  (`SI/storage/model/settings.go:73-97`, `:171-180`).
- `SD/{mode,tree-filter,secrets,datagrip}.ts`: types match their Go mirrors' JSON (read).
- TanStack Query rule: `customScripts`/`dbmcp`/`datagripImport`/`objectStore` are push-updated or
  command-shaped (no cached fetch with loading/error state to own); `schemas` and `maskRules`
  already use `queryClient`. No migration finding.

## Block 2: shell, workbench, settings, shortcuts, theme

### F5 (medium): DataGrip scan failure is silent

- `state/datagripImport.ts:321-338`, `App.vue:78-81`, `workbench/panels/StudioStart.vue:80-89`,
  `project/DataGripImportDialog.vue:174`.
- `scanDataGripProject` sets `state.error` on a rejected `datagripScan` and returns `false`, but
  `state.open` flips only on success. The only render of `error` is the Alert inside the dialog,
  which is `v-if="datagripImportStore.open"` (`App.vue:111`). A rejected `filesChooseFolder` is a
  floating rejection (`void` at both call sites).
- Scenario: menu Import from DataGrip, pick a folder that is not a DataGrip project (no
  `.idea/dataSources.xml`) or is unreadable. Go rejects the scan; nothing appears. The user cannot
  tell a failed scan from a cancelled picker. `datagrip-import.spec.ts` has no failed-scan case.
- Fix: open the dialog on scan failure too (`state.open = true`, `preview = null`) and let it render
  the Alert plus a "Choose another folder" action when `preview` is null; catch the picker
  rejection into `state.error` the same way. Guard re-entry with `busy` (StudioStart's button has
  no busy state, so a double click opens two pickers). Add the failed-scan case to
  `datagrip-import.spec.ts`.
- Code-read.

### F6 (medium): Settings numeric fields turn an empty field into `0` and accept fractions

- `workbench/settings/ApiPane.vue:26-31,38-40,45-73`, `CachePane.vue:21-33`,
  `AdvancedPane.vue:18-44`.
- Every handler writes `Number(input.value)`. A cleared `type="number"` input (or one holding text
  the browser rejects) has `value === ''`, and `Number('') === 0`, not `NaN`, so the
  `Number.isFinite` guard never fires. For `requestTimeoutMs` (0 = no timeout), `maxResponseMb`
  (0 = unlimited) and `maxRedirects`, 0 is in range: Save succeeds and silently writes a different
  setting. For `l2BudgetMb`/`opLogRetentionDays`/`expensiveQueryRows` the user sees a range error
  ("8–1024 MB") instead of "Enter a number".
- Fractions: `1.5` passes every renderer check; Go decodes the leaf into `*int`
  (`SI/storage/model/settings.go:109-123`), so Save fails with a raw JSON decode message in the
  footer instead of a field error.
- Scenario: user selects the Max response size text to retype it, clicks Save before typing (or
  types a letter WebKit drops): the 5 MB cap P160 added to stop viewer freezes becomes unlimited.
- Fix: one own helper (e.g. `settings/types.ts` `parseIntField(raw): number` returning `NaN` for
  `''` or a non-integer) used by the six handlers; validators check `Number.isInteger(v)` with
  "Enter a whole number." Extend `settings-apply-on-save.spec.ts` with the cleared-field case.
- Verified (scratch Playwright probe): Settings, Api, clear Max response size. No field error, Save
  enabled; Save sends `{"patch":{"api":{"maxResponseMb":0}}}` (unlimited).

### F7 (low): Settings footer names the wrong database file

- `workbench/SettingsDialog.vue:115` prints `~/.kira-studio/kira.sqlite`. Go stores `kira.db`
  (`SI/config/paths.go:16-24`, which says a `kira.sqlite` mention "is the doc drifting") and
  honours `KIRA_HOME`.
- Fix: change the literal to `kira.db`; better, show `config.DbPath()` from an existing control
  call if one exposes it (none found; a new bridge field would be Part 5/6, so keep the literal).
  All 7 `ST/visual/settings.spec.ts` snapshots capture the whole dialog, footer included, so each
  changes. They cannot be regenerated in this sandbox (`docs/DEV_ENVIRONMENT.md` font drift): the
  fixer records the baseline update as a follow-up for a machine that can run
  `test:visual:update:studio`.
- Also stale: `state/settingsDomain.ts:138` "an older kira.sqlite".
- Code-read.

### F8 (low): Operations panel "Reveal originating tab" does nothing from another mode

- `workbench/panels/OperationsPanel.vue` `revealTab` (`activateTab` only). The dock shows every
  mode's ops; `activateTab` sets the tab active in its own workspace but never switches
  `modeStore.active`.
- Scenario: in Api mode, the op log lists a Studio data-tab query; Reveal activates it inside the
  hidden Studio workspace. Nothing visible changes.
- Fix: `modeStore.setMode(workspaceKeyOf(tab))` before `activateTab` (both already exported from
  `state/mode.ts`). Same check for the terminal workspace.
- Code-read.

### F9 (low): instant-action settings report no failure

- `workbench/settings/DatabaseMcpPane.vue` (`onToggleDbMcpEnabled`, `onRegenerateDbMcpToken`,
  `onInstallDbMcpClaudeCode`, `onToggleConnectionMcpEnabled`), `ClaudeCodePane.vue`
  (`onToggleKeepAwakeAgentAware`). `useBusyAction` (`PW/util/useBusyAction.ts`) has no catch; the
  template calls drop the promise.
- Scenario: `dbMcpSetEnabled` rejects (port in use, DB busy). The checkbox snaps back to the store
  value; the only trace is an unhandled rejection in the webview console. Same for the per-connection
  MCP checkbox and the keep-awake leaf.
- Fix: catch in each pane into a local `actionError` ref rendered with `FieldError` (the pane
  already has the slot pattern), cleared on the next attempt.
- Code-read.

### F10 (low): native controls where a shadcn-vue primitive exists

- `workbench/GenerateDataDialog.vue:333` and `project/FiltersDialog.vue:180-181,210-211`: link-style
  `<button>`s restyled by hand; `Button variant="link"` exists (`PT/components/ui/button`).
- `project/ConnectionDialog.vue:684`: hand-built radio cards over a hidden `<input type="radio">`;
  `PT/components/ui/radio-group` exists (reka `RadioGroupItem` supports `as-child` cards).
- Kept as fine: `StudioStart.vue:104` recent-table rows, `ErrorPopover.vue:76` trigger,
  `FiltersDialog.vue:232` tree twisty (list-row semantics, no primitive fits).
- Fix: swap the four link buttons to `Button variant="link" size="..."`; the radio cards to
  `RadioGroup`, keeping `data-testid="connection-kind-<kind>"` on the item.
- Code-read.

### F11 (low): comments that now state wrong facts

- `fonts.ts:64` "CodeMirror editor" (Monaco since P60b).
- `theme/icons.ts:44-48`: cites `engine/adapters/*/read.ts` and `packages/db-fixtures/*.spec.ts`,
  both deleted (Go adapters' `typeClassFor` and `SI/adapters/*/*_test.go` now).
  `theme/icons.ts:196` "CodeMirror's own VS Code Dark Modern syntax colours".
- `state/schemaColumns.ts:177-178` "lang-sql's schemaCompletionSource" (lang-sql removed).
- Fix: reword each to the current fact.
- Code-read.

### Block 2: checked, nothing to report

- `mountShell` retry (`PW/bootstrapShell.ts`): every `init*`/`hydrate*` is idempotent
  (unsubscribe-then-resubscribe or an `if (unsubscribe) return` guard); `hydrateOps` buffers
  before its snapshot (P108 F7). No hydrate in the `Promise.all` needs another's result except a
  corrupt-row reset reading `defaultPageSize` before settings land (falls back to 100; harmless).
- `__KIRA_DEBUG_HOOKS__`: every `window.__kira*` assignment sits inside the gate (`main.ts:247-292`).
- `App.vue` subscriptions released in `onUnmounted`; `closeActiveTab` on a pinned kind is guarded in
  `closeTabInternal`; no Studio kind is pinned.
- `TAB_VIEWS`/`TAB_KINDS`/`MODES` total over their unions (typed records).
- `StatusBar.vue`: no dead store reads after P164.
- `DbMcpApprovalDialog.vue`: the header X fires `denyQuery` twice (button click plus
  `DialogClose` -> `update:open`); Go `Deny` on a resolved id is a no-op
  (`SI/dbmcp/approval.go:181-193`). Harmless, not reported.
- `EngineIcon.vue` covers all 10 `ConnectionKind`s; `shortcuts/state.ts` commands all reachable.
- One `<script setup lang="ts">` per own `.vue` file (grep); no `<TooltipTrigger>` wraps a
  disabled control without `TooltipDisabledTrigger`.

## Block 3: project tree and connection management

### F12 (high): Filters dialog can overwrite saved tree filters with an empty set

- `project/FiltersDialog.vue:48-66` (seed), `:129-134` (`onSave`); `project/state/tree.ts:201-217`
  (`loadVisibility` is private, called only from `expand`); `project/menus.ts:139,263`.
- The dialog seeds its draft from `treeStore.visibility[connectionId] ?? EMPTY_VISIBILITY`.
  `visibility[id]` is loaded only by `expand()`. "Filters…" is offered on every connection row and
  container row, connected or not, expanded or not. `onSave` calls `filtersReplace`, which
  replaces the whole persisted set (`saveVisibility`).
- Scenario: fresh launch; a connection whose saved filters hide `pg_catalog` and 40 paths. User
  right-clicks the (never expanded) connection, Filters…, sees an empty dialog (no cached nodes),
  clicks Save filters (or Cancel's neighbour by habit). The 40 hidden paths and hidden kinds are
  replaced by `{hiddenKinds: [], hiddenPaths: []}` in the DB. Data loss, no undo.
- Also `onSave` has no catch: a rejected `filtersReplace` leaves the dialog open with no message
  (unhandled rejection), after `saveVisibility` already bumped the generation.
- Fix: export `loadVisibility`; the dialog's `connectionId` watch awaits it before seeding the
  draft (disable Save and show a loading state until then; on a load failure show the error and
  keep Save disabled). Catch `onSave` into a dialog error line. A UI spec: `filtersList` returns a
  non-empty set, open Filters… without expanding, Save, assert the `filtersReplace` payload equals
  the loaded set.
- Verified (scratch Playwright probe in a scratch worktree, `ui` project): connection listed,
  `filtersList` would return `{hiddenKinds: ['sequence'], hiddenPaths: [<analytics schema>]}`;
  Filters… on the never-expanded connection, Save. `filtersList` calls: 0. `filtersReplace` sent
  `{"hiddenKinds":[],"hiddenPaths":[]}`.

### F13 (medium): Connection dialog Save has no in-flight guard

- `project/ConnectionDialog.vue:394-422` (`onSave`), `:1286-1294` (Save `:disabled="!isValid"`
  only); `state/connections.ts:246-262`.
- Scenario: create a connection, double-click Save (or press Save twice while the keychain prompt
  for the secret write is up). Two `connectionsCreate` calls run; both succeed; the tree shows two
  identical connections, each with its own encrypted secret row. Edit mode issues two
  `connectionsUpdate` calls (idempotent, so only create duplicates).
- Fix: a `saving` ref (or `useBusyAction`) set across `saveDialog()`; Save disabled while it is
  true. Test (`:1261`) has no gate either: two clicks race two `connectionsTest` calls; the snapshot check keeps the result honest, so only Save is a defect.
- Code-read.

### F14 (medium): switching Fields -> URI puts the typed password into a plain-text input

- `project/ConnectionDialog.vue:181-185` (`d.uri = formatConnectionUri(d)`),
  `:878-885` (URI `<Input>` has no `type="password"`), `packages/shared/domain/uri.ts:41`.
- `formatConnectionUri` embeds `draft.password` in the URI userinfo. The password field
  (`:858-865`) is masked and, in edit mode, gated behind local auth (P14 D1); the URI field shows
  everything as text. Go's design is the opposite: a URI shown back never carries a password (D7
  comment at `SI/connections/service.go:281-289`), and `in.Password` stands when the URI has none.
- Scenario: create dialog, type a password (masked), click URI: the secret is now visible on
  screen and in the DOM (`connection-uri` value), readable by a screen share or screenshot.
- Fix: `formatConnectionUri({ ...d, password: null })` in `setMode('uri')`; keep `d.password` in the
  draft so Save still sends it (Go keeps `in.Password` for a passwordless URI). Update the URI note
  to say "password kept separately" when `d.password` is set.
- Verified (scratch Playwright probe): host `db.example`, user `alice`, password typed into the
  masked field, click URI: `connection-uri` value is `postgresql://alice:hunter2-secret@db.example:5432`
  in a plain text input (no `type` attribute).

### F15 (medium): project tree has no arrow-key navigation (WAI-ARIA tree)

- `project/TreeRow.vue:116-121` (`onKeydown` handles Space only), `:139-146` (`role="treeitem"`,
  roving `tabindex`); `project/ProjectTree.vue:166-181` (`onTreeKeydown`: Enter plus menu
  shortcuts). git grep: no `Arrow`/`Home`/`End` handling in `project/*.vue` or `ProjectPanel.vue`.
  ProjectPanel's type-ahead only redirects printable keys into the search box.
- The tree declares `role="tree"` and one tabbable row, so a keyboard user can Tab in but cannot
  move to another row, expand (Right) or collapse (Left) a node. Carried suspect from Part 10 F13:
  confirmed.
- Fix: in `onTreeKeydown`, ArrowUp/ArrowDown move `selected` over `visibleRows` (and focus the row
  after `revealKey`), Right expands or moves to the first child, Left collapses or moves to the
  parent, Home/End jump. `revealKey` already handles virtualised rows. One UI spec step in
  `tree.spec.ts`.
- Code-read.

### F16 (low): "Reveal in project panel" fails when the panel is hidden, and a repeated reveal never scrolls

- `project/state/tree.ts:345-368` (`revealPath`), `project/ProjectTree.vue:64-71`
  (`watch(pendingScrollKey)`, not `immediate`), `PW/components/WorkbenchShell.vue:103,121`
  (`v-if="projectVisible"`).
- With the panel toggled off, `ProjectTree` is unmounted: the reveal expands and selects, nothing
  shows, and `pendingScrollKey` stays set. On the next mount the non-immediate watch never fires;
  a second reveal of the same row writes the same value, so the watch still does not fire.
- Fix: the tab-menu item (`state/tabKinds.ts:118`) shows the project panel first (layout store
  `panel.project.visible = true` via its own setter); the `pendingScrollKey` watch gets
  `{ immediate: true }`.
- Code-read.

### F17 (low): `refresh()` has no connection-epoch guard across its first await

- `project/state/tree.ts:282-287`. `refresh` adds the row to `expanded`, awaits `treeInvalidate`,
  then calls `loadChildren`, which captures the epoch only then. A disconnect landing during the
  first await runs `dropConnectionState` (clears `expanded`, bumps the epoch); `loadChildren` then
  starts under the new epoch and writes `children[k]` (or `errors[k]`) for a dropped connection.
  A later `expand` returns early on the stale `children[k]` (`:256`), and the reconnect
  invalidation skips it because `k` is no longer expanded.
- Fix: capture `connectionEpochFor(connectionId)` at the top of `refresh` (and
  `refreshConnection`) and return after each await when it changed.
- Code-read.

### F18 (low): tree actions drop rejections and clipboard failures

- `project/menuItems.ts:101,110` and `project/menus.ts:131`: `copyText(...)` result ignored (Part 12
  F10's class, fixed in views with `copyOrReportError`). `menus.ts:112-114` (duplicate),
  `:176-190` (read-only), `:200-204` (delete), colour items: async `run`s whose rejection is
  unhandled. `ProjectTree.vue:87,128` `void treeStore.expand(...)`: a rejected connect or
  `filtersList` leaves the row collapsed with no error (`errors[k]` is set only by
  `loadChildren`).
- Scenario: WebKit denies clipboard write (no user activation after the menu closes); Copy URI
  silently copies nothing. Delete fails on a busy DB; the row stays and nothing says why.
- Fix: route each through one tree-level reporter: write the message to `treeState.errors[row.key]`
  (the row already renders `ErrorPopover` for it), or a shared toast if Part 9 grows one. `expand`
  catches and sets `errors[k]`.
- Code-read.

### F19 (low): `ErrorPopover.vue` hand-rolls a popover

- `project/ErrorPopover.vue:1-72`: floating-ui positioning, outside-click and Escape wiring, no focus
  management, beside an existing shadcn-vue `Popover` (`PT/components/ui/popover`). Its Copy button
  also ignores the `copyText` promise.
- Fix: rebuild on `Popover`/`PopoverTrigger`/`PopoverContent` (reka handles positioning, outside
  click, Escape and focus return); keep `data-testid`s. Report a copy failure inline.
- Code-read.

### Block 3: checked, nothing to report

- `loadChildren` epoch plus per-key token, `loadVisibility` single-flight plus generation,
  `expand` collapse intent, `refreshExpanded` serial by depth: hold (P108 F9-F11).
- `dropConnectionState` on delete and on `disconnected` only (decided, P5 D6).
- `requestReveal` identity re-check after each await; `revealed` reset on draft swap (P108 F4);
  `closeDialog` clears the draft; `uriNote` shows host/port/db only; no `console.*` of a secret.
- DataGrip dialog: Import disabled while busy, report view replaces the button, selection reset on
  each scan.
- `SchemaDialog.vue` save catches; `filterTree.ts`/`grouping.ts`: no defect found.
- No drag-and-drop in the project tree (git grep).

## Block 4: configs and UI-test harness

### F20 (medium, routed Part 11 F17, decided: worth it): `data-view.spec.ts` Stop step proves no cancellation

- `ST/ui/data-view.spec.ts:1520-1571` (Stop step), `:976-991` (the `E_CANCELLED` port snapshot,
  `delayMs: 5000`); `ST/ui/support/mockStreamBrowser.js` (`onSend`: `setTimeout(reply, delayMs)`);
  `ST/ui/support/mockRuntime.ts` (`opsCancel` answered by the wildcard `null`).
- The canned `E_CANCELLED` arrives 5 s after the request whether or not Stop was pressed or
  `opsCancel` was sent. A regression where Stop sends no `opsCancel`, or the wrong op id, still
  passes: the button disables when the reply lands either way. The step also costs a fixed 5 s.
- Decision: worth it. Two parts, all in own files plus the Part 11 spec (Stream C may edit):
  1. Core (must): after the Stop click, assert `control.log()` holds one `opsCancel` whose `id`
     equals the `opId` of the in-flight data request (`stream.ops()` exposes the request payloads;
     keep `opId` in `SeenPortRequest` for this).
  2. Gate (should): a Studio-local `untilCancel?: true` on the snapshot (a wrapper type in
     `mockStream.ts`, so Part 5's `PortSnapshot` stays unchanged). `mockStreamBrowser.js` holds the
     reply in a `Map<opId, reply>` instead of scheduling it, and exposes
     `globalThis.__kiraReleaseCancelled(opId)`. Studio's `installControlMocks` passes a
     `resolveMissingBody` that, for `IPC.opsCancel`, fires `void page.evaluate(release, args.id)`
     and returns `'null'` (the hook already exists and is Studio-owned; `PW` needs no change).
     A safety timeout (10 s) still replies so a broken gate fails on the log assertion, not a hang.
  Then the spec proves "Stop sends the cancel, and the view recovers only because of it", and drops
  the fixed 5 s wait.
- Code-read.

### F21 (low): control-mock FQN table has gaps and cites a guard that does not exist

- `ST/ui/support/mockRuntime.ts:20-170` (`FQN_SUFFIX_BY_IPC_KEY`), doc comment at `:172-178`
  ("§5.5's `mockRuntime.spec.ts` guards both directions").
- Verified (diff of the generated bindings' `$Call.ByName` literals against the table): 122 bound
  methods, 120 mapped. Missing: `LifecycleService.WindowFlushed` and `TerminalService.Shutdown`.
  `WindowFlushed` is the ack `createTabsStore`'s close-time flush sends
  (`PW/state/createTabsStore.ts:250`), so no UI spec can drive the window-close flush (the 1000 ms
  debounced-save window, §5.2) without hitting `E_FIXTURE_MISS`. No UI spec covers that flush today
  (git grep: no `FlushBeforeClose` emit in `ST/ui`).
- No `mockRuntime.spec.ts` exists anywhere (git ls-files); nothing guards the table against the
  bindings.
- `ST/ui/support/ipcChannels.ts:15-16` keeps `port` and `engineState`, both dead channels
  (`SP/events.ts:7`; Go `ChannelEngineState` is never emitted, `SI/bridge/events.go:81`); no spec
  reads either (git grep).
- Fix: add the two entries (`windowFlushed` in `ipcChannels.ts` too); add an own unit spec that
  reads `frontend/bindings/**` `$Call.ByName` literals and asserts set equality with the table's
  values (the bindings exist wherever `typecheck:web:studio` runs); fix the comment to name it.
  Drop the two dead `IPC` keys. Optional, worth one UI spec: emit the window flush event inside the
  debounce window and assert one `tabsSave` with the new state, then `windowFlushed`.

### F22 (low): `openRowMenu` waits a blind 400 ms on every call

- `ST/ui/support/tree.ts:154-160`. 95 call sites (git grep) pay `waitForTimeout(400)` after
  `scrollIntoViewIfNeeded`: about 38 s of fixed sleep per full `ui` run, and still a guess under
  load, the exact pattern the file's own header (`:16-24`) rejects for `scrollAndSettle`.
- Same class, smaller: `ST/ui/tree.spec.ts:386-590` (12 sites of `waitForTimeout(100)`) where the
  next line is a non-retrying `boundingBox()` read (`:404-410`, `:417-422`); a slow frame reads
  stale geometry.
- Same pattern again: `closeAllTabs` is copied byte-for-byte in `ST/ui/perf.spec.ts:73-80` and
  `ST/ui/leaks.spec.ts:117-123`, each with its own 400 ms sleep.
- Fix: in `openRowMenu`, record `scrollTop` before and after `scrollIntoViewIfNeeded` (one
  `evaluate`) and await the `scroll` event only when it moved (reuse `scrollAndSettle`'s promise
  shape); then wait two rAFs. In `tree.spec.ts`, replace each sleep before a geometry read with an
  `expect.poll` on the measured value, or a two-rAF settle. Move `closeAllTabs` into
  `support/` with the same scroll-settle.
- Code-read.

### Block 4: checked, nothing to report

- `vite.config.ts` delegates to `PW/viteAppConfig.ts`; `index.html` CSP (`default-src 'self'`,
  no `unsafe-eval`); `tsconfig*.json` cover `fonts.ts` and every own `src/**`.
- `playwright.config.ts`: `ui-timing` serial after `ui` (decided, P27); `retries: CI ? 1 : 0`;
  `perf.spec.ts:196-206`'s "35 ms/frame at idle" note still matches this sandbox (block 5:
  p50 33-41 ms).
- `mockStreamBrowser.js`: a miss frame exists for every `DATA_OP` (`mockStream.ts:159-171`), so a
  missing stream fixture fails loudly, not as a hang.
- `WILDCARD_DEFAULTS`/`inferredBootMode`/`CANONICAL_OPTIONS`: each default is a benign empty
  answer; a spec that needs a real shape supplies a snapshot, and an unmapped call fails with
  `E_FIXTURE_MISS`. No masking found beyond F20's `opsCancel`.
- `clock.ts`, `clipboard.ts`, `connect.ts`, `grid.ts`, `editor*.ts`, `measure.ts` (except the
  percentile question, block 5), `bootSnapshots.ts`, `fixtures.ts`, `global.d.ts`: no defect.
- `ST/perf/perfProbe.ts` vs `PW/testing/ui/perfProbe.ts`: different measures (process-tree RSS vs
  WebKit RSS, frame lists vs live rAF capture); overlap is names, not logic. Not reported.

## Block 6: tests against the `CLAUDE.md` bar

### F23 (low): `mode-switch.spec.ts`'s `61e367f` wait matches a substring

- `ST/ui/mode-switch.spec.ts:101-108`. The poll waits for any `tabsSave` whose serialised log entry
  contains `'1000'`. A UUID (`crypto.randomUUID()` tab id) or any other number containing those
  digits satisfies it before the page-size save lands, which reopens the race `61e367f` closed. The
  product side is right: a mode switch calls only `setMode` (`createModeStore.ts:77-80`), which
  writes the window mode, never `tabsSave`.
- Fix: parse the entry, `(entry.args as { tabs: { state: { pageSize?: number } }[] }).tabs
  .some((t) => t.state.pageSize === 1000)`. Same check for any later edit of the baseline.
- Other own specs reading `tabsSave` (`tabs.spec.ts:349-355`) poll on the parsed payload: fine.
- Code-read.

### Block 6: checked

- Unit specs (9): each passes alone and together (29 tests). `tabs-save-serialized`,
  `tabs-save-retries-after-failure`, `tree-state`, `run-state` import the real stores
  (`frontend/src/state/tabs`, `project/state/tree`, `state/ops`) over a fake `control`: they drive
  current code and guard ordering/race logic, so they meet the bar. `mongo-srv-uri` (28 lines)
  still drives `canRoundTripToFields`. The four misplaced specs (`beautify-depth`, `frame-golden`,
  `history-view-supersession`, `ipc-fixture-sync`): pass alone, exercise current code
  (golden frames, cross-language fixture sync, supersession race, depth limit); none restates a
  body. No prune.
- Gaps tied to fixes above: `uri.ts` round trip (F3), cancel-gated mock (F20), Filters seed (F12),
  DataGrip failed scan (F5), settings cleared field (F6), FQN/bindings guard (F21). No other
  missing test qualifies under the bar.
- `waitForTimeout` sites (27): `tooltips.spec.ts` (5) prove an absence inside a tooltip delay
  window: legitimate. `tabs.spec.ts:326` waits Sortable's emulated dragover interval:
  documented, legitimate. `interaction.spec.ts:1078-1081` and `budgets.spec.ts:691` settle a
  pointer/scroll before a count: tolerable. The rest are F22.
- Visual (4 own specs) and `ST/perf/tree-scroll.spec.ts` (report-only by design): no defect.
- Not run: the full UI suite (plan rule), `test:visual:*` (sandbox font drift).

## Late finding (block 1 and 2 files)

### F24 (medium): a recent-tables entry for a deleted connection breaks every later tab save

- `state/tabs.ts:67-81` (`useRecentTablesStore`, never pruned), `:167-173` (the
  `onConnectionsChanged` listener closes a deleted connection's tabs but leaves its recent
  entries), `workbench/panels/StudioStart.vue:46-50` (`openRecent` opens without checking the
  connection still exists). Go: `tabs.connection_id REFERENCES connections(id) ON DELETE CASCADE`
  (`SI/storage/migrations/0002_p8_windows.sql:26`), and `TabsService.Save` replaces the window's
  whole tab set in one transaction.
- Scenario: open table T on connection C (recorded as recent), delete C, close every tab. The start
  screen lists T under Recent tables; click it. `openDataTab(C, T)` creates a tab for a connection
  that no longer exists and `saveNow` sends it. The insert violates the FK, the whole
  `ReplaceKeyed` transaction fails, and `enqueueSave` swallows the rejection
  (`PW/state/createTabsStore.ts:223-228`). Every later save fails the same way while that tab is
  open, so no tab change in that window persists; `onConnectionsChanged` never fires again for C
  to close it. This is the exact failure the `tabs.ts:162-166` D7 comment says the listener
  prevents.
- Fix: in the `onConnectionsChanged` listener also drop recent entries whose `connectionId` is not
  live (a `pruneRecent(liveIds)` action on `useRecentTablesStore`); `StudioStart` hides an entry
  with no `connectionRecord`; `openTrackedTab` returns early (no tab) when the connection record is
  missing.
- Code-read.

## Block 5: `ui-timing` investigation (raw numbers, round 1)

Method: two scratch worktrees in the session scratchpad, HEAD `62c0fdb` and base `f40cd35`
(node_modules hard-linked from this worktree, lockfile identical across the range; generated
bindings copied, no exported bridge signature changed in `f40cd35..62c0fdb`). Each got one scratch
line logging the raw sorted samples (`RAW ...`); spec files are byte-identical between the two
trees. `bun run build:test:studio` in each. Runs alternate HEAD/base, project alone:
`playwright test --config=apps/kira-studio/playwright.config.ts --project=ui-timing --no-deps`.
A runner waits up to 20 min for 1-min load < 4 with no other test process (any cwd outside the
scratchpad: Streams A/B and the main checkout ran Go tests, vue-tsc and `bun test` throughout),
then runs regardless. "max" below is the highest 1-min load sampled every 5 s during the run;
"foreign" the most foreign test processes seen. A run counts (P139 rule) only at max <= 4 and
foreign 0. WebKit's `performance.now()` here has 1 ms resolution (every sample is an integer).

Per-run summary (cell -> editor: `percentile(.., 95)` is the max of 20; perf: n = 22 deltas):

    head-1   10:14:24 load0=3.82 maxload=3.82 foreign=0 rc=0 COUNTED | cell p50=17 p95(max)=25 2nd=23 | scroll n=22 p50=35 p95=39 max=46
    base-1   10:15:19 load0=2.33 maxload=7.39 foreign=0 rc=0 not-counted | cell p50=18 p95(max)=24 2nd=24 | scroll n=22 p50=41 p95=57 max=59
    head-2   10:18:47 load0=3.99 maxload=3.99 foreign=4 rc=0 not-counted | cell p50=21 p95(max)=25 2nd=24 | scroll n=22 p50=33 p95=40 max=51
    base-2   10:19:40 load0=3.35 maxload=5.87 foreign=0 rc=0 not-counted | cell p50=16 p95(max)=23 2nd=22 | scroll n=22 p50=36 p95=46 max=54
    head-3   10:22:10 load0=3.92 maxload=10.71 foreign=0 rc=0 not-counted | cell p50=29 p95(max)=38 2nd=38 | scroll n=22 p50=46 p95=58 max=65
    base-3   10:26:04 load0=3.89 maxload=3.89 foreign=0 rc=0 COUNTED | cell p50=14 p95(max)=27 2nd=24 | scroll n=22 p50=32 p95=50 max=50
    head-4   10:36:50 load0=3.77 maxload=12.34 foreign=0 rc=1 not-counted | cell p50=23 p95(max)=42 2nd=37 | scroll n=22 p50=48 p95=57 max=58
    base-4   10:43:43 load0=3.96 maxload=12.94 foreign=0 rc=1 not-counted | cell p50=21 p95(max)=37 2nd=36 | scroll n=22 p50=49 p95=65 max=85
    head-5   11:05:03 load0=7.28 maxload=9.31 foreign=0 rc=0 not-counted | cell p50=27 p95(max)=42 2nd=39 | scroll n=22 p50=37 p95=47 max=54
    base-5   11:07:50 load0=3.99 maxload=7.41 foreign=0 rc=0 not-counted | cell p50=18 p95(max)=26 2nd=23 | scroll n=22 p50=41 p95=56 max=60
    head-6   11:10:03 load0=3.98 maxload=4.75 foreign=0 rc=0 not-counted | cell p50=18 p95(max)=33 2nd=29 | scroll n=22 p50=46 p95=65 max=94
    base-6   11:17:05 load0=3.72 maxload=3.98 foreign=0 rc=0 COUNTED | cell p50=19 p95(max)=27 2nd=24 | scroll n=22 p50=37 p95=55 max=64
    head-7   11:18:00 load0=3.36 maxload=7.97 foreign=0 rc=0 not-counted | cell p50=18 p95(max)=27 2nd=23 | scroll n=22 p50=41 p95=51 max=57
    base-7   11:19:54 load0=3.80 maxload=4.17 foreign=0 rc=0 not-counted | cell p50=17 p95(max)=41 2nd=25 | scroll n=22 p50=35 p95=41 max=43
    head-8   11:21:30 load0=3.90 maxload=7.84 foreign=0 rc=0 not-counted | cell p50=21 p95(max)=31 2nd=30 | scroll n=22 p50=50 p95=72 max=82
    base-8   11:23:13 load0=3.78 maxload=10.53 foreign=3 rc=0 not-counted | cell p50=27 p95(max)=38 2nd=37 | scroll n=22 p50=43 p95=59 max=60

Raw samples (sorted for budgets.spec.ts, arrival order for perf.spec.ts):

- `base-1` 10:15:19, load start 2.33, max 7.39, foreign 0, rc 0
  - cell -> editor: `[14,15,15,16,17,17,17,17,17,17,18,18,18,18,19,20,21,21,24,24]`
  - cached tree expand: `[15,16,16,16,16,17,17,18,18,18,19,20,20,21,27,28,33,36,39,43]`
  - cached tab switch: `[88,89,89,90,90,91,93,96,103,106,112,113,114,116,120,120,121,136,185,193]`
  - perf scroll deltas: `[5,15,44,46,40,41,43,39,36,41,38,44,43,57,37,36,38,38,47,59,41,30]`
- `head-1` 10:14:24, load start 3.82, max 3.82, foreign 0, rc 0
  - cell -> editor: `[14,14,15,16,16,16,17,17,17,17,17,18,18,18,19,20,22,22,23,25]`
  - cached tree expand: `[15,15,16,16,16,16,18,18,18,18,18,20,22,22,22,23,24,27,28,33]`
  - cached tab switch: `[89,91,91,91,93,96,96,97,97,112,113,115,117,119,121,128,135,143,147,161]`
  - perf scroll deltas: `[0,20,38,38,38,39,46,33,38,35,36,34,34,35,35,35,37,31,35,33,32,26]`
- `base-2` 10:19:40, load start 3.35, max 5.87, foreign 0, rc 0
  - cell -> editor: `[13,14,14,14,14,15,15,15,15,15,16,16,16,16,17,17,19,19,22,23]`
  - cached tree expand: `[14,15,15,15,16,16,16,17,17,18,18,18,18,19,19,19,20,20,21,22]`
  - cached tab switch: `[86,87,88,89,92,92,93,95,97,103,106,113,113,118,122,125,125,127,146,175]`
  - perf scroll deltas: `[5,21,39,40,46,35,38,35,36,34,35,37,37,42,42,54,43,34,35,34,32,31]`
- `head-2` 10:18:47, load start 3.99, max 3.99, foreign 4, rc 0
  - cell -> editor: `[15,16,16,17,17,18,19,20,20,21,21,22,22,23,23,23,24,24,24,25]`
  - cached tree expand: `[16,16,16,17,17,18,18,18,19,20,20,22,22,23,23,24,25,25,25,26]`
  - cached tab switch: `[89,89,91,94,97,102,103,106,109,111,115,116,117,117,120,120,124,125,129,191]`
  - perf scroll deltas: `[5,23,35,36,36,35,38,37,37,33,33,32,31,32,30,33,31,29,31,51,40,25]`
- `base-3` 10:26:04, load start 3.89, max 3.89, foreign 0, rc 0
  - cell -> editor: `[10,12,12,13,13,13,14,14,14,14,14,15,15,15,15,15,17,23,24,27]`
  - cached tree expand: `[14,14,14,15,15,15,15,15,15,16,16,16,17,17,18,18,18,19,26,27]`
  - cached tab switch: `[78,82,83,85,87,87,89,95,96,98,100,104,105,107,109,111,112,117,152,157]`
  - perf scroll deltas: `[3,16,33,32,32,31,31,32,32,28,30,30,50,29,33,50,45,32,30,31,33,24]`
- `head-3` 10:22:10, load start 3.92, max 10.71, foreign 0, rc 0
  - cell -> editor: `[14,16,19,21,21,21,23,25,27,28,29,29,29,30,31,31,32,33,38,38]`
  - cached tree expand: `[14,14,15,15,15,16,16,16,16,16,17,18,18,18,20,27,30,35,39,47]`
  - cached tab switch: `[89,94,102,103,105,109,114,123,123,125,127,127,130,131,133,136,143,160,169,197]`
  - perf scroll deltas: `[22,46,65,46,51,45,55,41,43,53,48,44,38,48,58,50,43,47,45,50,42,39]`
- `base-4` 10:43:43, load start 3.96, max 12.94, foreign 0, rc 1, FAIL ['apps/kira-studio/tests/ui/budgets.spec.ts:372'] [('300', '310')]
  - cell -> editor: `[10,11,11,16,16,18,19,19,19,20,21,21,22,25,26,27,27,29,36,37]`
  - cached tab switch: `[88,95,100,102,105,109,111,118,127,130,131,137,145,151,156,160,169,180,241,310]`
  - perf scroll deltas: `[18,25,49,56,51,45,85,50,48,49,55,46,65,54,47,45,47,52,44,45,50,33]`
- `head-4` 10:36:50, load start 3.77, max 12.34, foreign 0, rc 1, FAIL ['apps/kira-studio/tests/ui/budgets.spec.ts:372'] [('50', '52')]
  - cell -> editor: `[12,13,14,14,14,16,16,17,17,19,23,23,25,27,29,30,31,36,37,42]`
  - cached tree expand: `[17,17,17,18,19,20,20,22,22,25,28,30,33,35,37,41,41,46,49,52]`
  - cached tab switch: `[99,102,104,105,113,120,120,121,126,127,130,132,136,141,175,176,192,193,198,264]`
  - perf scroll deltas: `[9,28,54,45,51,53,50,48,49,57,50,58,47,50,48,47,54,46,47,43,42,37]`
- `base-5` 11:07:50, load start 3.99, max 7.41, foreign 0, rc 0
  - cell -> editor: `[14,14,15,15,16,16,16,16,17,17,18,18,20,20,20,20,20,22,23,26]`
  - cached tree expand: `[16,17,17,17,18,18,19,19,20,22,27,29,30,31,32,33,34,35,36,40]`
  - cached tab switch: `[89,89,93,94,103,105,110,111,116,117,117,118,121,122,133,138,142,164,170,202]`
  - perf scroll deltas: `[3,14,40,36,41,35,34,34,34,35,60,53,46,48,55,56,53,37,46,41,50,46]`
- `head-5` 11:05:03, load start 7.28, max 9.31, foreign 0, rc 0
  - cell -> editor: `[19,19,21,22,22,23,24,25,25,25,27,27,27,28,29,31,32,34,39,42]`
  - cached tree expand: `[14,15,15,16,16,17,18,18,19,19,19,19,19,21,21,22,23,23,24,26]`
  - cached tab switch: `[92,93,93,94,96,96,111,112,113,114,115,120,121,121,123,131,137,138,170,228]`
  - perf scroll deltas: `[0,16,38,44,40,38,38,36,38,33,37,41,47,54,33,35,35,31,37,37,35,27]`
- `base-6` 11:17:05, load start 3.72, max 3.98, foreign 0, rc 0
  - cell -> editor: `[15,16,16,16,17,17,17,18,18,19,19,19,19,19,20,20,20,22,24,27]`
  - cached tree expand: `[15,16,16,17,17,17,18,18,18,19,19,19,20,21,21,21,22,22,22,27]`
  - cached tab switch: `[90,91,94,97,100,101,104,110,111,118,120,120,124,125,126,127,130,146,166,170]`
  - perf scroll deltas: `[4,14,39,43,41,38,43,34,33,51,55,35,33,33,33,37,35,42,64,41,36,32]`
- `head-6` 11:10:03, load start 3.98, max 4.75, foreign 0, rc 0
  - cell -> editor: `[14,14,14,16,16,16,16,16,16,17,18,18,18,18,18,19,21,21,29,33]`
  - cached tree expand: `[15,16,17,17,18,18,19,19,19,20,20,20,23,24,25,33,33,38,41,50]`
  - cached tab switch: `[88,90,91,93,97,99,102,106,110,112,114,117,118,120,122,123,125,151,155,169]`
  - perf scroll deltas: `[9,25,55,45,51,50,47,46,43,51,94,65,43,43,37,47,46,48,43,48,37,32]`
- `base-7` 11:19:54, load start 3.80, max 4.17, foreign 0, rc 0
  - cell -> editor: `[12,13,14,15,15,16,16,16,16,16,17,17,18,18,19,19,23,24,25,41]`
  - cached tree expand: `[15,15,15,16,16,17,17,17,17,17,17,18,19,19,19,19,19,19,20,21]`
  - cached tab switch: `[88,97,98,98,101,101,103,109,109,116,121,122,125,126,130,132,133,134,136,180]`
  - perf scroll deltas: `[10,16,38,43,36,32,36,34,34,35,33,37,41,40,34,36,33,35,34,37,35,26]`
- `head-7` 11:18:00, load start 3.36, max 7.97, foreign 0, rc 0
  - cell -> editor: `[14,14,15,15,15,15,16,18,18,18,18,19,19,19,19,19,20,22,23,27]`
  - cached tree expand: `[15,16,16,17,17,18,18,18,19,19,20,20,20,20,22,24,25,25,31,39]`
  - cached tab switch: `[89,89,90,92,93,95,97,99,102,107,107,115,117,118,122,123,133,133,134,183]`
  - perf scroll deltas: `[2,17,48,41,42,39,37,49,38,38,38,38,51,40,41,43,41,35,45,45,40,57]`
- `base-8` 11:23:13, load start 3.78, max 10.53, foreign 3, rc 0
  - cell -> editor: `[11,15,19,24,25,26,26,26,27,27,27,28,28,29,29,31,35,35,37,38]`
  - cached tree expand: `[16,17,17,17,18,18,18,18,18,19,19,20,21,24,27,28,30,32,32,43]`
  - cached tab switch: `[88,95,101,105,112,116,119,124,125,126,128,145,145,173,173,175,175,177,215,239]`
  - perf scroll deltas: `[2,17,39,40,38,45,45,37,35,46,45,43,59,41,49,43,55,50,41,49,60,39]`
- `head-8` 11:21:30, load start 3.90, max 7.84, foreign 0, rc 0
  - cell -> editor: `[17,18,19,20,20,21,21,21,21,21,21,21,22,22,23,23,23,27,30,31]`
  - cached tree expand: `[15,17,17,18,18,18,18,19,19,20,20,21,22,26,27,29,33,40,41,49]`
  - cached tab switch: `[101,101,103,111,116,117,119,127,129,130,131,137,144,145,145,156,172,196,203,207]`
  - perf scroll deltas: `[20,28,52,59,52,48,50,48,50,48,46,51,63,60,50,50,48,56,72,82,54,43]`
