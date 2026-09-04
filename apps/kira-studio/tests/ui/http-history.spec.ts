import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P8 §6.3: three tests, each seeding historyList (and historyGet where needed) rather than
// sending twice — F12's whole point (P2 §8 OQ-8's predicted one-snapshot-per-channel limitation
// does not bite here, because history never arrives through a second httpSend).

function modeTab(page: Page, mode: 'studio' | 'http'): Locator {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

async function openHttpModeAndNewRequest(page: Page): Promise<void> {
  await modeTab(page, 'http').click();
  await expect(page.locator('[data-testid="http-start"]')).toBeVisible();
  await page.click('[data-testid="new-request-start"]');
}

// A minimal, always-present request half for a snapshot's own `request` field — no test below
// asserts on it, only on the response side.
const EMPTY_REQUEST = {
  method: 'GET',
  url: 'https://api.example.com/orders',
  headers: [],
  body: {
    mode: 'none',
    raw: '',
    code: '',
    codeLanguage: '',
    urlEncoded: [],
    formData: [],
    file: '',
  },
};

test('Http history — browse a request’s past responses', async ({ relaunch }) => {
  const OLDEST = {
    id: 'e1',
    itemId: null,
    tabId: 't1',
    sentAt: '2024-06-01T10:00:00.000Z',
    method: 'GET',
    url: 'https://api.example.com/orders',
    environment: '',
    status: 200,
    statusText: 'OK',
    elapsedMs: 100,
    bodyBytes: 50,
    storedBytes: 140,
  };
  const MIDDLE = {
    id: 'e2',
    itemId: null,
    tabId: 't1',
    sentAt: '2024-06-01T10:05:00.000Z',
    method: 'GET',
    url: 'https://api.example.com/orders',
    environment: 'Staging',
    status: 404,
    statusText: 'Not Found',
    elapsedMs: 80,
    bodyBytes: 22,
    storedBytes: 96,
  };
  const NEWEST = {
    id: 'e3',
    itemId: null,
    tabId: 't1',
    sentAt: '2024-06-01T10:10:00.000Z',
    method: 'GET',
    url: 'https://api.example.com/orders',
    environment: '',
    status: 200,
    statusText: 'OK',
    elapsedMs: 60,
    bodyBytes: 40,
    storedBytes: 110,
  };

  const MIDDLE_SNAPSHOT = {
    entry: MIDDLE,
    request: EMPTY_REQUEST,
    response: {
      status: 404,
      statusText: 'Not Found',
      proto: 'HTTP/1.1',
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: '{"error":"not found"}',
      bodyEncoding: 'utf8',
      bodyBytes: 22,
      bodyTruncated: false,
      elapsedMs: 80,
      finalUrl: 'https://api.example.com/orders',
      redirects: [],
    },
    bodyStored: true,
    bodyStorageTruncated: false,
    requestBodyStorageTruncated: false,
  };

  const CONTROL: ControlSnapshot[] = [
    // Newest first — the same order Record's own per-scope trim/List orders by.
    { channel: IPC.historyList, response: [NEWEST, MIDDLE, OLDEST] },
    { channel: IPC.historyGet, response: MIDDLE_SNAPSHOT },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await openHttpModeAndNewRequest(page);
  await page.click('[data-testid="http-response-pane-history"]');

  const rows = page.locator('[data-testid="http-history-row"]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('200');
  await expect(rows.nth(0)).toContainText('60 ms');
  await expect(rows.nth(1)).toContainText('404');
  await expect(rows.nth(1)).toContainText('Staging');
  await expect(rows.nth(2)).toContainText('200');
  await expect(rows.nth(2)).toContainText('100 ms');

  await rows.nth(1).click();

  const band = page.locator('[data-testid="http-history-band"]');
  await expect(band).toBeVisible();
  await expect(band).toContainText('GET');
  await expect(band).toContainText('https://api.example.com/orders');

  const status = page.locator('[data-testid="http-status"]');
  await expect(status).toContainText('404');
  await expect(status).toHaveClass(/err/);

  const bodyEditor = page.locator('[data-testid="http-response-pane"] .response-body .cm-content');
  await expect(bodyEditor).toBeVisible();
  expect(await bodyEditor.innerText()).toBe('{\n  "error": "not found"\n}');

  await page.click('[data-testid="http-history-back"]');
  await expect(band).toHaveCount(0);
});

test('Http history — restore, and the storage notices', async ({ relaunch }) => {
  const RESTORED_TAB = {
    id: 'tab-hist-1',
    connectionId: null,
    path: 'request',
    kind: 'http-request',
    order: 0,
    active: true,
    state: {
      method: 'GET',
      url: 'https://api.example.com/export',
      headers: [],
      bodyMode: 'none',
      body: '',
      requestPane: 'params',
      // A restored tab that last had the History pane open (P8 D10/D11: a pane choice persists
      // exactly like the two that already did).
      responsePane: 'history',
      responseView: 'pretty',
      requestPaneHeight: 0,
    },
  };

  const TRUNCATED = {
    id: 'trunc-1',
    itemId: null,
    tabId: 'tab-hist-1',
    sentAt: '2024-06-01T09:05:00.000Z',
    method: 'GET',
    url: 'https://api.example.com/export',
    environment: '',
    status: 200,
    statusText: 'OK',
    elapsedMs: 300,
    bodyBytes: 10 * 1024 * 1024,
    storedBytes: 262_144,
  };
  const BINARY = {
    id: 'bin-1',
    itemId: null,
    tabId: 'tab-hist-1',
    sentAt: '2024-06-01T09:00:00.000Z',
    method: 'GET',
    url: 'https://api.example.com/export',
    environment: '',
    status: 200,
    statusText: 'OK',
    elapsedMs: 900,
    bodyBytes: 412 * 1024,
    storedBytes: 300,
  };

  const TRUNCATED_SNAPSHOT = {
    entry: TRUNCATED,
    request: EMPTY_REQUEST,
    response: {
      status: 200,
      statusText: 'OK',
      proto: 'HTTP/1.1',
      headers: [],
      body: 'x'.repeat(10),
      bodyEncoding: 'utf8',
      bodyBytes: 10 * 1024 * 1024,
      // F9: two independent booleans — the transfer was ALSO truncated (a genuinely huge
      // response), so both notices must render together, not one instead of the other.
      bodyTruncated: true,
      elapsedMs: 300,
      finalUrl: 'https://api.example.com/export',
      redirects: [],
    },
    bodyStored: true,
    bodyStorageTruncated: true,
    requestBodyStorageTruncated: false,
  };
  const BINARY_SNAPSHOT = {
    entry: BINARY,
    request: EMPTY_REQUEST,
    response: {
      status: 200,
      statusText: 'OK',
      proto: 'HTTP/1.1',
      headers: [],
      body: '',
      bodyEncoding: 'base64',
      bodyBytes: 412 * 1024,
      bodyTruncated: false,
      elapsedMs: 900,
      finalUrl: 'https://api.example.com/export',
      redirects: [],
    },
    bodyStored: false,
    bodyStorageTruncated: false,
    requestBodyStorageTruncated: false,
  };

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [RESTORED_TAB] },
    { channel: IPC.historyList, response: [TRUNCATED, BINARY] },
    { channel: IPC.historyGet, args: { id: 'trunc-1' }, response: TRUNCATED_SNAPSHOT },
    { channel: IPC.historyGet, args: { id: 'bin-1' }, response: BINARY_SNAPSHOT },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  // hydrateTabs derives the boot mode from the restored active tab's own kind.
  await expect(modeTab(page, 'http')).toHaveClass(/is-active/);
  const view = page.locator('[data-testid="http-request-view"]');
  await expect(view).toBeVisible();

  // D6/P2's own property, still true: no reconnect gate (nothing to reconnect), and no live
  // response — a restored tab never had a send in this session.
  await expect(view).not.toContainText('Reconnect');
  await expect(page.locator('[data-testid="http-status"]')).toHaveCount(0);

  const rows = page.locator('[data-testid="http-history-row"]');
  await expect(rows).toHaveCount(2);

  // View the binary entry: the dedicated note renders, and no editor is mounted for it.
  await rows.nth(1).click();
  await expect(page.locator('[data-testid="http-history-binary-note"]')).toBeVisible();
  await expect(
    page.locator('[data-testid="http-response-pane"] .response-body .cm-content'),
  ).toHaveCount(0);

  // Back to History, then the storage-truncated entry: both notices render together (F9).
  await page.click('[data-testid="http-response-pane-history"]');
  await rows.nth(0).click();
  await expect(page.locator('[data-testid="http-history-truncated"]')).toBeVisible();
  await expect(page.locator('[data-testid="http-body-truncated"]')).toBeVisible();
});

test('Http history — compare two responses', async ({ relaunch }) => {
  const ENTRY_A = {
    id: 'cmp-a',
    itemId: null,
    tabId: 't1',
    sentAt: '2024-06-01T08:00:00.000Z',
    method: 'GET',
    url: 'https://api.example.com/orders/1',
    environment: '',
    status: 200,
    statusText: 'OK',
    elapsedMs: 50,
    bodyBytes: 22,
    storedBytes: 140,
  };
  const ENTRY_B = {
    id: 'cmp-b',
    itemId: null,
    tabId: 't1',
    sentAt: '2024-06-01T08:05:00.000Z',
    method: 'GET',
    url: 'https://api.example.com/orders/1',
    environment: '',
    status: 404,
    statusText: 'Not Found',
    elapsedMs: 20,
    bodyBytes: 36,
    storedBytes: 150,
  };

  const SNAPSHOT_A = {
    entry: ENTRY_A,
    request: EMPTY_REQUEST,
    response: {
      status: 200,
      statusText: 'OK',
      proto: 'HTTP/1.1',
      headers: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'X-Total', value: '10' },
      ],
      body: '{"id":1,"name":"Ada"}',
      bodyEncoding: 'utf8',
      bodyBytes: 22,
      bodyTruncated: false,
      elapsedMs: 50,
      finalUrl: 'https://api.example.com/orders/1',
      redirects: [],
    },
    bodyStored: true,
    bodyStorageTruncated: false,
    requestBodyStorageTruncated: false,
  };
  const SNAPSHOT_B = {
    entry: ENTRY_B,
    request: EMPTY_REQUEST,
    response: {
      status: 404,
      statusText: 'Not Found',
      proto: 'HTTP/1.1',
      headers: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'X-Total', value: '12' },
        { name: 'X-New', value: 'yes' },
      ],
      body: '{"id":1,"name":"Ada","active":true}',
      bodyEncoding: 'utf8',
      bodyBytes: 36,
      bodyTruncated: false,
      elapsedMs: 20,
      finalUrl: 'https://api.example.com/orders/1',
      redirects: [],
    },
    bodyStored: true,
    bodyStorageTruncated: false,
    requestBodyStorageTruncated: false,
  };

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.historyList, response: [ENTRY_B, ENTRY_A] },
    { channel: IPC.historyGet, args: { id: 'cmp-a' }, response: SNAPSHOT_A },
    { channel: IPC.historyGet, args: { id: 'cmp-b' }, response: SNAPSHOT_B },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await openHttpModeAndNewRequest(page);
  await page.click('[data-testid="http-response-pane-history"]');

  const rows = page.locator('[data-testid="http-history-row"]');
  await expect(rows).toHaveCount(2);
  await rows.nth(0).locator('[data-testid="http-history-checkbox"]').check();
  await rows.nth(1).locator('[data-testid="http-history-checkbox"]').check();

  const compareButton = page.locator('[data-testid="http-history-compare"]');
  await expect(compareButton).toBeEnabled();
  await compareButton.click();

  const dialog = page.locator('[data-testid="http-diff-dialog"]');
  await expect(dialog).toBeVisible();

  // A is fixed as the older entry by sentAt regardless of click/check order (D12).
  const statusA = page.locator('[data-testid="http-diff-status-a"]');
  const statusB = page.locator('[data-testid="http-diff-status-b"]');
  await expect(statusA).toContainText('200');
  await expect(statusA).toHaveClass(/ok/);
  await expect(statusB).toContainText('404');
  await expect(statusB).toHaveClass(/err/);

  // One changed header (X-Total) and one added header (X-New) — Content-Type is unchanged and
  // collapsed behind the disclosure by default.
  const headerRows = dialog.locator('[data-testid="http-diff-header-row"]');
  await expect(headerRows).toHaveCount(2);
  await expect(headerRows.filter({ hasText: 'x-total' })).toContainText('changed');
  await expect(headerRows.filter({ hasText: 'x-new' })).toContainText('added');

  // Both bodies are pretty-printed (indented) before diffing, since both are JSON — the seeded
  // bodies above are minified, so an unindented render here is a failing assertion (D12).
  const mergeHost = page.locator('[data-testid="http-diff-merge"]');
  await expect(mergeHost.locator('.cm-merge-a .cm-content')).toBeVisible({ timeout: 10_000 });
  expect(await mergeHost.locator('.cm-merge-a .cm-content').innerText()).toBe(
    '{\n  "id": 1,\n  "name": "Ada"\n}',
  );
  expect(await mergeHost.locator('.cm-merge-b .cm-content').innerText()).toBe(
    '{\n  "id": 1,\n  "name": "Ada",\n  "active": true\n}',
  );
});
