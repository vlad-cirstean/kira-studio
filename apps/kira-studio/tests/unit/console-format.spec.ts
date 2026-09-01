// P13 D10: formatConsoleText's Mongo branch is a composed statement parser (mongoStatement.ts) +
// argument splitter + emitter (ejson.ts's beautifyShellText) with real boundary cases — nested
// constructor calls, an empty argument list, a trailing comma — the "parser or splitter with
// several interacting lexical rules" AGENTS.md's own bar names explicitly. The SQL branch is a
// per-kind dialect lookup plus a library call, plumbing well below that bar, and is covered by
// tests/ui/console-format.spec.ts alone.
import { describe, expect, test } from 'bun:test';
import { formatConsoleText } from '../../frontend/src/views/console/format';

describe('formatConsoleText — mongodb', () => {
  test('one argument', async () => {
    expect(await formatConsoleText('mongodb', 'db.c.find({a:1})')).toEqual({
      text: 'db.c.find({\n  "a": 1\n})',
      ok: true,
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
    });
  });

  test('no arguments', async () => {
    expect(await formatConsoleText('mongodb', 'db.c.countDocuments()')).toEqual({
      text: 'db.c.countDocuments()',
      ok: true,
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
    });
  });

  test('a trailing comma is dropped, not treated as an empty argument', async () => {
    expect(await formatConsoleText('mongodb', 'db.c.find({a:1,})')).toEqual({
      text: 'db.c.find({\n  "a": 1\n})',
      ok: true,
    });
  });

  test('two ;-separated statements are rejoined with a blank line between them', async () => {
    const result = await formatConsoleText('mongodb', 'db.a.find({x:1});db.b.find({y:2})');
    expect(result).toEqual({
      text: 'db.a.find({\n  "x": 1\n});\n\ndb.b.find({\n  "y": 2\n})',
      ok: true,
    });
  });

  test('an unsupported method fails with the linter own wording, text unchanged', async () => {
    const input = 'db.c.frobnicate({a:1})';
    expect(await formatConsoleText('mongodb', input)).toEqual({
      text: input,
      ok: false,
      reason: 'unsupported console method: db.c.frobnicate()',
    });
  });

  test('an unbalanced brace inside the argument fails, text unchanged', async () => {
    const input = 'db.c.find({a:1)';
    const result = await formatConsoleText('mongodb', input);
    expect(result.ok).toBe(false);
    expect(result.text).toBe(input);
  });
});
