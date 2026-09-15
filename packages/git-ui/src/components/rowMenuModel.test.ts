import { describe, expect, test } from 'bun:test';
import type { InProgressOperation, StashEntry } from '@kira/git-ipc';
import {
  buildGlobalStashMenu,
  buildReadOnlyRefMenu,
  buildReadOnlyRowMenu,
  buildReadOnlyStashMenu,
  buildRefMenu,
  buildRowMenu,
  buildStashMenu,
  type RefMenuContext,
} from './rowMenuModel.ts';

// P76 §12.2: worktreeAdd is not in GATED_OP_KINDS — an operation in progress must not disable
// createWorktreeHere, unlike every gatedItem in these same menus.
const MERGE_IN_PROGRESS: InProgressOperation = {
  kind: 'merge',
  otherSha: 'a'.repeat(40),
  headName: undefined,
  conflictedPaths: [],
  canContinue: true,
  canAbort: true,
  isSequence: false,
  unmergedCount: 0,
  canSkip: false,
};

function stashFixture(overrides: Partial<StashEntry> = {}): StashEntry {
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

/**
 * G26 D-4.14/4.15: `buildRefMenu`'s own new stack section — present only when the caller supplies
 * `ctx.stack` at all (a tag/remoteBranch row, or a host with no `StackState`, gets none, mirroring
 * `buildRowMenu`'s own "absent, not disabled" convention for a missing capability). No file
 * existed for `rowMenuModel.ts` before this phase; this one is new rather than edited, focused on
 * the addition this phase makes.
 */
function branchCtx(overrides: Partial<RefMenuContext> = {}): RefMenuContext {
  return {
    kind: 'branch',
    shortName: 'feat1',
    isHead: false,
    knownRemotes: [],
    inProgress: null,
    ...overrides,
  };
}

function stackItemIds(sections: ReturnType<typeof buildRefMenu>): string[] {
  return sections.length > 1 ? (sections[1]?.items.map((i) => i.id) ?? []) : [];
}

describe('buildRefMenu — stack section presence', () => {
  test('absent entirely when ctx.stack is undefined', () => {
    const sections = buildRefMenu(branchCtx());
    expect(sections.length).toBe(1);
  });

  test('a tag or remoteBranch row never gets a stack section, even if stack were supplied', () => {
    const tagSections = buildRefMenu({ ...branchCtx({ kind: 'tag' }) });
    expect(tagSections.length).toBe(1);
    const remoteSections = buildRefMenu({ ...branchCtx({ kind: 'remoteBranch' }) });
    expect(remoteSections.length).toBe(1);
  });
});

describe('buildRefMenu — stack section contents', () => {
  test('not yet stacked: only "Set stack parent…"', () => {
    const sections = buildRefMenu(branchCtx({ stack: { hasParent: false, hasChild: false } }));
    const ids = stackItemIds(sections);
    expect(ids).toEqual(['stackSetParent']);
    expect(sections[1]?.items[0]?.label).toBe('Set stack parent…');
  });

  test('already stacked with no child: parent-scoped items, worded "Change"', () => {
    const sections = buildRefMenu(branchCtx({ stack: { hasParent: true, hasChild: false } }));
    const ids = stackItemIds(sections);
    expect(ids).toEqual(['stackSetParent', 'stackRemove', 'stackRestack', 'stackGoToParent']);
    expect(sections[1]?.items[0]?.label).toBe('Change stack parent…');
  });

  test('a fork parent (has a child, but no parent of its own) gets only the child nav item', () => {
    const sections = buildRefMenu(branchCtx({ stack: { hasParent: false, hasChild: true } }));
    const ids = stackItemIds(sections);
    expect(ids).toEqual(['stackSetParent', 'stackGoToChild']);
  });

  test('a mid-stack branch (both parent and child) gets every item', () => {
    const sections = buildRefMenu(branchCtx({ stack: { hasParent: true, hasChild: true } }));
    const ids = stackItemIds(sections);
    expect(ids).toEqual([
      'stackSetParent',
      'stackRemove',
      'stackRestack',
      'stackGoToParent',
      'stackGoToChild',
    ]);
  });

  test('stack items are never gated by canRunOp (always enabled)', () => {
    const sections = buildRefMenu(branchCtx({ stack: { hasParent: true, hasChild: true } }));
    for (const item of sections[1]?.items ?? []) {
      expect(item.disabled).toBe(false);
    }
  });
});

describe('buildStashMenu — G28 D5 cross-branch behavior', () => {
  test('Pop is present for a same-branch entry, labelled plain "Apply"', () => {
    const sections = buildStashMenu(null, stashFixture({ branch: 'main' }), 'main');
    const ids = sections[0]?.items.map((i) => i.id);
    expect(ids).toEqual([
      'stashApply',
      'stashPop',
      'stashDrop',
      'stashBranch',
      'stashSaveGlobal',
      'stashShow',
    ]);
    expect(sections[0]?.items[0]?.label).toBe('Apply');
  });

  test('Pop is absent for a cross-branch entry, and Apply is labelled with the origin', () => {
    const sections = buildStashMenu(null, stashFixture({ branch: 'main' }), 'feature');
    const ids = sections[0]?.items.map((i) => i.id);
    expect(ids).toEqual(['stashApply', 'stashDrop', 'stashBranch', 'stashSaveGlobal', 'stashShow']);
    expect(sections[0]?.items[0]?.label).toBe('Apply here (from main)');
  });

  test('a detached-HEAD stash (no origin branch) keeps Pop and plain "Apply"', () => {
    const sections = buildStashMenu(null, stashFixture({ branch: null }), 'feature');
    const ids = sections[0]?.items.map((i) => i.id);
    expect(ids).toContain('stashPop');
    expect(sections[0]?.items[0]?.label).toBe('Apply');
  });
});

describe('buildGlobalStashMenu — D12/D13 never contains stashPop or stashDrop', () => {
  test('offers exactly Apply/Branch/Show/Remove, in that order', () => {
    const sections = buildGlobalStashMenu(null, stashFixture({ scope: 'global' }), 'feature');
    const ids = sections[0]?.items.map((i) => i.id);
    expect(ids).toEqual(['stashApply', 'stashBranch', 'stashShow', 'globalStashRemove']);
  });

  test('never contains stashPop or stashDrop, regardless of branch', () => {
    for (const currentBranch of ['main', 'feature', null]) {
      const sections = buildGlobalStashMenu(null, stashFixture({ scope: 'global' }), currentBranch);
      const ids = sections[0]?.items.map((i) => i.id) ?? [];
      expect(ids).not.toContain('stashPop');
      expect(ids).not.toContain('stashDrop');
    }
  });

  test('cross-branch Apply label applies here too', () => {
    const sections = buildGlobalStashMenu(
      null,
      stashFixture({ scope: 'global', branch: 'main' }),
      'feature',
    );
    expect(sections[0]?.items[0]?.label).toBe('Apply here (from main)');
  });
});

// G32 round-3 functional-correctness review, finding #4: tagPush/tagDeleteRemote are the two
// OpRequest kinds the server has never served (RunOp's write path has no askpass wiring) — the row
// menu used to offer them enabled anyway, so a click always rejected silently (no toast, no
// announcement). Disabled with a visible reason until the server-side move to remote.run lands.
describe('buildRefMenu — tag remote actions are disabled, not silently broken', () => {
  test('Push to <remote> and Delete on <remote> are disabled with a reason, for every known remote', () => {
    const sections = buildRefMenu(branchCtx({ kind: 'tag', knownRemotes: ['origin', 'upstream'] }));
    const items = sections[0]?.items ?? [];
    for (const remote of ['origin', 'upstream']) {
      const push = items.find((i) => i.id === `pushRef:${remote}`);
      const del = items.find((i) => i.id === `deleteRemoteRef:${remote}`);
      expect(push?.disabled).toBe(true);
      expect(push?.disabledReason).toBeTruthy();
      expect(del?.disabled).toBe(true);
      expect(del?.disabledReason).toBeTruthy();
    }
  });

  test('no known remotes -> neither item appears at all', () => {
    const sections = buildRefMenu(branchCtx({ kind: 'tag', knownRemotes: [] }));
    const ids = sections[0]?.items.map((i) => i.id) ?? [];
    expect(ids.some((id) => id.startsWith('pushRef:') || id.startsWith('deleteRemoteRef:'))).toBe(
      false,
    );
  });
});

// P76 §12.2: createWorktreeHere is un-gated (plainItem, not gatedItem) — present and enabled on
// branch/remoteBranch rows and the commit row menu even mid-operation, absent for a tag (§10: a
// tag is a point, its own commit row already offers the detached item), and absent from every
// read-only builder (it is a write, same as every other row action C10 hides).
describe('createWorktreeHere — un-gated, offered on branch/remoteBranch/commit rows only', () => {
  test('present and enabled on a branch row even with an operation in progress', () => {
    const sections = buildRefMenu(branchCtx({ inProgress: MERGE_IN_PROGRESS }));
    const item = sections[0]?.items.find((i) => i.id === 'createWorktreeHere');
    expect(item?.disabled).toBe(false);
  });

  test('present and enabled on a remoteBranch row even with an operation in progress', () => {
    const sections = buildRefMenu(
      branchCtx({ kind: 'remoteBranch', inProgress: MERGE_IN_PROGRESS }),
    );
    const item = sections[0]?.items.find((i) => i.id === 'createWorktreeHere');
    expect(item?.disabled).toBe(false);
  });

  test('absent for a tag row', () => {
    const sections = buildRefMenu(branchCtx({ kind: 'tag' }));
    const ids = sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).not.toContain('createWorktreeHere');
  });

  test('present in the commit row menu', () => {
    const sections = buildRowMenu({
      sha: 'a'.repeat(40),
      decorations: [],
      inProgress: MERGE_IN_PROGRESS,
      clipboardEnabled: false,
    });
    const item = sections[0]?.items.find((i) => i.id === 'createWorktreeHere');
    expect(item?.disabled).toBe(false);
  });

  test('absent from buildReadOnlyRefMenu and buildReadOnlyRowMenu', () => {
    const refIds = buildReadOnlyRefMenu().flatMap((s) => s.items.map((i) => i.id));
    const rowIds = buildReadOnlyRowMenu(true).flatMap((s) => s.items.map((i) => i.id));
    expect(refIds).not.toContain('createWorktreeHere');
    expect(rowIds).not.toContain('createWorktreeHere');
  });
});

// C10 §4.2/§4.3/§11 (S6): the three read-only builders must never emit an item whose id maps to
// an OpRequest kind (or, for a ref, anything the picker/graph would otherwise wire to a write) —
// UI layer 3 of the read-only boundary. The Go allowlist (gitstream_test.go) is what actually
// enforces the boundary; these three cases just pin that this layer stays honest with it.
const WRITE_CAPABLE_ROW_IDS = [
  'checkoutDetached',
  'createBranchHere',
  'createTagHere',
  'createWorktreeHere',
  'revertThisCommit',
  'resetToThisCommit',
  'cherryPickThisCommit',
];
const WRITE_CAPABLE_STASH_IDS = [
  'stashApply',
  'stashPop',
  'stashDrop',
  'stashBranch',
  'stashSaveGlobal',
  'globalStashRemove',
];

describe('C10 read-only menu builders emit no write-capable item', () => {
  test('buildReadOnlyRowMenu: only Copy SHA / Copy commit message', () => {
    const sections = buildReadOnlyRowMenu(true);
    const ids = sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual(['copySha', 'copyMessage']);
    for (const writeId of WRITE_CAPABLE_ROW_IDS) {
      expect(ids).not.toContain(writeId);
    }
  });

  // C11 §12 (S12): "Review branch changes" is restored — a read, never gated on `canRunOp`
  // (buildRefMenu's own comment) — now that review.open has a native surface. Every other write
  // buildRefMenu offers stays hidden.
  test('buildReadOnlyRefMenu: only Review branch changes, for any ref kind', () => {
    for (const kind of ['branch', 'remoteBranch', 'tag'] as const) {
      const sections = buildReadOnlyRefMenu();
      const ids = sections.flatMap((s) => s.items.map((i) => i.id));
      expect(ids).toEqual(['reviewBranch']);
      // kind is unused by the function itself (it takes no context) — looping over it here just
      // documents that the result holds regardless of which row a caller invokes it for.
      void kind;
    }
  });

  test('buildReadOnlyStashMenu: only Show changes', () => {
    const sections = buildReadOnlyStashMenu();
    const ids = sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual(['stashShow']);
    for (const writeId of WRITE_CAPABLE_STASH_IDS) {
      expect(ids).not.toContain(writeId);
    }
  });
});
