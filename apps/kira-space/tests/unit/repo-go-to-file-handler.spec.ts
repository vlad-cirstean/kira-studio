// P74 §7.2: hostHandlers.ts's 'editor.goToFile' — composes file.goToTarget's three outcomes onto
// openRepoFileTab plus @kira/git-core's mapLineAcrossDiff. Three branches, a line remap only one
// of them applies, and an id-space translation (gitRepoId -> codeRepoId) that throws on a miss
// rather than guessing — worth a direct test at the handler itself rather than through the whole
// transport/UI stack this repo has no mock for yet (gitStreamMock.ts answers only app.init/
// repo.list/refs.list, and has no streaming support at all — see docs/v1.8/SPEC.md's P74 result).
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import type { Transport } from '../../../../packages/git-ipc/src/transport';

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);
(control as unknown as { tabsSave: typeof control.tabsSave }).tabsSave = () => Promise.resolve();

const { asRepoFileTab } = await import('../../frontend/src/state/tabDomain');
const { repoWorkspaceKey } = await import('../../frontend/src/state/workspace');
const { pinia } = await import('../../frontend/src/state/pinia');
setActivePinia(pinia);
const { useCodeReposStore } = await import('../../frontend/src/state/coderepos');
const { useTabsStore } = await import('../../frontend/src/state/tabs');
const tabsStore = useTabsStore();
const { createHostHandlers } = await import('../../frontend/src/repo/git/hostHandlers');

let repoCounter = 0;
function freshRepoPair(): { codeRepoId: string; gitRepoId: string } {
  repoCounter += 1;
  const codeRepoId = `code-repo-${repoCounter}`;
  const gitRepoId = `/repos/git-repo-${repoCounter}`;
  useCodeReposStore().records.push({
    id: codeRepoId,
    name: `repo ${repoCounter}`,
    root: `/repos/root-${repoCounter}`,
    repoId: gitRepoId,
    sortOrder: repoCounter,
    createdAt: '2024-01-01T00:00:00Z',
  });
  return { codeRepoId, gitRepoId };
}

// Only 'file.goToTarget' is ever exercised by the handler under test — anything else is a mistake
// in the test itself, not a case to tolerate silently.
function handlersWithGoToTarget(result: unknown) {
  const remoteRequest = (async (method: string) => {
    if (method !== 'file.goToTarget') throw new Error(`unexpected remoteRequest: ${method}`);
    return result;
  }) as Transport['request'];
  return createHostHandlers({
    remoteRequest,
    codeRepoId: 'unused-in-these-tests',
    emitLocal: () => false,
  });
}

describe("P74 §7.2: editor.goToFile's three outcomes", () => {
  test('live, no hunks: opens the worktree file at the requested line unchanged', async () => {
    const { codeRepoId, gitRepoId } = freshRepoPair();
    const handlers = handlersWithGoToTarget({
      kind: 'live',
      absPath: '/abs/src/app.ts',
      hunks: null,
    });

    const outcome = await handlers['editor.goToFile']?.(
      { repoId: gitRepoId, rev: 'deadbeef', path: 'src/app.ts', line: 42 },
      undefined,
    );

    expect(outcome).toEqual({ kind: 'liveFile', path: 'src/app.ts', line: 42 });
    const ws = repoWorkspaceKey(codeRepoId);
    const tab = tabsStore.tabs.find(
      (t) => (t.workspaceId ?? null) === ws && t.path === 'src/app.ts',
    );
    const file = tab ? asRepoFileTab(tab) : null;
    expect(file?.state.rev ?? null).toBeNull();
    expect(file?.state.revealLine).toBe(42);
  });

  test('live, with hunks: re-maps the requested line across the commit-to-worktree drift', async () => {
    const { gitRepoId } = freshRepoPair();
    // One hunk, net +2 lines (old 1..1 -> new 1..3): a line requested past the hunk's old-side
    // end shifts by that same +2 on the new side — the closed-form branch of mapLineAcrossDiff,
    // exercised here rather than re-derived (G4 D11's own warning against a second algorithm).
    const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 3, heading: '', lines: [] }];
    const handlers = handlersWithGoToTarget({ kind: 'live', absPath: '/abs/src/app.ts', hunks });

    const outcome = await handlers['editor.goToFile']?.(
      { repoId: gitRepoId, rev: 'deadbeef', path: 'src/app.ts', line: 10 },
      undefined,
    );

    expect(outcome).toEqual({ kind: 'liveFile', path: 'src/app.ts', line: 12 });
  });

  test('historical: opens a read-only tab at the resolved rev/path, line unchanged', async () => {
    const { codeRepoId, gitRepoId } = freshRepoPair();
    const rev = 'a'.repeat(40);
    // The resolved path can differ from the request's own (a rename across history) — the tab
    // must open at target.path, never the caller's original path.
    const handlers = handlersWithGoToTarget({ kind: 'historical', rev, path: 'src/renamed.ts' });

    const outcome = await handlers['editor.goToFile']?.(
      { repoId: gitRepoId, rev, path: 'src/old-name.ts', line: 7 },
      undefined,
    );

    expect(outcome).toEqual({ kind: 'virtualBlob', path: 'src/renamed.ts', rev, line: 7 });
    const ws = repoWorkspaceKey(codeRepoId);
    const tab = tabsStore.tabs.find(
      (t) => (t.workspaceId ?? null) === ws && t.path === 'src/renamed.ts',
    );
    const file = tab ? asRepoFileTab(tab) : null;
    expect(file?.state.rev).toBe(rev);
    expect(file?.state.revealLine).toBe(7);
  });

  test('unavailable: passes the reason through and opens no tab', async () => {
    const { codeRepoId, gitRepoId } = freshRepoPair();
    const ws = repoWorkspaceKey(codeRepoId);
    const tabCountBefore = tabsStore.tabs.filter((t) => (t.workspaceId ?? null) === ws).length;
    const handlers = handlersWithGoToTarget({ kind: 'unavailable', reason: 'notInRevision' });

    const outcome = await handlers['editor.goToFile']?.(
      { repoId: gitRepoId, rev: 'deadbeef', path: 'gone.ts', line: 1 },
      undefined,
    );

    expect(outcome).toEqual({ kind: 'unavailable', reason: 'notInRevision' });
    expect(tabsStore.tabs.filter((t) => (t.workspaceId ?? null) === ws).length).toBe(
      tabCountBefore,
    );
  });

  test('an unknown git repoId throws rather than guessing a code repo', async () => {
    const handlers = handlersWithGoToTarget({ kind: 'live', absPath: '/abs/x', hunks: null });
    await expect(
      handlers['editor.goToFile']?.(
        { repoId: '/repos/never-registered', rev: 'deadbeef', path: 'x.ts', line: 1 },
        undefined,
      ),
    ).rejects.toThrow(/unknown git repoId/);
  });
});
