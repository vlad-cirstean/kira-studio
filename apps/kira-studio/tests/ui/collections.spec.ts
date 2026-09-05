import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P4 §6.3: four tests, one snapshot per channel (mockRuntime.ts: a channel with exactly one
// snapshot answers args-blind, which is what lets a test assert on a call's args afterwards
// without having to make them matchable up front).

function modeTab(page: Page, mode: 'studio' | 'api'): Locator {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

// Located by row id rather than by label: a `hasText` filter would make "Orders" match the
// "Orders API" collection row too, and the id is what the row model actually keys on.
function row(page: Page, id: string): Locator {
  return page.locator(`[data-testid="collection-row"][data-id="${id}"]`);
}

const NOW = '2026-01-01T00:00:00.000Z';

// One collection, one folder inside it, and two requests — one at the root, one in the folder.
const TREE = {
  collections: [{ id: 'col-1', name: 'Orders API', sortOrder: 0, createdAt: NOW, updatedAt: NOW }],
  items: [
    {
      id: 'item-folder',
      collectionId: 'col-1',
      parentId: null,
      kind: 'folder',
      name: 'Orders',
      sortOrder: 0,
      method: '',
      url: '',
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'item-create',
      collectionId: 'col-1',
      parentId: 'item-folder',
      kind: 'request',
      name: 'Create order',
      sortOrder: 0,
      method: 'POST',
      url: 'https://api.example.com/v2/orders',
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'item-health',
      collectionId: 'col-1',
      parentId: null,
      kind: 'request',
      name: 'Health check',
      sortOrder: 1,
      method: 'GET',
      url: 'https://api.example.com/healthz',
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
};

const CREATE_ORDER_REQUEST = {
  method: 'POST',
  url: 'https://api.example.com/v2/orders',
  headers: [{ name: 'Content-Type', value: 'application/json', enabled: true }],
  bodyMode: 'code',
  body: '',
  code: '{"sku":"widget"}',
  codeLanguage: 'json',
  urlEncoded: [],
  formData: [],
  binaryFile: null,
};

async function openHttpMode(page: Page): Promise<void> {
  await modeTab(page, 'api').click();
}

test('collections — the tree renders and a request opens into the existing tab kind', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: TREE },
    { channel: IPC.collectionsGetRequest, response: CREATE_ORDER_REQUEST },
  ];
  const { window: page } = await relaunch({ control: CONTROL });
  await openHttpMode(page);

  // A collection renders collapsed until it is opened — nothing auto-expands, so the shape the
  // user left the tree in is the shape it comes back as.
  await expect(row(page, 'col-1')).toBeVisible();
  await expect(row(page, 'col-1')).toHaveText('Orders API');
  await expect(row(page, 'item-folder')).toHaveCount(0);

  await row(page, 'col-1').locator('.twisty').click();
  await expect(row(page, 'item-folder')).toBeVisible();
  await expect(row(page, 'item-health')).toBeVisible();
  // The folder is collapsed in turn, so the request inside it is not rendered yet.
  await expect(row(page, 'item-create')).toHaveCount(0);

  // Depths come from the row model, not from DOM nesting — every row is a sibling in the virtual
  // list, indented by padding.
  await expect(row(page, 'col-1')).toHaveAttribute('data-depth', '0');
  await expect(row(page, 'item-health')).toHaveAttribute('data-depth', '1');

  // A request row carries its method chip; a folder and a collection do not.
  await expect(row(page, 'item-health').locator('.method')).toHaveText('GET');
  await expect(row(page, 'item-folder').locator('.method')).toHaveCount(0);

  // Expanding the folder reveals the request at the next depth; collapsing hides it again.
  await row(page, 'item-folder').locator('.twisty').click();
  await expect(row(page, 'item-create')).toBeVisible();
  await expect(row(page, 'item-create')).toHaveAttribute('data-depth', '2');
  await expect(row(page, 'item-create').locator('.method')).toHaveText('POST');
  await row(page, 'item-folder').locator('.twisty').click();
  await expect(row(page, 'item-create')).toHaveCount(0);

  // Double-clicking a request opens the existing 'http-request' tab kind (D14), carrying the
  // **saved name** rather than the URL-derived title, and the saved body.
  await row(page, 'item-folder').locator('.twisty').click();
  await row(page, 'item-create').dblclick();
  const view = page.locator('[data-testid="http-request-view"]');
  await expect(view).toBeVisible();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="tab"]')).toContainText('Create order');
  await expect(page.locator('[data-testid="http-request-target"]')).toContainText('Create order');
  await expect(page.locator('[data-testid="http-method-select"]')).toHaveValue('POST');
  await expect(page.locator('[data-testid="http-url"]')).toHaveValue(
    'https://api.example.com/v2/orders',
  );

  // Opening the same row again reuses the bound tab rather than making a second one (D14).
  await row(page, 'item-create').dblclick();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(1);
});

test('collections — editing marks the request dirty, and Save clears it', async ({ relaunch }) => {
  const SAVED_ITEM = {
    id: 'item-create',
    collectionId: 'col-1',
    parentId: 'item-folder',
    kind: 'request',
    name: 'Create order',
    sortOrder: 0,
    method: 'POST',
    url: 'https://api.example.com/v2/orders/edited',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: TREE },
    { channel: IPC.collectionsGetRequest, response: CREATE_ORDER_REQUEST },
    { channel: IPC.collectionsSaveRequest, response: SAVED_ITEM },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });
  await openHttpMode(page);

  await row(page, 'col-1').locator('.twisty').click();
  await row(page, 'item-folder').locator('.twisty').click();
  await row(page, 'item-create').dblclick();
  await expect(page.locator('[data-testid="http-request-view"]')).toBeVisible();

  // A freshly opened saved request is clean, and Save is disabled because there is nothing to do.
  await expect(page.locator('[data-testid="http-dirty"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="http-save"]')).toBeDisabled();

  await page.fill('[data-testid="http-url"]', 'https://api.example.com/v2/orders/edited');
  await expect(page.locator('[data-testid="http-dirty"]')).toBeVisible();
  await expect(page.locator('[data-testid="http-save"]')).toBeEnabled();

  await page.click('[data-testid="http-save"]');
  await expect(page.locator('[data-testid="http-dirty"]')).toHaveCount(0);

  // The call carries the edited request — and none of the four UI-only pane fields, which is what
  // stops resizing a pane from marking a request dirty (D15's toSavedRequest).
  const calls = control.log().filter((e) => e.channel === IPC.collectionsSaveRequest);
  expect(calls).toHaveLength(1);
  const args = calls[0].args as {
    itemId: string;
    name: string;
    request: Record<string, unknown>;
  };
  expect(args.itemId).toBe('item-create');
  expect(args.name).toBe('Create order');
  expect(args.request.url).toBe('https://api.example.com/v2/orders/edited');
  expect(args.request.code).toBe('{"sku":"widget"}');
  for (const uiOnly of ['requestPane', 'responsePane', 'responseView', 'requestPaneHeight']) {
    expect(args.request).not.toHaveProperty(uiOnly);
  }
  // Nor the tab's own identity fields — a saved request document is the request, nothing else.
  expect(args.request).not.toHaveProperty('itemId');
  expect(args.request).not.toHaveProperty('name');
});

test('collections — import reports what it did, and no file contents cross the bridge', async ({
  relaunch,
}) => {
  const REPORT = {
    collectionId: 'col-1',
    name: 'Orders API',
    folders: 1,
    requests: 2,
    warnings: [
      {
        kind: 'scripts_inert',
        count: 4,
        detail:
          '4 pre-request/test scripts were kept but are not run — they survive an export unchanged.',
      },
      {
        kind: 'auth_inert',
        count: 2,
        detail:
          '2 requests or folders carry an auth block. It is kept but not applied — those requests will need an Authorization header.',
      },
      {
        kind: 'graphql_body',
        count: 1,
        detail: '1 GraphQL bodies were imported as JSON bodies carrying the same query.',
      },
    ],
  };
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: TREE },
    {
      channel: IPC.filesChooseOpen,
      response: {
        canceled: false,
        file: {
          path: '/Users/someone/Orders.postman_collection.json',
          name: 'Orders.postman_collection.json',
          size: 4_200_000,
        },
      },
    },
    { channel: IPC.collectionsImport, response: REPORT },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });
  await openHttpMode(page);

  await page.click('[data-testid="import-collection"]');

  const strip = page.locator('[data-testid="import-report"]');
  await expect(strip).toBeVisible();
  await expect(page.locator('[data-testid="import-report-summary"]')).toHaveText(
    'Imported Orders API — 2 requests, 1 folder.',
  );
  await expect(strip.locator('li[data-kind="scripts_inert"]')).toContainText('are not run');
  await expect(strip.locator('li[data-kind="auth_inert"]')).toContainText('not applied');
  await expect(strip.locator('li[data-kind="graphql_body"]')).toContainText('JSON bodies');

  // The tree is re-listed after an import, so the new collection is visible without a reload.
  const listCalls = control.log().filter((e) => e.channel === IPC.collectionsList);
  expect(listCalls.length).toBeGreaterThanOrEqual(2);

  // Import carries the **path only** (D11/F16) — Go opens the file. This is the load-bearing
  // assertion of the test: the same shape P3's own form-data test asserts for a request body.
  const importCalls = control.log().filter((e) => e.channel === IPC.collectionsImport);
  expect(importCalls).toHaveLength(1);
  expect(importCalls[0].args).toEqual({
    path: '/Users/someone/Orders.postman_collection.json',
  });
  // And nothing else in the whole call log is file-sized either.
  for (const entry of control.log()) {
    const size = entry.args === undefined ? 0 : JSON.stringify(entry.args).length;
    expect(size).toBeLessThan(2000);
  }

  // The strip is dismissible — it reports, it does not persist.
  await page.click('[data-testid="import-report-dismiss"]');
  await expect(strip).toHaveCount(0);
});

test('collections — search filters the tree, keeps ancestors, and restores the expansion state', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [{ channel: IPC.collectionsList, response: TREE }];
  const { window: page } = await relaunch({ control: CONTROL });
  await openHttpMode(page);

  // Expand the collection only — the folder stays collapsed, which is the state search must
  // restore afterwards.
  await row(page, 'col-1').locator('.twisty').click();
  await expect(row(page, 'item-folder')).toBeVisible();
  await expect(row(page, 'item-create')).toHaveCount(0);

  await page.click('[data-testid="toggle-search"]');
  await page.fill('[data-testid="tree-search"]', 'Create');

  // Only the matching branch survives, and its ancestors render so the match is reachable.
  await expect(row(page, 'item-create')).toBeVisible();
  await expect(row(page, 'col-1')).toBeVisible();
  await expect(row(page, 'item-folder')).toBeVisible();
  await expect(row(page, 'item-health')).toHaveCount(0);
  // The matched substring is highlighted, not the whole label.
  await expect(row(page, 'item-create').locator('mark')).toHaveText('Create');

  // A URL-only match still surfaces the row, since the URL is searched even though it is not shown.
  await page.fill('[data-testid="tree-search"]', 'healthz');
  await expect(row(page, 'item-health')).toBeVisible();
  await expect(row(page, 'item-create')).toHaveCount(0);

  // Clearing restores exactly the shape the user had: the collection expanded, the folder not —
  // D13's "renders expanded without mutating `expanded`".
  await page.fill('[data-testid="tree-search"]', '');
  await expect(row(page, 'item-folder')).toBeVisible();
  await expect(row(page, 'item-health')).toBeVisible();
  await expect(row(page, 'item-create')).toHaveCount(0);
});
