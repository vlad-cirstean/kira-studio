import { expect, type Page } from '@playwright/test';
import { scriptRunSchema } from '@shared/domain/scriptRuns';
import { customScriptSchema } from '@shared/domain/scripts';
import { emitWailsEvent } from '../mockRuntime';
import type { ScenarioEnv } from './env';

type Env = ScenarioEnv<
  | 'customScriptsList'
  | 'scriptRunsChanged'
  | 'scriptRunsPreview'
  | 'scriptRunsReadLog'
  | 'scriptRunsResume'
  | 'scriptRunsStart'
  | 'terminalOpen'
>;

// P279: a smart run a restart interrupted offers Resume in its run tab. Backend half: termflow
// TestSmartScriptResume (both apps) stores the fixtures against the fake claude.
export function registerResumeScenarios(env: Env): void {
  const { test, contract, ipc: IPC } = env;

  const script = contract('smart', 'CustomScriptsService.Create', { schema: customScriptSchema });
  const run = (key: string) =>
    contract('smart-resume', `ScriptRunsService.Get#${key}`, { schema: scriptRunSchema });
  const times = { createdAt: 1_000, startedAt: 1_000, finishedAt: 4_000 };

  async function openInterrupted(page: Page, interrupted: ReturnType<typeof run>) {
    await page.locator('[data-testid="mode-tab"][data-mode="automations"]').click();
    await expect(page.locator('[data-testid="automations-panel"]')).toBeVisible();
    await page.locator(`[data-testid="script-${script.id}"]`).click();
    await expect(page.locator('[data-testid="run-start"]')).toBeEnabled();
    await page.locator('[data-testid="run-start"]').click();
    await emitWailsEvent(page, IPC.scriptRunsChanged, { ...interrupted, ...times });
  }

  const base = (runId: string) => [
    { channel: IPC.customScriptsList, response: { collections: [], scripts: [script] } },
    {
      channel: IPC.scriptRunsPreview,
      response: contract('smart', 'ScriptRunsService.Preview'),
    },
    { channel: IPC.scriptRunsStart, response: { runId, terminal: null } },
    { channel: IPC.scriptRunsReadLog, response: { chunks: [], truncated: false } },
    { channel: IPC.terminalOpen, response: { shell: '/bin/zsh' } },
  ];

  test('contract: an interrupted smart run resumes into a new run tab', async ({ relaunch }) => {
    const interrupted = run('interrupted');
    const resumed = run('resumed');
    const { window: page, control } = await relaunch({
      control: [
        ...base(interrupted.id),
        { channel: IPC.scriptRunsResume, response: { runId: resumed.id, terminal: null } },
      ],
    });
    await openInterrupted(page, interrupted);
    const view = page.locator('[data-testid="script-run-view"]');
    await expect(view.locator('[data-testid="run-resume"]')).toBeVisible();
    await expect(view.locator('[data-testid="script-run-resumed-from"]')).toHaveCount(0);

    await view.locator('[data-testid="run-resume"]').click();
    await expect
      .poll(() => control.log().find((e) => e.channel === IPC.scriptRunsResume)?.args)
      .toMatchObject({ id: interrupted.id });
    await emitWailsEvent(page, IPC.scriptRunsChanged, { ...resumed, ...times });
    await expect(page.locator('[data-testid="script-run-resumed-from"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-resume"]')).toHaveCount(0);
  });

  test('contract: a refused Resume shows its reason inline', async ({ relaunch }) => {
    const interrupted = run('interrupted');
    const refused = JSON.parse(
      contract<string>('smart-resume', 'ScriptRunsService.Resume#missing'),
    ) as { code: string; message: string };
    const { window: page } = await relaunch({
      control: [
        ...base(interrupted.id),
        { channel: IPC.scriptRunsResume, error: { code: refused.code, message: refused.message } },
      ],
    });
    await openInterrupted(page, interrupted);
    await page.locator('[data-testid="run-resume"]').click();
    await expect(page.locator('[data-testid="run-resume-error"]')).toContainText('token');
  });
}
