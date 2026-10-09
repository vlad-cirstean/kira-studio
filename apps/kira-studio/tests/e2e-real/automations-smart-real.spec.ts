import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// P242 Part 2: a smart script against the real backend with the fake claude on PATH: create it in
// the editor, run it from the dialog, follow the run tab.

async function addSmartScript(page: Page, name: string, prompt: string): Promise<void> {
  await page.locator('[data-testid="mode-tab"][data-mode="automations"]').click();
  await page.locator('[data-testid="automations-add"]').click();
  await page.locator('[data-testid="menu-item-new-smart-script"]').click();
  const dialog = page.locator('[data-testid="script-dialog"]');
  await dialog.locator('[data-testid="script-dialog-name"]').fill(name);
  await dialog.locator('[data-testid="script-dialog-command"]').fill(prompt);
  await dialog.locator('[data-testid="script-dialog-save"]').click();
  await expect(dialog).toHaveCount(0);
}

async function runSmartScript(page: Page, name: string): Promise<void> {
  await page.locator('button[data-testid^="script-"]').filter({ hasText: name }).first().click();
  const start = page.locator('[data-testid="run-start"]');
  await expect(start).toBeEnabled();
  await start.click();
}

test.describe('done', () => {
  test.use({ scenario: { claude: { '*': ['done'] } } });

  test('a smart script runs to Succeeded with the agent summary', async ({ kira }) => {
    const page = kira.window;
    await addSmartScript(page, 'Say hi', 'Say hi to {nobody}.');
    await runSmartScript(page, 'Say hi');
    const header = page.locator('[data-testid="script-run-header"]');
    await expect(header.locator('[data-testid="run-status"]')).toHaveText('Succeeded', {
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="run-outcome-summary"]')).toHaveText('summary-done');
    await expect(
      page.locator('[data-testid="run-row"] [data-testid="run-status"]').first(),
    ).toHaveText('Succeeded');
  });
});

test.describe('failed', () => {
  test.use({ scenario: { claude: { '*': ['failed'] } } });

  test('a failed smart run ends Failed with the agent summary', async ({ kira }) => {
    const page = kira.window;
    await addSmartScript(page, 'Breaks', 'Do the thing.');
    await runSmartScript(page, 'Breaks');
    const header = page.locator('[data-testid="script-run-header"]');
    await expect(header.locator('[data-testid="run-status"]')).toHaveText('Failed', {
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="run-outcome-summary"]')).toHaveText('summary-failed');
  });
});
