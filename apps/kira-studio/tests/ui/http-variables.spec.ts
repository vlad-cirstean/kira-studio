import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { acceptConfirm } from './support/dialogs';
import { IPC } from './support/ipcChannels';

// P5 §6.3: five tests, own file (§0.3 — nothing appended to collections.spec.ts or the mixed
// parity spec). Modelled on credential-reveal.spec.ts — mocking the reveal *outcome* per scenario
// rather than driving a real LocalAuthentication prompt this tier cannot reach at all.

const NOW = '2026-01-01T00:00:00.000Z';

function modeTab(page: Page, mode: 'studio' | 'http'): Locator {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}
async function openHttpMode(page: Page): Promise<void> {
  await modeTab(page, 'http').click();
}
function collectionRow(page: Page, id: string): Locator {
  return page.locator(`[data-testid="collection-row"][data-id="${id}"]`);
}
function variableRow(page: Page, id: string): Locator {
  return page.locator(`[data-testid="variable-row"][data-id="${id}"]`);
}

// One collection, one request item directly under its root (no folder — one twisty click reaches
// it), reused by every test below.
const TREE = {
  collections: [{ id: 'col-1', name: 'Orders API', sortOrder: 0, createdAt: NOW, updatedAt: NOW }],
  items: [
    {
      id: 'item-1',
      collectionId: 'col-1',
      parentId: null,
      kind: 'request',
      name: 'Health check',
      sortOrder: 0,
      method: 'GET',
      url: 'https://api.example.com/healthz',
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
};
const HEALTH_REQUEST = {
  method: 'GET',
  url: 'https://api.example.com/healthz',
  headers: [],
  bodyMode: 'none',
  body: '',
  code: '',
  codeLanguage: 'json',
  urlEncoded: [],
  formData: [],
  binaryFile: null,
};

async function openVariablesDialog(page: Page): Promise<void> {
  await openHttpMode(page);
  await expect(collectionRow(page, 'col-1')).toBeVisible();
  await collectionRow(page, 'col-1').click({ button: 'right' });
  await page.click('[data-testid="menu-item-variables"]');
  await expect(page.locator('[data-testid="variables-dialog"]')).toBeVisible();
}

// ---- 1. A secret is masked, and revealing it is gated ----

test('a secret is masked, and revealing it is gated', async ({ relaunch }) => {
  const PLAIN = {
    id: 'var-plain',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'host',
    value: 'api.example.com',
    isSecret: false,
    sortOrder: 0,
  };
  const SECRET_OK = {
    id: 'var-secret-ok',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'apiKey',
    value: '',
    isSecret: true,
    sortOrder: 1,
  };
  const SECRET_CANCEL = {
    id: 'var-secret-cancel',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'cancelled',
    value: '',
    isSecret: true,
    sortOrder: 2,
  };
  const SECRET_ERROR = {
    id: 'var-secret-error',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'errored',
    value: '',
    isSecret: true,
    sortOrder: 3,
  };

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: TREE },
    {
      channel: IPC.variablesList,
      args: { scope: 'collection', ownerId: 'col-1' },
      response: [PLAIN, SECRET_OK, SECRET_CANCEL, SECRET_ERROR],
    },
    {
      channel: IPC.variablesReveal,
      args: { variableId: 'var-secret-ok', confirmed: false },
      response: { value: null, error: null, outcome: 'confirmation-required' },
    },
    {
      channel: IPC.variablesReveal,
      args: { variableId: 'var-secret-ok', confirmed: true },
      response: { value: 's3cr3t', error: null, outcome: 'revealed' },
    },
    {
      channel: IPC.variablesReveal,
      args: { variableId: 'var-secret-cancel', confirmed: false },
      response: { value: null, error: null, outcome: 'cancelled' },
    },
    {
      channel: IPC.variablesReveal,
      args: { variableId: 'var-secret-error', confirmed: false },
      response: {
        value: null,
        error: 'The stored credential could not be decrypted.',
        outcome: 'error',
      },
    },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await openVariablesDialog(page);

  // The plaintext row shows its value; every secret row is masked; not one Reveal call has been
  // made yet, and no bound call's own log carries the secret's plaintext before a reveal.
  await expect(
    variableRow(page, 'var-plain').locator('[data-testid="variable-value"]'),
  ).toHaveValue('api.example.com');
  await expect(
    variableRow(page, 'var-secret-ok').locator('[data-testid="variable-value-masked"]'),
  ).toHaveText('••••••••');
  expect(control.log().filter((e) => e.channel === IPC.variablesReveal)).toHaveLength(0);
  for (const entry of control.log()) {
    expect(JSON.stringify(entry)).not.toContain('s3cr3t');
  }

  // Confirmation-required -> the app's own confirm dialog -> accept -> a second Reveal call with
  // confirmed: true, and the value now renders.
  await variableRow(page, 'var-secret-ok').locator('[data-testid="variable-reveal"]').click();
  await expect(page.locator('[data-testid="confirm-dialog-message"]')).toHaveText(
    'Show this variable’s value? It will be displayed in plain text.',
  );
  await acceptConfirm(page);
  await expect(
    variableRow(page, 'var-secret-ok').locator('[data-testid="variable-value"]'),
  ).toHaveValue('s3cr3t');
  expect(control.log().filter((e) => e.channel === IPC.variablesReveal)).toHaveLength(2);

  // A cancelled reveal leaves the row masked, with no further call than the one Reveal itself.
  await variableRow(page, 'var-secret-cancel').locator('[data-testid="variable-reveal"]').click();
  await expect(
    variableRow(page, 'var-secret-cancel').locator('[data-testid="variable-value-masked"]'),
  ).toHaveText('••••••••');

  // An error leaves the row masked too, and surfaces in the dialog's own error strip.
  await variableRow(page, 'var-secret-error').locator('[data-testid="variable-reveal"]').click();
  await expect(
    variableRow(page, 'var-secret-error').locator('[data-testid="variable-value-masked"]'),
  ).toHaveText('••••••••');
  await expect(page.locator('[data-testid="variables-error"]')).toContainText(
    'could not be decrypted',
  );
});

// ---- 2. Substitution reaches the wire, and a secret does not ----

test('substitution reaches the wire, and a secret does not', async ({ relaunch }) => {
  const ENV = { id: 'env-1', name: 'Prod', sortOrder: 0, isActive: true };
  const HOST_VAR = {
    id: 'var-host',
    scope: 'environment',
    ownerId: 'env-1',
    name: 'host',
    value: 'api.example.com',
    isSecret: false,
    sortOrder: 0,
  };
  const TOKEN_VAR = {
    id: 'var-token',
    scope: 'environment',
    ownerId: 'env-1',
    name: 'token',
    value: '',
    isSecret: true,
    sortOrder: 1,
  };
  const RESPONSE = {
    status: 200,
    statusText: 'OK',
    proto: 'HTTP/1.1',
    headers: [],
    body: '',
    bodyEncoding: 'utf8',
    bodyBytes: 0,
    bodyTruncated: false,
    elapsedMs: 1,
    finalUrl: '',
    redirects: [],
  };

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: { collections: [], items: [] } },
    { channel: IPC.variablesListEnvironments, response: [ENV] },
    {
      channel: IPC.variablesList,
      args: { scope: 'environment', ownerId: 'env-1' },
      response: [HOST_VAR, TOKEN_VAR],
    },
    { channel: IPC.httpSend, response: RESPONSE },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await openHttpMode(page);
  await page.click('[data-testid="new-request"]');
  await expect(page.locator('[data-testid="http-request-view"]')).toBeVisible();

  await page.fill('[data-testid="http-url"]', 'https://{{host}}/v1/x?k={{missing}}');
  await page.click('[data-testid="http-request-pane-headers"]');
  const firstHeaderRow = page.locator('[data-testid="http-header-row"]').first();
  await firstHeaderRow.locator('[data-testid="http-header-name"]').fill('Authorization');
  await firstHeaderRow.locator('[data-testid="http-header-value"]').fill('Bearer {{token}}');

  // The chip is live, before any send: 1 unresolved reference, naming the unknown one — never the
  // deferred secret, which will resolve fine at send time.
  const chip = page.locator('[data-testid="http-unresolved-chip"]');
  await expect(chip).toContainText('1 unresolved');
  await expect(chip).toHaveAttribute('data-kira-tip', /missing/);
  await expect(chip).not.toHaveAttribute('data-kira-tip', /token/);

  await page.click('[data-testid="http-send"]');
  await expect(page.locator('[data-testid="http-status"]')).toContainText('200');

  const sendCalls = control.log().filter((e) => e.channel === IPC.httpSend);
  expect(sendCalls).toHaveLength(1);
  expect(sendCalls[0].args).toMatchObject({
    url: 'https://api.example.com/v1/x?k={{missing}}',
    headers: [{ name: 'Authorization', value: 'Bearer {{token}}' }],
    environmentId: 'env-1',
    collectionId: '',
  });
});

// ---- 3. Precedence is environment-over-collection ----

test('precedence is environment-over-collection', async ({ relaunch }) => {
  const ENV = { id: 'env-1', name: 'Prod', sortOrder: 0, isActive: true };
  const ENV_REGION = {
    id: 'var-env-region',
    scope: 'environment',
    ownerId: 'env-1',
    name: 'region',
    value: 'us-environment',
    isSecret: false,
    sortOrder: 0,
  };
  const COL_REGION = {
    id: 'var-col-region',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'region',
    value: 'us-collection',
    isSecret: false,
    sortOrder: 0,
  };
  const RESPONSE = {
    status: 200,
    statusText: 'OK',
    proto: 'HTTP/1.1',
    headers: [],
    body: '',
    bodyEncoding: 'utf8',
    bodyBytes: 0,
    bodyTruncated: false,
    elapsedMs: 1,
    finalUrl: '',
    redirects: [],
  };

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: TREE },
    { channel: IPC.collectionsGetRequest, response: HEALTH_REQUEST },
    // Two snapshots sharing the same (args-less) key, on purpose — the initial mount's own load,
    // then the reload SetActiveEnvironment('') triggers, reflecting the switch to "No environment".
    { channel: IPC.variablesListEnvironments, response: [ENV] },
    { channel: IPC.variablesListEnvironments, response: [{ ...ENV, isActive: false }] },
    { channel: IPC.variablesSetActiveEnvironment, args: { id: '' } },
    {
      channel: IPC.variablesList,
      args: { scope: 'environment', ownerId: 'env-1' },
      response: [ENV_REGION],
    },
    {
      channel: IPC.variablesList,
      args: { scope: 'collection', ownerId: 'col-1' },
      response: [COL_REGION],
    },
    { channel: IPC.httpSend, response: RESPONSE },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await openHttpMode(page);
  await collectionRow(page, 'col-1').locator('.twisty').click();
  await page.locator('[data-testid="collection-row"][data-id="item-1"]').dblclick();
  await expect(page.locator('[data-testid="http-request-view"]')).toBeVisible();

  await page.fill('[data-testid="http-url"]', 'https://api.example.com/{{region}}');
  await page.click('[data-testid="http-send"]');
  await expect(page.locator('[data-testid="http-status"]')).toContainText('200');

  // Falls back to the collection's value with no environment active.
  await page.selectOption('[data-testid="http-environment-select"]', '');
  await expect(page.locator('[data-testid="http-environment-select"]')).toHaveValue('');
  await page.click('[data-testid="http-send"]');
  await expect(page.locator('[data-testid="http-status"]')).toContainText('200');

  const sendCalls = control.log().filter((e) => e.channel === IPC.httpSend);
  expect(sendCalls).toHaveLength(2);
  expect(sendCalls[0].args).toMatchObject({ url: 'https://api.example.com/us-environment' });
  expect(sendCalls[1].args).toMatchObject({ url: 'https://api.example.com/us-collection' });
});

// ---- 4. Reorder persists what was dragged ----

test('reorder persists what was dragged', async ({ relaunch }) => {
  const V1 = {
    id: 'v1',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'a',
    value: '1',
    isSecret: false,
    sortOrder: 0,
  };
  const V2 = {
    id: 'v2',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'b',
    value: '2',
    isSecret: false,
    sortOrder: 1,
  };
  const V3 = {
    id: 'v3',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'c',
    value: '3',
    isSecret: false,
    sortOrder: 2,
  };

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: TREE },
    {
      channel: IPC.variablesList,
      args: { scope: 'collection', ownerId: 'col-1' },
      response: [V1, V2, V3],
    },
    { channel: IPC.variablesReorder },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await openVariablesDialog(page);
  await expect(variableRow(page, 'v3')).toBeVisible();

  // Drag row 3 above row 1.
  await variableRow(page, 'v3')
    .locator('[data-testid="variable-grip"]')
    .dragTo(variableRow(page, 'v1'));
  const dragCalls = control.log().filter((e) => e.channel === IPC.variablesReorder);
  expect(dragCalls).toHaveLength(1);
  expect(dragCalls[0].args).toMatchObject({
    scope: 'collection',
    ownerId: 'col-1',
    ids: ['v3', 'v1', 'v2'],
  });

  // Alt+↑ on a focused row produces the same call shape — focus row v2 (now last) and move it up.
  await variableRow(page, 'v2').locator('[data-testid="variable-name"]').focus();
  await page.keyboard.press('Alt+ArrowUp');
  const keyCalls = control.log().filter((e) => e.channel === IPC.variablesReorder);
  expect(keyCalls).toHaveLength(2);
  expect(keyCalls[1].args).toMatchObject({ scope: 'collection', ownerId: 'col-1' });
  expect((keyCalls[1].args as { ids: string[] }).ids).toContain('v2');
});

// ---- 5. History restores a prior value ----

test('history restores a prior value', async ({ relaunch }) => {
  const CURRENT = {
    id: 'var-1',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'baseUrl',
    value: 'v3',
    isSecret: false,
    sortOrder: 0,
  };
  const RESTORED = { ...CURRENT, value: 'v2' };
  const HISTORY = [
    {
      id: 'h3',
      variableId: 'var-1',
      value: 'v3',
      isSecret: false,
      recordedAt: '2026-01-03T00:00:00.000Z',
    },
    {
      id: 'h2',
      variableId: 'var-1',
      value: 'v2',
      isSecret: false,
      recordedAt: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 'h1',
      variableId: 'var-1',
      value: 'v1',
      isSecret: false,
      recordedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: TREE },
    // Two snapshots sharing one (channel, args) key, on purpose (mockRuntime.ts's own supported
    // shape) — the dialog's initial load, then its reload after the restore's own Upsert.
    {
      channel: IPC.variablesList,
      args: { scope: 'collection', ownerId: 'col-1' },
      response: [CURRENT],
    },
    {
      channel: IPC.variablesList,
      args: { scope: 'collection', ownerId: 'col-1' },
      response: [RESTORED],
    },
    { channel: IPC.variablesHistory, args: { variableId: 'var-1' }, response: HISTORY },
    { channel: IPC.variablesUpsert, response: RESTORED },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await openVariablesDialog(page);
  await variableRow(page, 'var-1').locator('[data-testid="variable-history"]').click();

  const entries = page.locator('[data-testid="variable-history-entry"]');
  await expect(entries).toHaveCount(3);
  // Newest first.
  await expect(entries.nth(0).locator('[data-testid="variable-history-value"]')).toHaveText('v3');
  await expect(entries.nth(1).locator('[data-testid="variable-history-value"]')).toHaveText('v2');
  await expect(entries.nth(2).locator('[data-testid="variable-history-value"]')).toHaveText('v1');

  await entries.nth(1).locator('[data-testid="variable-history-restore"]').click();

  const upsertCalls = control.log().filter((e) => e.channel === IPC.variablesUpsert);
  expect(upsertCalls).toHaveLength(1);
  expect(upsertCalls[0].args).toMatchObject({
    id: 'var-1',
    name: 'baseUrl',
    value: 'v2',
    isSecret: false,
  });
  await expect(variableRow(page, 'var-1').locator('[data-testid="variable-value"]')).toHaveValue(
    'v2',
  );
});
