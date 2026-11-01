import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { failedStatus, offStatus, requestedStatus } from './support/capture';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// UI half of captureflow's settings scenario: the Capture pane in Settings.

async function openPane(page: Page): Promise<void> {
  await emitWailsEvent(page, IPC.openSettings, undefined);
  await page.locator('[data-testid="settings-section-Capture"]').click();
}

const id = (s: string) => `[data-testid="${s}"]`;

test('the default is on with the three-key chord and an active status', async ({ relaunch }) => {
  const { window: page } = await relaunch();
  await openPane(page);
  await expect(page.locator(id('settings-capture-enabled'))).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator(id('settings-capture-hotkey'))).toHaveValue('CmdOrCtrl+Shift+K');
  await expect(page.locator(id('settings-capture-status'))).toContainText('CmdOrCtrl+Shift+K');
});

test('Save writes the toggle', async ({ relaunch }) => {
  const { window: page, control } = await relaunch();
  await openPane(page);
  await page.locator(id('settings-capture-enabled')).click();
  await page.locator(id('settings-save')).click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.settingsSet)?.args)
    .toEqual({ patch: { capture: { enabled: false } } });
});

test('the recorder turns a keydown into an accelerator and reset restores the default', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch();
  await openPane(page);
  const hotkey = page.locator(id('settings-capture-hotkey'));
  await hotkey.focus();
  // The UI tier's WebKit reports a Mac: Cmd is CmdOrCtrl, a physical Ctrl stays Ctrl.
  await page.keyboard.press('Control+Shift+J');
  await expect(hotkey).toHaveValue('Ctrl+Shift+J');
  await page.keyboard.press('Meta+Shift+J');
  await expect(hotkey).toHaveValue('CmdOrCtrl+Shift+J');
  await page.locator(id('settings-reset-capture-hotkey')).click();
  await expect(hotkey).toHaveValue('CmdOrCtrl+Shift+K');
  await hotkey.focus();
  await page.keyboard.press('Meta+Shift+J');
  await page.locator(id('settings-save')).click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.settingsSet)?.args)
    .toEqual({ patch: { capture: { hotkey: 'CmdOrCtrl+Shift+J' } } });
});

test('a bare key is ignored and Backspace clears with an inline error', async ({ relaunch }) => {
  const { window: page } = await relaunch();
  await openPane(page);
  const hotkey = page.locator(id('settings-capture-hotkey'));
  await hotkey.focus();
  await page.keyboard.press('J');
  await expect(hotkey).toHaveValue('CmdOrCtrl+Shift+K');
  await page.keyboard.press('Backspace');
  await expect(hotkey).toHaveValue('');
  await expect(hotkey).toHaveAttribute('aria-invalid', 'true');
});

test('a failed registration shows the OS reason and a push updates the status', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.captureStatus, response: failedStatus }],
  });
  await openPane(page);
  const status = page.locator(id('settings-capture-status'));
  await expect(status).toContainText(failedStatus.reason as string);
  await emitWailsEvent(page, IPC.captureStatusChanged, requestedStatus);
  await expect(status).not.toContainText(failedStatus.reason as string);
  await emitWailsEvent(page, IPC.captureStatusChanged, offStatus);
  await expect(status).toBeVisible();
});
