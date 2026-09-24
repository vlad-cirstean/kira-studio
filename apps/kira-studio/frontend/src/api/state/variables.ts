import type { PaletteColor } from '@shared/domain/color';
import type {
  ApiEnvironment,
  ApiVariable,
  ApiVariableBulkEntry,
  ApiVariableBulkResult,
  ApiVariableHistoryEntry,
  VariableScope,
} from '@shared/domain/variables';
import { registerTabRuntimeCleanup } from '@workbench/state/tabRuntime';
import { defineStore } from 'pinia';
import { computed, reactive, toRefs } from 'vue';
import { control } from '../../bridge/control';
import { useTabIncognitoStore } from '../../state/tabIncognito';
import { runReveal } from '../reveal';
import { closeVariableSetTabsForOwner, openEnvironmentsTab, renameVariableSetTabs } from '../tabs';
import { createRevealExpiry } from './revealExpiry';

// P5 D3/D11: the environment list and the app-global active selection — read-only at this point
// (list and switch); editing, secrets, history and reordering land in later commits on this same
// store. Mirrors http/state/collections.ts's own shape: one reactive object, re-listed after every
// mutation rather than patched locally, since the list is small and this keeps the store
// impossible to get out of step with what Go actually stored.
//
// P99: split out of the original single variables.ts into two stores — this one (environments) and
// useVariableSetStore below (the variable-set tab's runtime, send-time cache, gated reveal and
// history popover). The two are genuinely independent: nothing here reaches into the variable-set
// machinery, and nothing there reaches back into environment CRUD.

interface VariablesState {
  environments: ApiEnvironment[];
  loaded: boolean;
  /** P108 F10: an environment CRUD call's own failure message — every mutation below used to let
   *  this throw uncaught (a fire-and-forget `void` call from EnvironmentsView.vue), so a failed
   *  create/rename/delete/duplicate/reorder/activate left the row exactly as it was with nothing
   *  telling the user why. Cleared on the next successful mutation. */
  error: string | null;
}

export const useVariablesStore = defineStore('variables', () => {
  const state = reactive<VariablesState>({
    environments: [],
    loaded: false,
    error: null,
  });

  function dismissError(): void {
    state.error = null;
  }

  /** D3: the app-global selection, or null when none is active ("No environment"). */
  const activeEnvironment = computed<ApiEnvironment | null>(
    () => state.environments.find((e) => e.isActive) ?? null,
  );

  /** '' when no environment is active — the same convention SetActiveEnvironment's own id arg
   *  uses, and what control.httpSend's environmentId will carry at send time. */
  const activeEnvironmentId = computed(() => activeEnvironment.value?.id ?? '');

  /** P18 D17/D19: the active environment's colour, for the request views' toolbar rail and head
   *  dot (LAW 07) — 'none' with no environment active, the same "the rail slot stays reserved
   *  either way" treatment a colour of 'none' already gets. Always defined (never undefined), so
   *  ViewChrome's `envColor` prop always drives the dot rather than falling through to a
   *  connection's own colour, which an Api tab never has (F20 #6). */
  const activeEnvironmentColor = computed<PaletteColor>(
    () => activeEnvironment.value?.color ?? 'none',
  );

  async function loadEnvironments(): Promise<void> {
    state.environments = await control.variablesListEnvironments();
    state.loaded = true;
  }

  // P22b D8 regression: CollectionsPanel.vue now calls initVariables() on its own mount, alongside
  // EnvironmentSelect.vue's pre-existing call — both fire in the same tick on a fresh Api-mode
  // mount, before either's own loadEnvironments() await resolves and sets `loaded = true`, so the
  // `if (loaded) return` guard let both through and this fired variablesListEnvironments() twice
  // instead of once. `initInFlight` closes that window: a second caller during the first's own
  // in-flight load reuses its promise instead of starting a second real fetch.
  let initInFlight: Promise<void> | null = null;

  function initVariables(): void {
    if (state.loaded || initInFlight) return;
    initInFlight = loadEnvironments().finally(() => {
      initInFlight = null;
    });
  }

  /** id: '' selects "No environment" (D3). */
  async function setActiveEnvironment(id: string): Promise<void> {
    try {
      await control.variablesSetActiveEnvironment(id);
      await loadEnvironments();
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  // ---- P71 §3.3: the per-tab environment override ----
  //
  // An incognito tab's own environment pick lives here, in memory, never touching
  // api_environments.is_active — switching environment is the main reason to open an incognito tab
  // at all, so the selector itself stays enabled and useful rather than disabled (§3.3's own
  // "declined" note). Absent (no entry) until the user actually picks one: an incognito tab inherits
  // the app-wide selection at open time, so the common case is byte-identical to today.
  const incognitoEnvByTab = new Map<string, string>(); // tabId → environment id ('' = none)

  function environmentIdForTab(tabId: string): string {
    if (useTabIncognitoStore().isIncognito(tabId) && incognitoEnvByTab.has(tabId)) {
      return incognitoEnvByTab.get(tabId) as string;
    }
    return activeEnvironmentId.value;
  }

  function environmentColorForTab(tabId: string): PaletteColor {
    if (!useTabIncognitoStore().isIncognito(tabId) || !incognitoEnvByTab.has(tabId))
      return activeEnvironmentColor.value;
    const id = incognitoEnvByTab.get(tabId);
    return state.environments.find((e) => e.id === id)?.color ?? 'none';
  }

  /** In-memory when the tab is incognito, else the ordinary app-wide write (setActiveEnvironment). */
  async function selectEnvironmentForTab(tabId: string, id: string): Promise<void> {
    if (useTabIncognitoStore().isIncognito(tabId)) {
      incognitoEnvByTab.set(tabId, id);
      return;
    }
    await setActiveEnvironment(id);
  }

  registerTabRuntimeCleanup((tabId) => {
    incognitoEnvByTab.delete(tabId);
  });

  async function createEnvironment(
    name: string,
    description = '',
    color: PaletteColor = 'none',
  ): Promise<ApiEnvironment | undefined> {
    try {
      const env = await control.variablesCreateEnvironment(name, description, color);
      await loadEnvironments();
      state.error = null;
      return env;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      return undefined;
    }
  }

  /** P17 D14/P18 D19: replaces renameEnvironment — renaming, describing and colouring an
   *  environment are one row update. Also patches any open variable-set tab for this environment
   *  (D16), the same rename-follows-tab rule a collection's own rename already has. */
  async function updateEnvironment(
    id: string,
    name: string,
    description: string,
    color: PaletteColor = 'none',
  ): Promise<void> {
    try {
      await control.variablesUpdateEnvironment(id, name, description, color);
      renameVariableSetTabs('environment', id, name);
      await loadEnvironments();
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Deleting the active environment leaves none active (D3) — there is nothing to reassign.
   *  Closes any open variable-set tab for it too (D16) — unlike a request tab, it has no state of
   *  its own worth preserving once its owner is gone. */
  async function deleteEnvironment(id: string): Promise<void> {
    try {
      await control.variablesDeleteEnvironment(id);
      closeVariableSetTabsForOwner('environment', id);
      // P108 F9: an incognito tab's own override (above) is never cleared by anything else — left
      // in place, it kept substituting the deleted environment's plain values in stage 1 while Go
      // resolved no secrets for the (now missing) environment id, and the selector showed nothing
      // selected while send still used the stale pick. Falling back drops it back to the app-wide
      // selection, same as a non-incognito tab already reads once this environment is gone.
      for (const [tabId, envId] of incognitoEnvByTab) {
        if (envId === id) incognitoEnvByTab.delete(tabId);
      }
      // listCache's own eviction (useVariableSetStore) — nothing else ever drops a deleted owner's
      // cached rows, so a later ensureVariablesLoaded('environment', id) call (a stale watch, a
      // reused id) would otherwise keep reading them back forever.
      useVariableSetStore().evictListCache('environment', id);
      await loadEnvironments();
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** P17 D17/item 4: a raw-ciphertext duplicate — no history copied, never active. */
  async function duplicateEnvironment(id: string): Promise<ApiEnvironment | undefined> {
    try {
      const env = await control.variablesDuplicateEnvironment(id);
      await loadEnvironments();
      state.error = null;
      return env;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      return undefined;
    }
  }

  // ---- the environments surface (D3/D11, re-homed to a tab by P28 D16(c)) ----
  //
  // The dialog flag and its open/close pair are gone. `openEnvironments()` is the one entry point
  // every caller uses; it opens (or focuses) the environments tab and refreshes the list, which is
  // exactly what openEnvironmentsDialog did minus the flag. It lives here rather than in api/tabs.ts
  // so that a caller wanting "the environments UI" keeps importing one module, and so the
  // loadEnvironments() refresh cannot be forgotten at a call site.
  function openEnvironments(): void {
    openEnvironmentsTab();
    void loadEnvironments();
  }

  async function reorderEnvironmentsList(ids: string[]): Promise<void> {
    try {
      await control.variablesReorderEnvironments(ids);
      await loadEnvironments();
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ...toRefs(state),
    activeEnvironment,
    activeEnvironmentId,
    activeEnvironmentColor,
    dismissError,
    initVariables,
    setActiveEnvironment,
    environmentIdForTab,
    environmentColorForTab,
    selectEnvironmentForTab,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    duplicateEnvironment,
    openEnvironments,
    reorderEnvironmentsList,
  };
});

// ---- the variable-set tab (P17 D16) — one scope's variable list, one runtime per open tab ----
//
// R10 re-homes what used to be the single VariablesDialog's own state (variablesDialogState) into
// a per-tab runtime — createRuntimeStore's own shape (views/httprequest/state.ts:132's precedent),
// since a variable-set tab, unlike the dialog it replaces, can now be open more than once at a
// time (one per collection/environment).
//
// Kept as one store together with the send-time cache, the merged value/secret cache, the gated
// reveal and the history popover (rather than split further): loadVariableSetRows writes into both
// variableSetRuntime and listCache in the same call, and revealHistoryEntry/restoreHistoryEntry
// reach into setVariableSetError/variableSetRows/upsertVariable/openHistoryMenu — a further split
// would only trade this one store for several calling each other for every operation that matters.

interface VariableSetRuntime {
  rows: ApiVariable[];
  /** A reveal failure's message (D10) — shown in the view's own MessageStrip. */
  error: string | null;
}

function defaultVariableSetRuntime(): VariableSetRuntime {
  return { rows: [], error: null };
}

export interface VariableOverviewRow {
  id: string;
  name: string;
  value: string;
  isSecret: boolean;
  description: string;
  scope: VariableScope;
  /** True for a collection row whose name is also claimed by some environment row — D2's
   *  precedence means the environment row is the one that actually resolves. An environment row
   *  is never shadowed; nothing outranks it. */
  shadowed: boolean;
}

interface HistoryMenuState {
  open: boolean;
  /** Which tab's own row this popover is restoring into — restoreHistoryEntry's own lookup key,
   *  since rows now live in a per-tab runtime rather than one singleton dialog's own list. */
  tabId: string | null;
  scope: VariableScope | null;
  ownerId: string;
  variableId: string | null;
  entries: ApiVariableHistoryEntry[];
}

export const useVariableSetStore = defineStore('variableSet', () => {
  // P1 D7: api/ may not import views/shared/viewOp.ts's own createRuntimeStore (the module-boundary
  // lint rule) — this is that same small "one reactive record, keyed by tabId, created on first
  // touch" shape, inlined rather than hoisted somewhere both sides could reach, since this is the
  // only api/-side per-tab runtime that exists. Returned as a named property directly (not
  // toRefs-spread): toRefs only captures keys present at call time, unsuitable for a record whose
  // keys grow as tabs open.
  const variableSetRuntime = reactive({} as Record<string, VariableSetRuntime>);

  function ensureVariableSetRuntime(tabId: string): VariableSetRuntime {
    if (!variableSetRuntime[tabId]) {
      variableSetRuntime[tabId] = defaultVariableSetRuntime();
    }
    return variableSetRuntime[tabId];
  }

  registerTabRuntimeCleanup((tabId) => {
    delete variableSetRuntime[tabId];
    // Finding 5, re-homed: a stale reveal left behind by one tab must never let a different,
    // later-opened tab (or a later-opened Copy as curl dialog) trust it in place of its own re-auth
    // gate — the same reason closeVariablesDialog used to clear this on close.
    clearRevealed();
  });

  /** Loads (or reloads) one scope's variable list into `tabId`'s own runtime — the tab-scoped
   *  replacement for the old singleton dialog's reloadVariablesDialog. Also keeps the send-time
   *  cache (below) in step, exactly as the dialog's own edits used to. */
  async function loadVariableSetRows(
    tabId: string,
    scope: VariableScope,
    ownerId: string,
  ): Promise<void> {
    const rows = await control.variablesList(scope, ownerId);
    ensureVariableSetRuntime(tabId).rows = rows;
    const key = cacheKey(scope, ownerId);
    listCache[key] = rows;
    // P108 F2: this is an authoritative write (a fresh list right after a mutation) — bump so any
    // ensureVariablesLoaded that started before it, and is still in flight, discards its own reply
    // instead of clobbering these rows with a pre-edit snapshot.
    bumpListCacheGen(key);
  }

  function variableSetRows(tabId: string): ApiVariable[] {
    return variableSetRuntime[tabId]?.rows ?? [];
  }

  function variableSetError(tabId: string): string | null {
    return variableSetRuntime[tabId]?.error ?? null;
  }

  function setVariableSetError(tabId: string, message: string | null): void {
    ensureVariableSetRuntime(tabId).error = message;
  }

  // ---- the send-time value cache (D6/D7) ----
  //
  // send() needs each scope's non-secret values (and which names are secret, to defer them) without
  // a fresh round trip on every keystroke of a live "unresolved reference" preview — this is that
  // cache, kept in step with VariablesDialog's own edits above (the one place these rows change).

  function cacheKey(scope: VariableScope, ownerId: string): string {
    return `${scope}:${ownerId}`;
  }

  // Returned as a named property directly (not toRefs-spread) — same Record-with-dynamic-keys
  // reasoning as variableSetRuntime above.
  const listCache = reactive<Record<string, ApiVariable[]>>({});

  // P108 F2: per-key generation counter, bumped by every authoritative write to a `listCache` key
  // (loadVariableSetRows below; the cache-eviction sites F9 adds). ensureVariablesLoaded compares
  // against this to tell "nothing else has touched this key since I started" from "I'm answering a
  // question a fresher write already superseded" — the same opId-supersession shape the request
  // views' own runtimes use, applied to this cache instead of a per-tab runtime.
  const listCacheGen = new Map<string, number>();
  function bumpListCacheGen(key: string): void {
    listCacheGen.set(key, (listCacheGen.get(key) ?? 0) + 1);
  }

  // P108 F2: concurrent ensureVariablesLoaded calls for the same key each used to fire their own
  // control.variablesList request. A slow first reply landing after a later loadVariableSetRows
  // (a post-edit refresh) overwrote the just-written fresh rows with the pre-edit list — silently:
  // every subsequent send for that scope substituted stale plain values until the next edit. One
  // in-flight promise per key so concurrent callers share a single request, and a generation check
  // on the reply so a superseded one never overwrites a fresher write.
  const ensureInFlight = new Map<string, Promise<void>>();

  /** Populates the cache for one scope if it is not already loaded — safe to call on every render;
   *  a no-op for '' (a scratch tab's collection, or no active environment). */
  async function ensureVariablesLoaded(scope: VariableScope, ownerId: string): Promise<void> {
    if (!ownerId) return;
    const key = cacheKey(scope, ownerId);
    if (listCache[key]) return;
    const existing = ensureInFlight.get(key);
    if (existing) return existing;
    const startGen = listCacheGen.get(key) ?? 0;
    const promise = control
      .variablesList(scope, ownerId)
      .then((rows) => {
        // Only commit if nothing (a loadVariableSetRows post-edit refresh, or a cache eviction)
        // has touched this key since this fetch started — otherwise this reply is an answer to a
        // question already superseded by a fresher one.
        if (!listCache[key] && (listCacheGen.get(key) ?? 0) === startGen) {
          listCache[key] = rows;
        }
      })
      .finally(() => {
        ensureInFlight.delete(key);
      });
    ensureInFlight.set(key, promise);
    return promise;
  }

  function cachedVariables(scope: VariableScope, ownerId: string): ApiVariable[] {
    if (!ownerId) return [];
    return listCache[cacheKey(scope, ownerId)] ?? [];
  }

  /** P108 F9: `listCache` was never evicted — deleting an environment or a collection left its own
   *  rows cached under the old owner id forever, so a request sent afterward against a different
   *  owner that happened to share the id space (or a since-recreated environment reusing the same
   *  route through `ensureVariablesLoaded`'s cache-hit guard) kept substituting stale plain values.
   *  Bumping the generation too matters exactly like `loadVariableSetRows`'s own bump: an
   *  `ensureVariablesLoaded` call already in flight for this key must not resurrect the deleted rows
   *  once its reply lands. */
  function evictListCache(scope: VariableScope, ownerId: string): void {
    const key = cacheKey(scope, ownerId);
    delete listCache[key];
    bumpListCacheGen(key);
  }

  /** id: '' creates a new row (D19). value is three-state (F2, P108 Part 3): null means "leave the
   *  stored value untouched" — VariableSetView.vue's own valueTouched flag is what decides which
   *  one it sends; every other caller here (restoreHistoryEntry) always has a real value in hand.
   *  Re-lists afterward — the same "one call, always correct" discipline http/state/collections.ts's
   *  own mutations use. */
  /** P108 F10: this (and deleteVariable/reorderVariables below) used to let a failed IPC call
   *  throw uncaught — VariableSetView.vue's own call sites (commitDraft, row delete, drag/keyboard
   *  reorder) have no try/catch of their own, so a rejected edit vanished with nothing telling the
   *  user why the row snapped back. Reuses the tab's own `variableSetError`/setVariableSetError —
   *  already wired to an `Alert` in VariableSetView.vue for reveal failures — rather than inventing
   *  a second error channel. applyBulkVariables is deliberately left alone: its one call site
   *  (BulkVariablesEditor.vue's onApply) already has its own try/catch and local error display. */
  async function upsertVariable(
    tabId: string,
    scope: VariableScope,
    ownerId: string,
    args: {
      id: string;
      name: string;
      value: string | null;
      isSecret: boolean;
      description?: string;
    },
  ): Promise<void> {
    try {
      await control.variablesUpsert({ scope, ownerId, ...args });
      await loadVariableSetRows(tabId, scope, ownerId);
      setVariableSetError(tabId, null);
    } catch (err) {
      setVariableSetError(tabId, err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteVariable(
    tabId: string,
    scope: VariableScope,
    ownerId: string,
    id: string,
  ): Promise<void> {
    try {
      await control.variablesDelete(id);
      await loadVariableSetRows(tabId, scope, ownerId);
      setVariableSetError(tabId, null);
    } catch (err) {
      setVariableSetError(tabId, err instanceof Error ? err.message : String(err));
    }
  }

  /** D14: the full new order, in full — ConnectionsService.Reorder's own shape. */
  async function reorderVariables(
    tabId: string,
    scope: VariableScope,
    ownerId: string,
    ids: string[],
  ): Promise<void> {
    try {
      await control.variablesReorder(scope, ownerId, ids);
      await loadVariableSetRows(tabId, scope, ownerId);
      setVariableSetError(tabId, null);
    } catch (err) {
      setVariableSetError(tabId, err instanceof Error ? err.message : String(err));
    }
  }

  /** P17 D21-D23/item 5: applies a parsed `.env` entry list atomically (VariablesRepo.ApplyBulk),
   *  then re-lists — the same "one call, always correct" discipline every other mutation here uses.
   *  The returned counts are ApplyBulk's own, from the server-side reconcile — BulkVariablesEditor's
   *  own live summary is computed independently (dotenv.ts#reconcileEnv) for the pre-Apply preview,
   *  and the two are expected to agree (§4 of the plan). */
  async function applyBulkVariables(
    tabId: string,
    scope: VariableScope,
    ownerId: string,
    entries: ApiVariableBulkEntry[],
  ): Promise<ApiVariableBulkResult> {
    const result = await control.variablesApplyBulk(scope, ownerId, entries);
    await loadVariableSetRows(tabId, scope, ownerId);
    return result;
  }

  /** D12: a duplicate name within one scope is allowed by the schema and resolved first-wins by
   *  sort_order — this is the dialog's own "which rows are the later, shadowed duplicates" check,
   *  over the already-sort_order-ordered list List returns. */
  function isDuplicateName(rows: ApiVariable[], index: number): boolean {
    const name = rows[index]?.name.trim();
    if (!name) return false;
    return rows.slice(0, index).some((r) => r.name.trim() === name);
  }

  // ---- the merged value/secret cache, shared by both protocols (P12 D9/F10) ----
  //
  // mergedValuesAndSecrets used to be hand-copied into views/grpcrequest/state.ts, which said so in
  // so many words ("the coupling P12 would have to unpick") — both views already import this module
  // for cachedVariables, so the fix is a move, not an abstraction.

  /** D12: a duplicate name within one scope resolves first-wins by sort_order — cachedVariables
   *  already returns each scope's rows in that order, so the first row claiming a name is the one
   *  that wins; a later same-named row is skipped rather than overwriting it. */
  function firstWinsByName(rows: ApiVariable[]): Map<string, { value: string; isSecret: boolean }> {
    const out = new Map<string, { value: string; isSecret: boolean }>();
    for (const v of rows) {
      if (!out.has(v.name)) out.set(v.name, { value: v.value, isSecret: v.isSecret });
    }
    return out;
  }

  /** D2's precedence (environment over collection), read from the cache this module keeps in step
   *  with its own dialog edits — a fresh IPC round trip on every keystroke of a live
   *  "unresolved reference" preview would be needless. Correction (round-2 review): neither send()
   *  nor call() calls ensureVariablesLoaded themselves — HttpRequestView.vue/GrpcRequestView.vue
   *  each fire it, unawaited, on mount and on collection/environment change, well before this ever
   *  runs for the same tab in the ordinary case. This function does not itself guarantee the cache
   *  is loaded; a scope this call site has genuinely never seen simply reads as empty here (§0's own
   *  "an honest unresolved reference is fine" posture), same as before any load ever ran. */
  function mergedValuesAndSecrets(
    collectionId: string,
    environmentId: string,
  ): { values: Record<string, string>; secretNames: string[] } {
    const merged = firstWinsByName(cachedVariables('collection', collectionId));
    for (const [name, entry] of firstWinsByName(cachedVariables('environment', environmentId))) {
      merged.set(name, entry); // environment wins over collection (D2), regardless of within-scope order
    }
    const values: Record<string, string> = {};
    const secretNames: string[] = [];
    for (const [name, entry] of merged) {
      if (entry.isSecret) secretNames.push(name);
      else values[name] = entry.value;
    }
    return { values, secretNames };
  }

  // P17 D20/item 8: one row of the read-only overview panel — every stored row from both scopes
  // (not deduplicated into a single resolved value the way mergedValuesAndSecrets is, since the
  // panel's whole point is to make D2's precedence *visible*: a shadowed collection row still
  // appears, dimmed, rather than disappearing the way it would in the merged map above).

  /** D20: environment rows first (the scope that wins precedence, D2), then collection rows, each
   *  group in its own `sort_order` (`cachedVariables`'s own order) — read-only, no dedup within a
   *  scope, since collapsing same-named rows is `mergedValuesAndSecrets`' job, not this list's. */
  function overviewRows(collectionId: string, environmentId: string): VariableOverviewRow[] {
    const envRows = cachedVariables('environment', environmentId);
    const colRows = cachedVariables('collection', collectionId);
    const envNames = new Set(envRows.map((v) => v.name));
    const toRow = (
      v: ApiVariable,
      scope: VariableScope,
      shadowed: boolean,
    ): VariableOverviewRow => ({
      id: v.id,
      name: v.name,
      value: v.value,
      isSecret: v.isSecret,
      description: v.description,
      scope,
      shadowed,
    });
    return [
      ...envRows.map((v) => toRow(v, 'environment', false)),
      ...colRows.map((v) => toRow(v, 'collection', envNames.has(v.name))),
    ];
  }

  // ---- the gated reveal (D5/D8/D9) ----

  /** A revealed variable's plaintext, keyed by variable id — transient, cleared on dialog close
   *  (never written to tab state, never to a collection row). Not reactive-persisted anywhere else:
   *  this is the one place a secret's plaintext exists in the renderer at all. Shared with
   *  state/curl.ts's own reveal loop (revealSecretValues calls the same revealVariable below), so
   *  clearRevealed stays a store method (not private) — every dialog that can populate this map
   *  must also be able to clear it (finding 5: a stale entry left behind by one dialog must never
   *  let a *different*, later-opened dialog trust it in place of its own re-auth gate). Returned as
   *  a named property directly (not toRefs-spread) — same Record-with-dynamic-keys reasoning as
   *  variableSetRuntime/listCache above.
   */
  const revealedValues = reactive<Record<string, string>>({});

  const revealedValuesExpiry = createRevealExpiry(revealedValues);

  /** Drops every revealed secret's plaintext from memory — called by every dialog/popover close
   *  path that can populate revealedValues (closeVariablesDialog here, closeCopyAsCurlDialog in
   *  curl.ts), the same honest "not scrubbed, just dropped" limit P14 §0.3 states for its own reveal
   *  map (JS offers no way to zero a string in memory). Also cancels this id's grace-expiry timer
   *  (finding 5) so a delayed callback can't fire against a map a later reveal has since repopulated. */
  function clearRevealed(): void {
    for (const id of Object.keys(revealedValues)) delete revealedValues[id];
    revealedValuesExpiry.clearAll();
  }

  /** P12 D13: runs over http/reveal.ts's shared recurse-once switch — the pattern used to be
   *  hand-copied from ConnectionDialog.vue's own requestReveal (there was nothing importable to
   *  reuse, §1.4/OQ-2); now it is the module's own shared loop, used here and by
   *  revealHistoryEntry below.
   *
   *  R10: `onError` is now required rather than falling back to a singleton dialog's error field —
   *  there is no longer one such field to fall back to (a variable-set view writes into its own
   *  tab's runtime via setVariableSetError; the *Copy as curl* reveal loop, http/state/curl.ts, has
   *  its own error sink either way). */
  async function revealVariable(
    id: string,
    onError: (message: string) => void,
  ): Promise<string | undefined> {
    return runReveal(
      (confirmed) => control.variablesReveal(id, confirmed),
      (value) => {
        revealedValues[id] = value;
        revealedValuesExpiry.schedule(id);
      },
      onError,
      'Show this variable’s value? It will be displayed in plain text.',
    );
  }

  // ---- the per-variable history popover (D13) ----

  const historyMenuState = reactive<HistoryMenuState>({
    open: false,
    tabId: null,
    scope: null,
    ownerId: '',
    variableId: null,
    entries: [],
  });

  /** A revealed history entry's plaintext, keyed by history entry id — the same transient-map
   *  discipline revealedValues follows, cleared when the popover closes. Returned as a named
   *  property directly, same reasoning as the other Record-shaped fields above. */
  const revealedHistoryValues = reactive<Record<string, string>>({});

  // Finding 5: this map used to be cleared only by the popover's own close path
  // (openHistoryMenu/closeHistoryMenu below) — nothing re-masked a revealed prior value once the
  // grace it came from had actually expired, so a popover left open (or, per the comment on
  // openHistoryMenu below, torn down without its own @close firing) could hold a decrypted secret
  // history value indefinitely. Same grace, same discipline as revealedValues above.
  const revealedHistoryValuesExpiry = createRevealExpiry(revealedHistoryValues);

  function clearRevealedHistory(): void {
    for (const id of Object.keys(revealedHistoryValues)) delete revealedHistoryValues[id];
    revealedHistoryValuesExpiry.clearAll();
  }

  /** Finding 5: VariableRow.vue's popover is `v-if`-gated on `historyMenuState.variableId ===
   *  row.id`, so switching from one row's history button to another's unmounts the first popover
   *  without ever firing its own `@close` — closeHistoryMenu below would never run for it. Clearing
   *  here too, before the new popover's own state lands, closes that gap regardless of whether the
   *  previous popover ever closes "cleanly". */
  async function openHistoryMenu(
    tabId: string,
    scope: VariableScope,
    ownerId: string,
    variableId: string,
  ): Promise<void> {
    clearRevealedHistory();
    historyMenuState.tabId = tabId;
    historyMenuState.scope = scope;
    historyMenuState.ownerId = ownerId;
    historyMenuState.variableId = variableId;
    historyMenuState.open = true;
    historyMenuState.entries = await control.variablesHistory(variableId);
  }

  function closeHistoryMenu(): void {
    historyMenuState.open = false;
    historyMenuState.tabId = null;
    historyMenuState.scope = null;
    historyMenuState.ownerId = '';
    historyMenuState.variableId = null;
    historyMenuState.entries = [];
    clearRevealedHistory();
  }

  /** P12 D13: runReveal's own second instantiation, over api_variable_history instead of
   *  api_variables. */
  async function revealHistoryEntry(historyId: string): Promise<string | undefined> {
    return runReveal(
      (confirmed) => control.variablesRevealHistory(historyId, confirmed),
      (value) => {
        revealedHistoryValues[historyId] = value;
        revealedHistoryValuesExpiry.schedule(historyId);
      },
      (message) => {
        if (historyMenuState.tabId) setVariableSetError(historyMenuState.tabId, message);
      },
      'Show this prior value? It will be displayed in plain text.',
    );
  }

  /** D13: restoring writes the prior value through the ordinary Upsert path, so the restore is
   *  itself recorded in history and is therefore undoable. A secret entry is revealed first if it
   *  has not been already — restoring is no less a reveal than the eye button is. */
  async function restoreHistoryEntry(entry: ApiVariableHistoryEntry): Promise<void> {
    const { tabId, scope, ownerId } = historyMenuState;
    if (!tabId || !scope) return;
    const row = variableSetRows(tabId).find((r) => r.id === entry.variableId);
    if (!row) return;
    let value = entry.value;
    if (entry.isSecret) {
      if (revealedHistoryValues[entry.id] === undefined) {
        await revealHistoryEntry(entry.id);
      }
      const revealed = revealedHistoryValues[entry.id];
      if (revealed === undefined) return; // cancelled, unavailable, or errored
      value = revealed;
    }
    await upsertVariable(tabId, scope, ownerId, {
      id: row.id,
      name: row.name,
      value,
      isSecret: entry.isSecret,
      description: row.description,
    });
    await openHistoryMenu(tabId, scope, ownerId, entry.variableId);
  }

  return {
    variableSetRuntime,
    listCache,
    revealedValues,
    revealedHistoryValues,
    ...toRefs(historyMenuState),
    loadVariableSetRows,
    variableSetRows,
    variableSetError,
    setVariableSetError,
    ensureVariablesLoaded,
    cachedVariables,
    evictListCache,
    upsertVariable,
    deleteVariable,
    reorderVariables,
    applyBulkVariables,
    isDuplicateName,
    mergedValuesAndSecrets,
    overviewRows,
    clearRevealed,
    revealVariable,
    openHistoryMenu,
    closeHistoryMenu,
    revealHistoryEntry,
    restoreHistoryEntry,
  };
});
