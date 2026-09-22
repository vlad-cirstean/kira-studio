// P74 §7.3: openRepoFileTab's own existing-tab lookup includes `rev` — the worktree file and the
// same path at a revision (or at two different revisions) must never collapse into one tab, the
// identical class of gap openRepoReviewDiffTab's own bug (repo-review-diff-tab.spec.ts) guards one
// kind over. Also covers repoFileTitle carrying the short rev (tabKinds.ts), the one visible signal
// distinguishing such tabs in the strip.
import './support/window';

import { describe, expect, test } from 'bun:test';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';
import { restoreAfterEach } from './support/restoreAfterEach';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);
(control as unknown as { tabsSave: typeof control.tabsSave }).tabsSave = () => Promise.resolve();

const { asRepoFileTab } = await import('../../../../packages/shared/domain/tabs');
const { repoWorkspaceKey } = await import('../../frontend/src/state/workspace');
const { TAB_KINDS } = await import('../../frontend/src/state/tabKinds');
const { useTabsStore } = await import('../../frontend/src/state/tabs');
const tabsStore = useTabsStore();
const { openRepoFileTab } = await import('../../frontend/src/state/repoTabs');

let repoCounter = 0;
function freshRepoId(): string {
  repoCounter += 1;
  return `rev-tab-test-${repoCounter}`;
}

describe('P74 §7.3: openRepoFileTab at a revision', () => {
  test('the worktree file and the same path at a revision are two different tabs', () => {
    const repoId = freshRepoId();
    const worktree = openRepoFileTab(repoId, 'src/app.ts', { preview: false });
    const historical = openRepoFileTab(repoId, 'src/app.ts', {
      preview: false,
      rev: 'a'.repeat(40),
    });
    expect(historical.id).not.toBe(worktree.id);
    expect(historical.reused).toBe(false);
  });

  test('two different revisions of the same path are two different tabs', () => {
    const repoId = freshRepoId();
    const revA = openRepoFileTab(repoId, 'src/app.ts', { preview: false, rev: 'a'.repeat(40) });
    const revB = openRepoFileTab(repoId, 'src/app.ts', { preview: false, rev: 'b'.repeat(40) });
    expect(revB.id).not.toBe(revA.id);
    expect(revB.reused).toBe(false);
  });

  test('reopening the same path at the same revision reuses the existing tab', () => {
    const repoId = freshRepoId();
    const rev = 'c'.repeat(40);
    const first = openRepoFileTab(repoId, 'src/app.ts', { preview: true, rev });
    const second = openRepoFileTab(repoId, 'src/app.ts', { preview: false, rev });
    expect(second.id).toBe(first.id);
    expect(second.reused).toBe(true);
  });

  test('a tab opened at a revision titles with the short rev; the worktree tab does not', () => {
    const repoId = freshRepoId();
    const rev = 'd'.repeat(40);
    const historical = openRepoFileTab(repoId, 'src/deep/file.ts', { preview: false, rev });
    const worktree = openRepoFileTab(repoId, 'src/deep/file.ts', { preview: false });

    const historicalTab = tabsStore.tabs.find((t) => t.id === historical.id) ?? null;
    const worktreeTab = tabsStore.tabs.find((t) => t.id === worktree.id) ?? null;
    expect(historicalTab).not.toBeNull();
    expect(worktreeTab).not.toBeNull();
    expect(historicalTab && TAB_KINDS['repo-file'].title(historicalTab)).toBe(
      `file.ts (${rev.slice(0, 7)})`,
    );
    expect(worktreeTab && TAB_KINDS['repo-file'].title(worktreeTab)).toBe('file.ts');
    expect(historicalTab && asRepoFileTab(historicalTab)?.state.rev).toBe(rev);
    expect(worktreeTab && asRepoFileTab(worktreeTab)?.state.rev).toBeNull();
  });

  test('a permanent open of a historical preview tab promotes it out of its own cohort', () => {
    const repoId = freshRepoId();
    const rev = 'e'.repeat(40);
    const ws = repoWorkspaceKey(repoId);
    const preview = openRepoFileTab(repoId, 'src/app.ts', { preview: true, rev });
    expect(tabsStore.previewIdsByWorkspace[ws] ?? []).toContain(preview.id);

    openRepoFileTab(repoId, 'src/app.ts', { preview: false, rev });
    expect(tabsStore.previewIdsByWorkspace[ws] ?? []).not.toContain(preview.id);
  });
});
