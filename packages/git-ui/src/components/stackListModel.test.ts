import { describe, expect, test } from 'bun:test';
import type { StackBranch, StackListResult, StackSummary } from '@kira/git-ipc';
import {
  aheadText,
  buildOrphanRows,
  buildStackRows,
  childOf,
  parentOf,
  prBadgeLabel,
  rowNeedsForcePush,
  staleChipText,
} from './stackListModel.ts';

function branch(overrides: Partial<StackBranch> & { name: string; parent: string }): StackBranch {
  return {
    depth: 0,
    tip: 't',
    parentTip: 'p',
    recordedBase: 'p',
    behind: 0,
    ahead: 1,
    state: 'upToDate',
    checkedOutIn: undefined,
    track: undefined,
    isHead: false,
    ...overrides,
  };
}

describe('buildStackRows — chain indenting', () => {
  test('a linear chain carries depth straight through, in order', () => {
    const summary: StackSummary = {
      base: 'main',
      baseTip: 'm',
      needsRestack: false,
      branches: [
        branch({ name: 'feat1', parent: 'main', depth: 0 }),
        branch({ name: 'feat2', parent: 'feat1', depth: 1 }),
        branch({ name: 'feat3', parent: 'feat2', depth: 2 }),
      ],
    };
    const rows = buildStackRows(summary, new Map());
    expect(rows.map((r) => [r.name, r.depth])).toEqual([
      ['feat1', 0],
      ['feat2', 1],
      ['feat3', 2],
    ]);
  });
});

describe('buildStackRows — fork indenting', () => {
  test('two children of the same parent share a depth, order preserved', () => {
    const summary: StackSummary = {
      base: 'main',
      baseTip: 'm',
      needsRestack: false,
      branches: [
        branch({ name: 'feat1', parent: 'main', depth: 0 }),
        branch({ name: 'feat2a', parent: 'feat1', depth: 1 }),
        branch({ name: 'feat2b', parent: 'feat1', depth: 1 }),
      ],
    };
    const rows = buildStackRows(summary, new Map());
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1]);
    expect(rows.map((r) => r.name)).toEqual(['feat1', 'feat2a', 'feat2b']);
  });
});

describe('staleChipText / aheadText', () => {
  test('singular vs plural, and undefined when not stale', () => {
    expect(
      staleChipText(branch({ name: 'a', parent: 'b', state: 'needsRestack', behind: 1 })),
    ).toBe('1 commit behind');
    expect(
      staleChipText(branch({ name: 'a', parent: 'b', state: 'needsRestack', behind: 3 })),
    ).toBe('3 commits behind');
    expect(staleChipText(branch({ name: 'a', parent: 'b', state: 'upToDate' }))).toBeUndefined();
  });

  test('aheadText is singular/plural over the branch’s own commit count', () => {
    expect(aheadText(branch({ name: 'a', parent: 'b', ahead: 1 }))).toBe('1 commit');
    expect(aheadText(branch({ name: 'a', parent: 'b', ahead: 4 }))).toBe('4 commits');
  });
});

describe('buildOrphanRows — the orphans section', () => {
  test('a dangling parent names the remedy', () => {
    const rows = buildOrphanRows(
      [branch({ name: 'orphan1', parent: 'gone', state: 'parentMissing' })],
      new Map(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.isOrphan).toBe(true);
    expect(rows[0]?.depth).toBe(0);
    expect(rows[0]?.orphanReason).toBe('parent "gone" no longer exists');
  });

  test('a cycle member (empty recorded parent from the orphan builder) gets its own reason', () => {
    const rows = buildOrphanRows(
      [branch({ name: 'a', parent: '', state: 'parentMissing' })],
      new Map(),
    );
    expect(rows[0]?.orphanReason).toBe('this branch sits in a cycle');
  });
});

describe('prBadgeLabel', () => {
  test('undefined with no PR, "#N" with one', () => {
    expect(prBadgeLabel(undefined)).toBeUndefined();
    expect(
      prBadgeLabel({
        number: 42,
        title: 't',
        url: 'u',
        state: 'open',
        headRef: 'feat1',
        headSha: 's',
        baseRef: 'main',
        updatedAt: 0,
      }),
    ).toBe('#42');
  });
});

describe('rowNeedsForcePush', () => {
  const preflight = {
    base: 'main',
    plan: [],
    blockers: [],
    verdict: 'clean' as const,
    restoresHead: 'feat2',
    needsForcePush: ['feat2'],
    routes: [],
  };
  test('true only for a listed branch, false with no preflight at all', () => {
    expect(rowNeedsForcePush(preflight, 'feat2')).toBe(true);
    expect(rowNeedsForcePush(preflight, 'feat1')).toBe(false);
    expect(rowNeedsForcePush(undefined, 'feat2')).toBe(false);
  });
});

describe('parentOf / childOf — navigation', () => {
  function twoLevelResult(): StackListResult {
    return {
      stacks: [
        {
          base: 'main',
          baseTip: 'm',
          needsRestack: false,
          branches: [
            branch({ name: 'feat1', parent: 'main', depth: 0 }),
            branch({ name: 'feat2', parent: 'feat1', depth: 1 }),
          ],
        },
      ],
      orphans: [branch({ name: 'orphaned', parent: 'gone', state: 'parentMissing' })],
    };
  }

  test('parentOf walks the recorded parent for a stack member', () => {
    const result = twoLevelResult();
    expect(parentOf(result, 'feat2')).toBe('feat1');
    expect(parentOf(result, 'feat1')).toBe('main');
  });

  test('childOf finds the first (sorted-name) child', () => {
    const result = twoLevelResult();
    expect(childOf(result, 'feat1')).toBe('feat2');
  });

  // "Wrap-around at the ends": this implementation's chosen behaviour (no cyclic wrap) is that
  // navigation simply STOPS at either end — going up from a root returns the base name itself
  // (still a real, navigable ref), and going up from there, or down from a leaf, answers
  // undefined rather than looping back to the opposite end of the stack.
  test('parentOf at the very top of a walk (the base itself) answers undefined — the base is not a stack member', () => {
    const result = twoLevelResult();
    expect(parentOf(result, 'main')).toBeUndefined();
  });

  test('childOf at a leaf answers undefined, never wrapping back to the root', () => {
    const result = twoLevelResult();
    expect(childOf(result, 'feat2')).toBeUndefined();
  });

  test('an orphan with a dangling (non-empty) parent still reports it', () => {
    const result = twoLevelResult();
    expect(parentOf(result, 'orphaned')).toBe('gone');
  });

  test('a branch not in any stack or orphan list answers undefined for both', () => {
    const result = twoLevelResult();
    expect(parentOf(result, 'unrelated')).toBeUndefined();
    expect(childOf(result, 'unrelated')).toBeUndefined();
  });
});
