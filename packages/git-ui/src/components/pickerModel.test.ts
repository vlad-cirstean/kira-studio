import { describe, expect, test } from 'bun:test';
import type { RefRow, StackBranch, StashEntry, WorktreeEntry } from '@kira/git-ipc';
import { buildPickerModel, type PickerInput } from './pickerModel.ts';

function ref(overrides: Partial<RefRow> & { shortName: string }): RefRow {
  return {
    refname: `refs/heads/${overrides.shortName}`,
    kind: 'branch',
    objectId: 'a'.repeat(40),
    peeledObjectId: undefined,
    upstream: undefined,
    track: undefined,
    committerDate: 0,
    isHead: false,
    checkedOutIn: undefined,
    annotation: undefined,
    ...overrides,
  };
}

function stash(overrides: Partial<StashEntry> & { sha: string }): StashEntry {
  return {
    index: 0,
    baseSha: 'b'.repeat(40),
    baseSubject: 'base subject',
    indexSha: 'c'.repeat(40),
    untrackedSha: undefined,
    message: 'On main: my label',
    branch: 'main',
    timestamp: 0,
    fileCount: 1,
    includedUntracked: false,
    scope: 'stack',
    ref: '',
    ...overrides,
  };
}

function worktree(overrides: Partial<WorktreeEntry> & { path: string }): WorktreeEntry {
  return {
    head: 'a'.repeat(40),
    branch: null,
    isBare: false,
    isDetached: false,
    isMain: false,
    isCurrent: false,
    locked: null,
    prunable: null,
    openElsewhere: false,
    ...overrides,
  };
}

function stackBranch(overrides: Partial<StackBranch> & { name: string }): StackBranch {
  return {
    parent: 'main',
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

function emptyInput(overrides: Partial<PickerInput> = {}): PickerInput {
  return {
    branches: [],
    remoteBranches: [],
    tags: [],
    stashes: [],
    globalStashes: [],
    worktrees: [],
    stacks: [],
    orphans: [],
    ...overrides,
  };
}

describe('buildPickerModel — Branches tab pin/order/cap', () => {
  test('1: HEAD sorts first regardless of name or committerDate', () => {
    const input = emptyInput({
      branches: [
        ref({ shortName: 'zzz-newest', committerDate: 100 }),
        ref({ shortName: 'aaa-head', isHead: true, committerDate: 1 }),
      ],
    });
    const model = buildPickerModel(input, '', 'branches', {});
    expect(model.branchesLocal.visible[0]?.shortName).toBe('aaa-head');
  });

  test('2: a checkedOutIn branch sorts after HEAD and before every unpinned row', () => {
    const input = emptyInput({
      branches: [
        ref({ shortName: 'unpinned', committerDate: 999 }),
        ref({ shortName: 'elsewhere', checkedOutIn: '/other/worktree' }),
        ref({ shortName: 'head', isHead: true }),
      ],
    });
    const model = buildPickerModel(input, '', 'branches', {});
    expect(model.branchesLocal.visible.map((r) => r.shortName)).toEqual([
      'head',
      'elsewhere',
      'unpinned',
    ]);
  });

  test('3: HEAD survives a cap of 1 against 60 branches, exactly once', () => {
    const branches = Array.from({ length: 59 }, (_, i) =>
      ref({ shortName: `b${i}`, committerDate: i }),
    );
    branches.push(ref({ shortName: 'head', isHead: true }));
    const input = emptyInput({ branches });
    const model = buildPickerModel(input, '', 'branches', { branchesLocal: 1 });
    expect(model.branchesLocal.visible.length).toBe(1);
    expect(model.branchesLocal.visible[0]?.shortName).toBe('head');
    expect(model.branchesLocal.hiddenCount).toBe(59);
  });

  test('4: a filter excluding HEAD does not pin it back in', () => {
    const input = emptyInput({
      branches: [ref({ shortName: 'main', isHead: true }), ref({ shortName: 'feature-x' })],
    });
    const model = buildPickerModel(input, 'feat', 'branches', {});
    expect(model.branchesLocal.visible.map((r) => r.shortName)).toEqual(['feature-x']);
  });

  test('5: local branches order by committerDate descending, ties by name', () => {
    const input = emptyInput({
      branches: [
        ref({ shortName: 'old', committerDate: 1 }),
        ref({ shortName: 'b-tie', committerDate: 5 }),
        ref({ shortName: 'a-tie', committerDate: 5 }),
      ],
    });
    const model = buildPickerModel(input, '', 'branches', {});
    expect(model.branchesLocal.visible.map((r) => r.shortName)).toEqual(['a-tie', 'b-tie', 'old']);
  });
});

describe('buildPickerModel — Tags/Stashes keep their own order', () => {
  test('6: tags keep naturalCompare (v9 before v10), never reordered by recency', () => {
    const input = emptyInput({
      tags: [
        ref({ shortName: 'v10', kind: 'tag', committerDate: 1 }),
        ref({ shortName: 'v9', kind: 'tag', committerDate: 999 }),
      ],
    });
    const model = buildPickerModel(input, '', 'tags', {});
    expect(model.tags.visible.map((r) => r.shortName)).toEqual(['v9', 'v10']);
  });

  test('7: the stash stack keeps index order; the global bucket orders by timestamp descending', () => {
    const input = emptyInput({
      stashes: [
        stash({ sha: 's2', index: 2, timestamp: 1 }),
        stash({ sha: 's0', index: 0, timestamp: 999 }),
        stash({ sha: 's1', index: 1, timestamp: 500 }),
      ],
      globalStashes: [
        stash({ sha: 'g-old', timestamp: 1 }),
        stash({ sha: 'g-new', timestamp: 100 }),
      ],
    });
    const model = buildPickerModel(input, '', 'stashes', {});
    expect(model.stashStack.visible.map((e) => e.sha)).toEqual(['s0', 's1', 's2']);
    expect(model.stashGlobal.visible.map((e) => e.sha)).toEqual(['g-new', 'g-old']);
  });
});

describe('buildPickerModel — Worktrees ordering', () => {
  test('8: worktrees order current, then main, then path', () => {
    const input = emptyInput({
      worktrees: [
        worktree({ path: '/z', isMain: false }),
        worktree({ path: '/a', isMain: true }),
        worktree({ path: '/current', isCurrent: true }),
        worktree({ path: '/b' }),
      ],
    });
    const model = buildPickerModel(input, '', 'worktrees', {});
    expect(model.worktrees.visible.map((w) => w.path)).toEqual(['/current', '/a', '/b', '/z']);
  });
});

describe('buildPickerModel — filter scope per tab', () => {
  test('9: stash filtering matches stashLabel (WIP framing stripped) and the origin branch, not the raw message', () => {
    const input = emptyInput({
      stashes: [
        stash({ sha: 'match-label', message: 'WIP on main: auth refactor' }),
        stash({ sha: 'match-branch', message: 'On other: unrelated', branch: 'auth-fix' }),
        stash({ sha: 'no-match', message: 'On main: something else', branch: 'main' }),
      ],
    });
    const model = buildPickerModel(input, 'auth', 'stashes', {});
    expect(model.stashStack.visible.map((e) => e.sha).sort()).toEqual([
      'match-branch',
      'match-label',
    ]);
  });

  test('10: worktree filtering matches both the label and the path', () => {
    const input = emptyInput({
      worktrees: [
        worktree({ path: '/repo/main', branch: 'refs/heads/main' }),
        worktree({ path: '/repo/feature-auth', branch: 'refs/heads/other' }),
        worktree({ path: '/unrelated', branch: 'refs/heads/nope' }),
      ],
    });
    const model = buildPickerModel(input, 'auth', 'worktrees', {});
    expect(model.worktrees.visible.map((w) => w.path)).toEqual(['/repo/feature-auth']);
  });

  test('11: stack filtering matches a branch name and its stack’s base', () => {
    const input = emptyInput({
      stacks: [
        {
          base: 'auth-base',
          baseTip: 't',
          needsRestack: false,
          branches: [stackBranch({ name: 'unrelated-name' })],
        },
        {
          base: 'main',
          baseTip: 't',
          needsRestack: false,
          branches: [stackBranch({ name: 'auth-feature' }), stackBranch({ name: 'other' })],
        },
      ],
    });
    const model = buildPickerModel(input, 'auth', 'stacks', {});
    expect(model.stacks.visible.map((g) => g.summary.base)).toEqual(['auth-base', 'main']);
    expect(model.stacks.visible[0]?.branches.map((b) => b.name)).toEqual(['unrelated-name']);
    expect(model.stacks.visible[1]?.branches.map((b) => b.name)).toEqual(['auth-feature']);
  });
});

describe('buildPickerModel — counts', () => {
  test('12: counts equal totals with an empty query, and per-tab match counts with a live one', () => {
    const input = emptyInput({
      branches: [ref({ shortName: 'main' }), ref({ shortName: 'auth-work' })],
      tags: [ref({ shortName: 'v1', kind: 'tag' })],
    });
    const empty = buildPickerModel(input, '', 'branches', {});
    expect(empty.counts.branches).toBe(2);
    expect(empty.counts.tags).toBe(1);

    const filtered = buildPickerModel(input, 'auth', 'branches', {});
    expect(filtered.counts.branches).toBe(1);
    expect(filtered.counts.tags).toBe(0);
  });

  test('13: counts are computed for all five tabs while only the active tab materialises rows', () => {
    const input = emptyInput({
      branches: [ref({ shortName: 'main' })],
      tags: [ref({ shortName: 'v1', kind: 'tag' })],
      stashes: [stash({ sha: 's0' })],
      worktrees: [worktree({ path: '/repo' })],
      stacks: [
        { base: 'main', baseTip: 't', needsRestack: false, branches: [stackBranch({ name: 'a' })] },
      ],
    });
    const model = buildPickerModel(input, '', 'branches', {});
    expect(model.counts).toEqual({ branches: 1, tags: 1, stashes: 1, worktrees: 1, stacks: 1 });
    expect(model.tags.visible.length).toBe(0);
    expect(model.stashStack.visible.length).toBe(0);
    expect(model.worktrees.visible.length).toBe(0);
    expect(model.stacks.visible.length).toBe(0);
  });
});

describe('buildPickerModel — stepped cap', () => {
  test('14: a cap step raises exactly one list’s cap and leaves the others’ hiddenCount alone', () => {
    const input = emptyInput({
      branches: Array.from({ length: 5 }, (_, i) => ref({ shortName: `b${i}` })),
      remoteBranches: Array.from({ length: 5 }, (_, i) =>
        ref({ shortName: `r${i}`, kind: 'remoteBranch' }),
      ),
    });
    const base = buildPickerModel(input, '', 'branches', { branchesLocal: 2, branchesRemote: 2 });
    expect(base.branchesLocal.hiddenCount).toBe(3);
    expect(base.branchesRemote.hiddenCount).toBe(3);

    const stepped = buildPickerModel(input, '', 'branches', {
      branchesLocal: 4,
      branchesRemote: 2,
    });
    expect(stepped.branchesLocal.hiddenCount).toBe(1);
    expect(stepped.branchesRemote.hiddenCount).toBe(3);
  });
});

describe('buildPickerModel — rowIds', () => {
  test('15: rowIds are unique and in DOM order for each tab, including both sub-groups', () => {
    const input = emptyInput({
      branches: [ref({ shortName: 'main', isHead: true })],
      remoteBranches: [ref({ shortName: 'origin/main', kind: 'remoteBranch' })],
      stashes: [stash({ sha: 'stack-sha' })],
      globalStashes: [stash({ sha: 'global-sha' })],
      stacks: [
        {
          base: 'main',
          baseTip: 't',
          needsRestack: false,
          branches: [stackBranch({ name: 'stacked' })],
        },
      ],
      orphans: [stackBranch({ name: 'orphaned', parent: 'gone' })],
    });

    const branchesModel = buildPickerModel(input, '', 'branches', {});
    expect(branchesModel.rowIds.map((r) => r.id)).toEqual([
      'branch:refs/heads/main',
      'remote:refs/heads/origin/main',
    ]);

    const stashesModel = buildPickerModel(input, '', 'stashes', {});
    expect(stashesModel.rowIds.map((r) => r.id)).toEqual(['stash:stack-sha', 'global:global-sha']);

    const stacksModel = buildPickerModel(input, '', 'stacks', {});
    expect(stacksModel.rowIds.map((r) => r.id)).toEqual(['stack:stacked', 'orphan:orphaned']);

    for (const model of [branchesModel, stashesModel, stacksModel]) {
      const ids = model.rowIds.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
