import { describe, expect, test } from 'bun:test';
import type { LoadedScanResult } from '@kira/git-core';
import { buildCommitHits, type SearchRunResult } from './search.ts';

/**
 * `docs/plans/P11.md` W20 / `docs/plans/G23-search.md` F12/D11: `buildCommitHits`'s own merge is
 * subtle enough (and was untested enough before this phase, when `tail` was always `undefined`
 * at runtime) to deserve direct, pure-function coverage. The four cases named in G23's own file
 * table: a loaded hit, a tail-only hit, a body-only tail hit on an already-loaded row (the exact
 * bug W20 names — counting it as `overlap` would silently zero it out of `matchCount.n` even
 * though it still gets a `CommitHit` entry), and a genuine overlap.
 */

interface Row {
  readonly sha: string;
  readonly subject: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorTime: number;
}

const ROWS: readonly Row[] = [
  {
    sha: 'sha0',
    subject: 'subject 0',
    authorName: 'Author Zero',
    authorEmail: 'zero@example.com',
    authorTime: 100,
  },
  {
    sha: 'sha1',
    subject: 'subject 1',
    authorName: 'Author One',
    authorEmail: 'one@example.com',
    authorTime: 200,
  },
  {
    sha: 'sha2',
    subject: 'subject 2',
    authorName: 'Author Two',
    authorEmail: 'two@example.com',
    authorTime: 300,
  },
];

function rowOfSha(sha: string): number {
  return ROWS.findIndex((r) => r.sha === sha);
}
function shaAt(row: number): string {
  return ROWS[row]?.sha ?? '';
}
function subjectAt(row: number): string {
  return ROWS[row]?.subject ?? '';
}
function authorAt(row: number): {
  readonly name: string;
  readonly email: string;
  readonly timestamp: number;
} {
  const r = ROWS[row];
  return { name: r?.authorName ?? '', email: r?.authorEmail ?? '', timestamp: r?.authorTime ?? 0 };
}

function loadedResult(hits: LoadedScanResult['hits']): LoadedScanResult {
  return { hits, total: hits.length, truncated: false, complete: true, scannedRows: ROWS.length };
}

function okTail(hits: Extract<SearchRunResult, { kind: 'ok' }>['hits']): SearchRunResult {
  return { kind: 'ok', hits, total: hits.length, truncated: false, scanned: 100, complete: true };
}

describe('buildCommitHits', () => {
  test('a loaded hit alone becomes one CommitHit, no overlap', () => {
    const loaded = loadedResult([{ row: 0, fields: ['subject'] }]);
    const { hits, overlapCount } = buildCommitHits(
      rowOfSha,
      shaAt,
      subjectAt,
      authorAt,
      loaded,
      undefined,
    );
    expect(hits).toEqual([
      {
        sha: 'sha0',
        row: 0,
        subject: 'subject 0',
        authorName: 'Author Zero',
        authorEmail: 'zero@example.com',
        authorTime: 100,
        fields: ['subject'],
      },
    ]);
    expect(overlapCount).toBe(0);
  });

  test('a tail-only hit (sha not yet loaded) gets row -1, sorts after every loaded hit', () => {
    const loaded = loadedResult([{ row: 0, fields: ['subject'] }]);
    const tail = okTail([
      {
        sha: 'deadbeef',
        subject: 'a not-yet-loaded commit',
        authorName: 'Someone',
        authorEmail: 'someone@example.com',
        authorTime: 50,
        fields: ['subject'],
      },
    ]);
    const { hits, overlapCount } = buildCommitHits(
      rowOfSha,
      shaAt,
      subjectAt,
      authorAt,
      loaded,
      tail,
    );
    expect(hits).toHaveLength(2);
    expect(hits[0]?.row).toBe(0);
    expect(hits[1]).toEqual({
      sha: 'deadbeef',
      row: -1,
      subject: 'a not-yet-loaded commit',
      authorName: 'Someone',
      authorEmail: 'someone@example.com',
      authorTime: 50,
      fields: ['subject'],
    });
    expect(overlapCount).toBe(0);
  });

  test('a body-only tail hit on an ALREADY-LOADED row is not double-counted as overlap (P11 W20)', () => {
    // The loaded (client-side) scan never reads body at all, so row 2 has NO loaded hit even
    // though it is paged into the store -- rowOfSha(sha2) still resolves to a real row.
    const loaded = loadedResult([]);
    const tail = okTail([
      {
        sha: 'sha2',
        subject: 'subject 2',
        authorName: 'Author Two',
        authorEmail: 'two@example.com',
        authorTime: 300,
        fields: ['body'],
      },
    ]);
    const { hits, overlapCount } = buildCommitHits(
      rowOfSha,
      shaAt,
      subjectAt,
      authorAt,
      loaded,
      tail,
    );
    expect(hits).toEqual([
      {
        sha: 'sha2',
        row: 2,
        subject: 'subject 2',
        authorName: 'Author Two',
        authorEmail: 'two@example.com',
        authorTime: 300,
        fields: ['body'],
      },
    ]);
    // The whole point of this case: this row is loaded (rowOfSha found it) but was never a
    // *loaded hit* -- overlapCount must stay 0, or matchCount.n would silently drop this hit.
    expect(overlapCount).toBe(0);
  });

  test('a genuine overlap (the same row is a loaded hit AND a tail hit) counts once, fields merged', () => {
    const loaded = loadedResult([{ row: 1, fields: ['subject'] }]);
    const tail = okTail([
      {
        sha: 'sha1',
        subject: 'subject 1',
        authorName: 'Author One',
        authorEmail: 'one@example.com',
        authorTime: 200,
        fields: ['subject', 'authorEmail'],
      },
    ]);
    const { hits, overlapCount } = buildCommitHits(
      rowOfSha,
      shaAt,
      subjectAt,
      authorAt,
      loaded,
      tail,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.row).toBe(1);
    expect(new Set(hits[0]?.fields)).toEqual(new Set(['subject', 'authorEmail']));
    expect(overlapCount).toBe(1);
  });

  test('no loaded and no tail result yields no hits', () => {
    const { hits, overlapCount } = buildCommitHits(
      rowOfSha,
      shaAt,
      subjectAt,
      authorAt,
      undefined,
      undefined,
    );
    expect(hits).toEqual([]);
    expect(overlapCount).toBe(0);
  });

  test('loaded entries sort by row ascending regardless of insertion order', () => {
    const loaded = loadedResult([
      { row: 2, fields: ['subject'] },
      { row: 0, fields: ['subject'] },
    ]);
    const { hits } = buildCommitHits(rowOfSha, shaAt, subjectAt, authorAt, loaded, undefined);
    expect(hits.map((h) => h.row)).toEqual([0, 2]);
  });
});
