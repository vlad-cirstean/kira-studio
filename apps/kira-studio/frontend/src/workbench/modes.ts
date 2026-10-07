import type { AppMode } from '@shared/domain/mode';
import type { ModeRegistry, PanelModeDef } from '@workbench/modes';
import { defineAsyncComponent } from 'vue';
import ApiStart from '../api/ApiStart.vue';
import CollectionsPanel from '../api/CollectionsPanel.vue';
import ProjectPanel from './panels/ProjectPanel.vue';
import StudioStart from './panels/StudioStart.vue';

// P91 OQ-1: Terminal joins Studio/Api last, the plan's own stated default. Hoisted here from
// TitleBar.vue at P128 §2.3: one file lists a module.
export const MODE_ORDER: AppMode[] = ['studio', 'api', 'terminal', 'docker'];

// P1 D6/C6: mode content comes from a registry, mirroring D4's tab-kind registry. Api's own
// entries are both EmptyState-based (§0.2) — P1 adds no HTTP functionality, only the seam.
// `Component` already covers `defineAsyncComponent`'s return either way. P128 §2.3: ModeDef/
// ModeRegistry hoisted to packages/workbench/src/modes.ts. P128 §2.4: `terminal`'s panel/start/
// newTab now live in the shared terminal module (packages/workbench/src/terminal/) — no
// `modeStore.active === 'terminal'` branch anywhere in WorkbenchShell.vue any more, the module
// owns its own "+" via `newTab`.
// P129 Part 3 §0.12: every one of this app's own modes is a panel module, so `MODES` is typed
// `ModeRegistry<AppMode, PanelModeDef>` rather than the base `ModeDef` union — a one-line type
// change, no behavior change, since this app's own shell already reads `.panel`/`.start`
// unconditionally.
export const MODES: ModeRegistry<AppMode, PanelModeDef> = {
  studio: { label: 'Studio', icon: 'database', panel: ProjectPanel, start: StudioStart },
  api: { label: 'Api', icon: 'globe', panel: CollectionsPanel, start: ApiStart },
  // P91 §2: a peer module, lazy the same reason Studio/Api's entries are — nothing
  // in a Studio-only session should pay for the terminal panel's own launch chunk.
  terminal: {
    label: 'Terminal',
    icon: 'terminal-bash',
    panel: defineAsyncComponent(() => import('@workbench/terminal/TerminalPanel.vue')),
    start: defineAsyncComponent(() => import('@workbench/terminal/TerminalStart.vue')),
    newTab: defineAsyncComponent(() => import('@workbench/terminal/TerminalNewTab.vue')),
  },
  // P200: lazy like Terminal; no tabs of its own, so the tab strip is hidden for this mode.
  docker: {
    label: 'Docker',
    icon: 'vm',
    tabStrip: false,
    panel: defineAsyncComponent(() => import('../docker/DockerPanel.vue')),
    start: defineAsyncComponent(() => import('../docker/DockerView.vue')),
  },
};
