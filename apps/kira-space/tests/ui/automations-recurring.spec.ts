import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import { emitPrompts, routed } from './support/prompts';
import type { ControlSnapshot } from './support/types';

// P242 Part 4: recurring scripts on the mocked bridge: the editor's schedule, rows, the confirm popup.

const SCHEDULE = {
  cron: '0 9 * * 1-5',
  timezone: 'UTC',
  enabled: true,
  confirm: true,
  timeout: '30m',
  params: {},
  taskId: '',
  branchId: '',
};

const SCRIPT = {
  id: 'rec-1',
  kind: 'script',
  name: 'Nightly build',
  command: 'make build',
  params: [],
  smart: null,
  schedule: SCHEDULE,
  workingDir: '',
  dirMode: 'kira',
  useAdeDir: false,
  color: 'blue',
  collectionId: null,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const DIR = {
  path: '/kira/automations/rec-1',
  mode: 'kira',
  base: '/kira',
  blocker: '',
  branch: '',
  pending: false,
};

const FIRES = [1_900_000_000_000, 1_900_086_400_000, 1_900_172_800_000];

const PREVIEW = {
  kind: 'script',
  missing: [],
  blocker: '',
  dir: DIR,
  body: SCRIPT.command,
  prompt: [],
  suffix: '',
  env: [],
  command: 'make build',
  model: '',
  maxBudgetUsd: 0,
  timeout: '30m',
  tools: [],
  allowedTools: [],
  mcpServers: [],
  hash: 'sched-h1',
  needs: { tasks: [], branches: [] },
  ade: null,
};

function run(state: string, extra: Record<string, unknown> = {}) {
  const ended = state !== 'running' && state !== 'waiting';
  return {
    id: 'run-w',
    scriptId: SCRIPT.id,
    scriptName: SCRIPT.name,
    color: 'blue',
    kind: 'script',
    trigger: 'scheduled',
    state,
    terminalId: '',
    cwd: DIR.path,
    command: 'make build',
    outcome: ended ? { status: state, reason: 'done', source: 'exit', reported: false } : null,
    createdAt: 2_000,
    startedAt: state === 'waiting' ? null : 2_000,
    finishedAt: ended ? 3_000 : null,
    model: '',
    sessionId: '',
    prompt: '',
    params: [],
    tools: { tools: [], allowedTools: [], mcpServers: [] },
    taskId: '',
    taskTitle: '',
    branchId: '',
    branchLabel: '',
    ...extra,
  };
}

const BASE: ControlSnapshot[] = [
  { channel: IPC.windowsEnsure, response: { mode: 'git' } },
  { channel: IPC.customScriptsList, response: { collections: [], scripts: [SCRIPT] } },
  { channel: IPC.scriptRunsResolveDir, response: DIR },
  { channel: IPC.scriptRunsNextFires, response: FIRES },
  { channel: IPC.scriptRunsSchedulePreview, response: PREVIEW },
  { channel: IPC.scriptRunsConfirmAccept, response: { runId: 'run-w', terminal: null } },
  { channel: IPC.scriptRunsRunScheduleNow, response: { runId: 'run-n', terminal: null } },
  { channel: IPC.scriptRunsReadLog, response: { chunks: [], truncated: false } },
];

const modeTab = (page: Page) => page.locator('[data-testid="mode-tab"][data-mode="automations"]');
const dialog = (page: Page) => page.locator('[data-testid="script-dialog"]');

async function openPanel(page: Page): Promise<void> {
  await modeTab(page).click();
  await expect(page.locator('[data-testid="automations-panel"]')).toBeVisible();
}

test('New recurring script opens the editor with the schedule on', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [
      ...BASE.filter((s) => s.channel !== IPC.customScriptsList),
      { channel: IPC.customScriptsList, response: { collections: [], scripts: [] } },
      { channel: IPC.customScriptsCreate, response: SCRIPT },
    ],
  });
  await openPanel(page);
  await page.locator('[data-testid="automations-add"]').click();
  await page.locator('[data-testid="menu-item-new-recurring"]').hover();
  await page.locator('[data-testid="menu-item-new-recurring-script"]').click();

  await expect(dialog(page).locator('[data-testid="script-schedule"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const fields = dialog(page).locator('[data-testid="schedule-fields"]');
  await fields.locator('[data-testid="schedule-preset"]').selectOption('0 9 * * 1-5');
  await expect(fields.locator('[data-testid="schedule-cron"]')).toHaveValue('0 9 * * 1-5');
  await expect(fields.locator('[data-testid="schedule-next"]')).toContainText('Next:');
  await expect(fields.locator('[data-testid="schedule-quiet"]')).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(fields.locator('[data-testid="schedule-note"]')).toContainText(
    'Runs only while Kira Space is open. Missed runs are skipped.',
  );
  await expect(fields.locator('[data-testid="schedule-where"]')).toBeVisible();

  await dialog(page).locator('[data-testid="script-dialog-name"]').fill('Nightly build');
  await dialog(page).locator('[data-testid="script-dialog-command"]').fill('make build');
  await dialog(page).locator('[data-testid="script-dialog-save"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.customScriptsCreate)?.args)
    .toMatchObject({
      fields: {
        name: 'Nightly build',
        schedule: { cron: '0 9 * * 1-5', enabled: true, confirm: true },
      },
    });
});

test('an invalid cron shows the error and holds Save', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [
      ...BASE.filter((s) => s.channel !== IPC.scriptRunsNextFires),
      {
        channel: IPC.scriptRunsNextFires,
        error: { code: 'E_INVALID', message: 'cron needs 5 fields: minute hour day month weekday' },
      },
    ],
  });
  await openPanel(page);
  await page.locator(`[data-testid="script-${SCRIPT.id}"]`).click({ button: 'right' });
  await page.locator('[data-testid="menu-item-edit"]').click();
  await expect(dialog(page).locator('[data-testid="schedule-cron-error"]')).toContainText(
    'cron needs 5 fields',
  );
  await expect(dialog(page).locator('[data-testid="script-dialog-save"]')).toBeDisabled();
});

test('Run without asking is locked while the script has a secret param', async ({ relaunch }) => {
  const secret = {
    name: 'token',
    label: 'Token',
    type: 'text',
    options: [],
    default: [],
    required: true,
    secret: true,
  };
  const { window: page } = await relaunch({
    control: [
      ...BASE.filter((s) => s.channel !== IPC.customScriptsList),
      {
        channel: IPC.customScriptsList,
        response: { collections: [], scripts: [{ ...SCRIPT, params: [secret] }] },
      },
    ],
  });
  await openPanel(page);
  await page.locator(`[data-testid="script-${SCRIPT.id}"]`).click({ button: 'right' });
  await page.locator('[data-testid="menu-item-edit"]').click();
  const quiet = dialog(page).locator('[data-testid="schedule-quiet"]');
  await expect(quiet).toBeDisabled();
  await expect(dialog(page).locator('[data-testid="schedule-quiet-why"]')).toContainText(
    'a schedule never stores one',
  );
});

test('a recurring row shows the clock and next fire; the menu turns the schedule off', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [...BASE, { channel: IPC.customScriptsUpdate, response: SCRIPT }],
  });
  await openPanel(page);
  const row = page.locator(`[data-testid="script-${SCRIPT.id}"]`);
  await expect(row.locator('[data-testid="script-schedule-line"]')).toBeVisible();
  await expect(row.locator('[data-testid="script-next"]')).toContainText('next');

  await row.click({ button: 'right' });
  await page.locator('[data-testid="menu-item-toggle-schedule"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.customScriptsUpdate)?.args)
    .toMatchObject({ id: SCRIPT.id, fields: { schedule: { enabled: false } } });
});

test('Run now opens the confirm popup and Run starts the schedule run', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({ control: BASE });
  await openPanel(page);
  await page.locator(`[data-testid="script-${SCRIPT.id}"]`).click({ button: 'right' });
  await page.locator('[data-testid="menu-item-run-now"]').click();
  const popup = page.locator('[data-testid="schedule-confirm"]');
  await expect(popup).toContainText('Run Nightly build?');
  await expect(popup.locator('[data-testid="schedule-confirm-due"]')).toHaveText('Now');
  await expect(popup.locator('[data-testid="run-folder"] [data-var="folder"]')).toBeVisible();
  await popup.locator('[data-testid="schedule-confirm-run"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.scriptRunsRunScheduleNow)?.args)
    .toMatchObject({ scriptId: SCRIPT.id, hash: 'sched-h1' });
  await expect(popup).toHaveCount(0);
});

test('a waiting run shows the popup in the main window; Run accepts, Not now declines', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({
    control: [...BASE, { channel: IPC.scriptRunsConfirmDecline }],
  });
  await openPanel(page);
  await emitWailsEvent(page, IPC.scriptRunsChanged, run('waiting'));
  await emitPrompts(page, [routed('schedule', 'run-w')]);
  const popup = page.locator('[data-testid="schedule-confirm"]');
  await expect(popup).toBeVisible();
  await expect(popup.locator('[data-testid="schedule-confirm-due"]')).toContainText('Due');
  await popup.locator('[data-testid="schedule-confirm-run"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.scriptRunsConfirmAccept)?.args)
    .toMatchObject({ runId: 'run-w', hash: 'sched-h1' });
  await expect(popup).toHaveCount(0);

  await emitWailsEvent(page, IPC.scriptRunsChanged, run('waiting', { id: 'run-x' }));
  await emitPrompts(page, [routed('schedule', 'run-x')]);
  await expect(popup).toBeVisible();
  await popup.locator('[data-testid="schedule-confirm-decline"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.scriptRunsConfirmDecline)?.args)
    .toMatchObject({ id: 'run-x' });
});

test('a waiting run shows no popup in a window the router did not target', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: BASE });
  await openPanel(page);
  await emitWailsEvent(page, IPC.scriptRunsChanged, run('waiting'));
  await emitPrompts(page, [routed('schedule', 'run-w', { target: 'other-window' })]);
  await expect(page.locator('[data-testid="run-row"][data-state="waiting"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="schedule-confirm"]')).toHaveCount(0);
});

test('the runs list shows Skipped with its reason; a headless run opens its tab', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: BASE });
  await openPanel(page);
  await emitWailsEvent(
    page,
    IPC.scriptRunsChanged,
    run('skipped', {
      id: 'run-s',
      outcome: {
        status: 'skipped',
        reason: 'the previous run is still running (started 09:00)',
        source: 'schedule',
        reported: false,
      },
    }),
  );
  const skipped = page.locator('[data-testid="run-row"][data-state="skipped"]');
  await expect(skipped.locator('[data-testid="run-status"]')).toHaveText('Skipped');
  await expect(skipped.locator('[data-testid="run-trigger"]')).toContainText('scheduled');
  await skipped.locator('button').first().click();
  await expect(skipped.locator('[data-testid="run-outcome-reason"]')).toContainText(
    'still running (started 09:00)',
  );

  await emitWailsEvent(page, IPC.scriptRunsChanged, run('running', { id: 'run-h' }));
  await page.locator('[data-testid="run-row"][data-state="running"] button').first().click();
  const view = page.locator('[data-testid="script-run-view"]');
  await expect(view).toBeVisible();
  await expect(view.locator('[data-testid="script-run-command"]')).toContainText('make build');
  await expect(view.locator('[data-testid="run-log"]')).toBeVisible();
});

test('the editor targets an ADE task through the task picker', async ({ relaunch }) => {
  const adePreview = {
    ...PREVIEW,
    needs: { tasks: [{ id: 'task-1', title: 'Fix login' }], branches: [] },
  };
  const { window: page, control } = await relaunch({
    control: [
      ...BASE,
      { channel: IPC.scriptRunsPreview, response: adePreview },
      { channel: IPC.customScriptsUpdate, response: SCRIPT },
    ],
  });
  await openPanel(page);
  await page.locator(`[data-testid="script-${SCRIPT.id}"]`).click({ button: 'right' });
  await page.locator('[data-testid="menu-item-edit"]').click();
  await dialog(page).locator('[data-testid="schedule-where-task"]').click();
  await dialog(page).locator('[data-testid="run-task"]').click();
  await page.locator('[data-testid="run-task-option-task-1"]').click();
  await dialog(page).locator('[data-testid="script-dialog-save"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.customScriptsUpdate)?.args)
    .toMatchObject({ id: SCRIPT.id, fields: { schedule: { taskId: 'task-1' } } });
});
