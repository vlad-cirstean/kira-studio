import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import type { CommitFields, SearchField } from './matcher.ts';
import { matchCommitFields } from './matcher.ts';
import type { SearchQuery } from './query.ts';
import { compileQuery } from './query.ts';

/**
 * `docs/plans/G23-search.md` D9: the shared conformance corpus, read from BOTH languages —
 * `apps/kira-studio/internal/gitsearch/conformance_test.go` reads the exact same JSON and runs
 * `Compile`/`MatchFields`. A row failing here and passing there (or vice versa) is exactly the
 * silent divergence SPEC's own open item (`docs/v1.3/SPEC.md:446-450`) forbids.
 */

interface ConformanceQuery {
  readonly text: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

interface ConformanceRow {
  readonly name: string;
  readonly query: ConformanceQuery;
  readonly subject: string;
  readonly body: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly committerName: string;
  readonly committerEmail: string;
  readonly sha: string;
  readonly expect: {
    readonly supported: boolean;
    readonly fields: readonly SearchField[];
  };
}

interface ConformanceCorpus {
  readonly rows: readonly ConformanceRow[];
}

const fixturePath = path.join(import.meta.dir, '..', '..', 'testdata', 'searchConformance.json');

async function loadCorpus(): Promise<ConformanceCorpus> {
  const text = await Bun.file(fixturePath).text();
  return JSON.parse(text) as ConformanceCorpus;
}

function toSearchQuery(q: ConformanceQuery): SearchQuery {
  return { ...q, scope: 'commits' };
}

function toCommitFields(row: ConformanceRow): CommitFields {
  return {
    sha: row.sha,
    subject: row.subject,
    body: row.body,
    authorName: row.authorName,
    authorEmail: row.authorEmail,
    committerName: row.committerName,
    committerEmail: row.committerEmail,
  };
}

describe('search conformance corpus (git-core side)', () => {
  test('the corpus file parses and is non-empty', async () => {
    const corpus = await loadCorpus();
    expect(corpus.rows.length).toBeGreaterThan(0);
  });

  test('every row agrees with compileQuery + matchCommitFields', async () => {
    const corpus = await loadCorpus();
    for (const row of corpus.rows) {
      const compiled = compileQuery(toSearchQuery(row.query));
      if (!row.expect.supported) {
        // JS has no RE2 to reject a pattern against -- an "unsupported in Go" row must still
        // compile fine as JS (that is the whole premise of D6's honest unsupportedPattern
        // member: the pattern IS valid JavaScript). This corpus does not assert anything about
        // what compileQuery itself returns for such a row beyond "it must not be 'invalid'".
        expect(compiled.kind, `row ${row.name}: JS must be able to compile this pattern`).toBe(
          'ok',
        );
        continue;
      }
      expect(compiled.kind, `row ${row.name}: expected an 'ok' compiled query`).toBe('ok');
      if (compiled.kind !== 'ok') continue;
      const got = matchCommitFields(toCommitFields(row), compiled);
      expect(got, `row ${row.name}`).toEqual(row.expect.fields);
    }
  });
});
