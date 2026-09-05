// P2 D10: closes P1 §8 OQ-6. Adding a tab kind or an op kind touches four vocabularies (§2 F1):
// tabKindSchema, RENDERABLE_TAB_KINDS and tabRecordSchema's discriminated union on the TS side
// (all three exhaustiveness-checked by the compiler), plus Go's own model.RenderableTabKinds/
// opKinds — the one of the four with no compiler behind it. A kind missing there is dropped on
// restore with a `warn` nobody reads (repos/tabs.go's own comment). Generating one side from the
// other was declined (D10: "too much machinery for two lists of eight strings") in favour of
// reading the Go source as plain text, the same technique this repo already leans on elsewhere to
// cross-check a generated/hand-written pair without a build step.
//
// P12 D19: this file's own vocabulary — tab kinds and op kinds — spans both Studio and Api by
// nature, so it stays a host-level spec. The Api-only body/content-type/Postman-language parity
// checks that used to live below move to packages/api-core/test/go-ts-api-parity.spec.ts, next to
// the package whose vocabulary they check.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { opKindSchema } from '../../../../packages/shared/domain/ops';
import { RENDERABLE_TAB_KINDS } from '../../../../packages/shared/domain/tabs';

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

describe('Go/TS tab- and op-kind vocabulary parity (P2 D10)', () => {
  test('model.RenderableTabKinds (Go) matches RENDERABLE_TAB_KINDS (TS)', () => {
    const source = readFileSync(
      resolve(import.meta.dir, '../../internal/storage/model/tabs.go'),
      'utf8',
    );
    const goKinds = extractGoStringSet(source, 'RenderableTabKinds');
    expect(goKinds).toEqual(new Set(RENDERABLE_TAB_KINDS));
  });

  test('model.opKinds (Go) matches opKindSchema (TS)', () => {
    const source = readFileSync(
      resolve(import.meta.dir, '../../internal/storage/model/ops.go'),
      'utf8',
    );
    const goKinds = extractGoStringSet(source, 'opKinds');
    expect(goKinds).toEqual(new Set(opKindSchema.options));
  });
});
