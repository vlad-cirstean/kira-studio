# P168 Part 10: review plan, Studio API client UI

Chunk C1, Stream C position 1 of 4 (pre-plan `P168-prep-plan.md` §5.9; moved from Stream A by user
instruction, SPEC row). One Opus reviewer runs this plan and reports findings. It fixes nothing. One
Sonnet fixer follows (§8). Tree surveyed: `8a008bd` (`p168-stream-c`, equal to `v2.0` tip).

Paths repo-relative. `SF` = `apps/kira-studio/frontend/src`, `ST` = `apps/kira-studio/tests`,
`AC` = `packages/api-core`, `SD` = `packages/shared/domain`, `PW` = `packages/workbench/src`
(`@workbench`), `PT` = `packages/theme/src` (`@theme`), `SI` = `apps/kira-studio/internal`. Line
numbers are as of `8a008bd`; re-read before citing.

SPEC row names this file `P168-part10-api-ui.md`; the orchestrator named it
`P168-part10-studio-api-ui.md`. Same plan, this name wins.

## 0. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Load it with `ToolSearch "codegraph"`, then call it with
  `projectPath=/home/user/kira-studio-streamC` before any Read/Grep on a symbol, call-path or
  blast-radius question. The orchestrator greps the run's tool log for real calls. Index: run
  `sh scripts/codegraph-setup.sh` in the worktree if `.codegraph/` is missing. Seeds:
  - data layer: `apiQueries.ts` keys and options, `refreshApiQuery`, `reconcileTree`,
    `reconcileEnvironments`, `handleApiDataChange`, `initApiDataSync`, `useVariableRows`,
    `useSavedRequest`; `useCollectionsStore` (`afterTreeListChange`, `deleteRow`, `duplicateRow`,
    `saveRequest`, `saveGrpcRequest`, `importCollection`, `exportCollection`, `submitSaveDialog`);
    `useVariablesStore` (`afterEnvironmentsListChange`, environment mutations,
    `environmentIdForTab`); `apiIdsForTab`, `variablesForSend`, `mergeVariableRows`;
    `useVariableSetStore` (`upsertVariable`, `deleteVariable`, `reorderVariables`,
    `applyBulkVariables`, `openHistoryMenu`, `restoreHistoryEntry`); `mergeDrafts`;
    `createHistoryStore` (`load`, `noteRecorded`, `ensureFresh`, `view`, `del`, `clearAll`).
  - plaintext lifecycle: `runReveal`, `createRevealExpiry`, `revealVariable`,
    `revealHistoryEntry`, `clearRevealed`, `clearRevealedHistory`, `useCopyAsCurlStore`
    (`revealSecretValues`, `findSecretVariableId`, `currentCurlCommand`, `copyCurlCommand`,
    `closeCopyAsCurlDialog`), `VariableRow` `visible` watch, `VariableHistoryMenu`,
    `variableCompletion.ts` (hover, decorations).
  - request lifecycle: `useHttpRequestViewStore.send`, `resolveTabState`, `buildBodyWire`,
    `onSendCompleted`; `useGrpcRequestViewStore.call`, `loadSchema`, `applyGrpcEvent`,
    `ensureGrpcCallSubscription`, `MAX_LIVE_MESSAGES`; `useCookiesStore` (`fetchCookiesNow`,
    `deleteCookie`, `clearCookies`); `useResponseBody`; `useParseWorker` `run`/`runLatest`
    callers `onBeautifyBody` (`RequestBodyPane.vue`), `onBeautify` (`GrpcRequestView.vue`).
  - UI seams: `useSortableReorder` callers (`VariableSetView.vue`, `EnvironmentsView.vue`),
    `registerTabRuntimeCleanup` callers, `registerCommand` callers, `SF/api/tabs.ts` helpers.
- **CodeGraph over-links TS names.** `run`, `request`, `apply`, `state`, `queryKey`, `remove`
  collide across Studio, Space, `git-ui` and Go. Confirm every cross-package claim with `git grep`
  of real `import` lines. §2 and §3 below were verified that way.
- **Unreviewed callees (gates G1/G2 waived).** Part 7 (`AC`, `SD/{http,collections,grpc,
  grpc-history,response-history,variables}.ts`, `SI/{httpclient,grpcclient,apivars,postman}`) and
  Part 9 (`PW`, `PT`, `packages/kira-ui`) are **not reviewed yet**. Read them as unreviewed
  callees: verify the contract this chunk relies on, do not assume it holds. A defect there is
  reported with the routing tag (§8), never left implicit.
- **Scratch probes** in the session scratchpad, never in the tree, where a claim turns on runtime
  behavior: a `bun test` harness over a Pinia store with a fake `control` (ordering, cache
  overwrite, abort), or a Playwright run against `ST/ui`'s static server and `control` mock. Mark
  each claim "verified" or "code-read".
- **Checks.** Baseline at `8a008bd`: `bun test` over the 13 own unit specs: 38 pass, 0 fail. Run
  also `bun run typecheck:web:studio`, `bun run typecheck:unit:studio` and `bunx biome check` over
  the own paths. Optional, when a claim needs it: `bun run build:test:studio` then
  `bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui <spec>` for the
  own UI specs (§1). If missing deps or bindings fail a check: `bun install --frozen-lockfile` and
  `bun run setup` (or `sh scripts/prepare-worktree.sh`). A red check is a finding.
- **Known open items read first** (`docs/ARCHITECTURE.md`): response bodies, gRPC reply messages
  and jar cookies stored and shown unmasked (F16) is accepted by design; the shared 5-minute reveal
  grace across windows (D8) is intended. Do not re-report either.

## 1. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `8a008bd`. **Part 10: no drift.** 91 files, 23,319 code lines,
10,157 test lines, same as `f40cd35`.

Drift elsewhere, from fixes since `f40cd35`, none touching a Part 10 file:
- Part 2: 145 to 148 files, 19,684 to 20,159 lines (Part 2 fixes, already recorded in Part 3's
  plan). Part 8: 16,274 to 16,328.
- Part 16: 18,789 to 18,792. Part 20: 20,140 to 20,312 (tests 4,585 to 4,590). Part 21: 17,275 to
  17,327. P166/P167 fixes, Stream B files.
- Totals: streams A+C 254,613, B 182,321; 2,871 owned, 0 orphans, 3,500 tracked (docs 476).
- **Script label drift.** The script prints `[A]` for every Part `<= 13`. Parts 10-13 are Stream C
  now (SPEC rows). Ownership rules are unchanged; only the label is stale. Not a Part 10 finding.

`v2.0` tip equals this branch's base (`8a008bd`), so the landing rebase is currently trivial.
Re-check `git diff --name-only 8a008bd v2.0 -- apps/kira-studio/frontend/src/{api,views/httprequest,views/grpcrequest}`
before landing.

## 2. Own file set (91 files)

13,162 production lines (59 files), 10,157 test lines (32 files). Visual baseline `.png`s are
excluded assets (pre-plan §6).

- **`SF/api` (33 files, 6,934 lines).**
  - Data layer (`state/`): `apiQueries.ts` (278: TanStack Query keys, options, imperative
    loaders, `refreshApiQuery`, reconcilers, `initApiDataSync` cross-window listener, composables),
    `collections.ts` (799), `variables.ts` (822: `useVariablesStore`, `apiIdsForTab`,
    `variablesForSend`, `useVariableSetStore` with two reveal maps and the history popover),
    `curl.ts` (307: `useImportCurlStore`, `useCopyAsCurlStore` with the third reveal map),
    `history.ts` (218: `createHistoryStore`), `variableCompletion.ts` (343), `raw.ts` (90),
    `saveRequestDialog.ts` (63), `draftMerge.ts` (58), `revealExpiry.ts` (46),
    `dynamicValues.ts` (23).
  - `reveal.ts` (40, `runReveal`), `tabs.ts` (215), `menus.ts` (204).
  - Components (19): `ApiDialogs`, `ApiStart`, `BulkVariablesEditor`, `CollectionRow`,
    `CollectionsPanel`, `CollectionsTree`, `CopyAsCurlDialog`, `DynamicValuesDialog`,
    `EditRawRequestDialog`, `EnvironmentSelect`, `EnvironmentsView` (354), `ImportCurlDialog`,
    `ImportReportStrip`, `MethodSelect`, `SaveRequestDialog`, `VariableHistoryMenu`,
    `VariableRow`, `VariableSetView` (645), `VariablesOverviewPanel`.
- **`SF/views/httprequest` (19 files, 4,244).** `state.ts` (280), `useResponseBody.ts` (111, new in
  P160/P163), `cookies.ts` (94), `history.ts` (76), `files.ts` (18); `HttpRequestView.vue` (790),
  `ResponsePane.vue` (503), `ResponseDiffDialog.vue` (371), `TimelinePane.vue` (328),
  `RequestSettingsPane.vue` (310), `RawExchangePane.vue` (282), `RequestBodyPane.vue` (252),
  `ResponseHistoryList.vue` (243), `CookiesPane.vue` (202), `FormDataTable.vue`,
  `QueryParamsTable.vue`, `BinaryBodyPicker.vue`, `RequestHeadersTable.vue`, `UrlEncodedTable.vue`.
- **`SF/views/grpcrequest` (7 files, 1,984).** `state.ts` (383), `history.ts` (47);
  `GrpcRequestView.vue` (546), `ResponsePane.vue` (490), `SchemaBrowser.vue` (258),
  `CallHistoryList.vue` (188), `GrpcMetadataTable.vue` (72).
- **`ST/unit` (13, 1,879):** `api-collections-delete-orphans-cache`,
  `api-collections-search-debounce`, `api-draft-merge`, `api-secret-reveal-expiry-round2`,
  `api-variables-delete-eviction`, `api-variables-duplicate-names`,
  `api-variables-ensure-load-race`, `api-variables-reveal-grace-expiry`,
  `grpc-schema-supersession`, `grpc-stream-terminal-race`, `history-runtime-reactivity`,
  `http-cookies-store-race`, `http-send-tab-close-leak`.
- **`ST/ui` (16, 7,988):** `api-cross-window-sync`, `api-secret-reveal-isolation`,
  `api-ui-consistency` (1,575), `collections`, `credential-reveal`, `grpc-request` (1,258),
  `http-curl`, `http-dynamic-values`, `http-history`, `http-pipes`, `http-raw`,
  `http-request-body`, `http-request`, `http-timeline`, `http-variables`, `secrets`.
  `credential-reveal` and `secrets` also cover connection dialogs; only their API half is in scope.
- **`ST/perf` (2, 250):** `http-response.spec.ts`, `http-response-body.spec.ts` (P160/P163 WebKit
  probes). **`ST/visual` (1, 40):** `http-request-view.spec.ts`.

## 3. One hop: callers (git grep of import lines, production files)

- `SF/App.vue` (Part 13): `ApiDialogs`, `useCollectionsStore`, `openApiRequestTab`.
- `SF/main.ts` (Part 13): `initApiDataSync` (bootstrap, before any query exists).
- `SF/workbench/tabViews.ts` (Part 13): `EnvironmentsView`, `VariableSetView`, `GrpcRequestView`,
  `HttpRequestView`. `SF/workbench/modes.ts` (Part 13): `ApiStart`, `CollectionsPanel`.
- `SF/shortcuts/state.ts` (Part 13): `openApiRequestTab`, `openGrpcRequestTab`.
- `SF/state/tabKinds.ts` (Part 13): the `http-request`, `grpc-request`, `variable-set` kind entries
  (`duplicateState`, menus, incognito). No import of this chunk; contract only.
- **Back-edges into this chunk from Part 11:** `views/shared/request/useRequestChrome.ts` imports
  `useVariablesStore`; `views/shared/fields/FieldRowsTable.vue` imports type `VariableSupport`.
- **Drift from the pre-plan caller list:** `main.ts` is a caller (pre-plan lists only `tabViews.ts`
  and `App.vue`); `modes.ts` and `shortcuts/state.ts` likewise. No dynamic `import()` of own files.

## 4. One hop: callees

Grouped by owner, with the routing that applies to a fix there (§8).

- **Part 7, Stream A, unreviewed:** `@kira/api-core` (16 imports: `resolve`, `applySecretValues`,
  `toCurl`, `parseCurl`, `parseRawRequest`, `generateRawRequest*`, `parseEnv`/`reconcileEnv`,
  `fromSaved*`/`toSaved*`/`isDirty`, `httpRequestTitle`); `SD/http` (20), `SD/variables` (10),
  `SD/grpc` (7), `SD/collections` (6), `SD/response-history`, `SD/grpc-history`. Go side read for
  contract: `SI/bridge/{http,grpc,variables,collections,apidata}.go` (Part 6) emits
  `ApiDataChanged` (`tree`, `savedRequest`, `variables`, `environments`).
- **Part 9, Stream A, unreviewed:** `PT/components/ui/*` (shadcn-vue: button, tooltip, alert,
  empty, input-group, badge, popover, native-select, input, toggle-group, dialog, label, checkbox,
  textarea, resizable, field), `PT/{CodiconIcon,RunState,SwatchRadio}.vue`,
  `PT/components/TooltipIconButton.vue`, `PT/{connColor,methodColor,lib/utils}`;
  `PW/state/{queryClient,tabRuntime,confirmDialog,contextMenu}`, `PW/util/{clipboard,format,
  useSortableReorder,virtualRows,treeVirtualRows,panelSearch}`, `PW/shortcuts/{commands,keys}`,
  `PW/components/{ViewToolbar,TreeTwisty}.vue`, `PW/editor/monaco`; `SD/color`,
  `shared/protocol/events`.
- **Part 5, Stream A:** `SF/bridge/control` (11 imports; `control.onGrpcCall`,
  `control.onApiDataChanged` push channels).
- **Part 11, Stream C later:** `views/shared/{fields/FieldRowsTable.vue,ResponseFindBar.vue,
  AutocompleteField.vue,viewOp.ts,celleditor/formats.ts}`, `views/shared/request/{resolve,
  useRequestChrome,useRequestTabSave}.ts`.
- **Part 12, Stream C later:** `SF/editor/{MonacoHost.vue,ranges,findRanges,monacoLanguages,
  hoverInfo,completion}`, `SF/workers/parse/{client,useParseWorker,protocol}` (P163 worker and
  `INLINE_CHARS` = 65,536), `SF/beautify.ts` (`ResponseDiffDialog`, `GrpcRequestView`).
- **Part 13, Stream C later:** `SF/state/{tabDomain,tabIncognito,settings,settingsDomain}`,
  `SF/theme/completion.ts` (`templateToken`).
- Third-party: Vue, Pinia, `@tanstack/vue-query` (4 files), `@tanstack/vue-virtual` (1), VueUse
  (9: `useTimeoutFn`, `useDebounceFn`, `refDebounced`, `tryOnScopeDispose`), `vue-draggable-plus`
  (via `useSortableReorder`), Monaco.

## 5. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Security first: this chunk holds
revealed plaintext and tells Go which scopes to resolve against. Items marked "suspect" were seen
during planning but not verified; confirm or drop each, never report unverified.

### 5.1 Stale async responses and cancellation races

- **Suspect: stuck `running`.** `send` (`httprequest/state.ts:158`) and `call`
  (`grpcrequest/state.ts:281`) set `rt.status = 'running'` and `rt.opId`, then
  `await variablesForSend(...)` **outside** the `try`. A rejected tree, environments or variable
  query (bridge error) leaves the tab `running` with no op on the Go side. Stop during that window
  cancels an op id Go never saw. A tab closed during it still reaches `control.httpSend`/`grpcCall`.
- `send`'s closed-tab guard (`findHttpRequestTab`) against `call`, which has only the `opId`
  check: a gRPC tab closed mid-call, then `noteGrpcCallRecorded` for a dead tab (P108 F8's HTTP
  fix, gRPC half).
- `applyGrpcEvent` ordering: terminal event before `grpcCall` returns and the reverse,
  `notifiedCallId` dedupe, a unary result replacing live messages, a superseded call's late events
  (`lastCallId` match), events for a tab whose runtime cleanup ran. `ensureGrpcCallSubscription`
  subscribes once for the store's lifetime; check nothing leaks per call.
- `loadSchema` supersession (`genId`) against tab close and method switch; Call disabled until
  `findMethod` resolves, and the command path's own guard.
- **Suspect: cookies.** `deleteCookie` has neither the tab-exists guard nor the `fetchSeq` check
  that `fetchCookiesNow` has, and recreates runtime for a closed tab via `ensure`.
  `clearCookies` does not bump `fetchSeq`, so an in-flight fetch can land after a clear and
  repopulate a list the jar no longer holds.
- `createHistoryStore.load` retry loop under rapid sends: bound, and `loading` ownership when
  the tab closes mid-retry.
- `useResponseBody`: `seq` plus `runLatest('body', ...)` against rapid history `view`/`backToLatest`
  switches, Pretty/Raw toggles mid-pass, a base64 body arriving while a worker pass runs, and the
  inline path (`<= INLINE_CHARS`) racing an aborted worker pass. `formatting` caption timer after
  unmount (`useTimeoutFn` scope).
- Beautify (`RequestBodyPane.onBeautifyBody`, `GrpcRequestView.onBeautify`): `parse.run`, not
  `runLatest`, so repeated clicks queue jobs; check the source-equality guard and `beautifyError`
  when the buffer moved on.
- `CopyAsCurlDialog`: **suspect** `revealSecretValues` keeps looping after the dialog closes (or
  reopens for another request): a later `revealVariable` writes plaintext into
  `state.revealedSecretValues` after `closeCopyAsCurlDialog` cleared it. Also `state.revealing`
  across close.

### 5.2 TanStack Query keys, invalidation and cross-window sync (P112)

- Key set: `apiCollectionsTree`, `apiSavedRequest/<id>`, `apiSavedGrpcRequest/<id>`,
  `apiEnvironments`, `apiVariables/<scope>/<ownerId>`. All `staleTime: Infinity`; correctness
  rests entirely on invalidation. For every mutation (create, rename, delete, duplicate, save,
  Save-as, import, export, environment CRUD, activate, reorder, bulk apply, history restore) check
  the keys it refreshes locally against the `ApiDataChanged` kinds Go emits for it.
- `refreshApiQuery`'s double invalidate around an in-flight fetch; `queryClient.query` callers with
  no observer (send, describe) after an invalidation.
- `reconcileTree` sets `null` (orphan) for saved-request queries whose item is not in the tree:
  a just-created item whose tree refetch lags, and Save-as rebinding (`submitSaveDialog` to patch
  `itemId`) against a concurrent broadcast.
- `saveRequest` writes the cache with the renderer's `request` object, not Go's stored form; check
  the dirty mark against what Go normalises.
- `initApiDataSync` swallows failures to `console.warn`: a failed refresh leaves a stale cache with
  `staleTime: Infinity` and no retry.
- `apiIdsForTab` for an incognito tab whose environment override was deleted;
  `environmentIdForTab` after `reconcileEnvironments` evicts it.
- gcTime: variables queries for owners never reopened, saved-request queries for every tab ever
  opened. Bounded or growing for the session?

### 5.3 Pinia store lifetime and leaks

- Every per-tab runtime (`createRuntimeStore`, `variableSetRuntime`, `cookiesRuntime`, history
  `latestSeq`/`staleSeq`, `schemaRuntime`, reveal expiry timers) is deleted by a
  `registerTabRuntimeCleanup` callback. Check each map has one, and that no async path recreates
  an entry after cleanup.
- Module-level listener sets (`sendCompletedListeners`) and unsubscribes on view unmount.
- One store, one concern (`CLAUDE.md`): `useCollectionsStore` (tree UI, search, import/export,
  save, error strip) and `useVariableSetStore` (rows, reveal maps, history popover). Report a real
  second concern, not size.

### 5.4 Secret and credential handling

- Three plaintext maps: `revealedValues`, `revealedHistoryValues`, `copyAsCurl.revealedSecretValues`.
  Every write schedules expiry; every close path clears. Confirm no fourth holder: drafts
  (`mergeDrafts` seeds), `VariableRow` inputs, Monaco models, `variableCompletion` hover text and
  decorations, tab state, TanStack Query cache (secrets must stay `''` there), `console.*`.
- `VariableRow`'s `visible` watch flips on `'' -> non-empty`: a remote refetch landing a reveal-like
  transition, and re-mask after expiry while the row is focused.
- `restoreHistoryEntry` writes a revealed secret through `upsertVariable`; check it never lands in
  a non-secret row.
- Clipboard: `copyCurlCommand` copies the current (possibly revealed) text via `copyText`; check
  it never copies a stale snapshot and that copy failure surfaces.
- `findSecretVariableId` precedence (environment over collection) against Go's merge order.
- `REVEAL_GRACE_WINDOW_MS` against `internal/localauth.GraceWindow` (hand-synced constant).

### 5.5 Large bodies, P160/P163 worker and chunker

- `ResponsePane` pending state: `bodyPending` hides `MonacoHost`; check find bar, copy, and
  diff actions while pending, and that Raw always shows bytes.
- Every Raw to Pretty toggle re-runs a full worker pass on a 5 MB body (P21 F7 trade). Cost
  versus retention; report only if measurably wrong.
- `ResponseDiffDialog` beautifies both bodies on the main thread (`beautifyJson`/`beautifyXml`).
  Check P163's inventory verdict (`docs/v2.0/plans/P163-shared-parse-worker.md`) before reporting.
- `curl.ts` `parseCurl` and `raw.ts` `parseRawRequest` run per keystroke on pasted input.
- gRPC: 10,000 live messages (`markRaw`, `splice` cost), `messageBytes` running total, `truncated`
  messages never `JSON.parse`d unguarded, history list virtualisation.
- Perf specs (`ST/perf/http-*`): still measure the current code path.

### 5.6 Drag/drop, keyboard, accessibility

- `useSortableReorder` (P137/P140 `vue-draggable-plus`) in `VariableSetView` and
  `EnvironmentsView`: a broadcast refetch mid-drag (ids change under the mirror), the empty draft
  row excluded by selector, reorder mutation failure (revert or stale order), drag while a rename
  input is focused.
- `registerCommand` sites (`CollectionsPanel` 5, `HttpRequestView` 6, `GrpcRequestView` 4, both
  `ResponsePane`s): unregister on unmount, active-tab gating so a background tab never handles
  `api.save`/send, Enter in a field that also triggers send.
- Collections tree keyboard (arrow, Enter, F2 rename, Escape), focus return after dialogs, labels
  on icon-only buttons, native `<button>`s (`CookiesPane.vue:97,151`,
  `RequestSettingsPane.vue:306`, `grpcrequest/ResponsePane.vue:433`) for focus ring and role.

### 5.7 Unsaved-edit loss

- `mergeDrafts`: a remote delete drops a dirty draft silently; a remote edit to a dirty row keeps
  the draft (then Save overwrites the remote edit).
- Request tab dirty mark (`isDirty`) for an orphan (`saved === null` reads not dirty); Save while
  `unresolved`; tab close with a dirty request.
- Bulk editor (`BulkVariablesEditor`) against a concurrent row change.

### 5.8 Variable and environment resolution

- `mergeVariableRows` first-wins per name within scope and environment over collection, against
  Go's `apivars` merge (Part 7). Duplicate names, a plain row shadowing a secret, nested
  `{{secret}}` inside a plain value (deferred).
- `{{$dynamic}}` second pass: generator chunk load failure.
- `variableCompletion` decorations agree with what `resolve` substitutes.

### 5.9 XSS and rendering

- Zero `v-html`/`innerHTML`/`insertAdjacentHTML` and zero bound `:href` in the chunk today. Check
  every server-sourced string (headers, timeline hop errors, gRPC status message, import warnings,
  cookie values, redirect URL) renders as text, and Monaco/diff editors get plain models.

### 5.10 Conventions (`CLAUDE.md`)

- One `<style scoped>` block remains (`ResponseDiffDialog.vue`, a `:deep(.monaco-diff-editor)`
  height rule, justified in its comment). Every other component is Tailwind-only. All 38 Vue files
  have exactly one `<script setup lang="ts">`.
- `PT` `native-select` wrapper in 7 files (`EnvironmentSelect`, `MethodSelect`,
  `SaveRequestDialog`, `GrpcRequestView`, `FormDataTable`, `RequestBodyPane`,
  `RequestSettingsPane`; P61 WebKit decline). Native `<button>`s in §5.6: shadcn `Button` or
  justified.
- Raw timers: only `revealExpiry.ts` (`setTimeout` keyed map). Judge it against VueUse
  (`useTimeoutFn` per key does not fit a dynamic key set; the decline must be named).
- Server state outside TanStack Query: `useCookiesStore`, `createHistoryStore`, gRPC schema
  runtime still hand-roll loading/error/sequence. Weigh each against the rule; a migration too
  large for this fixer becomes its own `SPEC.md` phase, point fixes stay findings.
- P105: disabled triggers inside `TooltipTrigger` wrap in `TooltipDisabledTrigger`.

### 5.11 Tests against the `CLAUDE.md` bar

- The 13 unit specs guard races, supersession, expiry, draft merge and eviction: they qualify.
  Check each still drives the current code (P112 rewrote the stores) and is not a restated body.
- Name a gap only where a finding's fix needs a guard (for example §5.1's stuck-`running`).
- UI specs: `api-cross-window-sync` against §5.2; `api-secret-reveal-isolation` and
  `credential-reveal` against §5.4. Duplicate coverage across `api-ui-consistency` and per-feature
  specs is pruned only when truly duplicate.

## 6. What earlier reviews and P143-P165 changed (do not re-report)

- **P141/P142** (base `771512bc`, not in this shallow clone): no finding touched a Part 10 file
  (SPEC "P141 result", "P142 result": ADE, Studio S3/redis, `git-ui`, scripts).
- **P166/P167** (base `743af03`): no finding touched a Part 10 file. P166's coverage list names
  "gRPC/HTTP body panes" as **not reached**; P167 fixed no Part 10 file. So the P160/P163 changes
  below are unreviewed: review them in full. `docs/v2.0/plans/P16{6,7}-code-review.md` are gone
  from both `v2.0` and this branch.
- **`git diff 743af03 HEAD` on own paths, 459 lines, all P160/P163 feature work**
  (`fdca6ce`, `4fd4cd5`, `1c7ec31`, `33ffed3`):
  - `useResponseBody.ts` new (111): one worker pass per body, `seq`, `runLatest`, 200 ms caption.
  - `httprequest/ResponsePane.vue` (+24/-44): `prettyFormat`/`bodyText` computeds replaced by
    `useResponseBody`; "Formatting response…" pending state.
  - `RequestBodyPane.vue` (+12/-2), `GrpcRequestView.vue` (+13/-3): Beautify above
    `INLINE_CHARS` runs on the worker with a source-equality guard.
  - `ST/perf/http-response.spec.ts` (167), `http-response-body.spec.ts` (83) new.
- **P108 Part 9 and P112** fixes are in code (stage-1 ids via `apiIdsForTab`, `listCache` gone,
  cookie `fetchSeq`, history seq retry, `notifiedCallId`, send tab-close guard, reveal expiry on all
  three maps, `draftMerge`). Verify they hold; do not re-report them as new.

## 7. Watch items

- Pre-plan §5.9: TanStack Query keys and invalidation (§5.2), cross-window sync (§5.2), reveal
  expiry (§5.4), send-then-tab-close leak (§5.1, gRPC half), cookie store race (§5.1), gRPC stream
  terminal race (§5.1).

## 8. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, in this block order** (data layer first, so views read against known stores):
  1. Data layer: `api/state/apiQueries.ts`, `collections.ts`, `variables.ts`, `draftMerge.ts`,
     `history.ts`, `revealExpiry.ts`, `reveal.ts`, `curl.ts`, `variableCompletion.ts`, `raw.ts`,
     `saveRequestDialog.ts`, `dynamicValues.ts`, `api/tabs.ts`, `api/menus.ts`.
  2. API components: the 19 `api/*.vue`.
  3. HTTP view: `state.ts`, `cookies.ts`, `history.ts`, `files.ts`, `useResponseBody.ts`, then the
     14 components.
  4. gRPC view: `state.ts`, `history.ts`, then the 5 components.
  5. Tests: 13 unit, 16 UI, 2 perf, 1 visual specs (coverage claims, test bar).
- **Resumable:** write `docs/v2.0/plans/P168-part10-findings.md` as blocks finish and commit it
  after **each** block (`docs(v2.0): P168 Part 10 findings, block <n>`), normal commit, explicit
  `git add <path>`, hooks green. An interrupted run resumes from the last committed block, never
  re-derives one.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a concrete
  failure scenario, a proposed fix, "verified" or "code-read". Mark one that needs a real design
  decision; the fixer turns it into its own `SPEC.md` phase.
- **Routing tag (G1/G2 waived).** A finding whose fix must edit a file owned by another Part
  carries `needs-other-part-file: <path> (Part N)`. Owners: Stream A Parts 2-9 (here mostly Part 5
  `SF/bridge`, Part 7 `AC`/`SD`/`SI` API backend, Part 9 `PW`/`PT`); Stream B Parts 14-23; Stream C
  later Parts 11 (`views/shared`), 12 (`editor`, `workers`, `beautify.ts`), 13 (`state`,
  `workbench`, `App.vue`, `main.ts`, `theme`). The Stream C fixer does not make those edits. The
  orchestrator routes them into `docs/v2.0/plans/P168-routed-to-<stream>.md`. A finding fixable
  in own files with only a read of another Part's contract carries no tag.
- The findings file states base commit, HEAD reviewed, checks run and results, findings, then
  coverage per block: reviewed, skimmed (with reason), not reached. No unexplained gap. A chunk with
  nothing real says so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 10 findings` before any fixer starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 10`, only
  in own files; tagged findings left for the orchestrator. Re-runs the own unit specs,
  `typecheck:web:studio`, lint, and the own UI specs touched. Deletes the findings file when done.
  Chunk lands per pre-plan §3.4 before Part 11's plan starts.

## 9. Out of scope

- Part 7 backend and Part 9 base internals beyond the contract this chunk uses (report a defect
  there with the routing tag).
- `views/shared/**` (Part 11), `editor/**`, `workers/**`, `beautify.ts` (Part 12), `state/**`,
  `workbench/**`, `App.vue`, `main.ts` (Part 13): contract only.
- Connection-dialog reveal (`SF/project/ConnectionDialog.vue`) and the connection half of the
  `credential-reveal`/`secrets` specs (Part 13).
- Documented known open items (F16 unmasked bodies/messages/cookies; D8 shared grace).
- Generated bindings, docs, excluded files (pre-plan §6).
