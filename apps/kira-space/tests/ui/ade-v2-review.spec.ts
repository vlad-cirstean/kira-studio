import type { Page } from '@playwright/test';
import { expect, reviewTest, test } from './fixtures';
import {
  adeFixture,
  adeV2Control,
  emitAgentEvent,
  emitAgentSessions,
  openPlan,
} from './support/adeV2';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// The review window: three panes for one branch, the review agent and the GitHub sync.

const t = (id: string) => `[data-testid="${id}"]`;
const target = adeFixture<{ gitRepoId: string }>('review-target');
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
    { channel: IPC.adeTaskGitHubSyncPlan, response: adeFixture('gh-sync-plan') },
    { channel: IPC.adeTaskGitHubSyncApply, response: adeFixture('gh-sync-result') },
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
  await expect(page.locator(t('ade-review-base'))).toHaveText('base main');
  await expect(page.locator(t('ade-review-left'))).toBeVisible();
  await expect(page.locator(t('ade-review-centre'))).toBeVisible();
  await expect(page.locator(t('ade-review-right'))).toBeVisible();
  await expect(page.locator(t('ade-review-empty'))).toBeVisible();
});

test('any other window boots the normal workbench', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await expect(page.locator(t('ade-review-window'))).toHaveCount(0);
});

reviewTest('the files pane lists only what needs review', async ({ relaunch }) => {
  const page = await openReview(relaunch);
  const left = page.locator(t('ade-review-left'));
  await expect(left).toContainText('pending.ts');
  await expect(left).toContainText('moved.ts');
  await expect(left).not.toContainText('done.ts');
});

reviewTest('with no review agent the panel offers to start one', async ({ relaunch }) => {
  const page = await openReview(relaunch);
  await expect(page.locator(t('ade-review-start'))).toHaveText('Start review agent');
  await expect(page.locator(t('ade-review-compose'))).toHaveCount(0);
});

reviewTest('Send is disabled while the agent waits on input', async ({ relaunch }) => {
  const terminalId = agent.session.terminalId;
  const page = await openReview(relaunch, [{ channel: IPC.adeTaskReviewAgent, response: agent }]);
  await emitAgentSessions(page, [terminalId]);
  const send = page.locator(t('ade-review-send'));
  await page.locator(t('ade-review-question')).fill('why this change?');
  await expect(send).toBeEnabled();
  await emitAgentEvent(page, terminalId, 'Notification');
  await expect(send).toBeDisabled();
});

reviewTest('a watched turn ends when the agent terminal disappears', async ({ relaunch }) => {
  const terminalId = agent.session.terminalId;
  const page = await openReview(relaunch, [
    { channel: IPC.adeTaskReviewAgent, response: agent },
    { channel: IPC.adeTaskSend },
  ]);
  await emitAgentSessions(page, [terminalId]);
  await page.locator(t('ade-review-question')).fill('why this change?');
  await page.locator(t('ade-review-send')).click();
  await emitAgentEvent(page, terminalId, 'UserPromptSubmit');
  await expect(page.locator(t('ade-review-status'))).toBeVisible();
  await emitAgentSessions(page, [terminalId]);
  await emitAgentSessions(page, []);
  await expect(page.locator(t('ade-review-status'))).toHaveCount(0);
});

reviewTest(
  'the sync button lists what it will do and why it skips the rest',
  async ({ relaunch }) => {
    const page = await openReview(relaunch);
    await page.locator(t('ade-review-sync')).click();
    const popover = page.locator(t('ade-review-sync-popover'));
    await expect(popover.locator(t('ade-review-sync-rows'))).toContainText('src/a.ts');
    await popover.locator(t('ade-review-sync-skipped')).evaluate((d) => d.setAttribute('open', ''));
    await expect(popover.locator(t('ade-review-sync-skipped'))).toContainText(
      'changed since review',
    );
    await expect(popover.locator(t('ade-review-sync-skipped'))).toContainText('not in the PR');
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
    ...adeFixture<object>('gh-sync-plan'),
    status: 'headNotFetched',
    message: 'PR head not fetched',
  };
  const page = await openReview(relaunch, [
    { channel: IPC.adeTaskRefresh, response: failed },
    { channel: IPC.adeTaskGitHubSyncPlan, response: plan },
  ]);
  await page.locator(t('ade-review-sync')).click();
  await page.locator(t('ade-review-sync-refresh')).dispatchEvent('click');
  await expect(page.locator(t('ade-review-sync-error'))).toHaveText('Could not fetch origin');
});

reviewTest('the sync button is hidden when the branch has no PR', async ({ relaunch }) => {
  const plan = { ...adeFixture<object>('gh-sync-plan'), status: 'noPr', pr: null, files: [] };
  const page = await openReview(relaunch, [{ channel: IPC.adeTaskGitHubSyncPlan, response: plan }]);
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
    expect(await stored()).toBe(String(start));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(stored).toBe(String(Math.round(start + 60)));
  },
);

reviewTest(
  'the sync button stays visible and disabled when its plan fails to load',
  async ({ relaunch }) => {
    const page = await openReview(relaunch, [
      { channel: IPC.adeTaskGitHubSyncPlan, error: { code: 'invalid', message: 'gh exploded' } },
    ]);
    const button = page.locator(t('ade-review-sync'));
    await expect(button).toBeDisabled();
    await button.locator('xpath=..').hover();
    await expect(page.getByText('Could not load the sync plan: gh exploded').first()).toBeVisible();
  },
);
