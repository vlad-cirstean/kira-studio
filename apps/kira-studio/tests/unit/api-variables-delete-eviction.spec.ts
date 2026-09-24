// P108 F9: deleteEnvironment closed the environment's own variable-set tabs and reloaded the list,
// but left `incognitoEnvByTab` entries holding the deleted id (an incognito tab kept substituting
// its plain values in stage 1 while Go resolved no secrets for the missing environment) and left
// the environment-scope variables query cached forever (a later read for that owner id would keep
// reading the deleted rows back). This pins both evictions.
//
// P112: `listCache` is gone — eviction is `reconcileEnvironments` (apiQueries.ts), run from
// `afterEnvironmentsListChange` after every environments-list mutation. The collection-delete half
// of the original spec (`reconcileTree`'s own eviction) moves with `collections.ts`'s own
// migration (commit 5 of this phase) — collectionsStore.deleteRow does not evict variable queries
// yet, so that case is re-added alongside reconcileTree's wiring rather than tested against
// not-yet-existing behaviour here.
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import type { ApiEnvironment, ApiVariable } from '@shared/domain/variables';
import { queryClient } from '@workbench/state/queryClient';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
// wailsRuntime.ts's mocked transport deliberately never settles an unmocked call — useVariablesStore
// below mounts a permanent, eager `useQuery` for the environments list (apiQueries.ts) the moment
// the store is created, so it needs a resolving default in place *before* that first call, or its
// own initial fetch hangs forever and wedges every later invalidateQueries-triggered refetch behind
// it. Set before restoreAfterEach's own snapshot, so each test's afterEach restores to this benign
// default rather than reintroducing the hang.
(
  control as unknown as { variablesListEnvironments: typeof control.variablesListEnvironments }
).variablesListEnvironments = async () => [];
restoreAfterEach(control);
const { useVariablesStore } = await import('../../frontend/src/api/state/variables');
const { apiVariablesKey, apiEnvironmentsKey, loadVariableRows } = await import(
  '../../frontend/src/api/state/apiQueries'
);
const { useTabIncognitoStore } = await import('../../frontend/src/state/tabIncognito');

const variablesStore = useVariablesStore();
// Lets the store's own eager initial fetch (above) actually settle before any test runs, so
// `refreshApiQuery`'s own in-flight capture never mistakes it for a test's own mocked fetch.
await new Promise((resolve) => setTimeout(resolve, 0));

function environment(id: string): ApiEnvironment {
  return { id, name: id, description: '', color: 'none', sortOrder: 0, isActive: false };
}

function variable(id: string, ownerId: string): ApiVariable {
  return {
    id,
    scope: 'environment',
    ownerId,
    name: 'token',
    value: 'value',
    isSecret: false,
    sortOrder: 0,
    description: '',
  };
}

/** §3.5's reactivity rule: notifyManager batches with setTimeout(0), so a reactive reader
 *  (the `environments` computed, and the incognito-eviction watch over it) lags a resolved
 *  refetch by one macrotask — this waits that tick out. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('deleteEnvironment evicts the incognito override and the cached variables query (P108 F9)', () => {
  test('an incognito tab pointing at the deleted environment falls back to the app-wide selection', async () => {
    const tabId = 'tab-incognito-1';
    const envId = 'env-to-delete-1';
    // Seeds the environments list with the id about to be deleted — TanStack's default structural
    // sharing would otherwise reuse the same (empty) array reference across the delete below,
    // since an empty-to-empty transition has no content change for it to detect, and the
    // eviction watch (variables.ts) would then have nothing to react to.
    queryClient.setQueryData(apiEnvironmentsKey, [environment(envId)]);
    await flush();
    useTabIncognitoStore().setIncognito(tabId, true);
    await variablesStore.selectEnvironmentForTab(tabId, envId);
    expect(variablesStore.environmentIdForTab(tabId)).toBe(envId);

    (
      control as unknown as {
        variablesDeleteEnvironment: typeof control.variablesDeleteEnvironment;
      }
    ).variablesDeleteEnvironment = async () => {};
    (
      control as unknown as { variablesListEnvironments: typeof control.variablesListEnvironments }
    ).variablesListEnvironments = async () => [];

    await variablesStore.deleteEnvironment(envId);
    await flush();

    // Falls back to the app-wide selection ('' — no environment active) rather than keeping the
    // deleted id.
    expect(variablesStore.environmentIdForTab(tabId)).toBe('');
  });

  test('deleting an environment evicts its cached variables query, not just the environments list', async () => {
    const envId = 'env-to-delete-2';
    (control as unknown as { variablesList: typeof control.variablesList }).variablesList =
      async () => [variable('v1', envId)];
    await loadVariableRows('environment', envId);
    expect(queryClient.getQueryData(apiVariablesKey('environment', envId))).toHaveLength(1);

    (
      control as unknown as {
        variablesDeleteEnvironment: typeof control.variablesDeleteEnvironment;
      }
    ).variablesDeleteEnvironment = async () => {};
    (
      control as unknown as { variablesListEnvironments: typeof control.variablesListEnvironments }
    ).variablesListEnvironments = async () => [];

    await variablesStore.deleteEnvironment(envId);

    // reconcileEnvironments reads the query cache directly (an imperative reader, §3.5) —
    // no reactivity lag to wait out here.
    expect(queryClient.getQueryData(apiVariablesKey('environment', envId))).toBeUndefined();
    expect(queryClient.getQueryData<ApiEnvironment[]>(apiEnvironmentsKey)).toEqual([]);

    // A later loadVariableRows call for the same (now-evicted) id must re-fetch rather than
    // silently keep returning nothing forever because some stale cache entry still answers it.
    let calls = 0;
    (control as unknown as { variablesList: typeof control.variablesList }).variablesList =
      async () => {
        calls++;
        return [variable('v2', envId)];
      };
    const rows = await loadVariableRows('environment', envId);
    expect(calls).toBe(1);
    expect(rows).toHaveLength(1);
  });
});
