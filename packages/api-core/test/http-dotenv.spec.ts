// P17 D21/D22: the bulk `.env` editor's own parse/serialize/reconcile — a real parser and a real
// reconciler, not CRUD, so this earns the unit-test bar AGENTS.md sets (§4.2 of the plan).

import { describe, expect, test } from 'bun:test';
import {
  type EnvRow,
  parseEnv,
  reconcileEnv,
  SECRET_MARKER,
  serializeEnv,
} from '../src/http/dotenv';

function row(overrides: Partial<EnvRow>): EnvRow {
  return {
    id: 'id-1',
    name: 'KEY',
    value: 'value',
    isSecret: false,
    description: '',
    ...overrides,
  };
}

describe('parseEnv', () => {
  test('an unquoted value is trimmed both ends', () => {
    const { entries, error } = parseEnv('KEY=  hello world  ');
    expect(error).toBeNull();
    expect(entries).toEqual([
      { name: 'KEY', value: 'hello world', hasValue: true, description: '' },
    ]);
  });

  test('a double-quoted value decodes \\n \\t \\\\ \\" escapes', () => {
    const { entries, error } = parseEnv('KEY="line one\\nline two\\ttabbed\\\\slash\\"quote"');
    expect(error).toBeNull();
    expect(entries).toEqual([
      {
        name: 'KEY',
        value: 'line one\nline two\ttabbed\\slash"quote',
        hasValue: true,
        description: '',
      },
    ]);
  });

  test('a single-quoted value is literal — no escapes at all', () => {
    const { entries, error } = parseEnv("KEY='a\\nb'");
    expect(error).toBeNull();
    expect(entries).toEqual([{ name: 'KEY', value: 'a\\nb', hasValue: true, description: '' }]);
  });

  test('an export prefix is tolerated and stripped', () => {
    const { entries, error } = parseEnv('export KEY=value');
    expect(error).toBeNull();
    expect(entries).toEqual([{ name: 'KEY', value: 'value', hasValue: true, description: '' }]);
  });

  test('KEY= with nothing after the = is hasValue: false', () => {
    const { entries, error } = parseEnv('KEY=');
    expect(error).toBeNull();
    expect(entries).toEqual([{ name: 'KEY', value: '', hasValue: false, description: '' }]);
  });

  test('a comment block becomes the next pair’s multi-line description', () => {
    const { entries, error } = parseEnv('# line one\n# line two\nKEY=value');
    expect(error).toBeNull();
    expect(entries).toEqual([
      { name: 'KEY', value: 'value', hasValue: true, description: 'line one\nline two' },
    ]);
  });

  test('the exact secret marker is recognised and dropped, never becomes a description', () => {
    const text = `${SECRET_MARKER}\nAPI_TOKEN=`;
    const { entries, error } = parseEnv(text);
    expect(error).toBeNull();
    expect(entries).toEqual([{ name: 'API_TOKEN', value: '', hasValue: false, description: '' }]);
  });

  test('a blank line ends the pending comment block — it does not attach to a later pair', () => {
    const { entries, error } = parseEnv('# orphaned\n\nKEY=value');
    expect(error).toBeNull();
    expect(entries).toEqual([{ name: 'KEY', value: 'value', hasValue: true, description: '' }]);
  });

  test('duplicate keys are permitted and kept in file order', () => {
    const { entries, error } = parseEnv('KEY=first\nKEY=second');
    expect(error).toBeNull();
    expect(entries.map((e) => e.value)).toEqual(['first', 'second']);
  });

  test('a malformed line (no =) reports its own 1-based line number', () => {
    const { entries, error } = parseEnv('GOOD=1\nnot a valid line\nALSO_GOOD=2');
    expect(error).toEqual({ line: 2, message: 'line 2: expected KEY=VALUE' });
    // Entries collected before the bad line are still returned — the caller decides what to do
    // with a partial result (in practice: disable Apply and show the message).
    expect(entries).toEqual([{ name: 'GOOD', value: '1', hasValue: true, description: '' }]);
  });

  test('an unterminated double-quoted value is a parse error naming its line', () => {
    const { error } = parseEnv('KEY="unterminated');
    expect(error).toEqual({ line: 1, message: 'line 1: unterminated double-quoted value' });
  });

  test('a missing key before = is a parse error', () => {
    const { error } = parseEnv('=value');
    expect(error).toEqual({ line: 1, message: "line 1: missing a key before '='" });
  });
});

describe('serializeEnv', () => {
  test('a plain value with no quoting trigger is emitted raw', () => {
    expect(serializeEnv([row({ name: 'HOST', value: 'api.example.com' })])).toBe(
      'HOST=api.example.com\n',
    );
  });

  test('an empty value is quoted (so it round-trips as hasValue: true, not KEY=)', () => {
    expect(serializeEnv([row({ name: 'EMPTY', value: '' })])).toBe('EMPTY=""\n');
  });

  test('leading/trailing whitespace is quoted', () => {
    expect(serializeEnv([row({ name: 'PADDED', value: '  hi  ' })])).toBe('PADDED="  hi  "\n');
  });

  test('an embedded # is quoted', () => {
    expect(serializeEnv([row({ name: 'HASH', value: 'a#b' })])).toBe('HASH="a#b"\n');
  });

  test('an embedded newline is quoted and escaped', () => {
    expect(serializeEnv([row({ name: 'MULTI', value: 'a\nb' })])).toBe('MULTI="a\\nb"\n');
  });

  test('an embedded double quote is quoted and escaped', () => {
    expect(serializeEnv([row({ name: 'QUOTED', value: 'say "hi"' })])).toBe(
      'QUOTED="say \\"hi\\""\n',
    );
  });

  test('a secret row emits the marker and an empty value, never the plaintext', () => {
    const out = serializeEnv([
      row({ name: 'TOKEN', value: 'should-never-appear', isSecret: true }),
    ]);
    expect(out).toBe(`${SECRET_MARKER}\nTOKEN=\n`);
    expect(out).not.toContain('should-never-appear');
  });

  test('a non-empty description becomes # -prefixed lines above the pair, one per description line', () => {
    const out = serializeEnv([row({ name: 'HOST', value: 'x', description: 'first\nsecond' })]);
    expect(out).toBe('# first\n# second\nHOST=x\n');
  });

  test('multiple rows are separated by a blank line', () => {
    const out = serializeEnv([
      row({ name: 'A', value: '1' }),
      row({ id: 'id-2', name: 'B', value: '2' }),
    ]);
    expect(out).toBe('A=1\n\nB=2\n');
  });
});

describe('serializeEnv -> parseEnv round trip', () => {
  test('every quoting trigger round-trips losslessly for a non-secret row', () => {
    const rows: EnvRow[] = [
      row({ id: '1', name: 'EMPTY', value: '' }),
      row({ id: '2', name: 'PADDED', value: '  x  ' }),
      row({ id: '3', name: 'HASH', value: 'a#b' }),
      row({ id: '4', name: 'MULTI', value: 'line1\nline2' }),
      row({ id: '5', name: 'QUOTE', value: 'a "b" c' }),
      row({ id: '6', name: 'PLAIN', value: 'plain-value', description: 'a description' }),
    ];
    const text = serializeEnv(rows);
    const { entries, error } = parseEnv(text);
    expect(error).toBeNull();
    expect(
      entries.map((e) => ({ name: e.name, value: e.value, description: e.description })),
    ).toEqual(rows.map((r) => ({ name: r.name, value: r.value, description: r.description })));
  });
});

describe('reconcileEnv (P17 D22)', () => {
  test('rule 1: a matched line updates the row, replacing its description', () => {
    const existing = [row({ id: 'v1', name: 'HOST', value: 'old', description: 'old desc' })];
    const diff = reconcileEnv(existing, [
      { name: 'HOST', value: 'new', hasValue: true, description: 'new desc' },
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.updated).toEqual([
      { id: 'v1', name: 'HOST', value: 'new', description: 'new desc', valueChanged: true },
    ]);
  });

  test('rule 1: an unchanged line produces no update at all', () => {
    const existing = [row({ id: 'v1', name: 'HOST', value: 'same', description: 'same' })];
    const diff = reconcileEnv(existing, [
      { name: 'HOST', value: 'same', hasValue: true, description: 'same' },
    ]);
    expect(diff.updated).toEqual([]);
  });

  test('rule 2: an unmatched line creates a new, non-secret row', () => {
    const diff = reconcileEnv([], [{ name: 'NEW', value: 'v', hasValue: true, description: 'd' }]);
    expect(diff.added).toEqual([{ name: 'NEW', value: 'v', description: 'd' }]);
  });

  test('rule 3: a secret row with an untouched (hasValue: false) line keeps its value untouched', () => {
    const existing = [
      row({ id: 's1', name: 'TOKEN', value: '', isSecret: true, description: 'd' }),
    ];
    const diff = reconcileEnv(existing, [
      { name: 'TOKEN', value: '', hasValue: false, description: 'd' },
    ]);
    expect(diff.updated).toEqual([]); // nothing changed at all
  });

  test('rule 3: a secret row with an untouched line but a changed description updates description only', () => {
    const existing = [
      row({ id: 's1', name: 'TOKEN', value: '', isSecret: true, description: 'old' }),
    ];
    const diff = reconcileEnv(existing, [
      { name: 'TOKEN', value: '', hasValue: false, description: 'new' },
    ]);
    expect(diff.updated).toEqual([
      { id: 's1', name: 'TOKEN', value: '', description: 'new', valueChanged: false },
    ]);
  });

  test('rule 3: a secret row with a typed value updates the value (valueChanged: true)', () => {
    const existing = [row({ id: 's1', name: 'TOKEN', value: '', isSecret: true, description: '' })];
    const diff = reconcileEnv(existing, [
      { name: 'TOKEN', value: 'typed-plaintext', hasValue: true, description: '' },
    ]);
    expect(diff.updated).toEqual([
      { id: 's1', name: 'TOKEN', value: 'typed-plaintext', description: '', valueChanged: true },
    ]);
  });

  test('rule 4: an existing name absent from every line is removed', () => {
    const existing = [row({ id: 'v1', name: 'GONE' })];
    const diff = reconcileEnv(existing, []);
    expect(diff.removed).toEqual([{ id: 'v1', name: 'GONE' }]);
  });

  test('rule 5: reordering two lines with no other change reports zero add/update/remove and a non-empty reorder', () => {
    const existing = [
      row({ id: 'v1', name: 'A', value: '1' }),
      row({ id: 'v2', name: 'B', value: '2' }),
    ];
    const diff = reconcileEnv(existing, [
      { name: 'B', value: '2', hasValue: true, description: '' },
      { name: 'A', value: '1', hasValue: true, description: '' },
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.updated).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.reordered).toBe(true);
  });

  test('an untouched set (same order, same content) reports no reorder', () => {
    const existing = [
      row({ id: 'v1', name: 'A', value: '1' }),
      row({ id: 'v2', name: 'B', value: '2' }),
    ];
    const diff = reconcileEnv(existing, [
      { name: 'A', value: '1', hasValue: true, description: '' },
      { name: 'B', value: '2', hasValue: true, description: '' },
    ]);
    expect(diff.reordered).toBe(false);
  });

  test('duplicate keys match positionally: the Nth line maps to the Nth existing row of that name', () => {
    const existing = [
      row({ id: 'v1', name: 'DUP', value: 'first' }),
      row({ id: 'v2', name: 'DUP', value: 'second' }),
    ];
    const diff = reconcileEnv(existing, [
      { name: 'DUP', value: 'first-changed', hasValue: true, description: '' },
      { name: 'DUP', value: 'second', hasValue: true, description: '' },
    ]);
    expect(diff.updated).toEqual([
      { id: 'v1', name: 'DUP', value: 'first-changed', description: '', valueChanged: true },
    ]);
  });

  test('a rename (one name removed, a different name added) is flagged as a rename risk', () => {
    const existing = [row({ id: 'v1', name: 'OLD_NAME', value: 'x' })];
    const diff = reconcileEnv(existing, [
      { name: 'NEW_NAME', value: 'x', hasValue: true, description: '' },
    ]);
    expect(diff.removed).toEqual([{ id: 'v1', name: 'OLD_NAME' }]);
    expect(diff.added).toEqual([{ name: 'NEW_NAME', value: 'x', description: '' }]);
    expect(diff.hasRenameRisk).toBe(true);
  });

  test('an unrelated add with no removal is not flagged as a rename risk', () => {
    const existing = [row({ id: 'v1', name: 'KEEP', value: 'x' })];
    const diff = reconcileEnv(existing, [
      { name: 'KEEP', value: 'x', hasValue: true, description: '' },
      { name: 'NEW', value: 'y', hasValue: true, description: '' },
    ]);
    expect(diff.hasRenameRisk).toBe(false);
  });
});
