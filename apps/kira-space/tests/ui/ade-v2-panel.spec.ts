import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { adeBoard, adeFixture, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// The Plan's right-hand panel: task fields, notes, branch details and changes, force push, resize.

interface BoardFx {
  tasks: { id: string; est: string }[];
  branches: {
    id: string;
    deployments: { env: string; status: string; error: string }[];
  }[];
}

const card = (page: Page, id: string) =>
  page.locator(`[data-testid="ade-card"][data-task-id="${id}"] [data-testid="ade-card-head"]`);

async function openTask(page: Page, id: string): Promise<void> {
  await card(page, id).click();
  await expect(page.locator('[data-testid="ade-panel"]')).toBeVisible();
}

function updates(control: { log(): { channel: string; args?: unknown }[] }) {
  return control.log().filter((e) => e.channel === IPC.adeTaskUpdateTask);
}

test('Space on a focused card head selects the task', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await card(page, 'T_bill').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-testid="ade-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="ade-panel-title"]')).toContainText('PAY-102');
});

test('selecting a task shows its facts; status is read-only', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await openTask(page, 'T_bill');
  await expect(page.locator('[data-testid="ade-panel-title"]')).toContainText('PAY-102');
  await expect(page.locator('[data-testid="ade-panel-facts"]')).toContainText(
    '3 branches in api, web-app',
  );
  await expect(page.locator('[data-testid="ade-task-status-why"]')).toContainText(
    'follows the workflow',
  );
  await expect(page.locator('[data-testid="ade-task-branch"]')).toHaveCount(3);
});

test('name, Jira, GitHub and Not merging write UpdateTask patches', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await openTask(page, 'T_notif');
  const name = page.locator('[data-testid="ade-task-name"]');
  await name.fill('Notify on mention');
  await name.press('Enter');
  await expect.poll(() => updates(control)).toHaveLength(1);
  expect(updates(control)[0]?.args).toMatchObject({
    taskId: 'T_notif',
    patch: { title: 'Notify on mention', jira: null, githubUrl: null, est: null, kind: null },
  });

  await page.locator('[data-testid="ade-task-jira-input"]').fill('PAY-9');
  await page.locator('[data-testid="ade-task-jira-save"]').click();
  await expect.poll(() => updates(control)).toHaveLength(2);
  expect(updates(control)[1]?.args).toMatchObject({
    patch: { jira: { key: 'PAY-9', url: '' } },
  });

  await page.locator('[data-testid="ade-task-github-input"]').fill('not a link');
  await page.locator('[data-testid="ade-task-github-save"]').click();
  await expect(page.locator('[data-testid="ade-task-github-error"]')).toBeVisible();
  expect(updates(control)).toHaveLength(2);
  await page
    .locator('[data-testid="ade-task-github-input"]')
    .fill('https://github.com/acme/web-app/issues/882');
  await page.locator('[data-testid="ade-task-github-save"]').click();
  await expect.poll(() => updates(control)).toHaveLength(3);
  expect(updates(control)[2]?.args).toMatchObject({
    patch: { githubUrl: 'https://github.com/acme/web-app/issues/882' },
  });

  await page.locator('[data-testid="ade-task-parked"]').click();
  await expect.poll(() => updates(control)).toHaveLength(4);
  expect(updates(control)[3]?.args).toMatchObject({ patch: { kind: 'parked' } });
});

test('estimate: unset takes number and unit, set only extends, a backend refusal shows', async ({
  relaunch,
}) => {
  const board = adeFixture<BoardFx>('board');
  const target = board.tasks.find((t) => t.id === 'T_notif');
  if (target) target.est = '';
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
  ]);
  await openTask(page, 'T_notif');
  await page.locator('[data-testid="ade-estimate-num"]').fill('3');
  await page.getByRole('button', { name: 'days' }).click();
  await expect.poll(() => updates(control)).toHaveLength(1);
  expect(updates(control)[0]?.args).toMatchObject({ patch: { est: '3d' } });

  await openTask(page, 'T_bill');
  await expect(page.locator('[data-testid="ade-estimate-total"]')).toHaveText('2d');
  await page.locator('[data-testid="ade-estimate-extend"]').fill('1');
  await page.locator('[data-testid="ade-estimate-extend-submit"]').click();
  await expect.poll(() => updates(control)).toHaveLength(2);
  expect(updates(control)[1]?.args).toMatchObject({ taskId: 'T_bill', patch: { est: '3d' } });
});

test('a refused estimate shows the backend error', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, [
    {
      channel: IPC.adeTaskUpdateTask,
      error: { code: 'invalid', message: 'estimate can only grow' },
    },
  ]);
  await openTask(page, 'T_bill');
  await page.locator('[data-testid="ade-estimate-extend"]').fill('1');
  await page.locator('[data-testid="ade-estimate-extend-submit"]').click();
  await expect(page.locator('[data-testid="ade-estimate-error"]')).toContainText(
    'estimate can only grow',
  );
});

test('+ Add repo adds a draft branch in the chosen repo', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await openTask(page, 'T_bill');
  await page.locator('[data-testid="ade-add-repo"]').selectOption('repo-mobile');
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.adeTaskAddTaskRepo))
    .toHaveLength(1);
  expect(control.log().find((e) => e.channel === IPC.adeTaskAddTaskRepo)?.args).toEqual({
    taskId: 'T_bill',
    codeRepoId: 'repo-mobile',
  });
});

test('+ Add branch attaches an existing branch to this task', async ({ relaunch }) => {
  const added = adeFixture<{ task: unknown }>('add-existing-branch');
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskCandidateBranches, response: adeFixture('candidates') },
    { channel: IPC.adeTaskAddExistingBranch, response: added },
  ]);
  await openTask(page, 'T_bill');
  await page.locator('[data-testid="ade-add-branch"]').click();
  await expect(page.locator('[data-testid="ade-add-attach"]')).toContainText('adding to');
  await expect(page.locator('[data-testid="ade-add-tab-new"]')).toHaveCount(0);
  await page.locator('[data-testid="ade-branch-search"]').fill('invoice');
  await page.locator('[data-testid="ade-candidate"]').first().click();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.adeTaskAddExistingBranch))
    .toHaveLength(1);
  expect(control.log().find((e) => e.channel === IPC.adeTaskAddExistingBranch)?.args).toEqual({
    codeRepoId: 'repo-web-app',
    name: 'fix/invoice-rounding',
    taskId: 'T_bill',
  });
});

test('typing in Notes saves once, debounced', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch);
  await openTask(page, 'T_notif');
  await page.locator('[data-testid="ade-panel-tab-notes"]').click();
  const editor = page.locator('[data-testid="ade-notes-tab"] .ProseMirror');
  await editor.click();
  await page.keyboard.type('check the digest', { delay: 20 });
  await expect.poll(() => updates(control)).toHaveLength(1);
  await page.clock.runFor(900);
  expect(updates(control)).toHaveLength(1);
  const args = updates(control)[0]?.args as { patch: { notes: string } };
  expect(args.patch.notes).toContain('check the digest');
});

test('a branch opens Details with merged and deployed rows; Changes; back to the task', async ({
  relaunch,
}) => {
  const board = adeFixture<BoardFx>('board');
  const auth = board.branches.find((b) => b.id === 'b_auth');
  const preview = auth?.deployments[0];
  if (preview) {
    preview.status = 'unknown';
    preview.error = 'script exited 1';
  }
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
  ]);
  await openTask(page, 'T_auth');
  await page.locator('[data-testid="ade-task-branch"][data-branch-id="b_auth"]').click();
  const details = page.locator('[data-testid="ade-branch-details"]');
  await expect(details).toBeVisible();
  await expect(
    details.locator('[data-testid="ade-branch-into"][data-target="develop"]'),
  ).toContainText('stale');
  await expect(
    details.locator('[data-testid="ade-branch-deploy"][data-env="preview"]'),
  ).toContainText('unknown');
  await page.locator('[data-testid="ade-panel-tab-changes"]').click();
  await expect(page.locator('[data-testid="ade-changes-tab"]')).toBeVisible();
  await page.locator('[data-testid="ade-panel-back"]').click();
  await expect(page.locator('[data-testid="ade-task-tab"]')).toBeVisible();
});

test('a branch row on the Plan selects the branch', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page.locator('[data-testid="ade-branch-row"][data-branch-id="b_cart"]').first().click();
  await expect(page.locator('[data-testid="ade-branch-details"]')).toBeVisible();
  await expect(page.locator('[data-testid="ade-branch-deploy"][data-env="prod"]')).toContainText(
    'deployed',
  );
});

test('Force push in the branch header asks first and sends the branch', async ({ relaunch }) => {
  const board = adeFixture<{ plan: { unpushed: Record<string, boolean> } }>('board');
  board.plan.unpushed = { b_deps: true };
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
    { channel: IPC.adeTaskForcePush, response: adeFixture('force-push') },
  ]);
  await openTask(page, 'T_deps');
  await page.locator('[data-testid="ade-task-branch"]').first().click();
  await page.locator('[data-testid="ade-panel-force-push"]').click();
  await page.locator('[data-testid="ade-confirm-yes"]').click();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.adeTaskForcePush))
    .toHaveLength(1);
  expect(control.log().find((e) => e.channel === IPC.adeTaskForcePush)?.args).toEqual({
    branchId: 'b_deps',
  });
});

test('a pushed branch offers no Force push', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await openTask(page, 'T_deps');
  await page.locator('[data-testid="ade-task-branch"]').first().click();
  await expect(page.locator('[data-testid="ade-branch-details"]')).toBeVisible();
  await expect(page.locator('[data-testid="ade-panel-force-push"]')).toHaveCount(0);
});

test('dragging the handle persists the dragged width; a click persists nothing', async ({
  relaunch,
}) => {
  const { window: page, control } = await openPlan(relaunch);
  await openTask(page, 'T_bill');
  const handle = page.locator('[data-testid="ade-panel-resize-handle"]');
  const startWidth = Number(await handle.getAttribute('aria-valuenow'));
  const box = await handle.boundingBox();
  if (!box) throw new Error('no handle');
  const x = box.x + box.width / 2;
  const y = box.y + 200;
  const widthWrites = () =>
    control
      .log()
      .filter(
        (e) => e.channel === IPC.settingsSet && JSON.stringify(e.args).includes('panelWidth'),
      );
  await page.mouse.click(x, y);
  expect(widthWrites()).toHaveLength(0);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 120, y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => widthWrites()).toHaveLength(1);
  expect(widthWrites()[0]?.args).toEqual({ patch: { ade: { panelWidth: startWidth + 120 } } });
});

test('the Advanced switch saves ade.headlessSettingSources with the dialog', async ({
  relaunch,
}) => {
  const { window: page, control } = await openPlan(relaunch);
  await emitWailsEvent(page, IPC.openSettings, undefined);
  await page.locator('[data-testid="settings-section-Advanced"]').click();
  const sw = page.locator('[data-testid="settings-ade-headless-sources"]');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  expect(
    control
      .log()
      .some(
        (e) =>
          e.channel === IPC.settingsSet &&
          JSON.stringify(e.args).includes('headlessSettingSources'),
      ),
  ).toBe(false);
  await page.locator('[data-testid="settings-save"]').click();
  await expect
    .poll(() =>
      control
        .log()
        .some(
          (e) =>
            e.channel === IPC.settingsSet &&
            JSON.stringify(e.args).includes('"headlessSettingSources":"user"'),
        ),
    )
    .toBe(true);
});

test('Details lists every environment of the repo, not deployed where the branch has none', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch);
  await page.locator('[data-testid="ade-branch-row"][data-branch-id="b_bill"]').first().click();
  const rows = page.locator('[data-testid="ade-branch-deploy"]');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('not deployed');
  await expect(page.locator('[data-testid="ade-branch-deploy"][data-env="prod"]')).toBeVisible();
});

// ---- worktree setup

test('a running setup shows a ticking preparing tag', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  const tag = page
    .locator('[data-testid="ade-task"][data-task-id="T_push"] [data-testid="ade-tag"]')
    .filter({ hasText: 'preparing' });
  await expect(tag).toHaveCount(1);
  const first = await tag.textContent();
  await expect.poll(async () => tag.textContent()).not.toBe(first);
});

test('See error opens the branch with the failed setup log, Retry setup sends the branch', async ({
  relaunch,
}) => {
  const { window: page, control } = await openPlan(relaunch);
  await page
    .locator('[data-testid="ade-task"][data-task-id="T_search"] [data-testid="ade-see-error"]')
    .click();
  await expect(page.locator('[data-testid="ade-branch-details"]')).toBeVisible();
  const setup = page.locator('[data-testid="ade-worktree-setup"]');
  await expect(setup).toBeVisible();
  await expect(setup).toContainText('failed');
  await expect(setup).toContainText('prepare-worktree script of');
  await expect(setup.locator('[data-testid="ade-run-log"]')).toContainText('ERR_PNPM_FETCH_404');

  await page.locator('[data-testid="ade-setup-retry"]').click();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.adeTaskRetrySetup))
    .toHaveLength(1);
  expect(control.log().find((e) => e.channel === IPC.adeTaskRetrySetup)?.args).toEqual({
    branchId: 'b_searchui',
  });
});

test('a ready setup shows its status without a log', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page.locator('[data-testid="ade-branch-row"][data-branch-id="b_search"]').click();
  const setup = page.locator('[data-testid="ade-worktree-setup"]');
  await expect(setup).toContainText('ready');
  await expect(setup.locator('[data-testid="ade-run-log"]')).toHaveCount(0);
});

test('the stage mover goes back, picks any stage and is off while a run is live', async ({
  relaunch,
}) => {
  const { window: page, control } = await openPlan(relaunch);
  const moves = () => control.log().filter((e) => e.channel === IPC.adeTaskSetTaskStage);

  await openTask(page, 'T_auth');
  await page.locator('[data-testid="ade-stage-back"]').click();
  await expect.poll(moves).toHaveLength(1);
  expect(moves()[0]?.args).toEqual({ taskId: 'T_auth', stageId: 'impl' });

  await page.locator('[data-testid="ade-stage-pick"]').click();
  await page.locator('[data-testid="ade-stage-option-done"]').click();
  await expect.poll(moves).toHaveLength(2);
  expect(moves()[1]?.args).toEqual({ taskId: 'T_auth', stageId: 'done' });

  await openTask(page, 'T_alerts');
  await expect(page.locator('[data-testid="ade-stage-back"]')).toBeDisabled();
  await expect(page.locator('[data-testid="ade-stage-next"]')).toBeEnabled();

  await openTask(page, 'T_bill');
  await expect(page.locator('[data-testid="ade-stage-pick"]')).toBeDisabled();
  await expect(page.locator('[data-testid="ade-stage-next"]')).toBeDisabled();
});

test('a started task on an older workflow version says so', async ({ relaunch }) => {
  const workflow = adeFixture<{ workflows: { workflow: unknown }[] }>('workflows').workflows[0]
    ?.workflow;
  const board = adeBoard((b) => {
    const task = b.tasks.find((x) => x.id === 'T_bill');
    if (task) Object.assign(task, { workflow, workflowOutdated: true });
  });
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
  ]);
  await openTask(page, 'T_bill');
  await expect(page.locator('[data-testid="ade-workflow-outdated"]')).toHaveText(
    'updated — applies to new work only',
  );
  await openTask(page, 'T_auth');
  await expect(page.locator('[data-testid="ade-workflow-outdated"]')).toHaveCount(0);
});
