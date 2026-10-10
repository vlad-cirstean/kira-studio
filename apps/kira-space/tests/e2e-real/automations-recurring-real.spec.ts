import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// P242 Part 4: a recurring script against the real backend and the real clock: the confirm popup
// appears when the minute turns, Run starts it headless, and Run now starts one at once.

async function addRecurring(page: Page, name: string, command: string, quiet: boolean) {
  await page.locator('[data-testid="mode-tab"][data-mode="automations"]').click();
  await page.locator('[data-testid="automations-add"]').click();
  await page.locator('[data-testid="menu-item-new-recurring"]').hover();
  await page.locator('[data-testid="menu-item-new-recurring-script"]').click();
  const dialog = page.locator('[data-testid="script-dialog"]');
  await dialog.locator('[data-testid="script-dialog-name"]').fill(name);
  await dialog.locator('[data-testid="script-dialog-command"]').fill(command);
  await dialog.locator('[data-testid="schedule-cron"]').fill('* * * * *');
  await expect(dialog.locator('[data-testid="schedule-next"]')).toContainText('Next:');
  if (quiet) await dialog.locator('[data-testid="schedule-quiet"]').click();
  await dialog.locator('[data-testid="script-dialog-save"]').click();
  await expect(dialog).toHaveCount(0);
}

test('a due recurring script asks, then runs headless and ends Succeeded', async ({ kira }) => {
  test.setTimeout(150_000);
  const page = kira.window;
  // The popup shows in the main window only: open this page as that window.
  const main = await kira.call<string>('ScriptRunsService', 'MainWindow');
  await page.goto(`${kira.baseURL}/?window=${main}`);
  await page.waitForSelector('[data-testid="status-bar"]');
  await addRecurring(page, 'Scheduled echo', 'echo scheduled-ok', false);
  const popup = page.locator('[data-testid="schedule-confirm"]');
  await expect(popup).toBeVisible({ timeout: 75_000 });
  await expect(popup).toContainText('Run Scheduled echo?');
  await expect(popup.locator('[data-testid="run-command"]')).toContainText('echo scheduled-ok');
  await popup.locator('[data-testid="schedule-confirm-run"]').click();
  const view = page.locator('[data-testid="script-run-view"]');
  await expect(view.locator('[data-testid="run-status"]')).toHaveText('Succeeded', {
    timeout: 30_000,
  });
  await expect(view.locator('[data-testid="run-log"]')).toContainText('scheduled-ok');
});

test('Run now on a script that runs without asking starts it at once', async ({ kira }) => {
  const page = kira.window;
  await addRecurring(page, 'Quiet echo', 'echo now-ok', true);
  await page
    .locator('button[data-testid^="script-"]')
    .filter({ hasText: 'Quiet echo' })
    .first()
    .click({ button: 'right' });
  await page.locator('[data-testid="menu-item-run-now"]').click();
  const popup = page.locator('[data-testid="schedule-confirm"]');
  await expect(popup).toBeVisible();
  await popup.locator('[data-testid="schedule-confirm-run"]').click();
  const view = page.locator('[data-testid="script-run-view"]');
  await expect(view.locator('[data-testid="run-status"]')).toHaveText('Succeeded', {
    timeout: 30_000,
  });
  await expect(view.locator('[data-testid="run-log"]')).toContainText('now-ok');
});
