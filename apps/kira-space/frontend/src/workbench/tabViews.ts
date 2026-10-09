import ScriptRunView from '@workbench/automations/runs/ScriptRunView.vue';
import TerminalTabView from '@workbench/terminal/TerminalTabView.vue';
import type { Component } from 'vue';
import type { SpaceTabKind } from '../state/tabDomain';
import RepoDiffTabView from '../views/repo/RepoDiffView.vue';
import RepoFileTabView from '../views/repo/RepoFileView.vue';
import RepoGraphTabView from '../views/repo/RepoGraphView.vue';
import RepoMultiDiffTabView from '../views/repo/RepoMultiDiffView.vue';

// P100 Part 2: Kira Studio's own workbench/tabViews.ts (the component half of the tab-kind
// registry, split from state/tabKinds.ts because state/ -> workbench/ is a lint-forbidden edge)
// — keyed by SpaceTabKind (state/tabKinds.ts), this app's own five kinds, every one of them real.
// Unlike Studio (which keeps the repo-* kinds in the still-shared TabKind union and stubs them
// with NeverRenderedTabView), this app has no DB-client kind left over to stub the same way, so
// there is no unreachable entry here at all. P128 §2.5/§2.7: `terminal` is now the one shared
// component (packages/workbench/src/terminal/TerminalTabView.vue) both apps render, for either a
// Terminal-module tab or a repo terminal — the two differ only in workspaceId/codeRepoId, set by
// whichever opener built the tab (views/repo/RepoTerminalView.vue deleted).
export const TAB_VIEWS: Record<SpaceTabKind, Component> = {
  'repo-graph': RepoGraphTabView,
  'repo-file': RepoFileTabView,
  'repo-diff': RepoDiffTabView,
  'repo-multi-diff': RepoMultiDiffTabView,
  terminal: TerminalTabView,
  'script-run': ScriptRunView,
};
