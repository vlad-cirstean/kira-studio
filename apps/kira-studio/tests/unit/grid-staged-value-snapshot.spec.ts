// P21 round 3 performance finding 10: SlickGridHost.vue's own header states the rule ("Vue must
// not see the grid" — the cell extractor runs *during* SlickGrid's own synchronous render), but
// createDisplayValueExtractor read pending edits/inserts through pendingFor()/stagedValue() inside
// its per-cell closure — pendingState[tabId] is a reactive proxy, its `edits` a reactive-wrapped
// Map, so every cell paid up to four proxy traps once the user had staged even one edit.
// rawPendingFor snapshots the same underlying object via toRaw, taken once per extractor build
// rather than once per cell (SlickGridHost.vue already rebuilds the extractor on every staging
// change, so the snapshot can never go stale for the render it serves).
//
// pendingChanges.ts transitively reaches bridge/data.ts -> '/wails/runtime.js' at module scope,
// hence the dynamic import after ./support/window's mock.module registration — the same pattern
// row-values-visible-span.spec.ts already uses for the same reason.
import './support/window';

import { describe, expect, test } from 'bun:test';
import { isReactive } from 'vue';
import type { TabularPage } from '../../../../packages/shared/protocol/page';

const { addInsertRow, clearPending, rawPendingFor, stageEdit, stageInsertValue, stageNull } =
  await import('../../frontend/src/views/grid/pendingChanges');
const { createDisplayValueExtractor, pendingRowClasses } = await import(
  '../../frontend/src/views/grid/slick/dataSource'
);

const TAB = 'tab-staged-snapshot';

// createDisplayValueExtractor now resolves each columnOrder entry to a page-column index at build
// time (fieldToPageCol), so it always dereferences page.columns even when every test case here
// only cares about the staged-edit path. An empty-columns fake page makes every `pageColumnIndexFor`
// lookup miss (-1) by construction, which is exactly what "no page value available" means for these
// tests — none of them exercise the real page.ts decode path (cell()).
const NO_PAGE = { columns: [] } as unknown as TabularPage;

describe('rawPendingFor (finding 10)', () => {
  test('returns the same data as pendingFor, unwrapped from reactivity', () => {
    clearPending(TAB);
    stageEdit(TAB, 3, 'name', 'edited');
    const snapshot = rawPendingFor(TAB);
    expect(snapshot).toBeDefined();
    expect(isReactive(snapshot)).toBe(false);
    expect(isReactive(snapshot?.edits)).toBe(false);
    expect(snapshot?.edits.get(3)?.changes.name).toBe('edited');
  });

  test('undefined for a tab with no pending state at all', () => {
    expect(rawPendingFor('never-touched-tab')).toBeUndefined();
  });
});

describe('createDisplayValueExtractor merges staged edits the same way stagedValue() did (finding 10)', () => {
  test('a staged edit wins over the (absent) page value', () => {
    clearPending(TAB);
    stageEdit(TAB, 5, 'email', 'new@example.com');
    const extract = createDisplayValueExtractor(TAB, NO_PAGE, ['email']);
    const view = extract({ row: 5, pos: 5 }, 'email');
    expect(view).toEqual({ text: 'new@example.com', isNull: false, truncated: false });
  });

  test('a staged NULL is distinguished from an empty string', () => {
    clearPending(TAB);
    stageNull(TAB, 7, 'email');
    const extract = createDisplayValueExtractor(TAB, NO_PAGE, ['email']);
    const view = extract({ row: 7, pos: 7 }, 'email');
    expect(view).toEqual({ text: '', isNull: true, truncated: false });
  });

  test('a pending insert row is read from `inserts`, keyed by insertId', () => {
    clearPending(TAB);
    const insertId = addInsertRow(TAB, ['name']);
    stageInsertValue(TAB, insertId, 'name', 'brand new row');
    const extract = createDisplayValueExtractor(TAB, NO_PAGE, ['name']);
    const view = extract({ row: 100, pos: 100, insertId }, 'name');
    expect(view).toEqual({ text: 'brand new row', isNull: false, truncated: false });
  });

  test('no staged edit and no page falls through to the empty/null placeholder', () => {
    clearPending(TAB);
    const extract = createDisplayValueExtractor(TAB, NO_PAGE, ['email']);
    const view = extract({ row: 9, pos: 9 }, 'email');
    expect(view).toEqual({ text: '', isNull: true, truncated: false });
  });

  test('an edit staged after the extractor was built is still visible through it (toRaw unwraps, it does not clone)', () => {
    // rawPendingFor returns `toRaw(pendingState[tabId])` -- the SAME underlying object the
    // reactive proxy wraps, not a copy of it. `edits` is a Map mutated in place (stageEdit calls
    // `.set` on the existing Map), so a later stageEdit is a mutation of the very object this
    // extractor already captured a reference to: it is observed exactly as it would have been
    // through the old pendingFor()/stagedValue() reactive path. The optimisation removes proxy
    // traps, not correctness -- this is the test that would catch a snapshot that accidentally
    // cloned instead of unwrapped.
    clearPending(TAB);
    stageEdit(TAB, 1, 'a', 'first');
    const extract = createDisplayValueExtractor(TAB, NO_PAGE, ['a']);
    expect(extract({ row: 1, pos: 1 }, 'a').text).toBe('first');
    stageEdit(TAB, 1, 'a', 'second');
    expect(extract({ row: 1, pos: 1 }, 'a').text).toBe('second');
  });
});

describe('pendingRowClasses reads the same snapshot mechanism (finding 10)', () => {
  test('a staged edit marks the row dirty', () => {
    clearPending(TAB);
    stageEdit(TAB, 2, 'x', 'y');
    expect(pendingRowClasses(TAB, 2, 1000)).toBe('kira-row-dirty');
  });

  test('an untouched row has no pending class', () => {
    clearPending(TAB);
    expect(pendingRowClasses(TAB, 4, 1000)).toBeUndefined();
  });
});
