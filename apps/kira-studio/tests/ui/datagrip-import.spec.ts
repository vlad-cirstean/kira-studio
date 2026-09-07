import type { ConnectionSummary } from '@shared/domain/connection';
import type { DataGripPreview, DataGripReport } from '@shared/domain/datagrip';
import type { SecretStorageStatus } from '@shared/domain/secrets';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// §4.4.1: one importable Postgres source, one unsupported-engine Oracle source, one
// password-not-saved source, and one row that matches an already-existing connection
// (EXISTING below, by name+host+port+database).
const EXISTING: ConnectionSummary = {
  id: 'conn-existing',
  name: 'orders-db',
  kind: 'postgres',
  color: 'cyan',
  mode: 'fields',
  readOnly: false,
  host: 'db.example.internal',
  port: 5432,
  database: 'orders',
  username: 'app',
  uri: null,
  options: {},
  preconnect: null,
  preconnectSidecar: false,
  autoExplain: false,
  throttlePerSec: 0,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const PROJECT_DIR = '/Users/dev/orders-service';

const PREVIEW: DataGripPreview = {
  projectDir: PROJECT_DIR,
  rows: [
    {
      uuid: 'uuid-pg',
      name: 'pg-main',
      importable: true,
      kind: 'postgres',
      host: 'pg.example.internal',
      port: 5432,
      database: 'appdb',
      username: 'app',
      passwordOutlook: 'will-attempt',
      warnings: [],
    },
    {
      uuid: 'uuid-oracle',
      name: 'legacy-oracle',
      importable: false,
      skipReason: 'unsupported-engine',
      skipDetail: 'oracle',
      warnings: [],
    },
    {
      uuid: 'uuid-not-saved',
      name: 'ci-db',
      importable: true,
      kind: 'mysql',
      host: 'ci.example.internal',
      port: 3306,
      database: 'ci',
      username: 'ci',
      passwordOutlook: 'not-saved',
      warnings: [],
    },
    {
      uuid: 'uuid-dup',
      name: 'orders-db',
      importable: true,
      kind: 'postgres',
      host: 'db.example.internal',
      port: 5432,
      database: 'orders',
      username: 'app',
      passwordOutlook: 'will-attempt',
      warnings: [],
    },
  ],
};

const REPORT: DataGripReport = {
  rows: [
    { uuid: 'uuid-pg', name: 'pg-main', created: true, passwordImported: true },
    { uuid: 'uuid-not-saved', name: 'ci-db', created: true, passwordImported: false },
  ],
};

function baseControl(): ControlSnapshot[] {
  return [
    { channel: IPC.connectionsList, response: [EXISTING] },
    { channel: IPC.filesChooseFolder, response: { canceled: false, path: PROJECT_DIR } },
    { channel: IPC.datagripScan, response: PREVIEW },
  ];
}

test('datagrip import — the preview lists every row, greys the unsupported one, starts a probable duplicate unchecked, and confirm sends only the checked uuids', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    ...baseControl(),
    { channel: IPC.datagripImport, response: REPORT },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await page.click('[data-testid="import-datagrip"]');

  const dialog = page.locator('[data-testid="datagrip-import-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(
    page.locator('[data-testid="datagrip-preview-rows"] > div[data-testid^="datagrip-row-"]'),
  ).toHaveCount(4);

  // The unsupported-engine row is greyed, has no checkbox, and names the driver.
  const oracleRow = page.locator('[data-testid="datagrip-row-uuid-oracle"]');
  await expect(oracleRow).toHaveAttribute('data-importable', 'false');
  await expect(oracleRow.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(oracleRow.locator('[data-testid="datagrip-row-skip-reason"]')).toContainText(
    'oracle',
  );

  // The password-not-saved row is still importable and checked by default, with its outlook shown.
  const notSavedRow = page.locator('[data-testid="datagrip-row-uuid-not-saved"]');
  await expect(notSavedRow.locator('input[type="checkbox"]')).toBeChecked();
  await expect(notSavedRow.locator('[data-testid="datagrip-row-outlook"]')).toContainText(
    'did not save',
  );

  // The row matching an existing connection is badged and starts unchecked (D10).
  const dupRow = page.locator('[data-testid="datagrip-row-uuid-dup"]');
  await expect(dupRow.locator('[data-testid="datagrip-row-duplicate"]')).toBeVisible();
  await expect(dupRow.locator('input[type="checkbox"]')).not.toBeChecked();

  // Confirm's label counts only checked rows: pg-main + ci-db, not the dup or the oracle row.
  await expect(page.locator('[data-testid="datagrip-import-confirm"]')).toHaveText(
    'Import 2 connections',
  );

  await page.click('[data-testid="datagrip-import-confirm"]');

  const importCalls = control.log().filter((e) => e.channel === IPC.datagripImport);
  expect(importCalls).toHaveLength(1);
  const args = importCalls[0].args as { path: string; selectedUuids: string[] };
  expect(args.path).toBe(PROJECT_DIR);
  expect([...args.selectedUuids].sort()).toEqual(['uuid-not-saved', 'uuid-pg']);

  await expect(dialog).toHaveCount(0);
});

test('datagrip import — cancelling the dialog never calls Import', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({ control: baseControl() });

  await page.click('[data-testid="import-datagrip"]');
  await expect(page.locator('[data-testid="datagrip-import-dialog"]')).toBeVisible();

  await page.click('[data-testid="datagrip-import-cancel"]');
  await expect(page.locator('[data-testid="datagrip-import-dialog"]')).toHaveCount(0);
  expect(control.log().filter((e) => e.channel === IPC.datagripImport)).toHaveLength(0);
});

test('datagrip import — cancelling the folder picker never opens the dialog or calls Scan', async ({
  relaunch,
}) => {
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    { channel: IPC.filesChooseFolder, response: { canceled: true, path: null } },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await page.click('[data-testid="import-datagrip"]');
  await expect(page.locator('[data-testid="datagrip-import-dialog"]')).toHaveCount(0);
  expect(control.log().filter((e) => e.channel === IPC.datagripScan)).toHaveLength(0);
});

test('datagrip import — shows the secret-storage-unavailable banner and still lets rows import password-free', async ({
  relaunch,
}) => {
  const UNAVAILABLE: SecretStorageStatus = {
    available: false,
    backend: 'unavailable',
    insecureFallback: false,
    reason: 'No system keychain is available on Linux in this build.',
  };
  const CONTROL: ControlSnapshot[] = [
    ...baseControl(),
    { channel: IPC.connectionsSecretsStatus, response: UNAVAILABLE },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.click('[data-testid="import-datagrip"]');
  const banner = page.locator('[data-testid="datagrip-secrets-unavailable"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('No system keychain');

  // The rows underneath are unaffected — this dialog only ever shows what Scan itself found.
  await expect(
    page.locator('[data-testid="datagrip-preview-rows"] > div[data-testid^="datagrip-row-"]'),
  ).toHaveCount(4);
});
