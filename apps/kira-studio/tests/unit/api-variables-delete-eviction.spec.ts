// P108 F9: deleteEnvironment closed the environment's own variable-set tabs and reloaded the list,
// but left `incognitoEnvByTab` entries holding the deleted id (an incognito tab kept substituting
// its plain values in stage 1 while Go resolved no secrets for the missing environment) and left
// `listCache[environment:<id>]` populated (a later ensureVariablesLoaded call for that key would
// keep reading the deleted rows back forever). Deleting a collection had the same `listCache` gap.
// This pins all three evictions.
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import type { CollectionItemSummary, CollectionSummary } from '@shared/domain/collections';
import type { ApiEnvironment, ApiVariable } from '@shared/domain/variables';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);
const { useVariablesStore, useVariableSetStore } = await import(
  '../../frontend/src/api/state/variables'
);
const { useCollectionsStore } = await import('../../frontend/src/api/state/collections');
const { useTabIncognitoStore } = await import('../../frontend/src/state/tabIncognito');

const variablesStore = useVariablesStore();
const variableSetStore = useVariableSetStore();
const collectionsStore = useCollectionsStore();

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

describe('deleteEnvironment evicts the incognito override and the listCache entry (P108 F9)', () => {
  test('an incognito tab pointing at the deleted environment falls back to the app-wide selection', async () => {
    const tabId = 'tab-incognito-1';
    const envId = 'env-to-delete-1';
    useTabIncognitoStore().setIncognito(tabId, true);
    (
      control as unknown as { variablesListEnvironments: typeof control.variablesListEnvironments }
    ).variablesListEnvironments = async () => [environment(envId)];
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

    // Falls back to the app-wide selection ('' — no environment active) rather than keeping the
    // deleted id.
    expect(variablesStore.environmentIdForTab(tabId)).toBe('');
  });

  test('deleting an environment evicts its listCache entry, not just the environments list', async () => {
    const envId = 'env-to-delete-2';
    (control as unknown as { variablesList: typeof control.variablesList }).variablesList =
      async () => [variable('v1', envId)];
    await variableSetStore.ensureVariablesLoaded('environment', envId);
    expect(variableSetStore.cachedVariables('environment', envId)).toHaveLength(1);

    (
      control as unknown as {
        variablesDeleteEnvironment: typeof control.variablesDeleteEnvironment;
      }
    ).variablesDeleteEnvironment = async () => {};
    (
      control as unknown as { variablesListEnvironments: typeof control.variablesListEnvironments }
    ).variablesListEnvironments = async () => [];

    await variablesStore.deleteEnvironment(envId);

    expect(variableSetStore.cachedVariables('environment', envId)).toEqual([]);

    // A later ensureVariablesLoaded call for the same (now-deleted) id must re-fetch rather than
    // silently keep returning nothing forever because some other guard still thinks it's cached.
    let calls = 0;
    (control as unknown as { variablesList: typeof control.variablesList }).variablesList =
      async () => {
        calls++;
        return [variable('v2', envId)];
      };
    await variableSetStore.ensureVariablesLoaded('environment', envId);
    expect(calls).toBe(1);
    expect(variableSetStore.cachedVariables('environment', envId)).toHaveLength(1);
  });
});

describe('deleting a collection evicts its own listCache entry (P108 F9)', () => {
  test('deleteRow drops listCache[collection:<id>]', async () => {
    const collectionId = 'col-to-delete-1';
    collectionsStore.collections = [
      { id: collectionId, name: 'Widgets API', sortOrder: 0, createdAt: '', updatedAt: '' },
    ] as CollectionSummary[];
    collectionsStore.items = [] as CollectionItemSummary[];

    (control as unknown as { variablesList: typeof control.variablesList }).variablesList =
      async () => [variable('v1', collectionId)];
    await variableSetStore.ensureVariablesLoaded('collection', collectionId);
    expect(variableSetStore.cachedVariables('collection', collectionId)).toHaveLength(1);

    (
      control as unknown as { collectionsDelete: typeof control.collectionsDelete }
    ).collectionsDelete = async () => {};
    (control as unknown as { collectionsList: typeof control.collectionsList }).collectionsList =
      async () => ({ collections: [], items: [] });

    await collectionsStore.deleteRow({
      key: `c:${collectionId}`,
      depth: 0,
      hasChildren: false,
      expanded: false,
      kind: 'collection',
      id: collectionId,
      collectionId,
      parentId: null,
      name: 'Widgets API',
      method: '',
      url: '',
      protocol: 'http',
      matched: false,
    });

    expect(variableSetStore.cachedVariables('collection', collectionId)).toEqual([]);
  });
});
