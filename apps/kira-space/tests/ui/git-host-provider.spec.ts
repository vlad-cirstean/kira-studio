import type { Page } from '@playwright/test';
import { expect, reviewTest, test } from './fixtures';
import { adeBoard, adeFixture, adeV2Control, openPlan } from './support/adeV2';
import {
  COMMIT_DETAIL,
  openPortGraph,
  PICKER_RESULTS,
  rootRow,
  SHA_A,
  singleRowChunks,
} from './support/gitUiPortFixtures';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// A second code host (merge requests on Forge) drives every label, link and button. Backend half:
// githostflow TestSecondGitHostRegistered.

const FORGE = {
  id: 'forge',
  label: 'Forge',
  changeRequest: 'Merge request',
  changeRequestNoun: 'merge request',
  changeRequestShort: 'MR',
  cli: 'Forge CLI',
  fileReviewSync: true,
};
const GITHUB = adeFixture<{ providers: object[] }>('host-providers').providers[0];
const PROVIDERS = { providers: [GITHUB, FORGE] };
const MR_URL = 'https://forge.test/acme/web-app/-/merge_requests/7';

const t = (id: string) => `[data-testid="${id}"]`;

const GIT_HOST = { 'gitHost.info': { host: FORGE }, 'gitHost.providers': PROVIDERS };

async function openForgeCommit(relaunch: Parameters<typeof openPortGraph>[0]): Promise<Page> {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, COMMIT_DETAIL.subject)]),
    results: {
      ...GIT_HOST,
      'commit.detail': COMMIT_DETAIL,
      'commit.resolveChangeRequests': {
        kind: 'ok',
        changeRequests: [
          {
            number: 7,
            title: 'Fix login',
            url: MR_URL,
            state: 'open',
            headRef: 'main',
            headSha: SHA_A,
            baseRef: 'main',
            updatedAt: 0,
          },
        ],
      },
    },
  });
  await page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]').click();
  await expect(page.locator(t('meta-subject'))).toBeVisible();
  return page;
}

test('the commit detail names the merge request and its host', async ({ relaunch }) => {
  const page = await openForgeCommit(relaunch);
  await expect(page.locator(t('commit-meta-change-request-icon'))).toHaveAttribute(
    'aria-label',
    'Open merge request #7 on Forge',
  );
  await page.locator(t('meta-body-toggle')).click();
  await expect(page.locator(t('commit-meta'))).toContainText('Merge request');
  await expect(page.locator(t('commit-meta'))).toContainText('#7 Fix login');
});

test('the repository settings offer every registered host', async ({ relaunch }) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, COMMIT_DETAIL.subject)]),
    results: {
      ...PICKER_RESULTS,
      ...GIT_HOST,
      'repoSettings.get': {
        'kiraSpace.graph.pageSize': 500,
        'kiraSpace.graph.scope': 'all',
        'kiraSpace.stash.showInGraph': true,
        'kiraSpace.stash.includeUntracked': false,
        'kiraSpace.review.baseCandidates': ['main'],
        'kiraSpace.pull.strategy': 'auto',
        'kiraSpace.gitHost.provider': 'auto',
        'kiraSpace.worktree.prepareScript': '',
        'kiraSpace.worktree.basePath': '',
        'kiraSpace.checkout.autoStash': true,
      },
    },
  });
  await page.locator(t('repo-settings-button')).click();
  const select = page.getByLabel('Show status from');
  await expect(select.locator('option')).toHaveText([
    'Detect from remote',
    'Off',
    'GitHub',
    'Forge',
  ]);
});

// The ADE board: the branch panel and the task link read the host from the board's own answers.

function forgeChangeRequests() {
  const fx = adeFixture<{
    repos: { host: unknown }[];
    branches: Record<string, unknown>;
    branchUrls: Record<string, string>;
  }>('change-requests');
  for (const r of fx.repos) if (r.host) r.host = FORGE;
  fx.branches.b_auth = { number: 7, title: 'Fix login', state: 'Open', url: MR_URL };
  fx.branchUrls.b_auth = 'https://forge.test/acme/web-app/-/tree/feat/oauth-login';
  return fx;
}

test('the branch panel and the task link use the host words', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.gitHostProviders, response: PROVIDERS },
    { channel: IPC.adeTaskChangeRequests, response: forgeChangeRequests() },
    {
      channel: IPC.adeTaskBoard,
      response: adeBoard((b) => {
        const task = b.tasks.find((x) => x.id === 'T_auth');
        if (!task) throw new Error('fixture task missing');
        Object.assign(task, {
          hostUrl: MR_URL,
          hostLink: { provider: 'forge', kind: 'changeRequest', ref: 'web-app!7' },
        });
      }),
    },
  ]);
  await page.locator(`${t('ade-card')}[data-task-id="T_auth"] ${t('ade-card-head')}`).click();
  const link = page.locator(t('ade-task-host-link'));
  await expect(link).toHaveText('web-app!7');
  await expect(page.locator('dd', { has: link })).toContainText('MR');

  await page.locator(`${t('ade-task-branch')}[data-branch-id="b_auth"]`).click();
  const pr = page.locator(t('ade-branch-pr'));
  await expect(pr).toContainText('#7');
  await expect(
    page.locator(t('ade-branch-details')).getByText('MR', { exact: true }),
  ).toBeVisible();
  await expect(pr.getByRole('button', { name: 'Copy MR link' })).toBeVisible();
  await expect(
    page.locator(t('ade-branch-details')).locator('a', { hasText: 'feat/oauth-login' }),
  ).toHaveAttribute('href', 'https://forge.test/acme/web-app/-/tree/feat/oauth-login');
});

// The review window's sync button.

const target = adeFixture<{ gitRepoId: string }>('review-target');

function syncControl(plan: object): ControlSnapshot[] {
  return adeV2Control([
    { channel: IPC.adeTaskReviewWindowTarget, response: target },
    { channel: IPC.adeTaskReviewAgent, response: { session: null, hostWindowKey: '' } },
    { channel: IPC.adeTaskViewedSyncPlan, response: plan },
    { channel: IPC.gitHostProviders, response: PROVIDERS },
  ]);
}

const forgePlan = (patch: object) => ({
  ...adeFixture<object>('viewed-sync-plan'),
  host: FORGE,
  changeRequest: { number: 7, title: 'Fix login', state: 'open', url: MR_URL },
  ...patch,
});

async function openSync(
  relaunch: Parameters<Parameters<typeof reviewTest>[2]>[0]['relaunch'],
  plan: object,
): Promise<Page> {
  const { window: page } = await relaunch({
    control: syncControl(plan),
    gitStream: {
      repoId: target.gitRepoId,
      extraResults: {
        'review.resolveBase': {
          branch: 'feat/billing-dashboard',
          base: 'main',
          reason: 'override',
          range: { kind: 'ready', commitCount: 3 },
          candidates: [],
        },
        'review.files': { branchTip: 'a'.repeat(40), mergeBase: 'b'.repeat(40), files: [] },
        'review.session.load': null,
        'repo.open': null,
      },
    },
  });
  await page.locator(t('ade-review-window')).waitFor();
  return page;
}

reviewTest('the sync button names the host and its merge requests', async ({ relaunch }) => {
  const page = await openSync(relaunch, forgePlan({}));
  await expect(page.locator(t('ade-review-sync'))).toHaveText('Sync to Forge · 2');
  await page.locator(t('ade-review-sync')).click();
  await page.locator(t('ade-review-sync-skipped')).getByRole('button').first().click();
  await expect(page.locator(t('ade-review-sync-skipped'))).toContainText('Not in the MR');
});

reviewTest('a missing host CLI is named in the sync button tooltip', async ({ relaunch }) => {
  const page = await openSync(relaunch, forgePlan({ status: 'cliMissing', files: [] }));
  await page.locator(t('ade-review-sync')).locator('..').hover();
  await expect(page.getByRole('tooltip')).toContainText('Install the Forge CLI');
});

reviewTest('a host without file review sync hides the sync button', async ({ relaunch }) => {
  const page = await openSync(
    relaunch,
    forgePlan({ status: 'unsupported', files: [], host: { ...FORGE, fileReviewSync: false } }),
  );
  await expect(page.locator(t('ade-review-header'))).toBeVisible();
  await expect(page.locator(t('ade-review-sync'))).toHaveCount(0);
});
