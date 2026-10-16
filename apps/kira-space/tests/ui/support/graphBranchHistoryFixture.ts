import { buildPackedChunk, type PackedChunkRow } from '@kira/git-core/testing/packedChunk';
import { PORT_REPO, refRow } from './gitUiPortFixtures';
import { buildGraphStreamChunk, type GraphStreamChunkFixture } from './graphStreamFixture';

// P278: a branchy history shaped like a real repo. Blocks of 20 rows: 15 on `main`, 5 exclusive to a
// side branch that forks off the next block's first main commit. Every other side tip is listed in
// `refs.list`; the rest land in the `other` group. A tag every 37 rows, a merge of the block's side
// tip every 60 rows.

export const PAGE_SIZE = 1000;
export const HISTORY_ROWS = 2000;
export const CHUNK_ROWS = 250;
const BLOCK = 20;
const MAIN_PER_BLOCK = 15;
const IDENTITIES = ['Fake Author', 'fake@example.com'];

export const historySha = (n: number) => n.toString(16).padStart(8, '0').repeat(5);

/** A commit one ahead of row 0, as a `commit` on `main` would add. */
export const HEAD_NEXT_SHA = 'ab'.repeat(20);

function parentsOf(n: number): number[] {
  const offset = n % BLOCK;
  const nextBlock = n - offset + BLOCK;
  const tail = offset === MAIN_PER_BLOCK - 1 || offset === BLOCK - 1;
  const out = [tail ? nextBlock : n + 1];
  if (n % 60 === 0) out.push(n + MAIN_PER_BLOCK);
  return out.filter((parent) => parent < HISTORY_ROWS);
}

export function historyRows(from: number, to: number): PackedChunkRow[] {
  return Array.from({ length: to - from }, (_, i) => {
    const n = from + i;
    return {
      sha: historySha(n),
      subject: `commit ${n}`,
      parents: parentsOf(n).map(historySha),
      ...(n % 37 === 0 ? { decoration: [{ kind: 'tag' as const, name: `v${n}` }] } : {}),
    };
  });
}

/** The re-walk after one new commit on `main`: optionally `HEAD_NEXT`, then rows 0 to `count` - 1. */
export function rewalkRows(withHead: boolean, count: number): PackedChunkRow[] {
  const head: PackedChunkRow = {
    sha: HEAD_NEXT_SHA,
    subject: 'head moved',
    parents: [historySha(0)],
  };
  return withHead ? [head, ...historyRows(0, count)] : historyRows(0, count);
}

/** `main` at `headSha` plus every other block's side tip. */
export function refsList(headSha: string) {
  const sides = [];
  for (let block = 0; block * BLOCK < HISTORY_ROWS; block += 2) {
    sides.push(
      refRow(`side-${block}`, {
        objectId: historySha(block * BLOCK + MAIN_PER_BLOCK),
        committerDate: HISTORY_ROWS - block,
      }),
    );
  }
  return {
    branches: [refRow('main', { objectId: headSha }), ...sides],
    remoteBranches: [],
    tags: [],
    head: { kind: 'branch', name: 'main' },
  };
}

/** `rows[from, to)` as `CHUNK_ROWS`-row stream chunks. `last` marks the history's end. */
export function pageChunks(
  rows: readonly PackedChunkRow[],
  from: number,
  to: number,
  last: boolean,
): GraphStreamChunkFixture[] {
  const total = HISTORY_ROWS + (rows[0]?.sha === HEAD_NEXT_SHA ? 1 : 0);
  const out: GraphStreamChunkFixture[] = [];
  for (let start = from; start < to; start += CHUNK_ROWS) {
    const end = Math.min(start + CHUNK_ROWS, to);
    const final = last && end === to;
    out.push(
      buildGraphStreamChunk(
        PORT_REPO.repoId,
        out.length,
        buildPackedChunk(
          rows.slice(start, end),
          start === 0
            ? { from: 0, dictionary: IDENTITIES }
            : { from: start, dictionary: [], dictionaryBase: IDENTITIES.length },
        ),
        final ? {} : { exhausted: false, remaining: total - end },
      ),
    );
  }
  return out;
}
