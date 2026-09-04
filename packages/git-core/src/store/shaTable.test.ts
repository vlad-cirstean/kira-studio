import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { ShaTable } from './shaTable';

/** A deterministic, genuinely unique-per-seed hex string — sha1 (40 hex) or sha256-truncated
 *  (up to 64 hex) of the seed, so 100k seeds never collide. */
function hexOfLength(seed: number, chars: number): string {
  const algo = chars <= 40 ? 'sha1' : 'sha256';
  const hex = createHash(algo).update(`shaTable-fixture:${seed}`).digest('hex');
  return hex.slice(0, chars).padEnd(chars, '0');
}

describe('ShaTable', () => {
  test('append then hexAt round-trips', () => {
    const table = new ShaTable();
    const hex = '0123456789abcdef0123456789abcdef01234567';
    const row = table.append(hex.slice(0, 40));
    expect(table.hexAt(row)).toBe(hex.slice(0, 40).toLowerCase());
  });

  test('rowOfHex finds an appended sha and returns -1 for an absent one', () => {
    const table = new ShaTable();
    const a = table.append(hexOfLength(1, 40));
    expect(table.rowOfHex(hexOfLength(1, 40))).toBe(a);
    expect(table.rowOfHex(hexOfLength(999_999, 40))).toBe(-1);
  });

  test('rowOfHex on an empty table returns -1 without throwing', () => {
    const table = new ShaTable();
    expect(table.rowOfHex(hexOfLength(1, 40))).toBe(-1);
  });

  test('100k random shas insert and look up correctly with no false positives', () => {
    const table = new ShaTable();
    const shas: string[] = [];
    const seen = new Set<string>();
    let i = 0;
    while (shas.length < 100_000) {
      const hex = hexOfLength(i++, 40);
      if (seen.has(hex)) continue; // extremely unlikely, but keep the fixture actually unique
      seen.add(hex);
      shas.push(hex);
    }
    const rows = shas.map((hex) => table.append(hex));
    expect(table.count).toBe(100_000);

    for (let idx = 0; idx < shas.length; idx += 997) {
      const sha = shas[idx] as string;
      const row = rows[idx] as number;
      expect(table.rowOfHex(sha)).toBe(row);
      expect(table.hexAt(row)).toBe(sha);
    }
    // A sha that was never appended, sharing no accidental prefix with any real entry.
    expect(table.rowOfHex('f'.repeat(40))).toBe(-1);
  });

  test('a deliberate first-four-bytes collision still resolves to the right row', () => {
    const table = new ShaTable();
    // Two distinct 20-byte shas sharing the same leading 4 bytes (the hash input) but
    // differing later — the hash table must fall through to a full compare, not the hash.
    const shaA = `${'aa'.repeat(4)}${'11'.repeat(16)}`;
    const shaB = `${'aa'.repeat(4)}${'22'.repeat(16)}`;
    expect(shaA).not.toBe(shaB);
    const rowA = table.append(shaA);
    const rowB = table.append(shaB);
    expect(rowA).not.toBe(rowB);
    expect(table.rowOfHex(shaA)).toBe(rowA);
    expect(table.rowOfHex(shaB)).toBe(rowB);
  });

  test('bytesAt returns a view reflecting only its own row', () => {
    const table = new ShaTable();
    const rowA = table.append(hexOfLength(1, 40));
    const rowB = table.append(hexOfLength(2, 40));
    const viewA = table.bytesAt(rowA);
    const viewB = table.bytesAt(rowB);
    expect(viewA).not.toEqual(viewB);
    expect(viewA).toHaveLength(20);
  });

  test("a sha-256 repository's 64-hex ids round-trip through a widthBytes: 32 table", () => {
    const table = new ShaTable({ widthBytes: 32 });
    const hex = hexOfLength(1, 64);
    const row = table.append(hex);
    expect(table.widthBytes).toBe(32);
    expect(table.hexAt(row)).toBe(hex);
    expect(table.rowOfHex(hex)).toBe(row);
  });

  test('width is auto-detected from the first append when not specified', () => {
    const table = new ShaTable();
    table.append(hexOfLength(1, 64));
    expect(table.widthBytes).toBe(32);
  });

  test('the table survives a growth rehash with every prior entry still findable', () => {
    const table = new ShaTable({ initialCapacity: 4 });
    const shas: string[] = [];
    for (let i = 0; i < 500; i++) shas.push(hexOfLength(i, 40));
    const rows = shas.map((hex) => table.append(hex));
    for (let i = 0; i < shas.length; i++) {
      expect(table.rowOfHex(shas[i] as string)).toBe(rows[i] as number);
    }
  });

  test('shortHexAt returns the requested prefix length', () => {
    const table = new ShaTable();
    const hex = hexOfLength(1, 40);
    const row = table.append(hex);
    expect(table.shortHexAt(row, 7)).toBe(hex.slice(0, 7));
  });

  test('append rejects a malformed sha length', () => {
    const table = new ShaTable();
    table.append(hexOfLength(1, 40));
    expect(() => table.append('abc')).toThrow();
  });

  test('append rejects a non-hex character', () => {
    const table = new ShaTable();
    expect(() => table.append(`${'g'.repeat(40)}`)).toThrow();
  });
});
