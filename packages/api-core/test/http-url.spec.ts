// Finding 16 of the v1.2 P14 round-1 review: buildQuery (url.ts) and goQueryEscape (escape.ts)
// both used to encodeURIComponent/escape a query param or urlencoded field whole, including any
// literal `{{name}}` inside it — turning it into `%7B%7Bname%7D%7D`, a form neither substitution
// engine (this package's own resolve, nor internal/apivars/resolve.go) recognises any more. Both
// now split on `{{...}}` spans first (splitTemplateSpans, substitute.ts) and only encode the
// literal segments between them.

import { describe, expect, test } from 'bun:test';
import { goQueryEscape } from '../src/http/escape';
import { splitTemplateSpans } from '../src/http/substitute';
import { buildQuery, parseQuery } from '../src/http/url';

describe('http/substitute.ts splitTemplateSpans', () => {
  test('splits literal text around a {{name}} reference', () => {
    expect(splitTemplateSpans('a{{b}}c')).toEqual([
      { text: 'a', isReference: false },
      { text: '{{b}}', isReference: true },
      { text: 'c', isReference: false },
    ]);
  });

  test("an empty {{}} is not a reference — matches resolve()'s own rule", () => {
    expect(splitTemplateSpans('a{{}}b')).toEqual([
      { text: 'a', isReference: false },
      { text: '{{}}', isReference: false },
      { text: 'b', isReference: false },
    ]);
  });

  test('an unterminated {{ is left as trailing literal', () => {
    expect(splitTemplateSpans('a{{b')).toEqual([{ text: 'a{{b', isReference: false }]);
  });

  test('a plain string with no braces is one literal span', () => {
    expect(splitTemplateSpans('plain')).toEqual([{ text: 'plain', isReference: false }]);
  });
});

describe('http/url.ts buildQuery leaves a {{variable}} reference untouched', () => {
  test('a reference-only value is not encoded at all', () => {
    expect(buildQuery([{ name: 'token', value: '{{apiKey}}' }])).toBe('token={{apiKey}}');
  });

  test('a reference alongside literal text encodes only the literal parts', () => {
    expect(buildQuery([{ name: 'q', value: 'prefix {{name}} suffix&more' }])).toBe(
      'q=prefix%20{{name}}%20suffix%26more',
    );
  });

  test('a plain value with no reference encodes exactly as before', () => {
    expect(buildQuery([{ name: 'a b', value: 'c&d' }])).toBe('a%20b=c%26d');
  });

  test('adding a param to a URL that already has a {{variable}} reference elsewhere leaves the reference intact — round trip through parseQuery', () => {
    const original = 'region={{region}}';
    const pairs = parseQuery(original);
    pairs.push({ name: 'limit', value: '10' });
    expect(buildQuery(pairs)).toBe('region={{region}}&limit=10');
  });
});

describe('http/escape.ts goQueryEscape leaves a {{variable}} reference untouched', () => {
  test('a reference-only value is not escaped at all', () => {
    expect(goQueryEscape('{{apiKey}}')).toBe('{{apiKey}}');
  });

  test('a reference alongside literal text escapes only the literal parts, Go-style (space as +)', () => {
    expect(goQueryEscape('Bearer {{token}} now')).toBe('Bearer+{{token}}+now');
  });

  test('a plain value with no reference escapes exactly as before', () => {
    expect(goQueryEscape('a b(c)')).toBe('a+b%28c%29');
  });
});
