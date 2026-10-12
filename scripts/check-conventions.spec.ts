import { describe, expect, test } from 'bun:test';
import {
  applyPending,
  codeParityHits,
  eventHits,
  fileNameHit,
  folderHits,
  migrationHits,
  parsePending,
  piniaHits,
  testSuffixHit,
} from './check-conventions';

describe('N1 file names', () => {
  test('modules are camelCase, components PascalCase', () => {
    expect(fileNameHit('p/shared/domain/error-codes.ts')?.rule).toBe('N1');
    expect(fileNameHit('p/shared/domain/errorCodes.ts')).toBeUndefined();
    expect(fileNameHit('p/shared/domain/errorCodes.spec.ts')).toBeUndefined();
    expect(fileNameHit('p/w/Foo-bar.vue')?.rule).toBe('N1');
    expect(fileNameHit('p/w/fooBar.vue')?.rule).toBe('N1');
    expect(fileNameHit('p/w/FooBar.vue')).toBeUndefined();
  });
  test('declaration and config files are exempt', () => {
    expect(fileNameHit('p/w/env.d.ts')).toBeUndefined();
    expect(fileNameHit('p/w/vite.config.ts')).toBeUndefined();
  });
});

describe('N2/N3', () => {
  test('flags .test.ts and helper folders', () => {
    expect(testSuffixHit('a/b.test.ts')?.rule).toBe('N2');
    expect(testSuffixHit('a/b.spec.ts')).toBeUndefined();
    expect(folderHits('p/workbench/src/util/x.ts').map((h) => h.path)).toEqual([
      'p/workbench/src/util',
    ]);
    expect(folderHits('p/workbench/src/lib/x.ts')).toEqual([]);
    expect(folderHits('p/util/lib/x.ts')).toEqual([]);
  });
});

describe('N6 error-code parity', () => {
  const go = (codes: string[], legacy: string[]) =>
    `${codes.map((c) => `CodeX Code = "${c}"`).join('\n')}\nvar Legacy = map[Code]Code{\n${legacy
      .map((c) => `"${c}": CodeX,`)
      .join('\n')}\n}`;
  const ts = (codes: string[], legacy: string[]) =>
    `export const ERROR_CODES = [${codes.map((c) => `'${c}'`).join(', ')}] as const;\n` +
    `export const CLIENT_ERROR_CODES = ['E_NETWORK'] as const;\n` +
    `export const LEGACY_ERROR_CODES = [${legacy.map((c) => `'${c}'`).join(', ')}] as const;`;
  test('same sets pass, client-only codes are ignored', () => {
    expect(codeParityHits(go(['E_A', 'E_B'], ['E_OLD']), ts(['E_B', 'E_A'], ['E_OLD']))).toEqual(
      [],
    );
  });
  test('a code on one side only fails and names the side', () => {
    const hits = codeParityHits(go(['E_A', 'E_B'], []), ts(['E_A', 'E_C'], ['E_OLD']));
    expect(hits).toHaveLength(2);
    expect(hits[0]?.message).toContain('only in Go: E_B');
    expect(hits[0]?.message).toContain('only in TS: E_C');
    expect(hits[1]?.message).toContain('only in TS: E_OLD');
  });
});

describe('N4 Pinia ids', () => {
  const store = (exportName: string, id: string) =>
    `export const ${exportName} = defineStore('${id}', () => {});`;
  test('id is the export name without use/Store, camelCase', () => {
    expect(piniaHits('a.ts', store('useConfirmDialogStore', 'confirmDialog'))).toEqual([]);
    expect(piniaHits('a.ts', store('useDbMcp', 'dbmcp'))[0]?.rule).toBe('N4');
  });
  test('factory exports resolve to the nearest preceding export', () => {
    const src = `export function createModeStore() {\n  return defineStore('mode', () => {});\n}`;
    expect(piniaHits('a.ts', src)).toEqual([]);
    expect(piniaHits('a.ts', src.replace("'mode'", "'modes'"))).toHaveLength(1);
  });
});

describe('N5 event names', () => {
  const literal = /'(kira:[^']*)'/g;
  test('three camelCase segments only', () => {
    expect(eventHits('e.ts', "a: 'kira:op:update', b: 'kira:app:metrics'", literal)).toEqual([]);
    const hits = eventHits('e.ts', "a: 'kira:open-settings', b: 'kira:menu:view-find'", literal);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain('kira:menu:view-find');
  });
});

describe('N7 migrations', () => {
  const files = new Map([
    ['0003_p150_pin.sql', 'ALTER TABLE x ADD COLUMN created_at TEXT;'],
    ['0004_p266_ok.sql', 'ALTER TABLE x ADD COLUMN created_at INTEGER;'],
    ['0005_p266_text.sql', 'CREATE TABLE y (id INTEGER, updated_at  TEXT NOT NULL);'],
    ['0006_badname.sql', 'SELECT 1;'],
  ]);
  test('only files above the baseline are checked', () => {
    const hits = migrationHits('d', 3, files);
    expect(hits.map((h) => h.path)).toEqual(['d/0005_p266_text.sql', 'd/0006_badname.sql']);
  });
});

describe('pending list', () => {
  test('exempts a listed hit, reports an unused line as stale, ignores other ids', () => {
    const pending = parsePending(['N1 a.ts # why', 'N2 gone.spec.ts', 'U72 x.vue', 'G1 y.go', '']);
    const hits = [
      { rule: 'N1' as const, path: 'a.ts', message: '' },
      { rule: 'N1' as const, path: 'b.ts', message: '' },
    ];
    const { remaining, stale } = applyPending(hits, pending);
    expect(remaining.map((h) => h.path)).toEqual(['b.ts']);
    expect(stale).toEqual(['N2 gone.spec.ts']);
  });
});
