import { expect, test } from 'bun:test';
import { nextWarmIds } from './warmTabs.ts';

const live = (...ids: string[]) => new Set(ids);

test('evicts the oldest stamp, not the first list position', () => {
  const used = new Map([
    ['a', 3],
    ['b', 1],
    ['c', 2],
  ]);
  const next = nextWarmIds(['a', 'b', 'c'], 'd', live('a', 'b', 'c', 'd'), used, 4, 3);
  expect(next).toEqual(['a', 'c', 'd']);
  expect(used.has('b')).toBe(false);
});

test('drops closed ids before eviction counts', () => {
  const used = new Map([
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ]);
  const next = nextWarmIds(['a', 'b', 'c'], 'd', live('b', 'c', 'd'), used, 4, 3);
  expect(next).toEqual(['b', 'c', 'd']);
  expect(used.has('a')).toBe(false);
});

test('active id survives max 1', () => {
  const used = new Map([['a', 1]]);
  expect(nextWarmIds(['a'], 'b', live('a', 'b'), used, 2, 1)).toEqual(['b']);
});

test('order is unchanged when an old id is re-activated', () => {
  const used = new Map([
    ['a', 1],
    ['b', 2],
  ]);
  expect(nextWarmIds(['a', 'b'], 'a', live('a', 'b'), used, 3, 5)).toEqual(['a', 'b']);
  expect(used.get('a')).toBe(3);
});

test('returns prev itself when nothing changed', () => {
  const prev = ['a', 'b'];
  const used = new Map([
    ['a', 1],
    ['b', 2],
  ]);
  expect(nextWarmIds(prev, 'b', live('a', 'b'), used, 3, 5)).toBe(prev);
  expect(nextWarmIds(prev, null, live('a', 'b'), used, 4, 5)).toBe(prev);
});
