import type { Component } from 'vue';
import type { SpaceTabKind } from '../state/tabKinds';
import RepoDiffTabView from '../views/repo/RepoDiffView.vue';
import RepoFileTabView from '../views/repo/RepoFileView.vue';
import RepoGraphTabView from '../views/repo/RepoGraphView.vue';
import RepoMultiDiffTabView from '../views/repo/RepoMultiDiffView.vue';
import TerminalTabView from '../views/repo/RepoTerminalView.vue';

// P100 Part 2: Kira Studio's own workbench/tabViews.ts (the component half of the tab-kind
// registry, split from state/tabKinds.ts because state/ -> workbench/ is a lint-forbidden edge)
// — keyed by SpaceTabKind (state/tabKinds.ts), this app's own five kinds, every one of them real.
// Unlike Studio (which keeps the repo-* kinds in the still-shared TabKind union and stubs them
// with NeverRenderedTabView), this app has no DB-client kind left over to stub the same way, so
// there is no unreachable entry here at all.
export const TAB_VIEWS: Record<SpaceTabKind, Component> = {
  'repo-graph': RepoGraphTabView,
  'repo-file': RepoFileTabView,
  'repo-diff': RepoDiffTabView,
  'repo-multi-diff': RepoMultiDiffTabView,
  terminal: TerminalTabView,
};
