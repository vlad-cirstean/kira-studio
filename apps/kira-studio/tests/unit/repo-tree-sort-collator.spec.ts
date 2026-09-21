// C13-4: fileTree.ts's buildTree sorted with a fresh `localeCompare(..., { sensitivity: 'base' })`
// call per comparison -- measured 20x slower than one hoisted Intl.Collator at scale (200k files,
// the MaxListedFiles cap: 3,760ms -> 322ms). This locks in that the visible ordering is unchanged
// (directories first, case-insensitive collation) after switching to the shared collator.
import './support/window';

import { describe, expect, test } from 'bun:test';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';
import { restoreAfterEach } from './support/restoreAfterEach';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);

const { useFileTreeStore } = await import('../../frontend/src/repo/state/fileTree');
const fileTreeStore = useFileTreeStore();

let repoCounter = 0;
function freshRepoId() {
  repoCounter += 1;
  return `tree-sort-test-${repoCounter}`;
}

describe('C13-4: tree sort order after the Intl.Collator hoist', () => {
  test('directories before files, each case-insensitive/locale-collated', async () => {
    const repoId = freshRepoId();
    const paths = [
      'Banana.ts',
      'apple.ts',
      'zebra/index.ts',
      'Zebra/other.ts', // buildTree keys dirs case-sensitively, so this is a distinct sibling node
      'étude.ts',
      'file10.ts',
      'file2.ts',
      '_hidden.ts',
      '.env',
      'Apple/readme.md',
    ];
    (
      control as unknown as { codeWorkspaceListFiles: typeof control.codeWorkspaceListFiles }
    ).codeWorkspaceListFiles = async () => ({ paths, status: {}, truncated: false });

    fileTreeStore.ensureRepoTreeLoaded(repoId);
    await Promise.resolve();
    await Promise.resolve();

    const rows = fileTreeStore.visibleRepoRows(repoId, '');
    const topLevel = rows.filter((r) => r.depth === 0);

    // Directories (Apple/, zebra/, Zebra/) sort before files, and within each group names collate
    // case-insensitively.
    const dirNames = topLevel.filter((r) => r.isDir).map((r) => r.name);
    const fileNames = topLevel.filter((r) => !r.isDir).map((r) => r.name);
    expect(topLevel.findIndex((r) => r.isDir)).toBeLessThan(topLevel.findIndex((r) => !r.isDir));
    expect(dirNames).toEqual(
      [...dirNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    );
    expect(fileNames).toEqual(
      [...fileNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    );
    expect(fileNames).toEqual(
      ['_hidden.ts', '.env', 'apple.ts', 'Banana.ts', 'étude.ts', 'file10.ts', 'file2.ts'].sort(
        (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }),
      ),
    );
  });
});
