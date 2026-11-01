import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openAdvanced, openWorkflows, saved } from './support/adeV2';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// Stage settings in the step inspector. Contract ade-stage-settings; backend half: adeflow
// TestStageSettings* (stagesettings_test.go). Catalog, hint and the saved shape are the backend's.

const t = (id: string) => `[data-testid="${id}"]`;
const SCENARIO = 'ade-stage-settings';
const SETTING = 'ade-wf-setting-claude-auto_compact_window';

interface Spec {
  label: string;
  hint: string;
  min: number;
  max: number;
}
interface SavedWorkflow {
  workflow: { steps: { id: string; settings: Record<string, Record<string, string>> }[] };
}

const catalog = (): Spec => {
  const specs = contract<{ stageSettings: Spec[] }>(
    SCENARIO,
    'AdeTaskService.Workflows#stage-settings',
  ).stageSettings;
  const first = specs[0];
  if (!first) throw new Error('contract has no stage setting');
  return first;
};
const workflows = () => ({
  channel: IPC.adeTaskWorkflows,
  response: contract(SCENARIO, 'AdeTaskService.Workflows#stage-settings'),
});
const node = (page: Page, step: string) =>
  page.locator(`${t('ade-wf-node')}[data-step-id="${step}"]`);
const input = (page: Page) => page.locator(t(SETTING));
const settingsOf = (out: SavedWorkflow, id: string) =>
  out.workflow.steps.find((x) => x.id === id)?.settings;

async function pick(page: Page, step: string): Promise<void> {
  await node(page, step).click();
  await openAdvanced(page);
}

test("contract: the inspector shows the catalog's Auto compact limit with its hint", async ({
  relaunch,
}) => {
  const spec = catalog();
  const { window: page } = await openWorkflows(relaunch, [workflows()]);
  await pick(page, 'plain');
  await expect(page.locator(t('ade-wf-step-settings'))).toBeVisible();
  await expect(page.locator('label', { hasText: spec.label })).toBeVisible();
  await expect(input(page)).toHaveValue('');
  await expect(input(page)).toHaveAttribute('min', String(spec.min));
  await expect(input(page)).toHaveAttribute('max', String(spec.max));
  await expect(page.locator(t('ade-wf-setting-hint-claude-auto_compact_window'))).toHaveText(
    spec.hint,
  );
  await pick(page, 'tuned');
  await expect(input(page)).toHaveValue('200000');
});

test('contract: a typed limit saves as the backend takes it', async ({ relaunch }) => {
  const sent = contract<{ fileName: string; workflow: unknown }>(
    SCENARIO,
    'args:AdeTaskService.SaveWorkflow#stage-settings',
  );
  const { window: page, control } = await openWorkflows(relaunch, [workflows()]);
  await pick(page, 'plain');
  await input(page).fill('300000');
  const out = await saved<SavedWorkflow>(page, control, 1);
  expect(out).toMatchObject({ fileName: sent.fileName });
  expect(out.workflow).toEqual(sent.workflow);
});

test('clearing the limit saves no settings for the step', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch, [workflows()]);
  await pick(page, 'tuned');
  await input(page).fill('');
  const out = await saved<SavedWorkflow>(page, control, 1);
  expect(settingsOf(out, 'tuned')).toEqual({});
});

test('an out-of-range limit shows the range error', async ({ relaunch }) => {
  const spec = catalog();
  const { window: page } = await openWorkflows(relaunch, [workflows()]);
  await pick(page, 'plain');
  await input(page).fill('50000');
  await expect(page.locator(t('ade-wf-setting-error-claude-auto_compact_window'))).toHaveText(
    `Enter a whole number from ${spec.min.toLocaleString('en-US')} to ${spec.max.toLocaleString('en-US')}, or leave it empty.`,
  );
  await input(page).fill('150000');
  await expect(page.locator(t('ade-wf-setting-error-claude-auto_compact_window'))).toHaveCount(0);
});

test('contract: a refused save shows the range message', async ({ relaunch }) => {
  const refused = JSON.parse(
    contract<string>(SCENARIO, 'AdeTaskService.SaveWorkflow#stage-settings-range'),
  ) as { code: string; message: string };
  const { window: page } = await openWorkflows(relaunch, [
    workflows(),
    { channel: IPC.adeTaskSaveWorkflow, error: refused },
  ]);
  await pick(page, 'plain');
  await input(page).fill('50000');
  await page.locator(t('ade-wf-save')).click();
  await expect(page.locator(t('ade-wf-save-error'))).toContainText(refused.message);
});

test('script steps and manual steps without a session show no agent settings', async ({
  relaunch,
}) => {
  const { window: page } = await openWorkflows(relaunch);
  await pick(page, 'release');
  await expect(page.locator(t('ade-wf-step-settings'))).toHaveCount(0);
  await pick(page, 'spec');
  await expect(page.locator(t('ade-wf-step-settings'))).toBeVisible();
  await page.locator(t('ade-wf-step-session')).click();
  await expect(page.locator(t('ade-wf-step-settings'))).toHaveCount(0);
  await page.locator(t('ade-wf-step-session')).click();
  await expect(page.locator(t('ade-wf-step-settings'))).toBeVisible();
});
