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
- Fix: `if (!opts.findTab(tabId)) return;` after the await in both, or move `ensure`/`bumpSeq`
  in `load` behind a `findTab` check.

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

## Coverage

- Block 1 reviewed in full: `apiQueries.ts`, `collections.ts`, `variables.ts`, `draftMerge.ts`,
  `history.ts`, `revealExpiry.ts`, `reveal.ts`, `curl.ts`, `variableCompletion.ts`, `raw.ts`,
  `saveRequestDialog.ts`, `dynamicValues.ts`, `api/tabs.ts`, `api/menus.ts`. Go contract read:
  `SI/bridge/{apidata,collections,variables}.go` emission sites.
- Block 2 reviewed in full: all 19 `SF/api/*.vue`. Contract read: `PW/util/useSortableReorder.ts`,
  `PW/util/clipboard.ts`, `SI/storage/repos/variables.go` (`Upsert`, `ApplyBulk`).
- Blocks 3-5: pending.
