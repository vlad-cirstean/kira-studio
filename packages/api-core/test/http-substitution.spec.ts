// P5 D18: the {{name}} substitution engine is written twice — once here (http/substitute.ts) and
// once in Go (internal/httpvars/resolve.go) — and pinned to the same behaviour by one shared
// corpus, read by both a Go test and this one, rather than by two independently-imagined test
// suites. A case added to the corpus must pass on both sides or one of them fails.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { type Reference, resolve } from '../src/http/substitute';

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
    // P12 F15: this file moved (D19) and internal/httpvars renames to internal/apivars at C9 —
    // touched by two different renames at once, so the path here changes twice across this phase.
    resolvePath(
      import.meta.dir,
      '../../../apps/kira-studio/internal/httpvars/testdata/substitution.json',
    ),
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

// P6 D2/D3: three TS-only cases for the optional fourth argument — Go has no dynamic branch to be
// in parity with, so these live beside the corpus loop rather than inside it, and the corpus JSON
// itself is untouched (D2 property 3).
describe('http/substitute.ts resolve() dynamic callback (P6 D2/D3)', () => {
  test('two occurrences of one name produce two different values', () => {
    let n = 0;
    const result = resolve('{{$guid}}/{{$guid}}', {}, [], () => String(n++));
    expect(result.text).toBe('0/1');
    expect(result.refs).toEqual([
      { name: '$guid', kind: 'resolved' },
      { name: '$guid', kind: 'resolved' },
    ]);
  });

  test('a callback returning null leaves today’s behaviour exactly', () => {
    const withNullCallback = resolve('{{$nope}}', {}, [], () => null);
    const withNoCallback = resolve('{{$nope}}', {}, []);
    expect(withNullCallback).toEqual(withNoCallback);
    expect(withNullCallback.text).toBe('{{$nope}}');
    expect(withNullCallback.refs).toEqual([{ name: '$nope', kind: 'dynamic' }]);
  });

  test('a dynamic reference adjacent to a variable, a secret and an unknown resolve independently', () => {
    const result = resolve(
      '{{$guid}} {{apiKey}} {{token}} {{missing}}',
      { apiKey: 'abc123' },
      ['token'],
      () => 'GENERATED',
    );
    expect(result.text).toBe('GENERATED abc123 {{token}} {{missing}}');
    expect(result.refs).toEqual([
      { name: '$guid', kind: 'resolved' },
      { name: 'apiKey', kind: 'resolved' },
      { name: 'token', kind: 'deferred' },
      { name: 'missing', kind: 'unknown' },
    ]);
  });
});
