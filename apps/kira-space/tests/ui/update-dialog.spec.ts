import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P119: the status-bar update-available item and the modal update dialog it opens — Kira Studio's
// own tests/ui/update-dialog.spec.ts, trimmed to this app's own first three cases (the error state
// is the same shared @workbench component, already covered there). Default boot answers "no
// update" (mockRuntime.ts's own WILDCARD_DEFAULTS[IPC.updateStatus]).

test('no update available: no status-bar item, no dialog', async ({ kira }) => {
  const { window } = kira;

  await expect(window.locator('[data-testid="update-available"]')).toHaveCount(0);
  await expect(window.locator('[data-testid="update-dialog"]')).toHaveCount(0);
  await expect(window.locator('[data-testid="status-bar"]')).toBeVisible();
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
          installLogPath: '/tmp/kira-space-update.log',
        },
      },
    ],
  });

  const dialog = window.locator('[data-testid="update-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(window.locator('[data-testid="update-dialog-versions"]')).toHaveText(
    'Kira Space 1.3.0 is available. You have 1.2.0.',
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
          installLogPath: '/tmp/kira-space-update.log',
        },
      },
      { channel: IPC.updateInstall },
    ],
  });

  await window.click('[data-testid="update-dialog-install"]');

  await expect
    .poll(() => control.log().some((entry) => entry.channel === IPC.updateInstall))
    .toBe(true);
});
