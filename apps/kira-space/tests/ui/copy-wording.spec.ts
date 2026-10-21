import { expect, test } from './fixtures';
import { adeBoard, adeFixture, adeV2Control, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P265 Stream B: the wording of the confirm dialogs, empty states, plurals and the reset action.
// Each assertion pins the catalog text a user reads (title, body, verb buttons).

const t = (id: string) => `[data-testid="${id}"]`;

type Relaunch = Parameters<typeof openPlan>[0];

async function openReposDialog(relaunch: Relaunch, extra: ControlSnapshot[] = []) {
  const app = await relaunch({
    control: adeV2Control([{ channel: IPC.windowsEnsure, response: { mode: 'git' } }, ...extra]),
  });
  await app.window.locator(t('manage-repos')).click();
  await app.window.locator(t('repos-dialog')).waitFor();
  return app;
}

test('removing a repository says what stays and offers Remove / Cancel', async ({ relaunch }) => {
  const { window: page } = await openReposDialog(relaunch, [
    { channel: IPC.codeWorkspaceRemoveRepo },
  ]);
  await page.locator(t('repos-dialog-repo-remove')).click();
  const dialog = page.locator(t('confirm-dialog'));
  await expect(dialog).toContainText('Remove repository?');
  await expect(page.locator(t('confirm-dialog-message'))).toContainText('Files on disk stay.');
  await expect(page.locator(t('confirm-dialog-confirm'))).toHaveText('Remove');
  await expect(page.locator(t('confirm-dialog-cancel'))).toHaveText('Cancel');
});

test('deleting a backlog item names it and offers Delete / Cancel', async ({ relaunch }) => {
  const items = adeFixture<{ items: { text: string }[] }>('backlog').items;
  const { window: page } = await openPlan(relaunch);
  await page.locator(t('ade-tab-backlog')).click();
  await page.locator(t('ade-backlog-row')).nth(3).locator(t('ade-backlog-delete')).click();
  const dialog = page.locator(t('confirm-dialog'));
  await expect(dialog).toContainText('Delete backlog item?');
  await expect(page.locator(t('confirm-dialog-message'))).toContainText(
    `Deletes “${items[3]?.text}” from the backlog. This can’t be undone.`,
  );
  await expect(page.locator(t('confirm-dialog-confirm'))).toHaveText('Delete');
  await expect(page.locator(t('confirm-dialog-cancel'))).toHaveText('Cancel');
});

test('force push asks with Cancel / Force push', async ({ relaunch }) => {
  const board = adeFixture<{ plan: { unpushed: Record<string, boolean> } }>('board');
  board.plan.unpushed = { b_deps: true };
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
  ]);
  await page.locator(t('ade-force-push')).click();
  const dialog = page.locator(t('ade-confirm-dialog'));
  await expect(dialog).toContainText('Force push?');
  await expect(dialog.locator(t('ade-confirm-no'))).toHaveText('Cancel');
  await expect(dialog.locator(t('ade-confirm-yes'))).toHaveText('Force push');
});

test('abort rebase asks with Cancel / Abort', async ({ relaunch }) => {
  const board = adeBoard((b) => {
    const auth = b.branches.find((br) => br.id === 'b_auth');
    Object.assign(auth ?? {}, { base: 'develop', basePendingFrom: 'main', rebaseInProgress: true });
  });
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
  ]);
  await page.locator('[data-testid="ade-branch-row"][data-branch-id="b_auth"]').click();
  await page.locator(t('ade-panel-action-abort-rebase')).click();
  await expect(page.getByText('Abort rebase?')).toBeVisible();
  await expect(page.locator(t('ade-confirm-no'))).toHaveText('Cancel');
  await expect(page.locator(t('ade-confirm-yes'))).toHaveText('Abort');
});

test('a stuck run offers Take over on the Needs you page', async ({ relaunch }) => {
  const board = adeBoard((b) => {
    for (const task of b.tasks) {
      for (const run of task.runs)
        if (String(run.id).startsWith('r_T_bill_impl_')) run.state = 'stuck';
    }
  });
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
  ]);
  await page.locator(t('ade-tab-needs')).click();
  await expect(page.locator(t('ade-needs-item')).first().locator(t('ade-needs-action'))).toHaveText(
    'Take over',
  );
});

test('the plan board with no repositories says where to add them', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: adeV2Control([{ channel: IPC.codeWorkspaceListRepos, response: [] }]),
  });
  const view = page.locator(t('ade-view'));
  await expect(view).toContainText('No repositories yet');
  await expect(view).toContainText(
    'Add repositories from the Git module to start planning agent work.',
  );
});

test('the needs footer pluralises interactive sessions', async ({ relaunch }) => {
  const all = adeFixture<{ sessions: { mode: string }[] }>('sessions').sessions;
  const tui = all.filter((s) => s.mode === 'tui');
  const withCount = (n: number): ControlSnapshot => ({
    channel: IPC.adeTaskSessions,
    response: { sessions: tui.slice(0, n) },
  });

  const one = await openPlan(relaunch, [withCount(1)]);
  await one.window.locator(t('ade-tab-needs')).click();
  await expect(one.window.locator(t('ade-needs-footer'))).toHaveText(/ 1 interactive session$/);
});

test('discarding a memory import asks with Discard / Cancel', async ({ relaunch }) => {
  const job = {
    id: 'J2',
    roots: ['/docs'],
    base: '/docs',
    state: 'paused',
    reason: '',
    truncated: false,
    ignoredCount: 0,
    estimate: { files: 1, chunks: 1, tokens: 100, calls: 1, seconds: 10 },
    progress: { filesDone: 0, filesTotal: 1, chunksDone: 0, chunksTotal: 1 },
    totals: {
      added: 0,
      updated: 0,
      noop: 0,
      dropped: 0,
      unresolved: 0,
      failedFiles: 0,
      skippedFiles: 0,
    },
    channel: 'ui',
    origin: 'external',
    sourceTag: 'doc',
    scope: 'personal',
    project: null,
    sessionId: null,
    groups: [],
    autoStart: false,
    writeDoc: false,
    calls: 0,
    costUsd: 0,
    createdAt: '2026-03-01T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  };
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.memoryImportJobs, response: [job] },
      { channel: IPC.memoryImportJob, args: { id: 'J2' }, response: { job, files: [] } },
      { channel: IPC.memoryImportDiscard },
    ],
  });
  await page.locator('[data-testid="mode-tab"][data-mode="memory"]').click();
  await page.locator(t('memory-import-open')).click();
  await page.locator(t('import-discard')).click();
  const dialog = page.locator(t('confirm-dialog'));
  await expect(dialog).toContainText('Discard import?');
  await expect(dialog).toContainText('Memories already stored stay.');
  await expect(page.locator(t('confirm-dialog-confirm'))).toHaveText('Discard');
  await expect(page.locator(t('confirm-dialog-cancel'))).toHaveText('Cancel');
});

test('a settings field resets with Reset to default', async ({ relaunch }) => {
  const { window: page } = await relaunch();
  await emitWailsEvent(page, IPC.openSettings, undefined);
  await page.locator(t('settings-section-Agent')).click();
  await expect(page.locator(t('settings-reset-agent-notifyIncludeMessage'))).toHaveAccessibleName(
    'Reset to default',
  );
});
