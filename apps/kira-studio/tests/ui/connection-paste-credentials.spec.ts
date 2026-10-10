import type { Page } from '@playwright/test';
import {
  type ConnectionKind,
  type ConnectionSummary,
  connectionStateSchema,
} from '@shared/domain/connection';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import { connectionRow } from './support/tree';

// P248: paste credentials into the connection dialog, and "Update credentials…" on a saved
// connection. The pasted password must never reach the console.

const PASSWORD = 'Zx9!pw;Qq7'; // distinctive; contains `;` to exercise label-based value bounds

const BASE: Omit<ConnectionSummary, 'id' | 'name' | 'kind' | 'mode' | 'sortOrder'> = {
  color: 'blue',
  readOnly: false,
  host: '127.0.0.1',
  port: 5432,
  database: 'testdb',
  username: 'testuser',
  uri: null,
  options: {},
  preconnect: null,
  preconnectSidecar: false,
  autoExplain: false,
  throttlePerSec: 0,
  mcpEnabled: false,
  mcpDescription: '',
  mcpReadMode: 'allow',
  mcpWriteMode: 'prompt',
  mcpDdlMode: 'deny',
  mcpAutoExplain: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function conn(
  id: string,
  name: string,
  kind: ConnectionKind,
  mode: 'fields' | 'uri',
  sortOrder: number,
): ConnectionSummary {
  return { ...BASE, id, name, kind, mode, sortOrder };
}

const PG = conn('c-pg', 'Fields PG', 'postgres', 'fields', 0);
const PG_URI = conn('c-uri', 'Uri PG', 'postgres', 'uri', 1);
const LITE = conn('c-lite', 'File DB', 'sqlite', 'fields', 2);
const SQS = conn('c-sqs', 'Queue', 'sqs', 'fields', 3);

const CREDENTIAL_CALLS: readonly string[] = [
  IPC.connectionsUpdate,
  IPC.connectionsDisconnect,
  IPC.connectionsConnect,
];

function consoleLog(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (m) => seen.push(m.text()));
  page.on('pageerror', (e) => seen.push(String(e)));
  return seen;
}

function recordArgs(connection: ConnectionSummary): Record<string, unknown> {
  const { id: _id, sortOrder: _s, createdAt: _c, updatedAt: _u, ...fields } = connection;
  return fields;
}

async function paste(page: Page, text: string): Promise<void> {
  await page.fill('[data-testid="paste-credentials-input"]', text);
}

async function openPastePopover(page: Page): Promise<void> {
  await page.click('[data-testid="connection-paste-credentials"]');
  await expect(page.locator('[data-testid="paste-credentials-panel"]')).toBeVisible();
}

const CREATE_TEXT = [
  'PGHOST=db.example.com',
  'PGPORT=5433',
  `user: alice  pass: ${PASSWORD}`,
  'login: bob',
  'service=svc',
].join('\n');

test('create: review shows masked password, guessed badge and a picker; Apply fills, Save sends', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.connectionsList, response: [] },
      { channel: IPC.connectionsCreate, response: PG },
    ],
  });
  const logged = consoleLog(page);

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Pasted');
  await openPastePopover(page);
  await paste(page, CREATE_TEXT);

  const passwordRow = page.locator('[data-testid="paste-credentials-row-password"]');
  await expect(passwordRow).toBeVisible();
  await expect(passwordRow).not.toContainText(PASSWORD);
  await page.click('[data-testid="paste-credentials-toggle-password"]');
  await expect(passwordRow).toContainText(PASSWORD);
  await expect(page.locator('[data-testid="paste-credentials-row-database"]')).toContainText(
    'guessed',
  );

  const pick = page.locator('[data-testid="paste-credentials-pick-username"]');
  await expect(pick).toBeVisible();
  await pick.selectOption({ index: 1 });

  await page.click('[data-testid="paste-credentials-apply"]');
  await expect(page.locator('[data-testid="paste-credentials-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="connection-host"]')).toHaveValue('db.example.com');
  await expect(page.locator('[data-testid="connection-port"]')).toHaveValue('5433');
  await expect(page.locator('[data-testid="connection-database"]')).toHaveValue('svc');
  await expect(page.locator('[data-testid="connection-username"]')).toHaveValue('bob');

  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
  const create = control.log().find((e) => e.channel === IPC.connectionsCreate);
  expect(create?.args).toMatchObject({
    host: 'db.example.com',
    port: 5433,
    database: 'svc',
    username: 'bob',
    password: PASSWORD,
  });
  expect(logged.join('\n')).not.toContain(PASSWORD);
});

test('cancel leaves the draft untouched and the textarea empty on reopen', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  const logged = consoleLog(page);

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  const host = page.locator('[data-testid="connection-host"]');
  const hostBefore = await host.inputValue();
  await openPastePopover(page);
  await paste(page, CREATE_TEXT);
  await expect(page.locator('[data-testid="paste-credentials-row-password"]')).toBeVisible();
  await page.click('[data-testid="paste-credentials-cancel"]');

  await expect(page.locator('[data-testid="paste-credentials-panel"]')).toHaveCount(0);
  await expect(host).toHaveValue(hostBefore);
  await expect(page.locator('[data-testid="connection-password"]')).toHaveValue('');

  await openPastePopover(page);
  await expect(page.locator('[data-testid="paste-credentials-input"]')).toHaveValue('');
  await expect(page.locator('[data-testid="paste-credentials-row-password"]')).toHaveCount(0);
  expect(logged.join('\n')).not.toContain(PASSWORD);
});

test('edit: pasted password is sent on Save', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.connectionsList, response: [PG] },
      { channel: IPC.connectionsUpdate, response: PG },
    ],
  });
  const logged = consoleLog(page);

  await connectionRow(page, PG.name).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await openPastePopover(page);
  await paste(page, `PGPASSWORD="${PASSWORD}"`);
  await page.click('[data-testid="paste-credentials-apply"]');
  await expect(page.locator('[data-testid="connection-password"]')).toHaveValue(PASSWORD);

  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
  const update = control.log().find((e) => e.channel === IPC.connectionsUpdate);
  expect(update?.args).toEqual({
    id: PG.id,
    input: { ...recordArgs(PG), password: PASSWORD },
  });
  expect(logged.join('\n')).not.toContain(PASSWORD);
});

test('tree menu offers Update credentials only for fields-mode network connections', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [PG, PG_URI, LITE, SQS] }],
  });

  const item = page.locator('[data-testid="menu-item-update-credentials"]');
  const expected: [ConnectionSummary, number][] = [
    [PG, 1],
    [PG_URI, 0],
    [LITE, 0],
    [SQS, 0],
  ];
  for (const [c, count] of expected) {
    await connectionRow(page, c.name).click({ button: 'right' });
    await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
    await expect(item).toHaveCount(count);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
  }
});

test('Update credentials writes only user and password; a username change leaves the reconnect to the backend', async ({
  relaunch,
}) => {
  const state = {
    connectionId: PG.id,
    status: 'connected',
    serverVersion: '16.0',
    error: null,
    since: 1735689600000,
    caps: null,
  };
  const control: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [PG] },
    { channel: IPC.connectionsStates, response: [state] },
    { channel: IPC.connectionsUpdate, response: PG },
    { channel: IPC.connectionsDisconnect, response: { ...state, status: 'disconnected' } },
    { channel: IPC.connectionsConnect, response: state },
  ];
  const { window: page, control: handle } = await relaunch({ control });
  const logged = consoleLog(page);

  await connectionRow(page, PG.name).click({ button: 'right' });
  await page.click('[data-testid="menu-item-update-credentials"]');
  await expect(page.locator('[data-testid="credentials-update-dialog"]')).toBeVisible();
  await expect(page.locator('[data-testid="credentials-update-live-note"]')).toBeVisible();

  // Host, port and database are recognised but outside this dialog's scope.
  await paste(page, `PGHOST=elsewhere\nPGUSER=rotated\nPGPASSWORD=${PASSWORD}`);
  await expect(page.locator('[data-testid="paste-credentials-also-found"]')).toContainText('host');
  await page.click('[data-testid="paste-credentials-apply"]');
  await expect(page.locator('[data-testid="credentials-update-dialog"]')).toHaveCount(0);

  const calls = handle.log().filter((e) => CREDENTIAL_CALLS.includes(e.channel));
  expect(calls.map((e) => e.channel)).toEqual([IPC.connectionsUpdate]);
  expect(calls[0]?.args).toEqual({
    id: PG.id,
    input: { ...recordArgs(PG), username: 'rotated', password: PASSWORD },
  });
  expect(logged.join('\n')).not.toContain(PASSWORD);
});

test('Update credentials with a password only reconnects a live connection', async ({
  relaunch,
}) => {
  // Backend half: dbflow TestPostgresUpdateCredentials (complete suite).
  const state = {
    ...contract('paste-credentials', 'ConnectionsService.Connect#connected', {
      schema: connectionStateSchema.omit({ caps: true }),
    }),
    connectionId: PG.id,
    caps: null,
  };
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.connectionsList, response: [PG] },
      { channel: IPC.connectionsStates, response: [state] },
      { channel: IPC.connectionsUpdate, response: PG },
      { channel: IPC.connectionsDisconnect, response: { ...state, status: 'disconnected' } },
      { channel: IPC.connectionsConnect, response: state },
    ],
  });

  await connectionRow(page, PG.name).click({ button: 'right' });
  await page.click('[data-testid="menu-item-update-credentials"]');
  await paste(page, `password: ${PASSWORD}`);
  await page.click('[data-testid="paste-credentials-apply"]');
  await expect(page.locator('[data-testid="credentials-update-dialog"]')).toHaveCount(0);

  await expect
    .poll(() =>
      control
        .log()
        .map((e) => e.channel)
        .filter((c) => CREDENTIAL_CALLS.includes(c)),
    )
    .toEqual([IPC.connectionsUpdate, IPC.connectionsDisconnect, IPC.connectionsConnect]);
  const update = control.log().find((e) => e.channel === IPC.connectionsUpdate);
  expect(update?.args).toEqual({
    id: PG.id,
    input: { ...recordArgs(PG), password: PASSWORD },
  });
});
