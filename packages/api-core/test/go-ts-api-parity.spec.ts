// P12 D19: split out of tests/unit/go-ts-vocabulary-parity.spec.ts — that file's own remaining
// describe (tab/op-kind parity) spans both Studio and Api by nature, but these three checks (body
// modes, content types, Postman code languages) are Api-only, so they move beside the package
// whose vocabulary they check. Same technique as the file they came from: reading the Go source as
// plain text rather than generating one side from the other (P2 D10).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CODE_LANGUAGES,
  CONTENT_TYPE_BY_CODE_LANGUAGE,
  HTTP_BODY_MODES,
} from '@kira/shared/domain/http';

/** Pulls every `"key": true` entry out of a Go `var <name> = map[string]bool{ ... }` literal —
 *  tolerant of comments and multi-entries-per-line (both present in the real source), not a full
 *  Go parser. */
function extractGoStringSet(source: string, varName: string): Set<string> {
  const header = new RegExp(`var\\s+${varName}\\s*=\\s*map\\[string\\]bool\\{`);
  const headerMatch = header.exec(source);
  if (!headerMatch) {
    throw new Error(`could not find "var ${varName} = map[string]bool{" in the Go source`);
  }
  const bodyStart = headerMatch.index + headerMatch[0].length;
  const bodyEnd = source.indexOf('}', bodyStart);
  if (bodyEnd < 0) throw new Error(`unterminated "${varName}" map literal`);
  const body = source.slice(bodyStart, bodyEnd);
  return new Set([...body.matchAll(/"([^"]+)":\s*true/g)].map((m) => m[1]));
}

/** P3 D12: the map[string]string sibling of extractGoStringSet — pulls every `"key": "value"`
 *  entry out of a Go `var <name> = map[string]string{ ... }` literal. */
function extractGoStringMap(source: string, varName: string): Record<string, string> {
  const header = new RegExp(`var\\s+${varName}\\s*=\\s*map\\[string\\]string\\{`);
  const headerMatch = header.exec(source);
  if (!headerMatch) {
    throw new Error(`could not find "var ${varName} = map[string]string{" in the Go source`);
  }
  const bodyStart = headerMatch.index + headerMatch[0].length;
  const bodyEnd = source.indexOf('}', bodyStart);
  if (bodyEnd < 0) throw new Error(`unterminated "${varName}" map literal`);
  const body = source.slice(bodyStart, bodyEnd);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/"([^"]+)":\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

// P3 D12: the same silent-drift shape go-ts-vocabulary-parity.spec.ts's own tab/op-kind checks
// guard, for the request body's own two small vocabularies — the mode strings are duplicated in
// two languages, and so are the Content-Type-by-code-language values (Go decides what to send;
// body.ts decides what the caption claims will be sent).
describe('Go/TS HTTP body vocabulary parity (P3 D12)', () => {
  test('httpclient.validBodyModes (Go) matches HTTP_BODY_MODES minus the legacy json alias (TS)', () => {
    const source = readFileSync(
      resolve(import.meta.dir, '../../../apps/kira-studio/internal/httpclient/body.go'),
      'utf8',
    );
    const goModes = extractGoStringSet(source, 'validBodyModes');
    // The legacy 'json' alias (httpRequestTabStateSchema's preprocess) is input-only and
    // deliberately has no Go counterpart — HTTP_BODY_MODES itself never contains it.
    expect(goModes).toEqual(new Set(HTTP_BODY_MODES));
  });

  test('httpclient.contentTypeByCodeLanguage (Go) matches CONTENT_TYPE_BY_CODE_LANGUAGE (TS)', () => {
    const source = readFileSync(
      resolve(import.meta.dir, '../../../apps/kira-studio/internal/httpclient/body.go'),
      'utf8',
    );
    const goTable = extractGoStringMap(source, 'contentTypeByCodeLanguage');
    expect(goTable).toEqual(CONTENT_TYPE_BY_CODE_LANGUAGE);
  });
});

// P4 D17: the Postman translation table lives only in Go, so most of it needs no parity guard.
// One list does. If a fifth code language were ever added on the TypeScript side,
// internal/postman/body.go's importer would silently stop recognising it — importing that
// language's bodies as plain `raw` — and its exporter would silently stop emitting it, with
// nothing failing anywhere.
describe('Go/TS Postman code-language parity (P4 D17)', () => {
  test('postman.postmanCodeLanguages (Go) matches CODE_LANGUAGES (TS)', () => {
    const source = readFileSync(
      resolve(import.meta.dir, '../../../apps/kira-studio/internal/postman/body.go'),
      'utf8',
    );
    const goLanguages = extractGoStringSet(source, 'postmanCodeLanguages');
    expect(goLanguages).toEqual(new Set(CODE_LANGUAGES));
  });
});
