import type { ConnectionSummary } from '@shared/domain/connection';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P28 §7's new spec: the connection dialog's step-2 tabs (General/Advanced/Pre-connect) and the
// throttle field the Advanced tab gained.

function connectionRow(page: import('@playwright/test').Page, name: string) {
  return page.locator('[data-testid="tree-row"][data-kind="connection"]').filter({ hasText: name });
}

async function openNewPostgresDialog(page: import('@playwright/test').Page): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-kind-postgres"]');
}

async function fillGeneralFields(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await page.fill('[data-testid="connection-name"]', name);
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'testdb');
  await page.fill('[data-testid="connection-username"]', 'testuser');
}

test('all three tabs switch, and General is where a freshly-opened details step lands', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  await openNewPostgresDialog(page);

  const generalTab = page.locator('[data-testid="connection-tab-general"]');
  const advancedTab = page.locator('[data-testid="connection-tab-advanced"]');
  const preconnectTab = page.locator('[data-testid="connection-tab-preconnect"]');

  await expect(generalTab).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="connection-name"]')).toBeVisible();
  await expect(page.locator('[data-testid="connection-readonly"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="connection-preconnect"]')).toHaveCount(0);

  await advancedTab.click();
  await expect(advancedTab).toHaveClass(/is-active/);
  await expect(generalTab).not.toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="connection-readonly"]')).toBeVisible();
  await expect(page.locator('[data-testid="connection-name"]')).toHaveCount(0);

  await preconnectTab.click();
  await expect(preconnectTab).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="connection-preconnect"]')).toBeVisible();
  await expect(page.locator('[data-testid="connection-readonly"]')).toHaveCount(0);

  await generalTab.click();
  await expect(generalTab).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="connection-name"]')).toBeVisible();

  // Reopening a fresh details step (Cancel, then reopen) lands back on General, not wherever the
  // previous session left off.
  await preconnectTab.click();
  await page.click('[data-testid="connection-cancel"]');
  await openNewPostgresDialog(page);
  await expect(page.locator('[data-testid="connection-tab-general"]')).toHaveClass(/is-active/);
});

test('the pre-connect textarea round-trips a multi-line value, and a valid throttle reaches connectionsCreate', async ({
  relaunch,
}) => {
  const MULTILINE = 'set -e\nexport FOO=bar\n./scripts/port-forward.sh';
  const CREATED: ConnectionSummary = {
    id: 'conn-tabs-1',
    name: 'Tabbed PG',
    kind: 'postgres',
    color: 'none',
    mode: 'fields',
    readOnly: false,
    host: '127.0.0.1',
    port: 5432,
    database: 'testdb',
    username: 'testuser',
    uri: null,
    options: {},
    preconnect: MULTILINE,
    preconnectSidecar: false,
    autoExplain: false,
    throttlePerSec: 5,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: {
        name: 'Tabbed PG',
        kind: 'postgres',
        color: 'none',
        mode: 'fields',
        readOnly: false,
        host: '127.0.0.1',
        port: 5432,
        database: 'testdb',
        username: 'testuser',
        password: null,
        uri: null,
        options: {},
        preconnect: MULTILINE,
        preconnectSidecar: false,
        autoExplain: false,
        throttlePerSec: 5,
      },
      response: CREATED,
    },
    { channel: IPC.connectionsList, response: [CREATED] },
    {
      channel: IPC.connectionsReveal,
      args: { id: CREATED.id },
      response: { password: null, error: null },
    },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await openNewPostgresDialog(page);
  await fillGeneralFields(page, 'Tabbed PG');

  await page.click('[data-testid="connection-tab-preconnect"]');
  await page.fill('[data-testid="connection-preconnect"]', MULTILINE);
  await expect(page.locator('[data-testid="connection-preconnect"]')).toHaveValue(MULTILINE);

  await page.click('[data-testid="connection-tab-advanced"]');
  await page.fill('[data-testid="connection-throttle"]', '5');

  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  // Reopen and confirm both fields round-tripped through the tabs correctly.
  await (await connectionRow(page, 'Tabbed PG')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await page.click('[data-testid="connection-tab-preconnect"]');
  await expect(page.locator('[data-testid="connection-preconnect"]')).toHaveValue(MULTILINE);
  await page.click('[data-testid="connection-tab-advanced"]');
  await expect(page.locator('[data-testid="connection-throttle"]')).toHaveValue('5');
});

test('an out-of-range throttle blocks Save and shows its own error', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  await openNewPostgresDialog(page);
  await fillGeneralFields(page, 'Throttled PG');

  await page.click('[data-testid="connection-tab-advanced"]');
  await expect(page.locator('[data-testid="connection-save"]')).toBeEnabled();

  await page.fill('[data-testid="connection-throttle"]', '5000'); // above CONNECTION_THROTTLE_RANGE.max
  await expect(page.locator('[data-testid="connection-save"]')).toBeDisabled();
  await expect(page.locator('[data-testid="connection-throttle-error"]')).toBeVisible();

  await page.fill('[data-testid="connection-throttle"]', '0'); // 0 (unlimited) is always valid
  await expect(page.locator('[data-testid="connection-save"]')).toBeEnabled();
  await expect(page.locator('[data-testid="connection-throttle-error"]')).toHaveCount(0);
});

// The Save button is disabled whenever connectionInputSchema itself rejects the draft (isValid
// uses the identical schema), so a genuinely invalid draft can never be clicked through by a real
// user — there is nothing to switch tabs *for* in that path. This test exercises the
// TAB_FOR_FIELD switch in onSave directly (a pre-connect value validation would otherwise reject
// it, per the schema's max(2000)) by removing the button's disabled attribute immediately before
// the click, the one way to reach that internal branch without relying on a state a real user
// could produce — the switch itself, once reached, is exactly what a real out-of-band failure
// (e.g. a field made invalid by something other than this schema) would also hit.
test('a save that fails validation on a Pre-connect-tab field switches to that tab', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  await openNewPostgresDialog(page);
  await fillGeneralFields(page, 'Overlong Preconnect');

  await page.click('[data-testid="connection-tab-preconnect"]');
  const tooLong = 'x'.repeat(2001);
  await page.locator('[data-testid="connection-preconnect"]').evaluate((el, value) => {
    const textarea = el as HTMLTextAreaElement;
    textarea.value = value; // bypasses the HTML maxlength, which only clamps interactive typing
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }, tooLong);

  await page.click('[data-testid="connection-tab-general"]');
  const saveButton = page.locator('[data-testid="connection-save"]');
  await expect(saveButton).toBeDisabled();
  await saveButton.evaluate((el) => el.removeAttribute('disabled'));
  await saveButton.click();

  await expect(page.locator('[data-testid="connection-tab-preconnect"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
});

// P19 D1/D2: one width (620) and one height (520) for the whole dialog, both steps and every
// tab/sub-tab/engine family included — see docs/v1.2/plans/P19-connection-dialog-mongo-console-sql-tooling.md.

async function dialogBox(page: import('@playwright/test').Page) {
  const box = await page.locator('[data-testid="connection-dialog"] .dialog').boundingBox();
  if (!box) throw new Error('connection dialog box not found');
  return box;
}

async function dialogBodyFits(page: import('@playwright/test').Page): Promise<boolean> {
  const { scrollHeight, clientHeight } = await page
    .locator('[data-testid="connection-dialog"] .dialog-body')
    .evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  return scrollHeight <= clientHeight;
}

test("the dialog's box never moves, across every step, tab, sub-tab and engine family", async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });

  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  const reference = await dialogBox(page);
  expect(await dialogBodyFits(page)).toBe(true);

  const assertUnchanged = async () => {
    expect(await dialogBox(page)).toEqual(reference);
    expect(await dialogBodyFits(page)).toBe(true);
  };

  // Step 1 -> step 2 (Postgres, a SQL kind with the min-version note and auto-explain).
  await page.click('[data-testid="connection-kind-postgres"]');
  await assertUnchanged();

  await page.click('[data-testid="connection-tab-advanced"]');
  await assertUnchanged();
  await page.click('[data-testid="connection-tab-preconnect"]');
  await assertUnchanged();
  await page.click('[data-testid="connection-tab-general"]');
  await assertUnchanged();

  // Fields <-> Connection URI, both directions.
  await page.click('[data-testid="mode-uri"]');
  await assertUnchanged();
  await page.click('[data-testid="mode-fields"]');
  await assertUnchanged();

  // Pre-connect: typing grows the pane by a warning line + a sidecar checkbox + its helper.
  await page.click('[data-testid="connection-tab-preconnect"]');
  await assertUnchanged();
  await page.fill('[data-testid="connection-preconnect"]', 'echo hello');
  await expect(page.locator('[data-testid="connection-preconnect-warning"]')).toBeVisible();
  await expect(page.locator('[data-testid="connection-preconnect-sidecar"]')).toBeVisible();
  await assertUnchanged();

  // Change engine -> a file-style kind (sqlite: no host/port/user/password).
  await page.click('[data-testid="connection-tab-general"]');
  await page.click('button:has-text("Change engine")');
  await assertUnchanged();
  await page.click('[data-testid="connection-kind-sqlite"]');
  await assertUnchanged();
  await page.click('[data-testid="connection-tab-advanced"]');
  await assertUnchanged(); // no auto-explain block for a non-SQL kind

  // Change engine -> an AWS-style kind (sqs: no min-version note, no database, no password).
  await page.click('[data-testid="connection-tab-general"]');
  await page.click('button:has-text("Change engine")');
  await assertUnchanged();
  await page.click('[data-testid="connection-kind-sqs"]');
  await assertUnchanged();
});

test('typing in the engine search filters the tile grid without moving the dialog box', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });

  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  const reference = await dialogBox(page);
  expect(await dialogBodyFits(page)).toBe(true);

  // Narrows the 10-tile/3-column grid from four rows to one.
  await page.fill('[data-testid="connection-engine-search"]', 'postgres');
  await expect(page.locator('[data-testid="connection-kind"] button')).toHaveCount(1);
  expect(await dialogBox(page)).toEqual(reference);
  expect(await dialogBodyFits(page)).toBe(true);

  await page.fill('[data-testid="connection-engine-search"]', '');
  await expect(page.locator('[data-testid="connection-kind"] button')).toHaveCount(10);
  expect(await dialogBox(page)).toEqual(reference);
});
