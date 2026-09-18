import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P86 §19.3 — modelled on settings-code-intelligence.spec.ts, itself modelled on
// settings-scripts.spec.ts: the Claude Code section renders with the toggle off; clicking it
// calls agentHooksSetEnabled with {enabled: true}; a status carrying `error` renders
// claude-code-hooks-error; a running status renders claude-code-hooks-path.

async function openSettings(page: Page): Promise<void> {
  await page.click('[data-testid="open-settings"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();
}

function dialog(page: Page) {
  return page.locator('[data-testid="settings-dialog"]');
}

test('off by default: toggle unchecked, no error, no path', async ({ relaunch }) => {
  const { window: page } = await relaunch();
  await openSettings(page);
  await page.click('[data-testid="settings-section-Claude Code"]');

  await expect(
    dialog(page).locator('[data-testid="settings-claude-code-hooks"]'),
  ).not.toBeChecked();
  await expect(dialog(page).locator('[data-testid="claude-code-hooks-error"]')).toHaveCount(0);
  await expect(dialog(page).locator('[data-testid="claude-code-hooks-path"]')).toHaveCount(0);
});

test('clicking the toggle calls agentHooksSetEnabled with {enabled: true}, and a running status shows the path', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [
      {
        channel: IPC.agentHooksSetEnabled,
        response: { running: true, settingsPath: '/tmp/kira-agent-xyz/hooks.json', error: '' },
      },
    ],
  });
  await openSettings(page);
  await page.click('[data-testid="settings-section-Claude Code"]');
  await page.click('[data-testid="settings-claude-code-hooks"]');

  await expect
    .poll(() => control.log().some((entry) => entry.channel === IPC.agentHooksSetEnabled))
    .toBe(true);
  const call = control.log().find((entry) => entry.channel === IPC.agentHooksSetEnabled);
  expect(call?.args).toEqual({ enabled: true });

  await expect(dialog(page).locator('[data-testid="settings-claude-code-hooks"]')).toBeChecked();
  await expect(dialog(page).locator('[data-testid="claude-code-hooks-path"]')).toHaveText(
    '/tmp/kira-agent-xyz/hooks.json',
  );
  await expect(dialog(page).locator('[data-testid="claude-code-hooks-error"]')).toHaveCount(0);
});

// P87 §10.3: the agent-aware keep-awake leaf, beside the hooks toggle in the same section.
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

test('a start failure (e.g. curl not found) shows the error, not a path', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [
      {
        channel: IPC.agentHooksSetEnabled,
        response: {
          running: false,
          settingsPath: '',
          error: 'curl not found; hooks cannot report',
        },
      },
    ],
  });
  await openSettings(page);
  await page.click('[data-testid="settings-section-Claude Code"]');
  await page.click('[data-testid="settings-claude-code-hooks"]');

  await expect(dialog(page).locator('[data-testid="claude-code-hooks-error"]')).toHaveText(
    'curl not found; hooks cannot report',
  );
  await expect(dialog(page).locator('[data-testid="claude-code-hooks-path"]')).toHaveCount(0);
});
