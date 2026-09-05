import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
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
