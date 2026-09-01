// P44 F43: shared/domain/sql-split.ts is a hand-written six-regime lexer that decides what SQL
// actually gets sent to the server (views/console/ConsoleView.vue's "Run statement"/"Run all"),
// and nothing in tests/ calls it directly. The only existing coverage is tests/e2e/console.spec.ts,
// which is Docker-gated (isDockerAvailable() -> test.skip) and has never run in this sandbox — and
// even on a box with containers, reproducing a dollar-quoted-body split means typing a multi-line
// PL/pgSQL function into CodeMirror and reading what the server rejects. Six direct expects over a
// pure function is the same fact in milliseconds instead of minutes, and the offset invariant
// (SqlStatement.start/.end index the *original* source, per the type's own doc comment) is not
// otherwise checked anywhere.
import { describe, expect, test } from 'bun:test';
import { splitSqlStatements, statementAtCursor } from '../../src/shared/domain/sql-split';

describe('splitSqlStatements — lexical regimes (P44 F43)', () => {
  test('1. a semicolon inside a single-quoted literal is not a boundary', () => {
    const stmts = splitSqlStatements(`SELECT 'a;b'; SELECT 2`);
    expect(stmts.map((s) => s.text)).toEqual([`SELECT 'a;b'`, 'SELECT 2']);
  });

  test('2. a doubled quote is an escape, not a close', () => {
    const stmts = splitSqlStatements(`SELECT 'it''s; still one'; SELECT 2`);
    expect(stmts.map((s) => s.text)).toEqual([`SELECT 'it''s; still one'`, 'SELECT 2']);
  });

  test('3a. MySQL/MariaDB/ClickHouse: a backslash escapes the next character', () => {
    const stmts = splitSqlStatements(`SELECT '\\'; still one'; SELECT 2`, {
      backslashEscapes: true,
    });
    expect(stmts).toHaveLength(2);
    expect(stmts[0]?.text).toBe(`SELECT '\\'; still one'`);
  });

  // P2 R2 (task #92): standard SQL has no backslash-escaping in a '...' literal — only a doubled
  // quote escapes. A literal ending in a real backslash immediately before its closing quote
  // (`'foo\'`) must not have that quote mistaken for an escaped character, or the scanner runs
  // on past the literal's true end and mis-splits everything after it.
  test('3b. Postgres/SQLite: a backslash is an ordinary character, not an escape', () => {
    const stmts = splitSqlStatements(`SELECT 'foo\\'; SELECT 2`, { backslashEscapes: false });
    expect(stmts.map((s) => s.text)).toEqual([`SELECT 'foo\\'`, 'SELECT 2']);
  });

  test('3c. splitSqlStatements defaults to backslashEscapes: true when no options are given', () => {
    const stmts = splitSqlStatements(`SELECT '\\'; still one'; SELECT 2`);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]?.text).toBe(`SELECT '\\'; still one'`);
  });

  test('4. -- runs to end of line', () => {
    const stmts = splitSqlStatements('SELECT 1; -- comment; not a boundary\nSELECT 2;');
    expect(stmts.map((s) => s.text)).toEqual(['SELECT 1', '-- comment; not a boundary\nSELECT 2']);
  });

  test('5. a block comment is skipped, including an unterminated one', () => {
    const terminated = splitSqlStatements('SELECT /* a; b */ 1; SELECT 2');
    expect(terminated.map((s) => s.text)).toEqual(['SELECT /* a; b */ 1', 'SELECT 2']);

    const unterminated = splitSqlStatements('SELECT 1; /* never closes; SELECT 2');
    expect(unterminated.map((s) => s.text)).toEqual(['SELECT 1', '/* never closes; SELECT 2']);
  });

  test('6. dollar-quoting protects a body with semicolons, and an unterminated tag swallows the rest', () => {
    const body = `CREATE FUNCTION f() RETURNS int AS $body$\nBEGIN\n  x := 1;\n  y := 2;\nEND;\n$body$ LANGUAGE plpgsql; SELECT 2`;
    const stmts = splitSqlStatements(body);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]?.text).toContain('x := 1;');
    expect(stmts[0]?.text).toContain('y := 2;');
    expect(stmts[1]?.text).toBe('SELECT 2');

    const unterminated = splitSqlStatements('SELECT $$ never closes; SELECT 2');
    expect(unterminated).toHaveLength(1);
    expect(unterminated[0]?.text).toBe('SELECT $$ never closes; SELECT 2');
  });

  test('7. backtick- and double-quoted identifiers protect their own semicolons', () => {
    const backtick = splitSqlStatements('SELECT `a;b` FROM t; SELECT 2');
    expect(backtick.map((s) => s.text)).toEqual(['SELECT `a;b` FROM t', 'SELECT 2']);

    const doubled = splitSqlStatements('SELECT "a;b" FROM t; SELECT 2');
    expect(doubled.map((s) => s.text)).toEqual(['SELECT "a;b" FROM t', 'SELECT 2']);
  });

  test('8. empty statements are dropped', () => {
    expect(splitSqlStatements(';;  ;\n')).toEqual([]);
    expect(splitSqlStatements('')).toEqual([]);
  });

  test('9. start/end index the original source; text is trimmed', () => {
    const source = '  SELECT 1  ;  SELECT 2';
    const stmts = splitSqlStatements(source);
    expect(stmts[0]).toEqual({ text: 'SELECT 1', start: 0, end: 12 });
    const first = stmts[0];
    if (!first) throw new Error('expected a first statement');
    expect(source.slice(first.start, first.end)).toBe('  SELECT 1  ');
    expect(stmts[1]?.start).toBe(13);
    expect(stmts[1]?.end).toBe(source.length);
  });
});

describe('statementAtCursor (P44 F43)', () => {
  const source = 'SELECT 1; SELECT 2; SELECT 3';

  test('10a. a cursor inside a statement resolves to that statement', () => {
    expect(statementAtCursor(source, 0)?.text).toBe('SELECT 1');
    expect(statementAtCursor(source, 12)?.text).toBe('SELECT 2');
    expect(statementAtCursor(source, source.length)?.text).toBe('SELECT 3');
  });

  test('10b. a cursor past the end falls back to the last statement', () => {
    expect(statementAtCursor(source, source.length + 50)?.text).toBe('SELECT 3');
  });
});
