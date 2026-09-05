// P5 D18: the {{name}} substitution engine is written twice — once here (src/http/substitute.ts)
// and once in Go (internal/apivars/resolve.go) — and pinned to the same behaviour by one shared
// corpus, read by both a Go test and this one, rather than by two independently-imagined test
// suites. A case added to the corpus must pass on both sides or one of them fails.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { type Reference, resolve, sanitizeUrlSpan } from '../src/http/substitute';

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
    resolvePath(
      import.meta.dir,
      '../../../apps/kira-studio/internal/apivars/testdata/substitution.json',
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

// Finding 6 (v1.2 P14 round 2): a template-reference span left literal because it names nothing
// (`unknown`) or generates nothing (`dynamic`, no catalogued generator) must not survive into the
// final URL carrying a raw space/&/#/= — those break url.Parse's RawQuery or the request line
// itself. `sanitizeUrlSpan` (the optional 5th argument) is applied to exactly those two kinds and
// never to `deferred` — a secret span a later, Go-side pass still has to find byte-identical.
describe('http/substitute.ts resolve() sanitizeUrlSpan (P14 round-2 finding 6)', () => {
  test('an unresolved {{base url}}-shaped reference in a query value survives as safe, parseable text', () => {
    const result = resolve(
      'https://api.example.com/orders?a={{base url}}&b=2',
      {},
      [],
      undefined,
      sanitizeUrlSpan,
    );
    expect(result.text).toBe('https://api.example.com/orders?a={{base%20url}}&b=2');
    expect(result.refs).toEqual([{ name: 'base url', kind: 'unknown' }]);
    // Proves the fix's own stated bar: the resulting URL actually parses, and the query string it
    // parses into is well-formed — the second, unrelated param survives untouched.
    const parsed = new URL(result.text);
    expect(parsed.searchParams.get('b')).toBe('2');
  });

  test('a deferred secret reference is never sanitized — a later pass still needs its exact name', () => {
    const result = resolve(
      '{{secret with spaces}}',
      {},
      ['secret with spaces'],
      undefined,
      sanitizeUrlSpan,
    );
    expect(result.text).toBe('{{secret with spaces}}');
    expect(result.refs).toEqual([{ name: 'secret with spaces', kind: 'deferred' }]);
  });

  test('a resolved value and ordinary literal text are unaffected', () => {
    const result = resolve('{{host}}/a b', { host: 'x.test' }, [], undefined, sanitizeUrlSpan);
    expect(result.text).toBe('x.test/a b');
  });

  test('an uncatalogued dynamic reference is sanitized the same way as unknown', () => {
    const result = resolve('{{$weird generator}}', {}, [], () => null, sanitizeUrlSpan);
    expect(result.text).toBe('{{$weird%20generator}}');
    expect(result.refs).toEqual([{ name: '$weird generator', kind: 'dynamic' }]);
  });
});
