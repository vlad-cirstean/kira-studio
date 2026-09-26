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
// `Component` already covers `defineAsyncComponent`'s return either way.
export const MODES: Record<AppMode, ModeDef> = {
  studio: { label: 'Studio', icon: 'database', panel: ProjectPanel, start: StudioStart },
  api: { label: 'Api', icon: 'globe', panel: CollectionsPanel, start: ApiStart },
  // P91 §2: a peer module, lazy the same reason Studio/Api's entries are — nothing
  // in a Studio-only session should pay for the terminal panel's own launch chunk.
  terminal: {
    label: 'Terminal',
    icon: 'terminal-bash',
    panel: defineAsyncComponent(() => import('../terminal/TerminalPanel.vue')),
    start: defineAsyncComponent(() => import('../terminal/TerminalStart.vue')),
  },
};
