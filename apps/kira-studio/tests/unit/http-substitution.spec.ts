// P5 D18: the {{name}} substitution engine is written twice — once here (http/substitute.ts) and
// once in Go (internal/httpvars/resolve.go) — and pinned to the same behaviour by one shared
// corpus, read by both a Go test and this one, rather than by two independently-imagined test
// suites. A case added to the corpus must pass on both sides or one of them fails.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { type Reference, resolve } from '../../frontend/src/http/substitute';

interface Case {
  name: string;
  template: string;
  values: Record<string, string>;
  secrets: string[];
  want: string;
  refs: Reference[];
}

const cases: Case[] = JSON.parse(
  readFileSync(
    resolvePath(import.meta.dir, '../../internal/httpvars/testdata/substitution.json'),
    'utf8',
  ),
);

describe('http/substitute.ts (P5 D17/D18)', () => {
  test('the corpus is non-empty', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    test(c.name, () => {
      const result = resolve(c.template, c.values, c.secrets);
      expect(result.text).toBe(c.want);
      expect(result.refs).toEqual(c.refs);
    });
  }
});
