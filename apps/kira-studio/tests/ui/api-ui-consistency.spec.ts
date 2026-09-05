import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { acceptConfirm } from './support/dialogs';
import { IPC } from './support/ipcChannels';

// P13 §7: a small, Api-only spec (the SPEC's module-boundary rule — "a single test file covering
// both is not") guarding three things a restyle can genuinely regress, not the restyles
// themselves: a de-duplicated affordance staying de-duplicated, an HTML-validity fix staying
// fixed, and one new control's enabled state actually tracking real data.

function modeTab(page: Page, mode: 'studio' | 'api'): Locator {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

test('collections empty state has no duplicate action buttons (D6)', async ({ relaunch }) => {
  // No control mock needed — mockRuntime.ts's own WILDCARD_DEFAULTS answers collectionsList with
  // an empty tree, which is exactly the state under test.
  const { window: page } = await relaunch({});
  await modeTab(page, 'api').click();

  const empty = page.locator(
    '[data-testid="new-collection-empty"], [data-testid="import-collection-empty"], [data-testid="new-request-empty"]',
  );
  await expect(empty).toHaveCount(0);
  // The header's own three actions are the one copy that remains reachable.
  await expect(page.locator('[data-testid="new-request"]')).toBeVisible();
  await expect(page.locator('[data-testid="new-collection"]')).toBeVisible();
  await expect(page.locator('[data-testid="import-collection"]')).toBeVisible();
  // D6/F3: no bordered dialog button anywhere in the panel's own empty-state slot.
  await expect(page.locator('.side-empty .p-dlgbtn')).toHaveCount(0);
});

function grpcTab(state: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'tab-grpc-1',
    connectionId: null,
    path: 'request',
    kind: 'grpc-request',
    order: 0,
    active: true,
    state: {
      target: '',
      tlsMode: 'tls',
      caFile: '',
      serverName: '',
      descriptorMode: 'reflection',
      protoPath: '',
      importPaths: [],
      service: '',
      method: '',
      message: '',
      metadata: [],
      itemId: null,
      name: '',
      requestPane: 'message',
      responsePane: 'history',
      requestPaneHeight: 0,
      ...state,
    },
  };
}

const GRPC_HISTORY_ENTRY = {
  id: 'call-1',
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
};

test('gRPC history row delete control is not nested inside a button (F20)', async ({
  relaunch,
}) => {
  const scope = { itemId: '', tabId: 'tab-grpc-1' };
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [grpcTab({})] },
    { channel: IPC.grpcHistoryList, args: scope, response: [GRPC_HISTORY_ENTRY] },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  const row = page.locator('[data-testid="grpc-history-row"]');
  await expect(row).toHaveCount(1);
  const deleteBtn = row.locator('[data-testid="grpc-history-delete"]');
  await expect(deleteBtn).toBeVisible();
  // The row itself may legitimately be an interactive element, but the delete control must never
  // be a descendant of a <button> — a <button> nested in a <button> is invalid HTML the parser
  // silently hoists out of its parent at parse time (F20), which this asserts can't come back.
  await expect(deleteBtn.locator('xpath=ancestor::button')).toHaveCount(0);
});

test('gRPC history Clear tracks whether there is anything to clear (D12)', async ({ relaunch }) => {
  const scope = { itemId: '', tabId: 'tab-grpc-1' };

  // service/method set and a live call answered so the response section (and its History pane)
  // renders even though the history list itself comes back empty — the same `hasResult ||
  // hasHistory` gate response-pane.vue's HTTP twin has.
  const empty = await relaunch({
    control: [
      { channel: IPC.tabsList, response: [grpcTab({ service: 'demo.Echo', method: 'SayHello' })] },
      {
        channel: IPC.grpcCall,
        response: {
          code: 0,
          codeName: 'OK',
          statusMessage: '',
          elapsedMs: 3,
          header: [],
          trailer: [],
          messageCount: 1,
          messageBytes: 10,
          messages: [{ seq: 0, json: '{}', wireBytes: 10, offsetMs: 0 }],
        },
      },
      { channel: IPC.grpcHistoryList, args: scope, response: [] },
    ],
  });
  await empty.window.click('[data-testid="grpc-call"]');
  await empty.window.click('[data-testid="grpc-response-pane-history"]');
  await expect(empty.window.locator('[data-testid="grpc-history-clear"]')).toBeDisabled();

  // Non-empty history alone is enough to render the toolbar — no live call needed here.
  const withEntries = await relaunch({
    control: [
      { channel: IPC.tabsList, response: [grpcTab({})] },
      { channel: IPC.grpcHistoryList, args: scope, response: [GRPC_HISTORY_ENTRY] },
    ],
  });
  await expect(withEntries.window.locator('[data-testid="grpc-history-clear"]')).toBeEnabled();
});

// P15 §4: four cases guarding this phase's own end-to-end behaviour, not the restyles themselves —
// the response pane's chrome present from tab-open (D1), JSON as a top-level body segment (D6),
// and the tab-strip badge (D8).

async function openHttpModeAndNewRequest(page: Page): Promise<void> {
  await modeTab(page, 'api').click();
  await expect(page.locator('[data-testid="api-start"]')).toBeVisible();
  await page.click('[data-testid="new-request-start"]');
}

test('a freshly opened request tab shows the response pane switcher before any send (D1)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({});
  await openHttpModeAndNewRequest(page);

  // Present from the moment the tab opens — asserted as a presence so a future refactor cannot
  // quietly re-hide it behind a first send again.
  await expect(page.locator('[data-testid="http-response-pane-toggle"]')).toBeVisible();

  // Each pane owns its own empty state — switching to Headers on a never-sent tab renders one
  // rather than throwing.
  await page.click('[data-testid="http-response-pane-headers"]');
  const headers = page.locator('[data-testid="http-response-headers"]');
  await expect(headers.locator('.p-empty')).toHaveText('Send a request to see the response');
});

test('the body-mode segmented control has a JSON segment (D6)', async ({ relaunch }) => {
  const { window: page } = await relaunch({});
  await openHttpModeAndNewRequest(page);
  await page.click('[data-testid="http-request-pane-body"]');

  await page.click('[data-testid="http-body-mode-json"]');
  await expect(page.locator('[data-testid="http-body-mode-json"]')).toHaveClass(/on/);
  // Same segmented control the request pane's own toggle uses for the Body segment's count/kind
  // badge — selecting JSON is reflected there end to end, without asserting storage directly.
  await expect(page.locator('[data-testid="http-request-pane-body"]')).toHaveText('Body (JSON)');
});

function httpRequestTab(
  id: string,
  order: number,
  active: boolean,
  state: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    connectionId: null,
    path: 'request',
    kind: 'http-request',
    order,
    active,
    state: {
      method: 'GET',
      url: '',
      headers: [],
      bodyMode: 'none',
      body: '',
      code: '',
      codeLanguage: 'json',
      urlEncoded: [],
      formData: [],
      binaryFile: null,
      itemId: null,
      name: '',
      requestPane: 'body',
      responsePane: 'body',
      responseView: 'pretty',
      requestPaneHeight: 0,
      ...state,
    },
  };
}

test('a request tab with a body shows a tab-strip badge; one with none does not (D8)', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.tabsList,
      response: [
        httpRequestTab('tab-has-body', 0, true, { bodyMode: 'raw', body: 'hello' }),
        httpRequestTab('tab-no-body', 1, false, { bodyMode: 'none' }),
      ],
    },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await expect(page.locator('[data-testid="http-request-view"]')).toBeVisible();
  const withBody = page.locator('[data-testid="tab"][data-tab-id="tab-has-body"]');
  const withoutBody = page.locator('[data-testid="tab"][data-tab-id="tab-no-body"]');
  await expect(withBody.locator('[data-testid="tab-badge"]')).toHaveCount(1);
  await expect(withoutBody.locator('[data-testid="tab-badge"]')).toHaveCount(0);
});

// P15b §4: six cases guarding this phase's own end-to-end behaviour — header-name autocomplete,
// {{variable}} colouring/hover/completion, and arrow-key navigation across the request tables.

const P15B_ENV = { id: 'env-p15b', name: 'Prod', sortOrder: 0, isActive: true };
const P15B_BASE_URL_VAR = {
  id: 'var-base-url',
  scope: 'environment',
  ownerId: 'env-p15b',
  name: 'base_url',
  value: 'api.example.com',
  isSecret: false,
  sortOrder: 0,
};
const P15B_SECRET_VAR = {
  id: 'var-api-key',
  scope: 'environment',
  ownerId: 'env-p15b',
  name: 'api_key',
  value: '',
  isSecret: true,
  sortOrder: 1,
};

function p15bVariableControl(): ControlSnapshot[] {
  return [
    { channel: IPC.variablesListEnvironments, response: [P15B_ENV] },
    {
      channel: IPC.variablesList,
      args: { scope: 'environment', ownerId: 'env-p15b' },
      response: [P15B_BASE_URL_VAR, P15B_SECRET_VAR],
    },
  ];
}

test('the URL field: typing {{ auto-closes, and accepting a suggestion produces a clean reference', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [httpRequestTab('tab-1', 0, true, {})] },
    ...p15bVariableControl(),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  const url = page.locator('[data-testid="http-url"]');
  await url.click();
  // D5(b) rule 1 composing twice: `{` gives `{|}`, a second `{` gives `{{|}}` — the reference the
  // user was going to type, caret where the name goes.
  await url.pressSequentially('{{');
  await expect(url).toHaveValue('{{}}');

  // D3(b)'s templateToken opens the popup once there is a non-empty word inside the reference.
  await url.pressSequentially('b');
  await expect(url).toHaveValue('{{b}}');
  const suggestions = page.locator('.autocomplete-suggestions li');
  await expect(suggestions.filter({ hasText: 'base_url' })).toBeVisible();

  // Accepting produces `{{base_url}}` — not `{{base_url}}}}` — the exact interaction between
  // auto-close and accept a reviewer cannot check by reading alone.
  await page.keyboard.press('Tab');
  await expect(url).toHaveValue('{{base_url}}');
  await expect(suggestions).toHaveCount(0);
});

test('the URL field paints a resolved reference and an unknown one differently', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [httpRequestTab('tab-1', 0, true, {})] },
    ...p15bVariableControl(),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.fill('[data-testid="http-url"]', 'https://{{base_url}}/v1?missing={{not_defined}}');

  const overlay = page.locator('.url-field .highlight-overlay');
  await expect(overlay.locator('.cm-kira-var')).toHaveCount(1);
  await expect(overlay.locator('.cm-kira-var-unknown')).toHaveCount(1);
});

test('hovering a resolved reference shows its value; hovering a secret never does', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [httpRequestTab('tab-1', 0, true, {})] },
    ...p15bVariableControl(),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.fill('[data-testid="http-url"]', 'https://{{base_url}}/{{api_key}}');

  const resolvedSpan = page.locator('.url-field .cm-kira-var');
  await expect(resolvedSpan).toHaveCount(1);
  const resolvedBox = await resolvedSpan.boundingBox();
  if (!resolvedBox) throw new Error('resolved reference span has no box');
  await page.mouse.move(
    resolvedBox.x + resolvedBox.width / 2,
    resolvedBox.y + resolvedBox.height / 2,
  );
  const hover = page.locator('[data-testid="autocomplete-hover"]');
  await expect(hover).toBeVisible();
  await expect(hover).toContainText('api.example.com');
  await expect(hover).toContainText('environment variable');

  // Move away, then hover the secret reference — a fresh token, so the panel re-arms.
  await page.mouse.move(0, 0);
  await expect(hover).toHaveCount(0);

  const secretSpan = page.locator('.url-field .cm-kira-var-secret');
  await expect(secretSpan).toHaveCount(1);
  const secretBox = await secretSpan.boundingBox();
  if (!secretBox) throw new Error('secret reference span has no box');
  await page.mouse.move(secretBox.x + secretBox.width / 2, secretBox.y + secretBox.height / 2);
  await expect(hover).toBeVisible();
  await expect(hover).toContainText('resolved when the request is sent');
  // The security property, not a UX one: the secret's plaintext (empty in this fixture, but the
  // point stands architecturally — mergedValuesAndSecrets never hands a secret's value to
  // variableCompletion.ts at all, F5) never appears, and neither does the word "value".
  await expect(hover).not.toContainText('api_key');
});

test('a header-name cell suggests Content-Type, and typing Content-T then accepting does not duplicate it', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [httpRequestTab('tab-1', 0, true, {})] },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.click('[data-testid="http-request-pane-headers"]');
  const nameInput = page.locator('[data-testid="http-header-name"]').first();
  await nameInput.click();
  await nameInput.pressSequentially('cont');
  const suggestions = page.locator('.autocomplete-suggestions li');
  await expect(suggestions.filter({ hasText: 'Content-Type' })).toBeVisible();
  await page.keyboard.press('Escape');
  await nameInput.fill('');

  // F1's own concatenation bug, asserted so it cannot come back: the default word-run tokenizer
  // has no `-`, so accepting after `Content-T` would otherwise produce `Content-Content-Type`.
  await nameInput.click();
  await nameInput.pressSequentially('Content-T');
  await expect(suggestions.filter({ hasText: 'Content-Type' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(nameInput).toHaveValue('Content-Type');
});

test('ArrowDown moves focus down a column, but not while the completion popup is navigating (D6)', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.tabsList,
      response: [
        httpRequestTab('tab-1', 0, true, {
          headers: [
            { name: 'Authorization', value: 'Bearer x', enabled: true },
            { name: 'Accept', value: 'application/json', enabled: true },
          ],
        }),
      ],
    },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.click('[data-testid="http-request-pane-headers"]');
  const names = page.locator('[data-testid="http-header-name"]');
  await expect(names).toHaveCount(3); // two real rows plus the trailing blank one

  await names.nth(0).click();
  await page.keyboard.press('ArrowDown');
  await expect(names.nth(1)).toBeFocused();

  // While the popup is open and navigating, ArrowDown must move the *popup* selection, not focus.
  await names.nth(0).click();
  await names.nth(0).fill('');
  await names.nth(0).pressSequentially('cont');
  const suggestions = page.locator('.autocomplete-suggestions li');
  await expect(suggestions.filter({ hasText: 'Content-Type' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(names.nth(0)).toBeFocused();
  await expect(names.nth(1)).not.toBeFocused();
});

// P16 §4: the Api half of this phase's own new coverage — D6 (dropdown height parity), D8/D9
// (the two retinted tokens), D11 (the response find bar), D12/D13 (the headers pane filter and
// the request tables' index-carry-through under a filter).

test('http-method-select and http-url report the same height (D6)', async ({ relaunch }) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [httpRequestTab('tab-1', 0, true, {})] },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  const methodHeight = await page
    .locator('[data-testid="http-method-select"]')
    .evaluate((el) => (el as HTMLElement).offsetHeight);
  const urlBoxHeight = await page
    .locator('.p-input:has([data-testid="http-url"])')
    .evaluate((el) => (el as HTMLElement).offsetHeight);
  expect(urlBoxHeight).toBe(methodHeight);
});

test('a placeholder is muted text, and .dim text is subtle text (D8/D9)', async ({ relaunch }) => {
  const RESPONSE = {
    status: 200,
    statusText: 'OK',
    proto: 'HTTP/1.1',
    headers: [],
    body: '',
    bodyEncoding: 'utf8',
    bodyBytes: 0,
    bodyTruncated: false,
    elapsedMs: 5,
    finalUrl: 'https://api.example.com/',
    redirects: [],
  };
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [httpRequestTab('tab-1', 0, true, {})] },
    { channel: IPC.httpSend, response: RESPONSE },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  // D8: pins the two tokens against a future well-meaning revert — computed colour, not the
  // token's own declared value, since ::placeholder pseudo-elements don't expose custom
  // properties directly to getComputedStyle on the real element.
  const [placeholderColor, mutedToken] = await page.evaluate(() => {
    const input = document.querySelector('[data-testid="http-url"]') as HTMLElement;
    const cs = getComputedStyle(input, '::placeholder');
    const root = getComputedStyle(document.documentElement);
    return [cs.color, root.getPropertyValue('--kira-fg-muted').trim()];
  });
  expect(placeholderColor).not.toBe('');
  // Convert the muted token (a hex string) and the computed placeholder colour to the same
  // rgb(...) form the browser reports, via a throwaway element.
  const mutedRgb = await page.evaluate((hex) => {
    const probe = document.createElement('span');
    probe.style.color = hex;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }, mutedToken);
  expect(placeholderColor).toBe(mutedRgb);

  // D9: a `.dim` element (the elapsed-time caption in the response status row, shown once a
  // response has landed) now reads --kira-fg-subtle, not --kira-fg-disabled.
  await page.click('[data-testid="http-send"]');
  await expect(page.locator('[data-testid="http-elapsed"]')).toBeVisible();
  const [dimColor, subtleRgb] = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="http-elapsed"]') as HTMLElement;
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement)
      .getPropertyValue('--kira-fg-subtle')
      .trim();
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).color, rgb];
  });
  expect(dimColor).toBe(subtleRgb);
});

test('the response find bar counts and steps through matches, and Escape clears them (D11)', async ({
  relaunch,
}) => {
  const RESPONSE_BODY = '{"id":1,"name":"Ada","note":"Ada Lovelace"}'; // "Ada" appears twice
  const RESPONSE = {
    status: 200,
    statusText: 'OK',
    proto: 'HTTP/1.1',
    headers: [{ name: 'Content-Type', value: 'application/json' }],
    body: RESPONSE_BODY,
    bodyEncoding: 'utf8',
    bodyBytes: RESPONSE_BODY.length,
    bodyTruncated: false,
    elapsedMs: 10,
    finalUrl: 'https://api.example.com/users',
    redirects: [],
  };
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.tabsList,
      response: [httpRequestTab('tab-1', 0, true, { url: 'https://api.example.com/users' })],
    },
    { channel: IPC.httpSend, response: RESPONSE },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.click('[data-testid="http-send"]');
  await expect(page.locator('[data-testid="http-status"]')).toContainText('200');

  await page.click('[data-testid="http-find-toggle"]');
  await expect(page.locator('[data-testid="http-find-bar"]')).toBeVisible();
  await page.fill('[data-testid="http-find-input"]', 'Ada');
  await expect(page.locator('[data-testid="http-find-count"]')).toHaveText('1 of 2');
  await page.click('[data-testid="http-find-next"]');
  await expect(page.locator('[data-testid="http-find-count"]')).toHaveText('2 of 2');
  await expect(page.locator('.cm-kira-find-match-current')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="http-find-bar"]')).toHaveCount(0);
  await expect(page.locator('.cm-kira-find-match')).toHaveCount(0);
  await expect(page.locator('.cm-kira-find-match-current')).toHaveCount(0);
});

test('filtering the response headers pane, and filtering the request headers table without losing a row’s identity (D12/D13)', async ({
  relaunch,
}) => {
  const RESPONSE = {
    status: 200,
    statusText: 'OK',
    proto: 'HTTP/1.1',
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'X-Request-Id', value: 'abc123' },
      { name: 'Cache-Control', value: 'no-store' },
    ],
    body: '{}',
    bodyEncoding: 'utf8',
    bodyBytes: 2,
    bodyTruncated: false,
    elapsedMs: 5,
    finalUrl: 'https://api.example.com/users',
    redirects: [],
  };
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.tabsList,
      response: [
        httpRequestTab('tab-1', 0, true, {
          url: 'https://api.example.com/users',
          headers: [
            { name: 'Authorization', value: 'Bearer x', enabled: true },
            { name: 'Accept', value: 'application/json', enabled: true },
            { name: 'X-Debug', value: 'on', enabled: true },
          ],
        }),
      ],
    },
    { channel: IPC.httpSend, response: RESPONSE },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  // D12: the response headers pane's own filter, by name or value.
  await page.click('[data-testid="http-send"]');
  await page.click('[data-testid="http-response-pane-headers"]');
  await expect(page.locator('[data-testid="http-response-headers"] .p-kv-row')).toHaveCount(3);
  await page.fill('[data-testid="http-response-headers-filter"]', 'no-store');
  await expect(page.locator('[data-testid="http-response-headers"] .p-kv-row')).toHaveCount(1);
  await expect(page.locator('[data-testid="http-response-headers-count"]')).toHaveText(
    '1 of 3 headers',
  );
  await page.fill('[data-testid="http-response-headers-filter"]', '');

  // D13/F11: the request headers table's own filter, and the index-carry-through hazard —
  // filtering down to one real row and editing it must write to *that* row, never to whichever
  // position it happens to land on in the filtered list.
  await page.click('[data-testid="http-request-pane-headers"]');
  await page.click('[data-testid="http-field-filter-toggle"]');
  await page.fill('[data-testid="http-field-filter"]', 'Debug');
  const filteredRows = page.locator('[data-testid="http-header-row"]');
  await expect(filteredRows).toHaveCount(2); // X-Debug + the trailing blank row, never hidden
  await filteredRows.first().locator('[data-testid="http-header-value"]').fill('off');

  // Closing the toggle clears the filter and restores every row (D13's own rule) — the edit above
  // must have landed on X-Debug (real position 2), not on Authorization (position 0, the filtered
  // list's own position 0) and not on the trailing row.
  await page.click('[data-testid="http-field-filter-toggle"]');
  await expect(page.locator('[data-testid="http-field-filter"]')).toHaveCount(0);
  const allRows = page.locator('[data-testid="http-header-row"]');
  await expect(allRows).toHaveCount(4); // three real rows + trailing
  await expect(allRows.nth(0).locator('[data-testid="http-header-name"]')).toHaveValue(
    'Authorization',
  );
  await expect(allRows.nth(0).locator('[data-testid="http-header-value"]')).toHaveValue('Bearer x');
  await expect(allRows.nth(2).locator('[data-testid="http-header-name"]')).toHaveValue('X-Debug');
  await expect(allRows.nth(2).locator('[data-testid="http-header-value"]')).toHaveValue('off');
});

// P17 §4.4: this phase's own eight new cases — the pipe/fake namespace, the method select, and
// the dialog->tab/duplicate/bulk-edit/overview surfaces item 3/4/5/8 built.

test('typing "{{base_url | " in the URL field lists the six transforms, not the variable names (D13(b))', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [httpRequestTab('tab-1', 0, true, {})] },
    ...p15bVariableControl(),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  const url = page.locator('[data-testid="http-url"]');
  await url.click();
  await url.pressSequentially('https://{{');
  await expect(url).toHaveValue('https://{{}}');
  await url.pressSequentially('base_url | ');
  await expect(url).toHaveValue('https://{{base_url | }}');

  // Ctrl+Space forces the full list open on an empty word (completionKeymap's own "show me
  // everything" binding, shared with the console) — after the pipe, that list is exactly the six
  // transforms, never base_url/api_key.
  await page.keyboard.press('Control+Space');
  const suggestions = page.locator('.autocomplete-suggestions li');
  await expect(suggestions).toHaveCount(6);
  await expect(suggestions.filter({ hasText: 'base_url' })).toHaveCount(0);
  await expect(suggestions.filter({ hasText: 'base64 encode' })).toBeVisible();

  await suggestions.filter({ hasText: 'base64 encode' }).click();
  await expect(url).toHaveValue('https://{{base_url | base64}}');
});

test('the URL field paints a piped reference resolved and an unrecognised transform unknown (D3 rule 4)', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [httpRequestTab('tab-1', 0, true, {})] },
    ...p15bVariableControl(),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.fill(
    '[data-testid="http-url"]',
    'https://{{base_url | base64}}/v1?x={{base_url | nope}}',
  );

  const overlay = page.locator('.url-field .highlight-overlay');
  await expect(overlay.locator('.cm-kira-var')).toHaveCount(1);
  await expect(overlay.locator('.cm-kira-var-unknown')).toHaveCount(1);
});

test("hovering a piped secret names the transform and shows no value (§5's UI-half security assertion)", async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [httpRequestTab('tab-1', 0, true, {})] },
    ...p15bVariableControl(),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.fill('[data-testid="http-url"]', 'https://{{base_url}}/{{api_key | base64}}');

  const secretSpan = page.locator('.url-field .cm-kira-var-secret');
  await expect(secretSpan).toHaveCount(1);
  const secretBox = await secretSpan.boundingBox();
  if (!secretBox) throw new Error('secret reference span has no box');
  await page.mouse.move(secretBox.x + secretBox.width / 2, secretBox.y + secretBox.height / 2);
  const hover = page.locator('[data-testid="autocomplete-hover"]');
  await expect(hover).toBeVisible();
  await expect(hover).toContainText('secret — base64-encoded when the request is sent');
  // The security assertion: no value, transformed or not, and the name isn't repeated either.
  await expect(hover).not.toContainText('api_key');
});

test('the method select opens an app-drawn menu, and PATCH gets its own colour, distinct from PUT (D18/D19)', async ({
  relaunch,
}) => {
  const NOW = '2026-01-01T00:00:00.000Z';
  const TREE = {
    collections: [
      { id: 'col-1', name: 'Orders API', sortOrder: 0, createdAt: NOW, updatedAt: NOW },
    ],
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
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: TREE },
    { channel: IPC.collectionsGetRequest, response: HEALTH_REQUEST },
  ];
  const { window: page } = await relaunch({ control: CONTROL });
  await modeTab(page, 'api').click();
  await expect(page.locator('[data-testid="collection-row"][data-id="col-1"]')).toBeVisible();
  await page.locator('[data-testid="collection-row"][data-id="col-1"]').locator('.twisty').click();
  await page.locator('[data-testid="collection-row"][data-id="item-1"]').dblclick();
  await expect(page.locator('[data-testid="http-request-view"]')).toBeVisible();

  const trigger = page.locator('[data-testid="http-method-select"]');
  await trigger.click();
  await expect(page.locator('[data-testid="method-menu"]')).toBeVisible();
  await expect(page.locator('[data-testid="method-menu-item-GET"] .codicon-check')).toHaveCount(1);

  await page.click('[data-testid="method-menu-item-PATCH"]');
  await expect(page.locator('[data-testid="method-menu"]')).toHaveCount(0);
  await expect(trigger).toHaveAttribute('data-value', 'PATCH');

  // "each a distinct colour" — the trigger's own resolved text colour actually differs between
  // the two methods that used to share one family (PUT/PATCH both 'warn' under httpMethodClass).
  const patchColor = await trigger.evaluate((el) => getComputedStyle(el).color);
  await trigger.click();
  await page.click('[data-testid="method-menu-item-PUT"]');
  const putColor = await trigger.evaluate((el) => getComputedStyle(el).color);
  expect(putColor).not.toBe(patchColor);
});

const P17_TREE = {
  collections: [
    {
      id: 'col-1',
      name: 'Orders API',
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  items: [],
};

test('Variables… on a collection row opens a tab, a second invocation activates it rather than opening a second, and renaming retitles it (D16)', async ({
  relaunch,
}) => {
  const RENAMED_TREE = {
    collections: [{ ...P17_TREE.collections[0], name: 'Orders API v2' }],
    items: [],
  };
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: P17_TREE },
    { channel: IPC.variablesListEnvironments, response: [] },
    { channel: IPC.variablesList, args: { scope: 'collection', ownerId: 'col-1' }, response: [] },
    { channel: IPC.collectionsRename, response: undefined },
    { channel: IPC.collectionsList, response: RENAMED_TREE },
  ];
  const { window: page } = await relaunch({ control: CONTROL });
  await modeTab(page, 'api').click();

  const row = page.locator('[data-testid="collection-row"][data-id="col-1"]');
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page.click('[data-testid="menu-item-variables"]');
  await expect(page.locator('[data-testid="variables-dialog"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(1);

  // D16's reuse: true — a second invocation activates the same tab, never a second one.
  await row.click({ button: 'right' });
  await page.click('[data-testid="menu-item-variables"]');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(1);

  // Renaming the collection follows through to the open tab's own name (D16, the same
  // renameApiRequestTabs shape P4 D14 already established for a request tab).
  await row.click({ button: 'right' });
  await page.click('[data-testid="menu-item-rename"]');
  await page.locator('[data-testid="collection-rename-input"]').fill('Orders API v2');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="variable-set-target"]')).toContainText('Orders API v2');
});

test('duplicating an environment produces "<name> copy" carrying the same variable names, with the original still active (D17)', async ({
  relaunch,
}) => {
  const ENV = { id: 'env-1', name: 'Prod', sortOrder: 0, isActive: true, description: '' };
  const ENV_COPY = {
    id: 'env-1-copy',
    name: 'Prod copy',
    sortOrder: 1,
    isActive: false,
    description: '',
  };
  const VAR_COPY = {
    id: 'var-1-copy',
    scope: 'environment',
    ownerId: 'env-1-copy',
    name: 'region',
    value: 'us',
    isSecret: false,
    sortOrder: 0,
    description: '',
  };
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: P17_TREE },
    { channel: IPC.variablesListEnvironments, response: [ENV] },
    { channel: IPC.variablesDuplicateEnvironment, response: ENV_COPY },
    { channel: IPC.variablesListEnvironments, response: [ENV, ENV_COPY] },
    {
      channel: IPC.variablesList,
      args: { scope: 'environment', ownerId: 'env-1-copy' },
      response: [VAR_COPY],
    },
  ];
  const { window: page } = await relaunch({ control: CONTROL });
  await modeTab(page, 'api').click();

  await page.locator('[data-testid="tree-background"]').click({ button: 'right' });
  await page.click('[data-testid="menu-item-environments"]');
  await expect(page.locator('[data-testid="environments-dialog"]')).toBeVisible();

  const originalRow = page.locator('[data-testid="environment-row"][data-id="env-1"]');
  await originalRow.locator('[data-testid="environment-duplicate"]').click();

  const copyRow = page.locator('[data-testid="environment-row"][data-id="env-1-copy"]');
  await expect(copyRow).toBeVisible();
  await expect(copyRow.locator('[data-testid="environment-name"]')).toHaveValue('Prod copy');
  await expect(originalRow.locator('[data-testid="environment-active"]')).toBeChecked();
  await expect(copyRow.locator('[data-testid="environment-active"]')).not.toBeChecked();

  await copyRow.locator('[data-testid="environment-edit-variables"]').click();
  await expect(page.locator('[data-testid="variables-dialog"]')).toBeVisible();
  await expect(
    page.locator('[data-testid="variable-row"]').first().locator('[data-testid="variable-name"]'),
  ).toHaveValue('region');
});

test('the bulk editor: toggle, edit, live summary and rename warning, Apply through the confirm, and a secret left blank stays intact (item 5)', async ({
  relaunch,
}) => {
  const ROW_KEPT = {
    id: 'v-kept',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'kept',
    value: 'v1',
    isSecret: false,
    sortOrder: 0,
    description: '',
  };
  const ROW_SECRET = {
    id: 'v-token',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'token',
    value: '',
    isSecret: true,
    sortOrder: 1,
    description: '',
  };
  const ROW_GONE = {
    id: 'v-gone',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'gone',
    value: 'x',
    isSecret: false,
    sortOrder: 2,
    description: '',
  };
  const AFTER = [
    { ...ROW_KEPT, value: 'v2' },
    ROW_SECRET,
    {
      id: 'v-added',
      scope: 'collection',
      ownerId: 'col-1',
      name: 'added',
      value: 'z',
      isSecret: false,
      sortOrder: 1,
      description: '',
    },
  ];
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: P17_TREE },
    { channel: IPC.variablesListEnvironments, response: [] },
    {
      channel: IPC.variablesList,
      args: { scope: 'collection', ownerId: 'col-1' },
      response: [ROW_KEPT, ROW_SECRET, ROW_GONE],
    },
    {
      channel: IPC.variablesApplyBulk,
      response: { added: 1, updated: 1, removed: 1, reordered: false },
    },
    {
      channel: IPC.variablesList,
      args: { scope: 'collection', ownerId: 'col-1' },
      response: AFTER,
    },
  ];
  const { window: page } = await relaunch({ control: CONTROL });
  await modeTab(page, 'api').click();

  await page.locator('[data-testid="collection-row"][data-id="col-1"]').click({ button: 'right' });
  await page.click('[data-testid="menu-item-variables"]');
  await expect(page.locator('[data-testid="variables-dialog"]')).toBeVisible();
  await expect(page.locator('[data-testid="variable-row"]')).toHaveCount(4); // 3 real + trailing

  await page.click('[data-testid="variables-bulk-toggle"]');
  const editor = page.locator('[data-testid="variables-bulk-textarea"] .cm-content');
  await expect(editor).toBeVisible();
  // The secret's own line is seeded empty, with the fixed marker comment above it (D21) — the
  // seed already proves the renderer never had a plaintext to write out.
  await expect(editor).toContainText('secret — the value is not shown here');

  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    [
      'kept=v2',
      '',
      '# secret — the value is not shown here and is left unchanged unless you type one',
      'token=',
      '',
      'added=z',
    ].join('\n'),
  );

  await expect(page.locator('[data-testid="variables-bulk-summary"]')).toContainText(
    '1 added · 1 updated · 1 removed',
  );
  await expect(page.locator('[data-testid="variables-bulk-rename-warning"]')).toBeVisible();

  await page.click('[data-testid="variables-bulk-apply"]');
  await acceptConfirm(page);

  await expect(page.locator('[data-testid="variables-bulk-editor"]')).toHaveCount(0);
  const rows = page.locator('[data-testid="variable-row"]');
  await expect(rows).toHaveCount(4); // kept, token, added + trailing
  await expect(page.locator('[data-testid="variable-row"][data-id="v-token"]')).toBeVisible();
  await expect(
    page.locator('[data-testid="variable-row"][data-id="v-token"] [data-testid="variable-secret"]'),
  ).toBeChecked();
  await expect(page.locator('[data-testid="variable-row"][data-id="v-gone"]')).toHaveCount(0);
  await expect(
    page.locator('[data-testid="variable-row"][data-id="v-added"] [data-testid="variable-value"]'),
  ).toHaveValue('z');
});

test('the overview panel opens from a request tab, lists both scopes with their chips, masks a secret, and Edit… opens the D16 tab (item 8)', async ({
  relaunch,
}) => {
  const NOW = '2026-01-01T00:00:00.000Z';
  const TREE = {
    collections: [
      { id: 'col-1', name: 'Orders API', sortOrder: 0, createdAt: NOW, updatedAt: NOW },
    ],
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
  const ENV = { id: 'env-1', name: 'Prod', sortOrder: 0, isActive: true, description: '' };
  const ENV_VAR = {
    id: 'var-env',
    scope: 'environment',
    ownerId: 'env-1',
    name: 'region',
    value: 'us-east',
    isSecret: false,
    sortOrder: 0,
    description: '',
  };
  const COL_SECRET = {
    id: 'var-col-secret',
    scope: 'collection',
    ownerId: 'col-1',
    name: 'apiKey',
    value: '',
    isSecret: true,
    sortOrder: 0,
    description: '',
  };
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: TREE },
    { channel: IPC.collectionsGetRequest, response: HEALTH_REQUEST },
    { channel: IPC.variablesListEnvironments, response: [ENV] },
    {
      channel: IPC.variablesList,
      args: { scope: 'environment', ownerId: 'env-1' },
      response: [ENV_VAR],
    },
    {
      channel: IPC.variablesList,
      args: { scope: 'collection', ownerId: 'col-1' },
      response: [COL_SECRET],
    },
  ];
  const { window: page } = await relaunch({ control: CONTROL });
  await modeTab(page, 'api').click();
  await expect(page.locator('[data-testid="collection-row"][data-id="col-1"]')).toBeVisible();
  await page.locator('[data-testid="collection-row"][data-id="col-1"]').locator('.twisty').click();
  await page.locator('[data-testid="collection-row"][data-id="item-1"]').dblclick();
  await expect(page.locator('[data-testid="http-request-view"]')).toBeVisible();

  await page.click('[data-testid="http-variables-overview-toggle"]');
  await expect(page.locator('[data-testid="variables-overview"]')).toBeVisible();

  const rows = page.locator('[data-testid="variables-overview-row"]');
  await expect(rows).toHaveCount(2);
  await expect(
    page.locator('[data-testid="variables-overview-row"][data-scope="environment"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-testid="variables-overview-row"][data-scope="collection"]'),
  ).toHaveCount(1);
  await expect(page.locator('[data-testid="variables-overview-secret"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="variables-overview-value"]')).toContainText('us-east');

  await page.click('[data-testid="variables-overview-edit-environment"]');
  await expect(
    page.locator('[data-testid="variables-dialog"][data-scope="environment"]'),
  ).toBeVisible();
});

// P18 D10/D12: gRPC parity with the URL-field (:300) and header-name (:357) cases above — closing
// F15 (no {{variable}} colouring anywhere in gRPC) and P15b #7 (no metadata-name completion).

const GRPC_P18_ENV = { id: 'env-p18', name: 'Prod', sortOrder: 0, isActive: true };
const GRPC_P18_BASE_URL_VAR = {
  id: 'var-target',
  scope: 'environment',
  ownerId: 'env-p18',
  name: 'target',
  value: 'demo.example.com:443',
  isSecret: false,
  sortOrder: 0,
};

function grpcP18VariableControl(): ControlSnapshot[] {
  return [
    { channel: IPC.variablesListEnvironments, response: [GRPC_P18_ENV] },
    {
      channel: IPC.variablesList,
      args: { scope: 'environment', ownerId: 'env-p18' },
      response: [GRPC_P18_BASE_URL_VAR],
    },
  ];
}

test('the gRPC target paints a resolved reference and an unknown one differently (P18 D10)', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [grpcTab({})] },
    ...grpcP18VariableControl(),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.fill('[data-testid="grpc-target"]', '{{target}}/{{not_defined}}');

  const overlay = page.locator('.grpc-target-field .highlight-overlay');
  await expect(overlay.locator('.cm-kira-var')).toHaveCount(1);
  await expect(overlay.locator('.cm-kira-var-unknown')).toHaveCount(1);
});

test('a metadata name cell suggests grpc-timeout (P18 D12)', async ({ relaunch }) => {
  const CONTROL: ControlSnapshot[] = [{ channel: IPC.tabsList, response: [grpcTab({})] }];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.click('[data-testid="grpc-request-pane-metadata"]');
  const nameInput = page.locator('[data-testid="grpc-metadata-name"]').first();
  await nameInput.click();
  await nameInput.pressSequentially('grpc-time');
  const suggestions = page.locator('.autocomplete-suggestions li');
  await expect(suggestions.filter({ hasText: 'grpc-timeout' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(nameInput).toHaveValue('grpc-timeout');
});

// P18 D19: the environment select is app-drawn now (P17 D18's precedent) — a colour dot on the
// closed state and per row, and the closed height/border/padding unchanged (P16 D6, extending the
// http-method-select/http-url case at :424).

const GRPC_ENV_COLOR_A = {
  id: 'env-a',
  name: 'Prod',
  sortOrder: 0,
  isActive: true,
  description: '',
  color: 'blue',
};
const GRPC_ENV_COLOR_B = {
  id: 'env-b',
  name: 'Staging',
  sortOrder: 1,
  isActive: false,
  description: '',
  color: 'none',
};

test('the environment select opens an app-drawn menu carrying each environment’s colour, and its closed height matches the controls beside it (P18 D19)', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [httpRequestTab('tab-1', 0, true, {})] },
    { channel: IPC.variablesListEnvironments, response: [GRPC_ENV_COLOR_A, GRPC_ENV_COLOR_B] },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  const select = page.locator('[data-testid="api-environment-select"]');
  await expect(select).toBeVisible();
  await expect(select.locator('.p-conn-dot')).toBeVisible();

  // P16 D6's own rule, extended: the closed control's height matches its neighbours in the same
  // toolbar row, unaffected by the native-<select> -> app-drawn-<button> swap.
  const selectHeight = await select.evaluate((el) => (el as HTMLElement).offsetHeight);
  const urlBoxHeight = await page
    .locator('.p-input:has([data-testid="http-url"])')
    .evaluate((el) => (el as HTMLElement).offsetHeight);
  expect(selectHeight).toBe(urlBoxHeight);

  await select.click();
  const menu = page.locator('[data-testid="api-environment-menu"]');
  await expect(menu).toBeVisible();

  const noneRow = page.locator('[data-testid="api-environment-option-none"]');
  await expect(noneRow.locator('.p-conn-dot.none')).toBeVisible();

  const rows = page.locator('[data-testid="api-environment-option"]');
  await expect(rows).toHaveCount(2);
  const prodRow = rows.filter({ hasText: 'Prod' });
  const stagingRow = rows.filter({ hasText: 'Staging' });
  await expect(prodRow.locator('.p-conn-dot')).not.toHaveClass(/none/);
  await expect(stagingRow.locator('.p-conn-dot')).toHaveClass(/none/);

  await prodRow.click();
  await expect(menu).toHaveCount(0);
  await expect(select).toHaveAttribute('data-value', 'env-a');
});

// P18 D17: an environment's colour reaches the request view's toolbar cap and head dot, and
// changes live when the active environment changes — LAW 07's rail/dot, the exact analogue of a
// query console's own connection indicator, filling the slot F20 #6 found reserved-but-empty.

test('an environment’s colour reaches the request view’s toolbar cap and head dot, and changes when the active environment changes (P18 D17)', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [httpRequestTab('tab-1', 0, true, {})] },
    // Two answers, consumed in order: env-a active (initial mount), then env-b active (the
    // reload setActiveEnvironment triggers after the switch below) — the same "list re-fetched
    // after every mutation" shape variablesSetActiveEnvironment/loadEnvironments already has.
    { channel: IPC.variablesListEnvironments, response: [GRPC_ENV_COLOR_A, GRPC_ENV_COLOR_B] },
    {
      channel: IPC.variablesListEnvironments,
      response: [
        { ...GRPC_ENV_COLOR_A, isActive: false },
        { ...GRPC_ENV_COLOR_B, isActive: true },
      ],
    },
    { channel: IPC.variablesSetActiveEnvironment, args: { id: 'env-b' }, response: null },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  const rail = page.locator('[data-testid="http-request-view"] .p-toolbar-rail');
  await expect(rail).toHaveAttribute('style', /--kira-conn-blue/);

  const headDot = page.locator('.p-view-head .p-conn-dot');
  await expect(headDot).not.toHaveClass(/none/);
  await expect(headDot).toHaveAttribute('style', /--kira-conn-blue/);

  await page.click('[data-testid="api-environment-select"]');
  await page.click('[data-testid="api-environment-option"][data-value="env-b"]');

  await expect(headDot).toHaveClass(/none/);
});
