// P18 D8: generateRawRequestFromStored is the small adapter the Raw pane's stored-entry reader
// uses — same rendering as generateRawRequest, over a ResponseHistorySnapshot.request's four
// fields (method/url/headers/body) rather than a live tab's HttpRequestTabState.

import { describe, expect, test } from 'bun:test';
import type { HttpBodyWire, HttpHeaderWire } from '@kira/shared/domain/http';
import { generateRawRequestFromStored } from '../src/http/raw/generate';

function body(overrides: Partial<HttpBodyWire>): HttpBodyWire {
  return {
    mode: 'none',
    raw: '',
    code: '',
    codeLanguage: 'json',
    urlEncoded: [],
    formData: [],
    file: '',
    ...overrides,
  };
}

describe('http/raw/generate.ts — generateRawRequestFromStored (P18 D8)', () => {
  test('renders the request line, headers verbatim (including {{name}}), and a raw body', () => {
    const headers: HttpHeaderWire[] = [
      { name: 'Authorization', value: 'Bearer {{token}}' },
      { name: 'X-Trace', value: '{{$guid}}' },
    ];
    const out = generateRawRequestFromStored(
      {
        method: 'POST',
        url: 'https://api.example.com/orders',
        headers,
        body: body({ mode: 'raw', raw: 'hello' }),
      },
      'text/plain',
    );
    expect(out).toContain('POST https://api.example.com/orders HTTP/1.1');
    expect(out).toContain('Authorization: Bearer {{token}}');
    expect(out).toContain('X-Trace: {{$guid}}');
    expect(out).toContain('Content-Type: text/plain');
    expect(out.endsWith('\n\nhello')).toBe(true);
  });

  test('does not inject a default Content-Type when the stored request already carried one', () => {
    const headers: HttpHeaderWire[] = [{ name: 'Content-Type', value: 'application/json' }];
    const out = generateRawRequestFromStored(
      {
        method: 'POST',
        url: 'https://api.example.com/orders',
        headers,
        body: body({ mode: 'code', code: '{}' }),
      },
      'application/json',
    );
    expect(out.match(/Content-Type/g)?.length).toBe(1);
  });

  test('renders an empty body for mode "none", with no Content-Type line', () => {
    const out = generateRawRequestFromStored(
      { method: 'GET', url: 'https://api.example.com/health', headers: [], body: body({}) },
      'text/plain',
    );
    expect(out).toBe('GET https://api.example.com/health HTTP/1.1\n\n');
  });

  test('renders urlencoded fields already reduced to name/value (the wire shape carries no `enabled`)', () => {
    const out = generateRawRequestFromStored(
      {
        method: 'POST',
        url: 'https://api.example.com/orders',
        headers: [],
        body: body({
          mode: 'urlencoded',
          urlEncoded: [
            { name: 'a', value: '1' },
            { name: 'b', value: 'two words' },
          ],
        }),
      },
      'application/x-www-form-urlencoded',
    );
    expect(out).toContain('a=1&b=two+words');
  });
});
