// C13-7: quickOpenTruncated (now quickOpenIndexTruncated) read `snapshotCache.get(repoId)?.
// candidatesTruncated` for its own half of "is the candidate set capped" -- but snapshotCache is a
// plain (non-reactive) Map, so that read registered no Vue dependency. A `computed` wrapping it
// (QuickOpen.vue's own `truncated`) then cached whatever it evaluated to on first access forever:
// a repo tree crossing QUICK_OPEN_MAX_CANDIDATES after the palette had already opened once never
// flipped the notice on. This reproduces that exact sequence through a real Vue `computed`.
import './support/window';

import { describe, expect, test } from 'bun:test';
import { setActivePinia } from 'pinia';
import { computed } from 'vue';
import { pinia } from '../../frontend/src/state/pinia';
import { restoreAfterEach } from './support/restoreAfterEach';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);

const { refreshRepoTree } = await import('../../frontend/src/repo/state/fileTree');
const { useWorkspaceStore } = await import('../../frontend/src/state/workspace');
const { useQuickOpenStore, QUICK_OPEN_MAX_CANDIDATES } = await import(
  '../../frontend/src/repo/state/quickOpen'
);

const workspaceStore = useWorkspaceStore();
const quickOpenStore = useQuickOpenStore();

let repoCounter = 0;
function freshRepoId() {
  repoCounter += 1;
  return `quick-open-truncated-test-${repoCounter}`;
}

function pathsOfLength(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `file${i}.ts`);
}

describe('C13-7: quickOpenIndexTruncated stays reactive across a later tree refresh', () => {
  test('crossing QUICK_OPEN_MAX_CANDIDATES after the palette already opened once still flips a computed wrapping it', async () => {
    const repoId = freshRepoId();
    let served: string[] = pathsOfLength(1000); // well under the cap
    (
      control as unknown as { codeWorkspaceListFiles: typeof control.codeWorkspaceListFiles }
    ).codeWorkspaceListFiles = async () => ({ paths: served, status: {}, truncated: false });
    (
      control as unknown as {
        codeWorkspaceOpenWorkspace: typeof control.codeWorkspaceOpenWorkspace;
      }
    ).codeWorkspaceOpenWorkspace = async () => {};
    (control as unknown as { tabsSave: typeof control.tabsSave }).tabsSave = async () => {};

    workspaceStore.openRepoWorkspace(repoId);
    await Promise.resolve();
    await Promise.resolve();

    quickOpenStore.openQuickOpen();
    await Promise.resolve();

    // The exact shape of the original bug: a `computed` wrapping the function, accessed once while
    // the candidate set is small.
    const truncated = computed(() => quickOpenStore.quickOpenIndexTruncated());
    expect(truncated.value).toBe(false);

    // A later tree refresh (e.g. a Refresh click, or reopening after new files landed) crosses the
    // candidate cap -- the tree's own `paths` array is reassigned wholesale, which is what the
    // fixed implementation reads directly and reactively.
    served = pathsOfLength(QUICK_OPEN_MAX_CANDIDATES + 1);
    await refreshRepoTree(repoId);

    expect(truncated.value).toBe(true);
  });
});
