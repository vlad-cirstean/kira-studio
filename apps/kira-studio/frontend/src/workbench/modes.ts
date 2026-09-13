import type { AppMode } from '@shared/domain/mode';
import type { Component } from 'vue';
import ApiStart from '../api/ApiStart.vue';
import CollectionsPanel from '../api/CollectionsPanel.vue';
import RepoPanel from '../repo/RepoPanel.vue';
import RepoGraphView from '../views/repo/RepoGraphView.vue';
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
export const MODES: Record<AppMode, ModeDef> = {
  studio: { label: 'Studio', icon: 'database', panel: ProjectPanel, start: StudioStart },
  api: { label: 'Api', icon: 'globe', panel: CollectionsPanel, start: ApiStart },
};

// C5 §4.3: a ModeDef-shaped sibling for every repo workspace — WorkbenchShell.vue/MainView.vue
// dispatch on it the same way they dispatch on MODES[modeState.active] for studio/api, but this is
// never keyed by AppMode (one repo workspace's panel/start never differs from another's — RepoPanel
// itself reads which repo is active off workspaceState). `label`/`icon` are unused here (TitleBar's
// own repo switcher entries render a repo's *name*, not a fixed label, per §4.3) but kept so this
// stays a real ModeDef rather than a narrower ad hoc shape.
export const REPO_WORKSPACE: ModeDef = {
  label: '',
  icon: 'source-control',
  panel: RepoPanel,
  start: RepoGraphView,
};
