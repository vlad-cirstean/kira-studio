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
      { text: 'a', isReference: false, from: 0, to: 1, name: '' },
      { text: '{{b}}', isReference: true, from: 1, to: 6, name: 'b' },
      { text: 'c', isReference: false, from: 6, to: 7, name: '' },
    ]);
  });

  test("an empty {{}} is not a reference — matches resolve()'s own rule", () => {
    expect(splitTemplateSpans('a{{}}b')).toEqual([
      { text: 'a', isReference: false, from: 0, to: 1, name: '' },
      { text: '{{}}', isReference: false, from: 1, to: 5, name: '' },
      { text: 'b', isReference: false, from: 5, to: 6, name: '' },
    ]);
  });

  test('an unterminated {{ is left as trailing literal', () => {
    expect(splitTemplateSpans('a{{b')).toEqual([
      { text: 'a{{b', isReference: false, from: 0, to: 4, name: '' },
    ]);
  });

  test('a plain string with no braces is one literal span', () => {
    expect(splitTemplateSpans('plain')).toEqual([
      { text: 'plain', isReference: false, from: 0, to: 5, name: '' },
    ]);
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

// P21 round 3 functional finding 11: parseQuery/buildQuery were not exact inverses in two ways —
// a literal '+' was left alone on decode but encoded to '%2B' on the way back out, and a valueless
// `?flag` always rebuilt as `flag=`. Because HttpRequestView.vue rewrites the *whole* query string
// from the table whenever any row changes, both asymmetries silently rewrote params the user never
// touched the moment an unrelated row was edited.
describe('http/url.ts parseQuery/buildQuery are exact inverses (finding 11)', () => {
  test('a literal + survives a round trip unchanged, not re-encoded to %2B', () => {
    const pairs = parseQuery('q=hello+world');
    expect(pairs).toEqual([{ name: 'q', value: 'hello+world', bare: false }]);
    expect(buildQuery(pairs)).toBe('q=hello+world');
  });

  test('editing one param leaves an untouched + param exactly as it was', () => {
    const pairs = parseQuery('q=hello+world&debug');
    pairs.push({ name: 'page', value: '2' });
    // Pre-fix: 'q=hello%2Bworld&debug=&page=2' — a different request for any server that treats
    // '+' as a space in a query, which is the overwhelming majority of form-encoded readers.
    expect(buildQuery(pairs)).toBe('q=hello+world&debug&page=2');
  });

  test('a bare flag (?flag, no "=") round-trips bare, not as "flag="', () => {
    const pairs = parseQuery('debug');
    expect(pairs).toEqual([{ name: 'debug', value: '', bare: true }]);
    expect(buildQuery(pairs)).toBe('debug');
  });

  test('a param that was always "flag=" (an explicit empty value) keeps its "=" — parseQuery still tells the two apart', () => {
    const pairs = parseQuery('flag=');
    expect(pairs).toEqual([{ name: 'flag', value: '', bare: false }]);
    expect(buildQuery(pairs)).toBe('flag=');
  });

  test('once a bare flag is given a real value, it is no longer bare', () => {
    const pairs = parseQuery('debug');
    pairs[0].value = 'true';
    expect(buildQuery(pairs)).toBe('debug=true');
  });

  test('a fresh row built with no `bare` field at all defaults to non-bare (an empty value still gets "=")', () => {
    expect(buildQuery([{ name: 'x', value: '' }])).toBe('x=');
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
