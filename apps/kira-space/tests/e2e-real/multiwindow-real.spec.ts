import { expect, test } from './fixtures';
import { stubNativeDialogs } from './support/routes';

// Two pages, two window keys, one server: a terminal started in one page streams only to it.
test('terminal output reaches only the page that owns the terminal', async ({ kira, browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const other = await context.newPage();
  await stubNativeDialogs(other);
  await other.goto(`${kira.baseURL}/?window=${crypto.randomUUID()}`);
  await other.waitForSelector('[data-testid="status-bar"]');

  const owner = kira.window;
  await owner.locator('[data-testid="mode-tab"][data-mode="terminal"]').click();
  await owner.locator('[data-testid="terminal-start-new"]').click();
  await expect(owner.locator('.xterm-rows')).toBeVisible();
  await owner.locator('.xterm-helper-textarea').focus();
  await owner.keyboard.type('echo only-mine-$((20+22))');
  await owner.keyboard.press('Enter');
  await expect(owner.locator('.xterm-rows')).toContainText('only-mine-42');

  await other.locator('[data-testid="mode-tab"][data-mode="terminal"]').click();
  await expect(other.locator('.xterm-rows')).toHaveCount(0);
  await expect(other.locator('body')).not.toContainText('only-mine-42');
  await context.close();
});
