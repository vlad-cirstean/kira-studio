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
  url: 'http://127.0.0.1:8765/mcp',
  command:
    'claude mcp add --transport http --scope user kira-repo-map http://127.0.0.1:8765/mcp --header "Authorization: Bearer test-token"',
  claudeAvailable: true,
  probed: ['claude (on PATH)'],
  error: '',
  repos: [],
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

test('a server-wide failure (e.g. a bind conflict) shows the error, not a command', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      {
        channel: IPC.repoMapSetEnabled,
        response: {
          running: false,
          url: '',
          command: '',
          claudeAvailable: false,
          probed: [],
          error: 'repomap: listen tcp 127.0.0.1:8765: bind: address already in use',
          repos: [],
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

// P67d §7.4/§10: every imported repository is listed, one row per repository, with a checkbox
// reflecting its own grant — and toggling an ungranted one calls RepoMapService.SetRepoEnabled
// (asserted through the mock channel, since the Go side is not in the loop here).
test('lists every imported repository with its own per-repository access checkbox', async ({
  relaunch,
}) => {
  const STATUS_WITH_REPOS = {
    ...ENABLED_STATUS,
    repos: [
      {
        id: 'repo-1',
        name: 'kira-studio',
        root: '/home/user/kira-studio',
        key: 'kira-studio',
        enabled: true,
        serving: true,
        ready: true,
        error: '',
      },
      {
        id: 'repo-2',
        name: 'other-repo',
        root: '/home/user/other-repo',
        key: '',
        enabled: false,
        serving: false,
        ready: false,
        error: '',
      },
    ],
  };
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.repoMapSetEnabled, response: STATUS_WITH_REPOS },
      { channel: IPC.repoMapSetRepoEnabled, response: STATUS_WITH_REPOS },
    ],
  });
  await openSettings(page);
  await page.click('[data-testid="settings-section-Code intelligence"]');
  await page.click('[data-testid="settings-code-intel-enabled"]');

  await expect(dialog(page).locator('[data-testid="repomap-repo-row-repo-1"]')).toBeVisible();
  await expect(dialog(page).locator('[data-testid="repomap-repo-row-repo-2"]')).toBeVisible();
  await expect(dialog(page).locator('[data-testid="repomap-repo-toggle-repo-1"]')).toBeChecked();
  await expect(
    dialog(page).locator('[data-testid="repomap-repo-toggle-repo-2"]'),
  ).not.toBeChecked();

  await page.click('[data-testid="repomap-repo-toggle-repo-2"]');

  await expect
    .poll(() => control.log().some((entry) => entry.channel === IPC.repoMapSetRepoEnabled))
    .toBe(true);
  const call = control.log().find((entry) => entry.channel === IPC.repoMapSetRepoEnabled);
  expect(call?.args).toEqual({ id: 'repo-2', enabled: true });
});
