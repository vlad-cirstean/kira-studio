import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { postgresConnectionSummary } from './support/postgresFixture';

// P264: one key set for every list. The project tree is the Studio list bound through the shared
// useListNavigation today (Left/Right and expansion are covered in tree.spec.ts); rows here are
// disconnected connections so no tree IPC is needed.

const CONNS = [
  postgresConnectionSummary('conn-k1', 'Alpha DB', 'blue'),
  postgresConnectionSummary('conn-k2', 'Bravo DB', 'cyan'),
  postgresConnectionSummary('conn-k3', 'Charlie DB', 'green'),
];
const CONTROL: ControlSnapshot[] = [{ channel: IPC.connectionsList, response: CONNS }];

test('project tree — arrows, Home/End, right-click select, Shift+F10 and focus return', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });
  const rows = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(rows).toHaveCount(CONNS.length);
  const row = (i: number) => rows.filter({ hasText: CONNS[i].name });

  await row(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(1)).toBeFocused();
  await expect(row(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid="tree-row"][tabindex="0"]')).toHaveCount(1);

  await page.keyboard.press('End');
  await expect(row(2)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row(2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(row(0)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(row(0)).toBeFocused();

  // Right-click selects the row under the pointer, then the menu opens; Esc returns focus to it.
  await row(2).click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await expect(row(2)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
  await expect(row(2)).toBeFocused();

  await page.keyboard.press('ArrowUp');
  await expect(row(1)).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
  await expect(row(1)).toBeFocused();
});
