import { describe, expect, test } from 'bun:test';
import type { FileChange } from '@kira/git-ipc';
import { type FileTreeDirNode, type FileTreeFileNode, flattenTreeRows } from './fileTreeModel.ts';

function fileNode(path: string, fileIndex: number): FileTreeFileNode {
  const change: FileChange = {
    path,
    kind: 'modified',
    originalPath: undefined,
    similarity: undefined,
    additions: 1,
    deletions: 1,
    isBinary: false,
  };
  const slash = path.lastIndexOf('/');
  return {
    kind: 'file',
    name: slash === -1 ? path : path.slice(slash + 1),
    path,
    change,
    fileIndex,
  };
}

function dirNode(
  path: string,
  children: readonly (FileTreeFileNode | FileTreeDirNode)[],
): FileTreeDirNode {
  const slash = path.lastIndexOf('/');
  return {
    kind: 'directory',
    name: slash === -1 ? path : path.slice(slash + 1),
    path,
    children,
    additions: 0,
    deletions: 0,
    fileCount: children.length,
  };
}

describe('flattenTreeRows — basic correctness', () => {
  test('a nested tree respects isExpanded and reports the right depth per row', () => {
    const tree = [
      dirNode('src', [
        fileNode('src/a.ts', 0),
        dirNode('src/nested', [fileNode('src/nested/b.ts', 1)]),
      ]),
      fileNode('README.md', 2),
    ];

    const expanded = new Set(['src']); // 'src/nested' collapsed.
    const rows = flattenTreeRows(tree, (path) => expanded.has(path));

    expect(rows.map((r) => (r.kind === 'file' ? r.node.path : `${r.node.path}/`))).toEqual([
      'src/',
      'src/a.ts',
      'src/nested/',
      'README.md',
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0]);
    // The collapsed directory's own children are entirely absent from the list, not merely
    // hidden — this is what makes arrow-key navigation skip them for free.
    expect(rows.some((r) => r.kind === 'file' && r.node.path === 'src/nested/b.ts')).toBe(false);
  });

  test('an empty node list produces an empty row list', () => {
    expect(flattenTreeRows([], () => true)).toEqual([]);
  });
});

// G30 round-1 performance review, finding #7: `rows.push(...flattenTreeRows(...))` spread a
// freshly built sub-array into the parent's row list at every directory level — a single spread
// call's own argument count is bounded by the engine's call-stack-sized argument list (V8's own
// figure is commonly cited around 65k; this test runtime's engine — Bun's JSC — has a materially
// higher ceiling, empirically between 637,694 and 638,671 elements, confirmed by binary search
// against the exact `out.push(...arr)` shape the old code used), so a single directory holding
// enough files past that ceiling threw `RangeError: Maximum call stack size exceeded` outright
// rather than merely running slow. 700,000 is comfortably past the confirmed JSC threshold.
describe('flattenTreeRows — one large expanded directory never throws or drops rows', () => {
  test('700,000 files under one expanded directory flatten without a RangeError', () => {
    const fileCount = 700_000;
    const children: FileTreeFileNode[] = [];
    for (let i = 0; i < fileCount; i++) {
      children.push(fileNode(`dir/f${i}.ts`, i));
    }
    const tree = [dirNode('dir', children)];

    const rows = flattenTreeRows(tree, () => true);

    expect(rows.length).toBe(fileCount + 1); // the directory row itself, plus every file.
    expect(rows[0]).toMatchObject({ kind: 'directory', depth: 0 });
    expect(rows[1]).toMatchObject({ kind: 'file', depth: 1 });
    const last = rows[rows.length - 1];
    expect(last?.kind).toBe('file');
    expect(last?.kind === 'file' ? last.node.path : undefined).toBe(`dir/f${fileCount - 1}.ts`);
  });
});
