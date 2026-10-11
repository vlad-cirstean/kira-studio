import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { grpcTab, modeTab, openHttpModeAndNewRequest } from './support/apiMode';
import { IPC } from './support/ipcChannels';
import { postgresConnectionSummary } from './support/postgresFixture';

// P264: one key set for every list. The project tree is the Studio list bound through the shared
// useListNavigation today (Left/Right and expansion are covered in tree.spec.ts); rows here are
// disconnected connections so no tree IPC is needed.

const CONNS = [
  postgresConnectionSummary('conn-k1', 'Alpha DB', 'blue'),
  postgresConnectionSummary('conn-k2', 'Bravo DB', 'cyan'),
  postgresConnectionSummary('conn-k3', 'Charlie DB', 'green'),
];
const CONTROL: ControlSnapshot[] = [{ channel: IPC.connectionsList, response: CONNS }];

test('project tree — arrows, Home/End, right-click select, Shift+F10 and focus return', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });
  const rows = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(rows).toHaveCount(CONNS.length);
  const row = (i: number) => rows.filter({ hasText: CONNS[i].name });

  await row(1).focus();
  await expect(row(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

  await row(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(1)).toBeFocused();
  await expect(row(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid="tree-row"][tabindex="0"]')).toHaveCount(1);

  await page.keyboard.press('End');
  await expect(row(2)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row(2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(row(0)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(row(0)).toBeFocused();

  // Right-click selects the row under the pointer, then the menu opens; Esc returns focus to it.
  await row(2).click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await expect(row(2)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
  await expect(row(2)).toBeFocused();

  await page.keyboard.press('ArrowUp');
  await expect(row(1)).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
  await expect(row(1)).toBeFocused();
});

// --- collections tree -------------------------------------------------------------------------

const NOW = '2026-01-01T00:00:00.000Z';
const COLLECTION_TREE = {
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
const HEALTH_REQUEST = {
  method: 'GET',
  url: 'https://api.example.com/healthz',
  headers: [],
  bodyMode: 'code',
  body: '',
  code: '',
  codeLanguage: 'json',
  urlEncoded: [],
  formData: [],
  binaryFile: null,
};

test('collections tree — arrows, expand and collapse, Enter opens, Shift+F10 and focus return', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.collectionsList, response: COLLECTION_TREE },
      { channel: IPC.collectionsGetRequest, response: HEALTH_REQUEST },
    ],
  });
  await modeTab(page, 'api').click();
  const row = (id: string) => page.locator(`[data-testid="collection-row"][data-id="${id}"]`);

  await row('col-1').focus();
  await page.keyboard.press('ArrowRight');
  await expect(row('item-folder')).toBeVisible();
  await expect(row('item-health')).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(row('item-folder')).toBeFocused();
  await expect(row('item-folder')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(row('item-create')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(row('item-create')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(row('item-folder')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(row('item-create')).toHaveCount(0);

  await page.keyboard.press('End');
  await expect(row('item-health')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(row('col-1')).toBeFocused();
  await expect(page.locator('[data-testid="collection-row"][tabindex="0"]')).toHaveCount(1);

  await row('item-health').click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await expect(row('item-health')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(row('item-health')).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row('item-health')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="http-request-view"]')).toBeVisible();
});

// --- request history lists --------------------------------------------------------------------

function httpEntry(id: string, status: number, sentAt: string) {
  return {
    id,
    itemId: null,
    tabId: 't1',
    sentAt,
    method: 'GET',
    url: 'https://api.example.com/orders',
    environment: '',
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    elapsedMs: 10,
    bodyBytes: 5,
    storedBytes: 20,
  };
}

test('http history — arrows, Home/End and Enter view the focused entry', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [
      {
        channel: IPC.historyList,
        response: [
          httpEntry('e3', 200, '2024-06-01T10:10:00.000Z'),
          httpEntry('e2', 404, '2024-06-01T10:05:00.000Z'),
          httpEntry('e1', 200, '2024-06-01T10:00:00.000Z'),
        ],
      },
    ],
  });
  await openHttpModeAndNewRequest(page);
  await page.click('[data-testid="http-response-pane-history"]');
  const rows = page.locator('[data-testid="http-history-row"]');
  await expect(rows).toHaveCount(3);

  await rows.nth(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await expect(page.locator('[data-testid="http-history-row"][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('End');
  await expect(rows.nth(2)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(rows.nth(0)).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.historyGet).length)
    .toBeGreaterThan(0);
});

test('grpc history — arrows and Home/End move between calls', async ({ relaunch }) => {
  const entry = (id: string) => ({
    id,
    itemId: null,
    tabId: 'tab-grpc-1',
    calledAt: '2026-01-01T00:00:00.000Z',
    target: 'demo.example.com:443',
    method: 'demo.Echo/SayHello',
    streaming: 'unary',
    environment: '',
    code: 0,
    codeName: 'OK',
    statusMessage: '',
    elapsedMs: 5,
    messageCount: 1,
    messageBytes: 20,
    storedBytes: 20,
  });
  const scope = { itemId: '', tabId: 'tab-grpc-1' };
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.tabsList, response: [grpcTab({})] },
      {
        channel: IPC.grpcHistoryList,
        args: scope,
        response: [entry('c3'), entry('c2'), entry('c1')],
      },
    ],
  });
  const rows = page.locator('[data-testid="grpc-history-row"]');
  await expect(rows).toHaveCount(3);

  await rows.nth(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(rows.nth(2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(rows.nth(0)).toBeFocused();
  await expect(page.locator('[data-testid="grpc-history-row"][tabindex="0"]')).toHaveCount(1);
});
