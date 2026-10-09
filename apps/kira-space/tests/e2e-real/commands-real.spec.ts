import { expect, test } from './fixtures';

interface Library {
  collections: { id: string; name: string }[];
  scripts: { id: string; name: string; command: string; collectionId: string | null }[];
}

test('a collection and a script moved into it survive a reload', async ({ kira }) => {
  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="terminal"]').click();
  await expect(page.locator('[data-testid="terminal-panel"]')).toBeVisible();

  await page.locator('[data-testid="quick-commands-new-collection"]').click();
  await page.locator('[data-testid="quick-command-collection-rename-input"]').fill('Builds');
  await page.keyboard.press('Enter');
  await expect(
    page.locator('[data-testid="quick-command-group"][data-name="Builds"]'),
  ).toBeVisible();

  await page.locator('[data-testid="quick-commands-add"]').click();
  const dialog = page.locator('[data-testid="quick-commands-dialog"]');
  await dialog.locator('[data-testid="custom-script-name"]').fill('Build all');
  await dialog.locator('[data-testid="custom-script-command"]').fill('echo one');
  await dialog.locator('[data-testid="custom-script-save"]').click();
  await expect(dialog).toHaveCount(0);

  const row = page.locator('[data-testid^="quick-command-"]', { hasText: 'Build all' });
  await row.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to collection' }).click();
  await page.getByRole('menuitem', { name: 'Builds' }).click();

  const stored = async () => kira.call<Library>('CustomScriptsService', 'List');
  await expect
    .poll(async () => {
      const lib = await stored();
      const col = lib.collections.find((c) => c.name === 'Builds');
      return lib.scripts.find((x) => x.name === 'Build all')?.collectionId === col?.id;
    })
    .toBe(true);

  await kira.reload();
  await page.locator('[data-testid="mode-tab"][data-mode="terminal"]').click();
  const group = page.locator('[data-testid="quick-command-group"][data-name="Builds"]');
  await expect(group).toBeVisible();
  await expect(group).toContainText('1');
  await expect(
    page.locator('[data-testid^="quick-command-"]', { hasText: 'Build all' }).first(),
  ).toBeVisible();
});
