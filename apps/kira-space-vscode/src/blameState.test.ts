import { describe, expect, test } from 'bun:test';
import { blameStatusText, selectBlameDisplayState } from './blameState.ts';

// P5: the pure "which state should the status bar show" selector, factored out of blameWidget.ts
// specifically so it's testable under Bun with no vscode module to fake — dirty vs. uncommitted vs.
// resolved vs. nothing.
describe('selectBlameDisplayState', () => {
  test('dirty input always yields the dirty state', () => {
    expect(selectBlameDisplayState({ kind: 'dirty' })).toEqual({ kind: 'dirty' });
  });

  test('none input always yields the none state', () => {
    expect(selectBlameDisplayState({ kind: 'none' })).toEqual({ kind: 'none' });
  });

  test('a result carrying the all-zero sentinel sha yields uncommitted', () => {
    const state = selectBlameDisplayState({
      kind: 'result',
      repoId: 'r1',
      sha: '0000000000000000000000000000000000000000',
      author: 'Not Committed Yet',
      authorTimeSeconds: 0,
      summary: '',
    });
    expect(state).toEqual({ kind: 'uncommitted' });
  });

  test('a result carrying a real sha yields resolved with every field carried through', () => {
    const state = selectBlameDisplayState({
      kind: 'result',
      repoId: 'r1',
      sha: 'abc123',
      author: 'Ada Lovelace',
      authorTimeSeconds: 1700000000,
      summary: 'fix the thing',
    });
    expect(state).toEqual({
      kind: 'resolved',
      repoId: 'r1',
      sha: 'abc123',
      author: 'Ada Lovelace',
      authorTimeSeconds: 1700000000,
      summary: 'fix the thing',
    });
  });
});

describe('blameStatusText', () => {
  test('renders "<author>, <age>"', () => {
    const now = Date.UTC(2024, 5, 15, 12, 0, 0);
    const text = blameStatusText(
      {
        kind: 'resolved',
        repoId: 'r1',
        sha: 'abc123',
        author: 'Ada Lovelace',
        authorTimeSeconds: now / 1000 - 3600,
        summary: 'fix the thing',
      },
      now,
    );
    expect(text).toBe('Ada Lovelace, 1h');
  });
});
