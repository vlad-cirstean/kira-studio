// C14-1 (severe performance): insertByPath's splice into state.files used to run against a DEEP
// reactive() array -- C13-5's markRaw only covered each streamed group, not the containing array,
// so every element to the right of a mid-array insert still walked Vue's get/set proxy traps.
// Measured through this exact module on a capped 10,000-match streaming search: 41,550ms cumulative
// main-thread cost (worst single flush 2,100ms) vs 2ms for the identical insert sequence into a
// plain array. This pins two things: (1) a large streamed search completes with a generous but
// regression-catching wall-clock bound -- a return to O(F^2) reactive proxying would blow well past
// it -- and (2) the result rows are still correct and the view still re-renders incrementally
// (repoSearchRows reflects each flush), so the `filesVersion` reactivity workaround actually works.
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import type { CodeSearchEvent, FileMatches } from '../../../../packages/shared/domain/repo';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);

const { useRepoSearchStore } = await import('../../frontend/src/repo/state/search');
const repoSearchStore = useRepoSearchStore();

function group(path: string): FileMatches {
  return {
    path,
    truncated: false,
    matches: [
      {
        line: 1,
        column: 1,
        endColumn: 5,
        preview: 'match',
        previewMatchStart: 0,
        previewMatchEnd: 4,
        truncatedStart: false,
        truncatedEnd: false,
      },
    ],
  };
}

describe('C14-1: state.files insertion stays off Vue deep reactivity at scale', () => {
  test('a 10,000-match streamed search completes without O(F^2) reactive-proxy cost', async () => {
    const repoId = 'search-perf-c14-1';
    let deliver: (event: CodeSearchEvent) => void = () => {};
    (control as unknown as { onCodeSearch: typeof control.onCodeSearch }).onCodeSearch = (cb) => {
      deliver = cb;
      return () => {};
    };
    (
      control as unknown as { codeWorkspaceStartSearch: typeof control.codeWorkspaceStartSearch }
    ).codeWorkspaceStartSearch = async () => ({ searchId: 'search-1' });

    repoSearchStore.setRepoSearchQuery(repoId, 'needle');
    await repoSearchStore.startRepoSearch(repoId);

    // D11: workers emit out of order, so insertByPath's own binary search lands mid-array, not just
    // at the tail -- that's what actually pays the reactive-proxy element-shift cost the fix targets
    // (a purely tail-appending stream never shifts an existing element, so it can't reproduce the
    // regression). Build 10,000 sorted paths, then deliver them shuffled across ~40 flush batches,
    // matching the real out-of-order streaming shape.
    const totalPaths = 10_000;
    const batchSize = 250;
    const paths: string[] = [];
    for (let i = 0; i < totalPaths; i++) paths.push(`src/dir${Math.floor(i / 20)}/file${i}.ts`);
    paths.sort();
    const shuffled = [...paths];
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const started = performance.now();
    for (let start = 0; start < shuffled.length; start += batchSize) {
      const batch = shuffled.slice(start, start + batchSize).map(group);
      deliver({ searchId: 'search-1', seq: start, files: batch, done: false });
    }
    deliver({
      searchId: 'search-1',
      seq: paths.length,
      files: [],
      done: true,
      stats: {
        filesScanned: totalPaths,
        filesMatched: totalPaths,
        filesSkipped: 0,
        matches: totalPaths,
        truncated: false,
      },
      error: null,
    });
    const elapsedMs = performance.now() - started;

    // Previously ~41,550ms cumulative for this shape; a plain array does the same work in ~2ms.
    // 5,000ms is a generous ceiling that still fails hard on a regression back to O(F^2) splicing,
    // without flaking on ordinary CI scheduling jitter for O(F) work over 10,000 elements.
    expect(elapsedMs).toBeLessThan(5_000);

    expect(repoSearchStore.repoSearchRunning(repoId)).toBe(false);
    const rows = repoSearchStore.repoSearchRows(repoId);
    // One file-header row + one match row per path, in sorted order.
    expect(rows.length).toBe(totalPaths * 2);
    expect(rows[0]).toMatchObject({ kind: 'file', path: paths[0] });
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'match', path: paths[paths.length - 1] });

    repoSearchStore.dropRepoSearch(repoId);
  });
});
