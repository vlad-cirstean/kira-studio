import type { PackedChunkRow } from '@kira/git-core/testing/packedChunk';

// P225: 2000-commit history served as two 1000-row pages. Page 1 needs 2 lanes and carries
// second-parent shapes that converge (branch-out then merge-in); page 2 needs 5.

export const PAGING_ROWS = 2000;
export const PAGE_SIZE = 1000;
export const CHUNK_ROWS = 500;
/** Row whose second parent sits on page 2: the edge is unresolved until Load more. */
export const CROSS_PAGE_FROM = 990;
export const CROSS_PAGE_TO = 1005;

export const pagingSha = (n: number) => n.toString(16).padStart(8, '0').repeat(5);

function parentRows(n: number): number[] {
  if (n === PAGING_ROWS - 1) return [];
  if (n === CROSS_PAGE_FROM) return [n + 1, CROSS_PAGE_TO];
  if (n >= PAGE_SIZE) {
    // Fan at the block's first row: main line continues at +5, four side commits (+1..+4) each
    // rejoin the main line further down.
    const o = (n - PAGE_SIZE) % 50;
    const r = n - o;
    if (o === 0) return [r + 5, r + 1, r + 2, r + 3, r + 4];
    if (o <= 4) return [r + 10 * o + 1];
    return [n + 1];
  }
  const o = n % 10;
  if (n >= CROSS_PAGE_FROM) return [n + 1];
  if (o === 0) return [n + 1, n + 2];
  if (o === 1) return [n + 2];
  if (o === 5) return [n + 1, n + 3];
  return [n + 1];
}

export function pagingRows(from: number, to: number): PackedChunkRow[] {
  return Array.from({ length: to - from }, (_, i) => {
    const n = from + i;
    return {
      sha: pagingSha(n),
      subject: `commit ${n}`,
      parents: parentRows(n).map(pagingSha),
      ...(n % 37 === 0 ? { decoration: [{ kind: 'tag' as const, name: `v${n}` }] } : {}),
    };
  });
}
