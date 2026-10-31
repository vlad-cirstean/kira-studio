import { AGENT_PANEL_ON, expect, reviewTest, test } from './fixtures';
import { contract } from './support/contract';
import { gitStreamParams } from './support/gitStreamMock';
import {
  COMMIT_DETAIL,
  openPortGraph,
  PICKER_RESULTS,
  rootRow,
  SHA_A,
  singleRowChunks,
} from './support/gitUiPortFixtures';
import { GIT, reviewControl, target } from './support/reviewHunkDiff';

// Azure Repos as the code host. Contract git-host-azure; backend half: githostflow TestAzureRepos.

const az = (key: string) => contract('git-host-azure', `git:${key}`);
const providers = az('gitHost.providers') as { providers: { id: string }[] };
const t = (id: string) => `[data-testid="${id}"]`;

test('contract: the commit detail names the pull request and its host', async ({ relaunch }) => {
  const resolved = az('branch.resolveChangeRequest') as {
    changeRequests: { number: number; url: string }[];
  };
  const pr = resolved.changeRequests[0];
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, COMMIT_DETAIL.subject)]),
    results: {
      'gitHost.info': az('gitHost.info'),
      'gitHost.providers': providers,
      'commit.detail': COMMIT_DETAIL,
      'commit.resolveChangeRequests': resolved,
    },
  });
  await page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]').click();
  await expect(page.locator(t('meta-subject'))).toBeVisible();
  await expect(page.locator(t('commit-meta-change-request-icon'))).toHaveAttribute(
    'aria-label',
    `Open pull request #${pr?.number} on Azure Repos`,
  );
});

test('contract: the repository settings offer Azure Repos', async ({ relaunch }) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, COMMIT_DETAIL.subject)]),
    results: {
      ...PICKER_RESULTS,
      'gitHost.info': az('gitHost.info'),
      'gitHost.providers': providers,
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
  await expect(page.getByLabel('Show status from').locator('option')).toHaveText([
    'Detect from remote',
    'Off',
    'GitHub',
    'Azure Repos',
  ]);
});

reviewTest('contract: approving a pull request submits the review', async ({ relaunch }) => {
  const state = az('changeRequest.reviewState') as { headSha: string };
  const { window: page } = await relaunch({
    storage: AGENT_PANEL_ON,
    control: reviewControl([]),
    gitStream: {
      ...GIT,
      extraResults: {
        ...GIT.extraResults,
        'changeRequest.reviewState': { ...state, localHeadSha: state.headSha, state: 'open' },
        'changeRequest.submitReview': az('changeRequest.submitReview'),
        'changeRequest.comment': az('changeRequest.comment'),
      },
    },
  });
  await page.locator(t('ade-review-window')).waitFor();
  await page.locator(t('ade-review-actions-trigger')).click();
  await page.locator(t('ade-review-action-approve')).click();
  await expect(page.getByRole('dialog')).toContainText('Approve PR #12');
  await page.locator(t('ade-review-submit-body')).fill('LGTM');
  await page.locator(t('ade-review-submit')).click();
  await expect(page.locator(t('ade-review-posted'))).toContainText('Review submitted');
  expect(await gitStreamParams(page, 'changeRequest.submitReview')).toEqual([
    {
      repoId: target.gitRepoId,
      number: 12,
      event: 'approve',
      body: 'LGTM',
      headSha: state.headSha,
    },
  ]);
});
