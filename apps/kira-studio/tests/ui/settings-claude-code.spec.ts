import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { openSettings } from './support/settings';

// P127: the section's own hooks toggle (session-activity reporting) left Kira Studio along with
// the rest of agent-activity monitoring — this file now covers only what stayed, the P87 §10.3
// agent-aware keep-awake leaf.

function dialog(page: Page) {
  return page.locator('[data-testid="settings-dialog"]');
}

test('the keep-awake setting is unchecked by default, and clicking it calls SetAgentAware with {enabled: true}', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      {
        channel: IPC.keepAwakeSetAgentAware,
        response: { manual: false, supported: true, error: '' },
      },
    ],
  });
  await openSettings(page);
  await page.click('[data-testid="settings-section-Claude Code"]');

  await expect(
    dialog(page).locator('[data-testid="settings-claude-code-keep-awake"]'),
  ).not.toBeChecked();

  await page.click('[data-testid="settings-claude-code-keep-awake"]');

  await expect
    .poll(() => control.log().some((entry) => entry.channel === IPC.keepAwakeSetAgentAware))
    .toBe(true);
  const call = control.log().find((entry) => entry.channel === IPC.keepAwakeSetAgentAware);
  expect(call?.args).toEqual({ enabled: true });

  await expect(
    dialog(page).locator('[data-testid="settings-claude-code-keep-awake"]'),
  ).toBeChecked();
});
