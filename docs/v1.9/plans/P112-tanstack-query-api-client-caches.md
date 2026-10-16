# P112 — implementation plan: TanStack Query for API-client caches

SPEC row: `docs/v1.9/SPEC.md` phasing table, P112. Origin: `plans/P108-part9-findings.md` F12, deferred
in `## P108 Part 9 result`. Opus plans, one sequential Sonnet implementer lands it. No review-findings
stage. Tree surveyed: `264069c`.

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SF` = `apps/kira-studio/frontend/src`,
`ST` = `apps/kira-studio/tests`, `SP` = `packages/shared/protocol`, `PW` = `packages/workbench/src`
(alias `@workbench`). Line numbers are at `264069c`; re-check each against the tree when work starts
(§8).

## 0. Goal and acceptance

Replace five hand-rolled server-state caches with TanStack Query, invalidated by one Go broadcast.

| Cache today | Where | Becomes |
|---|---|---|
| collections tree (`state.collections`/`state.items`/`loaded`) | `SF/api/state/collections.ts:72-147` | query `['apiCollectionsTree']` |
| saved HTTP requests (`state.requests`, `orphanRequests`) | `collections.ts:80-219` | query `['apiSavedRequest', itemId]` |
| saved gRPC requests (`state.grpcRequests`, `orphanGrpcRequests`) | same | query `['apiSavedGrpcRequest', itemId]` |
| environments list + active env (`state.environments`, `loaded`, `initInFlight`) | `SF/api/state/variables.ts:30-87` | query `['apiEnvironments']` |
| variable rows (`listCache`, `listCacheGen`, `ensureInFlight`, `variableSetRuntime[tab].rows`) | `variables.ts:306-427` | query `['apiVariables', scope, ownerId]` |

Acceptance (orchestrator checks each with a real grep/run, §9):

1. Zero hand-rolled server-state caches left: `listCache`, `listCacheGen`, `bumpListCacheGen`,
   `ensureInFlight`, `initInFlight`, `loadVariableSetRows`, `ensureVariablesLoaded`,
   `cachedVariables`, `evictListCache`, `loadCollections`, `loadEnvironments`, `initCollections`,
   `initVariables`, `state.requests`, `state.grpcRequests`, `orphanRequests`, `orphanGrpcRequests`
   all return zero hits under `SF` and `ST`.
2. Every cache in the table above is read through `useQuery` or `queryClient.query(...)`, and every
   write to it goes through a `useMutation` whose `onSuccess` updates the cache (§4.4). A grep finds
   real `useQuery(`/`useMutation(` callers in `SF/api/state/*.ts` and both request views.
3. Go emits `kira:api:dataChanged` on every mutation site in §2.3 — 19 sites, counted by grep.
4. One boot-time listener turns each change into invalidation (§3.4). A cross-window edit reaches the
   other window's tree, environment selector, variable-set tab, request dirty state and next send.
5. F2's and F9's guarantees still hold, under new mechanisms (§5). Their unit specs are rewritten, not
   dropped.

## 1. Method (implementer)

This phase names every file and fix up front. The implementer executes named changes, so the
CodeGraph rule is not mandatory for it. Two exceptions: re-verifying §8's drift list before starting,
and any caller not listed in §6 that typecheck surfaces. Both are discovery — use
`codegraph_explore` first (`ToolSearch` for "codegraph" to load it).

Discovery for this plan ran through `codegraph_explore`: `useVariablesStore`/`useVariableSetStore`
members, `useCollectionsStore` members, the Go `Events`/`Emitter` push machinery, and existing
TanStack Query users. Library behaviour below was read from `@tanstack/query-core@5.103.2`'s build
(`node_modules/.bun/@tanstack+query-core@5.103.2/.../build/modern/{query,queryClient,notifyManager}.js`)
and `@tanstack/vue-query@5.103.2`'s `useBaseQuery.js`.

## 2. Go side: the `api-data-changed` event

### 2.1 Precedent

State-change broadcasts from a bound service already use `s.Deps.Events.Emit(Channel…, payload)`.
Examples: `SI/bridge/customscripts.go:34` (`ChannelCustomScriptsChanged`), `SI/bridge/schema.go:46`
(`ChannelSchemaChanged`), `SI/bridge/layout.go:35`. `Emit` fans out to every window, including the
one that made the call (ARCHITECTURE.md "Menu commands go to the focused window; state changes still
broadcast to every window"). Follow that exact shape. No `Sources`/`Attach` entry: the producer is a
bound call, not a long-lived source (`ChannelGrpcCall`'s own comment, `SI/bridge/events.go:43-48`).

### 2.2 Shape

`SI/bridge/events.go`: add a const after `ChannelKeepAwake` (`:83`), with a short comment:

```go
ChannelApiDataChanged = "kira:api:dataChanged"
```

New file `SI/bridge/apidata.go`:

```go
package bridge

// ApiDataChange names one renderer cache a mutation made stale (P112). Kind is one of the four
// consts below; ItemID is set only for savedRequest, Scope/OwnerID only for variables.
type ApiDataChange struct {
	Kind    string              `json:"kind"`
	ItemID  string              `json:"itemId,omitempty"`
	Scope   model.VariableScope `json:"scope,omitempty"`
	OwnerID string              `json:"ownerId,omitempty"`
}

const (
	ApiDataTree         = "tree"         // collections + items list (names, method/url summary, order)
	ApiDataSavedRequest = "savedRequest" // one item's saved HTTP or gRPC body
	ApiDataVariables    = "variables"    // one owner's variable rows
	ApiDataEnvironments = "environments" // environment list, including is_active
)

// ApiDataChanged is ChannelApiDataChanged's payload: every scope one mutation touched, in one
// event, so the renderer invalidates them in one batch.
type ApiDataChanged struct {
	Changes []ApiDataChange `json:"changes"`
}

func emitApiData(e appcore.Emitter, changes ...ApiDataChange) {
	e.Emit(ChannelApiDataChanged, ApiDataChanged{Changes: changes})
}
```

Plus small constructors to keep call sites one line: `treeChange()`, `savedRequestChange(itemID)`,
`variablesChange(scope, ownerID)`, `environmentsChange()`.

Why one event per mutation carrying a change list, not one event per scope: several mutations touch
two scopes at once (environment delete: list + that owner's rows). One IPC message per mutation, one
handler pass. Each change still names exactly one scope, which is what the SPEC row asks for.

Why no active-environment kind: `ListEnvironments` returns `isActive` on every row
(`packages/shared/domain/variables.ts:32-39`). `SetActiveEnvironment` changes that list, so
`environments` covers it. A separate key would fetch the same rows twice.

Why no originating-window filter: the bound call carries no window identity, and adding one is
plumbing for one redundant local refetch. Structural sharing makes that refetch a no-op for
reactivity when data is unchanged (`replaceData`, `query.js:87`).

### 2.3 Emission sites — every mutation, audited

Emit only after the repo call succeeds, before `return`. Full audit of `SI/bridge/{collections,variables}.go`
methods (`grep -n "^func (s \*\(Collections\|Variables\)Service)"`); nothing else in `SI` writes
`Repos.Collections`/`Repos.Variables` (checked: only `ApiVars.ResolveRequest`/`NewResolver` reads,
in `http.go:100` and `grpc.go:70,121`).

| # | Method | File:line | Changes emitted |
|---|---|---|---|
| 1 | `CollectionsService.SaveRequest` | `collections.go:90` | tree, savedRequest(ItemID) |
| 2 | `CollectionsService.SaveGrpcRequest` | `:111` | tree, savedRequest(ItemID) |
| 3 | `CollectionsService.CreateCollection` | `:129` | tree |
| 4 | `CollectionsService.CreateItem` | `:148` | tree |
| 5 | `CollectionsService.CreateGrpcItem` | `:174` | tree |
| 6 | `CollectionsService.Rename` | `:196` | tree |
| 7 | `CollectionsService.Delete` target `collection` | `:209` | tree, variables(collection, ID) |
| 8 | `CollectionsService.Delete` target `item` | `:209` | tree |
| 9 | `CollectionsService.Import` | `:272` | tree — see note |
| 10 | `VariablesService.CreateEnvironment` | `variables.go:33` | environments |
| 11 | `VariablesService.UpdateEnvironment` | `:57` | environments |
| 12 | `VariablesService.DeleteEnvironment` | `:74` | environments, variables(environment, ID) |
| 13 | `VariablesService.DuplicateEnvironment` | `:85` | environments |
| 14 | `VariablesService.SetActiveEnvironment` | `:98` | environments |
| 15 | `VariablesService.ReorderEnvironments` | `:109` | environments |
| 16 | `VariablesService.Upsert` | `:162` | variables(v.Scope, v.OwnerID) — from the returned row |
| 17 | `VariablesService.Delete` | `:183` | variables(scope, owner) — see repo change |
| 18 | `VariablesService.Reorder` | `:199` | variables(args.Scope, args.OwnerID) |
| 19 | `VariablesService.ApplyBulk` | `:217` | variables(args.Scope, args.OwnerID) |

No emit (read-only or out of scope): `List`, `GetRequest`, `GetGrpcRequest`, `Export`,
`ListEnvironments`, `List` (variables), `History`, `Reveal`, `RevealHistory`. History adoption
(`grpcHistoryAdopt`/`historyAdopt`) is history-store state, not in this phase.

Note on #9 (Import): emit `tree` whenever `ImportTree` committed, on every later path. That covers
success, rollback success (net-zero change, one harmless refetch), and rollback failure — the
partially imported collection stays visible, and other windows must see it (`collections.go:303-319`).
Use `defer emitApiData(...)` right after `ImportTree` returns nil. No `variables` change: the new
collection id cannot be cached anywhere yet.

Note on #7: a collection delete cascades its items and its collection-scope variables
(`0006_p4_collections.sql:19`, `0007_p5_variables.sql:19`, `ON DELETE CASCADE`). Descendant
saved-request queries are pruned renderer-side from the new tree (§3.4), so Go needs no subtree walk.

Repo change for #17: `VariablesRepo.Delete(id string) error` (`SI/storage/repos/variables.go:644`)
already reads `collection_id, environment_id` and derives `scope, ownerID` at `:671-674` for its own
reindex. Change the signature to `Delete(id string) (model.VariableScope, string, error)` and return
them. Update the one production caller (`SI/bridge/variables.go:187`) and the one test caller
(`SI/storage/repos/variables_test.go:68`). Do not re-read the row in the bridge — that is a second
query and a race with the delete.

Test fixture: `SI/bridge/collections_import_atomicity_test.go:64` builds `appcore.Deps` without
`Events`, so the new `Import` emit would dereference a nil interface. Give it `Events: &fakeEmitter{}`
(the same-package no-op double at `SI/bridge/grpc_test.go:300`). No nil guard in `emitApiData`:
production always wires `deps.Events` (`apps/kira-studio/main.go:122`), and a guard would hide a
real wiring bug.

No new Go test. The emits are one-line wiring; CLAUDE.md's test bar excludes them.

## 3. TS side: channel, listener, query module

### 3.1 Channel and payload type

`SP/events.ts`: add `apiDataChanged: 'kira:api:dataChanged'` to `CHANNEL`, with a one-line comment in
the `customScriptsChanged` style. Add a hand-written payload type next to `AppMetricsSample`, since
no generated binding carries an emitted-only shape (that file's own comment explains why):

```ts
export type ApiDataChange =
  | { kind: 'tree' }
  | { kind: 'savedRequest'; itemId: string }
  | { kind: 'variables'; scope: VariableScope; ownerId: string }
  | { kind: 'environments' };

export interface ApiDataChangedEvent {
  changes: ApiDataChange[];
}
```

(`import type { VariableScope } from '../domain/variables'`.)

`SF/bridge/apiControl.ts`: add
`onApiDataChanged: (cb: (event: ApiDataChangedEvent) => void): (() => void) => on(CHANNEL.apiDataChanged, cb)`,
next to `onGrpcCall` (`:156`). In `SF/bridge/index.ts:63` and `:418`, update both "the Api module's
39" counts to 40.

`ST/ui/support/ipcChannels.ts`: add `apiDataChanged: 'kira:api:dataChanged'` beside
`customScriptsChanged` (`:207`), so UI specs can drive it with `emitWailsEvent`.

### 3.2 Query module: `SF/api/state/apiQueries.ts` (new)

One module owns the keys, the query options, the invalidation helper and the listener. Precedents:
`SF/state/schemas.ts` (options object, `staleTime: Infinity` because Go pushes, broadcast →
`invalidateQueries`) and `SF/state/maskRules.ts`.

Keys follow P99 §5.5's flat `[domain, ...ids]` convention (`PW/state/queryClient.ts:6-8`):

```ts
export const apiCollectionsTreeKey = ['apiCollectionsTree'] as const;
export function apiSavedRequestKey(itemId: string) { return ['apiSavedRequest', itemId] as const; }
export function apiSavedGrpcRequestKey(itemId: string) { return ['apiSavedGrpcRequest', itemId] as const; }
export const apiEnvironmentsKey = ['apiEnvironments'] as const;
export function apiVariablesKey(scope: VariableScope, ownerId: string) {
  return ['apiVariables', scope, ownerId] as const;
}
```

Options factories, all with `staleTime: Number.POSITIVE_INFINITY`. Never `'static'`: `refetchQueries`
skips static queries entirely (`queryClient.js:329`, `isStatic()` at `query.js:176`).

- `apiCollectionsTreeQueryOptions()` → `control.collectionsList()`, normalised as `apiControl.ts:172-173`
  does now.
- `apiSavedRequestQueryOptions(itemId)` → `HttpSavedRequest | null`. The queryFn catches the bridge
  error and returns `null`. `null` means "confirmed orphan" and `undefined` (no data) means "not
  loaded yet". This keeps P108 F4's orphan/not-loaded split exactly (`collections.ts:85-90,202-219`
  treats any `GetRequest` error as orphan today), without two parallel maps.
  `httpSavedRequestSchema.parse` stays inside the queryFn.
- `apiSavedGrpcRequestQueryOptions(itemId)` — the gRPC sibling, `grpcSavedRequestSchema.parse`.
- `apiEnvironmentsQueryOptions()` → `control.variablesListEnvironments()`.
- `apiVariablesQueryOptions(scope, ownerId)` → `control.variablesList(scope, ownerId)`.

Imperative readers for non-component code (async, cache-first, refetch when invalidated — exactly
`queryClient.query`'s contract with `staleTime: Infinity`, `queryClient.js:367-375`; `fetchQuery`/
`ensureQueryData` are deprecated in 5.103.2):

- `loadCollectionsTree()`, `loadEnvironments()`, `loadVariableRows(scope, ownerId)` (returns `[]` for
  `ownerId === ''` with no fetch, preserving `ensureVariablesLoaded`'s `''` no-op),
  `loadSavedRequest(itemId)`, `loadSavedGrpcRequest(itemId)`.

### 3.3 `refreshApiQuery(queryKey)` — the one invalidation helper (F2's successor)

Every invalidation goes through this: the event handler and every mutation's `onSuccess` where a
re-list is needed.

```ts
export async function refreshApiQuery(queryKey: QueryKey): Promise<void> {
  const inFlight = queryClient.getQueryCache().find({ queryKey, exact: true })?.promise;
  await queryClient.invalidateQueries({ queryKey, exact: true });
  if (inFlight) {
    await inFlight.catch(() => {});
    await queryClient.invalidateQueries({ queryKey, exact: true });
  }
}
```

Why the second invalidate — this is the F2 race, restated for TanStack. Verified in
`query-core@5.103.2`:

- `query.fetch` with `cancelRefetch` cancels an in-flight fetch only when `data !== undefined`.
  With no data yet, it **joins** the in-flight fetch and returns its promise (`query.js:298-303`).
  So invalidating during a first load hands back the pre-change answer.
- `invalidateQueries` refetches only `type: 'active'` by default (`queryClient.js:305`). A query with
  no observer but a fetch in flight (a `send()` calling `queryClient.query`) is marked invalidated,
  then that fetch lands, and `successState` clears `isInvalidated`. The change is lost.

Both are the old "slow pre-edit reply clobbers a fresher write" bug. The rule: a fetch that was
already running when a change landed is never trusted as the post-change answer. Wait for it, then
invalidate once more. Worst case is one extra local SQLite read. Comment it in two lines, naming F2.

A silently cancelled fetch's awaiters are handed the replacement fetch's promise, not an error
(`query.js:393`, `if (error.silent) return this.#retryer.promise`). So `send()` never sees a
`CancelledError` from this.

### 3.4 Listener: `initApiDataSync()`

Exported from `apiQueries.ts`. Called once in `SF/main.ts` `bootstrap()`, synchronously, before the
`Promise.all` (`:315`). It needs no data, and it must be live before any query exists, whether or not
the Api panel ever mounts. Same `unsubscribe?.()` then resubscribe shape as `initSchemaSync`
(`SF/state/schemas.ts:166`).

Handler, for one `ApiDataChangedEvent`:

- `tree` → `refreshApiQuery(apiCollectionsTreeKey)`, then `reconcileTree()`.
- `savedRequest` → `refreshApiQuery` on both `apiSavedRequestKey(itemId)` and
  `apiSavedGrpcRequestKey(itemId)`. Only one exists; the other is a no-op.
- `variables` → `refreshApiQuery(apiVariablesKey(scope, ownerId))`.
- `environments` → `refreshApiQuery(apiEnvironmentsKey)`, then `reconcileEnvironments()`.

Run a single event's changes concurrently (`Promise.all`). Log a failure with `console.warn`, same as
`collections.ts:564` — a broadcast has no user action to attach an error strip to.

`reconcileTree()` reads `queryClient.getQueryData(apiCollectionsTreeKey)`. If data exists:

- For every cached `['apiSavedRequest', id]`/`['apiSavedGrpcRequest', id]` query whose `id` is not
  in `items`, run `queryClient.setQueryData(key, null)`. The tab reads as orphan — D14's rule and
  `deleteRow`'s current local behaviour (`collections.ts:470-478`), now cross-window and cascade-aware
  for free.
- For every cached `['apiVariables', 'collection', id]` whose `id` is not in `collections`, run
  `queryClient.removeQueries({ queryKey, exact: true })`. This is F9's `listCache` eviction,
  generalised.

`reconcileEnvironments()`: for every cached `['apiVariables', 'environment', id]` whose `id` is not in
the list, run `removeQueries`. F9 again.

Mutations in this window call the same two reconcilers after their own refresh (§4). One code path
serves local and remote changes.

### 3.5 Reactivity rule — two reader kinds

`notifyManager` batches observer notifications with `setTimeout(0)` (`notifyManager.js:7`), and
vue-query never swaps the scheduler. So a `useQuery` result's `.data` lags the cache by one macrotask
after a fetch resolves. State this in one comment in `apiQueries.ts`, and follow it everywhere:

- **Reactive readers** (computeds, templates, watches) read a `useQuery` result's `data`.
- **Imperative code after an `await`** (a mutation continuing to `revealItem`, `send()`, reconcilers)
  reads `queryClient.getQueryData(key)` or awaits a `load*()` reader. Never the observer ref.

## 4. Stores: thin wrappers, server state out

### 4.1 Decision: keep the three Pinia stores; move only server state out

Kept in Pinia (client state, CLAUDE.md "one store, one concern"):

- `useCollectionsStore`: `expanded`, `selected`, `search`, `renamingKey`, `busy`, `report`,
  `exportWarning`, `error`.
- `useVariablesStore`: `incognitoEnvByTab`, `error`.
- `useVariableSetStore`: per-tab `error`, `revealedValues`, reveal expiry, history popover.

Moved to TanStack Query: every item in §0's table.

Tradeoff. Replacing the stores entirely would push tree-row derivation (`childrenIndex`,
`visibleRows`, `revealItem`, `folderPaths`), UI state and the F10 error channel into each component.
It would also churn ~20 call sites for no behaviour change. And several non-component callers
(`views/*/state.ts`, `curl.ts`, the command palette, `App.vue`'s menu import) need one import point.
Keeping each store as the facade — computeds over query data plus actions that run mutations —
leaves the public surface mostly intact while the cache underneath changes. The cost is one rule the
implementer must hold: server data comes only from a query, never a store field. §9 check 1 enforces
that.

### 4.2 Query observers inside setup stores

`useCollectionsStore` and `useVariablesStore` each create one app-lifetime observer for their singleton
list:

```ts
const treeQuery = useQuery(apiCollectionsTreeQueryOptions(), queryClient);
```

Pass `queryClient` explicitly (the `PW/state/queryClient.ts` singleton). `useBaseQuery` uses the
explicit client instead of `inject` (`vue-query useBaseQuery.js:15`: `queryClient || useQueryClient()`).
That is required: `SF/main.ts` instantiates stores before `app.use(VueQueryPlugin)`, and unit tests
have no app. The Pinia setup store's own effect scope owns the observer (`onScopeDispose`
unsubscribes). An always-mounted observer keeps the tree and environment list active, so
`invalidateQueries` refetches them. Creating the store starts the first fetch, so `initCollections`/
`initVariables` and their `loaded`/`initInFlight` guards go away. That also subsumes P108 F5
(`HttpRequestView.vue:473-477`, `GrpcRequestView.vue:273-276`): any code touching the store loads the
tree.

Per-owner and per-item queries (`apiVariables`, `apiSaved*`) are observed from components (§6), not
the store. Their keys are dynamic.

Unit tests: `queryClient` is a module singleton, so every spec touching these stores calls
`queryClient.clear()` in `beforeEach`, next to its existing `setActivePinia(createPinia())`.

### 4.3 Store getters over query data

`useCollectionsStore`:

- `collections`/`items` → `computed(() => treeQuery.data.value?.collections ?? [])` (and `items`).
- `loaded` → `computed(() => treeQuery.data.value !== undefined)` (`VariableSetView.vue:50-52`
  still reads it).
- `error` → keep `state.error` (the mutation channel, F10). Add `treeLoadError` =
  `treeQuery.error.value?.message ?? null`. Render it wherever `state.error` renders today
  (CollectionsPanel's strip). A failed `List` used to reject into a `void`ed promise with nothing
  shown.
- `childrenIndex`, `visibleRows`, `folderPaths`, `itemRecord`, `collectionRecord`, `collectionIdFor`:
  unchanged bodies, reading the computeds above.
- `revealItem` and `subtreeItemIds`: imperative, called after awaits. Read
  `queryClient.getQueryData(apiCollectionsTreeKey)?.items` per §3.5, not the computed.
- `savedRequestFor(itemId)`, `savedGrpcRequestFor`, `isOrphanRequest`, `isOrphanGrpcRequest`,
  `ensureSaved*Loaded`, `fetchSaved*`: removed from the store. Components use §6's composables;
  imperative callers use `loadSavedRequest`/`loadSavedGrpcRequest`.

`useVariablesStore`:

- `environments` → `computed(() => envQuery.data.value ?? [])`. `activeEnvironment`,
  `activeEnvironmentId`, `activeEnvironmentColor`, `environmentIdForTab`, `environmentColorForTab`:
  unchanged bodies over it, so `SF/views/shared/request/useRequestChrome.ts` is untouched.
- `loaded` → `computed(() => envQuery.data.value !== undefined)`.
- F9 incognito half: add `watch(environments, (list) => drop every incognitoEnvByTab entry whose id is
  not in list)` inside the store. This replaces the loop in `deleteEnvironment` (`variables.ts:183-185`)
  and now also covers a delete made in another window. Skip while `envQuery.data.value` is
  `undefined`, so an unloaded list never wipes overrides.

`useVariableSetStore`:

- Remove `variableSetRuntime[tab].rows`, `variableSetRows`, `loadVariableSetRows`, `cacheKey`,
  `listCache`, `listCacheGen`, `bumpListCacheGen`, `ensureInFlight`, `ensureVariablesLoaded`,
  `cachedVariables`, `evictListCache`. `VariableSetRuntime` keeps `error` only.
- `firstWinsByName`, `mergedValuesAndSecrets`, `overviewRows` become **pure functions** over rows,
  exported from `variables.ts` (not store members):
  `mergeVariableRows(collectionRows, environmentRows)` and
  `overviewRowsOf(collectionRows, environmentRows)`. Same bodies, with arguments in place of
  `cachedVariables` calls.
- New async helper `variablesForSend(tabId, itemId)` →
  `{ collectionId, environmentId, values, secretNames }`. It awaits `loadCollectionsTree()` and
  `loadEnvironments()`, derives the two ids through the stores' existing `collectionIdFor`/
  `environmentIdForTab`, awaits both `loadVariableRows`, then calls `mergeVariableRows`. This
  replaces five duplicated sync blocks (§6.3). Awaiting `queryClient.query` means a send after an
  invalidation always refetches first, so stale plain values can never substitute — the concrete F12
  symptom. It also closes F5's "tree not loaded yet" gap at send time.

### 4.4 Mutations: `useMutation` per bridge write

Each store creates its mutations with `useMutation({ mutationKey, mutationFn, onSuccess }, queryClient)`
— the same explicit-client pattern as §4.2. Store actions call `mutateAsync` inside their existing
try/catch, so the F10 `state.error`/`setVariableSetError` channels and their "cleared on next success"
semantics stay unchanged. This follows `SF/state/schemas.ts`'s `useSaveDdlMutation` shape.

Mutation keys: `['apiCollectionsTree', '<verb>']`, `['apiEnvironments', '<verb>']`,
`['apiVariables', '<verb>']`.

`onSuccess` rules:

- **List mutations** (tree, environments, variable rows): `await refreshApiQuery(key)` for the
  touched key, then the matching reconciler (§3.4). Callers that read fresh data right after
  (`revealItem`, selection of the new key) await `mutateAsync`, then read `getQueryData` (§3.5). The
  Go event triggers a second refresh of the same key moments later. Structural sharing makes it a
  no-op for watchers — accepted cost, stated in the §2.2 rationale.
- **Saved-request writes** (`saveRequest`, `saveGrpcRequest`, `submitSaveDialog`'s create): run
  `queryClient.setQueryData(apiSaved*Key(itemId), request)` synchronously with the payload the tab
  just saved. Then refresh the tree. This is `saveRequest`'s existing "cache moves in step with the
  write" rule (`collections.ts:613-615`), and the maskRules/schemas precedent (P99 §5.5: a
  synchronous cache write, not a fire-and-hope invalidate). The Go `savedRequest` change then
  refetches Go's stored copy. That copy must compare equal under `isDirty`/`sameRequest`
  (`packages/api-core/src/http/saved.ts`). A restored tab already depends on this today (P108 F4), so
  it is expected to hold. §9 check 6 verifies it for real.
- `deleteRow`: after the delete, for every id in `subtreeItemIds(row)` (computed **before** the
  delete from `getQueryData`), `setQueryData(apiSaved*Key(id), null)`. Then refresh the tree, which
  runs `reconcileTree` and drops the collection's variable query when `row.kind === 'collection'`.
  The explicit `evictListCache` call (`collections.ts:486`) goes. `closeVariableSetTabsForOwner`
  stays — tab state, not cache.
- `deleteEnvironment`: the explicit incognito loop and `evictListCache` (`variables.ts:183-189`) go.
  The store's `environments` watch (§4.3) and `reconcileEnvironments` cover both.
  `closeVariableSetTabsForOwner` stays.
- `duplicateRow`: `fetchSavedRequest(row.id)` becomes `await loadSavedRequest(row.id)`. A `null`
  result (orphan) throws a clear `Error` into `state.error`, instead of creating an empty copy.
- `importCollection`: the `finally` reload (`:677`) becomes `await refreshApiQuery(apiCollectionsTreeKey)`
  plus `reconcileTree()`, with the same success-or-failure semantics (F10). `busy` stays a plain
  synchronous flag. A `useMutation`'s `isPending` reaches Vue only after the `setTimeout(0)` batch
  (§3.5), which would reopen P28 D18's re-entry window.
- `exportCollection`: not a server-state write. Stays a plain `control.collectionsExport` call, no
  `useMutation`.
- `openEnvironments` (`variables.ts:217-220`): drop its `void loadEnvironments()`. The observer is
  always live.

Variable-row mutations (`upsertVariable`, `deleteVariable`, `reorderVariables`,
`applyBulkVariables`) each become `useMutation`s whose `onSuccess` runs
`refreshApiQuery(apiVariablesKey(scope, ownerId))`. `restoreHistoryEntry` (`:737-758`) reads the row
from `queryClient.getQueryData(apiVariablesKey(scope, ownerId))` instead of
`variableSetRows(tabId)`.

## 5. What happens to P108 Part 9's F2 and F9

The SPEC row says both "stay as landed — this phase replaces the caching mechanism underneath them,
not those two fixes' own correctness". Read as: keep each guarantee, change its mechanism, and remove
nothing without a replacement that provides the same property.

**F2** (`63ff4f9`: per-key in-flight dedupe plus per-key generation guard on `ensureVariablesLoaded`):

- Per-key in-flight dedupe (`ensureInFlight`, `variables.ts:383-408`) is **redundant — remove it**.
  `query.fetch` joins a running fetch for the same key (`query.js:300-302`), and `useQuery` observers
  on one key share one query. The same applies to `initInFlight` (`variables.ts:80-87`, P22b D8's
  double-fetch fix), which also goes.
- The generation guard (`listCacheGen`/`bumpListCacheGen`, `:367-375`) is **replaced, not simply
  dropped**. TanStack covers most of it: `invalidateQueries` silently cancels an in-flight fetch that
  already has data, and starts a fresh one (`query.js:299`). Two cases slip through, both verified in
  §3.3: a first load in flight, and an observer-less query in flight. `refreshApiQuery` closes both.
  That is F2's guarantee — a stale reply never overwrites a fresher write — kept by one helper
  instead of a per-key counter.
- `ST/unit/api-variables-ensure-load-race.spec.ts`: rewrite against `refreshApiQuery`. Keep one test:
  a slow first `variablesList` in flight, a change lands, and the cache ends on the post-change rows.
  Add a second: the same with an observer-less `queryClient.query` caller in flight (the `send()`
  path). Drop the "concurrent calls share one request" test. That is library behaviour now, and
  CLAUDE.md's bar says not to restate it.

**F9** (`e334637`: env delete drops matching incognito overrides and evicts
`listCache[environment:<id>]`; collection delete evicts `listCache[collection:<id>]`):

- Incognito override drop: **still needed**, moved into the `environments` watch in
  `useVariablesStore` (§4.3). It now also fires for a delete made in another window, which F9's local
  loop never saw.
- Cache eviction: **still needed**, now `removeQueries` in `reconcileTree`/`reconcileEnvironments`
  (§3.4). It runs on every list change, local or remote. It is not strictly required for correctness
  any more: Go's `variables` change for the deleted owner makes an active observer refetch `[]`, and
  the override drop makes the owner unreachable. It is kept anyway so dead owners do not linger for
  `gcTime`, and because the SPEC row asks for F9's own guarantee to be kept.
- `ST/unit/api-variables-delete-eviction.spec.ts`: rewrite. It asserts that after `deleteEnvironment`
  the incognito override is gone and `queryClient.getQueryCache().find({ queryKey:
  apiVariablesKey('environment', id) })` is `undefined`. It asserts the same for `deleteRow` on a
  collection. Add one case with no local delete: emit a `tree`/`environments` change whose refetched
  list lacks the owner, and assert the same eviction. That is the cross-window case.

## 6. Call sites

### 6.1 Composables (in `apiQueries.ts`)

- `useVariableRows(scope: VariableScope, ownerId: MaybeRefOrGetter<string>)` →
  `useQuery(() => ({ ...apiVariablesQueryOptions(scope, toValue(ownerId)), enabled: toValue(ownerId) !== '' }))`.
- `useSavedRequest(itemId: MaybeRefOrGetter<string | null>)` and `useSavedGrpcRequest(...)`, both with
  `enabled: !!toValue(itemId)`.

### 6.2 Components

- `SF/views/httprequest/HttpRequestView.vue`:
  - `:172-194`: `saved` → `useSavedRequest(() => props.tab.state.itemId)`. `saved` becomes
    `computed(() => q.data.value ?? null)`. `unresolved` becomes
    `itemId !== null && q.data.value === undefined`. Delete the `ensureSavedRequestLoaded` watch.
  - `:274-293`, `:414`: delete the `ensureVariablesLoaded` watch. Add
    `colRows = useVariableRows('collection', collectionId)` and
    `envRows = useVariableRows('environment', envId)`. `unresolvedRefs`/`resolvedCookiesUrl` call
    `mergeVariableRows(colRows.data.value ?? [], envRows.data.value ?? [])`.
  - `variables` (`:286`) → `variableSupport(colRows…, envRows…)` (§6.4).
  - `:473-477`: delete the `initCollections()` call and its F5 comment. §4.2 subsumes it.
- `SF/views/grpcrequest/GrpcRequestView.vue`: the same four changes at `:114-195` and `:273-276`.
- `SF/api/VariableSetView.vue`:
  - `:79-85`: `rows` becomes `useVariableRows(scope.value, ownerId)`'s `data ?? []`. The scope is fixed
    per tab. Delete `onMounted`'s init/load calls.
  - `hasLoadedOnce` (`:395-410`) keys off `rowsQuery.data.value !== undefined` instead of the first
    watch firing.
  - `syncDrafts` → draft merge (§6.5).
- `SF/api/EnvironmentsView.vue`: `syncDrafts` → draft merge (§6.5). Reads stay `variablesStore.environments`.
- `SF/api/VariablesOverviewPanel.vue:37-39`: two `useVariableRows` for its props, and
  `overviewRowsOf(...)`.
- `SF/api/CollectionsPanel.vue:40,44` and `SF/api/EnvironmentSelect.vue:34`: delete
  `onMounted(initCollections)`/`onMounted(initVariables)`.
- `SF/api/CollectionsTree.vue:63,67` (`onOpen`): `await loadSavedGrpcRequest(row.id)` /
  `loadSavedRequest(row.id)`. On `null`, open the tab as today's orphan path does. Check the current
  thrown-error behaviour and keep it equivalent.
- `SF/api/SaveRequestDialog.vue:27-30`: unchanged. It reads store computeds.

### 6.3 Non-component readers

Replace each sync `collectionIdFor` + `environmentIdForTab` + `mergedValuesAndSecrets` block with
`await variablesForSend(tabId, tab.state.itemId)`:

- `SF/views/httprequest/state.ts:170-175` (`send`) and `:269-274` (`resolveForExport`).
- `SF/views/grpcrequest/state.ts:144-149` (`resolveForDescribe`) and `:323-328` (`call`).
- `SF/views/grpcrequest/state.ts:231-232` (`loadSchema`) needs only the ids. Use the same helper and
  ignore values, or add `apiIdsForTab` (awaits the tree and environments, returns the ids). Pick one
  and keep a single helper file.

`send`'s P6 D7 comment ("no await" in the common case) refers to the dynamic-generators chunk. That
guarantee is untouched. Add one line: the variables await resolves from cache unless a change
invalidated it.

`SF/api/state/curl.ts:247-261` (`findSecretVariableId`) runs inside the async `revealSecretValues`.
Make it `async`, with `await loadVariableRows(...)` for each scope.

### 6.4 `variableCompletion.ts`

`variableSupport(collectionId, environmentId)` (`SF/api/state/variableCompletion.ts:140`) →
`variableSupport(collectionRows: ApiVariable[], environmentRows: ApiVariable[])`. `scopeOf`
(`:83-94`) tests membership in `environmentRows` directly. Two callers only (both request views,
§6.2). Update the P15b D4 prop comments that name `variableSupport(...)` only if they quote the
signature.

### 6.5 Draft merge — required by live cross-window data

`VariableSetView.vue`'s `syncDrafts` (`:154-180`) and `EnvironmentsView.vue`'s (`:59-67`) wipe every
draft, including the trailing new-row draft, whenever the list changes. Today the list only changes
after this window's own commit, so that is harmless. Once another window's edit refetches the same
key, it would erase text the user is typing mid-edit. That is a regression this phase itself would
introduce, so it is in scope.

Rule. Record the row snapshot each draft was seeded from. On a list change, for each incoming row:

- keep the existing draft if it is **dirty against its seed** (a field changed, or `valueTouched`)
  **and differs from the incoming row**;
- otherwise reseed from the incoming row (`valueTouched = false`, F3's `revealedValues` seeding kept).

Drop drafts for rows no longer present. Keep `trailingDraft` untouched (`commitDraft` already resets
it at `:284`). Reseed `order` from the incoming rows unless a drag is in progress. Check whether
either view tracks drag state; if not, reseed.

After this window's own commit, the draft equals the incoming row, so it reseeds — today's behaviour.
A remote edit to a row the user is not touching reseeds. A remote edit to a row being typed keeps the
typing.

Extract the rule as a pure function, `mergeDrafts(seeds, drafts, incomingRows)`, in a new
`SF/api/state/draftMerge.ts`, used by both views. It is a decision structure with interacting rules,
which CLAUDE.md's test bar admits. Add one unit spec, `ST/unit/api-draft-merge.spec.ts`, with four
cases: own-commit reseed, untouched-row remote reseed, dirty-row remote keep, removed row dropped.

## 7. Commit order

One Sonnet implementer, sequential. Each commit passes `bun run typecheck:web:studio`, `bunx biome
check` on touched files and (Go commits) `go test ./apps/kira-studio/internal/bridge/...
./apps/kira-studio/internal/storage/repos/...`. The pre-commit hook must be green on every commit.
Never use `--no-verify` to finish. Conventional Commits, one concern each:

1. `feat(studio): broadcast api-data-changed on every API-client mutation (P112)`: §2 in full —
   channel const, `apidata.go`, the 19 emits, the repo `Delete` signature change and its two callers,
   and the import-atomicity test emitter.
2. `feat(studio): api-data-changed channel, listener and query module (P112)`: §3.1-§3.4, with the
   handler already keyed for all four kinds. Invalidating keys nothing observes yet is a no-op. Wired
   in `main.ts`.
3. `refactor(studio): environments list onto TanStack Query (P112)`: §4.2-§4.4 for `useVariablesStore`,
   the incognito watch, and the §6.2 init-call removals for environments.
4. `refactor(studio): variable rows onto TanStack Query (P112)`: the `useVariableSetStore` removals,
   pure merge functions, `variablesForSend`, §6.2-§6.4 variable call sites, variable mutations, and
   `reconcileEnvironments` eviction.
5. `refactor(studio): collections tree onto TanStack Query (P112)`: the tree observer, tree mutations,
   `reconcileTree`'s variables half, and the `initCollections` removals.
6. `refactor(studio): saved requests onto TanStack Query (P112)`: saved-request queries and
   composables, the null-orphan convention, `reconcileTree`'s saved half, the `deleteRow`/save
   rewrites, and the request views' `saved`/`unresolved`.
7. `fix(studio): keep in-progress drafts across a cross-window refetch (P112)`: §6.5 plus its spec.
8. `test(studio): move API-client unit specs onto the query cache (P112)`: every spec in §7.1. If a
   spec breaks in an earlier commit, fix it in that commit instead. The hook runs typecheck only, so
   unit specs may lag until here, but none may be left red.
9. `test(studio): cross-window api-data-changed UI spec (P112)`: §7.2.
10. `docs: record api-data-changed and API-client query caches (P112)`: §7.3.

Commits 3-6 are ordered by dependency. `variablesForSend` (4) needs the environments query (3).
`reconcileTree` (5-6) prunes variable queries (4).

### 7.1 Unit specs (`ST/unit/`)

| Spec | Action |
|---|---|
| `api-variables-ensure-load-race.spec.ts` | rewrite (§5 F2) |
| `api-variables-delete-eviction.spec.ts` | rewrite + cross-window case (§5 F9) |
| `api-variables-duplicate-names.spec.ts` | rewrite as a direct `mergeVariableRows` test (D12 first-wins); no store |
| `api-collections-delete-orphans-cache.spec.ts` | adapt: seed the tree via `queryClient.setQueryData`, assert `getQueryData(apiSavedRequestKey(id)) === null` for the cascaded subtree. The subtree walk is the non-trivial part, so keep it |
| `api-collections-ensure-saved-loaded.spec.ts` | **delete**. What it guarded (fetch once, orphan flag) is now TanStack dedupe plus a one-line `catch → null`. Restating either fails CLAUDE.md's test bar. Say so in the commit body |
| `api-collections-search-debounce.spec.ts` | adapt seeding only (`setQueryData` instead of assigning `collectionsStore.collections/items`) |
| `api-secret-reveal-expiry-round2.spec.ts` (`:87`) | replace `ensureVariablesLoaded` with `setQueryData`/`loadVariableRows` |
| `api-variables-reveal-grace-expiry.spec.ts` | adapt only if it touches a removed member; check with typecheck `typecheck:unit:studio` |
| `api-draft-merge.spec.ts` | new (§6.5) |

Every rewritten spec calls `queryClient.clear()` in `beforeEach`.

### 7.2 UI spec

New `ST/ui/api-cross-window-sync.spec.ts`. Drive the event with `emitWailsEvent(page,
IPC.apiDataChanged, …)` after swapping the mocked binding's next response (the
`TREE_WITH_ITEM`/`TREE_RENAMED` pattern in `ST/ui/grpc-request.spec.ts:598-600`). Three cases:

1. An `environments` change adds an environment. The selector lists it.
2. A `variables` change for the active environment changes a value. The URL's unresolved chip and
   Copy-as-cURL reflect it without a reload.
3. A `tree` change removes an open request's item. The tab's Save falls back to Save as (orphan).

Existing API UI specs (`collections`, `http-variables`, `http-curl`, `http-dynamic-values`,
`http-pipes`, `grpc-request`, `api-ui-consistency`, `api-secret-reveal-isolation`) mock
`collectionsList`/`variablesList` responses. Fetch timing moves (store-creation fetch, one extra
refetch per local mutation), so a spec that counts calls or sequences responses may need adjusting.
Fix each such spec in the commit that moved its behaviour. Run the full `bun run test:ui:studio`
once near phase end (CLAUDE.md "test once and fix").

### 7.3 Docs

- `docs/ARCHITECTURE.md`, "Multi-window" section (`:2465`): add API collections, saved requests,
  variables and environments to the **App-wide** bullet, naming `kira:api:dataChanged` as their
  broadcast and TanStack Query as the renderer cache. In the "Menu commands…" paragraph, update
  "the six state-change channels" to the real count after this channel.
- `docs/v1.9/SPEC.md`: the implementer writes `## P112 result` after the last result section. List
  commits with hashes, the §9 verification run for real, and any spec adjusted in §7.2. No other SPEC
  row changes.
- No `CLAUDE.md` change.

## 8. Migration risk and conflict notes

- **Execution position.** P112 is the last row (after P109 docs true-up, P110, P111). Per CLAUDE.md
  it runs only after P108 Parts 10-12 and 20, and P109-P111, are committed. This plan was written at
  `264069c`. Before commit 1, re-verify every line reference in §2.3, §4 and §6 with
  `codegraph_explore` against the then-current tree.
- **Files owned by other reviews.** Part 9 owns `SF/api/**` and `SF/views/{httprequest,grpcrequest}/**`,
  and its fixes (F2-F16) landed on exactly the code this phase rewrites. Their guarantees move as
  §4-§6 state; none are silently lost. Part 8 owns `SI/bridge/{collections,variables}.go` and
  `SI/storage/repos/variables.go`. Part 7 owns `SI/bridge/events.go`. Part 13 owns `SP/events.ts`.
  Part 12 owns `SF/main.ts` and `ST/ui/support/**`. Part 10 owns `SF/views/shared/**` —
  `useRequestChrome.ts` is deliberately left untouched (§4.3 keeps `environmentIdForTab`'s
  signature). If any of these parts is still open when P112 starts, that is a table-order violation
  — stop and report, do not merge around it.
- **P109 runs first.** P109 trues up `docs/ARCHITECTURE.md` before this phase lands. §7.3's doc edit
  must therefore be complete by itself. Nothing may be left for a later true-up.
- **Behavioural risks to watch:**
  - (a) Saved-request round-trip equality (§4.4). If Go's stored copy does not compare equal to the
    just-saved tab state, the dirty dot would light after every save once the event refetch lands.
    §9 check 6 catches it. The fix would be in `sameRequest`, not in skipping the refetch.
  - (b) Store-creation fetch in unit tests. Any spec that creates `useCollectionsStore`/
    `useVariablesStore` now fires `collectionsList`/`variablesListEnvironments` immediately. Its
    control mock must answer them.
  - (c) An observer created in a setup store outlives component scope by design. It is fine for two
    singleton lists. Do not create per-id observers in a store.

## 9. Verification (orchestrator runs each for real)

1. Grep for §0 acceptance 1's removed identifiers under `SF` and `ST` — zero hits.
2. Grep for `useQuery(`/`useMutation(` in `SF/api/state/{collections,variables}.ts` and
   `SF/api/state/apiQueries.ts`, and `useSavedRequest`/`useVariableRows` in both request views —
   real callers present.
3. Grep for `emitApiData(` in `SI/bridge/` — 19 call sites, matching §2.3. Every site sits after its
   repo call's error check.
4. `go test ./apps/kira-studio/...`, `bun run lint:go`, `bun run typecheck`, `bun run lint`,
   `bun run lint:dead`, `bun run test:unit`, `bun run build:studio` — all clean.
5. `bun run test:ui:studio` once at phase end — clean, including the §7.2 spec.
6. Manual two-window check on a real build (`bun run dev` or a built app, ⇧⌘N for a second window):
   - edit a variable in window B → window A's next send uses the new value;
   - switch the active environment in B → A's selector follows;
   - rename and delete a request in B → A's tree follows, and A's open tab reads orphan;
   - save a request in A → A's dirty dot stays off after the event refetch (risk (a)).
   If the session cannot open a GUI, record which items were covered by the §7.2 UI spec instead.
   Name any uncovered item in the result section as unverified. Do not claim it.
7. Confirm F2/F9 guarantees: the rewritten specs from §5 exist and pass.
