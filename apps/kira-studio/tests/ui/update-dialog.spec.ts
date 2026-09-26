import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P119: the status-bar update-available item and the modal update dialog it opens, replacing
// P66's own update-banner (release-page-link) behavior. Default boot answers "no update"
// (mockRuntime.ts's own WILDCARD_DEFAULTS[IPC.updateStatus]), so case 1 proves the hidden-by-default
// shape every other existing spec/snapshot silently relies on; the rest seed an available update
// explicitly.

test('no update available: no status-bar item, no dialog', async ({ kira }) => {
  const { window } = kira;

  await expect(window.locator('[data-testid="update-available"]')).toHaveCount(0);
  await expect(window.locator('[data-testid="update-dialog"]')).toHaveCount(0);
  await expect(window.locator('[data-testid="status-bar"]')).toBeVisible();
  await expect(window.locator('[data-testid="engine-status"]')).toBeVisible();
});

test('update available: dialog auto-opens, Later closes it, the item reopens it', async ({
  relaunch,
}) => {
  const { window } = await relaunch({
    control: [
      {
        channel: IPC.updateStatus,
        response: {
          updateAvailable: true,
          currentVersion: '1.2.0',
          latestVersion: '1.3.0',
          installLogPath: '/tmp/kira-studio-update.log',
        },
      },
    ],
  });

  const dialog = window.locator('[data-testid="update-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(window.locator('[data-testid="update-dialog-versions"]')).toHaveText(
    'Kira Studio 1.3.0 is available. You have 1.2.0.',
  );

  const item = window.locator('[data-testid="update-available"]');
  await expect(item).toBeVisible();
  await expect(item).toHaveText('Update 1.3.0');

  await window.click('[data-testid="update-dialog-later"]');
  await expect(dialog).toHaveCount(0);
  await expect(item).toBeVisible();

  await item.click();
  await expect(dialog).toBeVisible();
});

test('Update click installs: control log shows the install call', async ({ relaunch }) => {
  const { window, control } = await relaunch({
    control: [
      {
        channel: IPC.updateStatus,
        response: {
          updateAvailable: true,
          currentVersion: '1.2.0',
          latestVersion: '1.3.0',
          installLogPath: '/tmp/kira-studio-update.log',
        },
      },
      { channel: IPC.updateInstall, hold: true },
    ],
  });

  await window.click('[data-testid="update-dialog-install"]');

  await expect
    .poll(() => control.log().some((entry) => entry.channel === IPC.updateInstall))
    .toBe(true);
});

test('a failed install shows the error and re-enables Try again', async ({ relaunch }) => {
  const { window } = await relaunch({
    control: [
      {
        channel: IPC.updateStatus,
        response: {
          updateAvailable: true,
          currentVersion: '1.2.0',
          latestVersion: '1.3.0',
          installLogPath: '/tmp/kira-studio-update.log',
        },
      },
      {
        channel: IPC.updateInstall,
        error: { code: 'E_INTERNAL', message: 'checksum mismatch' },
      },
    ],
  });

  await window.click('[data-testid="update-dialog-install"]');

  const error = window.locator('[data-testid="update-dialog-error"]');
  await expect(error).toBeVisible();
  await expect(error).toContainText('checksum mismatch');

  const install = window.locator('[data-testid="update-dialog-install"]');
  await expect(install).toBeEnabled();
  await expect(install).toHaveText('Try again');
});
