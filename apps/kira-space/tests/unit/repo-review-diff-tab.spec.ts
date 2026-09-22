// C13-1: openRepoReviewDiffTab (state/repoTabs.ts) reused an existing review diff tab keyed only on
// (workspaceId, path, review !== null, left, right) — two DIFFERENT branches sharing the same tip
// and merge base (e.g. a local branch and its remote-tracking counterpart, both pointing at the
// same commit) collided onto one tab, so review.mark/review.comment.add calls kept writing to the
// FIRST branch's review session while the panel showed the second branch's name. This is the
// data-correctness regression test CLAUDE.md calls for given the bug class.
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);
(control as unknown as { tabsSave: typeof control.tabsSave }).tabsSave = () => Promise.resolve();

const { repoWorkspaceKey } = await import('../../frontend/src/state/workspace');
const { asRepoDiffTab } = await import('../../../../packages/shared/domain/tabs');
const { useTabsStore } = await import('../../frontend/src/state/tabs');
const tabsStore = useTabsStore();
const { openRepoReviewDiffTab } = await import('../../frontend/src/state/repoTabs');

let workspaceCounter = 0;
function freshRepoId() {
  workspaceCounter += 1;
  return `review-tab-test-${workspaceCounter}`;
}

describe('C13-1: openRepoReviewDiffTab reuse predicate', () => {
  test('same tip + same merge base but different branches never collapse into one tab', () => {
    const repoId = freshRepoId();
    const sameLeft = 'base-sha';
    const sameRight = 'tip-sha'; // e.g. main and origin/main pointing at the identical commit

    const main = openRepoReviewDiffTab(
      repoId,
      'src/app.ts',
      sameLeft,
      sameRight,
      { left: 'base', right: 'main' },
      { branch: 'main', branchTip: sameRight, leftLabel: 'base' },
      true,
    );
    const originMain = openRepoReviewDiffTab(
      repoId,
      'src/app.ts',
      sameLeft,
      sameRight,
      { left: 'base', right: 'origin/main' },
      { branch: 'origin/main', branchTip: sameRight, leftLabel: 'base' },
      true,
    );

    expect(originMain.id).not.toBe(main.id);
    expect(originMain.reused).toBe(false);

    const workspaceId = repoWorkspaceKey(repoId);
    const tabsInWorkspace = tabsStore.tabs.filter((t) => (t.workspaceId ?? null) === workspaceId);
    expect(tabsInWorkspace.length).toBe(2);

    const mainTab = tabsStore.tabs.find((t) => t.id === main.id);
    const originTab = tabsStore.tabs.find((t) => t.id === originMain.id);
    const mainDiff = mainTab ? asRepoDiffTab(mainTab) : null;
    const originDiff = originTab ? asRepoDiffTab(originTab) : null;
    expect(mainDiff?.state.review?.branch).toBe('main');
    expect(originDiff?.state.review?.branch).toBe('origin/main');
  });

  test('reopening the same branch/path/revision pair still reuses the existing tab', () => {
    const repoId = freshRepoId();
    const first = openRepoReviewDiffTab(
      repoId,
      'src/app.ts',
      'base-sha',
      'tip-sha',
      { left: 'base', right: 'main' },
      { branch: 'main', branchTip: 'tip-sha', leftLabel: 'base' },
      true,
    );
    const second = openRepoReviewDiffTab(
      repoId,
      'src/app.ts',
      'base-sha',
      'tip-sha',
      { left: 'base', right: 'main' },
      { branch: 'main', branchTip: 'tip-sha', leftLabel: 'base' },
      true,
    );
    expect(second.id).toBe(first.id);
    expect(second.reused).toBe(true);
  });
});
