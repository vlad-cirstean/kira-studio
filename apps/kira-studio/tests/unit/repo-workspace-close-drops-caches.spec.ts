// C13-3: closeRepoWorkspace (state/workspace.ts) used to close tabs and dispose the git transport
// but never dropped the repo's own file-tree/search/quick-open caches -- those were wired only to
// removeCodeRepo (deleting the repo entirely), so opening and closing several large repos in one
// session accumulated unbounded retained memory (measured ~55 MB per 50k-file repo). This asserts
// the tree and search caches are actually gone after a plain close, and that a reopen rebuilds
// cleanly from scratch rather than resurrecting stale state.
import './support/window';

import { describe, expect, test } from 'bun:test';
import { restoreAfterEach } from './support/restoreAfterEach';

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);

const { repoWorkspaceKey } = await import('../../../../packages/shared/domain/workspace');
const { tabsState } = await import('../../frontend/src/state/tabs');
const { ensureRepoTreeLoaded, isRepoTreeLoaded, repoTreePaths } = await import(
  '../../frontend/src/repo/state/fileTree'
);
const { repoSearchQuery, setRepoSearchQuery } = await import(
  '../../frontend/src/repo/state/search'
);
const { workspaceState, openRepoWorkspace, closeRepoWorkspace } = await import(
  '../../frontend/src/state/workspace'
);

let repoCounter = 0;
function freshRepoId() {
  repoCounter += 1;
  return `close-workspace-test-${repoCounter}`;
}

describe('C13-3: closeRepoWorkspace drops per-repo caches', () => {
  test('tree cache and search cache are gone after close, workspace list updates', async () => {
    const repoId = freshRepoId();
    (
      control as unknown as { codeWorkspaceListFiles: typeof control.codeWorkspaceListFiles }
    ).codeWorkspaceListFiles = async () => ({
      paths: ['a.ts', 'b.ts'],
      status: {},
      truncated: false,
    });
    (
      control as unknown as {
        codeWorkspaceOpenWorkspace: typeof control.codeWorkspaceOpenWorkspace;
      }
    ).codeWorkspaceOpenWorkspace = async () => {};
    (
      control as unknown as {
        codeWorkspaceCloseWorkspace: typeof control.codeWorkspaceCloseWorkspace;
      }
    ).codeWorkspaceCloseWorkspace = async () => {};
    (control as unknown as { tabsSave: typeof control.tabsSave }).tabsSave = async () => {};

    openRepoWorkspace(repoId);
    expect(workspaceState.openRepos).toContain(repoId);

    ensureRepoTreeLoaded(repoId);
    // ensureRepoTreeLoaded fires refreshRepoTree without awaiting it — drain the microtask queue so
    // the mocked codeWorkspaceListFiles above resolves before asserting on the loaded tree.
    await Promise.resolve();
    await Promise.resolve();
    expect(isRepoTreeLoaded(repoId)).toBe(true);
    expect(repoTreePaths(repoId)).toEqual(['a.ts', 'b.ts']);

    setRepoSearchQuery(repoId, 'needle');
    expect(repoSearchQuery(repoId)).toBe('needle');

    closeRepoWorkspace(repoId);

    expect(workspaceState.openRepos).not.toContain(repoId);
    expect(isRepoTreeLoaded(repoId)).toBe(false);
    expect(repoTreePaths(repoId)).toEqual([]);
    expect(repoSearchQuery(repoId)).toBe('');

    const workspaceId = repoWorkspaceKey(repoId);
    expect(tabsState.tabs.some((t) => (t.workspaceId ?? null) === workspaceId)).toBe(false);

    // Reopening the same repo in the same session must rebuild cleanly rather than surface stale
    // (already-dropped) cache state.
    openRepoWorkspace(repoId);
    ensureRepoTreeLoaded(repoId);
    await Promise.resolve();
    await Promise.resolve();
    expect(isRepoTreeLoaded(repoId)).toBe(true);
    expect(repoTreePaths(repoId)).toEqual(['a.ts', 'b.ts']);
  });
});
