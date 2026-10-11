import type { ConnectionSummary } from '@shared/domain/connection';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { postgresConnectionSummary } from './support/postgresFixture';

// P264: a danger confirm opens on Cancel (Enter declines), a primary confirm opens on its confirm
// button (Enter accepts). No mutation snapshot is mocked for Delete: a stray call fails the mock.

const CONN: ConnectionSummary = postgresConnectionSummary('conn-focus', 'Focus DB', 'blue');
const CONTROL: ControlSnapshot[] = [{ channel: IPC.connectionsList, response: [CONN] }];

const dialog = '[data-testid="confirm-dialog"]';

test('danger confirm opens with Cancel focused; Enter declines', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({ control: CONTROL });
  const row = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: CONN.name });
  await row.click({ button: 'right' });
  await page.click('[data-testid="menu-item-delete"]');

  await expect(page.locator(dialog)).toBeVisible();
  await expect(page.locator('[data-testid="confirm-dialog-cancel"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator(dialog)).toHaveCount(0);
  await expect(row).toBeVisible();
  expect(control.log().filter((e) => e.channel === IPC.connectionsDelete)).toHaveLength(0);
});

test('primary confirm opens with the confirm button focused; Enter accepts', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      ...CONTROL,
      {
        channel: IPC.connectionsReveal,
        args: { id: CONN.id, confirmed: false },
        response: { password: null, error: null, outcome: 'confirmation-required' },
      },
      {
        channel: IPC.connectionsReveal,
        args: { id: CONN.id, confirmed: true },
        response: { password: 'hunter2', error: null, outcome: 'revealed' },
      },
    ],
  });
  await page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: CONN.name })
    .click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await page.click('[aria-label="Show password"]');

  await expect(page.locator(dialog)).toBeVisible();
  await expect(page.locator('[data-testid="confirm-dialog-confirm"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator(dialog)).toHaveCount(0);
  await expect(page.locator('[data-testid="connection-password"]')).toHaveValue('hunter2');
  expect(
    control
      .log()
      .filter(
        (e) =>
          e.channel === IPC.connectionsReveal &&
          (e.args as { confirmed?: boolean } | undefined)?.confirmed === true,
      ),
  ).toHaveLength(1);
});
