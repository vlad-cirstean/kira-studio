import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openPlan } from './support/adeV2';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// A second agent provider: the names, models and optional roles come from AgentService.Info.
// Backend half: harnessflow TestSecondProviderRegistered, which writes the fake provider's Info.

const fake = contract<{ headlessLabel: string; models: { id: string }[]; defaultModel: string }>(
  'agent',
  'AgentService.Info#fake',
);
const info = [{ channel: IPC.agentInfo, response: fake }];

async function openSettings(page: Page, section: string): Promise<void> {
  await emitWailsEvent(page, IPC.openSettings, undefined);
  await page.locator(`[data-testid="settings-section-${section}"]`).click();
}

test('the Memory pane lists the provider models and its default', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: info });
  await openSettings(page, 'Memory');
  const select = page.locator('[data-testid="settings-memory-agent-model"]');
  await expect(select).toHaveValue(fake.defaultModel);
  const options = await select
    .locator('option')
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(options).toEqual(fake.models.map((m) => m.id));
});

test('a provider without hooks or usage hides those settings', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: info });
  await openSettings(page, 'Agent');
  await expect(page.locator('[data-testid="settings-agent-notify"]')).toBeVisible();
  await expect(page.locator('[data-testid="settings-agent-notify-run-ended"]')).toBeVisible();
  await expect(page.locator('[data-testid="settings-agent-notify-finished"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="settings-agent-notify-needs-input"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="settings-agent-usage"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="agent-usage-status"]')).toHaveCount(0);
});

test('headless session badges carry the provider label', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, info);
  await page
    .locator('[data-testid="ade-card"][data-task-id="T_bill"] [data-testid="ade-card-head"]')
    .click();
  await page.locator('[data-testid="ade-panel-tab-sessions"]').click();
  const badges = await page.locator('[data-testid="ade-session-badge"]').allTextContents();
  expect(badges).toContain(fake.headlessLabel);
  expect(badges).not.toContain('claude -p');
});
