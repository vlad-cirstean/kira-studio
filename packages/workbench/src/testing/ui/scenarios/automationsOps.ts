import { expect, type Locator, type Page } from '@playwright/test';
import { scriptRunSchema } from '@shared/domain/scriptRuns';
import { customScriptSchema } from '@shared/domain/scripts';
import { type ControlSnapshot, emitWailsEvent } from '../mockRuntime';
import type { ScenarioEnv } from './env';

type Env = ScenarioEnv<
  | 'customScriptsList'
  | 'scriptRunsChanged'
  | 'scriptRunsConfirmDecline'
  | 'scriptRunsList'
  | 'scriptRunsReadLog'
  | 'scriptRunsResolveDir'
  | 'scriptRunsStop'
  | 'terminalOpen'
>;

export interface Options {
  extraBase: readonly ControlSnapshot[];
  modeTab: (page: Page) => Locator;
}

// Automation runs in the Operations panel. Backend half: termflow TestScriptRunNonZeroExit stores the
// failed run with its output tail; the Automations panel keeps only running and waiting runs.
export function registerOpsScenarios(env: Env, options: Options): void {
  const { test, contract, ipc: IPC } = env;

  const script = contract('automations', 'CustomScriptsService.Create#failed', {
    schema: customScriptSchema,
  });
  const failed = contract('automations', 'ScriptRunsService.Get#failed', {
    schema: scriptRunSchema,
  });
  const DIR = {
    path: failed.cwd,
    mode: 'kira',
    base: '/kira',
    blocker: '',
    branch: '',
    pending: false,
  };

  const BASE: ControlSnapshot[] = [
    ...options.extraBase,
    { channel: IPC.customScriptsList, response: { collections: [], scripts: [script] } },
    { channel: IPC.scriptRunsResolveDir, response: DIR },
    { channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } },
    { channel: IPC.scriptRunsReadLog, response: { chunks: [], truncated: false } },
    { channel: IPC.scriptRunsStop, response: null },
    { channel: IPC.scriptRunsConfirmDecline, response: null },
  ];

  const times = { createdAt: 1_000, startedAt: 1_000 };
  function run(id: string, state: string, extra: Record<string, unknown> = {}) {
    const live = state === 'running' || state === 'waiting';
    return {
      ...failed,
      ...times,
      id,
      state,
      terminalId: '',
      finishedAt: live ? null : 4_000,
      outcome: live ? null : { status: state, reason: 'finished', source: 'exit', reported: false },
      ...extra,
    };
  }
  const smart = (id: string, state: string) =>
    run(id, state, {
      kind: 'smart',
      trigger: 'manual',
      command: '',
      model: 'sonnet',
      sessionId: 's1',
      prompt: 'Check the build',
      tools: { tools: ['Read'], allowedTools: ['Read'], mcpServers: [] },
      outcome: {
        status: 'done',
        reason: 'Finished',
        source: 'agent',
        reported: true,
        summary: 'ok',
      },
    });

  const ops = (page: Page) => page.locator('[data-testid="operations-panel"]');
  const opRow = (page: Page, id: string) => ops(page).locator(`[data-op-id="run:${id}"]`);
  async function openOps(page: Page): Promise<void> {
    await page.locator('[data-testid="toggle-operations-panel"]').click();
    await expect(ops(page)).toBeVisible();
  }
  async function menu(page: Page, id: string, item: string): Promise<void> {
    await opRow(page, id).click({ button: 'right' });
    await page.locator(`[data-testid="menu-item-${item}"]`).click();
  }

  test('contract: a failed run lists in Operations; the Errors filter keeps it, Running hides it', async ({
    relaunch,
  }) => {
    const { window: page } = await relaunch({
      control: [...BASE, { channel: IPC.scriptRunsList, response: [failed] }],
    });
    await openOps(page);
    const row = opRow(page, failed.id);
    await expect(row).toHaveAttribute('data-status', 'error');
    await expect(row).toContainText('Automations');
    await expect(row).toContainText(failed.scriptName);
    await ops(page).getByText('Errors', { exact: true }).click();
    await expect(row).toBeVisible();
    await ops(page).getByText('Running', { exact: true }).click();
    await expect(row).toHaveCount(0);
  });

  test('contract: an expanded failed run shows its output tail and exit code', async ({
    relaunch,
  }) => {
    const { window: page } = await relaunch({
      control: [...BASE, { channel: IPC.scriptRunsList, response: [failed] }],
    });
    await openOps(page);
    await opRow(page, failed.id).click();
    const lines = ops(page).locator('[data-testid="op-detail-line"]');
    await expect(lines.filter({ hasText: 'boom' })).toHaveCount(1);
    await expect(lines.filter({ hasText: 'Exit code 3' })).toHaveCount(1);
  });

  test('contract: Copy for agent copies the report with no terminal tab open', async ({
    relaunch,
  }) => {
    const { window: page } = await relaunch({
      control: [...BASE, { channel: IPC.scriptRunsList, response: [failed] }],
    });
    await openOps(page);
    await page.evaluate(() => {
      const w = window as unknown as { __clipboard: string[] };
      w.__clipboard = [];
      navigator.clipboard.writeText = (text: string) => {
        w.__clipboard.push(text);
        return Promise.resolve();
      };
    });
    await menu(page, failed.id, 'copy-for-agent');
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __clipboard: string[] }).__clipboard.at(-1) ?? '',
        ),
      )
      .toContain('boom');
    const copied = await page.evaluate(
      () => (window as unknown as { __clipboard: string[] }).__clipboard.at(-1) ?? '',
    );
    expect(copied).toContain(`Script: ${failed.scriptName}`);
    expect(copied).toContain('Exit code: 3');
  });

  test('Cancel on a running row stops it; on a waiting row it declines it', async ({
    relaunch,
  }) => {
    const { window: page, control } = await relaunch({ control: BASE });
    await openOps(page);
    const now = await page.evaluate(() => Date.now());
    const at = { createdAt: now, startedAt: now };
    await emitWailsEvent(page, IPC.scriptRunsChanged, run('run-r', 'running', at));
    await emitWailsEvent(
      page,
      IPC.scriptRunsChanged,
      run('run-w', 'waiting', { ...at, startedAt: null }),
    );
    await expect(opRow(page, 'run-r')).toHaveAttribute('data-status', 'running');
    await expect(opRow(page, 'run-w')).toHaveAttribute('data-status', 'running');
    await opRow(page, 'run-r').getByRole('button', { name: 'Cancel operation' }).click();
    await expect
      .poll(() => control.log().find((e) => e.channel === IPC.scriptRunsStop)?.args)
      .toEqual({ id: 'run-r' });
    await expect(opRow(page, 'run-w')).toContainText('Waiting');
    await opRow(page, 'run-w').getByRole('button', { name: 'Cancel operation' }).click();
    await expect
      .poll(() => control.log().find((e) => e.channel === IPC.scriptRunsConfirmDecline)?.args)
      .toMatchObject({ id: 'run-w' });
  });

  test('Clear hides automation runs; a run pushed after it shows', async ({ relaunch }) => {
    const { window: page } = await relaunch({
      control: [...BASE, { channel: IPC.scriptRunsList, response: [failed] }],
    });
    await openOps(page);
    await expect(opRow(page, failed.id)).toBeVisible();
    await ops(page).getByRole('button', { name: 'Clear' }).click();
    await expect(opRow(page, failed.id)).toHaveCount(0);
    const now = await page.evaluate(() => Date.now());
    await emitWailsEvent(
      page,
      IPC.scriptRunsChanged,
      run('run-late', 'failed', { createdAt: now + 60_000, startedAt: now + 60_000 }),
    );
    await expect(opRow(page, 'run-late')).toBeVisible();
    await expect(opRow(page, failed.id)).toHaveCount(0);
  });

  test('Open run on a smart run opens its tab in Automations', async ({ relaunch }) => {
    const { window: page } = await relaunch({
      control: [...BASE, { channel: IPC.scriptRunsList, response: [smart('run-s', 'done')] }],
    });
    await openOps(page);
    await menu(page, 'run-s', 'open-run');
    await expect(page.locator('[data-testid="automations-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="script-run-view"]')).toBeVisible();
  });

  test('Run again starts the script', async ({ relaunch }) => {
    const { window: page, control } = await relaunch({
      control: [...BASE, { channel: IPC.scriptRunsList, response: [failed] }],
    });
    await openOps(page);
    await menu(page, failed.id, 'run-again');
    await expect
      .poll(() => control.log().filter((e) => e.channel === IPC.terminalOpen).length)
      .toBe(1);
  });

  test('the Automations panel lists only running and waiting runs', async ({ relaunch }) => {
    const { window: page } = await relaunch({
      control: [
        ...BASE,
        {
          channel: IPC.scriptRunsList,
          response: [run('run-d', 'done'), run('run-f', 'failed', { id: 'run-f' })],
        },
      ],
    });
    await options.modeTab(page).click();
    const rows = page.locator('[data-testid="runs-section"] [data-testid="run-row"]');
    await expect(page.locator('[data-testid="runs-empty"]')).toBeVisible();
    await expect(rows).toHaveCount(0);
    await emitWailsEvent(page, IPC.scriptRunsChanged, run('run-r', 'running'));
    await emitWailsEvent(page, IPC.scriptRunsChanged, run('run-w', 'waiting', { startedAt: null }));
    await expect(rows).toHaveCount(2);
    await expect(page.locator('[data-testid="runs-empty"]')).toHaveCount(0);
  });

  test('with no live run, Show history opens the Operations panel', async ({ relaunch }) => {
    const { window: page } = await relaunch({ control: BASE });
    await options.modeTab(page).click();
    await expect(page.locator('[data-testid="operations-panel"]')).toHaveCount(0);
    await page.locator('[data-testid="runs-show-history"]').click();
    await expect(page.locator('[data-testid="operations-panel"]')).toBeVisible();
  });
}
