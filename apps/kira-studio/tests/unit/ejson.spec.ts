// Regression coverage for a "Mongo objects can't be copied" report: documents/menu.ts's
// copy-document/copy-id items call toShellText()/parseIdLabel() synchronously, and — before this
// fix — nothing caught a throw from either (ContextMenu.vue's onItemClick is never awaited by its
// own @click binding). This module had zero prior test coverage despite detectWrapper() covering
// every BSON extended-JSON wrapper this app recognises (P27 D13) — exactly the "parser with
// several interacting lexical rules" AGENTS.md's own bar keeps. Confirmed empirically first
// (a real Mongo-shaped document through every wrapper below, deeply nested) that none of them
// throws; this file pins that finding so a future wrapper addition/change can't silently regress
// it back into a synchronous throw that a caller with no try/catch would swallow.
import { describe, expect, test } from 'bun:test';
import {
  parseDocument,
  parseIdLabel,
  toShellText,
} from '../../frontend/src/views/shared/document/ejson';

describe('toShellText — every BSON wrapper detectWrapper() recognises', () => {
  test('ObjectId', () => {
    expect(toShellText('{"_id":{"$oid":"507f1f77bcf86cd799439011"}}')).toBe(
      '{\n  "_id": ObjectId("507f1f77bcf86cd799439011")\n}',
    );
  });

  test('Date, canonical nested $numberLong form', () => {
    expect(toShellText('{"d":{"$date":{"$numberLong":"1704067200000"}}}')).toBe(
      '{\n  "d": ISODate("2024-01-01T00:00:00.000Z")\n}',
    );
  });

  test('Date, bare ISO string tolerated (D14 fallback)', () => {
    expect(toShellText('{"d":{"$date":"2024-01-01T00:00:00.000Z"}}')).toBe(
      '{\n  "d": ISODate("2024-01-01T00:00:00.000Z")\n}',
    );
  });

  test('Int32', () => {
    expect(toShellText('{"n":{"$numberInt":"42"}}')).toBe('{\n  "n": NumberInt(42)\n}');
  });

  test('Int64', () => {
    expect(toShellText('{"n":{"$numberLong":"9223372036854775807"}}')).toBe(
      '{\n  "n": NumberLong("9223372036854775807")\n}',
    );
  });

  test('Decimal128', () => {
    expect(toShellText('{"n":{"$numberDecimal":"19.99"}}')).toBe(
      '{\n  "n": NumberDecimal("19.99")\n}',
    );
  });

  test('Double, finite renders as a bare number', () => {
    expect(toShellText('{"n":{"$numberDouble":"3.14"}}')).toBe('{\n  "n": 3.14\n}');
  });

  test('Double, Infinity/NaN fall back to verbatim EJSON (no bare-number spelling exists)', () => {
    expect(toShellText('{"n":{"$numberDouble":"Infinity"}}')).toBe(
      '{\n  "n": {\n    "$numberDouble": "Infinity"\n  }\n}',
    );
    expect(toShellText('{"n":{"$numberDouble":"NaN"}}')).toBe(
      '{\n  "n": {\n    "$numberDouble": "NaN"\n  }\n}',
    );
  });

  test('Binary', () => {
    expect(toShellText('{"b":{"$binary":{"base64":"Zm9vYmFy","subType":"00"}}}')).toBe(
      '{\n  "b": {"$binary":{"base64":"Zm9vYmFy","subType":"00"}}\n}',
    );
  });

  test('UUID (Binary subType 04)', () => {
    expect(
      toShellText('{"u":{"$binary":{"base64":"c1EiXehZQnKz1MdOP+uzhA==","subType":"04"}}}'),
    ).toBe('{\n  "u": {"$binary":{"base64":"c1EiXehZQnKz1MdOP+uzhA==","subType":"04"}}\n}');
  });

  test('Timestamp', () => {
    expect(toShellText('{"t":{"$timestamp":{"t":1700000000,"i":1}}}')).toBe(
      '{\n  "t": {"$timestamp":{"t":1700000000,"i":1}}\n}',
    );
  });

  test('RegExp', () => {
    expect(toShellText('{"r":{"$regularExpression":{"pattern":"^abc$","options":"i"}}}')).toBe(
      '{\n  "r": {"$regularExpression":{"pattern":"^abc$","options":"i"}}\n}',
    );
  });

  test('Code, with and without $scope', () => {
    expect(toShellText('{"c":{"$code":"function() { return 1; }"}}')).toBe(
      '{\n  "c": {"$code":"function() { return 1; }"}\n}',
    );
    expect(toShellText('{"c":{"$code":"function() { return x; }","$scope":{"x":1}}}')).toBe(
      '{\n  "c": {"$code":"function() { return x; }","$scope":{"x":1}}\n}',
    );
  });

  test('DBRef, with and without $db', () => {
    expect(toShellText('{"r":{"$ref":"other","$id":{"$oid":"507f1f77bcf86cd799439012"}}}')).toBe(
      '{\n  "r": {"$ref":"other","$id":{"$oid":"507f1f77bcf86cd799439012"}}\n}',
    );
    expect(
      toShellText('{"r":{"$ref":"other","$id":{"$oid":"507f1f77bcf86cd799439012"},"$db":"mydb"}}'),
    ).toBe('{\n  "r": {"$ref":"other","$id":{"$oid":"507f1f77bcf86cd799439012"},"$db":"mydb"}\n}');
  });

  test('MinKey / MaxKey', () => {
    expect(toShellText('{"m":{"$minKey":1}}')).toBe('{\n  "m": {"$minKey":1}\n}');
    expect(toShellText('{"m":{"$maxKey":1}}')).toBe('{\n  "m": {"$maxKey":1}\n}');
  });

  test('every wrapper together, deeply nested inside objects and arrays', () => {
    const body = JSON.stringify({
      _id: { $oid: '507f1f77bcf86cd799439011' },
      when: { $date: { $numberLong: '1700000000000' } },
      n1: { $numberInt: '1' },
      n2: { $numberLong: '2' },
      n3: { $numberDecimal: '3.3' },
      n4: { $numberDouble: '4.4' },
      bin: { $binary: { base64: 'AAAA', subType: '00' } },
      uuid: { $binary: { base64: 'AAAAAAAAAAAAAAAAAAAAAA==', subType: '04' } },
      ts: { $timestamp: { t: 1, i: 2 } },
      re: { $regularExpression: { pattern: 'x', options: '' } },
      code: { $code: 'x' },
      ref: { $ref: 'y', $id: 1 },
      mink: { $minKey: 1 },
      maxk: { $maxKey: 1 },
      nested: { a: { b: { c: [{ $minKey: 1 }, [null, true, { $numberLong: '5' }]] } } },
      arr: [{ $oid: '507f1f77bcf86cd799439011' }, { $numberLong: '5' }],
      emptyObj: {},
      emptyArr: [],
    });
    // Every branch resolves without throwing (the actual regression) and round-trips through
    // parseDocument — asserting well-formed output, not restating the exact indentation above.
    expect(() => toShellText(body)).not.toThrow();
    const root = parseDocument(body);
    expect(root).not.toBeNull();
    expect(root?.children.length).toBe(18);
  });
});

describe('toShellText — non-wrapper/edge shapes never throw', () => {
  test('unparseable body falls back to the raw text (D22) instead of throwing', () => {
    const raw = '{not valid json';
    expect(toShellText(raw)).toBe(raw);
  });

  test('a truncated 64KB-cut body (invalid JSON) falls back to raw text, not a throw', () => {
    const truncated = `{"_id":{"$oid":"507f1f77bcf86cd799439011"},"note":"${'x'.repeat(1000)}`;
    expect(() => toShellText(truncated)).not.toThrow();
    expect(toShellText(truncated)).toBe(truncated);
  });

  test('a bare top-level array is not an object — parseDocument returns null, no throw', () => {
    expect(parseDocument('[1,2,3]')).toBeNull();
  });
});

describe("parseIdLabel — DocumentPage.ids' own EJSON text", () => {
  test('ObjectId, NumberLong, UUID wrappers', () => {
    expect(parseIdLabel('{"$oid":"507f1f77bcf86cd799439011"}')).toEqual({
      text: 'ObjectId("507f1f77bcf86cd799439011")',
      bsonType: 'ObjectId',
    });
    expect(parseIdLabel('{"$numberLong":"123"}')).toEqual({
      text: 'NumberLong("123")',
      bsonType: 'Int64',
    });
    expect(parseIdLabel('{"$binary":{"base64":"AAAA","subType":"04"}}')).toEqual({
      text: '{"$binary":{"base64":"AAAA","subType":"04"}}',
      bsonType: 'UUID',
    });
  });

  test('a plain scalar or non-EJSON id falls back rather than throwing', () => {
    expect(parseIdLabel('"plain-string-id"')).toEqual({
      text: '"plain-string-id"',
      bsonType: 'json',
    });
    expect(parseIdLabel('42')).toEqual({ text: '42', bsonType: 'json' });
    expect(parseIdLabel('not-json-at-all')).toEqual({ text: 'not-json-at-all', bsonType: 'json' });
  });
});
