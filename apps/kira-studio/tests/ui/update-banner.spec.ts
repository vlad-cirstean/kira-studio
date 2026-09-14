import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P66: the status-bar update-availability banner. Default boot answers "no update" (mockRuntime.ts's
// own WILDCARD_DEFAULTS[IPC.updateStatus]), so case 1 proves the hidden-by-default shape every
// other existing spec/snapshot silently relies on; case 2 seeds an available update explicitly.

test('no update available: banner is absent, other status-bar readouts unaffected', async ({
  kira,
}) => {
  const { window } = kira;

  await expect(window.locator('[data-testid="update-available"]')).toHaveCount(0);
  await expect(window.locator('[data-testid="status-bar"]')).toBeVisible();
  await expect(window.locator('[data-testid="engine-status"]')).toBeVisible();
});

test('update available: banner shows the latest version and opens the release page on click', async ({
  relaunch,
}) => {
  const { window, control } = await relaunch({
    control: [
      {
        channel: IPC.updateStatus,
        response: { updateAvailable: true, currentVersion: '1.2.0', latestVersion: '1.3.0' },
      },
    ],
  });

  const banner = window.locator('[data-testid="update-available"]');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText('Update 1.3.0');

  await banner.click();

  await expect
    .poll(() => control.log().some((entry) => entry.channel === IPC.updateOpenReleasePage))
    .toBe(true);
});
