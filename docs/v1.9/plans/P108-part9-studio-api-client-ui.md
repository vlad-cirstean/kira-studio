# P108 Part 9 — review plan: Studio API client UI

Chunk A8, stream A position 8 (pre-plan §5.8). One Opus reviewer runs this plan and reports
findings. It fixes nothing. One Sonnet fixer then lands one commit per finding. Tree surveyed:
`d0436aa` (Part 8 result recorded, all 19 Part 8 fixes landed).

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SF` = `apps/kira-studio/frontend/src`,
`SD` = `packages/shared/domain`, `AC` = `packages/api-core`, `ST` = `apps/kira-studio/tests`,
`PW` = `packages/workbench/src` (alias `@workbench`), `PT` = `packages/theme/src` (alias `@theme`).

## 0. Method

- **`codegraph_explore`** for discovery, before any Read. Targets:
  - reveal and plaintext lifecycle: `runReveal` (`SF/api/reveal.ts`), `createRevealExpiry`,
    `useVariableSetStore.revealVariable`/`revealHistoryEntry`/`clearRevealed`/`clearRevealedHistory`,
    `useCopyAsCurlStore.revealSecretValues`/`findSecretVariableId`/`closeCopyAsCurlDialog`/
    `currentCurlCommand`, `VariableSetView.vue`'s `revealMirroredValue` watch and `syncDrafts`,
    `VariableRow.vue`'s `visible` watch, `VariableHistoryMenu.vue`;
  - stage 1 and the ids Go trusts: `mergedValuesAndSecrets`/`firstWinsByName`/`cachedVariables`/
    `ensureVariablesLoaded`/`loadVariableSetRows`, `collectionIdFor`/`itemRecord`,
    `environmentIdForTab`/`incognitoEnvByTab`, `send`/`resolveForExport` (`views/httprequest/state.ts`),
    `resolveForDescribe`/`loadSchema`/`call`/`applyGrpcEvent`/`ensureGrpcCallSubscription`
    (`views/grpcrequest/state.ts`);
  - hand-rolled server state: `useCollectionsStore` (`loadCollections`, `fetchSavedRequest`,
    `savedRequestFor`, `deleteRow`, `duplicateRow`, `submitSaveDialog`, `saveRequest`,
    `importCollection`, `exportCollection`), `useVariablesStore` (`loadEnvironments`,
    `initVariables`, environment mutations), `createHistoryStore` (`load`/`bumpSeq`/`noteRecorded`/
    `ensureFresh`/`del`/`clearAll`), `useCookiesStore`, the gRPC schema runtime (`genId`);
  - tab-kind and cleanup seams: `registerTabRuntimeCleanup` callers, `SF/state/tabKinds.ts` API
    entries (`duplicateState`, menus, incognito extras), `SF/api/tabs.ts` open/rename/close helpers.
  Blast radius of any proposed fix is checked the same way.
- **Read the Part 8 result first** (`docs/v1.9/SPEC.md` "P108 Part 8 result" and
  `plans/P108-part8-findings.md`). Several fixes changed what this UI receives: F4 (Describe
  timeout), F5 (undecryptable env secret now shadows), F6 (nested secret reported `deferred`), F8
  (Postman `auth`/secret-typed origin stripped at import), F9 (curl `-u` warning), F10 (`--json
  @file`), F13 (protojson error text), F19 (partial-import error). Check each against the UI half.
- **Premise correction, stated up front.** The pre-plan's watch line says P99 Part 3 moved this
  surface onto TanStack Query. It did not. P99 §10.2's inventory marks "Query: —" for all 39 files,
  and the P99 Part 3 result is styling and debounce only. `grep useQuery|useMutation|queryKey`
  over `SF/api`, `SF/views/httprequest`, `SF/views/grpcrequest` returns zero hits. No revealed
  secret lives in a TanStack Query cache anywhere in the app (reveals sit in three Pinia-held
  `reactive` maps). So "query key correctness" has no subject here. The stale-cache and
  invalidation question still stands, over the hand-rolled caches instead (§4.4). No part of the
  watch item is dropped; its subject changes.
- **Scratch replicas** in the session scratchpad, never in the tree, where a claim depends on
  runtime behavior: a `bun test` harness over a Pinia store with a fake `control` (race ordering,
  cache overwrite), or a Playwright run against `ST/ui`'s own static server and `control` mock.
  Mark each claim "verified" or "code-read".
- **Known open items read first.** `docs/ARCHITECTURE.md` lists F16 (response bodies, gRPC reply
  messages and jar cookies stored and shown unmasked). The Cookies pane showing an echoed secret is
  that item, not new. The shared 5-minute reveal grace across windows (D8, ARCHITECTURE's
  multi-window subsection) is intended. Do not re-report either.

## 1. Own file set

About 13.5k production lines (TS plus Vue) and 8.7k spec lines. Matches pre-plan §4's ~20k.

- **`SF/api` (31 files, 6.9k)**:
  - stores: `state/collections.ts` (703: tree, search, saved-request cache, save dialog, import,
    export), `state/variables.ts` (636: `useVariablesStore` environments and per-tab override;
    `useVariableSetStore` set rows, `listCache`, merge, reveal maps, history popover),
    `state/curl.ts` (307: `useImportCurlStore`, `useCopyAsCurlStore`), `state/history.ts` (181:
    `createHistoryStore` factory), `state/raw.ts`, `state/dynamicValues.ts`,
    `state/revealExpiry.ts`, `state/variableCompletion.ts` (345: Monaco decorations, hover,
    completion);
  - `reveal.ts` (`runReveal`), `tabs.ts` (open/rename/close helpers), `menus.ts`;
  - components: `ApiDialogs`, `ApiStart`, `BulkVariablesEditor`, `CollectionRow`,
    `CollectionsPanel`, `CollectionsTree`, `CopyAsCurlDialog`, `DynamicValuesDialog`,
    `EditRawRequestDialog`, `EnvironmentSelect`, `EnvironmentsView`, `ImportCurlDialog`,
    `ImportReportStrip`, `MethodSelect`, `SaveRequestDialog`, `VariableHistoryMenu`, `VariableRow`,
    `VariableSetView` (674), `VariablesOverviewPanel`.
- **`SF/views/httprequest` (18 files, 4.4k)**: `state.ts` (`useHttpRequestViewStore.send`,
  `resolveForExport`, `onSendCompleted` listener set), `history.ts`, `cookies.ts`
  (`useCookiesStore`), `files.ts`; `HttpRequestView.vue` (844), `ResponsePane.vue`,
  `RawExchangePane.vue`, `TimelinePane.vue`, `ResponseDiffDialog.vue`, `ResponseHistoryList.vue`,
  `CookiesPane.vue`, `RequestBodyPane.vue`, `RequestSettingsPane.vue`, `FormDataTable.vue`,
  `QueryParamsTable.vue`, `RequestHeadersTable.vue`, `UrlEncodedTable.vue`, `BinaryBodyPicker.vue`.
- **`SF/views/grpcrequest` (7 files, 2.2k)**: `state.ts` (`useGrpcRequestViewStore`: schema
  runtime, `call`, event apply, `MAX_LIVE_MESSAGES`), `history.ts`; `GrpcRequestView.vue`,
  `ResponsePane.vue`, `SchemaBrowser.vue`, `CallHistoryList.vue`, `GrpcMetadataTable.vue`.
- **`ST/unit`** (8): `api-collections-delete-orphans-cache`, `api-collections-search-debounce`,
  `api-secret-reveal-expiry-round2`, `api-variables-duplicate-names`,
  `api-variables-reveal-grace-expiry`, `grpc-schema-supersession`, `grpc-stream-terminal-race`,
  `history-runtime-reactivity`.
- **`ST/ui`** (15): `api-secret-reveal-isolation`, `api-ui-consistency`, `collections`,
  `credential-reveal`, `grpc-request`, `http-curl`, `http-dynamic-values`, `http-history`,
  `http-pipes`, `http-raw`, `http-request-body`, `http-request`, `http-timeline`,
  `http-variables`, `secrets`. `credential-reveal` and `secrets` may cover connection dialogs too;
  keep only their API half in scope, and move nothing.

## 2. One hop: callers

- `SF/App.vue`: `ApiDialogs` (five dialogs, each gated on its store's `open`),
  `useCollectionsStore`, `openApiRequestTab`.
- `SF/workbench/tabViews.ts`: `http-request`, `grpc-request`, `variable-set`, `environments`
  entries. `SF/workbench/modes.ts`: `ApiStart`, `CollectionsPanel`.
- `SF/state/tabKinds.ts` (Part 12): the four API kind definitions (`duplicateState` clears
  `itemId`; `incognitoMenuExtras`; titles via `AC` `httpRequestTitle`). `SF/state/tabs.ts`
  persistable filter for incognito tabs; `SF/state/tabIncognito.ts`.
- `SF/shortcuts/state.ts`: `openApiRequestTab`, `openGrpcRequestTab`.
- `SF/views/shared/request/useRequestChrome.ts` (Part 10) imports `useVariablesStore`;
  `SF/views/shared/fields/FieldRowsTable.vue` imports the `VariableSupport` type. Both cross back
  into this chunk and are read for the contract only.

## 3. One hop: callees

- **Settled (Parts 2-8, 13):**
  - `SF/bridge/apiControl.ts` via `control.*` (A5; `trust<T>()`, no zod on results). Only
    `onGrpcCall` is a push channel here; collections, variables and environments have none.
  - `AC` (Part 8): `resolve`/`applySecretValues`/`toCurl`/`parseCurl`/`parseRawRequest`/
    `generateRawRequest{,FromStored}`/`parseEnv`/`reconcileEnv`/`fromSaved*`/`isDirty`.
  - `SD/{http,grpc,collections,variables,response-history,grpc-history}.ts` (Part 8).
  - `SI/bridge/{http,grpc,variables,collections,grpchistory,responsehistory}.go` masking and
    error mapping (Part 7).
  - `PW` (B1): `state/tabRuntime` (`registerTabRuntimeCleanup`), `state/confirmDialog`,
    `util/clipboard`, `util/format`, `util/useDragReorder`, `util/panelSearch`,
    `util/treeVirtualRows`, `shortcuts/*`, `state/contextMenu`, `editor/monaco`.
  - `PT/components/ui/*` (shadcn-vue: button, dialog, popover, tooltip incl.
    `TooltipDisabledTrigger`, input, checkbox, alert, input-group).
- **Later in this stream (read for the contract):** `SF/views/shared/{viewOp,request,fields,
  celleditor}` (Part 10); `SF/editor/{ranges,findRanges,monacoLanguages,hoverInfo,completion}`
  (Part 11); `SF/state/{tabDomain,tabIncognito,tabs,settings,settingsDomain,runState,connections}`
  (Part 12).
- Third-party: Pinia, VueUse (`refDebounced`, `useDebounceFn`, `useEventListener`), Monaco.

## 4. Edge cases to weight

Security first. This chunk is where a revealed secret exists in plaintext and where the renderer
tells Go which scopes to resolve against.

1. **Secret plaintext lifecycle in the renderer.**
   - Three maps hold plaintext: `revealedValues` (by variable id), `revealedHistoryValues` (by
     history id), `copyAsCurl.revealedSecretValues` (by name). Check every write path schedules
     expiry and every close path clears. Confirm no fourth holder: `VariableSetView` drafts,
     `VariableRow` inputs, Monaco models, the clipboard, tab state, `console.*` output.
   - `VariableSetView`'s draft mirror: after expiry, a draft still equal to the revealed text is
     reset to `''`. Check `syncDrafts` (fires on any `rows` reload) against a live reveal: the draft
     drops to `''` while `revealedValues[id]` stays set, so the mirror never re-fills it. Check the
     re-mask against 8476adc's `valueTouched` flag: a revealed, untouched value must still send
     `null`. An edited value typed back to the revealed text is re-masked by expiry; decide if
     that loses user input.
   - `registerTabRuntimeCleanup` in `useVariableSetStore` runs `clearRevealed()` on **any** tab
     close, and `closeCopyAsCurlDialog` clears the shared map too. Both clear reveals an open
     variable-set tab still shows. That is fail-safe; report only if it breaks a user flow
     (re-prompt loop inside the grace).
   - Tab close and reopen, window close, mode switch (API to Studio and back): does any map survive
     past its owning surface longer than the grace?
   - `CopyAsCurlDialog`: the command re-masks on expiry (reactive `currentCurlCommand`). Check the
     copy button copies the current (possibly re-masked) text, not a stale snapshot.
2. **Renderer and Go agreement after the Part 8 fixes.**
   - F5: an undecryptable env secret now shadows. `findSecretVariableId` picks the env row first;
     confirm its reveal failure leaves `{{name}}` literal and the dialog's error text is sane.
   - F6: nested `{{secret}}` inside a plain value is now reported `deferred`. Check that
     `applySecretValues` fills the nested span in Copy-as-curl, and that `variableCompletion`'s
     decoration and hover classify it consistently.
   - Within-scope duplicate secrets: `findSecretVariableId` takes the first matching row in
     `cachedVariables` order. Go uses first-wins by `sort_order` over `is_secret = 1`. Confirm
     `List`'s order equals `sort_order`. Also a plain row first and a secret row second with one
     name: TS treats the name as plain, Go never sees it deferred. Confirm both agree.
   - `firstWinsByName` in `mergedValuesAndSecrets` against Go's `mergeSecrets` for a plain
     environment row shadowing a collection secret.
3. **The scope ids Go trusts (Part 8 §4.1, UI half).**
   - `collectionIdFor` returns `''` when the tree is not loaded. Only `CollectionsPanel` and
     `VariableSetView` call `initCollections`. A restored request tab sent before the panel ever
     mounts (panel hidden, other mode first) silently drops collection variables and secrets.
   - After a row is moved, duplicated, or deleted: the orphan rule keeps the tab. Confirm send uses
     `''` and not a stale id. Save-as rebinding (`submitSaveDialog` → `historyAdopt` → patch
     `itemId`) ordering against an in-flight send.
   - `environmentIdForTab` for an incognito tab whose override points at a deleted environment:
     `deleteEnvironment` never clears `incognitoEnvByTab`, and `listCache` keeps the deleted
     environment's rows. Stage 1 then substitutes a deleted environment's plain values. Go
     resolves no secret for it.
   - `listCache` entries for deleted collections and environments are never evicted.
4. **Hand-rolled server state against `CLAUDE.md`'s TanStack Query rule.** Inventory each cache,
   then check it:
   - `useCollectionsStore`: tree (`loadCollections` after every mutation), saved-request caches
     (`requests`/`grpcRequests`, the dirty comparison's saved side), `loaded` flag.
   - `useVariablesStore`: `environments`, `initInFlight` dedupe.
   - `useVariableSetStore.listCache`: `ensureVariablesLoaded` has no in-flight dedupe and no
     sequencing. A slow first load can land after `loadVariableSetRows` wrote fresher rows and
     overwrite them. Try to reproduce.
   - `createHistoryStore`: sequence guard plus retry; bound the retry loop under rapid sends.
   - `useCookiesStore`: `fetchCookiesNow` has no sequencing (debounced keystroke fetch against the
     `onSendCompleted` refetch against `deleteCookie`). Its cleanup never clears
     `debounceTimers[tabId]`, so a pending timer after tab close re-creates runtime for a dead tab.
     `clearCookies` clears the process-wide jar, but other tabs' badges keep stale counts.
   - gRPC schema runtime: `genId` supersession plus the tab-closed check (pinned by
     `grpc-schema-supersession.spec.ts`).
   - For each: every mutation's invalidation path (import, bulk apply, duplicate environment,
     cascade delete, Save-as, history adopt). Also cross-window staleness. Collections, variables
     and environments are app-wide DB state, but `ARCHITECTURE.md`'s multi-window section lists
     neither side for them, and no broadcast exists. Window B deleting a collection leaves window A
     sending with its id and dirty-comparing against a deleted row.
   - Then weigh the standing rule. Server state fetched over the bridge with loading, error and
     cache handling goes through TanStack Query unless a named requirement declines it. No named
     decline exists for these stores. A migration that is out of proportion for this chunk's fixer
     becomes its own named follow-up phase in `SPEC.md` (pre-plan §6). Never report it as a line in
     a result section. Point fixes (a sequence guard, an eviction) stay findings here.
5. **One store, one concern.** `useCollectionsStore` holds tree, search, import/export, save dialog
   and the saved-request cache. P99 flagged it as "plausibly three concerns" and never split it.
   `useVariableSetStore` holds set rows, send-time cache, merge, three reveal paths and the history
   popover. Report a real second concern; do not split for size alone.
6. **Request and call lifecycle.**
   - HTTP `send`: `opId` supersession, and a tab closed mid-send (runtime deleted, response
     written to a detached object). `noteSendCompleted` and `noteSendRecorded` for a closed tab.
   - gRPC `call`: `lastCallId` matching against event-before-return and return-before-event
     orderings. Stop mid-stream. A client-streaming or bidi method selected (Go refuses; check UI
     text). `MAX_LIVE_MESSAGES` trim and `trueMessageCount`. `result.messages` replacing live
     messages on a unary return.
   - `loadSchema` under F4's new timeout: error text, retry, and no stuck `loading`.
   - Duplicated tab (`duplicateState` clears `itemId`) and incognito: history scope, environment
     override, and no persistence of an incognito tab's state.
7. **What the UI shows from the backend.**
   - Error and timeline text render as text only (`v-html`/`innerHTML`: zero hits today; keep it
     that way). Timeline hop errors arrive via `err.details`.
   - Import and export copy after F8: Go's `WarnAuthInert` text (`SI/bridge/collections.go:255`)
     now says values "were not kept". Check `ImportReportStrip` renders it unaltered, and that
     `exportCollection`'s "N secret values were not written" still matches what `SecretCount`
     counts.
   - F19: import fails with a partial collection left. Does the tree refresh, and does the user see
     the partial row?
   - F9/F10 curl warnings reach `ImportCurlDialog`'s warning list by `kind`.
   - Truncation flags: `bodyTruncated`, history `bodyStorageTruncated`, gRPC message `truncated`.
     No unguarded `JSON.parse` of a truncated gRPC message (Part 8 §4.15 handoff).
8. **Primitive and convention regressions (P104, P105, P99).**
   - P104 swap: dialog focus, Escape and outside-click on the five `ApiDialogs`; popover anchoring
     (`VariableRow`/`VariableHistoryMenu`, `EnvironmentSelect`, `MethodSelect`).
   - P105: every disabled trigger that has a tooltip wraps in `TooltipDisabledTrigger`. Sweep
     `:disabled` bindings inside `TooltipTrigger` across the chunk, not only the 10 current uses.
   - Remaining `<style>` blocks (`ImportCurlDialog`, `EditRawRequestDialog`, `ImportReportStrip`,
     others): each justified by a category Tailwind cannot express, or a finding.
   - `cookies.ts`' named `setTimeout` decline: check the reason still holds.
   - Every component `<script setup lang="ts">`, exactly one `<script>` block.
9. **Performance.** 10k live gRPC messages (`markRaw`, splice cost); `ResponseDiffDialog` over two
   256 KiB bodies; `visibleRows` recompute on search; `variableCompletion` decorations per
   keystroke calling `mergedValuesAndSecrets` (a fresh merge per call); `ensureVariablesLoaded` on
   every watch fire.
10. **Tests against `CLAUDE.md`'s unit-test bar.** The 8 unit specs guard races, supersession and
    expiry, which qualify. Check each still tests the current code path (renamed stores, moved
    functions) and is not a restated function body. UI specs: `api-secret-reveal-isolation` and
    `credential-reveal` should pin the reveal-map lifecycle from §4.1. Name a gap only where a
    finding's fix needs a guard.

## 5. Watch items (pre-plan §5.8, expanded)

- **TanStack Query migration (P99 Part 3):** premise corrected in §0. Stale-cache and
  invalidation edges are §4.4. Query keys have no subject. Secret-in-query-cache risk is nil, since
  no reveal touches TanStack Query. The reveal maps' lifecycle is §4.1.
- **P104 primitive swap, P105 disabled-trigger tooltips:** §4.8.
- **Churn areas:** `SF/api` (§4.1-§4.5), `grpcrequest` (§4.6), `httprequest` (§4.4 cookies,
  §4.6, §4.7).
- **Part 8 consumer check:** §0's F-list against §4.2 and §4.7.

## 6. Out of scope

- Generated code (`frontend/bindings`) and P110's `--color-muted` collision.
- Documented known open items: F16 unmasked bodies, gRPC messages and cookies (including the
  Cookies pane display); the shared reveal grace (D8).
- **Part 8's backend** (`SI/{httpclient,grpcclient,apivars,postman}`, `AC`, `SD` mirrors) and
  **Part 7's bridge**. Both closed. Report a defect there with its file; review only the contract.
- **`SF/views/shared/**`** (Part 10), **`SF/editor/**`** (Part 11), **`SF/state/**`** and
  `SF/workbench/**` (Part 12). Read for the contract. Same-stream later chunks, so a fixer may
  edit them (pre-plan §3.3).
- **`PW`/`PT` (B1, stream B).** Stream B is still open (Part 19 running), so a fix there is
  handed off per pre-plan §3.3, not made in place.
- Connection-dialog reveal (`SF/project/ConnectionDialog.vue`'s own `runReveal` copy, P12 D13) and
  the connection half of `credential-reveal`/`secrets` specs (Part 12).
