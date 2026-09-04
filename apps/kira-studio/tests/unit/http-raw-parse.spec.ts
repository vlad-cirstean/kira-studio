// P9 D11: the raw HTTP/1.1 parser is "a parser with several interacting rules" (AGENTS.md's own
// bar for a dedicated test) — the request-line/header/body grammar, D10's Content-Type → mode
// table, and the two warning cases interact enough to earn a corpus, the same shape P7 D17 took
// for curl. Not JSON-shaped (http-curl.spec.ts's own reasoning: an HttpRequestTabState is naturally
// a TS object literal) — TS test cases instead.

import { describe, expect, test } from 'bun:test';
import {
  defaultHttpRequestTabState,
  type HttpCodeLanguage,
  type HttpRequestTabState,
} from '@shared/domain/http';
import { generateRawRequest } from '../../frontend/src/http/raw/generate';
import { parseRawRequest } from '../../frontend/src/http/raw/parse';

function state(overrides: Partial<HttpRequestTabState>): HttpRequestTabState {
  return { ...defaultHttpRequestTabState(), ...overrides };
}

const ORIGIN = 'https://api.example.com/v1/orders?a=1';

describe('http/raw/parse.ts — parseRawRequest (P9 D10/D11)', () => {
  // ---- 1/2/3: the round trip — generate(state) then parse(...) lands back on the original for
  // a code body, a raw body, an empty body, and duplicate/mixed-case headers; {{var}} survives in
  // every position; header case and order (including two same-named rows) are preserved exactly. ----

  test('round-trips a code (json) body, headers with duplicate and mixed-case names, and {{var}} in every position', () => {
    const s = state({
      method: 'POST',
      url: 'https://{{base_url}}/v2/orders',
      headers: [
        { name: 'X-Trace', value: '{{$guid}}', enabled: true },
        { name: 'Authorization', value: 'Bearer {{token}}', enabled: true },
        { name: 'x-trace', value: 'second-row', enabled: true },
        // A user-set Content-Type means generateRawRequest's own default-injection never fires
        // (D7's precedence) — this case is about header case/order preservation, kept separate
        // from the Content-Type → mode mapping the dedicated cases below cover.
        { name: 'Content-Type', value: 'application/json', enabled: true },
      ],
      bodyMode: 'code',
      code: '{"id": "{{token}}"}',
      codeLanguage: 'json',
    });
    const buffer = generateRawRequest(s, 'application/json');
    expect(buffer).toContain('{{base_url}}');
    expect(buffer).toContain('{{$guid}}');
    expect(buffer).toContain('{{token}}');

    const result = parseRawRequest(buffer, ORIGIN);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.method).toBe('POST');
    expect(result.state.url).toBe('https://{{base_url}}/v2/orders');
    expect(result.state.bodyMode).toBe('code');
    expect(result.state.codeLanguage).toBe('json');
    expect(result.state.code).toBe('{"id": "{{token}}"}');
    // Case and order preserved exactly — 'X-Trace' and 'x-trace' stay two distinct rows, in the
    // order they were typed, never merged.
    expect(result.state.headers).toEqual([
      { name: 'X-Trace', value: '{{$guid}}', enabled: true },
      { name: 'Authorization', value: 'Bearer {{token}}', enabled: true },
      { name: 'x-trace', value: 'second-row', enabled: true },
      { name: 'Content-Type', value: 'application/json', enabled: true },
    ]);
  });

  test('round-trips a raw (text/plain) body', () => {
    const s = state({
      method: 'PUT',
      url: 'https://api.example.com/notes',
      bodyMode: 'raw',
      body: 'plain text, not json',
    });
    const result = parseRawRequest(generateRawRequest(s, 'text/plain'), ORIGIN);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.bodyMode).toBe('raw');
    expect(result.state.body).toBe('plain text, not json');
  });

  test('round-trips an empty body as bodyMode none', () => {
    const s = state({ method: 'GET', url: 'https://api.example.com/health' });
    const result = parseRawRequest(generateRawRequest(s, ''), ORIGIN);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.bodyMode).toBe('none');
    expect(result.state.body).toBe('');
    expect(result.state.code).toBe('');
  });

  // ---- 4: a leading-'/' target joins onto the tab's existing origin; an absolute target
  // replaces it outright. ----

  test('a leading-"/" target joins onto the current origin', () => {
    const result = parseRawRequest('GET /v2/health HTTP/1.1\n\n', ORIGIN);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.url).toBe('https://api.example.com/v2/health');
  });

  test('an absolute target replaces the URL outright', () => {
    const result = parseRawRequest('GET https://other.test/x HTTP/1.1\n\n', ORIGIN);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.url).toBe('https://other.test/x');
  });

  test('a {{base_url}}-prefixed target replaces the URL outright, never joined as a path', () => {
    const result = parseRawRequest('GET {{base_url}}/v2/orders HTTP/1.1\n\n', ORIGIN);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.url).toBe('{{base_url}}/v2/orders');
  });

  // ---- 5: Content-Type → mode, D10's exact table, including x-www-form-urlencoded landing in
  // raw (never back in `urlencoded` — D10's own "a parsed body always lands in raw or code" rule). ----

  const CONTENT_TYPE_CASES: {
    contentType: string;
    mode: 'code' | 'raw';
    codeLanguage?: HttpCodeLanguage;
  }[] = [
    { contentType: 'application/json', mode: 'code', codeLanguage: 'json' },
    { contentType: 'application/xml', mode: 'code', codeLanguage: 'xml' },
    { contentType: 'text/xml', mode: 'code', codeLanguage: 'xml' },
    { contentType: 'text/html', mode: 'code', codeLanguage: 'html' },
    { contentType: 'application/javascript', mode: 'code', codeLanguage: 'javascript' },
    { contentType: 'application/x-www-form-urlencoded', mode: 'raw' },
    { contentType: 'text/plain', mode: 'raw' },
  ];
  for (const c of CONTENT_TYPE_CASES) {
    test(`Content-Type: ${c.contentType} → bodyMode ${c.mode}${c.codeLanguage ? `/${c.codeLanguage}` : ''}`, () => {
      const text = `POST /x HTTP/1.1\nContent-Type: ${c.contentType}\n\nsome-body-text`;
      const result = parseRawRequest(text, ORIGIN);
      expect('error' in result).toBe(false);
      if ('error' in result) return;
      expect(result.state.bodyMode).toBe(c.mode);
      if (c.mode === 'code' && c.codeLanguage !== undefined) {
        expect(result.state.codeLanguage).toBe(c.codeLanguage);
        expect(result.state.code).toBe('some-body-text');
      } else {
        expect(result.state.body).toBe('some-body-text');
      }
    });
  }

  // ---- 6: Content-Length is dropped with a note; Transfer-Encoding: chunked warns. ----

  test('a Content-Length header is dropped from the parsed headers, with a warning', () => {
    const text = 'POST /x HTTP/1.1\nContent-Length: 999\nX-Real: yes\n\nbody';
    const result = parseRawRequest(text, ORIGIN);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.headers).toEqual([{ name: 'X-Real', value: 'yes', enabled: true }]);
    expect(result.warnings.map((w) => w.kind)).toEqual(['content-length-dropped']);
  });

  test('Transfer-Encoding: chunked is kept as a header but warns', () => {
    const text = 'POST /x HTTP/1.1\nTransfer-Encoding: chunked\n\nbody';
    const result = parseRawRequest(text, ORIGIN);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.headers).toEqual([
      { name: 'Transfer-Encoding', value: 'chunked', enabled: true },
    ]);
    expect(result.warnings.map((w) => w.kind)).toEqual(['chunked-transfer-encoding']);
  });

  // ---- 7: an obs-fold continuation line is an error naming its line number, not a silent join. ----

  test('an obs-fold continuation line is an error naming its line number', () => {
    const text = 'GET /x HTTP/1.1\nX-A: one\n two\n\n';
    const result = parseRawRequest(text, ORIGIN);
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toContain('Line 3');
  });

  // ---- 8: errors — an unknown method, a request line with no target, a header line with no colon. ----

  test('an unknown method is an error', () => {
    const result = parseRawRequest('FETCH /x HTTP/1.1\n\n', ORIGIN);
    expect('error' in result).toBe(true);
  });

  test('a request line with no target is an error', () => {
    const result = parseRawRequest('GET \n\n', ORIGIN);
    expect('error' in result).toBe(true);
  });

  test('a header line with no colon is an error', () => {
    const text = 'GET /x HTTP/1.1\nNotAHeader\n\n';
    const result = parseRawRequest(text, ORIGIN);
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toContain('Line 2');
  });

  test('a request line with no space at all is an error', () => {
    const result = parseRawRequest('GET', ORIGIN);
    expect('error' in result).toBe(true);
  });
});
