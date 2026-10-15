import type { Page } from '@playwright/test';
import { runPreviewSnapshots } from './adePromptPreview';
import { expect, test } from './fixtures';
import { type AdeBoardFx, adeBoard, adeFixture, openPlan } from './support/adeV2';
import { contract } from './support/contract';
import { calls } from './support/ipcCalls';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// Step return limit: run counter, stop message, review step without a limit, editor field. Contract
// ade-return-limit; backend half: adeflow TestReturnLimit (returnlimit_test.go).

const t = (id: string) => `[data-testid="${id}"]`;

interface ContractRun {
  state: string;
  loops: number;
  returns: number;
  note: string;
  summary: string;
  outcome: Record<string, unknown> | null;
  review: unknown;
}

interface WorkflowsFx {
  workflows: {
    workflow: {
      stages: {
        steps: { id: string; maxReturns: number; review?: unknown; results: unknown[] }[];
      }[];
    };
  }[];
}

function workflows(maxReturns: number, review = false): ControlSnapshot {
  const fx = adeFixture<WorkflowsFx>('workflows');
  const tests = fx.workflows[0]?.workflow.stages[1]?.steps.find((s) => s.id === 'tests');
  if (tests) {
    tests.maxReturns = maxReturns;
    if (review) tests.review = { sendTo: 'implementer', implementer: '' };
    tests.results = [
      { id: 'approved', ok: true, description: '', next: 'next', loop: false },
      { id: 'changes', ok: false, description: '', next: 'impl', loop: true },
    ];
  }
  return { channel: IPC.adeTaskWorkflows, response: fx };
}

function board(from: ContractRun): ControlSnapshot[] {
  const edit = (b: AdeBoardFx): void => {
    const run = b.tasks
      .find((x) => x.id === 'T_push')
      ?.runs.find((r) => r.stepId === 'tests' && r.branchId === 'b_push');
    if (!run) throw new Error('T_push tests run missing');
    Object.assign(run, {
      state: from.state,
      loops: from.loops,
      returns: from.returns,
      note: from.note,
      summary: from.summary,
      outcome: from.outcome,
      review: from.review,
    });
  };
  return [{ channel: IPC.adeTaskBoard, response: adeBoard(edit) }, ...runPreviewSnapshots()];
}

async function open(page: Page): Promise<void> {
  await page
    .locator(`[data-testid="ade-card"][data-task-id="T_push"] [data-testid="ade-card-head"]`)
    .click();
  await expect(page.locator(t('ade-panel'))).toBeVisible();
}

const testsLine = (page: Page) =>
  page
    .locator(`${t('ade-stage-block')}[data-stage-id="impl"]`)
    .locator(`${t('ade-run-line')}[data-branch-id="b_push"]`)
    .filter({ has: page.locator(t('ade-run-returns')) });

test('contract: a step that spent its returns shows the count, the stop note and Retry', async ({
  relaunch,
}) => {
  const stopped = contract<ContractRun>('ade-return-limit', 'AdeTaskService.Run#stopped');
  expect(stopped.returns).toBe(2);
  const { window: page } = await openPlan(relaunch, [workflows(2), ...board(stopped)]);
  await open(page);
  const line = testsLine(page);
  await expect(line.locator(t('ade-run-status'))).toHaveText('Failed');
  await expect(line.locator(t('ade-run-note'))).toHaveText(stopped.note);
  const chip = line.locator(t('ade-run-returns'));
  await expect(chip).toHaveText('↩ 2/2');
  await expect(chip).toHaveAttribute('data-spent', 'true');
  await expect(line.locator(t('ade-run-retry'))).toBeVisible();
});

test('contract: a step sent back shows how many returns it has used', async ({ relaunch }) => {
  const back = contract<ContractRun>('ade-return-limit', 'AdeTaskService.Run#back');
  expect(back.returns).toBe(1);
  const { window: page } = await openPlan(relaunch, [workflows(2), ...board(back)]);
  await open(page);
  const chip = testsLine(page).locator(t('ade-run-returns'));
  await expect(chip).toHaveText('↩ 1/2');
  await expect(chip).toHaveAttribute('data-spent', 'false');
});

test('contract: a review step without a limit counts returns and shows no limit', async ({
  relaunch,
}) => {
  const review = contract<ContractRun>('ade-return-limit', 'AdeTaskService.Run#review');
  expect(review.returns).toBe(4);
  const { window: page } = await openPlan(relaunch, [workflows(0, true), ...board(review)]);
  await open(page);
  const chip = testsLine(page).locator(t('ade-run-returns'));
  await expect(chip).toHaveText('↩ 4');
  await chip.hover();
  await expect(page.getByText('Returned 4 times, no limit')).toBeVisible();
});

test('contract: the editor saves Max returns as the backend takes it', async ({ relaunch }) => {
  const sent = contract<{
    workflow: { stages: { steps: { id: string; maxReturns: number }[] }[] };
  }>('ade-return-limit', 'args:AdeTaskService.SaveWorkflow');
  const want = sent.workflow.stages[0]?.steps.find((s) => s.id === 'impl')?.maxReturns;
  expect(want).toBe(5);
  const { window: page, control } = await openPlan(relaunch, [workflows(5)]);
  await page.locator(t('ade-tab-workflows')).click();
  await page.locator(t('ade-workflows')).waitFor();
  await page.locator(`${t('ade-wf-node')}[data-step-id="tests"]`).click();
  const field = page.locator(t('ade-wf-step-max-returns'));
  await expect(field).toHaveValue('5');
  await expect(field).toHaveAttribute('min', '1');
  await field.fill('4');
  await expect(
    page.locator(`${t('ade-wf-node')}[data-step-id="tests"]`).locator(t('ade-wf-node-returns')),
  ).toHaveText('↩ ≤4');
  await page.locator(t('ade-wf-step-mode-review')).click();
  await expect(field).toHaveAttribute('min', '0');
  await field.fill('0');
  await expect(field).toHaveValue('0');
  await page.locator(t('ade-wf-save')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(1);
  const args = calls(control, IPC.adeTaskSaveWorkflow)[0]?.args as {
    workflow: { stages: { steps: { id: string; maxReturns: number }[] }[] };
  };
  const steps = args.workflow.stages.flatMap((s) => s.steps);
  expect(steps.find((s) => s.id === 'tests')?.maxReturns).toBe(0);
});
