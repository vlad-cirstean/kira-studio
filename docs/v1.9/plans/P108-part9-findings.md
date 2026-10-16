# P108 Part 9 review findings — Studio API client UI

Scope: `apps/kira-studio/frontend/src/{api/**, views/httprequest/**, views/grpcrequest/**}` against
plan `P108-part9-studio-api-client-ui.md` §4.1–§4.10. Paths below are relative to
`apps/kira-studio/frontend/src/` unless absolute from repo root. Known open items F16 (unmasked
bodies/gRPC messages/cookies) and D8 (shared reveal grace) not re-reported.

"Verified" marks a finding reproduced at runtime in a scratch bun harness driving real store code.
"Code-read" marks one traced through source only.

## F1 — history store `load` retry loops forever on overlapping loads (HIGH, verified)

`api/state/history.ts:80–116` (retry at 108), `noteRecorded` at 131–143.

Bug: `load` bumps `latestSeq` on entry, then after its await retries (`void load(tabId)`) whenever
`latestSeq !== mySeq`. Two overlapping loads each see the other's bump. Each retry bumps again, so
the pair keeps superseding each other indefinitely. `loading` stays true and `entries` never
commits.

Reachable: any two history refreshes in flight together while History pane visible — two quick
sends, a delete plus a send, `ensureFresh` racing `noteRecorded`. Deterministic for a gRPC
server-streaming call when the control-plane return lands before the terminal event:
`views/grpcrequest/state.ts:336` (`call()` return path) and `:186` (`applyGrpcEvent` done) both call
`noteGrpcCallRecorded` for the same call. Harness: two `noteRecorded` 1 ms apart, FIFO 5 ms replies —
109 list calls in 300 ms, `loading` stuck true, `entries` null. Constant bridge traffic until tab
closes.

Fix: separate "superseded by a newer load" from "marked stale during this load". Newer load wins:
older result discarded, no retry. Retry only when `noteRecorded`'s not-visible stale bump happened
after this load started and no newer load exists. Clear `loading` only from the load that commits.
Also call `noteGrpcCallRecorded` once per call: drop one of the two sites (keep terminal event for
streaming, return path for unary), or guard on `lastCallId`.

## F2 — `ensureVariablesLoaded` has no dedupe or sequencing (verified)

`api/state/variables.ts:309–312`; `loadVariableSetRows` at 271–279.

Bug: `if (!ownerId || listCache[key]) return; listCache[key] = await control.variablesList(...)`.
Concurrent callers each fire a request. Slow first reply lands after a later
`loadVariableSetRows` (post-edit refresh) and overwrites fresh rows with pre-edit rows. Harness:
slow ensure started, `loadVariableSetRows` wrote NEW, ensure then wrote OLD into `listCache`.

Reachable: open request tab (ensure fires from view watch) while variable-set tab edits same scope;
several request tabs mounting together. Stale plain values then substitute into every send until
next edit of that scope.

Fix: per-key in-flight promise map so concurrent ensures share one request. Per-key generation
counter bumped by `loadVariableSetRows`; ensure writes only if generation unchanged since it started
(or key still absent).

## F3 — rows reload blanks a revealed secret's draft; eye then looks dead (verified)

`api/VariableSetView.vue:154–172` (`syncDrafts`, run by `watch(rows, …)`), reveal mirror watch
181–193; `api/state/variables.ts:494–507` (`revealVariable`).

Bug: `syncDrafts` resets every secret draft to `''` on any `rows` change. Revealed value stays in
`revealedValues[id]`. Pressing eye again re-reveals the same string; `revealedValues[id] = value` is
a same-value set, so the mirror watch never fires and draft stays `''`. Row shows reveal state with
empty field until expiry (up to 5 min). Harness: watch fired once, draft stayed `""` after re-reveal.

Reachable: reveal secret A, then edit/add/reorder any other row (reload of `rows`), or Git restore
of another row's history entry.

Fix: in `syncDrafts`, seed a secret row's draft from `revealedValues[id]` when present (same mirror
rule as the watch, keeping `valueTouched` false). Alternative: `onReveal` writes returned value
into draft directly rather than relying on the watch.

## F4 — restored request tab never loads its saved side (code-read)

`api/state/collections.ts:150–178` (`fetchSavedRequest`/`savedRequestFor`,
`fetchSavedGrpcRequest`/`savedGrpcRequestFor`); `views/httprequest/HttpRequestView.vue:171–173`;
`views/grpcrequest/GrpcRequestView.vue:124–126`; `views/shared/request/useRequestTabSave.ts`;
repo `packages/api-core/src/http/saved.ts:72`.

Bug: saved side is fetched only from `CollectionsTree` `onOpen`. After app restart (tab restored
with `itemId`) `savedRequestFor` returns null. `isDirty(null, …)` returns false, so the dirty dot
never lights. `onSave` treats null as unsaved and opens Save as…, which creates a duplicate row and
rebinds the tab to it.

Reachable: every restored saved request/gRPC tab; also a tab reopened via any path other than tree
click.

Fix: when a request view mounts (or `itemId` changes) with `itemId` set and no cache entry, call
`fetchSavedRequest`/`fetchSavedGrpcRequest`. Distinguish "not loaded yet" (disable Save, no dirty
mark) from "orphan" (item deleted — Save as is right there).

## F5 — `collectionIdFor` is `''` until CollectionsPanel mounts (code-read)

`api/state/collections.ts:639–642`; `initCollections` callers only `api/CollectionsPanel.vue:40`
and `VariableSetView`; repo `packages/workbench/src/components/WorkbenchShell.vue:137` mounts the
panel slot only under `v-if="projectVisible"`.

Bug: `collectionIdFor` looks the item up in loaded `items`; empty before `initCollections`. With
project panel hidden (persisted `layout.panel.project.visible=false`) or app opened outside Api
mode, a restored request tab resolves with `collectionId ''`. Collection plain variables drop from
stage 1 and Go resolves no collection secrets — `{{name}}` goes out literal or unresolved-warned.
Affects `send`, gRPC `call`, `loadSchema`/`resolveForDescribe`, `resolveForExport` (Copy as cURL).

Fix: request views call `initCollections()` on mount (as `EnvironmentSelect` calls
`initVariables`). Or `send`/`call`/resolvers await collections load when tab has `itemId` and
items not loaded.

## F6 — Cookies pane and badge use unresolved URL (code-read)

`views/httprequest/HttpRequestView.vue:385–396` (count watch), `:758–764`
(`CookiesPane :url="tab.state.url"`); `views/httprequest/cookies.ts`; Go
`internal/bridge/http.go:210–228` takes raw URL, no variable resolution.

Bug: `{{baseUrl}}/login` parses to no host, so pane and badge always show zero cookies for a
templated URL, though the jar holds them from the resolved send. Delete uses the same raw URL.

Reachable: any request whose host comes from a variable — the normal Postman-style case.

Fix: pass stage-1 resolved URL (same resolution `send` uses). When host is still a deferred secret,
show a note in the pane ("host uses a secret; cookies not shown") or pass scope ids to Go and
resolve there.

## F7 — cookies store: no ordering, timers outlive tab (code-read)

`views/httprequest/cookies.ts:21` (cleanup), `:33` (`fetchCookiesNow`), `:50–61`
(`debounceTimers`), `:68` (`clearCookies`).

Bug:
- `fetchCookiesNow` writes whatever reply lands last. Late reply from an older URL overwrites a
  newer one, or undoes `deleteCookie`'s refreshed list.
- Cleanup does not clear `debounceTimers[tabId]`. Timer firing after close recreates
  `cookiesRuntime[tabId]` for a dead tab.
- `clearCookies` empties process-wide jar but refetches only calling tab; other open tabs keep stale
  counts.
- Named decline of `useDebounceFn` (per-key store timers) no longer holds: sole caller is
  `HttpRequestView`, one instance per tab.

Fix: per-tab request sequence, write only latest. Move debounce into `HttpRequestView` as
`useDebounceFn` cancelled on unmount (GrpcRequestView schema-load pattern), or clear timer in
cleanup. After clear, refetch (or zero) every tab's runtime.

## F8 — closing HTTP tab mid-send leaks op and history runtime (code-read)

`views/httprequest/state.ts:145–147` (cleanup is only `delete runtime[tabId]`), `:197–206`
(post-await path); `api/state/history.ts:131–143` (`noteRecorded`).

Bug: gRPC cleanup calls `stopOp`; HTTP does not. Send keeps running in Go and records history. On
completion `rt.opId !== opId` still passes (captured `rt` object), so `noteSendRecorded` and
`noteSendCompleted` run for a closed tab. `noteRecorded` calls `ensure()`, recreating history
runtime and seq entry for the dead tab; never cleaned again.

Reachable: close tab during slow request (long-poll, large download, timeout wait).

Fix: cleanup calls `stopOp(runtime[tabId])` before delete. `send` post-await returns early when tab
no longer exists. `noteRecorded` returns early when tab is gone (no `ensure()` for unknown tab).

## F9 — incognito tab can point at deleted environment; `listCache` never evicted (code-read)

`api/state/variables.ts:92–99` (`incognitoEnvByTab`, `environmentIdForTab`), `:148–152`
(`deleteEnvironment`); `api/state/collections.ts:397–416` (`deleteRow`).

Bug: `deleteEnvironment` closes the env's variable-set tabs and reloads the list, but leaves
`incognitoEnvByTab` entries holding the deleted id, and `listCache[environment:<id>]` holding its
rows. Incognito tab keeps substituting deleted env's plain values in stage 1; Go resolves no
secrets for the missing env, so secrets go unresolved. Selector shows nothing selected while
send uses the old values. Deleting a collection leaves `listCache[collection:<id>]` likewise.

Fix: on env delete, drop matching incognito overrides (fall back to app-wide selection) and delete
`listCache[environment:<id>]`. Collection delete drops `listCache[collection:<id>]`.

## F10 — mutations, import and export have no error path (code-read)

`api/state/collections.ts` (`importCollection` 570–596: try/finally, no catch, no reload on
failure; rename, `deleteRow` 397, `duplicateRow` 420, `submitSaveDialog` 486–539, `saveRequest`
542); `api/VariableSetView.vue` `commitDraft` 266–302 (upsert); environment CRUD in
`api/state/variables.ts`. Callers `void` the promise; no global `unhandledrejection` handler.

Bug: any bridge error vanishes. Import of a bad file shows nothing. F19's error ("partial
collection remains visible and must be deleted manually") is never shown, and tree is not
reloaded, so the partial collection is not visible either until something else reloads. Failed
rename/delete/duplicate/save/variable upsert leaves UI claiming success (draft looks committed).

Fix: catch at each action, surface via an error state — `state.error` on the collections store
rendered in the ImportReportStrip area; `setVariableSetError` for variable-set edits; env errors
in selector's own strip. Import always calls `loadCollections` in `finally`.

## F11 — Export ignores `skippedGrpc` (code-read)

`api/state/collections.ts:610–628`; Go `internal/bridge/collections.go:401–410`
(`ExportReport{SecretCount, SkippedGrpc}`); bindings `models.ts:326`.

Bug: Postman format cannot hold gRPC requests, so Go skips them and reports the count. Frontend
reads only `secretCount`. Zero frontend reads of `skippedGrpc`. Exported file silently omits gRPC
requests — the case Go's own comment calls "the worst possible reading".

Fix: include `skippedGrpc` in `exportWarning` ("N gRPC requests were not exported — Postman has no
gRPC format"), shown with the secret-count text.

## F12 — no cross-window invalidation; hand-rolled server-state caches (code-read)

`api/state/variables.ts` (`listCache`, environments list, active env), `api/state/collections.ts`
(tree, saved-request caches).

Bug: edits in window B never reach window A. `listCache` never refetches once filled, so A sends
stale plain values. Active environment (`is_active` app-wide) stays stale in A. Tree stale until
manual reload. All of this is server state fetched over the bridge with loading/error/cache logic,
which CLAUDE.md routes through TanStack Query; no named decline exists for these caches.

Fix: too large for this chunk. Add a named SPEC.md follow-up phase: Go broadcasts an api-data-changed
event per scope, and collections/variables/environments move to TanStack Query with that event as
invalidation. F2/F9 point fixes stay in this chunk.

## F13 — `openHistoryMenu` has no stale guard (low, code-read)

`api/state/variables.ts:542–555` (write at 554).

Bug: `historyMenuState.entries = await control.variablesHistory(variableId)` writes whatever
returns. Opening row A's menu then quickly row B's can show A's entries in B's popover; Restore
then acts on A's entry id under B. Closing the variable-set tab with popover open leaves
`historyMenuState` populated.

Fix: capture `variableId`; write only if `historyMenuState.variableId` still equals it. Reset menu
state in the tab cleanup.

## F14 — gRPC Call before schema load sends streaming method as unary (low, code-read)

`views/grpcrequest/state.ts:278–280`; Call button `views/grpcrequest/GrpcRequestView.vue:379`
(disabled only on `running || !service || !method`); Go `grpcclient/call.go:131`.

Bug: `streaming = findMethod(schema, …)?.serverStreaming ?? false`. Schema not loaded yet (150 ms
debounce, slow reflection) or load errored: server-streaming method goes as unary; Go refuses
with `is a streaming method, not unary`. Error names the problem but the user did nothing wrong.

Fix: disable Call until `findMethod` resolves; or have `call` await schema load when missing.
Client/bidi streaming methods: disabled Call with reason text beyond the "(stream)" badge.

## F15 — alert-tone style block duplicated across 12 chunk files (low, code-read)

`.strip-warn`/`.strip-note` (+ `-text`) `@apply`-only rules in: `api/BulkVariablesEditor.vue`,
`api/CopyAsCurlDialog.vue`, `api/EditRawRequestDialog.vue`, `api/ImportCurlDialog.vue`,
`api/ImportReportStrip.vue`, `api/SaveRequestDialog.vue`, `api/VariableSetView.vue`,
`views/grpcrequest/ResponsePane.vue`, `views/httprequest/RawExchangePane.vue`,
`views/httprequest/ResponseDiffDialog.vue`, `views/httprequest/ResponsePane.vue`,
`views/httprequest/TimelinePane.vue`. 21 copies app-wide.

Bug: same Tailwind-expressible block copied per file; drift risk, against CLAUDE.md's Tailwind rule.

Fix: `warn`/`note` variant on shadcn `Alert` (ui/alert lives in stream B — hand off), then delete
per-file blocks. Short of that, inline utilities at each Alert.

## F16 — collections store holds save-dialog state (low, code-read)

`api/state/collections.ts:70–89` (`CollectionsState`), `:126–131`, `openSaveDialog` 460,
`closeSaveDialog`, `submitSaveDialog` 486–539.

Bug: one-store-one-concern. Collections store owns tree, search, selection, request caches,
import/export report, and save-dialog state. Every sibling dialog has its own store
(`useImportCurlStore`, `useCopyAsCurlStore`, edit-raw, dynamic values).

Fix: move save dialog into `useSaveRequestDialogStore`; `submitSaveDialog` calls collections
actions. `listCache` concern in `useVariableSetStore` folds into F12's follow-up.

## F17 — stale comment in ImportReportStrip (low, code-read)

`api/ImportReportStrip.vue:12`: says "an auth block that is kept but never applied". Since F8 the
auth values are not kept (Go WarnAuthInert text: "values were not kept",
`internal/bridge/collections.go:255`).

Fix: reword comment to match current behavior.

## F18 — gRPC history view drops per-message `truncated`; request-message flag unread (code-read)

`views/grpcrequest/ResponsePane.vue:84–92` (history `messages` map keeps `seq/json/wireBytes/
offsetMs` only); repo `packages/shared/domain/grpc-history.ts:30–46`; Go
`internal/storage/repos/grpc_history.go:16,95–98` (stored message cut at 64 KiB).

Bug: plan §4.7 lists gRPC message `truncated` as a check item. A stored message over 64 KiB is cut
and flagged, but the view drops the flag and renders the prefix in Monaco as if complete — invalid
JSON with no note, next to a header showing the full `wireBytes`. HTTP's equivalent has a note
(`http-history-truncated`). `requestMessageTruncated` has zero frontend readers; gRPC history does
not show the stored request message at all. No unguarded `JSON.parse` of message text (Monaco gets
raw string) — that half of the check holds.

Fix: carry `truncated` through the map; show per-message note ("stored copy cut at 64 KiB") in the
message header or detail. Either display the stored request message with a `requestMessageTruncated`
note, or record in the plan that it is intentionally not shown.

## Checked, nothing real

- §4.1 plaintext holders: Copy as cURL builds from current `currentCurlCommand` each time. No fourth
  plaintext holder: `console.*` logs only adopt errors; no `v-html`. `clearRevealed` on any tab
  close is fail-safe, no loop. Untouched reveal commits `null` via `valueTouched`, so reveal alone
  never rewrites a secret.
- §4.2 two-stage agreement: F5 env-first secret lookup (`curl.ts:247–261`) matches Go; reveal
  error leaves name literal. F6 nested deferred secret reported by stage 1, filled by
  `applySecretValues`. Duplicate-name order agrees (dense `sort_order`; `List` orders
  `sort_order, name`, `mergeSecrets` orders `sort_order`). Plain-first/secret-second pair agrees.
- §4.6 gRPC: Describe error shows and Reload re-enables — no stuck state. Unary emits no events,
  so no duplicated messages. `loadSchema` genId guard correct.
- §4.7 import/curl warnings: WarnAuthInert rendered unaltered; curl warnings shown by kind; no
  `v-html`/`innerHTML`.
- §4.8 conventions: every tooltip-wrapped disabled trigger uses `TooltipDisabledTrigger`; every
  component is `<script setup lang="ts">`, single script block; remaining style blocks are P99's
  accepted `@apply` conversions, apart from F15.
- §4.9 performance: live gRPC messages capped (`MAX_LIVE_MESSAGES`) with O(1) byte total; stored
  view capped at 100. `ResponseDiffDialog` diffs via Monaco's diff editor, beautify memoized per
  body. `variableSupport` merges once per call, not per keystroke. `ensureVariablesLoaded` per
  watch fire returns early once cached (its race is F2). Nothing beyond F1's request storm and
  F7's redundant fetches.
- §4.10 tests: the 8 unit specs (`tests/unit/api-*`, `grpc-*`, `history-runtime-reactivity`) run
  green — 24 pass — against current code paths. `history-runtime-reactivity.spec.ts` test 7 covers
  load vs stale-mark, not two overlapping visible loads; F1's fix needs that case added. F2's
  generation guard qualifies for one targeted test too. No other gap.
- `loadDynamicGenerator` throwing before `try` (stuck running): not realistic — bundled chunk.
