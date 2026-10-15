import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { adeBoard, adeFixture, openPlan, openWorkflows } from './support/adeV2';
import { contract } from './support/contract';
import { calls } from './support/ipcCalls';
import { IPC } from './support/ipcChannels';

// Flat workflow steps: card, panel rows, moves, return chip and the editor. Contract ade-flat-steps;
// backend half: flows/adeflow TestFlatSteps (flatsteps_test.go).

const t = (id: string) => `[data-testid="${id}"]`;
const card = (page: Page, id: string) =>
  page.locator(`[data-testid="ade-card"][data-task-id="${id}"]`);
const block = (page: Page, id: string) =>
  page.locator(`${t('ade-step-block')}[data-step-id="${id}"]`);
const node = (page: Page, id: string) => page.locator(`${t('ade-wf-node')}[data-step-id="${id}"]`);

interface TaskFx {
  entryStepId: string;
  since: Record<string, number>;
  workflow: { steps: { id: string; kind: string }[] } | null;
}

interface WorkflowsFx {
  workflows: { workflow: { steps: { id: string; kind: string }[] } }[];
}

async function openTask(page: Page, id: string): Promise<void> {
  await card(page, id).click();
  await expect(page.locator(t('ade-panel'))).toBeVisible();
}

test('contract: a created task starts on the first step and the panel lists every step', async ({
  relaunch,
}) => {
  const created = contract<TaskFx>('ade-flat-steps', 'AdeTaskService.Task#created');
  expect(created.entryStepId).toBe('spec');
  expect(created.since).toEqual({});
  const fx = adeFixture<WorkflowsFx>('workflows');
  const steps = fx.workflows[0]?.workflow.steps ?? [];
  const { window: page } = await openPlan(relaunch);
  await openTask(page, 'T_alerts');
  await expect(page.locator(t('ade-step-block'))).toHaveCount(steps.length);
  await expect(block(page, 'spec')).toBeVisible();
  await expect(card(page, 'T_alerts').locator(t('ade-step-label'))).toContainText('Spec');
});

test('a manual first step shows the Session action on its card', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await expect(card(page, 'T_alerts').locator(t('ade-task-action-session'))).toBeVisible();
});

test('contract: Move task here and the step mover send SetTaskStep with the target step', async ({
  relaunch,
}) => {
  const moved = contract<TaskFx>('ade-flat-steps', 'AdeTaskService.Task#moved');
  expect(Object.keys(moved.since).length).toBeGreaterThan(0);
  const { window: page, control } = await openPlan(relaunch);
  const moves = () => calls(control, IPC.adeTaskSetTaskStep);
  await openTask(page, 'T_alerts');

  await block(page, 'impl')
    .locator(t('ade-step-block-head'))
    .click({
      button: 'right',
      position: { x: 200, y: 8 },
    });
  await page.locator(t('menu-item-ade-step-move-here')).click();
  await expect.poll(moves).toHaveLength(1);
  expect(moves()[0]?.args).toEqual({ taskId: 'T_alerts', stepId: 'impl' });

  await page.locator(t('ade-step-next')).click();
  await expect.poll(moves).toHaveLength(2);
  expect(moves()[1]?.args).toMatchObject({ taskId: 'T_alerts' });
});

test('a step moved back shows pending while its earlier runs stay hidden', async ({ relaunch }) => {
  const edit = adeBoard((b) => {
    const task = b.tasks.find((x) => x.id === 'T_hooks');
    if (!task) throw new Error('T_hooks missing');
    task.entryStepId = 'impl';
    const branch = task.runs.find((r) => r.stepId === 'impl');
    if (branch) task.since = { [`impl/${String(branch.branchId)}`]: 1 };
  });
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: edit },
  ]);
  await openTask(page, 'T_hooks');
  await expect(block(page, 'impl')).toBeVisible();
  await expect(block(page, 'impl').locator(t('ade-run-status'))).toHaveCount(0);
});

test('contract: a return past the entry step shows the returns used on the chip', async ({
  relaunch,
}) => {
  const back = contract<TaskFx & { runs: { stepId: string; returns: number }[] }>(
    'ade-flat-steps',
    'AdeTaskService.Task#return',
  );
  expect(back.entryStepId).toBe('implement');
  expect(back.runs.some((r) => r.returns === 1)).toBe(true);
  const { window: page } = await openPlan(relaunch);
  await openTask(page, 'T_push');
  const chip = page.locator(t('ade-run-returns')).first();
  await expect(chip).toContainText('↩');
});

test('contract: the inspector switches field groups per kind, keeps Advanced closed, and saves kinds', async ({
  relaunch,
}) => {
  const sent = contract<{ workflow: { steps: { kind: string }[] } }>(
    'ade-flat-steps',
    'args:AdeTaskService.SaveWorkflow',
  );
  expect(sent.workflow.steps.length).toBeGreaterThan(0);
  const { window: page, control } = await openWorkflows(relaunch);
  await node(page, 'ci').click();
  await expect(page.locator(t('ade-wf-step-tools'))).toBeHidden();
  await page.locator(t('ade-wf-step-kind-script')).click();
  await expect(page.locator(t('ade-wf-step-command'))).toBeVisible();
  await expect(page.locator(t('ade-wf-step-prompt'))).toHaveCount(0);

  await node(page, 'plan').click();
  await page.locator(t('ade-wf-step-advanced')).click();
  await expect(page.locator(t('ade-wf-step-tools'))).toBeVisible();
  await node(page, 'impl').click();
  await expect(page.locator(t('ade-wf-step-tools'))).toBeVisible();

  await node(page, 'spec').locator(t('ade-wf-step-menu')).click();
  await page.locator(t('ade-wf-step-add-after')).click();
  await page.locator(t('ade-wf-step-add-after-script')).click();
  await page.locator(t('ade-wf-save')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(1);
  const out = calls(control, IPC.adeTaskSaveWorkflow)[0]?.args as {
    workflow: { steps: { id: string; kind: string }[] };
  };
  expect(out.workflow.steps.map((s) => s.kind).slice(0, 3)).toEqual(['manual', 'script', 'agent']);
  expect(out.workflow.steps.find((s) => s.id === 'ci')?.kind).toBe('script');
});
