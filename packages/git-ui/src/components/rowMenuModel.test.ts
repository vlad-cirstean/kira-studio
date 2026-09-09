import { describe, expect, test } from 'bun:test';
import { buildRefMenu, type RefMenuContext } from './rowMenuModel.ts';

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
