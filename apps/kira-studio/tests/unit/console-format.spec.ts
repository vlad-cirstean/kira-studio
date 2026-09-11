// P13 D10: formatConsoleText's Mongo branch is a composed statement parser (mongoStatement.ts) +
// argument splitter + emitter (ejson.ts's beautifyShellText) with real boundary cases — nested
// constructor calls, an empty argument list, a trailing comma — the "parser or splitter with
// several interacting lexical rules" AGENTS.md's own bar names explicitly. The SQL branch's own
// per-kind dialect lookup plus a library call stays below that bar and is covered by
// tests/ui/console-format.spec.ts alone — but v1.4's compact-statement decision
// (compactIfShortEnough) and comment-safe terminator placement (appendTerminator) are exactly that
// bar's case (a quote/comment-aware safety check plus a width threshold interacting with a
// synthesized ';'), so those get their own describe block below.
//
// P19 D13: every case below now carries its own `failures: []` — formatConsoleText's return
// shape gained a per-statement `failures` array (reopening P13 §3's declined statement-by-
// statement alternative), and the cases at the bottom exercise it directly: one statement failing
// no longer takes its neighbours down with it, and the statement COUNT survives every case
// (what D12's caret-by-index mapping in ConsoleView.onFormat depends on).
import { describe, expect, test } from 'bun:test';
import { formatConsoleText } from '../../frontend/src/views/console/format';

describe('formatConsoleText — mongodb', () => {
  test('one argument', async () => {
    expect(await formatConsoleText('mongodb', 'db.c.find({a:1})')).toEqual({
      text: 'db.c.find({\n  "a": 1\n})',
      ok: true,
      failures: [],
    });
  });

  test('an aggregate pipeline — the case the feature exists for', async () => {
    const result = await formatConsoleText(
      'mongodb',
      'db.widgets.aggregate([{$match:{a:1}},{$group:{_id:"$a"}}])',
    );
    expect(result).toEqual({
      text:
        'db.widgets.aggregate([\n' +
        '  {\n' +
        '    "$match": {\n' +
        '      "a": 1\n' +
        '    }\n' +
        '  },\n' +
        '  {\n' +
        '    "$group": {\n' +
        '      "_id": "$a"\n' +
        '    }\n' +
        '  }\n' +
        '])',
      ok: true,
      failures: [],
    });
  });

  test('two arguments — one per line at indent 2', async () => {
    expect(await formatConsoleText('mongodb', 'db.c.updateOne({a:1},{$set:{b:2}})')).toEqual({
      text:
        'db.c.updateOne(\n' +
        '  {\n' +
        '    "a": 1\n' +
        '  },\n' +
        '  {\n' +
        '    "$set": {\n' +
        '      "b": 2\n' +
        '    }\n' +
        '  }\n' +
        ')',
      ok: true,
      failures: [],
    });
  });

  test('no arguments — byte-identical, reported as an ordinary success with no failures', async () => {
    expect(await formatConsoleText('mongodb', 'db.c.countDocuments()')).toEqual({
      text: 'db.c.countDocuments()',
      ok: true,
      failures: [],
    });
  });

  test('a nested constructor argument is carried whole, never re-parsed', async () => {
    const result = await formatConsoleText(
      'mongodb',
      'db.c.find({_id: ObjectId("507f1f77bcf86cd799439011")})',
    );
    expect(result).toEqual({
      text: 'db.c.find({\n  "_id": ObjectId("507f1f77bcf86cd799439011")\n})',
      ok: true,
      failures: [],
    });
  });

  test('a trailing comma is dropped, not treated as an empty argument', async () => {
    expect(await formatConsoleText('mongodb', 'db.c.find({a:1,})')).toEqual({
      text: 'db.c.find({\n  "a": 1\n})',
      ok: true,
      failures: [],
    });
  });

  test('two ;-separated statements are rejoined with a blank line between them', async () => {
    const result = await formatConsoleText('mongodb', 'db.a.find({x:1});db.b.find({y:2})');
    expect(result).toEqual({
      text: 'db.a.find({\n  "x": 1\n});\n\ndb.b.find({\n  "y": 2\n})',
      ok: true,
      failures: [],
    });
  });

  test('an unsupported method fails with the linter own wording, text unchanged', async () => {
    const input = 'db.c.frobnicate({a:1})';
    expect(await formatConsoleText('mongodb', input)).toEqual({
      text: input,
      ok: false,
      reason: 'unsupported console method: db.c.frobnicate()',
      failures: [{ index: 0, reason: 'unsupported console method: db.c.frobnicate()' }],
    });
  });

  test('an unbalanced brace inside the argument fails, text unchanged', async () => {
    const input = 'db.c.find({a:1)';
    const result = await formatConsoleText('mongodb', input);
    expect(result.ok).toBe(false);
    expect(result.text).toBe(input);
    expect(result.failures).toEqual([{ index: 0, reason: expect.any(String) }]);
  });

  test('D13: one unparseable statement among three formats the other two, verbatim in place', async () => {
    const result = await formatConsoleText(
      'mongodb',
      'db.a.find({x:1});db.c.frobnicate({y:2});db.b.find({z:3})',
    );
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([
      { index: 1, reason: 'unsupported console method: db.c.frobnicate()' },
    ]);
    expect(result.text).toBe(
      'db.a.find({\n  "x": 1\n});\n\ndb.c.frobnicate({y:2});\n\ndb.b.find({\n  "z": 3\n})',
    );
  });

  test('D13: every statement failing is still ok:false with the original text, statement count preserved', async () => {
    const input = 'db.c.frobnicate({x:1});db.d.frobnicate({y:2})';
    const result = await formatConsoleText('mongodb', input);
    expect(result.ok).toBe(false);
    expect(result.text).toBe(input);
    expect(result.failures).toHaveLength(2);
    expect(result.failures.map((f) => f.index)).toEqual([0, 1]);
  });
});

// P22b D12: splitSqlStatements' pushIfNonEmpty slices up to, not through, a statement's own ';'
// (sql-split.ts), so a plain join(';\n\n') emitted N-1 semicolons for N statements — silently
// deleting the document's LAST one on every press, a regression against P13's whole-document
// formatDialect call. None of the cases above happen to end their input in ';', which is exactly
// why the regression went unnoticed; these are the ones that would have caught it.
//
// v1.4 follow-up: a SQL document now always ends formatted with ';', even one that started without
// one — reported as Format looking like it does nothing for the common "type one statement, no
// trailing ;" case. Mongo is unchanged: its own ';' is a real statement separator the user typed,
// not a terminator this app invents.
describe("formatConsoleText — D12 preserves the document's own trailing terminator", () => {
  test('a document ending in ";" still does', async () => {
    const result = await formatConsoleText('sqlite', 'select 1;');
    expect(result.ok).toBe(true);
    expect(result.text.endsWith(';')).toBe(true);
  });

  test('a SQL document NOT ending in ";" now gets one added', async () => {
    const result = await formatConsoleText('sqlite', 'select 1');
    expect(result.ok).toBe(true);
    expect(result.text).toBe('select 1;');
  });

  test('a multi-statement document keeps every internal ";" and its own trailing one', async () => {
    const result = await formatConsoleText('sqlite', 'select 1; select 2;');
    expect(result.ok).toBe(true);
    // Two statements means exactly two ';' — one between them, one at the end — never one fewer.
    expect(result.text.match(/;/g)).toHaveLength(2);
    expect(result.text.endsWith(';')).toBe(true);
  });

  test('the mongo branch (which also goes through splitSqlStatements, F20) keeps a trailing ";" too', async () => {
    const result = await formatConsoleText('mongodb', 'db.c.find({a:1});');
    expect(result.ok).toBe(true);
    expect(result.text).toBe('db.c.find({\n  "a": 1\n});');
  });

  test('a mongo document NOT ending in ";" still does not (unlike SQL)', async () => {
    const result = await formatConsoleText('mongodb', 'db.c.find({a:1})');
    expect(result.ok).toBe(true);
    expect(result.text.endsWith(';')).toBe(false);
  });

  test("a trailing '--' line comment never swallows the synthesized terminator", async () => {
    const result = await formatConsoleText('postgres', 'select 1 -- a comment');
    expect(result.ok).toBe(true);
    // The comment consumes the rest of its own line — the ';' goes on a fresh line instead of
    // being appended directly, which would have silently commented the terminator out too.
    expect(result.text.endsWith('\n;')).toBe(true);
    expect(result.text).not.toMatch(/--.*;/);
  });

  test('a document where every statement fails is returned byte-identical, terminator included', async () => {
    // D12's own note: the all-failed branch already returns `text` untouched (the original
    // string, terminator and all) — correct by construction, not by this fix. Pinned here anyway
    // so a future refactor of that branch can't silently drop it.
    const input = 'db.c.frobnicate({x:1});';
    const result = await formatConsoleText('mongodb', input);
    expect(result.ok).toBe(false);
    expect(result.text).toBe(input);
  });
});

// v1.4 follow-up: sql-formatter puts every clause on its own line unconditionally, even for a
// trivial single-table query — reported as Format looking broken for exactly the queries people
// try it on first (`select * from products` becoming four lines). compactIfShortEnough collapses
// a formatted statement back onto one line when it's short enough AND safe to collapse; a string
// literal, a quoted identifier, or a comment blocks compaction outright rather than risk touching
// whitespace that has to survive exactly as written.
describe('formatConsoleText — SQL compacts short, safe statements onto one line', () => {
  test('a trivial single-table query stays on one line', async () => {
    const result = await formatConsoleText('postgres', 'select * from products');
    expect(result.text).toBe('select * from products;');
  });

  test('a short query with a WHERE clause still compacts', async () => {
    const result = await formatConsoleText('postgres', 'select a, b from t where x = 1');
    expect(result.text).toBe('select a, b from t where x = 1;');
  });

  test('a query long enough to exceed the compact width stays expanded', async () => {
    const long =
      'select a, b, c, d, e, f, g, h, i, j from a_really_long_table_name_here where x = 1 and y = 2';
    const result = await formatConsoleText('postgres', long);
    expect(result.text).toContain('\n');
    expect(result.text.split('\n').length).toBeGreaterThan(1);
  });

  test('a string literal blocks compaction — its internal whitespace is never touched', async () => {
    const result = await formatConsoleText('postgres', "select name from t where name = 'a   b'");
    // Stays expanded (sql-formatter's own multi-line form); the literal's three internal spaces
    // survive exactly, proven by matching the raw substring rather than a collapsed one.
    expect(result.text).toContain("'a   b'");
    expect(result.text).toContain('\n');
  });

  test('a backtick-quoted identifier blocks compaction', async () => {
    const result = await formatConsoleText('mysql', 'select * from `users`');
    expect(result.text).toContain('\n');
  });

  test('an already-compact statement is idempotent across repeated presses', async () => {
    const first = await formatConsoleText('postgres', 'select * from products');
    const second = await formatConsoleText('postgres', first.text);
    expect(second.text).toBe(first.text);
  });
});
