import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { adeFixture, openPlan, openTask } from './support/adeV2';
import { calls } from './support/ipcCalls';
import { IPC } from './support/ipcChannels';

// Add, change and remove the repos and branches of a task, row by row. Backend half: adeflow
// TestTaskReposAndBranches.

const t = (id: string) => `[data-testid="${id}"]`;
const card = (id: string) => `[data-testid="ade-card"][data-task-id="${id}"]`;
const menu = (branchId: string) => `${t('ade-task-branch-menu')}[data-branch-id="${branchId}"]`;

async function pick(page: Page, branchId: string, item: string): Promise<void> {
  await page.locator(menu(branchId)).click();
  await page.locator(t(item)).click();
}

const candidates = { channel: IPC.adeTaskCandidateBranches, response: adeFixture('candidates') };

test('a repo without a branch gets an existing branch from its menu', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [candidates]);
  await openTask(page, 'T_alerts');
  await pick(page, 'd_alerts_web', 'ade-task-branch-add');
  await expect(page.locator(t('ade-branch-form'))).toBeVisible();
  const rows = page.locator(t('ade-candidate'));
  await expect(rows).toHaveCount(2);
  await rows.filter({ hasText: 'fix/invoice-rounding' }).click();
  await expect.poll(() => calls(control, IPC.adeTaskSetTaskBranch)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskSetTaskBranch)[0]?.args).toEqual({
    branchId: 'd_alerts_web',
    name: 'fix/invoice-rounding',
    existing: true,
  });
  await expect(page.locator(t('ade-branch-form'))).toHaveCount(0);
});

test('a repo without a branch gets a new branch name', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await openTask(page, 'T_alerts');
  await pick(page, 'd_alerts_api', 'ade-task-branch-add');
  await page.locator(t('ade-branch-form-new')).click();
  await page.locator(t('ade-branch-form-name')).fill('feat/alerts-api');
  await page.locator(t('ade-branch-form-create')).click();
  await expect.poll(() => calls(control, IPC.adeTaskSetTaskBranch)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskSetTaskBranch)[0]?.args).toEqual({
    branchId: 'd_alerts_api',
    name: 'feat/alerts-api',
    existing: false,
  });
});

test('a refused name stays in the form', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, [
    {
      channel: IPC.adeTaskSetTaskBranch,
      error: { code: 'E_BAD_REQUEST', message: 'branch feat/x already exists' },
    },
  ]);
  await openTask(page, 'T_alerts');
  await pick(page, 'd_alerts_api', 'ade-task-branch-add');
  await page.locator(t('ade-branch-form-new')).click();
  await page.locator(t('ade-branch-form-name')).fill('feat/x');
  await page.locator(t('ade-branch-form-create')).click();
  await expect(page.locator(t('ade-branch-form-error'))).toContainText('already exists');
  await expect(page.locator(t('ade-branch-form'))).toBeVisible();
});

test('Change repo swaps the repo of a row without a branch', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await openTask(page, 'T_alerts');
  await pick(page, 'd_alerts_api', 'ade-task-repo-change');
  await page.locator(t('ade-branch-form-repo')).selectOption('repo-mobile');
  await expect.poll(() => calls(control, IPC.adeTaskUpdateTaskRepo)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskUpdateTaskRepo)[0]?.args).toEqual({
    branchId: 'd_alerts_api',
    codeRepoId: 'repo-mobile',
  });
});

test('Remove repo on a clean row asks nothing', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await openTask(page, 'T_alerts');
  await pick(page, 'd_alerts_web', 'ade-task-repo-remove');
  await expect.poll(() => calls(control, IPC.adeTaskRemoveTaskRepo)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskRemoveTaskRepo)[0]?.args).toEqual({ branchId: 'd_alerts_web' });
  await expect(page.locator(t('confirm-dialog'))).toHaveCount(0);
});

test('Remove branch on a dirty worktree lists what is lost and waits for the confirm', async ({
  relaunch,
}) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskTaskBranchRisk, response: adeFixture('branch-risk-dirty') },
  ]);
  await openTask(page, 'T_cart');
  await pick(page, 'b_cart', 'ade-task-branch-remove');
  await expect(page.locator(t('confirm-dialog-message'))).toContainText('src/cart/total.ts');
  await expect(page.locator(t('confirm-dialog-message'))).toContainText('2 unmerged commits');
  expect(calls(control, IPC.adeTaskRemoveTaskBranch)).toHaveLength(0);
  await page.locator(t('confirm-dialog-confirm')).click();
  await expect.poll(() => calls(control, IPC.adeTaskRemoveTaskBranch)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskRemoveTaskBranch)[0]?.args).toEqual({ branchId: 'b_cart' });
});

test('a worktree git cannot remove blocks the removal with its reason', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    {
      channel: IPC.adeTaskTaskBranchRisk,
      response: { ...adeFixture<object>('branch-risk-dirty'), blocked: 'locked' },
    },
  ]);
  await openTask(page, 'T_cart');
  await pick(page, 'b_cart', 'ade-task-branch-remove');
  await expect(page.locator(t('ade-task-error'))).toBeVisible();
  expect(calls(control, IPC.adeTaskRemoveTaskBranch)).toHaveLength(0);
});

test('a review task offers no row menu', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page.locator(t('ade-load-all')).click();
  const row = page.locator(`${card('R_sara')} ${t('ade-branch-row')}[data-branch-id="b_sara"]`);
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(page.locator(t('ade-panel-review-note'))).toBeVisible();
  await page.locator(`${t('ade-task-branch')}[data-branch-id="b_sara"]`).click();
  await expect(page.locator(t('ade-panel-back'))).toBeVisible();
  await expect(page.locator(t('ade-task-branch-menu'))).toHaveCount(0);
});

test('Add branch on the task still attaches an existing branch to a new row', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch);
  await openTask(page, 'T_alerts');
  await page.locator(t('ade-add-branch')).click();
  await expect(page.locator(t('ade-add-popover'))).toBeVisible();
});
