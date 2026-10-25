import type { Page } from '@playwright/test';
import { expect, reviewTest, test } from './fixtures';
import {
  adeFixture,
  adeV2Control,
  emitAgentEvent,
  emitAgentSessions,
  openPlan,
} from './support/adeV2';
import { contract } from './support/contract';
import { gitStreamRequests } from './support/gitStreamMock';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// The review window: three panes for one branch, the review agent and the GitHub sync.

const t = (id: string) => `[data-testid="${id}"]`;
const target = adeFixture<{ gitRepoId: string; codeRepoId: string; branchId: string }>(
  'review-target',
);
const agent = adeFixture<{ session: { terminalId: string } }>('review-agent');

const change = (path: string) => ({
  kind: 'modified',
  path,
  similarity: 0,
});
const status = (kind: 'none' | 'full', changedSinceReview: boolean) => ({
  kind,
  changedSinceReview,
});

const REVIEW_FILES = {
  branchTip: 'a'.repeat(40),
  mergeBase: 'b'.repeat(40),
  files: [
    { change: change('src/pending.ts'), review: status('none', false) },
    { change: change('src/done.ts'), review: status('full', false) },
    { change: change('src/moved.ts'), review: status('full', true) },
  ],
};

const GIT = {
  repoId: target.gitRepoId,
  extraResults: {
    'review.resolveBase': {
      branch: 'feat/billing-dashboard',
      base: 'main',
      reason: 'override',
      range: { kind: 'ready', commitCount: 3 },
      candidates: [],
    },
    'review.files': REVIEW_FILES,
    'review.session.load': null,
    'repo.open': null,
  },
};

function reviewControl(extra: readonly ControlSnapshot[] = []): ControlSnapshot[] {
  const defaults: ControlSnapshot[] = [
    { channel: IPC.adeTaskReviewWindowTarget, response: target },
    { channel: IPC.adeTaskReviewAgent, response: { session: null, hostWindowKey: '' } },
    { channel: IPC.adeTaskViewedSyncPlan, response: adeFixture('viewed-sync-plan') },
    { channel: IPC.adeTaskViewedSyncApply, response: adeFixture('viewed-sync-result') },
  ];
  const overridden = new Set(extra.map((e) => e.channel));
  return adeV2Control([...defaults.filter((d) => !overridden.has(d.channel)), ...extra]);
}

async function openReview(
  relaunch: Parameters<Parameters<typeof reviewTest>[2]>[0]['relaunch'],
  extra: readonly ControlSnapshot[] = [],
): Promise<Page> {
  const { window: page } = await relaunch({ control: reviewControl(extra), gitStream: GIT });
  await page.locator(t('ade-review-window')).waitFor();
  return page;
}

reviewTest('a review window boots three panes for its branch', async ({ relaunch }) => {
  const page = await openReview(relaunch);
  await expect(page.locator(t('ade-review-branch'))).toHaveText('feat/billing-dashboard');
  await expect(page.locator(t('ade-review-base'))).toHaveText('Base main');
  await expect(page.locator(t('ade-review-left'))).toBeVisible();
  await expect(page.locator(t('ade-review-centre'))).toBeVisible();
  await expect(page.locator(t('ade-review-right'))).toBeVisible();
  await expect(page.locator(t('ade-review-empty'))).toBeVisible();
});

test('any other window boots the normal workbench', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await expect(page.locator(t('ade-review-window'))).toHaveCount(0);
});

reviewTest('the files pane lists every changed file like the git module', async ({ relaunch }) => {
  const page = await openReview(relaunch);
  const left = page.locator(t('ade-review-left'));
  await expect(left).toContainText('pending.ts');
  await expect(left).toContainText('moved.ts');
  await expect(left).toContainText('done.ts');
  await expect(left.getByText('Needs review')).toHaveCount(0);
});

reviewTest("the left bar stays on the window's branch", async ({ relaunch }) => {
  const page = await openReview(relaunch);
  await expect(page.locator(t('review-branch-name'))).toHaveText('feat/billing-dashboard');
  await expect(page.locator(t('review-base-name'))).toHaveText('main');
  for (const id of ['review-back-button', 'review-swap-button', 'base-selector-trigger']) {
    await expect(page.locator(t(id))).toHaveCount(0);
  }
  await page.locator(t('review-pane-commits')).click();
  await page.locator(t('review-pane-files')).click();
  expect(await gitStreamRequests(page)).not.toContain('review.session.save');
});

reviewTest('a review diff opens side by side', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: reviewControl([
      { channel: IPC.windowsEnsure, response: { mode: 'git' } },
      {
        channel: IPC.codeWorkspaceListRepos,
        response: [
          {
            id: target.codeRepoId,
            name: 'web-app',
            root: '/tmp/web-app',
            repoId: target.gitRepoId,
            sortOrder: 1,
            color: 'none',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ]),
    gitStream: {
      ...GIT,
      extraResults: {
        ...GIT.extraResults,
        'file.read': { kind: 'found', content: 'export const a = 1;\n' },
        'review.snapshot': { kind: 'none', text: null, reviewedAtSha: null },
        'review.fileDiff': {
          path: 'src/pending.ts',
          deltaSource: 'noSnapshot',
          body: { kind: 'text', hunks: [] },
          reviewedRanges: [],
          lineCount: 1,
          reviewedAtSha: null,
        },
      },
    },
  });
  await page.locator(t('ade-review-window')).waitFor();
  await page
    .locator(`${t('review-files-tree')} ${t('file-tree-row')}`, { hasText: 'pending.ts' })
    .click();
  const editor = page.locator(t('repo-diff-editor'));
  await expect(editor.locator('.monaco-diff-editor .editor.original')).toBeVisible();
  const width = await editor
    .locator('.monaco-diff-editor .editor.original')
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(100);
});

reviewTest('with no review agent the panel offers to start one', async ({ relaunch }) => {
  const page = await openReview(relaunch);
  await expect(page.locator(t('ade-review-start'))).toHaveText('Start review agent');
  await expect(page.locator(t('ade-review-compose'))).toHaveCount(0);
});

const openComment = (id: number, state: 'open' | 'addressed' = 'open') => ({
  id,
  path: 'src/billing.ts',
  range: { start: 10 * id, end: 10 * id },
  body: `Comment ${id}`,
  anchor: 'exact',
  anchorSha: 'a'.repeat(40),
  createdAt: 1_790_036_500_000,
  kind: 'change',
  state,
  reply: '',
  repliedAt: null,
  sentAt: null,
});

async function openForward(
  relaunch: Parameters<Parameters<typeof reviewTest>[2]>[0]['relaunch'],
  comments: readonly unknown[],
  extra: readonly ControlSnapshot[] = [],
): Promise<{ page: Page; control: { log(): { channel: string; args?: unknown }[] } }> {
  const { window: page, control } = await relaunch({
    control: reviewControl([{ channel: IPC.adeTaskReviewAgent, response: agent }, ...extra]),
    gitStream: {
      ...GIT,
      extraResults: {
        ...GIT.extraResults,
        'review.comment.list': { at: 'a'.repeat(40), comments },
      },
    },
  });
  await page.locator(t('ade-review-window')).waitFor();
  await emitAgentSessions(page, [agent.session.terminalId]);
  return { page, control };
}

reviewTest('the running review agent is a plain terminal', async ({ relaunch }) => {
  const { page } = await openForward(
    relaunch,
    [],
    [{ channel: IPC.mobileLaunchOpened, response: null }],
  );
  await emitWailsEvent(page, IPC.mobileOpenLaunch, {
    launch: {
      ...adeFixture<object>('launch'),
      terminalId: agent.session.terminalId,
      sessionId: 'rv01',
    },
    taskId: 'T_bill',
    branchId: 'b_billdash',
  });
  await expect(page.locator(t('ade-tui-pane'))).toBeVisible();
  await expect(page.locator(t('ade-review-question'))).toHaveCount(0);
  await expect(page.locator(t('ade-review-compose'))).toHaveCount(0);
});

// Contract ade-review-forward, backend half: adeflow TestReviewForwardComments.
reviewTest('contract: forward review comments', async ({ relaunch }) => {
  const args = contract<{ branchId: string }>(
    'ade-review-forward',
    'args:AdeTaskService.ForwardReviewComments',
  );
  const result = contract<{ count: number }>(
    'ade-review-forward',
    'AdeTaskService.ForwardReviewComments',
  );
  const { page, control } = await openForward(
    relaunch,
    [openComment(1), openComment(2), openComment(3, 'addressed')],
    [{ channel: IPC.adeTaskForwardReviewComments, response: result }],
  );
  const button = page.locator(t('ade-review-forward'));
  await expect(button).toHaveText('Send review comments · 2');
  await expect(button).toBeEnabled();
  await button.click();
  const forwarded = () =>
    control.log().filter((e) => e.channel === IPC.adeTaskForwardReviewComments);
  await expect.poll(forwarded).toHaveLength(1);
  expect(Object.keys(args)).toEqual(Object.keys(forwarded()[0]?.args as object));
  expect(forwarded()[0]?.args).toEqual({ branchId: target.branchId });
});

reviewTest(
  'forward is disabled while the agent waits on input or nothing is open',
  async ({ relaunch }) => {
    const { page } = await openForward(relaunch, [openComment(1)]);
    const button = page.locator(t('ade-review-forward'));
    await expect(button).toBeEnabled();
    await emitAgentEvent(page, agent.session.terminalId, 'Notification');
    await expect(button).toBeDisabled();

    const empty = await openForward(relaunch, [openComment(1, 'addressed')]);
    await expect(empty.page.locator(t('ade-review-forward'))).toBeDisabled();
    await expect(empty.page.locator(t('ade-review-forward'))).toHaveText(
      'Send review comments · 0',
    );
  },
);

reviewTest(
  'the sync button lists what it will do and why it skips the rest',
  async ({ relaunch }) => {
    const page = await openReview(relaunch);
    await page.locator(t('ade-review-sync')).click();
    const popover = page.locator(t('ade-review-sync-popover'));
    await expect(popover.locator(t('ade-review-sync-rows'))).toContainText('src/a.ts');
    const trigger = await page.locator(t('ade-review-sync')).boundingBox();
    const box = await popover.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y - (trigger!.y + trigger!.height)).toBeLessThanOrEqual(16);
    expect(Math.abs(box!.x + box!.width - (trigger!.x + trigger!.width))).toBeLessThanOrEqual(2);
    await popover.locator(t('ade-review-sync-skipped')).getByRole('button').first().click();
    await expect(popover.locator(t('ade-review-sync-skipped'))).toContainText(
      'Changed since review',
    );
    await expect(popover.locator(t('ade-review-sync-skipped'))).toContainText('Not in the PR');
  },
);

reviewTest('a failed fetch from the sync popover shows its error', async ({ relaunch }) => {
  const failed = {
    repos: [
      {
        codeRepoId: 'repo-web-app',
        refsChanged: 0,
        mergedInto: [],
        error: { kind: 'network', message: 'Could not fetch origin', remoteMessage: '' },
      },
    ],
  };
  const plan = {
    ...adeFixture<object>('viewed-sync-plan'),
    status: 'headNotFetched',
    message: 'PR head not fetched',
  };
  const page = await openReview(relaunch, [
    { channel: IPC.adeTaskRefresh, response: failed },
    { channel: IPC.adeTaskViewedSyncPlan, response: plan },
  ]);
  await page.locator(t('ade-review-sync')).click();
  await page.locator(t('ade-review-sync-refresh')).click();
  await expect(page.locator(t('ade-review-sync-error'))).toHaveText('Could not fetch origin');
});

reviewTest('the sync button is hidden when the branch has no PR', async ({ relaunch }) => {
  const plan = {
    ...adeFixture<object>('viewed-sync-plan'),
    status: 'noPr',
    changeRequest: null,
    files: [],
  };
  const page = await openReview(relaunch, [{ channel: IPC.adeTaskViewedSyncPlan, response: plan }]);
  await expect(page.locator(t('ade-review-header'))).toBeVisible();
  await expect(page.locator(t('ade-review-sync'))).toHaveCount(0);
});

reviewTest(
  'dragging a pane handle stores the dragged width; a click stores none',
  async ({ relaunch }) => {
    const page = await openReview(relaunch);
    const left = page.locator(t('ade-review-left'));
    const handle = page.locator(t('ade-panel-resize-handle')).first();
    const start = (await left.boundingBox())?.width ?? 0;
    const box = await handle.boundingBox();
    if (!box) throw new Error('no handle');
    const x = box.x + box.width / 2;
    const y = box.y + 200;
    const stored = () => page.evaluate(() => localStorage.getItem('kira.ade.review.leftWidth'));
    await page.mouse.click(x, y);
    expect(await stored()).toBeNull();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(stored).toBe(String(Math.round(start + 60)));
  },
);

reviewTest('arrow keys on a pane handle resize and store the left width', async ({ relaunch }) => {
  const page = await openReview(relaunch);
  const left = page.locator(t('ade-review-left'));
  const handle = page.locator(t('ade-panel-resize-handle')).first();
  const start = (await left.boundingBox())?.width ?? 0;
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await left.boundingBox())?.width ?? 0).toBeGreaterThan(start);
  const stored = await page.evaluate(() => localStorage.getItem('kira.ade.review.leftWidth'));
  expect(Number(stored)).toBeGreaterThan(start);
});

reviewTest(
  'the sync button stays visible and disabled when its plan fails to load',
  async ({ relaunch }) => {
    const page = await openReview(relaunch, [
      { channel: IPC.adeTaskViewedSyncPlan, error: { code: 'invalid', message: 'gh exploded' } },
    ]);
    const button = page.locator(t('ade-review-sync'));
    await expect(button).toBeDisabled();
    await button.locator('xpath=..').hover();
    await expect(page.getByText('Couldn’t load the sync plan: gh exploded').first()).toBeVisible();
  },
);
