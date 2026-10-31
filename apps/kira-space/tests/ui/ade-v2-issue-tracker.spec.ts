import { expect, test } from './fixtures';
import { openPlan, openTask } from './support/adeV2';
import { contract } from './support/contract';
import { calls } from './support/ipcCalls';
import { IPC } from './support/ipcChannels';

// The linked issue in the Task tab: title, status and pull requests from the tracker. Contract
// ade-issue-tracker; backend half: flows/adeflow TestTaskIssueTracker (issuetracker_test.go).

const t = (id: string) => `[data-testid="${id}"]`;

interface IssueFx {
  provider: string;
  key: string;
  title: string;
  status: string;
  summary: { known: boolean; count: number };
  changeRequests: { title: string; repo: string; ref: string; state: string }[];
  reason: string;
}
const issue = (key: string) => contract<IssueFx>('ade-issue-tracker', key);

test('contract: the Task tab shows the issue title, status and pull requests', async ({
  relaunch,
}) => {
  const fx = issue('IssueTrackerService.TaskIssue');
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskIssue, response: fx },
  ]);
  await openTask(page, 'T_alerts');
  await expect(page.locator(t('ade-task-issue-title'))).toHaveText(fx.title);
  await expect(page.locator(t('ade-task-issue-status'))).toHaveText(fx.status);
  const prs = page.locator(t('ade-task-issue-pr'));
  await expect(prs).toHaveCount(fx.changeRequests.length);
  for (const cr of fx.changeRequests) {
    await expect(prs.filter({ hasText: cr.title })).toContainText(cr.repo);
  }
  await expect(page.locator(t('ade-task-issue-prs'))).toHaveText(
    `${fx.summary.count} pull requests`,
  );
  await expect.poll(() => calls(control, IPC.adeTaskIssue)).toHaveLength(1);
  expect(calls(control, IPC.adeTaskIssue)[0]?.args).toEqual({ taskId: 'T_alerts' });
});

test('contract: Jira counting more pull requests than found reads as a gap', async ({
  relaunch,
}) => {
  const fx = issue('IssueTrackerService.TaskIssue');
  const missing = fx.summary.count - fx.changeRequests.length;
  expect(missing).toBeGreaterThan(0);
  const { window: page } = await openPlan(relaunch, [{ channel: IPC.adeTaskIssue, response: fx }]);
  await openTask(page, 'T_alerts');
  await expect(page.locator(t('ade-task-issue-gap'))).toContainText(
    `Jira counts ${missing} more pull request`,
  );
});

test('contract: a signed-out tracker explains how to sign in', async ({ relaunch }) => {
  const fx = issue('IssueTrackerService.TaskIssue#unauthenticated');
  const { window: page } = await openPlan(relaunch, [{ channel: IPC.adeTaskIssue, response: fx }]);
  await openTask(page, 'T_alerts');
  await expect(page.locator(t('ade-task-issue-gap'))).toContainText('not signed in to Jira');
  await expect(page.locator(t('ade-task-issue-title'))).toHaveCount(0);
  await expect(page.locator(t('ade-task-issue-pr'))).toHaveCount(0);
});

test('a task no tracker recognises shows no issue row', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await openTask(page, 'T_alerts');
  await expect(page.locator(t('ade-task-tab'))).toBeVisible();
  await expect(page.locator(t('ade-task-issue'))).toHaveCount(0);
});
