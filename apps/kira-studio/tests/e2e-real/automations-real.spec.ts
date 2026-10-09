import { expect, test } from './fixtures';

// P242 Part 1: script runs against the real backend: the run store, the exit outcome, Stop and the
// per-script folder.

async function addScript(page: import('@playwright/test').Page, name: string, command: string) {
  await page.locator('[data-testid="mode-tab"][data-mode="automations"]').click();
  await page.locator('[data-testid="automations-add"]').click();
  await page.locator('[data-testid="menu-item-new-script"]').click();
  const dialog = page.locator('[data-testid="script-dialog"]');
  await dialog.locator('[data-testid="script-dialog-name"]').fill(name);
  await dialog.locator('[data-testid="script-dialog-command"]').fill(command);
  await dialog.locator('[data-testid="script-dialog-save"]').click();
  await expect(dialog).toHaveCount(0);
  await page.locator('button[data-testid^="script-"]').filter({ hasText: name }).first().click();
}

test('a script runs in its own automations folder and ends succeeded', async ({ kira }) => {
  const page = kira.window;
  await addScript(page, 'Where am I', 'pwd');
  await expect(page.locator('.xterm-rows')).toContainText('/automations/');
  await expect(
    page.locator('[data-testid="script-run-strip"] [data-testid="run-status"]'),
  ).toHaveText('Succeeded');
  await expect(
    page.locator('[data-testid="run-row"] [data-testid="run-status"]').first(),
  ).toHaveText('Succeeded');
});

test('a failing script shows its exit status', async ({ kira }) => {
  const page = kira.window;
  await addScript(page, 'Fails', 'exit 3');
  await expect(
    page.locator('[data-testid="script-run-outcome"] [data-testid="run-outcome-reason"]'),
  ).toHaveText('exited with status 3');
  await expect(
    page.locator('[data-testid="script-run-strip"] [data-testid="run-status"]'),
  ).toHaveText('Failed');
});

test('Stop ends a running script as cancelled', async ({ kira }) => {
  const page = kira.window;
  await addScript(page, 'Sleeps', 'sleep 60');
  await expect(page.locator('[data-testid="status-runs"]')).toContainText('1 running');
  await page
    .locator('[data-testid="run-row"][data-state="running"] [data-testid="run-stop"]')
    .click();
  await expect(
    page.locator('[data-testid="script-run-outcome"] [data-testid="run-outcome-reason"]'),
  ).toHaveText('stopped by you');
  await expect(page.locator('[data-testid="status-runs"]')).toHaveCount(0);
});
