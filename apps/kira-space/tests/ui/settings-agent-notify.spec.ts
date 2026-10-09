import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// P238: the Notifications group in Settings > Claude Code, and the window's answer to a
// notification click.

const LEAVES = ['finished', 'needs-input', 'run-ended', 'include-message'] as const;

async function openClaudeCodePane(page: Page): Promise<void> {
  await emitWailsEvent(page, IPC.openSettings, undefined);
  await page.locator('[data-testid="settings-section-Claude Code"]').click();
}

const sw = (page: Page, suffix = '') =>
  page.locator(`[data-testid="settings-claude-code-notify${suffix}"]`);

test('every notification switch starts on and the master switch gates the four others', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch();
  await openClaudeCodePane(page);
  await expect(sw(page)).toHaveAttribute('aria-checked', 'true');
  for (const leaf of LEAVES) {
    await expect(sw(page, `-${leaf}`)).toHaveAttribute('aria-checked', 'true');
    await expect(sw(page, `-${leaf}`)).toBeEnabled();
  }
  await sw(page).click();
  for (const leaf of LEAVES) await expect(sw(page, `-${leaf}`)).toBeDisabled();
  await expect(sw(page, '-test')).toBeDisabled();
});

test('Save writes the changed notify leaves and reset restores a default', async ({ relaunch }) => {
  const { window: page, control } = await relaunch();
  await openClaudeCodePane(page);
  await sw(page, '-finished').click();
  await sw(page, '-include-message').click();
  const reset = page.locator('[data-testid="settings-reset-claudeCode-notifyIncludeMessage"]');
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(sw(page, '-include-message')).toHaveAttribute('aria-checked', 'true');

  await page.locator('[data-testid="settings-save"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.settingsSet)?.args)
    .toEqual({ patch: { claudeCode: { notifyOnFinished: false } } });
});

test('the test button calls AgentNotifyService.SendTest', async ({ relaunch }) => {
  const { window: page, control } = await relaunch();
  await openClaudeCodePane(page);
  await sw(page, '-test').click();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.agentNotifySendTest).length)
    .toBe(1);
});

test('a window reports its focus at boot', async ({ relaunch }) => {
  const { control } = await relaunch();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.agentNotifyReportFocus)?.args)
    .toMatchObject({ module: 'git', activeTerminalId: '', adeTaskId: '' });
});

test('reveal-task switches to the Agents module', async ({ relaunch }) => {
  const { window: page } = await relaunch();
  await emitWailsEvent(page, IPC.agentRevealTask, { taskId: 'task-1' });
  await expect(page.locator('[data-testid="mode-tab"][data-mode="ade"]')).toHaveClass(/is-active/);
});

test('reveal-terminal switches to the Terminal module and shows that tab', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [{ channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } }],
  });
  const mode = (m: string) => page.locator(`[data-testid="mode-tab"][data-mode="${m}"]`);
  await mode('automations').click();
  await page.click('[data-testid="automations-start-new"]');
  const tabs = page.locator('[data-testid="tab-strip-wrapper"] [data-testid="tab"]');
  await expect(tabs).toHaveCount(1);
  const openedId = () =>
    (
      control.log().find((e) => e.channel === IPC.terminalOpen)?.args as
        | { terminalId?: string }
        | undefined
    )?.terminalId;
  await expect.poll(openedId).toBeTruthy();

  await mode('git').click();
  await expect(mode('git')).toHaveClass(/is-active/);
  await emitWailsEvent(page, IPC.agentRevealTerminal, { terminalId: openedId() });
  await expect(mode('automations')).toHaveClass(/is-active/);
  await expect(tabs).toHaveCount(1);
});
