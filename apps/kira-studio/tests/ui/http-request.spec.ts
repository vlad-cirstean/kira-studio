import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P2 §6.2: three tests, one httpSend snapshot each (F16 — a channel with more than one snapshot
// matches on args, and the send's renderer-minted opId makes those args unmatchable across two
// sends in one test; OQ-8 hands the contained fix, a per-snapshot matchIgnoreKeys, forward for
// whichever phase actually needs two responses on one channel).

function modeTab(page: Page, mode: 'studio' | 'api'): Locator {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

async function openHttpModeAndNewRequest(page: Page): Promise<void> {
  await modeTab(page, 'api').click();
  await expect(page.locator('[data-testid="api-start"]')).toBeVisible();
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

  // P22 D13 (F22): the request/response splitter draws a visible divider at rest — it used to be
  // 4px of nothing, with no line and no grab affordance until the pointer crossed it.
  await expect
    .poll(() => view.locator('.request-splitter').evaluate((el) => getComputedStyle(el).boxShadow))
    .not.toBe('none');

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
    body: { mode: 'none' },
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

// Finding 16: buildQuery used to encodeURIComponent a query param whole, including any literal
// {{name}} reference inside it — turning it into %7B%7Bname%7D%7D, a form neither substitution
// engine recognises any more.
test('Http request — adding a query param leaves an existing {{variable}} reference untouched', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: [] });

  await openHttpModeAndNewRequest(page);
  await page.fill('[data-testid="http-url"]', 'https://api.example.com/orders?region={{region}}');

  const paramRows = page.locator('[data-testid="http-param-row"]');
  await expect(paramRows.first().locator('[data-testid="http-param-name"]')).toHaveValue('region');
  await expect(paramRows.first().locator('[data-testid="http-param-value"]')).toHaveValue(
    '{{region}}',
  );

  // Add a second param via the table's own trailing blank row.
  const trailing = paramRows.nth(1);
  await trailing.locator('[data-testid="http-param-name"]').fill('limit');
  await trailing.locator('[data-testid="http-param-value"]').fill('10');

  // The existing {{region}} reference must survive un-mangled, not %7B%7Bregion%7D%7D.
  await expect(page.locator('[data-testid="http-url"]')).toHaveValue(
    'https://api.example.com/orders?region={{region}}&limit=10',
  );
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

// P22b D2: a header's value cell now completes from a vocabulary keyed by the row's own name —
// a whole-value entry for Content-Type (replaces the field) and a prefix entry for Authorization
// (inserts `Bearer ` and leaves the caret after it, so {{variable}} completion can take over for
// the credential itself).
test('Http request — a header value completes from its own name', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: [] });

  await openHttpModeAndNewRequest(page);
  await page.click('[data-testid="http-request-pane-headers"]');
  const rows = page.locator('[data-testid="http-header-row"]');
  const suggestions = page.locator('.autocomplete-suggestions li');

  const firstRow = rows.first();
  await firstRow.locator('[data-testid="http-header-name"]').fill('Content-Type');
  const firstValue = firstRow.locator('[data-testid="http-header-value"]');
  await firstValue.click();
  await firstValue.pressSequentially('appl');
  await expect(suggestions.filter({ hasText: 'application/json' })).toBeVisible({
    timeout: 5_000,
  });
  await suggestions.filter({ hasText: 'application/json' }).click();
  await expect(firstValue).toHaveValue('application/json');

  const secondRow = rows.nth(1);
  await secondRow.locator('[data-testid="http-header-name"]').fill('Authorization');
  const secondValue = secondRow.locator('[data-testid="http-header-value"]');
  await secondValue.click();
  await secondValue.pressSequentially('Bea');
  await expect(suggestions.filter({ hasText: 'Bearer' })).toBeVisible({ timeout: 5_000 });
  await suggestions.filter({ hasText: 'Bearer' }).click();
  await expect(secondValue).toHaveValue('Bearer ');
  // The caret lands right after the inserted space — typing `{{` there opens the {{variable}}
  // source, not a second round of the Authorization prefix vocabulary. templateToken only opens
  // once there is a non-empty word inside the reference (api-ui-consistency.spec.ts's own rule).
  await secondValue.pressSequentially('{{');
  await expect(secondValue).toHaveValue('Bearer {{}}');
  await secondValue.pressSequentially('$g');
  await expect(suggestions.filter({ hasText: '$guid' })).toBeVisible({ timeout: 5_000 });
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
  await expect(modeTab(page, 'api')).toHaveClass(/is-active/);
  const view = page.locator('[data-testid="http-request-view"]');
  await expect(view).toBeVisible();

  // P17 D18: the method select is an app-drawn button now, not a native <select>.
  await expect(page.locator('[data-testid="http-method-select"]')).toHaveAttribute(
    'data-value',
    'POST',
  );
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

// P22b D6/D7: the description toggle reveals a description cell on every configurable row —
// headers, params, urlencoded and form-data — off by default (a fourth AutocompleteField-width
// column is unusable for the majority of rows that have none).
test('Http request — the description toggle reveals a description cell on every row kind', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: [] });
  await openHttpModeAndNewRequest(page);

  await expect(page.locator('[data-testid="http-header-description"]')).toHaveCount(0);
  await page.click('[data-testid="http-field-descriptions-toggle"]');

  // Params: needs a real row, which only exists once the URL carries a query string (D9's
  // URL-is-authoritative design — F10's own reason there is no persisted params array at all).
  await page.fill('[data-testid="http-url"]', 'https://api.example.com/x?limit=10');
  const paramDescription = page.locator('[data-testid="http-param-description"]').first();
  await expect(paramDescription).toBeVisible();
  await paramDescription.fill('page size');
  await expect(paramDescription).toHaveValue('page size');

  // Headers.
  await page.click('[data-testid="http-request-pane-headers"]');
  const headerDescription = page.locator('[data-testid="http-header-description"]').first();
  await expect(headerDescription).toBeVisible();
  await headerDescription.fill('bearer token');
  await expect(headerDescription).toHaveValue('bearer token');

  // Urlencoded body.
  await page.click('[data-testid="http-request-pane-body"]');
  await page.click('[data-testid="http-body-mode-urlencoded"]');
  const urlencodedDescription = page.locator('[data-testid="http-urlencoded-description"]').first();
  await expect(urlencodedDescription).toBeVisible();
  await urlencodedDescription.fill('form field');
  await expect(urlencodedDescription).toHaveValue('form field');

  // Form-data body.
  await page.click('[data-testid="http-body-mode-formdata"]');
  const formdataDescription = page.locator('[data-testid="http-formdata-description"]').first();
  await expect(formdataDescription).toBeVisible();
  await formdataDescription.fill('upload field');
  await expect(formdataDescription).toHaveValue('upload field');
});

// A value typed into a description cell survives a tab reload — asserted the same way this file's
// own "restore from saved state" test above proves persistence for every other field: a tab
// restored with the description already in its saved state renders it immediately, with no
// further interaction.
test('Http request — a header description survives a tab reload', async ({ relaunch }) => {
  const RESTORED_TAB = {
    id: 'tab-restore-desc',
    connectionId: null,
    path: 'request',
    kind: 'http-request',
    order: 0,
    active: true,
    state: {
      method: 'GET',
      url: 'https://api.example.com/widgets',
      headers: [
        {
          name: 'Authorization',
          value: 'Bearer {{token}}',
          enabled: true,
          description: 'auth token',
        },
      ],
      bodyMode: 'none',
      body: '',
      requestPane: 'headers',
      responsePane: 'body',
      responseView: 'pretty',
      requestPaneHeight: 0,
      fieldDescriptions: true,
    },
  };
  const CONTROL: ControlSnapshot[] = [{ channel: IPC.tabsList, response: [RESTORED_TAB] }];
  const { window: page } = await relaunch({ control: CONTROL });

  const headerRow = page.locator('[data-testid="http-header-row"]').first();
  await expect(headerRow.locator('[data-testid="http-header-description"]')).toHaveValue(
    'auth token',
  );
});

// P22b D16: the trailing blank row IS the add affordance (FieldRowsTable.vue's own displayRows
// comment), so the row a user needs next is the one that appears BELOW the one they just filled
// in — off the fold on any table long enough to scroll (F24). Guarded on growth only: deleting a
// row must never move the scroll position.
test('Http request — a new header row scrolls into view when it appears (D16)', async ({
  relaunch,
}) => {
  const headers = Array.from({ length: 30 }, (_, i) => ({
    name: `X-Header-${i}`,
    value: `v${i}`,
    enabled: true,
  }));
  const RESTORED_TAB = {
    id: 'tab-scroll-1',
    connectionId: null,
    path: 'request',
    kind: 'http-request',
    order: 0,
    active: true,
    state: {
      method: 'GET',
      url: '',
      headers,
      bodyMode: 'none',
      body: '',
      requestPane: 'headers',
      responsePane: 'body',
      responseView: 'pretty',
      requestPaneHeight: 0,
    },
  };
  const { window: page } = await relaunch({
    control: [{ channel: IPC.tabsList, response: [RESTORED_TAB] }],
  });

  const table = page.locator('[data-testid="http-headers-table"]');
  await expect(table).toBeVisible();
  const rows = table.locator('[data-testid="http-header-row"]');
  await expect(rows).toHaveCount(31); // 30 real rows plus the trailing blank

  const trailing = rows.last();
  await trailing.locator('[data-testid="http-header-name"]').fill('X-New');
  await expect(rows).toHaveCount(32);

  const newTrailing = rows.last();
  const tableBox = await table.boundingBox();
  const rowBox = await newTrailing.boundingBox();
  if (!tableBox || !rowBox) throw new Error('table/row has no box');
  // "inside the scroller's client rect": the new row's own box is fully within the container's.
  expect(rowBox.y).toBeGreaterThanOrEqual(tableBox.y);
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(tableBox.y + tableBox.height + 1);
});

// The growth guard (D16's own reasoning: "without it, deleting the second row of forty would
// jump to the fortieth"): removing a row is a shrink, and must never scroll anywhere. Scrolled to
// the top, removing a row further down the (still off-screen) list must leave the top in view —
// deliberately not reusing the scroll-into-view test above, whose own scroll-to-bottom state
// would fold a real browser reflow (removing DOM above the viewport shifts scrollTop on its own)
// into the same assertion as the watcher's own behaviour.
test('Http request — deleting a header row does not scroll (D16 guard)', async ({ relaunch }) => {
  const headers = Array.from({ length: 30 }, (_, i) => ({
    name: `X-Header-${i}`,
    value: `v${i}`,
    enabled: true,
  }));
  const RESTORED_TAB = {
    id: 'tab-scroll-2',
    connectionId: null,
    path: 'request',
    kind: 'http-request',
    order: 0,
    active: true,
    state: {
      method: 'GET',
      url: '',
      headers,
      bodyMode: 'none',
      body: '',
      requestPane: 'headers',
      responsePane: 'body',
      responseView: 'pretty',
      requestPaneHeight: 0,
    },
  };
  const { window: page } = await relaunch({
    control: [{ channel: IPC.tabsList, response: [RESTORED_TAB] }],
  });

  const table = page.locator('[data-testid="http-headers-table"]');
  await expect(table).toBeVisible();
  await expect(table.evaluate((el) => el.scrollTop)).resolves.toBe(0);

  const rows = table.locator('[data-testid="http-header-row"]');
  // A plain `.click()` would first scroll the (currently off-screen) target into view — an
  // artifact of the test driver, not of the app — which is exactly the browser-reflow noise this
  // test exists to avoid. Dispatching the click via JS clicks the real button with no scroll.
  await rows
    .nth(20)
    .locator('[data-testid="http-header-remove"]')
    .evaluate((el: HTMLElement) => el.click());
  await expect(rows).toHaveCount(30);
  await expect(table.evaluate((el) => el.scrollTop)).resolves.toBe(0);
});
