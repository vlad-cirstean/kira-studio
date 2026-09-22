// C5 §15.1: the preview/pin interaction in state/tabs.ts — the one piece of this phase's own
// tab-scoping rewrite that is genuinely several interacting rules over one mutable structure
// (CLAUDE.md's own testing bar), tested directly against openTab/closeTab/moveTab/closeOthers/
// closeAll rather than through any UI.
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);
(control as unknown as { tabsSave: typeof control.tabsSave }).tabsSave = () => Promise.resolve();

const { defaultRepoFileTabState } = await import('../../../../packages/shared/domain/tabs');
const { repoWorkspaceKey } = await import('../../frontend/src/state/workspace');
const { tabsForWorkspace } = await import('../../frontend/src/state/tabs');
const { useTabsStore } = await import('../../frontend/src/state/tabs');
const tabsStore = useTabsStore();
const { openRepoCommitDiffTab, openRepoFileTab } = await import(
  '../../frontend/src/state/repoTabs'
);

// Every test gets its own fresh workspace ids — tabsStore.tabs is one shared module-level array
// with no per-test reset, so reusing a workspace id across tests would leak tabs between them.
let workspaceCounter = 0;
function freshWorkspace() {
  workspaceCounter += 1;
  return repoWorkspaceKey(`test-${workspaceCounter}`);
}

// openRepoCommitDiffTab/openRepoFileTab take a raw repoId (they compute the workspace key
// themselves via repoWorkspaceKey) — a separate counter from freshWorkspace's own, same
// leak-avoidance reason.
let repoIdCounter = 0;
function freshRepoId(): string {
  repoIdCounter += 1;
  return `test-repo-${repoIdCounter}`;
}

function openFile(workspace: string, path: string, preview: boolean, previewCohort = false) {
  return tabsStore.openTab('repo-file', null, path, () => defaultRepoFileTabState(), {
    reuse: true,
    workspaceId: workspace,
    preview,
    previewCohort,
  });
}

describe('C5 §5.2: the preview slot', () => {
  test('a preview open replaces the slot tab in its own array position', () => {
    const ws = freshWorkspace();
    const a = openFile(ws, 'a.ts', false); // permanent, anchors position 0
    const b = openFile(ws, 'b.ts', true); // preview at position 1
    const c = openFile(ws, 'c.ts', false); // permanent at position 2
    expect(tabsForWorkspace(ws).map((t) => t.id)).toEqual([a.id, b.id, c.id]);

    const d = openFile(ws, 'd.ts', true); // replaces b's preview, in b's own position
    expect(tabsForWorkspace(ws).map((t) => t.id)).toEqual([a.id, d.id, c.id]);
    expect(tabsStore.tabs.find((t) => t.id === b.id)).toBeUndefined();
    expect(tabsStore.isPreview(d.id)).toBe(true);
  });

  test('a permanent open never evicts a preview tab', () => {
    const ws = freshWorkspace();
    const preview = openFile(ws, 'p.ts', true);
    const permanent = openFile(ws, 'q.ts', false);
    expect(tabsForWorkspace(ws).map((t) => t.id)).toEqual([preview.id, permanent.id]);
    expect(tabsStore.isPreview(preview.id)).toBe(true);
  });

  test('reopening the same path activates rather than duplicating', () => {
    const ws = freshWorkspace();
    const first = openFile(ws, 'same.ts', true);
    const countBefore = tabsStore.tabs.length;
    const second = openFile(ws, 'same.ts', false);
    expect(second.id).toBe(first.id);
    expect(second.reused).toBe(true);
    expect(tabsStore.tabs.length).toBe(countBefore);
  });

  test('a permanent reopen of the current preview tab promotes it (clears the slot)', () => {
    const ws = freshWorkspace();
    const tab = openFile(ws, 'promote.ts', true);
    expect(tabsStore.isPreview(tab.id)).toBe(true);
    openFile(ws, 'promote.ts', false);
    expect(tabsStore.isPreview(tab.id)).toBe(false);
  });

  test('closing the preview tab clears the slot', () => {
    const ws = freshWorkspace();
    const tab = openFile(ws, 'closeme.ts', true);
    expect(tabsStore.isPreview(tab.id)).toBe(true);
    tabsStore.closeTab(tab.id);
    expect(tabsStore.previewIdsByWorkspace[ws] ?? []).toEqual([]);
  });

  test("two workspaces' preview slots are independent", () => {
    const wsA = freshWorkspace();
    const wsB = freshWorkspace();
    const a = openFile(wsA, 'x.ts', true);
    const b = openFile(wsB, 'x.ts', true); // same relative path, different repo
    expect(tabsStore.isPreview(a.id)).toBe(true);
    expect(tabsStore.isPreview(b.id)).toBe(true);
    expect(a.id).not.toBe(b.id); // dedupe key includes workspaceId — never collapsed together
  });
});

describe('P74 §5.2: the preview cohort ("Open all changes")', () => {
  test('a bulk open leaves every file previewed, none evicting the others', () => {
    const ws = freshWorkspace();
    const a = openFile(ws, 'a.ts', true, false); // first file: evicts nothing (slot was empty)
    const b = openFile(ws, 'b.ts', true, true); // joins a's cohort
    const c = openFile(ws, 'c.ts', true, true); // joins too
    expect(tabsForWorkspace(ws).map((t) => t.id)).toEqual([a.id, b.id, c.id]);
    expect(tabsStore.isPreview(a.id)).toBe(true);
    expect(tabsStore.isPreview(b.id)).toBe(true);
    expect(tabsStore.isPreview(c.id)).toBe(true);
    expect(tabsStore.previewIdsByWorkspace[ws]).toEqual([a.id, b.id, c.id]);
  });

  test('a later single-file preview evicts the whole prior cohort, not just one member', () => {
    const ws = freshWorkspace();
    const a = openFile(ws, 'a.ts', true, false);
    const b = openFile(ws, 'b.ts', true, true);
    const c = openFile(ws, 'c.ts', true, true);
    expect(tabsForWorkspace(ws).map((t) => t.id)).toEqual([a.id, b.id, c.id]);

    const d = openFile(ws, 'd.ts', true, false); // a plain tree-click preview, not a bulk open
    expect(tabsStore.tabs.find((t) => t.id === a.id)).toBeUndefined();
    expect(tabsStore.tabs.find((t) => t.id === b.id)).toBeUndefined();
    expect(tabsStore.tabs.find((t) => t.id === c.id)).toBeUndefined();
    expect(tabsStore.previewIdsByWorkspace[ws]).toEqual([d.id]);
  });

  test('a permanent open never evicts the cohort', () => {
    const ws = freshWorkspace();
    const a = openFile(ws, 'a.ts', true, false);
    const b = openFile(ws, 'b.ts', true, true);
    const permanent = openFile(ws, 'keep.ts', false);
    expect(tabsStore.isPreview(a.id)).toBe(true);
    expect(tabsStore.isPreview(b.id)).toBe(true);
    expect(tabsForWorkspace(ws).map((t) => t.id)).toEqual([a.id, b.id, permanent.id]);
  });

  // P79 review fix (Performance, MEDIUM): evicting a large cohort ("Open all changes" on a
  // many-file commit) used to call tabsStore.closeTab() per evicted tab, each doing its own synchronous
  // full-array control.tabsSave() round trip. Asserts the whole eviction now costs exactly one.
  test('evicting a large cohort in one go saves exactly once', () => {
    const ws = freshWorkspace();
    openFile(ws, 'seed.ts', true, false);
    for (let i = 0; i < 20; i++) openFile(ws, `bulk${i}.ts`, true, true);
    expect(tabsStore.previewIdsByWorkspace[ws]?.length).toBe(21);

    let saveCalls = 0;
    const original = control.tabsSave;
    (control as unknown as { tabsSave: typeof control.tabsSave }).tabsSave = (...args) => {
      saveCalls += 1;
      return original(...args);
    };
    let evictor: { id: string };
    try {
      evictor = openFile(ws, 'evict-all.ts', true, false); // a plain preview click, not a bulk open
    } finally {
      (control as unknown as { tabsSave: typeof control.tabsSave }).tabsSave = original;
    }
    expect(saveCalls).toBe(1);
    expect(tabsStore.previewIdsByWorkspace[ws]).toEqual([evictor.id]);
  });
});

describe('P79 review fix: openRepoCommitDiffTab reuse still evicts the preview cohort', () => {
  test("reusing file 0's existing permanent tab still evicts a stale cohort, and later files join fresh", () => {
    const repoId = freshRepoId();
    const ws = repoWorkspaceKey(repoId);
    const diffLabels = { left: 'base', right: 'sha1' };

    // file 0's diff tab already exists as a permanent (pinned) tab.
    const file0 = openRepoCommitDiffTab(repoId, 'a.ts', 'base', 'sha1', diffLabels, true);
    expect(tabsStore.isPreview(file0.id)).toBe(false);

    // An unrelated preview tab is open in the same workspace beforehand.
    const stale = openRepoFileTab(repoId, 'unrelated.ts', { preview: true });
    expect(tabsStore.isPreview(stale.id)).toBe(true);

    // "Open all changes": file 0 reuses its existing permanent tab (pinned: false,
    // previewCohort unset) — the reuse short-circuit must still evict the stale cohort.
    const reused = openRepoCommitDiffTab(repoId, 'a.ts', 'base', 'sha1', diffLabels, false);
    expect(reused.id).toBe(file0.id);
    expect(reused.reused).toBe(true);
    expect(tabsStore.tabs.find((t) => t.id === stale.id)).toBeUndefined();
    expect(tabsStore.previewIdsByWorkspace[ws]).toEqual([file0.id]);

    // file 1 joins the cohort file 0 just started.
    const file1 = openRepoCommitDiffTab(repoId, 'b.ts', 'base', 'sha1', diffLabels, false, true);
    expect(tabsStore.previewIdsByWorkspace[ws]).toEqual([file0.id, file1.id]);
  });
});

describe('P74 §6: promoting a preview tab on double click', () => {
  test('promoting one member of a cohort leaves the rest previewed', () => {
    const ws = freshWorkspace();
    const a = openFile(ws, 'a.ts', true, false);
    const b = openFile(ws, 'b.ts', true, true);
    const c = openFile(ws, 'c.ts', true, true);

    tabsStore.promoteTab(b.id);
    expect(tabsStore.isPreview(a.id)).toBe(true);
    expect(tabsStore.isPreview(b.id)).toBe(false);
    expect(tabsStore.isPreview(c.id)).toBe(true);
    expect(tabsStore.previewIdsByWorkspace[ws]).toEqual([a.id, c.id]);
  });

  test('a promoted tab survives a later cohort-evicting preview open', () => {
    const ws = freshWorkspace();
    const a = openFile(ws, 'a.ts', true, false);
    const b = openFile(ws, 'b.ts', true, true);
    tabsStore.promoteTab(a.id);

    const c = openFile(ws, 'c.ts', true, false); // evicts only b, the one still previewed
    expect(tabsStore.tabs.find((t) => t.id === a.id)).toBeDefined();
    expect(tabsStore.tabs.find((t) => t.id === b.id)).toBeUndefined();
    expect(tabsForWorkspace(ws).map((t) => t.id)).toEqual([a.id, c.id]);
  });

  test('promoting a tab that is not in any preview cohort is a no-op', () => {
    const ws = freshWorkspace();
    const permanent = openFile(ws, 'p.ts', false);
    tabsStore.promoteTab(permanent.id);
    expect(tabsStore.isPreview(permanent.id)).toBe(false);
    expect(tabsStore.tabs.find((t) => t.id === permanent.id)).toBeDefined();
  });
});

describe('C5 §6.1: the pinned tab', () => {
  test('tabsForWorkspace puts the pinned tab first after a moveTab that tried to drag another tab in front of it', () => {
    const ws = freshWorkspace();
    const graph = tabsStore.createPinnedRepoGraphTab(ws);
    const file1 = openFile(ws, 'f1.ts', false);
    const file2 = openFile(ws, 'f2.ts', false);

    // Attempt to drag file2 in front of the pinned graph tab — moveTab must refuse outright since
    // the drop target (graph) is pinned.
    tabsStore.moveTab(file2.id, graph.id);

    const order = tabsForWorkspace(ws).map((t) => t.id);
    expect(order[0]).toBe(graph.id);
    expect(order).toEqual([graph.id, file1.id, file2.id]);
  });

  test('moveTab on the pinned tab itself is a no-op', () => {
    const ws = freshWorkspace();
    const graph = tabsStore.createPinnedRepoGraphTab(ws);
    const file1 = openFile(ws, 'g1.ts', false);
    const before = tabsStore.tabs.map((t) => t.id);
    tabsStore.moveTab(graph.id, file1.id);
    expect(tabsStore.tabs.map((t) => t.id)).toEqual(before);
  });

  test('closeTab, closeOthers and closeAll all leave the pinned tab alive', () => {
    const ws = freshWorkspace();
    const graph = tabsStore.createPinnedRepoGraphTab(ws);
    const file1 = openFile(ws, 'h1.ts', false);
    const file2 = openFile(ws, 'h2.ts', false);

    tabsStore.closeTab(graph.id); // §6.1: a pinned tab never closes.
    expect(tabsStore.tabs.some((t) => t.id === graph.id)).toBe(true);

    tabsStore.closeOthers(file1.id);
    expect(tabsStore.tabs.some((t) => t.id === graph.id)).toBe(true);
    expect(tabsStore.tabs.some((t) => t.id === file2.id)).toBe(false);

    tabsStore.closeAll(ws);
    expect(tabsStore.tabs.some((t) => t.id === graph.id)).toBe(true);
    expect(tabsForWorkspace(ws).filter((t) => t.id !== graph.id).length).toBe(0);
  });

  test('duplicateTab refuses a pinned tab', () => {
    const ws = freshWorkspace();
    const graph = tabsStore.createPinnedRepoGraphTab(ws);
    const countBefore = tabsStore.tabs.length;
    const result = tabsStore.duplicateTab(graph.id);
    expect(result).toBe(graph.id);
    expect(tabsStore.tabs.length).toBe(countBefore);
  });
});
