// P13 D10: formatConsoleText's Mongo branch is a composed statement parser (mongoStatement.ts) +
// argument splitter + emitter (ejson.ts's beautifyShellText) with real boundary cases — nested
// constructor calls, an empty argument list, a trailing comma — the "parser or splitter with
// several interacting lexical rules" AGENTS.md's own bar names explicitly. The SQL branch is a
// per-kind dialect lookup plus a library call, plumbing well below that bar, and is covered by
// tests/ui/console-format.spec.ts alone.
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
