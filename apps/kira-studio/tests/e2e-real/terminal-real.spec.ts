import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { installPassthrough } from './support/passthrough';

// P232: Terminal mode with real PTYs and Studio's own quick commands. HOME is a temp dir so the
// default cwd and the login shell's rc files are isolated from the machine running the suite.

const home = mkdtempSync(join(tmpdir(), 'kira-e2e-home-'));
test.use({ serverEnv: { HOME: home } });
test.afterAll(() => rmSync(home, { recursive: true, force: true }));

test('a new terminal tab runs a command in a real shell', async ({ kira }) => {
  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="terminal"]').click();
  await page.locator('[data-testid="terminal-start-new"]').click();
  await expect(page.locator('.xterm-rows')).toBeVisible();
  await page.locator('.xterm-helper-textarea').focus();
  // One chunk, then Enter once it echoed: per-key writes can reorder (P232 finding B-1).
  await page.keyboard.insertText('echo kira-$((1+1))');
  await expect(page.locator('.xterm-rows')).toContainText('echo kira-$((1+1))');
  await page.keyboard.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('kira-2');
});

test('a quick command runs in the picked folder', async ({ kira }) => {
  const dir = mkdtempSync(join(tmpdir(), 'kira-e2e-qc-'));
  writeFileSync(join(dir, 'marker-from-quick-command.txt'), '');
  try {
    const page = kira.window;
    await installPassthrough(page, {
      'FilesService.ChooseFolder': { response: { canceled: false, path: dir } },
    });
    await page.locator('[data-testid="mode-tab"][data-mode="terminal"]').click();
    await page.locator('[data-testid="quick-commands-add"]').click();
    const dialog = page.locator('[data-testid="quick-commands-dialog"]');
    await dialog.locator('[data-testid="custom-script-name"]').fill('List folder');
    await dialog.locator('[data-testid="custom-script-command"]').fill('ls');
    await dialog.locator('[data-testid="custom-script-workingdir-choose"]').click();
    await expect(dialog.locator('[data-testid="custom-script-workingdir"]')).toHaveValue(dir);
    await dialog.locator('[data-testid="custom-script-save"]').click();
    await expect(dialog).toHaveCount(0);

    await page
      .locator('button[data-testid^="quick-command-"]')
      .filter({ hasText: 'List folder' })
      .click();
    await expect(page.locator('.xterm-rows')).toContainText('marker-from-quick-command.txt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keystrokes typed one by one reach the shell in order', async ({ kira }) => {
  test.fixme(
    true,
    'P232 finding B-1: per-key terminal writes are unordered concurrent bound calls',
  );
  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="terminal"]').click();
  await page.locator('[data-testid="terminal-start-new"]').click();
  await expect(page.locator('.xterm-rows')).toBeVisible();
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('echo kira-$((1+1))', { delay: 0 });
  await expect(page.locator('.xterm-rows')).toContainText('echo kira-$((1+1))');
});
