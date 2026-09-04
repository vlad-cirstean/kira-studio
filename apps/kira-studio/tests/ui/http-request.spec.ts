import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P2 §6.2: three tests, one httpSend snapshot each (F16 — a channel with more than one snapshot
// matches on args, and the send's renderer-minted opId makes those args unmatchable across two
// sends in one test; OQ-8 hands the contained fix, a per-snapshot matchIgnoreKeys, forward for
// whichever phase actually needs two responses on one channel).

function modeTab(page: Page, mode: 'studio' | 'http'): Locator {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

async function openHttpModeAndNewRequest(page: Page): Promise<void> {
  await modeTab(page, 'http').click();
  await expect(page.locator('[data-testid="http-start"]')).toBeVisible();
  await page.click('[data-testid="new-request-start"]');
}

test('Http request — send, view a JSON response, and Params-table <-> URL sync', async ({
  relaunch,
}) => {
  const RESPONSE_BODY = '{"id":1,"name":"Ada"}';
  const JSON_RESPONSE = {
    status: 200,
    statusText: 'OK',
    proto: 'HTTP/1.1',
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'X-Request-Id', value: 'abc123' },
    ],
    body: RESPONSE_BODY,
    bodyEncoding: 'utf8',
    bodyBytes: RESPONSE_BODY.length,
    bodyTruncated: false,
    elapsedMs: 42,
    finalUrl: 'https://api.example.com/users?limit=20',
    redirects: [],
  };

  const CONTROL: ControlSnapshot[] = [{ channel: IPC.httpSend, response: JSON_RESPONSE }];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await openHttpModeAndNewRequest(page);
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(1);
  const view = page.locator('[data-testid="http-request-view"]');
  await expect(view).toBeVisible();

  // Typing in the URL updates the Params table without rewriting the URL (D9).
  await page.fill('[data-testid="http-url"]', 'https://api.example.com/users?limit=10');
  const paramRows = page.locator('[data-testid="http-param-row"]');
  const firstParamRow = paramRows.first();
  await expect(firstParamRow.locator('[data-testid="http-param-name"]')).toHaveValue('limit');
  await expect(firstParamRow.locator('[data-testid="http-param-value"]')).toHaveValue('10');
  await expect(page.locator('[data-testid="http-url"]')).toHaveValue(
    'https://api.example.com/users?limit=10',
  );

  // Editing the table rewrites the URL (D9's other half).
  await firstParamRow.locator('[data-testid="http-param-value"]').fill('20');
  await expect(page.locator('[data-testid="http-url"]')).toHaveValue(
    'https://api.example.com/users?limit=20',
  );

  // A header the builder shows should reach the send args verbatim.
  await page.click('[data-testid="http-request-pane-headers"]');
  const firstHeaderRow = page.locator('[data-testid="http-header-row"]').first();
  await firstHeaderRow.locator('[data-testid="http-header-name"]').fill('Accept');
  await firstHeaderRow.locator('[data-testid="http-header-value"]').fill('application/json');

  await page.click('[data-testid="http-send"]');

  const status = page.locator('[data-testid="http-status"]');
  await expect(status).toContainText('200');
  await expect(status).toHaveClass(/ok/);

  // The request's own args carried the method/URL/headers the builder shows.
  const httpSendCalls = control.log().filter((e) => e.channel === IPC.httpSend);
  expect(httpSendCalls).toHaveLength(1);
  expect(httpSendCalls[0].args).toMatchObject({
    method: 'GET',
    url: 'https://api.example.com/users?limit=20',
    headers: [{ name: 'Accept', value: 'application/json' }],
    hasBody: false,
    body: '',
  });

  // Opening a tab persists it.
  expect(control.log().some((e) => e.channel === IPC.tabsSave)).toBe(true);

  // Pretty (default) shows the indented form; Raw shows the compact bytes exactly as sent.
  const bodyEditor = page.locator('[data-testid="http-response-pane"] .response-body .cm-content');
  await expect(bodyEditor).toBeVisible();
  expect(await bodyEditor.innerText()).toBe('{\n  "id": 1,\n  "name": "Ada"\n}');

  await page.click('[data-testid="http-response-view-raw"]');
  expect(await bodyEditor.innerText()).toBe(RESPONSE_BODY);

  // The Headers pane shows a known header row.
  await page.click('[data-testid="http-response-pane-headers"]');
  const responseHeaders = page.locator('[data-testid="http-response-headers"]');
  await expect(responseHeaders).toContainText('Content-Type');
  await expect(responseHeaders).toContainText('application/json');
});

test('Http request — a 404 shows its own hint', async ({ relaunch }) => {
  const NOT_FOUND_RESPONSE = {
    status: 404,
    statusText: 'Not Found',
    proto: 'HTTP/1.1',
    headers: [],
    body: '',
    bodyEncoding: 'utf8',
    bodyBytes: 0,
    bodyTruncated: false,
    elapsedMs: 5,
    finalUrl: 'https://api.example.com/missing',
    redirects: [],
  };
  const CONTROL: ControlSnapshot[] = [{ channel: IPC.httpSend, response: NOT_FOUND_RESPONSE }];
  const { window: page } = await relaunch({ control: CONTROL });

  await openHttpModeAndNewRequest(page);
  await page.fill('[data-testid="http-url"]', 'https://api.example.com/missing');
  await page.click('[data-testid="http-send"]');

  const status = page.locator('[data-testid="http-status"]');
  await expect(status).toContainText('404');
  await expect(status).toHaveClass(/err/);
  await expect(page.locator('[data-testid="http-status-hint"]')).toContainText(
    'the server has no resource at this URL',
  );
});

test('Http request — restore from saved state, no reconnect gate', async ({ relaunch }) => {
  const RESTORED_TAB = {
    id: 'tab-restore-1',
    connectionId: null,
    path: 'request',
    kind: 'http-request',
    order: 0,
    active: true,
    state: {
      method: 'POST',
      url: 'https://api.example.com/widgets',
      headers: [{ name: 'Accept', value: 'application/json', enabled: true }],
      bodyMode: 'json',
      body: '{"name":"gizmo"}',
      requestPane: 'body',
      responsePane: 'body',
      responseView: 'pretty',
      requestPaneHeight: 0,
    },
  };
  const CONTROL: ControlSnapshot[] = [{ channel: IPC.tabsList, response: [RESTORED_TAB] }];
  const { window: page } = await relaunch({ control: CONTROL });

  // hydrateTabs derives the boot mode from the restored active tab's own kind.
  await expect(modeTab(page, 'http')).toHaveClass(/is-active/);
  const view = page.locator('[data-testid="http-request-view"]');
  await expect(view).toBeVisible();

  await expect(page.locator('[data-testid="http-method-select"]')).toHaveValue('POST');
  await expect(page.locator('[data-testid="http-url"]')).toHaveValue(
    'https://api.example.com/widgets',
  );
  // requestPane restored to 'body' — the JSON body shows immediately, byte-identical to what was
  // saved (no beautify is ever applied on restore).
  const bodyEditor = page.locator('[data-testid="http-request-pane"] .cm-content');
  expect(await bodyEditor.innerText()).toBe('{"name":"gizmo"}');

  await page.click('[data-testid="http-request-pane-headers"]');
  const headerRow = page.locator('[data-testid="http-header-row"]').first();
  await expect(headerRow.locator('[data-testid="http-header-name"]')).toHaveValue('Accept');
  await expect(headerRow.locator('[data-testid="http-header-value"]')).toHaveValue(
    'application/json',
  );

  // D6: no reconnect gate (there is nothing to reconnect) and no response content — a restored
  // tab never had a send in this session.
  await expect(view).not.toContainText('Reconnect');
  await expect(page.locator('[data-testid="http-status"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="http-response-pane"]')).toContainText(
    'Send a request to see the response',
  );
});
