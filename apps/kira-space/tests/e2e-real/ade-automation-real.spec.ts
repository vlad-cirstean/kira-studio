import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, type KiraSpaceApp, test } from './fixtures';
import { addTask, DONE_SCENARIO, openPlan, runTask, saveFlow } from './support/ade';
import { createRepoWithRemote } from './support/gitRepo';

// P242 Part 3: a smart script run for a task in its worktree, and the gate between it and an ADE
// step, against the real backend with the fake claude.

test.use({ scenario: DONE_SCENARIO });

const t = (id: string) => `[data-testid="${id}"]`;

/** Rewrites the fake claude's scenario; the fake reads it on every call. */
async function scenario(kira: KiraSpaceApp, actions: (string | object)[]): Promise<void> {
  await writeFile(join(kira.root, 'scenario.json'), JSON.stringify({ claude: { '*': actions } }));
}

/** A task whose first step is done on `feat/api-run`, so its worktree exists. */
async function taskWithWorktree(kira: KiraSpaceApp): Promise<Page> {
  const repo = join(kira.work, 'api');
  await createRepoWithRemote(repo, join(kira.work, 'api-remote.git'), [
    { subject: 'api base', files: { 'a.txt': 'a\n' } },
  ]);
  await kira.call('CodeWorkspaceService', 'ImportRepo', { path: repo });
  await saveFlow(kira);
  await kira.call('CustomScriptsService', 'Create', {
    fields: {
      name: 'Review',
      kind: 'smart',
      command: 'Review {branch}.',
      color: 'blue',
      useAdeDir: true,
      dirMode: 'kira',
      workingDir: '',
      params: [],
      smart: null,
    },
  });
  const page = await openPlan(kira);
  await addTask(page, 'Fix login');
  await page
    .locator('[data-testid="ade-card"]', { hasText: 'Fix login' })
    .locator(t('ade-card-head'))
    .click();
  await runTask(page, 'feat/api-run');
  const step = (id: string) => page.locator(`${t('ade-step')}[data-step-id="${id}"]`);
  await expect(step('one')).toContainText(/done/i, { timeout: 30_000 });
  await expect(page.locator(t('ade-step-approve'))).toBeVisible({ timeout: 30_000 });
  return page;
}

async function startAutomation(page: Page): Promise<void> {
  await page
    .locator('[data-testid="ade-card"]', { hasText: 'Fix login' })
    .click({ button: 'right', position: { x: 60, y: 30 } });
  await page.locator(t('menu-item-ade-task-automation')).click();
  await page.locator('[data-testid^="menu-item-ade-automation-"]').first().click();
  const start = page.locator(t('run-start'));
  const radio = page.locator('[data-testid^="run-branch-"]:not([data-disabled])').first();
  if (await radio.count()) await radio.click();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator(t('run-dialog'))).toHaveCount(0);
}

test('a smart script runs in the task worktree: Running chip, then Succeeded in its tab', async ({
  kira,
}) => {
  const page = await taskWithWorktree(kira);
  const gate = join(kira.root, 'gate-run');
  await scenario(kira, ['done', { name: 'done', waitFile: gate }]);
  await startAutomation(page);

  await expect(page.locator(t('ade-automation-chip')).first()).toHaveAttribute(
    'data-state',
    'running',
    { timeout: 30_000 },
  );
  await page.locator(t('ade-automation-chip')).first().click();
  await expect(page.locator(t('script-run-header')).locator(t('run-status'))).toHaveText('Running');
  await writeFile(gate, '');
  const header = page.locator(t('script-run-header'));
  await expect(header.locator(t('run-status'))).toHaveText('Succeeded', { timeout: 30_000 });
});

test('a step waits for a running automation, then runs', async ({ kira }) => {
  const page = await taskWithWorktree(kira);
  const gate = join(kira.root, 'gate-held');
  await scenario(kira, ['done', { name: 'done', waitFile: gate }, 'done']);
  await startAutomation(page);
  await expect(page.locator(t('ade-automation-chip')).first()).toHaveAttribute(
    'data-state',
    'running',
    { timeout: 30_000 },
  );

  await page.locator(t('ade-step-approve')).click();
  const two = page.locator(`${t('ade-step')}[data-step-id="two"]`);
  await expect(two).toContainText('waiting for automation', { timeout: 30_000 });

  await writeFile(gate, '');
  await expect(two).toContainText(/done/i, { timeout: 30_000 });
});
