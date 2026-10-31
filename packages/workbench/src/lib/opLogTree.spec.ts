import { describe, expect, test } from 'bun:test';
import { MAX_OP_DEPTH, orderOpTree } from './opLogTree';

interface Rec {
  id: string;
  startedAt: string;
  parent: string | null;
}
// Newest first, like the panel's list: `at` is a minute offset.
const rec = (id: string, at: number, parent: string | null = null): Rec => ({
  id,
  startedAt: new Date(Date.UTC(2026, 0, 1, 0, at)).toISOString(),
  parent,
});
const parentOf = (r: Rec): string | null => r.parent;
const shape = (rows: ReturnType<typeof orderOpTree<Rec>>) =>
  rows.map((r) => `${r.record.id}:${r.depth}${r.viaParent ? 'v' : ''}`);

describe('orderOpTree', () => {
  test('without parentOf keeps input order, all top-level', () => {
    const rows = orderOpTree([rec('b', 2, 'a'), rec('a', 1)], undefined);
    expect(shape(rows)).toEqual(['b:0', 'a:0']);
  });

  test('children sit under their parent, oldest first', () => {
    const rows = orderOpTree(
      [rec('c2', 4, 'p'), rec('c1', 3, 'p'), rec('p', 2), rec('other', 1)],
      parentOf,
    );
    expect(shape(rows)).toEqual(['p:0', 'c1:1', 'c2:1', 'other:0']);
  });

  test('a child whose parent is absent stays top-level and keeps viaParent', () => {
    const rows = orderOpTree([rec('c', 2, 'gone'), rec('x', 1)], parentOf);
    expect(shape(rows)).toEqual(['c:0v', 'x:0']);
  });

  test('grandchild nests one more level', () => {
    const rows = orderOpTree([rec('g', 3, 'c'), rec('c', 2, 'p'), rec('p', 1)], parentOf);
    expect(shape(rows)).toEqual(['p:0', 'c:1', 'g:2']);
  });

  test('depth is capped at the maximum', () => {
    const chain = [
      rec('e', 5, 'd'),
      rec('d', 4, 'c'),
      rec('c', 3, 'b'),
      rec('b', 2, 'a'),
      rec('a', 1),
    ];
    const rows = orderOpTree(chain, parentOf);
    expect(shape(rows)).toEqual(['a:0', 'b:1', 'c:2', 'd:3', 'e:3']);
    expect(Math.max(...rows.map((r) => r.depth))).toBe(MAX_OP_DEPTH);
  });

  test('a two-record cycle breaks at the newest record', () => {
    const rows = orderOpTree([rec('b', 2, 'a'), rec('a', 1, 'b')], parentOf);
    expect(shape(rows)).toEqual(['b:0v', 'a:1']);
  });

  test('every record appears exactly once', () => {
    const input = [
      rec('s', 9, 's'),
      rec('c', 8, 'p'),
      rec('x', 7, 'y'),
      rec('y', 6, 'x'),
      rec('p', 5),
      rec('o', 4, 'gone'),
    ];
    const ids = orderOpTree(input, parentOf).map((r) => r.record.id);
    expect(ids).toHaveLength(input.length);
    expect(new Set(ids)).toEqual(new Set(input.map((r) => r.id)));
  });
});
