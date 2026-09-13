import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// C3 §11.4/SPEC's own non-negotiable: "enabling is never a silent action." With the toggle off,
// the Code intelligence tab shows neither the registration command nor an Install button; turning
// it on reveals the command before the button, in that DOM order — the one place this ordering is
// actually enforced (docs/v1.5/plans/C3-mcp-repo-map-server.md §11 item 5).

async function openSettings(page: Page): Promise<void> {
  await page.click('[data-testid="open-settings"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();
}

function dialog(page: Page) {
  return page.locator('[data-testid="settings-dialog"]');
}

const ENABLED_STATUS = {
  running: true,
  repo: '/repo',
  command:
    'claude mcp add --transport http --scope user kira-repo-map http://127.0.0.1:8765/mcp --header "Authorization: Bearer test-token"',
  claudeAvailable: true,
  probed: ['claude (on PATH)'],
  error: '',
};

test('off: no command, no Install button; on: command renders before the button', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.repoMapSetEnabled, response: ENABLED_STATUS }],
  });
  await openSettings(page);
  await page.click('[data-testid="settings-section-Code intelligence"]');

  await expect(dialog(page).locator('[data-testid="repomap-command"]')).toHaveCount(0);
  await expect(dialog(page).locator('[data-testid="repomap-install-button"]')).toHaveCount(0);
  await expect(
    dialog(page).locator('[data-testid="settings-code-intel-enabled"]'),
  ).not.toBeChecked();

  await page.click('[data-testid="settings-code-intel-enabled"]');

  const command = dialog(page).locator('[data-testid="repomap-command"]');
  const button = dialog(page).locator('[data-testid="repomap-install-button"]');
  await expect(command).toBeVisible();
  await expect(command).toHaveText(ENABLED_STATUS.command);
  await expect(button).toBeVisible();
  await expect(dialog(page).locator('[data-testid="settings-code-intel-enabled"]')).toBeChecked();

  // DOM order: command before button.
  const testIds = await dialog(page)
    .locator('[data-testid="repomap-command"], [data-testid="repomap-install-button"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  expect(testIds).toEqual(['repomap-command', 'repomap-install-button']);
});

test('a repository resolution failure shows the error, not a command', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [
      {
        channel: IPC.repoMapSetEnabled,
        response: {
          running: false,
          repo: '',
          command: '',
          claudeAvailable: false,
          probed: [],
          error: 'repomap: no repository found for this working directory',
        },
      },
    ],
  });
  await openSettings(page);
  await page.click('[data-testid="settings-section-Code intelligence"]');
  await page.click('[data-testid="settings-code-intel-enabled"]');

  await expect(dialog(page).locator('[data-testid="repomap-error"]')).toBeVisible();
  await expect(dialog(page).locator('[data-testid="repomap-command"]')).toHaveCount(0);
  await expect(dialog(page).locator('[data-testid="repomap-install-button"]')).toHaveCount(0);
});
