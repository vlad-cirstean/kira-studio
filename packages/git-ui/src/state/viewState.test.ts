import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_COLUMN_WIDTHS,
  InMemoryViewStateStore,
  type PersistedViewState,
  parsePersistedViewState,
} from './viewState.ts';

/** A v5-shaped blob, matching `PersistedViewState`'s current fields exactly (no `sha` in
 *  `columnWidths`). */
function v5Blob(overrides: Partial<PersistedViewState> = {}): PersistedViewState {
  return {
    version: 5,
    repoId: 'repo-1',
    loadedRows: 40,
    detailOpen: true,
    scrollRow: 3,
    selectedSha: 'abc1234',
    columnWidths: DEFAULT_COLUMN_WIDTHS,
    dateFormat: 'relative',
    detailWidth: 380,
    fileListMode: 'tree',
    searchCaseSensitive: false,
    searchWholeWord: false,
    searchRegex: false,
    searchScope: 'both',
    ...overrides,
  };
}

/** A v4 blob (G19's own shape, `columnWidths.sha` present) — what every profile that ever opened
 *  the graph panel before this phase still has in its own persisted storage. */
function v4Blob(): Record<string, unknown> {
  return {
    version: 4,
    repoId: 'repo-1',
    loadedRows: 40,
    detailOpen: true,
    scrollRow: 3,
    selectedSha: 'abc1234',
    columnWidths: { author: 140, date: 120, sha: 80 }, // G19's own pre-fix default, still in it
    dateFormat: 'relative',
    detailWidth: 380,
    fileListMode: 'tree',
    searchCaseSensitive: false,
    searchWholeWord: false,
    searchRegex: false,
    searchScope: 'both',
  };
}

describe('parsePersistedViewState — G21 D5/D6a version 4 -> 5', () => {
  test('a v5 blob without columnWidths.sha round-trips exactly', () => {
    const blob = v5Blob();
    expect(parsePersistedViewState(blob)).toEqual(blob);
  });

  test('a v4 blob (with columnWidths.sha) is rejected whole, not partially applied', () => {
    // D5/D6a's whole point: a v4 blob is what every profile that used the app before this phase
    // still has. It must be discarded entirely — parsePersistedViewState's own documented policy
    // — which is what finally delivers G19's date-width fix to the users who reported it twice
    // (F6). A partial parse that kept, say, columnWidths would leave the too-narrow pre-G19
    // default (120) in place forever.
    expect(parsePersistedViewState(v4Blob())).toBeNull();
  });

  test('a v5 blob whose columnWidths carries a stray sha field is still accepted (extra fields are not checked)', () => {
    // isColumnWidthsShape only requires author/date to be numbers — an extra field neither
    // breaks nor is specially handled, matching every other "shape" check in this file.
    const blob = v5Blob({ columnWidths: { author: 140, date: 152, sha: 80 } as never });
    expect(parsePersistedViewState(blob)).not.toBeNull();
  });

  test('missing columnWidths.date (v4-style incompleteness in a v5-labelled blob) is rejected', () => {
    const blob = { ...v5Blob(), columnWidths: { author: 140 } };
    expect(parsePersistedViewState(blob)).toBeNull();
  });

  test('InMemoryViewStateStore round-trips a real v5 write through read()', () => {
    const store = new InMemoryViewStateStore();
    const blob = v5Blob({ scrollRow: 7 });
    store.write(blob);
    expect(store.read()).toEqual(blob);
  });

  test('InMemoryViewStateStore.setRaw with a v4 blob reads back null, exactly like real platform storage would', () => {
    const store = new InMemoryViewStateStore();
    store.setRaw(v4Blob());
    expect(store.read()).toBeNull();
  });
});

describe('DEFAULT_COLUMN_WIDTHS — G21 D5', () => {
  test('has no sha field — the SHA column is gone', () => {
    expect(Object.keys(DEFAULT_COLUMN_WIDTHS).sort()).toEqual(['author', 'date']);
  });
});
