# P170 studio-frontend findings

Review of P168 Parts 10-13 fixes (API client UI; grid and shared view machinery; console, editor,
parse worker and per-kind views; Studio shell, stores and UI-test harness). Report only; no fixes.

- Base commit: `f40cd35` (P168 start).
- Reviewed HEAD: `1ff382e` (branch `p168-stream-c`, equal to local `v2.0`).
- Scope: `git diff f40cd35..HEAD` over `apps/kira-studio/frontend/**`, `apps/kira-studio/tests/**`,
  `packages/api-core`. Every fixer commit read in full, plus one-hop callers and the tests added.
- Fix context: deleted findings files `P168-part10/11/12/13-findings.md` read from `886eff1^`,
  `8b20119^`, `844e132^`, `6751569^`.
- Parked P172-P180 items not repeated.

Counts: 0 high, 2 medium, 6 low (one DESIGN-DECISION). No routed item.

## F1. medium. Commit guard (Part 11 F6) leaves five staging paths open; edits staged mid-commit are still dropped

- `apps/kira-studio/frontend/src/views/grid/pendingChanges.ts:124-233` (stage functions have no
  committing check), `views/grid/SlickGridHost.vue:2439-2453` (dock watch sources),
  `:2505-2519` (dock `onEdit`/`onRevert` closures), `:204-214` and `:1612-1615` (insert-row
  inputs), `:2005-2006` (`editorCtx.commit`), `:2380-2382` (`canEditTableReactive` watch),
  `views/grid/menu.ts:466-476` (Revert row(s)).
- Fix `11ef40e` gates `isWritable()` and the toolbar. Part 11 F6 scenario B (an edit staged during
  the commit is cleared by `clearPending` after `data.mutate`, or by the reload's `clearPending`)
  still happens through paths that do not read `isWritable()` at action time:
  1. Cell editor dock. `onEdit`/`onRevert` are closures evaluated when the selection is published;
     the publishing watch has no committing source, so they stay defined during the commit. Dock
     Save, Ctrl/Cmd+Enter, the focusout auto-stage (`CellEditorView.vue:316-321`), the
     unmount auto-stage (`:328-330`) and the cell-switch auto-stage (`:228-236`) all stage.
     `dockPageStale` only catches the window after the page is replaced.
  2. Insert-row `<input>`s. Rendered by `cellFormatter` with no writability check;
     `onInsertGridInput` stages every keystroke. Typing into an insert row while its INSERT is in
     flight edits a value already sent, then `clearPending` drops it; the row lands with the old
     value.
  3. Open inline editor. Committing flips `canEditTableReactive` to false; the watch calls
     `grid.setOptions({ editable: false })`, and SlickGrid's `setOptions` runs
     `prepareForOptionsChange()` → `getEditorLock().commitCurrentEdit()`
     (`node_modules/slickgrid/src/slick.grid.ts:1380-1386`). An inline edit left open when the user
     clicks Commit is therefore staged by the guard itself, after `buildPlan`, and then cleared.
  4. Revert row(s) row-menu item: disabled only by `hasPendingChange`, never by committing; it
     un-stages ops already on the wire, so the screen shows the row reverted while the commit
     writes it.
  5. A menu opened before the commit and used during it (Set NULL, Duplicate row(s), Delete row(s))
     carries `canEdit`/`canDelete` computed at open time.
- Scenario: user commits a large change set on a slow link, then edits a cell in the dock and
  clicks another cell. The edit shows as pending, then vanishes when the commit returns, with no
  message. Same for an inline editor left open when Commit is clicked.
- Fix: put the guard in the store, not in each caller. While `committingState[tabId]` is set,
  `stageEdit`, `stageNull`, `stageDelete`, `addInsertRow`, `stageInsertValue`, `discardCellEdit`,
  `discardRowChange`, `discardInsertRow`, `duplicateAsInsert` refuse and the host reports
  "Edit not staged: a commit is in progress" (same channel as `dockPageStale`). In `DataView.vue`
  `onCommit`, commit the grid's open inline edit before `commitPending` (a host hook, like
  `registerGridHost`), so a typed-but-open edit is included instead of lost. Make insert inputs
  `readOnly` while committing. Add `() => pendingChangesStore.isCommitting(props.tabId)` to the dock
  watch sources. Extend `grid-commit-double-submit.spec.ts`: a `stageEdit` during the in-flight
  commit is refused, and pending state after the commit holds nothing staged mid-flight.
- Evidence: code-read; SlickGrid `setOptions` path confirmed in source.

## F2. medium. New-document Save double-submits; two documents are inserted

- `apps/kira-studio/frontend/src/views/documents/DocumentView.vue:330-339` (`commitCreate`),
  `:1017` (Save button), `views/shared/immediateMutation.ts:21-56` (no in-flight guard).
- Same bug class as Part 11 F6, left in the sibling immediate-mutation view. `commitCreate` has no
  busy flag and the Save button is never disabled. A double click, or a click during a slow insert,
  runs `saveNewDocument` twice; each is an `insertOne` with no `_id`, so the server assigns two ids
  and both documents land. `commitEdit` (`:622-633`) has the same shape but is a whole-document
  replace, so a second run is idempotent; only the insert duplicates. Stream compose
  (`StreamComposeMessage.vue:32`), Generate data and the key-value Save paths already guard.
  Pre-existing (not a P168 regression); reported because P170's brief asks for the same bug class
  left in siblings.
- Fix: a `creating` ref in `DocumentView.vue`; `commitCreate` returns early while set, the Save
  button disables on it. Optional: the same for `commitEdit` to stop a redundant second write.
- Evidence: code-read.

## F3. low. Curl import drops the URL when the first argument ends in `/curl` (regression from `fab7dca`)

- `packages/api-core/src/http/curl/tokenize.ts:76-78`.
- `fab7dca` (P168 Part 7 F19) now strips the command word before `shlex`. The old post-split strip
  (`argv[0] === 'curl' || argv[0].endsWith('/curl')`) still runs, now against the first real
  argument. Probe (bun, scratchpad, deleted): `tokenize('curl https://example.com/tools/curl')`
  returns `argv: []`; before the fix it kept the URL. `curl curl -X GET https://x.test` also loses
  the second `curl`. The import then yields a request with no URL and no warning.
- Fix: delete the post-split strip; the pre-split `isCurlCommandName` strip covers every case it
  handled. Add the probe as a `curl-cases.json` case.
- Evidence: verified by probe.

## F4. low. Re-queued focus request (Part 11 F9) can fire on an unrelated later load

- `apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue:2286-2290` (and the mount path
  `:2200-2204` it now mirrors), `views/grid/focusRequest.ts:33-37`.
- The page watch now re-queues a request `applyCellFocusRequest` could not apply. With the
  other-tab rebuilds gone (`lastAppliedPage`), the remaining failure is this tab's own page lacking
  `req.row` (an Edit referenced row whose filtered page came back empty: the referenced row was
  deleted). The request then stays pending past a successful load; `clearCellFocus` runs only on a
  failed load or tab close. The next load (user clears the filter) consumes it, selects row 0 and
  opens the inline editor (`edit: true`) unasked.
- Fix: re-queue only when there is no page yet (`!getPage(props.tabId)`); when a page landed and
  still lacks the row, drop the request (and optionally report "Referenced row not found").
- Evidence: code-read.

## F5. low. Failed dynamic-generator and faker chunk loads are memoised forever

- `packages/api-core/src/http/dynamic/catalog.ts:241,256-259`,
  `apps/kira-studio/frontend/src/views/grid/fakeData/generate.ts:25-33`.
- Part 12 F6 (`33473c9`) fixed this for `sql-formatter` (`loadSqlFormatter` clears the memo on
  rejection). Part 10 F14 (`510214f`) surfaced a failed `loadDynamicGenerator` but left its memo
  holding the rejected promise, so every later HTTP or gRPC send that references `{{$…}}`, and the
  Dynamic values dialog, keep failing until restart. `getFaker` has the same shape.
- Fix: the `loadSqlFormatter` pattern in both: on rejection reset the memo, then rethrow.
- Evidence: code-read. Low: chunks are local assets, so a load failure is rare.

## F6. low. Filters dialog shows the previous draft while the saved set loads

- `apps/kira-studio/frontend/src/project/FiltersDialog.vue:54-81`.
- `5c9c132` seeds the draft after `loadVisibility` resolves, but never resets it on open. For a
  connection whose filters are not cached, the dialog shows the checkboxes of the last connection it
  was opened for until the load lands, and any toggle made meanwhile is overwritten by the seed.
  Save is disabled while loading, so nothing wrong is written.
- Fix: set `draft.value = EMPTY_VISIBILITY` (or disable the lists) at the top of the watch while
  `loading` is true.
- Evidence: code-read.

## F7. low. Window-flush spec asserts an exact save count that a slow run breaks; a comment now heads the wrong test

- `apps/kira-studio/tests/ui/mode-switch.spec.ts:181-217`.
- `48ce095` asserts `savesWith1000() === savesBefore + 1`. `flushPendingTabState`
  (`packages/workbench/src/state/createTabsStore.ts:244-247`) cancels the debounce and saves
  unconditionally. If more than the 1 s debounce passes between the page-size click and the emitted
  flush (loaded CI box), the debounced save lands first and the flush saves again: count +2, test
  fails though the product is right. The file already imports `installFakeTimers`.
- The new test was inserted between the P22 D12/F20/F21 comment block (`:173-180`) and the test it
  describes ("a window boots into whatever mode windowsEnsure answers with"), so that comment now
  sits above the flush test.
- Fix: assert a pending-state save lands before the ack (drop the exact count), or freeze time
  with `installFakeTimers`; move the new test below the windowsEnsure test.
- Evidence: code-read. UI run of the spec passed once on this machine.

## F8. low. DESIGN-DECISION: paste of comma-free multi-line text still spreads down the column

- `apps/kira-studio/frontend/src/views/shared/clipboardFormats.ts:179-183`.
- `8a5cb1c` deviated from Part 11 F14's fix: a rectangular single-column CSV parse still pastes as
  rows, to keep the same-app column copy. Text with newlines and no commas (a multi-line address,
  a short SQL snippet without commas) is a rectangular single column, so it still stages edits on
  the rows below the target, the F14 scenario. The two sources are indistinguishable from text
  alone. Options: keep (current), or treat single-column multi-line text as one value unless the
  clipboard came from this app (a private clipboard marker or a `text/html`/custom MIME flavour
  written on copy). User call.
- Evidence: code-read.

## Dropped candidates

- Nearest-rank p95 (`e464d6c`): index `ceil(0.95·40)−1 = 37` excludes exactly the two largest, as
  the comment says; p50 gates untouched; `perf.spec.ts` now uses the shared `percentile` with
  identical semantics. Correct.
- `settleFrames` replacing 400 ms / 100 ms sleeps: `tree.spec.ts` ran green (24 s).
- Search page identity (`c7b13a9`, `5d3dcf9`): `setPage` always replaces and freezes the page
  object, so an own-tab change always changes identity; nothing bumps `pageVersion` for the same
  tab without replacing its page (console keeps the counter, `bumpPageVersion` only there).
- Search filter uncapped rows (`600e87f`): every `searchState` writer either sets `matchedRows` or
  spreads the entry; the priority-window pass is followed by the full scan.
- Filters dialog test fails without the fix: the draft would be empty, so `filtersReplace` args
  would not equal `SAVED`.
- Double-submit unit spec, Copy-as-curl reveal-cancel spec, parse-client abort spec,
  beautify-depth spec: each fails without its fix (second `mutate` call; `vB` reveal; handler spy
  called; RangeError thrown).
- `MonacoHost` `cancelFill` flag reset: resets only when a fill is active; the editable external
  write sets `applyingExternal` after calling it.
- `tryParse`/`beautifyWith` catching every `RangeError` (also "Invalid string length"): needs a
  string past engine limits; label wrong only there.
- HTTP/gRPC pre-flight Stop leaves `rt.streaming` true: nothing reads `rt.streaming`.
- Cookie `deleteCookie` superseding a fetch started for a newly typed URL: needs a URL edit inside
  the delete await; the next debounced fetch corrects it.
- `reseedCommitted` reading `rows` after `mutateAsync`: TanStack v5 awaits `onSuccess`, which awaits
  `refreshApiQuery`'s refetch, so `rows` is fresh.
- `syncRequestTabNames` overwriting a local name: a request tab's name is not editable in the tab.
- Connection URI without password (`fc3953d`): Go `Create` keeps `in.Password` when the URI has
  none, and `resolve.go` injects it back for connecting.
- Collections tree arrow focus: sticky rows use `collection-sticky-row`, so the selector finds the
  virtual row.
- Mask cache cleanup: counts live under `['maskRuleCounts']`, not the `['maskRules']` prefix.
- Recents prune on `connectionsChanged`: same trust in the list as the existing stale-tab close.
- `RowActionButton` tab stop: the shared tooltip resolves via `closest('[data-tip]')`, so a focused
  enabled button still shows it.
- Copy-error strips in Definition/console not cleared on a later success: cosmetic, cleared on the
  next toolbar Copy or remount.
- Key-value Add/Edit via Enter while saving: `addKey` on an existing key fails instead of
  duplicating; edit is a replace.

## Coverage

- Part 10: `e162ab5`, `cfa4a85`, `665c5b5`, `7bd4158`, `dba1f89`, `27bec1c`, `5cd1161`, `4e9f88b`,
  `78f4c8f`, `0eebea3`, `57a97a2`, `3becea5`, `510214f`, `3d39a24`, `b4bf357`.
- Part 11: `600e87f`, `c7b13a9`, `4fe61d0`, `11ef40e`, `c68b1b0`, `8a5cb1c`, `8acf2eb`, test
  commits `891d314`, `568bbd4`, `c2df5e9`, `5c519e6`, `61e367f`.
- Part 12: `0044c74`, `33473c9`, `5d3dcf9`, `81c8099`, `42d7757`, `d6823cf`.
- Part 13: `caf03fe`, `fc3953d`, `5c9c132`, `d0726b1`, `4b262df`, `4a3684c`, `3cdef17`, `77abeb0`,
  `b3b9d31`, `a06c0c1`, `94c3f6e`, `e464d6c`, `90fc875`, `48ce095`.
- `packages/api-core`: `fab7dca` (Part 7's TS half; files in this area).
- Grid perf revert chain (`71d7c6a`, `b088feb`, `0eeedb6`, `4d65b17`, `b6843c1`): CSS only, read;
  nothing found.
- One hop read: `SlickGridHost.vue` (dock watch, page watch, paste, editor ctx), `CellEditorView.vue`
  staging paths, `menu.ts`, `immediateMutation.ts`, `focusRequest.ts`, `createTabsStore.ts` flush,
  `useConnectionGate.ts`, Go `connections/service.go` and `uri.go` (password path), SlickGrid
  `setOptions`.
- Checks run: `bun test apps/kira-studio/tests/unit packages/api-core/test` 1067 pass, 0 fail.
  `build:test:studio`, then Playwright `ui` project for `tree.spec.ts`, `mode-switch.spec.ts`,
  `datagrip-import.spec.ts`, `settings-apply-on-save.spec.ts`: 25 pass. `ui-timing` not run (load
  from parallel reviewers would skew it). Visual specs not run (known baseline gap, P168 result).
- Rules: every new or changed component stays `<script setup lang="ts">`; new UI uses shadcn-vue
  (`Alert`, `Popover`, `DropdownMenu`, `Button`) and VueUse (`useDebounceFn`); no new store mixes
  concerns. No violation found.
