import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { adeFixture, openPlan } from './support/adeV2';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// The Workflows page: list, Graph and YAML editors, import and new.

interface WorkflowsFx {
  dir: string;
  workflows: { fileName: string; workflow: unknown; error: unknown; usedBy: number }[];
}

const t = (id: string) => `[data-testid="${id}"]`;

async function openWorkflows(
  relaunch: Parameters<typeof openPlan>[0],
  extra: readonly ControlSnapshot[] = [],
) {
  const app = await openPlan(relaunch, extra);
  await app.window.locator(t('ade-tab-workflows')).click();
  await app.window.locator(t('ade-workflows')).waitFor();
  return app;
}

function calls(control: { log(): { channel: string; args?: unknown }[] }, channel: string) {
  return control.log().filter((e) => e.channel === channel);
}

interface SavedWorkflow {
  workflow: {
    stages: {
      id: string;
      skip: boolean;
      steps: {
        id: string;
        allowedTools: string[];
        results: { id: string; ok: boolean; next: string; max: number; description: string }[];
      }[];
    }[];
  };
}

const node = (page: Page, step: string) =>
  page.locator(`${t('ade-wf-node')}[data-step-id="${step}"]`);
const chip = (page: Page, stage: string) =>
  page.locator(`${t('ade-wf-strip-chip')}[data-stage-id="${stage}"]`);

async function saved(
  page: Page,
  control: Parameters<typeof calls>[0],
  n: number,
): Promise<SavedWorkflow> {
  await page.locator(t('ade-wf-save')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(n);
  return calls(control, IPC.adeTaskSaveWorkflow)[n - 1]?.args as SavedWorkflow;
}

async function openYaml(page: Page): Promise<void> {
  await page.locator(t('ade-wf-mode-yaml')).click();
  await expect(page.locator(t('ade-wf-yaml'))).toBeVisible();
}

test('an empty folder shows the explanation', async ({ relaunch }) => {
  const { window: page } = await openWorkflows(relaunch, [
    { channel: IPC.adeTaskWorkflows, response: { dir: '~/.kira-space/workflows', workflows: [] } },
  ]);
  await expect(page.locator(t('ade-wf-empty'))).toContainText(
    'No workflows yet. Workflows are YAML files in ~/.kira-space/workflows.',
  );
});

test('the list shows each file with its stages and flags a broken one', async ({ relaunch }) => {
  const fx = adeFixture<WorkflowsFx>('workflows');
  const { window: page } = await openWorkflows(relaunch);
  await expect(page.locator(t('ade-wf-row'))).toHaveCount(fx.workflows.length);
  const first = page.locator(t('ade-wf-row')).first();
  await expect(first.locator(t('ade-wf-row-name'))).toContainText('Standard feature');
  await expect(first.locator(t('ade-wf-row-stages'))).toContainText('Spec › Implement › Review');
  await expect(first.locator(t('ade-wf-row-used'))).toContainText('used by');
  await expect(page.locator(t('ade-wf-row-error'))).toHaveCount(1);
  await page.locator(t('ade-wf-row')).last().click();
  await expect(page.locator(t('ade-wf-yaml'))).toBeVisible();
});

test('the graph saves on Save, never on its own, with ids unchanged', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  await expect(page.locator(t('ade-wf-form'))).toBeVisible();
  const name = page.locator(t('ade-wf-form-name'));
  await name.fill('Standard feature v2');
  await page.waitForTimeout(1200);
  expect(calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(0);
  await page.locator(t('ade-wf-save')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(1);
  const args = calls(control, IPC.adeTaskSaveWorkflow)[0]?.args as {
    fileName: string;
    workflow: { id: string; name: string; stages: { id: string; steps: { id: string }[] }[] };
  };
  expect(args.fileName).toBe('standard.yaml');
  expect(args.workflow.name).toBe('Standard feature v2');
  expect(args.workflow.id).toBe('standard');
  expect(args.workflow.stages.map((s) => s.id)).toEqual(['spec', 'impl', 'review', 'release']);
  expect(args.workflow.stages[1]?.steps.map((s) => s.id)).toEqual([
    'plan',
    'impl',
    'tests',
    'ci',
    'pr',
  ]);
});

test('a new step gets a fresh id and Allowed tools becomes allowedTools', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  await chip(page, 'impl').click();
  await page.locator(t('ade-wf-add-step')).click();
  const added = await saved(page, control, 1);
  expect(added.workflow.stages[1]?.steps.at(-1)?.id).toMatch(/^step-[0-9a-f]{8}$/);

  await node(page, 'plan').click();
  await page.locator(t('ade-wf-step-tools')).fill('Read, Grep, Bash(git diff:*)');
  const tools = await saved(page, control, 2);
  expect(tools.workflow.stages[1]?.steps[0]?.allowedTools).toEqual([
    'Read',
    'Grep',
    'Bash(git diff:*)',
  ]);
});

test('the canvas has no up or down buttons', async ({ relaunch }) => {
  const { window: page } = await openWorkflows(relaunch);
  await node(page, 'plan').click();
  await expect(page.locator(t('ade-wf-step'))).toBeVisible();
  for (const id of ['ade-wf-step-up', 'ade-wf-step-down', 'ade-wf-stage-up', 'ade-wf-stage-down']) {
    await expect(page.locator(t(id))).toHaveCount(0);
  }
});

test('edges are green for ok results, red for not ok, and a loop is dashed', async ({
  relaunch,
}) => {
  const { window: page } = await openWorkflows(relaunch);
  await expect(page.locator(`${t('ade-wf-edge')}[data-tone="ok"]`).first()).toBeVisible();
  const loop = page.locator(`${t('ade-wf-edge')}[data-loop="true"]`);
  await expect(loop).toHaveCount(3);
  for (const e of await loop.all()) {
    await expect(e).toHaveAttribute('data-tone', 'fail');
    await expect(e).toHaveAttribute('data-results', 'failed');
  }
});

test('the route select sets where a result goes and saves it in results', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  await node(page, 'pr').click();
  const failed = page.locator(`${t('ade-wf-result')}[data-result="failed"]`);
  await failed.locator(t('ade-wf-result-route')).selectOption('plan');
  await expect(failed.locator(t('ade-wf-result-max'))).toHaveValue('3');
  await expect(page.locator(`${t('ade-wf-edge')}[data-loop="true"][data-tone="fail"]`)).toHaveCount(
    4,
  );
  const out = await saved(page, control, 1);
  const pr = out.workflow.stages[1]?.steps.find((x) => x.id === 'pr');
  expect(pr?.results.find((r) => r.id === 'failed')).toMatchObject({
    ok: false,
    next: 'plan',
    max: 3,
  });
});

test('contract: a result built in the editor saves as the backend takes it', async ({
  relaunch,
}) => {
  const sent = contract<{
    workflow: { stages: { steps: { id: string; results: Record<string, unknown>[] }[] }[] };
  }>('ade-workflow-results', 'args:AdeTaskService.SaveWorkflow');
  const want = sent.workflow.stages[0]?.steps
    .find((x) => x.id === 'review')
    ?.results.find((r) => r.id === 'changes');
  expect(want).toMatchObject({ next: 'impl', max: 2 });
  const { window: page, control } = await openWorkflows(relaunch);
  await node(page, 'tests').click();
  await page.locator(t('ade-wf-add-result')).click();
  const row = page.locator(t('ade-wf-result')).nth(2);
  await row.locator(t('ade-wf-result-id')).fill(String(want?.id));
  await row.locator(t('ade-wf-result-description')).fill(String(want?.description));
  if (want?.ok === false) await row.locator(t('ade-wf-result-ok')).click();
  await row.locator(t('ade-wf-result-route')).selectOption(String(want?.next));
  await row.locator(t('ade-wf-result-max')).fill(String(want?.max));
  const out = await saved(page, control, 1);
  const tests = out.workflow.stages[1]?.steps.find((x) => x.id === 'tests');
  expect(tests?.results.find((r) => r.id === 'changes')).toEqual(want);
});

test('dragging a result dot to another step sets its route', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  const dot = node(page, 'pr').locator(
    `${t('ade-wf-node-result')}[data-result="failed"] .vue-flow__handle`,
  );
  const target = node(page, 'impl').locator('[data-handleid="in"]');
  await dot.dragTo(target);
  const out = await saved(page, control, 1);
  const pr = out.workflow.stages[1]?.steps.find((x) => x.id === 'pr');
  expect(pr?.results.find((r) => r.id === 'failed')).toMatchObject({ next: 'impl', max: 3 });
});

test('a result added in the inspector gets its own connector', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  await node(page, 'ci').click();
  await expect(node(page, 'ci').locator(t('ade-wf-node-result'))).toHaveCount(2);
  await page.locator(t('ade-wf-add-result')).click();
  await expect(node(page, 'ci').locator(t('ade-wf-node-result'))).toHaveCount(3);
  const row = page.locator(t('ade-wf-result')).nth(2);
  await row.locator(t('ade-wf-result-id')).fill('flaky');
  await row.locator(t('ade-wf-result-route')).selectOption('end');
  const out = await saved(page, control, 1);
  const ci = out.workflow.stages[1]?.steps.find((x) => x.id === 'ci');
  expect(ci?.results.map((r) => [r.id, r.next])).toEqual([
    ['done', 'next'],
    ['failed', 'impl'],
    ['flaky', 'end'],
  ]);
});

test('Delete removes the selected step after asking', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  await node(page, 'ci').click();
  await page.locator(t('ade-wf-graph')).press('Delete');
  await page.locator(t('confirm-dialog-confirm')).click();
  await expect(node(page, 'ci')).toHaveCount(0);
  const out = await saved(page, control, 1);
  expect(out.workflow.stages[1]?.steps.map((x) => x.id)).toEqual(['plan', 'impl', 'tests', 'pr']);
});

test('dragging a stage chip reorders the stages', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  const from = await chip(page, 'review').boundingBox();
  const to = await chip(page, 'impl').boundingBox();
  if (!from || !to) throw new Error('stage chips not laid out');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 10 + 4, to.y + to.height / 2);
  await page.mouse.up();
  await expect(page.locator(t('ade-wf-strip-chip')).nth(1)).toHaveAttribute(
    'data-stage-id',
    'review',
  );
  const out = await saved(page, control, 1);
  expect(out.workflow.stages.map((x) => x.id)).toEqual(['spec', 'review', 'impl', 'release']);
});

test('a refused save shows the error and a Switch to YAML link', async ({ relaunch }) => {
  const { window: page } = await openWorkflows(relaunch, [
    {
      channel: IPC.adeTaskSaveWorkflow,
      error: { code: 'invalid', message: 'workflow file has comments; edit it in YAML' },
    },
  ]);
  await page.locator(t('ade-wf-form-name')).fill('Renamed');
  await page.locator(t('ade-wf-save')).click();
  await expect(page.locator(t('ade-wf-save-error'))).toContainText('edit it in YAML');
  await page.locator(t('ade-wf-switch-yaml')).click();
  await expect(page.locator(t('ade-wf-yaml'))).toBeVisible();
});

test('YAML mode validates while typing and saves the text on Save', async ({ relaunch }) => {
  const fx = adeFixture<WorkflowsFx>('workflows');
  const { window: page, control } = await openWorkflows(relaunch, [
    {
      channel: IPC.adeTaskValidateWorkflowYaml,
      response: { workflow: fx.workflows[0]?.workflow, error: null },
    },
  ]);
  await openYaml(page);
  const area = page.locator(t('ade-wf-yaml'));
  await area.fill(`${await area.inputValue()}\n# note\n`);
  await expect(page.locator(t('ade-wf-yaml-msg'))).toContainText(
    '✓ valid · the form and the plan use this file',
  );
  expect(calls(control, IPC.adeTaskSaveWorkflowYaml)).toHaveLength(0);
  await page.locator(t('ade-wf-save')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveWorkflowYaml)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskSaveWorkflowYaml)[0]?.args).toMatchObject({
    fileName: 'standard.yaml',
  });
});

test('an invalid YAML shows its line and keeps the last valid version', async ({ relaunch }) => {
  const { window: page } = await openWorkflows(relaunch, [
    {
      channel: IPC.adeTaskValidateWorkflowYaml,
      response: {
        workflow: null,
        error: { line: 7, message: 'kind must be user, agent or script' },
      },
    },
  ]);
  await openYaml(page);
  await page.locator(t('ade-wf-yaml')).fill('id: x\n');
  await expect(page.locator(t('ade-wf-yaml-msg'))).toContainText(
    '✕ line 7: kind must be user, agent or script (the last valid version stays in use)',
  );
});

test('line 0 shows the message alone', async ({ relaunch }) => {
  const { window: page } = await openWorkflows(relaunch);
  await openYaml(page);
  await page.locator(t('ade-wf-yaml')).fill('id: x\n');
  await expect(page.locator(t('ade-wf-yaml-msg'))).toContainText(
    '✕ stage 4: kind must be user, agent or script',
  );
  await expect(page.locator(t('ade-wf-yaml-msg'))).not.toContainText('✕ ✕');
});

test('Copy YAML confirms the copy', async ({ relaunch }) => {
  const { window: page } = await openWorkflows(relaunch);
  const copy = page.locator(t('ade-wf-copy'));
  await expect(copy).toHaveText('Copy YAML');
  await copy.click();
  await expect(copy).toHaveText('Copied');
});

test('Import sends the typed path and opens YAML mode', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  await page.locator(t('ade-wf-import')).click();
  await page.locator(t('ade-wf-import-path')).fill('/tmp/shared/release.yaml');
  await page.locator(t('ade-wf-import-go')).click();
  await expect.poll(() => calls(control, IPC.adeTaskImportWorkflow)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskImportWorkflow)[0]?.args).toEqual({
    path: '/tmp/shared/release.yaml',
  });
  await expect(page.locator(t('ade-wf-yaml'))).toBeVisible();
});

test('+ New creates a workflow and opens its graph', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  await page.locator(t('ade-wf-new')).click();
  await expect.poll(() => calls(control, IPC.adeTaskNewWorkflow)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskNewWorkflow)[0]?.args).toEqual({ name: 'New workflow' });
  await expect(page.locator(t('ade-wf-form'))).toBeVisible();
});

test('Discard restores the saved form, and leaving with edits asks first', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  const name = page.locator(t('ade-wf-form-name'));
  const saved = await name.inputValue();
  await expect(page.locator(t('ade-wf-save'))).toBeDisabled();
  await name.fill('Edited');
  await expect(page.locator(t('ade-wf-save'))).toBeEnabled();
  await page.locator(t('ade-wf-discard')).click();
  await expect(name).toHaveValue(saved);
  await expect(page.locator(t('ade-wf-save'))).toBeDisabled();

  await name.fill('Edited again');
  await page.locator(t('ade-tab-plan')).click();
  await expect(page.locator(t('confirm-dialog'))).toBeVisible();
  await page.locator(t('confirm-dialog-cancel')).click();
  await expect(page.locator(t('ade-workflows'))).toBeVisible();
  await expect(name).toHaveValue('Edited again');
  await page.locator(t('ade-tab-plan')).click();
  await page.locator(t('confirm-dialog-confirm')).click();
  await expect(page.locator(t('ade-plan'))).toBeVisible();
  expect(calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(0);
});

test('Ctrl+S saves the open editor', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  const name = page.locator(t('ade-wf-form-name'));
  await name.fill('Via shortcut');
  await name.press('Control+s');
  await expect.poll(() => calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(1);
});

test('the stage menu skips a stage, and the last runnable stage cannot be skipped', async ({
  relaunch,
}) => {
  const { window: page, control } = await openWorkflows(relaunch);
  const skipItem = page.locator(t('ade-wf-stage-skip'));
  const skip = async (id: string): Promise<void> => {
    await chip(page, id).click();
    await page.locator(t('ade-wf-stage-menu')).click();
    await skipItem.click();
  };
  await skip('impl');
  await expect(chip(page, 'impl')).toHaveAttribute('data-skipped', 'true');
  const out = await saved(page, control, 1);
  expect(out.workflow.stages.map((s) => s.skip)).toEqual([false, true, false, false]);

  await skip('spec');
  await skip('review');
  await chip(page, 'release').click();
  await page.locator(t('ade-wf-stage-menu')).click();
  await expect(skipItem).toHaveAttribute('data-disabled', '');
});

test('the Kira Space tools switch saves with the workflow', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  const toggle = page.locator(t('ade-wf-form-space'));
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await page.locator(t('ade-wf-save')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(1);
  const args = calls(control, IPC.adeTaskSaveWorkflow)[0]?.args as {
    workflow: { kiraSpaceMcp: boolean };
  };
  expect(args.workflow.kiraSpaceMcp).toBe(true);
});

test('leaving Agents with unsaved edits asks first', async ({ relaunch }) => {
  const { window: page } = await openWorkflows(relaunch);
  const name = page.locator(t('ade-wf-form-name'));
  await name.fill('Edited');
  const terminal = page.locator('[data-testid="mode-tab"][data-mode="automations"]');
  await terminal.click();
  await expect(page.locator(t('confirm-dialog'))).toBeVisible();
  await page.locator(t('confirm-dialog-cancel')).click();
  await expect(name).toHaveValue('Edited');
  await terminal.click();
  await page.locator(t('confirm-dialog-confirm')).click();
  await expect(terminal).toHaveClass(/is-active/);
});
