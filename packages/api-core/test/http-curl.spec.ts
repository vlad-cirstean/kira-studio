// P7 D17: what earns a dedicated test is the interacting-rules half of this phase — mode selection
// × the effective Content-Type, method inference × -G × -T × a body flag, @/< handling × the flag
// it appears in, flag arity × an unknown flag × the URL pick, and the tokenizer's operator stop.
// One JSON corpus (curl-cases.json) covers tokenize/parseCurl, the same shape P5 D18's substitution
// corpus established — minus a second language, since D2 means there is no Go twin to be in parity
// with, so it lives beside its one reader rather than in internal/*/testdata/.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { HttpBodyWire, HttpHeaderWire, HttpRequestTabState } from '@kira/shared/domain/http';
import type { CurlRequest } from '../src/http/curl/generate';
import { toCurl } from '../src/http/curl/generate';
import { parseCurl } from '../src/http/curl/parse';
import type { CurlWarningKind } from '../src/http/curl/tokenize';
import { tokenize } from '../src/http/curl/tokenize';

interface TokenizeCase {
  name: string;
  command: string;
  argv?: string[];
  warnings?: CurlWarningKind[];
  error?: string;
}

interface ParseCase {
  name: string;
  command: string;
  want: Partial<HttpRequestTabState>;
  warnings: CurlWarningKind[];
}

const corpus: { tokenize: TokenizeCase[]; parse: ParseCase[] } = JSON.parse(
  readFileSync(resolvePath(import.meta.dir, 'curl-cases.json'), 'utf8'),
);

// Every field parseCurl's ParsedCurl.state always carries — a corpus case's `want` only states
// what differs from this, kept in one place so a new case does not have to restate the other nine.
const DEFAULT_STATE = {
  method: 'GET',
  url: '',
  headers: [] as unknown[],
  bodyMode: 'none',
  body: '',
  code: '',
  codeLanguage: 'json',
  urlEncoded: [] as unknown[],
  formData: [] as unknown[],
  binaryFile: null as unknown,
};

describe('http/curl/tokenize.ts (P7 D3)', () => {
  test('the corpus is non-empty', () => {
    expect(corpus.tokenize.length).toBeGreaterThan(0);
  });

  for (const c of corpus.tokenize) {
    test(c.name, () => {
      const result = tokenize(c.command);
      if (c.error !== undefined) {
        expect(result.ok).toBe(false);
        expect(result.ok ? '' : result.error).toBe(c.error);
        return;
      }
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.argv).toEqual(c.argv ?? []);
      expect(result.warnings.map((w) => w.kind)).toEqual(c.warnings ?? []);
    });
  }
});

describe('http/curl/parse.ts — parseCurl (P7 D4-D9)', () => {
  test('the corpus is non-empty', () => {
    expect(corpus.parse.length).toBeGreaterThan(0);
  });

  for (const c of corpus.parse) {
    test(c.name, () => {
      const result = parseCurl(c.command);
      expect('error' in result).toBe(false);
      if ('error' in result) return;
      expect(result.state).toEqual({ ...DEFAULT_STATE, ...c.want } as HttpRequestTabState);
      expect(result.warnings.map((w) => w.kind)).toEqual(c.warnings);
    });
  }
});

// ---- toCurl (P7 D13-D16) — not JSON-shaped (a CurlRequest's HttpBodyWire is naturally a TS
// object literal), each asserting one specific, measured rule rather than a whole command string,
// which would be brittle against a harmless reordering. ----

const EMPTY_BODY: HttpBodyWire = {
  mode: 'none',
  raw: '',
  code: '',
  codeLanguage: '',
  urlEncoded: [],
  formData: [],
  file: '',
};

function req(overrides: Partial<CurlRequest>): CurlRequest {
  return {
    method: 'GET',
    url: 'https://x.test/a',
    headers: [],
    body: EMPTY_BODY,
    defaultContentType: '',
    ...overrides,
  };
}

describe('http/curl/generate.ts — toCurl (P7 D13-D16)', () => {
  test('a GET with no body needs no -X, but always gets -L', () => {
    const command = toCurl(req({}));
    expect(command).toContain('-L');
    expect(command).not.toContain('-X');
  });

  test('a body flag makes -X unnecessary for POST, but DELETE with no body still needs it', () => {
    const withBody = toCurl(
      req({ method: 'POST', body: { ...EMPTY_BODY, mode: 'raw', raw: 'hi' } }),
    );
    expect(withBody).not.toContain('-X');
    expect(withBody).toContain('--data-raw');

    const noBody = toCurl(req({ method: 'DELETE' }));
    expect(noBody).toContain('-X');
    expect(noBody).toContain('DELETE');
  });

  test('the mode default Content-Type is emitted only when the user set none (D14)', () => {
    const auto = toCurl(
      req({
        method: 'POST',
        body: { ...EMPTY_BODY, mode: 'raw', raw: 'x' },
        defaultContentType: 'text/plain',
      }),
    );
    expect(auto).toContain('Content-Type: text/plain');

    const userSet: HttpHeaderWire[] = [{ name: 'Content-Type', value: 'application/xml' }];
    const explicit = toCurl(
      req({
        method: 'POST',
        headers: userSet,
        body: { ...EMPTY_BODY, mode: 'raw', raw: 'x' },
        defaultContentType: 'text/plain',
      }),
    );
    expect(explicit).toContain('application/xml');
    expect(explicit).not.toContain('text/plain');
  });

  test('a binary body removes the header curl would otherwise add (F11/D14)', () => {
    const command = toCurl(
      req({ method: 'POST', body: { ...EMPTY_BODY, mode: 'file', file: '/tmp/blob.bin' } }),
    );
    expect(command).toContain('-H Content-Type:');
    expect(command).toContain('--data-binary');
    expect(command).toContain('/tmp/blob.bin');
  });

  test('a formdata text row uses --form-string, never -F, even for a value starting with @ (F10)', () => {
    const command = toCurl(
      req({
        method: 'POST',
        body: {
          ...EMPTY_BODY,
          mode: 'formdata',
          formData: [{ name: 'note', kind: 'text', value: '@notafile', path: '', contentType: '' }],
        },
      }),
    );
    expect(command).toContain('--form-string');
    expect(command).not.toContain("-F 'note");
  });

  test('a formdata file row uses -F, with a stated Content-Type appended (F10)', () => {
    const command = toCurl(
      req({
        method: 'POST',
        body: {
          ...EMPTY_BODY,
          mode: 'formdata',
          formData: [
            { name: 'file', kind: 'file', value: '', path: '/tmp/r.csv', contentType: 'text/csv' },
          ],
        },
      }),
    );
    expect(command).toContain("-F 'file=@/tmp/r.csv;type=text/csv'");
  });

  test("a user's own multipart Content-Type header is dropped — curl mints its own boundary (D15)", () => {
    const headers: HttpHeaderWire[] = [
      { name: 'Content-Type', value: 'multipart/form-data; boundary=abc' },
    ];
    const command = toCurl(
      req({
        method: 'POST',
        headers,
        body: {
          ...EMPTY_BODY,
          mode: 'formdata',
          formData: [{ name: 'a', kind: 'text', value: 'b', path: '', contentType: '' }],
        },
      }),
    );
    expect(command).not.toContain('boundary=abc');
  });

  test('urlencoded emits the pre-encoded string as --data-raw, matching Go byte-for-byte (F13)', () => {
    const command = toCurl(
      req({
        method: 'POST',
        body: {
          ...EMPTY_BODY,
          mode: 'urlencoded',
          urlEncoded: [
            { name: 'a b', value: 'c d' },
            { name: 'x&y', value: 'z&w' },
          ],
        },
      }),
    );
    expect(command).not.toContain('--data-urlencode');
    expect(command).toContain("--data-raw 'a+b=c+d&x%26y=z%26w'");
  });

  test('every argument is shell-quoted (D13) — a single quote in a body round-trips through shlex', () => {
    const command = toCurl(
      req({ method: 'POST', body: { ...EMPTY_BODY, mode: 'raw', raw: "it's a test" } }),
    );
    expect(command).toContain(`'it'"'"'s a test'`);
  });

  test('an unresolved {{token}} is emitted verbatim, never a reveal by itself (D10)', () => {
    const headers: HttpHeaderWire[] = [{ name: 'Authorization', value: 'Bearer {{token}}' }];
    const command = toCurl(req({ headers }));
    expect(command).toContain('{{token}}');
  });

  test('an Authorization header is emitted as a header, never decoded back into -u (D16)', () => {
    const headers: HttpHeaderWire[] = [{ name: 'Authorization', value: 'Basic YWxpY2U6czNjcjN0' }];
    const command = toCurl(req({ headers }));
    expect(command).toContain('-H');
    expect(command).toContain('Authorization: Basic YWxpY2U6czNjcjN0');
    expect(command).not.toContain('-u ');
  });
});

// ---- The round trip (D17 item 3) — the strongest single property this phase can assert: it
// catches an escaping bug and a mapping bug in one assertion, in both directions at once. ----

describe('parseCurl(toCurl(x)) round-trips every mode (P7 D17)', () => {
  function roundTrip(request: CurlRequest): ReturnType<typeof parseCurl> {
    return parseCurl(toCurl(request));
  }

  test('none', () => {
    const result = roundTrip(req({ method: 'GET' }));
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.method).toBe('GET');
    expect(result.state.url).toBe('https://x.test/a');
    expect(result.state.bodyMode).toBe('none');
  });

  test('raw, with an embedded quote, newline and backslash', () => {
    const raw = "line one\nit's a \\backslash\\ test";
    const result = roundTrip(
      req({
        method: 'POST',
        body: { ...EMPTY_BODY, mode: 'raw', raw },
        defaultContentType: 'text/plain',
      }),
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.bodyMode).toBe('raw');
    expect(result.state.body).toBe(raw);
  });

  for (const codeLanguage of ['javascript', 'json', 'html', 'xml'] as const) {
    test(`code · ${codeLanguage}`, () => {
      const code = `<content for ${codeLanguage}> & "quoted" 'text'`;
      const result = roundTrip(
        req({
          method: 'POST',
          body: { ...EMPTY_BODY, mode: 'code', code, codeLanguage },
          defaultContentType:
            codeLanguage === 'json'
              ? 'application/json'
              : codeLanguage === 'xml'
                ? 'application/xml'
                : codeLanguage === 'html'
                  ? 'text/html'
                  : 'application/javascript',
        }),
      );
      expect('error' in result).toBe(false);
      if ('error' in result) return;
      expect(result.state.bodyMode).toBe('code');
      expect(result.state.codeLanguage).toBe(codeLanguage);
      expect(result.state.code).toBe(code);
    });
  }

  test('urlencoded, with &, =, +, a space and a % in a value', () => {
    const result = roundTrip(
      req({
        method: 'POST',
        body: {
          ...EMPTY_BODY,
          mode: 'urlencoded',
          urlEncoded: [{ name: 'q', value: 'a&b=c+d e%f' }],
        },
        defaultContentType: 'application/x-www-form-urlencoded',
      }),
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.bodyMode).toBe('urlencoded');
    expect(result.state.urlEncoded).toEqual([{ name: 'q', value: 'a&b=c+d e%f', enabled: true }]);
  });

  test('formdata — a text row, a file row, and a text value starting with @', () => {
    const result = roundTrip(
      req({
        method: 'POST',
        body: {
          ...EMPTY_BODY,
          mode: 'formdata',
          formData: [
            { name: 'title', kind: 'text', value: 'hello world', path: '', contentType: '' },
            { name: 'note', kind: 'text', value: '@notafile', path: '', contentType: '' },
            { name: 'file', kind: 'file', value: '', path: '/tmp/r.csv', contentType: 'text/csv' },
          ],
        },
      }),
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.bodyMode).toBe('formdata');
    expect(result.state.formData).toEqual([
      {
        name: 'title',
        kind: 'text',
        value: 'hello world',
        path: '',
        fileName: '',
        fileSize: 0,
        contentType: '',
        enabled: true,
      },
      {
        name: 'note',
        kind: 'text',
        value: '@notafile',
        path: '',
        fileName: '',
        fileSize: 0,
        contentType: '',
        enabled: true,
      },
      {
        name: 'file',
        kind: 'file',
        value: '',
        path: '/tmp/r.csv',
        fileName: 'r.csv',
        fileSize: 0,
        contentType: 'text/csv',
        enabled: true,
      },
    ]);
  });

  test('file (binary)', () => {
    const result = roundTrip(
      req({ method: 'POST', body: { ...EMPTY_BODY, mode: 'file', file: '/tmp/blob.bin' } }),
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.bodyMode).toBe('file');
    expect(result.state.binaryFile).toEqual({ path: '/tmp/blob.bin', name: 'blob.bin', size: 0 });
  });
});
