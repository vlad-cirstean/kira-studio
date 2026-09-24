// P108 F2: ensureVariablesLoaded had no dedupe or sequencing. `if (!ownerId || listCache[key])
// return; listCache[key] = await control.variablesList(...)` let two concurrent callers each fire
// their own request, and a slow first reply landing after a later loadVariableSetRows (a post-edit
// refresh) overwrote the just-written fresh rows with the pre-edit list — every subsequent send for
// that scope then substituted stale plain values until the next edit. This pins both halves of the
// fix: one in-flight promise per key (concurrent callers share a single request), and a generation
// check on the reply (a superseded ensure never overwrites a fresher loadVariableSetRows write).
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import type { ApiVariable } from '@shared/domain/variables';
import { deferred } from '@workbench/testing/unit/async';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);
const { useVariableSetStore } = await import('../../frontend/src/api/state/variables');

const variableSetStore = useVariableSetStore();

function variable(overrides: Partial<ApiVariable>): ApiVariable {
  return {
    id: 'id',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'token',
    value: 'value',
    isSecret: false,
    sortOrder: 0,
    description: '',
    ...overrides,
  };
}

describe('ensureVariablesLoaded dedupe and sequencing (P108 F2)', () => {
  test('two concurrent calls for the same key share one request', async () => {
    const collectionId = 'col-race-1';
    let calls = 0;
    const result = deferred<ApiVariable[]>();
    (control as unknown as { variablesList: typeof control.variablesList }).variablesList =
      async () => {
        calls++;
        return result.promise;
      };

    const first = variableSetStore.ensureVariablesLoaded('collection', collectionId);
    const second = variableSetStore.ensureVariablesLoaded('collection', collectionId);
    // Give both callers' own synchronous dedupe check a tick to run before the fetch settles.
    await Promise.resolve();
    expect(calls).toBe(1);

    result.resolve([variable({ id: 'v1', ownerId: collectionId, value: 'loaded' })]);
    await first;
    await second;

    expect(variableSetStore.cachedVariables('collection', collectionId)).toHaveLength(1);
    expect(calls).toBe(1);
  });

  test('a slow ensure resolving after a fresher loadVariableSetRows does not clobber it', async () => {
    const tabId = 'tab-race-2';
    const collectionId = 'col-race-2';
    const ensureResult = deferred<ApiVariable[]>();
    let call = 0;
    (control as unknown as { variablesList: typeof control.variablesList }).variablesList = async (
      ..._args
    ) => {
      call++;
      // The first call (the ensure) is slow; the second (loadVariableSetRows, the post-edit
      // refresh) answers immediately, landing first.
      return call === 1 ? ensureResult.promise : [variable({ id: 'fresh', value: 'fresh-value' })];
    };

    const ensurePromise = variableSetStore.ensureVariablesLoaded('collection', collectionId);
    await Promise.resolve(); // let the ensure's own fetch actually start (and be captured in-flight)

    await variableSetStore.loadVariableSetRows(tabId, 'collection', collectionId);
    expect(variableSetStore.cachedVariables('collection', collectionId)).toEqual([
      variable({ id: 'fresh', value: 'fresh-value' }),
    ]);

    // The slow ensure's own stale reply lands last — it must not overwrite the fresh rows above.
    ensureResult.resolve([variable({ id: 'stale', value: 'stale-value' })]);
    await ensurePromise;

    expect(variableSetStore.cachedVariables('collection', collectionId)).toEqual([
      variable({ id: 'fresh', value: 'fresh-value' }),
    ]);
  });
});
