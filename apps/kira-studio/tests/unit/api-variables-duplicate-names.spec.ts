// Finding 2 of the v1.2 P14 round-1 review: three separate code paths each resolve a duplicate
// variable name within one scope, and disagreed on which one wins. The documented rule (P5 D12)
// is first-wins by sort_order — isDuplicateName (VariablesDialog.vue's own chip) and
// findSecretVariableId (curl.ts) already matched it; mergedValuesAndSecrets (this file) used to
// overwrite on every iteration (last-wins). This pins the fix: given two same-named variables, the
// one with the lower sort_order — the one control.variablesList returns first — is the value
// mergedValuesAndSecrets actually reports, exactly what a live send or a copied curl command uses.
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { ApiVariable } from '@shared/domain/variables';

const { control } = await import('../../frontend/src/bridge/control');
const { ensureVariablesLoaded, mergedValuesAndSecrets } = await import(
  '../../frontend/src/api/state/variables'
);

function variable(overrides: Partial<ApiVariable>): ApiVariable {
  return {
    id: 'id',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'token',
    value: 'value',
    isSecret: false,
    sortOrder: 0,
    ...overrides,
  };
}

describe('mergedValuesAndSecrets duplicate-name resolution (D12)', () => {
  test('a duplicate name within one scope resolves first-wins by sort_order', async () => {
    const collectionId = 'col-dup-1';
    (control as unknown as { variablesList: typeof control.variablesList }).variablesList =
      async () => [
        variable({
          id: 'v1',
          ownerId: collectionId,
          name: 'token',
          value: 'first-value',
          sortOrder: 0,
        }),
        variable({
          id: 'v2',
          ownerId: collectionId,
          name: 'token',
          value: 'second-value',
          sortOrder: 1,
        }),
      ];

    await ensureVariablesLoaded('collection', collectionId);
    const { values } = mergedValuesAndSecrets(collectionId, '');

    expect(values.token).toBe('first-value');
  });

  test('environment still overrides collection for the same name, despite within-scope first-wins', async () => {
    const collectionId = 'col-dup-2';
    const environmentId = 'env-dup-2';
    (control as unknown as { variablesList: typeof control.variablesList }).variablesList = async (
      scope,
      ownerId,
    ) => {
      if (scope === 'collection' && ownerId === collectionId) {
        return [
          variable({ id: 'c1', ownerId: collectionId, name: 'token', value: 'collection-value' }),
        ];
      }
      if (scope === 'environment' && ownerId === environmentId) {
        return [variable({ id: 'e1', ownerId: environmentId, name: 'token', value: 'env-value' })];
      }
      return [];
    };

    await ensureVariablesLoaded('collection', collectionId);
    await ensureVariablesLoaded('environment', environmentId);
    const { values } = mergedValuesAndSecrets(collectionId, environmentId);

    expect(values.token).toBe('env-value');
  });
});
