// P108 F9: deleteEnvironment closed the environment's own variable-set tabs and reloaded the list,
// but left `incognitoEnvByTab` entries holding the deleted id (an incognito tab kept substituting
// its plain values in stage 1 while Go resolved no secrets for the missing environment) and left
// the environment-scope variables query cached forever (a later read for that owner id would keep
// reading the deleted rows back). This pins both evictions.
//
// P112: `listCache` is gone — eviction is `reconcileEnvironments`/`reconcileTree` (apiQueries.ts),
// run from `afterEnvironmentsListChange`/`afterTreeListChange` after every list mutation. The
// collection-delete case below is `reconcileTree`'s own half, re-added now that
// `collections.ts`'s own migration (commit 5) wires `deleteRow` through `afterTreeListChange`.
import '@workbench/testing/unit/window';

import { afterAll, describe, expect, test } from 'bun:test';
import type { CollectionItemSummary, CollectionSummary } from '@shared/domain/collections';
import type { ApiEnvironment, ApiVariable } from '@shared/domain/variables';
import { queryClient } from '@workbench/state/queryClient';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
// wailsRuntime.ts's mocked transport deliberately never settles an unmocked call — useVariablesStore
// and useCollectionsStore below each mount a permanent, eager `useQuery` (apiQueries.ts) the moment
// the store is created, so both need a resolving default in place *before* that first call, or its
// own initial fetch hangs forever and wedges every later invalidateQueries-triggered refetch behind
// it. Set before restoreAfterEach's own snapshot, so each test's afterEach restores to this benign
// default rather than reintroducing the hang.
//
// P112: restoreAfterEach's own snapshot is taken *after* these two overrides (deliberately, so the
// per-test reset keeps the benign default rather than reintroducing the hang) — which means it
// never restores the *true* originals, and `control` is one process-wide singleton (restoreAfterEach.ts's
// own documented hazard: a spec's stub that outlives its file leaks into whatever runs next in the
// same bun test process). Captured here and restored in afterAll, so bridge-unwrap.spec.ts's
// generic "every control method rejects" check never sees this file's own defaults once this file's
// own tests are done.
const originalVariablesListEnvironments = control.variablesListEnvironments;
const originalCollectionsList = control.collectionsList;
afterAll(() => {
  control.variablesListEnvironments = originalVariablesListEnvironments;
  control.collectionsList = originalCollectionsList;
});
(
  control as unknown as { variablesListEnvironments: typeof control.variablesListEnvironments }
).variablesListEnvironments = async () => [];
(control as unknown as { collectionsList: typeof control.collectionsList }).collectionsList =
  async () => ({ collections: [], items: [] });
restoreAfterEach(control);
const { useVariablesStore } = await import('../../frontend/src/api/state/variables');
const { apiVariablesKey, apiEnvironmentsKey, apiCollectionsTreeKey, loadVariableRows } =
  await import('../../frontend/src/api/state/apiQueries');
const { useTabIncognitoStore } = await import('../../frontend/src/state/tabIncognito');
const { useCollectionsStore } = await import('../../frontend/src/api/state/collections');

const variablesStore = useVariablesStore();
const collectionsStore = useCollectionsStore();
// Lets both stores' own eager initial fetch (above) actually settle before any test runs, so
// `refreshApiQuery`'s own in-flight capture never mistakes it for a test's own mocked fetch.
await new Promise((resolve) => setTimeout(resolve, 0));

function environment(id: string): ApiEnvironment {
  return { id, name: id, description: '', color: 'none', sortOrder: 0, isActive: false };
}

function collection(id: string, name: string): CollectionSummary {
  return { id, name, sortOrder: 0, createdAt: '', updatedAt: '' };
}

function folder(id: string, collectionId: string): CollectionItemSummary {
  return {
    id,
    collectionId,
    parentId: null,
    kind: 'folder',
    name: id,
    sortOrder: 0,
    method: '',
    url: '',
    protocol: 'http',
    createdAt: '',
    updatedAt: '',
  };
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

describe('deleteRow (collections.ts) evicts the collection-scope variables query on a collection delete (reconcileTree, P112)', () => {
  test('deleting a collection evicts its cached variables query, not just the tree', async () => {
    const collectionId = 'col-to-delete-1';
    queryClient.setQueryData(apiCollectionsTreeKey, {
      collections: [collection(collectionId, 'Orders API')],
      items: [folder('folder-1', collectionId)],
    });

    (control as unknown as { variablesList: typeof control.variablesList }).variablesList =
      async () => [variable('v1', collectionId)];
    await loadVariableRows('collection', collectionId);
    expect(queryClient.getQueryData(apiVariablesKey('collection', collectionId))).toHaveLength(1);

    (
      control as unknown as { collectionsDelete: typeof control.collectionsDelete }
    ).collectionsDelete = async () => {};
    (control as unknown as { collectionsList: typeof control.collectionsList }).collectionsList =
      async () => ({ collections: [], items: [] });

    await collectionsStore.deleteRow({
      key: `c:${collectionId}`,
      depth: 0,
      hasChildren: true,
      expanded: true,
      kind: 'collection',
      id: collectionId,
      collectionId,
      parentId: null,
      name: 'Orders API',
      method: '',
      url: '',
      protocol: 'http',
      matched: false,
    });

    // reconcileTree reads the query cache directly (an imperative reader, §3.5) — no reactivity
    // lag to wait out here.
    expect(queryClient.getQueryData(apiVariablesKey('collection', collectionId))).toBeUndefined();
    expect(
      queryClient.getQueryData<{ collections: CollectionSummary[] }>(apiCollectionsTreeKey)
        ?.collections,
    ).toEqual([]);
  });
});
