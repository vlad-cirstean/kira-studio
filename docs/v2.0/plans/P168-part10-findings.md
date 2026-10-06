# P168 Part 10: review findings, Studio API client UI

Plan: `P168-part10-studio-api-ui.md`. Base commit `8a008bd` (plan surveyed), HEAD reviewed `6a7fde1`
(`p168-stream-c`, plan commit only on top). Reviewer: one Opus agent, report only.

## Checks

- `bun test` over 13 own unit specs: 38 pass, 0 fail.
- `bun run typecheck` (all nine projects): pass.
- `bunx biome check` over `SF/api`, `SF/views/httprequest`, `SF/views/grpcrequest`: 59 files, clean.

Probes: `bun test` harnesses in session scratchpad (Pinia store, stubbed `control`), never in tree.

## Findings (block 1, data layer)

### F1 medium, verified: Copy as curl reveal loop keeps revealing after dialog close or reopen

- `SF/api/state/curl.ts:268-291` (`revealSecretValues`), `:211-226` (`closeCopyAsCurlDialog`).
- Loop captures `deferredNames`, `collectionId`, `environmentId` once, then awaits per name. Close
  clears both maps, but nothing stops the loop. Each later iteration still calls `revealVariable`
  (OS auth or confirm prompt with no dialog on screen) and writes plaintext into
  `state.revealedSecretValues` and `useVariableSetStore().revealedValues`.
- Probe: two deferred secrets, close while first reveal pending. After close: `calls ["va","vb"]`,
  curl map `{"A":"plain-va","B":"plain-vb"}`, variable-set map `{"va":…,"vb":…}`. Both held 5 min.
- Reopen for another request: openCopyAsCurlDialog clears the map, then old loop writes old-scope
  values keyed by name. New dialog's command then substitutes another environment's secret for a
  same-named `{{A}}`. Copy copies it.
- Fix: per-open generation token (`openSeq`). Bump in open and close. Loop checks token after each
  await; on mismatch, stop and write nothing. Same check before `revealVariable` so no prompt fires
  after close. Guard via unit spec (cancellation race qualifies under CLAUDE.md bar).

### F2 low, code-read: history `view()` has no supersession

- `SF/api/state/history.ts:490-500`. Two quick clicks on entries A then B: if `get(A)` resolves
  last, `viewing` shows A while B is selected. A `get` resolving after `noteRecorded` (which clears
  `viewing` for a fresh send, D3) re-shows the old snapshot over the new response.
- Fix: per-tab view sequence (or compare against a `requestedViewId`), bumped by `view`,
  `backToLatest` and `noteRecorded`; commit only on match.

### F3 low, code-read: `del`/`clearAll` resurrect a closed tab's runtime

- `SF/api/state/history.ts:508-522`. After `await opts.remove/clear`, both call `load(tabId)`,
  which calls `ensure(tabId)` and `bumpSeq` before any `findTab` check. Tab closed during the
  await: runtime and `latestSeq` entry recreated, never cleaned (cleanup already ran).
- Callers `ResponseHistoryList.vue` (`onDelete` via `void`, `onClear`) and the gRPC
  `CallHistoryList.vue` never catch: a failed `remove`/`clear` is an unhandled rejection with no
  message, though `rt.error` exists for exactly this.
- Fix: `if (!opts.findTab(tabId)) return;` after the await in both, or move `ensure`/`bumpSeq`
  in `load` behind a `findTab` check; catch in `del`/`clearAll` and set `rt.error`.

### F4 low, code-read: `openHistoryMenu` failure unhandled and silent

- `SF/api/state/variables.ts:732`; caller `SF/api/VariableSetView.vue:456` uses `void`.
- `control.variablesHistory` rejection becomes an unhandled rejection. Popover stays open with
  empty entries, reads as "no history".
- Fix: try/catch; on error `setVariableSetError(tabId, message)` when `variableId` still matches.

### F5 low, code-read: export clears `busy` under a running import

- `SF/api/state/collections.ts:700-728` vs `:644-680`. `exportCollection` never checks `busy` and
  its `finally` sets `busy = false`. Export started (row menu) during an import ends first and
  re-opens import's P28 D18 re-entry guard while the import still runs.
- Fix: export returns early when `busy`, like import.

### F6 low, code-read: any saved-request read failure is cached as a permanent orphan

- `SF/api/state/apiQueries.ts:67-94`. `queryFn` maps every error (transient bridge/DB error, or a
  Zod parse failure from schema drift) to `null`, the confirmed-orphan marker, with
  `staleTime: Infinity`. Only a later `savedRequest` broadcast for that id clears it. The tab
  reads unsaved/orphan for the session (block 3 notes what Save then does).
- Fix: return `null` only for Go's not-found outcome. Rethrow other errors so the query is in
  error state and retries on next read. Needs Go to return a typed not-found from
  `GetRequest`/`GetGrpcRequest` (today `ipcerr.InternalResult` wraps all errors alike).
  `needs-other-part-file: apps/kira-studio/internal/bridge/collections.go (Part 6)`.
- Consequence in this chunk: `CollectionsTree.vue:291,295` opens a `null` read as
  `default*SavedRequest()` bound to the row id, so a transient read failure opens an empty request
  for a row that has content (Save then routes to Save as, so no overwrite).

### Refuted in block 1

- `apiIdsForTab` reading observer-backed computeds (`collectionIdFor`, `environmentIdForTab`)
  right after `loadCollectionsTree`/`loadEnvironments`: probe at boot and during a broadcast
  refresh both returned fresh ids. No lag observed.
- `REVEAL_GRACE_WINDOW_MS` (5 min) matches `internal/localauth.GraceWindow`.
- Go emits `ApiDataChanged` for every mutation the renderer refreshes locally (tree, savedRequest
  on save, variables on upsert/delete/reorder/bulk, environments on all env CRUD, collection
  delete adds its variables scope). Key set and kinds agree.
- `findSecretVariableId` precedence (environment then collection, first-wins) matches
  `mergeVariableRows`.

## Findings (block 2, API components)

### F7 medium, verified: committed secret value stays in the row draft as plaintext, row stuck dirty

- `SF/api/VariableSetView.vue:164-208` (`draftFromRow`, `syncDrafts`) with `SF/api/state/draftMerge.ts:40-55`.
- Type a new value into a secret row (or tick "secret" on a plain row) and blur. After the
  commit, the refetched row is secret with `value: ''`. Draft value (typed plaintext) differs from
  both its seed and the incoming draft, so `mergeDrafts` keeps it, `valueTouched` still true.
- Probe (`mergeDrafts` with this view's options): after own commit the draft is still
  `{"value":"typed-secret","valueTouched":true}`; a later remote rename of the row is ignored too.
- Effects: (1) a fourth plaintext holder outside the three reveal maps, never cleared by the
  5-minute expiry; the eye toggles it visible with no reveal gate (`notYetRevealed` is false).
  (2) The row never reseeds again until the tab remounts, so remote edits to it (name,
  description, value) never show. (3) Every later focus-and-blur on the row re-sends the stale
  plaintext (`valueTouched` true, `value !== ''`), silently reverting another window's change.
- Fix: after a successful own commit, reseed that row's draft and seed from the incoming row
  (clear the typed value; keep `revealedValues` mirroring as today). For example `commitDraft`
  records the committed id, and `syncDrafts` forces a reseed for ids in that set. Unit-guard via
  `api-draft-merge` spec (secret case).

### F8 medium, code-read: bulk `.env` Apply deletes rows added since the editor opened, unconfirmed

- `SF/api/BulkVariablesEditor.vue:193-254`. `baseline` is frozen at mount. `diff` and the removal
  confirm compare entries against that baseline. Go `VariablesRepo.ApplyBulk`
  (`SI/storage/repos/variables.go:735`, phase 3) deletes every live row whose name is in no line,
  history included.
- Scenario: open bulk mode in window A; window B adds `API_KEY` (or this window's own restore or
  a remote upsert lands). Apply in A: `API_KEY` and its history are deleted with no prompt, and any
  non-secret value B changed is reverted to A's baseline text.
- Fix: on Apply, reconcile against the live `props.rows` (`toEnvRows(props.rows)`), confirm
  removals from that list, and warn ("variables changed since you opened bulk edit") when live rows
  differ from `baseline`.

### F9 medium, code-read: Save request dialog sticks in "saving" on failure and never shows the error; Enter double-submits

- `SF/api/SaveRequestDialog.vue:52-64`, `:99`. `collectionsStore.submitSaveDialog`
  (`SF/api/state/collections.ts:543-603`) catches every error into `collectionsStore.error` and
  resolves. The dialog's own `catch` never runs: `saving` stays true (Save disabled for the rest
  of the dialog's life) and its `save-request-error` alert never shows. The message lands in the
  tree panel strip, which may be collapsed or hidden.
- `onSave` has no `saving` guard and is bound to `@keydown.enter`: two quick Enters create two
  collection rows from one Save as.
- Fix: `submitSaveDialog` returns success/failure (or rethrows); dialog resets `saving` and shows
  the message in its own alert. `if (saving.value) return;` at the top of `onSave`.

### F10 low, code-read: reorder order not reconciled after a failed reorder or a mid-drag refetch

- `SF/api/VariableSetView.vue:192-208, 280-293, 413-422`; `SF/api/EnvironmentsView.vue:77-96, 121-180`.
- Both set `order` optimistically. On reorder failure the mutation's `onSuccess` refresh never
  runs and `rows` does not change, so the list keeps showing an order Go never stored (until some
  unrelated change). `syncDrafts` skips the order reseed while `dragging`; a refetch landing
  mid-drag is never replayed after `onEnd`, so a row added remotely stays invisible (filtered out
  of `order`) until the next change, and a drop sends Go an id list missing it.
- Fix: on reorder error, reset `order` from current `rows`/`environments`; on drag end, run the
  reseed `syncDrafts` skipped (watch `dragging` false then resync order).

### F11 low, code-read: Environments list does not scroll; rows lack accessible names

- `SF/api/EnvironmentsView.vue:265` list container has no `flex-1 min-h-0 overflow-y-auto`
  (VariableSetView's list has it), under an `h-full flex-col` root. With more environments than
  fit, lower rows are clipped and unreachable.
- `:289-296` the Active radio has only a tooltip, no `aria-label`; the name input (`:299`) has no
  label or placeholder. Screen readers announce "radio button"/"edit text" with no name. A failed
  `setActiveEnvironment` leaves the clicked native radio checked while the store's active row is
  unchanged (`:checked` binding never re-renders).
- Fix: add `flex-1 min-h-0 overflow-y-auto`; `aria-label` on radio ("Active: {name}") and both
  inputs; on activation error, re-sync the radio (bind `:key` or reset `checked`).

### F12 low, code-read: hand-rolled menus and native buttons where shadcn primitives exist

- `SF/api/EnvironmentSelect.vue:163-234`, `SF/api/MethodSelect.vue:271-308`: Popover plus native
  `<button>` rows act as a select menu. No arrow-key navigation, no `menu`/`menuitemradio` roles,
  checked state only visual. Their decline reason (native `<option>` cannot colour rows) does not
  apply to `PT/components/ui/dropdown-menu`, which exists and renders app-drawn rows
  (`DropdownMenuRadioGroup`/`DropdownMenuRadioItem`). CLAUDE.md: menu primitives come from
  shadcn-vue.
- Native `<button>` also in `CollectionsPanel.vue:184` (category toggle),
  `DynamicValuesDialog.vue:206`, `VariablesOverviewPanel.vue:370, 407, 417`. Not justified in
  comments beyond reset notes; shadcn `Button` (`variant="ghost"`/`link`) covers them.
- Fix: rebuild both selects on `DropdownMenu` + radio items (keep `nativeSelectVariants` trigger
  styling and testids); swap the native buttons for `Button`.

### F13 low, code-read: Collections tree has no ArrowUp/ArrowDown navigation

- `SF/api/CollectionsTree.vue:350-380`, `SF/api/CollectionRow.vue:139-146`. `role="tree"` with
  roving `tabindex` (only the selected row is 0) but keydown handles only Left/Right, open and
  menu shortcuts. A keyboard user cannot move between rows; with nothing selected no row is
  tabbable. Same gap exists in `project/ProjectTree.vue` (Part 13, not this chunk).
- Fix: ArrowUp/Down (and Home/End) move `selected` across `visibleRows`, focus the row
  (`revealKey` for virtualised rows).

### F14 low, code-read: clipboard and generator-load failures are silent

- `SF/api/state/curl.ts:295-297` (`copyCurlCommand`), `CollectionsTree.vue:311` (copy URL),
  `DynamicValuesDialog.vue:155-157`, `VariablesOverviewPanel.vue:291-293` all `void copyText(...)`:
  a denied/unfocused clipboard write is an unhandled rejection with no feedback.
  `PW/util/clipboard.ts` already offers `copyOrReportError` for this.
- `DynamicValuesDialog.vue:132-137`: `loadDynamicGenerator()` rejection (chunk load failure) is
  unhandled; every sample stays blank with no message.
- Fix: `copyOrReportError` into each surface's own error sink (Copy as curl: `state.error`);
  try/catch around the generator load with an inline error.

### Refuted or clean in block 2

- `EnvironmentsView`/`VariableSetView` env-name draft reset on unrelated environments refetch:
  TanStack structural sharing keeps unchanged objects' identity; the watch does not fire.
- Copy as curl dialog renders the command in a readonly `Textarea` (text, not HTML); all
  server strings (import warnings, errors, names) render via interpolation. No `v-html`.
- All 19 components are single `<script setup lang="ts">`, Tailwind-only (no `<style>`).
- `CollectionsPanel` registers/unregisters its 5 commands on mount/unmount.
- `ImportCurlDialog`/`EditRawRequestDialog` debounce parsing (400 ms, `refDebounced`/
  `useDebounceFn`, cancelled on unmount).

## Findings (block 3, HTTP view)

### F15 medium, verified: a failed variable or tree load wedges the tab in "running"; Stop is a no-op; a closed tab still sends

- `SF/views/httprequest/state.ts:158-184` (`send`): `status = 'running'` and `opId` are set, then
  `await variablesForSend(...)` and `await loadDynamicGenerator()` run before the `try`. Same
  shape in `SF/views/grpcrequest/state.ts` `call` (block 4, F21).
- Probe: `control.collectionsList` rejects. `send` rejects (unhandled from the `void` call
  site), runtime left `status: running`, `opId` set, `httpSend` never called. Retry after the
  bridge recovers: `send` returns at the `running` guard; status still `running`. Send stays
  disabled (`:disabled="running"`) for the life of the tab.
- Stop during that window calls `opsCancel` for an op Go never saw (no-op), then `httpSend` still
  runs. A tab closed during the await: cleanup deletes the runtime, then `httpSend` still goes
  out and Go records history for a dead tab (the post-await guard only stops the bookkeeping).
- Fix: move the variable/generator awaits inside the `try` (its `catch` already restores state);
  after them, return early if `!findHttpRequestTab(tabId) || rt.opId !== opId` before calling
  `control.httpSend`. Stop while pre-flight: clear `opId` and set `cancelled` locally. Extend
  `http-send-tab-close-leak` spec with the pre-flight close and the load-failure case.

### F16 medium, verified: Settings pane accepts values that make the persisted tab unparseable; restart resets the whole request

- `SF/views/httprequest/RequestSettingsPane.vue:41-71` patch `Number(input.value)` unchecked.
  `min`/`max` attributes do not stop typing `-5` or `1.5`. Schema `httpRequestSettingsSchema`
  (`packages/shared/domain/http.ts:339-343`) is `int().min(0)`.
- Probe: tab state with `settings.maxRedirects` `-5` or `1.5` fails
  `httpRequestTabStateSchema.safeParse`; `7` passes. On the next launch `createTabsStore.hydrateTabs`
  (`PW/state/createTabsStore.ts:252-264`) resets a failed tab to `defaultState()`: URL, headers,
  body and `itemId` are gone. Before restart, `1.5` also fails Go's JSON decode into `*int`
  (`SI/httpclient/options.go:19-23`), so every send errors.
- Fix: normalise in the handlers: empty/NaN means keep previous value or `null`, `Math.trunc`,
  clamp to the `*_RANGE` constants already imported. No schema change needed.

### F17 medium, code-read: a rename in another window is reverted by Save in this window

- `SF/api/state/collections.ts:397-412` renames bound tabs only in the window that renamed
  (`renameApiRequestTabs`/`renameGrpcRequestTabs`). The `tree` broadcast refreshes the tree in
  other windows but never touches tab names. `HttpRequestView.vue:206` saves with
  `name: props.tab.state.name || title`; Go `SaveRequest` writes that name
  (`SI/bridge/collections.go:82-94`).
- Scenario: request open in windows A and B. Rename in A. Edit and Save in B: the row's name
  reverts to the old one. Same for gRPC (`GrpcRequestView` save).
- Fix: after every tree refresh (local or broadcast), sync bound tab names from the tree
  (a watch on `items` in `useCollectionsStore` calling the two rename helpers for mismatches,
  skipping orphans); or have Save send the tree's current name for a bound row.

### F18 low, code-read: cookie list races: clear does not bump `fetchSeq`; delete has no sequence check

- `SF/views/httprequest/cookies.ts:77-91`. A fetch in flight when `clearCookies` resolves lands
  afterwards (its `mySeq` still current) and repopulates the list with cookies the jar no longer
  holds. `deleteCookie` writes Go's reply with no `fetchSeq` bump, so an older in-flight fetch
  resolving after it re-shows the deleted cookie. Both rejections are unhandled
  (`CookiesPane.vue:58-65`).
- `CookiesPane.vue:121` keys rows by `c.name`: two cookies with one name on different paths or
  domains (common) duplicate the key, and Remove-by-name is ambiguous.
- "Clear all" (`CookiesPane.vue:103-111`) empties the process-wide jar for every host with no
  confirmation, from a pane scoped to one request URL.
- Fix: bump `fetchSeq` for every tab in `clearCookies` and for the tab in `deleteCookie`; catch
  and surface errors; key by `name+domain+path`; confirm "Clear all cookies for every host?".

### F19 low, code-read: Raw toggle hidden while Pretty formatting is pending

- `SF/views/httprequest/ResponsePane.vue:302-312` renders the Pretty/Raw toggle only
  `v-if="prettyFormat"`; `format` is `undefined` for the whole worker pass. With a persisted
  `responseView: 'pretty'` and a multi-MB body, the user sees only "Formatting response…" and has
  no way to switch to Raw until the pass ends.
- Fix: show the toggle while `prettyFormat === undefined` too (pending), hide only when `null`.

### F20 low, code-read: after a failed send the previous response and timeline stay on screen

- `SF/views/httprequest/state.ts:217-240` keeps `rt.response` from the last success on error.
  `ResponsePane` shows the old status badge, body and size under the error strip;
  `TimelinePane.vue:26-30` shows the failure's partial timeline only when there is no response, so
  after any earlier success the P10 D15 failure timeline is unreachable.
- Fix: clear `rt.response` when a send fails (or have both panes prefer the error state when
  `status === 'error'`).

### Refuted or clean in block 3

- `useResponseBody`: `seq` plus `runLatest` per component instance; a superseded worker pass is
  discarded; inline path bypasses the worker; caption timer is `useTimeoutFn` (scope-disposed).
  View switch drops and re-requests text as designed (P21 F7).
- Beautify (`RequestBodyPane.onBeautifyBody`): source-equality guard holds; repeated clicks queue
  duplicate worker jobs but only the first can patch.
- `ResponseDiffDialog` beautifies on the main thread, but history bodies are capped at 256 KB
  (stored snapshot); P163 inventory does not route it to the worker. Not reported.
  Monaco diff models disposed on unmount; a late `loadMonaco` after unmount returns early.
- Stored request in history is pre-resolution (`response-history.ts:34`), so the Raw pane's
  reconstructed request holds no secret plaintext.
- `sendCompletedListeners` unsubscribed on unmount; `fetchCookiesDebounced.cancel()` on unmount.
- All 14 components single `<script setup lang="ts">`; one `<style scoped>` in
  `ResponseDiffDialog.vue` (justified `:deep` Monaco height rule). Header, cookie, status and
  timeline strings render as text.

## Findings (block 4, gRPC view)

### F21 medium, code-read (HTTP twin verified, F15): gRPC `call` and `loadSchema` wedge on a pre-flight load failure

- `SF/views/grpcrequest/state.ts:307-325` (`call`): `status = 'running'`, `opId`, `lastCallId`
  set, then `await variablesForSend` and `await loadDynamicGenerator()` outside the `try`. A
  rejection leaves the tab `running` for good (Call disabled, Stop cancels an op Go never saw).
  A tab closed in that window still issues `control.grpcCall`; there is no `findGrpcRequestTab`
  check before the call (the HTTP fix of P108 F8 has no gRPC twin here).
- `:217-227` (`loadSchema`): `status = 'loading'`, then `await apiIdsForTab` outside the `try`. A
  rejection leaves the schema `loading` and the rejection unhandled from the debounced watcher;
  Call stays disabled (`methodResolved` false) until another source edit or Reload.
- Fix: same as F15: move the awaits inside each `try`; re-check
  `findGrpcRequestTab(tabId) && rt.opId === opId` (and `rt.genId === myGen`) before the bridge
  call. Extend `grpc-stream-terminal-race` or `grpc-schema-supersession` spec.

### F22 low, code-read: message rows keyed by index; at the 10,000 cap every batch remounts expanded editors

- `SF/views/grpcrequest/ResponsePane.vue:371-373` keys rows `:key="entry.row.index"` while the
  virtualizer's own `getItemKey` uses `seq`. Past `MAX_LIVE_MESSAGES` each batch splices the head,
  so every index now holds another message. An expanded row's `MonacoHost` unmounts at its old
  index and a new Monaco editor mounts at the new one, per batch, losing its scroll and selection;
  `messageHosts` (keyed by seq) keeps pointing at reused instances.
- Fix: `:key="entry.m.seq"`.

### F23 low, code-read: gRPC Beautify fails silently

- `SF/views/grpcrequest/GrpcRequestView.vue` `onBeautify`: invalid JSON (`result.ok` false) or a
  worker failure (`.catch(() => null)`) does nothing and shows nothing. HTTP's
  `RequestBodyPane.onBeautifyBody` shows `beautifyError` for the same case.
- Fix: a `beautifyError` ref and inline alert, cleared on message edit, as in `RequestBodyPane`.

### Refuted or clean in block 4

- Closed gRPC tab mid-call: `noteGrpcCallRecorded` reaches `createHistoryStore.noteRecorded`,
  whose `findTab` guard returns before `ensure`; streaming events for a removed runtime are
  dropped by the `Object.keys(runtime)` scan. No runtime leak.
- `applyGrpcEvent` ordering: `lastCallId` match survives the control-plane return landing first;
  `notifiedCallId` dedupes history notify; a superseded call's events no longer match.
  `ensureGrpcCallSubscription` subscribes once per store lifetime.
- Failed unary calls are not recorded by Go (`Partial` is set only for server streams,
  `SI/grpcclient/errors.go:21-29`), so the catch path not noting history is correct.
- Live `messages` computed re-spreads up to 10,000 rows per batch: ~0.6 ms per recompute
  measured in Bun (scratch probe); not reported.
- Truncated stored messages are never `JSON.parse`d; message JSON goes to a read-only Monaco
  model as text. Status message, header and trailer values render via interpolation.
- All 5 components single `<script setup lang="ts">`, no `<style>`.

## Findings (block 5, tests and cross-cutting)

### F24 low, design decision: three server-state caches still hand-rolled outside TanStack Query

- `SF/views/httprequest/cookies.ts` (per-tab list, `loading`, `fetchSeq`), `SF/api/state/history.ts`
  (`createHistoryStore`: `entries`/`loading`/`error`, `latestSeq`/`staleSeq` retry), and the gRPC
  schema runtime (`SF/views/grpcrequest/state.ts:120-260`, `genId`). CLAUDE.md routes server state
  fetched over the bridge, with loading/error/cache handling, through TanStack Query. F2, F3 and
  F18 are races of exactly the kind keyed queries remove (cookies keyed by URL, history by scope,
  schema by source).
- Too large for the point fixer: needs a decision and its own `SPEC.md` phase (key design,
  invalidation from send/call completion, the P8 D11 lazy-when-hidden rule as `enabled`).
  F2/F3/F18 stay point fixes in the meantime.

### Tests (no findings)

- 13 unit specs: all import and drive current P112-era code (`apiQueries`, store mutations,
  `createHistoryStore`, `useGrpcRequestViewStore`, `useCookiesStore`, `mergeDrafts`). They guard
  races, supersession, expiry, eviction and draft merge, which meets the CLAUDE.md bar. A few cases
  read close to restated bodies (`api-collections-search-debounce` test 2,
  `history-runtime-reactivity` tests 4 and 6); CLAUDE.md's test rule applies going forward, not as
  retroactive cleanup, so not reported.
- Guard gaps tied to findings: F1 (reveal loop cancellation), F7 (secret draft reseed, extend
  `api-draft-merge`), F15/F21 (pre-flight failure and close, extend `http-send-tab-close-leak`,
  `grpc-stream-terminal-race`). The fixer adds these with the fixes.
- 16 UI specs run (`build:test:studio`, Playwright `--project=ui`): 133 passed, 0 failed (2.1 min).
  `api-cross-window-sync` covers environments, variables and tree broadcasts, not a cross-window
  rename (F17). `http-timeline` "a failed send carries the timeline" covers only a tab with no
  earlier response (F20 is the other case). `credential-reveal` and `secrets` exercise the
  connection dialog only; their API half is nil (secret reveal for variables is covered by
  `api-secret-reveal-isolation` and `http-variables`).
- 2 perf specs (`perf/http-response*.spec.ts`, opt-in `perf:http:studio`) select
  `.response-body .monaco-host`, both present in current `ResponsePane.vue`/`MonacoHost.vue`, so they
  still measure the P163 path. Not run (opt-in, no claim depends on them).
- 1 visual spec (`visual/http-request-view.spec.ts`): read, not run (no visual claim made).

## Summary

24 findings: 0 high, 8 medium, 16 low.

- Medium: F1, F7, F8, F9, F15, F16, F17, F21. Verified by probe: F1, F7, F15, F16.
- Routed (`needs-other-part-file`): F6 (`SI/bridge/collections.go`, Part 6).
- Needs design decision: F24 (own `SPEC.md` phase).

### Ranking

1. F15 medium (verified) 2. F16 medium (verified) 3. F7 medium (verified) 4. F1 medium (verified)
5. F8 medium 6. F21 medium 7. F17 medium 8. F9 medium 9. F6 low (routed) 10. F18 low 11. F10 low
12. F11 low 13. F3 low 14. F2 low 15. F20 low 16. F19 low 17. F22 low 18. F13 low 19. F12 low
20. F14 low 21. F4 low 22. F5 low 23. F23 low 24. F24 low (design).

## Coverage

- Block 1 reviewed in full: `apiQueries.ts`, `collections.ts`, `variables.ts`, `draftMerge.ts`,
  `history.ts`, `revealExpiry.ts`, `reveal.ts`, `curl.ts`, `variableCompletion.ts`, `raw.ts`,
  `saveRequestDialog.ts`, `dynamicValues.ts`, `api/tabs.ts`, `api/menus.ts`. Go contract read:
  `SI/bridge/{apidata,collections,variables}.go` emission sites.
- Block 2 reviewed in full: all 19 `SF/api/*.vue`. Contract read: `PW/util/useSortableReorder.ts`,
  `PW/util/clipboard.ts`, `SI/storage/repos/variables.go` (`Upsert`, `ApplyBulk`).
- Block 3 reviewed in full: `state.ts`, `cookies.ts`, `history.ts`, `files.ts`,
  `useResponseBody.ts`, `HttpRequestView.vue`, `ResponsePane.vue`, `ResponseDiffDialog.vue`,
  `TimelinePane.vue`, `RequestSettingsPane.vue`, `RawExchangePane.vue`, `RequestBodyPane.vue`,
  `ResponseHistoryList.vue`, `CookiesPane.vue`. Skimmed (thin wrappers over Part 11's
  `FieldRowsTable`, no own logic beyond row patching): `FormDataTable.vue`, `QueryParamsTable.vue`,
  `BinaryBodyPicker.vue`, `RequestHeadersTable.vue`, `UrlEncodedTable.vue`. Contract read:
  `PW/state/createTabsStore.ts` hydrate, `PW/workers` `useParseWorker`, `SI/httpclient/options.go`.
- Block 4 reviewed in full: `state.ts`, `history.ts`, `GrpcRequestView.vue`, `ResponsePane.vue`,
  `SchemaBrowser.vue`, `CallHistoryList.vue`, `GrpcMetadataTable.vue` (thin `FieldRowsTable`
  wrapper). Contract read: `SI/bridge/grpc.go` recording paths, `SI/grpcclient/errors.go`.
- Block 5 reviewed: 13 unit specs (all read, all run), 16 UI specs (test lists read, all run),
  2 perf specs (read), 1 visual spec (read).
- No unexplained gaps. Skimmed only: the five HTTP row-table wrappers and `GrpcMetadataTable.vue`
  (thin `FieldRowsTable` callers, Part 11 owns the logic). Out of scope per plan §9: Part 7/9/11/
  12/13 internals beyond the contracts named per block.
