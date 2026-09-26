import type { AppMode } from '@shared/domain/mode';
import type { ModeRegistry } from '@workbench/modes';
import { defineAsyncComponent } from 'vue';
import ApiStart from '../api/ApiStart.vue';
import CollectionsPanel from '../api/CollectionsPanel.vue';
import ProjectPanel from './panels/ProjectPanel.vue';
import StudioStart from './panels/StudioStart.vue';

// P91 OQ-1: Terminal joins Studio/Api last, the plan's own stated default. Hoisted here from
// TitleBar.vue at P128 §2.3: one file lists a module.
export const MODE_ORDER: AppMode[] = ['studio', 'api', 'terminal'];

// P1 D6/C6: mode content comes from a registry, mirroring D4's tab-kind registry. Api's own
// entries are both EmptyState-based (§0.2) — P1 adds no HTTP functionality, only the seam.
// `Component` already covers `defineAsyncComponent`'s return either way. P128 §2.3: ModeDef/
// ModeRegistry hoisted to packages/workbench/src/modes.ts.
export const MODES: ModeRegistry<AppMode> = {
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
