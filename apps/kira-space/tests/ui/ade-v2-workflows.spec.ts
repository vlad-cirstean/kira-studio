import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { adeFixture, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// The Workflows page: list, Form and YAML editors, import and new.

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

test('the form saves on Save, never on its own, with ids unchanged', async ({ relaunch }) => {
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
  const stage = page.locator(t('ade-wf-stage')).nth(1);
  await stage.locator(t('ade-wf-add-step')).click();
  await page.locator(t('ade-wf-save')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(1);
  const added = calls(control, IPC.adeTaskSaveWorkflow)[0]?.args as {
    workflow: { stages: { steps: { id: string }[] }[] };
  };
  expect(added.workflow.stages[1]?.steps.at(-1)?.id).toMatch(/^step-[0-9a-f]{8}$/);

  await stage
    .locator(t('ade-wf-step'))
    .first()
    .locator(t('ade-wf-step-tools'))
    .fill('Read, Grep, Bash(git diff:*)');
  await page.locator(t('ade-wf-save')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(2);
  const tools = calls(control, IPC.adeTaskSaveWorkflow)[1]?.args as {
    workflow: { stages: { steps: { allowedTools: string[] }[] }[] };
  };
  expect(tools.workflow.stages[1]?.steps[0]?.allowedTools).toEqual([
    'Read',
    'Grep',
    'Bash(git diff:*)',
  ]);
});

test('a later step can send back to an earlier one', async ({ relaunch }) => {
  const { window: page, control } = await openWorkflows(relaunch);
  const steps = page.locator(t('ade-wf-stage')).nth(1).locator(t('ade-wf-step'));
  await steps.nth(4).locator(t('ade-wf-step-fail')).selectOption('back:plan');
  await page.locator(t('ade-wf-save')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(1);
  const saved = calls(control, IPC.adeTaskSaveWorkflow)[0]?.args as {
    workflow: { stages: { steps: { id: string; onFailure: string }[] }[] };
  };
  expect(saved.workflow.stages[1]?.steps.find((x) => x.id === 'pr')?.onFailure).toBe('back:plan');
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

test('+ New creates a workflow and opens its form', async ({ relaunch }) => {
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

test('right-clicking a stage skips it, and the last runnable stage cannot be skipped', async ({
  relaunch,
}) => {
  const { window: page, control } = await openWorkflows(relaunch);
  const stages = page.locator(t('ade-wf-stage'));
  const skipItem = page.locator(t('menu-item-ade-wf-stage-skip'));
  await stages.nth(1).click({ button: 'right', position: { x: 10, y: 10 } });
  await skipItem.click();
  await expect(stages.nth(1).locator(t('ade-wf-stage-skipped'))).toBeVisible();
  await page.locator(t('ade-wf-save')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSaveWorkflow)).toHaveLength(1);
  const saved = calls(control, IPC.adeTaskSaveWorkflow)[0]?.args as {
    workflow: { stages: { id: string; skip: boolean }[] };
  };
  expect(saved.workflow.stages.map((s) => s.skip)).toEqual([false, true, false, false]);

  for (const i of [0, 2]) {
    await stages.nth(i).click({ button: 'right', position: { x: 10, y: 10 } });
    await skipItem.click();
  }
  await stages.nth(3).click({ button: 'right', position: { x: 10, y: 10 } });
  await expect(skipItem).toHaveAttribute('data-disabled', '');
});
