// P44 F44: engine/adapters/sql-text.ts's computeEffectiveOrder decides whether keyset pagination
// is legal at all, and decodePageToken refuses a token whose fingerprint no longer matches — the
// check that stops a keyset boundary built for one filter/sort/projection from being handed to a
// query using another. Both are reached by seven adapters (postgres/mysql-family/sqlite/
// clickhouse/redis/kafka/mongo's read.ts modules) and neither is named in any spec anywhere in the
// repo. The existing coverage — tests/db/{postgres,mysql,mariadb,sqlite,clickhouse}.spec.ts, all
// Testcontainers- or node:sqlite-backed and none of which has ever run in this sandbox — is also
// incidental: those suites page real tables and only ever exercise the eligible-and-correct path,
// never the three disqualification paths a wrong sort can trigger. Driving "mixed sort directions
// must disqualify keyset" through a live server means constructing the sort in the UI and inferring
// the strategy three layers away; a direct call is the same fact in one assertion.
import { describe, expect, test } from 'bun:test';
import type { ColumnMeta } from '@shared/domain/tree';
import { AdapterError } from '../../src/engine/adapters/errors';
import {
  buildKeysetPosition,
  buildKeysetPredicate,
  computeEffectiveOrder,
  decodePageToken,
  type EffectiveOrder,
  encodePageToken,
  requestFingerprint,
  resolveProjection,
  safeInt,
  stripOneTrailingSemicolon,
} from '../../src/engine/adapters/sql-text';

function col(name: string, position: number, isPrimaryKey = false): ColumnMeta {
  return {
    name,
    position,
    dataType: 'int4',
    nullable: false,
    defaultExpr: null,
    isPrimaryKey,
    comment: null,
  };
}

const COLUMNS: ColumnMeta[] = [col('id', 0, true), col('name', 1), col('created_at', 2)];

describe('computeEffectiveOrder (P44 F44)', () => {
  test('1. a text sort is never keyset-eligible', () => {
    const result = computeEffectiveOrder({ kind: 'text', text: 'name asc' }, COLUMNS, ['id']);
    expect(result).toEqual({
      terms: [],
      keysetEligible: false,
      keysetColumns: [],
      keysetDirection: 'asc',
    });
  });

  test('2. mixed sort directions disqualify keyset, but keep both requested terms', () => {
    const sort = {
      kind: 'structured' as const,
      terms: [
        { column: 'name', direction: 'asc' as const },
        { column: 'created_at', direction: 'desc' as const },
      ],
    };
    const result = computeEffectiveOrder(sort, COLUMNS, ['id']);
    expect(result.keysetEligible).toBe(false);
    expect(result.keysetColumns).toEqual([]);
    expect(result.terms).toEqual(sort.terms);
  });

  test('3. an absent tiebreaker disqualifies keyset but keeps the requested direction', () => {
    const sort = {
      kind: 'structured' as const,
      terms: [{ column: 'name', direction: 'desc' as const }],
    };
    const result = computeEffectiveOrder(sort, COLUMNS, null);
    expect(result.keysetEligible).toBe(false);
    expect(result.keysetDirection).toBe('desc');
    expect(result.terms).toEqual(sort.terms);
  });

  test('4. the tiebreaker is appended in the requested direction, deduping a column already sorted by', () => {
    const sort = {
      kind: 'structured' as const,
      terms: [{ column: 'name', direction: 'desc' as const }],
    };
    const result = computeEffectiveOrder(sort, COLUMNS, ['name', 'id']);
    expect(result.keysetEligible).toBe(true);
    expect(result.keysetDirection).toBe('desc');
    // 'name' is already in the requested terms — appended only once, not duplicated.
    expect(result.terms).toEqual([
      { column: 'name', direction: 'desc' },
      { column: 'id', direction: 'desc' },
    ]);
    expect(result.keysetColumns).toEqual(['name', 'id']);
  });

  test('5. no sort at all is ascending and eligible on the tiebreaker alone', () => {
    const result = computeEffectiveOrder(null, COLUMNS, ['id']);
    expect(result).toEqual({
      terms: [{ column: 'id', direction: 'asc' }],
      keysetEligible: true,
      keysetColumns: ['id'],
      keysetDirection: 'asc',
    });
  });

  test('6. an unknown sort column throws E_NOT_FOUND', () => {
    const sort = {
      kind: 'structured' as const,
      terms: [{ column: 'nope', direction: 'asc' as const }],
    };
    expect(() => computeEffectiveOrder(sort, COLUMNS, ['id'])).toThrow(AdapterError);
    try {
      computeEffectiveOrder(sort, COLUMNS, ['id']);
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as AdapterError).code).toBe('E_NOT_FOUND');
    }
  });
});

describe('decodePageToken / encodePageToken (P44 F44)', () => {
  test('7. a token round-trips under a matching fingerprint', () => {
    const fp = requestFingerprint({ filter: 'x', sort: 'y' });
    const token = encodePageToken(['id', '42'], fp);
    expect(decodePageToken(token, fp)).toEqual(['id', '42']);
  });

  test('8. a mismatched fingerprint is refused, naming why', () => {
    const token = encodePageToken(['id', '42'], requestFingerprint({ a: 1 }));
    try {
      decodePageToken(token, requestFingerprint({ a: 2 }));
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as AdapterError).code).toBe('E_QUERY');
      expect((err as Error).message).toContain('does not match');
    }
  });

  test('9. a malformed token and a wrong-shape payload are both refused', () => {
    expect(() => decodePageToken('not-base64-json!!', 'fp')).toThrow(AdapterError);
    const wrongShape = Buffer.from(JSON.stringify({ v: 2, k: 'not-an-array' }), 'utf8').toString(
      'base64url',
    );
    expect(() => decodePageToken(wrongShape, 'fp')).toThrow(AdapterError);
  });
});

describe('buildKeysetPredicate (P44 F44)', () => {
  const placeholder = (i: number) => `$${i}`;

  test('10. the operator flips with both direction and mode', () => {
    expect(buildKeysetPredicate(['"id"'], 'asc', 'after', 1, placeholder)).toBe('("id") > ($1)');
    expect(buildKeysetPredicate(['"id"'], 'asc', 'before', 1, placeholder)).toBe('("id") < ($1)');
    expect(buildKeysetPredicate(['"id"'], 'desc', 'after', 1, placeholder)).toBe('("id") < ($1)');
    expect(buildKeysetPredicate(['"id"'], 'desc', 'before', 1, placeholder)).toBe('("id") > ($1)');
  });
});

describe('buildKeysetPosition (P48 F24, step 5)', () => {
  const fp = requestFingerprint({ path: 't', pageSize: 2 });
  const eligibleOrder: EffectiveOrder = {
    terms: [{ column: 'id', direction: 'asc' }],
    keysetEligible: true,
    keysetColumns: ['id'],
    keysetDirection: 'asc',
  };
  const keysetColumnIndex = new Map([['id', 0]]);
  const cellAt = (row: string[], i: number): string | null => row[i];

  test("14. an 'after' page with a next page reports strategy 'keyset' and both tokens", () => {
    const position = buildKeysetPosition({
      cursor: { mode: 'after', token: 'x' },
      pageSize: 2,
      displayRows: [['1'], ['2']],
      probedExtra: true,
      order: eligibleOrder,
      keysetColumnIndex,
      fingerprint: fp,
      cellAt,
    });
    expect(position.strategy).toBe('keyset');
    expect(position.offset).toBeNull();
    expect(position.hasMore).toBe(true);
    expect(position.nextToken && decodePageToken(position.nextToken, fp)).toEqual(['2']);
    expect(position.prevToken && decodePageToken(position.prevToken, fp)).toEqual(['1']);
  });

  test("15. a 'before' page always reports hasMore true, regardless of probedExtra", () => {
    const position = buildKeysetPosition({
      cursor: { mode: 'before', token: 'x' },
      pageSize: 2,
      displayRows: [['5'], ['6']],
      probedExtra: false,
      order: eligibleOrder,
      keysetColumnIndex,
      fingerprint: fp,
      cellAt,
    });
    expect(position.hasMore).toBe(true);
    expect(position.prevToken).toBeNull();
    expect(position.nextToken && decodePageToken(position.nextToken, fp)).toEqual(['6']);
  });

  test('16. an offset page at 0 never has a prevToken', () => {
    const position = buildKeysetPosition({
      cursor: { mode: 'offset', offset: 0 },
      pageSize: 2,
      displayRows: [['1'], ['2']],
      probedExtra: true,
      order: eligibleOrder,
      keysetColumnIndex,
      fingerprint: fp,
      cellAt,
    });
    expect(position.offset).toBe(0);
    expect(position.prevToken).toBeNull();
    expect(position.nextToken && decodePageToken(position.nextToken, fp)).toEqual(['2']);
  });

  test('17. an offset page at >0 gets a prevToken once keyset-eligible', () => {
    const position = buildKeysetPosition({
      cursor: { mode: 'offset', offset: 20 },
      pageSize: 2,
      displayRows: [['21'], ['22']],
      probedExtra: false,
      order: eligibleOrder,
      keysetColumnIndex,
      fingerprint: fp,
      cellAt,
    });
    expect(position.offset).toBe(20);
    expect(position.hasMore).toBe(false);
    expect(position.nextToken).toBeNull();
    expect(position.prevToken && decodePageToken(position.prevToken, fp)).toEqual(['21']);
  });
});

describe('resolveProjection (P44 F44)', () => {
  test('11a. returns ordinal order, not request order', () => {
    expect(resolveProjection(COLUMNS, ['created_at', 'id'])).toEqual([
      col('id', 0, true),
      col('created_at', 2),
    ]);
  });

  test('11b. dedups a repeated request', () => {
    expect(resolveProjection(COLUMNS, ['id', 'id'])).toEqual([col('id', 0, true)]);
  });

  test('11c. null means every column, in the input array identity', () => {
    expect(resolveProjection(COLUMNS, null)).toBe(COLUMNS);
  });

  test('11d. an unknown column throws E_NOT_FOUND', () => {
    expect(() => resolveProjection(COLUMNS, ['nope'])).toThrow(AdapterError);
  });
});

describe('safeInt (P44 F44)', () => {
  test('12. refuses negative and non-integer values', () => {
    expect(safeInt(5, 'pageSize')).toBe(5);
    expect(() => safeInt(-1, 'pageSize')).toThrow(AdapterError);
    expect(() => safeInt(1.5, 'pageSize')).toThrow(AdapterError);
    expect(() => safeInt(Number.NaN, 'pageSize')).toThrow(AdapterError);
  });
});

describe('stripOneTrailingSemicolon (P44 F44)', () => {
  test('13. strips exactly one trailing semicolon, with its trailing whitespace', () => {
    expect(stripOneTrailingSemicolon('SELECT 1;')).toBe('SELECT 1');
    expect(stripOneTrailingSemicolon('SELECT 1;  \n')).toBe('SELECT 1');
    expect(stripOneTrailingSemicolon('SELECT 1;;')).toBe('SELECT 1;');
    expect(stripOneTrailingSemicolon('SELECT 1')).toBe('SELECT 1');
  });
});
