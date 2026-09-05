import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { acceptConfirm } from './support/dialogs';
import { IPC } from './support/ipcChannels';
import { CHANNEL_TO_FQN, emitWailsEvent } from './support/mockRuntime';

// Located by row id rather than by label — collections.spec.ts's own helper verbatim, over the
// collections tree's own row (`[data-testid="collection-row"]`), a different tree from
// tests/ui/support/tree.ts's `[data-testid="tree-row"]` (the Studio project tree).
function row(page: Page, id: string): Locator {
  return page.locator(`[data-testid="collection-row"][data-id="${id}"]`);
}

// P11 §6.4: seven tests, driving both wire planes mocked (D13's own reasoning, ported verbatim
// from every other tests/ui spec) — the `Call` bound-call endpoint via installControlMocks'
// snapshot machinery, and D8's own pushed message channel via F20's new `emitWailsEvent` helper.

function modeTab(page: Page, mode: 'studio' | 'api'): Locator {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

async function openHttpModeAndNewGrpcRequest(page: Page): Promise<void> {
  await modeTab(page, 'api').click();
  await expect(page.locator('[data-testid="api-start"]')).toBeVisible();
  await page.click('[data-testid="new-grpc-request-start"]');
}

// A restored 'grpc-request' tab (grpcRequestTabStateSchema's own defaults, overridden per test) —
// the same "skip the UI's own build-up path and start from a known state" shortcut
// collections.spec.ts and http-request.spec.ts's third test both already use.
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
      responsePane: 'messages',
      requestPaneHeight: 0,
      ...state,
    },
  };
}

const UNARY_SCHEMA = {
  services: [
    {
      name: 'demo.Echo',
      methods: [
        {
          name: 'SayHello',
          fullName: 'demo.Echo/SayHello',
          clientStreaming: false,
          serverStreaming: false,
          inputType: 'demo.HelloRequest',
          outputType: 'demo.HelloReply',
          requestTemplate: '{\n  "name": ""\n}',
        },
      ],
    },
  ],
  mode: 'reflection',
  warnings: [] as string[],
};

const TWO_SERVICE_SCHEMA = {
  services: [
    {
      name: 'demo.Echo',
      methods: [
        {
          name: 'SayHello',
          fullName: 'demo.Echo/SayHello',
          clientStreaming: false,
          serverStreaming: false,
          inputType: 'demo.HelloRequest',
          outputType: 'demo.HelloReply',
          requestTemplate: '{\n  "name": ""\n}',
        },
      ],
    },
    {
      name: 'demo.Items',
      methods: [
        {
          name: 'ListItems',
          fullName: 'demo.Items/ListItems',
          clientStreaming: false,
          serverStreaming: true,
          inputType: 'demo.ListRequest',
          outputType: 'demo.Item',
          requestTemplate: '{\n  "pageSize": 0\n}',
        },
      ],
    },
  ],
  mode: 'reflection',
  warnings: [] as string[],
};

const STREAM_SCHEMA = {
  services: [
    {
      name: 'demo.Items',
      methods: [
        {
          name: 'ListItems',
          fullName: 'demo.Items/ListItems',
          clientStreaming: false,
          serverStreaming: true,
          inputType: 'demo.ListRequest',
          outputType: 'demo.Item',
          requestTemplate: '{\n  "pageSize": 0\n}',
        },
      ],
    },
  ],
  mode: 'reflection',
  warnings: [] as string[],
};

test('gRPC request — open a tab and browse a schema', async ({ relaunch }) => {
  const CONTROL: ControlSnapshot[] = [{ channel: IPC.grpcDescribe, response: TWO_SERVICE_SCHEMA }];
  const { window: page } = await relaunch({ control: CONTROL });

  await openHttpModeAndNewGrpcRequest(page);
  const view = page.locator('[data-testid="grpc-request-view"]');
  await expect(view).toBeVisible();

  // Right icon (D2: distinct from HTTP's 'globe') and, once a target exists, the right title
  // (grpcRequestTitle's own precedence falls to the target when no name/service/method is set).
  const tab = page.locator('[data-testid="tab"]');
  await expect(tab).toHaveCount(1);
  await expect(tab.locator('.codicon-symbol-interface')).toBeVisible();

  await page.fill('[data-testid="grpc-target"]', 'demo.example.com:443');
  await expect(tab).toContainText('demo.example.com:443');

  await page.click('[data-testid="grpc-request-pane-schema"]');
  const serviceList = page.locator('[data-testid="grpc-service-list"]');
  await expect(serviceList).toBeVisible();
  await expect(page.locator('[data-testid="grpc-service-name"]')).toHaveText([
    'demo.Echo',
    'demo.Items',
  ]);

  const methodRows = page.locator('[data-testid="grpc-method-row"]');
  await expect(methodRows).toHaveCount(2);
  await expect(methodRows.nth(0)).toContainText('SayHello');
  await expect(methodRows.nth(0).locator('[data-testid="grpc-method-streaming-badge"]')).toHaveText(
    'UNARY',
  );
  await expect(methodRows.nth(1)).toContainText('ListItems');
  await expect(methodRows.nth(1).locator('[data-testid="grpc-method-streaming-badge"]')).toHaveText(
    'STREAM',
  );
});

test('gRPC request — choosing a method seeds the Message editor with its template', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [{ channel: IPC.grpcDescribe, response: TWO_SERVICE_SCHEMA }];
  const { window: page } = await relaunch({ control: CONTROL });

  await openHttpModeAndNewGrpcRequest(page);
  await page.fill('[data-testid="grpc-target"]', 'demo.example.com:443');
  await page.click('[data-testid="grpc-request-pane-schema"]');
  await expect(page.locator('[data-testid="grpc-method-row"]')).toHaveCount(2);

  await page.locator('[data-testid="grpc-method-row"]').nth(1).click();

  // Selecting a method switches the request pane to Message (SchemaBrowser's own selectMethod)…
  await expect(page.locator('[data-testid="grpc-request-pane"]')).toContainText('pageSize');
  const editor = page.locator('[data-testid="grpc-message-editor"] .cm-content');
  await expect(editor).toBeVisible();
  expect(await editor.innerText()).toBe('{\n  "pageSize": 0\n}');
  // …and the toolbar's method chip and select both reflect the chosen method.
  await expect(page.locator('[data-testid="grpc-method-chip"]')).toContainText(
    'demo.Items/ListItems',
  );
});

test('gRPC request — a unary call renders its status, message and metadata', async ({
  relaunch,
}) => {
  const RESULT = {
    code: 0,
    codeName: 'OK',
    statusMessage: '',
    elapsedMs: 12,
    header: [{ name: 'content-type', value: 'application/grpc' }],
    trailer: [{ name: 'grpc-status', value: '0' }],
    messageCount: 1,
    messageBytes: 26,
    messages: [{ seq: 0, json: '{"message":"Hello, Ada!"}', wireBytes: 26, offsetMs: 0 }],
  };
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.tabsList,
      response: [
        grpcTab({
          target: 'demo.example.com:443',
          service: 'demo.Echo',
          method: 'SayHello',
          message: '{"name":"Ada"}',
        }),
      ],
    },
    { channel: IPC.grpcDescribe, response: UNARY_SCHEMA },
    { channel: IPC.grpcCall, response: RESULT },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await expect(modeTab(page, 'api')).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="grpc-request-view"]')).toBeVisible();

  await page.click('[data-testid="grpc-call"]');

  const chip = page.locator('[data-testid="grpc-status-chip"]');
  await expect(chip).toContainText('OK (0)');
  await expect(chip).toHaveClass(/ok/);

  // A unary call's single message is auto-expanded (D14).
  await expect(page.locator('[data-testid="grpc-message-entry"]')).toHaveCount(1);
  const messageBody = page.locator('[data-testid="grpc-message-entry"] .cm-content');
  expect(await messageBody.innerText()).toContain('Hello, Ada!');

  // Both header and trailer groups render (F6).
  await page.click('[data-testid="grpc-response-pane-metadata"]');
  const metadata = page.locator('[data-testid="grpc-response-metadata"]');
  await expect(metadata).toContainText('content-type');
  await expect(metadata).toContainText('application/grpc');
  await expect(metadata).toContainText('grpc-status');
});

test('gRPC request — a non-OK status is a result, not an error', async ({ relaunch }) => {
  const RESULT = {
    code: 7,
    codeName: 'PermissionDenied',
    statusMessage: 'missing bearer token',
    elapsedMs: 3,
    header: [],
    trailer: [],
    messageCount: 0,
    messageBytes: 0,
  };
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.tabsList,
      response: [
        grpcTab({
          target: 'demo.example.com:443',
          service: 'demo.Echo',
          method: 'SayHello',
          message: '{}',
        }),
      ],
    },
    { channel: IPC.grpcDescribe, response: UNARY_SCHEMA },
    { channel: IPC.grpcCall, response: RESULT },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await expect(page.locator('[data-testid="grpc-request-view"]')).toBeVisible();
  await page.click('[data-testid="grpc-call"]');

  const chip = page.locator('[data-testid="grpc-status-chip"]');
  await expect(chip).toContainText('PermissionDenied (7)');
  await expect(chip).toHaveClass(/err/);
  // D16's central claim: a non-OK status never renders as a MessageStrip error.
  await expect(page.locator('[data-testid="grpc-call-error"]')).toHaveCount(0);
});

/** F20: holds the `GrpcService.Call` bound call open forever, exactly the way the real backend's
 *  own `runServerStream` blocks for the life of the stream (D8) — every UI update for a streaming
 *  test comes from `emitWailsEvent`'s own push channel instead, never from this promise settling.
 *  Registered after `relaunch()` so it is the most-recently-added `page.route` handler for
 *  `/wails/runtime` and therefore wins (Playwright evaluates routes in reverse registration order);
 *  every other bound call falls back to `installControlMocks`'s own handler untouched. */
async function holdGrpcCallPending(page: Page): Promise<() => string | undefined> {
  let opId: string | undefined;
  await page.route('**/wails/runtime', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }
    const body = JSON.parse(request.postData() ?? '{}') as {
      args?: { methodName?: string; args?: [{ opId?: string }] };
    };
    if (body.args?.methodName === CHANNEL_TO_FQN[IPC.grpcCall]) {
      opId = body.args.args?.[0]?.opId;
      return;
    }
    await route.fallback();
  });
  return () => opId;
}

test('gRPC request — a server-streaming call appends messages as they arrive', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.tabsList,
      response: [
        grpcTab({
          target: 'demo.example.com:443',
          service: 'demo.Items',
          method: 'ListItems',
          message: '{"pageSize":10}',
        }),
      ],
    },
    { channel: IPC.grpcDescribe, response: STREAM_SCHEMA },
  ];
  const { window: page } = await relaunch({ control: CONTROL });
  const getOpId = await holdGrpcCallPending(page);

  await expect(page.locator('[data-testid="grpc-request-view"]')).toBeVisible();
  await page.click('[data-testid="grpc-call"]');
  await expect.poll(getOpId).toBeTruthy();
  const callId = getOpId() as string;

  await emitWailsEvent(page, IPC.grpcCall, {
    callId,
    seq: 0,
    messages: [
      { seq: 0, json: '{"item":"a"}', wireBytes: 14, offsetMs: 4 },
      { seq: 1, json: '{"item":"b"}', wireBytes: 14, offsetMs: 11 },
    ],
    done: false,
  });
  await expect(page.locator('[data-testid="grpc-message-entry"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="grpc-message-offset"]').first()).toHaveText('+4 ms');

  await emitWailsEvent(page, IPC.grpcCall, {
    callId,
    seq: 2,
    messages: [{ seq: 2, json: '{"item":"c"}', wireBytes: 14, offsetMs: 19 }],
    done: false,
  });
  await expect(page.locator('[data-testid="grpc-message-entry"]')).toHaveCount(3);
  // Still running — Stop stays enabled until the terminal event.
  await expect(page.locator('[data-testid="grpc-request-stop"]')).toBeEnabled();

  await emitWailsEvent(page, IPC.grpcCall, {
    callId,
    seq: 3,
    messages: [],
    done: true,
    status: {
      code: 0,
      codeName: 'OK',
      statusMessage: '',
      elapsedMs: 25,
      header: [],
      trailer: [],
      messageCount: 3,
      messageBytes: 42,
    },
  });

  await expect(page.locator('[data-testid="grpc-message-entry"]')).toHaveCount(3);
  await expect(page.locator('[data-testid="grpc-status-chip"]')).toContainText('OK (0)');
  await expect(page.locator('[data-testid="grpc-request-stop"]')).toBeDisabled();
});

// Finding 11: the live message list used to grow without bound and re-`reduce` its whole array
// on every single push. Sends one batch well past the 10,000-message live-view ceiling
// (state.ts's MAX_LIVE_MESSAGES) in a single event — real messages arrive one at a time, but a
// live server sending 10,000+ individual push events in a test would only slow the suite down,
// never exercise a code path this batch doesn't already cover identically.
test('gRPC request — the live message list caps at 10,000 and shows the true total', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.tabsList,
      response: [
        grpcTab({
          target: 'demo.example.com:443',
          service: 'demo.Items',
          method: 'ListItems',
          message: '{"pageSize":10}',
        }),
      ],
    },
    { channel: IPC.grpcDescribe, response: STREAM_SCHEMA },
  ];
  const { window: page } = await relaunch({ control: CONTROL });
  const getOpId = await holdGrpcCallPending(page);

  await expect(page.locator('[data-testid="grpc-request-view"]')).toBeVisible();
  await page.click('[data-testid="grpc-call"]');
  await expect.poll(getOpId).toBeTruthy();
  const callId = getOpId() as string;

  const total = 10_037;
  const batch = Array.from({ length: total }, (_, i) => ({
    seq: i,
    json: `{"i":${i}}`,
    wireBytes: 10,
    offsetMs: i,
  }));
  await emitWailsEvent(page, IPC.grpcCall, { callId, seq: 0, messages: batch, done: false });

  await expect(page.locator('[data-testid="grpc-live-messages-elided"]')).toHaveText(
    `Showing the most recent 10000 of ${total} messages.`,
  );
  // The oldest 37 messages were dropped, not the newest — the ones a live user is watching arrive.
  await expect(page.locator('[data-testid="grpc-message-offset"]').first()).toHaveText('+37 ms');

  await emitWailsEvent(page, IPC.grpcCall, {
    callId,
    seq: total,
    messages: [],
    done: true,
    status: {
      code: 0,
      codeName: 'OK',
      statusMessage: '',
      elapsedMs: total,
      header: [],
      trailer: [],
      messageCount: total,
      messageBytes: total * 10,
    },
  });

  // The true total (10,037 × 10 bytes = 100,370) is what the byte summary shows too — it is kept
  // as a running total (state.ts's rt.messageBytes), not re-derived from the now-capped array.
  await expect(page.locator('[data-testid="grpc-message-summary"]')).toContainText(
    '10000 messages',
  );
  await expect(page.locator('[data-testid="grpc-message-summary"]')).toContainText('98.0 KB');
  await expect(page.locator('[data-testid="grpc-live-messages-elided"]')).toHaveText(
    `Showing the most recent 10000 of ${total} messages.`,
  );
});

test('gRPC request — Stop cancels an in-flight stream and keeps what arrived', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.tabsList,
      response: [
        grpcTab({
          target: 'demo.example.com:443',
          service: 'demo.Items',
          method: 'ListItems',
          message: '{"pageSize":10}',
        }),
      ],
    },
    { channel: IPC.grpcDescribe, response: STREAM_SCHEMA },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });
  const getOpId = await holdGrpcCallPending(page);

  await expect(page.locator('[data-testid="grpc-request-view"]')).toBeVisible();
  await page.click('[data-testid="grpc-call"]');
  await expect.poll(getOpId).toBeTruthy();
  const callId = getOpId() as string;

  await emitWailsEvent(page, IPC.grpcCall, {
    callId,
    seq: 0,
    messages: [
      { seq: 0, json: '{"item":"a"}', wireBytes: 14, offsetMs: 4 },
      { seq: 1, json: '{"item":"b"}', wireBytes: 14, offsetMs: 11 },
    ],
    done: false,
  });
  await expect(page.locator('[data-testid="grpc-message-entry"]')).toHaveCount(2);

  await page.click('[data-testid="grpc-request-stop"]');
  // opsCancel is a void wildcard default (mockRuntime.ts's WILDCARD_DEFAULTS) — consumed, not
  // seeded, exactly as §6.4's own wording says.
  await expect.poll(() => control.log().some((e) => e.channel === IPC.opsCancel)).toBe(true);

  await emitWailsEvent(page, IPC.grpcCall, {
    callId,
    seq: 2,
    messages: [],
    done: true,
    error: { code: 'E_GRPC_CANCELLED', message: 'the call was stopped' },
    status: {
      code: 1,
      codeName: 'Canceled',
      statusMessage: 'context canceled',
      elapsedMs: 9,
      header: [],
      trailer: [],
      messageCount: 2,
      messageBytes: 28,
    },
  });

  // D17: the messages already delivered are kept, and the sentence names the true partial count.
  await expect(page.locator('[data-testid="grpc-message-entry"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="grpc-stopped-strip"]')).toHaveText(
    'Stopped after 2 messages.',
  );
  await expect(page.locator('[data-testid="grpc-request-stop"]')).toBeDisabled();
});

test('gRPC request — a request in a collection opens the grpc-request tab kind, not http-request', async ({
  relaunch,
}) => {
  const NOW = '2026-01-01T00:00:00.000Z';
  const TREE_EMPTY = {
    collections: [{ id: 'col-1', name: 'Demo API', sortOrder: 0, createdAt: NOW, updatedAt: NOW }],
    items: [] as unknown[],
  };
  const CREATED_ITEM = {
    id: 'item-grpc-1',
    collectionId: 'col-1',
    parentId: null,
    kind: 'request',
    protocol: 'grpc',
    name: 'New gRPC request',
    sortOrder: 0,
    method: '',
    url: '',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const TREE_WITH_ITEM = { collections: TREE_EMPTY.collections, items: [CREATED_ITEM] };
  const RENAMED_ITEM = { ...CREATED_ITEM, name: 'List items' };
  const TREE_RENAMED = { collections: TREE_EMPTY.collections, items: [RENAMED_ITEM] };
  const SAVED_REQUEST = {
    target: 'demo.example.com:443',
    tlsMode: 'tls',
    caFile: '',
    serverName: '',
    descriptorMode: 'reflection',
    protoPath: '',
    importPaths: [],
    service: 'demo.Items',
    method: 'ListItems',
    message: '{"pageSize":10}',
    metadata: [],
  };

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: TREE_EMPTY },
    { channel: IPC.collectionsCreateGrpcItem, response: CREATED_ITEM },
    { channel: IPC.collectionsList, response: TREE_WITH_ITEM },
    { channel: IPC.collectionsRename, response: undefined },
    { channel: IPC.collectionsList, response: TREE_RENAMED },
    { channel: IPC.collectionsGetGrpcRequest, response: SAVED_REQUEST },
    // Opening the tab sets a non-empty target, which fires GrpcRequestView's own reflection
    // watch (D4) — seeded so the Schema pane behind the toolbar's method chip has something real
    // to have resolved, though this test asserts only the chip and the tab kind.
    { channel: IPC.grpcDescribe, response: STREAM_SCHEMA },
  ];
  const { window: page } = await relaunch({ control: CONTROL });
  await modeTab(page, 'api').click();

  // *New gRPC request* from the tree's own context menu (D12's sibling of *New request*) creates
  // the row directly — D13's inline rename is this tree's own "name it and it's saved" step, in
  // place of a Save-as dialog it does not need for a row that already exists.
  await row(page, 'col-1').click({ button: 'right' });
  await page.click('[data-testid="menu-item-new-grpc-request"]');

  const created = row(page, 'item-grpc-1');
  await expect(created).toBeVisible();
  // D12's own chip: `grpcMethodClass` gives every gRPC row the one neutral class (no per-row
  // streaming distinction — that lives in the method's own descriptor, unreachable from a
  // collection row without a live call), so this is the row's one identifying mark.
  await expect(created.locator('[data-testid="grpc-collection-chip"]')).toHaveText('gRPC');

  await page.locator('[data-testid="collection-rename-input"]').fill('List items');
  await page.keyboard.press('Enter');
  await expect(row(page, 'item-grpc-1')).toContainText('List items');

  await row(page, 'item-grpc-1').dblclick();
  await expect(page.locator('[data-testid="grpc-request-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="http-request-view"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="grpc-method-chip"]')).toContainText(
    'demo.Items/ListItems',
  );
});

// P13 D15: the Beautify affordance the already-registered view.format command implied but had
// no button for — identical behaviour to RequestBodyPane.vue's own http-body-beautify.
test('gRPC request — Beautify formats the request message', async ({ relaunch }) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.tabsList, response: [grpcTab({ message: '{"a":1,"b":"two"}' })] },
  ];
  const { window: page } = await relaunch({ control: CONTROL });
  await expect(page.locator('[data-testid="grpc-request-view"]')).toBeVisible();

  await page.click('[data-testid="grpc-beautify"]');
  const BEAUTIFIED = '{\n  "a": 1,\n  "b": "two"\n}';
  const editor = page.locator('[data-testid="grpc-message-editor"] .cm-content');
  expect(await editor.innerText()).toBe(BEAUTIFIED);
});

// P13 D12: clearGrpcHistory has been implemented and bound since P11/P12, reachable from
// nowhere until CallHistoryList.vue's own toolbar. F20's structural guard (the delete control is
// no longer a <button> nested inside a <button>) lives in api-ui-consistency.spec.ts; this test
// drives the Clear behaviour end to end.
test('gRPC request — the history pane gets a real Clear action', async ({ relaunch }) => {
  const ENTRY = {
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
  const scope = { itemId: '', tabId: 'tab-grpc-1' };
  const CONTROL: ControlSnapshot[] = [
    // service/method set and a live call answered so the response section (and its History pane)
    // stays mounted once the history list empties out — the same `hasResult || hasHistory` gate
    // response-pane.vue's HTTP twin has.
    {
      channel: IPC.tabsList,
      response: [grpcTab({ service: 'demo.Echo', method: 'SayHello' })],
    },
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
    { channel: IPC.grpcHistoryList, args: scope, response: [ENTRY] },
    { channel: IPC.grpcHistoryClear, args: scope, response: undefined },
    { channel: IPC.grpcHistoryList, args: scope, response: [] },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await page.click('[data-testid="grpc-call"]');
  await expect(page.locator('[data-testid="grpc-status-chip"]')).toContainText('OK (0)');

  await page.click('[data-testid="grpc-response-pane-history"]');
  const clearBtn = page.locator('[data-testid="grpc-history-clear"]');
  await expect(clearBtn).toBeEnabled();
  await expect(page.locator('[data-testid="grpc-history-row"]')).toHaveCount(1);

  await clearBtn.click();
  await expect(page.locator('[data-testid="confirm-dialog-message"]')).toHaveText(
    'Clear this request’s call history? This cannot be undone.',
  );
  await acceptConfirm(page);

  await expect(page.locator('[data-testid="grpc-history-row"]')).toHaveCount(0);
  await expect(clearBtn).toBeDisabled();

  expect(control.log().filter((e) => e.channel === IPC.grpcHistoryClear)).toHaveLength(1);
});

// Finding 8: a server-streaming call's history entry used to always store zero messages (call.go's
// ServerStream never populated CallResult.Messages), so grpc-history.ts's own messagesElided field
// never carried real data. Viewing a stored streaming entry whose call produced more than the
// 100-message cap must now show the "first N of M" note the domain type's own comment always
// described but nothing rendered.
test('gRPC request — a stored streaming history entry with elided messages shows a note', async ({
  relaunch,
}) => {
  const ENTRY = {
    id: 'call-elided-1',
    itemId: null,
    tabId: 'tab-grpc-1',
    calledAt: '2026-01-01T00:00:00.000Z',
    target: 'demo.example.com:443',
    method: 'demo.Echo/ServerStream',
    streaming: 'server',
    environment: '',
    code: 0,
    codeName: 'OK',
    statusMessage: '',
    elapsedMs: 500,
    messageCount: 137,
    messageBytes: 13700,
    storedBytes: 13700,
  };
  const SNAPSHOT = {
    entry: ENTRY,
    target: 'demo.example.com:443',
    method: 'demo.Echo/ServerStream',
    streaming: 'server',
    message: '{}',
    metadata: [],
    messages: Array.from({ length: 100 }, (_, i) => ({
      seq: i,
      json: '{}',
      wireBytes: 100,
      offsetMs: i,
      truncated: false,
    })),
    messagesElided: true,
    header: [],
    trailer: [],
  };
  const scope = { itemId: '', tabId: 'tab-grpc-1' };
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.tabsList,
      response: [grpcTab({ service: 'demo.Echo', method: 'ServerStream' })],
    },
    { channel: IPC.grpcHistoryList, args: scope, response: [ENTRY] },
    { channel: IPC.grpcHistoryGet, args: { id: 'call-elided-1' }, response: SNAPSHOT },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.click('[data-testid="grpc-response-pane-history"]');
  await page.click('[data-testid="grpc-history-row"]');

  await expect(page.locator('[data-testid="grpc-history-band"]')).toBeVisible();
  await expect(page.locator('[data-testid="grpc-history-messages-elided"]')).toHaveText(
    'Showing the first 100 of 137 messages.',
  );
  await page.click('[data-testid="grpc-response-pane-messages"]');
  // The message list is virtualized (finding 11) — only the visible window actually renders, so
  // the 100-message data length is asserted through the status row's own summary rather than a
  // DOM node count.
  await expect(page.locator('[data-testid="grpc-message-summary"]')).toContainText('100 messages');
});
