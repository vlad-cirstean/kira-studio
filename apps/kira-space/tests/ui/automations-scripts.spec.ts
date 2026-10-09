import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

const SCRIPT = {
  id: 'script-1',
  name: 'Build all',
  command: 'echo one\necho two',
  workingDir: '',
  color: 'none',
  collectionId: null,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const TERMINAL_OPEN_OK: ControlSnapshot = {
  channel: IPC.terminalOpen,
  response: { shell: '/bin/zsh' },
};

function modeTab(page: Page) {
  return page.locator('[data-testid="mode-tab"][data-mode="terminal"]');
}

test('the header + adds a two-line quick command, sent with its newline', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'terminal' } },
      TERMINAL_OPEN_OK,
      { channel: IPC.customScriptsCreate, response: SCRIPT },
    ],
  });
  await expect(modeTab(page)).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="terminal-panel"]')).toContainText('No quick commands');

  await page.locator('[data-testid="quick-commands-add"]').click();
  const dialog = page.locator('[data-testid="quick-commands-dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-testid="custom-script-name"]').fill(SCRIPT.name);
  const script = dialog.locator('[data-testid="custom-script-command"]');
  await script.focus();
  await page.keyboard.type('echo one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('echo two');
  await dialog.locator('[data-testid="custom-script-save"]').click();

  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.customScriptsCreate)?.args)
    .toEqual({
      fields: {
        name: SCRIPT.name,
        command: SCRIPT.command,
        workingDir: '',
        color: 'none',
        collectionId: null,
      },
    });
});

test('clicking a quick command opens a terminal tab titled with its name', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'terminal' } },
      TERMINAL_OPEN_OK,
      { channel: IPC.customScriptsList, response: { collections: [], scripts: [SCRIPT] } },
    ],
  });

  const row = page.locator(`[data-testid="quick-command-${SCRIPT.id}"]`);
  await expect(row).toContainText('echo one…');
  await row.click();

  await expect(page.locator('[data-testid="tab-strip-wrapper"] [data-testid="tab"]')).toContainText(
    SCRIPT.name,
  );
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.terminalOpen &&
            (e.args as { command?: string } | undefined)?.command === SCRIPT.command,
        ),
    )
    .toBe(true);
});

test('Choose… fills the working directory from the folder dialog', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.windowsEnsure, response: { mode: 'terminal' } },
      { channel: IPC.filesChooseFolder, response: { canceled: false, path: '/tmp/picked' } },
    ],
  });
  await page.locator('[data-testid="quick-commands-add"]').click();
  const dialog = page.locator('[data-testid="quick-commands-dialog"]');
  await dialog.locator('[data-testid="custom-script-workingdir-choose"]').click();
  await expect(dialog.locator('[data-testid="custom-script-workingdir"]')).toHaveValue(
    '/tmp/picked',
  );
});
