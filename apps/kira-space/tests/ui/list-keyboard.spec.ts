import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// P264: one key set for every list. The Operations dock is the Space list bound through the shared
// useListNavigation today; its rows are virtual, so Home/End also prove focus follows the scroll.

const NOW = '2026-01-01T00:00:00.000Z';

function opRecord(id: string): Record<string, unknown> {
  return {
    id,
    startedAt: NOW,
    durationMs: 12,
    kind: 'fetch',
    status: 'ok',
    command: `git fetch ${id}`,
    error: null,
    repoRoot: '/work/alpha',
    repoName: 'alpha',
    source: 'Kira Space',
    cancellable: false,
  };
}

const IDS = ['op-a', 'op-b', 'op-c'];
const CONTROL: ControlSnapshot[] = [{ channel: IPC.opsRecent, response: IDS.map(opRecord) }];

test('operations list — roving tab stop, arrows, Home/End, Enter, Shift+F10 and focus return', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });
  await page.click('[data-testid="toggle-operations-panel"]');
  const rows = page.locator('[data-testid="op-row"]');
  await expect(rows).toHaveCount(IDS.length);
  const ids = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-op-id') ?? ''));

  await expect(page.locator('[data-testid="op-row"][tabindex="0"]')).toHaveCount(1);
  const row = (i: number) => page.locator(`[data-testid="op-row"][data-op-id="${ids[i]}"]`);

  await row(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(1)).toBeFocused();
  await expect(row(1)).toHaveAttribute('tabindex', '0');
  await expect(row(0)).toHaveAttribute('tabindex', '-1');

  await page.keyboard.press('End');
  await expect(row(2)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row(2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(row(0)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(row(0)).toBeFocused();

  // Enter opens the row, same as a click: the command detail row appears.
  await page.keyboard.press('Enter');
  await expect(page.getByText(`command: git fetch ${ids[0]}`)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText(`command: git fetch ${ids[0]}`)).toHaveCount(0);

  await page.keyboard.press('Shift+F10');
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
  await expect(row(0)).toBeFocused();
});

test('operations list — keys typed in the filter field do not move the list', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });
  await page.click('[data-testid="toggle-operations-panel"]');
  const rows = page.locator('[data-testid="op-row"]');
  await expect(rows).toHaveCount(IDS.length);
  const filter = page.locator('[data-testid="ops-filter"]');
  await filter.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await expect(filter).toBeFocused();
});
