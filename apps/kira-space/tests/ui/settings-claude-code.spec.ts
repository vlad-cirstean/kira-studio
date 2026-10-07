import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// P188: keep-awake while Claude Code runs is a Space setting, saved with the dialog.

test('the Claude Code switch saves claudeCode.keepAwakeWithAgents with the dialog', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch();
  await emitWailsEvent(page, IPC.openSettings, undefined);
  await page.locator('[data-testid="settings-section-Claude Code"]').click();
  const sw = page.locator('[data-testid="settings-claude-code-keep-awake"]');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(control.log().some((e) => e.channel === IPC.settingsSet)).toBe(false);

  await page.locator('[data-testid="settings-save"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.settingsSet)?.args)
    .toEqual({ patch: { claudeCode: { keepAwakeWithAgents: true } } });
});
