import { describe, expect, test } from 'bun:test';
import { createPendingFocus, createTypeahead, type NavRow, navigate } from './listNavigation';

const flat = (...disabled: boolean[]): NavRow[] =>
  disabled.map((d, i) => ({ key: `r${i}`, disabled: d }));

describe('navigate: flat list', () => {
  test('Up/Down skip disabled rows and stop at the ends without wrapping', () => {
    const rows = flat(true, false, true, false, true);
    expect(navigate(rows, 1, 'ArrowDown', false)).toEqual({ kind: 'move', index: 3 });
    expect(navigate(rows, 3, 'ArrowDown', false)).toEqual({ kind: 'none' });
    expect(navigate(rows, 3, 'ArrowUp', false)).toEqual({ kind: 'move', index: 1 });
    expect(navigate(rows, 1, 'ArrowUp', false)).toEqual({ kind: 'none' });
  });

  test('Home/End land on the first/last enabled row; no-op when already there', () => {
    const rows = flat(true, false, false, true);
    expect(navigate(rows, 2, 'Home', false)).toEqual({ kind: 'move', index: 1 });
    expect(navigate(rows, 1, 'Home', false)).toEqual({ kind: 'none' });
    expect(navigate(rows, 1, 'End', false)).toEqual({ kind: 'move', index: 2 });
    expect(navigate(rows, 2, 'End', false)).toEqual({ kind: 'none' });
  });

  test('no active row: Down and Up both enter at the first enabled row', () => {
    const rows = flat(true, false, false);
    expect(navigate(rows, -1, 'ArrowDown', false)).toEqual({ kind: 'move', index: 1 });
    expect(navigate(rows, -1, 'ArrowUp', false)).toEqual({ kind: 'move', index: 1 });
  });

  test('empty list and all-disabled list never move', () => {
    expect(navigate([], -1, 'ArrowDown', false)).toEqual({ kind: 'none' });
    expect(navigate(flat(true, true), -1, 'End', false)).toEqual({ kind: 'none' });
  });

  test('Left/Right do nothing outside a tree', () => {
    expect(navigate(flat(false, false), 0, 'ArrowRight', false)).toEqual({ kind: 'none' });
  });
});

describe('navigate: tree', () => {
  const tree: NavRow[] = [
    { key: 'a', depth: 0, hasChildren: true, expanded: true },
    { key: 'a1', depth: 1, hasChildren: false },
    { key: 'a2', depth: 1, hasChildren: true, expanded: false },
    { key: 'b', depth: 0, hasChildren: true, expanded: false },
  ];

  test('Right expands a collapsed node, enters the first child of an expanded one', () => {
    expect(navigate(tree, 2, 'ArrowRight', true)).toEqual({ kind: 'expand', index: 2 });
    expect(navigate(tree, 0, 'ArrowRight', true)).toEqual({ kind: 'move', index: 1 });
  });

  test('Right on a leaf does nothing', () => {
    expect(navigate(tree, 1, 'ArrowRight', true)).toEqual({ kind: 'none' });
  });

  test('Right on an expanded node whose next row is not deeper does nothing', () => {
    const rows: NavRow[] = [
      { key: 'a', depth: 0, hasChildren: true, expanded: true },
      { key: 'b', depth: 0 },
    ];
    expect(navigate(rows, 0, 'ArrowRight', true)).toEqual({ kind: 'none' });
  });

  test('Left collapses an expanded node, else goes to the nearest shallower row', () => {
    expect(navigate(tree, 0, 'ArrowLeft', true)).toEqual({ kind: 'collapse', index: 0 });
    expect(navigate(tree, 2, 'ArrowLeft', true)).toEqual({ kind: 'move', index: 0 });
    expect(navigate(tree, 1, 'ArrowLeft', true)).toEqual({ kind: 'move', index: 0 });
  });

  test('Left on a collapsed root does nothing; a disabled parent is not entered', () => {
    expect(navigate(tree, 3, 'ArrowLeft', true)).toEqual({ kind: 'none' });
    const rows = tree.map((r) => (r.key === 'a' ? { ...r, disabled: true } : r));
    expect(navigate(rows, 1, 'ArrowLeft', true)).toEqual({ kind: 'none' });
  });
});

describe('createTypeahead', () => {
  const rows = ['Alpha', 'Apple', 'Banana', 'Avocado', null];

  test('one letter cycles through matches from the active row and wraps', () => {
    let t = 0;
    const ta = createTypeahead(() => t, 500);
    expect(ta.press('a', rows, -1)).toBe(0);
    t += 600;
    expect(ta.press('a', rows, 0)).toBe(1);
    t += 600;
    expect(ta.press('a', rows, 3)).toBe(0);
  });

  test('repeating the same letter within the window keeps cycling', () => {
    let t = 0;
    const ta = createTypeahead(() => t, 500);
    expect(ta.press('a', rows, -1)).toBe(0);
    t += 100;
    expect(ta.press('a', rows, 0)).toBe(1);
    t += 100;
    expect(ta.press('a', rows, 1)).toBe(3);
  });

  test('a multi-letter buffer matches the prefix, starting at the active row', () => {
    let t = 0;
    const ta = createTypeahead(() => t, 500);
    expect(ta.press('a', rows, -1)).toBe(0);
    t += 100;
    expect(ta.press('v', rows, 0)).toBe(3);
  });

  test('the buffer resets after the timeout', () => {
    let t = 0;
    const ta = createTypeahead(() => t, 500);
    ta.press('b', rows, -1);
    t += 501;
    expect(ta.press('a', rows, 2)).toBe(3);
  });

  test('no match returns -1; null rows (disabled) never match; reset clears the buffer', () => {
    let t = 0;
    const ta = createTypeahead(() => t, 500);
    expect(ta.press('z', rows, 0)).toBe(-1);
    t += 100;
    ta.reset();
    expect(ta.press('b', rows, 0)).toBe(2);
    expect(createTypeahead().press('a', [null, null], 0)).toBe(-1);
  });
});

describe('createPendingFocus', () => {
  test('lands at once when the row exists', () => {
    const pf = createPendingFocus(() => true);
    pf.request('x');
    expect(pf.pending).toBeNull();
  });

  test('waits for the row, retries on flush, then clears', () => {
    const present = new Set<string>();
    const focused: string[] = [];
    const pf = createPendingFocus((k) => {
      if (!present.has(k)) return false;
      focused.push(k);
      return true;
    });
    pf.request('x');
    expect(pf.pending).toBe('x');
    pf.flush();
    expect(focused).toEqual([]);
    present.add('x');
    pf.flush();
    expect(focused).toEqual(['x']);
    pf.flush();
    expect(focused).toEqual(['x']);
  });

  test('a newer request replaces an unmet older one', () => {
    const present = new Set(['y']);
    const focused: string[] = [];
    const pf = createPendingFocus((k) => {
      if (!present.has(k)) return false;
      focused.push(k);
      return true;
    });
    pf.request('x');
    pf.request('y');
    present.add('x');
    pf.flush();
    expect(focused).toEqual(['y']);
  });
});
