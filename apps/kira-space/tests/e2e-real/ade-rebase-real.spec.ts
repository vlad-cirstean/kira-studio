import { join } from 'node:path';
import { expect, test } from './fixtures';
import {
  addTaskOnBase,
  openPlan,
  REBASE_CONFLICT_SCENARIO,
  REBASE_DONE_SCENARIO,
  runTask,
  saveFlow,
} from './support/ade';
import { createRepoWithRemote, git } from './support/gitRepo';

// Real app, real git; the fake claude runs the rebase itself and reports through finish_step.

interface RunRow {
  id: string;
  purpose: string;
  state: string;
}
interface BoardFull {
  tasks: { id: string; runs: RunRow[] }[];
  branches: { id: string; name: string; worktree: string; base: string; basePendingFrom: string }[];
}

/** develop adds clash.txt; main moves on with clash.txt (conflicting) or m.txt (clean). */
async function setup(
  clash: boolean,
  kira: {
    work: string;
    call: <T>(s: string, m: string, a?: unknown) => Promise<T>;
  },
) {
  const repo = join(kira.work, 'api');
  await createRepoWithRemote(repo, join(kira.work, 'api-remote.git'), [
    { subject: 'api base', files: { 'a.txt': 'a\n' } },
  ]);
  git(repo, 'checkout', '-q', '-b', 'develop');
  await createFile(repo, 'clash.txt', 'develop\n');
  git(repo, 'checkout', '-q', 'main');
  await createFile(repo, clash ? 'clash.txt' : 'm.txt', 'main\n');
  git(repo, 'push', '-q', 'origin', 'main', 'develop');
  await kira.call('CodeWorkspaceService', 'ImportRepo', { path: repo });
  await saveFlow(kira as never);
  return repo;
}

async function createFile(repo: string, name: string, body: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(repo, name), body);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', `add ${name}`);
}

test.describe('clean', () => {
  test.use({ scenario: REBASE_DONE_SCENARIO });

  test('a new task on develop starts its branch at origin/develop', async ({ kira }) => {
    const repo = await setup(false, kira);
    const page = await openPlan(kira);
    await addTaskOnBase(page, 'Fix login', 'develop');
    const card = page.locator('[data-testid="ade-card"]', { hasText: 'Fix login' });
    await card.locator('[data-testid="ade-card-head"]').click();
    await runTask(page, 'feat/api-run');
    await expect
      .poll(
        async () =>
          (await kira.call<BoardFull>('AdeTaskService', 'Board')).branches.find(
            (b) => b.name === 'feat/api-run',
          )?.worktree ?? '',
      )
      .not.toBe('');
    const wt =
      (await kira.call<BoardFull>('AdeTaskService', 'Board')).branches.find(
        (b) => b.name === 'feat/api-run',
      )?.worktree ?? '';
    git(repo, 'fetch', '-q', 'origin');
    expect(git(wt, 'merge-base', 'HEAD', 'origin/develop')).toBe(
      git(wt, 'rev-parse', 'origin/develop'),
    );
  });

  test('Change base to main rebases in the background', async ({ kira }) => {
    const repo = await setup(false, kira);
    const page = await openPlan(kira);
    await addTaskOnBase(page, 'Fix login', 'develop');
    const card = page.locator('[data-testid="ade-card"]', { hasText: 'Fix login' });
    await card.locator('[data-testid="ade-card-head"]').click();
    await runTask(page, 'feat/api-run');

    const board = async () => kira.call<BoardFull>('AdeTaskService', 'Board');
    await expect
      .poll(
        async () => (await board()).branches.find((b) => b.name === 'feat/api-run')?.worktree ?? '',
      )
      .not.toBe('');
    const worktree =
      (await board()).branches.find((b) => b.name === 'feat/api-run')?.worktree ?? '';
    git(repo, 'fetch', '-q', 'origin');
    expect(git(worktree, 'merge-base', 'HEAD', 'origin/develop')).toBe(
      git(worktree, 'rev-parse', 'origin/develop'),
    );

    await card.locator('[data-testid="ade-card-change-base"]').click();
    await page.locator('[data-testid="ade-base-picker"]').click();
    await page.locator('[data-testid="ade-base-option-main"]').click();
    await expect(page.locator('[data-testid="ade-dialog-send"]')).toHaveText('Run in background');
    await page.locator('[data-testid="ade-dialog-send"]').click();
    await expect
      .poll(async () => (await board()).tasks[0]?.runs.find((r) => r.purpose === 'rebase')?.state, {
        timeout: 60_000,
      })
      .toBe('done');
    const b = (await board()).branches.find((x) => x.name === 'feat/api-run');
    expect(b?.base).toBe('main');
    expect(b?.basePendingFrom).toBe('');
    expect(git(worktree, 'merge-base', 'HEAD', 'origin/main')).toBe(
      git(worktree, 'rev-parse', 'origin/main'),
    );
  });
});

test.describe('conflict', () => {
  test.use({ scenario: REBASE_CONFLICT_SCENARIO });

  test('a conflicting rebase is reported, left pending, and Abort rebase restores the tip', async ({
    kira,
  }) => {
    const repo = await setup(true, kira);
    const page = await openPlan(kira);
    await addTaskOnBase(page, 'Fix login', 'develop');
    const card = page.locator('[data-testid="ade-card"]', { hasText: 'Fix login' });
    await card.locator('[data-testid="ade-card-head"]').click();
    await runTask(page, 'feat/api-run');

    const board = async () => kira.call<BoardFull>('AdeTaskService', 'Board');
    await expect
      .poll(
        async () => (await board()).branches.find((b) => b.name === 'feat/api-run')?.worktree ?? '',
      )
      .not.toBe('');
    const worktree =
      (await board()).branches.find((b) => b.name === 'feat/api-run')?.worktree ?? '';
    const tip = git(worktree, 'rev-parse', 'HEAD');
    git(repo, 'fetch', '-q', 'origin');

    await card.locator('[data-testid="ade-card-change-base"]').click();
    await page.locator('[data-testid="ade-base-picker"]').click();
    await page.locator('[data-testid="ade-base-option-main"]').click();
    await page.locator('[data-testid="ade-dialog-send"]').click();

    await expect
      .poll(async () => (await board()).tasks[0]?.runs.find((r) => r.purpose === 'rebase')?.state, {
        timeout: 60_000,
      })
      .toBe('failed');
    await page.locator('[data-testid="ade-branch-row"]').first().click();
    await expect(page.locator('[data-testid="ade-outcome-reason"]')).toHaveText(
      'clash.txt conflicts',
    );
    await expect(page.locator('[data-testid="ade-outcome-files"]')).toContainText('clash.txt');

    await page.locator('[data-testid="ade-panel-action-abort-rebase"]').click();
    await page.getByRole('button', { name: 'Abort rebase' }).click();
    await expect
      .poll(
        async () =>
          (await board()).branches.find((b) => b.name === 'feat/api-run')?.basePendingFrom,
      )
      .toBe('develop');
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(tip);
    expect(git(worktree, 'status', '--porcelain')).toBe('');
  });
});
