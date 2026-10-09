import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { installPassthrough } from './support/passthrough';

// P232: Automations mode with real PTYs and Studio's own scripts. HOME is a temp dir so the
// default cwd and the login shell's rc files are isolated from the machine running the suite.

const home = mkdtempSync(join(tmpdir(), 'kira-e2e-home-'));
test.use({ serverEnv: { HOME: home } });
// Not afterAll: with fullyParallel it runs between tests of one worker, deleting the HOME the next test uses.
process.once('exit', () => rmSync(home, { recursive: true, force: true }));

test('a new terminal tab runs a command in a real shell', async ({ kira }) => {
  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="automations"]').click();
  await page.locator('[data-testid="automations-start-new"]').click();
  await expect(page.locator('.xterm-rows')).toBeVisible();
  await page.locator('.xterm-helper-textarea').focus();
  // One pasted chunk; the next test types key by key.
  await page.keyboard.insertText('echo kira-$((1+1))');
  await expect(page.locator('.xterm-rows')).toContainText('echo kira-$((1+1))');
  await page.keyboard.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('kira-2');
});

test('a script runs in the picked folder', async ({ kira }) => {
  const dir = mkdtempSync(join(tmpdir(), 'kira-e2e-script-'));
  writeFileSync(join(dir, 'marker-from-script.txt'), '');
  try {
    const page = kira.window;
    await installPassthrough(page, {
      'FilesService.ChooseFolder': { response: { canceled: false, path: dir } },
    });
    await page.locator('[data-testid="mode-tab"][data-mode="automations"]').click();
    await page.locator('[data-testid="automations-add"]').click();
    const dialog = page.locator('[data-testid="script-dialog"]');
    await dialog.locator('[data-testid="script-dialog-name"]').fill('List folder');
    await dialog.locator('[data-testid="script-dialog-command"]').fill('ls');
    await dialog.locator('[data-testid="script-dialog-dir-fixed"]').click();
    await dialog.locator('[data-testid="script-dialog-workingdir-choose"]').click();
    await expect(dialog.locator('[data-testid="script-dialog-workingdir"]')).toHaveText(dir);
    await dialog.locator('[data-testid="script-dialog-save"]').click();
    await expect(dialog).toHaveCount(0);

    await page.locator('button[data-testid^="script-"]').filter({ hasText: 'List folder' }).click();
    await expect(page.locator('.xterm-rows')).toContainText('marker-from-script.txt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keystrokes typed one by one reach the shell in order', async ({ kira }) => {
  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="automations"]').click();
  await page.locator('[data-testid="automations-start-new"]').click();
  await expect(page.locator('.xterm-rows')).toBeVisible();
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('echo kira-$((1+1))', { delay: 0 });
  await expect(page.locator('.xterm-rows')).toContainText('echo kira-$((1+1))');
  await page.keyboard.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('kira-2');
});
