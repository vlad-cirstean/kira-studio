import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { AdeBoardFx } from './support/adeV2';
import { adeBoard, openPlan } from './support/adeV2';
import { contract } from './support/contract';
import { calls } from './support/ipcCalls';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// P279: a run a restart stopped offers Resume. Backend half: flows/adeflow TestResumeAfterRestart,
// TestResumeLostConversation (contract ade-resume). The fixture board's T_cart release run takes the
// contract run's state, outcome and resumable flag.

const t = (id: string) => `[data-testid="${id}"]`;
const RUN = 'r_T_cart_release_b_cart';

type ContractRun = {
  state: string;
  note: string;
  resumable: boolean;
  outcome: unknown;
};

function boardAs(key: string): ControlSnapshot[] {
  const fx = contract<ContractRun>('ade-resume', `AdeTaskService.Run#${key}`);
  const board = adeBoard((b: AdeBoardFx) => {
    const run = b.tasks.find((x) => x.id === 'T_cart')?.runs.find((r) => r.id === RUN);
    if (!run) throw new Error('fixture run missing');
    Object.assign(run, {
      state: fx.state,
      note: fx.note,
      resumable: fx.resumable,
      outcome: fx.outcome,
    });
  });
  return [{ channel: IPC.adeTaskBoard, response: board }];
}

async function openCart(page: Page): Promise<void> {
  await page
    .locator('[data-testid="ade-card"][data-task-id="T_cart"] [data-testid="ade-card-head"]')
    .click();
  await expect(page.locator(t('ade-panel'))).toBeVisible();
}

const release = (page: Page) => page.locator(`${t('ade-stage-block')}[data-stage-id="release"]`);

test('contract: a restart-stopped run offers Resume on its step line and in Needs you', async ({
  relaunch,
}) => {
  const { window: page, control } = await openPlan(relaunch, boardAs('stuck'));
  await page.locator(t('ade-tab-needs')).click();
  await expect(
    page.locator(`${t('ade-needs-item')}[data-kind="stuck run"] ${t('ade-needs-action')}`),
  ).toHaveText('Resume');

  await openCart(page);
  await release(page).locator(t('ade-run-resume')).click();
  await expect.poll(() => calls(control, IPC.adeTaskResumeRun)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskResumeRun)[0]?.args).toEqual({ runId: RUN });
});

test('contract: a resumed run that finished has no Resume', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, boardAs('resumed'));
  await openCart(page);
  await expect(release(page).locator(t('ade-run-resume'))).toHaveCount(0);
});

test('contract: a lost conversation shows its reason and Retry, no Resume', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch, boardAs('lost'));
  await openCart(page);
  const block = release(page);
  await expect(block.locator(t('ade-run-resume'))).toHaveCount(0);
  await expect(block.locator(t('ade-run-retry'))).toBeVisible();
  await expect(block.locator(t('ade-run-note')).first()).toContainText('could not resume');
});

test('contract: a refused Resume shows its error in the panel', async ({ relaunch }) => {
  const refused = JSON.parse(
    contract<string>('ade-resume', 'AdeTaskService.ResumeRun#refused'),
  ) as {
    code: string;
    message: string;
  };
  const { window: page } = await openPlan(relaunch, [
    ...boardAs('stuck'),
    { channel: IPC.adeTaskResumeRun, error: { code: refused.code, message: refused.message } },
  ]);
  await openCart(page);
  await release(page).locator(t('ade-run-resume')).click();
  await expect(page.locator(t('ade-panel-action-error'))).toContainText(refused.message);
});
