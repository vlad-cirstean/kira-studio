import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
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

function modeTab(page: Page, mode: 'studio' | 'http'): Locator {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

async function openHttpModeAndNewGrpcRequest(page: Page): Promise<void> {
  await modeTab(page, 'http').click();
  await expect(page.locator('[data-testid="http-start"]')).toBeVisible();
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

  await expect(modeTab(page, 'http')).toHaveClass(/is-active/);
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
  await modeTab(page, 'http').click();

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
