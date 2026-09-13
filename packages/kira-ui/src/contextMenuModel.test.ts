import { describe, expect, test } from 'bun:test';
import {
  enabledNeighbour,
  firstEnabled,
  flattenItems,
  type MenuSection,
} from './contextMenuModel.ts';

function item(id: string, disabled = false) {
  return { id, label: id, disabled, disabledReason: disabled ? 'nope' : undefined };
}

const sections: MenuSection[] = [
  { items: [item('a'), item('b', true), item('c')] },
  { items: [item('d'), item('e')] },
];

describe('flattenItems', () => {
  test('flattens every section into one list, preserving order', () => {
    expect(flattenItems(sections).map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('firstEnabled', () => {
  test('is the first item whose disabled flag is false', () => {
    expect(firstEnabled(flattenItems(sections))).toBe('a');
  });

  test('is undefined when every item is disabled', () => {
    expect(firstEnabled([item('x', true), item('y', true)])).toBeUndefined();
  });
});

describe('enabledNeighbour', () => {
  const flat = flattenItems(sections);

  test('ArrowDown from undefined lands on the first enabled item', () => {
    expect(enabledNeighbour(flat, undefined, 1)).toBe('a');
  });

  test('ArrowUp from undefined steps via the same formula RowContextMenu.vue already used, ported verbatim', () => {
    expect(enabledNeighbour(flat, undefined, -1)).toBe('d');
  });

  test('ArrowDown skips a disabled neighbour', () => {
    expect(enabledNeighbour(flat, 'a', 1)).toBe('c');
  });

  test('ArrowUp skips a disabled neighbour', () => {
    expect(enabledNeighbour(flat, 'c', -1)).toBe('a');
  });

  test('ArrowDown wraps past the end back to the first enabled item', () => {
    expect(enabledNeighbour(flat, 'e', 1)).toBe('a');
  });

  test('ArrowUp wraps past the start back to the last enabled item', () => {
    expect(enabledNeighbour(flat, 'a', -1)).toBe('e');
  });

  test('returns undefined when no item is enabled', () => {
    const allDisabled: MenuSection[] = [{ items: [item('x', true), item('y', true)] }];
    expect(enabledNeighbour(flattenItems(allDisabled), undefined, 1)).toBeUndefined();
  });

  test('an empty menu returns undefined', () => {
    expect(enabledNeighbour([], undefined, 1)).toBeUndefined();
  });
});
