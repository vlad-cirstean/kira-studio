import { expect, test } from './fixtures';
import { adeFixture, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';

// Capture box and the Add popover on the committed fixtures.

interface TaskFx {
  id: string;
  [key: string]: unknown;
}

function visibleTask(): TaskFx {
  return { ...adeFixture<TaskFx>('task'), id: 'T_deps' };
}

test('Enter in the capture box files a backlog item and confirms it', async ({ relaunch }) => {
  const item = adeFixture<{ items: unknown[] }>('backlog').items[0];
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskAddBacklogItem, response: item },
  ]);
  const input = page.locator('[data-testid="ade-capture"]');
  await input.fill('Rate limit exports');
  await input.press('Enter');
  await expect(page.locator('[data-testid="ade-capture-note"]')).toHaveText('added to backlog');
  await expect(input).toHaveValue('');
  expect(control.log().find((e) => e.channel === IPC.adeTaskAddBacklogItem)?.args).toEqual({
    text: 'Rate limit exports',
  });
});

test('New task creates a branchless task in chosen repos and selects it', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskCreateTask, response: visibleTask() },
  ]);
  await page.locator('[data-testid="ade-add"]').click();
  await page.locator('[data-testid="ade-nw-title"]').fill('Export CSV');
  await page.locator('[data-testid="ade-nw-jira"]').fill('PAY-77');
  await page.locator('[data-testid="ade-nw-repo"]', { hasText: 'api' }).click();
  await page.locator('[data-testid="ade-nw-add"]').click();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.adeTaskCreateTask))
    .toHaveLength(1);
  expect(control.log().find((e) => e.channel === IPC.adeTaskCreateTask)?.args).toEqual({
    title: 'Export CSV',
    jira: { key: 'PAY-77', url: '' },
    githubUrl: '',
    notes: '',
    codeRepoIds: ['repo-web-app', 'repo-api'],
    workflowId: '',
    bases: {},
  });
  await expect(page.locator('[data-testid="ade-add-popover"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="ade-task"][data-task-id="T_deps"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
});

test('Existing branch searches every repo and adds the picked one', async ({ relaunch }) => {
  const added = { ...adeFixture<{ task: TaskFx }>('add-existing-branch') };
  added.task = visibleTask();
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskCandidateBranches, response: adeFixture('candidates') },
    { channel: IPC.adeTaskAddExistingBranch, response: added },
  ]);
  await page.locator('[data-testid="ade-add"]').click();
  await page.locator('[data-testid="ade-add-tab-branch"]').click();
  await page.locator('[data-testid="ade-branch-search"]').fill('invoice');
  const rows = page.locator('[data-testid="ade-candidate"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('you');
  await expect(rows.first()).toContainText('web-app');
  await rows.first().click();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.adeTaskAddExistingBranch))
    .toHaveLength(1);
  expect(control.log().find((e) => e.channel === IPC.adeTaskAddExistingBranch)?.args).toEqual({
    codeRepoId: 'repo-web-app',
    name: 'fix/invoice-rounding',
    taskId: '',
  });
});
