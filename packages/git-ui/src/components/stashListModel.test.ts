import { describe, expect, test } from 'bun:test';
import type { StashEntry } from '@kira/git-ipc';
import {
  applyMenuLabel,
  globalRowModel,
  isAutoStash,
  originLabel,
  stashLabel,
} from './stashListModel.ts';

function fixture(overrides: Partial<StashEntry> = {}): StashEntry {
  return {
    index: 0,
    sha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    baseSubject: 'base subject',
    indexSha: 'c'.repeat(40),
    untrackedSha: undefined,
    message: 'On main: my label',
    branch: 'main',
    timestamp: 1700000000,
    fileCount: 1,
    includedUntracked: false,
    scope: 'stack',
    ref: '',
    ...overrides,
  };
}

describe('stashLabel', () => {
  test('strips the "On <b>: " prefix', () => {
    expect(stashLabel(fixture({ message: 'On main: my label' }))).toBe('my label');
  });

  test('strips the "WIP on <b>: " prefix', () => {
    expect(stashLabel(fixture({ message: 'WIP on main: abc1234 subject' }))).toBe(
      'abc1234 subject',
    );
  });

  test('a label containing ": " round-trips whole', () => {
    expect(stashLabel(fixture({ message: 'On main: note: fix the thing' }))).toBe(
      'note: fix the thing',
    );
  });

  test('a message with neither prefix passes through unchanged (a stash-store-restored entry)', () => {
    expect(stashLabel(fixture({ message: 'custom restore message, no WIP/On prefix' }))).toBe(
      'custom restore message, no WIP/On prefix',
    );
  });

  test('a detached-HEAD stash strips "On (no branch): " too', () => {
    expect(stashLabel(fixture({ message: 'On (no branch): detached test', branch: null }))).toBe(
      'detached test',
    );
  });
});

describe('isAutoStash', () => {
  test('true for an auto-stash entry', () => {
    expect(isAutoStash(fixture({ message: 'On main: auto-stash: switching to feature' }))).toBe(
      true,
    );
  });

  test('false for an ordinary manual stash', () => {
    expect(isAutoStash(fixture({ message: 'On main: my label' }))).toBe(false);
  });
});

describe('originLabel', () => {
  test('undefined when the entry origin is the current branch', () => {
    expect(originLabel(fixture({ branch: 'main' }), 'main')).toBeUndefined();
  });

  test('set when the entry origin differs from the current branch', () => {
    expect(originLabel(fixture({ branch: 'main' }), 'feature')).toBe('main');
  });

  test('undefined for a detached-HEAD stash (no origin branch at all)', () => {
    expect(originLabel(fixture({ branch: null }), 'feature')).toBeUndefined();
  });

  test('set when currentBranch is detached (null) and the entry has a real origin', () => {
    expect(originLabel(fixture({ branch: 'main' }), null)).toBe('main');
  });
});

describe('applyMenuLabel', () => {
  test('"Apply" for a same-branch entry', () => {
    expect(applyMenuLabel(fixture({ branch: 'main' }), 'main')).toBe('Apply');
  });

  test('"Apply here (from <origin>)" for a cross-branch entry', () => {
    expect(applyMenuLabel(fixture({ branch: 'main' }), 'feature')).toBe('Apply here (from main)');
  });
});

describe('globalRowModel', () => {
  test('combines label/auto/origin for a global entry', () => {
    const entry = fixture({
      scope: 'global',
      ref: `refs/kira/globalstash/${'a'.repeat(40)}`,
      message: 'On feature: keep this WIP',
      branch: 'feature',
    });
    expect(globalRowModel(entry)).toEqual({
      label: 'keep this WIP',
      auto: false,
      origin: 'feature',
    });
  });

  test('origin is undefined for a detached-HEAD global entry', () => {
    const entry = fixture({ scope: 'global', message: 'On (no branch): x', branch: null });
    expect(globalRowModel(entry).origin).toBeUndefined();
  });
});
