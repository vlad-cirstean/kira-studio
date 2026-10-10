import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  type AdeBoardFx,
  adeBoard,
  adeFixture,
  emitLog,
  emitRuns,
  openPlan,
} from './support/adeV2';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// Workflow block, run lines, the Run dialog and the stage actions on the Plan.

const t = (id: string) => `[data-testid="${id}"]`;
const task = (id: string) => `[data-testid="ade-task"][data-task-id="${id}"]`;
const cellAction = (id: string, kind: string) =>
  `${task(id)} ${t('ade-task-cells')} ${t(`ade-task-action-${kind}`)}`;

function boardWith(edit: (b: AdeBoardFx) => void): ControlSnapshot[] {
  return [{ channel: IPC.adeTaskBoard, response: adeBoard(edit) }];
}

function calls(control: { log(): { channel: string; args?: unknown }[] }, channel: string) {
  return control.log().filter((e) => e.channel === channel);
}

async function open(page: Page, id: string): Promise<void> {
  await page
    .locator(`[data-testid="ade-card"][data-task-id="${id}"] [data-testid="ade-card-head"]`)
    .click();
  await expect(page.locator(t('ade-panel'))).toBeVisible();
}

const stage = (page: Page, stageId: string) =>
  page.locator(`${t('ade-stage-block')}[data-stage-id="${stageId}"]`);

/** T_alerts moved to a not yet started Implement stage of the standard workflow. */
function alertsInImpl(b: AdeBoardFx): void {
  const bill = b.tasks.find((x) => x.id === 'T_bill');
  const alerts = b.tasks.find((x) => x.id === 'T_alerts');
  if (!bill || !alerts) throw new Error('fixture tasks missing');
  alerts.stageId = 'impl';
  alerts.workflowId = 'standard';
  alerts.currentStage = bill.currentStage;
  alerts.runs = [];
}

test('the Workflow select sends SetTaskWorkflow', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await open(page, 'T_bill');
  await page.locator(t('ade-workflow-select')).selectOption('bugfix');
  await expect.poll(() => calls(control, IPC.adeTaskSetTaskWorkflow)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskSetTaskWorkflow)[0]?.args).toEqual({
    taskId: 'T_bill',
    workflowId: 'bugfix',
  });
});

test('Edit workflows opens the Workflows page', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await open(page, 'T_bill');
  await page.locator(t('ade-edit-workflows')).click();
  await expect(page.locator(t('ade-workflows'))).toBeVisible();
});

test('the Run dialog shows the default message and the read-only suffix', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, boardWith(alertsInImpl));
  await page.locator(cellAction('T_alerts', 'run')).click();
  const dialog = page.locator(t('ade-run-dialog'));
  await expect(dialog).toContainText('Run Implement in the background');
  await expect(dialog.locator(t('ade-run-branch'))).toHaveCount(2);
  const msg = dialog.locator(t('ade-run-message'));
  await expect(msg).toHaveValue(
    /^Task: .*\n- Jira: PAY-130 \S+\n- Repo: \{repo\} · Branch: \{branch\} · Worktree: \{worktree\}\nStep 1\/5: Plan from spec\n/,
  );
  await expect(dialog.locator(t('ade-run-suffix'))).toContainText('call the finish_step tool');
  await expect(msg).not.toHaveValue(/finish_step/);

  await dialog.locator(t('ade-run-branch')).nth(1).fill('feat/alerts-web');
  await dialog.locator(t('ade-run-send')).click();
  await expect.poll(() => calls(control, IPC.adeTaskStartRun)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskStartRun)[0]?.args).toEqual({
    taskId: 'T_alerts',
    branchNames: { d_alerts_api: '', d_alerts_web: 'feat/alerts-web' },
    message: '',
  });
  await expect(dialog).toBeHidden();
});

test('the Run dialog asks no branch names when the workflow has Kira Space tools', async ({
  relaunch,
}) => {
  const wfs = adeFixture<{ workflows: { workflow: { kiraSpaceMcp: boolean } }[] }>('workflows');
  for (const w of wfs.workflows) if (w.workflow) w.workflow.kiraSpaceMcp = true;
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: adeBoard(alertsInImpl) },
    { channel: IPC.adeTaskWorkflows, response: wfs },
  ]);
  await page.locator(cellAction('T_alerts', 'run')).click();
  const dialog = page.locator(t('ade-run-dialog'));
  await expect(dialog.locator(t('ade-run-message'))).toBeVisible();
  await expect(dialog.locator(t('ade-run-branch'))).toHaveCount(0);
  await dialog.locator(t('ade-run-send')).click();
  await expect.poll(() => calls(control, IPC.adeTaskStartRun)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskStartRun)[0]?.args).toEqual({
    taskId: 'T_alerts',
    branchNames: {},
    message: '',
  });
});

test('an edited message is sent and Reset restores the default', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, boardWith(alertsInImpl));
  await page.locator(cellAction('T_alerts', 'run')).click();
  const dialog = page.locator(t('ade-run-dialog'));
  const msg = dialog.locator(t('ade-run-message'));
  const original = await msg.inputValue();
  await msg.fill('Do it differently');
  await dialog.locator(t('ade-run-reset')).click();
  await expect(msg).toHaveValue(original);
  await msg.fill('Do it differently');
  await dialog.locator(t('ade-run-send')).click();
  await expect.poll(() => calls(control, IPC.adeTaskStartRun)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskStartRun)[0]?.args).toMatchObject({
    message: 'Do it differently',
  });
});

test('Cancel closes the Run dialog without a call', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, boardWith(alertsInImpl));
  await page.locator(cellAction('T_alerts', 'run')).click();
  await page.locator(t('ade-run-cancel')).click();
  await expect(page.locator(t('ade-run-dialog'))).toBeHidden();
  expect(calls(control, IPC.adeTaskStartRun)).toHaveLength(0);
});

test('a pushed runs event updates the step line', async ({ relaunch }) => {
  const ev = adeFixture<{ runs: Record<string, unknown>[] }>('event-runs');
  const { window: page } = await openPlan(relaunch);
  await open(page, 'T_bill');
  const line = stage(page, 'impl').locator('[data-testid="ade-run-line"][data-branch-id="b_bill"]');
  await expect(line.locator(t('ade-run-status'))).toHaveText('running');
  await emitRuns(page, [{ ...ev.runs[0], state: 'done' }]);
  await expect(line.locator(t('ade-run-glyph'))).toHaveText('✓');
  await expect(line.locator(t('ade-run-status'))).toHaveText('done');
});

test('Approve sends the gated step', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(
    relaunch,
    boardWith((b) => {
      const hooks = b.tasks.find((x) => x.id === 'T_hooks');
      if (hooks) hooks.runs = hooks.runs.filter((r) => r.stepId !== 'pr');
    }),
  );
  await page.locator(cellAction('T_hooks', 'approve')).click();
  await expect.poll(() => calls(control, IPC.adeTaskApprove)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskApprove)[0]?.args).toEqual({
    taskId: 'T_hooks',
    stageId: 'impl',
    stepId: 'pr',
  });
});

test('Retry re-runs a failed script run', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await page.locator(cellAction('T_cart', 'retry')).click();
  await expect.poll(() => calls(control, IPC.adeTaskRetryRun)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskRetryRun)[0]?.args).toEqual({
    runId: 'r_T_cart_release_b_cart',
  });
});

test('Retry also covers a stuck run and the step line offers it', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(
    relaunch,
    boardWith((b) => {
      const cart = b.tasks.find((x) => x.id === 'T_cart');
      const run = cart?.runs.find((r) => r.id === 'r_T_cart_release_b_cart');
      if (run) run.state = 'stuck';
    }),
  );
  await open(page, 'T_cart');
  await stage(page, 'release').locator(t('ade-run-retry')).click();
  await expect.poll(() => calls(control, IPC.adeTaskRetryRun)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskRetryRun)[0]?.args).toEqual({
    runId: 'r_T_cart_release_b_cart',
  });
});

test('Done and Finish call StageDone', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(
    relaunch,
    boardWith((b) => {
      const cart = b.tasks.find((x) => x.id === 'T_cart');
      const run = cart?.runs.find((r) => r.id === 'r_T_cart_release_b_cart');
      if (run) run.state = 'done';
      for (const r of b.tasks.find((x) => x.id === 'T_hooks')?.runs ?? []) r.state = 'done';
    }),
  );
  await page.locator(cellAction('T_hooks', 'done')).click();
  await expect.poll(() => calls(control, IPC.adeTaskStageDone)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskStageDone)[0]?.args).toEqual({ taskId: 'T_hooks' });
  await page.locator(cellAction('T_cart', 'finish')).click();
  await expect.poll(() => calls(control, IPC.adeTaskStageDone)).toHaveLength(2);
  expect(calls(control, IPC.adeTaskStageDone)[1]?.args).toEqual({ taskId: 'T_cart' });
});

test('a failed action shows its error in the panel', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskRetryRun, error: { code: 'invalid', message: 'run is not failed' } },
  ]);
  await page.locator(cellAction('T_cart', 'retry')).click();
  await expect(page.locator(t('ade-panel-action-error'))).toContainText('run is not failed');
});

test('a send-back shows on the step line with its loop and note', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await open(page, 'T_push');
  const impl = stage(page, 'impl');
  await expect(impl.locator(t('ade-run-status')).filter({ hasText: 'sent back' })).toHaveCount(1);
  await expect(
    impl.locator(t('ade-run-note')).filter({ hasText: '2 failing tests' }),
  ).not.toHaveCount(0);
});

// Same scenario as the flows/adeflow branching test: a review step whose `changes` result loops back to
// Implement, here with the stored run outcome the backend writes.
function branchingWorkflows(max = 3): ControlSnapshot {
  const fx = adeFixture<{
    workflows: {
      workflow: { stages: { steps: { id: string; results: unknown[] }[] }[] };
    }[];
  }>('workflows');
  const steps = fx.workflows[0]?.workflow.stages[1]?.steps ?? [];
  // The fixture's other back edge to Implement (ci, max 3) would set the budget instead.
  const ci = steps.find((x) => x.id === 'ci');
  if (ci) ci.results = [{ id: 'done', ok: true, description: '', next: 'next', max: 0 }];
  const tests = steps.find((x) => x.id === 'tests');
  if (tests)
    tests.results = [
      { id: 'approved', ok: true, description: '', next: 'next', max: 0 },
      { id: 'changes', ok: false, description: '', next: 'impl', max },
    ];
  return { channel: IPC.adeTaskWorkflows, response: fx };
}

test('a result that loops back shows its route on the step and the sent-back line', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch, [
    branchingWorkflows(),
    ...boardWith((b) => {
      const run = b.tasks
        .find((x) => x.id === 'T_push')
        ?.runs.find((r) => r.stepId === 'tests' && r.state === 'back');
      if (run)
        run.outcome = {
          status: 'failed',
          reason: '2 failing tests',
          source: 'agent',
          reported: true,
          result: 'changes',
          route: 'back:impl',
        };
    }),
  ]);
  await open(page, 'T_push');
  const impl = stage(page, 'impl');
  await expect(
    impl.locator(t('ade-step-route')).filter({ hasText: 'changes ↩ Implement (max 3)' }),
  ).toHaveCount(1);
  await expect(impl.locator(t('ade-run-status')).filter({ hasText: 'sent back' })).toHaveCount(1);
});

interface ContractRun {
  state: string;
  loops: number;
  note: string;
  summary: string;
  outcome: Record<string, unknown>;
}

// Backend values (flows/adeflow TestBranching, contract ade-branching) onto the fixture's b_push runs.
function placeRun(b: AdeBoardFx, stepId: string, from: ContractRun): void {
  const run = b.tasks
    .find((x) => x.id === 'T_push')
    ?.runs.find((r) => r.stepId === stepId && r.branchId === 'b_push');
  if (!run) throw new Error(`T_push ${stepId} run missing`);
  Object.assign(run, {
    state: from.state,
    loops: from.loops,
    note: from.note,
    summary: from.summary,
    outcome: from.outcome,
  });
}

test("contract: a fix round counts against its result's loop budget", async ({ relaunch }) => {
  const rerun = contract<ContractRun>('ade-branching', 'AdeTaskService.Run#impl-rerun');
  const back = contract<ContractRun>('ade-branching', 'AdeTaskService.Run#review-back');
  const { workflows } = contract<{
    workflows: {
      workflow: { stages: { steps: { id: string; results: { max: number }[] }[] }[] };
    }[];
  }>('ade-branching', 'AdeTaskService.Workflows');
  const budget = workflows[0]?.workflow.stages[0]?.steps
    .find((s) => s.id === 'review')
    ?.results.find((r) => r.max > 0)?.max;
  expect(budget).toBe(2);
  const { window: page } = await openPlan(relaunch, [
    branchingWorkflows(budget),
    ...boardWith((b) => {
      placeRun(b, 'impl', rerun);
      placeRun(b, 'tests', back);
    }),
  ]);
  await open(page, 'T_push');
  await expect(
    stage(page, 'impl').locator(t('ade-run-note')).filter({ hasText: 'fix round 1 of 2' }),
  ).toHaveCount(1);
  await expect(
    stage(page, 'impl').locator(t('ade-run-note')).filter({ hasText: back.note }),
  ).toHaveCount(1);
});

test('contract: a run without claude on PATH shows its reason', async ({ relaunch }) => {
  const failed = contract<ContractRun>('ade-run-errors', 'AdeTaskService.Run#no-claude');
  const { window: page } = await openPlan(
    relaunch,
    boardWith((b) => placeRun(b, 'impl', failed)),
  );
  await open(page, 'T_push');
  const line = stage(page, 'impl')
    .locator(`${t('ade-run-line')}[data-branch-id="b_push"]`)
    .filter({ has: page.locator(t('ade-run-retry')) });
  await expect(line.locator(t('ade-run-status'))).toHaveText('failed');
  await expect(line.locator(t('ade-run-note'))).toHaveText(failed.outcome.reason as string);
  await expect(line.locator(t('ade-run-retry'))).toBeVisible();
});

test('contract: a spent loop shows the result and that the stage stopped', async ({ relaunch }) => {
  const spent = contract<ContractRun>('ade-branching', 'AdeTaskService.Run#review-spent');
  const { window: page } = await openPlan(
    relaunch,
    boardWith((b) => {
      const run = b.tasks
        .find((x) => x.id === 'T_cart')
        ?.runs.find((r) => r.id === 'r_T_cart_release_b_cart');
      if (run) run.outcome = { ...spent.outcome, report: { tried: 'retry' } };
    }),
  );
  await open(page, 'T_cart');
  const out = page.locator(t('ade-run-outcome'));
  await expect(out.locator(t('ade-outcome-result'))).toHaveText('changes');
  await expect(out.locator(t('ade-outcome-route'))).toHaveText('stopped');
  await expect(out).toContainText(spent.note);
});

test('Log opens the run log and appends pushed chunks', async ({ relaunch }) => {
  const page0 = await openPlan(relaunch);
  const page = page0.window;
  await open(page, 'T_bill');
  const line = stage(page, 'impl').locator('[data-testid="ade-run-line"][data-branch-id="b_bill"]');
  await line.locator(t('ade-run-log-toggle')).click();
  const log = page.locator(t('ade-run-log'));
  await expect(log).toBeVisible();
  const before = await log.locator(t('ade-run-log-line')).count();
  expect(before).toBeGreaterThan(0);
  const lastSeq = 99;
  await emitLog(page, 'run', 'r_T_bill_impl_b_bill', [
    { seq: lastSeq, at: 1790067600000, stream: 'event', text: 'Edit src/appended.ts' },
  ]);
  await expect(log).toContainText('Edit src/appended.ts');
});

test('a script run offers Output, and the Release block lists the branches', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch);
  await open(page, 'T_cart');
  await expect(stage(page, 'release').locator(t('ade-run-log-toggle'))).toHaveText('Output');
  await expect(stage(page, 'release').locator(t('ade-release-row'))).toHaveCount(1);
});

// Contract ade-run. Backend half: adeflow TestRunLifecycle ("approval, logs and stage done"). Fixture
// ids replace the backend's; every other field is the backend's.
test('contract: a finished step run shows done', async ({ relaunch }) => {
  const one = contract<Record<string, unknown>>('ade-run', 'AdeTaskService.Run#one-done');
  const { window: page } = await openPlan(relaunch);
  await open(page, 'T_bill');
  const line = stage(page, 'impl').locator('[data-testid="ade-run-line"][data-branch-id="b_bill"]');
  await expect(line.locator(t('ade-run-status'))).toHaveText('running');
  await emitRuns(page, [
    {
      ...one,
      id: 'r_T_bill_impl_b_bill',
      taskId: 'T_bill',
      stageId: 'impl',
      stepId: 'impl',
      branchId: 'b_bill',
      startedAt: 1_790_035_200_000,
      finishedAt: 1_790_035_300_000,
    },
  ]);
  await expect(line.locator(t('ade-run-glyph'))).toHaveText('✓');
  await expect(line.locator(t('ade-run-status'))).toHaveText(String(one.state));
});

test('contract: Approve sends the arguments the backend takes', async ({ relaunch }) => {
  const approve = contract<Record<string, unknown>>('ade-run', 'args:AdeTaskService.Approve');
  const { window: page, control } = await openPlan(
    relaunch,
    boardWith((b) => {
      const hooks = b.tasks.find((x) => x.id === 'T_hooks');
      if (hooks) hooks.runs = hooks.runs.filter((r) => r.stepId !== 'pr');
    }),
  );
  await page.locator(cellAction('T_hooks', 'approve')).click();
  await expect.poll(() => calls(control, IPC.adeTaskApprove)).toHaveLength(1);
  const sent = calls(control, IPC.adeTaskApprove)[0]?.args as Record<string, unknown>;
  expect(Object.keys(sent).sort()).toEqual(Object.keys(approve).sort());
});
