import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P85 §10: the Scripts section is instant-effect like Code intelligence and Connected editors —
// modelled on settings-code-intelligence.spec.ts, the existing spec for that shape.

async function openSettings(page: Page): Promise<void> {
  await page.click('[data-testid="open-settings"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();
}

function dialog(page: Page) {
  return page.locator('[data-testid="settings-dialog"]');
}

const SCRIPT = {
  id: 'script-1',
  name: 'Dev server',
  command: 'npm run dev',
  workingDir: '/tmp/demo-repo/frontend',
  color: 'green',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

test('empty state, then adding a script calls customScriptsCreate with the trimmed fields', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [] },
      { channel: IPC.customScriptsCreate, response: SCRIPT },
    ],
  });
  await openSettings(page);
  await page.click('[data-testid="settings-section-Scripts"]');

  await expect(dialog(page).locator('[data-testid="custom-script-list"]')).toHaveCount(0);
  await expect(dialog(page).getByText('No scripts yet.')).toBeVisible();

  const addButton = dialog(page).locator('[data-testid="custom-script-add"]');
  await expect(addButton).toBeDisabled();

  await dialog(page).locator('[data-testid="custom-script-add-name"]').fill(`  ${SCRIPT.name}  `);
  await dialog(page)
    .locator('[data-testid="custom-script-add-command"]')
    .fill(`  ${SCRIPT.command}  `);
  await dialog(page)
    .locator('[data-testid="custom-script-add-workingdir"]')
    .fill(SCRIPT.workingDir);
  await expect(addButton).toBeEnabled();
  await addButton.click();

  await expect
    .poll(() => control.log().some((entry) => entry.channel === IPC.customScriptsCreate))
    .toBe(true);
  const call = control.log().find((entry) => entry.channel === IPC.customScriptsCreate);
  expect(call?.args).toEqual({
    fields: {
      name: SCRIPT.name,
      command: SCRIPT.command,
      workingDir: SCRIPT.workingDir,
      color: 'none',
    },
  });
});

test('Add stays disabled with an empty name or command', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.customScriptsList, response: [] }],
  });
  await openSettings(page);
  await page.click('[data-testid="settings-section-Scripts"]');

  const addButton = dialog(page).locator('[data-testid="custom-script-add"]');
  await expect(addButton).toBeDisabled();

  await dialog(page).locator('[data-testid="custom-script-add-name"]').fill(SCRIPT.name);
  await expect(addButton).toBeDisabled(); // command still empty

  await dialog(page).locator('[data-testid="custom-script-add-name"]').fill('');
  await dialog(page).locator('[data-testid="custom-script-add-command"]').fill(SCRIPT.command);
  await expect(addButton).toBeDisabled(); // name empty again
});

test('a non-absolute working directory surfaces the backend validation error', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.customScriptsList, response: [] },
      {
        channel: IPC.customScriptsCreate,
        error: {
          code: 'E_BAD_REQUEST',
          message: 'model: custom script: working directory must be an absolute path',
        },
      },
    ],
  });
  await openSettings(page);
  await page.click('[data-testid="settings-section-Scripts"]');

  await dialog(page).locator('[data-testid="custom-script-add-name"]').fill(SCRIPT.name);
  await dialog(page).locator('[data-testid="custom-script-add-command"]').fill(SCRIPT.command);
  await dialog(page).locator('[data-testid="custom-script-add-workingdir"]').fill('relative/dir');
  await dialog(page).locator('[data-testid="custom-script-add"]').click();

  await expect(dialog(page).locator('[data-testid="custom-script-error"]')).toHaveText(
    'model: custom script: working directory must be an absolute path',
  );
});
