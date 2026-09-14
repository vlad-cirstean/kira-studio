import type { AppMode } from '@shared/domain/mode';
import { type Component, defineAsyncComponent } from 'vue';
import ApiStart from '../api/ApiStart.vue';
import CollectionsPanel from '../api/CollectionsPanel.vue';
import ProjectPanel from './panels/ProjectPanel.vue';
import StudioStart from './panels/StudioStart.vue';

export interface ModeDef {
  label: string;
  icon: string;
  /** Mounted in the left-panel slot (WorkbenchShell.vue) — a whole self-contained panel that
   *  wraps PanelShell itself, the same way ProjectPanel.vue already does (D6). */
  panel: Component;
  /** MainView.vue's fallback when this mode has no active tab. */
  start: Component;
}

// P1 D6/C6: mode content comes from a registry, mirroring D4's tab-kind registry. Api's own
// entries are both EmptyState-based (§0.2) — P1 adds no HTTP functionality, only the seam.
//
// P67b §4.1: 'git' joins as a third peer module, not a special case dispatched around (§0's
// correction — a repository is an instance inside Git, not a fourth top-level tab of its own).
// §4.6: git's panel/start are lazily imported — GitPanel.vue pulls in RepoFileTree/RepoTreeRow/
// RepoSearchView/RepoReviewView (and, via RepoTreeRow, seti-icons' 144 KB of JSON data, §6.3),
// none of which a session that never opens a repository should pay for in its launch chunk
// (gitUiModule.ts's own C12-3 precedent). `Component` already covers a `defineAsyncComponent`'s
// return, so ModeDef needs no type change.
export const MODES: Record<AppMode, ModeDef> = {
  studio: { label: 'Studio', icon: 'database', panel: ProjectPanel, start: StudioStart },
  api: { label: 'Api', icon: 'globe', panel: CollectionsPanel, start: ApiStart },
  git: {
    label: 'Git',
    icon: 'source-control',
    panel: defineAsyncComponent(() => import('../repo/GitPanel.vue')),
    start: defineAsyncComponent(() => import('../repo/GitStart.vue')),
  },
};
