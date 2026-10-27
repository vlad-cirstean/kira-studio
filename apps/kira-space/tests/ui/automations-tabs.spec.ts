import { registerTabScenarios } from '@workbench/testing/ui/scenarios/automationsTabs';
import { expect, test } from './fixtures';
import { openPlan, SCRIPTS, SMART } from './support/adeV2';
import { contract } from './support/contract';
import { calls } from './support/ipcCalls';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// P380: one tab per script, play-only start. Backend half: termflow TestScriptRunTwice.

registerTabScenarios(
  { test, contract, ipc: IPC },
  {
    extraBase: [{ channel: IPC.windowsEnsure, response: { mode: 'git' } }],
    modeTab: (page) => page.locator('[data-testid="mode-tab"][data-mode="automations"]'),
  },
);

// ADE: the key includes the task, so two tasks run one script side by side; a repeat for a task
// whose run is live focuses its tab.
const t = (id: string) => `[data-testid="${id}"]`;
const START = { scriptId: 'smart-1', params: {}, branchId: '', listTasks: false, hash: 'h1' };

function adeRun(id: string, taskId: string) {
  return {
    id,
    scriptId: 'smart-1',
    scriptName: 'Review diff',
    color: 'none',
    kind: 'smart',
    trigger: 'manual',
    state: 'running',
    terminalId: '',
    cwd: '/wt',
    command: '',
    outcome: null,
    createdAt: 1_000,
    startedAt: 1_000,
    finishedAt: null,
    model: 'sonnet',
    sessionId: 's1',
    prompt: 'Review.',
    params: [],
    tools: { tools: [], allowedTools: [], mcpServers: [] },
    taskId,
    taskTitle: taskId,
    branchId: '',
    branchLabel: '',
  };
}

test('ADE: one tab per script and task; a live repeat focuses instead of starting', async ({
  relaunch,
}) => {
  const preview = {
    kind: 'smart',
    missing: [],
    blocker: '',
    dir: { path: '/wt', mode: 'worktree', base: '/kira', blocker: '', branch: '', pending: false },
    body: SMART.command,
    prompt: [{ text: SMART.command, var: '', value: '' }],
    suffix: '',
    env: [],
    command: '',
    model: 'sonnet',
    maxBudgetUsd: 1,
    timeout: '15m',
    tools: ['Read'],
    allowedTools: ['Read'],
    mcpServers: [],
    hash: 'h1',
    needs: { tasks: [], branches: [] },
    ade: null,
  };
  const { window: page, control } = await openPlan(relaunch, [
    SCRIPTS,
    { channel: IPC.scriptRunsPreview, response: preview },
    { channel: IPC.scriptRunsList, response: [] },
    { channel: IPC.scriptRunsReadLog, response: { chunks: [], truncated: false } },
    {
      channel: IPC.scriptRunsStart,
      args: { ...START, prompt: null, taskId: 'T_alerts' },
      response: { runId: 'run-1', terminal: null },
    },
    {
      channel: IPC.scriptRunsStart,
      args: { ...START, prompt: null, taskId: 'T_bill' },
      response: { runId: 'run-2', terminal: null },
    },
  ]);
  const tabs = page.locator('[data-testid="tab-strip-wrapper"] [data-testid="tab"]');
  const dialog = page.locator(t('run-dialog'));

  async function startFor(taskId: string): Promise<void> {
    await page
      .locator(`[data-testid="ade-card"][data-task-id="${taskId}"]`)
      .click({ button: 'right', position: { x: 60, y: 30 } });
    await page.locator(t('menu-item-ade-task-automation')).click();
    await page.locator(t('menu-item-ade-automation-smart-1')).click();
  }

  await startFor('T_alerts');
  await expect(dialog.locator(t('run-start'))).toBeEnabled();
  await dialog.locator(t('run-start')).click();
  await emitWailsEvent(page, IPC.scriptRunsChanged, adeRun('run-1', 'T_alerts'));
  await startFor('T_bill');
  await expect(dialog.locator(t('run-start'))).toBeEnabled();
  await dialog.locator(t('run-start')).click();
  await emitWailsEvent(page, IPC.scriptRunsChanged, adeRun('run-2', 'T_bill'));
  await expect.poll(() => calls(control, IPC.scriptRunsStart)).toHaveLength(2);

  await page.locator('[data-testid="mode-tab"][data-mode="automations"]').click();
  await expect(tabs).toHaveCount(2);

  await page.locator('[data-testid="mode-tab"][data-mode="ade"]').click();
  await startFor('T_alerts');
  await expect(dialog).toHaveCount(0);
  expect(calls(control, IPC.scriptRunsStart)).toHaveLength(2);
  await expect(tabs).toHaveCount(2);
});
